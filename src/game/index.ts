// Game module (YÖN): canonical sim factory and session glue.

export {
  PERFECT_PROFILE, PLAYER_CAR_ID, assignGrid, buildLineup, createSim, defaultSessionConfig, neutralControls, neutralInput, startCompoundFor,
} from './createSim';
export { buildResults } from './results';
export { availableRaceTracks, loadRaceTrack, resolveTrackId } from './tracks';
export { storedTimeTrial } from './timeTrial';
export { hashState, deepAssign, findNonFinite } from './sim/stateUtils';
// CR-01: replay factories (bodies in L8).
export { createReplayRecorder, createReplayPlayer, decodeReplay, encodeReplay } from './replay/index';
