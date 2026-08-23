// Arranque del simulador: estado global, camara, entrada del usuario y bucle.
import { createGame, MAP_W, MAP_H } from './scenario.js';
import { POSTURES } from './units.js';
import { SIDES, other, runTurn, findPath, projectsZOC } from './sim.js';
import { analyze } from './analysis.js';
import { aiTurn } from './ai.js';
import { Renderer } from './render.js';
import { UI } from './ui.js';
import { issueOrder, clearOrder } from './orders.js';
import { distance, HEX_KM } from './hex.js';
import { TERRAIN } from './terrain.js';
import { world, landFraction, citiesIn } from './world.js';
import { Theater } from './geo.js';

const qs = new URLSearchParams(location.search);
let game = null, ui = null, rnd = null;

// Teatros de partida: geografia real, elegidos por variedad de terreno.
const PRESETS = [
  { n: 'Llanura de Panonia', lon: 20.0, lat: 47.0, d: 'Terreno abierto y rios anchos: maniobra rapida, cruces decisivos.' },
  { n: 'Alpes centrales', lon: 10.5, lat: 46.6, d: 'Valles estrechos y puertos: el terreno manda mas que la masa.' },
  { n: 'Ardenas', lon: 5.6, lat: 50.2, d: 'Bosque, colinas y una red de carreteras que lo decide todo.' },
  { n: 'Normandía', lon: -0.4, lat: 49.1, d: 'Bocage y costa: frente estrecho, desgaste alto.' },
  { n: 'Kursk', lon: 36.2, lat: 51.7, d: 'Estepa boscosa sin obstaculos naturales: el terreno de los grandes cercos.' },
  { n: 'Península de Corea', lon: 127.3, lat: 38.0, d: 'Corredores entre montañas y mar en ambos flancos.' },
  { n: 'Llanura del Po', lon: 10.8, lat: 45.1, d: 'Llanura irrigada entre los Alpes y los Apeninos.' },
  { n: 'Pampa', lon: -61.0, lat: -34.5, d: 'Llanura sin accidentes: nada frena una explotacion acorazada.' },
];

// ─────────────────────────────── arranque ───────────────────────────────
function boot(lon, lat, seed) {
  game = createGame(seed >>> 0, { lon, lat });
  if (!ui) { ui = new UI(game); ui.onGoto = (c, r) => rnd && rnd.centerOn(c, r); }
  else ui.setGame(game);
  if (!rnd) rnd = new Renderer(document.getElementById('map'), game, ui);
  else rnd.setGame(game);
  rnd.fitTheater();
  ui.refresh();
}

boot(
  Number(qs.get('lon') ?? PRESETS[0].lon),
  Number(qs.get('lat') ?? PRESETS[0].lat),
  Number(qs.get('seed')) || Math.floor(Math.random() * 1e9));

// ─────────────────────────────── camara ───────────────────────────────
const cv = document.getElementById('map');
const tip = document.getElementById('tooltip');
let drag = null, moved = 0;

cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('mousedown', e => {
  const r = cv.getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  if (e.button === 0) {
    drag = { sx, sy, lon: rnd.cam.lon, lat: rnd.cam.lat, tilt: rnd.cam.tilt,
      bearing: rnd.cam.bearing, orbit: e.shiftKey };
    moved = 0;
  }
  if (e.button === 2) rightClick(sx, sy);
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
    if (moved > 4) {
      const cam = rnd.cam;
      if (drag.orbit) {
        // arrastrar con mayusculas inclina y gira el punto de vista
        cam.tilt = Math.max(0, Math.min(1.25, drag.tilt + (sy - drag.sy) * 0.004));
        cam.bearing = drag.bearing + (sx - drag.sx) * 0.005;
      } else {
        // desplazamiento sobre la superficie, proporcional a la altura
        const k = cam.alt * 42;
        cam.lat = Math.max(-85, Math.min(85, drag.lat + (sy - drag.sy) / rnd.vh * k));
        cam.lon = drag.lon - (sx - drag.sx) / rnd.vw * k / Math.max(0.25, Math.cos(cam.lat * Math.PI / 180));
      }
      cam.update();
      tip.style.display = 'none';
    }
    return;
  }
  if (sx < 0 || sy < 0 || sx > r.width || sy > r.height) { tip.style.display = 'none'; return; }
  hover(sx, sy, e.clientX, e.clientY);
});
cv.addEventListener('wheel', e => {
  e.preventDefault();
  const cam = rnd.cam;
  cam.alt = Math.max(0.010, Math.min(4.2, cam.alt * (e.deltaY < 0 ? 1 / 1.14 : 1.14)));
  if (cam.alt > 0.5) cam.tilt = Math.min(cam.tilt, 0.15);
  cam.update();
  updateHint();
}, { passive: false });

// ─────────────────────────────── ordenes ───────────────────────────────
function hexAt(sx, sy) {
  const c = rnd.pickHex(sx, sy);
  if (!c) return null;
  return game.hexes[c[1] * game.W + c[0]];
}

function leftClick(sx, sy) {
  if (!rnd.showGrid) { pickTheater(sx, sy); return; }
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
  if (!rnd.showGrid) return;
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
  if (!rnd.showGrid) {
    const ll = rnd.cam.pick(sx, sy);
    if (!ll) { tip.style.display = 'none'; return; }
    const nm = placeName(ll[0], ll[1]);
    tip.textContent = `${nm}\n${fmtLL(ll[0], ll[1])}\nClic para abrir aquí un teatro de operaciones`;
    showTip(cx, cy);
    return;
  }
  const h = hexAt(sx, sy);
  if (!h) { tip.style.display = 'none'; ui.hoverPath = null; return; }
  const T = TERRAIN[h.t];
  const A = game.analysis;
  const owner = A ? SIDES[A.owner[h.i]] : '—';
  const sup = Math.round(game._supply[game.player].level[h.i]);
  const stack = (game._occ.list[h.i] || []).filter(u => rnd.unitVisibility(u) > 0);
  let txt = `${h.city ? h.city.name.toUpperCase() + ' · ' : ''}${T.name}\n${fmtLL(h.lon, h.lat)}\n`;
  txt += `Control: ${owner === 'BLUE' ? 'azul' : 'rojo'} · traza propia ${sup}%\n`;
  txt += `Defensa ×${T.def.toFixed(2)} · frente útil ×${T.atkFront.toFixed(2)} · trinchera máx ${T.entrenchMax}\n`;
  if (h.road) txt += h.road >= 2 ? 'Calzada principal\n' : 'Camino secundario\n';
  if (h.rail) txt += 'Ferrocarril\n';
  if (h.river.some(Boolean)) txt += h.bridge.some(Boolean) ? 'Curso de agua con puente\n' : 'Curso de agua sin paso\n';
  if (h.vp) txt += `Objetivo operacional: ${h.vp} puntos\n`;
  for (const u of stack) {
    txt += rnd.unitVisibility(u) === 2
      ? `▸ ${u.name} — ${Math.round(u.personnel / u.personnelMax * 100)}% · moral ${Math.round(u.morale)} · ${POSTURES[u.posture].name}\n`
      : `▸ contacto sin identificar\n`;
  }
  tip.textContent = txt.trim();
  showTip(cx, cy);

  const u = ui.selected;
  ui.hoverPath = (u && u.side === game.player && distance(u.col, u.row, h.col, h.row) > 0)
    ? findPath(game, u, h.col, h.row, game._zoc) : null;
}
function showTip(cx, cy) {
  tip.style.display = 'block';
  tip.style.left = Math.min(window.innerWidth - 310, cx + 16) + 'px';
  tip.style.top = (cy + 14) + 'px';
}
function fmtLL(lon, lat) {
  const ns = lat >= 0 ? 'N' : 'S', ew = lon >= 0 ? 'E' : 'O';
  return `${Math.abs(lat).toFixed(2)}° ${ns}  ${Math.abs(lon).toFixed(2)}° ${ew}`;
}
function placeName(lon, lat) {
  const near = world().cities
    .map(c => ({ c, d: Math.hypot((c.x - lon) * Math.cos(lat * Math.PI / 180), c.y - lat) }))
    .sort((a, b) => a.d - b.d)[0];
  if (!near || near.d > 6) return 'Alta mar o territorio despoblado';
  const país = world().countries[near.c.c] || '';
  return near.d < 1.2 ? `${near.c.n}${país ? ' · ' + país : ''}` : `${país || 'Cerca de ' + near.c.n}`;
}

// ── eleccion de teatro sobre el globo ─────────────────────────────────
function pickTheater(sx, sy) {
  const ll = rnd.cam.pick(sx, sy);
  if (!ll) return;
  openTheaterDialog(ll[0], ll[1]);
}

function openTheaterDialog(lon, lat) {
  const t = new Theater(lon, lat, MAP_W, MAP_H, HEX_KM);
  const frac = landFraction(t.bbox(0));
  const nm = placeName(lon, lat);
  const ok = frac >= 0.45;
  showModal('ABRIR TEATRO DE OPERACIONES', `
    <p><b>${nm}</b><br><span style="font-family:var(--mono);font-size:11px">${fmtLL(lon, lat)}</span></p>
    <p>Frente de ${MAP_W * HEX_KM} × ${Math.round(MAP_H * HEX_KM * 0.866)} km.
       Tierra firme: <b>${Math.round(frac * 100)} %</b>.</p>
    ${ok ? '<p>La campaña se generará sobre la geografía real de este rectángulo: costa, cauces, relieve y núcleos de población con su nombre.</p>'
      : '<p style="color:#e0938a">Hay demasiada agua para una campaña terrestre. Elige un punto más interior.</p>'}
    <p style="margin-top:16px">
      ${ok ? `<button class="primary" data-act="open" data-lon="${lon}" data-lat="${lat}">DESPLEGAR AQUÍ</button>` : ''}
      <button data-act="close">Volver al globo</button>
    </p>`);
}

function theaterList() {
  return `<h3>TEATROS PREPARADOS</h3>` + PRESETS.map(p => `
    <p style="margin:6px 0"><button data-act="open" data-lon="${p.lon}" data-lat="${p.lat}"
      style="min-width:210px;text-align:left">${p.n}</button>
      <span class="note" style="display:inline">${p.d}</span></p>`).join('');
}

// ─────────────────────────────── turno ───────────────────────────────
const btn = document.getElementById('btn-endturn');
btn.addEventListener('click', endTurn);
document.getElementById('btn-globe').addEventListener('click', () => {
  if (rnd.showGrid) rnd.viewGlobe(); else rnd.fitTheater();
  updateHint();
});
window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.key === 'Enter') endTurn();
  if (e.code === 'Space') { e.preventDefault(); cycleIdle(); }
  if (e.key === 'f') { ui.layers.fog = !ui.layers.fog; document.getElementById('ly-fog').checked = ui.layers.fog; }
  if (e.key === 'g' || e.key === 'G') { rnd.viewGlobe(); updateHint(); }
  if (e.key === 't' || e.key === 'T') { rnd.fitTheater(); updateHint(); }
  if (e.key === 'Escape') { ui.orderMode = null; ui.setHint(''); }
});

function cycleIdle() {
  const mine = game.units.filter(u => u.side === game.player && u.status !== 'destroyed'
    && projectsZOC(u) && !u.order && !u.pending);
  if (!mine.length) { ui.setHint('Todas las unidades tienen orden en vigor'); return; }
  const i = mine.indexOf(ui.selected);
  const u = mine[(i + 1) % mine.length];
  ui.select(u);
  if (!rnd.showGrid) rnd.fitTheater();
  rnd.centerOn(u.col, u.row);
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
    if (men(s) < start * 0.35) game.over = { winner: other(s), why: `${game.sides[s].name}: colapso del despliegue (pérdidas superiores al 65 %).` };
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
     ${theaterList()}`);
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
  modal.querySelectorAll('[data-act="close"]').forEach(b =>
    b.addEventListener('click', () => modal.classList.remove('on')));
  modal.querySelectorAll('[data-act="open"]').forEach(b =>
    b.addEventListener('click', () => {
      modal.classList.remove('on');
      boot(Number(b.dataset.lon), Number(b.dataset.lat), Math.floor(Math.random() * 1e9));
      updateHint();
    }));
  modal.querySelectorAll('[data-act="globe"]').forEach(b =>
    b.addEventListener('click', () => { modal.classList.remove('on'); rnd.viewGlobe(); updateHint(); }));
}

function updateHint() {
  const s = document.getElementById('hint');
  s.textContent = rnd.showGrid
    ? 'Clic: seleccionar · Clic derecho: orden · Rueda: acercar · Arrastrar: desplazar · Mayús+arrastrar: inclinar · G: globo · Espacio: siguiente unidad'
    : 'Vista del planeta · Arrastrar: girar · Rueda: acercar · Clic sobre tierra: abrir un teatro allí · T: volver al teatro actual';
}

if (qs.get('brief') !== '0') showModal('ORDEN DE OPERACIONES N.º 1', `
  <p><b>El teatro es un trozo real de la Tierra.</b> La costa, los lagos, los cursos de agua,
  las cordilleras y las ciudades —con su nombre— provienen de la cartografía de Natural Earth.
  El relieve fino, la vegetación según clima y la red de carreteras se deducen de esos datos.</p>
  <p><b>Situación.</b> Dos ejércitos de maniobra, el azul al oeste y el rojo al este, se disputan
  el control del sector. Los núcleos con valor operacional aparecen marcados en el mapa.</p>
  <p><b>Misión.</b> Romper el frente enemigo, alcanzar la profundidad operacional y destruir el
  grueso de sus fuerzas mediante envolvimiento.</p>
  <h3>CÓMO SE MANDA</h3>
  <ul>
    <li><b>Clic</b> sobre una ficha para asumir su mando; <b>clic derecho</b> sobre el mapa para ordenarle marchar (o atacar, si el hexágono enemigo es contiguo).</li>
    <li><b>Arrastrar</b> desplaza la cámara, <b>la rueda</b> acerca y aleja, <b>Mayús+arrastrar</b> inclina la vista.</li>
    <li><b>G</b> aleja hasta ver el planeta entero; desde ahí, un clic sobre cualquier tierra firme abre un teatro nuevo allí. <b>T</b> devuelve al actual.</li>
    <li>Las órdenes <b>no son instantáneas</b>: viajan por la cadena de mando y tardan turnos según la distancia al cuartel general.</li>
  </ul>
  <h3>LO QUE DECIDE LA CAMPAÑA</h3>
  <ul>
    <li>Nada mata como <b>cortar la traza logística</b>. Una unidad cercada consume sus reservas, pierde el material pesado por falta de combustible y acaba capitulando.</li>
    <li>Un <b>saliente</b> con el cuello más estrecho que su profundidad es una bolsa esperando a ocurrir.</li>
    <li>Cuando dos salientes propios convergen, el panel calcula qué fuerzas quedarían embolsadas al <b>cerrar la pinza</b>.</li>
  </ul>
  ${theaterList()}
  <p style="margin-top:18px">
    <button class="primary" data-act="close">ASUMIR EL MANDO</button>
    <button data-act="globe">VER EL PLANETA</button>
  </p>`);

// Parametro de depuracion: ?auto=N resuelve N turnos con las dos partes automaticas.
const auto = Number(qs.get('auto') || 0);
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

// Parametros de depuracion de camara: ?alt= radios terrestres, ?tilt= radianes.
if (qs.get('alt') !== null) { rnd.cam.alt = Number(qs.get('alt')); rnd.cam.update(); }
if (qs.get('tilt') !== null) { rnd.cam.tilt = Number(qs.get('tilt')); rnd.cam.update(); }

updateHint();
ui.refresh();
(function loop() { rnd.draw(); requestAnimationFrame(loop); })();

window.THEATRUM = { get game() { return game; }, get ui() { return ui; }, get rnd() { return rnd; }, boot };
