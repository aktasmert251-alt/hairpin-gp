// Game-server configuration (design §4, §6, §7; D-043). Every value is a plain constant that tests may override through
// createApexServer({ game: { ... } }). Capacities are config, not claims: 6 rooms × 20 humans is what D-048 asks for.
import type { RaceTrackId } from '../../src/contracts/track';

export interface GameConfig {
  /** D-043: rooms held at once. */
  maxRooms: number;
  /** D-048: up to 20 humans per room (AI cars fill only the empty slots of the 20-car grid). */
  maxPlayersPerRoom: number;
  /** Humans needed for `start` (1: a solo human races the server AI). */
  minPlayersToStart: number;
  /** A socket that has not sent `hello` within this time is closed. */
  helloTimeoutMs: number;
  /** Reconnect grace per phase; after it the player leaves (lobby/results) or is DNF (race). */
  graceLobbyMs: number;
  graceLoadingMs: number;
  graceRaceMs: number;
  /** LOADING ends when every human sent `loaded`, or after this. A player still connected but not loaded then joins late. */
  loadTimeoutMs: number;
  /** A connected player that had not finished loading when the race started may still load and join for this long (from
   *  lights out); after it, a car that never appeared on track is retired. */
  lateJoinMs: number;
  /** T0 = all loaded + this (the client's 3-2-1). */
  countdownMs: number;
  /** Rules FINISH_WINDOW_MS. */
  finishWindowMs: number;
  /** A car with no relayed state for this long is shown as stale (`player{stale:true}`). */
  staleMs: number;
  /** A present human that stands still this long is retired: never left the grid (from lights out) / later in the race. */
  startStallMs: number;
  stallMs: number;
  /** Strikes: `strikeLimit` within `strikeWindowMs` → states not relayed for `strikeMuteMs`. `hardLimit` hard violations → DSQ. */
  strikeLimit: number;
  strikeWindowMs: number;
  strikeMuteMs: number;
  hardLimit: number;
  /** Bad (malformed / unknown / out-of-phase) messages: `badLimit` within `badWindowMs` → close 1008. */
  badLimit: number;
  badWindowMs: number;
  /** Failed joins per IP per minute. */
  maxFailedJoinsPerMin: number;
  /** Lap floor: 0.95 × the best known AI lap at d100 (D-042), ms. */
  minLapMs: Record<RaceTrackId, number>;
  /** Server AI sim: at most this many 240 Hz steps per room tick (1 s); a bigger backlog is dropped and logged. */
  maxStepsPerTick: number;
  /** Send buffer above which batches to a socket are skipped (slow client). */
  maxBufferedBytes: number;
}

export const DEFAULT_GAME_CONFIG: Readonly<GameConfig> = {
  maxRooms: 6,
  maxPlayersPerRoom: 20,
  minPlayersToStart: 1,
  helloTimeoutMs: 10_000,
  graceLobbyMs: 30_000,
  graceLoadingMs: 30_000,
  graceRaceMs: 60_000,
  // A slow PC or a cold asset cache (the static site downloads the track first) can need well over 30 s.
  loadTimeoutMs: 90_000,
  lateJoinMs: 120_000,
  countdownMs: 3_000,
  finishWindowMs: 120_000,
  staleMs: 1_000,
  // Under the safety-car rule's 5 s start grace + 2 s slow + 10 s delay (src/race/rules.ts), so a car that never starts
  // cannot bring the SC out; a car stopped later in the race gets its yellow / SC, then is retired so the SC can end.
  startStallMs: 12_000,
  stallMs: 30_000,
  strikeLimit: 3,
  strikeWindowMs: 10_000,
  strikeMuteMs: 1_000,
  hardLimit: 2,
  badLimit: 5,
  badWindowMs: 10_000,
  maxFailedJoinsPerMin: 5,
  // ardennes: provisional floor (7004 m at 85 m/s) until 0.95 × the measured AI d100 lap replaces it (CR-TRK-7, Lead).
  // alpine (D-063): 0.95 × the measured AI d100 lap 76.84 s; cliff: 0.95 × 98.69 s; eifel: 0.95 × 270.36 s; aegean: 0.95 × 78.71 s;
  // cappadocia: 0.95 × 88.25 s; volcano: 0.95 × 92.14 s (src/ai/__tests__/calibration.test.ts).
  minLapMs: { istanbul: 79_800, lombardia: 74_000, bosphorus: 66_400, ardennes: 98_981, alpine: 73_000, cliff: 93_760, eifel: 256_800, aegean: 74_770, cappadocia: 83_840, volcano: 87_530 },
  maxStepsPerTick: 240,
  maxBufferedBytes: 64 * 1024,
};

/** Artificial latency for tests (`--net-delay <ms>`, design §6.2 T13): added to each direction of every socket. */
export interface NetDelayConfig {
  delayMs: number;
  /** Extra random 0..jitterMs per message (order is kept, as on TCP). */
  jitterMs: number;
  /** Percent of binary `state`/`states` messages dropped (simulated loss of an unreliable update). */
  lossPct: number;
}

export const NO_NET_DELAY: Readonly<NetDelayConfig> = { delayMs: 0, jitterMs: 0, lossPct: 0 };
