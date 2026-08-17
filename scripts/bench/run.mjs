/**
 * The benchmark driver: how well an agent does on a page with AgenticSchema's
 * tools, against the same agent given the page's text.
 *
 *   node scripts/bench/run.mjs --pages 5 --concurrency 4
 *   node scripts/bench/run.mjs --dry-run          # what it would cost, spending nothing
 *
 * One trial is one `claude -p --output-format json` invocation answering one
 * question about one page. The two arms differ in exactly one thing:
 *
 *   text    the extracted text of the page is in the prompt, and no tools
 *   tools   an MCP server built from the page's markup, and no text
 *
 * Every answer is scored against two keys, written by two more invocations. One
 * reads the rendered text alone, which is biased against AgenticSchema by
 * construction — a fact carried only in the markup is not in that key, so the
 * arm that knew it is marked down. The other reads the text and what the page
 * publishes as data, and is the one that can say which input serves an agent
 * better. Neither is called accuracy; `verdict.mjs` says why at more length.
 *
 * Everything a run produces is written the moment it is produced. A run of any
 * size gets interrupted, and one that had to start over would never finish.
 * What is written carries a fingerprint of the configuration that produced it,
 * because "already on disk" is not the same as "still comparable".
 */
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUILT_IN_TOOLS,
  DEFAULT_TIMEOUT_MS,
  judgePrompt,
  killLiveTrials,
  labelPrompt,
  neutralLabelPrompt,
  runTrial,
  textPrompt,
  toolsPrompt,
} from './claude.mjs';
import { callsFor, fingerprint, planCells, planCost, trialId } from './plan.mjs';
import { needsJudge, verdict } from './verdict.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCK = join(ROOT, 'corpus', 'corpus.lock.json');
const TASKS = join(ROOT, 'corpus', 'tasks.json');
const PAGES = join(ROOT, 'packages', 'core', 'test', 'fixtures', 'local');
const SERVER = join(ROOT, 'scripts', 'bench', 'page-server.mjs');

/**
 * The benchmark runs against the built packages, because that is what it is
 * measuring. A fresh clone has no `dist`, and left to the bare import the first
 * thing anyone saw was a stack trace naming a package they had never installed.
 *
 * Checked here rather than inside `page.mjs`, which the test suite imports and
 * which therefore has no business calling `process.exit`.
 */
if (!existsSync(join(ROOT, 'packages', 'server', 'dist', 'index.js'))) {
  process.stderr.write('bench: the packages are not built. Run "npm run build" first.\n');
  process.exit(1);
}
const { readPage } = await import('./page.mjs');

const USAGE = `
node scripts/bench/run.mjs [options]

  --pages N          pages per vertical (default 5, 0 for all)
  --only a,b         verticals to run (default all that have questions)
  --task a,b         question ids to run (default all)
  --arms text,tools  which arms (default both)
  --concurrency N    trials in flight at once (default 4)
  --model NAME       model the two arms answer with (default sonnet)
  --referee-model N  model that writes the keys and judges (default sonnet)
  --max-turns N      turn cap per trial (default 8)
  --timeout MS       kill a trial after this long (default ${DEFAULT_TIMEOUT_MS})
  --out DIR          where results go (default bench-results/)
  --redo [verdicts]  re-run trials already on disk whose verdict is one of these
                     (default: everything that is not a match)
  --force            re-run every trial already on disk
  --rekey            recompute answer keys already on disk
  --dry-run          print the plan and the calls it would cost, then stop

Four verticals and five questions each, so a run is 20 cells per page:
--pages 5 is 100 cells, --pages 10 is 200. The default is deliberately small.
A full sweep costs several rate-limit windows, and this is meant to be run after
every change rather than once a week.

After changing the library, the loop that costs almost nothing is

  --arms tools --redo

which reuses the answer keys, leaves the text arm alone — it cannot have moved —
and re-runs only the trials that were not already agreeing.
`;

// ---------------------------------------------------------------------------
// arguments

/** Cheap enough to run often, capable enough to be worth measuring. */
const DEFAULT_MODEL = 'sonnet';

const argv = process.argv.slice(2);
/**
 * The value after a flag, and nothing when the next word is another flag.
 *
 * That second half is what makes `--redo` usable on its own: written as
 * `--redo --arms tools`, a naive reader hands back `--arms` as the list of
 * verdicts to redo, and the run quietly does nothing at all.
 */
const flag = (name) => {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const next = argv[i + 1];
  return next === undefined || next.startsWith('-') ? undefined : next;
};
const has = (name) => argv.includes(name);
const list = (name) =>
  flag(name)
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);

if (has('-h') || has('--help')) {
  process.stdout.write(USAGE);
  process.exit(0);
}

const options = {
  pagesPerVertical: flag('--pages') === undefined ? 5 : Number(flag('--pages')),
  verticals: list('--only'),
  taskIds: list('--task'),
  arms: list('--arms') ?? ['text', 'tools'],
  concurrency: Number(flag('--concurrency') ?? 4),
  model: flag('--model') ?? DEFAULT_MODEL,
  /**
   * The referee is a separate choice, and it does not follow `--model`.
   *
   * Two thirds of a run's allowance goes on writing keys and judging, so it is
   * the obvious place to economise and the worst one. A labeller that misreads
   * a page writes a key **both** arms are then scored against, and that noise
   * lands on the difference between them — which is the entire measurement. The
   * arms are the cheap third and the safe place to vary.
   *
   * So cheapening the arms never quietly cheapens the referee. Ask for that
   * explicitly, and the fingerprint will record that you did.
   */
  refereeModel: flag('--referee-model') ?? DEFAULT_MODEL,
  maxTurns: Number(flag('--max-turns') ?? 8),
  timeoutMs: Number(flag('--timeout') ?? DEFAULT_TIMEOUT_MS),
  out: resolve(ROOT, flag('--out') ?? 'bench-results'),
  // `--redo` on its own means every trial that is not already a match, which is
  // what you want after fixing something: the agreeing trials cost calls to
  // confirm what they already said.
  redo: has('--redo') ? (list('--redo') ?? ['not-match']) : undefined,
  force: has('--force'),
  rekey: has('--rekey'),
  dryRun: has('--dry-run'),
};

for (const arm of options.arms) {
  if (arm !== 'text' && arm !== 'tools') die(`unknown arm: ${arm}`);
}
if (!(options.concurrency >= 1)) die('--concurrency must be at least 1');

function die(message) {
  process.stderr.write(`bench: ${message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// inputs

const lock = read(LOCK, 'run "npm run corpus:fetch" first');
const taskFile = read(TASKS);

function read(path, hint) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    die(`cannot read ${path}${hint ? ` (${hint})` : ''}: ${error.message}`);
  }
}

const protocol = taskFile.answerProtocol;
const cells = planCells({
  pages: lock.pages,
  tasks: taskFile.tasks,
  pagesPerVertical: options.pagesPerVertical || undefined,
  verticals: options.verticals,
  taskIds: options.taskIds,
});

if (cells.length === 0) die('the plan is empty: check --only and --task');

const out = (line) => process.stdout.write(`${line}\n`);

// ---------------------------------------------------------------------------
// output layout. Every answer here is derived from someone else's page, so this
// directory is gitignored and stays that way.

const dirs = {
  keys: join(options.out, 'keys'),
  trials: join(options.out, 'trials'),
  mcp: join(options.out, 'mcp'),
  // The CLI is run from an empty directory rather than from the repo, so that a
  // trial does not pick up this project's CLAUDE.md, its settings or its own
  // MCP servers. Configuration at user level still applies — it applies to both
  // arms equally, which is what the comparison needs.
  sandbox: join(options.out, 'sandbox'),
};
for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });

let writes = 0;

function writeJson(path, value) {
  // Written under a temporary name and renamed, because the run gets killed and
  // a half-written trial that resume then skips is worse than no trial at all.
  // The temporary name is unique per write: several lanes ask for the same page
  // config at once, and a shared scratch name lets one truncate what another is
  // about to rename into place.
  const tmp = `${path}.${process.pid}.${writes++}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

const keyPath = (cell) => join(dirs.keys, `${cell.id}.json`);
const trialPath = (cell, arm) => join(dirs.trials, `${trialId(cell.id, arm)}.json`);

// ---------------------------------------------------------------------------
// what this run is, precisely enough to know whether an old trial still counts

/** Every source file that decides what a page is turned into, hashed together. */
function sourceHash(paths) {
  const hash = createHash('sha256');
  const walk = (path) => {
    if (statSync(path).isDirectory()) {
      for (const entry of readdirSync(path).sort()) walk(join(path, entry));
    } else if (/\.(ts|mjs)$/.test(path)) {
      hash.update(path).update(readFileSync(path));
    }
  };
  for (const path of paths) walk(path);
  return hash.digest('hex').slice(0, 12);
}

/**
 * The library that turns markup into tools, and the harness that turns a page
 * into a prompt. Both change what an answer will be, and neither shows up in
 * any option, so both are hashed from source. `claude.mjs` covers the prompts
 * and every CLI flag; `page.mjs` covers the text extraction the other arm gets.
 */
const LIBRARY = sourceHash([
  join(ROOT, 'packages', 'core', 'src'),
  join(ROOT, 'packages', 'profiles', 'src'),
]);
const HARNESS = sourceHash([
  join(ROOT, 'scripts', 'bench', 'claude.mjs'),
  join(ROOT, 'scripts', 'bench', 'page.mjs'),
]);

const pageHashes = new Map(lock.pages.map((page) => [page.file, page.sha256]));

/**
 * What a pair of answer keys depended on. A reworded question or a different
 * referee makes the cached keys answers to a question nobody asked — which
 * happened, and had to be cleaned up by hand.
 */
const keyConfigOf = (cell) =>
  fingerprint({
    refereeModel: options.refereeModel,
    protocol,
    question: cell.question,
    page: pageHashes.get(cell.file) ?? cell.file,
    harness: HARNESS,
  });

/**
 * The settings a whole run shares. Every trial of one run carries the same
 * value, which is what makes it worth grouping by: "these 400 trials are one
 * measurement, those 60 are another".
 */
const RUN_CONFIG = fingerprint({
  model: options.model,
  refereeModel: options.refereeModel,
  maxTurns: options.maxTurns,
  denied: BUILT_IN_TOOLS,
  library: LIBRARY,
  harness: HARNESS,
});

/**
 * What a trial's answer depended on: the run's settings and this cell's own
 * inputs. Compared against the record on disk, so a result produced under a
 * different model, turn cap, deny list, question, page or library is re-run
 * rather than averaged in with the rest.
 *
 * Two hashes rather than one, because they answer different questions. `hash`
 * is unique per trial and decides whether *this* trial still stands; `run` is
 * shared by every trial of a run and is what a report can group by. Reporting
 * on `hash` alone printed one group per trial, which is a list rather than a
 * warning.
 *
 * The keys' fingerprint is folded in: a trial carries a copy of the keys it was
 * scored against, so recomputing those without redoing the trial would leave a
 * stored verdict that no longer follows from anything on disk.
 */
const configOf = (cell, arm) => ({
  hash: fingerprint({
    run: RUN_CONFIG,
    arm,
    allowed: arm === 'tools' ? 'mcp__page' : '',
    keys: keyConfigOf(cell),
  }),
  run: RUN_CONFIG,
  model: options.model,
  refereeModel: options.refereeModel,
  library: LIBRARY,
  harness: HARNESS,
});

/**
 * Which arms of a cell still need running, decided before anything is spawned
 * so that the run can say how much work it is about to do rather than
 * discovering it.
 *
 * A trial already on disk is skipped, which is what makes a run resumable.
 * `--redo` reopens the ones whose verdict is worth another look, and the
 * verdict is recomputed from the recorded answer rather than read off the file:
 * a scoring fix should decide what gets rerun, and the file was written by
 * whatever the scoring was that day.
 */
let stale = 0;

function armsNeeded(cell) {
  return options.arms.filter((arm) => {
    const path = trialPath(cell, arm);
    if (options.force) return true;
    // `--redo` re-checks what has been measured; it does not open cells that
    // were never run. Otherwise "re-run the trials that disagreed" quietly
    // becomes "run the rest of the corpus too", which is the one thing the
    // small default is there to avoid.
    if (!existsSync(path)) return !options.redo;

    let recorded;
    try {
      recorded = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      return true;
    }

    // Produced by a different model, turn cap, deny list, question or version
    // of the library. Skipping it would report two measurements as one, which
    // is how a `ToolSearch` experiment and a mapping fix both ended up averaged
    // into results that claimed to be a single run.
    if (recorded.config?.hash !== configOf(cell, arm).hash) {
      stale += 1;
      return true;
    }

    if (!options.redo) return false;
    const outcome = verdict(recorded);
    return options.redo.includes('not-match') ? outcome !== 'match' : options.redo.includes(outcome);
  });
}

const todo = new Map(cells.map((cell) => [cell.id, armsNeeded(cell)]));
const toRun = [...todo.values()].reduce((sum, arms) => sum + arms.length, 0);
// A key already computed is reused whatever else is rerun, which is most of why
// a second run is so much cheaper than the first.
const keysToWrite = cells.filter(
  (cell) => todo.get(cell.id).length > 0 && (options.rekey || !existsSync(keyPath(cell)))
).length;
const cost = planCost(cells, options.arms);

out(
  `bench: ${cells.length} cells, ${options.arms.join(' + ')}, model ${options.model}` +
    (options.refereeModel === options.model ? '' : `, referee ${options.refereeModel}`)
);
out(
  `  ${cost.trials - toRun} trials already on disk, ${toRun} to run, ` +
    `${keysToWrite} cells needing keys — at most ${callsFor(keysToWrite, toRun)} CLI calls`
);
if (stale > 0) {
  out(
    `  ${stale} of those were run under a different configuration — model, turn cap,` +
      ' deny list, question or library — and are being redone rather than mixed in'
  );
}
for (const [vertical, n] of countBy(cells, (c) => c.vertical)) {
  out(`  ${vertical.padEnd(12)} ${n} cells`);
}

if (options.dryRun) {
  out('bench: --dry-run, nothing spawned');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// the page: read once, however many questions are asked about it

const pages = new Map();
const configs = new Map();

/** Parsed once per page, however many questions are asked about it. */
function pageFor(cell) {
  if (!pages.has(cell.file)) {
    pages.set(
      cell.file,
      (async () => readPage(readFileSync(join(PAGES, cell.file), 'utf8')))()
    );
  }
  return pages.get(cell.file);
}

/**
 * The tools arm's half of the setup: a config naming the page's own server and
 * nothing else. `--strict-mcp-config` in `buildArgs` is what makes "nothing
 * else" true; without it the machine's own MCP servers join in and the arm
 * stops being about this page.
 */
function configFor(cell) {
  if (!configs.has(cell.pageSlug)) {
    const path = join(dirs.mcp, `${cell.pageSlug}.json`);
    writeJson(path, {
      mcpServers: {
        page: { command: process.execPath, args: [SERVER, join(PAGES, cell.file), cell.url] },
      },
    });
    configs.set(cell.pageSlug, path);
  }
  return configs.get(cell.pageSlug);
}

// ---------------------------------------------------------------------------
// the three kinds of call

const base = {
  model: options.model,
  maxTurns: options.maxTurns,
  timeoutMs: options.timeoutMs,
  cwd: dirs.sandbox,
  disallowedTools: BUILT_IN_TOOLS,
};

/** Keys and judging, which are two thirds of the allowance and all of the metre. */
const refereeBase = { ...base, model: options.refereeModel };

/**
 * The two keys for a cell, computed once and reused by every later run.
 *
 *   key         written from the rendered text alone. Systematically friendly
 *               to the text arm, and the tools arm cannot beat it: its ceiling
 *               is repeating what the prose already said.
 *   neutralKey  written from the text AND what the page publishes as data, so a
 *               fact in either counts. This is the one that can say which input
 *               serves an agent better, rather than which reproduces the prose.
 *
 * Both, always. Reporting one would be choosing an answer.
 */
async function answerKeys(cell) {
  const path = keyPath(cell);
  const config = keyConfigOf(cell);

  if (!options.rekey && existsSync(path)) {
    const cached = JSON.parse(readFileSync(path, 'utf8'));
    if (cached.key && cached.neutralKey && cached.config === config) return cached;
  }

  const page = await pageFor(cell);
  const ask = (prompt) => runTrial({ ...refereeBase, prompt });

  const [fromText, fromBoth] = await Promise.all([
    ask(labelPrompt({ url: cell.url, text: page.text, question: cell.question, protocol })),
    ask(
      neutralLabelPrompt({
        url: cell.url,
        text: page.text,
        structured: page.structured,
        question: cell.question,
        protocol,
      })
    ),
  ]);

  for (const result of [fromText, fromBoth]) {
    if (!result.ok && result.exhausted) noteExhausted(result.error);
  }
  if (!fromText.ok || !fromBoth.ok) {
    return { error: (fromText.ok ? fromBoth : fromText).error };
  }

  const record = {
    cellId: cell.id,
    url: cell.url,
    taskId: cell.taskId,
    key: fromText.answer,
    neutralKey: fromBoth.answer,
    mappable: page.mappable,
    config,
    model: options.refereeModel,
    at: new Date().toISOString(),
    metrics: metricsOf(fromText),
    neutralMetrics: metricsOf(fromBoth),
  };
  // Only a pair of keys that exist is written. A failed one left on disk would
  // be reused by every later run as if it were an answer.
  if (record.key && record.neutralKey) writeJson(path, record);
  return record;
}

async function runArm(cell, arm, text) {
  const prompt =
    arm === 'text'
      ? textPrompt({ url: cell.url, text, question: cell.question, protocol })
      : toolsPrompt({ url: cell.url, question: cell.question, protocol });

  return runTrial({
    ...base,
    prompt,
    ...(arm === 'tools' ? { mcpConfig: configFor(cell), allowedTools: 'mcp__page' } : {}),
  });
}

async function judge(cell, key, answer) {
  const result = await runTrial({
    ...refereeBase,
    prompt: judgePrompt({ question: cell.question, key, answer }),
    // One comparison, one turn. A judge that went round again would be
    // deliberating, and there is nothing here to deliberate about.
    maxTurns: 1,
  });
  return result.ok
    ? { judgement: result.answer, costUsd: result.costUsd, durationMs: result.durationMs }
    : { error: result.error, exhausted: result.exhausted };
}

const metricsOf = (result) => ({
  turns: result.turns ?? 0,
  durationMs: result.durationMs ?? 0,
  costUsd: result.costUsd ?? 0,
  inputTokens: result.inputTokens ?? 0,
  outputTokens: result.outputTokens ?? 0,
  cachedTokens: result.cachedTokens ?? 0,
  cacheWriteTokens: result.cacheWriteTokens ?? 0,
  denials: result.denials ?? 0,
});

// ---------------------------------------------------------------------------
// the run

let stopping = false;
let exhausted = false;
let done = 0;
let spend = 0;
const started = Date.now();
const planned = cells.length * options.arms.length;

/**
 * The allowance, not the wallet.
 *
 * This runs on the CLI's own login, so nothing here is billed per token; what
 * runs out is the subscription's rate limit, and on a run of this length it
 * will. The first refusal stops everything. Left going, the remaining trials
 * fail one after another in seconds, and — because a written trial is a trial
 * the next run skips — a fifteen-minute outage would be preserved as several
 * hundred permanent non-answers.
 */
function noteExhausted(message) {
  if (exhausted) return;
  exhausted = true;
  stopping = true;
  process.stderr.write(`\nbench: the subscription's allowance is used up — ${message}\n`);
  process.stderr.write('bench: stopping here. Everything finished is on disk; rerun to continue.\n');
  killLiveTrials();
}

/**
 * A trial that never produced an answer is logged and left undone, never
 * written as a result. Recording it would mean a resumed run skipped it, and
 * one bad afternoon would be indistinguishable, ever after, from a page the
 * agent could not answer about.
 */
function noteFailure(cell, arm, error) {
  appendFileSync(
    join(options.out, 'failures.log'),
    `${new Date().toISOString()}\t${cell.id}\t${arm}\t${String(error).replace(/\s+/g, ' ')}\n`
  );
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (stopping) process.exit(130);
    stopping = true;
    process.stderr.write(`\nbench: ${signal}, killing trials in flight\n`);
    // The driver dying while its children live is how a run keeps eating the
    // allowance after you have stopped watching it. Everything already written
    // stays, and the next run picks up from there.
    killLiveTrials();
  });
}

async function work(cell) {
  const wanted = todo.get(cell.id) ?? [];
  // What a previous run already finished still counts towards the total, or a
  // resumed run appears to be running backwards.
  done += options.arms.length - wanted.length;
  if (wanted.length === 0) return;

  const keys = await answerKeys(cell);
  if (!keys.key || !keys.neutralKey) {
    // No key means nothing about this cell can be scored, and running the arms
    // would spend two calls to learn nothing.
    report(cell, '—', 'unkeyed', 0, keys.error ?? 'no key');
    done += wanted.length;
    return;
  }

  const page = await pageFor(cell);

  for (const arm of wanted) {
    if (stopping) return;
    const result = await runArm(cell, arm, page.text);

    if (!result.ok) {
      if (result.exhausted) noteExhausted(result.error);
      // A trial killed because the run is already stopping is not a failure of
      // its own, and logging it would fill the log with our own signals.
      else if (!stopping) noteFailure(cell, arm, result.error);
      report(cell, arm, 'failed', result.durationMs ?? 0, result.error);
      done += 1;
      continue;
    }
    const answer = result.answer;

    // Judged against both keys, in parallel: they disagree exactly where the
    // markup and the prose do, and that disagreement is the finding.
    //
    // Except where they agree, which is four times in five. The same answer
    // against the same key is the same judgement, and asking twice spent 40% of
    // the judging budget to find that out — worse, a model asked one question
    // twice can answer it two ways, so the second call was buying noise.
    const oneKey = keys.key === keys.neutralKey;
    const [judged, neutrallyJudged] = oneKey
      ? await Promise.all([
          needsJudge(keys.key, answer) ? judge(cell, keys.key, answer) : undefined,
        ]).then(([only]) => [only, only])
      : await Promise.all([
          needsJudge(keys.key, answer) ? judge(cell, keys.key, answer) : undefined,
          needsJudge(keys.neutralKey, answer) ? judge(cell, keys.neutralKey, answer) : undefined,
        ]);

    for (const record of [judged, neutrallyJudged]) {
      if (record?.exhausted) noteExhausted(record.error);
    }

    // An answer whose judge never ran is not a result. Written anyway it would
    // count as `unjudged` for good, since a trial on disk is one the next run
    // skips — so it is left undone and picked up next time. A judge that
    // answered something unreadable is different: that is recorded, and shows
    // up in the report as the anomaly it is.
    const judgeError = judged?.error ?? neutrallyJudged?.error;
    if (judgeError) {
      if (!stopping) noteFailure(cell, arm, `judge: ${judgeError}`);
      report(cell, arm, 'unjudged', result.durationMs ?? 0, judgeError);
      done += 1;
      continue;
    }

    const judgement = judged?.judgement;
    const judgeRecord = judged;

    const record = {
      id: trialId(cell.id, arm),
      cellId: cell.id,
      arm,
      vertical: cell.vertical,
      taskId: cell.taskId,
      kind: cell.kind,
      question: cell.question,
      url: cell.url,
      file: cell.file,
      model: options.model,
      // What this answer depended on. A later run compares it before reusing
      // this trial, so results from two configurations never average together.
      config: configOf(cell, arm),
      // Whether the page publishes anything to map, decided from the markup and
      // not from how this trial went. The report gives the numbers with and
      // without the pages that publish nothing.
      mappable: keys.mappable,
      key: keys.key,
      answer,
      judgement,
      verdict: verdict({ key: keys.key, answer, judgement }),
      neutralKey: keys.neutralKey,
      neutralJudgement: neutrallyJudged?.judgement,
      neutralVerdict: verdict({
        key: keys.neutralKey,
        answer,
        judgement: neutrallyJudged?.judgement,
      }),
      metrics: metricsOf(result),
      ...(judgeRecord ? { judge: judgeRecord } : {}),
      // Only when it was a call of its own. Recorded twice, one judgement would
      // be counted twice in every cost the report adds up.
      ...(neutrallyJudged && neutrallyJudged !== judgeRecord
        ? { neutralJudge: neutrallyJudged }
        : {}),
      at: new Date().toISOString(),
    };
    writeJson(trialPath(cell, arm), record);

    done += 1;
    // One judgement shared by both keys is one call, however many fields it is
    // recorded under.
    const judgeSpend =
      (judgeRecord?.costUsd ?? 0) +
      (neutrallyJudged && neutrallyJudged !== judgeRecord ? neutrallyJudged.costUsd ?? 0 : 0);
    spend += record.metrics.costUsd + judgeSpend;
    report(
      cell,
      arm,
      `${record.verdict}/${record.neutralVerdict}`,
      record.metrics.durationMs,
      record.error
    );
  }
}

function report(cell, arm, outcome, durationMs, error) {
  const line =
    `[${String(done).padStart(String(planned).length)}/${planned}] ` +
    `${cell.vertical.padEnd(10)} ${cell.taskId.padEnd(28)} ${String(arm).padEnd(5)} ` +
    // text-derived verdict / neutral verdict, in that order
    `${outcome.padEnd(27)} ${(durationMs / 1000).toFixed(1)}s $${spend.toFixed(3)}`;
  out(error ? `${line}  ${String(error).slice(0, 80)}` : line);
}

async function pool(items, limit, worker) {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length && !stopping) {
      const item = items[next++];
      try {
        await worker(item);
      } catch (error) {
        // One page that will not parse must not take the run with it.
        process.stderr.write(`bench: ${item.id}: ${error.message}\n`);
      }
    }
  });
  await Promise.all(lanes);
}

await pool(cells, options.concurrency, work);

// The sandbox is scratch, and the CLI leaves state in it.
rmSync(dirs.sandbox, { recursive: true, force: true });

const minutes = ((Date.now() - started) / 60_000).toFixed(1);
// "Would have cost", not "cost": this runs on the CLI's login, so the tokens
// come out of the subscription's allowance and nothing is billed for them.
out(
  `\nbench: ${done}/${planned} trials in ${minutes} min, $${spend.toFixed(2)} at API rates` +
    ` (not billed: this uses the CLI login)` +
    `${exhausted ? ' — stopped on the usage limit' : stopping ? ' — interrupted' : ''}`
);
if (stopping) out('bench: rerun the same command to continue where it stopped');
out(`bench: results in ${options.out} — "npm run bench:report" to read them`);

function countBy(items, key) {
  const counts = new Map();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => a.localeCompare(b));
}
