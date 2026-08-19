// Emision de ordenes a traves de la cadena de mando.
// Una orden no es instantanea: viaja del CG a la division y tarda en funcion de la
// distancia, del radio de mando del cuartel y de la doctrina de control (la orden
// tipo misión de la doctrina relámpago llega antes que la orden detallada).
import { distance } from './hex.js';
import { DOCTRINES } from './units.js';

export function c2Delay(game, u) {
  const hq = u.hqId ? game.byId[u.hqId] : null;
  const D = DOCTRINES[game.sides[u.side].doctrine];
  let delay;
  if (hq && hq.status !== 'destroyed') {
    const d = distance(u.col, u.row, hq.col, hq.row);
    delay = Math.max(0, Math.round((d - hq.tpl.cmdRadius * 0.5) / (5 * D.c2)));
    if (d > hq.tpl.cmdRadius) delay += 1;
  } else delay = 2;
  if (u.supplyLevel < 10) delay += 1;
  if (u.status === 'routed') delay += 1;
  return delay;
}

const same = (a, b) => a && b && a.type === b.type && a.col === b.col && a.row === b.row;

export function issueOrder(game, u, o) {
  // Repetir una orden ya cursada no reinicia su transmision: si no fuese asi,
  // un mando que insiste cada turno dejaria a la unidad esperando para siempre.
  if (same(u.pending, o)) return u.pending.activeTurn - game.turn;
  if (same(u.order, o) && !u.pending) return 0;
  o.issuedTurn = game.turn;
  const d = c2Delay(game, u);
  o.activeTurn = game.turn + d;
  if (d <= 0) { u.order = o; u.pending = null; }
  else { u.pending = o; }
  return d;
}

export function clearOrder(u) { u.order = null; u.pending = null; }
