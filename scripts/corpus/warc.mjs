/**
 * One WARC response record, as Common Crawl serves it through a range request.
 *
 * The record arrives as three parts glued by blank lines: the WARC header, the
 * HTTP header of the original response, then the bytes of the page. Everything
 * here works on Buffers until the last step, because the charset is only known
 * once the headers have been read, and decoding early is how accents turn into
 * question marks.
 */
import { gunzipSync } from 'node:zlib';

const CRLFCRLF = Buffer.from('\r\n\r\n');
const LFLF = Buffer.from('\n\n');

/**
 * The first blank line at or after `from`. CRLF is what the spec says and what
 * Common Crawl writes; bare LF turns up anyway in records whose origin server
 * was careless, and a corpus is exactly where the careless ones collect.
 */
function boundary(buf, from) {
  const crlf = buf.indexOf(CRLFCRLF, from);
  const lf = buf.indexOf(LFLF, from);
  if (crlf === -1 && lf === -1) return undefined;
  if (crlf !== -1 && (lf === -1 || crlf <= lf)) return { end: crlf, next: crlf + 4 };
  return { end: lf, next: lf + 2 };
}

const headerValue = (block, name) => {
  const match = block.match(new RegExp(`^${name}\\s*:\\s*(.*)$`, 'im'));
  return match?.[1]?.trim();
};

/**
 * `Content-Type` first, since the server is the authority on its own bytes.
 * Failing that the `<meta>` tag, read as latin1 so the scan cannot itself
 * corrupt what it is looking for.
 */
function charsetOf(contentType, payload) {
  const fromHeader = contentType.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1];
  if (fromHeader) return fromHeader;

  const head = payload.subarray(0, 4096).toString('latin1');
  return (
    head.match(/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i)?.[1] ??
    head.match(/content\s*=\s*["'][^"']*charset=([\w-]+)/i)?.[1]
  );
}

function decode(bytes, charset) {
  const label = charset?.toLowerCase();
  if (!label || label === 'utf-8' || label === 'utf8') return bytes.toString('utf8');
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    // An unknown label is not worth losing the page over. utf-8 is the right
    // guess for the overwhelming majority of what is left.
    return bytes.toString('utf8');
  }
}

export function parseWarcRecord(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);

  const first = boundary(buf, 0);
  if (!first) throw new Error('malformed WARC record: no blank line after the WARC header');
  const warcHeader = buf.subarray(0, first.end).toString('latin1');

  // Checked before the rest: a request or metadata record has no page in it,
  // and reading one as though it did produces nonsense rather than an error.
  const type = headerValue(warcHeader, 'WARC-Type');
  if (type && type !== 'response') {
    throw new Error(`WARC-Type is "${type}", expected "response"`);
  }

  const second = boundary(buf, first.next);
  if (!second) throw new Error('malformed WARC record: no blank line after the HTTP header');
  const httpHeader = buf.subarray(first.next, second.end).toString('latin1');

  let payload = buf.subarray(second.next);
  if (/gzip/i.test(headerValue(httpHeader, 'Content-Encoding') ?? '')) {
    payload = gunzipSync(payload);
  }

  const contentType = headerValue(httpHeader, 'Content-Type') ?? '';
  return {
    url: headerValue(warcHeader, 'WARC-Target-URI') ?? '',
    status: Number(httpHeader.match(/^HTTP\/[\d.]+\s+(\d{3})/)?.[1] ?? 0),
    contentType,
    html: decode(payload, charsetOf(contentType, payload)),
  };
}
