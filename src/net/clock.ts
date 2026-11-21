// Server clock sync (design §5.3): NTP-style offset from ping/pong, using the lowest-RTT sample of the 8 most recent.
// Pure and allocation-free after creation: the caller passes every timestamp (client ms from performance.now, server ms
// from the pong), so the module reads no clock itself and server/** may import it.

export const CLOCK_SAMPLES = 8;

export interface ClockSync {
  /** One pong: `clientSendMs` (echoed by the server), the server's `serverMs` and the local receive time. Bad samples are ignored. */
  addSample(clientSendMs: number, serverMs: number, clientRecvMs: number): void;
  /** serverTime ≈ clientTime + offsetMs (0 before the first sample). */
  offsetMs(): number;
  /** RTT of the sample the offset comes from (Infinity before the first sample). */
  rttMs(): number;
  /** Server time estimate for a local time. */
  serverNow(clientNowMs: number): number;
  /** Samples held (≤ CLOCK_SAMPLES). */
  count(): number;
  reset(): void;
}

export function createClockSync(): ClockSync {
  const rtt = new Float64Array(CLOCK_SAMPLES);
  const off = new Float64Array(CLOCK_SAMPLES);
  let n = 0;
  let head = 0;
  let best = -1;

  const pickBest = (): void => {
    best = -1;
    for (let i = 0; i < n; i++) if (best < 0 || rtt[i]! < rtt[best]!) best = i;
  };

  return {
    addSample(send, server, recv) {
      const r = recv - send;
      if (!Number.isFinite(r) || !Number.isFinite(server) || r < 0) return;
      rtt[head] = r;
      // The server stamped its time somewhere in [send, recv]; the midpoint bounds the error by r / 2.
      off[head] = server - (send + recv) / 2;
      head = (head + 1) % CLOCK_SAMPLES;
      if (n < CLOCK_SAMPLES) n++;
      pickBest();
    },
    offsetMs: () => (best < 0 ? 0 : off[best]!),
    rttMs: () => (best < 0 ? Infinity : rtt[best]!),
    serverNow(clientNowMs) {
      return clientNowMs + (best < 0 ? 0 : off[best]!);
    },
    count: () => n,
    reset() {
      n = 0;
      head = 0;
      best = -1;
    },
  };
}
