// Replay codec (CR-01, L8): 'APXR' magic, u32 header length, JSON header (everything but the float arrays, padded
// to 4 bytes), then the raw little-endian Float32 car and global arrays.

import type { ReplayData } from '../../contracts/replay';

const MAGIC = 0x52585041; // 'APXR' little-endian

type Header = Omit<ReplayData, 'cars' | 'global'> & { carsLen: number; globalLen: number };

export function encodeReplay(d: ReplayData): ArrayBuffer {
  const { cars, global, ...rest } = d;
  const header: Header = { ...rest, carsLen: cars.length, globalLen: global.length };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const hLen = (json.length + 3) & ~3;
  const buf = new ArrayBuffer(8 + hLen + 4 * (cars.length + global.length));
  const dv = new DataView(buf);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, hLen, true);
  const u8 = new Uint8Array(buf);
  u8.fill(0x20, 8, 8 + hLen);
  u8.set(json, 8);
  new Float32Array(buf, 8 + hLen, cars.length).set(cars);
  new Float32Array(buf, 8 + hLen + 4 * cars.length, global.length).set(global);
  return buf;
}

export function decodeReplay(b: ArrayBuffer): ReplayData {
  const dv = new DataView(b);
  if (b.byteLength < 8 || dv.getUint32(0, true) !== MAGIC) throw new Error('[replay] not an APEX GP replay');
  const hLen = dv.getUint32(4, true);
  const { carsLen, globalLen, ...rest } = JSON.parse(new TextDecoder().decode(new Uint8Array(b, 8, hLen))) as Header;
  if (rest.version !== 1) throw new Error(`[replay] unsupported version ${String(rest.version)}`);
  const cars = new Float32Array(b.slice(8 + hLen, 8 + hLen + 4 * carsLen));
  const global = new Float32Array(b.slice(8 + hLen + 4 * carsLen, 8 + hLen + 4 * (carsLen + globalLen)));
  return { ...rest, cars, global };
}
