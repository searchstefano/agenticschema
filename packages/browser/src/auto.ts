import { start, type Handle, type StartOptions } from './index.js';

export * from './index.js';

/**
 * The script-tag entry point. Configured through data attributes:
 *
 *   <script src="https://cdn.jsdelivr.net/npm/@agenticschema/browser" defer
 *           data-actions="off" data-max-tools="12" data-watch="off"></script>
 */
function optionsFromScriptTag(): StartOptions {
  // `currentScript` is null in a module script, and the CDN snippet is a module
  // script, so on a real page one of the fallbacks is always what runs. Matching
  // on the src keeps the plain snippet configurable; `data-agenticschema` stays
  // for self-hosted builds, whose filename this cannot guess.
  const script =
    (document.currentScript as HTMLScriptElement | null) ??
    document.querySelector<HTMLScriptElement>('script[data-agenticschema]') ??
    document.querySelector<HTMLScriptElement>('script[src*="agenticschema"]');
  const data = script?.dataset ?? {};

  const maxTools = Number(data['maxTools']);
  return {
    ...(data['actions'] === 'off' ? { actions: 'off' as const } : {}),
    ...(Number.isFinite(maxTools) && maxTools > 0 ? { maxTools } : {}),
    ...(data['watch'] === 'off' ? { watch: false } : {}),
    ...(data['allowHosts']
      ? { allowedHosts: data['allowHosts'].split(',').map((h) => h.trim()) }
      : {}),
  };
}

/** Exposed so the adapter can be stopped or inspected from the console. */
export const ready: Promise<Handle> = start(optionsFromScriptTag());

// Whatever goes wrong here, it must not take the host page down with it.
void ready.catch((err: unknown) => {
  console.warn('[agenticschema] failed to start:', err);
});
