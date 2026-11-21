// Recent server events for the admin panel: the last N log lines (strikes, joins, kicks...) in a fixed ring.

export interface EventEntry { t: number; event: string; data: Record<string, unknown> }

export class EventRing {
  private readonly buf: EventEntry[] = [];
  private next = 0;

  constructor(private readonly size = 200) {}

  push(event: string, data: Record<string, unknown>, t: number = Date.now()): void {
    const e = { t, event, data };
    if (this.buf.length < this.size) this.buf.push(e);
    else this.buf[this.next] = e;
    this.next = (this.next + 1) % this.size;
  }

  /** Newest first. */
  recent(): EventEntry[] {
    const n = this.buf.length;
    const out: EventEntry[] = [];
    for (let i = 1; i <= n; i++) out.push(this.buf[(this.next - i + n) % n]!);
    return out;
  }
}
