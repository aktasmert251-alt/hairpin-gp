// D-064 invite links: the host shares `<page url>#join=<invite code>` instead of a 700-character code that breaks in chat apps.
// The URL fragment is never sent to a server. The code only holds URL-safe characters (A-Z a-z 0-9 - _ and the "." after HP1I),
// so it goes into the link unmodified. Pure helpers plus a tiny "pending invite" hand-over from page load to the Online screen.
import { ANSWER_PREFIX, INVITE_PREFIX, normalizeCode } from './signal';
import { MAX_CODE_CHARS } from './config';

const JOIN_KEY = 'join=';

/** `<base>#join=<code>`; base defaults to this page without query / fragment (works under a sub-path such as /hairpin-gp/). */
export function buildInviteLink(code: string, base: string = `${location.origin}${location.pathname}`): string {
  return `${base.replace(/#.*$/, '')}#${JOIN_KEY}${code}`;
}

function decodeOnce(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** The invite code a URL hash carries (`#join=HP1I.…`, or a hash that is directly the code), else null. */
export function parseInviteHash(hash: string): string | null {
  let h = hash.trim().replace(/^#/, '');
  if (h.toLowerCase().startsWith(JOIN_KEY)) h = h.slice(JOIN_KEY.length);
  // A chat app or a second encoding pass may have percent-encoded the code once or twice.
  for (let i = 0; i < 2 && h.includes('%'); i++) h = decodeOnce(h);
  const code = normalizeCode(h);
  if (!code.startsWith(INVITE_PREFIX)) return null;
  const body = /^[A-Za-z0-9_-]*/.exec(code.slice(INVITE_PREFIX.length))![0];
  if (!body || body.length > MAX_CODE_CHARS) return null;
  // Anything after the code (a stray "&utm=…" a messenger appended) is dropped: the zlib checksum is checked on decoding.
  return INVITE_PREFIX + body;
}

let pending: string | null = null;

/** Remembers the invite from the page URL until the Online screen takes it. */
export function setPendingInvite(code: string | null): void {
  pending = code;
}

/** Returns the pending invite once (then null). */
export function takePendingInvite(): string | null {
  const c = pending;
  pending = null;
  return c;
}

export function hasPendingInvite(): boolean {
  return pending !== null;
}

/** wa.me deep link with a prefilled message (opens WhatsApp on phones and WhatsApp Web / the desktop app elsewhere). */
export function whatsAppUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

// ---- answer links (guest -> host) -------------------------------------------------------------------------------------------
// The guest sends `<page url>#answer=<answer code>`. When the host opens it in the browser that runs the room, the new tab hands
// the code to the room tab over a BroadcastChannel (same browser, same origin) and nothing has to be pasted.

const ANSWER_KEY = 'answer=';
/** BroadcastChannel name shared by the room tab and an answer-link tab. */
export const P2P_HANDOFF_CHANNEL = 'hairpin-gp-p2p';
export type HandoffMsg =
  | { t: 'answer'; id: string; code: string }
  | { t: 'ack'; id: string; ok: boolean; error: string | null };

export function buildAnswerLink(code: string, base: string = `${location.origin}${location.pathname}`): string {
  return `${base.replace(/#.*$/, '')}#${ANSWER_KEY}${code}`;
}

/** The answer code an `#answer=HP1A.…` hash carries, else null. */
export function parseAnswerHash(hash: string): string | null {
  let h = hash.trim().replace(/^#/, '');
  if (h.toLowerCase().startsWith(ANSWER_KEY)) h = h.slice(ANSWER_KEY.length);
  for (let i = 0; i < 2 && h.includes('%'); i++) h = decodeOnce(h);
  const code = normalizeCode(h);
  if (!code.startsWith(ANSWER_PREFIX)) return null;
  const body = /^[A-Za-z0-9_-]*/.exec(code.slice(ANSWER_PREFIX.length))![0];
  if (!body || body.length > MAX_CODE_CHARS) return null;
  return ANSWER_PREFIX + body;
}