// Online protocol codecs and validators (docs/design/multiplayer.md §7–§8, multiplayer-tasks §C, D-043).
// Shared by the client (src/net, src/game/net) and the server (server/**): pure TS, no DOM, no three, no clocks
// (arch: classed as sim layer). Binary messages are little-endian via DataView; the binary codecs are allocation-free
// (they read into / write from caller-owned objects). JSON control messages are parsed with strict hand-written schemas:
// unknown types, unknown keys, wrong types or out-of-range values → null (the server answers error{code:'badMessage'}).

import type { Compound, TimeOfDay, WeatherPreset } from '../contracts/common';
import { NET_STATE_BYTES } from '../contracts/net';
import type {
  NetCarState, NetClientMsg, NetContact, NetErrorCode, NetLimits, NetPlayerInfo, NetRaceConfig, NetReportKind, NetResultRow, NetRoomPhase,
  NetRoomSettings, NetRoomListing, NetRosterEntry, NetServerMsg, NetCustomTeam, NetCustomTeamEntry, NetRaceMode,
} from '../contracts/net';
import { parseCustomTeam } from '../data/customTeams';
import type { CarRaceState, PenaltyReason } from '../contracts/race';
import type { TrackData } from '../contracts/track';
import { TEAMS } from '../data/teams';
import { RACE_TRACKS } from '../data/tracks';

// ---- message codes, sizes, flags -------------------------------------------------------------------------------------------

export const MSG_PING = 0x01;
export const MSG_PONG = 0x02;
export const MSG_STATE = 0x10;
export const MSG_CONTACT = 0x11;
export const MSG_STATES = 0x90;
export const MSG_CONTACT_RELAY = 0x91;

export const PING_BYTES = 12;
export const PONG_BYTES = 20;
export const CONTACT_BYTES = 28;
export const BATCH_HEADER_BYTES = 8;

/** `state` flags byte (design §8.2). */
export const NET_FLAG_PIT_LIMITER = 1;
export const NET_FLAG_DRS_OPEN = 2;
export const NET_FLAG_PIT_RIBBON = 4;
export const NET_FLAG_IN_PIT_BOX = 8;
export const NET_FLAG_RESET = 16;
export const NET_FLAG_WRONG_WAY = 32;
export const NET_FLAG_FINISHED = 64;
export const NET_FLAG_REVERSE = 128;

/** Id byte of batch entries and contacts: low 7 bits = NetId, bit 7 = server-sourced car (AI, D-043). */
export const NET_ID_SERVER_BIT = 0x80;
export const NET_ID_MAX = 127;

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const NET_LAPS: readonly NetRoomSettings['laps'][] = [1, 3, 5, 10];

/** Validation thresholds (design §6.2, §7). The server's validate/contact modules and every receiving client use these. */
export const NET_LIMITS: Readonly<NetLimits> = {
  maxCoordM: 20_000,
  maxSpeedMs: 105,
  hardSpeedMs: 150,
  teleportM: 50,
  displacementSlackM: 3,
  simAheadMs: 250,
  simLagMs: 3000,
  trackDeltaSM: 25,
  escapeM: 5,
  resetProgressM: 10,
  contactJMax: 15_000,
  contactWindowMs: 200,
  // P3c: one contact per 200 ms episode = 5/s per pair.
  contactsPerPairPerS: 5,
  contactsPerPlayerPerS: 10,
  maxClientJsonBytes: 1024,
  // D-043: `load`/`results`/`standings` carry up to 20 cars (humans + AI), which does not fit the 1 KB client limit.
  maxServerJsonBytes: 16_384,
  maxBatchCars: 20,
  nameMin: 2,
  nameMax: 16,
  roomCodeLength: 5,
};

const COMPOUNDS: readonly Compound[] = ['soft', 'medium', 'hard', 'inter', 'wet'];
const MAX_PROGRESS_M = 1e7;
const U32_MAX = 4294967295;

export function batchBytes(count: number): number {
  return BATCH_HEADER_BYTES + NET_STATE_BYTES * count;
}

/** First byte of a binary message, or −1 when empty. */
export function messageType(dv: DataView): number {
  return dv.byteLength > 0 ? dv.getUint8(0) : -1;
}

/** A DataView over exactly the bytes of `u8` (Node Buffers share a larger ArrayBuffer). */
export function viewOf(u8: Uint8Array): DataView {
  return new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
}

export function newNetCarState(): NetCarState {
  return {
    id: 0, fromServer: false, flags: 0, seq: 0, simMs: 0, x: 0, y: 0, z: 0, progress: 0, yaw: 0, vx: 0, vz: 0, yawRate: 0,
    steerAngle: 0, throttle: 0, brake: 0, gear: 0, rpm: 0, drsFlap: 0, compound: 'medium', ersDeploying: false,
  };
}

export function newNetContact(): NetContact {
  return { other: 0, fromServer: false, seq: 0, simMs: 0, j: 0, nx: 0, nz: 0, px: 0, pz: 0, vRelN: 0, episode: 0 };
}

// ---- quantisation ----------------------------------------------------------------------------------------------------------

function clampInt(v: number, lo: number, hi: number): number {
  const r = Math.round(v);
  return r > hi ? hi : r < lo ? lo : r === r ? r : 0; // NaN → 0
}

/** Wraps to [−π, π). */
function wrapAngle(a: number): number {
  const TWO_PI = 2 * Math.PI;
  let w = a % TWO_PI;
  if (w >= Math.PI) w -= TWO_PI;
  else if (w < -Math.PI) w += TWO_PI;
  return w;
}

function idByte(id: number, fromServer: boolean): number {
  return (id & NET_ID_MAX) | (fromServer ? NET_ID_SERVER_BIT : 0);
}

// ---- 0x10 state / 0x90 batch -----------------------------------------------------------------------------------------------

/** Writes bytes o+1 … o+39 (everything but the type / id byte). */
function writeStateBody(dv: DataView, o: number, s: NetCarState): void {
  dv.setUint8(o + 1, s.flags & 0xff);
  dv.setUint16(o + 2, s.seq & 0xffff, true);
  dv.setUint32(o + 4, clampInt(s.simMs, 0, U32_MAX), true);
  dv.setFloat32(o + 8, s.x, true);
  dv.setFloat32(o + 12, s.y, true);
  dv.setFloat32(o + 16, s.z, true);
  dv.setFloat32(o + 20, s.progress, true);
  let yaw = Math.round((wrapAngle(s.yaw) * 32768) / Math.PI);
  if (yaw >= 32768) yaw -= 65536; // +π ≡ −π
  dv.setInt16(o + 24, yaw === yaw ? yaw : 0, true);
  dv.setInt16(o + 26, clampInt(s.vx * 100, -32768, 32767), true);
  dv.setInt16(o + 28, clampInt(s.vz * 100, -32768, 32767), true);
  dv.setInt16(o + 30, clampInt(s.yawRate * 1000, -32768, 32767), true);
  dv.setInt8(o + 32, clampInt(s.steerAngle * 300, -128, 127));
  dv.setUint8(o + 33, clampInt(s.throttle * 255, 0, 255));
  dv.setUint8(o + 34, clampInt(s.brake * 255, 0, 255));
  dv.setInt8(o + 35, clampInt(s.gear, -1, 8));
  dv.setUint16(o + 36, clampInt(s.rpm, 0, 65535), true);
  dv.setUint8(o + 38, clampInt(s.drsFlap * 255, 0, 255));
  const ci = COMPOUNDS.indexOf(s.compound);
  dv.setUint8(o + 39, (ci < 0 ? 1 : ci) | (s.ersDeploying ? 8 : 0));
}

/** Reads bytes o+1 … o+39 into `out`; false on non-finite / out-of-range values. */
function readStateBody(dv: DataView, o: number, out: NetCarState): boolean {
  const x = dv.getFloat32(o + 8, true);
  const y = dv.getFloat32(o + 12, true);
  const z = dv.getFloat32(o + 16, true);
  const progress = dv.getFloat32(o + 20, true);
  const lim = NET_LIMITS.maxCoordM;
  // `!(a <= b)` also rejects NaN.
  if (!(Math.abs(x) <= lim) || !(Math.abs(y) <= lim) || !(Math.abs(z) <= lim) || !(Math.abs(progress) <= MAX_PROGRESS_M)) return false;
  const gear = dv.getInt8(o + 35);
  if (gear < -1 || gear > 8) return false;
  const cb = dv.getUint8(o + 39);
  const ci = cb & 7;
  if (ci > 4 || (cb & 0xf0) !== 0) return false;
  out.flags = dv.getUint8(o + 1);
  out.seq = dv.getUint16(o + 2, true);
  out.simMs = dv.getUint32(o + 4, true);
  out.x = x;
  out.y = y;
  out.z = z;
  out.progress = progress;
  out.yaw = (dv.getInt16(o + 24, true) * Math.PI) / 32768;
  out.vx = dv.getInt16(o + 26, true) / 100;
  out.vz = dv.getInt16(o + 28, true) / 100;
  out.yawRate = dv.getInt16(o + 30, true) / 1000;
  out.steerAngle = dv.getInt8(o + 32) / 300;
  out.throttle = dv.getUint8(o + 33) / 255;
  out.brake = dv.getUint8(o + 34) / 255;
  out.gear = gear;
  out.rpm = dv.getUint16(o + 36, true);
  out.drsFlap = dv.getUint8(o + 38) / 255;
  out.compound = COMPOUNDS[ci]!;
  out.ersDeploying = (cb & 8) !== 0;
  return true;
}

/** Client → server `state` (0x10). `dv` needs ≥ 40 bytes from `o`. Returns the byte count. */
export function encodeState(s: NetCarState, dv: DataView, o = 0): number {
  dv.setUint8(o, MSG_STATE);
  writeStateBody(dv, o, s);
  return NET_STATE_BYTES;
}

/** Decodes a whole `state` message (exactly 40 bytes). `out.id/fromServer` are left untouched. */
export function decodeState(dv: DataView, out: NetCarState): boolean {
  if (dv.byteLength !== NET_STATE_BYTES || dv.getUint8(0) !== MSG_STATE) return false;
  return readStateBody(dv, 0, out);
}

export interface NetBatchHeader { count: number; serverSeq: number; serverMs: number }

/** Server → client `states` (0x90) header; entries follow with writeBatchEntry / copyStateToBatch. */
export function writeBatchHeader(dv: DataView, count: number, serverSeq: number, serverMs: number): number {
  dv.setUint8(0, MSG_STATES);
  dv.setUint8(1, count);
  dv.setUint16(2, serverSeq & 0xffff, true);
  dv.setUint32(4, clampInt(serverMs, 0, U32_MAX), true);
  return BATCH_HEADER_BYTES;
}

/** Encodes entry `k` from a state struct (server AI cars, D-043: `fromServer` = true). */
export function writeBatchEntry(dv: DataView, k: number, id: number, fromServer: boolean, s: NetCarState): void {
  const o = BATCH_HEADER_BYTES + k * NET_STATE_BYTES;
  dv.setUint8(o, idByte(id, fromServer));
  writeStateBody(dv, o, s);
}

/** Relays a validated client `state` (40 raw bytes) as entry `k`: byte 0 becomes the id byte, bytes 1…39 are copied. */
export function copyStateToBatch(state: Uint8Array, batch: Uint8Array, k: number, id: number, fromServer: boolean): void {
  const o = BATCH_HEADER_BYTES + k * NET_STATE_BYTES;
  batch[o] = idByte(id, fromServer);
  batch.set(state.subarray(1, NET_STATE_BYTES), o + 1);
}

/** Validates the batch frame (type, size = 8 + 40·count, count ≤ 20, unique ids) and reads the header. */
export function decodeBatchHeader(dv: DataView, out: NetBatchHeader): boolean {
  if (dv.byteLength < BATCH_HEADER_BYTES || dv.getUint8(0) !== MSG_STATES) return false;
  const count = dv.getUint8(1);
  if (count > NET_LIMITS.maxBatchCars || dv.byteLength !== batchBytes(count)) return false;
  let m0 = 0;
  let m1 = 0;
  let m2 = 0;
  let m3 = 0;
  for (let k = 0; k < count; k++) {
    const id = dv.getUint8(BATCH_HEADER_BYTES + k * NET_STATE_BYTES) & NET_ID_MAX;
    const bit = 1 << (id & 31);
    const w = id >> 5;
    const m = w === 0 ? m0 : w === 1 ? m1 : w === 2 ? m2 : m3;
    if ((m & bit) !== 0) return false;
    if (w === 0) m0 |= bit;
    else if (w === 1) m1 |= bit;
    else if (w === 2) m2 |= bit;
    else m3 |= bit;
  }
  out.count = count;
  out.serverSeq = dv.getUint16(2, true);
  out.serverMs = dv.getUint32(4, true);
  return true;
}

/** Reads entry `k` (call decodeBatchHeader first). Fills `out.id` / `out.fromServer`. */
export function decodeBatchEntry(dv: DataView, k: number, out: NetCarState): boolean {
  const o = BATCH_HEADER_BYTES + k * NET_STATE_BYTES;
  if (o + NET_STATE_BYTES > dv.byteLength) return false;
  const b = dv.getUint8(o);
  if (!readStateBody(dv, o, out)) return false;
  out.id = b & NET_ID_MAX;
  out.fromServer = (b & NET_ID_SERVER_BIT) !== 0;
  return true;
}

// ---- 0x11 / 0x91 contact ---------------------------------------------------------------------------------------------------

/** `type` = MSG_CONTACT (client → server, `other` = the hit car) or MSG_CONTACT_RELAY (server → client, `other` = the source). */
export function encodeContact(c: NetContact, type: typeof MSG_CONTACT | typeof MSG_CONTACT_RELAY, dv: DataView, o = 0): number {
  dv.setUint8(o, type);
  dv.setUint8(o + 1, idByte(c.other, c.fromServer));
  dv.setUint16(o + 2, c.seq & 0xffff, true);
  dv.setUint32(o + 4, clampInt(c.simMs, 0, U32_MAX), true);
  dv.setFloat32(o + 8, c.j, true);
  dv.setInt16(o + 12, clampInt(c.nx * 32767, -32767, 32767), true);
  dv.setInt16(o + 14, clampInt(c.nz * 32767, -32767, 32767), true);
  dv.setFloat32(o + 16, c.px, true);
  dv.setFloat32(o + 20, c.pz, true);
  dv.setInt16(o + 24, clampInt(c.vRelN * 100, -32768, 32767), true);
  dv.setUint16(o + 26, c.episode & 0xffff, true);
  return CONTACT_BYTES;
}

/** Exactly 28 bytes of `type`; j finite and ≥ 0, a unit normal (±5 %), a finite contact point inside the world bound. */
export function decodeContact(dv: DataView, type: typeof MSG_CONTACT | typeof MSG_CONTACT_RELAY, out: NetContact): boolean {
  if (dv.byteLength !== CONTACT_BYTES || dv.getUint8(0) !== type) return false;
  const j = dv.getFloat32(8, true);
  const nx = dv.getInt16(12, true) / 32767;
  const nz = dv.getInt16(14, true) / 32767;
  const px = dv.getFloat32(16, true);
  const pz = dv.getFloat32(20, true);
  const n2 = nx * nx + nz * nz;
  const lim = NET_LIMITS.maxCoordM;
  if (!(j >= 0 && j < Infinity) || !(n2 >= 0.9025 && n2 <= 1.1025) || !(Math.abs(px) <= lim) || !(Math.abs(pz) <= lim)) return false;
  const b = dv.getUint8(1);
  out.other = b & NET_ID_MAX;
  out.fromServer = (b & NET_ID_SERVER_BIT) !== 0;
  out.seq = dv.getUint16(2, true);
  out.simMs = dv.getUint32(4, true);
  out.j = j;
  out.nx = nx;
  out.nz = nz;
  out.px = px;
  out.pz = pz;
  out.vRelN = dv.getInt16(24, true) / 100;
  out.episode = dv.getUint16(26, true);
  return true;
}

// ---- 0x01 ping / 0x02 pong -------------------------------------------------------------------------------------------------

export interface NetPingMsg { seq: number; clientMs: number }
export interface NetPongMsg { seq: number; clientMs: number; serverMs: number }

export function encodePing(seq: number, clientMs: number, dv: DataView, o = 0): number {
  dv.setUint8(o, MSG_PING);
  dv.setUint8(o + 1, 0);
  dv.setUint16(o + 2, seq & 0xffff, true);
  dv.setFloat64(o + 4, clientMs, true);
  return PING_BYTES;
}

export function decodePing(dv: DataView, out: NetPingMsg): boolean {
  if (dv.byteLength !== PING_BYTES || dv.getUint8(0) !== MSG_PING) return false;
  const clientMs = dv.getFloat64(4, true);
  if (!Number.isFinite(clientMs)) return false;
  out.seq = dv.getUint16(2, true);
  out.clientMs = clientMs;
  return true;
}

export function encodePong(seq: number, clientMs: number, serverMs: number, dv: DataView, o = 0): number {
  dv.setUint8(o, MSG_PONG);
  dv.setUint8(o + 1, 0);
  dv.setUint16(o + 2, seq & 0xffff, true);
  dv.setFloat64(o + 4, clientMs, true);
  dv.setFloat64(o + 12, serverMs, true);
  return PONG_BYTES;
}

export function decodePong(dv: DataView, out: NetPongMsg): boolean {
  if (dv.byteLength !== PONG_BYTES || dv.getUint8(0) !== MSG_PONG) return false;
  const clientMs = dv.getFloat64(4, true);
  const serverMs = dv.getFloat64(12, true);
  if (!Number.isFinite(clientMs) || !Number.isFinite(serverMs)) return false;
  out.seq = dv.getUint16(2, true);
  out.clientMs = clientMs;
  out.serverMs = serverMs;
  return true;
}

/** u16 sequence comparison with wrap: true when `a` is newer than `b`. */
export function seqNewer(a: number, b: number): boolean {
  const d = (a - b) & 0xffff;
  return d !== 0 && d < 0x8000;
}

// ---- names and codes -------------------------------------------------------------------------------------------------------

const NAME_RE = /^[\p{L}\p{Nd} _.-]+$/u;
const ROOM_CODE_RE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{5}$`);

/**
 * Nickname rule (design §7.1): NFC-normalised and trimmed, 2–16 characters from letters (Turkish included), digits, space,
 * `_ - .`; control characters, bidi overrides and combining marks are rejected. Returns the normalised name or null.
 */
export function normalizeName(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 64) return null;
  const s = raw.normalize('NFC').trim();
  const n = [...s].length;
  if (n < NET_LIMITS.nameMin || n > NET_LIMITS.nameMax || !NAME_RE.test(s)) return null;
  return s;
}

export function isRoomCode(v: unknown): v is string {
  return typeof v === 'string' && ROOM_CODE_RE.test(v);
}

/** UTF-8 byte length without encoding. */
export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

// ---- JSON schema helpers ---------------------------------------------------------------------------------------------------

type Obj = Record<string, unknown>;

const TODS: readonly TimeOfDay[] = ['day', 'sunset', 'night'];
const WEATHERS: readonly WeatherPreset[] = ['dry', 'light', 'heavy', 'variable'];
const PHASES: readonly NetRoomPhase[] = ['lobby', 'loading', 'countdown', 'racing', 'finishing', 'results'];
const REPORT_KINDS: readonly NetReportKind[] = ['trackLimits', 'cornerCut', 'pitSpeeding', 'lapInvalidated', 'collision', 'safetyCar'];
const ERROR_CODES: readonly NetErrorCode[] = ['full', 'notFound', 'badName', 'taken', 'version', 'rate', 'badMessage', 'phase', 'maintenance'];
const PENALTY_REASONS: readonly PenaltyReason[] = ['jumpStart', 'trackLimits', 'cornerCut', 'pitSpeeding', 'twoCompound', 'collision', 'safetyCar'];
const STATUSES: readonly CarRaceState['status'][] = ['running', 'finished', 'dnf', 'dsq'];
const TEAM_IDS: readonly string[] = TEAMS.map((t) => t.id);
const HEX32_RE = /^[0-9a-f]{32}$/;
/** D-050 hello.deviceId. */
export const DEVICE_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
/** D-050 admin notice length. */
export const NOTICE_MAX = 200;
/** D-050 WebSocket close codes after `kicked` (the client must not reconnect). */
export const CLOSE_KICKED = 4001;
export const CLOSE_BANNED = 4003;
const HASH_RE = /^[0-9a-f]{8,64}$/;
const RACE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_CARS = 20;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

/** Every own key is one of `keys` (optional keys included). */
function onlyKeys(o: Obj, keys: readonly string[]): boolean {
  for (const k of Object.keys(o)) if (!keys.includes(k)) return false;
  return true;
}

function isInt(v: unknown, lo: number, hi: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
}

function isNum(v: unknown, lo: number, hi: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
}

function isBool(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

function oneOf<T>(v: unknown, allowed: readonly T[]): v is T {
  return (allowed as readonly unknown[]).includes(v);
}

/** Server-sent display names (humans already normalised; AI driver names from data): 1–32 chars, no control/format chars. */
function isDisplayName(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 1 && v.length <= 32 && !/[\p{Cc}\p{Cf}]/u.test(v);
}

const isId = (v: unknown): v is number => isInt(v, 0, NET_ID_MAX);
const isDriverIdx = (v: unknown): v is 0 | 1 => v === 0 || v === 1;

function settingsOf(v: unknown): NetRoomSettings | null {
  if (!isObj(v) || !onlyKeys(v, ['trackId', 'laps', 'tod', 'weather', 'aiCount', 'difficulty', 'visibility', 'mode'])) return null;
  const { trackId, laps, tod, weather, aiCount, difficulty, visibility = 'public', mode = 'normal' } = v;
  if (visibility !== 'public' && visibility !== 'private') return null;
  if (!oneOf(mode, RACE_MODES)) return null;
  if (!oneOf(trackId, RACE_TRACKS) || !oneOf(laps, NET_LAPS) || !oneOf(tod, TODS) || !oneOf(weather, WEATHERS)) return null;
  if (!isInt(aiCount, 0, MAX_CARS - 1) || !isInt(difficulty, 0, 110)) return null;
  return { trackId, laps, tod, weather, aiCount, difficulty, visibility, mode };
}

/** D-061 race modes. */
export const RACE_MODES: readonly NetRaceMode[] = ['normal', 'kasap'];
/** D-062: custom teams per room (one per base team). */
export const MAX_CUSTOM_TEAMS = 10;

/** D-062: a custom team on the wire: the exact shape plus the D-046 rules (name, palette ids, base car); canonical copy or null. */
export function customTeamOf(v: unknown): NetCustomTeam | null {
  if (!isObj(v) || !onlyKeys(v, ['id', 'name', 'baseTeamId', 'primary', 'secondary', 'accent', 'finish'])) return null;
  const t = parseCustomTeam(v);
  return t && t.name === v.name ? { ...t } : null;
}

function teamEntryOf(v: unknown): NetCustomTeamEntry | null {
  if (!isObj(v) || !onlyKeys(v, ['ownerId', 'team']) || !isId(v.ownerId)) return null;
  const team = customTeamOf(v.team);
  return team ? { ownerId: v.ownerId, team } : null;
}

/** Directory bound independent of deployment capacity; also bounded by maxServerJsonBytes. */
export const MAX_ROOM_LISTINGS = 32;
function roomListingOf(v: unknown): NetRoomListing | null {
  if (!isObj(v) || !onlyKeys(v, ['code', 'track', 'laps', 'weather', 'tod', 'humans', 'capacity', 'state', 'owner', 'mode'])) return null;
  const { code, track, laps, weather, tod, humans, capacity, state, owner, mode } = v;
  if (mode !== undefined && !oneOf(mode, RACE_MODES)) return null;
  if (!isRoomCode(code) || !oneOf(track, RACE_TRACKS) || !oneOf(laps, NET_LAPS) || !oneOf(weather, WEATHERS) || !oneOf(tod, TODS)) return null;
  if (!isInt(capacity, 1, MAX_CARS) || !isInt(humans, 1, capacity) || (state !== 'lobby' && state !== 'racing') || typeof owner !== 'string' || normalizeName(owner) !== owner) return null;
  const row: NetRoomListing = { code, track, laps, weather, tod, humans, capacity, state, owner };
  if (mode !== undefined) row.mode = mode;
  return row;
}

function playerOf(v: unknown): NetPlayerInfo | null {
  if (!isObj(v) || !onlyKeys(v, ['id', 'name', 'teamId', 'driverIdx', 'ready', 'connected', 'pingMs'])) return null;
  const { id, name, teamId, driverIdx, ready, connected, pingMs } = v;
  if (!isId(id) || !isDisplayName(name) || !oneOf(teamId, TEAM_IDS) || !isDriverIdx(driverIdx) || !isBool(ready) || !isBool(connected)) return null;
  if (!isInt(pingMs, 0, 60_000)) return null;
  return { id, name, teamId, driverIdx, ready, connected, pingMs };
}

function rosterOf(v: unknown): NetRosterEntry | null {
  if (!isObj(v) || !onlyKeys(v, ['id', 'kind', 'name', 'teamId', 'driverIdx', 'gridSlot'])) return null;
  const { id, kind, name, teamId, driverIdx, gridSlot } = v;
  if (!isId(id) || (kind !== 'human' && kind !== 'ai') || !isDisplayName(name) || !oneOf(teamId, TEAM_IDS) || !isDriverIdx(driverIdx)) return null;
  if (!isInt(gridSlot, 0, MAX_CARS - 1)) return null;
  return { id, kind, name, teamId, driverIdx, gridSlot };
}

function resultRowOf(v: unknown): NetResultRow | null {
  const keys = ['pos', 'id', 'name', 'teamId', 'totalMs', 'gapMs', 'lapsDown', 'bestLapMs', 'stops', 'penaltySec', 'points', 'status'];
  if (!isObj(v) || !onlyKeys(v, keys)) return null;
  const { pos, id, name, teamId, totalMs, gapMs, lapsDown, bestLapMs, stops, penaltySec, points, status } = v;
  if (!isInt(pos, 1, MAX_CARS) || !isId(id) || !isDisplayName(name) || !oneOf(teamId, TEAM_IDS) || !oneOf(status, STATUSES)) return null;
  if (!isNum(totalMs, 0, 1e9) || !isNum(gapMs, 0, 1e9) || !isInt(lapsDown, 0, 99) || !isNum(bestLapMs, 0, 1e9)) return null;
  if (!isInt(stops, 0, 99) || !isNum(penaltySec, 0, 3600) || !isInt(points, 0, 100)) return null;
  return { pos, id, name, teamId, totalMs, gapMs, lapsDown, bestLapMs, stops, penaltySec, points, status };
}

/** Maps every element through `f`; null if any fails or the array is too long. */
function arrayOf<T>(v: unknown, max: number, f: (x: unknown) => T | null): T[] | null {
  if (!Array.isArray(v) || v.length > max) return null;
  const out: T[] = [];
  for (const x of v) {
    const r = f(x);
    if (r === null) return null;
    out.push(r);
  }
  return out;
}

function uniqueBy<T>(xs: readonly T[], key: (x: T) => number): boolean {
  return new Set(xs.map(key)).size === xs.length;
}

function parseJsonObject(text: unknown, maxBytes: number): Obj | null {
  if (typeof text !== 'string' || text.length > maxBytes || utf8Length(text) > maxBytes) return null;
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  return isObj(v) && typeof v.type === 'string' ? v : null;
}

// ---- JSON: client → server -------------------------------------------------------------------------------------------------

/**
 * Strict parse of a client control message (≤ 1 KB). Returns a fresh object holding only the known fields, or null.
 * `hello.name` is only shape-checked here; the server runs normalizeName() on it (→ error 'badName').
 */
export function parseClientMessage(text: unknown): NetClientMsg | null {
  const o = parseJsonObject(text, NET_LIMITS.maxClientJsonBytes);
  if (!o) return null;
  switch (o.type) {
    case 'hello': {
      if (!onlyKeys(o, ['type', 'v', 'build', 'name', 'resume', 'deviceId'])) return null;
      const { v, build, name, resume, deviceId } = o;
      if (!isInt(v, 0, 65535) || typeof build !== 'string' || build.length > 64 || typeof name !== 'string' || name.length > 64) return null;
      if (resume !== undefined && (typeof resume !== 'string' || !HEX32_RE.test(resume))) return null;
      if (deviceId !== undefined && (typeof deviceId !== 'string' || !DEVICE_ID_RE.test(deviceId))) return null;
      const hello: Extract<NetClientMsg, { type: 'hello' }> = { type: 'hello', v, build, name };
      if (resume !== undefined) hello.resume = resume;
      if (deviceId !== undefined) hello.deviceId = deviceId;
      return hello;
    }
    case 'create':
    case 'setSettings': {
      if (!onlyKeys(o, ['type', 'settings'])) return null;
      const settings = settingsOf(o.settings);
      return settings ? { type: o.type, settings } : null;
    }
    case 'join':
      return onlyKeys(o, ['type', 'code']) && isRoomCode(o.code) ? { type: 'join', code: o.code } : null;
    case 'setCar':
      return onlyKeys(o, ['type', 'teamId', 'driverIdx']) && oneOf(o.teamId, TEAM_IDS) && isDriverIdx(o.driverIdx)
        ? { type: 'setCar', teamId: o.teamId, driverIdx: o.driverIdx }
        : null;
    case 'setReady':
      return onlyKeys(o, ['type', 'ready']) && isBool(o.ready) ? { type: 'setReady', ready: o.ready } : null;
    case 'loaded':
      return onlyKeys(o, ['type', 'trackHash']) && typeof o.trackHash === 'string' && HASH_RE.test(o.trackHash)
        ? { type: 'loaded', trackHash: o.trackHash }
        : null;
    case 'report': {
      if (!onlyKeys(o, ['type', 'kind', 'seconds', 'lap'])) return null;
      const { kind, seconds, lap } = o;
      if (!oneOf(kind, REPORT_KINDS) || !isInt(lap, 0, 99) || (seconds !== undefined && !isNum(seconds, 0, 60))) return null;
      return seconds === undefined ? { type: 'report', kind, lap } : { type: 'report', kind, seconds, lap };
    }
    case 'setTeam': {
      if (!onlyKeys(o, ['type', 'team'])) return null;
      if (o.team === null) return { type: 'setTeam', team: null };
      const team = customTeamOf(o.team);
      return team ? { type: 'setTeam', team } : null;
    }
    case 'listRooms':
    case 'quickJoin':
    case 'leave':
    case 'start':
    case 'retire':
    case 'backToLobby':
      return onlyKeys(o, ['type']) ? { type: o.type } : null;
    default:
      return null;
  }
}

// ---- JSON: server → client -------------------------------------------------------------------------------------------------

/** Strict parse of a server control message (≤ 16 KB); same rules as parseClientMessage. */
export function parseServerMessage(text: unknown): NetServerMsg | null {
  const o = parseJsonObject(text, NET_LIMITS.maxServerJsonBytes);
  if (!o) return null;
  switch (o.type) {
    case 'welcome': {
      if (!onlyKeys(o, ['type', 'id', 'resumeToken', 'serverMs', 'limits'])) return null;
      const { id, resumeToken, serverMs, limits } = o;
      if (!isId(id) || typeof resumeToken !== 'string' || !HEX32_RE.test(resumeToken) || !isNum(serverMs, 0, Number.MAX_SAFE_INTEGER)) return null;
      if (!isObj(limits) || !onlyKeys(limits, ['maxPlayers', 'hz']) || !isInt(limits.maxPlayers, 1, MAX_CARS) || !isInt(limits.hz, 1, 60)) return null;
      return { type: 'welcome', id, resumeToken, serverMs, limits: { maxPlayers: limits.maxPlayers, hz: limits.hz } };
    }
    case 'rooms': {
      if (!onlyKeys(o, ['type', 'rooms'])) return null;
      const rooms = arrayOf(o.rooms, MAX_ROOM_LISTINGS, roomListingOf);
      return rooms && new Set(rooms.map((r) => r.code)).size === rooms.length ? { type: 'rooms', rooms } : null;
    }
    case 'room': {
      if (!onlyKeys(o, ['type', 'code', 'ownerId', 'phase', 'settings', 'players', 'teams'])) return null;
      const { code, ownerId, phase } = o;
      const settings = settingsOf(o.settings);
      const players = arrayOf(o.players, MAX_CARS, playerOf);
      if (!isRoomCode(code) || !isId(ownerId) || !oneOf(phase, PHASES) || !settings || !players || !uniqueBy(players, (p) => p.id)) return null;
      if (o.teams === undefined) return { type: 'room', code, ownerId, phase, settings, players };
      const teams = arrayOf(o.teams, MAX_CUSTOM_TEAMS, teamEntryOf);
      if (!teams || new Set(teams.map((e) => e.team.baseTeamId)).size !== teams.length) return null;
      return { type: 'room', code, ownerId, phase, settings, players, teams };
    }
    case 'error':
      return onlyKeys(o, ['type', 'code']) && oneOf(o.code, ERROR_CODES) ? { type: 'error', code: o.code } : null;
    case 'load': {
      if (!onlyKeys(o, ['type', 'raceId', 'config', 'roster', 'lightsOutAtMs', 'teams'])) return null;
      const { raceId, config, lightsOutAtMs } = o;
      if (typeof raceId !== 'string' || !RACE_ID_RE.test(raceId) || !isNum(lightsOutAtMs, 0, 60_000) || !isObj(config)) return null;
      const { seed, ...rest } = config;
      const settings = settingsOf(rest);
      const roster = arrayOf(o.roster, MAX_CARS, rosterOf);
      if (!settings || !isInt(seed, -2147483648, 2147483647) || !roster || roster.length === 0) return null;
      if (!uniqueBy(roster, (r) => r.id) || !uniqueBy(roster, (r) => r.gridSlot)) return null;
      const cfg: NetRaceConfig = { ...settings, seed };
      if (o.teams === undefined) return { type: 'load', raceId, config: cfg, roster, lightsOutAtMs };
      const teams = arrayOf(o.teams, MAX_CUSTOM_TEAMS, customTeamOf);
      if (!teams || new Set(teams.map((t) => t.baseTeamId)).size !== teams.length) return null;
      return { type: 'load', raceId, config: cfg, roster, lightsOutAtMs, teams };
    }
    case 'start':
      return onlyKeys(o, ['type', 't0ServerMs']) && isNum(o.t0ServerMs, 0, Number.MAX_SAFE_INTEGER) ? { type: 'start', t0ServerMs: o.t0ServerMs } : null;
    case 'lap': {
      if (!onlyKeys(o, ['type', 'id', 'lap', 'ms', 'valid', 'bestMs'])) return null;
      const { id, lap, ms, valid, bestMs } = o;
      if (!isId(id) || !isInt(lap, 0, 99) || !isNum(ms, 0, 1e9) || !isBool(valid) || !isNum(bestMs, 0, 1e9)) return null;
      return { type: 'lap', id, lap, ms, valid, bestMs };
    }
    case 'penalty': {
      if (!onlyKeys(o, ['type', 'id', 'seconds', 'reason'])) return null;
      const { id, seconds, reason } = o;
      if (!isId(id) || !isNum(seconds, 0, 300) || !oneOf(reason, PENALTY_REASONS)) return null;
      return { type: 'penalty', id, seconds, reason };
    }
    case 'standings': {
      if (!onlyKeys(o, ['type', 'order', 'laps', 'gapMs', 'status'])) return null;
      const order = arrayOf(o.order, MAX_CARS, (x) => (isId(x) ? x : null));
      const laps = arrayOf(o.laps, MAX_CARS, (x) => (isInt(x, 0, 99) ? x : null));
      const gapMs = arrayOf(o.gapMs, MAX_CARS, (x) => (isNum(x, 0, 1e9) ? x : null));
      const status = arrayOf(o.status, MAX_CARS, (x) => (oneOf(x, STATUSES) ? x : null));
      if (!order || !laps || !gapMs || !status || !uniqueBy(order, (x) => x)) return null;
      if (laps.length !== order.length || gapMs.length !== order.length || status.length !== order.length) return null;
      return { type: 'standings', order, laps, gapMs, status };
    }
    case 'finishing':
      return onlyKeys(o, ['type', 'byId', 'windowMs']) && isId(o.byId) && isInt(o.windowMs, 0, 600_000)
        ? { type: 'finishing', byId: o.byId, windowMs: o.windowMs }
        : null;
    case 'player':
      return onlyKeys(o, ['type', 'id', 'connected', 'stale']) && isId(o.id) && isBool(o.connected) && isBool(o.stale)
        ? { type: 'player', id: o.id, connected: o.connected, stale: o.stale }
        : null;
    case 'results': {
      if (!onlyKeys(o, ['type', 'rows'])) return null;
      const rows = arrayOf(o.rows, MAX_CARS, resultRowOf);
      return rows && uniqueBy(rows, (r) => r.id) ? { type: 'results', rows } : null;
    }
    case 'notice':
      return onlyKeys(o, ['type', 'text']) && typeof o.text === 'string' && o.text.length <= NOTICE_MAX && !/[\p{Cc}\p{Cf}]/u.test(o.text)
        ? { type: 'notice', text: o.text }
        : null;
    case 'kicked': {
      if (!onlyKeys(o, ['type', 'reason', 'until']) || (o.reason !== 'kicked' && o.reason !== 'banned')) return null;
      const { until } = o;
      if (until !== undefined && until !== null && !isNum(until, 0, Number.MAX_SAFE_INTEGER)) return null;
      return until === undefined ? { type: 'kicked', reason: o.reason } : { type: 'kicked', reason: o.reason, until };
    }
    default:
      return null;
  }
}

// ---- track hash (CR-SRV-1) -------------------------------------------------------------------------------------------------

const hashF32 = new Float32Array(1);
const hashU32 = new Uint32Array(hashF32.buffer);

/**
 * Hash of a built track (design §8.1: `loaded{trackHash}` must equal the server's, else the geometry differs). FNV-1a 32 over the
 * f32 bits of the length, sample count, sector lines, grid slots and every 8th centreline sample → 8 lowercase hex chars.
 * Moved here from server/src/trackHash.ts (CR-SRV-1); the algorithm is unchanged, so both sides agree byte for byte.
 */
export function trackHashOf(data: TrackData): string {
  let h = 0x811c9dc5;
  const mix = (v: number): void => {
    hashF32[0] = v;
    let w = hashU32[0]!;
    for (let k = 0; k < 4; k++) {
      h ^= w & 0xff;
      h = Math.imul(h, 0x01000193);
      w >>>= 8;
    }
  };
  mix(data.length);
  mix(data.count);
  mix(data.sectors[0]);
  mix(data.sectors[1]);
  for (const g of data.grid) {
    mix(g.s);
    mix(g.d);
  }
  for (let i = 0; i < data.count; i += 8) {
    mix(data.x[i]!);
    mix(data.z[i]!);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
