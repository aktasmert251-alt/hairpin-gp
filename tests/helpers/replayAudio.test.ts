import { afterEach, expect, it, vi } from 'vitest';
import type { ReplayData } from '../../src/contracts/replay';
import { renderReplayAudio } from '../../src/audio/offline';

const { scheduled, schedule } = vi.hoisted(() => {
  const scheduled: number[] = [];
  return { scheduled, schedule: (_value: unknown, at: number) => {
    if (at < 0) throw new RangeError(`Negative audio time: ${at}`);
    scheduled.push(at);
  } };
});

vi.mock('../../src/audio/graph', () => ({
  createAudioGraph: () => ({
    setVolumes: vi.fn(), start: vi.fn(),
    engine: { set: schedule }, setWind: vi.fn(), setSqueal: vi.fn(),
  }),
}));
vi.mock('../../src/audio/scene', () => ({
  createSceneAudio: () => ({ update: (_frame: unknown, _listener: unknown, at: number) => schedule(null, at), start: vi.fn() }),
}));

class BufferStub {
  readonly length: number;
  private readonly channels: Float32Array[];
  constructor(options: AudioBufferOptions) {
    this.length = options.length;
    this.channels = Array.from({ length: options.numberOfChannels ?? 1 }, () => new Float32Array(this.length));
  }
  getChannelData(channel: number): Float32Array { return this.channels[channel]!; }
  copyToChannel(data: Float32Array, channel: number): void { this.channels[channel]!.set(data); }
}

afterEach(() => { vi.unstubAllGlobals(); scheduled.length = 0; });

it('renders a replay slice without scheduling negative times at a rounded pre-roll boundary', async () => {
  vi.stubGlobal('AudioBuffer', BufferStub);
  vi.stubGlobal('OfflineAudioContext', class {
    constructor(private channels: number, private length: number, private sampleRate: number) {}
    async startRendering(): Promise<BufferStub> {
      return new BufferStub({ numberOfChannels: this.channels, length: this.length, sampleRate: this.sampleRate });
    }
  });
  const from = 4.083333333333334;
  const t0 = from - 2;
  expect(Math.ceil(t0 * 60 - 1e-9) / 60 - t0).toBeLessThan(0);
  const replay = {
    hz: 60, frameCount: 300, config: { tod: 'day' },
    meta: [{ id: 0, isPlayer: true }], cars: new Float32Array(300 * 44),
    global: new Float32Array(300 * 8), events: [],
  } as unknown as ReplayData;
  const output = await renderReplayAudio(replay, {
    from, to: from + 0.5, sampleRate: 8000,
    volumes: { master: 1, engine: 1, sfx: 1, ambience: 1, ui: 1 }, listener: (_time, out) => out,
  });
  expect(output.length).toBe(4000);
  expect(scheduled[0]).toBe(0);
  expect(scheduled.length).toBeGreaterThan(2);
  expect(scheduled.every((at) => at >= 0)).toBe(true);
  expect(scheduled.some((at) => at > 0)).toBe(true);
});
