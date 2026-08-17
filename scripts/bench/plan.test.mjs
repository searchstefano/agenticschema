import { describe, expect, it } from 'vitest';
import { callsFor, fingerprint, planCells, planCost, slugForPage, trialId } from './plan.mjs';

const page = (vertical, n) => ({
  vertical,
  file: `${vertical}/example-com-${n}.html`,
  url: `https://example.test/${vertical}/${n}`,
  bytes: 1000,
});

const TASKS = [
  { id: 'ecommerce-name', vertical: 'ecommerce', kind: 'fact', question: 'Name?' },
  { id: 'ecommerce-stock', vertical: 'ecommerce', kind: 'absent', question: 'Units left?' },
  { id: 'news-headline', vertical: 'news', kind: 'fact', question: 'Headline?' },
];

describe('slugForPage', () => {
  it('turns a corpus path into a filename that keeps the vertical readable', () => {
    expect(slugForPage('ecommerce/ikea-com-p-billy-0263850.html')).toBe(
      'ecommerce-ikea-com-p-billy-0263850'
    );
  });

  it('gives two long paths that share a prefix two different slugs', () => {
    // A truncated slug alone would have these overwrite each other's results,
    // and nothing would say so: the run would simply report fewer pages than
    // it measured.
    const long = (tail) => `ecommerce/${'a'.repeat(120)}-${tail}.html`;
    const first = slugForPage(long('one'));
    const second = slugForPage(long('two'));
    expect(first).not.toBe(second);
    expect(first.length).toBeLessThanOrEqual(100);
  });

  it('is stable, so a resumed run recognises what it already finished', () => {
    expect(slugForPage('news/a-b.html')).toBe(slugForPage('news/a-b.html'));
  });
});

describe('planCells', () => {
  it('crosses each page with the questions of its own vertical only', () => {
    const cells = planCells({ pages: [page('ecommerce', 1), page('news', 1)], tasks: TASKS });
    expect(cells).toHaveLength(3);
    expect(cells.filter((c) => c.vertical === 'ecommerce').map((c) => c.taskId)).toEqual([
      'ecommerce-name',
      'ecommerce-stock',
    ]);
    expect(cells[0].question).toBeTruthy();
    expect(cells[0].kind).toBe('fact');
  });

  it('drops a vertical that has no questions, however many pages it has', () => {
    // `book` is two pages. It is in the corpus and out of the task set, and
    // sampling it would only pad the plan with cells that can never run.
    const cells = planCells({ pages: [page('book', 1), page('book', 2)], tasks: TASKS });
    expect(cells).toEqual([]);
  });

  it('samples a vertical without following the order it arrives in', () => {
    const pages = Array.from({ length: 10 }, (_, i) => page('news', i));
    const cells = planCells({ pages, tasks: TASKS, pagesPerVertical: 3 });
    expect(cells).toHaveLength(3);
    // Not the first three: the corpus is ordered by site and by url, so taking
    // the front of it would be taking one shop, or one aisle of one shop.
    expect(cells.map((c) => c.file)).not.toEqual([
      'news/example-com-0.html',
      'news/example-com-1.html',
      'news/example-com-2.html',
    ]);
  });

  it('makes a small sample a prefix of a larger one', () => {
    // Sizes change constantly while fixing something. If three pages were not
    // inside the five, every change of size would throw away trials already
    // paid for — and on a subscription those are rate-limit windows, not
    // pennies.
    const pages = Array.from({ length: 20 }, (_, i) => page('news', i));
    const of = (n) => planCells({ pages, tasks: TASKS, pagesPerVertical: n }).map((c) => c.file);

    expect(of(10)).toEqual(expect.arrayContaining(of(3)));
    expect(of(20)).toEqual(expect.arrayContaining(of(10)));
    expect(of(3)).toEqual(of(10).slice(0, 3));
  });

  it('interleaves the verticals so an interrupted run still covers them all', () => {
    const pages = [page('ecommerce', 1), page('ecommerce', 2), page('news', 1), page('news', 2)];
    const cells = planCells({ pages, tasks: TASKS });
    // Whatever prefix of this a run gets through, news is in it.
    expect(cells.slice(0, 3).map((c) => c.vertical)).toEqual(['ecommerce', 'news', 'ecommerce']);
  });

  it('narrows to the asked-for verticals and tasks', () => {
    const pages = [page('ecommerce', 1), page('news', 1)];
    expect(planCells({ pages, tasks: TASKS, verticals: ['news'] }).map((c) => c.taskId)).toEqual([
      'news-headline',
    ]);
    expect(
      planCells({ pages, tasks: TASKS, taskIds: ['ecommerce-stock'] }).map((c) => c.taskId)
    ).toEqual(['ecommerce-stock']);
  });

  it('gives every cell an id unique to its page and question', () => {
    const cells = planCells({ pages: [page('ecommerce', 1), page('ecommerce', 2)], tasks: TASKS });
    expect(new Set(cells.map((c) => c.id)).size).toBe(cells.length);
    expect(trialId(cells[0].id, 'tools')).toMatch(/__tools$/);
  });
});

describe('planCost', () => {
  it('counts both keys per cell and both judgements per trial', () => {
    // Every number here is doubled and every one of them is easy to halve by
    // accident: a cell needs a text-derived key *and* a neutral one, and each
    // trial is judged against both. Three cells and six trials is 24 calls; an
    // earlier version promised 15, and on a subscription an underestimate is a
    // rate-limit window that ends halfway through what it said it would do.
    const cells = planCells({ pages: [page('ecommerce', 1), page('news', 1)], tasks: TASKS });
    expect(planCost(cells, ['text', 'tools'])).toEqual({
      cells: 3,
      keys: 6,
      trials: 6,
      judgesAtMost: 12,
      callsAtMost: 24,
    });
  });

  it('costs the same whether the work is counted whole or in parts', () => {
    expect(callsFor(3, 6)).toBe(24);
    // Nothing left to key, only trials to redo: two judgements each.
    expect(callsFor(0, 10)).toBe(30);
  });
});

describe('fingerprint', () => {
  const base = { model: 'sonnet', maxTurns: 8, library: 'abc123', question: 'Price?' };

  it('does not care what order the configuration was written in', () => {
    expect(fingerprint(base)).toBe(
      fingerprint({ question: 'Price?', library: 'abc123', maxTurns: 8, model: 'sonnet' })
    );
  });

  it('changes when anything that could change an answer changes', () => {
    // Each of these produced results that a later run happily reused as though
    // they were current: a different model, a turn cap, the deny list that
    // decides whether the agent spends a turn fetching tool schemas, a reworded
    // question, a fixed mapping.
    for (const [field, value] of [
      ['model', 'opus'],
      ['maxTurns', 4],
      ['library', 'def456'],
      ['question', 'What does it cost?'],
      ['denied', 'ToolSearch'],
    ]) {
      expect(fingerprint({ ...base, [field]: value })).not.toBe(fingerprint(base));
    }
  });
});
