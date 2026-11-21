// Contract: online multiplayer protocol (CR-NET-9, docs/design/multiplayer.md §8, D-043). Implemented by: Yönetici
// (src/net/protocol.ts codecs + validators, src/net/clock.ts) and Sunucu (server/**). Pure types plus three runtime
// constants (arch exception like D-025); every other protocol number lives in src/net/protocol.ts (NET_LIMITS, message codes).

import type { Compound, TimeOfDay, WeatherPreset } from './common';
import type { CarRaceState, PenaltyReason } from './race';
import type { RaceTrackId } from './track';

// Runtime constants (CR-NET-9), like REPLAY_HZ in replay.ts.
/** Bumped on any wire change; a mismatch in `hello` → error{code:'version'}. */
export const PROTOCOL_VERSION = 2;
/** Size of one binary `state` message (0x10) and of one batch entry (0x90). */
export const NET_STATE_BYTES = 40;
/** Client state send rate and server room tick (Hz). */
export const NET_HZ = 20;

/**
 * Room-local car id 0..127 (7 bits). Humans get one at `welcome`; the server also gives every server-simulated AI car
 * (D-043) an id from the same space. In binary messages bit 7 of the id byte marks a server-sourced (AI) car.
 */
export type NetId = number;

export type NetRoomPhase = 'lobby' | 'loading' | 'countdown' | 'racing' | 'finishing' | 'results';
export type NetLaps = 1 | 3 | 5 | 10;

/** Visibility defaults to public when omitted (legacy local setup literals); parsed snapshots always include it.
 * Owner-chosen race settings (D-043). `aiCount` = AI cars that fill empty grid slots (server clamps to 20 − humans). */
export interface NetRoomSettings {
  visibility?: 'public' | 'private'; trackId: RaceTrackId; laps: NetLaps; tod: TimeOfDay; weather: WeatherPreset; aiCount: number; difficulty: number;
  /** D-061 race mode (default 'normal'; parsed snapshots always include it). */
  mode?: NetRaceMode;
}

/** D-061: 'normal' = every rule (penalties, safety car); 'kasap' = no penalties or warnings of any kind, no safety car. */
export type NetRaceMode = 'normal' | 'kasap';

/** D-062 custom team (online): `primary`/`secondary`/`accent` are palette ids (src/data/teamPalette); `baseTeamId` = the car / grid seats it takes. */
export interface NetCustomTeam { id: string; name: string; baseTeamId: string; primary: string; secondary: string; accent: string; finish: 'gloss' | 'matte' | 'metallic' }

/** D-062: a custom team in a room and the player who created (and edits) it. */
export interface NetCustomTeamEntry { ownerId: NetId; team: NetCustomTeam }

/** Public directory entry (D-052); non-lobby phases display as racing and cannot be joined. */
export interface NetRoomListing {
  code: string; track: RaceTrackId; laps: NetLaps; weather: WeatherPreset; tod: TimeOfDay;
  humans: number; capacity: number; state: 'lobby' | 'racing'; owner: string;
  /** D-061 (absent = normal). */
  mode?: NetRaceMode;
}

/** Lobby card (humans only). */
export interface NetPlayerInfo { id: NetId; name: string; teamId: string; driverIdx: 0 | 1; ready: boolean; connected: boolean; pingMs: number }

/** Frozen grid entry sent in `load`. `kind: 'ai'` = simulated on the server and streamed like a human (D-043). */
export interface NetRosterEntry { id: NetId; kind: 'human' | 'ai'; name: string; teamId: string; driverIdx: 0 | 1; gridSlot: number }

/** Frozen race config of `load` (design §5.1). */
export interface NetRaceConfig extends NetRoomSettings { seed: number }

/** ResultsModel row with the car index replaced by the NetId. */
export interface NetResultRow {
  pos: number; id: NetId; name: string; teamId: string; totalMs: number; gapMs: number; lapsDown: number; bestLapMs: number; stops: number;
  penaltySec: number; points: number; status: CarRaceState['status'];
}

/** D-056: 'collision' / 'safetyCar' = client-judged penalties of the reporting car. */
export type NetReportKind = 'trackLimits' | 'cornerCut' | 'pitSpeeding' | 'lapInvalidated' | 'collision' | 'safetyCar';
/** D-050: 'maintenance' = the admin closed new rooms / joins (answer to create / join). */
export type NetErrorCode = 'full' | 'notFound' | 'badName' | 'taken' | 'version' | 'rate' | 'badMessage' | 'phase' | 'maintenance';

/** D-050: why the server removed this player (sent as `kicked` just before closing with 4001 / 4003). */
export type NetKickReason = 'kicked' | 'banned';

/** JSON control messages, client → server (multiplayer-tasks §C). */
export type NetClientMsg =
  /** D-050 `deviceId`: random per-browser id (^[A-Za-z0-9_-]{16,64}$) used only for bans. */
  | { type: 'hello'; v: number; build: string; name: string; resume?: string; deviceId?: string }
  | { type: 'create'; settings: NetRoomSettings }
  | { type: 'join'; code: string }
  | { type: 'listRooms' }
  | { type: 'quickJoin' }
  | { type: 'leave' }
  | { type: 'setCar'; teamId: string; driverIdx: 0 | 1 }
  /** D-062: create / edit (own) or drop (null) the player's custom team; the player takes a seat of its base team. */
  | { type: 'setTeam'; team: NetCustomTeam | null }
  | { type: 'setReady'; ready: boolean }
  | { type: 'setSettings'; settings: NetRoomSettings }
  | { type: 'start' }
  | { type: 'loaded'; trackHash: string }
  | { type: 'report'; kind: NetReportKind; seconds?: number; lap: number }
  | { type: 'retire' }
  | { type: 'backToLobby' };

/** JSON control messages, server → client. `id` fields name humans and AI cars alike. */
export type NetServerMsg =
  | { type: 'welcome'; id: NetId; resumeToken: string; serverMs: number; limits: { maxPlayers: number; hz: number } }
  | { type: 'room'; code: string; ownerId: NetId; phase: NetRoomPhase; settings: NetRoomSettings; players: NetPlayerInfo[]; teams?: NetCustomTeamEntry[] }
  | { type: 'rooms'; rooms: NetRoomListing[] }
  | { type: 'error'; code: NetErrorCode }
  /** D-062 `teams`: the race's custom teams (cars of `baseTeamId` show that name / livery). */
  | { type: 'load'; raceId: string; config: NetRaceConfig; roster: NetRosterEntry[]; lightsOutAtMs: number; teams?: NetCustomTeam[] }
  | { type: 'start'; t0ServerMs: number }
  | { type: 'lap'; id: NetId; lap: number; ms: number; valid: boolean; bestMs: number }
  | { type: 'penalty'; id: NetId; seconds: number; reason: PenaltyReason }
  | { type: 'standings'; order: NetId[]; laps: number[]; gapMs: number[]; status: CarRaceState['status'][] }
  | { type: 'finishing'; byId: NetId; windowMs: number }
  | { type: 'player'; id: NetId; connected: boolean; stale: boolean }
  | { type: 'results'; rows: NetResultRow[] }
  /** D-050: admin notice to every player (≤ 200 chars; '' = cleared). Sent on change and after `welcome`. */
  | { type: 'notice'; text: string }
  /** D-050: sent just before the socket closes with 4001 (kicked) / 4003 (banned). `until` = ban end (epoch ms, Date.now clock), null = permanent / kick. */
  | { type: 'kicked'; reason: NetKickReason; until?: number | null };

/**
 * Decoded binary `state` (0x10, 40 B) / batch entry (0x90). Units as SimCarState.vehicle; quantised on the wire
 * (design §8.2). Reused as an `out` object by the codecs (allocation-free).
 */
export interface NetCarState {
  /** Batch only: the car's NetId (7 bits) and whether the server simulates it (AI, D-043). */
  id: NetId; fromServer: boolean;
  /** Bitfield, NET_FLAG_* in src/net/protocol.ts. */
  flags: number;
  seq: number; simMs: number;
  x: number; y: number; z: number; progress: number; yaw: number; vx: number; vz: number; yawRate: number;
  steerAngle: number; throttle: number; brake: number; gear: number; rpm: number; drsFlap: number;
  compound: Compound; ersDeploying: boolean;
}

/** Binary `contact` (0x11 C→S / 0x91 S→C, 28 B). `other` = the hit car (C→S) or the source car (S→C). */
export interface NetContact {
  other: NetId; fromServer: boolean; seq: number; simMs: number;
  /** Impulse magnitude N·s along n (sender → other). */
  j: number; nx: number; nz: number; px: number; pz: number;
  /** Relative normal velocity m/s. */
  vRelN: number; episode: number;
}

/** Numeric validation thresholds shared by client and server (design §7). Values: NET_LIMITS in src/net/protocol.ts. */
export interface NetLimits {
  maxCoordM: number; maxSpeedMs: number; hardSpeedMs: number; teleportM: number; displacementSlackM: number;
  simAheadMs: number; simLagMs: number; trackDeltaSM: number; escapeM: number; resetProgressM: number;
  contactJMax: number; contactWindowMs: number; contactsPerPairPerS: number; contactsPerPlayerPerS: number;
  maxClientJsonBytes: number; maxServerJsonBytes: number; maxBatchCars: number;
  nameMin: number; nameMax: number; roomCodeLength: number;
}

/** UI store fed by the netClient (CR-NET-3). */
export interface NetLobbyModel {
  status: 'offline' | 'connecting' | 'online' | 'reconnecting' | 'error';
  error: NetErrorCode | null;
  myId: NetId | null;
  room: { code: string; ownerId: NetId; phase: NetRoomPhase; settings: NetRoomSettings; players: NetPlayerInfo[]; teams?: NetCustomTeamEntry[] } | null;
  /** 3-2-1 overlay: server time of the start (null when not counting down). */
  t0ServerMs: number | null;
  /** D-050: current admin notice (absent / null = none). */
  notice?: string | null;
  /** D-050: removed by the admin; the client does not reconnect (absent / null = not kicked). */
  kicked?: { reason: NetKickReason; until: number | null } | null;
  /** D-052 public directory, replaced on each rooms reply. */
  rooms?: NetRoomListing[];
  rttMs: number;
}

/** `__APEX__.net()` (CR-NET-4). */
export interface NetStats { state: NetLobbyModel['status']; rttMs: number; offsetMs: number; sent: number; recv: number; dropped: number; staleCars: number }
