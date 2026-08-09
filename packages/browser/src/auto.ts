import { start, type Handle, type StartOptions } from './index.js';

export * from './index.js';

/**
 * Entry per il tag script. Si configura con i data-attribute:
 *
 *   <script src="https://cdn.jsdelivr.net/npm/@agenticschema/browser" defer
 *           data-actions="off" data-max-tools="12" data-watch="off"></script>
 */
function optionsFromScriptTag(): StartOptions {
  const script =
    (document.currentScript as HTMLScriptElement | null) ??
    document.querySelector<HTMLScriptElement>('script[data-agenticschema]');
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

/** Handle esposto per poter fermare o ispezionare l'adapter dalla console. */
export const ready: Promise<Handle> = start(optionsFromScriptTag());

// Un errore qui non deve rompere la pagina ospite.
void ready.catch((err: unknown) => {
  console.warn('[agenticschema] avvio fallito:', err);
});
