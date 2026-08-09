import { extract, toTools, type PipelineOptions, type ToolDescriptor } from '@agenticschema/core';

/**
 * Sottoinsieme di WebMCP che serve qui.
 *
 * Volutamente NON dichiara `getTools()` né `executeTool()`: sono API lato agente
 * e non risolvono se nessun agente è connesso. Awaitarle bloccherebbe l'init su
 * ogni pagina, quindi l'adapter tiene un registro proprio.
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
  /** Default: il `document` della pagina. */
  document?: Document;
  /** Segue i cambi di route e le modifiche al markup (SPA). Default: true. */
  watch?: boolean;
  /** Attesa prima di rimappare dopo una modifica al DOM. Default: 250 ms. */
  debounceMs?: number;
  /** Iniettabile nei test; altrimenti si usa `document.modelContext`. */
  modelContext?: ModelContext;
}

export interface Handle {
  /** Tool attualmente registrati. */
  tools(): readonly ToolDescriptor[];
  /** Rimappa la pagina adesso. No-op se il markup non è cambiato. */
  refresh(): Promise<void>;
  /** Deregistra tutto e smette di osservare. */
  stop(): void;
}

const POLYFILL = '@mcp-b/webmcp-polyfill';

type ProfileOptions = Pick<PipelineOptions, 'profiles' | 'ancestorsOf'>;
let profilesPromise: Promise<ProfileOptions> | undefined;

/**
 * I profili e la gerarchia Schema.org pesano più di tutto il resto messo insieme.
 * Restano un chunk a parte, caricato dopo che l'adapter è già in piedi: il costo
 * iniziale per una pagina che include lo script deve restare minimo.
 * Se il chunk non arriva si va avanti col profilo generico del core.
 */
function loadProfiles(): Promise<ProfileOptions> {
  profilesPromise ??= import('@agenticschema/profiles')
    .then((m) => m.schemaOrgProfiles as ProfileOptions)
    .catch(() => ({}) as ProfileOptions);
  return profilesPromise;
}

/**
 * Trova la superficie WebMCP.
 * `document.modelContext` è quella canonica; `navigator.modelContext` esiste come
 * alias deprecato. Se manca, si carica il polyfill: Chrome non abilita WebMCP di
 * default, quindi il polyfill è la norma, non l'eccezione.
 */
async function resolveApi(): Promise<ModelContext | undefined> {
  const find = (): ModelContext | undefined =>
    (globalThis as { document?: { modelContext?: ModelContext } }).document?.modelContext ??
    (globalThis as { navigator?: { modelContext?: ModelContext } }).navigator?.modelContext;

  const existing = find();
  if (existing) return existing;

  try {
    await import(/* @vite-ignore */ POLYFILL);
  } catch {
    return undefined;
  }
  return find();
}

export async function start(options: StartOptions = {}): Promise<Handle> {
  const doc = options.document ?? globalThis.document;
  if (!doc) throw new Error('agenticschema/browser richiede un document');

  const resolved = options.modelContext ?? (await resolveApi());
  if (!resolved) {
    // Nessun errore: un sito con lo script incluso non deve rompersi su un browser
    // che non supporta WebMCP e dove il polyfill non è caricabile.
    return { tools: () => [], refresh: async () => {}, stop: () => {} };
  }
  // Rilegato dopo la guardia: il restringimento non sopravvive dentro le closure.
  const api: ModelContext = resolved;

  const baseUrl = options.baseUrl ?? globalThis.location?.href;
  const debounceMs = options.debounceMs ?? 250;

  let controller: AbortController | undefined;
  let registered: ToolDescriptor[] = [];
  let lastSnapshot = '';
  let stopped = false;

  /**
   * Impronta del markup strutturato. Si confronta questa e non la firma dei tool:
   * se cambia solo un prezzo, nomi e description restano identici ma le closure
   * dei tool sono ormai vecchie e vanno ricostruite.
   */
  const snapshot = (): string => JSON.stringify(extract(doc, options).nodes);

  async function refresh(): Promise<void> {
    if (stopped) return;
    const current = snapshot();
    if (current === lastSnapshot) return;
    lastSnapshot = current;

    controller?.abort(); // unica via di deregistrazione: WebMCP non ha unregisterTool
    controller = new AbortController();

    const result = toTools(doc, {
      ...(await loadProfiles()),
      ...options,
      ...(baseUrl ? { baseUrl } : {}),
    });
    registered = result.tools;

    for (const tool of result.tools) {
      // Non awaitato: la promise di registerTool non è sulla strada critica e
      // un agente non ancora connesso non deve bloccare l'init della pagina.
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
  if (options.watch !== false) teardown.push(watchPage(doc, refresh, debounceMs));

  await refresh();

  return {
    tools: () => registered,
    refresh,
    stop: () => {
      stopped = true;
      controller?.abort();
      registered = [];
      for (const off of teardown) off();
    },
  };
}

/**
 * Nelle SPA il markup JSON-LD cambia senza ricaricare la pagina. Servono entrambi
 * i segnali: il DOM (il framework riscrive il blocco) e la History API (la route
 * cambia anche quando il markup arriva dopo).
 */
function watchPage(doc: Document, onChange: () => void, debounceMs: number): () => void {
  // Le API vanno prese dal realm del document, non da globalThis: un Document può
  // venire da un'altra finestra (iframe, o happy-dom lato Node), dove i globali
  // della pagina ospite non esistono affatto.
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
