import { beforeEach, describe, expect, it } from 'vitest';
import { buildInviteLink, hasPendingInvite, parseInviteHash, setPendingInvite, takePendingInvite, whatsAppUrl } from '../inviteLink';
import { decodeInvite, encodeInvite } from '../signal';

const SDP = [
  'v=0', 'o=- 4611731400430051336 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
  'a=candidate:1467250027 1 udp 2122260223 192.0.2.10 53921 typ host generation 0 network-id 1',
  'a=candidate:2999745851 1 udp 1686052607 198.51.100.7 53921 typ srflx raddr 192.0.2.10 rport 53921 generation 0 network-id 1',
  'a=ice-ufrag:Ks9X', 'a=ice-pwd:bWQkT3n2Y0p1Qy8hZr4N6s7V', 'a=ice-options:trickle',
  'a=fingerprint:sha-256 6B:8B:5D:EA:59:04:20:23:29:C8:87:1C:CD:87:32:BE:DD:8C:66:A5:8E:50:55:EA:8C:D3:B6:5C:09:5E:D6:BC',
  'a=setup:actpass', 'a=mid:0', 'a=sctp-port:5000', '',
].join('\r\n');
const INVITE = { room: 'ABCDE', display: 'K7M2PQ', slot: 2, sdp: SDP };
const BASE = 'https://example.org/hairpin-gp/';

describe('invite links', () => {
  it('builds <base>#join=<code> with the code untouched and drops an existing fragment / keeps the sub-path', async () => {
    const code = await encodeInvite(INVITE);
    const link = buildInviteLink(code, BASE);
    expect(link).toBe(`${BASE}#join=${code}`);
    expect(link).not.toMatch(/[%\s]/);
    expect(buildInviteLink(code, `${BASE}#old`)).toBe(link);
  });

  it('round-trips through the URL hash into a decodable invite', async () => {
    const code = await encodeInvite(INVITE);
    const hash = new URL(buildInviteLink(code, BASE)).hash;
    const parsed = parseInviteHash(hash);
    expect(parsed).toBe(code);
    expect(await decodeInvite(parsed!)).toEqual(INVITE);
  });

  it('accepts #join=, a bare HP1I. hash, no leading #, percent-encoding (also twice), chat line breaks', async () => {
    const code = await encodeInvite(INVITE);
    expect(parseInviteHash(`#${code}`)).toBe(code);
    expect(parseInviteHash(`join=${code}`)).toBe(code);
    expect(parseInviteHash(`#JOIN=${code}`)).toBe(code);
    expect(parseInviteHash(`#join=${encodeURIComponent(code)}`)).toBe(code);
    expect(parseInviteHash(`#join=${encodeURIComponent(encodeURIComponent(code))}`)).toBe(code);
    expect(parseInviteHash(`#join=${code.slice(0, 200)}%0A${code.slice(200)}`)).toBe(code);
    expect(parseInviteHash(`#join=${code.replace(/-/g, '–')}`)).toBe(code);
  });

  it('drops characters that trail the code (tracking parameters, punctuation)', async () => {
    const code = await encodeInvite(INVITE);
    expect(parseInviteHash(`#join=${code}&utm_source=chat`)).toBe(code);
    // Words glued on after a space end up inside the run; the decoder's checksum-guided trimming removes them.
    expect(await decodeInvite(parseInviteHash(`#join=${code}%20thanks`)!)).toEqual(INVITE);
    expect(parseInviteHash(`#join=${code}!`)).toBe(code);
  });

  it('rejects junk, answers, empty and oversized hashes', async () => {
    const answer = 'HP1A.' + 'A'.repeat(400);
    for (const h of ['', '#', '#join=', '#join=hello', '#section', `#join=${answer}`, '#join=%E0%A4%A', '#join=HP1I.', `#HP1I.${'A'.repeat(13_000)}`]) {
      expect(parseInviteHash(h), h).toBeNull();
    }
  });

  it('wa.me link carries the encoded message', () => {
    const url = whatsAppUrl('HAIRPIN GP: https://x.org/#join=HP1I.abc\nline 2');
    expect(url.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(url.slice('https://wa.me/?text='.length))).toBe('HAIRPIN GP: https://x.org/#join=HP1I.abc\nline 2');
  });
});

describe('pending invite store', () => {
  beforeEach(() => setPendingInvite(null));
  it('hands the invite over exactly once', () => {
    expect(hasPendingInvite()).toBe(false);
    expect(takePendingInvite()).toBeNull();
    setPendingInvite('HP1I.abc');
    expect(hasPendingInvite()).toBe(true);
    expect(takePendingInvite()).toBe('HP1I.abc');
    expect(takePendingInvite()).toBeNull();
    expect(hasPendingInvite()).toBe(false);
  });
  it('the latest invite wins', () => {
    setPendingInvite('HP1I.one');
    setPendingInvite('HP1I.two');
    expect(takePendingInvite()).toBe('HP1I.two');
  });
});
