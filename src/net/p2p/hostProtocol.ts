// D-064: messages between the host page and its room worker (hostWorker.ts), and the small side channel ('ctl' data channel)
// from the host page to every guest page. Game traffic never uses these: it is the unchanged online protocol on the 'game' channel.

export type HostWorkerMsg =
  | { t: 'attach'; label: string; port: MessagePort }
  | { t: 'stats'; label: string; pingMs: number; buffered: number }
  | { t: 'end' };

/** Host → guest side channel: the host tab is hidden (`paused`) / visible again, or the host closed the room (`bye`). */
export type HostCtlMsg = { t: 'paused'; v: boolean } | { t: 'bye' };

export function parseCtl(raw: unknown): HostCtlMsg | null {
  if (typeof raw !== 'string' || raw.length > 64) return null;
  try {
    const m = JSON.parse(raw) as { t?: unknown; v?: unknown };
    if (m.t === 'bye') return { t: 'bye' };
    if (m.t === 'paused' && typeof m.v === 'boolean') return { t: 'paused', v: m.v };
  } catch {
    /* not JSON */
  }
  return null;
}
