import { describe, expect, it } from 'vitest';
import { isRoomCode } from '../../protocol';
import { ANSWER_PREFIX, INVITE_PREFIX, decodeAnswer, decodeInvite, encodeAnswer, encodeInvite, isDisplayCode, newDisplayCode, normalizeCode } from '../signal';

/** A realistic Chrome data-channel offer with host + srflx candidates (documentation addresses only). */
const SDP = [
  'v=0', 'o=- 4611731400430051336 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=extmap-allow-mixed', 'a=msid-semantic: WMS',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
  'a=candidate:1467250027 1 udp 2122260223 192.0.2.10 53921 typ host generation 0 network-id 1',
  'a=candidate:2999745851 1 udp 1686052607 198.51.100.7 53921 typ srflx raddr 192.0.2.10 rport 53921 generation 0 network-id 1',
  'a=candidate:3337744321 1 udp 2122194687 4f3a1d2e-77aa-4b5c-9d1e-0123456789ab.local 61522 typ host generation 0',
  'a=ice-ufrag:Ks9X', 'a=ice-pwd:bWQkT3n2Y0p1Qy8hZr4N6s7V', 'a=ice-options:trickle',
  'a=fingerprint:sha-256 6B:8B:5D:EA:59:04:20:23:29:C8:87:1C:CD:87:32:BE:DD:8C:66:A5:8E:50:55:EA:8C:D3:B6:5C:09:5E:D6:BC',
  'a=setup:actpass', 'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144', '',
].join('\r\n');

const INVITE = { room: 'ABCDE', display: 'K7M2PQ', slot: 2, sdp: SDP };

describe('manual signaling codes', () => {
  it('invite and answer round-trip', async () => {
    const code = await encodeInvite(INVITE);
    expect(code.startsWith(INVITE_PREFIX)).toBe(true);
    expect(code).toMatch(/^HP1I\.[A-Za-z0-9_-]+$/);
    expect(await decodeInvite(code)).toEqual(INVITE);
    const ans = await encodeAnswer({ display: 'K7M2PQ', slot: 2, sdp: SDP });
    expect(ans.startsWith(ANSWER_PREFIX)).toBe(true);
    expect(await decodeAnswer(ans)).toEqual({ display: 'K7M2PQ', slot: 2, sdp: SDP });
  });

  it('is plain (no CompressionStream needed, iOS < 16.4 and in-app browsers) and still fits a message (< 3 KB)', async () => {
    const code = await encodeInvite(INVITE);
    expect(code.startsWith(`${INVITE_PREFIX}eyJ`)).toBe(true);
    expect(code.length).toBeLessThan(3000);
  });

  it('still reads older compressed (zlib) codes where the browser can inflate them', async () => {
    const json = new TextEncoder().encode(JSON.stringify({ v: 1, r: INVITE.room, c: INVITE.display, s: INVITE.slot, d: INVITE.sdp }));
    const z = new Uint8Array(await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
    let bin = '';
    for (const b of z) bin += String.fromCharCode(b);
    const old = INVITE_PREFIX + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(old.startsWith(`${INVITE_PREFIX}eJ`)).toBe(true);
    expect(await decodeInvite(old)).toEqual(INVITE);
  });

  it('a plain code with an edited character fails its checksum', async () => {
    const code = await encodeInvite(INVITE);
    const i = Math.floor(code.length / 2);
    const edited = code.slice(0, i) + (code[i] === 'Q' ? 'R' : 'Q') + code.slice(i + 1);
    await expect(decodeInvite(edited)).rejects.toMatchObject({ code: 'corrupt' });
  });

  it('ignores whitespace and line breaks that chat apps insert', async () => {
    const code = await encodeInvite(INVITE);
    const wrapped = `  ${code.slice(0, 40)}\n${code.slice(40, 90)} \r\n${code.slice(90)}\n`;
    expect(await decodeInvite(wrapped)).toEqual(INVITE);
  });

  it('rejects corrupted, truncated, foreign and swapped codes with a reason', async () => {
    const code = await encodeInvite(INVITE);
    const flip = (s: string, i: number): string => s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1);
    await expect(decodeInvite(flip(code, code.length - 3))).rejects.toMatchObject({ code: 'corrupt' });
    await expect(decodeInvite(flip(code, 20))).rejects.toMatchObject({ code: 'corrupt' });
    await expect(decodeInvite(code.slice(0, code.length - 10))).rejects.toMatchObject({ code: 'corrupt' });
    await expect(decodeInvite('hello there')).rejects.toMatchObject({ code: 'corrupt' });
    await expect(decodeInvite('HP1I.!!!')).rejects.toMatchObject({ code: 'short' });
    await expect(decodeInvite('   ')).rejects.toMatchObject({ code: 'empty' });
    await expect(decodeInvite(`HP1I.${'A'.repeat(13_000)}`)).rejects.toMatchObject({ code: 'tooLong' });
    const ans = await encodeAnswer({ display: 'K7M2PQ', slot: 2, sdp: SDP });
    await expect(decodeInvite(ans)).rejects.toMatchObject({ code: 'notInvite' });
    await expect(decodeAnswer(code)).rejects.toMatchObject({ code: 'notAnswer' });
  });

  it('finds the code inside a pasted chat message and ignores text around it', async () => {
    const code = await encodeInvite(INVITE);
    await expect(decodeInvite(`[12:31, 21.11.2026] Mert: ${code}`)).resolves.toEqual(INVITE);
    await expect(decodeInvite(`Davet kodum:\n${code}\nBunu yapıştır, sonra cevap kodunu gönder`)).resolves.toEqual(INVITE);
    // Words glued straight to the end of the code (no space) are cut off using the checksum.
    await expect(decodeInvite(`${code}Bunuyapistir`)).resolves.toEqual(INVITE);
    await expect(decodeInvite(`${code}.`)).resolves.toEqual(INVITE);
    const ans = await encodeAnswer({ display: 'K7M2PQ', slot: 2, sdp: SDP });
    await expect(decodeAnswer(`Cevap: ${ans} 🙂`)).resolves.toMatchObject({ slot: 2 });
  });

  it('repairs typographic look-alikes and invisible characters added by keyboards and chat apps', async () => {
    expect(normalizeCode('a\u2011b\u2013c\uFF3Fd\u2212e')).toBe('a-b-c_d-e');
    expect(normalizeCode('a\u200Bb\u200Ec\u00A0d\uFEFFe\u00ADf')).toBe('abcdef');
    const code = await encodeInvite(INVITE);
    const decoded = await decodeInvite(code);
    expect(await decodeInvite(`\u200E${code.slice(0, 50)}\u200B${code.slice(50, 100)}\u00A0${code.slice(100)}\uFEFF`)).toEqual(decoded);
  });
  it('explains that a 6-character room code is not an invite', async () => {
    await expect(decodeInvite('HY88M3')).rejects.toMatchObject({ code: 'roomCode' });
    await expect(decodeInvite(' hy88m3 ')).rejects.toMatchObject({ code: 'roomCode' });
    await expect(decodeAnswer('ABCDE')).rejects.toMatchObject({ code: 'roomCode' });
  });

  it('says "short" when the code was cut off while copying', async () => {
    const code = await encodeInvite(INVITE);
    await expect(decodeInvite(code.slice(0, 120))).rejects.toMatchObject({ code: 'short' });
    await expect(decodeInvite(code.slice(0, code.length - 40))).rejects.toMatchObject({ code: 'corrupt' });
  });

  it('validates the payload: room code, display code, slot and SDP shape', async () => {
    await expect(decodeInvite(await encodeInvite({ ...INVITE, room: 'abc' }))).rejects.toMatchObject({ code: 'corrupt' });
    await expect(decodeInvite(await encodeInvite({ ...INVITE, slot: 0 }))).rejects.toMatchObject({ code: 'corrupt' });
    await expect(decodeInvite(await encodeInvite({ ...INVITE, sdp: 'not sdp' }))).rejects.toMatchObject({ code: 'corrupt' });
    await expect(decodeInvite(await encodeInvite({ ...INVITE, sdp: `v=0${'x'.repeat(9000)}` }))).rejects.toMatchObject({ code: expect.stringMatching(/^(corrupt|tooLong)$/) });
    await expect(decodeAnswer(await encodeAnswer({ display: 'IOIOIO', slot: 3, sdp: SDP }))).rejects.toMatchObject({ code: 'corrupt' });
  });

  it('display codes: 6 characters of the room-code alphabet, distinct from 5-character room codes', () => {
    for (let i = 0; i < 50; i++) {
      const c = newDisplayCode();
      expect(isDisplayCode(c)).toBe(true);
      expect(isRoomCode(c)).toBe(false);
    }
    expect(newDisplayCode(() => new Uint8Array(6))).toBe('AAAAAA');
  });
});
