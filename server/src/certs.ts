// TLS material from <certDir>/{key.pem,cert.pem} (acme.sh --install-cert target, deploy doc §1.2 step 3).
// Renewals rewrite the files; watchCerts() reloads them into the running server with setSecureContext (no restart).
import { X509Certificate } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Server as HttpsServer } from 'node:https';

export interface CertFiles {
  key: Buffer;
  cert: Buffer;
  /** Leaf certificate expiry (X509 validTo string). */
  validTo: string;
}

export function certPaths(certDir: string): { keyFile: string; certFile: string } {
  return { keyFile: path.join(certDir, 'key.pem'), certFile: path.join(certDir, 'cert.pem') };
}

/** Whole days until expiry (negative once expired). */
export function daysUntil(validTo: string, nowMs = Date.now()): number {
  return Math.floor((Date.parse(validTo) - nowMs) / 86_400_000);
}

/** Null when either file is missing (then the server runs plain HTTP). Throws on unreadable or invalid PEM. */
export function loadCerts(certDir: string): CertFiles | null {
  const { keyFile, certFile } = certPaths(certDir);
  if (!fs.existsSync(keyFile) || !fs.existsSync(certFile)) return null;
  const key = fs.readFileSync(keyFile);
  const cert = fs.readFileSync(certFile);
  // The first certificate in the full chain is the leaf.
  const leaf = new X509Certificate(cert);
  return { key, cert, validTo: leaf.validTo };
}

/**
 * Polls the two files (fs.watchFile survives the delete+create that cert tools do) and swaps the
 * secure context when they change. A bad pair is logged and the old context stays in use.
 */
export function watchCerts(
  server: HttpsServer,
  certDir: string,
  onReload: (certs: CertFiles) => void,
  log: (event: string, data?: Record<string, unknown>) => void,
): () => void {
  const { keyFile, certFile } = certPaths(certDir);
  let pending: NodeJS.Timeout | null = null;
  const reload = (): void => {
    pending = null;
    try {
      const certs = loadCerts(certDir);
      if (!certs) return;
      server.setSecureContext({ key: certs.key, cert: certs.cert });
      onReload(certs);
      log('certReloaded', { daysLeft: daysUntil(certs.validTo) });
    } catch (err) {
      log('certReloadFailed', { error: String(err) });
    }
  };
  // Key and cert are written one after the other; wait for both before reloading.
  const onChange = (): void => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(reload, 2000);
  };
  const opts = { interval: 30_000, persistent: false };
  fs.watchFile(keyFile, opts, onChange);
  fs.watchFile(certFile, opts, onChange);
  return () => {
    if (pending) clearTimeout(pending);
    fs.unwatchFile(keyFile, onChange);
    fs.unwatchFile(certFile, onChange);
  };
}
