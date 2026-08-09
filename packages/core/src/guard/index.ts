import type { Diagnostic, ToolDescriptor } from '../types.js';

/**
 * The core takes page content and puts it in front of a model. That opens two
 * concrete attack channels, not theoretical ones:
 *
 *  1. Prompt injection. An `ld+json` block injected through user content or a
 *     compromised CMS can carry instructions aimed at the agent. The defence:
 *     page text never reaches a tool's INSTRUCTIONS, only the DATA it returns,
 *     and that data gets cleaned and capped.
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
const HTML_TAG = /<[^>]*>/g;

/**
 * Cleans text that came off the page. HTML tags go, since they are the usual
 * way to hide instructions from a human reader but not from the model, and so
 * do control characters.
 */
export function sanitizeText(value: string, maxLength = DEFAULT_MAX_DESCRIPTION): string {
  const clean = value
    .replace(HTML_TAG, ' ')
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
  if (byteLength(clean) <= maxBytes) return clean;

  const notice = `\n… [truncated: content exceeded ${maxBytes} bytes]`;
  // The budget is whatever is left after the notice, and it must not go below
  // zero: with a maxBytes smaller than the notice itself, a negative target
  // could never be reached and the trimming loop would spin forever.
  const budget = Math.max(0, maxBytes - byteLength(notice));

  // Trim by characters, measure in bytes, so a code point never gets split.
  let cut = clean.slice(0, budget);
  while (cut.length > 0 && byteLength(cut) > budget) cut = cut.slice(0, -1);

  return cut + notice;
}

// `Buffer` does not exist in the browser and the core has to stay isomorphic.
const encoder = new TextEncoder();
const byteLength = (value: string): number => encoder.encode(value).length;
