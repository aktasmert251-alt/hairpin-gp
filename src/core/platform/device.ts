// Device profile (mobile, 2026-11-21): touch / phone detection and the mobile quality default. Pure over an injectable
// environment so tests can describe any device; detectDevice() reads the real browser once at boot.
// Desktop stays exactly as before: only a touch-only device (coarse primary pointer, no fine pointer, no hover) or a
// mobile user agent counts as mobile; touchscreen laptops keep their mouse defaults.

import type { QualityId } from '../../contracts/common';
import type { DeviceProfile } from '../../contracts/input';

export interface DeviceEnv {
  /** matchMedia(query).matches */
  media(query: string): boolean;
  maxTouchPoints: number;
  userAgent: string;
  /** navigator.userAgentData.mobile when available (Chromium). */
  uaMobile?: boolean;
  hardwareConcurrency?: number;
  /** navigator.deviceMemory (GB, Chromium). */
  deviceMemory?: number;
  /** WEBGL_debug_renderer_info string ('' when hidden). */
  gpu?: string;
  secure: boolean;
}

const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i;
/** GPUs that keep a phone at the low tier (older Mali / Adreno 5xx and below, PowerVR, software). */
const WEAK_GPU = /Mali-(T\d+|G5\d|G7[0-2])\b|Adreno \(TM\) [1-5]\d\d\b|PowerVR|SwiftShader|llvmpipe/i;
/** GPUs good enough for the medium preset (Apple GPUs from A15, Adreno 7xx, recent Mali Immortalis / G7xx). */
const STRONG_GPU = /Apple GPU|Adreno \(TM\) [78]\d\d|Immortalis|Mali-G7[1-9]\d|Mali-G(7[6-9]|[89]\d)\b|Xclipse/i;

export function profileFrom(env: DeviceEnv): DeviceProfile {
  const coarse = env.media('(pointer: coarse)');
  const fine = env.media('(any-pointer: fine)');
  const hover = env.media('(any-hover: hover)');
  const touch = env.maxTouchPoints > 0 || coarse;
  // iPadOS reports a desktop Safari UA: Mac + touch points.
  const ios = /iPhone|iPad|iPod/i.test(env.userAgent) || (/Macintosh/i.test(env.userAgent) && env.maxTouchPoints > 1);
  const touchOnly = touch && coarse && !fine && !hover;
  const mobile = env.uaMobile === true || (MOBILE_UA.test(env.userAgent) && touch) || ios || touchOnly;
  let tier: DeviceProfile['tier'] = 'high';
  if (mobile) {
    const cores = env.hardwareConcurrency ?? 4;
    // Safari exposes no deviceMemory: recent iPhones / iPads have >= 6 GB.
    const mem = env.deviceMemory ?? (ios ? 6 : 4);
    const gpu = env.gpu ?? '';
    if (WEAK_GPU.test(gpu) || cores <= 4 || mem < 4) tier = 'low';
    else if (STRONG_GPU.test(gpu) && cores >= 6 && mem >= 6) tier = 'high';
    else tier = 'mid';
  }
  return { touch, touchOnly, mobile, ios, tier, secure: env.secure };
}

/** First-run quality on this device (desktop: 'high' as before; mobile: low, medium on strong phones). */
export function defaultQualityFor(p: DeviceProfile): QualityId {
  if (!p.mobile) return 'high';
  return p.tier === 'high' ? 'medium' : 'low';
}

function readGpu(): string {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') ?? c.getContext('webgl');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const s = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return typeof s === 'string' ? s : '';
  } catch {
    return '';
  }
}

let cached: DeviceProfile | null = null;

/** The real browser's profile (cached). Node / tests without a window: a desktop profile. */
export function detectDevice(): DeviceProfile {
  if (cached) return cached;
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    cached = { touch: false, touchOnly: false, mobile: false, ios: false, tier: 'high', secure: false };
    return cached;
  }
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean }; deviceMemory?: number };
  const media = (q: string): boolean => {
    try {
      return typeof window.matchMedia === 'function' && window.matchMedia(q).matches;
    } catch {
      return false;
    }
  };
  const base: DeviceEnv = {
    media, maxTouchPoints: nav.maxTouchPoints ?? 0, userAgent: nav.userAgent ?? '', uaMobile: nav.userAgentData?.mobile,
    hardwareConcurrency: nav.hardwareConcurrency, deviceMemory: nav.deviceMemory, secure: window.isSecureContext === true,
  };
  // The GPU string costs a context: only read it when the device looks mobile already.
  const first = profileFrom(base);
  cached = first.mobile ? profileFrom({ ...base, gpu: readGpu() }) : first;
  return cached;
}
