// Pit building, control tower and paddock (Ç7, report §7.9): garages along the pit lane (front at the garage-side
// barrier line, ≈ +22 m from the main centreline), team-coloured garage bays at each box, office and glazed VIP
// floors, roof canopy over the apron, control tower near the S/F line, paddock slab with team motorhomes.
// S2-Ç4: fictional team name boards on the garage fascias, HAIRPIN GP wordmark on the control tower, pit speed-limit
// boards (80 / end of limit), team pit-wall stands with canopies, office windows lit at sunset / night.

import { BufferAttribute, BufferGeometry, Color, Group, Mesh } from 'three';
import { envMaterial, EnvMode } from '../materials/shared';
import type { Vec3 } from '../../contracts/common';
import type { TrackFrame } from '../../contracts/track';
import { TEAMS } from '../../data/teams';
import { canvasTexture, makeRand } from '../mesh/textures';
import { boxInFrame, SBuf } from './stands';
import { drawSponsor, FONT, loadFonts, SPONSORS } from './trackside';
import type { EnvContext, EnvPart } from './environment';

/** Pit atlas (1024 × 512): team boards 2 × 5 cells of 512 × 80, then the limit signs and the tower wordmark. */
const PA_W = 1024, PA_H = 512;
type PCell = [number, number, number, number];
const teamCell = (k: number): PCell => [(k % 2) * 512, Math.floor(k / 2) * 80, 512, 80];
const LIMIT_CELL: PCell = [0, 400, 112, 112];
const END_CELL: PCell = [112, 400, 112, 112];
const WORDMARK_CELL: PCell = [256, 400, 768, 112];

function pitAtlas() {
  return canvasTexture(PA_W, PA_H, (g) => {
    g.fillStyle = '#0A0C0F';
    g.fillRect(0, 0, PA_W, PA_H);
    TEAMS.forEach((t, k) => {
      const [x, y, w, h] = teamCell(k);
      const bg = new Color(t.colors.primary);
      const light = bg.r * 0.2126 + bg.g * 0.7152 + bg.b * 0.0722 > 0.35;
      g.fillStyle = t.colors.primary;
      g.fillRect(x, y, w, h);
      g.fillStyle = t.colors.secondary;
      g.fillRect(x, y + h - 12, w, 12);
      g.fillStyle = light ? '#0A0C0F' : '#F2F4F7';
      g.font = `800 ${h * 0.56}px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      // Pre-composed display string (D-008: team names never take Turkish casing).
      g.fillText(t.name.toUpperCase(), x + w / 2, y + h * 0.44);
    });
    const sign = ([x, y, w, h]: PCell, end: boolean): void => {
      const cx = x + w / 2, cy = y + h / 2, r = w * 0.44;
      g.fillStyle = '#F2F4F7';
      g.fillRect(x, y, w, h);
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.fillStyle = end ? '#F2F4F7' : '#C8102E';
      g.fill();
      if (!end) {
        g.beginPath();
        g.arc(cx, cy, r * 0.78, 0, Math.PI * 2);
        g.fillStyle = '#F2F4F7';
        g.fill();
      } else {
        g.lineWidth = 3;
        g.strokeStyle = '#0A0C0F';
        g.stroke();
      }
      g.fillStyle = end ? '#6B7078' : '#0A0C0F';
      g.font = `800 ${w * 0.42}px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('80', cx, cy + 3);
      if (end) {
        g.save();
        g.beginPath();
        g.arc(cx, cy, r, 0, Math.PI * 2);
        g.clip();
        g.strokeStyle = '#0A0C0F';
        g.lineWidth = 5;
        for (let k = -2; k <= 2; k++) {
          g.beginPath();
          g.moveTo(cx - r + k * 9, cy + r);
          g.lineTo(cx + r + k * 9, cy - r);
          g.stroke();
        }
        g.restore();
      }
    };
    sign(LIMIT_CELL, false);
    sign(END_CELL, true);
    drawSponsor(g, SPONSORS[9]!, ...WORDMARK_CELL);
  });
}

/** Textured quads into the pit atlas (opaque env family; no vertex colours needed in Plain mode). */
class TBuf {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; col: number[] = []; idx: number[] = [];
  /** p = [bottom-left, bottom-right, top-left, top-right] seen from the front. */
  quad(p: number[][], n: [number, number, number], cell: PCell): void {
    const b = this.pos.length / 3;
    const [cx, cy, cw, ch] = cell;
    const u0 = (cx + 1) / PA_W, u1 = (cx + cw - 1) / PA_W, v0 = 1 - (cy + ch - 1) / PA_H, v1 = 1 - (cy + 1) / PA_H;
    [[u0, v0], [u1, v0], [u0, v1], [u1, v1]].forEach((uv, k) => {
      this.pos.push(...p[k]!);
      this.nor.push(...n);
      this.uv.push(uv[0]!, uv[1]!);
      this.col.push(1, 1, 1);
    });
    this.idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** Emissive intensity of lit windows per time of day. */
const WINDOW_GLOW = { day: 0, sunset: 0.18, night: 0.4 } as const;

export async function createPitBuilding(c: EnvContext): Promise<EnvPart & { triangles: number }> {
  const { track, ex } = c;
  const { data, query: q } = track;
  const pit = data.pit;
  const group = new Group();
  group.name = 'pitBuilding';
  if (pit.count < 2 || pit.boxes.length === 0) return { root: group, triangles: 0, dispose() {} };

  await loadFonts();
  const atlas = pitAtlas();
  const facade = new SBuf();
  const glass = new SBuf();
  const emissive = new SBuf();
  const boards = new TBuf();
  const white = new Color(0.6, 0.61, 0.62);
  const grey = new Color(0.17, 0.18, 0.19);
  const dark = new Color(0.02, 0.022, 0.024);
  // Glass: albedo from the material; the vertex colour is the window's light (EnvMode.Garage emissive) at night.
  const rand = makeRand(2024);
  const warm = new Color(1.0, 0.82, 0.58), cool = new Color(0.72, 0.82, 1.0), off = new Color(0.04, 0.04, 0.05);
  const windowLight = (): Color => { const r = rand(); return r < 0.5 ? warm : r < 0.68 ? cool : off; };
  const glassC = warm;
  const slab = new Color(0.13, 0.13, 0.13);
  const panel = new Color(0.32, 0.34, 0.37);
  const frameC = new Color(0.035, 0.037, 0.04);
  const graphite = new Color(0.06, 0.065, 0.07);
  const rib = new Color(0.24, 0.25, 0.27);
  const plant = new Color(0.36, 0.37, 0.38);
  const P: Vec3 = { x: 0, y: 0, z: 0 };
  const dsp = ex.pitDsp;
  const sg = ex.pitSide;
  const BAY = 6;
  const DEPTH = 28;
  const PADDOCK = 90;
  const ground = c.ground;
  const first = pit.boxes[0]!.sp;
  const last = pit.boxes[pit.boxes.length - 1]!.sp;
  const spA = first - 54;
  const spB = last + 54;
  const teamAt = (sp: number): string | null => {
    for (const b of pit.boxes) if (Math.abs(sp - b.sp) <= BAY) return b.teamId;
    return null;
  };
  const colorOf = (id: string): Color => new Color(TEAMS.find((t) => t.id === id)?.colors.primary ?? '#888888');
  // S/F lies inside the building range: the control tower stands there.
  let towerSp = (spA + spB) / 2;
  {
    let best = Infinity;
    for (let j = 0; j < pit.count; j++) {
      const d = Math.abs(q.deltaS(ex.pitMainS[j]!, 0));
      if (d < best) { best = d; towerSp = j * dsp; }
    }
  }

  for (let sp = spA; sp < spB - 0.01; sp += BAY) {
    const mid = sp + BAY / 2;
    const j = Math.min(pit.count - 2, Math.round(mid / dsp));
    const front = ex.pitOuterWallD[j]! + 0.3 * sg;
    q.pitWorldFromSD(mid, front, P);
    const o = { x: P.x, y: pit.y[j]!, z: P.z };
    // Frame rotated 180° for a right-side pit (keeps the handedness, so face winding stays front-facing).
    const tx = sg * pit.tx[j]!, tz = sg * pit.tz[j]!;
    const vx = tz, vz = -tx; // garage side = away from the lane
    const u: [number, number] = [-BAY / 2 - 0.02, BAY / 2 + 0.02];
    const team = teamAt(mid);
    // Ground under this bay (relative to the floor): the paddock is flat only where height.ts flattened it. Where the
    // pit lane bends away (Ardennes: the exit behind T1, the descent behind the paddock) the terrain falls off, so the
    // slab stops at the first ground step and the building gets a plinth down to the terrain (no floating edges).
    const rel = (vv: number, uu = 0): number => ground ? ground.height(o.x + tx * uu + vx * vv, o.z + tz * uu + vz * vv) - o.y : 0;
    let drop = 0;
    for (const vv of [0, 10, 20, DEPTH]) for (const uu of [u[0], u[1]]) drop = Math.min(drop, rel(vv, uu));
    // Spare bays past the boxes stop where the lane bends off the flattened ground (no tall plinth beside the exit).
    if (!team && drop < -1.5 && (mid < first || mid > last)) continue;
    if (drop < -0.05) boxInFrame(facade, o, u, [0.3, DEPTH], [drop - 0.3, 0], tx, tz, vx, vz, white);
    let room = 0;
    while (room < PADDOCK && Math.abs(rel(DEPTH + room + 2, u[0])) < 0.6 && Math.abs(rel(DEPTH + room + 2, u[1])) < 0.6) room += 2;
    // Ground floor: garage opening (recessed, team colour back wall) between pillars.
    boxInFrame(facade, o, [u[0], u[0] + 0.5], [0, DEPTH], [0, 5], tx, tz, vx, vz, white);
    boxInFrame(facade, o, [u[1] - 0.5, u[1]], [0, DEPTH], [0, 5], tx, tz, vx, vz, white);
    // QC2-17: graphite pillar plinths and a recessed graphite joint up each pillar face.
    for (const m of [u[0], u[1] - 0.5]) {
      boxInFrame(facade, o, [m - 0.02, m + 0.52], [-0.04, 0.6], [0, 0.7], tx, tz, vx, vz, graphite);
      boxInFrame(facade, o, [m + 0.21, m + 0.29], [-0.015, 0.2], [0.7, 4.95], tx, tz, vx, vz, graphite);
    }
    const bay = Math.round((sp - spA) / BAY);
    const back = team ? colorOf(team) : grey;
    if (team) {
      // Open garage: dark epoxy floor, lit team-coloured back wall and side panels, ceiling strip.
      boxInFrame(facade, o, [u[0] + 0.5, u[1] - 0.5], [0, 10], [-0.2, 0.03], tx, tz, vx, vz, dark);
      boxInFrame(emissive, o, [u[0] + 0.5, u[1] - 0.5], [9.6, 10], [0, 4.2], tx, tz, vx, vz, back);
      boxInFrame(emissive, o, [u[0] + 0.5, u[0] + 0.62], [2, 9.6], [0, 3.6], tx, tz, vx, vz, back);
      boxInFrame(emissive, o, [u[1] - 0.62, u[1] - 0.5], [2, 9.6], [0, 3.6], tx, tz, vx, vz, back);
      boxInFrame(facade, o, [u[0] + 0.5, u[1] - 0.5], [1.2, 10], [4.1, 4.2], tx, tz, vx, vz, grey, true);
      boxInFrame(facade, o, [u[0] + 0.5, u[1] - 0.5], [10, DEPTH], [0, 4.2], tx, tz, vx, vz, grey);
      boxInFrame(facade, o, [u[0] + 0.5, u[1] - 0.5], [0.0, 1.2], [4.2, 5], tx, tz, vx, vz, back);
    } else {
      // Closed roller door (ribbed grey) and plain fascia.
      boxInFrame(facade, o, [u[0] + 0.5, u[1] - 0.5], [0.6, DEPTH], [0, 4.2], tx, tz, vx, vz, grey);
      boxInFrame(facade, o, [u[0] + 0.5, u[1] - 0.5], [0.0, 1.2], [4.2, 5], tx, tz, vx, vz, panel);
      // Roller-door ribs, a bottom rail and a small personnel door in every other closed bay.
      const n0 = [-vx, 0, -vz];
      const D = (uu: number, yy: number): number[] => [o.x + tx * uu + vx * 0.58, o.y + yy, o.z + tz * uu + vz * 0.58];
      for (let yy = 0.35; yy < 4.0; yy += 0.42) facade.quad([D(u[0] + 0.5, yy), D(u[1] - 0.5, yy), D(u[0] + 0.5, yy + 0.07), D(u[1] - 0.5, yy + 0.07)], n0, rib);
      boxInFrame(facade, o, [u[0] + 0.5, u[1] - 0.5], [0.45, 0.6], [0, 0.18], tx, tz, vx, vz, graphite);
      if (bay % 2 === 0) boxInFrame(facade, o, [u[1] - 1.75, u[1] - 0.75], [0.52, 0.6], [0, 2.2], tx, tz, vx, vz, graphite);
    }
    // First floor (offices): panel band + window strip with mullions; VIP floor glazed and set back; roof canopy.
    boxInFrame(facade, o, u, [0, DEPTH], [5, 6.2], tx, tz, vx, vz, graphite);
    // Team-coloured stripe along the office band over a team's garages; light trim line on the others.
    boxInFrame(facade, o, u, [-0.03, 0.1], team ? [5.0, 5.22] : [5.0, 5.06], tx, tz, vx, vz, team ? colorOf(team) : white);
    boxInFrame(glass, o, u, [0.6, DEPTH], [6.2, 8.4], tx, tz, vx, vz, windowLight());
    for (const m of [u[0], 0]) boxInFrame(facade, o, [m, m + 0.18], [0.3, 0.6], [6.2, 8.4], tx, tz, vx, vz, frameC);
    boxInFrame(facade, o, u, [0, DEPTH], [8.4, 9.4], tx, tz, vx, vz, white);
    boxInFrame(facade, o, u, [-1.2, 0], [8.95, 9.4], tx, tz, vx, vz, white, true);
    boxInFrame(glass, o, u, [1.5, DEPTH - 2], [9.4, 12.6], tx, tz, vx, vz, windowLight());
    for (const m of [u[0], -1, 1]) boxInFrame(facade, o, [m, m + 0.12], [1.3, 1.5], [9.4, 12.6], tx, tz, vx, vz, frameC);
    boxInFrame(facade, o, [u[0] - 0.01, u[1] + 0.01], [-4.5, DEPTH + 0.5], [12.6, 13.3], tx, tz, vx, vz, white, true);
    // Canopy fascia: graphite drip edge, HAIRPIN GP wordmark every fourth bay; roof parapet and plant.
    boxInFrame(facade, o, [u[0] - 0.01, u[1] + 0.01], [-4.53, -4.2], [12.48, 12.62], tx, tz, vx, vz, graphite);
    if (bay % 4 === 2 && Math.abs(mid - towerSp) > BAY * 2) {
      const vf = -4.5 - 0.03;
      const pt = (uu: number, yy: number): number[] => [o.x + tx * uu + vx * vf, o.y + yy, o.z + tz * uu + vz * vf];
      boards.quad([pt(-2.3, 12.63), pt(2.3, 12.63), pt(-2.3, 13.27), pt(2.3, 13.27)], [-vx, 0, -vz], WORDMARK_CELL);
    }
    boxInFrame(facade, o, u, [DEPTH + 0.2, DEPTH + 0.5], [13.3, 14.0], tx, tz, vx, vz, white);
    if (bay % 3 === 1) {
      boxInFrame(facade, o, [-1.8, 0.6], [8, 11], [13.3, 14.7], tx, tz, vx, vz, plant);
      boxInFrame(facade, o, [-1.5, 0.3], [8.3, 10.7], [14.7, 14.85], tx, tz, vx, vz, graphite);
    } else if (bay % 3 === 2) {
      boxInFrame(facade, o, [-0.7, 0.7], [16, 17.4], [13.3, 14.3], tx, tz, vx, vz, plant);
    }
    // Paddock slab behind.
    if (room > 0) boxInFrame(facade, o, u, [DEPTH, DEPTH + room], [-0.6, 0.12], tx, tz, vx, vz, slab);
    // Motorhomes: two rows in the paddock, team colours (each row only where the slab reaches past it).
    if (team && Math.abs(mid - pit.boxes.find((b) => b.teamId === team)!.sp) < BAY / 2) {
      const col = colorOf(team);
      if (room >= 40 && Math.abs(rel(DEPTH + 34, -7)) < 0.6 && Math.abs(rel(DEPTH + 34, 7)) < 0.6) {
        boxInFrame(facade, o, [-7, 7], [DEPTH + 22, DEPTH + 34], [0, 7.5], tx, tz, vx, vz, col);
        boxInFrame(glass, o, [-7.05, 7.05], [DEPTH + 21.9, DEPTH + 34.1], [3, 5.5], tx, tz, vx, vz, glassC);
      }
      if (room >= 64 && Math.abs(rel(DEPTH + 58, -6)) < 0.6 && Math.abs(rel(DEPTH + 58, 6)) < 0.6) {
        boxInFrame(facade, o, [-6, 6], [DEPTH + 50, DEPTH + 58], [0, 4], tx, tz, vx, vz, white);
      }
    }
    // Control tower (behind the building, near the S/F line).
    if (Math.abs(mid - towerSp) < BAY / 2) {
      boxInFrame(facade, o, [-5, 5], [DEPTH - 12, DEPTH - 2], [13.3, 30], tx, tz, vx, vz, white);
      boxInFrame(glass, o, [-6.5, 6.5], [DEPTH - 13.5, DEPTH - 0.5], [30, 34.5], tx, tz, vx, vz, glassC);
      boxInFrame(facade, o, [-7.2, 7.2], [DEPTH - 14.2, DEPTH + 0.2], [34.5, 35.4], tx, tz, vx, vz, white, true);
      boxInFrame(facade, o, [-0.2, 0.2], [DEPTH - 7.2, DEPTH - 6.8], [35.4, 42], tx, tz, vx, vz, grey);
      // Series wordmark across the tower front (lane side), right = +t as seen from the lane.
      const v0 = DEPTH - 12 - 0.03;
      const pt = (uu: number, yy: number): number[] => [o.x + tx * uu + vx * v0, o.y + yy, o.z + tz * uu + vz * v0];
      boards.quad([pt(-4.8, 26), pt(4.8, 26), pt(-4.8, 27.4), pt(4.8, 27.4)], [-vx, 0, -vz], WORDMARK_CELL);
    }
  }

  // ---- team name boards on the garage fascias -------------------------------------------------------------
  pit.boxes.forEach((b) => {
    const k = TEAMS.findIndex((t) => t.id === b.teamId);
    if (k < 0) return;
    const j = Math.min(pit.count - 2, Math.round(b.sp / dsp));
    q.pitWorldFromSD(b.sp, ex.pitOuterWallD[j]! + 0.3 * sg, P);
    const tx = sg * pit.tx[j]!, tz = sg * pit.tz[j]!;
    const vx = tz, vz = -tx;
    const ox = P.x - vx * 0.03, oy = pit.y[j]!, oz = P.z - vz * 0.03;
    const pt = (uu: number, yy: number): number[] => [ox + tx * uu, oy + yy, oz + tz * uu];
    boards.quad([pt(-2.6, 4.28), pt(2.6, 4.28), pt(-2.6, 4.92), pt(2.6, 4.92)], [-vx, 0, -vz], teamCell(k));
  });

  // ---- pit speed-limit boards (80 at the limit line, end-of-limit at the exit), both sides of the lane ------
  for (const [sp, cell] of [[pit.limitStartSp, LIMIT_CELL], [pit.limitEndSp, END_CELL]] as [number, PCell][]) {
    const j = Math.max(0, Math.min(pit.count - 2, Math.round(sp / dsp)));
    const tx = pit.tx[j]!, tz = pit.tz[j]!;
    const rx = -tz, rz = tx; // right of a driver facing +t
    for (const d of [-(pit.halfWidth[j]! + 0.7), pit.halfWidth[j]! + 0.7]) {
      if (sg * d > 0 && sg * d > sg * ex.pitOuterWallD[j]! - 0.3) continue;
      q.pitWorldFromSD(sp, d, P);
      const y0 = pit.y[j]!;
      const pt = (rr: number, yy: number): number[] => [P.x + rx * rr - tx * 0.05, y0 + yy, P.z + rz * rr - tz * 0.05];
      boards.quad([pt(-0.55, 1.6), pt(0.55, 1.6), pt(-0.55, 2.7), pt(0.55, 2.7)], [-tx, 0, -tz], cell);
      boxInFrame(facade, { x: P.x, y: y0, z: P.z }, [-0.05, 0.05], [0, 0.08], [0, 2.7], rx, rz, tx, tz, frameC);
    }
  }

  // ---- team pit-wall stands: platform, desk, posts and a team-coloured canopy on the pit side of the wall ----
  {
    const f: TrackFrame = { s: 0, px: 0, py: 0, pz: 0, tx: 1, tz: 0, lx: 0, lz: -1, halfWidthL: 0, halfWidthR: 0, crossSlope: 0, curvature: 0, vCurvature: 0, grade: 0, sector: 0 };
    pit.boxes.forEach((b, k) => {
      const s = ex.boxMainS[k];
      if (s === undefined) return;
      const wd = ex.pitWallD[Math.round(q.wrapS(s)) % track.data.count]!;
      if (!Number.isFinite(wd)) return;
      const side = Math.sign(wd) || 1;
      q.frameAt(s, f);
      q.worldFromSD(s, wd + side * ex.pitWallThickness, P);
      const o = { x: P.x, y: P.y, z: P.z };
      const ux = side * f.tx, uz = side * f.tz, vx = side * f.lx, vz = side * f.lz;
      boxInFrame(facade, o, [-2.4, 2.4], [-0.4, 1.0], [1.0, 1.15], ux, uz, vx, vz, grey, true);
      boxInFrame(facade, o, [-2.2, 2.2], [-0.35, -0.05], [1.15, 1.85], ux, uz, vx, vz, dark);
      for (const uu of [-2.3, 2.2]) boxInFrame(facade, o, [uu, uu + 0.1], [0.85, 0.95], [0, 3.3], ux, uz, vx, vz, frameC);
      boxInFrame(facade, o, [-2.7, 2.7], [-0.9, 1.6], [3.3, 3.55], ux, uz, vx, vz, colorOf(b.teamId), true);
    });
  }

  const facadeMat = envMaterial(c.sh, { name: 'pit.facade', family: 'opaque', vertexColor: true, roughness: 0.7, metalness: 0.05, wet: 0.5 });
  // Glass: dark reflective albedo; vertex colour = window light, emissive by time of day (EnvMode.Garage).
  const glassMat = envMaterial(c.sh, {
    name: 'pit.glass', family: 'opaque', mode: EnvMode.Garage, color: 0x0d1217, emissive: 0xffffff, emissiveIntensity: 0,
    roughness: 0.08, metalness: 0.9, wet: 0, flood: 0.3,
  });
  const boardMat = envMaterial(c.sh, { name: 'pit.boards', family: 'opaque', map: atlas, roughness: 0.7, wet: 0.4 });
  // Garage back walls: emissive × vertex colour (EnvMode.Garage). The S1 program error (vec4 vColor into vec3) is gone.
  const emiMat = envMaterial(c.sh, {
    name: 'pit.garageBack', family: 'opaque', mode: EnvMode.Garage, vertexColor: true, roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0.35,
    wet: 0, flood: 0.5,
  });
  const geos = [facade.geometry(), glass.geometry(), emissive.geometry(), boards.geometry()];
  const mats = [facadeMat, glassMat, emiMat, boardMat];
  const casts = (m: Mesh): boolean => m.material === facadeMat || m.material === glassMat;
  geos.forEach((g, k) => {
    const m = new Mesh(g, mats[k]);
    m.castShadow = c.quality.id !== 'low' && casts(m);
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    group.add(m);
  });
  const triangles = geos.reduce((a, g) => a + g.index!.count / 3, 0);
  return {
    root: group,
    triangles,
    applyConditions(cc) {
      glassMat.emissiveIntensity = WINDOW_GLOW[cc.tod];
    },
    setQuality(qp) {
      for (const ch of group.children) (ch as Mesh).castShadow = qp.id !== 'low' && casts(ch as Mesh);
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      atlas.dispose();
      group.removeFromParent();
    },
  };
}
