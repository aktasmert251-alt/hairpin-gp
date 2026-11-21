// Init scripts shared by Playwright fixtures (TypeScript) and scripts/perf.mjs (plain Node). Strings are injected with
// `context.addInitScript(...)` before any page script runs.

/**
 * The dev server is shared with agents who edit src/ all day; every edit makes Vite push a "full-reload" over its HMR WebSocket and
 * would reload the page in the middle of a test. A fake `vite-hmr` socket that never connects keeps the page stable.
 * Other WebSockets are untouched.
 */
export const BLOCK_VITE_HMR = `
(() => {
  const Native = window.WebSocket;
  const isVite = (protocols) => protocols === 'vite-hmr' || (Array.isArray(protocols) && protocols.includes('vite-hmr'));
  const Fake = function (url, protocols) {
    if (!isVite(protocols)) return protocols === undefined ? new Native(url) : new Native(url, protocols);
    const t = new EventTarget();
    t.readyState = 0; t.url = String(url); t.protocol = 'vite-hmr'; t.extensions = ''; t.bufferedAmount = 0; t.binaryType = 'blob';
    t.send = () => {}; t.close = () => {};
    return t;
  };
  Fake.prototype = Native.prototype;
  Fake.CONNECTING = 0; Fake.OPEN = 1; Fake.CLOSING = 2; Fake.CLOSED = 3;
  window.WebSocket = Fake;
})();
`;

/** Clears localStorage once per tab (a reload inside the test keeps persisted data); sessionStorage marks the tab as clean. */
export const RESET_STORAGE_ONCE = `
try {
  if (!window.sessionStorage.getItem('__apexTestClean')) {
    window.localStorage.clear();
    window.sessionStorage.setItem('__apexTestClean', '1');
  }
} catch (e) { /* storage unavailable */ }
`;
