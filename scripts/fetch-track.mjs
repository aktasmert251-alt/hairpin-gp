#!/usr/bin/env node
// APEX GP track data pipeline (Çevre, planner-report §7.2, tracks.md §1.3). Run once per track; the output is committed.
//
//   node scripts/fetch-track.mjs [--track <id>]   fetch OSM geometry + scenery + EU-DEM elevation, write src/track/data/<id>.raw.json
//   node scripts/fetch-track.mjs --fallback       skip the network, build the raw file from the track's fallback module
//   node scripts/fetch-track.mjs --no-terrain     skip the 3 × 3 km terrain grid (centreline elevation only)
// <id> is a key of TRACKS below (default istanbul).
//
// Network paths, each with a descriptive User-Agent and no personal data:
//   1. geometry: ways: Overpass POST (3 tries, exponential backoff) → OSM API way/<id>/full.json
//                relation: OSM API relation/<id>/full.json → Overpass; member ways chained from the start node, fail closed
//                to the fallback if the chain does not close
//   2. scenery:  OSM API map.json (bbox) → Overpass
//   3. elevation: OpenTopoData eudem25m, ≤ 100 points per call, ≥ 1.1 s between calls
// If geometry cannot be fetched the whole file falls back to §7.15 (source "fallback"). If only elevation fails, the
// centreline elevation comes from §7.4 and the terrain grid is omitted (source "osm+fallback-elevation").
// Idempotent: the output depends only on the fetched data (sorted, rounded, no timestamps).

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'APEX-GP-track-pipeline/1.0 (non-commercial browser racing game prototype; one-off data fetch)';

// Real circuit names appear only here, in scripts/ comments (tracks.md Ek A); the game uses the fictional ids.
const TRACKS = {
  // Istanbul Park (planner-report §7).
  istanbul: {
    mainWay: 179048507, pitWay: 295742111, sfNode: 1893855303,
    bbox: { minLon: 29.396, minLat: 40.945, maxLon: 29.425, maxLat: 40.966 },
    origin: { lat: 40.95222, lon: 29.4063884 }, demOffset: 130.6, fallback: 'fallback.ts', ruins: false,
  },
  // Autodromo Nazionale Monza (tracks.md §2): circuit relation, pit way, S/F node; old banking ruins kept as 'ruin'.
  lombardia: {
    relation: 284565, pitWay: 38168747, sfNode: 1828499259,
    bbox: { minLon: 9.2755, minLat: 45.6083, maxLon: 9.302, maxLat: 45.635 },
    origin: { lat: 45.6189632, lon: 9.2811729 }, demOffset: 188.7, fallback: 'fallback-lombardia.ts', ruins: true,
    // Raw-file budget (≤ 80 KB): drop buildings < 500 m² and the kinds no scenery reads, Douglas–Peucker 1.5 m / 5 m.
    slim: { minBuildingArea: 500, dpBuilding: 1.5, dpArea: 5, dropKinds: ['parking', 'grass', 'farmland'] },
  },
  // Circuit de Spa-Francorchamps (docs/design/tracks-spa.md): circuit relation 284560 (start node 258602622), pit way
  // 323851541. Hilly Ardennes: a larger 4.5 × 4.5 km terrain grid at 75 m (≈ the Lombardia sample count, raw ≤ 80 KB).
  ardennes: {
    relation: 284560, pitWay: 323851541, sfNode: 258602622,
    bbox: { minLon: 5.948, minLat: 50.424, maxLon: 5.989, maxLat: 50.45 },
    origin: { lat: 50.4440643, lon: 5.9651626 }, demOffset: 395, fallback: 'fallback-ardennes.ts', ruins: false,
    terrain: { size: 4500, step: 75 },
    slim: { minBuildingArea: 300, dpBuilding: 1.5, dpArea: 6, dropKinds: ['parking', 'grass', 'farmland'] },
  },
  // Original street circuit on the European Bosphorus shore (tracks.md §3): authored centreline, OSM coast/buildings/
  // bridges (Overpass only: the bbox exceeds the OSM API limit), EU-DEM 6 × 6 km at 100 m. See mainAuthored().
  bosphorus: {
    authored: 'bosphorus-ctrl.ts',
    bbox: { minLon: 29.0, minLat: 41.03, maxLon: 29.08, maxLat: 41.09 },
    // Southern and northern suspension bridges; coast reference way for the bearing β (between coastRefLat).
    bridges: [403255158, 403376607], coastRefWay: 671228671, coastRefLat: [41.0504, 41.06],
    origin: { lat: 41.0553, lon: 29.0355 }, demOffset: 2,
  },
};

const argv = process.argv.slice(2);
const args = new Set(argv);
const TRACK_ID = argv.includes('--track') ? argv[argv.indexOf('--track') + 1] : 'istanbul';
const CFG = TRACKS[TRACK_ID];
if (!CFG) {
  console.error(`[fetch-track] unknown --track ${TRACK_ID} (known: ${Object.keys(TRACKS).join(', ')})`);
  process.exit(1);
}
const OUT = path.join(root, 'src', 'track', 'data', `${TRACK_ID}.raw.json`);
const MAIN_WAY = CFG.mainWay;
const PIT_WAY = CFG.pitWay;
const SF_NODE = CFG.sfNode;
const BBOX = CFG.bbox;
const PHI_DEG = CFG.origin.lat;
const PHI = (PHI_DEG * Math.PI) / 180;
const M_LAT = 111132.92 - 559.82 * Math.cos(2 * PHI) + 1.175 * Math.cos(4 * PHI);
const M_LON = 111412.84 * Math.cos(PHI) - 93.5 * Math.cos(3 * PHI);
const DEM_OFFSET = CFG.demOffset; // y = EU-DEM − DEM(S/F) (this constant only when the S/F DEM sample is missing)
const TERRAIN_SIZE = CFG.terrain?.size ?? 3000;
const TERRAIN_STEP = CFG.terrain?.step ?? 50;
const CENTRE_STEP = 25;
/** Ids of the circuit's own ways (never stored as scenery). */
let circuitWays = new Set();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r2 = (v) => Math.round(v * 100) / 100;
const r1 = (v) => Math.round(v * 10) / 10;
const log = (...a) => console.log('[fetch-track]', ...a);

async function fetchRetry(url, init = {}, tries = 3) {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, Accept: 'application/json', ...(init.headers ?? {}) }, signal: AbortSignal.timeout(90_000) });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} (not retried)`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (String(err.message).includes('not retried')) break;
      const wait = 2000 * 2 ** i;
      log(`  ${url.slice(0, 80)}… failed (${err.message}); retry in ${wait} ms`);
      await sleep(wait);
    }
  }
  throw lastErr ?? new Error('fetch failed');
}

const overpass = (q) => fetchRetry('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: `data=${encodeURIComponent(q)}`,
});

// ---- projection ------------------------------------------------------------------------------
let origin = { ...CFG.origin };
const toXZ = (lat, lon) => [r2((lon - origin.lon) * M_LON), r2(-(lat - origin.lat) * M_LAT)];
const toLatLon = (x, z) => ({ lat: origin.lat - z / M_LAT, lon: origin.lon + x / M_LON });

// ---- geometry --------------------------------------------------------------------------------
/** Relation path (tracks.md §1.3): the chained main loop under 'main', the pit under 'pit', member ids under 'members'. */
async function fetchRelationGeometry() {
  let els;
  try {
    log('geometry: OSM API relation full.json');
    els = (await fetchRetry(`https://api.openstreetmap.org/api/0.6/relation/${CFG.relation}/full.json`)).elements;
  } catch (err) {
    log(`geometry: OSM API failed (${err.message}); Overpass`);
    els = (await overpass(`[out:json][timeout:60];relation(${CFG.relation});(._;way(r);node(w););out body;`)).elements;
  }
  const nodes = new Map(els.filter((e) => e.type === 'node').map((n) => [n.id, n]));
  const ways = new Map(els.filter((e) => e.type === 'way').map((w) => [w.id, w]));
  const rel = els.find((e) => e.type === 'relation' && e.id === CFG.relation);
  const mainWays = rel.members.filter((m) => m.type === 'way' && m.role !== 'pit_lane').map((m) => ways.get(m.ref)).filter(Boolean);
  const pitM = rel.members.find((m) => m.type === 'way' && m.role === 'pit_lane');
  // Chain the member ways by shared end nodes, each in its own node order (oneway = driving direction).
  const byFirst = new Map(mainWays.map((w) => [w.nodes[0], w]));
  const startWay = mainWays.find((w) => w.nodes.includes(SF_NODE));
  if (!startWay) throw new Error('start node not on a member way');
  const ids = [];
  let w = startWay;
  for (let guard = 0; guard <= mainWays.length; guard++) {
    ids.push(...w.nodes.slice(0, -1));
    w = byFirst.get(w.nodes[w.nodes.length - 1]);
    if (!w || w === startWay) break;
  }
  if (w !== startWay) throw new Error('member ways do not chain into a closed loop');
  const k = ids.indexOf(SF_NODE);
  const rot = ids.slice(k).concat(ids.slice(0, k));
  if (new Set(rot).size !== rot.length) throw new Error('chain visits a node twice');
  const pt = (id) => ({ lat: nodes.get(id).lat, lon: nodes.get(id).lon });
  const pitWay = ways.get(pitM?.ref ?? PIT_WAY);
  if (!pitWay) throw new Error('pit way missing');
  log(`geometry: chained ${mainWays.length} ways, ${rot.length} nodes`);
  return new Map([
    ['main', { nodes: rot.concat(rot[0]), pts: rot.concat(rot[0]).map(pt) }],
    ['pit', { nodes: pitWay.nodes, pts: pitWay.nodes.map(pt) }],
    ['members', new Set(mainWays.map((mw) => mw.id).concat(pitWay.id))],
  ]);
}

async function fetchGeometry() {
  if (CFG.relation) return fetchRelationGeometry();
  try {
    log('geometry: Overpass');
    const j = await overpass(`[out:json][timeout:60];way(id:${MAIN_WAY},${PIT_WAY});out geom;`);
    const ways = new Map(j.elements.map((w) => [w.id, { nodes: w.nodes, pts: w.geometry.map((g) => ({ lat: g.lat, lon: g.lon })) }]));
    if (!ways.has(MAIN_WAY) || !ways.has(PIT_WAY)) throw new Error('missing way in Overpass answer');
    return ways;
  } catch (err) {
    log(`geometry: Overpass failed (${err.message}); OSM API`);
  }
  const ways = new Map();
  for (const id of [MAIN_WAY, PIT_WAY]) {
    const j = await fetchRetry(`https://api.openstreetmap.org/api/0.6/way/${id}/full.json`);
    const nodes = new Map(j.elements.filter((e) => e.type === 'node').map((n) => [n.id, n]));
    const way = j.elements.find((e) => e.type === 'way' && e.id === id);
    ways.set(id, { nodes: way.nodes, pts: way.nodes.map((n) => ({ lat: nodes.get(n).lat, lon: nodes.get(n).lon })) });
    await sleep(1000);
  }
  return ways;
}

function polyLength(xz, closed) {
  let L = 0;
  const n = xz.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = xz[i];
    const b = xz[(i + 1) % n];
    L += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return L;
}

/** Points every `step` metres along a polyline (closed: wraps), with their arc length. */
function resample(xz, closed, step) {
  const out = [];
  const n = xz.length;
  const segs = closed ? n : n - 1;
  let s = 0;
  let next = 0;
  for (let i = 0; i < segs; i++) {
    const a = xz[i];
    const b = xz[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (next <= s + len) {
      const t = len > 0 ? (next - s) / len : 0;
      out.push({ s: next, x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t });
      next += step;
    }
    s += len;
  }
  if (!closed && out.length && out[out.length - 1].s < s - 1) out.push({ s, x: xz[n - 1][0], z: xz[n - 1][1] });
  return out;
}

// ---- scenery ---------------------------------------------------------------------------------
function classify(tags) {
  if (!tags) return null;
  if (tags.leisure === 'bleachers') return 'bleachers';
  if (tags.building === 'grandstand' || tags['building:use'] === 'grandstand') return 'grandstand';
  if (tags.leisure === 'stadium' && tags.building) return 'grandstand';
  if (tags.building) return 'building';
  if (tags.landuse === 'forest' || tags.natural === 'wood') return 'forest';
  if (tags.natural === 'scrub') return 'scrub';
  if (tags.landuse === 'farmland' || tags.landuse === 'meadow' || tags.landuse === 'orchard') return 'farmland';
  if (tags.landuse === 'residential') return 'residential';
  if (tags.landuse === 'grass' || tags.natural === 'grassland') return 'grass';
  if (tags.amenity === 'parking') return 'parking';
  return null;
}

function joinRings(ways) {
  // ways: arrays of [lat, lon]; joins open ways end to end into closed rings.
  const rings = [];
  const pool = ways.map((w) => w.slice());
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  while (pool.length) {
    let ring = pool.shift();
    let grew = true;
    while (!same(ring[0], ring[ring.length - 1]) && grew) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const w = pool[i];
        const end = ring[ring.length - 1];
        if (same(w[0], end)) ring = ring.concat(w.slice(1));
        else if (same(w[w.length - 1], end)) ring = ring.concat(w.slice().reverse().slice(1));
        else continue;
        pool.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}

function featuresFromElements(elements) {
  const nodes = new Map();
  const ways = new Map();
  for (const e of elements) {
    if (e.type === 'node') nodes.set(e.id, [e.lat, e.lon]);
    else if (e.type === 'way') ways.set(e.id, e);
  }
  const coordsOf = (w) => {
    if (w.geometry) return w.geometry.map((g) => [g.lat, g.lon]);
    const c = w.nodes.map((id) => nodes.get(id));
    return c.every(Boolean) ? c : null;
  };
  const out = [];
  const push = (kind, id, tags, ring) => {
    const xz = ring.map(([lat, lon]) => toXZ(lat, lon));
    // OSM name tags are never stored (tracks.md Ek A).
    const f = { kind, id, xz };
    if (tags.building) f.building = tags.building;
    const levels = Number(tags['building:levels']);
    if (Number.isFinite(levels) && levels > 0) f.levels = levels;
    const h = Number.parseFloat(tags.height);
    if (Number.isFinite(h) && h > 0) f.height = h;
    out.push(f);
  };
  for (const w of ways.values()) {
    const kind = classify(w.tags);
    if (!kind) continue;
    const c = coordsOf(w);
    if (!c || c.length < 3) continue;
    push(kind, w.id, w.tags, c);
  }
  // Old-banking ruins (tracks.md §1.3): raceway ways outside the circuit relation that are ruins or concrete banking.
  if (CFG.ruins) {
    for (const w of ways.values()) {
      const t = w.tags ?? {};
      if (t.highway !== 'raceway' || circuitWays.has(w.id) || t.area === 'yes' || t.bicycle === 'yes') continue;
      if (!(t.historic === 'ruins' && t.surface) && t.surface !== 'concrete') continue;
      const c = coordsOf(w);
      if (!c || c.length < 2) continue;
      const f = { kind: 'ruin', id: w.id, xz: c.map(([lat, lon]) => toXZ(lat, lon)) };
      if (t.bridge === 'yes') f.bridge = true;
      out.push(f);
    }
  }
  for (const r of elements.filter((e) => e.type === 'relation' && e.tags?.type === 'multipolygon')) {
    const kind = classify(r.tags);
    if (!kind) continue;
    const outer = r.members.filter((m) => m.type === 'way' && m.role !== 'inner')
      .map((m) => (m.geometry ? m.geometry.map((g) => [g.lat, g.lon]) : ways.has(m.ref) ? coordsOf(ways.get(m.ref)) : null))
      .filter(Boolean);
    joinRings(outer).forEach((ring, i) => push(kind, r.id * 100 + i, r.tags, ring));
  }
  out.sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.id - b.id));
  return out;
}

async function fetchFeatures() {
  const bb = `${BBOX.minLon},${BBOX.minLat},${BBOX.maxLon},${BBOX.maxLat}`;
  try {
    log('scenery: OSM API map.json');
    const j = await fetchRetry(`https://api.openstreetmap.org/api/0.6/map.json?bbox=${bb}`);
    return featuresFromElements(j.elements);
  } catch (err) {
    log(`scenery: OSM API failed (${err.message}); Overpass`);
  }
  const b = `${BBOX.minLat},${BBOX.minLon},${BBOX.maxLat},${BBOX.maxLon}`;
  const q = `[out:json][timeout:90];(way[leisure=bleachers](${b});way[building](${b});way[landuse~"^(forest|farmland|residential|meadow|grass|orchard)$"](${b});way[natural~"^(wood|scrub|grassland)$"](${b});way[amenity=parking](${b});relation[type=multipolygon][landuse](${b});relation[type=multipolygon][natural](${b}););out geom;`;
  const j = await overpass(q);
  return featuresFromElements(j.elements);
}

/** Douglas–Peucker on an open polyline (the closing edge of a ring is kept by its end points). */
function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  const [fx, fz] = pts[0], [lx, lz] = pts[pts.length - 1];
  if (Math.hypot(fx - lx, fz - lz) < 1e-6) {
    // Closed ring: split at the vertex farthest from the first one, simplify both halves.
    let k = 1, kd = -1;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.hypot(pts[i][0] - fx, pts[i][1] - fz);
      if (d > kd) { kd = d; k = i; }
    }
    return simplify(pts.slice(0, k + 1), tol).concat(simplify(pts.slice(k), tol).slice(1));
  }
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, az] = pts[a], [bx, bz] = pts[b];
    const len = Math.hypot(bx - ax, bz - az) || 1e-9;
    let m = -1, md = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (az - pts[i][1]) - (ax - pts[i][0]) * (bz - az)) / len;
      if (d > md) { md = d; m = i; }
    }
    if (m >= 0) { keep[m] = 1; stack.push([a, m], [m, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

function slimFeatures(features, o) {
  const area = (p) => {
    let a = 0;
    for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; }
    return Math.abs(a / 2);
  };
  const out = [];
  for (const f of features) {
    if (o.dropKinds.includes(f.kind)) continue;
    if (f.kind === 'building') {
      if (area(f.xz) < o.minBuildingArea) continue;
      const g = { ...f, xz: simplify(f.xz, o.dpBuilding).map(([x, z]) => [Math.round(x), Math.round(z)]) };
      if (g.building === 'yes') delete g.building;
      out.push(g);
    } else if (f.kind === 'ruin' || f.kind === 'grandstand' || f.kind === 'bleachers') {
      out.push({ ...f, xz: simplify(f.xz, 0.5).map(([x, z]) => [r1(x), r1(z)]) });
    } else {
      out.push({ ...f, xz: simplify(f.xz, o.dpArea).map(([x, z]) => [Math.round(x), Math.round(z)]) });
    }
  }
  return out;
}

// ---- elevation -------------------------------------------------------------------------------
let lastDemCall = 0;
async function demBatch(points) {
  const wait = lastDemCall + 1100 - Date.now();
  if (wait > 0) await sleep(wait);
  lastDemCall = Date.now();
  const loc = points.map((p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`).join('|');
  const j = await fetchRetry(`https://api.opentopodata.org/v1/eudem25m?locations=${loc}&interpolation=bilinear`);
  if (j.status !== 'OK') throw new Error(`OpenTopoData status ${j.status}`);
  return j.results.map((r) => (typeof r.elevation === 'number' ? r.elevation : NaN));
}

async function dem(points, label) {
  const out = [];
  for (let i = 0; i < points.length; i += 100) {
    const chunk = points.slice(i, i + 100);
    out.push(...(await demBatch(chunk)));
    log(`  ${label}: ${Math.min(points.length, i + 100)}/${points.length}`);
  }
  return out;
}

function fillNaN(arr) {
  // Replace missing samples with the nearest valid neighbour (keeps the grid usable at coverage edges).
  for (let i = 0; i < arr.length; i++) {
    if (Number.isFinite(arr[i])) continue;
    for (let k = 1; k < arr.length; k++) {
      if (Number.isFinite(arr[i - k])) { arr[i] = arr[i - k]; break; }
      if (Number.isFinite(arr[i + k])) { arr[i] = arr[i + k]; break; }
    }
  }
  return arr;
}

// ---- fallback --------------------------------------------------------------------------------
async function loadFallback() {
  return import(pathToFileURL(path.join(root, 'src', 'track', 'data', CFG.fallback)).href);
}

function fallbackElevation(fb, L) {
  const n = fb.FALLBACK_ELEVATION.length;
  return { step: L / n, s: fb.FALLBACK_ELEVATION.map((_, k) => r2((k * L) / n)), y: fb.FALLBACK_ELEVATION.slice() };
}

// ---- main ------------------------------------------------------------------------------------
async function main() {
  if (CFG.authored) return mainAuthored();
  const fb = await loadFallback();
  const raw = {
    version: 1,
    source: 'fallback',
    attribution: fb.ATTRIBUTION.slice(),
    origin: { nodeId: SF_NODE, lat: origin.lat, lon: origin.lon },
    projection: { phiDeg: PHI_DEG, mLat: M_LAT, mLon: M_LON },
    main: { closed: true, length: 0, xz: [] },
    pit: { length: 0, xz: [] },
    elevation: { ref: DEM_OFFSET, step: 0, s: [], y: [] },
    pitElevation: null,
    terrain: null,
    features: [],
  };

  let ways = null;
  if (!args.has('--fallback')) {
    try {
      ways = await fetchGeometry();
    } catch (err) {
      log(`geometry: all network paths failed (${err.message}); using §7.15 fallback`);
    }
  }

  if (ways) {
    const main = ways.get(CFG.relation ? 'main' : MAIN_WAY);
    const closedNodes = main.nodes[0] === main.nodes[main.nodes.length - 1];
    const ids = closedNodes ? main.nodes.slice(0, -1) : main.nodes.slice();
    const pts = closedNodes ? main.pts.slice(0, -1) : main.pts.slice();
    const k = ids.indexOf(SF_NODE);
    if (k < 0) throw new Error(`S/F node ${SF_NODE} not on the main loop`);
    const rot = pts.slice(k).concat(pts.slice(0, k));
    origin = { lat: rot[0].lat, lon: rot[0].lon };
    raw.origin = { nodeId: SF_NODE, lat: origin.lat, lon: origin.lon };
    raw.main.xz = rot.map((p) => toXZ(p.lat, p.lon));
    raw.pit.xz = ways.get(CFG.relation ? 'pit' : PIT_WAY).pts.map((p) => toXZ(p.lat, p.lon));
    circuitWays = ways.get('members') ?? new Set([MAIN_WAY, PIT_WAY]);
    raw.source = 'osm';
  } else {
    raw.main.xz = fb.FALLBACK_MAIN_XZ.map((p) => [p[0], p[1]]);
    raw.pit.xz = fb.FALLBACK_PIT_XZ.map((p) => [p[0], p[1]]);
  }
  raw.main.length = r2(polyLength(raw.main.xz, true));
  raw.pit.length = r2(polyLength(raw.pit.xz, false));
  log(`main loop ${raw.main.xz.length} pts, ${raw.main.length} m; pit ${raw.pit.xz.length} pts, ${raw.pit.length} m (${raw.source})`);

  if (raw.source === 'osm') {
    try {
      raw.features = await fetchFeatures();
      if (CFG.slim) raw.features = slimFeatures(raw.features, CFG.slim);
      log(`scenery: ${raw.features.length} features`);
    } catch (err) {
      log(`scenery: failed (${err.message}); continuing without features`);
    }
  }

  let elevOk = false;
  if (raw.source === 'osm' && !args.has('--no-dem')) {
    try {
      const centre = resample(raw.main.xz, true, CENTRE_STEP).filter((p) => p.s < raw.main.length - 1);
      const pitPts = resample(raw.pit.xz, false, CENTRE_STEP);
      const ys = await dem(centre.map((p) => toLatLon(p.x, p.z)), 'centreline');
      const yp = await dem(pitPts.map((p) => toLatLon(p.x, p.z)), 'pit');
      fillNaN(ys);
      fillNaN(yp);
      const ref = Number.isFinite(ys[0]) ? ys[0] : DEM_OFFSET;
      raw.elevation = { ref: r2(ref), step: CENTRE_STEP, s: centre.map((p) => r2(p.s)), y: ys.map((v) => r2(v - ref)) };
      raw.pitElevation = { step: CENTRE_STEP, s: pitPts.map((p) => r2(p.s)), y: yp.map((v) => r2(v - ref)) };
      elevOk = true;
      if (!args.has('--no-terrain')) {
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const [x, z] of raw.main.xz) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
        }
        const n = Math.round(TERRAIN_SIZE / TERRAIN_STEP) + 1;
        const x0 = Math.round(((minX + maxX) / 2 - TERRAIN_SIZE / 2) / TERRAIN_STEP) * TERRAIN_STEP;
        const z0 = Math.round(((minZ + maxZ) / 2 - TERRAIN_SIZE / 2) / TERRAIN_STEP) * TERRAIN_STEP;
        const grid = [];
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) grid.push(toLatLon(x0 + i * TERRAIN_STEP, z0 + j * TERRAIN_STEP));
        const yg = fillNaN(await dem(grid, 'terrain'));
        raw.terrain = { x0, z0, step: TERRAIN_STEP, nx: n, nz: n, y: yg.map((v) => r1(v - ref)) };
      }
    } catch (err) {
      log(`elevation: failed (${err.message}); using §7.4 fallback samples`);
    }
  }
  if (!elevOk) {
    raw.elevation = { ref: DEM_OFFSET, ...fallbackElevation(fb, raw.main.length) };
    if (raw.source === 'osm') raw.source = 'osm+fallback-elevation';
  }

  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(raw)}\n`);
  log(`wrote ${path.relative(root, OUT)} (${raw.source})`);
}

// ---- authored street circuit (tracks.md §3.2, §3.12) -------------------------------------------
const D2R = Math.PI / 180;
const RAW_BUDGET = 79_000;
const TOWER_SPAN = 1070; // main span between the towers, m (§3.10)
// Anchor shift step along the coast. §3.2 says 50 m; on the live coast no 50 m step satisfies (a)–(c) together (+500 m:
// T9 246 m from the bridge axis; +550 m: coast 22.7 m inland of the seawall), so the fit searches 25 m steps.
const SHIFT_STEP = 25;

async function overpassSlow(q) {
  for (let i = 0; i < 3; i++) {
    try {
      return await overpass(q);
    } catch (err) {
      log(`  Overpass failed (${err.message})${i < 2 ? '; retry in 60 s' : ''}`);
      if (i < 2) await sleep(60_000);
    }
  }
  throw new Error('Overpass unavailable');
}

const shoelace = (p) => {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; }
  return a / 2;
};

/** Douglas–Peucker, then extra points so no segment is longer than maxSeg (keeps Catmull–Rom tame on long straights). */
function simplifyDense(pts, closed, tol, maxSeg) {
  const s = closed ? simplify(pts.concat([pts[0]]), tol).slice(0, -1) : simplify(pts, tol);
  const out = [];
  const n = s.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = s[i], b = s[(i + 1) % n];
    const m = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / maxSeg));
    for (let k = 0; k < m; k++) out.push([a[0] + ((b[0] - a[0]) * k) / m, a[1] + ((b[1] - a[1]) * k) / m]);
  }
  if (!closed) out.push(s[n - 1]);
  return out;
}

async function mainAuthored() {
  const C = await import(pathToFileURL(path.join(root, 'src', 'track', 'authoring', CFG.authored)).href);
  const A0 = CFG.origin;
  // Local metric frame (E, N) around the default anchor; φ = anchor latitude (§7.1 projection).
  const en = (lat, lon) => [(lon - A0.lon) * M_LON, (lat - A0.lat) * M_LAT];
  const ll = (E, N) => ({ lat: A0.lat + N / M_LAT, lon: A0.lon + E / M_LON });
  const poly = C.filletPolygon(C.CTRL, 1);
  const pitUV = C.pitPolyline(poly);

  // ---- 1. OSM: coastline + bridges, then large buildings (names never stored) ----
  const coastWays = [];
  const bridges = [];
  let buildings = [];
  const bb = `${BBOX.minLat},${BBOX.minLon},${BBOX.maxLat},${BBOX.maxLon}`;
  if (!args.has('--fallback')) {
    try {
      log('coast + bridges: Overpass');
      const j = await overpassSlow(`[out:json][timeout:90];(way(id:${CFG.bridges.join(',')});way["natural"="coastline"](${bb}););out geom;`);
      for (const w of j.elements) {
        if (!w.geometry) continue;
        const pts = w.geometry.map((g) => en(g.lat, g.lon));
        if (w.tags?.natural === 'coastline') coastWays.push({ id: w.id, pts });
        else bridges.push({ id: w.id, pts, height: Number.parseFloat(w.tags?.height) || 65 });
      }
      coastWays.sort((a, b) => a.id - b.id);
      bridges.sort((a, b) => a.id - b.id);
      log(`  ${coastWays.length} coastline ways, ${bridges.length} bridges`);
    } catch (err) {
      log(`coast/bridges: failed (${err.message}); straight seawall + far shore at v = −850`);
    }
    if (coastWays.length && !args.has('--no-buildings')) {
      try {
        log('buildings: Overpass (perimeter > 90 m)');
        const j = await overpassSlow(`[out:json][timeout:180];way["building"](if:length()>90)(${bb});out geom;`);
        buildings = j.elements.filter((w) => w.geometry && w.geometry.length >= 4)
          .map((w) => ({ id: w.id, pts: w.geometry.map((g) => en(g.lat, g.lon)), tags: w.tags ?? {} }));
        log(`  ${buildings.length} buildings`);
      } catch (err) {
        log(`buildings: failed (${err.message}); procedural skyline only`);
      }
    }
  }

  // ---- 2. Coast bearing β from the reference way ----
  let beta = C.BETA_DEG;
  const ref = coastWays.find((w) => w.id === CFG.coastRefWay);
  if (ref) {
    const inR = ref.pts.filter(([, N]) => { const lat = A0.lat + N / M_LAT; return lat >= CFG.coastRefLat[0] && lat <= CFG.coastRefLat[1]; });
    if (inR.length >= 2) {
      const a = inR[0], b = inR[inR.length - 1];
      beta = Math.atan2(b[0] - a[0], b[1] - a[1]) / D2R;
      if (beta > 90) beta -= 180;
      if (beta < -90) beta += 180;
    }
  }
  beta = Math.round(beta * 10) / 10;
  const beta0 = beta;
  const sb0 = Math.sin(beta0 * D2R), cb0 = Math.cos(beta0 * D2R);
  let sb = sb0, cb = cb0;
  const setBeta = (b) => { beta = b; sb = Math.sin(b * D2R); cb = Math.cos(b * D2R); };
  const toEN = (a, u, v) => [a[0] + u * sb - v * cb, a[1] + u * cb + v * sb];
  const toUV = (a, E, N) => { const dE = E - a[0], dN = N - a[1]; return [dE * sb + dN * cb, -dE * cb + dN * sb]; };
  log(`coast bearing β = ${beta}°`);

  // ---- 3. Water test (nearest coastline segment, land on its left) and coast crossings along v ----
  const segs = [];
  for (const w of coastWays) for (let i = 0; i + 1 < w.pts.length; i++) segs.push([w.pts[i], w.pts[i + 1]]);
  const coastSide = (E, N) => {
    let best = Infinity, cr = 1;
    for (const [A, B] of segs) {
      const dx = B[0] - A[0], dz = B[1] - A[1];
      const l2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((E - A[0]) * dx + (N - A[1]) * dz) / l2));
      const d2 = (A[0] + dx * t - E) ** 2 + (A[1] + dz * t - N) ** 2;
      if (d2 < best) { best = d2; cr = dx * (N - A[1]) - dz * (E - A[0]); }
    }
    return cr; // > 0 land
  };
  /** v of the coastline crossing nearest to the seawall on the v line through u (null: none within ±400 m). */
  const coastV = (a, u) => {
    const P = toEN(a, u, 0);
    const dv = [-cb, sb];
    let best = null;
    for (const [A, B] of segs) {
      const ex = B[0] - A[0], ez = B[1] - A[1];
      const den = dv[0] * ez - dv[1] * ex;
      if (Math.abs(den) < 1e-9) continue;
      const wx = A[0] - P[0], wz = A[1] - P[1];
      const t = (wx * ez - wz * ex) / den; // along v
      const s = (wx * dv[1] - wz * dv[0]) / den; // along the segment
      if (s < 0 || s > 1 || Math.abs(t) > 400) continue;
      if (best === null || Math.abs(t - C.SEAWALL_V) < Math.abs(best - C.SEAWALL_V)) best = t;
    }
    return best;
  };

  // ---- 4. Bridge towers (principal axis of the outline, towers at mid ± span/2) ----
  const towersOf = (b) => {
    const n = b.pts.length;
    let cx = 0, cz = 0;
    for (const p of b.pts) { cx += p[0] / n; cz += p[1] / n; }
    let xx = 0, xz = 0, zz = 0;
    for (const p of b.pts) { const dx = p[0] - cx, dz = p[1] - cz; xx += dx * dx; xz += dx * dz; zz += dz * dz; }
    const ang = 0.5 * Math.atan2(2 * xz, xx - zz);
    const d = [Math.cos(ang), Math.sin(ang)];
    let t0 = Infinity, t1 = -Infinity;
    for (const p of b.pts) { const t = (p[0] - cx) * d[0] + (p[1] - cz) * d[1]; t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
    const m = [cx + d[0] * (t0 + t1) / 2, cz + d[1] * (t0 + t1) / 2];
    return { mid: m, d, half: (t1 - t0) / 2, towers: [[m[0] - d[0] * TOWER_SPAN / 2, m[1] - d[1] * TOWER_SPAN / 2], [m[0] + d[0] * TOWER_SPAN / 2, m[1] + d[1] * TOWER_SPAN / 2]] };
  };
  const bridgeGeo = bridges.map((b) => ({ ...b, ...towersOf(b) })).sort((p, q) => p.mid[1] - q.mid[1]); // [0] = southern

  // ---- 5. Placement fit (§3.2 a–c): shift the anchor along the coast in 50 m steps ----
  const trackUV = poly.filter((_, i) => i % 10 === 0).concat(pitUV.filter((_, i) => i % 10 === 0));
  const T9 = [-1062, 25];
  const check = (a) => {
    const fails = [];
    let towerMin = Infinity;
    for (const b of bridgeGeo) for (const t of b.towers) for (const [u, v] of trackUV) {
      const p = toEN(a, u, v);
      towerMin = Math.min(towerMin, Math.hypot(p[0] - t[0], p[1] - t[1]));
    }
    if (towerMin < 150 + 11) fails.push(`tower ${towerMin.toFixed(0)} m`);
    let worst = -Infinity;
    for (let u = -C.SEAWALL_U; u <= C.SEAWALL_U; u += 50) {
      const v = coastV(a, u);
      if (v !== null) worst = Math.max(worst, v - C.SEAWALL_V);
    }
    if (worst > 20) fails.push(`coast ${worst.toFixed(0)} m inland of the seawall`);
    let t9 = Infinity;
    if (bridgeGeo[0]) {
      const p = toEN(a, T9[0], T9[1]);
      const b = bridgeGeo[0];
      t9 = Math.abs((p[0] - b.mid[0]) * b.d[1] - (p[1] - b.mid[1]) * b.d[0]);
      if (t9 < 250) fails.push(`T9 ${t9.toFixed(0)} m from the bridge axis`);
    }
    return { fails, towerMin, worst, t9 };
  };
  let anchor = [0, 0];
  let fit = null;
  if (segs.length) {
    // Shifts along the measured coast bearing; if no shift satisfies (a)–(c), the seawall bearing is also tried ± 1…4°
    // (the European shore is not straight over 2.3 km).
    let best = null;
    for (const db of [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
      setBeta(beta0 + db);
      for (let i = 0; i <= 160; i++) {
        const k = i % 2 ? (i + 1) / 2 : -i / 2;
        const a0 = [k * SHIFT_STEP * sb0, k * SHIFT_STEP * cb0];
        const cv = coastV(a0, 0);
        if (cv === null) continue;
        const a = toEN(a0, 0, cv + 14);
        const r = check(a);
        if (args.has('--verbose')) log(`  β ${beta} k ${k}: tower ${r.towerMin.toFixed(0)} coast ${r.worst.toFixed(1)} t9 ${r.t9.toFixed(0)} ${r.fails.join('; ')}`);
        if (!best || r.fails.length < best.r.fails.length) best = { a, k, r, beta };
        if (r.fails.length === 0) break;
      }
      if (best.r.fails.length === 0) break;
    }
    setBeta(best.beta);
    anchor = best.a;
    fit = best;
    log(`placement: β ${beta}°, shift ${best.k * SHIFT_STEP} m along the coast; tower clearance ${best.r.towerMin.toFixed(0)} m, coast vs seawall ${best.r.worst.toFixed(1)} m, T9–bridge axis ${best.r.t9.toFixed(0)} m${best.r.fails.length ? `; FAILS: ${best.r.fails.join(', ')}` : ' (all rules hold)'}`);
  }
  const sfEN = toEN(anchor, C.SF_UV[0], C.SF_UV[1]);
  origin = ll(sfEN[0], sfEN[1]);
  const xzOf = (E, N) => [r2(E - sfEN[0]), r2(-(N - sfEN[1]))];
  const uvOfXZ = (x, z) => toUV(anchor, x + sfEN[0], -z + sfEN[1]);
  const isWater = (E, N) => {
    const [u, v] = toUV(anchor, E, N);
    if (Math.abs(u) <= C.SEAWALL_U) {
      if (v >= C.SEAWALL_V && v < 600) return false;
      if (v < C.SEAWALL_V && v > C.SEAWALL_V - 300) return true;
    }
    return segs.length ? coastSide(E, N) < 0 : v < C.SEAWALL_V && v > -850;
  };

  const raw = {
    version: 1,
    source: segs.length ? 'authored+osm' : 'authored',
    attribution: C.ATTRIBUTION.slice(),
    origin: { nodeId: 0, lat: origin.lat, lon: origin.lon },
    projection: { phiDeg: PHI_DEG, mLat: M_LAT, mLon: M_LON },
    local: { beta, anchor: xzOf(anchor[0], anchor[1]), seawallV: C.SEAWALL_V, seawallU: C.SEAWALL_U },
    main: { closed: true, length: 0, xz: [] },
    pit: { length: 0, xz: [] },
    elevation: { ref: DEM_OFFSET, step: CENTRE_STEP, s: [], y: [] },
    pitElevation: null,
    terrain: null,
    features: [],
  };
  const mapUV = (p) => { const e = toEN(anchor, p[0], p[1]); return xzOf(e[0], e[1]); };
  raw.main.xz = simplifyDense(poly, true, 0.03, 20).map(mapUV);
  raw.pit.xz = simplifyDense(pitUV, false, 0.03, 20).map(mapUV);
  raw.main.length = r2(polyLength(raw.main.xz, true));
  raw.pit.length = r2(polyLength(raw.pit.xz, false));
  log(`main ${raw.main.xz.length} pts ${raw.main.length} m; pit ${raw.pit.xz.length} pts ${raw.pit.length} m`);
  const elevOf = (pts, closed, L) => {
    const r = resample(pts, closed, CENTRE_STEP).filter((p) => !closed || p.s < L - 1);
    return { s: r.map((p) => r2(p.s)), y: r.map((p) => r2(C.elevationAtV(uvOfXZ(p.x, p.z)[1]))) };
  };
  Object.assign(raw.elevation, elevOf(raw.main.xz, true, raw.main.length));
  raw.pitElevation = { step: CENTRE_STEP, ...elevOf(raw.pit.xz, false, raw.pit.length) };

  // ---- 6. Terrain: EU-DEM − 2 m on land, −8 m under water, the street plateau y(v) near the track ----
  const SIZE = 6000, STEP = 100;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of raw.main.xz) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  const n = SIZE / STEP + 1;
  const x0 = Math.round(((minX + maxX) / 2 - SIZE / 2) / STEP) * STEP;
  const z0 = Math.round(((minZ + maxZ) / 2 - SIZE / 2) / STEP) * STEP;
  const gridEN = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) gridEN.push([x0 + i * STEP + sfEN[0], -(z0 + j * STEP) + sfEN[1]]);
  const trackDist = (u, v) => {
    let d2 = Infinity;
    for (const p of trackUV) d2 = Math.min(d2, (p[0] - u) ** 2 + (p[1] - v) ** 2);
    return Math.sqrt(d2);
  };
  const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  let demY = null;
  if (!args.has('--fallback') && !args.has('--no-terrain')) {
    try {
      demY = fillNaN(await dem(gridEN.map(([E, N]) => ll(E, N)), "terrain"));
    } catch (err) {
      log(`terrain: DEM failed (${err.message}); plateau + flat land`);
    }
  }
  raw.terrain = {
    x0, z0, step: STEP, nx: n, nz: n,
    y: gridEN.map(([E, N], k) => {
      if (isWater(E, N)) return -8;
      const [u, v] = toUV(anchor, E, N);
      const land = demY ? Math.max(demY[k] - DEM_OFFSET, -1) : 3;
      const plateau = C.elevationAtV(Math.max(C.SEAWALL_V, v)) + 0.15;
      return r1(plateau + (land - plateau) * smooth(250, 400, trackDist(u, v)));
    }),
  };

  // ---- 7. Features: coast, bridges, buildings (largest first until the raw budget) ----
  const feats = [];
  for (const w of coastWays) feats.push({ kind: 'coast', id: w.id, xz: simplify(w.pts.map((p) => xzOf(p[0], p[1])), 5).map(([x, z]) => [Math.round(x), Math.round(z)]) });
  for (const b of bridgeGeo) feats.push({ kind: 'bridge', id: b.id, xz: b.towers.map((t) => xzOf(t[0], t[1]).map(r1)), height: b.height });
  const cand = [];
  for (const b of buildings) {
    const area = Math.abs(shoelace(b.pts));
    if (area < 250) continue;
    let cE = 0, cN = 0;
    for (const p of b.pts) { cE += p[0] / b.pts.length; cN += p[1] / b.pts.length; }
    const [u, v] = toUV(anchor, cE, cN);
    if (isWater(cE, cN) || trackDist(u, v) < 45) continue;
    if (Math.abs(u) <= C.SEAWALL_U + 60 && v < C.SEAWALL_V + 4) continue;
    if (Math.hypot(cE - sfEN[0], cN - sfEN[1]) > 3200) continue;
    const f = { kind: 'building', id: b.id, xz: simplify(b.pts.map((p) => xzOf(p[0], p[1])), 2).map(([x, z]) => [Math.round(x), Math.round(z)]) };
    const lv = Number(b.tags['building:levels']);
    if (Number.isFinite(lv) && lv > 0) f.levels = lv;
    cand.push({ f, area });
  }
  cand.sort((p, q) => q.area - p.area || p.f.id - q.f.id);
  raw.features = feats;
  let size = JSON.stringify(raw).length;
  let kept = 0;
  for (const c of cand) {
    const add = JSON.stringify(c.f).length + 1;
    if (size + add > RAW_BUDGET) break;
    feats.push(c.f);
    size += add;
    kept++;
  }
  feats.sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.id - b.id));
  log(`features: ${coastWays.length} coast, ${bridgeGeo.length} bridges, ${kept}/${cand.length} buildings; ~${(size / 1024).toFixed(1)} KB`);
  if (fit) raw.placement = { shift: fit.k * SHIFT_STEP, towerClearance: Math.round(fit.r.towerMin), coastVsSeawall: r1(fit.r.worst), t9BridgeAxis: Math.round(fit.r.t9), fails: fit.r.fails };

  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(raw)}\n`);
  log(`wrote ${path.relative(root, OUT)} (${raw.source})`);
}

main().catch((err) => {
  console.error('[fetch-track] fatal:', err);
  process.exit(1);
});
