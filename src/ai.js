// Mando enemigo automatico.
//
// No juega hexagono a hexagono: razona en terminos operacionales. Cada turno
// evalua la relacion de fuerzas, elige uno o dos Schwerpunkt donde la densidad
// defensiva contraria es minima, destina reservas moviles a la explotacion,
// intenta cortar por la base los salientes vulnerables del adversario (es decir,
// forma pinzas), tapona sus propias brechas y ordena la ruptura del cerco a las
// unidades embolsadas.
import { neighbors, distance, disc, lineHexes, HEX_KM } from './hex.js';
import { TERRAIN } from './terrain.js';
import { SIDES, other, projectsZOC, readiness, rawPower } from './sim.js';
import { issueOrder } from './orders.js';

const sideIdx = (s) => (s === 'BLUE' ? 0 : 1);

export function aiTurn(game, events, side) {
  const S = game.sides[side];
  if (!S.ai) return;
  const foe = other(side);
  const A = game.analysis;
  if (!A) return;

  const mine = game.units.filter(u => u.side === side && u.status !== 'destroyed');
  const theirs = game.units.filter(u => u.side === foe && u.status !== 'destroyed');
  const myPower = mine.reduce((s, u) => s + rawPower(u) * readiness(u), 0);
  const foePower = theirs.reduce((s, u) => s + rawPower(u) * readiness(u), 0);
  const ratio = myPower / Math.max(1, foePower);

  S.plan = S.plan || {};
  // Punto culminante: si buena parte del despliegue esta por debajo del 25 % de
  // traza, la ofensiva se detiene y se consolida. Seguir empujando con la
  // logistica rota es la forma mas rapida de perder un ejercito entero.
  const sinTraza = mine.filter(u => projectsZOC(u) && u.supplyLevel < 25).length;
  const culminado = mine.length ? sinTraza / mine.length > 0.28 : false;
  const wantOffense = ratio > 0.95 && S.aggression > 0.35 && !culminado;
  S.plan.mode = culminado ? 'contencion'
    : wantOffense ? 'ofensiva' : (ratio < 0.6 ? 'defensiva' : 'contencion');
  S.plan.culminado = culminado;
  if (culminado) {
    events.push({ t: 'ai', side, quiet: true,
      txt: `Mando ${side === 'RED' ? 'rojo' : 'azul'}: pausa operacional, la ofensiva ha culminado.` });
    for (const u of mine) {
      if (u.supplyLevel < 25 && projectsZOC(u)) { u.posture = 'defensa'; u.effort = 0.5; u.logPriority = 2; }
    }
  }

  // ── aviacion y logistica ─────────────────────────────────────────────
  if (S.plan.mode === 'ofensiva') S.air.alloc = { cap: 30, cas: 40, interdiction: 20, recon: 10 };
  else if (S.plan.mode === 'defensiva') S.air.alloc = { cap: 40, cas: 20, interdiction: 25, recon: 15 };
  else S.air.alloc = { cap: 35, cas: 25, interdiction: 25, recon: 15 };

  const busy = new Set();

  /**
   * Fuerza de cobertura: una unidad en contacto que es la unica propia en su
   * sector no se mueve. Concentrar para el Schwerpunkt es correcto; vaciar el
   * frente para conseguirlo es como se regala la ofensiva del contrario.
   */
  const covering = new Set();
  for (const u of mine) {
    if (!projectsZOC(u)) continue;
    const contacto = neighbors(u.col, u.row).some(([c, r]) =>
      c >= 0 && r >= 0 && c < game.W && r < game.H && A.owner[r * game.W + c] === sideIdx(foe));
    if (!contacto) continue;
    const vecinos = mine.filter(o => o !== u && projectsZOC(o)
      && distance(o.col, o.row, u.col, u.row) <= 2).length;
    if (vecinos === 0) covering.add(u.id);
  }
  const libre = (u) => !busy.has(u.id) && !covering.has(u.id);

  // ── 1. romper cercos propios ─────────────────────────────────────────
  for (const p of A.sides[side].pockets) {
    const target = nearestFriendlyFront(game, side, p.centroid, A.owner);
    for (const id of p.units) {
      const u = game.byId[id]; if (!u) continue;
      u.posture = u.ammo > 25 ? 'ataque' : 'retirada';
      u.effort = 1.0; u.logPriority = 2;
      if (target) issueOrder(game, u, { type: 'move', col: target[0], row: target[1] });
      busy.add(u.id);
    }
    // socorro desde fuera
    const relief = mine.filter(u => libre(u) && u.tpl.exploit > 1.0
      && distance(u.col, u.row, Math.round(p.centroid[0]), Math.round(p.centroid[1])) < 10)
      .slice(0, 2);
    for (const u of relief) {
      u.posture = 'ataque'; u.effort = 0.95;
      issueOrder(game, u, { type: 'move', col: Math.round(p.centroid[0]), row: Math.round(p.centroid[1]) });
      busy.add(u.id);
    }
  }

  // ── 2. cortar salientes enemigos vulnerables (formar la pinza) ───────
  const targetsSal = A.sides[foe].salients.filter(s => s.vulnerable && s.men > 12000).slice(0, 2);
  for (const sal of targetsSal) {
    const necks = sal.base.map(i => [i % game.W, (i / game.W) | 0]);
    if (!necks.length) continue;
    // dos puntos de aplicacion a ambos lados del cuello
    necks.sort((a, b) => a[1] - b[1]);
    const shoulders = [necks[0], necks[necks.length - 1]];
    for (const sh of shoulders) {
      const force = mine.filter(u => !busy.has(u.id) && projectsZOC(u) && u.morale > 45
        && distance(u.col, u.row, sh[0], sh[1]) <= 7)
        .sort((a, b) => distance(a.col, a.row, sh[0], sh[1]) - distance(b.col, b.row, sh[0], sh[1]))
        .slice(0, 3);
      for (const u of force) {
        u.posture = u.tpl.exploit > 1.2 ? 'ataque' : 'asalto';
        u.effort = 0.95; u.logPriority = 2;
        orderAdvance(game, u, sh[0], sh[1], side, covering.has(u.id));
        busy.add(u.id);
      }
    }
    if (targetsSal.length) {
      events.push({ t: 'ai', side, quiet: true, txt: `Mando ${side === 'RED' ? 'rojo' : 'azul'}: maniobra de tenaza contra el saliente de ${Math.round(sal.depthKm)} km.` });
    }
  }

  // ── 3. cerrar pinzas propias ya iniciadas ────────────────────────────
  for (const p of A.sides[side].pincers.slice(0, 1)) {
    if (p.trappedMen < 8000) continue;
    const mid = p.closureLine[Math.floor(p.closureLine.length / 2)];
    const force = mine.filter(u => !busy.has(u.id) && projectsZOC(u)
      && distance(u.col, u.row, mid[0], mid[1]) <= 8)
      .sort((a, b) => b.tpl.exploit - a.tpl.exploit).slice(0, 4);
    for (const u of force) {
      u.posture = 'ataque'; u.effort = 1.0; u.logPriority = 2;
      orderAdvance(game, u, mid[0], mid[1], side, covering.has(u.id));
      busy.add(u.id);
    }
  }

  // ── 4. Schwerpunkt ofensivo ──────────────────────────────────────────
  if (S.plan.mode === 'ofensiva') {
    const axes = pickAxes(game, side, A, 2);
    for (const ax of axes) {
      const pool = mine.filter(u => !busy.has(u.id) && projectsZOC(u) && u.tpl.cmdRadius === 0
        && distance(u.col, u.row, ax.col, ax.row) <= 14 && u.morale > 40 && u.supplyLevel > 40)
        .sort((a, b) => distance(a.col, a.row, ax.col, ax.row) - distance(b.col, b.row, ax.col, ax.row));
      const echelon1 = pool.filter(u => u.tpl.exploit < 1.25).slice(0, 5);
      const echelon2 = pool.filter(u => u.tpl.exploit >= 1.25).slice(0, 4);
      for (const u of echelon1) {
        const d = distance(u.col, u.row, ax.col, ax.row);
        // lejos del contacto se marcha; en contacto se asalta
        u.posture = d <= 1 ? 'asalto' : d <= 3 ? 'ataque' : 'avance';
        u.effort = 0.9; u.logPriority = 2;
        orderAdvance(game, u, ax.col, ax.row, side, covering.has(u.id));
        busy.add(u.id);
      }
      // El segundo escalon solo se lanza a la profundidad cuando el eje ya esta
      // en nuestras manos. Mandarlo antes de la ruptura es como se pierden las
      // divisiones acorazadas: entran en un hueco que no existe y quedan sin traza.
      const roto = A.owner[ax.i] === sideIdx(side);
      for (const u of echelon2) {
        u.posture = 'avance'; u.effort = 0.85; u.logPriority = 2;
        const obj = roto ? deepObjective(game, side, ax, A.owner) : [ax.col, ax.row];
        orderAdvance(game, u, obj[0], obj[1], side, covering.has(u.id));
        busy.add(u.id);
      }
      // artilleria: preparacion sobre el eje
      const guns = mine.filter(u => !busy.has(u.id) && u.tpl.indRange >= 2 && (u.equip.guns + u.equip.mlrs) > 10);
      for (const g of guns) {
        const d = distance(g.col, g.row, ax.col, ax.row);
        if (d <= g.tpl.indRange) { g.artyMission = 'preparacion'; g.effort = 0.95; busy.add(g.id); }
        else if (d <= g.tpl.indRange + 6) {
          issueOrder(game, g, { type: 'move', col: ax.col, row: ax.row });
          g.artyMission = 'preparacion'; busy.add(g.id);
        }
      }
    }
  }

  // ── 5. taponar brechas propias ───────────────────────────────────────
  for (const br of A.sides[side].breaches.slice(0, 3)) {
    const [bc, br0] = br.centroid.map(Math.round);
    const res = mine.filter(u => libre(u) && projectsZOC(u) && u.posture === 'reserva')
      .sort((a, b) => distance(a.col, a.row, bc, br0) - distance(b.col, b.row, bc, br0))[0];
    if (res) {
      res.posture = 'defensa'; res.effort = 0.7;
      issueOrder(game, res, { type: 'move', col: bc, row: br0 });
      busy.add(res.id);
      events.push({ t: 'ai', side, quiet: true, txt: `Reserva ${side === 'RED' ? 'roja' : 'azul'} desplazada a la brecha de ${br.widthKm} km.` });
    }
  }

  // ── 6. resto del dispositivo: defensa y ataque de oportunidad ───────
  for (const u of mine) {
    if (busy.has(u.id)) continue;
    if (u.tpl.cmdRadius > 0) { keepHQBehindFront(game, u, A.owner); continue; }
    if (u.tpl.logBoost >= 3) { keepLogisticsForward(game, u, A.owner); continue; }
    if (u.tpl.indRange >= 2 && (u.equip.guns + u.equip.mlrs) > 10) {
      u.artyMission = S.plan.mode === 'defensiva' ? 'apoyo'
        : (game.rng() < 0.3 ? 'contrabateria' : 'apoyo');
      const near = theirs.filter(e => distance(e.col, e.row, u.col, u.row) <= u.tpl.indRange).length;
      if (near === 0) {
        const t = nearestEnemy(game, u, theirs);
        if (t) issueOrder(game, u, { type: 'move', col: t.col, row: t.row });
      }
      continue;
    }
    // ataque de oportunidad contra vecinos debiles
    let best = null, bestScore = 0;
    for (const [c, r] of neighbors(u.col, u.row)) {
      if (c < 0 || r < 0 || c >= game.W || r >= game.H) continue;
      const st = game._occ.list[r * game.W + c];
      if (!st || !st.length || st[0].side === side) continue;
      const dPow = st.reduce((s, e) => s + rawPower(e) * readiness(e) * TERRAIN[game.hexes[r * game.W + c].t].def * (1 + e.entrench * 0.16), 0);
      const aPow = rawPower(u) * readiness(u);
      const sc = aPow / Math.max(0.01, dPow);
      if (sc > bestScore) { bestScore = sc; best = [c, r]; }
    }
    if (best && bestScore > 1.30 && u.ammo > 35 && S.aggression > 0.3) {
      u.posture = 'ataque'; u.effort = 0.85;
      issueOrder(game, u, { type: 'attack', col: best[0], row: best[1] });
    } else {
      if (u.posture === 'ataque' || u.posture === 'asalto') u.posture = 'defensa';
      if (u.morale < 35 || u.supplyLevel < 12) u.posture = 'fortificada';
      u.effort = 0.55;
      u.order = null;
    }
  }
}

/** Elige puntos de ruptura: minima densidad defensiva, buen terreno, objetivo con valor. */
function pickAxes(game, side, A, n) {
  const foe = other(side), fi = sideIdx(foe), si = sideIdx(side);
  const cand = [];
  for (let i = 0; i < game.N; i++) {
    if (A.owner[i] !== fi) continue;
    const c = i % game.W, r = (i / game.W) | 0;
    // debe estar en contacto con nuestro dispositivo
    if (!neighbors(c, r).some(([cc, rr]) => cc >= 0 && rr >= 0 && cc < game.W && rr < game.H && A.owner[rr * game.W + cc] === si)) continue;
    const h = game.hexes[i];
    if (h.t === 'agua' || h.t === 'montana') continue;
    let def = 0;
    for (const e of game.units) {
      if (e.side !== foe || e.status === 'destroyed') continue;
      const d = distance(e.col, e.row, c, r);
      if (d <= 3) def += rawPower(e) * readiness(e) / (1 + d * d);
    }
    let own = 0;
    for (const u of game.units) {
      if (u.side !== side || u.status === 'destroyed') continue;
      const d = distance(u.col, u.row, c, r);
      if (d <= 6) own += rawPower(u) * readiness(u) / (1 + d);
    }
    let valor = h.vp * 1.5 + (h.road ? 3 : 0) + (h.rail ? 4 : 0);
    // premiar los ejes que amenazan la retaguardia enemiga
    const depth = side === 'BLUE' ? (game.W - c) : c;
    valor += (game.W - depth) * 0.12;
    const score = own / (1 + def * 2.2) * TERRAIN[h.t].atkFront * (1 + valor * 0.05);
    cand.push({ i, col: c, row: r, score, def });
  }
  cand.sort((a, b) => b.score - a.score);
  const out = [];
  for (const c of cand) {
    if (out.every(o => distance(o.col, o.row, c.col, c.row) > 7)) out.push(c);
    if (out.length >= n) break;
  }
  return out;
}

function deepObjective(game, side, ax, owner) {
  const dir = side === 'BLUE' ? 1 : -1;
  let bestCol = ax.col, bestRow = ax.row, best = -1;
  for (const [c, r] of disc(ax.col, ax.row, 5)) {
    if (c < 1 || r < 1 || c >= game.W - 1 || r >= game.H - 1) continue;
    if ((c - ax.col) * dir < 2) continue;
    const h = game.hexes[r * game.W + c];
    if (h.t === 'agua' || h.t === 'montana') continue;
    const v = (h.vp || 0) * 2 + (h.rail ? 5 : 0) + (h.road ? 2 : 0) + (c - ax.col) * dir;
    if (v > best) { best = v; bestCol = c; bestRow = r; }
  }
  return [bestCol, bestRow];
}

/**
 * Orden de avance. Si el objetivo esta contiguo y ocupado, se ataca. Si no, se
 * busca el hexagono enemigo contiguo que mejor abre camino hacia el objetivo;
 * solo cuando no hay nadie delante se cursa una orden de marcha. Una unidad que
 * ya esta sobre su objetivo y tiene enemigo al lado ataca: quedarse quieta es
 * como se pierden las ofensivas.
 */
function orderAdvance(game, u, col, row, side, hold = false) {
  const ti = row * game.W + col;
  const stack = game._occ.list[ti] || [];
  const dT = distance(u.col, u.row, col, row);
  if (dT === 1 && stack.length && stack[0].side !== side) {
    issueOrder(game, u, { type: 'attack', col, row });
    return;
  }
  let best = null, bd = 99;
  for (const [c, r] of neighbors(u.col, u.row)) {
    if (c < 0 || r < 0 || c >= game.W || r >= game.H) continue;
    const st = game._occ.list[r * game.W + c];
    if (!st || !st.length || st[0].side === side) continue;
    const d = distance(c, r, col, row);
    if (d < bd) { bd = d; best = [c, r]; }
  }
  if (best && (hold || dT <= 1 || bd <= dT)) issueOrder(game, u, { type: 'attack', col: best[0], row: best[1] });
  else if (hold) u.order = null;                       // fuerza de cobertura: no abandona el sector
  else if (dT > 0) issueOrder(game, u, { type: 'move', col, row });
  else u.order = null;
}

function nearestEnemy(game, u, theirs) {
  let best = null, bd = 1e9;
  for (const e of theirs) {
    const d = distance(u.col, u.row, e.col, e.row);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function nearestFriendlyFront(game, side, centroid, owner) {
  const si = sideIdx(side);
  const [cc, cr] = centroid.map(Math.round);
  let best = null, bd = 1e9;
  for (const u of game.units) {
    if (u.side !== side || u.status === 'destroyed') continue;
    if (u.supplyLevel < 25) continue;
    const d = distance(u.col, u.row, cc, cr);
    if (d < bd && d > 1) { bd = d; best = [u.col, u.row]; }
  }
  return best;
}

function keepHQBehindFront(game, u, owner) {
  const si = sideIdx(u.side);
  const subs = game.units.filter(x => x.hqId === u.id && x.status !== 'destroyed');
  if (!subs.length) return;
  const cx = Math.round(subs.reduce((s, x) => s + x.col, 0) / subs.length);
  const cy = Math.round(subs.reduce((s, x) => s + x.row, 0) / subs.length);
  const back = u.side === 'BLUE' ? -3 : 3;
  const tc = Math.max(1, Math.min(game.W - 2, cx + back));
  if (distance(u.col, u.row, tc, cy) > 2) issueOrder(game, u, { type: 'move', col: tc, row: cy });
  u.posture = 'reserva';
}

function keepLogisticsForward(game, u, owner) {
  const si = sideIdx(u.side);
  // situarse donde la traza propia empieza a decaer, sin entrar en contacto
  let best = null, bs = -1e9;
  for (const [c, r] of disc(u.col, u.row, 7)) {
    if (c < 1 || r < 1 || c >= game.W - 1 || r >= game.H - 1) continue;
    const i = r * game.W + c;
    if (owner[i] !== si) continue;
    const sl = game._supply[u.side].level[i];
    if (sl < 18 || sl > 55) continue;
    const ez = game._zoc[other(u.side)][i];
    if (ez) continue;
    const s = -Math.abs(sl - 34) + (game.hexes[i].road ? 6 : 0) + (game.hexes[i].rail ? 4 : 0);
    if (s > bs) { bs = s; best = [c, r]; }
  }
  if (best) issueOrder(game, u, { type: 'move', col: best[0], row: best[1] });
  u.posture = 'reserva';
}
