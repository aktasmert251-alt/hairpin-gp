import { parseCustomTeam, setCustomTeamCatalog, type CustomTeam } from '../data/customTeams';

export const CUSTOM_TEAMS_KEY = 'apexgp:v1:customTeams';
/** Saved custom teams per device (matches the per-room wire cap, one per base car). */
export const MAX_SAVED_TEAMS = 10;
interface TeamStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

export type TeamSaveError = 'invalid' | 'full' | 'duplicate';

export function newCustomTeamId(): string {
  const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffffff).toString(36)}`;
  return `custom-${uuid.toLowerCase()}`;
}

const nameKey = (name: string): string => name.normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/g, ' ').trim();

/**
 * Loads stored teams: the v1 list or a legacy single team object. Exact copies are dropped, a different team under a
 * reused id gets a fresh id, invalid entries are skipped and at most MAX_SAVED_TEAMS are kept (storage order).
 */
export function migrateCustomTeams(raw: unknown, makeId: () => string = newCustomTeamId): CustomTeam[] {
  const list: unknown[] = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
  const out: CustomTeam[] = [];
  for (const value of list.slice(0, 100)) {
    if (out.length >= MAX_SAVED_TEAMS) break;
    const team = parseCustomTeam(value);
    if (!team) continue;
    const same = out.find((t) => t.id === team.id);
    if (same && JSON.stringify(same) === JSON.stringify(team)) continue; // an exact copy
    if (same) team.id = makeId();
    out.push(team);
  }
  return out;
}

/** Memory remains authoritative if storage is absent, blocked, corrupt or full. */
export function createCustomTeamStore(storage: () => TeamStorage | undefined = () => globalThis.localStorage) {
  let teams: CustomTeam[] = [];
  let stored: string | null = null;
  try {
    stored = storage()?.getItem(CUSTOM_TEAMS_KEY) ?? null;
    teams = migrateCustomTeams(JSON.parse(stored ?? '[]'));
  } catch { /* memory-only mode */ }
  const publish = (): void => {
    setCustomTeamCatalog(teams);
    try { storage()?.setItem(CUSTOM_TEAMS_KEY, JSON.stringify(teams)); } catch { /* keep the in-memory edit */ }
  };
  setCustomTeamCatalog(teams);
  // Persist a migrated shape (legacy object, renamed duplicates) once.
  if (stored !== null && stored !== JSON.stringify(teams)) publish();
  const check = (value: CustomTeam): TeamSaveError | null => {
    const team = parseCustomTeam(value);
    if (!team) return 'invalid';
    const exists = teams.some((t) => t.id === team.id);
    if (!exists && teams.length >= MAX_SAVED_TEAMS) return 'full';
    if (teams.some((t) => t.id !== team.id && nameKey(t.name) === nameKey(team.name))) return 'duplicate';
    return null;
  };
  return {
    list: (): readonly CustomTeam[] => teams.map(t => ({ ...t })),
    get: (id: string): CustomTeam | undefined => { const t = teams.find(x => x.id === id); return t ? { ...t } : undefined; },
    count: (): number => teams.length,
    canCreate: (): boolean => teams.length < MAX_SAVED_TEAMS,
    /** Why `save` would refuse this team (null = it would be saved). */
    check,
    /** Create (new id) or update (existing id, keeps its list position). */
    save(value: CustomTeam): boolean {
      if (check(value)) return false;
      const team = parseCustomTeam(value)!;
      const i = teams.findIndex(t => t.id === team.id);
      teams = i >= 0 ? teams.map((t, j) => (j === i ? team : t)) : [...teams, team];
      publish(); return true;
    },
    remove(id: string): void { teams = teams.filter(t => t.id !== id); publish(); },
  };
}

export type CustomTeamStore = ReturnType<typeof createCustomTeamStore>;
let localTeams: CustomTeamStore | undefined;
export function customTeamStore(): CustomTeamStore {
  return localTeams ??= createCustomTeamStore();
}
