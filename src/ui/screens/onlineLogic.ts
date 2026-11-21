// Pure lobby rules. The server remains authoritative; these guards keep menu actions valid.
import type { NetCustomTeamEntry, NetLobbyModel, NetPlayerInfo, NetRoomSettings } from '../../contracts/net';
import { isRoomCode, normalizeName } from '../../net/index';

export function codeInput(raw: string): string {
  return raw.trim().toUpperCase();
}

export function validCode(raw: string): boolean { return isRoomCode(codeInput(raw)); }

export function onlineIdentity(name: string, code?: string): { name: string; code?: string } | null {
  const normalized = normalizeName(name);
  if (!normalized) return null;
  if (code !== undefined && !validCode(code)) return null;
  return { name: normalized, ...(code === undefined ? {} : { code: codeInput(code) }) };
}

export function validServer(raw: string, secure: boolean): boolean {
  if (!raw.trim()) return true;
  try {
    const url = new URL(raw.trim());
    return (url.protocol === 'wss:' || (!secure && url.protocol === 'ws:')) && !!url.hostname && !url.username && !url.password && !url.hash;
  } catch { return false; }
}

export function clampRoomSettings(settings: NetRoomSettings, humans: number): NetRoomSettings {
  const integer = (n: number, max: number): number => Math.max(0, Math.min(max, Number.isFinite(n) ? Math.round(n) : 0));
  return { ...settings, aiCount: integer(settings.aiCount, Math.max(0, Math.min(19, 20 - humans))), difficulty: integer(settings.difficulty, 110) };
}

export function carAvailable(players: readonly NetPlayerInfo[], myId: number | null, teamId: string, driverIdx: 0 | 1): boolean {
  return !players.some((p) => p.id !== myId && p.teamId === teamId && p.driverIdx === driverIdx);
}

export function canStartLobby(model: Readonly<NetLobbyModel>): boolean {
  const room = model.room;
  return model.status === 'online' && !!room && room.phase === 'lobby' && room.ownerId === model.myId
    && room.players.some((p) => p.id === room.ownerId && p.connected)
    && room.players.every((p) => p.connected && (p.id === room.ownerId || p.ready));
}

/** CR: server clock offset is not yet exposed by UiDeps. Local epoch works for the sandbox only. */
export function countdownNumber(t0ServerMs: number, nowMs: number): number {
  return Math.max(0, Math.min(3, Math.ceil((t0ServerMs - nowMs) / 1000)));
}

/**
 * Several custom teams per room: each takes a base car that no other player's custom team uses and that has a free seat
 * for me. Preference: the team's own base, then my current car, then the first free base. Null when none is left.
 */
export function lobbyTeamBase(preferred: string, bases: readonly string[], players: readonly NetPlayerInfo[],
  teams: readonly NetCustomTeamEntry[], myId: number | null): string | null {
  const free = (base: string): boolean => !teams.some((e) => e.team.baseTeamId === base && e.ownerId !== myId)
    && (carAvailable(players, myId, base, 0) || carAvailable(players, myId, base, 1));
  const mine = players.find((p) => p.id === myId)?.teamId;
  for (const base of [preferred, ...(mine ? [mine] : []), ...bases]) if (bases.includes(base) && free(base)) return base;
  return null;
}
