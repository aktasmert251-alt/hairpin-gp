// Build identity (vite.config `define`): keys caches of build-dependent data (rival ghost) and replay headers.
// Node / vitest runs have no define and report 'dev'.

declare const __APEX_BUILD__: string | undefined;

export const BUILD_HASH: string = typeof __APEX_BUILD__ === 'string' ? __APEX_BUILD__ : 'dev';
