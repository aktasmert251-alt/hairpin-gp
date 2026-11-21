/** Stable wire ids; colour values are resolved locally, never supplied by a player. */
export const TEAM_PALETTE = [
  { id: 'ink', hex: '#121417' }, { id: 'graphite', hex: '#3A4048' },
  { id: 'silver', hex: '#B9C0C7' }, { id: 'white', hex: '#F2F4F7' },
  { id: 'crimson', hex: '#C8102E' }, { id: 'coral', hex: '#FF7178' },
  { id: 'orange', hex: '#F57921' }, { id: 'amber', hex: '#E8A33D' },
  { id: 'gold', hex: '#D4A72C' }, { id: 'yellow', hex: '#FFD21A' },
  { id: 'lime', hex: '#B5D94C' }, { id: 'green', hex: '#39C96A' },
  { id: 'forest', hex: '#12664E' }, { id: 'mint', hex: '#7CE0B5' },
  { id: 'teal', hex: '#0E8C82' }, { id: 'cyan', hex: '#55D1DD' },
  { id: 'sky', hex: '#6EC6F0' }, { id: 'blue', hex: '#1E90FF' },
  { id: 'navy', hex: '#13235B' }, { id: 'indigo', hex: '#6478D8' },
  { id: 'purple', hex: '#7543A3' }, { id: 'lilac', hex: '#BE9AE5' },
  { id: 'pink', hex: '#FF5FA8' }, { id: 'cream', hex: '#F4E9D0' },
] as const;

export type TeamPaletteId = typeof TEAM_PALETTE[number]['id'];
export function paletteColor(id: TeamPaletteId): string {
  return TEAM_PALETTE.find(p => p.id === id)!.hex;
}

export function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const linear = (v: number): number => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linear((n >> 16 & 255) / 255) + 0.7152 * linear((n >> 8 & 255) / 255) + 0.0722 * linear((n & 255) / 255);
}
export function contrast(a: string, b: string): number {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** D-001: covers raised graphite and the lightest panel composite over white scenery. */
export function hudStripColor(id: TeamPaletteId): string {
  const hex = paletteColor(id);
  const n = Number.parseInt(hex.slice(1), 16);
  for (let i = 0; i <= 255; i++) {
    const mix = (v: number): string => Math.round(v + (255 - v) * i / 255).toString(16).padStart(2, '0');
    const c = `#${mix(n >> 16 & 255)}${mix(n >> 8 & 255)}${mix(n & 255)}`.toUpperCase();
    if (contrast(c, '#27292B') >= 3) return c;
  }
  return '#FFFFFF';
}
