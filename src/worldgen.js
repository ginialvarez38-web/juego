// Generacion del teatro de operaciones: relieve, hidrografia, red de comunicaciones
// y nucleos de poblacion. El mapa no es decorativo: rios, carreteras y ciudades
// definen los ejes de avance posibles y por tanto la forma que tomaran los frentes.
import { neighbors, neighbor, distance, OPPOSITE, disc } from './hex.js';
import { noiseField } from './rng.js';
import { MinHeap } from './heap.js';

const NOMBRES = ['Vashen', 'Korlau', 'Drenitz', 'Saloka', 'Belmar', 'Ostrog', 'Tarnov', 'Kresna',
  'Alvédar', 'Miroslav', 'Pászt', 'Rehden', 'Vinograd', 'Zelena', 'Hochbrück', 'Lemburg',
  'Novaya', 'Stanov', 'Ferrada', 'Kaltbach', 'Ordanz', 'Bielsk', 'Marnau', 'Sertol'];

export function generateTheater(W, H, rng) {
  const N = W * H;
  const hexes = new Array(N);
  const elevN = noiseField(W, H, rng, 5, 5);
  const forestN = noiseField(W, H, rng, 4, 9);
  const wetN = noiseField(W, H, rng, 3, 7);

  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const i = row * W + col;
      // Cordillera suave hacia los bordes N y S -> canaliza la maniobra al centro.
      const edgeBias = Math.pow(Math.abs(row - (H - 1) / 2) / ((H - 1) / 2), 2.2);
      const e = Math.min(1, elevN[i] * 0.78 + edgeBias * 0.55);
      let t = 'llanura';
      if (e > 0.80) t = 'montana';
      else if (e > 0.62) t = 'colinas';
      else if (forestN[i] > 0.62) t = e > 0.5 ? 'bosque' : 'bocage';
      else if (wetN[i] > 0.76 && e < 0.42) t = 'pantano';
      else if (forestN[i] < 0.34) t = 'cultivo';
      hexes[i] = {
        i, col, row, t, elev: e,
        river: [false, false, false, false, false, false],
        bridge: [false, false, false, false, false, false],
        road: 0, rail: false, city: null, vp: 0, name: null,
        blown: false,
      };
    }
  }

  const at = (c, r) => (c < 0 || r < 0 || c >= W || r >= H) ? null : hexes[r * W + c];

  // ---- Hidrografia: dos rios principales de N a S con meandros ----
  const rivers = [];
  for (let k = 0; k < 2; k++) {
    let col = Math.floor(W * (k === 0 ? 0.34 : 0.68) + rng.gauss(0, 2));
    const path = [];
    for (let row = 0; row < H; row++) {
      col += Math.round(rng.gauss(0, 0.85));
      col = Math.max(2, Math.min(W - 3, col));
      path.push([col, row]);
    }
    rivers.push(path);
    for (let n = 0; n < path.length - 1; n++) {
      const [c1, r1] = path[n], [c2, r2] = path[n + 1];
      const h = at(c1, r1); if (!h) continue;
      // marcar el lado del hexagono cruzado por el cauce
      const nb = neighbors(c1, r1);
      for (let d = 0; d < 6; d++) {
        if (nb[d][0] === c2 && nb[d][1] === r2) {
          h.river[d] = true;
          const o = at(c2, r2); if (o) o.river[OPPOSITE[d]] = true;
        }
      }
      // ribera: los laterales tambien son obstaculo
      for (const d of [0, 3]) {
        const [nc, nr] = neighbor(c1, r1, d);
        const o = at(nc, nr);
        if (o) { h.river[d] = true; o.river[OPPOSITE[d]] = true; }
      }
      if (h.t === 'montana') h.t = 'colinas';
    }
  }

  // ---- Ciudades y valor operacional ----
  const cities = [];
  const nombres = rng.shuffle([...NOMBRES]);
  const tryCity = (col, row, size, vp) => {
    const h = at(col, row);
    if (!h || h.t === 'montana' || h.t === 'pantano') return null;
    for (const c of cities) if (distance(c.col, c.row, col, row) < 5) return null;
    h.t = size >= 3 ? 'urbano' : 'urbano';
    h.city = { name: nombres.pop() || ('Punto ' + cities.length), size };
    h.name = h.city.name; h.vp = vp;
    if (size >= 3) {
      for (const [nc, nr] of neighbors(col, row)) {
        const o = at(nc, nr);
        if (o && o.t !== 'agua' && rng.chance(0.55)) o.t = rng.chance(0.4) ? 'industrial' : 'urbano';
      }
    }
    cities.push({ col, row, size, vp, name: h.city.name });
    return h;
  };
  // capitales de teatro en ambos extremos + objetivos intermedios
  tryCity(4, Math.floor(H / 2), 4, 30);
  tryCity(W - 5, Math.floor(H / 2), 4, 30);
  for (let n = 0; n < 16; n++) {
    tryCity(3 + rng.int(W - 6), 2 + rng.int(H - 4), 1 + rng.int(3), 4 + rng.int(10));
  }

  // ---- Red de comunicaciones: une ciudades por el camino de menor coste ----
  const carve = (a, b, grade) => {
    const path = roadPath(hexes, W, H, a, b);
    if (!path) return;
    for (let n = 0; n < path.length; n++) {
      const h = hexes[path[n]];
      h.road = Math.max(h.road, grade);
      if (grade >= 2) h.rail = true;
      if (n > 0) { // puente donde la calzada cruza el cauce
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
  // eje principal oeste-este (linea de comunicaciones estrategica)
  const spine = sorted.filter(c => Math.abs(c.row - H / 2) < H * 0.30);
  for (let n = 0; n < spine.length - 1; n++) carve(spine[n], spine[n + 1], 2);
  for (const c of cities) {
    const near = cities.filter(o => o !== c && distance(o.col, o.row, c.col, c.row) < 14);
    for (const o of near.slice(0, 2)) carve(c, o, 1);
  }
  // ramales laterales para dar profundidad logistica
  for (let n = 0; n < 6; n++) {
    const a = rng.pick(cities), b = rng.pick(cities);
    if (a !== b) carve(a, b, 1);
  }

  return { W, H, hexes, cities, rivers };
}

/** Dijkstra simple sobre coste de construccion (evita montana, pantano y rios). */
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
      let c = 1;
      if (o.t === 'montana') c = 7; else if (o.t === 'pantano') c = 6;
      else if (o.t === 'bosque' || o.t === 'bocage') c = 2.2; else if (o.t === 'colinas') c = 1.8;
      if (h.river[k]) c += 4;
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
 * Bases logisticas de teatro: cabezas de ferrocarril sobre el borde propio.
 * Cada cabeza se prolonga hacia el interior con un troncal ferroviario hasta la
 * zona de retaguardia del ejercito, y una lateral las une entre si. Sin este
 * esqueleto la traza tendria que hacerse campo a traves y el alcance operacional
 * de cualquier despliegue seria ridiculo.
 */
export function assignSupplyBases(world, side, edge, depthFrac = 0.30) {
  const { W, H, hexes } = world;
  const bases = [];
  const col = edge === 'W' ? 0 : W - 1;
  const depth = Math.round(W * depthFrac);
  const inward = (k) => (edge === 'W' ? k : W - 1 - k);

  for (let row = 2; row < H - 2; row += 5) {
    const h = hexes[row * W + col];
    h.rail = true; h.road = Math.max(h.road, 2); h.depot = side;
    bases.push(h.i);
    // troncal hacia el interior (esquiva agua bajando de fila si hace falta)
    let r = row;
    for (let k = 1; k <= depth; k++) {
      let o = hexes[r * W + inward(k)];
      if (o && o.t === 'agua') {
        const alt = hexes[(r + (r < H / 2 ? 1 : -1)) * W + inward(k)];
        if (alt && alt.t !== 'agua') { o = alt; r = alt.row; }
      }
      if (!o) break;
      o.rail = true; o.road = Math.max(o.road, 2);
      if (o.t === 'agua') break;
      // puente en el troncal donde cruza un cauce
      const prev = hexes[bases.length ? r * W + inward(k - 1) : o.i];
      if (prev) {
        const nb = neighbors(prev.col, prev.row);
        for (let d = 0; d < 6; d++) {
          if (nb[d][0] === o.col && nb[d][1] === o.row && prev.river[d]) {
            prev.bridge[d] = true; o.bridge[OPPOSITE[d]] = true;
          }
        }
      }
    }
  }
  // lateral de retaguardia: une todas las cabezas por la columna del borde
  for (let row = 2; row < H - 2; row++) {
    const h = hexes[row * W + col];
    if (h && h.t !== 'agua') { h.rail = true; h.road = Math.max(h.road, 1); }
  }
  return bases;
}

export function hexLabel(h) {
  return h.city ? h.city.name : `${String.fromCharCode(65 + (h.col % 26))}${h.col}-${h.row}`;
}

export { disc };
