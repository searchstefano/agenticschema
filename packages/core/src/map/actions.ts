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
 * Idempotent actions only. An `OrderAction` or a `ReserveAction` has
 * consequences out in the world: generating those automatically would mean that
 * dropping a script onto a site makes its products orderable by any agent that
 * wanders past. Those go through the explicit opt-in of `defineTool` instead.
 */
const IDEMPOTENT_ACTIONS = new Set(['SearchAction', 'FindAction', 'ReadAction', 'ViewAction']);

const VERB_BY_TYPE: Record<string, string> = {
  SearchAction: 'search',
  FindAction: 'find',
  ReadAction: 'read',
  ViewAction: 'view',
};

export interface ActionOptions {
  /** The page's origin. Without it nothing is generated: there is no way to vet where a request would go. */
  pageOrigin?: string;
  /** Extra hosts allowed beyond the page's own origin. */
  allowedHosts?: readonly string[];
  /** Injectable for tests and for the server adapter. */
  fetchImpl?: typeof globalThis.fetch;
  /**
   * Ceiling on how long a request may take. Without one, a slow endpoint, or one
   * that never answers at all, leaves the agent waiting indefinitely.
   */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export interface ActionResult {
  tools: ToolDescriptor[];
  diagnostics: Diagnostic[];
}

/** From `potentialAction` to an executable tool, with the safety rules applied here rather than downstream. */
export function mapActions(graph: EntityGraph, options: ActionOptions = {}): ActionResult {
  const diagnostics: Diagnostic[] = [];
  const tools: ToolDescriptor[] = [];
  const used = new Set<string>();

  const skip = (type: string, reason: string): void => {
    // Never silently: whoever is integrating has to be able to find out why
    // their action did not show up.
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

      // The check above evaluates the template with its placeholders stripped
      // out. If a parameter lands in the authority, that URL will never be the
      // real one: at runtime every non-empty value gets rejected, leaving the
      // agent with a tool that cannot possibly work. Better not to offer it.
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
    // Idempotent by construction, but it touches the network, so openWorld stays true.
    annotations: { readOnlyHint: true, openWorldHint: true },
    execute: async (input) => {
      const url = expand(urlTemplate, input);
      // Checked again AFTER expansion: a hostile value must not be able to move the destination.
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
 * Same-origin by default. A hostile `urlTemplate` pointing somewhere else would
 * turn the tool into an exfiltration channel for its own parameters.
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
 * A parameter sitting in the authority (scheme, host, port) could change where
 * the request goes. Everywhere else in the template is path and query, and there
 * encoding the value is enough to keep it inside its own segment.
 */
function touchesAuthority(template: string): boolean {
  const schemeEnd = template.indexOf('://');
  if (schemeEnd === -1) return /^\{/.test(template.trim()); // relative template
  const pathStart = template.indexOf('/', schemeEnd + 3);
  const authority = pathStart === -1 ? template : template.slice(0, pathStart);
  return /\{[A-Za-z0-9_]+\}/.test(authority);
}

/** RFC 6570 level 1 only: `{var}`. No operators, no explosions. */
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

/** Handles both the string form `"required name=x"` and PropertyValueSpecification. */
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
