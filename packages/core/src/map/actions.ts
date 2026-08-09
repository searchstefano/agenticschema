import { toSlug } from './profile.js';
import {
  isRef,
  type Diagnostic,
  type Entity,
  type EntityGraph,
  type JsonObject,
  type ToolDescriptor,
} from '../types.js';

/**
 * Solo azioni idempotenti. Un `OrderAction` o un `ReserveAction` hanno effetti
 * nel mondo reale: esporli automaticamente significherebbe che aggiungere uno
 * script a un sito ne rende ordinabili i prodotti da qualsiasi agente.
 * Quelle passano dall'opt-in esplicito di `defineTool`.
 */
const IDEMPOTENT_ACTIONS = new Set(['SearchAction', 'FindAction', 'ReadAction', 'ViewAction']);

const VERB_BY_TYPE: Record<string, string> = {
  SearchAction: 'search',
  FindAction: 'find',
  ReadAction: 'read',
  ViewAction: 'view',
};

export interface ActionOptions {
  /** Origin della pagina. Senza, nessuna azione viene generata: non c'è modo di verificare la destinazione. */
  pageOrigin?: string;
  /** Host aggiuntivi ammessi oltre all'origin della pagina. */
  allowedHosts?: readonly string[];
  /** Iniettabile per i test e per l'adapter server. */
  fetchImpl?: typeof globalThis.fetch;
  /**
   * Tetto sulla durata di una richiesta. Senza, un endpoint lento o che non
   * risponde mai terrebbe l'agente in attesa a tempo indefinito.
   */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export interface ActionResult {
  tools: ToolDescriptor[];
  diagnostics: Diagnostic[];
}

/** Da `potentialAction` a tool eseguibile, con le regole di sicurezza applicate qui e non a valle. */
export function mapActions(graph: EntityGraph, options: ActionOptions = {}): ActionResult {
  const diagnostics: Diagnostic[] = [];
  const tools: ToolDescriptor[] = [];
  const used = new Set<string>();

  const skip = (type: string, reason: string): void => {
    // Mai in silenzio: chi integra deve poter capire perché la sua azione non c'è.
    diagnostics.push({
      level: 'info',
      code: 'action-skipped',
      message: `${type || 'Action'} not exposed as a tool: ${reason}`,
    });
  };

  for (const entity of graph.nodes.values()) {
    for (const value of entity.props['potentialAction'] ?? []) {
      if (!isRef(value)) continue;
      const action = graph.nodes.get(value.ref);
      if (!action) continue;

      const type = action.types[0] ?? '';
      if (!IDEMPOTENT_ACTIONS.has(type)) {
        skip(type, 'non-idempotent type (use defineTool for actions with side effects)');
        continue;
      }

      const target = resolveTarget(graph, action);
      const urlTemplate =
        firstString(target?.props['urlTemplate']) ?? firstString(action.props['target']);
      if (!urlTemplate) {
        skip(type, 'no urlTemplate on the target');
        continue;
      }

      const method = (firstString(target?.props['httpMethod']) ?? 'GET').toUpperCase();
      if (method !== 'GET') {
        skip(type, `httpMethod ${method}: only GET is allowed`);
        continue;
      }

      if (!options.pageOrigin) {
        skip(type, 'page origin unknown: cannot verify the destination');
        continue;
      }

      const destination = safeDestination(urlTemplate, options);
      if ('error' in destination) {
        skip(type, destination.error);
        continue;
      }

      // Il controllo sopra valuta il template coi placeholder rimossi. Se un
      // parametro cade nell'autorità, quell'URL non sarà mai quello vero: a
      // runtime ogni valore non vuoto verrebbe respinto, e resterebbe esposto
      // all'agente un tool che non può funzionare. Meglio non generarlo.
      if (touchesAuthority(urlTemplate)) {
        skip(type, 'a template parameter would alter scheme, host or port');
        continue;
      }

      const params = templateVariables(urlTemplate);
      if (params.length === 0) {
        skip(type, 'urlTemplate has no parameters: not a parameterisable action');
        continue;
      }

      const required = requiredParam(action);
      const name = uniqueName(
        `${VERB_BY_TYPE[type] ?? 'run'}_${toSlug(entity.types[0] ?? 'site')}`,
        used
      );

      tools.push(
        buildActionTool({ name, type, urlTemplate, params, required, options, entityId: entity.id })
      );
    }
  }

  return { tools, diagnostics };
}

// ---------------------------------------------------------------------------

function buildActionTool(args: {
  name: string;
  type: string;
  urlTemplate: string;
  params: string[];
  required: string | undefined;
  options: ActionOptions;
  entityId: string;
}): ToolDescriptor {
  const { name, type, urlTemplate, params, required, options, entityId } = args;

  const properties: Record<string, JsonObject> = {};
  for (const param of params) {
    properties[param] = { type: 'string', description: `Value for {${param}}` };
  }

  return {
    name,
    description: `Run this site's own ${type.replace('Action', '').toLowerCase()} and return the raw response.`,
    inputSchema: {
      type: 'object',
      properties,
      ...(required ? { required: [required] } : {}),
      additionalProperties: false,
    },
    // Idempotente per costruzione, ma tocca la rete: openWorld resta true.
    annotations: { readOnlyHint: true, openWorldHint: true },
    execute: async (input) => {
      const url = expand(urlTemplate, input);
      // Ricontrollo DOPO l'espansione: un valore ostile non deve poter spostare la destinazione.
      const check = safeDestination(url, options);
      if ('error' in check) {
        return {
          isError: true,
          content: [{ type: 'text', text: `destination rejected: ${check.error}` }],
        };
      }

      const doFetch = options.fetchImpl ?? globalThis.fetch;
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      try {
        const response = await doFetch(check.url, {
          headers: { accept: 'application/json, text/html' },
          signal: AbortSignal.timeout(timeoutMs),
        });
        return { content: [{ type: 'text', text: await response.text() }] };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `request failed: ${(err as Error).message}` }],
        };
      }
    },
    source: { kind: 'action', entityId, entityType: type },
  };
}

/**
 * Same-origin per default. Un `urlTemplate` ostile che punta altrove
 * trasformerebbe il tool in un canale di esfiltrazione dei parametri.
 */
function safeDestination(
  candidate: string,
  options: ActionOptions
): { url: string } | { error: string } {
  const withoutPlaceholders = candidate.replace(/\{[^}]*\}/g, '');
  let url: URL;
  try {
    url = new URL(withoutPlaceholders, options.pageOrigin);
  } catch {
    return { error: 'urlTemplate is not a valid URL' };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { error: `scheme ${url.protocol} not allowed` };
  }

  const allowed = new Set([
    ...(options.pageOrigin ? [new URL(options.pageOrigin).host] : []),
    ...(options.allowedHosts ?? []),
  ]);
  if (!allowed.has(url.host)) {
    return { error: `host ${url.host} is outside the page origin` };
  }

  try {
    return { url: new URL(candidate, options.pageOrigin).href };
  } catch {
    return { error: 'urlTemplate is not a valid URL' };
  }
}

/**
 * Un parametro nell'autorità (schema, host, porta) potrebbe cambiare la
 * destinazione. Il resto del template è solo path e query: lì l'encoding dei
 * valori basta a tenerli dentro il segmento.
 */
function touchesAuthority(template: string): boolean {
  const schemeEnd = template.indexOf('://');
  if (schemeEnd === -1) return /^\{/.test(template.trim()); // template relativo
  const pathStart = template.indexOf('/', schemeEnd + 3);
  const authority = pathStart === -1 ? template : template.slice(0, pathStart);
  return /\{[A-Za-z0-9_]+\}/.test(authority);
}

/** RFC 6570 livello 1 soltanto: `{var}`. Niente operatori, niente esplosioni. */
const TEMPLATE_VAR = /\{([A-Za-z0-9_]+)\}/g;

const templateVariables = (template: string): string[] => [
  ...new Set([...template.matchAll(TEMPLATE_VAR)].map((m) => m[1] as string)),
];

function expand(template: string, input: Record<string, unknown>): string {
  return template.replace(TEMPLATE_VAR, (_match, name: string) => {
    const value = input[name];
    return value === undefined ? '' : encodeURIComponent(String(value));
  });
}

/** Sia la forma stringa `"required name=x"` sia PropertyValueSpecification. */
function requiredParam(action: Entity): string | undefined {
  const spec = action.props['query-input']?.[0];
  if (typeof spec === 'string') {
    return /\brequired\b/.test(spec) ? /name=(\S+)/.exec(spec)?.[1] : undefined;
  }
  return undefined;
}

function resolveTarget(graph: EntityGraph, action: Entity): Entity | undefined {
  const target = action.props['target']?.[0];
  return target && isRef(target) ? graph.nodes.get(target.ref) : undefined;
}

const firstString = (values: readonly unknown[] | undefined): string | undefined =>
  values?.find((v): v is string => typeof v === 'string');

function uniqueName(base: string, used: Set<string>): string {
  let name = base;
  let n = 2;
  while (used.has(name)) name = `${base}_${n++}`;
  used.add(name);
  return name;
}
