import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultSessionConfig } from '../../game/index';
import { createStore } from '../../core/store';
import type { ScreenCtx } from '../screens/ctx';

const key = 'apexgp:v1:lastRaceSetup';
afterEach(() => { vi.unstubAllGlobals(); });

describe('quick race setup persistence', () => {
  it.each([true, false])('restores the safety car option %s after a reload', async (safetyCar) => {
    vi.resetModules();
    const entries = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => entries.get(k) ?? null, setItem: (k: string, v: string) => entries.set(k, v) });
    const { saveLastSetup } = await import('../screens/raceSetup');
    saveLastSetup(defaultSessionConfig({ safetyCar }));
    vi.resetModules();
    const { primeSetup } = await import('../screens/raceSetup');
    const setup = createStore(defaultSessionConfig());
    primeSetup({ deps: { setup, settings: { get: () => ({ gameplay: { difficulty: 55, flashbacks: 3 }, assists: {} }) } } } as unknown as ScreenCtx);
    expect(setup.get().safetyCar).toBe(safetyCar);
  });
  it.each([19, 7, 1])('remembers Off and the last positive count %i in the existing setup entry', async (count) => {
    vi.resetModules();
    const entries = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => entries.get(k) ?? null, setItem: (k: string, v: string) => entries.set(k, v) });
    const { saveLastSetup } = await import('../screens/raceSetup');
    saveLastSetup(defaultSessionConfig({ aiCount: count }));
    saveLastSetup(defaultSessionConfig({ aiCount: 0 }));
    expect(JSON.parse(entries.get(key)!)).toMatchObject({ aiCount: 0, lastAiCount: count });

    vi.resetModules();
    const { primeSetup, saveLastSetup: saveAfterReload } = await import('../screens/raceSetup');
    const setup = createStore(defaultSessionConfig());
    primeSetup({ deps: { setup, settings: { get: () => ({ gameplay: { difficulty: 55, flashbacks: 3 }, assists: {} }) } } } as unknown as ScreenCtx);
    expect(setup.get().aiCount).toBe(0);
    expect(setup.get()).not.toHaveProperty('lastAiCount');
    saveAfterReload(setup.get());
    expect(JSON.parse(entries.get(key)!)).toMatchObject({ aiCount: 0, lastAiCount: count });
  });

  it('reads an older saved setup without toggle metadata', async () => {
    vi.resetModules();
    const entries = new Map([[key, JSON.stringify({ aiCount: 6 })]]);
    vi.stubGlobal('localStorage', { getItem: (k: string) => entries.get(k) ?? null, setItem: (k: string, v: string) => entries.set(k, v) });
    const { primeSetup, saveLastSetup } = await import('../screens/raceSetup');
    const setup = createStore(defaultSessionConfig());
    primeSetup({ deps: { setup, settings: { get: () => ({ gameplay: { difficulty: 55, flashbacks: 3 }, assists: {} }) } } } as unknown as ScreenCtx);
    expect(setup.get().aiCount).toBe(6);
    expect(setup.get().safetyCar).toBe(true);
    saveLastSetup({ ...setup.get(), aiCount: 0 });
    expect(JSON.parse(entries.get(key)!)).toMatchObject({ aiCount: 0, lastAiCount: 6 });
  });
});
