// Ambient typing of window.__APEX__ for page.evaluate callbacks in the E2E specs.
export {};
declare global {
  interface Window { __APEX__: import('../../src/contracts/debug').ApexDebugApi }
}
