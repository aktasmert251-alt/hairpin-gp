import type { TeamDef } from '../contracts/data';
import { TEAMS } from './teams';
import { hudStripColor, paletteColor, TEAM_PALETTE, type TeamPaletteId } from './teamPalette';

/** Plain JSON suitable for a future validated roster message. */
export interface CustomTeam {
  id: string;
  name: string;
  baseTeamId: string;
  primary: TeamPaletteId;
  secondary: TeamPaletteId;
  accent: TeamPaletteId;
  finish: 'gloss' | 'matte' | 'metallic';
}

// Encoded reserved-name tokens keep prohibited branding out of source text and assets.
const RESERVED = [
  [102, 49], [102, 111, 114, 109, 117, 108, 97, 49],
  [102, 101, 114, 114, 97, 114, 105], [109, 99, 108, 97, 114, 101, 110],
  [114, 101, 100, 98, 117, 108, 108], [109, 101, 114, 99, 101, 100, 101, 115],
  [97, 115, 116, 111, 110, 109, 97, 114, 116, 105, 110], [104, 97, 97, 115],
  [115, 97, 117, 98, 101, 114], [97, 108, 102, 97, 114, 111, 109, 101, 111],
  [97, 108, 112, 104, 97, 116, 97, 117, 114, 105], [116, 111, 114, 111, 114, 111, 115, 115, 111],
  [114, 97, 99, 105, 110, 103, 98, 117, 108, 108, 115], [115, 99, 117, 100, 101, 114, 105, 97],
  [119, 105, 108, 108, 105, 97, 109, 115], [97, 108, 112, 105, 110, 101],
  [97, 117, 100, 105], [99, 97, 100, 105, 108, 108, 97, 99],
  [102, 117, 99, 107], [115, 104, 105, 116], [98, 105, 116, 99, 104],
].map(codes => String.fromCharCode(...codes));

export type TeamNameError = 'length' | 'characters' | 'reserved';
export function validateTeamName(value: string): { name: string; error: TeamNameError | null } {
  const name = value.normalize('NFC').trim();
  if (/[\p{Cc}\p{Cf}<>]/u.test(value)) return { name, error: 'characters' };
  if ([...name].length < 2 || [...name].length > 20) return { name, error: 'length' };
  if (!/^[\p{L}\p{M}\p{N} ._\-]+$/u.test(name)) return { name, error: 'characters' };
  const folded = name.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '').replace(/[^a-z0-9]/g, '');
  if (RESERVED.some(word => folded.includes(word))) return { name, error: 'reserved' };
  return { name, error: null };
}

/** Validate unknown persisted/wire data, returning only canonical fields. */
export function parseCustomTeam(value: unknown): CustomTeam | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || !/^custom-[a-z0-9-]{1,64}$/.test(v.id) || typeof v.name !== 'string') return null;
  const checked = validateTeamName(v.name);
  if (checked.error || !TEAMS.some(t => t.id === v.baseTeamId)) return null;
  const color = (x: unknown): x is TeamPaletteId => TEAM_PALETTE.some(p => p.id === x);
  if (!color(v.primary) || !color(v.secondary) || !color(v.accent)) return null;
  if (v.finish !== 'gloss' && v.finish !== 'matte' && v.finish !== 'metallic') return null;
  return { id: v.id, name: checked.name, baseTeamId: v.baseTeamId as string, primary: v.primary, secondary: v.secondary, accent: v.accent, finish: v.finish };
}

export function customTeamDef(team: CustomTeam): TeamDef {
  const base = TEAMS.find(t => t.id === team.baseTeamId)!;
  return { ...base, id: team.id, name: team.name, short: team.name,
    colors: { primary: paletteColor(team.primary), secondary: paletteColor(team.secondary), accent: paletteColor(team.accent), ui: hudStripColor(team.primary) }, finish: team.finish };
}

/** Presentation registers validated local definitions before setup; simulation only reads plain data. */
let catalog: readonly CustomTeam[] = [];
let activeCustomId: string | null = null;
export function setCustomTeamCatalog(teams: readonly CustomTeam[]): void {
  catalog = teams.map(t => ({ ...t }));
  if (!catalog.some(t => t.id === activeCustomId)) activeCustomId = null;
}
export function customTeamById(id: string): CustomTeam | undefined { return catalog.find(t => t.id === id); }
export function teamChoices(): readonly TeamDef[] { return [...TEAMS, ...catalog.map(customTeamDef)]; }
/** A session-only presentation alias; simulation and pit-box ids stay those of the base car. */
export function setActiveCustomTeam(id: string | null): void { activeCustomId = id; }
function activeTeam(): TeamDef | undefined {
  const custom = activeCustomId ? customTeamById(activeCustomId) : undefined;
  return custom ? { ...customTeamDef(custom), id: custom.baseTeamId } : undefined;
}
/**
 * D-062 online: the race's custom teams by base team id. Cars keep their base team id (grid seats, pit boxes, sim); name and
 * livery are presented from the custom team. Set by the online glue at `load`, cleared when leaving online.
 */
let raceTeams = new Map<string, TeamDef>();
export function setRaceCustomTeams(teams: readonly CustomTeam[] | null): void {
  raceTeams = new Map((teams ?? []).map(t => [t.baseTeamId, { ...customTeamDef(t), id: t.baseTeamId }]));
}
export function sessionTeamChoices(): readonly TeamDef[] {
  const active = activeTeam();
  return [...TEAMS.map(t => raceTeams.get(t.id) ?? (active && t.id === active.id ? active : t)), ...catalog.map(customTeamDef)];
}
export function resolvedTeam(id: string): TeamDef | undefined {
  const custom = customTeamById(id);
  const active = activeTeam();
  return custom ? customTeamDef(custom) : raceTeams.get(id) ?? (active?.id === id ? active : TEAMS.find(t => t.id === id));
}
