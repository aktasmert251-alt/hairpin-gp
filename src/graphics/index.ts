// Graphics module façade (contracts/modules.ts GraphicsModule). Owner: Grafik-3B.
// H2 (sprint-1.md): real GraphicsSystem + QUALITY_PRESETS; G5 car visuals, G6 camera rig, G7 VFX, G8 racing line.

export const MODULE_STATUS: string = 'real';

export { createCameraRig, CAMERA_ORDER } from './camera/cameraRig';
export type { CameraRigImpl } from './camera/cameraRig';
export { createCarVisuals } from './car/carVisuals';
export type { CarVisualsImpl } from './car/carVisuals';
export { createGraphicsSystem } from './renderer/graphicsSystem';
export type { GraphicsSystemImpl } from './renderer/graphicsSystem';
export { createRacingLineVisual } from './racingLine/racingLineVisual';
export { createVfx } from './vfx/vfxSystem';
export type { VfxSystemImpl } from './vfx/vfxSystem';
export { QUALITY_PRESETS, mobilePreset } from './presets';
// CR-15 (G2): main-menu showroom.
export { createShowroom } from './showroom/showroom';
export type { ShowroomImpl } from './showroom/showroom';
