// Server AI CPU per room (D-043): steps a RoomSim exactly as a racing room does (20 Hz ticks of 12 × 240 Hz steps, with
// 2 human puppets held at their grid poses) and reports the CPU share of one core at real time.
// Run: node server/dist/tools/ai-bench.mjs [simSeconds=60] [track=istanbul]
import type { NetRaceConfig, NetRosterEntry } from '../../src/contracts/net';
import { newNetCarState } from '../../src/net/protocol';
import { loadRaceTrack } from '../../src/track/registry';
import type { RaceTrackId } from '../../src/contracts/track';
import { ALL_DRIVERS } from '../../src/data/teams';
import { RoomSim } from '../src/serverAi';

const simSeconds = Number(process.argv[2] ?? 60);
const trackId = (process.argv[3] ?? 'istanbul') as RaceTrackId;
const HUMANS = 2;

function bench(ai: number): { ai: number; cpuPct: number; tickP99Ms: number; tickMaxMs: number; msPerSimS: number } {
  const n = HUMANS + ai;
  const roster: NetRosterEntry[] = ALL_DRIVERS.slice(0, n).map((e, i) => ({
    id: i < HUMANS ? i : 64 + i, kind: i < HUMANS ? 'human' : 'ai', name: e.driver.name, teamId: e.team.id, driverIdx: e.idx, gridSlot: i,
  }));
  const cfg: NetRaceConfig = { trackId, laps: 10, tod: 'day', weather: 'dry', aiCount: ai, difficulty: 90, seed: 1234 };
  const track = loadRaceTrack(trackId);
  const sim = new RoomSim(cfg, roster, track);
  const L = track.query.length;
  for (let i = 0; i < HUMANS; i++) {
    const v = sim.car(i).vehicle;
    const p = newNetCarState();
    Object.assign(p, { x: v.x, y: v.y, z: v.z, yaw: v.yaw, progress: v.lapWraps * L + v.s, simMs: 0 });
    sim.puppets[i] = p;
  }
  const out = newNetCarState();
  const ticks: number[] = [];
  const t0 = performance.now();
  for (let ms = 50; ms <= simSeconds * 1000; ms += 50) {
    const a = performance.now();
    sim.advanceTo(ms, 240);
    for (let i = HUMANS; i < n; i++) sim.writeAiState(i, out);
    ticks.push(performance.now() - a);
  }
  const total = performance.now() - t0;
  ticks.sort((x, y) => x - y);
  const r1 = (v: number) => Math.round(v * 100) / 100;
  return {
    ai, cpuPct: r1((total / (simSeconds * 1000)) * 100), tickP99Ms: r1(ticks[Math.floor(ticks.length * 0.99)]!), tickMaxMs: r1(ticks.at(-1)!),
    msPerSimS: r1(total / simSeconds),
  };
}

bench(4); // warm-up (JIT, track build)
const rows = [0, 4, 12, 18].map((ai) => (ai === 0 ? { ai, cpuPct: 0, tickP99Ms: 0, tickMaxMs: 0, msPerSimS: 0, note: 'no sim without AI' } : bench(ai)));
console.log(JSON.stringify({ node: process.version, platform: `${process.platform}/${process.arch}`, trackId, simSeconds, humans: HUMANS, rows }, null, 1));
