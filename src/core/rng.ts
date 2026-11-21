// Seeded RNG for the sim: mulberry32 whose whole state is one int32 stored in SimState (sim-safe, allocation-free).
//
// Usage: `const u = nextRandom(state.rng, 'race');` advances state.rng.race and returns a float in [0, 1).

/** Advances a mulberry32 state. */
export function rngStep(s: number): number {
  return (s + 0x6d2b79f5) | 0;
}

/** Maps an (already advanced) mulberry32 state to a float in [0, 1). */
export function rngOut(s: number): number {
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Advances `holder[key]` and returns a float in [0, 1). */
export function nextRandom<K extends string>(holder: Record<K, number>, key: K): number {
  const s = rngStep(holder[key]);
  holder[key] = s;
  return rngOut(s);
}

export function nextRange<K extends string>(holder: Record<K, number>, key: K, lo: number, hi: number): number {
  return lo + (hi - lo) * nextRandom(holder, key);
}

/** Integer in [lo, hi] inclusive. */
export function nextInt<K extends string>(holder: Record<K, number>, key: K, lo: number, hi: number): number {
  return lo + Math.floor(nextRandom(holder, key) * (hi - lo + 1));
}

/** Standard normal sample (Box-Muller, two draws, no cached spare so the state stays a single number). */
export function nextNormal<K extends string>(holder: Record<K, number>, key: K): number {
  let u = nextRandom(holder, key);
  if (u < 1e-12) u = 1e-12;
  const v = nextRandom(holder, key);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Derives an independent int32 stream seed from a session seed and a stream id (splitmix-style mixing). */
export function seedStream(seed: number, stream: number): number {
  let h = (seed | 0) ^ Math.imul(stream + 1, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) | 0;
}

/** Small closure-based generator for setup code and tests (allocates once). */
export interface Rng { state: number; next(): number; range(lo: number, hi: number): number; int(lo: number, hi: number): number }

export function createRng(seed: number): Rng {
  const r: Rng = {
    state: seed | 0,
    next() {
      r.state = rngStep(r.state);
      return rngOut(r.state);
    },
    range(lo, hi) {
      return lo + (hi - lo) * r.next();
    },
    int(lo, hi) {
      return lo + Math.floor(r.next() * (hi - lo + 1));
    },
  };
  return r;
}
