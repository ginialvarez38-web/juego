// Arranque del simulador: estado global, entrada del usuario y bucle de dibujo.
import { createGame, MAP_W as W, MAP_H as H } from './scenario.js';
import { POSTURES, DOCTRINES } from './units.js';
import { SIDES, other, runTurn, findPath, projectsZOC } from './sim.js';
import { analyze } from './analysis.js';
import { aiTurn } from './ai.js';
import { Renderer } from './render.js';
import { UI } from './ui.js';
import { issueOrder, clearOrder } from './orders.js';
import { distance, HEX_KM } from './hex.js';
import { TERRAIN, WEATHER, GROUND } from './terrain.js';

// ─────────────────────────────── arranque ───────────────────────────────
const seed = (Number(new URLSearchParams(location.search).get('seed')) || Math.floor(Math.random() * 1e9)) >>> 0;
const game = createGame(seed);
const ui = new UI(game);
const rnd = new Renderer(document.getElementById('map'), game, ui);
rnd.fitTheater();
ui.onGoto = (c, r) => rnd.centerOn(c, r);

// ─────────────────────────────── entrada ───────────────────────────────
const cv = document.getElementById('map');
const tip = document.getElementById('tooltip');
let drag = null, moved = 0;

cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('mousedown', e => {
  const r = cv.getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  if (e.button === 0) { drag = { sx, sy, cx: rnd.cam.x, cy: rnd.cam.y }; moved = 0; }
  if (e.button === 2) { rightClick(sx, sy); }
});
window.addEventListener('mouseup', e => {
  if (drag && moved < 5 && e.button === 0) {
    const r = cv.getBoundingClientRect();
    leftClick(e.clientX - r.left, e.clientY - r.top);
  }
  drag = null;
});
window.addEventListener('mousemove', e => {
  const r = cv.getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  if (drag) {
    moved = Math.max(moved, Math.hypot(sx - drag.sx, sy - drag.sy));
    if (moved > 4) { rnd.cam.x = drag.cx - (sx - drag.sx); rnd.cam.y = drag.cy - (sy - drag.sy); }
    tip.style.display = 'none';
    return;
  }
  if (sx < 0 || sy < 0 || sx > r.width || sy > r.height) { tip.style.display = 'none'; return; }
  hover(sx, sy, e.clientX, e.clientY);
});
cv.addEventListener('wheel', e => {
  e.preventDefault();
  const r = cv.getBoundingClientRect();
  rnd.zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
}, { passive: false });

function hexAt(sx, sy) {
  const [c, r] = rnd.screenToHex(sx, sy);
  if (c < 0 || r < 0 || c >= game.W || r >= game.H) return null;
  return game.hexes[r * game.W + c];
}

function leftClick(sx, sy) {
  const h = hexAt(sx, sy); if (!h) return;
  if (ui.orderMode && ui.selected && ui.selected.side === game.player) {
    giveOrder(ui.selected, h, ui.orderMode);
    ui.orderMode = null; ui.refresh(); return;
  }
  const stack = game._occ.list[h.i] || [];
  const vis = stack.filter(u => rnd.unitVisibility(u) > 0);
  if (vis.length) {
    const i = vis.indexOf(ui.selected);
    ui.select(vis[(i + 1) % vis.length]);
  } else ui.select(null);
}

function rightClick(sx, sy) {
  const h = hexAt(sx, sy); if (!h) return;
  const u = ui.selected;
  if (!u || u.side !== game.player || u.status === 'destroyed') return;
  const stack = game._occ.list[h.i] || [];
  const enemy = stack.length && stack[0].side !== u.side;
  giveOrder(u, h, enemy && distance(u.col, u.row, h.col, h.row) === 1 ? 'attack' : 'move');
  ui.refresh();
}

function giveOrder(u, h, type) {
  if (type === 'attack' && distance(u.col, u.row, h.col, h.row) !== 1) type = 'move';
  const d = issueOrder(game, u, { type, col: h.col, row: h.row });
  if (type === 'attack' && !['asalto', 'ataque', 'sondeo'].includes(u.posture)) u.posture = 'ataque';
  ui.setHint(d > 0 ? `Orden cursada — llegará a la unidad en ${d} turno(s)` : 'Orden en vigor');
}

function hover(sx, sy, cx, cy) {
  const h = hexAt(sx, sy);
  if (!h) { tip.style.display = 'none'; ui.hoverPath = null; return; }
  const T = TERRAIN[h.t];
  const A = game.analysis;
  const owner = A ? SIDES[A.owner[h.i]] : '—';
  const sup = Math.round(game._supply[game.player].level[h.i]);
  const stack = (game._occ.list[h.i] || []).filter(u => rnd.unitVisibility(u) > 0);
  let txt = `${h.city ? h.city.name.toUpperCase() + ' · ' : ''}${T.name}  (${h.col},${h.row})\n`;
  txt += `Control: ${owner === 'BLUE' ? 'azul' : 'rojo'} · traza propia ${sup}%\n`;
  txt += `Defensa ×${T.def.toFixed(2)} · frente útil ×${T.atkFront.toFixed(2)} · trinchera máx ${T.entrenchMax}\n`;
  if (h.road) txt += h.road >= 2 ? 'Calzada principal\n' : 'Camino secundario\n';
  if (h.rail) txt += 'Ferrocarril\n';
  if (h.river.some(Boolean)) txt += h.bridge.some(Boolean) ? 'Curso de agua con puente\n' : 'Curso de agua sin paso\n';
  if (h.vp) txt += `Objetivo operacional: ${h.vp} puntos\n`;
  for (const u of stack) {
    const v = rnd.unitVisibility(u);
    txt += v === 2
      ? `▸ ${u.name} — ${Math.round(u.personnel / u.personnelMax * 100)}% · moral ${Math.round(u.morale)} · ${POSTURES[u.posture].name}\n`
      : `▸ contacto sin identificar\n`;
  }
  tip.textContent = txt.trim();
  tip.style.display = 'block';
  tip.style.left = Math.min(window.innerWidth - 310, cx + 16) + 'px';
  tip.style.top = (cy + 14) + 'px';

  const u = ui.selected;
  if (u && u.side === game.player && distance(u.col, u.row, h.col, h.row) > 0) {
    ui.hoverPath = findPath(game, u, h.col, h.row, game._zoc);
  } else ui.hoverPath = null;
}

// ─────────────────────────────── turno ───────────────────────────────
const btn = document.getElementById('btn-endturn');
btn.addEventListener('click', endTurn);
window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.key === 'Enter') { endTurn(); }
  if (e.code === 'Space') { e.preventDefault(); cycleIdle(); }
  if (e.key === 'f') { ui.layers.fog = !ui.layers.fog; document.getElementById('ly-fog').checked = ui.layers.fog; }
  if (e.key === 'Escape') { ui.orderMode = null; ui.setHint(''); }
});

function cycleIdle() {
  const mine = game.units.filter(u => u.side === game.player && u.status !== 'destroyed'
    && projectsZOC(u) && !u.order && !u.pending);
  if (!mine.length) { ui.setHint('Todas las unidades tienen orden en vigor'); return; }
  const i = mine.indexOf(ui.selected);
  const u = mine[(i + 1) % mine.length];
  ui.select(u); rnd.centerOn(u.col, u.row);
}

function endTurn() {
  if (game.over) return;
  btn.disabled = true; btn.textContent = 'RESOLVIENDO…';
  setTimeout(() => {
    const { events } = runTurn(game, (g, ev) => {
      for (const s of SIDES) if (g.sides[s].ai) aiTurn(g, ev, s);
    });
    analyze(game);
    ui.pushLog(events);
    checkEnd();
    ui.refresh();
    btn.disabled = false; btn.textContent = 'EJECUTAR TURNO ⏎';
  }, 10);
}

function checkEnd() {
  const men = (s) => game.units.filter(u => u.side === s && u.status !== 'destroyed').reduce((a, u) => a + u.personnel, 0);
  const start = 380000;
  for (const s of SIDES) {
    if (men(s) < start * 0.35) { game.over = { winner: other(s), why: `${game.sides[s].name}: colapso del despliegue (pérdidas superiores al 65 %).` }; }
  }
  if (game.turn >= 80 && !game.over) {
    const b = game.sides.BLUE.vp, r = game.sides.RED.vp;
    game.over = { winner: b === r ? null : (b > r ? 'BLUE' : 'RED'), why: `Fin del plazo operacional. Objetivos ${b} – ${r}.` };
  }
  if (game.over) showModal(
    game.over.winner === null ? 'TABLAS OPERACIONALES'
      : `VICTORIA ${game.over.winner === 'BLUE' ? 'AZUL' : 'ROJA'}`,
    `<p>${game.over.why}</p>
     <h3>BALANCE</h3>
     <p>Azules: ${game.sides.BLUE.casualties.total.toLocaleString('es')} bajas
        (${game.sides.BLUE.casualties.pow.toLocaleString('es')} prisioneros).<br>
        Rojas: ${game.sides.RED.casualties.total.toLocaleString('es')} bajas
        (${game.sides.RED.casualties.pow.toLocaleString('es')} prisioneros).</p>
     <p><button class="primary" data-act="restart">NUEVA CAMPAÑA</button></p>`);
}

// ─────────────────────────────── modal ───────────────────────────────
const modal = document.createElement('div');
modal.id = 'modal';
modal.innerHTML = '<div class="box"></div>';
document.body.appendChild(modal);
modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('on'); });
function showModal(title, html) {
  modal.querySelector('.box').innerHTML = `<h2>${title}</h2>${html}`;
  modal.classList.add('on');
  // Los manejadores se enlazan aqui y no como atributos en linea: un atributo
  // onclick depende de que la politica de contenido admita guion en linea.
  const close = modal.querySelector('[data-act="close"]');
  if (close) close.addEventListener('click', () => modal.classList.remove('on'));
  const again = modal.querySelector('[data-act="restart"]');
  if (again) again.addEventListener('click', () => location.reload());
}

if (new URLSearchParams(location.search).get('brief') !== '0') showModal('ORDEN DE OPERACIONES N.º 1', `
  <p><b>Situación.</b> El 4.º Ejército rojo ha establecido una defensa preparada a lo largo de los cursos
  de agua del teatro. Su dispositivo es denso en el centro y más débil en las alas, y dispone de dos
  divisiones acorazadas en reserva operativa.</p>
  <p><b>Misión.</b> El 1.er Ejército azul rompe el frente enemigo, alcanza la profundidad operacional y
  destruye el grueso del 4.º Ejército mediante envolvimiento. Los núcleos con valor operacional
  aparecen marcados en el mapa.</p>
  <h3>CÓMO SE MANDA</h3>
  <ul>
    <li><b>Clic</b> sobre una ficha para asumir su mando; <b>clic derecho</b> sobre el mapa para ordenarle marchar (o atacar, si el hexágono enemigo es contiguo).</li>
    <li>Las órdenes <b>no son instantáneas</b>: viajan por la cadena de mando y tardan turnos según la distancia al cuartel general.</li>
    <li>Cada unidad se regula por completo: postura, intensidad de esfuerzo, reserva retenida, prioridad logística, misión de fuegos y reglas de enfrentamiento.</li>
    <li>En la pestaña <b>EJÉRCITO</b> se fija la doctrina, el reparto de salidas de aviación y el esfuerzo de transporte.</li>
  </ul>
  <h3>LO QUE DECIDE LA CAMPAÑA</h3>
  <ul>
    <li>Nada mata como <b>cortar la traza logística</b>. Una unidad cercada consume sus reservas, pierde el material pesado por falta de combustible y acaba capitulando.</li>
    <li>Un <b>saliente</b> con el cuello más estrecho que su profundidad es una bolsa esperando a ocurrir. El mapa te avisa de los tuyos y de los del enemigo.</li>
    <li>Cuando dos salientes propios convergen, el panel calcula qué fuerzas quedarían embolsadas al <b>cerrar la pinza</b>. Ése es el objetivo.</li>
  </ul>
  <p style="margin-top:18px"><button class="primary" data-act="close">ASUMIR EL MANDO</button></p>
`);

// Parametro de depuracion: ?auto=N resuelve N turnos con las dos partes bajo
// control automatico, util para inspeccionar el mapa con la campaña avanzada.
const auto = Number(new URLSearchParams(location.search).get('auto') || 0);
if (auto > 0) {
  game.sides.BLUE.ai = true; game.sides.BLUE.aggression = 0.85;
  for (let i = 0; i < auto; i++) {
    const { events } = runTurn(game, (g, ev) => {
      for (const s of SIDES) if (g.sides[s].ai) aiTurn(g, ev, s);
    });
    analyze(game); ui.pushLog(events);
  }
  game.sides.BLUE.ai = false;
}

// ─────────────────────────────── bucle ───────────────────────────────
ui.refresh();
(function loop() { rnd.draw(); requestAnimationFrame(loop); })();

// utilidades de consola para depurar el modelo
window.THEATRUM = { game, ui, rnd, analyze, runTurn };
