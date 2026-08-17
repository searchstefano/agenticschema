/**
 * What one answer is worth, and how a run adds up.
 *
 * Pure and tested, and separate from `run.mjs` and `report.mjs` because those
 * two do their work on import: anything worth testing has to live where
 * importing it does nothing.
 *
 * The metric this produces is NOT accuracy. The key against which an answer is
 * scored was written by a model that read only the rendered text of the page,
 * never the markup, so it is systematically friendly to the arm that is handed
 * that same text and systematically harsh on the arm that reads structured data
 * — a fact stated in the markup and absent from the prose is scored as a
 * hallucination against the tools. That bias is deliberate and it points against
 * AgenticSchema. Everything downstream calls this *agreement with a
 * text-derived key*, and so should anything written about it.
 */

/** The exact token the answer protocol asks for when a page does not say. */
export const ABSENT = 'NOT_ON_PAGE';

const blank = (value) => String(value ?? '').trim() === '';

/**
 * Letters only, so `NOT_ON_PAGE`, `not on page`, `**NOT_ON_PAGE**` and
 * `"NOT_ON_PAGE."` are one answer. Models obey the protocol in spirit and
 * decorate it in practice, and counting the decoration as a different answer
 * would file obedience as a hallucination.
 */
const letters = (value) =>
  String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');

const TOKEN = /NOT[_-]ON[_-]PAGE/i;

const lastLine = (value) => {
  const lines = String(value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[lines.length - 1] ?? '';
};

/**
 * Whether this side says the page does not answer, and says nothing else.
 *
 * Two runs taught this rule its shape. Matching the token exactly was too
 * strict: models explain themselves first, and `"No inventory count is present
 * in this data.\n\nNOT_ON_PAGE"` was scored as a claim about warehouse stock.
 * Accepting the token anywhere was then too loose, and the questions that ask
 * for two things showed why — `"NOT_ON_PAGE (rating); $139.00 (price)"` is not
 * an absence, it is half an answer, and reading it as one turned an agent that
 * gave the right price into a hallucination.
 *
 * So: the token is an absence when it is the whole reply, or the last line of
 * it standing alone. A reply that says the token and also names a value is
 * making a partial claim, and partial claims are what the judge is for. All ten
 * of those in the last run were on the two-part questions and none anywhere
 * else.
 */
export const isAbsent = (value) =>
  letters(value) === 'NOTONPAGE' || letters(lastLine(value)) === 'NOTONPAGE';

/** The token is in there somewhere, even if the reply says more besides. */
export const mentionsAbsent = (value) => TOKEN.test(String(value ?? ''));

/**
 * A model is asked to compare only when both sides claim a fact.
 *
 * Every case involving NOT_ON_PAGE is decided below without a model: the
 * judgement that matters most — whether the agent invented something the page
 * never said — is not one to delegate, and each call skipped is a call not
 * paid for.
 */
export function needsJudge(key, answer) {
  if (blank(key) || blank(answer)) return false;
  // An answer that is purely the token is decided below, either way.
  if (isAbsent(answer)) return false;
  // The key says the page does not answer, and the reply says so too while
  // naming something as well. That is the two-part question, and reading it
  // mechanically is what produced a false hallucination.
  if (isAbsent(key)) return mentionsAbsent(answer);
  return true;
}

/**
 * MISMATCH contains MATCH. Checked in this order, a substring search would
 * score every disagreement as agreement, which is the single most expensive
 * bug this file could have.
 */
export function readJudgement(text) {
  const word = String(text ?? '').toUpperCase();
  if (word.includes('MISMATCH')) return 'MISMATCH';
  if (word.includes('MATCH')) return 'MATCH';
  return undefined;
}

/**
 * The seven outcomes, four of them about the answer and three about the harness
 * failing to produce one. Failures are named rather than folded into
 * `mismatch`, because a run where the CLI timed out and a run where the agent
 * was wrong are not the same result and must not average together.
 *
 *   match          both say the same thing, or both say the page does not say
 *   mismatch       both claim a fact, and they are different facts
 *   missed         the key has the fact, the agent said NOT_ON_PAGE
 *   hallucination  the key says the page does not say, the agent answered anyway
 *   error          the trial produced no answer at all
 *   unkeyed        no key exists for this cell, so nothing can be scored
 *   unjudged       both answered, and the judge did not come back with a verdict
 */
export function verdict({ key, answer, judgement }) {
  if (blank(key)) return 'unkeyed';
  if (blank(answer)) return 'error';

  const keyAbsent = isAbsent(key);
  const answerAbsent = isAbsent(answer);

  if (keyAbsent && answerAbsent) return 'match';
  if (answerAbsent) return 'missed';
  // Invention is still decided without a model, but only where the reply makes
  // no claim of absence at all. One that says NOT_ON_PAGE and also names a
  // value has answered half the question, and which half is for the judge.
  if (keyAbsent && !mentionsAbsent(answer)) return 'hallucination';

  const decided = readJudgement(judgement);
  if (decided === 'MATCH') return 'match';
  if (decided === 'MISMATCH') return 'mismatch';
  return 'unjudged';
}

export const VERDICTS = [
  'match',
  'mismatch',
  'missed',
  'hallucination',
  'error',
  'unkeyed',
  'unjudged',
];

/** The outcomes that say something about the agent rather than about the run. */
const SCORABLE = new Set(['match', 'mismatch', 'missed', 'hallucination']);

const emptyBucket = () => ({
  trials: 0,
  ...Object.fromEntries(VERDICTS.map((v) => [v, 0])),
  turns: 0,
  durationMs: 0,
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  cacheWriteTokens: 0,
  denials: 0,
  judgeCostUsd: 0,
});

const add = (bucket, trial) => {
  bucket.trials += 1;
  if (VERDICTS.includes(trial.verdict)) bucket[trial.verdict] += 1;
  const m = trial.metrics ?? {};
  bucket.turns += m.turns ?? 0;
  bucket.durationMs += m.durationMs ?? 0;
  bucket.costUsd += m.costUsd ?? 0;
  bucket.inputTokens += m.inputTokens ?? 0;
  bucket.outputTokens += m.outputTokens ?? 0;
  bucket.cachedTokens += m.cachedTokens ?? 0;
  bucket.cacheWriteTokens += m.cacheWriteTokens ?? 0;
  bucket.denials += m.denials ?? 0;
  // Both judgements, and only where the second was a call of its own: four
  // times in five the two keys are the same string, one judgement covers both,
  // and the runner records it once for exactly that reason.
  bucket.judgeCostUsd += (trial.judge?.costUsd ?? 0) + (trial.neutralJudge?.costUsd ?? 0);
  return bucket;
};

/**
 * The denominator is the scorable trials, not every trial.
 *
 * A timeout is a fact about the harness; letting it count as a wrong answer
 * would let a flaky afternoon look like a worse library. The count of what was
 * dropped travels alongside, so a run that dropped a third of its trials cannot
 * quietly present itself as a result.
 */
export function agreement(bucket) {
  const scored = [...SCORABLE].reduce((sum, v) => sum + bucket[v], 0);
  return { scored, rate: scored === 0 ? undefined : bucket.match / scored };
}

/**
 * Everything the report prints, computed here so it can be tested without a
 * filesystem: totals per arm, and per arm per vertical and per task kind.
 * `fact`, `multi` and `absent` are split out because they fail differently —
 * the absent questions are the only ones that can produce a hallucination, and
 * averaging them into a single percentage hides exactly the behaviour the task
 * set was built to expose.
 */
export function summarize(trials) {
  const byArm = new Map();
  const byArmVertical = new Map();
  const byArmKind = new Map();

  const into = (map, key, trial) => map.set(key, add(map.get(key) ?? emptyBucket(), trial));

  for (const trial of trials) {
    const arm = trial.arm ?? 'unknown';
    into(byArm, arm, trial);
    into(byArmVertical, `${arm} ${trial.vertical ?? 'unknown'}`, trial);
    into(byArmKind, `${arm} ${trial.kind ?? 'unknown'}`, trial);
  }

  const split = (map) =>
    [...map].map(([composite, bucket]) => {
      const [arm, key] = composite.split(' ');
      return { arm, key, bucket };
    });

  return {
    arms: [...byArm].map(([arm, bucket]) => ({ arm, bucket })),
    byVertical: split(byArmVertical),
    byKind: split(byArmKind),
  };
}
