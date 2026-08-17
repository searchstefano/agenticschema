/**
 * What a benchmark run came to.
 *
 *   node scripts/bench/report.mjs [--out DIR]
 *
 * Two outputs, and the second is the useful one.
 *
 * On stdout and in `summary.md`: counts and rates, per arm, per vertical, per
 * kind of question. Aggregate only, which is what may be copied into the
 * repository.
 *
 * In `disagreements.md`: every trial that did not match, in full — the
 * question, the key, what the agent said. A rate tells you that the tools arm
 * lost four points; the disagreements tell you that three of them were the same
 * date format and one was a real hole in the mapping. Only the second is worth
 * acting on, and only the second file can tell them apart. It holds text taken
 * from other people's pages, so it stays in the output directory, which is
 * gitignored.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agreement, summarize, verdict } from './verdict.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};

const outDir = resolve(ROOT, flag('--out') ?? 'bench-results');
const trialsDir = join(outDir, 'trials');

if (!existsSync(trialsDir)) {
  process.stderr.write(`bench: no trials in ${trialsDir}. Run "npm run bench:run" first.\n`);
  process.exit(1);
}

/**
 * Scored here rather than trusted as recorded.
 *
 * The trial file keeps the verdict the run gave it, but the verdict is a pure
 * function of the key, the answer and the judgement, all three of which are in
 * the file. Recomputing means a correction to the scoring applies to trials
 * that have already been paid for — and the first run of this harness needed
 * exactly that, having filed `"...\n\nNOT_ON_PAGE"` as a claim about warehouse
 * stock. Rerunning 1,750 trials to fix a regex would be an expensive way to
 * discourage fixing it.
 */
const trials = readdirSync(trialsDir)
  .filter((name) => name.endsWith('.json'))
  .map((name) => {
    const trial = JSON.parse(readFileSync(join(trialsDir, name), 'utf8'));
    return {
      ...trial,
      verdict: verdict(trial),
      neutralVerdict: verdict({
        key: trial.neutralKey,
        answer: trial.answer,
        judgement: trial.neutralJudgement,
      }),
    };
  });

/**
 * The same trials scored against the neutral key — the text plus what the page
 * publishes as data, so a fact in either counts.
 *
 * A second view of one set of answers rather than a second run: the arms
 * answered once and only the referee changes, which is what makes the two
 * columns comparable at all.
 */
const neutrally = (rows) => rows.map((row) => ({ ...row, verdict: row.neutralVerdict }));

if (trials.length === 0) {
  process.stderr.write(`bench: ${trialsDir} is empty\n`);
  process.exit(1);
}

const summary = summarize(trials);
const pages = new Set(trials.map((t) => t.file)).size;
const models = [...new Set(trials.map((t) => t.model ?? 'unknown'))];

// ---------------------------------------------------------------------------

const lines = [];
const out = (line = '') => lines.push(line);
const rule = '─'.repeat(78);

const pct = (rate) => (rate === undefined ? '—' : `${Math.round(rate * 100)}%`);
const per = (total, n) => (n === 0 ? 0 : total / n);
// en-US grouping, unlike the corpus report's it-IT: these tables get copied into
// an English document, and `12.025` next to `5314` reads as a fraction.
const num = (n, digits = 0) =>
  n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** text first, always: it is the baseline and the difference is read against it. */
const armOrder = (rows) =>
  [...rows].sort((a, b) => (a.arm === b.arm ? 0 : a.arm === 'text' ? -1 : 1));

out(rule);
out(`BENCH  ${trials.length} trials over ${pages} pages, model ${models.join(', ')}`);

/**
 * One run, or several wearing one hat?
 *
 * Every trial records a fingerprint of what produced it. Where more than one
 * turns up, the tables below average measurements that are not comparable — a
 * different model, turn cap, deny list, question or version of the library —
 * and the only honest thing is to say so before the numbers rather than after.
 */
// Grouped by the run's shared settings, not by the per-trial hash: that one is
// unique to each trial by design, and grouping on it prints a list of every
// trial rather than a warning about two measurements.
const configs = new Map();
for (const trial of trials) {
  const key = trial.config?.run ?? 'unrecorded';
  configs.set(key, (configs.get(key) ?? 0) + 1);
}

// `unrecorded` counts as its own warning, not as a configuration: those trials
// were written before the fingerprint existed, so nothing about them can be
// checked and they may have come from anywhere.
if (configs.size > 1 || configs.has('unrecorded')) {
  out(rule);
  out('CONFIGURATIONS NOT VERIFIED — these numbers may average measurements that');
  out('are not comparable. Rerun to refresh, or use a separate --out directory.');
  for (const [hash, count] of [...configs].sort((a, b) => b[1] - a[1])) {
    const sample = trials.find((t) => (t.config?.run ?? 'unrecorded') === hash);
    const referee = sample.config?.refereeModel;
    out(
      `  ${hash.padEnd(14)}${String(count).padStart(5)} trials` +
        `  model ${sample.config?.model ?? sample.model ?? '?'}` +
        (referee && referee !== sample.config?.model ? `  referee ${referee}` : '') +
        `  library ${sample.config?.library ?? '?'}`
    );
  }
}

out(rule);

const breakdown = (rows) => {
  out('                agreement   scored   match  mism  miss  halluc   err  unjud');
  for (const { arm, bucket } of armOrder(summarize(rows).arms)) {
    const { scored, rate } = agreement(bucket);
    out(
      `  ${arm.padEnd(12)}${pct(rate).padStart(9)}${String(scored).padStart(9)}` +
        `${String(bucket.match).padStart(8)}${String(bucket.mismatch).padStart(6)}` +
        `${String(bucket.missed).padStart(6)}${String(bucket.hallucination).padStart(8)}` +
        `${String(bucket.error + bucket.unkeyed).padStart(6)}${String(bucket.unjudged).padStart(7)}`
    );
  }
};

// The two referees, on the same answers. The first cannot let the tools arm win:
// its key is the text arm's own input, so a fact carried only in the markup is
// scored as an invention. The second reads the text and the published data
// alike, which is the only way round that ceiling.
out('SCORED AGAINST THE TEXT-DERIVED KEY — how much of the prose survives');
breakdown(trials);
out('');
out('SCORED AGAINST THE NEUTRAL KEY — text and published data both count');
breakdown(neutrally(trials));

/**
 * The same two, over the pages that publish something to map.
 *
 * A page carrying nothing but a breadcrumb trail gives the tools arm nothing to
 * answer with, and a question put to it measures the page rather than the
 * library. Both denominators are printed because each hides something the other
 * shows: over every page is how often the approach applies at all, and over
 * these is how well it does where it applies.
 */
const mappable = trials.filter((trial) => trial.mappable !== false);
if (mappable.length > 0 && mappable.length < trials.length) {
  const dropped = new Set(
    trials.filter((t) => t.mappable === false).map((t) => t.file)
  ).size;
  out(rule);
  out(
    `ONLY THE ${new Set(mappable.map((t) => t.file)).size} PAGES THAT PUBLISH SOMETHING TO MAP` +
      ` (${dropped} pages left out, neutral key)`
  );
  breakdown(neutrally(mappable));
}

out(rule);
// `input` is 2 or 6 tokens on these runs and says nothing: the prompt goes into
// the cache, not into the input. What the model had to read is the cache read,
// summed over the turns of the trial, which is why the tools arm — three turns
// where text takes one — reads several times the context for the same question.
out('COST PER TRIAL, mean       turns   cache rd   cache wr   output      usd      s');
for (const { arm, bucket } of armOrder(summary.arms)) {
  const n = bucket.trials;
  out(
    `  ${arm.padEnd(20)}${num(per(bucket.turns, n), 1).padStart(10)}` +
      `${num(per(bucket.cachedTokens, n)).padStart(11)}` +
      `${num(per(bucket.cacheWriteTokens, n)).padStart(11)}` +
      `${num(per(bucket.outputTokens, n)).padStart(9)}` +
      `${per(bucket.costUsd, n).toFixed(4).padStart(9)}` +
      `${(per(bucket.durationMs, n) / 1000).toFixed(1).padStart(7)}`
  );
}

const judged = summary.arms.reduce((sum, a) => sum + a.bucket.judgeCostUsd, 0);
const spent = summary.arms.reduce((sum, a) => sum + a.bucket.costUsd, 0);
out(`  ${'trials, total'.padEnd(20)}${`$${spent.toFixed(2)}`.padStart(56)}`);
out(`  ${'judging, overhead'.padEnd(20)}${`$${judged.toFixed(2)}`.padStart(56)}`);
// The harness runs on the CLI's own login, so these dollars were never charged
// to anyone. They are the API list price of the same tokens, kept because it is
// the one figure that compares a turn of tools against a page of text.
out('  dollars are what these tokens would cost at API rates, not a bill:');
out('  the run goes through the Claude Code login and its subscription allowance.');

const table = (title, rows) => {
  out(rule);
  out(`${title.padEnd(20)}   trials   text   tools   difference`);
  for (const key of [...new Set(rows.map((r) => r.key))].sort()) {
    const of = (arm) => rows.find((r) => r.key === key && r.arm === arm)?.bucket;
    const text = of('text');
    const tools = of('tools');
    const a = text ? agreement(text).rate : undefined;
    const b = tools ? agreement(tools).rate : undefined;
    const delta =
      a === undefined || b === undefined
        ? '—'
        : `${b - a >= 0 ? '+' : ''}${Math.round((b - a) * 100)} pt`;
    out(
      `  ${key.padEnd(20)}${String((text?.trials ?? 0) + (tools?.trials ?? 0)).padStart(7)}` +
        `${pct(a).padStart(7)}${pct(b).padStart(8)}${delta.padStart(13)}`
    );
  }
};

// Split by the neutral key from here down: it is the referee that can answer
// which input serves an agent better, and a table of the other one would only
// re-describe how closely the tools reproduce the prose.
const fair = summarize(neutrally(trials));
table('PER VERTICAL, neutral key', fair.byVertical);
table('PER KIND, neutral key', fair.byKind);

// The absent questions are the only ones that can produce a hallucination, and
// an agent that invents an answer is a worse outcome than one that fails to
// find it. Called out rather than left to dissolve into an average.
const absent = fair.byKind.filter((r) => r.key === 'absent');
if (absent.length > 0) {
  out(rule);
  out('ON THE QUESTIONS THE PAGE DOES NOT ANSWER');
  for (const { arm, bucket } of armOrder(absent)) {
    // The denominator is the trials where the key really did say NOT_ON_PAGE.
    // Those are the only ones that can show an invention: where the labeller
    // itself named a fact, an agent answering NOT_ON_PAGE is scored `missed`
    // and belongs to the count below instead.
    const asked = bucket.match + bucket.hallucination;
    out(
      `  ${arm.padEnd(12)}invented an answer ${bucket.hallucination}/${asked} times` +
        ` (${pct(per(bucket.hallucination, asked))})`
    );
  }
  // The referee's own failures, on exactly the questions built to catch
  // inventions, kept in view rather than folded into the arms' percentages: the
  // labeller reads only the prose, and asked how many units are left in the
  // warehouse it has been known to answer "1".
  const misKeyed = absent.reduce((sum, r) => sum + r.bucket.missed + r.bucket.mismatch, 0);
  if (misKeyed > 0) {
    out(`  on ${misKeyed} of these trials the key named a fact anyway: the text-only`);
    out('  labeller found something. They are in the disagreements, to read by hand.');
  }
}

const denials = summary.arms.reduce((sum, a) => sum + a.bucket.denials, 0);
if (denials > 0) {
  out(rule);
  // A denial is an arm reaching for a tool it was not given: the text arm going
  // for WebFetch, or the tools arm going for Read. It changes no answer, since
  // the call was refused, but it says the prompt is being read as an invitation
  // to leave the arm.
  out(`${denials} permission denials: an arm tried to reach outside itself.`);
}

out(rule);
out('AGREEMENT WITH A KEY, not accuracy. Two keys, and neither is neutral about');
out('everything: the text-derived one cannot let the tools arm win, since its key');
out('is the text arm\'s own input; the neutral one reads the published data too,');
out('and that half comes through this library\'s parser for microdata and RDFa.');
out('docs/bench.md sets out what each can and cannot say.');
out(rule);

process.stdout.write(`${lines.join('\n')}\n`);
writeFileSync(join(outDir, 'summary.md'), `\`\`\`\n${lines.join('\n')}\n\`\`\`\n`);

// ---------------------------------------------------------------------------
// the disagreements, which is where anything worth changing will be

// Listed by the neutral verdict: that is the referee worth acting on, and a
// trial the text-derived key called wrong while the neutral one called right is
// not a defect, it is the bias doing its job.
const failed = trials
  .filter((trial) => trial.neutralVerdict !== 'match')
  .sort(
    (a, b) =>
      (a.vertical ?? '').localeCompare(b.vertical ?? '') ||
      (a.taskId ?? '').localeCompare(b.taskId ?? '')
  );

const doc = [
  '# Disagreements',
  '',
  `${failed.length} of ${trials.length} trials did not match the neutral key. Every one of`,
  'them is here, because the interesting cases are individual: a date written the',
  'other way round, a price the markup carries and the prose does not, a question',
  'the page answers in a picture. None of that survives being averaged.',
  '',
  'Both verdicts are shown. Where they differ, the difference is the whole point:',
  'the text-derived key marks the tools arm down for knowing something the prose',
  'never said.',
  '',
  'Holds text from the corpus pages. Not for committing.',
  '',
];

let vertical;
for (const trial of failed) {
  if (trial.vertical !== vertical) {
    vertical = trial.vertical;
    doc.push(`## ${vertical}`, '');
  }
  const sameKey = (trial.neutralKey ?? '') === (trial.key ?? '');
  doc.push(
    `### ${trial.neutralVerdict} · ${trial.arm} · ${trial.taskId}` +
      (trial.mappable === false ? ' · page publishes nothing to map' : ''),
    '',
    `- page: ${trial.url}`,
    `- question: ${trial.question}`,
    `- neutral key: ${JSON.stringify(trial.neutralKey ?? '')}`,
    // Printed only when the two referees actually saw different answers, which
    // is precisely where the markup says something the prose does not.
    ...(sameKey
      ? []
      : [
          `- text-only key: ${JSON.stringify(trial.key ?? '')} (verdict there: ${trial.verdict})`,
        ]),
    `- answer: ${JSON.stringify(trial.answer ?? '')}`,
    ...(trial.neutralJudgement ? [`- judge: ${trial.neutralJudgement}`] : []),
    ...(trial.error ? [`- error: ${trial.error}`] : []),
    ''
  );
}

writeFileSync(join(outDir, 'disagreements.md'), `${doc.join('\n')}\n`);
process.stdout.write(
  `\n${failed.length} disagreements written to ${join(outDir, 'disagreements.md')}\n`
);
