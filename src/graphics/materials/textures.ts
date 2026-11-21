// Procedural textures (generated once, cached, never downloaded): carbon twill (albedo + normal), metallic flake
// normal, trim swatches (colour + roughness/metalness),
// blob shadow (tyre/rim textures live in car/wheelAppearance.ts). Colour maps are SRGBColorSpace, data maps NoColorSpace (rendering.md §1).

import {
  CanvasTexture, ClampToEdgeWrapping, DataTexture, LinearFilter, LinearMipmapLinearFilter, NearestFilter, NoColorSpace, RGBAFormat,
  RepeatWrapping, SRGBColorSpace, type Texture, UnsignedByteType,
} from 'three';
import { TRIM_CELLS, TRIM_SWATCHES } from '../car/carModel';

const cache = new Map<string, Texture>();
let refs = 0;

function cached<T extends Texture>(key: string, make: () => T): T {
  const hit = cache.get(key);
  if (hit) return hit as T;
  const t = make();
  t.name = `apex.${key}`;
  cache.set(key, t);
  return t;
}

/** Called by every system that uses shared textures; release() disposes them with the last user. */
export function retainTextures(): void {
  refs++;
}

export function releaseTextures(): void {
  refs = Math.max(0, refs - 1);
  if (refs > 0) return;
  for (const t of cache.values()) t.dispose();
  cache.clear();
}

export function textureBytes(): number {
  let b = 0;
  for (const t of cache.values()) {
    const img = t.image as { width?: number; height?: number } | null;
    if (img?.width && img.height) b += img.width * img.height * 4 * (t.generateMipmaps ? 1.33 : 1);
  }
  return b;
}

const hash = (x: number, y: number, s: number): number => {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

function dataTex(data: Uint8Array, w: number, h: number, srgb: boolean, repeat: boolean, mip = true): DataTexture {
  const t = new DataTexture(data, w, h, RGBAFormat, UnsignedByteType);
  t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  t.wrapS = t.wrapT = repeat ? RepeatWrapping : ClampToEdgeWrapping;
  t.generateMipmaps = mip;
  t.minFilter = mip ? LinearMipmapLinearFilter : LinearFilter;
  t.magFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** 2×2 twill height field (0..1) on a 256² tile; 8 tows per tile → one repeat = 0.08 m of model space. */
function twillHeight(x: number, y: number, size: number): number {
  const tows = 8;
  const cell = size / tows;
  const cx = Math.floor(x / cell);
  const cy = Math.floor(y / cell);
  const fx = (x % cell) / cell;
  const fy = (y % cell) / cell;
  // 2×2 twill: warp over two, under two, shifted by one each row.
  const warpOnTop = ((cx + cy) & 3) < 2;
  const across = warpOnTop ? fx : fy; // across the tow
  const along = warpOnTop ? fy : fx;
  const bump = Math.sin(across * Math.PI) ** 0.6;
  return (warpOnTop ? 1 : 0.85) * bump * (0.85 + 0.15 * Math.sin(along * Math.PI));
}

export function carbonTextures(): { albedo: DataTexture; normal: DataTexture } {
  const size = 256;
  const albedo = cached('carbon.albedo', () => {
    const d = new Uint8Array(size * size * 4);
    const a = [0x12, 0x14, 0x17];
    const b = [0x1b, 0x1e, 0x22];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const h = twillHeight(x, y, size);
        const n = (hash(x, y, 3) - 0.5) * 3;
        const i = (y * size + x) * 4;
        for (let c = 0; c < 3; c++) d[i + c] = Math.max(0, Math.min(255, a[c]! + (b[c]! - a[c]!) * h + n));
        d[i + 3] = 255;
      }
    }
    return dataTex(d, size, size, true, true);
  });
  const normal = cached('carbon.normal', () => {
    const d = new Uint8Array(size * size * 4);
    const hgt = (x: number, y: number): number => twillHeight((x + size) % size, (y + size) % size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (hgt(x + 1, y) - hgt(x - 1, y)) * 2.2;
        const dy = (hgt(x, y + 1) - hgt(x, y - 1)) * 2.2;
        const l = Math.hypot(dx, dy, 1);
        const i = (y * size + x) * 4;
        d[i] = Math.round((-dx / l * 0.5 + 0.5) * 255);
        d[i + 1] = Math.round((-dy / l * 0.5 + 0.5) * 255);
        d[i + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
        d[i + 3] = 255;
      }
    }
    return dataTex(d, size, size, false, true);
  });
  return { albedo, normal };
}

/** Metallic flake normal 256² (random micro-facets), tiled 40×. */
export function flakeNormal(): DataTexture {
  return cached('flake.normal', () => {
    const size = 256;
    const d = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const cx = x >> 1, cy = y >> 1;
        const a = hash(cx, cy, 11) * Math.PI * 2;
        const r = hash(cx, cy, 17) * 0.6;
        const nx = Math.cos(a) * r, ny = Math.sin(a) * r;
        const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
        const i = (y * size + x) * 4;
        d[i] = Math.round((nx * 0.5 + 0.5) * 255);
        d[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        d[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
        d[i + 3] = 255;
      }
    }
    const t = dataTex(d, size, size, false, true);
    t.repeat.set(40, 40); // rendering.md §6: flake normal tiled 40×
    return t;
  });
}

/**
 * Trim swatches: colour (sRGB) and ORM (G roughness, B metalness), TRIM_CELLS × 16 rows, linear-filtered.
 * Every column is constant except the mirror-glass cell, which holds a static "reflected" gradient
 * (pale sky at the top, horizon band, dark track below) so static mirrors never read as flat boxes.
 */
export function trimTextures(): { map: DataTexture; orm: DataTexture } {
  const rows = 16;
  const mirrorCell = 4;
  const sky = [0x5d, 0x6b, 0x7a], horizon = [0x8a, 0x93, 0x9b], track = [0x16, 0x18, 0x1c];
  const map = cached('trim.map', () => {
    const d = new Uint8Array(TRIM_CELLS * rows * 4);
    for (let r = 0; r < rows; r++) {
      const v = (r + 0.5) / rows; // row 0 = v 0 (bottom)
      TRIM_SWATCHES.forEach(([hex], i) => {
        let c = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
        if (i === mirrorCell) {
          const t = v < 0.45 ? 0 : v < 0.52 ? 1 : 2;
          c = t === 0 ? track : t === 1 ? horizon : sky.map((x, k) => Math.round(x * (1.15 - 0.3 * v) + 0 * k));
        }
        d.set([c[0]!, c[1]!, c[2]!, 255], (r * TRIM_CELLS + i) * 4);
      });
    }
    return dataTex(d, TRIM_CELLS, rows, true, false, false);
  });
  const orm = cached('trim.orm', () => {
    const d = new Uint8Array(TRIM_CELLS * rows * 4);
    for (let r = 0; r < rows; r++) {
      TRIM_SWATCHES.forEach(([, rough, metal], i) => {
        d.set([255, Math.round(rough * 255), Math.round(metal * 255), 255], (r * TRIM_CELLS + i) * 4);
      });
    }
    return dataTex(d, TRIM_CELLS, rows, false, false, false);
  });
  return { map, orm };
}

/** Radial blob-shadow falloff 128² (alpha only, in R). */
export function blobTexture(): DataTexture {
  return cached('blob', () => {
    const s = 128;
    const d = new Uint8Array(s * s * 4);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const nx = (x + 0.5) / s * 2 - 1;
        const ny = (y + 0.5) / s * 2 - 1;
        // Rounded-rectangle distance (car footprint), soft edge.
        const q = Math.hypot(Math.max(0, Math.abs(nx) - 0.35), Math.max(0, Math.abs(ny) - 0.55)) / 0.45;
        const a = Math.max(0, 1 - q);
        const v = Math.round(a * a * (3 - 2 * a) * 255);
        d.set([v, v, v, 255], (y * s + x) * 4);
      }
    }
    return dataTex(d, s, s, false, false);
  });
}

/** Wraps a canvas as an sRGB texture with mipmaps and anisotropy. */
export function canvasTexture(c: HTMLCanvasElement, anisotropy: number): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = anisotropy;
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  return t;
}
