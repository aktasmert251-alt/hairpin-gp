// Seeded noise buffers (audio.md §1): 2 s white and pink AudioBuffers from mulberry32 with a fixed seed, so live
// and offline renders are identical. Presentation layer; uses only BaseAudioContext APIs.

/** mulberry32 step: returns [0, 1). State lives in the caller's object. */
export function mulberry(state: { s: number }): number {
  state.s = (state.s + 0x6d2b79f5) | 0;
  let t = state.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export interface NoiseBuffers { white: AudioBuffer; pink: AudioBuffer }

export function createNoiseBuffers(ctx: BaseAudioContext, seed = 0x5eed): NoiseBuffers {
  const len = Math.round(ctx.sampleRate * 2);
  const white = ctx.createBuffer(1, len, ctx.sampleRate);
  const pink = ctx.createBuffer(1, len, ctx.sampleRate);
  const w = white.getChannelData(0);
  const p = pink.getChannelData(0);
  const st = { s: seed | 0 };
  // Paul Kellet's economy pink filter.
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) {
    const x = mulberry(st) * 2 - 1;
    w[i] = x;
    b0 = 0.99765 * b0 + x * 0.099046;
    b1 = 0.963 * b1 + x * 0.2965164;
    b2 = 0.57 * b2 + x * 1.0526913;
    p[i] = (b0 + b1 + b2 + x * 0.1848) * 0.25;
  }
  return { white, pink };
}
