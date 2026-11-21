// Sim layer: the shape of one track's authoring table (tracks.md §1.3). Every s is on the track's OSM (or authored)
// basis length OSM_LENGTH and is rescaled to the built length (s_final = s · L / OSM_LENGTH).

import type { RaceTrackId, WallKind } from '../../contracts/track';

/** Tracks with a registry source: the contract's RaceTrackId. */
export type BuiltTrackId = RaceTrackId;

export type RunoffKind = 'asphalt' | 'painted' | 'gravel';

export interface CornerDef {
  n: number;
  dir: 'L' | 'R';
  entry: number;
  /** One or more apexes (İstanbul T8 has three); the contract's apexS is the middle one. */
  apexes: number[];
  exit: number;
  /** Approximate apex speed, km/h (run-off width = clamp(0.12·v, 10, 45) m). */
  vApex: number;
  /** Banking into the corner, degrees. */
  bankDeg: number;
  runoff: RunoffKind;
  /** Gravel starts after a 3 m asphalt band on this s range (defaults to the whole run-off). */
  gravelFrom?: number;
  /** Barrier kind on the outside (impact zones get tyres / TecPro). */
  outsideWall: WallKind;
  sausage: boolean;
  /** Minimum barrier clearance from the track edge on the outside, m. */
  minClear: number;
  cutZone: boolean;
  /** Street circuits: outside run-off width override, m (0 = none; default clamp(0.12·vApex, 10, 45)). */
  runoffW?: number;
  /** Street circuits: outside wall at hw + wallD (overrides minClear and the run-off rule). */
  wallD?: number;
}

/** Escape road (street circuit): a closed asphalt wall pocket on one side over [from, to]. */
export interface EscapeDef { from: number; to: number; side: 1 | -1; depth: number; kind: WallKind }

/** Scenery theme (tracks.md §1.4): only fields the scenery reads. */
export interface TrackTheme {
  /** Terrain splat palette; 'urban' = paving + sparse grass verges. */
  ground: 'golden' | 'green' | 'urban' | 'alpine' | 'desert' | 'island' | 'valley' | 'volcanic';
  /** Species weights inside OSM forest polygons: pine, cypress, oak, broadleaf, spruce (optional, default 0). */
  forestMix: readonly [number, number, number, number, number?];
  /** Fill spacing inside forest polygons, m. */
  forestSpacing: number;
  /** Scatter spacing outside forests (0 = none). */
  openTreeSpacing: number;
  /** Species weights of the open scatter. */
  openMix: readonly [number, number, number, number, number?];
  /** Minimum tree distance from the barriers, m. */
  treeSetback: number;
  /** Cap on tree instances (3D + billboards share the list). */
  maxTrees: number;
  /** `skip` (optional): authoring-basis s ranges without poles (tunnels). */
  lights: { height: number; spacing: number; bothSides: boolean; head: 'flood' | 'street'; skip?: readonly { from: number; to: number }[]; color?: number };
  /** 'alpine': a far ring of high snowy peaks (terrain.ts) and a raised sky silhouette. */
  backdrop: 'residential' | 'parkland' | 'city' | 'alpine' | 'desert' | 'islands' | 'valley' | 'volcanic';
  sea: null | { y: number };
  /** Distance culling on a small but open map (optional): track-surface chunks beyond `surface` m and barrier / trackside /
   *  stand cells beyond `statics` m (bounding-sphere distance) are hidden. Large maps (> 4 km) have their own. */
  cull?: { surface: number; statics: number };
  /** Sea bridges: low parapets (0.5 m) with a slim railing instead of catch fences on elevated decks (barriers.ts). */
  bridgeRailing?: boolean;
  /** Street trees (species 3) every `spacing` m on one side, `d` m beyond the wall (city circuits). */
  streetTrees?: readonly { from: number; to: number; side: 1 | -1; d: number; spacing: number }[];
  /** Large maps: forest farther than `near` m from the road is filled at `spacing` m (billboard-scale trees on the DEM)
   *  instead of forestSpacing, and open-country scatter stops there. */
  treeFar?: { near: number; spacing: number };
  /** City outskirts on the horizon (scenery/outskirts.ts): estates of towers on an arc around a compass bearing
   *  (0 = north), `distance` m beyond the track's extent along that bearing, clamped to the DEM area. */
  outskirts?: { bearingDeg: number; arcDeg: number; distance: readonly [number, number]; clusters: number };
}

export interface PitAuthoring {
  limitStartSp: number;
  limitEndSp: number;
  speedLimitKmh: 80;
  firstBoxSp: number;
  boxSpacing: number;
  /** Main-centreline offset magnitudes along the pit straight (the sign comes from `side`). */
  fastLaneMainD: number;
  workingLaneMainD: number;
  garageFrontMainD: number;
  pitWallFaceMainD: number;
  pitWallThickness: number;
  /** Ribbon half-width in the two-lane (box) section and in the single-lane entry/exit. */
  wideHalfWidth: number;
  narrowHalfWidth: number;
  /** Main s range (wraps) where the pit lane runs parallel to the main track. */
  straightFrom: number;
  straightTo: number;
  endBlend: number;
  /** Minimum gap from the outermost band to the pit-wall face, m (default 1). */
  minWallGap?: number;
  /** Main-line search window (m) when walking the pit lane (default 60; more when the pit cuts behind a hairpin). */
  projectWindow?: number;
  /** Re-draw the pit entry: leave the main edge at OSM-basis main s `fromS` along the main tangent and join the OSM pit
   *  polyline `joinSp` m along it (Ardennes: the OSM entry branches off mid-chicane, unreachable for a braking car). */
  entryRedraw?: { fromS: number; joinSp: number };
  /** Stop the pit wall where it would run within 3 m of the lane edge on the outside of a lane bend tighter than 35 m. */
  wallClearOfBends?: boolean;
  /** +1 = pit on the left of the main track (İstanbul), −1 = on the right. */
  side: 1 | -1;
}

export interface TrackAuthoring {
  id: BuiltTrackId;
  name: { tr: string; en: string };
  OSM_LENGTH: number;
  CORNERS: readonly CornerDef[];
  /** Half-widths per s range; `from > to` wraps through S/F. Later rows win; transitions smoothstep over WIDTH_BLEND. */
  WIDTHS: readonly { from: number; to: number; hw: number }[];
  WIDTH_BLEND: number;
  /** Raw-arc ranges (from < to, raw metres from the S/F node) re-drawn as tangent–arc(r)–tangent before the build: OSM
   *  hairpins tighter than the 19.5 m centreline limiter can open on its own. */
  CENTRE_FILLETS?: readonly { from: number; to: number; r: number }[];
  /** Gaussian σ (m) of the centreline elevation smoothing. */
  ELEVATION_SIGMA: number;
  /** Half-window (raw samples) of a running median applied before the smoothing; 0 = off. */
  ELEVATION_MEDIAN: number;
  SECTOR2_S: number;
  SECTOR3_S: number;
  SPEED_TRAP_S: number;
  DRS_ZONES: readonly { id: number; detect: number; activate: number; end: number }[];
  PIT: PitAuthoring;
  /** P_k at s = L − first − spacing·k, d = ±d; the pole slot is on `poleSide`. */
  GRID: { first: number; spacing: number; d: number; slots: 20; poleSide: 1 | -1 };
  /** Verges: straights; the main straight on the side away from the pit (over mainStraightFrom → To); corner insides. */
  VERGE: { straight: number; mainStraightOpp: number; mainStraightFrom: number; mainStraightTo: number; inside: number; base?: 'grass' | 'concrete' };
  /** Barrier kind where no corner / extra wall sets one (default armco). */
  DEFAULT_WALL?: WallKind;
  /** Tunnels (optional): s ranges with walls at hw + wallD (kind) on both sides and no run-off or kerbs; the scenery
   *  builds the bore (scenery/alpine.ts). */
  TUNNELS?: readonly { from: number; to: number; wallD: number; kind: WallKind }[];
  /** Elevated decks (optional, Desert Cliff ramp): s ranges where the road is a structure above the ground. The ground
   *  height keeps the natural terrain under them (no embankment) and the scenery builds the deck (scenery/cliff.ts).
   *  With `wallD`, walls of `kind` at hw + wallD on both sides and no run-off, kerbs or verge grass (like TUNNELS). */
  DECKS?: readonly { from: number; to: number; wallD?: number; kind?: WallKind }[];
  /** Bumpy sections (optional, Cappadocia village street): the driving surface carries a deterministic washboard of
   *  `amp` m (two harmonics around `wave` m, faded in/out over 10 m) on [from, to]. Physics feels it through ground();
   *  the meshes stay flat (a few cm). */
  BUMPS?: readonly { from: number; to: number; amp: number; wave: number }[];
  /** Fall zones (optional, Volcano Rim): on `side` over [from, to] there is no barrier, only the lip line at hw + `lip`
   *  (TrackData.wall* = the reset line − 5 m); beyond it the ground drops away (query + terrain), and a car that goes
   *  over is reset by the collision system's 'beyond the barrier line' rule. */
  FALLS?: readonly { from: number; to: number; side: 1 | -1; lip: number }[];
  /** Volcanic ash on the racing surface (optional): inside the track limits over [from, to] the surface is 'ash'. */
  ASH?: readonly { from: number; to: number }[];
  /** Escape-road pockets (street circuits). */
  ESCAPES?: readonly EscapeDef[];
  /** Authored stands (no OSM footprint): s range, side, setback from the track edge and depth, m. */
  STANDS?: readonly { from: number; to: number; side: 1 | -1; setback: number; depth: number; kind: 'grandstand' | 'bleachers' }[];
  KERB: { inside: number; exit: number; astroturf: number; sausage: number; sausageGap: number; gravelAsphalt: number };
  /** Spectator areas: concrete wall + catch fence on the given side (+1 left, −1 right). */
  SPECTATOR_WALLS: readonly { from: number; to: number; side: 1 | -1 }[];
  /** Authored puddle spots for GroundHit.wetLocal = 2. */
  PUDDLES: readonly { s: number; d: number; len: number; width: number }[];
  /** Barrier-kind overrides on one side (impact zones not covered by a corner's outsideWall). */
  EXTRA_WALLS: readonly { from: number; to: number; kind: WallKind; side: 1 | -1 }[];
  TRACKSIDE: {
    /** Perimeter-board runs. `sponsors` (3 atlas indices, A-B-A) is optional; otherwise picked from the track id. */
    boardStraights: readonly { from: number; to: number; side: 1 | -1; sponsors?: readonly [number, number, number] }[];
    /** Banner gantries across the track. */
    gantries: readonly number[];
    /** Distance and braking boards before these corners, on `side`. */
    distanceBoardCorners: readonly { n: number; side: 1 | -1 }[];
    /** Corners whose outside run-off carries the painted series wordmark. */
    wordmarkCorners: readonly number[];
  };
  /** OSM footprint ids replaced by procedural scenery (e.g. the real pit building). */
  HIDE_FEATURES: readonly number[];
  THEME: TrackTheme;
}
