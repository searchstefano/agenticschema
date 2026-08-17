/**
 * Running one trial through the Claude Code CLI.
 *
 * The CLI is the engine here rather than the API, because it uses the login the
 * developer already has: no key to hand around, no second billing relationship.
 * `--output-format json` hands back the answer together with the token counts,
 * the turn count, the wall time and the cost, which is most of the measurement
 * for free.
 *
 * On a subscription login — which is the case this is built for — two things
 * follow, and both matter more than they look:
 *
 * `total_cost_usd` is not a bill. It is what those tokens would have cost at
 * API prices, and nothing is charged for them. It stays in the results because
 * it is the best single number for how much work a trial was, and everything
 * that prints it says what it is. Reading it as money spent would be wrong in
 * one direction; ignoring it would throw away the only comparable size measure.
 *
 * What is finite is the rate limit, and a run of a thousand trials will meet
 * it. That is not an error to record a thousand times, it is a signal to stop
 * and come back, so it is detected here and acted on by the driver.
 *
 * Prompt building and result reading are pure and tested. Only `runTrial`
 * touches a process.
 */
import { spawn } from 'node:child_process';

/** Reached only if a trial hangs; the CLI usually answers in seconds. */
export const DEFAULT_TIMEOUT_MS = 180_000;

/**
 * The instruction shared by both arms, so the only difference between them is
 * where the page comes from. Anything else here would show up in the results as
 * if it were an effect of the tools.
 */
const RULES = (protocol) =>
  [
    'You are answering a question about one web page.',
    protocol,
    'Do not guess. Do not use anything you know about this site from elsewhere;',
    'the only acceptable source is the one given to you below.',
  ].join(' ');

export function textPrompt({ url, text, question, protocol }) {
  return [
    RULES(protocol),
    '',
    `PAGE: ${url}`,
    '--- page text begins ---',
    text,
    '--- page text ends ---',
    '',
    `QUESTION: ${question}`,
  ].join('\n');
}

export function toolsPrompt({ url, question, protocol }) {
  return [
    RULES(protocol),
    '',
    `The page is ${url}. You cannot see it. Tools are attached that read its`,
    'structured data: call whichever ones you need.',
    '',
    `QUESTION: ${question}`,
  ].join('\n');
}

/**
 * The labeller never sees the markup, only the text a reader would see.
 *
 * This is the whole basis on which the results can be believed, and it points
 * against the library: a key derived from the text is a key the text arm can
 * hardly miss, while the tools arm can also fail because the fact is absent from
 * the markup. If AgenticSchema still comes out ahead under it, the margin is
 * real. What it is NOT is a neutral referee, and calling the resulting number
 * "accuracy" would be a lie: it is agreement with a text-derived key.
 */
export function labelPrompt({ url, text, question, protocol }) {
  return [
    'You are writing the answer key for a benchmark question about a web page.',
    'Read the page text carefully and completely before answering.',
    protocol,
    'If the text genuinely does not contain the answer, NOT_ON_PAGE is the correct key.',
    '',
    `PAGE: ${url}`,
    '--- page text begins ---',
    text,
    '--- page text ends ---',
    '',
    `QUESTION: ${question}`,
  ].join('\n');
}

/**
 * The second key, and the only one that can answer "which is better".
 *
 * A key written from the text alone puts a ceiling on the tools arm: the best it
 * can do is repeat what the prose already said, so it can draw level and never
 * come out ahead. Facts the markup carries and the prose does not —
 * `recipeYield`, a currency code, a publication date — are scored against it as
 * inventions. That referee measures fidelity to the text, which is a real
 * question, but it is not the question of which input serves an agent better.
 *
 * This one reads both: the rendered text AND what the page publishes as data. A
 * fact in either is a fact, so an arm that misses a prose-only fact and an arm
 * that misses a markup-only fact are penalised alike. Both keys are kept and
 * both are reported, because the pair says more than either: the text key says
 * how much of the prose survives the mapping, and this one says which input
 * answers more of what the page knows.
 *
 * The structured half is the page's own markup, not this library's tool output.
 * Keying on our own output would be asking the library to mark its own paper: a
 * fact it fails to expose would drop out of the key and stop counting against
 * it — which is exactly how the `hasVariant` defect would have gone unnoticed.
 */
export function neutralLabelPrompt({ url, text, structured, question, protocol }) {
  return [
    'You are writing the answer key for a benchmark question about a web page.',
    'You are given two views of the same page: the text a reader sees, and the',
    'structured data the page publishes for machines. They are equally valid',
    'sources. A fact that appears in only one of them is still a fact about this',
    'page. Where the two disagree, prefer the text a reader sees.',
    protocol,
    'If neither view contains the answer, NOT_ON_PAGE is the correct key.',
    '',
    `PAGE: ${url}`,
    '--- page text begins ---',
    text,
    '--- page text ends ---',
    '',
    '--- structured data begins ---',
    structured || '(the page publishes none)',
    '--- structured data ends ---',
    '',
    `QUESTION: ${question}`,
  ].join('\n');
}

/**
 * Comparing strings would report "129,90 €" and "EUR 129.90" as a disagreement,
 * so a model does the comparing. It is only ever asked when both sides have an
 * answer: every case involving NOT_ON_PAGE is decided mechanically, which keeps
 * the judgement of hallucinations out of a model's hands and saves the call.
 */
export function judgePrompt({ question, key, answer }) {
  return [
    'You are marking one benchmark answer against its key.',
    'They match if they carry the same information, whatever the wording, format,',
    'currency notation, date format or level of detail. A more specific answer that',
    'contains the key still matches. A different fact does not.',
    'Reply with exactly one word: MATCH or MISMATCH.',
    '',
    `QUESTION: ${question}`,
    `KEY: ${key}`,
    `ANSWER: ${answer}`,
  ].join('\n');
}

/** The fields of the CLI's json output this harness relies on. */
export function readResult(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { ok: false, error: `unparsable CLI output: ${stdout.slice(0, 200)}` };
  }

  const usage = parsed.usage ?? {};
  const common = {
    turns: parsed.num_turns ?? 0,
    durationMs: parsed.duration_ms ?? 0,
    costUsd: parsed.total_cost_usd ?? 0,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cachedTokens: usage.cache_read_input_tokens ?? 0,
    // Where the money actually goes, and the field it is easiest to leave out:
    // `input_tokens` on these runs is 2 or 6, because everything else is either
    // read from the cache or written to it. A cost table without this column
    // reports pennies it cannot account for.
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    denials: (parsed.permission_denials ?? []).length,
  };

  // `is_error` is how the CLI reports "not logged in" and friends, and it comes
  // back with subtype "success" and exit code 0. Reading only the text would
  // file "Please run /login" as the agent's answer to the question.
  if (parsed.is_error) {
    const error = String(parsed.result ?? 'CLI reported an error');
    return {
      ok: false,
      error,
      exhausted: isUsageLimit(error) || parsed.api_error_status === 429,
      ...common,
    };
  }
  return { ok: true, answer: String(parsed.result ?? '').trim(), ...common };
}

/**
 * Whether the CLI stopped because the subscription's allowance is used up
 * rather than because anything went wrong.
 *
 * The distinction decides what the driver does next, and getting it wrong is
 * expensive in a way that is easy to miss: treated as an ordinary failure, one
 * exhausted allowance turns into every remaining trial failing in quick
 * succession, and a resumable run becomes several hundred recorded
 * non-answers. Treated as what it is, the run stops with everything it had
 * finished intact and continues when the window rolls over.
 */
export function isUsageLimit(message) {
  return /usage limit|rate.?limit|limit reached|too many requests/i.test(String(message ?? ''));
}

/**
 * Every tool the CLI ships with, denied to both arms.
 *
 * Without this the benchmark measures the wrong thing twice over: the text arm
 * can `WebFetch` the live url and answer from today's page instead of from the
 * text it was given, and the tools arm can `Read` the corpus fixture straight
 * off the disk and never call a generated tool at all. Either one turns a
 * result into an artefact of what the agent was allowed to reach for.
 *
 * Denied for both arms rather than only where it would help, so that the two
 * differ in exactly one thing: where the page comes from.
 */
export const BUILT_IN_TOOLS = [
  'Bash',
  'BashOutput',
  'Edit',
  'Glob',
  'Grep',
  'KillShell',
  'NotebookEdit',
  'Read',
  'SlashCommand',
  'Task',
  'TodoWrite',
  // Not a way out of the arm like the others, but a turn spent on the client's
  // own bookkeeping. This CLI hands the agent the names of MCP tools and defers
  // their schemas, so the first thing the tools arm did on every trial was call
  // `ToolSearch` to fetch them — one turn in three, on every page, however few
  // tools it had. Denied, the agent calls the tool directly and answers in two
  // turns instead of three.
  //
  // This is a measurement decision and it deserves its scepticism: without the
  // fetch the agent picks a tool by name, so the descriptions AgenticSchema
  // writes are no longer in front of it. That could buy turns at the price of
  // reaching for the wrong tool. It was measured both ways before being turned
  // on — see docs/bench.md — and the answer, rather than the assumption, is why
  // it is here.
  'ToolSearch',
  'WebFetch',
  'WebSearch',
  'Write',
].join(',');

/**
 * The machine the benchmark runs on, kept out of the benchmark.
 *
 * The CLI assembles its system prompt from whatever the operator has installed:
 * settings, hooks, plugins, the list of available skills. On the machine this
 * was written on that came to 25,593 tokens written into the prompt cache on
 * every single call, before a word about the page — a per-call floor of $0.13
 * against $0.013 with these three flags, which over a full run is the
 * difference between $570 and $57.
 *
 * The cost is the smaller half of it. Without these, a result depends on which
 * plugins the person running it happens to have, and two machines cannot be
 * compared. A benchmark that quietly measures somebody's local configuration is
 * not measuring the library.
 *
 *   --setting-sources ''        no user, project or local settings, and so no
 *                               hooks injecting text into the trial
 *   --disable-slash-commands    no skills, whose listing is most of the weight
 *   --exclude-dynamic-...       cwd, git status and environment out of the
 *                               system prompt, so the cache is reused between
 *                               trials instead of rewritten for each
 *
 * `--safe-mode` looks like the flag for this and cannot be used: it turns off
 * MCP servers as well, including the one passed on the command line, and the
 * tools arm answers "no tool available in this session" for six turns and $0.16.
 */
const ISOLATION = ['--setting-sources', '', '--disable-slash-commands', '--exclude-dynamic-system-prompt-sections'];

/**
 * `--strict-mcp-config` is not optional: without it the CLI also loads whatever
 * MCP servers the developer has configured, and the tools arm would be measured
 * with tools that have nothing to do with the page.
 */
export function buildArgs({ prompt, model, mcpConfig, allowedTools, disallowedTools, maxTurns }) {
  const args = ['-p', prompt, '--output-format', 'json', ...ISOLATION];
  if (model) args.push('--model', model);
  if (maxTurns) args.push('--max-turns', String(maxTurns));
  if (mcpConfig) args.push('--mcp-config', mcpConfig, '--strict-mcp-config');
  args.push('--allowed-tools', allowedTools ?? '');
  if (disallowedTools) args.push('--disallowed-tools', disallowedTools);
  return args;
}

/**
 * Every CLI process this module currently has open.
 *
 * A run is hundreds of these and it will be interrupted at some point. Without
 * a registry, Ctrl-C leaves the driver dead and its children alive: each one
 * holds its own page server open, keeps working, and keeps costing money with
 * nobody left to read the answer.
 */
const live = new Set();

export function killLiveTrials() {
  for (const child of live) {
    try {
      child.kill('SIGKILL');
    } catch {
      // Already gone. Nothing to do, and nothing worth reporting.
    }
  }
  live.clear();
}

/** One CLI invocation, killed if it outstays its welcome. */
export function runTrial(options) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, cwd } = options;
  const args = buildArgs(options);

  return new Promise((resolve) => {
    const child = spawn('claude', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    live.add(child);
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      live.delete(child);
      resolve(value);
    };

    // A hung CLI would otherwise hold a slot for the rest of the run, and a run
    // is hundreds of these. SIGKILL follows SIGTERM because the child may itself
    // be waiting on something.
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref?.();
      finish({ ok: false, error: `timed out after ${timeoutMs} ms` });
    }, timeoutMs);

    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => finish({ ok: false, error: `cannot run claude: ${err.message}` }));
    child.on('close', (code) => {
      if (code !== 0 && !stdout.trim()) {
        // A refused request need not come back as json: it can also arrive as a
        // non-zero exit with the reason on stderr, and the driver has to
        // recognise it there too or it stops only half the time.
        finish({
          ok: false,
          error: `claude exited ${code}: ${stderr.slice(0, 200)}`,
          exhausted: isUsageLimit(stderr),
        });
        return;
      }
      finish(readResult(stdout));
    });
  });
}
