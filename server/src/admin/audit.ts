// Admin audit log (D-050, audit.md M6): one JSON line per login, failure, lockout and admin action in
// <dataDir>/audit/audit-YYYY-MM-DD.jsonl (UTC day), files older than 14 days are deleted. Callers pass network hashes, never IPs.
import fs from 'node:fs';
import path from 'node:path';

export const AUDIT_RETENTION_DAYS = 14;
const NAME = /^audit-(\d{4}-\d{2}-\d{2})\.jsonl$/;
const DAY_MS = 86_400_000;

export class AuditLog {
  private day = '';

  constructor(
    private readonly dir: string,
    private readonly now: () => number = Date.now,
  ) {}

  write(event: string, data: Record<string, unknown> = {}): void {
    const t = this.now();
    const day = new Date(t).toISOString().slice(0, 10);
    if (day !== this.day) {
      fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      this.day = day;
      this.prune(t);
    }
    fs.appendFileSync(path.join(this.dir, `audit-${day}.jsonl`), JSON.stringify({ t: new Date(t).toISOString(), event, ...data }) + '\n', { mode: 0o600 });
  }

  /** Deletes day files older than the retention window. */
  prune(t: number = this.now()): void {
    const oldest = new Date(t - AUDIT_RETENTION_DAYS * DAY_MS).toISOString().slice(0, 10);
    for (const f of fs.readdirSync(this.dir)) {
      const m = NAME.exec(f);
      if (m && m[1]! < oldest) fs.rmSync(path.join(this.dir, f), { force: true });
    }
  }
}
