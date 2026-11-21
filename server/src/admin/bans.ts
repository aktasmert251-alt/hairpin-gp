// Ban list (D-050), persisted to <dataDir>/bans.json. A ban matches a hello by device id (or, until clients send one, the
// resume token) or by the salted hash of the /24 network. Only salted hashes are stored, never a raw IP or device id.
import { createHash, randomBytes } from 'node:crypto';
import { netHash } from '../privacy';
import { readJson, writeJsonAtomic } from './files';

export interface Ban {
  id: string;
  /** sha256(salt, deviceId) or null. */
  device: string | null;
  /** sha256(salt, resumeToken): fallback key for clients that send no device id. */
  token: string | null;
  /** netHash(ip, salt) of the /24, or null when the admin chose "device only" (e.g. a LAN party behind one address). */
  net: string | null;
  name: string;
  reason: string;
  createdAt: number;
  /** Unix ms, or null = permanent. */
  expiresAt: number | null;
}

interface BansFile {
  v: 1;
  salt: string;
  bans: Ban[];
}

export interface BanKeys {
  deviceId: string | null;
  token: string | null;
  ip: string;
}

export class BanList {
  private readonly data: BansFile;

  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now,
  ) {
    const raw = readJson(file) as BansFile | null;
    // A missing file is created on the first ban (the salt is kept from then on).
    this.data = raw && raw.v === 1 && typeof raw.salt === 'string' && Array.isArray(raw.bans) ? raw : { v: 1, salt: randomBytes(16).toString('hex'), bans: [] };
  }

  private h(kind: string, value: string): string {
    return createHash('sha256').update(this.data.salt).update('\0' + kind + '\0').update(value).digest('hex');
  }

  /** The persistent network hash of an address (also used in the audit log, so entries can be matched to bans). */
  net(ip: string): string {
    return netHash(ip, this.data.salt);
  }

  /** Short display hash of a device id ("" when there is none). */
  deviceTag(deviceId: string | null): string {
    return deviceId ? this.h('device', deviceId).slice(0, 8) : '';
  }

  private prune(): void {
    const t = this.now();
    const before = this.data.bans.length;
    this.data.bans = this.data.bans.filter((b) => b.expiresAt === null || b.expiresAt > t);
    if (this.data.bans.length !== before) this.save();
  }

  list(): readonly Ban[] {
    this.prune();
    return this.data.bans;
  }

  match(k: BanKeys): Ban | null {
    const device = k.deviceId ? this.h('device', k.deviceId) : null;
    const token = k.token ? this.h('token', k.token) : null;
    const net = this.net(k.ip);
    for (const b of this.list()) {
      if ((device && b.device === device) || (token && b.token === token) || (b.net !== null && b.net === net)) return b;
    }
    return null;
  }

  add(k: BanKeys, opts: { name: string; reason: string; durationMs: number | null; network: boolean }): Ban {
    const t = this.now();
    const ban: Ban = {
      id: randomBytes(6).toString('hex'),
      device: k.deviceId ? this.h('device', k.deviceId) : null,
      token: k.token ? this.h('token', k.token) : null,
      net: opts.network ? this.net(k.ip) : null,
      name: opts.name,
      reason: opts.reason,
      createdAt: t,
      expiresAt: opts.durationMs === null ? null : t + opts.durationMs,
    };
    this.data.bans.push(ban);
    this.save();
    return ban;
  }

  remove(id: string): Ban | null {
    const i = this.data.bans.findIndex((b) => b.id === id);
    if (i < 0) return null;
    const [b] = this.data.bans.splice(i, 1);
    this.save();
    return b!;
  }

  private save(): void {
    writeJsonAtomic(this.file, this.data);
  }
}
