// Several custom teams: create / edit / rename / delete, cap, unique names, migration of the old single team, and the
// online rule that every player's custom team gets its own base car.
import { afterEach, describe, expect, it } from 'vitest';
import type { NetCustomTeamEntry, NetPlayerInfo } from '../../contracts/net';
import { customTeamById, setCustomTeamCatalog, teamChoices, type CustomTeam } from '../../data/customTeams';
import { TEAMS } from '../../data/teams';
import { createCustomTeamStore, CUSTOM_TEAMS_KEY, MAX_SAVED_TEAMS, migrateCustomTeams, newCustomTeamId } from '../customTeamStore';
import { lobbyTeamBase } from '../screens/onlineLogic';

const mk = (i: number, patch: Partial<CustomTeam> = {}): CustomTeam => ({
  id: `custom-t${i}`, name: `Takim ${i}`, baseTeamId: TEAMS[i % TEAMS.length]!.id, primary: 'teal', secondary: 'white', accent: 'gold', finish: 'gloss', ...patch,
});
function storage(initial?: unknown) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(CUSTOM_TEAMS_KEY, JSON.stringify(initial));
  return { values, get: () => ({ getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } }) };
}
afterEach(() => setCustomTeamCatalog([]));

describe('custom team store: many teams', () => {
  it('creates three teams, lists them in order and offers all of them as choices', () => {
    const s = storage();
    const store = createCustomTeamStore(s.get);
    for (const i of [1, 2, 3]) expect(store.save(mk(i))).toBe(true);
    expect(store.list().map((t) => t.name)).toEqual(['Takim 1', 'Takim 2', 'Takim 3']);
    expect(JSON.parse(s.values.get(CUSTOM_TEAMS_KEY)!)).toHaveLength(3);
    expect(teamChoices().filter((t) => t.id.startsWith('custom-')).map((t) => t.name)).toEqual(['Takim 1', 'Takim 2', 'Takim 3']);
    for (const i of [1, 2, 3]) expect(customTeamById(`custom-t${i}`)?.name).toBe(`Takim ${i}`);
    // Reload: all three come back.
    expect(createCustomTeamStore(s.get).list()).toHaveLength(3);
  });
  it('edit / rename keeps the id and list position; delete removes only that team', () => {
    const store = createCustomTeamStore(storage().get);
    for (const i of [1, 2, 3]) store.save(mk(i));
    expect(store.save({ ...mk(2), name: 'Yeni Ad', primary: 'navy' })).toBe(true);
    expect(store.list().map((t) => t.name)).toEqual(['Takim 1', 'Yeni Ad', 'Takim 3']);
    expect(store.get('custom-t2')?.primary).toBe('navy');
    store.remove('custom-t1');
    expect(store.list().map((t) => t.id)).toEqual(['custom-t2', 'custom-t3']);
  });
  it(`caps at ${MAX_SAVED_TEAMS} teams (edits still allowed) and refuses duplicate names`, () => {
    const store = createCustomTeamStore(storage().get);
    for (let i = 0; i < MAX_SAVED_TEAMS; i++) expect(store.save(mk(i))).toBe(true);
    expect(store.canCreate()).toBe(false);
    expect(store.check(mk(99))).toBe('full');
    expect(store.save(mk(99))).toBe(false);
    expect(store.save({ ...mk(0), name: 'Duzenlendi' })).toBe(true);
    store.remove('custom-t5');
    expect(store.check({ ...mk(50), name: 'takim  1' })).toBe('duplicate');
    expect(store.check({ ...mk(1), name: 'TAKIM 1' })).toBeNull(); // a team may change the case of its own name
    expect(store.save(mk(50))).toBe(true);
  });
  it('generates unique, valid ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newCustomTeamId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^custom-[a-z0-9-]{1,64}$/);
  });
});

describe('custom team migration', () => {
  it('keeps the existing single team (v1 list of one) and rewrites nothing', () => {
    const s = storage([mk(1)]);
    const before = s.values.get(CUSTOM_TEAMS_KEY);
    expect(createCustomTeamStore(s.get).list()).toEqual([mk(1)]);
    expect(s.values.get(CUSTOM_TEAMS_KEY)).toBe(before);
  });
  it('wraps a legacy single team object into the list and persists the new shape', () => {
    const s = storage(mk(1));
    const store = createCustomTeamStore(s.get);
    expect(store.list()).toEqual([mk(1)]);
    expect(JSON.parse(s.values.get(CUSTOM_TEAMS_KEY)!)).toEqual([mk(1)]);
    expect(store.save(mk(2))).toBe(true);
  });
  it('drops exact copies, re-ids a different team under a reused id, skips invalid, caps the list', () => {
    let n = 0;
    const out = migrateCustomTeams([mk(1), mk(1), { ...mk(1), name: 'Baska' }, { id: 'bad' }, ...Array.from({ length: 20 }, (_, i) => mk(10 + i))], () => `custom-new${++n}`);
    expect(out).toHaveLength(MAX_SAVED_TEAMS);
    expect(out[0]).toEqual(mk(1));
    expect(out[1]).toEqual({ ...mk(1), id: 'custom-new1', name: 'Baska' });
    expect(new Set(out.map((t) => t.id)).size).toBe(out.length);
    expect(migrateCustomTeams('garbage')).toEqual([]);
  });
});

describe('online: each player brings a custom team on its own base car', () => {
  const ids = TEAMS.map((t) => t.id);
  const player = (id: number, teamId: string, driverIdx: 0 | 1): NetPlayerInfo => ({ id, name: `P${id}`, teamId, driverIdx, connected: true, ready: false, pingMs: 0 });
  const entry = (ownerId: number, base: string): NetCustomTeamEntry => ({ ownerId, team: { ...mk(ownerId), id: `custom-${base}`, baseTeamId: base } });
  it('keeps the preferred base when it is free', () => {
    expect(lobbyTeamBase(ids[2]!, ids, [player(0, ids[0]!, 0)], [], 0)).toBe(ids[2]);
  });
  it("moves off a base that another player's custom team uses (to my car, else the first free one)", () => {
    const players = [player(0, ids[0]!, 0), player(1, ids[1]!, 0)];
    const teams = [entry(0, ids[0]!)];
    expect(lobbyTeamBase(ids[0]!, ids, players, teams, 1)).toBe(ids[1]);
    const players2 = [player(0, ids[0]!, 0), player(1, ids[0]!, 1)];
    expect(lobbyTeamBase(ids[0]!, ids, players2, teams, 1)).toBe(ids[1]);
  });
  it('my own room team does not block my base; a base with both seats taken by others is skipped', () => {
    expect(lobbyTeamBase(ids[0]!, ids, [player(0, ids[0]!, 0)], [entry(0, ids[0]!)], 0)).toBe(ids[0]);
    const full = [player(1, ids[3]!, 0), player(2, ids[3]!, 1), player(0, ids[0]!, 0)];
    expect(lobbyTeamBase(ids[3]!, ids, full, [], 0)).toBe(ids[0]);
  });
  it("returns null when every base already has another player's custom team", () => {
    const teams = ids.map((b, i) => entry(i + 1, b));
    expect(lobbyTeamBase(ids[0]!, ids, [player(0, ids[0]!, 0)], teams, 0)).toBeNull();
  });
});
