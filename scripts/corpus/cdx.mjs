/**
 * Talking to the Common Crawl URL index.
 *
 * Everything here is pure: building a query, reading a response, choosing which
 * captures are worth downloading. The network lives in `fetch.mjs`, so the
 * decisions that shape the corpus can be tested without it.
 */

export const cdxUrl = (crawl, pattern, limit) =>
  `https://index.commoncrawl.org/${crawl}-index` +
  `?url=${encodeURIComponent(pattern)}&output=json&limit=${limit}&filter=status:200`;

/**
 * The index answers with newline-delimited JSON, one capture per line, except
 * when it has nothing: then it is a single object carrying `message`. That is a
 * fact about the domain rather than a record or an error, and it is how Booking,
 * Yelp and Allrecipes all answer, because Common Crawl honours the same
 * robots.txt that turns away a direct fetch.
 */
export function parseCdxLines(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || parsed.message) continue;
    out.push(parsed);
  }
  return out;
}

/**
 * `limit` items taken evenly across the list rather than off the front.
 *
 * The index sorts by urlkey, so the first N captures of a shop are every product
 * whose name starts with "a". A corpus built from the head of that list is a
 * corpus of one aisle.
 */
export function spread(items, limit) {
  if (items.length <= limit) return [...items];
  if (limit <= 1) return items.length ? [items[0]] : [];
  const step = (items.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, i) => items[Math.round(i * step)]);
}

/** Captures worth downloading, deduplicated, capped, and ready for a Range header. */
export function selectRecords(records, limit) {
  const newestPerUrl = new Map();
  for (const record of records) {
    if (record.status !== '200') continue;
    const mime = record['mime-detected'] ?? record.mime ?? '';
    if (!mime.startsWith('text/html')) continue;

    const key = record.urlkey ?? record.url;
    const seen = newestPerUrl.get(key);
    if (!seen || (record.timestamp ?? '') > (seen.timestamp ?? '')) newestPerUrl.set(key, record);
  }

  const digests = new Set();
  const unique = [];
  for (const record of newestPerUrl.values()) {
    // The same digest under two urls is one page, not two. Shops produce these
    // constantly through tracking parameters and locale aliases, and a corpus
    // that counts them twice overstates its own size.
    if (record.digest) {
      if (digests.has(record.digest)) continue;
      digests.add(record.digest);
    }
    unique.push({
      url: record.url,
      urlkey: record.urlkey,
      timestamp: record.timestamp,
      digest: record.digest,
      filename: record.filename,
      offset: Number(record.offset),
      length: Number(record.length),
    });
  }

  return spread(unique, limit);
}
