// Ghost lap (YÖN glue-internal, sprint-2 §2): 20 Hz × 7 floats (px py pz fx fy fz speed) of lap-relative time,
// stored as base64 under STORAGE_KEYS.ghost(trackId). A 95 s lap ≈ 1,900 samples ≈ 53 KB raw → ≈ 71 KB base64 (I-05).

export const GHOST_HZ = 20;
export const GHOST_STRIDE = 7;
export const GHOST_ALPHA = 0.35;
/** The ghost fades to 0 within this distance of the player. */
export const GHOST_FADE_M = 8;
/** Longest recordable lap (the ≈ 20 km Eifel ring takes 4.5–7 min; 10 min ≈ 336 KB of buffer). */
const MAX_LAP_S = 600;

export interface GhostLap { samples: Float32Array; count: number; lapMs: number }

// ---- codec ----

export function encodeGhost(g: GhostLap): string {
  const header = new Float32Array([g.lapMs, g.count]);
  const body = g.samples.subarray(0, g.count * GHOST_STRIDE);
  const bytes = new Uint8Array(4 * (2 + body.length));
  bytes.set(new Uint8Array(header.buffer), 0);
  bytes.set(new Uint8Array(body.buffer, body.byteOffset, body.byteLength), 8);
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(bin);
}

export function decodeGhost(text: string): GhostLap | null {
  try {
    const bin = atob(text);
    if (bin.length < 8 || bin.length % 4 !== 0) return null;
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const f = new Float32Array(bytes.buffer);
    const lapMs = f[0]!;
    const count = Math.round(f[1]!);
    if (!(lapMs > 0) || count < 2 || f.length - 2 < count * GHOST_STRIDE) return null;
    return { samples: f.slice(2, 2 + count * GHOST_STRIDE), count, lapMs };
  } catch {
    return null;
  }
}

// ---- recorder ----

export interface GhostRecorder {
  /** Starts a new lap (drops everything recorded). */
  begin(): void;
  /** Records the pose if `lapMs` reached the next 20 Hz slot (call every tick). */
  sample(lapMs: number, px: number, py: number, pz: number, fx: number, fy: number, fz: number, speed: number): void;
  /** Flashback: drops samples after `lapMs`. */
  truncate(lapMs: number): void;
  /** Copies the recorded lap (null when nothing usable). */
  finish(lapMs: number): GhostLap | null;
  count(): number;
}

export function createGhostRecorder(): GhostRecorder {
  const cap = MAX_LAP_S * GHOST_HZ;
  const buf = new Float32Array(cap * GHOST_STRIDE);
  let n = 0;
  return {
    begin() {
      n = 0;
    },
    sample(lapMs, px, py, pz, fx, fy, fz, speed) {
      if (n >= cap || lapMs < (n * 1000) / GHOST_HZ) return;
      const o = n * GHOST_STRIDE;
      buf[o] = px; buf[o + 1] = py; buf[o + 2] = pz;
      buf[o + 3] = fx; buf[o + 4] = fy; buf[o + 5] = fz; buf[o + 6] = speed;
      n++;
    },
    truncate(lapMs) {
      const keep = Math.max(0, Math.floor((lapMs * GHOST_HZ) / 1000) + 1);
      if (keep < n) n = keep;
    },
    finish(lapMs) {
      if (n < 2) return null;
      return { samples: buf.slice(0, n * GHOST_STRIDE), count: n, lapMs };
    },
    count: () => n,
  };
}

// ---- player ----

export interface GhostPose { px: number; py: number; pz: number; fx: number; fy: number; fz: number; speed: number }

/** Interpolated pose at lap-relative `lapMs` (allocation-free); false when outside the lap. */
export function ghostPoseAt(g: GhostLap, lapMs: number, out: GhostPose): boolean {
  if (!(lapMs >= 0)) return false;
  const x = (lapMs * GHOST_HZ) / 1000;
  const i = Math.floor(x);
  if (i >= g.count - 1) return false;
  const t = x - i;
  const a = i * GHOST_STRIDE;
  const b = a + GHOST_STRIDE;
  const s = g.samples;
  out.px = s[a]! + (s[b]! - s[a]!) * t;
  out.py = s[a + 1]! + (s[b + 1]! - s[a + 1]!) * t;
  out.pz = s[a + 2]! + (s[b + 2]! - s[a + 2]!) * t;
  let fx = s[a + 3]! + (s[b + 3]! - s[a + 3]!) * t;
  let fy = s[a + 4]! + (s[b + 4]! - s[a + 4]!) * t;
  let fz = s[a + 5]! + (s[b + 5]! - s[a + 5]!) * t;
  const l = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
  fx /= l; fy /= l; fz /= l;
  out.fx = fx; out.fy = fy; out.fz = fz;
  out.speed = s[a + 6]! + (s[b + 6]! - s[a + 6]!) * t;
  return true;
}

/** Ghost alpha: GHOST_ALPHA, fading to 0 within GHOST_FADE_M of the player. */
export function ghostAlphaAt(distM: number): number {
  return GHOST_ALPHA * Math.min(1, Math.max(0, distM / GHOST_FADE_M));
}
