// Live AudioSystem (contracts/audio.ts; audio.md §1–§3, §7, §8). The AudioContext is created on unlock() (title
// key press), then the graph from createAudioGraph() is started. update() runs every frame and only writes
// AudioParams (setTargetAtTime τ 20 ms); pops come from a per-voice mulberry32 seeded by the car id so replays
// sound identical. Player engine, wind, tyre squeal, buses, pause; S2-S8 scene audio (scene.ts): AI voices with
// Doppler, surfaces, kerbs, impacts, rain, crowd, UI / notify / start / pit beeps, flashback, ducking.
// Game buses sit behind a session gate: closed until update() is called (sessions call it every frame, paused or
// not) and auto-closing LIVE_HOLD s after the last call, so menus only hear the ui bus (plus the quiet showroom bed on
// the title / main-menu screens, audio.md §7; results have no session, so no game audio either).

import type { AudioSettings, AudioSystem } from '../contracts/audio';
import type { EventBus, EventMap } from '../contracts/events';
import type { ListenerPose, RenderFrame } from '../contracts/render';
import type { SimEvent } from '../contracts/sim';
import { createAudioGraph, type AudioGraph } from './graph';
import { driveEngine, engineEvent, newEngineDrive } from './engineDrive';
import { createSceneAudio, type SceneAudio } from './scene';

const LIVE_HOLD = 0.25;
const SHOWROOM_STATES: readonly string[] = ['title', 'menu'];

export interface AudioSystemOptions {
  /** Use this context instead of creating an AudioContext on unlock (CR-08 offline rendering). */
  context?: BaseAudioContext;
}

export function createAudioSystem(opts: AudioSystemOptions = {}): AudioSystem {
  let bus: EventBus<EventMap> | null = null;
  let settings: AudioSettings = { master: 0.8, engine: 0.9, sfx: 0.8, ambience: 0.6, ui: 0.6 };
  let ctx: BaseAudioContext | null = opts.context ?? null;
  let owned = false;
  let graph: AudioGraph | null = null;
  let scene: SceneAudio | null = null;
  const unsub: (() => void)[] = [];
  let unlocked = false;
  let paused = false;
  let playerId = 0;
  let appState = 'boot';
  const drive = newEngineDrive();

  const build = (): void => {
    if (!ctx || graph) return;
    graph = createAudioGraph(ctx);
    scene = createSceneAudio(graph);
    graph.setVolumes(settings, ctx.currentTime);
    graph.setPaused(paused, ctx.currentTime);
    graph.live.gain.value = 0;
    graph.setShowroom(SHOWROOM_STATES.includes(appState), ctx.currentTime);
    graph.start(ctx.currentTime + 0.02);
    scene.start(ctx.currentTime + 0.02);
  };

  return {
    init(b, s) {
      bus = b;
      settings = { ...s };
      const now = (): number => (ctx ? ctx.currentTime : 0);
      unsub.push(
        b.on('ui:sound', (e) => scene?.ui(e.kind, now())),
        b.on('notify', (e) => scene?.notify(e.level, now())),
        b.on('flashback:open', () => scene?.flashback('open', now())),
        b.on('flashback:applied', () => scene?.flashback('applied', now())),
        b.on('flashback:cancel', () => scene?.flashback('cancel', now())),
        b.on('session:started', () => scene?.reset()),
        b.on('app:state', (e) => {
          appState = e.to;
          graph?.setShowroom(SHOWROOM_STATES.includes(appState), now());
        }),
      );
    },
    async unlock() {
      if (!ctx) {
        if (typeof AudioContext === 'undefined') return;
        ctx = new AudioContext({ latencyHint: 'interactive' });
        owned = true;
      }
      build();
      if (owned && ctx instanceof AudioContext && ctx.state !== 'running') {
        try {
          await ctx.resume();
        } catch {
          /* autoplay policy: retried on the next gesture */
        }
      }
      if (!unlocked) {
        unlocked = true;
        bus?.emit('audio:unlocked', {});
      }
    },
    isUnlocked: () => unlocked,
    update(frame: RenderFrame, listener: ListenerPose, dt: number) {
      if (!graph || !ctx) return;
      const t = ctx.currentTime;
      playerId = frame.playerId;
      const car = frame.cars[playerId];
      if (!car) return;
      const g = graph.live.gain;
      g.cancelScheduledValues(t);
      g.setTargetAtTime(1, t, 0.03);
      g.setTargetAtTime(0, t + LIVE_HOLD, 0.05);
      driveEngine(graph, drive, frame, car, t, dt);
      scene?.update(frame, listener, t, dt);
    },
    onSimEvent(e: SimEvent) {
      if (!graph || !ctx) return;
      scene?.event(e, playerId, ctx.currentTime);
      engineEvent(graph, drive, e, playerId, ctx.currentTime);
    },
    setVolumes(v) {
      settings = { ...v };
      if (graph && ctx) graph.setVolumes(settings, ctx.currentTime);
    },
    setPaused(p) {
      paused = p;
      if (graph && ctx) graph.setPaused(p, ctx.currentTime);
    },
    voices: () => scene?.voices() ?? 0,
    dispose() {
      for (const u of unsub) u();
      unsub.length = 0;
      if (scene && ctx) {
        scene.stop(ctx.currentTime);
        scene.disconnect();
      }
      scene = null;
      if (graph && ctx) {
        graph.stop(ctx.currentTime);
        graph.disconnect();
      }
      graph = null;
      if (owned && ctx instanceof AudioContext) void ctx.close();
      if (owned) ctx = null;
      unlocked = false;
      bus = null;
    },
  };
}
