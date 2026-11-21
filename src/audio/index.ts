// Audio module façade (§4 modules.ts). Owner: Sürüş. Presentation layer (WebAudio).

export const MODULE_STATUS: string = 'real';

export { createAudioSystem } from './audioSystem';
export { createAudioGraph } from './graph';
export { renderEngineOffline, renderReplayAudio } from './offline';
export { applyLevel, bindVolumes, isSilent, liveVolumes, mediaVolume, volumeGain } from './volume';
