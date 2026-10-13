// Generación del mapa político del planeta.
//
// No hay fronteras dibujadas a mano: el repositorio solo trae costas, lagos y
// ciudades reales con el país al que pertenecen. Con eso basta. Cada ciudad
// importante siembra una provincia y la provincia crece por tierra firme hasta
// tocar a sus vecinas (una distancia de Voronoi medida a pie, no en línea
// recta, así que un estrecho pesa más que una llanura). Las fronteras entre
// países salen solas: son las costuras entre provincias sembradas por ciudades
// de países distintos.
//
// Todo es código puro sin lienzo, de modo que la prueba en Node genera
// exactamente el mismo mundo que el navegador.

import { decodeRings, LAND_FINE, LAKES, SCALE_FINE, CITIES, COUNTRIES } from '../../src/geodata.js';
import { fillRings } from '../../src/raster.js';
import { ES_NAMES } from './exonyms.js';

// ── rejilla ───────────────────────────────────────────────────────────────
export const RES = 0.1;                 // grados por celda
export const LAT_N = 84, LAT_S = -58;   // la Antártida queda fuera del juego
export const GW = Math.round(360 / RES);
export const GH = Math.round((LAT_N - LAT_S) / RES);

export const cellLon = (x) => -180 + (x + 0.5) * RES;
export const cellLat = (y) => LAT_N - (y + 0.5) * RES;
export const lonToX = (lon) => Math.floor((lon + 180) / RES);
export const latToY = (lat) => Math.floor((LAT_N - lat) / RES);

const D2R = Math.PI / 180;

/** Distancia aproximada en km entre dos puntos (equirectangular local). */
export function km(lon1, lat1, lon2, lat2) {
  let dl = lon1 - lon2;
  if (dl > 180) dl -= 360; else if (dl < -180) dl += 360;
  const x = dl * Math.cos((lat1 + lat2) * 0.5 * D2R), y = lat1 - lat2;
  return Math.hypot(x, y) * 111.32;
}

// ── densidad urbana ───────────────────────────────────────────────────────
/** Índice espacial de ciudades por celdas de 1°. */
function cityBuckets() {
  const m = new Map();
  CITIES.forEach((c, i) => {
    const k = `${Math.floor(c.x)},${Math.floor(c.y)}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(i);
  });
  return m;
}
function citiesNear(buckets, lon, lat, rkm) {
  const out = [];
  const rl = Math.ceil(rkm / 111.32) + 1;
  const rx = Math.min(180, Math.ceil(rkm / 111.32 / Math.max(0.15, Math.cos(lat * D2R))) + 1);
  for (let dy = -rl; dy <= rl; dy++) {
    for (let dx = -rx; dx <= rx; dx++) {
      let gx = Math.floor(lon) + dx;
      if (gx >= 180) gx -= 360; else if (gx < -180) gx += 360;
      const l = buckets.get(`${gx},${Math.floor(lat) + dy}`);
      if (!l) continue;
      for (const i of l) if (km(CITIES[i].x, CITIES[i].y, lon, lat) <= rkm) out.push(i);
    }
  }
  return out;
}

// ── semillas ──────────────────────────────────────────────────────────────
/**
 * Escoge las ciudades que serán capitales de provincia. Se recorren de mayor a
 * menor población y se descarta cualquiera que caiga demasiado cerca de una ya
 * elegida. La distancia mínima se encoge donde hay muchas ciudades (Europa,
 * la India, la costa este de China) y se estira en los vacíos, como ocurre en
 * los mapas de provincias de verdad. Las capitales de Estado entran primero
 * para que ningún país, por pequeño que sea, se quede sin provincia.
 */
function pickSeeds(spacingKm, buckets) {
  const order = CITIES.map((c, i) => i)
    .sort((a, b) => (CITIES[b].cap - CITIES[a].cap) || (CITIES[b].p - CITIES[a].p));
  const chosen = new Map();               // celda de 1° → semillas
  const key = (lon, lat) => `${Math.floor(lon)},${Math.floor(lat)}`;
  const seeds = [];
  const perCountry = new Map();
  for (const i of order) {
    const c = CITIES[i];
    if (c.y < LAT_S + 0.3 || c.y > LAT_N - 0.3) continue;
    const dens = citiesNear(buckets, c.x, c.y, 300).length;
    let sp = spacingKm * Math.min(1.35, Math.max(0.42, Math.pow(10 / (dens + 1), 0.42)));
    // Los países con pocas ciudades se siembran más densos: si no, un país
    // mediano quedaría reducido a una sola provincia gigante sin juego posible.
    const have = perCountry.get(c.c) || 0;
    if (have < 4) sp *= 0.6;
    let clash = false;
    const rl = Math.ceil(sp / 111.32) + 1;
    const r = Math.min(180, Math.ceil(sp / 111.32 / Math.max(0.15, Math.cos(c.y * D2R))) + 1);
    for (let dy = -rl; dy <= rl && !clash; dy++) {
      for (let dx = -r; dx <= r && !clash; dx++) {
        const list = chosen.get(key(c.x + dx, c.y + dy));
        if (!list) continue;
        for (const s of list) {
          // dos países distintos no se estorban tanto: la frontera ya separa
          const need = s.cc !== c.c ? sp * 0.55 : sp;
          if (km(s.lon, s.lat, c.x, c.y) < need) { clash = true; break; }
        }
      }
    }
    if (clash && !c.cap) continue;
    if (clash && c.cap && seeds.some(s => s.cap && s.cc === c.c)) continue;
    const s = { name: c.n, lon: c.x, lat: c.y, pop: c.p, cc: c.c, cap: c.cap, city: i };
    seeds.push(s);
    perCountry.set(c.c, have + 1);
    const k = key(c.x, c.y);
    if (!chosen.has(k)) chosen.set(k, []);
    chosen.get(k).push(s);
  }
  return seeds;
}

// ── cola de Dial (costes enteros pequeños) ─────────────────────────────────
class Dial {
  constructor(maxCost) {
    this.n = maxCost + 1;
    this.b = Array.from({ length: this.n }, () => []);
    this.cur = 0; this.size = 0;
  }
  push(d, v) { this.b[d % this.n].push(v, d); this.size++; }
  /** Devuelve la celda; la distancia queda en this.d. */
  pop() {
    if (!this.size) return -1;
    for (;;) {
      const q = this.b[this.cur % this.n];
      if (q.length) {
        this.d = q.pop();
        this.size--;
        return q.pop();
      }
      this.cur++;
    }
  }
}

const COST_V = 10, WATER = 7;
/**
 * Crecimiento simultáneo de todas las semillas. Moverse por tierra cuesta su
 * distancia; cruzar agua cuesta mucho más, para que una provincia solo salte
 * un brazo de mar cuando al otro lado no hay nadie más cerca.
 *
 * Con `cc`/`seedCC`, una semilla solo entra en la tierra de su propio país: es
 * lo que mantiene cada provincia dentro de sus fronteras nacionales.
 */
function grow(land, seedCells, cc = null, seedCC = null) {
  const N = GW * GH;
  const lab = new Int32Array(N).fill(-1);
  const dist = new Float32Array(N).fill(Infinity);
  const hcost = new Uint8Array(GH);
  for (let y = 0; y < GH; y++) hcost[y] = Math.max(1, Math.round(COST_V * Math.cos(cellLat(y) * D2R)));
  const q = new Dial(COST_V * WATER + 1);
  for (let i = 0; i < seedCells.length; i++) {
    const c = seedCells[i];
    if (c < 0 || dist[c] === 0) continue;
    dist[c] = 0; lab[c] = i; q.push(0, c);
  }
  let c;
  while ((c = q.pop()) >= 0) {
    const d = q.d;
    if (d > dist[c]) continue;
    const x = c % GW, y = (c - x) / GW, l = lab[c];
    const lc = land[c], mine = seedCC ? seedCC[l] : 0;
    const relax = (n, base) => {
      const ln = land[n];
      if (ln && cc && cc[n] !== mine) return;
      const nd = d + base * (lc && ln ? 1 : WATER);
      if (nd < dist[n]) { dist[n] = nd; lab[n] = l; q.push(nd, n); }
    };
    relax(y * GW + (x + 1) % GW, hcost[y]);
    relax(y * GW + (x - 1 + GW) % GW, hcost[y]);
    if (y > 0) relax(c - GW, COST_V);
    if (y < GH - 1) relax(c + GW, COST_V);
  }
  return { lab, dist };
}

/** Celda de tierra más cercana a un punto (radio en celdas), opcionalmente de un país. */
function snapToLand(land, lon, lat, rad, cc = null, want = -1) {
  const x0 = lonToX(lon), y0 = latToY(lat);
  let best = -1, bd = Infinity;
  for (let dy = -rad; dy <= rad; dy++) {
    const y = y0 + dy;
    if (y < 0 || y >= GH) continue;
    for (let dx = -rad; dx <= rad; dx++) {
      const x = (x0 + dx + GW) % GW, c = y * GW + x;
      if (!land[c] || (cc && cc[c] !== want)) continue;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = c; }
    }
  }
  return best;
}

// ── nombres de las provincias sin ciudad ──────────────────────────────────
const DIRS = ['Norte', 'Noreste', 'Este', 'Sureste', 'Sur', 'Suroeste', 'Oeste', 'Noroeste'];
function bearingName(fromLon, fromLat, toLon, toLat) {
  let dl = toLon - fromLon;
  if (dl > 180) dl -= 360; else if (dl < -180) dl += 360;
  const a = Math.atan2(dl * Math.cos(fromLat * D2R), toLat - fromLat) / D2R; // 0 = norte
  return DIRS[((Math.round(a / 45) % 8) + 8) % 8];
}

/**
 * Territorios que las ciudades no pueden reclamar bien por sí solas porque no
 * tienen ninguna ciudad grande dentro: se asignan a mano por rectángulo.
 */
const GEO_FIXES = [
  // Groenlandia: el estrecho de Nares y la bahía de Baffin no son rectos
  { country: 'Denmark', w: -74, e: -10, s: 59, n: 84, only: ['Canada', 'Iceland'],
    test: (lon, lat) => lon > -57.5 - Math.max(0, lat - 71) * 3.2 },
  { country: 'Norway', w: 8, e: 35, s: 74, n: 81.5 },
  // la Raya: Galicia y la Extremadura española no son portuguesas
  { country: 'Spain', w: -9.5, e: -6.0, s: 42.1, n: 44, only: ['Portugal'] },
  { country: 'Spain', w: -6.9, e: -5.5, s: 38.2, n: 42.1, only: ['Portugal'], test: (lon, lat) => lon > -6.9 + Math.max(0, lat - 41.5) * 0.9 },
  { country: 'Portugal', w: -9.6, e: -7.0, s: 37, n: 42.0, only: ['Spain'], test: (lon, lat) => lon < -7.4 + (lat < 38.2 ? 0 : 0.2) },
  // Alaska termina en el meridiano 141 y el paralelo 49 separa las praderas
  { country: 'Canada', w: -141, e: -100, s: 60, n: 72, only: ['United States of America'] },
  { country: 'United States of America', w: -170, e: -141, s: 54, n: 72, only: ['Canada'] },
  { country: 'Canada', w: -123, e: -95.2, s: 49, n: 60, only: ['United States of America'] },
  { country: 'United States of America', w: -123, e: -95.2, s: 41, n: 48.99, only: ['Canada'] },                                // Svalbard
  { country: 'Russia', w: 19, e: 23, s: 54.3, n: 55.3, only: ['Lithuania', 'Poland'] }, // Kaliningrado
];

/** Nombres para los grandes vacíos sin ninguna ciudad cerca. */
const REGION_NAMES = [
  { name: 'Groenlandia', w: -74, e: -10, s: 59, n: 84 },
  { name: 'Svalbard', w: 8, e: 35, s: 74, n: 81.5 },
  { name: 'Ártico canadiense', w: -125, e: -60, s: 68, n: 84 },
  { name: 'Ártico ruso', w: 40, e: 180, s: 72, n: 84 },
  { name: 'Sáhara', w: -15, e: 30, s: 16, n: 30 },
  { name: 'Rub al-Jali', w: 44, e: 56, s: 16, n: 23 },
  { name: 'Gobi', w: 95, e: 115, s: 39, n: 46 },
  { name: 'Amazonia', w: -75, e: -50, s: -12, n: 3 },
  { name: 'Outback', w: 120, e: 145, s: -32, n: -18 },
  { name: 'Patagonia', w: -75, e: -63, s: -56, n: -39 },
];

// ── construcción del mundo ────────────────────────────────────────────────
/**
 * Devuelve el mundo estático:
 *   prov      Int16Array(GW*GH) — provincia de cada celda (-1 = agua)
 *   provinces [{id,name,lon,lat,area,pop,cc,cap,nb:Set}]
 *   borders   [{a,b,pts:Float32Array lon/lat}] — costuras entre provincias
 */
export function buildWorld(opts = {}) {
  const t0 = Date.now();
  const spacing = opts.spacing || 230;
  const N = GW * GH;
  const bbox = { w: -180, e: 180, n: LAT_N, s: LAT_S };
  const buckets = cityBuckets();

  // 1. tierra firme, sin lagos
  const land = new Uint8Array(N);
  fillRings(decodeRings(LAND_FINE, SCALE_FINE), bbox, GW, GH, land, 1);
  const lakes = decodeRings(LAKES, SCALE_FINE);
  fillRings(lakes, bbox, GW, GH, land, 0);

  // 2. reparto entre países: crece desde todas las ciudades del mapa
  const allCells = CITIES.map(c => snapToLand(land, c.x, c.y, 4));
  const byCity = grow(land, allCells);
  const cc = new Int16Array(N).fill(-1);
  for (let c = 0; c < N; c++) if (land[c] && byCity.lab[c] >= 0) cc[c] = CITIES[byCity.lab[c]].c;
  for (const f of GEO_FIXES) {
    const want = COUNTRIES.indexOf(f.country);
    const only = f.only ? new Set(f.only.map(n => COUNTRIES.indexOf(n))) : null;
    if (want < 0) continue;
    for (let y = latToY(f.n); y <= latToY(f.s); y++) {
      if (y < 0 || y >= GH) continue;
      for (let x = lonToX(f.w); x <= lonToX(f.e); x++) {
        const c = y * GW + x;
        if (land[c] && (!only || only.has(cc[c])) && (!f.test || f.test(cellLon(x), cellLat(y)))) cc[c] = want;
      }
    }
  }

  // 3. semillas de provincia, cada una dentro de su país
  const seeds = pickSeeds(spacing, buckets);
  const seedCells = [], seedCC = [], kept = [];
  const used = new Set();
  const addSeed = (cell, s) => {
    if (cell < 0 || used.has(cell)) return false;
    used.add(cell); seedCells.push(cell); seedCC.push(s.cc); kept.push(s);
    return true;
  };
  for (const s of seeds) addSeed(snapToLand(land, s.lon, s.lat, 5, cc, s.cc), s);

  // 4. relleno en los vacíos (Sáhara, Siberia, Amazonia, Groenlandia…)
  let first = grow(land, seedCells, cc, seedCC);
  const FILL_KM = Math.max(spacing * 1.7, 420);
  const stepY = Math.round((FILL_KM / 111.32) / RES * 0.7);
  for (let y = Math.floor(stepY / 2); y < GH; y += stepY) {
    const lat = cellLat(y);
    const k = 1 / Math.max(0.15, Math.cos(lat * D2R));
    const stepX = Math.round(stepY * k);
    for (let x = Math.floor(stepX / 2); x < GW; x += stepX) {
      const c = y * GW + x;
      if (!land[c] || cc[c] < 0) continue;
      const dkm = first.dist[c] / COST_V * RES * 111.32;
      // en latitudes altas la retícula es más laxa: tundra y hielo no necesitan detalle
      if (dkm < FILL_KM * (lat > 66 ? 2.6 : lat > 58 ? 1.6 : 1)) continue;
      const near = first.lab[c] >= 0 ? kept[first.lab[c]] : null;
      addSeed(c, { name: null, lon: cellLon(x), lat, pop: 0, cc: cc[c], cap: 0, city: -1, parent: near });
    }
  }
  const { lab } = grow(land, seedCells, cc, seedCC);

  // Tierras de un país que ninguna semilla suya alcanza: islas cuyo mar ya
  // reclamó una provincia extranjera más cercana. Se unen a la provincia
  // propia más próxima o, si están lejos de todo, forman una provincia nueva.
  const comp = new Int32Array(N).fill(-1);
  for (let c0 = 0; c0 < N; c0++) {
    if (!land[c0] || lab[c0] >= 0 || cc[c0] < 0 || comp[c0] >= 0) continue;
    const cells = [c0], want = cc[c0];
    comp[c0] = 1;
    let mx = 0, my = 0;
    for (let i = 0; i < cells.length; i++) {
      const v = cells[i], x = v % GW, y = (v - x) / GW;
      mx += cellLon(x); my += cellLat(y);
      for (const n of [y * GW + (x + 1) % GW, y * GW + (x - 1 + GW) % GW, y > 0 ? v - GW : -1, y < GH - 1 ? v + GW : -1]) {
        if (n >= 0 && land[n] && lab[n] < 0 && comp[n] < 0 && cc[n] === want) { comp[n] = 1; cells.push(n); }
      }
    }
    const lon = cellLon(cells[0] % GW), lat = my / cells.length;
    let best = -1, bd = 700;
    for (let i = 0; i < kept.length; i++) {
      if (seedCC[i] !== want) continue;
      const d = km(kept[i].lon, kept[i].lat, lon, lat);
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) {
      if (cells.length < 4) continue;   // un islote suelto no merece provincia
      best = kept.length;
      kept.push({ name: null, lon, lat, pop: 0, cc: want, cap: 0, city: -1, parent: null });
      seedCells.push(cells[0]); seedCC.push(want);
    }
    for (const v of cells) lab[v] = best;
  }

  // 5. provincias: solo las que conservan tierra
  const area = new Float64Array(kept.length);
  const sx = new Float64Array(kept.length), sy = new Float64Array(kept.length);
  for (let y = 0; y < GH; y++) {
    const w = Math.cos(cellLat(y) * D2R);
    for (let x = 0; x < GW; x++) {
      const c = y * GW + x;
      const l = lab[c];
      if (!land[c] || l < 0) continue;
      area[l] += w;
      // centro de masa: la longitud se acumula como desplazamiento respecto de la semilla
      let dl = cellLon(x) - kept[l].lon;
      if (dl > 180) dl -= 360; else if (dl < -180) dl += 360;
      sx[l] += dl * w; sy[l] += cellLat(y) * w;
    }
  }
  const remap = new Int32Array(kept.length).fill(-1);
  const provinces = [];
  for (let i = 0; i < kept.length; i++) {
    if (area[i] < 0.5) continue;        // menos de media celda: se pierde en el mar
    const s = kept[i];
    remap[i] = provinces.length;
    let clon = s.lon + sx[i] / area[i];
    if (clon > 180) clon -= 360; else if (clon < -180) clon += 360;
    provinces.push({
      id: provinces.length,
      name: s.name,
      lon: s.lon, lat: s.lat,                 // capital de la provincia
      clon, clat: sy[i] / area[i],            // centro de masa
      area: Math.round(area[i] * (RES * 111.32) ** 2), // km²
      pop: s.pop, cc: s.cc, cap: s.cap, city: s.city,
      parent: s.parent || null,
      nb: new Set(),
    });
  }
  // Nombres de las provincias de relleno: la población real más cercana que
  // no sea ya cabeza de otra provincia; si no hay ninguna a mano (tundra,
  // desierto), «Norte de Yakutsk».
  const taken = new Set(provinces.filter(p => p.name).map(p => p.name));
  for (const p of provinces) {
    if (p.name) continue;
    let best = -1, bd = Infinity;
    for (const i of citiesNear(buckets, p.clon, p.clat, 380)) {
      const c = CITIES[i];
      if (taken.has(c.n) || c.c !== p.cc) continue;
      const d = km(c.x, c.y, p.clon, p.clat);
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0) {
      const c = CITIES[best];
      p.name = c.n; taken.add(c.n);
      p.lon = c.x; p.lat = c.y; p.pop = c.p; p.city = best;
      continue;
    }
    const par = p.parent;
    const reg = REGION_NAMES.find(r => p.clon >= r.w && p.clon <= r.e && p.clat >= r.s && p.clat <= r.n);
    if (reg) p.name = `${reg.name} ${bearingName((reg.w + reg.e) / 2, (reg.s + reg.n) / 2, p.clon, p.clat)}`;
    else if (par && par.name) p.name = `${bearingName(par.lon, par.lat, p.clon, p.clat)} de ${par.name}`;
    else p.name = `Territorio de ${COUNTRIES[p.cc] || 'nadie'}`;
    p.lon = p.clon; p.lat = p.clat;
    p.pop = Math.round(p.area * 0.4);
  }
  // nombres en español para las ciudades más conocidas («Warsaw» → «Varsovia»)
  for (const p of provinces) if (ES_NAMES[p.name]) { p.intl = p.name; p.name = ES_NAMES[p.name]; }
  // nombres repetidos (hay muchas «San José»): se distinguen con un ordinal
  const seen = new Map();
  for (const p of provinces) {
    const n = seen.get(p.name) || 0;
    seen.set(p.name, n + 1);
    if (n) p.name = `${p.name} ${['', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] || n + 1}`;
  }
  for (const p of provinces) delete p.parent;

  const prov = new Int16Array(N).fill(-1);
  for (let c = 0; c < N; c++) if (land[c] && lab[c] >= 0) prov[c] = remap[lab[c]];

  // 6. vecindad terrestre y costuras
  const segs = new Map();                 // a*65536+b → segmentos entre esquinas
  const addSeg = (a, b, x0, y0, x1, y1) => {
    if (a > b) { const t = a; a = b; b = t; }
    const k = a * 65536 + b;
    let s = segs.get(k);
    if (!s) { s = []; segs.set(k, s); }
    s.push(x0, y0, x1, y1);
  };
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const c = y * GW + x, a = prov[c];
      if (a < 0) continue;
      const xr = (x + 1) % GW, r = prov[y * GW + xr];
      if (r >= 0 && r !== a) {
        provinces[a].nb.add(r); provinces[r].nb.add(a);
        addSeg(a, r, x + 1, y, x + 1, y + 1);
      }
      if (y + 1 < GH) {
        const d = prov[c + GW];
        if (d >= 0 && d !== a) {
          provinces[a].nb.add(d); provinces[d].nb.add(a);
          addSeg(a, d, x, y + 1, x + 1, y + 1);
        }
      }
    }
  }

  // 7. vecindad marítima: provincias separadas por poca agua (islas, estrechos)
  const sea = seaNeighbours(prov, provinces);

  const borders = [];
  for (const [k, s] of segs) {
    const a = Math.floor(k / 65536), b = k % 65536;
    for (const line of chain(s)) borders.push({ a, b, pts: smooth(line) });
  }

  return {
    GW, GH, RES, LAT_N, LAT_S,
    prov, provinces, borders, sea,
    lakes, neNames: COUNTRIES,
    ms: Date.now() - t0,
  };
}

/**
 * Vecinos por mar a menos de ~3° de agua. Se usan para desembarcos y para que
 * las islas no queden fuera del juego diplomático y militar.
 */
function seaNeighbours(prov, provinces) {
  const N = GW * GH, MAXD = 18;
  const lab = new Int32Array(N).fill(-1), dd = new Uint8Array(N);
  let cur = [];
  for (let c = 0; c < N; c++) {
    if (prov[c] < 0) continue;
    const x = c % GW, y = (c - x) / GW;
    // celdas de costa
    const nbs = [y * GW + (x + 1) % GW, y * GW + (x - 1 + GW) % GW, y > 0 ? c - GW : -1, y < GH - 1 ? c + GW : -1];
    if (nbs.some(n => n >= 0 && prov[n] < 0)) { lab[c] = prov[c]; cur.push(c); }
  }
  const pairs = new Set();
  for (let step = 1; step <= MAXD && cur.length; step++) {
    const nxt = [];
    for (const c of cur) {
      const x = c % GW, y = (c - x) / GW, l = lab[c];
      const nbs = [y * GW + (x + 1) % GW, y * GW + (x - 1 + GW) % GW, y > 0 ? c - GW : -1, y < GH - 1 ? c + GW : -1];
      for (const n of nbs) {
        if (n < 0 || prov[n] >= 0) continue;
        if (lab[n] < 0) { lab[n] = l; dd[n] = step; nxt.push(n); }
        else if (lab[n] !== l) {
          const a = Math.min(l, lab[n]), b = Math.max(l, lab[n]);
          if (!provinces[a].nb.has(b)) pairs.add(a * 65536 + b);
        }
      }
    }
    cur = nxt;
  }
  const sea = provinces.map(() => []);
  for (const k of pairs) {
    const a = Math.floor(k / 65536), b = k % 65536;
    sea[a].push(b); sea[b].push(a);
  }
  return sea;
}

/** Une segmentos unitarios en polilíneas siguiendo las esquinas compartidas. */
function chain(s) {
  const n = s.length / 4;
  const ptKey = (x, y) => y * (GW + 1) + x;
  const at = new Map();
  for (let i = 0; i < n; i++) {
    for (const k of [ptKey(s[i * 4], s[i * 4 + 1]), ptKey(s[i * 4 + 2], s[i * 4 + 3])]) {
      let l = at.get(k);
      if (!l) { l = []; at.set(k, l); }
      l.push(i);
    }
  }
  const used = new Uint8Array(n);
  const lines = [];
  const walk = (i, fromEnd) => {
    // devuelve la lista de puntos siguiendo desde el extremo fromEnd del segmento i
    const out = [];
    let cx = fromEnd ? s[i * 4 + 2] : s[i * 4], cy = fromEnd ? s[i * 4 + 3] : s[i * 4 + 1];
    for (;;) {
      const l = at.get(ptKey(cx, cy));
      let nx = -1;
      if (l && l.length === 2) for (const j of l) if (!used[j]) nx = j;
      if (nx < 0) break;
      used[nx] = 1;
      const ax = s[nx * 4], ay = s[nx * 4 + 1];
      if (ax === cx && ay === cy) { cx = s[nx * 4 + 2]; cy = s[nx * 4 + 3]; }
      else { cx = ax; cy = ay; }
      out.push(cx, cy);
    }
    return out;
  };
  for (let i = 0; i < n; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const fwd = walk(i, true), back = walk(i, false);
    const pts = [];
    for (let k = back.length - 2; k >= 0; k -= 2) pts.push(back[k], back[k + 1]);
    pts.push(s[i * 4], s[i * 4 + 1], s[i * 4 + 2], s[i * 4 + 3]);
    for (let k = 0; k < fwd.length; k += 2) pts.push(fwd[k], fwd[k + 1]);
    lines.push(pts);
  }
  return lines;
}

/**
 * Suaviza la escalera del ráster (Chaikin, dos pasadas) conservando los
 * extremos, y pasa de esquinas de rejilla a grados. Un tramo que cruza el
 * antimeridiano se queda en coordenadas continuas: quien dibuja lo resuelve.
 */
function smooth(p) {
  // la rejilla da vueltas: si un tramo salta de x=GW a x=0, se desenrolla
  for (let i = 2; i < p.length; i += 2) {
    const d = p[i] - p[i - 2];
    if (d > GW / 2) p[i] -= GW; else if (d < -GW / 2) p[i] += GW;
  }
  let a = p;
  for (let pass = 0; pass < 2 && a.length >= 6; pass++) {
    const o = [a[0], a[1]];
    for (let i = 0; i + 3 < a.length; i += 2) {
      const x0 = a[i], y0 = a[i + 1], x1 = a[i + 2], y1 = a[i + 3];
      o.push(0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1, 0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1);
    }
    o.push(a[a.length - 2], a[a.length - 1]);
    a = o;
  }
  // fuera los puntos casi alineados (ahorra mucho trazo)
  const keep = [a[0], a[1]];
  for (let i = 2; i + 2 < a.length; i += 2) {
    const px = keep[keep.length - 2], py = keep[keep.length - 1];
    const cross = (a[i] - px) * (a[i + 3] - py) - (a[i + 1] - py) * (a[i + 2] - px);
    if (Math.abs(cross) > 0.08) keep.push(a[i], a[i + 1]);
  }
  keep.push(a[a.length - 2], a[a.length - 1]);
  const out = new Float32Array(keep.length);
  for (let i = 0; i < keep.length; i += 2) {
    out[i] = -180 + keep[i] * RES;
    out[i + 1] = LAT_N - keep[i + 1] * RES;
  }
  return out;
}

export { COUNTRIES as NE_COUNTRIES, CITIES };
