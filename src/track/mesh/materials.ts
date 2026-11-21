// Track surface materials (Ç4, merged in S2-Ç1). All built by the shared env chunk (materials/shared.ts) and compile to
// the single `opaque` env program. UV convention u = s (m), v = d (m); per-vertex data in `aApx` (see EnvMode).

import type { Material, MeshStandardMaterial } from 'three';
import { envMaterial, EnvMode, type EnvShared } from '../materials/shared';
import type { EnvTextures } from './textures';

export { GLSL_NOISE } from '../materials/shared';

export interface TrackMaterials {
  asphalt: MeshStandardMaterial;
  markings: MeshStandardMaterial;
  verge: MeshStandardMaterial;
  gravel: MeshStandardMaterial;
  concrete: MeshStandardMaterial;
  all(): Material[];
  dispose(): void;
}

function scaled<T extends { repeat: { set(x: number, y: number): void } }>(t: T, metres: number): T {
  t.repeat.set(1 / metres, 1 / metres);
  return t;
}

/** green: parkland theme (fewer dry patches on the verges); seaside: blue / white kerbs and painted run-off. */
export function createTrackMaterials(tx: EnvTextures, sh: EnvShared, green = false, seaside = false): TrackMaterials {
  // Asphalt family: track (aApx.x 0), run-off (1), pit lane (2), painted run-off (3).
  const asphalt = envMaterial(sh, {
    name: 'track.asphalt', family: 'opaque', mode: EnvMode.Asphalt, wet: 1,
    map: scaled(tx.asphalt.map, 7), normalMap: scaled(tx.asphalt.normal, 7), roughnessMap: scaled(tx.asphalt.rough, 7),
    roughness: 1, normalScale: 0.7, color: 0xf2ebe0, param: seaside ? 1 : 0,
  });
  asphalt.color.setRGB(0.95, 0.92, 0.88);
  // Markings: white paint (0), flat kerb red/white (1), sausage kerb yellow (2), chequer (3), team box lines (4).
  const markings = envMaterial(sh, {
    name: 'track.markings', family: 'opaque', mode: EnvMode.Markings, wet: 1, vertexColor: false,
    map: tx.asphalt.map, normalMap: tx.asphalt.normal, roughness: 0.62, normalScale: 0.35, polygonOffset: -1, param: seaside ? 1 : 0,
  });
  // Verge: grass (aApx.x 0) / astroturf (1).
  const verge = envMaterial(sh, {
    name: 'track.verge', family: 'opaque', mode: EnvMode.Verge, wet: 0.7,
    map: scaled(tx.grassGreen.map, 4.5), roughness: 0.95, texA: tx.grassDry.map, param: green ? 1 : 0,
  });
  verge.color.setRGB(0.9, 0.95, 0.85);
  const gravel = envMaterial(sh, {
    name: 'track.gravel', family: 'opaque', wet: 0.6,
    map: scaled(tx.gravel.map, 2.6), normalMap: scaled(tx.gravel.normal, 2.6), roughness: 1, normalScale: 1.1,
  });
  gravel.color.setRGB(1.02, 0.95, 0.82);
  const concrete = envMaterial(sh, {
    name: 'track.concrete', family: 'opaque', wet: 0.9,
    map: scaled(tx.concrete.map, 4), normalMap: scaled(tx.concrete.normal, 4), roughnessMap: scaled(tx.concrete.rough, 4), roughness: 1,
  });
  concrete.color.setRGB(0.62, 0.61, 0.6);

  const list: Material[] = [asphalt, markings, verge, gravel, concrete];
  return {
    asphalt, markings, verge, gravel, concrete,
    all: () => list,
    dispose() {
      for (const m of list) m.dispose();
    },
  };
}
