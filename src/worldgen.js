// Generacion del teatro de operaciones sobre geografia real.
//
// Ya no se inventa un continente: se recorta un rectangulo de la Tierra y se
// deduce de el todo lo que el motor necesita. La costa, los lagos, los cauces,
// las cordilleras y las ciudades con su nombre salen de Natural Earth; lo unico
// procedimental es el detalle por debajo de la resolucion del dato — el relieve
// fino dentro de una cordillera real, la vegetacion segun clima, y la red de
// carreteras que une los nucleos reales por el camino de menor coste.
import { neighbors, neighbor, distance, OPPOSITE } from './hex.js';
import { noiseField } from './rng.js';
import { MinHeap } from './heap.js';
import { KM_PER_DEG } from './geo.js';
import { sampleRegion, citiesIn, peaksIn, world } from './world.js';

// Indices de clase de region fisica tal como los emite tools/extract-geo.py
const C = { RANGE: 1, PLATEAU: 2, FOOTHILLS: 3, PLAIN: 4, LOWLAND: 5, DESERT: 6,
  BASIN: 7, DEPRESSION: 8, VALLEY: 9, DELTA: 10, WETLANDS: 11, TUNDRA: 12 };

/**
 * Humedad media por latitud: convergencia ecuatorial, cinturon desertico hacia
 * los 25 grados, franja templada humeda y desecacion polar. Es una curva
 * gruesa — no sabe de monzones ni de sombras de lluvia —, asi que la corrigen
 * despues la presencia de cauces reales y la cercania del mar.
 */
function climate(absLat) {
  if (absLat < 10) return 1.00;
  if (absLat < 20) return 1.00 - (absLat - 10) * 0.045;
  if (absLat < 28) return 0.55 - (absLat - 20) * 0.031;
  if (absLat < 45) return 0.30 + (absLat - 28) * 0.026;
  if (absLat < 62) return 0.74 - (absLat - 45) * 0.007;
  if (absLat < 72) return 0.62 - (absLat - 62) * 0.022;
  return 0.35;
}

export function generateTheater(theater, rng) {
  const { W, H } = theater;
  const N = W * H;
  const bbox = theater.bbox(0.35);
  const kmW = (bbox.e - bbox.w) * KM_PER_DEG * theater.cosLat;
  const RW = Math.max(64, Math.min(420, Math.round(kmW / 1.6)));
  const RH = Math.max(48, Math.round(RW * (bbox.n - bbox.s) / (bbox.e - bbox.w)));
  const S = sampleRegion(bbox, RW, RH);

  const relN = noiseField(W, H, rng, 5, 4);      // detalle de relieve
  const forN = noiseField(W, H, rng, 4, 7);      // vegetacion
  const wetN = noiseField(W, H, rng, 3, 6);      // humedad local

  const px = (lon) => (lon - bbox.w) / (bbox.e - bbox.w) * RW;
  const py = (lat) => (bbox.n - lat) / (bbox.n - bbox.s) * RH;

  // ── 1. muestreo del planeta hexagono a hexagono ─────────────────────────
  const hexes = new Array(N);
  const landFrac = new Float32Array(N);
  const cls = new Uint8Array(N);
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const i = row * W + col;
      const [lon, lat] = theater.hexLonLat(col, row);
      const cxp = Math.round(px(lon)), cyp = Math.round(py(lat));
      let land = 0, tot = 0;
      const votes = {};
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = cxp + dx, y = cyp + dy;
          if (x < 0 || y < 0 || x >= RW || y >= RH) continue;
          const k = y * RW + x;
          land += S.land[k]; tot++;
          const c = S.cls[k];
          if (c) votes[c] = (votes[c] || 0) + 1;
        }
      }
      landFrac[i] = tot ? land / tot : 0;
      let best = 0, bestN = 0;
      for (const k in votes) if (votes[k] > bestN) { bestN = votes[k]; best = +k; }
      cls[i] = best;
      hexes[i] = {
        i, col, row, lon, lat,
        t: 'llanura', elev: 0,
        river: [false, false, false, false, false, false],
        bridge: [false, false, false, false, false, false],
        road: 0, rail: false, city: null, vp: 0, name: null, blown: false,
      };
    }
  }
  const at = (c, r) => (c < 0 || r < 0 || c >= W || r >= H) ? null : hexes[r * W + c];

  // ── 2. relieve: cota base por region fisica real + cumbres + detalle ────
  const base = { [C.RANGE]: 0.80, [C.PLATEAU]: 0.48, [C.FOOTHILLS]: 0.42,
    [C.PLAIN]: 0.12, [C.LOWLAND]: 0.08, [C.DESERT]: 0.20, [C.BASIN]: 0.15,
    [C.DEPRESSION]: 0.04, [C.VALLEY]: 0.18, [C.DELTA]: 0.03,
    [C.WETLANDS]: 0.04, [C.TUNDRA]: 0.16 };
  const elev = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    elev[i] = (base[cls[i]] ?? 0.20) + (relN[i] - 0.5) * 0.30;
  }
  // Las cumbres con cota conocida levantan su entorno. Se admiten las que caen
  // algo fuera del teatro —una cordillera no termina en el borde del mapa— pero
  // no las lejanas: proyectarlas dentro levantaria el terreno entero.
  for (const pk of peaksIn(theater.bbox(0.8))) {
    const [kx, ky] = theater.lonLatToKm(pk.x, pk.y);
    const rr = Math.round((ky + theater.cy) / theater.dy);
    const cc = Math.round((kx + theater.cx - (rr & 1) * theater.dx / 2) / theater.dx);
    if (cc < -6 || rr < -6 || cc > W + 6 || rr > H + 6) continue;
    const amp = Math.min(0.30, pk.e / 9000);
    for (let row = Math.max(0, rr - 5); row < Math.min(H, rr + 6); row++) {
      for (let col = Math.max(0, cc - 5); col < Math.min(W, cc + 6); col++) {
        const d = distance(cc, rr, col, row);
        if (d > 5) continue;
        elev[row * W + col] += amp * Math.exp(-d * d / 8);
      }
    }
  }
  // suavizado: una cordillera no cambia de altura de un hexagono al siguiente
  const sm = Float32Array.from(elev);
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      // el centro pesa mas que los vecinos: suavizar de mas convierte una
      // cordillera entera en una meseta de colinas
      let s = elev[row * W + col] * 3, n = 3;
      for (const [c, r] of neighbors(col, row)) {
        const o = at(c, r); if (!o) continue;
        s += elev[r * W + c]; n++;
      }
      sm[row * W + col] = s / n;
    }
  }
  for (let i = 0; i < N; i++) hexes[i].elev = Math.max(0, Math.min(1, sm[i]));

  // ── 3. tipo de terreno: mar, relieve, clima y region fisica ─────────────
  // Un gran rio corrige la latitud: la llanura del Ganges esta en el paralelo
  // del Sahara y no se parece en nada. Se mide la cercania a cauce y a costa.
  const nearWater = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const h = hexes[i];
    if (h.river.some(Boolean) || landFrac[i] < 0.34) nearWater[i] = 1;
  }
  for (let pass = 0; pass < 3; pass++) {
    const nx = Float32Array.from(nearWater);
    for (let row = 0; row < H; row++) {
      for (let col = 0; col < W; col++) {
        let m = nearWater[row * W + col];
        for (const [c, r] of neighbors(col, row)) {
          if (c < 0 || r < 0 || c >= W || r >= H) continue;
          m = Math.max(m, nearWater[r * W + c] * 0.72);
        }
        nx[row * W + col] = m;
      }
    }
    nearWater.set(nx);
  }

  for (let i = 0; i < N; i++) {
    const h = hexes[i];
    if (landFrac[i] < 0.34) { h.t = 'agua'; h.elev = 0; continue; }
    const absLat = Math.abs(h.lat);
    const e = h.elev;
    const wet = Math.max(0, Math.min(1,
      climate(absLat) * 0.86 + (wetN[i] - 0.5) * 0.34 + nearWater[i] * 0.30));
    const c = cls[i];

    if (absLat > 72) { h.t = e > 0.7 ? 'montana' : 'hielo'; continue; }
    if (e > 0.80) { h.t = 'montana'; continue; }
    if (e > 0.62) { h.t = 'colinas'; continue; }
    if (c === C.WETLANDS || c === C.DELTA) { h.t = 'pantano'; continue; }
    // por encima del circulo boreal la taiga llega mucho mas al norte que la tundra
    if (absLat > 66) { h.t = wet > 0.34 && forN[i] > 0.36 ? 'bosque' : 'tundra'; continue; }
    if (c === C.DESERT || wet < 0.15) { h.t = 'desierto'; continue; }
    if (wet < 0.30) { h.t = 'estepa'; continue; }
    if (absLat < 13 && wet > 0.60) { h.t = 'jungla'; continue; }
    if (forN[i] > 0.63) { h.t = e > 0.42 ? 'bosque' : 'bocage'; continue; }
    if (c === C.PLATEAU) { h.t = 'estepa'; continue; }
    h.t = forN[i] < 0.38 ? 'cultivo' : 'llanura';
  }

  // ── 4. cauces reales sobre las aristas de la retícula ───────────────────
  const w = world();
  const rb = theater.bbox(0.1);
  for (const r of w.rivers) {
    let prev = null;
    for (let k = 0; k < r.length; k += 2) {
      const lon = r[k], lat = r[k + 1];
      if (lon < rb.w || lon > rb.e || lat < rb.s || lat > rb.n) { prev = null; continue; }
      const cell = theater.lonLatToHex(lon, lat);
      if (!cell) { prev = null; continue; }
      if (prev && (prev[0] !== cell[0] || prev[1] !== cell[1])) {
        const a = at(prev[0], prev[1]), b = at(cell[0], cell[1]);
        if (a && b && distance(prev[0], prev[1], cell[0], cell[1]) === 1) {
          const nb = neighbors(a.col, a.row);
          for (let d = 0; d < 6; d++) {
            if (nb[d][0] === b.col && nb[d][1] === b.row) {
              a.river[d] = true; b.river[OPPOSITE[d]] = true;
            }
          }
        }
      }
      prev = cell;
    }
  }
  // la orilla de un cauce no es un solo lado: se ensancha para que cortar el
  // rio siga siendo una operacion y no un tramite
  for (const h of hexes) {
    if (h.t === 'agua') continue;
    if (!h.river.some(Boolean)) continue;
    for (const d of [0, 3]) {
      const [nc, nr] = neighbor(h.col, h.row, d);
      const o = at(nc, nr);
      if (o && o.t !== 'agua' && rng.chance(0.55)) { h.river[d] = true; o.river[OPPOSITE[d]] = true; }
    }
  }

  // ── 5. nucleos de poblacion reales ──────────────────────────────────────
  const cities = [];
  for (const c of citiesIn(theater.bbox(-0.05), 90)) {
    const cell = theater.lonLatToHex(c.x, c.y);
    if (!cell) continue;
    const h = at(cell[0], cell[1]);
    if (!h || h.t === 'agua') continue;
    if (cities.some(o => distance(o.col, o.row, h.col, h.row) < 2)) continue;
    const size = c.p > 3e6 ? 4 : c.p > 8e5 ? 3 : c.p > 2e5 ? 2 : 1;
    const vp = (c.cap ? 12 : 0) + [0, 5, 9, 16, 26][size];
    h.t = 'urbano'; h.city = { name: c.n, size, pop: c.p, country: c.c };
    h.name = c.n; h.vp = vp;
    if (size >= 3) {
      for (const [nc, nr] of neighbors(h.col, h.row)) {
        const o = at(nc, nr);
        if (o && o.t !== 'agua' && rng.chance(0.5)) o.t = rng.chance(0.4) ? 'industrial' : 'urbano';
      }
    }
    cities.push({ col: h.col, row: h.row, size, vp, name: c.n });
  }

  const worldObj = { W, H, hexes, cities, theater, landFrac };

  // ── 6. red de comunicaciones entre nucleos reales ───────────────────────
  const carve = (a, b, grade) => {
    const path = roadPath(hexes, W, H, a, b);
    if (!path) return;
    for (let n = 0; n < path.length; n++) {
      const h = hexes[path[n]];
      h.road = Math.max(h.road, grade);
      if (grade >= 2) h.rail = true;
      if (n > 0) {
        const p = hexes[path[n - 1]];
        const nb = neighbors(p.col, p.row);
        for (let d = 0; d < 6; d++) {
          if (nb[d][0] === h.col && nb[d][1] === h.row && p.river[d]) {
            p.bridge[d] = true; h.bridge[OPPOSITE[d]] = true;
          }
        }
      }
    }
  };
  const sorted = [...cities].sort((a, b) => a.col - b.col);
  for (let n = 0; n < sorted.length - 1; n++) carve(sorted[n], sorted[n + 1], 1);
  const big = [...cities].filter(c => c.size >= 2).sort((a, b) => a.col - b.col);
  for (let n = 0; n < big.length - 1; n++) carve(big[n], big[n + 1], 2);
  for (const c of cities) {
    const near = cities.filter(o => o !== c && distance(o.col, o.row, c.col, c.row) < 12);
    for (const o of near.slice(0, 2)) carve(c, o, 1);
  }
  return worldObj;
}

/** Dijkstra sobre coste de construccion: evita montaña, marisma, agua y cauces. */
function roadPath(hexes, W, H, a, b) {
  const N = W * H, dist = new Float32Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
  const start = a.row * W + a.col, goal = b.row * W + b.col;
  dist[start] = 0;
  const pq = new MinHeap();
  pq.push(0, start);
  while (pq.size) {
    const cur = pq.pop();
    const d = dist[cur];
    if (cur === goal) break;
    const h = hexes[cur];
    const nb = neighbors(h.col, h.row);
    for (let k = 0; k < 6; k++) {
      const [nc, nr] = nb[k];
      if (nc < 0 || nr < 0 || nc >= W || nr >= H) continue;
      const j = nr * W + nc, o = hexes[j];
      if (o.t === 'agua') continue;
      let c = 1;
      if (o.t === 'montana') c = 8; else if (o.t === 'pantano') c = 6;
      else if (o.t === 'jungla') c = 5; else if (o.t === 'hielo') c = 6;
      else if (o.t === 'bosque' || o.t === 'bocage') c = 2.2;
      else if (o.t === 'colinas') c = 1.8;
      c += o.elev * 2.5;
      if (h.river[k] && !h.bridge[k]) c += 4;
      if (o.road) c *= 0.35;
      const nd = d + c;
      if (nd < dist[j]) { dist[j] = nd; prev[j] = cur; pq.push(nd, j); }
    }
  }
  if (prev[goal] < 0 && goal !== start) return null;
  const out = []; let cur = goal;
  while (cur !== -1) { out.push(cur); if (cur === start) break; cur = prev[cur]; }
  return out.reverse();
}

/**
 * Bases logisticas de teatro: cabezas de ferrocarril sobre el borde propio, en
 * tierra firme, prolongadas hacia el interior por un troncal. Sin ese esqueleto
 * la traza tendria que hacerse campo a traves y el alcance operacional de
 * cualquier despliegue seria ridiculo.
 */
export function assignSupplyBases(world, side, edge, depthFrac = 0.30) {
  const { W, H, hexes } = world;
  const bases = [];
  const depth = Math.round(W * depthFrac);
  const inward = (k) => (edge === 'W' ? k : W - 1 - k);
  const landAt = (c, r) => {
    const h = hexes[r * W + c];
    return h && h.t !== 'agua' ? h : null;
  };

  for (let row = 2; row < H - 2; row += 5) {
    // la cabeza se retranquea hacia el interior hasta encontrar tierra
    let head = null;
    for (let k = 0; k < Math.round(W * 0.18); k++) {
      const h = landAt(inward(k), row);
      if (h) { head = h; break; }
    }
    if (!head) continue;
    head.rail = true; head.road = Math.max(head.road, 2); head.depot = side;
    bases.push(head.i);

    let r = head.row;
    const k0 = edge === 'W' ? head.col : W - 1 - head.col;
    for (let k = k0 + 1; k <= depth; k++) {
      let o = landAt(inward(k), r);
      if (!o) {                                   // rodea el agua por la fila contigua
        for (const dr of [1, -1, 2, -2]) {
          const alt = (r + dr >= 0 && r + dr < H) ? landAt(inward(k), r + dr) : null;
          if (alt) { o = alt; r = alt.row; break; }
        }
      }
      if (!o) break;
      const prev = hexes[r * W + inward(k - 1)];
      o.rail = true; o.road = Math.max(o.road, 2);
      if (prev && prev.t !== 'agua') {
        const nb = neighbors(prev.col, prev.row);
        for (let d = 0; d < 6; d++) {
          if (nb[d][0] === o.col && nb[d][1] === o.row && prev.river[d]) {
            prev.bridge[d] = true; o.bridge[OPPOSITE[d]] = true;
          }
        }
      }
    }
  }
  // lateral de retaguardia que une las cabezas
  if (bases.length) {
    const col = hexes[bases[0]].col;
    for (let row = 1; row < H - 1; row++) {
      const h = landAt(col, row);
      if (h) { h.rail = true; h.road = Math.max(h.road, 1); }
    }
  }
  return bases;
}

export function hexLabel(h) {
  return h.city ? h.city.name : `${h.lat.toFixed(2)}°, ${h.lon.toFixed(2)}°`;
}
