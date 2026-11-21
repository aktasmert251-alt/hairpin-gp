// D-064 manual signaling codes. An invite (host → guest) and an answer (guest → host) carry one complete SDP (ICE candidates
// included, gathered before encoding) plus the room it belongs to:
//   HP1I.<base64url(zlib(JSON))>   invite: { v, r: room code, c: display code, s: guest slot, d: SDP offer }
//   HP1A.<base64url(zlib(JSON))>   answer: { v, c: display code, s: guest slot, d: SDP answer }
// zlib (CompressionStream 'deflate') carries an Adler-32 checksum, so a truncated or edited code fails to decode instead of
// producing a wrong SDP. Whitespace and line breaks that chat apps insert are ignored.
import { ROOM_CODE_ALPHABET, isRoomCode } from '../protocol';
import { MAX_CODE_CHARS } from './config';

export const INVITE_PREFIX = 'HP1I.';
export const ANSWER_PREFIX = 'HP1A.';
export const CODE_VERSION = 1;
/** A data-channel SDP with a few candidates is ~0.5–2 KB; anything far bigger is not ours. */
export const MAX_SDP_CHARS = 8000;
export const DISPLAY_CODE_LENGTH = 6;
const DISPLAY_RE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${DISPLAY_CODE_LENGTH}}$`);

export interface InviteCode { room: string; display: string; slot: number; sdp: string }
export interface AnswerCode { display: string; slot: number; sdp: string }

export type CodeError = 'empty' | 'tooLong' | 'short' | 'notInvite' | 'notAnswer' | 'corrupt';

export class SignalCodeError extends Error {
  /** What the decoder saw (length, start, end, characters outside the code alphabet): for the error message, never the full code. */
  detail = '';
  constructor(readonly code: CodeError) {
    super(code);
  }
}

/** Short, non-sensitive description of a pasted text for support: lengths and the first / last few characters only. */
export function describeCode(raw: string): string {
  const t = normalizeCode(raw);
  const bad = (t.match(/[^A-Za-z0-9_.-]/g) ?? []).length;
  const head = t.slice(0, 8);
  const tail = t.length > 24 ? t.slice(-6) : '';
  return `${t.length} karakter, baş: ${head}, son: ${tail || '-'}, geçersiz karakter: ${bad}`;
}

/** Description of the code that was decoded last (shown in the error message so a failed paste can be diagnosed). */
export const codeDiag = { last: '' };

export function isDisplayCode(v: unknown): v is string {
  return typeof v === 'string' && DISPLAY_RE.test(v);
}

/** Short code shown in the lobby (and the relay mailbox key): 6 characters of the room-code alphabet. */
export function newDisplayCode(rnd: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const b = rnd(DISPLAY_CODE_LENGTH);
  let s = '';
  for (let i = 0; i < DISPLAY_CODE_LENGTH; i++) s += ROOM_CODE_ALPHABET[b[i]! % ROOM_CODE_ALPHABET.length];
  return s;
}

// ---- base64url + zlib -------------------------------------------------------------------------------------------------------

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new SignalCodeError('corrupt');
  const pad = text.length % 4 === 0 ? '' : '='.repeat(4 - (text.length % 4));
  let bin: string;
  try {
    bin = atob(text.replace(/-/g, '+').replace(/_/g, '/') + pad);
  } catch {
    throw new SignalCodeError('corrupt');
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const body = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

async function pack(prefix: string, obj: object): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(obj));
  return prefix + b64url(await pipe(json, new CompressionStream('deflate')));
}

/**
 * What chat apps and keyboards do to a pasted code: typographic look-alikes for '-' and '_', zero-width and non-breaking
 * characters, line breaks. All of these are repaired before decoding.
 */
export function normalizeCode(raw: string): string {
  return raw
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-')
    .replace(/[\uFF3F\u203F]/g, '_')
    .replace(/[\p{Cf}]/gu, '') // zero-width, direction marks (LRM / RLM, common in WhatsApp), soft hyphen, BOM, isolates
    .replace(/\s+/g, '');
}

/** Real codes are 500+ characters; anything shorter than this was cut off while copying. */
const MIN_PAYLOAD_CHARS = 300;
/** Longest run of prose that may follow a code in a pasted message ("... kodu yapıştır", names, times). */
const MAX_TRAILING_JUNK = 160;

async function decodePayload(payload: string): Promise<Record<string, unknown>> {
  let json: string;
  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(await pipe(unb64url(payload), new DecompressionStream('deflate')));
  } catch (e) {
    if (e instanceof SignalCodeError) throw e;
    throw new SignalCodeError('corrupt');
  }
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    throw new SignalCodeError('corrupt');
  }
  if (typeof obj !== 'object' || obj === null || (obj as { v?: unknown }).v !== CODE_VERSION) throw new SignalCodeError('corrupt');
  return obj as Record<string, unknown>;
}

async function unpack(raw: string, prefix: string, other: string, wrong: CodeError): Promise<Record<string, unknown>> {
  codeDiag.last = describeCode(raw);
  try {
    return await unpackText(raw, prefix, other, wrong);
  } catch (e) {
    if (e instanceof SignalCodeError && !e.detail) e.detail = describeCode(raw);
    throw e;
  }
}

async function unpackText(raw: string, prefix: string, other: string, wrong: CodeError): Promise<Record<string, unknown>> {
  const text = normalizeCode(raw);
  if (!text) throw new SignalCodeError('empty');
  // The code may sit inside a longer pasted message (sender name, time, instructions): start at its prefix.
  const at = text.indexOf(prefix);
  const atOther = text.indexOf(other);
  if (at < 0) throw new SignalCodeError(atOther >= 0 ? wrong : 'corrupt');
  if (atOther >= 0 && atOther < at) throw new SignalCodeError(wrong);
  const run = /^[A-Za-z0-9_-]*/.exec(text.slice(at + prefix.length))![0];
  if (run.length > MAX_CODE_CHARS) throw new SignalCodeError('tooLong');
  // zlib carries a checksum, so only the exact payload decodes. Words glued to the end of the code in a chat message are
  // cut off by trying shorter and shorter endings.
  let last: unknown = new SignalCodeError('corrupt');
  for (let cut = 0; cut <= Math.min(MAX_TRAILING_JUNK, run.length - 8); cut++) {
    const payload = run.slice(0, run.length - cut);
    if (payload.length % 4 === 1) continue;
    try {
      return await decodePayload(payload);
    } catch (e) {
      last = e;
    }
  }
  // Nothing decoded: a very short remainder means the code was cut off while copying.
  if (run.length < MIN_PAYLOAD_CHARS) throw new SignalCodeError('short');
  throw last instanceof SignalCodeError ? last : new SignalCodeError('corrupt');
}
const validSdp = (d: unknown): d is string => typeof d === 'string' && d.length <= MAX_SDP_CHARS && d.startsWith('v=0');
const validSlot = (s: unknown): s is number => typeof s === 'number' && Number.isInteger(s) && s >= 1 && s <= 99;

// ---- public codec ------------------------------------------------------------------------------------------------------------

export function encodeInvite(i: InviteCode): Promise<string> {
  return pack(INVITE_PREFIX, { v: CODE_VERSION, r: i.room, c: i.display, s: i.slot, d: i.sdp });
}

export async function decodeInvite(raw: string): Promise<InviteCode> {
  const o = await unpack(raw, INVITE_PREFIX, ANSWER_PREFIX, 'notInvite');
  if (!isRoomCode(o.r) || !isDisplayCode(o.c) || !validSlot(o.s) || !validSdp(o.d)) throw new SignalCodeError('corrupt');
  return { room: o.r, display: o.c, slot: o.s, sdp: o.d };
}

export function encodeAnswer(a: AnswerCode): Promise<string> {
  return pack(ANSWER_PREFIX, { v: CODE_VERSION, c: a.display, s: a.slot, d: a.sdp });
}

export async function decodeAnswer(raw: string): Promise<AnswerCode> {
  const o = await unpack(raw, ANSWER_PREFIX, INVITE_PREFIX, 'notAnswer');
  if (!isDisplayCode(o.c) || !validSlot(o.s) || !validSdp(o.d)) throw new SignalCodeError('corrupt');
  return { display: o.c, slot: o.s, sdp: o.d };
}

/** The error key of anything a decode threw. */
export function codeErrorOf(e: unknown): CodeError {
  return e instanceof SignalCodeError ? e.code : 'corrupt';
}
