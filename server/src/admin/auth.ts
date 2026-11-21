// Login throttling and admin sessions (D-050). In memory only: a restart ends every session and clears lockouts.
import { createHash, randomBytes } from 'node:crypto';

export const AUTH = {
  /** Failures per key before the first lockout. */
  freeFails: 5,
  /** First lockout; doubles with every further failure up to maxLockMs. */
  baseLockMs: 60_000,
  maxLockMs: 3_600_000,
  /** All keys together: more than globalFails failures within globalWindowMs lock every login for globalLockMs. */
  globalFails: 30,
  globalWindowMs: 600_000,
  globalLockMs: 300_000,
  idleMs: 30 * 60_000,
  maxAgeMs: 8 * 3_600_000,
};
export type AuthConfig = typeof AUTH;

interface KeyState { fails: number; lockedUntil: number; lastFail: number }

/** Per-network failure counter with exponential backoff, plus a global cap against distributed guessing. */
export class LoginLimiter {
  private readonly keys = new Map<string, KeyState>();
  private globalFails: number[] = [];
  private globalLockedUntil = 0;

  constructor(
    private readonly cfg: AuthConfig,
    private readonly now: () => number,
  ) {}

  /** Milliseconds this key must still wait (0 = may try). */
  waitMs(key: string): number {
    const t = this.now();
    const k = this.keys.get(key);
    return Math.max(0, this.globalLockedUntil - t, (k?.lockedUntil ?? 0) - t);
  }

  /** Records a failure; returns the new lock length (0 = not locked). */
  fail(key: string): number {
    const t = this.now();
    let k = this.keys.get(key);
    if (!k) {
      if (this.keys.size >= 10_000) this.keys.clear();
      k = { fails: 0, lockedUntil: 0, lastFail: t };
      this.keys.set(key, k);
    }
    // A key that stayed quiet for maxLockMs starts over.
    if (t - k.lastFail >= this.cfg.maxLockMs) k.fails = 0;
    k.lastFail = t;
    k.fails++;
    let lock = 0;
    if (k.fails >= this.cfg.freeFails) {
      lock = Math.min(this.cfg.maxLockMs, this.cfg.baseLockMs * 2 ** (k.fails - this.cfg.freeFails));
      k.lockedUntil = t + lock;
    }
    this.globalFails = this.globalFails.filter((x) => t - x < this.cfg.globalWindowMs);
    this.globalFails.push(t);
    if (this.globalFails.length > this.cfg.globalFails) {
      this.globalLockedUntil = t + this.cfg.globalLockMs;
      lock = Math.max(lock, this.cfg.globalLockMs);
    }
    return lock;
  }

  success(key: string): void {
    this.keys.delete(key);
  }
}

export interface Session {
  csrf: string;
  createdAt: number;
  lastSeen: number;
  net: string;
}

const hashId = (id: string): string => createHash('sha256').update(id).digest('hex');

/** Session store keyed by sha256(cookie value), so a lookup never compares the secret itself. */
export class Sessions {
  private readonly map = new Map<string, Session>();

  constructor(
    private readonly cfg: AuthConfig,
    private readonly now: () => number,
  ) {}

  create(net: string): { id: string; session: Session } {
    const id = randomBytes(32).toString('base64url');
    const t = this.now();
    for (const [k, s] of this.map) if (t - s.lastSeen >= this.cfg.idleMs || t - s.createdAt >= this.cfg.maxAgeMs) this.map.delete(k);
    const session: Session = { csrf: randomBytes(32).toString('base64url'), createdAt: t, lastSeen: t, net };
    this.map.set(hashId(id), session);
    return { id, session };
  }

  /** The live session for a cookie value, or null (expired sessions are removed). `touch` extends the idle timer. */
  get(id: string | null, touch: boolean): Session | null {
    if (!id) return null;
    const key = hashId(id);
    const s = this.map.get(key);
    if (!s) return null;
    const t = this.now();
    if (t - s.lastSeen >= this.cfg.idleMs || t - s.createdAt >= this.cfg.maxAgeMs) {
      this.map.delete(key);
      return null;
    }
    if (touch) s.lastSeen = t;
    return s;
  }

  destroy(id: string | null): void {
    if (id) this.map.delete(hashId(id));
  }

  get size(): number {
    return this.map.size;
  }
}
