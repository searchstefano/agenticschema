/**
 * Which trials a run consists of, decided before anything is spawned.
 *
 * Pure, so that "what is this run going to cost me" can be answered — by
 * `--dry-run` and by a test — without starting a single process. A benchmark
 * that only reveals its size by running is one nobody checks before spending.
 */
import { createHash } from 'node:crypto';

const digest = (value) => createHash('sha256').update(value).digest('hex');

/**
 * A short hash of everything that could change what a trial answers.
 *
 * A trial already on disk is skipped, which is what makes a run resumable — and
 * for a while that skip looked only at whether the file existed. It happily
 * mixed answers given by different models, under different turn caps, with a
 * different deny list, against a different version of the library, and reported
 * the average as one measurement. It did exactly that here: the `ToolSearch`
 * experiment and the `hasVariant` fix both left results on disk that the next
 * run treated as current.
 *
 * Keys are sorted, so the same configuration hashes the same way whatever order
 * the caller assembled it in.
 */
export function fingerprint(parts) {
  const ordered = Object.fromEntries(Object.entries(parts).sort(([a], [b]) => a.localeCompare(b)));
  return digest(JSON.stringify(ordered)).slice(0, 12);
}

/**
 * `count` pages of a vertical, chosen so that every size is a prefix of every
 * larger one.
 *
 * The corpus fetcher spreads its picks evenly across a sorted list, which is
 * right there: taking the first N captures of a shop would give every product
 * whose name begins with "a". Here the requirement is different, and it is
 * about how this benchmark actually gets used. Sizes change constantly — three
 * pages while fixing something, twenty for a considered run — and an evenly
 * spread sample picks *different* pages at each size, so every change of size
 * discards the trials already paid for. Sorting by a hash of the path is as free
 * of alphabetical bias and is nested: the three pages are inside the five, which
 * are inside the twenty.
 */
export function sample(pages, count) {
  const ordered = [...pages].sort((a, b) => digest(a.file).localeCompare(digest(b.file)));
  return count ? ordered.slice(0, count) : ordered;
}

/**
 * A page's identity on disk, and therefore the name of every file recorded
 * about it. Derived from the corpus path, which is already unique, so a resumed
 * run recognises what it finished last time.
 *
 * Truncated with a hash rather than plainly, because some shops put the whole
 * product name in the url and two of those can agree for the first hundred
 * characters. Silently sharing a slug would make one page overwrite the other's
 * results.
 */
export function slugForPage(file) {
  const bare = String(file).replace(/\.html?$/i, '');
  const slug = bare.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (slug.length <= 100) return slug;
  const hash = createHash('sha256').update(bare).digest('hex').slice(0, 8);
  return `${slug.slice(0, 91)}-${hash}`;
}

/** One arm of one question about one page. The unit that gets written to disk. */
export const trialId = (cellId, arm) => `${cellId}__${arm}`;

/**
 * The cross product of the sampled pages and the questions for their vertical.
 *
 * Verticals are interleaved rather than run one after another. A run of this
 * size gets interrupted — a laptop sleeps, a rate limit arrives — and the
 * useful partial result is one that covers every vertical thinly, not one that
 * finished ecommerce and never reached recipes.
 */
export function planCells({ pages, tasks, pagesPerVertical, verticals, taskIds }) {
  const wanted = new Set(verticals ?? []);
  const byVertical = new Map();

  for (const task of tasks) {
    if (taskIds && !taskIds.includes(task.id)) continue;
    if (wanted.size > 0 && !wanted.has(task.vertical)) continue;
    const bucket = byVertical.get(task.vertical) ?? { tasks: [], pages: [] };
    bucket.tasks.push(task);
    byVertical.set(task.vertical, bucket);
  }

  for (const page of pages) {
    // A vertical with no questions gets no pages, however many the corpus
    // holds: `book` is two pages and has none, and sampling it would only pad
    // the plan with cells that can never run.
    const bucket = byVertical.get(page.vertical);
    if (bucket) bucket.pages.push(page);
  }

  const columns = [];
  for (const [vertical, bucket] of [...byVertical].sort(([a], [b]) => a.localeCompare(b))) {
    const sampled = sample(bucket.pages, pagesPerVertical);
    const cells = [];
    for (const page of sampled) {
      const pageSlug = slugForPage(page.file);
      for (const task of bucket.tasks) {
        cells.push({
          id: `${pageSlug}__${task.id}`,
          pageSlug,
          file: page.file,
          url: page.url,
          vertical,
          taskId: task.id,
          kind: task.kind,
          question: task.question,
        });
      }
    }
    if (cells.length > 0) columns.push(cells);
  }

  const interleaved = [];
  for (let i = 0; columns.some((c) => i < c.length); i += 1) {
    for (const column of columns) if (i < column.length) interleaved.push(column[i]);
  }
  return interleaved;
}

/**
 * The most CLI calls a given amount of work can cost.
 *
 * Every count here is doubled and it is easy to halve one by accident. A cell
 * needs **two** answer keys, one from the page text and one from the text and
 * its published data; a trial is judged against **both** of those, so it can
 * cost two judgements rather than one. Three cells and six trials is 6 + 6 + 12
 * = 24 calls, not the 15 an earlier version of this promised — and on a
 * subscription an underestimate is a rate-limit window that ends halfway
 * through what it said it would do.
 *
 * An upper bound, not a forecast: judging is skipped wherever a key or an answer
 * says the page does not answer, which is most of the `absent` questions.
 */
export const callsFor = (cellsNeedingKeys, trials) => cellsNeedingKeys * 2 + trials * 3;

/** What a whole plan would cost from nothing, for `--dry-run` to say out loud. */
export function planCost(cells, arms) {
  const keys = new Set(cells.map((c) => c.id)).size;
  const trials = cells.length * arms.length;
  return {
    cells: cells.length,
    keys: keys * 2,
    trials,
    judgesAtMost: trials * 2,
    callsAtMost: callsFor(keys, trials),
  };
}
