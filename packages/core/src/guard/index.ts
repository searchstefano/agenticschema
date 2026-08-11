import type { Diagnostic, ToolDescriptor } from '../types.js';

/**
 * The core takes page content and puts it in front of a model. That opens two
 * concrete attack channels, not theoretical ones:
 *
 *  1. Prompt injection. An `ld+json` block injected through user content or a
 *     compromised CMS can carry instructions aimed at the agent. The defence:
 *     page text never reaches a tool's INSTRUCTIONS, only the DATA it returns,
 *     and that data gets cleaned and capped. What this file cannot do is tell
 *     an instruction from a sentence — it filters markup, not meaning — so text
 *     that names or describes a tool has to be vetted where it is chosen, and
 *     `typeLabel` in `map/profile.ts` is where `@type` meets that bar.
 *  2. Oversized payloads. A page with thousands of entities can swamp an
 *     agent's context. The defence: a ceiling on the bytes handed back.
 */
export interface GuardOptions {
  /** Longest a tool description may be. */
  maxDescriptionLength?: number;
  /** Ceiling on the bytes a tool may return. */
  maxPayloadBytes?: number;
}

const DEFAULT_MAX_DESCRIPTION = 320;
const DEFAULT_MAX_PAYLOAD = 32_000;

/** Names the MCP spec allows. */
const VALID_TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

// Written as escapes on purpose: a literal control character in source is
// invisible in review and does not survive the first copy-paste. C0 + DEL + C1,
// which is where ANSI sequences and record separators live.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;
/**
 * Replaces every `<…>` with a space: from a `<` to the first `>` after it, an
 * inner `<` included, which is how a browser reads a tag and what `/<[^>]*>/g`
 * used to match here.
 *
 * That regex was quadratic. A `<` with no `>` anywhere after it made the engine
 * scan to the end, fail, and start over at the next `<`, and descriptions come
 * off the page, so the input is the attacker's to choose. Neither narrower
 * regex works as a replacement: `<[^<>]*>` stops at the inner `<` and leaves
 * `<div title="…` — the very text this is meant to remove — standing in the
 * output, while `<[^>]*(?:>|$)` swallows everything after a lone `<`, so
 * `Valutato < 5 stelle` loses its tail. Two `indexOf` walks keep the old
 * meaning and never look at a character twice.
 */
function stripTags(value: string): string {
  let out = '';
  let from = 0;

  for (;;) {
    const open = value.indexOf('<', from);
    if (open === -1) break;
    const close = value.indexOf('>', open + 1);
    // Nothing closes this one, so nothing closes a later `<` either: it is text.
    if (close === -1) break;

    out += `${value.slice(from, open)} `;
    from = close + 1;
  }

  return out + value.slice(from);
}

/**
 * Cleans text that came off the page. HTML tags go, since they are the usual
 * way to hide instructions from a human reader but not from the model, and so
 * do control characters.
 */
export function sanitizeText(value: string, maxLength = DEFAULT_MAX_DESCRIPTION): string {
  const clean = stripTags(value)
    .replace(CONTROL_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length <= maxLength ? clean : `${clean.slice(0, maxLength - 1)}…`;
}

/**
 * Last stop before the adapters: valid names, cleaned descriptions, capped
 * payloads. It lives in the core, so every adapter gets it for free.
 */
export function guardTools(
  tools: readonly ToolDescriptor[],
  options: GuardOptions = {}
): { tools: ToolDescriptor[]; diagnostics: Diagnostic[] } {
  const maxDescription = options.maxDescriptionLength ?? DEFAULT_MAX_DESCRIPTION;
  const maxPayload = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD;
  const diagnostics: Diagnostic[] = [];

  const guarded = tools
    .filter((tool) => {
      if (VALID_TOOL_NAME.test(tool.name)) return true;
      diagnostics.push({
        level: 'warn',
        code: 'action-skipped',
        message: `invalid tool name, dropped: ${tool.name.slice(0, 40)}`,
      });
      return false;
    })
    .map((tool): ToolDescriptor => {
      const description = sanitizeText(tool.description, maxDescription);
      if (description !== tool.description) {
        diagnostics.push({
          level: 'info',
          code: 'field-truncated',
          message: `description of ${tool.name} was sanitised or truncated`,
        });
      }

      return {
        ...tool,
        description,
        execute: async (args) => {
          const result = await tool.execute(args);
          return {
            ...result,
            content: result.content.map((block) => ({
              ...block,
              text: capPayload(block.text, maxPayload),
            })),
          };
        },
      };
    });

  return { tools: guarded, diagnostics };
}

function capPayload(text: string, maxBytes: number): string {
  const clean = text.replace(CONTROL_CHARS, '');
  const bytes = encoder.encode(clean);
  if (bytes.length <= maxBytes) return clean;

  const notice = `\n… [truncated: content exceeded ${maxBytes} bytes]`;
  // The budget is whatever is left after the notice, and it must not go below
  // zero: with a maxBytes smaller than the notice itself, a negative target
  // could never be reached.
  const budget = Math.max(0, maxBytes - byteLength(notice));

  // Cut the bytes we already have. Trimming the string one character at a time
  // and re-encoding to measure walked the whole payload once per character
  // dropped, and multi-byte text overshoots the budget two to four times over,
  // so it ran tens of thousands of laps for a single tool call.
  //
  // `budget` is below `bytes.length` — anything else returned above — so the cut
  // is always inside the array, but it can land mid-sequence. Stepping back over
  // continuation bytes (`10xxxxxx`) reaches the start of the code point in at
  // most three moves. The old loop measured in bytes yet cut in UTF-16 units,
  // which left a stranded surrogate whenever the budget fell between the halves
  // of a pair.
  let end = budget;
  while (end > 0 && (bytes[end]! & 0b1100_0000) === 0b1000_0000) end -= 1;

  return decoder.decode(bytes.subarray(0, end)) + notice;
}

// `Buffer` does not exist in the browser and the core has to stay isomorphic.
const encoder = new TextEncoder();
// `ignoreBOM` keeps a leading U+FEFF as a character instead of eating it, so
// decoding a slice gives back exactly the text that was encoded.
const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
const byteLength = (value: string): number => encoder.encode(value).length;
