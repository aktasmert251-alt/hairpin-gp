// S-SM-03 single-writer rule (ARCHITECTURE §4.1/§4.2): each system writes only its own row of the §4.1 table.
//
// Method: `createSim` builds the systems from the module factories. This file wraps those factories (vi.mock) so that every
// `step()` is bracketed by a deep copy of `world.state` before and a field-by-field diff after. The set of changed paths per system
// is then compared with the writes the table allows. Additionally `world.static.config` and `world.static.params` are deep-frozen,
// so any system that writes them throws (strict mode) and the test fails with the stack trace.
//
// Runs 600 ticks of a 20-car field from the grid (lights on), then 1800 ticks of a skipLights race with the player on the keyboard
// path (controls injected between ticks the way latchControls does). Passes on stubs; reports violations by system and path.

import { describe, expect, it, vi } from 'vitest';
import type { SimCarState, SimState, SimSystem } from '../../src/contracts/sim';

interface Recorder { wrap(label: string, sys: SimSystem): SimSystem }
const rec = vi.hoisted((): { current: Recorder | null } => ({ current: null }));

vi.mock('../../src/physics/index', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../src/physics/index')>();
  return {
    ...m,
    createPlayerInputSystem: () => (rec.current ? rec.current.wrap('playerInput', m.createPlayerInputSystem()) : m.createPlayerInputSystem()),
    createVehicleSystem: () => (rec.current ? rec.current.wrap('vehicle', m.createVehicleSystem()) : m.createVehicleSystem()),
    createCollisionSystem: () => (rec.current ? rec.current.wrap('collision', m.createCollisionSystem()) : m.createCollisionSystem()),
  };
});
vi.mock('../../src/ai/index', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../src/ai/index')>();
  return { ...m, createAISystem: (ai: Parameters<typeof m.createAISystem>[0]) => (rec.current ? rec.current.wrap('ai', m.createAISystem(ai)) : m.createAISystem(ai)) };
});
vi.mock('../../src/race/index', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../src/race/index')>();
  return {
    ...m,
    createConditionsSystem: () => (rec.current ? rec.current.wrap('conditions', m.createConditionsSystem()) : m.createConditionsSystem()),
    createRaceDirector: () => (rec.current ? rec.current.wrap('race', m.createRaceDirector()) : m.createRaceDirector()),
    createSnapshotSystem: (h: Parameters<typeof m.createSnapshotSystem>[0]) => (rec.current ? rec.current.wrap('snapshot', m.createSnapshotSystem(h)) : m.createSnapshotSystem(h)),
  };
});

// Imported after the mocks are registered (vi.mock is hoisted above all imports).
import { readinessSummary } from '../helpers/readiness';
import { SEEDS, deepFreeze, makeSim } from '../helpers/sim';

// ---- diff -----------------------------------------------------------------------------------------------------------------------

type Bag = Record<string, unknown>;

function isTyped(v: unknown): v is ArrayLike<number> {
  return ArrayBuffer.isView(v) && !(v instanceof DataView);
}

/** Adds the dotted path of every leaf (or typed array) that differs between `a` (copy before) and `b` (live after). */
function diffInto(a: unknown, b: unknown, path: string, out: Set<string>): void {
  if (typeof a === 'number' && typeof b === 'number') {
    if (!Object.is(a, b)) out.add(path);
    return;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    if (a !== b) out.add(path);
    return;
  }
  if (isTyped(a) || isTyped(b)) {
    if (!isTyped(a) || !isTyped(b) || a.length !== b.length) {
      out.add(path);
      return;
    }
    for (let i = 0; i < a.length; i++) {
      if (!Object.is(a[i], b[i])) {
        out.add(path);
        return;
      }
    }
    return;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    out.add(path);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) out.add(`${path}.length`);
  const keys = new Set([...Object.keys(a as Bag), ...Object.keys(b as Bag)]);
  for (const k of keys) diffInto((a as Bag)[k], (b as Bag)[k], path ? `${path}.${k}` : k, out);
}

// ---- allowed writes (ARCHITECTURE §4.1) -----------------------------------------------------------------------------------------

interface Rule { prefix: string; car?: (c: SimCarState) => boolean }

const isPlayer = (c: SimCarState): boolean => c.isPlayer;
const isAiDriven = (c: SimCarState): boolean => c.control === 'ai' || c.control === 'pitAuto';

const ALLOWED: Record<string, Rule[]> = {
  conditions: [{ prefix: 'conditions' }, { prefix: 'rng.weather' }],
  playerInput: [{ prefix: 'cars.*.input', car: isPlayer }, { prefix: 'cars.*.kb', car: isPlayer }],
  ai: [{ prefix: 'cars.*.input', car: isAiDriven }, { prefix: 'cars.*.ai', car: isAiDriven }],
  vehicle: [{ prefix: 'cars.*.vehicle' }],
  collision: [{ prefix: 'cars.*.vehicle' }],
  race: [{ prefix: 'cars.*.race' }, { prefix: 'cars.*.pit' }, { prefix: 'cars.*.control' }, { prefix: 'race' }, { prefix: 'rng.race' }],
  snapshot: [],
};

function isAllowed(system: string, path: string, state: SimState): boolean {
  const rules = ALLOWED[system];
  if (!rules) return false;
  const m = /^cars\.(\d+)(\..*)?$/.exec(path);
  const generic = m ? `cars.*${m[2] ?? ''}` : path;
  const car = m ? state.cars[Number(m[1])] : undefined;
  return rules.some((r) => (generic === r.prefix || generic.startsWith(`${r.prefix}.`)) && (!r.car || (car !== undefined && r.car(car))));
}

// ---- the recorder --------------------------------------------------------------------------------------------------------------

interface Violation { system: string; path: string; tick: number }

function install(violations: Violation[], touched: Map<string, number>): void {
  rec.current = {
    wrap(label, sys) {
      return {
        name: sys.name,
        step(world, dt) {
          const before = structuredClone(world.state);
          sys.step(world, dt);
          const changed = new Set<string>();
          diffInto(before, world.state, '', changed);
          // The runner (not a system) advances tick/time before the systems run; no system may touch them.
          for (const p of changed) {
            touched.set(label, (touched.get(label) ?? 0) + 1);
            if (!isAllowed(label, p, world.state)) violations.push({ system: label, path: p.replace(/^cars\.(\d+)/, 'cars[$1]'), tick: world.state.tick });
          }
        },
      };
    },
  };
}

function summarise(v: Violation[]): string {
  const by = new Map<string, { first: number; n: number }>();
  for (const x of v) {
    const k = `${x.system}  ${x.path.replace(/\[\d+\]/, '[i]')}`;
    const e = by.get(k);
    if (e) e.n++;
    else by.set(k, { first: x.tick, n: 1 });
  }
  return [...by].map(([k, e]) => `${k}  (first at tick ${e.first}, ${e.n}x)`).join('\n  ');
}

describe(`S-SM-03 single writer (${readinessSummary()})`, () => {
  it('600 ticks from the grid: every system writes only its own row of ARCHITECTURE §4.1', () => {
    const violations: Violation[] = [];
    const touched = new Map<string, number>();
    install(violations, touched);
    try {
      const sim = makeSim({ cfg: { seed: SEEDS.field } });
      deepFreeze(sim.world.static.config);
      deepFreeze(sim.world.static.params);
      expect(sim.world.state.cars).toHaveLength(20);
      for (let i = 0; i < 600; i++) {
        sim.step();
        sim.world.events.drain(() => {});
      }
      expect(violations, `foreign writes (seed ${SEEDS.field}):\n  ${summarise(violations)}`).toEqual([]);
      // Sanity: the instrumentation actually saw the systems that move state.
      expect(touched.get('vehicle') ?? 0, 'vehicle system wrote state (instrumentation alive)').toBeGreaterThan(0);
      expect(touched.get('race') ?? 0, 'race director wrote state (instrumentation alive)').toBeGreaterThan(0);
    } finally {
      rec.current = null;
    }
  });

  it('1800 ticks of a skipLights race with the player on the keyboard path (throttle held, steering, DRS press)', () => {
    const violations: Violation[] = [];
    const touched = new Map<string, number>();
    install(violations, touched);
    try {
      const sim = makeSim({ skipLights: true, cfg: { seed: SEEDS.other, autodrive: false, aiCount: 19 } });
      deepFreeze(sim.world.static.config);
      deepFreeze(sim.world.static.params);
      const player = sim.world.state.cars[0]!;
      expect(player.control).toBe('player');
      for (let i = 0; i < 1800; i++) {
        // What `latchControls` does between ticks (glue): write the player's raw keyboard state.
        const c = player.controls;
        c.throttle = true;
        c.brake = false;
        c.left = i % 480 > 240;
        c.right = i % 480 <= 120;
        c.drsPressed = i % 600 === 300;
        c.gearUpPressed = i % 200 === 100;
        sim.step();
        sim.world.events.drain(() => {});
      }
      expect(violations, `foreign writes (seed ${SEEDS.other}):\n  ${summarise(violations)}`).toEqual([]);
      expect(touched.get('playerInput') ?? 0, 'player input system wrote state (instrumentation alive)').toBeGreaterThan(0);
      expect(touched.get('ai') ?? 0, 'ai system wrote state (instrumentation alive)').toBeGreaterThan(0);
    } finally {
      rec.current = null;
    }
  });

  it('the diff instrumentation detects a foreign write (self-check of this test)', () => {
    const violations: Violation[] = [];
    install(violations, new Map());
    try {
      const sim = makeSim({ skipLights: true, cfg: { aiCount: 2 } });
      const rogue = rec.current!.wrap('conditions', { name: 'rogue', step: (w) => { w.state.cars[1]!.vehicle.x += 1; w.state.race.raceMs += 0; } });
      rogue.step(sim.world, 1 / 240);
      expect(violations.map((v) => v.path)).toEqual(['cars[1].vehicle.x']);
      expect(violations[0]!.system).toBe('conditions');
    } finally {
      rec.current = null;
    }
  });
});
