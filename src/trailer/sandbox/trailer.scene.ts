// ?scene=trailer (Sprint 5b): the 30 s promo film, rendered from deterministic replays of the real sim.
// window.seek(t) renders film time t (awaitable); window.trailerReady = true once every clip, environment and the wordmark
// is loaded; window.trailerAudio(sr) returns the game audio as interleaved stereo. Space / ← → / R preview it.
// URL: &quality=ultra|high &t=<s> (initial frame). The film has no copy besides the wordmark (D-047).

import type { QualityId } from '../../contracts/common';
import type { SandboxScene } from '../../contracts/debug';
import { createSandboxAssets } from '../../graphics/sandbox/sandboxAssets';
import { DURATION, CUTS } from '../shots';
import { createTrailer } from '../trailer';

interface TrailerWindow {
  seek?: (t: number) => Promise<void>;
  trailerReady?: boolean;
  trailerStatus?: string;
  trailerInfo?: { duration: number; cuts: number[] };
  trailerAudio?: (sr: number) => Promise<string>;
}

const scene: SandboxScene = {
  id: 'trailer',
  title: 'Trailer',
  async create({ canvas, uiRoot, params }) {
    const w = window as unknown as TrailerWindow;
    const assets = createSandboxAssets();
    const trailer = await createTrailer({
      canvas, uiRoot, assets,
      quality: (params.get('quality') as QualityId | null) ?? 'ultra',
      onStatus: (s) => {
        w.trailerStatus = s;
      },
    });
    const t0 = Number(params.get('t') ?? 0);
    await trailer.seek(Number.isFinite(t0) ? t0 : 0);
    w.seek = trailer.seek;
    w.trailerInfo = { duration: DURATION, cuts: CUTS };
    w.trailerAudio = async (sr) => {
      const f = await trailer.renderAudio(sr);
      const bytes = new Uint8Array(f.buffer);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    };
    w.trailerReady = true;
    return {
      update: (dt) => trailer.update(dt),
      dispose() {
        trailer.dispose();
        assets.dispose();
      },
    };
  },
};

export default scene;
