// HTTP side of the one-process server: the built game (dist/) as static files, /health and the admin panel (/admin).
// Hardening (deploy doc §1.3, A.4 step 4): GET/HEAD only, path-traversal guard, no directory listing,
// no dotfiles, security headers on every response, HSTS only over TLS.
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isSecure, type TrustProxy } from './proxy';

const MAX_URL_LENGTH = 2048;
const HASHED_NAME = /-[\w-]{8}\.(js|css)(\.map)?$/;

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

/**
 * Security headers. CSP matches what the built game needs: its own scripts only, the inline <style> in
 * index.html, data:/blob: images and fonts (three.js, lil-gui), and WebSockets to the same host.
 */
/** `secure` = the page is https (real TLS or the trusted tunnel): its WebSocket is wss:. HSTS only with real TLS. */
export function securityHeaders(tls: boolean, secure = tls): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
      "font-src 'self' data:; media-src 'self' data: blob:; worker-src 'self' blob:; " +
      `connect-src 'self' https: ${secure ? 'wss:' : 'ws:'}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'none'`,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
  };
  if (tls) h['Strict-Transport-Security'] = 'max-age=31536000';
  return h;
}

/**
 * Maps a request URL to a file inside `root`, or null when it must not be served:
 * malformed encoding, NUL bytes, backslashes, any dot segment (`..`, `.env`, `.git`), or a result outside root.
 */
export function resolveSafePath(root: string, rawUrl: string): string | null {
  if (rawUrl.length > MAX_URL_LENGTH || !rawUrl.startsWith('/')) return null;
  const q = rawUrl.search(/[?#]/);
  let p: string;
  try {
    p = decodeURIComponent(q === -1 ? rawUrl : rawUrl.slice(0, q));
  } catch {
    return null;
  }
  if (p.includes('\0') || p.includes('\\')) return null;
  if (p.split('/').some((seg) => seg.startsWith('.'))) return null;
  if (p.endsWith('/')) p += 'index.html';
  const absRoot = path.resolve(root);
  const file = path.resolve(absRoot, '.' + p);
  const rel = path.relative(absRoot, file);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return file;
}

export interface HttpDeps {
  distDir: string;
  tls: boolean;
  /** Body of GET /health. */
  health: () => unknown;
  /** /admin and /admin/* (D-050); the admin module has its own headers, methods and API. */
  admin?: (req: IncomingMessage, res: ServerResponse) => void;
  contact?: (req: IncomingMessage, res: ServerResponse) => void;
  /** Never expose private server data, including when a caller nests it under distDir. */
  privateDir?: string;
  /** TRUST_PROXY (proxy.ts): https pages behind the local tunnel get the wss: CSP. */
  trustProxy?: TrustProxy;
}

export function isAdminPath(url: string): boolean {
  return url === '/admin' || url.startsWith('/admin/') || url.startsWith('/admin?');
}

function send(res: ServerResponse, status: number, headers: Record<string, string | number>, body: string, head: boolean): void {
  const buf = Buffer.from(body);
  res.writeHead(status, { ...headers, 'Content-Length': buf.length });
  res.end(head ? undefined : buf);
}

export function createRequestHandler(deps: HttpDeps): (req: IncomingMessage, res: ServerResponse) => void {
  const secPlain = securityHeaders(deps.tls);
  const secTunnel = securityHeaders(deps.tls, true);
  const trust = deps.trustProxy ?? 'none';
  const privateRoot = deps.privateDir ? path.resolve(deps.privateDir) : null;

  return (req, res) => {
    const sec = isSecure(req, deps.tls, trust) ? secTunnel : secPlain;
    const text = { ...sec, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' };
    const url = req.url ?? '/';
    const head = req.method === 'HEAD';
    if (deps.contact && url.split('?')[0] === '/api/contact') {
      deps.contact(req, res);
      return;
    }
    if (deps.admin && isAdminPath(url)) {
      deps.admin(req, res);
      return;
    }
    if (req.method !== 'GET' && !head) {
      send(res, 405, { ...text, Allow: 'GET, HEAD' }, 'Method Not Allowed\n', false);
      return;
    }
    if (url === '/health' || url.startsWith('/health?')) {
      send(res, 200, { ...sec, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, JSON.stringify(deps.health()), head);
      return;
    }
    const file = resolveSafePath(deps.distDir, url);
    if (!file) {
      send(res, 400, text, 'Bad Request\n', head);
      return;
    }
    if (privateRoot) {
      const relative = path.relative(privateRoot, file);
      if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
        send(res, 404, text, 'Not Found\n', head);
        return;
      }
    }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        send(res, 404, text, 'Not Found\n', head);
        return;
      }
      // Vite's content-hashed chunks (assets/<name>-<8 char hash>.js) never change; everything else
      // (index.html, public/ files such as assets/env/textures/*) is revalidated.
      const rel = path.relative(path.resolve(deps.distDir), file).split(path.sep);
      const hashed = rel.length === 2 && rel[0] === 'assets' && HASHED_NAME.test(rel[1]!);
      res.writeHead(200, {
        ...sec,
        'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
        'Last-Modified': st.mtime.toUTCString(),
      });
      if (head) {
        res.end();
        return;
      }
      const stream = fs.createReadStream(file);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    });
  };
}
