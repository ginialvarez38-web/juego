// Motor de simulacion operacional.
//
// Principios modelados (ver README para las fuentes doctrinales):
//  · Potencia de combate = masa x calidad x factores humanos x sostenimiento.
//  · La ventaja defensiva del terreno y el atrincheramiento son multiplicadores,
//    no sumas: por eso la relacion de fuerzas ~3:1 aparece sola como umbral de
//    exito del asalto en llano y sube a 6:1 contra posiciones urbanas preparadas.
//  · El abastecimiento se traza por la red de comunicaciones y lo interrumpen las
//    zonas de control enemigas: de ahi que un cerco mate por logistica, no por fuego.
//  · Una unidad sin hexagono de retirada disponible sufre bajas dobles y termina
//    capitulando: la mecanica que convierte una pinza cerrada en una bolsa.
import { neighbors, neighbor, distance, disc, lineHexes, OPPOSITE, HEX_KM } from './hex.js';
import { TERRAIN, WEATHER, GROUND } from './terrain.js';
import { POSTURES, DOCTRINES, TEMPLATES } from './units.js';
import { MinHeap } from './heap.js';

export const SIDES = ['BLUE', 'RED'];
export const other = (s) => (s === 'BLUE' ? 'RED' : 'BLUE');
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ───────────────────────────── potencia de combate ─────────────────────────────

/** Multiplicador de factores humanos y de sostenimiento (0..~1.4). */
export function readiness(u) {
  const mor = 0.35 + 0.65 * (u.morale / 100);
  const coh = 0.55 + 0.45 * (u.cohesion / 100);
  const fat = 1 - 0.42 * (u.fatigue / 100);
  const sup = 0.25 + 0.75 * Math.min(1, u.ammo / 70);
  const sup2 = 0.60 + 0.40 * Math.min(1, u.fuel / 60);
  const exp = 0.80 + 0.40 * (u.experience / 100);
  const shock = 1 - 0.55 * (u.suppression / 100);
  return Math.max(0.02, mor * coh * fat * sup * sup2 * exp * shock);
}

/** Potencia bruta de fuego de la unidad, ponderando personal y material. */
export function rawPower(u, vsArmor = 0.35) {
  const t = u.tpl;
  const men = u.personnel / Math.max(1, u.personnelMax);
  const e = u.equip;
  const mat =
    (e.tanks * 3.0 + e.ifv * 1.1 + e.apc * 0.35 + e.guns * 1.6 + e.mlrs * 2.4 + e.atgm * 0.7) / 100;
  const base = t.personnel / 1000 * (t.soft * (1 - vsArmor) + t.hard * vsArmor);
  return Math.max(0.1, base * (0.55 * men + 0.45 * Math.min(1.2, mat / Math.max(0.1, tplMat(t)))));
}
function tplMat(t) {
  return (t.tanks * 3.0 + t.ifv * 1.1 + t.apc * 0.35 + t.guns * 1.6 + t.mlrs * 2.4 + t.atgm * 0.7) / 100 || 0.3;
}

/** Proporcion acorazada del defensor: determina que mezcla de fuego es eficaz. */
function armorShare(units) {
  let t = 0, m = 0;
  for (const u of units) { t += u.equip.tanks + u.equip.ifv * 0.4; m += u.personnel / 1000; }
  return clamp(t / Math.max(1, t + m * 8), 0.05, 0.85);
}

export function combatPower(u, game, role, ctx = {}) {
  const h = game.hexes[u.row * game.W + u.col];
  const T = TERRAIN[h.t];
  const P = POSTURES[u.posture];
  const D = DOCTRINES[game.sides[u.side].doctrine];
  let p = rawPower(u, ctx.armorShare ?? 0.35) * readiness(u);

  const reserveHeld = 1 - u.reservePct * 0.8;
  p *= reserveHeld;
  p *= 0.55 + 0.45 * u.effort;

  if (role === 'attack') {
    p *= P.atk;
    p *= T.atkFront;                                   // frente utilizable / canalizacion
    if (!inCommand(u, game)) p *= 0.78;                // sin coordinacion superior
    p *= (game.sides[u.side].airSuperiority > 0 ? 1 + game.sides[u.side].airSuperiority * 0.08 : 1);
  } else {
    p *= P.def;
    p *= T.def;
    p *= 1 + u.entrench * 0.16;                        // trincheras, obstaculos, campos de tiro
    p *= D.defBonus;
    if (h.city) p *= 1 + Math.min(0.35, h.city.size * 0.09);
  }
  return p;
}

export function inCommand(u, game) {
  if (!u.hqId) return true;
  const hq = game.byId[u.hqId];
  if (!hq || hq.status === 'destroyed') return false;
  return distance(u.col, u.row, hq.col, hq.row) <= hq.tpl.cmdRadius;
}

// ───────────────────────────── zonas de control ─────────────────────────────

export function projectsZOC(u) {
  if (u.status === 'destroyed' || u.status === 'routed') return false;
  if (u.tpl.cmdRadius > 0 || u.tpl.logBoost >= 3) return false;   // CG y logistica no fijan frente
  return u.personnel / u.personnelMax > 0.18 && u.morale > 18;
}

export function computeZOC(game) {
  const z = { BLUE: new Uint8Array(game.N), RED: new Uint8Array(game.N) };
  for (const u of game.units) {
    if (u.status === 'destroyed') continue;
    if (!projectsZOC(u)) continue;
    z[u.side][u.row * game.W + u.col] = 2;
    for (const [c, r] of neighbors(u.col, u.row)) {
      if (c < 0 || r < 0 || c >= game.W || r >= game.H) continue;
      const i = r * game.W + c;
      if (z[u.side][i] < 1) z[u.side][i] = 1;
    }
  }
  return z;
}

export function occupancy(game) {
  const occ = new Int32Array(game.N).fill(-1);
  const list = new Array(game.N);
  for (const u of game.units) {
    if (u.status === 'destroyed') continue;
    const i = u.row * game.W + u.col;
    occ[i] = u.side === 'BLUE' ? 0 : 1;
    (list[i] || (list[i] = [])).push(u);
  }
  return { occ, list };
}

// ───────────────────────────── movimiento ─────────────────────────────

export function moveCost(game, from, to, dir, u) {
  const h = game.hexes[to];
  const T = TERRAIN[h.t];
  if (h.t === 'agua') return Infinity;
  const g = GROUND[game.weather.ground], w = WEATHER[game.weather.type];
  const src = game.hexes[from];
  const onRoad = src.road > 0 && h.road > 0;
  let c = onRoad ? (h.road >= 2 ? 0.5 : 0.75) * g.move : T.move * g.offroad * w.move;
  // cauces: sin puente el paso exige medios de asalto
  if (src.river[dir] && !src.bridge[dir]) {
    c += onRoad ? 1.0 : 4.5 / (1 + u.tpl.engineer);
  }
  if (u.fuel < 25) c *= 1.5;
  return c;
}

/** A* con coste de movimiento y penalizacion por zonas de control enemigas. */
export function findPath(game, u, goalCol, goalRow, zoc) {
  const W = game.W, H = game.H;
  const start = u.row * W + u.col, goal = goalRow * W + goalCol;
  const ez = zoc[other(u.side)], fz = zoc[u.side];
  const { occ } = game._occ;
  const mySide = u.side === 'BLUE' ? 0 : 1;
  const g = new Float32Array(game.N).fill(Infinity);
  const prev = new Int32Array(game.N).fill(-1);
  g[start] = 0;
  const open = new MinHeap();
  open.push(0, start);
  const hEst = (i) => distance(i % W, (i / W) | 0, goalCol, goalRow) * 0.75;
  let iter = 0;
  while (open.size && iter++ < 40000) {
    const cur = open.pop();
    if (cur === goal) break;
    const cc = cur % W, cr = (cur / W) | 0;
    const nb = neighbors(cc, cr);
    for (let d = 0; d < 6; d++) {
      const [nc, nr] = nb[d];
      if (nc < 0 || nr < 0 || nc >= W || nr >= H) continue;
      const j = nr * W + nc;
      if (occ[j] >= 0 && occ[j] !== mySide) continue;             // hexagono ocupado por el enemigo
      let c = moveCost(game, cur, j, d, u);
      if (!isFinite(c)) continue;
      // Regla de zonas de control: entrar en la ZDC contraria cuesta y detiene la
      // marcha; pasar directamente de una ZDC a otra esta prohibido salvo que la
      // casilla de destino este cubierta por tropa propia. Sin esta regla los
      // ejercitos se atraviesan y no llega a formarse frente alguno.
      if (ez[cur] && ez[j] && fz[j] < 2) continue;
      if (ez[j] && occ[j] < 0) c += 3.0;
      const ng = g[cur] + c;
      if (ng < g[j]) { g[j] = ng; prev[j] = cur; open.push(ng + hEst(j), j); }
    }
  }
  if (prev[goal] < 0 && goal !== start) return null;
  const out = []; let cur = goal;
  while (cur !== -1 && cur !== start) { out.push(cur); cur = prev[cur]; }
  return out.reverse();
}

export function maxMP(u, game) {
  const P = POSTURES[u.posture];
  const w = WEATHER[game.weather.type];
  const fuelF = u.fuel > 40 ? 1 : 0.3 + 0.7 * (u.fuel / 40);
  const fatF = 1 - 0.35 * (u.fatigue / 100);
  const supF = 1 - 0.4 * (u.suppression / 100);
  return u.tpl.mp * P.move * fuelF * fatF * supF / w.move;
}

// ───────────────────────────── abastecimiento ─────────────────────────────

/**
 * Traza logistica: Dijkstra multi-origen desde las bases de teatro por la red de
 * comunicaciones. Las ZDC enemigas no ocupadas por unidad propia cortan la traza.
 * Las brigadas logisticas alcanzadas actuan como deposito avanzado, extendiendo
 * el alcance operacional; el limite del presupuesto es el punto culminante.
 */
export function computeSupply(game, side) {
  const W = game.W, H = game.H, N = game.N;
  const cost = new Float32Array(N).fill(Infinity);
  const zoc = game._zoc, { occ } = game._occ;
  const ez = zoc[other(side)], fz = zoc[side];
  const mySide = side === 'BLUE' ? 0 : 1;
  const S = game.sides[side];
  const interdict = 1 + S.interdictedBy * 0.9;
  const wsup = WEATHER[game.weather.type].supply;

  const pq = new MinHeap();
  for (const i of S.bases) { cost[i] = 0; pq.push(0, i); }

  const budget = S.logRange * wsup;
  const logDepots = game.units.filter(u => u.side === side && u.tpl.logBoost >= 3 && u.status !== 'destroyed');
  const usedDepot = new Set();

  const relax = () => {
    while (pq.size) {
      const cur = pq.pop();
      const d = cost[cur];
      if (d > budget) continue;
      const cc = cur % W, cr = (cur / W) | 0;
      const nb = neighbors(cc, cr);
      for (let k = 0; k < 6; k++) {
        const [nc, nr] = nb[k];
        if (nc < 0 || nr < 0 || nc >= W || nr >= H) continue;
        const j = nr * W + nc;
        const h = game.hexes[j];
        if (h.t === 'agua') continue;
        if (occ[j] >= 0 && occ[j] !== mySide) continue;             // el enemigo corta la ruta
        // Atravesar la zona de control contraria no es imposible, es caro: los
        // convoyes pasan de noche y con perdidas. Bloquearlo del todo hacia que
        // cualquier avance dejase a su propia vanguardia sin traza.
        const zocPenalty = (ez[j] && fz[j] < 2) ? 5.0 : 0;
        // El coste de la traza es el de la red: el ferrocarril es casi gratis, la
        // carretera barata y el campo a traves caro. De ahi que el alcance
        // operacional siga las lineas de comunicaciones y no un radio.
        let c = h.rail ? 0.30 : h.road >= 2 ? 0.60 : h.road === 1 ? 0.95 : TERRAIN[h.t].move * 2.4;
        // El estado del suelo encarece la traza, pero menos que la marcha: los
        // convoyes van por la red y no campo a traves.
        c *= 0.6 + 0.4 * GROUND[game.weather.ground].move;
        const src = game.hexes[cur];
        if (src.river[k] && !src.bridge[k]) c += 3.0;
        if (ez[j]) c += 1.2;                                        // presion sobre la linea de comunicaciones
        c += zocPenalty;
        c *= interdict;
        const nd = d + c;
        if (nd < cost[j]) { cost[j] = nd; pq.push(nd, j); }
      }
    }
  };
  relax();
  // depositos avanzados: reinyectan capacidad si estan enlazados
  for (let pass = 0; pass < 2; pass++) {
    let added = false;
    for (const L of logDepots) {
      const i = L.row * W + L.col;
      if (usedDepot.has(L.id)) continue;
      if (cost[i] <= budget && L.stores > 20) {
        usedDepot.add(L.id);
        const nc = Math.max(0, cost[i] - budget * 0.45 * (L.stores / 100));
        if (nc < cost[i]) { cost[i] = nc; pq.push(nc, i); added = true; }
      }
    }
    if (!added) break;
    relax();
  }

  const lvl = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    lvl[i] = isFinite(cost[i]) ? clamp(100 * (1 - cost[i] / budget), 0, 100) : 0;
  }
  return { level: lvl, cost, budget, depots: usedDepot };
}

// ───────────────────────────── deteccion / niebla ─────────────────────────────

export function computeDetection(game) {
  for (const side of SIDES) {
    const foe = other(side);
    const w = WEATHER[game.weather.type].sight * (game.time.hour >= 20 || game.time.hour < 5 ? 0.55 : 1);
    const air = game.sides[side].air.alloc.recon * game.sides[side].air.sorties / 100
      * WEATHER[game.weather.type].air;
    for (const e of game.units) {
      if (e.side !== foe || e.status === 'destroyed') continue;
      let best = 0;
      for (const u of game.units) {
        if (u.side !== side || u.status === 'destroyed') continue;
        const d = distance(u.col, u.row, e.col, e.row);
        const sight = TERRAIN[game.hexes[u.row * game.W + u.col].t].sight * u.tpl.recon * w;
        if (d <= 1) best = Math.max(best, 100);
        else if (d <= sight) best = Math.max(best, 100 * (1 - (d - 1) / Math.max(1, sight)) * 0.95);
      }
      const cover = TERRAIN[game.hexes[e.row * game.W + e.col].t].cover;
      best *= (1 - cover * 0.55);
      best += clamp(air * 26 - distance(e.col, e.row, game.sides[side].frontRefCol ?? e.col, e.row) * 0.4, 0, 45);
      e.detectedBy = e.detectedBy || {};
      const prev = e.detectedBy[side] ?? 0;
      e.detectedBy[side] = clamp(Math.max(best, prev * 0.55), 0, 100);
      if (e.detectedBy[side] > 30) { e.lastSeen = [e.col, e.row]; e.lastSeenTurn = game.turn; }
    }
  }
}

// ───────────────────────────── artilleria y aviacion ─────────────────────────────

function artillerySupport(game, side, targetHex, mission) {
  let power = 0, supp = 0, used = [];
  const cb = game.sides[side].counterBatteryPenalty || 0;
  for (const u of game.units) {
    if (u.side !== side || u.status === 'destroyed') continue;
    if (u.tpl.indRange < 2 || (u.equip.guns + u.equip.mlrs) < 4) continue;
    if (u.artyMission !== mission && !(mission === 'apoyo' && u.artyMission === 'apoyo')) continue;
    const d = distance(u.col, u.row, targetHex.col, targetHex.row);
    if (d > u.tpl.indRange) continue;
    if (u.ammo < 6) continue;
    const eff = (u.equip.guns * 1.0 + u.equip.mlrs * 2.2) / 100
      * readiness(u) * (0.6 + 0.4 * u.effort) * (1 - cb * 0.45);
    power += eff * 2.6;
    supp += eff * 16;
    const burn = 9 * u.effort;
    u.ammo = clamp(u.ammo - burn, 0, 100);
    used.push(u);
  }
  return { power, supp, used };
}

function airSupport(game, side, kind) {
  const S = game.sides[side];
  const w = WEATHER[game.weather.type].air;
  const avail = S.air.sorties * (S.air.alloc[kind] / 100) * w;
  const sup = clamp(1 + S.airSuperiority * 0.5, 0.25, 2.0);
  return avail * sup;
}

// ───────────────────────────── combate ─────────────────────────────

export function resolveAssault(game, targetIdx, attackers, log) {
  const W = game.W;
  const th = game.hexes[targetIdx];
  const defenders = game._occ.list[targetIdx] || [];
  if (!defenders.length || !attackers.length) return null;
  const dSide = defenders[0].side, aSide = attackers[0].side;
  const D = DOCTRINES[game.sides[aSide].doctrine];
  const dArmor = armorShare(defenders);
  const aArmor = armorShare(attackers);

  // ─ preparacion artillera y apoyo aereo
  const prep = artillerySupport(game, aSide, th, 'preparacion');
  const sup = artillerySupport(game, aSide, th, 'apoyo');
  const dSup = artillerySupport(game, dSide, game.hexes[attackers[0].row * W + attackers[0].col], 'apoyo');
  const cas = airSupport(game, aSide, 'cas');
  const dcas = airSupport(game, dSide, 'cas');

  for (const d of defenders) d.suppression = clamp(d.suppression + (prep.supp + sup.supp) / defenders.length * D.artyPrep + cas * 0.6, 0, 95);
  for (const a of attackers) a.suppression = clamp(a.suppression + dSup.supp / attackers.length + dcas * 0.5, 0, 95);

  // ─ potencia
  let A = 0, Dp = 0;
  const frontage = clamp(1.15 - 0.13 * (attackers.length - 1), 0.55, 1.15); // saturacion del frente de ataque
  for (const a of attackers) A += combatPower(a, game, 'attack', { armorShare: dArmor });
  A *= frontage;
  A += (prep.power * D.artyPrep + sup.power) * 0.75 + cas * 0.9;

  for (const d of defenders) Dp += combatPower(d, game, 'defend', { armorShare: aArmor });
  Dp += dSup.power * 0.6 + dcas * 0.7;

  // ─ apoyo de flancos: hexagonos contiguos al defensor en manos propias
  let flank = 0;
  for (const [c, r] of neighbors(th.col, th.row)) {
    if (c < 0 || r < 0 || c >= game.W || r >= game.H) continue;
    const j = r * game.W + c;
    const o = game._occ.occ[j];
    if (o >= 0) flank += (SIDES[o] === dSide ? 1 : -1);
  }
  Dp *= clamp(1 + flank * 0.045, 0.70, 1.25);

  // ─ paso de curso de agua contra la posicion
  let river = false;
  for (const a of attackers) {
    const nb = neighbors(a.col, a.row);
    for (let d = 0; d < 6; d++) {
      if (nb[d][0] === th.col && nb[d][1] === th.row) {
        const ah = game.hexes[a.row * W + a.col];
        if (ah.river[d] && !ah.bridge[d]) river = true;
      }
    }
  }
  if (river) {
    const eng = attackers.reduce((s, a) => s + a.tpl.engineer, 0);
    A *= clamp(0.42 + eng * 0.12, 0.42, 0.92);
  }

  // ─ sorpresa: defensor no detectado o sin CG
  const detected = defenders.reduce((s, d) => s + (d.detectedBy?.[aSide] ?? 0), 0) / defenders.length;
  if (detected < 45) A *= 1.12;
  if (!defenders.some(d => inCommand(d, game))) Dp *= 0.85;

  const ratio = A / Math.max(0.001, Dp);

  // ─ probabilidad de exito: sigmoide sobre la relacion de fuerzas.
  //   Con k=1.7, 1:1 -> 50 %, 2:1 -> 76 %, 3:1 -> 87 %, 5:1 -> 96 %.
  const k = 1.7;
  const p = Math.pow(ratio, k) / (Math.pow(ratio, k) + 1);
  const roll = game.rng();
  const success = roll < p;

  // ─ bajas. La intensidad la fija el esfuerzo ordenado y la postura.
  const inten = attackers.reduce((s, a) => s + a.effort * POSTURES[a.posture].cas, 0) / attackers.length;
  const ammoF = attackers.reduce((s, a) => s + Math.min(1, a.ammo / 60), 0) / attackers.length;
  const terrDef = TERRAIN[th.t].def;
  const entr = 1 + (defenders.reduce((s, d) => s + d.entrench, 0) / defenders.length) * 0.13;

  let defRate = 0.021 * inten * ammoF * Math.pow(clamp(ratio, 0.2, 6), 0.55) / (terrDef * entr);
  let atkRate = 0.019 * inten * Math.pow(clamp(1 / ratio, 0.2, 6), 0.5) * terrDef * entr * 0.55;
  if (river) atkRate *= 1.45;
  defRate = clamp(defRate * game.rng.range(0.75, 1.3), 0.001, 0.16);
  atkRate = clamp(atkRate * game.rng.range(0.75, 1.3), 0.001, 0.14);

  // ─ hexagono de retirada: la clave del cerco
  const escape = retreatHex(game, defenders[0], attackers);
  const trapped = !escape;
  if (trapped) { defRate *= 2.0; }

  const rep = { targetIdx, aSide, dSide, ratio, p, success, river, trapped, attackers: [], defenders: [], hexName: th.city ? th.city.name : `${th.col},${th.row}` };

  for (const d of defenders) {
    const c = applyCasualties(d, defRate * game.rng.range(0.85, 1.15), game);
    d.suppression = clamp(d.suppression + 22 * inten, 0, 95);
    d.fatigue = clamp(d.fatigue + 7 * inten, 0, 100);
    d.ammo = clamp(d.ammo - 11 * d.effort, 0, 100);
    d.engagedTurn = game.turn;
    rep.defenders.push({ id: d.id, name: d.name, cas: c });
  }
  for (const a of attackers) {
    const c = applyCasualties(a, atkRate * game.rng.range(0.85, 1.15), game);
    a.fatigue = clamp(a.fatigue + 11 * inten, 0, 100);
    a.ammo = clamp(a.ammo - 15 * a.effort, 0, 100);
    a.fuel = clamp(a.fuel - 5 * a.effort, 0, 100);
    a.engagedTurn = game.turn;
    rep.attackers.push({ id: a.id, name: a.name, cas: c });
  }

  const dCas = rep.defenders.reduce((s, x) => s + x.cas, 0);
  const aCas = rep.attackers.reduce((s, x) => s + x.cas, 0);
  game.sides[dSide].casualties.total += dCas;
  game.sides[aSide].casualties.total += aCas;

  // ─ efecto moral
  for (const d of defenders) {
    d.morale = clamp(d.morale - (success ? 9 : 2) - defRate * 120, 0, 100);
    d.cohesion = clamp(d.cohesion - defRate * 90 - (trapped ? 6 : 0), 0, 100);
  }
  for (const a of attackers) {
    a.morale = clamp(a.morale + (success ? 4 : -6) - atkRate * 90, 0, 100);
    a.cohesion = clamp(a.cohesion - atkRate * 70, 0, 100);
  }

  if (success) {
    for (const d of defenders) {
      d.entrench = Math.max(0, d.entrench - 1.5);
      if (escape) {
        moveUnitTo(game, d, escape[0], escape[1]);
        d.status = d.morale < 22 || d.cohesion < 22 ? 'routed' : 'ok';
      } else {
        d.morale = clamp(d.morale - 16, 0, 100);
        d.status = 'trapped';
      }
    }
    rebuildOcc(game);
    // ocupacion del objetivo por el asaltante mejor situado
    if (!(game._occ.list[targetIdx] || []).length) {
      const winner = attackers.filter(a => a.status === 'ok')
        .sort((x, y) => (y.personnel / y.personnelMax) - (x.personnel / x.personnelMax))[0];
      if (winner && winner.mpLeft > 0.5) {
        moveUnitTo(game, winner, th.col, th.row);
        winner.entrench = 0;
        rebuildOcc(game);
        rep.captured = true;
      }
    }
  } else {
    for (const a of attackers) {
      a.morale = clamp(a.morale - 3, 0, 100);
      if (a.morale < a.roeMorale) a.posture = 'defensa';
    }
  }
  log.push(rep);
  return rep;
}

/** Baja aplicada a personal y material; devuelve bajas de personal. */
export function applyCasualties(u, rate, game) {
  const loss = Math.round(u.personnel * rate);
  u.personnel = Math.max(0, u.personnel - loss);
  u.casualtiesTotal += loss;
  const eq = rate * game.rng.range(0.7, 1.4);
  for (const k of ['tanks', 'ifv', 'apc', 'guns', 'mlrs', 'atgm', 'aa']) {
    u.equip[k] = Math.max(0, Math.round(u.equip[k] * (1 - eq)));
  }
  if (u.personnel / u.personnelMax < 0.12) u.status = 'destroyed';
  return loss;
}

/** Busca hexagono de repliegue: alejandose del atacante, sin ZDC enemiga si es posible. */
export function retreatHex(game, u, attackers) {
  const W = game.W, H = game.H;
  const ez = game._zoc[other(u.side)];
  const { occ } = game._occ;
  const mySide = u.side === 'BLUE' ? 0 : 1;
  let best = null, bestScore = -1e9;
  const ax = attackers.reduce((s, a) => s + a.col, 0) / attackers.length;
  const ay = attackers.reduce((s, a) => s + a.row, 0) / attackers.length;
  const nb = neighbors(u.col, u.row);
  for (let d = 0; d < 6; d++) {
    const [c, r] = nb[d];
    if (c < 0 || r < 0 || c >= W || r >= H) continue;
    const j = r * W + c, h = game.hexes[j];
    if (h.t === 'agua') continue;
    if (occ[j] >= 0 && occ[j] !== mySide) continue;
    if ((game._occ.list[j] || []).length >= 2) continue;
    const src = game.hexes[u.row * W + u.col];
    if (src.river[d] && !src.bridge[d]) continue;
    let s = (Math.hypot(c - ax, r - ay) - Math.hypot(u.col - ax, u.row - ay)) * 10;
    s -= ez[j] * 6;
    s += (game._supply[u.side] ? game._supply[u.side].level[j] : 0) * 0.08;
    s += TERRAIN[h.t].def * 3;
    if (s > bestScore) { bestScore = s; best = [c, r]; }
  }
  return best;
}

export function moveUnitTo(game, u, col, row) {
  u.trail.push([u.col, u.row, game.turn]);
  if (u.trail.length > 24) u.trail.shift();
  u.col = col; u.row = row;
}

export function rebuildOcc(game) { game._occ = occupancy(game); }

// ───────────────────────────── secuencia de turno ─────────────────────────────

export function advanceClock(game) {
  game.time.hour += 6;
  if (game.time.hour >= 24) { game.time.hour -= 24; game.time.day++; }
  // meteorologia: cadena de Markov sencilla con inercia estacional
  if (game.rng() < 0.34) {
    const opts = game.season === 'invierno'
      ? ['nieve', 'nublado', 'niebla', 'tormenta', 'despejado']
      : ['despejado', 'nublado', 'lluvia', 'niebla', 'tormenta'];
    game.weather.type = game.rng.pick(opts);
  }
  const wet = ['lluvia', 'tormenta', 'nieve'].includes(game.weather.type);
  if (wet && game.rng() < 0.5) game.weather.ground = game.weather.ground === 'firme' ? 'humedo' : 'barro';
  else if (!wet && game.rng() < 0.35) game.weather.ground = game.weather.ground === 'barro' ? 'humedo' : 'firme';
  if (game.season === 'invierno' && game.rng() < 0.3) game.weather.ground = 'helado';
}

function airPhase(game) {
  for (const side of SIDES) {
    const S = game.sides[side];
    const w = WEATHER[game.weather.type].air;
    S.air.sorties = clamp(S.air.capacity * (0.6 + 0.4 * (S.air.readiness / 100)), 0, 999);
    S._cap = S.air.sorties * (S.air.alloc.cap / 100) * w * (1 + S.air.quality * 0.25);
  }
  const b = game.sides.BLUE._cap, r = game.sides.RED._cap;
  // dominio del aire = ventaja relativa, atenuada por la defensa antiaerea de tierra
  const aaB = game.units.filter(u => u.side === 'BLUE').reduce((s, u) => s + u.equip.aa, 0) / 600;
  const aaR = game.units.filter(u => u.side === 'RED').reduce((s, u) => s + u.equip.aa, 0) / 600;
  const sB = (b + aaB) - (r + aaR), tot = Math.max(1, b + r + aaB + aaR);
  game.sides.BLUE.airSuperiority = clamp(sB / tot * 2, -1, 1);
  game.sides.RED.airSuperiority = -game.sides.BLUE.airSuperiority;

  for (const side of SIDES) {
    const S = game.sides[side], F = game.sides[other(side)];
    const inter = airSupport(game, side, 'interdiction');
    F.interdictedBy = clamp(inter / 55, 0, 1.4);
    S.counterBatteryPenalty = 0;
  }
  // contrabateria
  for (const side of SIDES) {
    let cb = 0;
    for (const u of game.units) {
      if (u.side !== side || u.status === 'destroyed') continue;
      if (u.artyMission === 'contrabateria' && (u.equip.guns + u.equip.mlrs) > 4 && u.ammo > 10) {
        cb += (u.equip.guns + u.equip.mlrs * 2) / 100 * readiness(u);
        u.ammo = clamp(u.ammo - 7 * u.effort, 0, 100);
      }
    }
    game.sides[other(side)].counterBatteryPenalty = clamp(cb / 6, 0, 0.8);
  }
}

function interdictionPhase(game) {
  for (const side of SIDES) {
    for (const u of game.units) {
      if (u.side !== side || u.status === 'destroyed') continue;
      if (u.artyMission !== 'interdiccion' || u.ammo < 8) continue;
      for (const e of game.units) {
        if (e.side === side || e.status === 'destroyed') continue;
        if (distance(u.col, u.row, e.col, e.row) > u.tpl.indRange) continue;
        if ((e.detectedBy?.[side] ?? 0) < 35) continue;
        const f = (u.equip.guns + u.equip.mlrs * 2) / 140 * readiness(u) * u.effort;
        e.suppression = clamp(e.suppression + f * 22, 0, 95);
        applyCasualties(e, clamp(f * 0.004, 0, 0.01), game);
      }
      u.ammo = clamp(u.ammo - 8 * u.effort, 0, 100);
    }
  }
}

function movementPhase(game, events) {
  const order = [...game.units].filter(u => u.status !== 'destroyed');
  order.sort((a, b) => maxMP(b, game) - maxMP(a, game));
  for (const u of order) {
    u.mpLeft = maxMP(u, game);
    u.movedThisTurn = 0;
  }
  for (const u of order) {
    if (u.status === 'trapped') u.status = 'ok';
    if (!u.order || (u.order.type !== 'move' && u.order.type !== 'attack' && u.order.type !== 'withdraw')) continue;
    if (u.order.activeTurn > game.turn) continue;
    let guard = 0;
    // La ruta se calcula una vez por turno y se sigue; solo se replantea si el
    // paso siguiente ha dejado de ser transitable.
    let path = findPath(game, u, u.order.col, u.order.row, game._zoc);
    while (u.mpLeft > 0.3 && guard++ < 40) {
      if (!path || !path.length) break;
      const next = path[0];
      const nc = next % game.W, nr = (next / game.W) | 0;
      let dir = -1;
      const nb = neighbors(u.col, u.row);
      for (let d = 0; d < 6; d++) if (nb[d][0] === nc && nb[d][1] === nr) dir = d;
      if (dir < 0) break;
      const stack = game._occ.list[next] || [];
      if (stack.length && stack[0].side !== u.side) break;              // hay que combatir, no marchar
      if (stack.length >= 2) {                                          // limite de apilamiento: rodear
        path = findPath(game, u, u.order.col, u.order.row, game._zoc);
        if (!path || !path.length || path[0] === next) break;
        continue;
      }
      const c = moveCost(game, u.row * game.W + u.col, next, dir, u);
      if (!isFinite(c) || c > u.mpLeft + 0.001) break;
      const inEZ = game._zoc[other(u.side)][u.row * game.W + u.col];
      moveUnitTo(game, u, nc, nr);
      path.shift();
      u.mpLeft -= c;
      u.movedThisTurn++;
      u.fuel = clamp(u.fuel - c * 1.5 * POSTURES[u.posture].fuel, 0, 100);
      u.fatigue = clamp(u.fatigue + c * 1.1, 0, 100);
      u.entrench = Math.max(0, u.entrench - 1.2);
      rebuildOcc(game);
      if (game._zoc[other(u.side)][next]) { u.mpLeft = Math.min(u.mpLeft, 0); } // detenerse en ZDC
      if (inEZ && !game._zoc[other(u.side)][next]) u.mpLeft = Math.min(u.mpLeft, 0);
      if (u.col === u.order.col && u.row === u.order.row) { break; }
    }
    if (u.col === u.order.col && u.row === u.order.row && u.order.type === 'move') {
      events.push({ t: 'arrive', u: u.id, txt: `${u.name} alcanza su objetivo.` });
      u.order = null;
    }
  }
}

function combatPhase(game, events) {
  const groups = new Map();
  for (const u of game.units) {
    if (u.status === 'destroyed' || !u.order || u.order.type !== 'attack') continue;
    if (u.order.activeTurn > game.turn) continue;
    if (u.suppression > 80) continue;
    const ti = u.order.row * game.W + u.order.col;
    if (distance(u.col, u.row, u.order.col, u.order.row) !== 1) continue;
    const def = game._occ.list[ti] || [];
    if (!def.length || def[0].side === u.side) continue;
    if (!groups.has(ti)) groups.set(ti, []);
    groups.get(ti).push(u);
  }
  const reports = [];
  for (const [ti, atk] of groups) resolveAssault(game, ti, atk, reports);
  for (const r of reports) {
    const dc = r.defenders.reduce((s, x) => s + x.cas, 0);
    const ac = r.attackers.reduce((s, x) => s + x.cas, 0);
    events.push({
      t: 'combat', side: r.aSide,
      txt: `${r.hexName}: ataque ${r.aSide === 'BLUE' ? 'azul' : 'rojo'} ${r.ratio.toFixed(2)}:1 — ` +
        `${r.success ? (r.captured ? 'posición tomada' : 'defensor desalojado') : 'rechazado'}` +
        `${r.trapped ? ' · DEFENSOR SIN VÍA DE REPLIEGUE' : ''}. ` +
        `Bajas ${ac.toLocaleString('es')} / ${dc.toLocaleString('es')}.`,
      report: r,
    });
  }
  return reports;
}

function exploitationPhase(game, reports, events) {
  for (const r of reports) {
    if (!r.success || !r.captured) continue;
    const D = DOCTRINES[game.sides[r.aSide].doctrine];
    for (const a of game.units) {
      if (a.side !== r.aSide || a.status === 'destroyed') continue;
      if (a.posture !== 'avance' && a.posture !== 'reserva') continue;
      if (distance(a.col, a.row, r.targetIdx % game.W, (r.targetIdx / game.W) | 0) > 2) continue;
      if (a.tpl.exploit < 1.1 || a.fuel < 25) continue;
      const bonus = a.tpl.exploit * D.exploit * 3.2;
      a.mpLeft = Math.max(a.mpLeft, bonus);
      if (a.order && a.order.type === 'move') {
        events.push({ t: 'exploit', txt: `${a.name} pasa a explotación tras la ruptura en ${r.hexName}.` });
      }
    }
  }
}

function supplyPhase(game, events) {
  for (const side of SIDES) game._supply[side] = computeSupply(game, side);
  for (const u of game.units) {
    if (u.status === 'destroyed') continue;
    const i = u.row * game.W + u.col;
    const sl = game._supply[u.side].level[i];
    u.supplyLevel = sl;
    const S = game.sides[u.side];
    const prio = [0.6, 1.0, 1.5][u.logPriority] || 1;
    const share = clamp(S.stockpile / Math.max(1, S.demand), 0, 1);
    if (sl > 0.5) {
      u.isolatedTurns = 0;
      const rate = (sl / 100) * prio * share;
      u.stores = clamp(u.stores + 22 * rate, 0, 100);
      u.ammo = clamp(u.ammo + 17 * rate * (u.stores / 100 + 0.2), 0, 100);
      u.fuel = clamp(u.fuel + 21 * rate * (u.stores / 100 + 0.2), 0, 100);
      S.stockpile -= 3.5 * rate;
    } else {
      u.isolatedTurns++;
      const burn = 9 + 5 * u.effort;
      u.stores = clamp(u.stores - burn, 0, 100);
      if (u.stores <= 0) {
        u.ammo = clamp(u.ammo - 17, 0, 100);
        u.fuel = clamp(u.fuel - 21, 0, 100);
        u.morale = clamp(u.morale - 7 - u.isolatedTurns * 0.9, 0, 100);
        u.cohesion = clamp(u.cohesion - 4, 0, 100);
      }
      if (u.fuel <= 0) {   // material pesado abandonado por falta de combustible
        for (const k of ['tanks', 'ifv', 'apc']) u.equip[k] = Math.round(u.equip[k] * 0.86);
      }
    }
  }
  for (const side of SIDES) {
    const S = game.sides[side];
    S.demand = game.units.filter(u => u.side === side && u.status !== 'destroyed').length * 3.5;
    S.stockpile = clamp(S.stockpile + S.production, 0, S.stockpileMax);
  }
}

function moralePhase(game, events) {
  for (const u of game.units) {
    if (u.status === 'destroyed') continue;
    const rest = game.turn - u.engagedTurn > 1;
    const P = POSTURES[u.posture];
    u.suppression = clamp(u.suppression - 26, 0, 95);
    u.fatigue = clamp(u.fatigue + P.fatigue * 1.4 - (rest ? 9 : 2), 0, 100);
    const supOK = u.supplyLevel > 25;
    if (rest && supOK) {
      u.morale = clamp(u.morale + 3.2 + (u.posture === 'reserva' ? 2.4 : 0), 0, 100);
      u.cohesion = clamp(u.cohesion + 2.6, 0, 100);
    }
    if (!supOK) u.morale = clamp(u.morale - 2.5, 0, 100);
    // atrincheramiento
    if (u.digIn && u.movedThisTurn === 0) {
      const h = game.hexes[u.row * game.W + u.col];
      const max = TERRAIN[h.t].entrenchMax;
      let rate = u.tpl.entrenchRate * P.entrench * 0.55;
      for (const e of game.units) {
        if (e.side === u.side && e.tpl.engineer >= 2 && distance(e.col, e.row, u.col, u.row) <= 2) rate *= 1.8;
      }
      if (GROUND[game.weather.ground].name === 'Helado') rate *= 0.5;
      u.entrench = clamp(u.entrench + rate, 0, max);
    } else if (u.movedThisTurn > 0) {
      u.entrench = Math.max(0, u.entrench - 0.8);
    }
    // reemplazos
    const S = game.sides[u.side];
    if (rest && supOK && u.personnel < u.personnelMax && S.replacements > 0) {
      const want = Math.round(Math.min((u.personnelMax - u.personnel) * 0.16, S.replacements, u.personnelMax * 0.05));
      u.personnel += want; S.replacements -= want;
      for (const k of ['tanks', 'ifv', 'apc', 'guns', 'mlrs', 'atgm', 'aa']) {
        if (u.equip[k] < u.equipMax[k]) u.equip[k] = Math.min(u.equipMax[k], u.equip[k] + Math.ceil(u.equipMax[k] * 0.05));
      }
      u.cohesion = clamp(u.cohesion - 0.6, 0, 100);   // integrar reemplazos cuesta cohesion
    }
    // desbandada y recuperacion
    if (u.status === 'routed' && u.morale > 35 && rest) u.status = 'ok';
    if (u.morale < 12 && u.cohesion < 20 && u.status !== 'routed') {
      u.status = 'routed';
      events.push({ t: 'rout', side: u.side, txt: `${u.name} se desbanda: cohesión perdida.` });
    }
    // capitulacion en bolsa
    if (u.isolatedTurns >= 4 && u.stores <= 0 && u.morale < 22 && u.ammo <= 5) {
      const pow = u.personnel;
      u.status = 'destroyed'; u.personnel = 0;
      game.sides[u.side].casualties.pow += pow;
      game.sides[u.side].casualties.total += pow;
      events.push({ t: 'surrender', side: u.side, big: true, txt: `${u.name} capitula en la bolsa: ${pow.toLocaleString('es')} prisioneros.` });
    }
    if (u.status === 'destroyed' && u.personnel > 0) {
      events.push({ t: 'destroyed', side: u.side, big: true, txt: `${u.name} destruida como unidad de combate.` });
      u.personnel = 0;
    }
  }
  game.units = game.units.filter(u => !(u.status === 'destroyed' && u.personnel === 0 && u._reaped)) ;
  for (const u of game.units) if (u.status === 'destroyed') u._reaped = true;
}

// El retardo se fija en el momento de cursar la orden (ver orders.js). Aqui solo
// se comprueba si la orden en transito ya ha llegado a la unidad.
function c2Phase(game) {
  for (const u of game.units) {
    if (!u.pending) continue;
    if (game.turn >= u.pending.activeTurn) { u.order = u.pending; u.pending = null; }
  }
}

/** Ejecuta un turno completo y devuelve la lista de sucesos. */
export function runTurn(game, aiFn) {
  const events = [];
  game.turn++;
  advanceClock(game);
  rebuildOcc(game);
  game._zoc = computeZOC(game);
  for (const s of SIDES) game._supply[s] = computeSupply(game, s);
  computeDetection(game);

  c2Phase(game);
  if (aiFn) aiFn(game, events);

  airPhase(game);
  interdictionPhase(game);

  rebuildOcc(game); game._zoc = computeZOC(game);
  movementPhase(game, events);

  rebuildOcc(game); game._zoc = computeZOC(game);
  const reports = combatPhase(game, events);

  rebuildOcc(game); game._zoc = computeZOC(game);
  exploitationPhase(game, reports, events);
  movementPhase(game, events);

  rebuildOcc(game); game._zoc = computeZOC(game);
  supplyPhase(game, events);
  moralePhase(game, events);
  computeDetection(game);

  rebuildOcc(game); game._zoc = computeZOC(game);
  for (const s of SIDES) game._supply[s] = computeSupply(game, s);

  // objetivos: control de nucleos con valor
  for (const s of SIDES) game.sides[s].vp = 0;
  for (const h of game.hexes) {
    if (!h.vp) continue;
    const st = game._occ.occ[h.i];
    if (st >= 0) h.owner = SIDES[st];
    if (h.owner) game.sides[h.owner].vp += h.vp;
  }
  return { events, reports };
}

export { clamp };
