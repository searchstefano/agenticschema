import type { Diagnostic, ToolDescriptor } from '../types.js';

/**
 * Il core prende contenuto di pagina e lo mette nel contesto di un modello.
 * Sono due canali di attacco concreti, non teorici:
 *
 *  1. Prompt injection. Un blocco `ld+json` iniettato via UGC o CMS compromesso
 *     può contenere istruzioni rivolte all'agente. Difesa: il testo di pagina non
 *     entra mai nelle ISTRUZIONI del tool, solo nei DATI restituiti; e i dati
 *     vengono ripuliti e limitati.
 *  2. Payload sproporzionati. Una pagina con migliaia di entità può saturare il
 *     contesto dell'agente. Difesa: tetto sui byte restituiti.
 */
export interface GuardOptions {
  /** Lunghezza massima di una description di tool. */
  maxDescriptionLength?: number;
  /** Tetto sui byte del payload restituito da un tool. */
  maxPayloadBytes?: number;
}

const DEFAULT_MAX_DESCRIPTION = 320;
const DEFAULT_MAX_PAYLOAD = 32_000;

/** Nomi ammessi dalla specifica MCP. */
const VALID_TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

// Escape espliciti: un carattere di controllo letterale nel sorgente è invisibile in
// review e si perde al primo copia-incolla. C0 + DEL + C1: dove vivono le
// sequenze ANSI e i separatori di record.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;
const HTML_TAG = /<[^>]*>/g;

/**
 * Ripulisce testo proveniente dalla pagina.
 * I tag HTML spariscono (sono il veicolo più comune per nascondere istruzioni a
 * un lettore umano ma non al modello) insieme ai caratteri di controllo.
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
 * Ultimo passaggio prima degli adapter: nomi validi, description ripulite,
 * payload limitati. Vale per ogni adapter perché sta nel core.
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
  // Il budget è ciò che resta dopo l'avviso e non può andare sotto zero: con un
  // maxBytes più piccolo dell'avviso stesso, un budget negativo non sarebbe mai
  // raggiungibile e il ciclo di taglio non terminerebbe.
  const budget = Math.max(0, maxBytes - byteLength(notice));

  // Si taglia per caratteri e si misura in byte, così un code point non viene spezzato.
  let cut = clean.slice(0, budget);
  while (cut.length > 0 && byteLength(cut) > budget) cut = cut.slice(0, -1);

  return cut + notice;
}

// `Buffer` non esiste nel browser: il core deve restare isomorfo.
const encoder = new TextEncoder();
const byteLength = (value: string): number => encoder.encode(value).length;
