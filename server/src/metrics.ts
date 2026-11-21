// Coarse process numbers for /health (deploy doc §1.4): CPU %, RSS, event-loop lag p99, sockets, msg/s.
// Values cover the last completed 10 s window; before the first window completes they cover the time since start.
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

export const METRICS_WINDOW_MS = 10_000;

export interface HealthSnapshot {
  ok: true;
  uptimeS: number;
  /** Percent of one core, averaged over the window. */
  cpuPct: number;
  rssMb: number;
  heapUsedMb: number;
  lagP99Ms: number;
  sockets: number;
  msgInPerS: number;
  msgOutPerS: number;
  bytesOutPerS: number;
  /** Largest server→client JSON message since start (limit 16 KB). */
  maxJsonBytes: number;
  maxJsonType: string;
  tls: boolean;
  certDaysLeft: number | null;
  warnings: string[];
}

interface Window {
  cpuPct: number;
  lagP99Ms: number;
  msgInPerS: number;
  msgOutPerS: number;
  bytesOutPerS: number;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

export class Metrics {
  msgIn = 0;
  msgOut = 0;
  bytesOut = 0;
  maxJsonBytes = 0;
  maxJsonType = '';
  sockets = 0;

  private readonly lag = monitorEventLoopDelay({ resolution: 10 });
  private readonly startMs = performance.now();
  private winStartMs = this.startMs;
  private winCpu = process.cpuUsage();
  private winIn = 0;
  private winOut = 0;
  private winBytes = 0;
  private last: Window | null = null;
  private readonly timer: NodeJS.Timeout;

  constructor() {
    this.lag.enable();
    this.timer = setInterval(() => {
      this.last = this.measure();
      this.winStartMs = performance.now();
      this.winCpu = process.cpuUsage();
      this.winIn = this.msgIn;
      this.winOut = this.msgOut;
      this.winBytes = this.bytesOut;
      this.lag.reset();
    }, METRICS_WINDOW_MS);
    this.timer.unref();
  }

  private measure(): Window {
    const dtMs = Math.max(1, performance.now() - this.winStartMs);
    const cpu = process.cpuUsage(this.winCpu);
    const p99 = this.lag.count > 0 ? this.lag.percentile(99) / 1e6 : 0;
    return {
      cpuPct: round1(((cpu.user + cpu.system) / 1000 / dtMs) * 100),
      // monitorEventLoopDelay includes the sampling resolution; subtract it to report the lag itself.
      lagP99Ms: round1(Math.max(0, p99 - 10)),
      msgInPerS: round1(((this.msgIn - this.winIn) * 1000) / dtMs),
      msgOutPerS: round1(((this.msgOut - this.winOut) * 1000) / dtMs),
      bytesOutPerS: Math.round(((this.bytesOut - this.winBytes) * 1000) / dtMs),
    };
  }

  snapshot(tls: boolean, certDaysLeft: number | null): HealthSnapshot {
    const w = this.last ?? this.measure();
    const mem = process.memoryUsage();
    const warnings: string[] = [];
    if (certDaysLeft !== null && certDaysLeft < 10) warnings.push('certExpiresSoon');
    return {
      ok: true,
      uptimeS: Math.round((performance.now() - this.startMs) / 1000),
      cpuPct: w.cpuPct,
      rssMb: round1(mem.rss / 1048576),
      heapUsedMb: round1(mem.heapUsed / 1048576),
      lagP99Ms: w.lagP99Ms,
      sockets: this.sockets,
      msgInPerS: w.msgInPerS,
      msgOutPerS: w.msgOutPerS,
      bytesOutPerS: w.bytesOutPerS,
      maxJsonBytes: this.maxJsonBytes,
      maxJsonType: this.maxJsonType,
      tls,
      certDaysLeft,
      warnings,
    };
  }

  dispose(): void {
    clearInterval(this.timer);
    this.lag.disable();
  }
}
