import { describe, expect, it } from 'vitest';
import { cdxUrl, parseCdxLines, selectRecords, spread } from './cdx.mjs';

const rec = (over = {}) => ({
  urlkey: 'test,esempio)/p/1',
  timestamp: '20260717000109',
  url: 'https://esempio.test/p/1',
  status: '200',
  mime: 'text/html',
  'mime-detected': 'text/html',
  digest: 'AAA',
  filename: 'crawl-data/CC-MAIN-2026-30/segments/1/warc/x.warc.gz',
  offset: '100',
  length: '200',
  ...over,
});

describe('cdxUrl', () => {
  it('encodes the pattern so a wildcard survives the query string', () => {
    const url = cdxUrl('CC-MAIN-2026-30', 'www.esempio.test/p/*', 10);
    expect(url).toContain('CC-MAIN-2026-30-index');
    expect(url).toContain('www.esempio.test%2Fp%2F*');
    expect(url).toContain('output=json');
  });
});

describe('parseCdxLines', () => {
  it('reads the newline-delimited JSON the index returns', () => {
    const text = `${JSON.stringify(rec())}\n${JSON.stringify(rec({ urlkey: 'b' }))}`;
    expect(parseCdxLines(text)).toHaveLength(2);
  });

  it('treats "No Captures found" as an empty result, not as a record', () => {
    // The index answers 200 with this body when a domain is absent from the
    // crawl. Booking, Yelp and Allrecipes all answer this way.
    expect(parseCdxLines('{"message": "No Captures found for: www.esempio.test/"}')).toEqual([]);
  });

  it('skips a malformed line instead of losing the whole response', () => {
    const text = `${JSON.stringify(rec())}\n{rotto\n${JSON.stringify(rec({ urlkey: 'b' }))}`;
    expect(parseCdxLines(text)).toHaveLength(2);
  });
});

describe('spread', () => {
  it('samples across the whole list rather than taking the head', () => {
    // The index returns records sorted by urlkey, so the first N are all the
    // same corner of the alphabet: with IKEA, every product starting with "a".
    const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(spread(items, 3)).toEqual([0, 5, 9]);
  });

  it('returns everything when the list is shorter than the limit', () => {
    expect(spread([1, 2], 5)).toEqual([1, 2]);
  });

  it('returns the first item when only one is wanted', () => {
    expect(spread([7, 8, 9], 1)).toEqual([7]);
  });
});

describe('selectRecords', () => {
  it('drops anything that did not answer 200', () => {
    const out = selectRecords([rec(), rec({ urlkey: 'b', status: '404' })], 10);
    expect(out).toHaveLength(1);
  });

  it('drops anything that is not html', () => {
    const out = selectRecords(
      [rec(), rec({ urlkey: 'b', mime: 'application/pdf', 'mime-detected': 'application/pdf' })],
      10
    );
    expect(out).toHaveLength(1);
  });

  it('keeps the newest capture when a url appears more than once', () => {
    const out = selectRecords(
      [
        rec({ timestamp: '20260701000000' }),
        rec({ timestamp: '20260717000109', digest: 'BBB' }),
      ],
      10
    );
    expect(out).toHaveLength(1);
    expect(out[0].timestamp).toBe('20260717000109');
  });

  it('drops a second copy of identical content', () => {
    // Same digest under two urls is one page in the corpus, not two. Shops do
    // this constantly with tracking parameters and locale aliases.
    const out = selectRecords(
      [rec(), rec({ urlkey: 'b', url: 'https://esempio.test/p/1-bis' })],
      10
    );
    expect(out).toHaveLength(1);
  });

  it('caps at the limit', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      rec({ urlkey: `k${i}`, url: `https://esempio.test/p/${i}`, digest: `D${i}` })
    );
    expect(selectRecords(many, 4)).toHaveLength(4);
  });

  it('turns the offset and length into numbers, because a range header needs arithmetic', () => {
    const [only] = selectRecords([rec({ offset: '678361069', length: '190243' })], 1);
    expect(only.offset).toBe(678361069);
    expect(only.length).toBe(190243);
  });
});
