// Interfaz de mando. Todo parametro que el modelo usa es accesible aqui:
// postura, esfuerzo, reservas retenidas, prioridad logistica, mision de la
// artilleria, reglas de enfrentamiento, doctrina del ejercito y reparto de las
// salidas de aviacion.
import { POSTURES, DOCTRINES, TEMPLATES } from './units.js';
import { SIDES, other, readiness, rawPower, maxMP, inCommand, findPath, projectsZOC } from './sim.js';
import { issueOrder, clearOrder, c2Delay } from './orders.js';
import { TERRAIN, WEATHER, GROUND } from './terrain.js';
import { distance, HEX_KM } from './hex.js';

const $ = (s) => document.querySelector(s);
const fmt = (n) => Math.round(n).toLocaleString('es-ES');
const pct = (n) => Math.round(n) + '%';

export class UI {
  constructor(game) {
    this.game = game;
    this.selected = null;
    this.orderMode = null;        // 'move' | 'attack' | null
    this.hoverPath = null;
    this.layers = {
      control: true, front: true, supply: false, pockets: true, salients: true,
      pincers: true, advance: true, threat: false, fog: true, grid: false,
    };
    this.log = [];
    this.tab = 'unit';
    this.bindChrome();
  }

  bindChrome() {
    for (const id of Object.keys(this.layers)) {
      const el = document.getElementById('ly-' + id);
      if (!el) continue;
      el.checked = this.layers[id];
      el.addEventListener('change', () => { this.layers[id] = el.checked; });
    }
    document.querySelectorAll('#tabs button').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('#tabs button').forEach(x => x.classList.remove('active'));
        document.querySelectorAll('.tabpane').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        this.tab = b.dataset.tab;
        $('#tab-' + this.tab).classList.add('active');
        this.refresh();
      });
    });
  }

  select(u) { this.selected = u; this.orderMode = null; this.hoverPath = null; this.refresh(); }

  // ───────────────────────── cabecera ─────────────────────────
  refreshTop() {
    const g = this.game;
    const hh = String(g.time.hour).padStart(2, '0');
    const noche = g.time.hour >= 20 || g.time.hour < 5;
    $('#clock').textContent = `D+${g.time.day}  ${hh}:00 ${noche ? '☾' : '☀'}  ·  turno ${g.turn}`;
    $('#weather').textContent = `${WEATHER[g.weather.type].name} · suelo ${GROUND[g.weather.ground].name.toLowerCase()}`;
    const sup = g.sides[g.player].airSuperiority;
    const st = sup > 0.35 ? 'superioridad aérea' : sup < -0.35 ? 'inferioridad aérea' : 'aire disputado';
    $('#airstate').textContent = `✈ ${st} (${sup >= 0 ? '+' : ''}${(sup * 100).toFixed(0)})`;

    const me = g.sides[g.player], foe = g.sides[other(g.player)];
    const men = (s) => g.units.filter(u => u.side === s && u.status !== 'destroyed').reduce((a, u) => a + u.personnel, 0);
    $('#scoreline').innerHTML =
      `OBJETIVOS <b>${me.vp}</b>–<b>${foe.vp}</b> &nbsp;·&nbsp; efectivos <b>${fmt(men(g.player))}</b> vs <b>${fmt(men(other(g.player)))}</b>` +
      ` &nbsp;·&nbsp; bajas propias <b>${fmt(me.casualties.total)}</b> (${fmt(me.casualties.pow)} pris.)`;
  }

  // ───────────────────────── caja de situacion ─────────────────────────
  refreshOps() {
    const g = this.game, A = g.analysis, me = g.player, foe = other(me);
    if (!A) return;
    const items = [];
    const goto = (c, r) => `data-goto="${Math.round(c)},${Math.round(r)}"`;

    for (const p of A.sides[me].pockets) items.push(
      `<div class="ops-item k-pocket" ${goto(...p.centroid)}><b>${p.sealed ? '⊗ FUERZAS PROPIAS CERCADAS' : 'BOLSA PROPIA (corredor abierto)'}</b>
       ${p.units.length} unidades · ${fmt(p.men)} h · ${p.areaKm2} km² · ${p.turnsIsolated} turnos sin traza</div>`);
    for (const p of A.sides[foe].pockets) items.push(
      `<div class="ops-item k-pocket" ${goto(...p.centroid)}><b>${p.sealed ? '⊗ CERCO SOBRE EL ENEMIGO' : 'ENEMIGO SEMIEMBOLSADO'}</b>
       ${p.units.length} unidades · ${fmt(p.men)} h atrapados · ${p.turnsIsolated} turnos aislado</div>`);
    for (const p of A.sides[me].pincers) items.push(
      `<div class="ops-item k-pincer" ${goto(...p.centroid)}><b>⇉ PINZA PROPIA — brecha ${p.gapKm} km</b>
       Al cerrar: ${fmt(p.trappedMen)} hombres y ${p.trappedUnits.length} unidades enemigas en la bolsa.</div>`);
    for (const p of A.sides[foe].pincers) if (p.trappedMen > 3000) items.push(
      `<div class="ops-item k-pincer" ${goto(...p.centroid)}><b>⚠ TENAZA ENEMIGA — brecha ${p.gapKm} km</b>
       En riesgo: ${fmt(p.trappedMen)} hombres propios.</div>`);
    for (const s of A.sides[me].salients) if (s.vulnerable) items.push(
      `<div class="ops-item k-salient" ${goto(...s.centroid)}><b>SALIENTE PROPIO VULNERABLE</b>
       ${Math.round(s.depthKm)} km de profundidad, cuello de ${Math.round(s.neckKm)} km · ${fmt(s.men)} h expuestos.</div>`);
    for (const s of A.sides[foe].salients) if (s.vulnerable) items.push(
      `<div class="ops-item k-salient" ${goto(...s.centroid)}><b>SALIENTE ENEMIGO VULNERABLE</b>
       ${Math.round(s.depthKm)} km prof · cuello ${Math.round(s.neckKm)} km · ${fmt(s.men)} h cortables.</div>`);
    for (const b of A.sides[me].breaches) items.push(
      `<div class="ops-item k-breach" ${goto(...b.centroid)}><b>BRECHA SIN CUBRIR — ${b.widthKm} km</b>
       Sector de contacto sin tropas propias a menos de 10 km.</div>`);

    const low = g.units.filter(u => u.side === me && u.status !== 'destroyed' && u.supplyLevel < 25);
    if (low.length) items.push(
      `<div class="ops-item k-supply"><b>ABASTECIMIENTO CRÍTICO</b>${low.length} unidades por debajo del 25 % de traza. ` +
      `Punto culminante alcanzado en esos sectores.</div>`);

    $('#opsbox').innerHTML = `<div class="ops-h">SITUACIÓN OPERACIONAL</div>` +
      (items.length ? items.join('') : `<div class="ops-item">Frente estable. Sin salientes ni bolsas destacables.</div>`);
    $('#opsbox').querySelectorAll('[data-goto]').forEach(el => {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => {
        const [c, r] = el.dataset.goto.split(',').map(Number);
        this.onGoto && this.onGoto(c, r);
      });
    });
  }

  // ───────────────────────── panel de unidad ─────────────────────────
  refreshUnit() {
    const el = $('#tab-unit'), g = this.game, u = this.selected;
    if (!u || u.status === 'destroyed') {
      el.innerHTML = `<div class="sec"><h4>SIN UNIDAD SELECCIONADA</h4><div class="note">
        Haz clic sobre una ficha para asumir su mando. Clic derecho sobre el mapa para darle una orden:
        si el hexágono está ocupado por el enemigo y es contiguo, la orden será de ataque; en caso contrario, de marcha.
      </div></div>`;
      return;
    }
    const own = u.side === g.player;
    const h = g.hexes[u.row * g.W + u.col];
    const T = TERRAIN[h.t];
    const hq = u.hqId ? g.byId[u.hqId] : null;
    const rd = readiness(u);
    const eqTot = ['tanks', 'ifv', 'apc', 'guns', 'mlrs', 'atgm', 'aa'];
    const det = u.side === g.player ? 100 : (u.detectedBy?.[g.player] ?? 0);

    const bar = (label, v, max, color, extra = '') =>
      `<div class="bl"><span>${label}</span><span>${extra || Math.round(v) + (max === 100 ? '%' : '')}</span></div>
       <div class="bar"><i style="width:${Math.max(0, Math.min(100, v / max * 100))}%;background:${color}"></i></div>`;

    const tags = [];
    if (u.status === 'routed') tags.push('<span class="tag bad">DESBANDADA</span>');
    if (u.supplyLevel < 3) tags.push('<span class="tag bad">CERCADA · SIN TRAZA</span>');
    else if (u.supplyLevel < 25) tags.push('<span class="tag warn">TRAZA PRECARIA</span>');
    if (!inCommand(u, g)) tags.push('<span class="tag warn">FUERA DEL RADIO DE MANDO</span>');
    if (u.entrench >= 3) tags.push('<span class="tag good">POSICIÓN PREPARADA</span>');
    if (u.suppression > 45) tags.push('<span class="tag bad">BATIDA POR EL FUEGO</span>');
    if (u.fatigue > 65) tags.push('<span class="tag warn">TROPA EXHAUSTA</span>');
    if (u.isolatedTurns > 0) tags.push(`<span class="tag bad">AISLADA ${u.isolatedTurns} TURNOS</span>`);

    let html = `
    <div class="unit-head">
      <div>
        <div class="unit-name">${u.name}</div>
        <div class="unit-sub">${u.tpl.name} · ${hq ? hq.name : 'mando directo'} · ${h.city ? h.city.name : T.name}</div>
      </div>
    </div>
    <div>${tags.join('')}</div>`;

    if (!own) {
      html += `<div class="sec"><h4>APRECIACIÓN DE INTELIGENCIA</h4><div>
        ${bar('Grado de identificación', det, 100, '#c8a24a')}
        <div class="row"><span class="k">Efectivos estimados</span><span class="v">${det > 60 ? fmt(u.personnel) : '≈ ' + fmt(Math.round(u.personnel / 1000) * 1000)}</span></div>
        <div class="row"><span class="k">Última observación</span><span class="v">turno ${u.lastSeenTurn < 0 ? '—' : u.lastSeenTurn}</span></div>
        <div class="row"><span class="k">Postura aparente</span><span class="v">${det > 55 ? POSTURES[u.posture].name : 'desconocida'}</span></div>
        ${det > 70 ? `<div class="row"><span class="k">Moral estimada</span><span class="v">${pct(u.morale)}</span></div>` : ''}
      </div></div>`;
      el.innerHTML = html;
      return;
    }

    html += `
    <div class="sec"><h4>ESTADO DE LA FUERZA</h4><div>
      ${bar('Efectivos', u.personnel, u.personnelMax, '#7fc98a', `${fmt(u.personnel)} / ${fmt(u.personnelMax)}`)}
      ${bar('Moral', u.morale, 100, '#d8c46a')}
      ${bar('Cohesión', u.cohesion, 100, '#b08fd0')}
      ${bar('Fatiga', u.fatigue, 100, '#d08a5a')}
      ${bar('Supresión', u.suppression, 100, '#c06a6a')}
      ${bar('Atrincheramiento', u.entrench, 6, '#8fa8b8', `nivel ${u.entrench.toFixed(1)} / ${T.entrenchMax}`)}
      <div class="row"><span class="k">Experiencia</span><span class="v">${pct(u.experience)}</span></div>
      <div class="row"><span class="k">Índice de eficacia</span><span class="v">${(rd * 100).toFixed(0)} / 100</span></div>
      <div class="row"><span class="k">Bajas acumuladas</span><span class="v">${fmt(u.casualtiesTotal)}</span></div>
    </div></div>

    <div class="sec"><h4>SOSTENIMIENTO</h4><div>
      ${bar('Traza logística', u.supplyLevel, 100, '#5fc0da')}
      ${bar('Munición', u.ammo, 100, '#d0a050')}
      ${bar('Combustible', u.fuel, 100, '#a0c060')}
      ${bar('Víveres y repuestos', u.stores, 100, '#90a0b0')}
      <div class="row"><span class="k">Prioridad de reabastecimiento</span><span class="v" id="lp-lbl">${['baja', 'normal', 'prioritaria'][u.logPriority]}</span></div>
      <div class="opts" id="opt-logprio">
        ${[0, 1, 2].map(i => `<button data-v="${i}" class="${u.logPriority === i ? 'on' : ''}">${['Baja', 'Normal', 'Prioritaria'][i]}</button>`).join('')}
      </div>
      <div class="note">La traza se calcula desde las bases de teatro por la red de comunicaciones. Las zonas de control enemigas la cortan; por debajo del 3 % la unidad consume reservas propias y empieza a desangrarse.</div>
    </div></div>

    <div class="sec"><h4>MATERIAL</h4><div class="grid2">
      ${eqTot.filter(k => u.equipMax[k] > 0).map(k => `
        <div class="row"><span class="k">${{ tanks: 'Carros', ifv: 'VCI', apc: 'TOA', guns: 'Piezas', mlrs: 'Lanzacohetes', atgm: 'Misiles c/c', aa: 'Antiaéreos' }[k]}</span>
        <span class="v">${u.equip[k]}/${u.equipMax[k]}</span></div>`).join('')}
    </div></div>

    <div class="sec"><h4>POSTURA TÁCTICA</h4><div>
      <div class="opts" id="opt-posture">
        ${Object.entries(POSTURES).map(([k, p]) => `<button data-v="${k}" class="${u.posture === k ? 'on' : ''}" title="${p.name}">${p.name}</button>`).join('')}
      </div>
      <div class="note">${POSTURES[u.posture].name}: ataque ×${POSTURES[u.posture].atk.toFixed(2)}, defensa ×${POSTURES[u.posture].def.toFixed(2)},
      bajas ×${POSTURES[u.posture].cas.toFixed(2)}, consumo de munición ×${POSTURES[u.posture].ammo.toFixed(1)}, movilidad ×${POSTURES[u.posture].move.toFixed(2)}.</div>
    </div></div>

    <div class="sec"><h4>ESFUERZO Y ESCALONAMIENTO</h4><div>
      <div class="bl"><span>Intensidad de esfuerzo</span><span>${pct(u.effort * 100)}</span></div>
      <input type="range" id="sl-effort" min="20" max="100" value="${Math.round(u.effort * 100)}">
      <div class="note">Gobierna consumo de munición y ritmo de bajas propias y ajenas. Un esfuerzo máximo sostenido agota a la unidad en pocos turnos.</div>
      <div class="bl" style="margin-top:8px"><span>Fuerza retenida en reserva</span><span>${pct(u.reservePct * 100)}</span></div>
      <input type="range" id="sl-reserve" min="0" max="50" value="${Math.round(u.reservePct * 100)}">
      <div class="note">Reduce la potencia aplicada pero conserva un escalón para relevar, contraatacar o cubrir la retirada.</div>
    </div></div>`;

    if (u.tpl.indRange >= 2 && (u.equipMax.guns + u.equipMax.mlrs) > 8) {
      html += `<div class="sec"><h4>MISIÓN DE FUEGOS · alcance ${u.tpl.indRange * HEX_KM} km</h4><div>
        <div class="opts" id="opt-arty">
          ${[['apoyo', 'Apoyo directo'], ['preparacion', 'Preparación'], ['contrabateria', 'Contrabatería'], ['interdiccion', 'Interdicción']]
          .map(([k, n]) => `<button data-v="${k}" class="${u.artyMission === k ? 'on' : ''}">${n}</button>`).join('')}
        </div>
        <div class="note">${{
          apoyo: 'Refuerza los combates propios en alcance, atacando y defendiendo.',
          preparacion: 'Machaca la posición asaltada antes del ataque: supresión masiva y desgaste del atrincheramiento. Consumo muy alto.',
          contrabateria: 'Bate la artillería enemiga y reduce su eficacia en todo el sector.',
          interdiccion: 'Bate retaguardia y columnas en marcha: supresión y desgaste continuo sobre unidades detectadas.',
        }[u.artyMission]}</div>
      </div></div>`;
    }

    html += `
    <div class="sec"><h4>REGLAS DE ENFRENTAMIENTO</h4><div>
      <div class="bl"><span>Romper contacto si las bajas superan</span><span>${u.roeCasualty}%</span></div>
      <input type="range" id="sl-roec" min="10" max="70" value="${u.roeCasualty}">
      <div class="bl"><span>Romper contacto si la moral cae por debajo de</span><span>${u.roeMorale}%</span></div>
      <input type="range" id="sl-roem" min="5" max="60" value="${u.roeMorale}">
      <div class="opts" style="margin-top:6px">
        <button id="tg-retreat" class="${u.allowRetreat ? 'on' : 'danger on'}">${u.allowRetreat ? 'Repliegue autorizado' : 'PROHIBIDO CEDER TERRENO'}</button>
        <button id="tg-digin" class="${u.digIn ? 'on' : ''}">${u.digIn ? 'Fortificar posición' : 'No fortificar'}</button>
      </div>
      <div class="note">«Prohibido ceder terreno» impide el repliegue voluntario: conserva la posición al precio de que un asalto exitoso encuentre a la unidad sin margen de maniobra.</div>
    </div></div>

    <div class="sec"><h4>MANDO Y CONTROL</h4><div>
      <div class="row"><span class="k">Cuartel general</span><span class="v">${hq ? hq.name : '—'}</span></div>
      <div class="row"><span class="k">Distancia al CG</span><span class="v">${hq ? distance(u.col, u.row, hq.col, hq.row) * HEX_KM + ' km' : '—'}</span></div>
      <div class="row"><span class="k">Retardo de transmisión</span><span class="v">${c2Delay(g, u)} turno(s)</span></div>
      <div class="row"><span class="k">Puntos de movimiento</span><span class="v">${maxMP(u, g).toFixed(1)}</span></div>
      <div class="row"><span class="k">Orden en vigor</span><span class="v">${orderText(g, u)}</span></div>
      <div class="opts" style="margin-top:6px">
        <button id="ord-move">Marchar a…</button>
        <button id="ord-attack">Atacar…</button>
        <button id="ord-hold">Mantener</button>
        <button id="ord-cancel">Anular</button>
      </div>
    </div></div>`;

    el.innerHTML = html;
    this.wireUnit(u);
  }

  wireUnit(u) {
    const g = this.game;
    const on = (sel, ev, fn) => { const e = $(sel); if (e) e.addEventListener(ev, fn); };
    $('#tab-unit').querySelectorAll('#opt-posture button').forEach(b =>
      b.addEventListener('click', () => { u.posture = b.dataset.v; this.refresh(); }));
    $('#tab-unit').querySelectorAll('#opt-arty button').forEach(b =>
      b.addEventListener('click', () => { u.artyMission = b.dataset.v; this.refresh(); }));
    $('#tab-unit').querySelectorAll('#opt-logprio button').forEach(b =>
      b.addEventListener('click', () => { u.logPriority = +b.dataset.v; this.refresh(); }));
    on('#sl-effort', 'input', e => { u.effort = +e.target.value / 100; this.refreshUnitSoft(); });
    on('#sl-reserve', 'input', e => { u.reservePct = +e.target.value / 100; this.refreshUnitSoft(); });
    on('#sl-roec', 'input', e => { u.roeCasualty = +e.target.value; this.refreshUnitSoft(); });
    on('#sl-roem', 'input', e => { u.roeMorale = +e.target.value; this.refreshUnitSoft(); });
    on('#tg-retreat', 'click', () => { u.allowRetreat = !u.allowRetreat; this.refresh(); });
    on('#tg-digin', 'click', () => { u.digIn = !u.digIn; this.refresh(); });
    on('#ord-move', 'click', () => { this.orderMode = 'move'; this.setHint('Selecciona el hexágono de destino'); });
    on('#ord-attack', 'click', () => { this.orderMode = 'attack'; this.setHint('Selecciona el hexágono enemigo contiguo a batir'); });
    on('#ord-hold', 'click', () => { clearOrder(u); u.posture = u.posture === 'reserva' ? 'defensa' : u.posture; this.refresh(); });
    on('#ord-cancel', 'click', () => { clearOrder(u); this.refresh(); });
  }
  refreshUnitSoft() {
    // refresco ligero de las etiquetas de los deslizadores sin reconstruir el panel
    const u = this.selected; if (!u) return;
    const set = (sel, txt) => { const e = $(sel); if (e) e.previousElementSibling && (e.previousElementSibling.lastElementChild.textContent = txt); };
    set('#sl-effort', pct(u.effort * 100));
    set('#sl-reserve', pct(u.reservePct * 100));
    set('#sl-roec', u.roeCasualty + '%');
    set('#sl-roem', u.roeMorale + '%');
  }

  // ───────────────────────── panel de ejercito ─────────────────────────
  refreshArmy() {
    const g = this.game, S = g.sides[g.player];
    const mine = g.units.filter(u => u.side === g.player && u.status !== 'destroyed');
    const tot = (k) => mine.reduce((a, u) => a + (u.equip[k] || 0), 0);
    const air = S.air.alloc;

    let html = `
    <div class="sec"><h4>DOCTRINA DEL EJÉRCITO</h4><div>
      <select id="sel-doctrine">
        ${Object.entries(DOCTRINES).map(([k, d]) => `<option value="${k}" ${S.doctrine === k ? 'selected' : ''}>${d.name}</option>`).join('')}
      </select>
      <div class="note">${DOCTRINES[S.doctrine].desc}<br>
      Explotación ×${DOCTRINES[S.doctrine].exploit.toFixed(2)} · preparación artillera ×${DOCTRINES[S.doctrine].artyPrep.toFixed(2)} ·
      bonificación defensiva ×${DOCTRINES[S.doctrine].defBonus.toFixed(2)} · velocidad de transmisión ×${DOCTRINES[S.doctrine].c2.toFixed(2)}.</div>
    </div></div>

    <div class="sec"><h4>EMPLEO DE LA AVIACIÓN · ${Math.round(S.air.sorties)} salidas/turno</h4><div>
      ${['cap', 'cas', 'interdiction', 'recon'].map(k => `
        <div class="bl"><span>${{ cap: 'Superioridad aérea', cas: 'Apoyo aéreo cercano', interdiction: 'Interdicción', recon: 'Reconocimiento' }[k]}</span><span>${air[k]}%</span></div>
        <input type="range" class="air" data-k="${k}" min="0" max="100" value="${air[k]}">`).join('')}
      <div class="note">Los porcentajes se normalizan a 100. La interdicción degrada la traza logística enemiga: es la herramienta para asfixiar una bolsa sin asaltarla.</div>
    </div></div>

    <div class="sec"><h4>SOSTENIMIENTO DE TEATRO</h4><div>
      <div class="row"><span class="k">Alcance operacional</span><span class="v">${S.logRange.toFixed(0)} pts (~${Math.round(S.logRange * 5)} km por carretera)</span></div>
      <div class="row"><span class="k">Depósito de teatro</span><span class="v">${Math.round(S.stockpile)} / ${S.stockpileMax}</span></div>
      <div class="row"><span class="k">Producción por turno</span><span class="v">+${S.production}</span></div>
      <div class="row"><span class="k">Demanda del despliegue</span><span class="v">${Math.round(S.demand)}</span></div>
      <div class="row"><span class="k">Reemplazos disponibles</span><span class="v">${fmt(S.replacements)}</span></div>
      <div class="row"><span class="k">Interdicción sufrida</span><span class="v">${(S.interdictedBy * 100).toFixed(0)}%</span></div>
      <div class="bl" style="margin-top:6px"><span>Esfuerzo de transporte hacia vanguardia</span><span>${S.transportPush}%</span></div>
      <input type="range" id="sl-transport" min="0" max="100" value="${S.transportPush}">
      <div class="note">Empujar el transporte hacia vanguardia amplía el alcance operacional pero quema depósito. Si la demanda supera el depósito, todas las unidades reciben menos de lo pedido.</div>
    </div></div>

    <div class="sec"><h4>BALANCE DE FUERZAS</h4><div class="grid2">
      <div class="row"><span class="k">Unidades</span><span class="v">${mine.length}</span></div>
      <div class="row"><span class="k">Efectivos</span><span class="v">${fmt(mine.reduce((a, u) => a + u.personnel, 0))}</span></div>
      <div class="row"><span class="k">Carros</span><span class="v">${tot('tanks')}</span></div>
      <div class="row"><span class="k">VCI/TOA</span><span class="v">${tot('ifv') + tot('apc')}</span></div>
      <div class="row"><span class="k">Piezas</span><span class="v">${tot('guns')}</span></div>
      <div class="row"><span class="k">Lanzacohetes</span><span class="v">${tot('mlrs')}</span></div>
      <div class="row"><span class="k">Bajas</span><span class="v">${fmt(S.casualties.total)}</span></div>
      <div class="row"><span class="k">Prisioneros</span><span class="v">${fmt(S.casualties.pow)}</span></div>
    </div></div>

    <div class="sec"><h4>ÓRDENES GENERALES</h4><div>
      <div class="opts">
        <button id="gen-digin">Fortificar todo el frente</button>
        <button id="gen-hold">Cancelar todas las órdenes</button>
        <button id="gen-effort-lo">Esfuerzo mínimo</button>
        <button id="gen-effort-hi">Esfuerzo máximo</button>
      </div>
      <div class="note">Atajos de estado mayor: aplican a todas las unidades propias en el frente.</div>
    </div></div>

    <div class="sec"><h4>ORDEN DE BATALLA</h4><div id="oob"></div></div>`;

    $('#tab-army').innerHTML = html;

    $('#sel-doctrine').addEventListener('change', e => { S.doctrine = e.target.value; this.refresh(); });
    $('#tab-army').querySelectorAll('input.air').forEach(sl => {
      sl.addEventListener('change', () => {
        S.air.alloc[sl.dataset.k] = +sl.value;
        const t = Object.values(S.air.alloc).reduce((a, b) => a + b, 0) || 1;
        for (const k of Object.keys(S.air.alloc)) S.air.alloc[k] = Math.round(S.air.alloc[k] / t * 100);
        this.refresh();
      });
    });
    $('#sl-transport').addEventListener('change', e => {
      S.transportPush = +e.target.value;
      S.logRange = S.logRangeBase * (0.75 + S.transportPush / 100 * 0.7);
      this.refresh();
    });
    const all = g.units.filter(u => u.side === g.player && u.status !== 'destroyed');
    $('#gen-digin').addEventListener('click', () => { all.forEach(u => { if (projectsZOC(u)) { u.digIn = true; u.posture = 'fortificada'; } }); this.refresh(); });
    $('#gen-hold').addEventListener('click', () => { all.forEach(u => clearOrder(u)); this.refresh(); });
    $('#gen-effort-lo').addEventListener('click', () => { all.forEach(u => u.effort = 0.4); this.refresh(); });
    $('#gen-effort-hi').addEventListener('click', () => { all.forEach(u => u.effort = 1.0); this.refresh(); });

    this.renderOOB();
  }

  renderOOB() {
    const g = this.game, box = $('#oob');
    if (!box) return;
    const mine = g.units.filter(u => u.side === g.player && u.status !== 'destroyed');
    const hqs = mine.filter(u => u.tpl.cmdRadius > 0);
    let html = '';
    for (const hq of hqs) {
      const subs = mine.filter(u => u.hqId === hq.id);
      if (!subs.length && hq.tpl.cmdRadius < 15) continue;
      const men = subs.reduce((a, u) => a + u.personnel, 0);
      html += `<div class="oob-corps"><div class="h" data-u="${hq.id}"><span>${hq.name}</span><span>${fmt(men)} h</span></div>`;
      for (const u of subs.sort((a, b) => a.name.localeCompare(b.name))) {
        const c = u.supplyLevel < 3 ? '#d4453a' : u.morale < 35 ? '#d39a3a' : '#5aa469';
        html += `<div class="oob-u ${this.selected === u ? 'sel' : ''}" data-u="${u.id}">
          <span class="dot" style="background:${c}"></span>
          <span class="nm">${u.name}</span>
          <span class="st">${Math.round(u.personnel / u.personnelMax * 100)}%·M${Math.round(u.morale)}·S${Math.round(u.supplyLevel)}</span>
        </div>`;
      }
      html += '</div>';
    }
    box.innerHTML = html;
    box.querySelectorAll('[data-u]').forEach(el => el.addEventListener('click', () => {
      const u = g.byId[+el.dataset.u];
      if (u) { this.select(u); this.onGoto && this.onGoto(u.col, u.row); }
    }));
  }

  // ───────────────────────── inteligencia ─────────────────────────
  refreshIntel() {
    const g = this.game, A = g.analysis, me = g.player, foe = other(me);
    if (!A) { $('#tab-intel').innerHTML = ''; return; }
    const seen = g.units.filter(u => u.side === foe && u.status !== 'destroyed' && (u.detectedBy?.[me] ?? 0) > 25);
    const conf = g.units.filter(u => u.side === foe && u.status !== 'destroyed' && (u.detectedBy?.[me] ?? 0) > 65);
    const estMen = seen.reduce((a, u) => a + u.personnel, 0);
    const myMen = g.units.filter(u => u.side === me && u.status !== 'destroyed').reduce((a, u) => a + u.personnel, 0);
    const myPow = g.units.filter(u => u.side === me && u.status !== 'destroyed').reduce((a, u) => a + rawPower(u) * readiness(u), 0);
    const foePow = seen.reduce((a, u) => a + rawPower(u) * readiness(u), 0);

    const sec = (t, body) => `<div class="sec"><h4>${t}</h4><div>${body}</div></div>`;
    const listShapes = (arr, f) => arr.length ? arr.map(f).join('') : '<div class="note">Nada que señalar.</div>';

    $('#tab-intel').innerHTML =
      sec('APRECIACIÓN GENERAL', `
        <div class="row"><span class="k">Frente de contacto</span><span class="v">${A.sides[me].frontKm} km</span></div>
        <div class="row"><span class="k">Territorio controlado</span><span class="v">${fmt(A.sides[me].areaKm2)} km²</span></div>
        <div class="row"><span class="k">Territorio enemigo</span><span class="v">${fmt(A.sides[foe].areaKm2)} km²</span></div>
        <div class="row"><span class="k">Unidades enemigas detectadas</span><span class="v">${seen.length} (${conf.length} identificadas)</span></div>
        <div class="row"><span class="k">Efectivos enemigos estimados</span><span class="v">≈ ${fmt(estMen)}</span></div>
        <div class="row"><span class="k">Relación de fuerzas apreciada</span><span class="v">${(myPow / Math.max(1, foePow)).toFixed(2)} : 1</span></div>
        <div class="note">La relación se calcula solo sobre lo detectado. Un enemigo no observado no aparece en el cómputo: la sorpresa operacional vive de ese hueco.</div>`) +

      sec('BOLSAS Y CERCOS', listShapes([...A.sides[me].pockets.map(p => ({ ...p, own: true })), ...A.sides[foe].pockets.map(p => ({ ...p, own: false }))],
        p => `<div class="ops-item k-pocket" data-goto="${Math.round(p.centroid[0])},${Math.round(p.centroid[1])}">
          <b>${p.own ? 'PROPIA' : 'ENEMIGA'} — ${p.sealed ? 'sellada' : 'con corredor'}</b>
          ${p.units.length} unidades · ${fmt(p.men)} h · ${p.areaKm2} km² · traza media ${Math.round(p.avgSupply)}%</div>`)) +

      sec('SALIENTES', listShapes([...A.sides[me].salients.map(s => ({ ...s, own: true })), ...A.sides[foe].salients.map(s => ({ ...s, own: false }))],
        s => `<div class="ops-item k-salient" data-goto="${Math.round(s.centroid[0])},${Math.round(s.centroid[1])}">
          <b>${s.own ? 'PROPIO' : 'ENEMIGO'} · ${Math.round(s.depthKm)} km de profundidad</b>
          Cuello de ${Math.round(s.neckKm)} km · ${fmt(s.men)} h dentro ${s.vulnerable ? '· <span style="color:#e0a83a">cortable por la base</span>' : ''}</div>`)) +

      sec('MANIOBRAS ENVOLVENTES', listShapes([...A.sides[me].pincers.map(p => ({ ...p, own: true })), ...A.sides[foe].pincers.map(p => ({ ...p, own: false }))],
        p => `<div class="ops-item k-pincer" data-goto="${Math.round(p.centroid[0])},${Math.round(p.centroid[1])}">
          <b>${p.own ? 'PINZA PROPIA' : 'TENAZA ENEMIGA'} · brecha ${p.gapKm} km</b>
          Al cerrarse quedarían embolsados ${fmt(p.trappedMen)} hombres y ${p.trappedUnits.length} unidades.</div>`)) +

      sec('BRECHAS EN EL DISPOSITIVO PROPIO', listShapes(A.sides[me].breaches,
        b => `<div class="ops-item k-breach" data-goto="${Math.round(b.centroid[0])},${Math.round(b.centroid[1])}">
          <b>${b.widthKm} km sin cubrir</b>Sector de contacto sin unidades propias en 10 km.</div>`));

    $('#tab-intel').querySelectorAll('[data-goto]').forEach(el => {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => {
        const [c, r] = el.dataset.goto.split(',').map(Number);
        this.onGoto && this.onGoto(c, r);
      });
    });
  }

  // ───────────────────────── diario ─────────────────────────
  pushLog(entries) {
    for (const e of entries) {
      if (e.quiet && e.side === this.game.player) continue;
      this.log.unshift({ turn: this.game.turn, ...e });
    }
    if (this.log.length > 400) this.log.length = 400;
  }
  refreshLog() {
    const g = this.game;
    $('#tab-log').innerHTML = `<div id="logfeed">` + this.log.slice(0, 200).map(e => {
      const cls = e.big ? 'big' : e.t === 'combat' ? (e.side === g.player ? 'blue' : 'red') : '';
      return `<div class="e ${cls}"><span class="t">T${e.turn}</span>${e.txt}</div>`;
    }).join('') + `</div>`;
  }

  setHint(t) { $('#orderstate').textContent = t || ''; }

  refresh() {
    this.refreshTop();
    this.refreshOps();
    if (this.tab === 'unit') this.refreshUnit();
    if (this.tab === 'army') this.refreshArmy();
    if (this.tab === 'intel') this.refreshIntel();
    if (this.tab === 'log') this.refreshLog();
    this.setHint(this.orderMode === 'move' ? 'Orden de marcha: elige destino'
      : this.orderMode === 'attack' ? 'Orden de ataque: elige objetivo contiguo' : '');
  }
}

function orderText(g, u) {
  const o = u.order || u.pending;
  if (!o) return 'ninguna';
  const t = o.type === 'attack' ? 'atacar' : o.type === 'move' ? 'marchar a' : o.type;
  const dest = g.hexes[o.row * g.W + o.col];
  const nm = dest.city ? dest.city.name : `${o.col},${o.row}`;
  return `${t} ${nm}${u.pending ? ` (en tránsito, +${o.activeTurn - g.turn}T)` : ''}`;
}
