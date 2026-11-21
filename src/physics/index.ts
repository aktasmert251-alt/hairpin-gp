// Physics module façade (§4 modules.ts). Owner: Sürüş. Sim layer.

export const MODULE_STATUS: string = 'real';

export { createCollisionSystem, type CollisionOptions } from './collision/collisionSystem';
export {
  CONTACT_EPISODE_MS, CONTACT_J_MAX, CONTACT_STALE_MS, applyContactImpulse, contactAccumulate, contactApplied, contactCredit, contactScale, contactTopUp,
  createContactEpisodes, type ContactEpisodes,
} from './remote/contact';
export { defaultVehicleParams } from './params';
export { createPlayerInputSystem } from './input/playerInputSystem';
export { initVehicleState } from './state';
export { createVehicleSystem } from './vehicle/vehicleSystem';
