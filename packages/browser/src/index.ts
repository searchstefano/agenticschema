import {
  extract,
  toTools,
  type Diagnostic,
  type PipelineOptions,
  type ToolDescriptor,
} from '@agenticschema/core';

/**
 * The slice of WebMCP this adapter needs.
 *
 * It deliberately leaves out `getTools()` and `executeTool()`. Those are
 * agent-side calls and they do not resolve while no agent is attached, so
 * awaiting one would stall page init. The adapter keeps its own registry instead.
 */
interface ModelContext {
  registerTool(
    tool: {
      name: string;
      description: string;
      inputSchema: unknown;
      execute: (args: Record<string, unknown>) => unknown;
    },
    options?: { signal?: AbortSignal }
  ): unknown;
}

export interface StartOptions extends PipelineOptions {
  /** Defaults to the page's own `document`. */
  document?: Document;
  /** Follow route changes and markup edits in single-page apps. Defaults to true. */
  watch?: boolean;
  /** How long to wait after a DOM change before remapping. Defaults to 250 ms. */
  debounceMs?: number;
  /** Injectable in tests. Otherwise `document.modelContext` is used. */
  modelContext?: ModelContext;
}

export interface Handle {
  /** The tools currently registered. */
  tools(): readonly ToolDescriptor[];
  /**
   * What the pipeline noticed on the way from markup to tools: blocks it could
   * not parse, actions it refused, fields it truncated. The tool list alone
   * cannot tell you why something is missing, and missing is the failure mode
   * that matters here.
   */
  diagnostics(): readonly Diagnostic[];
  /** Remap the page now. Does nothing if the markup has not changed. */
  refresh(): Promise<void>;
  /** Unregister everything and stop watching. */
  stop(): void;
}

type ProfileOptions = Pick<PipelineOptions, 'profiles' | 'ancestorsOf'>;
let profilesPromise: Promise<ProfileOptions> | undefined;

/**
 * The profiles and the Schema.org hierarchy weigh more than everything else put
 * together, so they stay in their own chunk and load once the adapter is already
 * running. A page that includes the script should pay as little as possible up
 * front. If the chunk never arrives, the core's generic profile carries on alone.
 */
function loadProfiles(): Promise<ProfileOptions> {
  profilesPromise ??= import('@agenticschema/profiles')
    .then((m) => m.schemaOrgProfiles as ProfileOptions)
    .catch((err: unknown) => {
      // Out loud. Swallowing this is what hid the 0.1.1 packaging bug: the tools
      // still showed up, only with generic names, so the page looked healthy and
      // the damage was visible nowhere except in the tool list itself.
      console.warn(
        '[agenticschema] profiles could not be loaded, falling back to generic tool names:',
        err
      );
      return {} as ProfileOptions;
    });
  return profilesPromise;
}

/**
 * Finds the WebMCP surface. `document.modelContext` is the canonical one and
 * `navigator.modelContext` survives as a deprecated alias. If neither is there,
 * load the polyfill: Chrome does not enable WebMCP by default, which makes the
 * polyfill the normal case rather than the exception.
 */
async function resolveApi(): Promise<ModelContext | undefined> {
  const find = (): ModelContext | undefined =>
    (globalThis as { document?: { modelContext?: ModelContext } }).document?.modelContext ??
    (globalThis as { navigator?: { modelContext?: ModelContext } }).navigator?.modelContext;

  const existing = find();
  if (existing) return existing;

  try {
    // The specifier stays a literal on purpose. Behind a variable, esbuild cannot
    // see the import and leaves the bare specifier in the bundle, where a browser
    // has nothing to resolve it with. That shipped in 0.1.1 and meant the script
    // tag registered nothing at all unless the browser had WebMCP natively.
    await import('@mcp-b/webmcp-polyfill');
  } catch {
    return undefined;
  }
  return find();
}

export async function start(options: StartOptions = {}): Promise<Handle> {
  const doc = options.document ?? globalThis.document;
  if (!doc) throw new Error('agenticschema/browser needs a document');

  const resolved = options.modelContext ?? (await resolveApi());
  if (!resolved) {
    // Not an error. A site that includes the script must not break on a browser
    // without WebMCP where the polyfill cannot be loaded either. It must not be
    // silent either: registering nothing looks exactly like working correctly
    // until someone goes looking for the tools.
    const message =
      'no WebMCP surface available: document.modelContext is missing and the polyfill did not load';
    console.warn(`[agenticschema] ${message}. No tools registered.`);
    // Reported, not just logged. An empty diagnostics array here is the one
    // answer that misleads: to anything reading the handle, a browser with no
    // WebMCP looked exactly like a page where everything went fine.
    return {
      tools: () => [],
      diagnostics: () => [{ level: 'warn', code: 'no-webmcp-surface', message }],
      refresh: async () => {},
      stop: () => {},
    };
  }
  // Rebound after the guard: the narrowing does not survive into the closures.
  const api: ModelContext = resolved;

  const baseUrl = options.baseUrl ?? globalThis.location?.href;
  const debounceMs = options.debounceMs ?? 250;

  let controller: AbortController | undefined;
  let registered: ToolDescriptor[] = [];
  let reported: Diagnostic[] = [];
  let lastSnapshot = '';
  let stopped = false;

  /**
   * A fingerprint of the structured markup. This is what gets compared, not the
   * tool signatures: when only a price changes, names and descriptions stay
   * identical while the tool closures are already stale and need rebuilding.
   */
  const snapshot = (): string => JSON.stringify(extract(doc, options).nodes);

  async function refresh(): Promise<void> {
    if (stopped) return;
    const current = snapshot();
    if (current === lastSnapshot) return;

    controller?.abort(); // the only way to unregister: WebMCP has no unregisterTool
    controller = new AbortController();

    let result;
    try {
      result = toTools(doc, {
        ...(await loadProfiles()),
        ...options,
        ...(baseUrl ? { baseUrl } : {}),
      });
    } catch (err) {
      // `lastSnapshot` is deliberately left alone. Recording this markup as done
      // before the work succeeded froze the adapter for the rest of the session:
      // every later refresh found the fingerprint already stored and returned
      // without doing anything, while the tools went on describing the page the
      // user had left.
      registered = [];
      reported = [
        { level: 'error', code: 'remap-failed', message: `remap failed: ${String(err)}` },
      ];
      throw err;
    }

    lastSnapshot = current;
    registered = result.tools;
    // Replaced, never appended: these describe the page as it is now, and a
    // single-page app remaps on every route change.
    reported = result.diagnostics;

    for (const tool of result.tools) {
      // Not awaited. The registerTool promise is not on the critical path, and an
      // agent that has not connected yet must not hold up the page.
      void api.registerTool(
        {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          execute: (args: Record<string, unknown>) => tool.execute(args ?? {}),
        },
        { signal: controller.signal }
      );
    }
  }

  const teardown: Array<() => void> = [];
  if (options.watch !== false) {
    // The watcher fires from a timer, where nothing is waiting on the promise.
    // Handing `refresh` over directly turned every failed remap into an
    // unhandled rejection in the host page. The diagnostic is already recorded
    // by then; this is what keeps the failure from escaping as a crash.
    const onChange = (): void => {
      void refresh().catch((err: unknown) => {
        console.warn('[agenticschema] remap failed:', err);
      });
    };
    teardown.push(watchPage(doc, onChange, debounceMs));
  }

  await refresh();

  return {
    // Copies. The typed signature says `readonly`, which settles it for
    // TypeScript, but this handle's main audience reaches it through a script
    // tag, from plain JavaScript, where nothing stops a caller from emptying the
    // adapter's own state.
    tools: () => [...registered],
    diagnostics: () => [...reported],
    refresh,
    stop: () => {
      stopped = true;
      controller?.abort();
      registered = [];
      reported = [];
      for (const off of teardown) off();
    },
  };
}

/**
 * In a single-page app the JSON-LD changes without a reload. Both signals are
 * needed: the DOM, because the framework rewrites the block, and the History
 * API, because the route can change before the new markup arrives.
 */
function watchPage(doc: Document, onChange: () => void, debounceMs: number): () => void {
  // These come from the document's own realm rather than globalThis. A Document
  // can belong to another window (an iframe, or happy-dom on Node) where the
  // host page's globals do not exist at all.
  const view = doc.defaultView;
  if (!view?.MutationObserver) return () => {};

  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (): void => {
    clearTimeout(timer);
    timer = setTimeout(onChange, debounceMs);
  };

  const observer = new view.MutationObserver((records) => {
    for (const record of records) {
      const touched = [
        ...record.addedNodes,
        ...record.removedNodes,
        ...(record.target ? [record.target] : []),
      ];
      if (touched.some(isStructuredDataNode)) {
        schedule();
        return;
      }
    }
  });
  observer.observe(doc.documentElement ?? doc, {
    childList: true,
    subtree: true,
    characterData: true,
    attributeFilter: ['itemscope', 'itemprop', 'itemtype', 'typeof', 'property'],
  });

  const history = view.history as History | undefined;
  const restore: Array<() => void> = [];
  if (history) {
    for (const method of ['pushState', 'replaceState'] as const) {
      const original = history[method];
      history[method] = function patched(this: History, ...args: Parameters<History['pushState']>) {
        const out = original.apply(this, args);
        schedule();
        return out;
      };
      restore.push(() => {
        history[method] = original;
      });
    }
  }
  view.addEventListener?.('popstate', schedule);

  return () => {
    clearTimeout(timer);
    observer.disconnect();
    for (const undo of restore) undo();
    view.removeEventListener?.('popstate', schedule);
  };
}

function isStructuredDataNode(node: Node): boolean {
  const element = node.nodeType === 1 ? (node as Element) : (node.parentElement as Element | null);
  if (!element) return false;
  if (element.tagName === 'SCRIPT') {
    return (element.getAttribute('type') ?? '').includes('ld+json');
  }
  return element.hasAttribute('itemscope') || element.hasAttribute('typeof');
}
