import { describe, expect, it } from 'vitest';
import { logTag, truncateIp } from '../privacy';
import { DEFAULT_GAME_CONFIG } from '../config';
import { WS_LIMITS } from '../limits';
import { Hub } from '../hub';
import type { Peer } from '../player';

describe('privacy-safe address logging', () => {
  it.each([
    ['203.0.113.87', '203.0.113.0/24'],
    ['::ffff:203.0.113.87', '203.0.113.0/24'],
    ['::FFFF:cb00:7157', '203.0.113.0/24'],
    ['2001:db8:abcd:1234:5678:9abc:def0:1234', '2001:db8:abcd::/48'],
    ['2001:db8::abcd', '2001:db8:0::/48'],
    ['::1', '0:0:0::/48'],
    ['fe80::abcd%eth0', 'fe80:0:0::/48'],
    ['unknown', 'unknown'], ['invalid secret', 'unknown'],
  ])('truncates %s without retaining the host', (input, expected) => {
    expect(truncateIp(input)).toBe(expected);
  });
  it('admits a full twenty-human room within the transport capacity', () => {
    expect(DEFAULT_GAME_CONFIG.maxPlayersPerRoom).toBe(20);
    expect(WS_LIMITS.maxSocketsTotal).toBeGreaterThanOrEqual(DEFAULT_GAME_CONFIG.maxRooms * 20);
    expect(WS_LIMITS.maxSocketsPerIp).toBeGreaterThanOrEqual(20);
  });
  it('logs bad messages with only a salted network tag at the hub boundary', () => {
    const logs: unknown[] = [];
    const hub = new Hub((event, data) => logs.push({ event, data }));
    const peer: Peer = { ip: '203.0.113.87', player: null, pingMs: 0, sendJson() {}, sendBinary() {}, bufferedAmount: () => 0, close() {} };
    try {
      hub.onOpen(peer); hub.onText(peer, '{invalid');
      const bad = logs.find((l) => (l as { event: string }).event === 'badMessage') as { data: Record<string, unknown> } | undefined;
      expect(bad?.data).toMatchObject({ net: logTag(peer.ip), id: null, why: 'parse' });
      expect(bad?.data).not.toHaveProperty('ip');
      expect(JSON.stringify(logs)).not.toContain(peer.ip);
    } finally { hub.dispose(); }
  });
});
