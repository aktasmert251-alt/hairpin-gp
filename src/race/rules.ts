// Race rule constants (docs/design/rules.md). Every number of the rules lives here (sim layer, no imports).

// §2 Start
export const GRID_HOLD_MS = 2000;
export const LIGHT_INTERVAL_MS = 1000;
export const LIGHTS_COUNT = 5;
export const LIGHTS_HOLD_MIN_MS = 200;
export const LIGHTS_HOLD_MAX_MS = 3000;
export const JUMP_START_M = 0.5;

// §3 Track limits
// Lenient by user request (D-033): an excursion needs all 4 wheels out AND the car centre LIMITS_MARGIN_M past the
// white line for EXCURSION_MIN_S; the black-and-white flag comes at the 5th strike.
export const EXCURSION_MIN_S = 0.5;
export const LIMITS_MARGIN_M = 0.75;
export const STRIKE_MIN_KMH = 60;
export const STRIKE_REJOIN_S = 6;
export const REARM_S = 1.0;
export const RECOVERY_EXEMPT_S = 3;
export const PIT_ENTRY_EXEMPT: readonly [number, number] = [-30, 60];
export const PIT_EXIT_EXEMPT: readonly [number, number] = [-60, 30];
export const BLACK_WHITE_STRIKE = 5;
export const TT_LAST_SEGMENT_M = 150;

// §4 Corner cutting
export const CUT_MARGIN_M = 1.0;
export const CUT_GAIN_FACTOR = 1.03;
export const CUT_PROFILE_FACTOR = 1.05;

// §5 Penalties
export const PENALTY_S = 5;
export const TWO_COMPOUND_PENALTY_S = 30;

// §6 Flags and DRS
export const YELLOW_SLOW_KMH = 40;
export const YELLOW_SLOW_S = 2;
/** Slow / stopped cars count only this long after lights out (every car starts from rest). */
export const YELLOW_START_GRACE_MS = 5000;
export const YELLOW_NEAR_TRACK_M = 15;
export const YELLOW_CLEAR_S = 3;
export const GREEN_PANEL_S = 3;
export const BLUE_GAP_S = 1.0;
export const BLUE_HOLD_S = 1.0;
/** Lapping cars further back than this (m) are not considered for blue flags. */
export const BLUE_SEARCH_M = 120;
export const DRS_ENABLE_LEADER_LAP = 3;
export const DRS_GAP_MS = 1000;
export const DRS_WET_OFF = 0.3;
export const DRS_WET_ON = 0.2;
export const DRS_WET_REENABLE_LAPS = 2;

// §7 Pit lane
export const PIT_LIMIT_KMH = 80;
export const PIT_SPEEDING_KMH = 80.5;
export const PIT_SPEEDING_S = 0.2;

// §8 Two-compound rule
export const TWO_COMPOUND_MIN_LAPS = 10;
export const TWO_COMPOUND_WET_LIFT = 0.12;

// §9 Finish
export const FINISH_WINDOW_MS = 120_000;
export const RESULTS_AFTER_PLAYER_FINISH_S = 4;
export const POINTS: readonly number[] = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

// D-040 Wrong way: faster than WRONG_WAY_KMH with heading·tangent < WRONG_WAY_DOT for WRONG_WAY_ON_S → warning;
// cleared after WRONG_WAY_OFF_S with a forward heading. No penalty in a race; invalidates the Time Trial lap.
export const WRONG_WAY_KMH = 10;
export const WRONG_WAY_DOT = -0.5;
export const WRONG_WAY_ON_S = 1.5;
export const WRONG_WAY_OFF_S = 1;

// D-056 Collision penalties: a car-car contact of at least COLLISION_MIN_J (N·s) where one car is at fault (rear-end: in line and
// closing; divebomb: behind and not alongside, from the side, in a corner; push: moving sideways into a car alongside) is judged
// over COLLISION_WINDOW_S: victim spun / off track / stopped = heavy (+10 s); otherwise the first at-fault contact is a warning,
// later ones +5 s (a push without consequence is free). One incident per pair per COLLISION_PAIR_COOLDOWN_S.
export const COLLISION_MIN_J = 2600;
/** Contacts in the first seconds after lights out need this factor more impulse (lap-1 bumps). */
export const COLLISION_START_S = 20;
export const COLLISION_START_FACTOR = 1.6;
export const COLLISION_WINDOW_S = 2.5;
export const COLLISION_PAIR_COOLDOWN_S = 4;
/** In line: lateral offset below this (m). */
export const COLLISION_INLINE_M = 1.2;
/** Alongside: the attacker's centre is less than this far behind the other car's centre (m). */
export const COLLISION_ALONGSIDE_M = 3.0;
/** Minimum closing speed along the track for a rear-end / divebomb (m/s). */
export const COLLISION_CLOSING_MS = 2.5;
/** Push: the attacker moves sideways into the other car this much faster (m/s). */
export const COLLISION_PUSH_MS = 1.5;
/** Corner for a divebomb: |track curvature| above this (1/m) within COLLISION_CORNER_LOOK_M ahead. */
export const COLLISION_CORNER_K = 1 / 220;
export const COLLISION_CORNER_LOOK_M = 60;
/** Victim consequences: heading off the track tangent by more than this (rad), off track, or slower than STOP (m/s). */
export const COLLISION_SPIN_RAD = 1.2;
export const COLLISION_STOP_MS = 5;
export const COLLISION_PENALTY_S = 5;
export const COLLISION_HEAVY_S = 10;

// D-056 Safety car: deployed when a stopped / crashed car (yellow cause) has not cleared the track SC_DELAY_S after its yellow.
export const SC_DELAY_S = 10;
/** SC car speed: a share of the racing-line speed profile, capped (m/s); it starts this far ahead of the leader (m). */
export const SC_LINE_FACTOR = 0.62;
export const SC_SPEED_MAX = 50;
export const SC_ACCEL = 8;
export const SC_START_AHEAD_M = 250;
/** Queue: gap kept to the car ahead (m), catch-up speed (m/s) and the gain of the gap controller (1/s). */
export const SC_QUEUE_GAP_M = 25;
export const SC_CATCHUP_MS = 60;
export const SC_GAP_GAIN = 0.6;
/** Cars slower than this (m/s) are not queued behind (stopped / crashed / recovering). */
export const SC_QUEUE_MIN_MS = 8;
/** The SC comes in after SC_MIN_LAPS leader laps with the track clear (SC_MAX_LAPS at most once clear). */
export const SC_MIN_LAPS = 1;
export const SC_MAX_LAPS = 2;
/** In its last lap the SC leaves the track this far before the line (pit entry). */
export const SC_PIT_IN_M = 400;
/** Marshals remove a retired car from the circuit this long after it retired (s); it is parked at PARK_X (m), off the map. */
export const SC_CLEAR_RETIRED_S = 20;
export const PARK_X = 1e5;
/** Overtaking under the SC is penalised when the passed car was racing faster than this (m/s); cooldown between penalties (s). */
export const SC_OVERTAKE_MIN_MS = 15;
export const SC_OVERTAKE_COOLDOWN_S = 5;
/** A pass completed within this long (ms) of the SC deployment is free when the two cars overlapped (progress gap < m) then. */
export const SC_DEPLOY_PASS_MS = 2000;
export const SC_DEPLOY_OVERLAP_M = 5.5;

// §11 Flashback
export const FLASHBACK_WINDOW_S = 15;
export const FLASHBACK_MIN_HISTORY_S = 1;
