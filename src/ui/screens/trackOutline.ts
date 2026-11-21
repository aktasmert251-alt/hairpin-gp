// Shared loading/setup outline. Same north-up x/z projection and dashed pit lane as the HUD minimap.
import type { TrackData } from '../../contracts/track';

const NS = 'http://www.w3.org/2000/svg';

export function trackOutline(t: TrackData, detailed = false): SVGSVGElement {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const ribbon of [t, t.pit]) for (let i = 0; i < ribbon.count; i++) {
    minX = Math.min(minX, ribbon.x[i]!); maxX = Math.max(maxX, ribbon.x[i]!);
    minZ = Math.min(minZ, ribbon.z[i]!); maxZ = Math.max(maxZ, ribbon.z[i]!);
  }
  const scale = detailed ? Math.min(616 / (maxX - minX), 356 / (maxZ - minZ)) : 1;
  const ox = detailed ? (680 - (maxX - minX) * scale) / 2 - minX * scale : 0;
  const oz = detailed ? (420 - (maxZ - minZ) * scale) / 2 - minZ * scale : 0;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', detailed ? '0 0 680 420' : `${minX} ${minZ} ${maxX - minX} ${maxZ - minZ}`);
  svg.setAttribute('aria-hidden', 'true');
  const path = (ribbon: Pick<TrackData, 'x' | 'z' | 'count'>, from: number, to: number, cls: string): void => {
    const p = document.createElementNS(NS, 'path');
    let d = '';
    const point = (i: number) => `${(ribbon.x[i % ribbon.count]! * scale + ox).toFixed(1)} ${(ribbon.z[i % ribbon.count]! * scale + oz).toFixed(1)}`;
    for (let i = from; i < to; i += 6) d += `${i === from ? 'M' : 'L'}${point(i)}`;
    p.setAttribute('d', `${d}L${point(to)}`);
    p.setAttribute('class', cls);
    svg.appendChild(p);
  };
  if (!detailed) { path(t, 0, t.count, 'outline'); return svg; }
  path(t, 0, t.count, 'outline');
  const bounds = [0, ...t.sectors.map(s => Math.round(s / t.ds)), t.count];
  for (let i = 0; i < 3; i++) path(t, bounds[i]!, bounds[i + 1]!, `sector sector-${i + 1}`);
  if (t.pit.count > 1) path(t.pit, 0, t.pit.count - 1, 'pit');
  const finish = Math.round((t.timingLines.find(l => l.kind === 'finish')?.s ?? 0) / t.ds) % t.count;
  const x = t.x[finish]! * scale + ox, z = t.z[finish]! * scale + oz;
  const nx = -t.tz[finish]! * 12, nz = t.tx[finish]! * 12;
  const marker = document.createElementNS(NS, 'path');
  marker.setAttribute('d', `M${x - nx} ${z - nz}L${x + nx} ${z + nz}`);
  marker.setAttribute('class', 'finish');
  svg.appendChild(marker);
  const labels: { x: number; y: number }[] = [];
  for (const c of t.corners) {
    const i = Math.round(c.apexS / t.ds) % t.count;
    const label = document.createElementNS(NS, 'text');
    // Label the inside of each corner, clear of the racing line.
    const side = c.dir === 'L' ? 1 : -1;
    const px = t.x[i]! * scale + ox, py = t.z[i]! * scale + oz;
    let x = px, y = py;
    for (const offset of [17, 32, 47, -20, -35]) {
      x = px + t.tz[i]! * side * offset;
      y = py - t.tx[i]! * side * offset;
      if (labels.every(p => Math.hypot(p.x - x, p.y - y) >= 22)) break;
    }
    labels.push({ x, y });
    label.setAttribute('x', String(x));
    label.setAttribute('y', String(y));
    label.textContent = String(c.n);
    svg.appendChild(label);
  }
  return svg;
}
