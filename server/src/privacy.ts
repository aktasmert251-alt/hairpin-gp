import { isIP } from 'node:net';
// IP minimisation (docs/legal/audit.md M6, D-050): raw IPs live only in memory (the socket, per-IP counters); logs, the
// audit file and the ban list see a salted SHA-256 of the network prefix (/24 for IPv4, /64 for IPv6) instead.
import { createHash, randomBytes } from 'node:crypto';

/** `1.2.3.4` → `1.2.3`; IPv6 → its first four hextets (expanded, lower case). Unknown shapes are returned as is. */
export function netPrefix(ip: string): string {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}`;
  if (!ip.includes(':')) return ip;
  const [head = '', tail = ''] = ip.split('%')[0]!.split('::');
  const h = head ? head.split(':') : [];
  const t = ip.includes('::') && tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return groups.slice(0, 4).map((g) => (parseInt(g, 16) || 0).toString(16)).join(':');
}

/** Salted SHA-256 of the network prefix, hex. */
export function netHash(ip: string, salt: string): string {
  return createHash('sha256').update(salt).update('\0').update(netPrefix(ip)).digest('hex');
}

/** Per-process salt for log lines: the same network gives the same tag until a restart, and cannot be looked up later. */
const LOG_SALT = randomBytes(16).toString('hex');

/** Short tag that replaces `ip` in log lines. */
export function logTag(ip: string): string {
  return netHash(ip, LOG_SALT).slice(0, 12);
}

// Display-only prefix (/24, /48) kept for tests and docs; logs use logTag().

/** Display-only network prefix. Logs use logTag(); full addresses remain in memory for abuse limits. */
export function truncateIp(address: string): string {
  const ip = address.split('%')[0]!;
  const version = isIP(ip);
  if (version === 4) return `${ip.slice(0, ip.lastIndexOf('.'))}.0/24`;
  if (version !== 6) return 'unknown';
  // Turn an embedded dotted IPv4 tail into two hextets before expanding ::.
  const hex = ip.replace(/(\d+\.\d+\.\d+\.\d+)$/, (tail) => {
    const b = tail.split('.').map(Number);
    return `${(b[0]! * 256 + b[1]!).toString(16)}:${(b[2]! * 256 + b[3]!).toString(16)}`;
  });
  const halves = hex.toLowerCase().split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const words = (halves.length === 2 ? [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right] : left).map((v) => parseInt(v, 16));
  if (words.slice(0, 5).every((v) => v === 0) && words[5] === 0xffff) {
    return `${words[6]! >> 8}.${words[6]! & 255}.${words[7]! >> 8}.0/24`;
  }
  return `${words.slice(0, 3).map((v) => v.toString(16)).join(':')}::/48`;
}
