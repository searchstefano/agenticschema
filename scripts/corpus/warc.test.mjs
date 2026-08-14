import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseWarcRecord } from './warc.mjs';

/** Builds a response record in the shape Common Crawl serves through a range request. */
const record = ({ url = 'https://esempio.test/p/1', status = 200, headers = {}, body = '' }) => {
  const warc = [
    'WARC/1.0',
    'WARC-Type: response',
    `WARC-Target-URI: ${url}`,
    'Content-Type: application/http; msgtype=response',
  ].join('\r\n');
  const http = [
    `HTTP/1.1 ${status} OK`,
    ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
  ].join('\r\n');
  return Buffer.concat([
    Buffer.from(`${warc}\r\n\r\n${http}\r\n\r\n`, 'latin1'),
    Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8'),
  ]);
};

describe('parseWarcRecord', () => {
  it('pulls the url, the status and the body out of a response record', () => {
    const out = parseWarcRecord(
      record({
        url: 'https://esempio.test/p/zaino',
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: '<html><body>Zaino</body></html>',
      })
    );

    expect(out.url).toBe('https://esempio.test/p/zaino');
    expect(out.status).toBe(200);
    expect(out.html).toContain('Zaino');
  });

  it('gunzips a payload that arrived compressed', () => {
    const out = parseWarcRecord(
      record({
        headers: { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' },
        body: gzipSync(Buffer.from('<html>compresso</html>', 'utf8')),
      })
    );

    expect(out.html).toContain('compresso');
  });

  it('honours the charset from the Content-Type', () => {
    // `città` in latin1: the bytes are not valid utf-8, so reading them as utf-8
    // gives a replacement character instead of the accent.
    const out = parseWarcRecord(
      record({
        headers: { 'Content-Type': 'text/html; charset=iso-8859-1' },
        body: Buffer.from('<html>citt\xe0</html>', 'latin1'),
      })
    );

    expect(out.html).toContain('città');
  });

  it('falls back to the meta charset when the header carries none', () => {
    const out = parseWarcRecord(
      record({
        headers: { 'Content-Type': 'text/html' },
        body: Buffer.from(
          '<html><head><meta charset="iso-8859-1"></head><body>citt\xe0</body></html>',
          'latin1'
        ),
      })
    );

    expect(out.html).toContain('città');
  });

  it('reports the status rather than assuming 200', () => {
    const out = parseWarcRecord(record({ status: 404, body: '<html>via</html>' }));
    expect(out.status).toBe(404);
  });

  it('refuses a record that is not a response', () => {
    const req = Buffer.from(
      'WARC/1.0\r\nWARC-Type: request\r\nWARC-Target-URI: https://esempio.test/\r\n\r\nGET / HTTP/1.1\r\n\r\n',
      'latin1'
    );
    expect(() => parseWarcRecord(req)).toThrow(/request/);
  });

  it('refuses a record with no HTTP header block', () => {
    const truncated = Buffer.from('WARC/1.0\r\nWARC-Type: response\r\n', 'latin1');
    expect(() => parseWarcRecord(truncated)).toThrow();
  });
});
