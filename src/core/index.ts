// Core module façade (YÖN) for other owners (TEAM-RULES §1, S-AR-06: no deep imports across owners).

export { ASSIST_PRESETS, SETTINGS_VERSION, STORAGE_KEYS, autoHudScale, defaultSettings, defaultTouchSettings } from './settings/defaults';
export { needsRotate } from './platform/screen';
export { PROJECT_URL, projectUrl, publicUrl } from './project';
