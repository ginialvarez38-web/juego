// Analisis operacional del teatro.
//
// Traduce la posicion de las unidades a la geometria que un estado mayor lee en
// el mapa: control del terreno, linea de contacto, salientes, bolsas, cercos,
// pinzas a punto de cerrarse y brechas sin cubrir. Todo se deriva de dos campos:
//   1) el campo de control (influencia ponderada de cada bando sobre cada hexagono)
//   2) el campo logistico (nivel de abastecimiento trazado desde las bases)
// La bolsa es la interseccion de ambos: territorio nominalmente propio cuya traza
// de abastecimiento esta cortada.
import { neighbors, distance, disc, lineHexes, HEX_KM } from './hex.js';
import { SIDES, other, projectsZOC } from './sim.js';
import { TERRAIN } from './terrain.js';
import { MinHeap } from './heap.js';

const B = 0, R = 1;
const sideIdx = (s) => (s === 'BLUE' ? 0 : 1);

/**
 * Campo de control por difusion de distancia ponderada.
 *
 * Cada bando propaga «alcance» desde sus unidades y sus bases a traves del
 * terreno; un hexagono pertenece a quien llega antes. Recorrer terreno dificil
 * cuesta mas, y penetrar en la zona de control contraria cuesta bastante mas:
 * asi la frontera se detiene en la linea de contacto en vez de degradarse en un
 * moteado. El resultado son regiones contiguas —que es como se pinta un frente—
 * y de ahi salen solos los salientes, las bolsas y los cercos.
 */
export function controlField(game) {
  const { W, H, N } = game;
  const prev = game.analysis?.owner;
  const dist = [new Float32Array(N).fill(Infinity), new Float32Array(N).fill(Infinity)];

  for (const s of SIDES) {
    const si = sideIdx(s), ez = game._zoc[other(s)];
    const d = dist[si];
    const pq = new MinHeap();
    const seed = (i, v) => { if (v < d[i]) { d[i] = v; pq.push(v, i); } };

    for (const u of game.units) {
      if (u.side !== s || u.status === 'destroyed') continue;
      // una division intacta domina mas lejos que un resto batido
      const frac = u.personnel / u.personnelMax;
      const pen = (projectsZOC(u) ? 0 : 2.5) + (1 - frac) * 2 + (u.status === 'routed' ? 3 : 0)
        + (1 - u.morale / 100) * 1.5;
      seed(u.row * W + u.col, pen);
    }
    for (const bi of game.sides[s].bases) seed(bi, 0);

    while (pq.size) {
      const cur = pq.pop();
      const dc = d[cur];
      const cc = cur % W, cr = (cur / W) | 0;
      for (const [c, r] of neighbors(cc, cr)) {
        if (c < 0 || r < 0 || c >= W || r >= H) continue;
        const j = r * W + c, h = game.hexes[j];
        if (h.t === 'agua') continue;
        let step = 0.85 + 0.30 * TERRAIN[h.t].move;
        if (ez[j]) step += 2.2;                       // la ZDC contraria frena la expansion
        const nd = dc + step;
        if (nd < d[j]) { d[j] = nd; pq.push(nd, j); }
      }
    }
  }

  const owner = new Int8Array(N);
  for (let i = 0; i < N; i++) {
    let a = dist[B][i], b = dist[R][i];
    if (prev) { if (prev[i] === B) a -= 0.7; else b -= 0.7; }   // histeresis: el terreno no cambia de mano por un empate
    if (!isFinite(a) && !isFinite(b)) owner[i] = (i % W) < W / 2 ? B : R;
    else owner[i] = a <= b ? B : R;
  }
  return { owner, infl: dist };
}

/** Componentes conexas de hexagonos con el mismo propietario. */
function components(game, owner, side) {
  const { W, H, N } = game;
  const seen = new Uint8Array(N), comps = [];
  for (let i = 0; i < N; i++) {
    if (seen[i] || owner[i] !== side) continue;
    const q = [i]; seen[i] = 1; const cells = [];
    while (q.length) {
      const cur = q.pop(); cells.push(cur);
      const cc = cur % W, cr = (cur / W) | 0;
      for (const [c, r] of neighbors(cc, cr)) {
        if (c < 0 || r < 0 || c >= W || r >= H) continue;
        const j = r * W + c;
        if (!seen[j] && owner[j] === side) { seen[j] = 1; q.push(j); }
      }
    }
    comps.push(cells);
  }
  return comps.sort((a, b) => b.length - a.length);
}

/** Bolsas y cercos: territorio propio sin traza logistica hacia la base. */
export function findPockets(game, owner, side) {
  const si = sideIdx(side);
  const sup = game._supply[side];
  const baseSet = new Set(game.sides[side].bases);
  const out = [];
  let total = 0;
  for (let i = 0; i < game.N; i++) if (owner[i] === si) total++;
  for (const cells of components(game, owner, si)) {
    let maxSup = 0, hasBase = false;
    for (const i of cells) {
      if (sup.level[i] > maxSup) maxSup = sup.level[i];
      if (baseSet.has(i)) hasBase = true;
    }
    if (hasBase || maxSup > 12) continue;                       // sector normal, no bolsa
    // Un cerco es una porcion aislada del despliegue. Si lo «aislado» es
    // practicamente todo el territorio propio, lo que hay no es una bolsa sino
    // un colapso general del sostenimiento, y se informa como tal en otro sitio.
    if (cells.length > total * 0.45) continue;
    const set = new Set(cells);
    const units = game.units.filter(u => u.side === side && u.status !== 'destroyed'
      && set.has(u.row * game.W + u.col));
    if (!units.length && cells.length < 6) continue;
    const men = units.reduce((s, u) => s + u.personnel, 0);
    const sealed = maxSup <= 2;
    // anchura del corredor si no esta sellada: hexagonos de borde con algo de traza
    let corridor = 0;
    for (const i of cells) if (sup.level[i] > 2 && sup.level[i] <= 12) corridor++;
    out.push({
      kind: sealed ? 'cerco' : 'bolsa',
      side, cells, units: units.map(u => u.id), men,
      areaKm2: Math.round(cells.length * HEX_KM * HEX_KM * 0.866),
      sealed, corridorHexes: corridor,
      avgSupply: units.length ? units.reduce((s, u) => s + u.supplyLevel, 0) / units.length : 0,
      turnsIsolated: units.length ? Math.max(...units.map(u => u.isolatedTurns)) : 0,
      centroid: centroid(game, cells),
    });
  }
  return out.sort((a, b) => b.men - a.men);
}

/** Grado de envolvimiento de un hexagono: proporcion de enemigo a su alrededor. */
export function enclosureField(game, owner, side) {
  const { W, H, N } = game;
  const si = sideIdx(side), ei = 1 - si;
  const enc = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (owner[i] !== si) continue;
    const c = i % W, r = (i / W) | 0;
    let e = 0, t = 0;
    for (const [cc, rr] of disc(c, r, 3)) {
      if (cc < 0 || rr < 0 || cc >= W || rr >= H) continue;
      t++; if (owner[rr * W + cc] === ei) e++;
    }
    enc[i] = t ? e / t : 0;
  }
  return enc;
}

/** Salientes: protuberancias del propio frente dentro del dispositivo enemigo. */
export function findSalients(game, owner, side, enc, pocketCells) {
  const { W, H, N } = game;
  const si = sideIdx(side);
  const cand = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (owner[i] === si && enc[i] >= 0.40 && !pocketCells.has(i)) cand[i] = 1;

  const seen = new Uint8Array(N), out = [];
  for (let i = 0; i < N; i++) {
    if (seen[i] || !cand[i]) continue;
    const q = [i]; seen[i] = 1; const cells = [];
    while (q.length) {
      const cur = q.pop(); cells.push(cur);
      const cc = cur % W, cr = (cur / W) | 0;
      for (const [c, r] of neighbors(cc, cr)) {
        if (c < 0 || r < 0 || c >= W || r >= H) continue;
        const j = r * W + c;
        if (!seen[j] && cand[j]) { seen[j] = 1; q.push(j); }
      }
    }
    if (cells.length < 4) continue;
    // hexagonos de arranque: los que enlazan con el cuerpo principal del frente
    const base = cells.filter(k => {
      const cc = k % W, cr = (k / W) | 0;
      return neighbors(cc, cr).some(([c, r]) =>
        c >= 0 && r >= 0 && c < W && r < H && owner[r * W + c] === si && !cand[r * W + c]);
    });
    if (!base.length) continue;                                  // desconectado: es bolsa, no saliente
    // profundidad: distancia maxima al arranque
    let depth = 0, tip = cells[0];
    for (const k of cells) {
      let dmin = 99;
      for (const b of base) dmin = Math.min(dmin, distance(k % W, (k / W) | 0, b % W, (b / W) | 0));
      if (dmin > depth) { depth = dmin; tip = k; }
    }
    // Una protuberancia de un solo hexagono es ruido cartografico. Un saliente
    // operacional tiene fondo y, sobre todo, tropas dentro: es lo que lo hace
    // interesante para quien quiere cortarlo.
    if (depth < 3) continue;
    const neck = base.length;
    const cellSet = new Set(cells);
    const units = game.units.filter(u => u.side === side && u.status !== 'destroyed'
      && cellSet.has(u.row * W + u.col));
    if (units.reduce((s, u) => s + u.personnel, 0) < 4000) continue;
    out.push({
      side, cells, base, tip,
      depthKm: (depth + 1) * HEX_KM,
      neckKm: neck * HEX_KM,
      men: units.reduce((s, u) => s + u.personnel, 0),
      units: units.map(u => u.id),
      vulnerable: neck <= Math.max(2, depth),
      centroid: centroid(game, cells),
    });
  }
  return out.sort((a, b) => b.depthKm - a.depthKm).slice(0, 4);
}

/**
 * Pinzas: dos salientes propios cuyas puntas convergen con dispositivo enemigo
 * entre ambas. Se simula el cierre para valorar el premio: que fuerzas quedarian
 * embolsadas si la brecha se sella este turno.
 */
export function findPincers(game, owner, side, salients) {
  const { W, H } = game;
  const si = sideIdx(side), ei = 1 - si;
  const out = [];
  const arms = salients.filter(s => s.depthKm >= 10);
  for (let a = 0; a < arms.length; a++) {
    for (let b = a + 1; b < arms.length; b++) {
      const A = arms[a], Bm = arms[b];
      const ac = A.tip % W, ar = (A.tip / W) | 0;
      const bc = Bm.tip % W, br = (Bm.tip / W) | 0;
      const d = distance(ac, ar, bc, br);
      if (d < 2 || d > 12) continue;
      const line = lineHexes(ac, ar, bc, br);
      let enemyOn = 0;
      for (const [c, r] of line) {
        if (c < 0 || r < 0 || c >= W || r >= H) continue;
        if (owner[r * W + c] === ei) enemyOn++;
      }
      if (enemyOn === 0 || enemyOn / line.length < 0.30) continue;

      // simulacion del cierre
      const sim = Int8Array.from(owner);
      for (const [c, r] of line) if (c >= 0 && r >= 0 && c < W && r < H) sim[r * W + c] = si;
      const trapped = simulateTrap(game, sim, other(side));
      // Cerrar la pinza debe aislar una parte del enemigo, no a todo el enemigo:
      // si lo segundo, el frente ya esta roto y no es una maniobra de tenaza.
      const foeMen = game.units.filter(x => x.side === other(side) && x.status !== 'destroyed')
        .reduce((s, x) => s + x.personnel, 0);
      if (trapped.men > foeMen * 0.72 || trapped.men < 2000) continue;
      out.push({
        side, armA: A, armB: Bm,
        gapKm: enemyOn * HEX_KM,
        gapHexes: enemyOn,
        closureLine: line,
        trappedMen: trapped.men,
        trappedUnits: trapped.units,
        trappedAreaKm2: trapped.areaKm2,
        centroid: [(ac + bc) / 2, (ar + br) / 2],
      });
    }
  }
  return out.sort((x, y) => y.trappedMen - x.trappedMen).slice(0, 4);
}

/** Que fuerzas del bando `victim` quedarian sin traza con este reparto simulado. */
function simulateTrap(game, simOwner, victim) {
  const { W, H, N } = game;
  const vi = sideIdx(victim);
  // BFS desde las bases del enemigo por territorio suyo en el reparto simulado
  const reach = new Uint8Array(N);
  const q = [];
  for (const bi of game.sides[victim].bases) if (simOwner[bi] === vi) { reach[bi] = 1; q.push(bi); }
  while (q.length) {
    const cur = q.pop();
    const cc = cur % W, cr = (cur / W) | 0;
    for (const [c, r] of neighbors(cc, cr)) {
      if (c < 0 || r < 0 || c >= W || r >= H) continue;
      const j = r * W + c;
      if (!reach[j] && simOwner[j] === vi) { reach[j] = 1; q.push(j); }
    }
  }
  let men = 0, cells = 0, units = [];
  for (let i = 0; i < N; i++) if (simOwner[i] === vi && !reach[i]) cells++;
  for (const u of game.units) {
    if (u.side !== victim || u.status === 'destroyed') continue;
    const i = u.row * W + u.col;
    if (simOwner[i] === vi && !reach[i]) { men += u.personnel; units.push(u.id); }
  }
  return { men, units, areaKm2: Math.round(cells * HEX_KM * HEX_KM * 0.866) };
}

/** Brechas: tramos de contacto sin tropas propias a menos de dos hexagonos. */
export function findBreaches(game, owner, side) {
  const { W, H, N } = game;
  const si = sideIdx(side), ei = 1 - si;
  const near = new Uint8Array(N);
  for (const u of game.units) {
    if (u.side !== side || u.status === 'destroyed' || !projectsZOC(u)) continue;
    for (const [c, r] of disc(u.col, u.row, 2)) {
      if (c >= 0 && r >= 0 && c < W && r < H) near[r * W + c] = 1;
    }
  }
  const open = [];
  for (let i = 0; i < N; i++) {
    if (owner[i] !== si || near[i]) continue;
    const c = i % W, r = (i / W) | 0;
    if (neighbors(c, r).some(([cc, rr]) => cc >= 0 && rr >= 0 && cc < W && rr < H && owner[rr * W + cc] === ei)) open.push(i);
  }
  // agrupar en tramos contiguos
  const openSet = new Set(open);
  const seen = new Set(), out = [];
  for (const i of open) {
    if (seen.has(i)) continue;
    const q = [i]; seen.add(i); const cells = [];
    while (q.length) {
      const cur = q.pop(); cells.push(cur);
      for (const [c, r] of neighbors(cur % W, (cur / W) | 0)) {
        if (c < 0 || r < 0 || c >= W || r >= H) continue;
        const j = r * W + c;
        if (!seen.has(j) && openSet.has(j)) { seen.add(j); q.push(j); }
      }
    }
    // un hueco de menos de 15 km entra dentro de la separacion normal entre
    // grandes unidades; solo se informa de lo que es de verdad un boquete
    if (cells.length >= 4) out.push({ side, cells, widthKm: cells.length * HEX_KM, centroid: centroid(game, cells) });
  }
  return out.sort((a, b) => b.widthKm - a.widthKm).slice(0, 3);
}

/** Segmentos de la linea de contacto: aristas entre hexagonos de distinto dueño. */
export function frontlineEdges(game, owner) {
  const { W, H, N } = game;
  const segs = [];
  for (let i = 0; i < N; i++) {
    const c = i % W, r = (i / W) | 0;
    if (owner[i] !== B) continue;
    const nb = neighbors(c, r);
    for (let d = 0; d < 6; d++) {
      const [nc, nr] = nb[d];
      if (nc < 0 || nr < 0 || nc >= W || nr >= H) continue;
      if (owner[nr * W + nc] === R) segs.push([i, d]);
    }
  }
  return segs;
}

/**
 * Vectores de avance de las ultimas `win` marcas de rastro. Solo se pinta lo que
 * es de verdad un avance: si la unidad ha caminado mucho para acabar cerca de
 * donde estaba, eso es desgaste de la tropa, no progresion operacional.
 */
export function advanceVectors(game, win = 4) {
  const out = [];
  for (const u of game.units) {
    if (u.status === 'destroyed' || u.trail.length < 2) continue;
    const past = u.trail.filter(t => t[2] >= game.turn - win);
    if (past.length < 2) continue;
    const [c0, r0] = past[0];
    const neto = distance(c0, r0, u.col, u.row);
    if (neto < 3) continue;
    let andado = 0;
    for (let i = 1; i < past.length; i++) andado += distance(past[i - 1][0], past[i - 1][1], past[i][0], past[i][1]);
    andado += distance(past[past.length - 1][0], past[past.length - 1][1], u.col, u.row);
    if (andado > 0 && neto / andado < 0.5) continue;
    out.push({ id: u.id, side: u.side, from: [c0, r0], to: [u.col, u.row], km: neto * HEX_KM });
  }
  return out.sort((a, b) => b.km - a.km).slice(0, 12);
}

function centroid(game, cells) {
  let c = 0, r = 0;
  for (const i of cells) { c += i % game.W; r += (i / game.W) | 0; }
  return [c / cells.length, r / cells.length];
}

/** Calcula el cuadro operacional completo para los dos bandos. */
export function analyze(game) {
  const { owner, infl } = controlField(game);
  const res = { owner, infl, front: frontlineEdges(game, owner), advance: advanceVectors(game), sides: {} };
  for (const s of SIDES) {
    const pockets = findPockets(game, owner, s);
    const pocketCells = new Set();
    for (const p of pockets) for (const i of p.cells) pocketCells.add(i);
    const enc = enclosureField(game, owner, s);
    const salients = findSalients(game, owner, s, enc, pocketCells);
    const pincers = findPincers(game, owner, s, salients);
    const breaches = findBreaches(game, owner, s);
    let hexes = 0;
    for (let i = 0; i < game.N; i++) if (owner[i] === sideIdx(s)) hexes++;
    res.sides[s] = {
      pockets, salients, pincers, breaches, enclosure: enc,
      areaKm2: Math.round(hexes * HEX_KM * HEX_KM * 0.866),
      frontKm: 0,
    };
  }
  res.sides.BLUE.frontKm = res.sides.RED.frontKm = Math.round(res.front.length * HEX_KM * 0.5);
  game.analysis = res;
  return res;
}
