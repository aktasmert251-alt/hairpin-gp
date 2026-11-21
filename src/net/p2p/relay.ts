// D-064 optional signaling relay client (p2p-signal/ worker, deployed by the user; P2P_SIGNAL_URL empty = not used).
// Mailbox keys: `<DISPLAY>-o` = the host's current open invite, `<DISPLAY>-a<slot>` = a guest's answer. Values are the same
// codes as the manual copy-paste flow, so the relay only saves the copying; it never sees game traffic.
import { isDisplayCode } from './signal';

// Writes carry a random per-page owner token (memory only, never stored or logged by the game): the mailbox binds each key to
// its first writer, so someone who learns a room code cannot replace the host's invite or a guest's answer.
export const RELAY_KEY_RE = /^[A-HJ-NP-Z2-9]{6}-(o|a\d{1,2})$/;
/** A hung request must not pile up behind the 2 s answer poll. */
export const RELAY_TIMEOUT_MS = 8000;

export const offerKey = (display: string): string => `${display}-o`;
export const answerKey = (display: string, slot: number): string => `${display}-a${slot}`;

let owner = '';
function ownerToken(): string {
  if (!owner) {
    const b = crypto.getRandomValues(new Uint8Array(24));
    owner = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  return owner;
}

function url(base: string, key: string): string {
  if (!RELAY_KEY_RE.test(key)) throw new Error('bad relay key');
  return `${base.replace(/\/+$/, '')}/m/${key}`;
}

export async function relayPut(base: string, key: string, value: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const r = await fetchFn(url(base, key), {
      method: 'PUT',
      body: value,
      headers: { 'content-type': 'text/plain', 'x-hp-owner': ownerToken() },
      signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** The stored value, or null (absent / expired / unreachable). */
export async function relayGet(base: string, key: string, fetchFn: typeof fetch = fetch): Promise<string | null> {
  try {
    const r = await fetchFn(url(base, key), { method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(RELAY_TIMEOUT_MS) });
    return r.ok ? await r.text() : null;
  } catch {
    return null;
  }
}

/** A 6-character display code typed into the invite field (relay mode) instead of a full invite. */
export function relayCodeInput(raw: string): string | null {
  const v = raw.trim().toUpperCase();
  return isDisplayCode(v) ? v : null;
}
