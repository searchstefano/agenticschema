import { describe, expect, it } from 'vitest';
import {
  agreement,
  isAbsent,
  mentionsAbsent,
  needsJudge,
  readJudgement,
  summarize,
  verdict,
} from './verdict.mjs';

describe('isAbsent', () => {
  it('accepts the token however the model decorates it', () => {
    for (const answer of ['NOT_ON_PAGE', 'not_on_page', '  NOT_ON_PAGE.  ', '**NOT_ON_PAGE**']) {
      expect(isAbsent(answer)).toBe(true);
    }
    // The protocol asks for the token; a model that writes the sentence instead
    // means the same thing, and scoring it as a fact would invent a
    // disagreement out of formatting.
    expect(isAbsent('not on page')).toBe(true);
  });

  it('finds the token after a model has explained itself first', () => {
    // Verbatim from the first run of this harness. Matched exactly, this was
    // scored as a claim about the warehouse and sent to the judge, which then
    // called it a mismatch: an obedient answer recorded as a wrong one.
    expect(isAbsent('No inventory count is present in this data.\n\nNOT_ON_PAGE')).toBe(true);
  });

  it('does not read half an answer as an absence', () => {
    // Verbatim from the second run, on a question that asks for two things.
    // Read as an absence, an agent that gave the right price was recorded as
    // having invented it. Half an answer goes to the judge instead.
    expect(isAbsent('NOT_ON_PAGE (rating); $139.00 (price)')).toBe(false);
    expect(isAbsent('NOT_ON_PAGE (no customer ratings) — costs $89.95 USD.')).toBe(false);
    // ...while still being recognisable as mentioning the token.
    expect(mentionsAbsent('NOT_ON_PAGE (rating); $139.00 (price)')).toBe(true);
  });

  it('does not mistake a real answer for the token', () => {
    expect(isAbsent('EUR 129.90')).toBe(false);
    // The bare words count only as the whole answer, or this would be read as a
    // refusal to answer.
    expect(isAbsent('The price is not on page 5 of the catalogue')).toBe(false);
    expect(isAbsent('')).toBe(false);
    expect(mentionsAbsent('EUR 129.90')).toBe(false);
  });
});

describe('needsJudge', () => {
  it('is asked only when both sides claim a fact', () => {
    expect(needsJudge('EUR 129.90', '129,90 €')).toBe(true);
  });

  it('is never asked when either side says the page does not say', () => {
    expect(needsJudge('NOT_ON_PAGE', 'NOT_ON_PAGE')).toBe(false);
    expect(needsJudge('NOT_ON_PAGE', '42 units')).toBe(false);
    expect(needsJudge('EUR 129.90', 'NOT_ON_PAGE')).toBe(false);
  });

  it('is never asked when either side is missing', () => {
    expect(needsJudge('', '129,90 €')).toBe(false);
    expect(needsJudge('EUR 129.90', '   ')).toBe(false);
  });
});

describe('readJudgement', () => {
  it('reads a one-word reply', () => {
    expect(readJudgement('MATCH')).toBe('MATCH');
    expect(readJudgement('MISMATCH')).toBe('MISMATCH');
  });

  it('reads MISMATCH as MISMATCH, not as a MATCH that happens to contain it', () => {
    // MISMATCH contains MATCH. Checked the other way round, every disagreement
    // in the run would be recorded as agreement.
    expect(readJudgement('mismatch')).toBe('MISMATCH');
    expect(readJudgement('The answer is a MISMATCH.')).toBe('MISMATCH');
  });

  it('returns nothing when the reply decided nothing', () => {
    expect(readJudgement('I am not sure')).toBeUndefined();
    expect(readJudgement('')).toBeUndefined();
    expect(readJudgement(undefined)).toBeUndefined();
  });
});

describe('verdict', () => {
  it('decides every plain NOT_ON_PAGE case without a judge', () => {
    expect(verdict({ key: 'NOT_ON_PAGE', answer: 'NOT_ON_PAGE' })).toBe('match');
    expect(verdict({ key: 'NOT_ON_PAGE', answer: '412 units in stock' })).toBe('hallucination');
    expect(verdict({ key: 'EUR 129.90', answer: 'NOT_ON_PAGE' })).toBe('missed');
  });

  it('sends a half-absent answer to the judge instead of calling it invention', () => {
    // Both sides say the rating is missing and both give the same price. Decided
    // mechanically, this was a hallucination; it is a match.
    const half = {
      key: 'NOT_ON_PAGE (rating); $139.00 (price)',
      answer: 'NOT_ON_PAGE — no rating exists. Price: $139.00',
    };
    expect(needsJudge(half.key, half.answer)).toBe(true);
    expect(verdict({ ...half, judgement: 'MATCH' })).toBe('match');

    // The same protection where only the key is plain: an answer naming the
    // token is not inventing, whatever else it says.
    expect(needsJudge('NOT_ON_PAGE', 'NOT_ON_PAGE for the rating; $139.00')).toBe(true);
  });

  it('uses the judge only when both sides claim a fact', () => {
    expect(verdict({ key: 'EUR 129.90', answer: '129,90 €', judgement: 'MATCH' })).toBe('match');
    expect(verdict({ key: 'EUR 129.90', answer: 'EUR 49.00', judgement: 'MISMATCH' })).toBe(
      'mismatch'
    );
  });

  it('names the harness failures instead of scoring them as wrong answers', () => {
    // A CLI that timed out and an agent that answered wrongly are not the same
    // result, and a benchmark that averaged them together would report the
    // weather as a property of the library.
    expect(verdict({ key: 'EUR 129.90', answer: '' })).toBe('error');
    expect(verdict({ key: '', answer: 'EUR 129.90' })).toBe('unkeyed');
    expect(verdict({ key: 'EUR 129.90', answer: '129,90 €', judgement: 'huh?' })).toBe('unjudged');
    expect(verdict({ key: 'EUR 129.90', answer: '129,90 €' })).toBe('unjudged');
  });
});

const trial = (over) => ({
  arm: 'tools',
  vertical: 'ecommerce',
  kind: 'fact',
  verdict: 'match',
  metrics: { turns: 1, durationMs: 1000, costUsd: 0.01, inputTokens: 10, outputTokens: 2 },
  ...over,
});

describe('agreement', () => {
  it('divides by the trials that could be scored, not by every trial', () => {
    const [{ bucket }] = summarize([
      trial({}),
      trial({ verdict: 'mismatch' }),
      trial({ verdict: 'error' }),
      trial({ verdict: 'unkeyed' }),
    ]).arms;

    // Two scorable trials, one of them a match. The two failures are counted
    // and reported, and stay out of the denominator.
    expect(agreement(bucket)).toEqual({ scored: 2, rate: 0.5 });
    expect(bucket.error).toBe(1);
    expect(bucket.unkeyed).toBe(1);
  });

  it('reports no rate at all rather than a zero when nothing could be scored', () => {
    const [{ bucket }] = summarize([trial({ verdict: 'error' })]).arms;
    expect(agreement(bucket).rate).toBeUndefined();
  });
});

describe('summarize', () => {
  it('keeps the arms apart', () => {
    const summary = summarize([
      trial({ arm: 'text', verdict: 'match' }),
      trial({ arm: 'tools', verdict: 'mismatch' }),
      trial({ arm: 'tools', verdict: 'match' }),
    ]);

    expect(summary.arms.map((a) => a.arm).sort()).toEqual(['text', 'tools']);
    const tools = summary.arms.find((a) => a.arm === 'tools').bucket;
    expect(tools.trials).toBe(2);
    expect(agreement(tools)).toEqual({ scored: 2, rate: 0.5 });
  });

  it('splits by vertical and by kind of question', () => {
    const summary = summarize([
      trial({ vertical: 'recipe', kind: 'absent', verdict: 'hallucination' }),
      trial({ vertical: 'news', kind: 'fact', verdict: 'match' }),
    ]);

    const recipe = summary.byVertical.find((r) => r.key === 'recipe');
    expect(recipe.bucket.hallucination).toBe(1);
    const absent = summary.byKind.find((r) => r.key === 'absent');
    expect(absent.bucket.hallucination).toBe(1);
    expect(summary.byKind.find((r) => r.key === 'fact').bucket.match).toBe(1);
  });

  it('adds up what each trial cost, judge included but kept separate', () => {
    const summary = summarize([
      trial({ metrics: { turns: 3, costUsd: 0.02, durationMs: 500 }, judge: { costUsd: 0.001 } }),
      trial({ metrics: { turns: 2, costUsd: 0.03, durationMs: 700 } }),
    ]);

    const { bucket } = summary.arms[0];
    expect(bucket.turns).toBe(5);
    expect(bucket.costUsd).toBeCloseTo(0.05);
    expect(bucket.durationMs).toBe(1200);
    // The judge is harness overhead. Folding it into the arm's cost would
    // charge the library for the way it is being measured.
    expect(bucket.judgeCostUsd).toBeCloseTo(0.001);
  });

  it('survives trials with nothing in them', () => {
    const summary = summarize([{ verdict: 'error' }]);
    expect(summary.arms[0].arm).toBe('unknown');
    expect(summary.arms[0].bucket.costUsd).toBe(0);
  });
});
