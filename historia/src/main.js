// Controlador del juego: pantallas, panel lateral, turnos, diplomacia y
// partidas guardadas.

import { buildWorld } from './world.js';
import { SCENARIOS, scenarioById } from './scenarios.js';
import {
  createGame, countryStats, estPopulation, fmtDate, addTime, JUMPS, relation, alliesOf, enemiesOf,
  provincesOf, applyChanges, snapshot, restore, serialize, deserialize, findProvince, norm, countryNeighbours,
} from './game.js';
import { MapView, KIND_COLORS, toX, toY } from './map.js';
import { aiTurn, aiChat, DEFAULT_SETTINGS, PROVIDERS, testConnection, fmtPop, AIError } from './ai.js';
import { offlineTurn, offlineChat } from './offline.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── almacenamiento ────────────────────────────────────────────────────────
const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  raw(k) { try { return localStorage.getItem(k); } catch { return null; } },
  setRaw(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* nada */ } },
};

let settings = { ...DEFAULT_SETTINGS, ...store.get('hm.settings', {}) };

// ── escenarios propios ────────────────────────────────────────────────────
function customList() { return store.get('hm.customs', []); }
/** Un escenario guardado por el jugador, con la misma forma que los de serie. */
function customScenario(cs) {
  return {
    ...cs,
    custom: true,
    owner: (pt, ne, p) => cs.owner[p.id],
    countries: () => JSON.parse(JSON.stringify(cs.countries)),
  };
}
function getScenario(id) {
  const s = scenarioById(id);
  if (s) return s;
  const cs = customList().find(c => c.id === id);
  return cs ? customScenario(cs) : null;
}
function allScenarios() { return [...SCENARIOS, ...customList().map(customScenario)]; }
let world = null, map = null, g = null;
let state = 'title';              // title | scenario | pick | play | editor
let edit = null;                  // estado del editor de escenarios
let pickScenario = null, pickCountry = null;
let chatWith = null;
let selected = null;              // país mostrado en la pestaña Nación
let busy = false;

// ── arranque ──────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => setTimeout(boot, 30));

function boot() {
  try {
    world = buildWorld();
  } catch (e) {
    $('#loading-text').textContent = 'No se pudo generar el mundo: ' + e.message;
    throw e;
  }
  map = new MapView($('#map'), world);
  // fondo del menú: el mundo actual
  map.setGame(createGame(world, SCENARIOS[0], null));
  map.on('hover', onHover);
  map.on('click', onMapClick);
  $('#loading').classList.add('hidden');
  bindUI();
  showTitle();
}

// ── pantallas ─────────────────────────────────────────────────────────────
function show(id) {
  for (const s of ['#screen-title', '#screen-scenario', '#screen-country', '#screen-editor']) $(s).classList.add('hidden');
  if (id) $(id).classList.remove('hidden');
  const play = state === 'play';
  for (const s of ['#hud', '#panel', '#panel-toggle', '#modes', '#legend']) $(s).classList.toggle('hidden', !play);
}

function showTitle() {
  state = 'title';
  show('#screen-title');
  $('#btn-continue').classList.toggle('hidden', !store.raw('hm.save.auto'));
  updateAIStatus();
}

function updateAIStatus() {
  const p = settings.provider;
  $('#ai-status').textContent = p === 'none'
    ? 'Modo actual: simulador local, sin IA. Configura una clave en «Ajustes de IA» para la experiencia completa.'
    : `Director de juego: ${PROVIDERS[p].label} · ${settings.model}`;
}

function showScenarios() {
  state = 'scenario';
  show('#screen-scenario');
  const ARTS = { actual: 'linear-gradient(135deg,#1d4e89,#2a9d8f)', 1936: 'linear-gradient(135deg,#5b3a29,#9e2a2b)' };
  $('#scenario-cards').innerHTML = allScenarios().map(s => `
    <button class="scn ${s.custom ? 'custom' : ''}" data-id="${esc(s.id)}">
      ${s.custom ? `<span class="del" data-del="${esc(s.id)}" title="Borrar escenario">×</span>` : ''}
      <div class="art" ${s.custom ? '' : `style="background:${ARTS[s.id] || '#333'}"`}>${esc(s.year)}</div>
      <div class="bd"><h3>${esc(s.title)}</h3><p>${esc(s.blurb || s.context || '')}</p></div>
    </button>`).join('') + '<button class="scn new" id="scn-create">＋ Crear escenario</button>';
  $$('#scenario-cards .scn[data-id]').forEach(b => b.onclick = (e) => {
    if (e.target.dataset.del) {
      e.stopPropagation();
      store.set('hm.customs', customList().filter(c => c.id !== e.target.dataset.del));
      showScenarios();
      return;
    }
    startPick(b.dataset.id);
  });
  $('#scn-create').onclick = () => openEditor();
}

function startPick(id) {
  pickScenario = getScenario(id);
  state = 'pick';
  pickCountry = null;
  const tmp = createGame(world, pickScenario, null);
  g = tmp;
  map.focus = null;
  map.setMode('political');
  map.setGame(tmp);
  map.setMarkers([]);
  show('#screen-country');
  $('#pick-title').textContent = `${pickScenario.title} · ${pickScenario.year}`;
  const st = countryStats(tmp, world);
  const featured = pickScenario.featured && pickScenario.featured.length ? pickScenario.featured
    : Object.keys(st).filter(id => st[id].provinces).sort((a, b) => st[b].provinces - st[a].provinces).slice(0, 14);
  $('#featured').innerHTML = featured.filter(id => tmp.countries[id] && st[id] && st[id].provinces)
    .map(id => `<span class="tag" data-id="${id}"><span class="sw" style="background:${tmp.countries[id].color}"></span>${esc(tmp.countries[id].name)}</span>`).join('');
  $$('#featured .tag').forEach(t => t.onclick = () => choosePick(t.dataset.id, true));
  $('#pick-search').value = '';
  $('#pick-results').innerHTML = '';
  $('#pick-info').innerHTML = '<p class="muted">Ningún país seleccionado.</p>';
}

function choosePick(id, fly = false) {
  const tmp = g;
  if (!tmp.countries[id] || !tmp.countries[id].alive) return;
  pickCountry = id;
  map.setFocus(id);
  if (fly) map.flyToCountry(id);
  const c = tmp.countries[id], st = countryStats(tmp, world)[id];
  $('#pick-info').innerHTML = `
    <div class="nation-head"><div class="flag" style="background:${c.color}"></div>
      <div><h2>${esc(c.name)}</h2><small>${esc(c.gov || '')}</small></div></div>
    <div class="stats">
      <div class="stat"><small>Líder</small><b>${esc(c.leader || '—')}</b></div>
      <div class="stat"><small>Provincias</small><b>${st.provinces}</b></div>
      <div class="stat"><small>Población</small><b>${fmtPop(estPopulation(st))}</b></div>
      <div class="stat"><small>Capital</small><b>${st.capital !== null ? esc(world.provinces[st.capital].name) : '—'}</b></div>
    </div>
    <button id="btn-play-as" class="primary big">Gobernar ${esc(c.name)}</button>`;
  $('#btn-play-as').onclick = () => startGame(pickScenario, id);
}

function startGame(scn, id) {
  g = createGame(world, scn, id);
  g.title = `${g.countries[id].name} · ${scn.year}`;
  state = 'play';
  selected = id;
  show(null);
  map.focus = null;
  map.setMode('political');
  map.setGame(g);
  map.setMarkers([]);
  map.flyToCountry(id);
  setTab('actions');
  renderAll();
  autosave();
  toast(`Gobiernas ${g.countries[id].name}. Escribe tus órdenes y pulsa «Avanzar».`);
}

function resumeGame(game) {
  g = game;
  state = 'play';
  selected = g.player;
  show(null);
  map.focus = null;
  map.setMode('political');
  map.setGame(g);
  map.setMarkers([]);
  map.flyToCountry(g.player);
  renderAll();
}

// ── interfaz ──────────────────────────────────────────────────────────────
function bindUI() {
  $('#btn-new').onclick = showScenarios;
  $('#btn-continue').onclick = () => {
    const raw = store.raw('hm.save.auto');
    if (raw) resumeGame(deserialize(raw));
  };
  $('#btn-load').onclick = openLoad;
  $('#btn-import').onclick = () => $('#file-input').click();
  $('#btn-create').onclick = () => openEditor();
  bindEditor();
  $('#btn-settings').onclick = openSettings;
  $('#btn-help').onclick = openHelp;
  $$('[data-back]').forEach(b => b.onclick = () => {
    if (b.dataset.back === 'title') showTitle();
    else { map.setFocus(null); showScenarios(); }
  });
  $('#pick-search').oninput = (e) => {
    const q = norm(e.target.value);
    if (!q) { $('#pick-results').innerHTML = ''; return; }
    const res = Object.values(g.countries).filter(c => c.alive && norm(c.name).includes(q)).slice(0, 8);
    $('#pick-results').innerHTML = res.map(c => `<div class="country-row" data-id="${c.id}"><span class="swatch" style="background:${c.color}"></span><span class="nm"><b>${esc(c.name)}</b></span></div>`).join('');
    $$('#pick-results .country-row').forEach(r => r.onclick = () => choosePick(r.dataset.id, true));
  };

  // HUD
  $('#jump').innerHTML = JUMPS.map(j => `<option value="${j.id}">${j.label}</option>`).join('');
  $('#jump').value = store.get('hm.jump', '1m');
  $('#jump').onchange = (e) => store.set('hm.jump', e.target.value);
  $('#btn-advance').onclick = advance;
  $('#btn-menu').onclick = (e) => { e.stopPropagation(); $('#menu-pop').classList.toggle('hidden'); };
  document.addEventListener('click', (e) => { if (!e.target.closest('#menu-pop')) $('#menu-pop').classList.add('hidden'); });
  $$('#menu-pop button').forEach(b => b.onclick = () => { $('#menu-pop').classList.add('hidden'); menuAction(b.dataset.act); });
  $('#me-badge').onclick = () => { selected = g.player; setTab('nation'); map.flyToCountry(g.player); };
  $$('#tabs button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
  $('#panel-toggle').onclick = () => {
    const c = $('#panel').classList.toggle('collapsed');
    $('#panel-toggle').classList.toggle('collapsed', c);
    $('#panel-toggle').textContent = c ? '⟨' : '⟩';
  };
  $$('#modes [data-mode]').forEach(b => b.onclick = () => {
    $$('#modes [data-mode]').forEach(x => x.classList.toggle('active', x === b));
    map.setMode(b.dataset.mode);
    renderLegend();
  });
  $('#zoom-in').onclick = () => map.zoomAt(map.vw / 2, map.vh / 2, 1.6);
  $('#zoom-out').onclick = () => map.zoomAt(map.vw / 2, map.vh / 2, 1 / 1.6);

  // acciones
  $('#btn-add-action').onclick = addAction;
  $('#action-input').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addAction(); } };
  // diplomacia
  $('#diplo-search').oninput = renderDiplo;
  $('#btn-send').onclick = sendChat;
  $('#chat-input').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } };

  $('#modal-close').onclick = closeModal;
  $('#modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };
  $('#file-input').onchange = importFile;

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === 'Escape') { closeModal(); if (state === 'play') { map.setFocus(null); } }
    if (state !== 'play') return;
    if (e.key === '+' || e.key === '=') map.zoomAt(map.vw / 2, map.vh / 2, 1.4);
    if (e.key === '-') map.zoomAt(map.vw / 2, map.vh / 2, 1 / 1.4);
  });
}

function setTab(t) {
  $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  $$('.tab').forEach(s => s.classList.toggle('active', s.id === 'tab-' + t));
  if ($('#panel').classList.contains('collapsed')) $('#panel-toggle').click();
  if (t === 'nation') renderNation();
  if (t === 'diplo') { if (chatWith) renderChat(); else renderDiplo(); }
  if (t === 'news') renderNews();
}

function renderAll() {
  renderHud();
  renderActions();
  renderDiplo();
  renderNews();
  renderNation();
  renderLegend();
}

function renderHud() {
  const c = g.countries[g.player];
  $('#me-badge .swatch').style.background = c.color;
  $('#me-name').textContent = c.name + (c.alive ? '' : ' (desaparecido)');
  $('#me-leader').textContent = c.leader || c.gov || '';
  $('#date').textContent = fmtDate(g.date);
  $('#turninfo').textContent = `Turno ${g.turn + 1} · ${g.scenarioTitle}`;
}

// ── acciones ──────────────────────────────────────────────────────────────
function addAction() {
  const t = $('#action-input').value.trim();
  if (!t) return;
  g.actions.push(t);
  $('#action-input').value = '';
  renderActions();
  autosave();
}

function renderActions() {
  const list = $('#action-list');
  list.innerHTML = g.actions.length
    ? g.actions.map((a, i) => `<div class="action-item"><span class="n">${i + 1}</span><span class="txt">${esc(a)}</span><button data-i="${i}" title="Quitar">×</button></div>`).join('')
    : '<div class="empty">Sin órdenes para este turno. Puedes avanzar el tiempo igualmente y ver cómo reacciona el mundo.</div>';
  $$('#action-list button').forEach(b => b.onclick = () => { g.actions.splice(+b.dataset.i, 1); renderActions(); autosave(); });
  renderSuggestions();
}

function renderSuggestions() {
  const me = g.player;
  const nb = [...(countryNeighbours(g, world).get(me) || [])].filter(id => g.countries[id] && g.countries[id].alive);
  const st = countryStats(g, world);
  nb.sort((a, b) => st[b].provinces - st[a].provinces);
  const N = (id) => g.countries[id].name;
  const sug = [];
  const enemies = enemiesOf(g, me);
  if (enemies.length) {
    const e = enemies[0];
    const tp = provincesOf(g, e).find(i => world.provinces[i].cap) ?? provincesOf(g, e)[0];
    if (tp !== undefined) sug.push(`Lanzar una ofensiva contra ${N(e)} en dirección a ${world.provinces[tp].name}`);
    sug.push(`Proponer un armisticio a ${N(e)}`);
  }
  if (nb[0]) sug.push(`Proponer una alianza defensiva a ${N(nb[0])}`);
  if (nb[1]) sug.push(`Firmar un tratado comercial con ${N(nb[1])}`);
  sug.push('Invertir en industria e infraestructuras');
  sug.push('Modernizar y ampliar el ejército');
  if (nb[2] && !enemies.length) sug.push(`Exigir a ${N(nb[2])} la cesión de territorios fronterizos`);
  sug.push('Celebrar elecciones y reforzar las instituciones');
  sug.push('Lanzar un programa científico nacional');
  $('#suggestions').innerHTML = '<span class="lbl">Ideas</span>' + sug.slice(0, 7).map(s => `<span class="chip">${esc(s)}</span>`).join('');
  $$('#suggestions .chip').forEach(ch => ch.onclick = () => {
    const ta = $('#action-input');
    ta.value = ch.textContent;
    ta.focus();
  });
}

// ── diplomacia ────────────────────────────────────────────────────────────
const REL_TXT = { war: 'En guerra', ally: 'Aliado', subject: 'Súbdito', overlord: 'Señor', neutral: 'Neutral', self: 'Tú' };

function renderDiplo() {
  if (!g || !g.player) return;
  $('#diplo-list-view').classList.toggle('hidden', !!chatWith);
  $('#chat-view').classList.toggle('hidden', !chatWith);
  if (chatWith) return;
  const me = g.player;
  const st = countryStats(g, world);
  const q = norm($('#diplo-search').value);
  const alive = Object.values(g.countries).filter(c => c.alive && c.id !== me && (!q || norm(c.name).includes(q)));
  const nb = countryNeighbours(g, world).get(me) || new Set();
  const groups = [
    ['Conversaciones abiertas', alive.filter(c => (g.chats[c.id] || []).length)],
    ['En guerra', alive.filter(c => relation(g, me, c.id) === 'war')],
    ['Aliados y súbditos', alive.filter(c => ['ally', 'subject', 'overlord'].includes(relation(g, me, c.id)))],
    ['Vecinos', alive.filter(c => nb.has(c.id))],
    ['Grandes potencias', alive.slice().sort((a, b) => st[b.id].provinces - st[a.id].provinces).slice(0, 12)],
    ['Todos los países', alive.slice().sort((a, b) => a.name.localeCompare(b.name, 'es'))],
  ];
  const shown = new Set();
  let html = '';
  for (const [title, list] of groups) {
    const items = list.filter(c => !shown.has(c.id));
    if (!items.length) continue;
    html += `<div class="diplo-group">${title}</div>`;
    for (const c of items) {
      shown.add(c.id);
      const r = relation(g, me, c.id);
      const unread = (g.chats[c.id] || []).some(m => m.unread);
      html += `<div class="country-row" data-id="${c.id}"><span class="swatch" style="background:${c.color}"></span>
        <span class="nm"><b>${esc(c.name)}</b><small>${esc(c.leader || c.gov || '')}</small></span>
        ${unread ? '<span class="unread"></span>' : ''}<span class="rel ${r}">${REL_TXT[r]}</span></div>`;
    }
  }
  $('#diplo-list').innerHTML = html || '<div class="empty">Ningún país coincide.</div>';
  $$('#diplo-list .country-row').forEach(r => r.onclick = () => openChat(r.dataset.id));
}

function openChat(id) {
  if (id === g.player) return;
  chatWith = id;
  setTab('diplo');
  renderChat();
  map.setFocus(id);
  setTimeout(() => $('#chat-input').focus(), 50);
}

function renderChat() {
  $('#diplo-list-view').classList.add('hidden');
  $('#chat-view').classList.remove('hidden');
  const c = g.countries[chatWith];
  const r = relation(g, g.player, chatWith);
  $('#chat-head').innerHTML = `<button id="chat-back" class="icon" title="Volver">←</button>
    <span class="swatch sw" style="background:${c.color};width:28px;height:28px"></span>
    <span class="who"><b>${esc(c.name)}</b><small>${esc(c.leader || 'Jefe de Estado')} · ${esc(c.gov || '')}</small></span>
    <span class="rel ${r}">${REL_TXT[r]}</span>`;
  $('#chat-back').onclick = () => { chatWith = null; map.setFocus(null); renderDiplo(); };
  const msgs = g.chats[chatWith] || [];
  let lastTurn = -1, html = '';
  for (const m of msgs) {
    if (m.turn !== lastTurn) { html += `<div class="turn-sep">${esc(m.date ? fmtDate(m.date) : '')}</div>`; lastTurn = m.turn; }
    html += `<div class="msg ${m.who}">${m.who === 'them' ? `<span class="meta">${esc(c.leader || c.name)}</span>` : ''}${esc(m.text)}</div>`;
    m.unread = false;
  }
  if (!msgs.length) html = `<div class="empty">Abre las negociaciones con ${esc(c.name)}: propón alianzas, la paz, acuerdos comerciales, cesiones territoriales… o lanza un ultimátum.</div>`;
  $('#chat-log').innerHTML = html;
  $('#chat-log').scrollTop = 1e9;
}

async function sendChat() {
  const t = $('#chat-input').value.trim();
  if (!t || !chatWith || busy) return;
  const id = chatWith;
  g.chats[id] = g.chats[id] || [];
  g.chats[id].push({ who: 'me', text: t, turn: g.turn, date: g.date });
  $('#chat-input').value = '';
  renderChat();
  const typing = document.createElement('div');
  typing.className = 'msg them typing';
  typing.textContent = `${g.countries[id].leader || g.countries[id].name} está escribiendo…`;
  $('#chat-log').appendChild(typing);
  $('#chat-log').scrollTop = 1e9;
  $('#btn-send').disabled = true;
  let reply;
  try {
    if (settings.provider === 'none') {
      await sleep(500 + Math.random() * 700);
      reply = offlineChat(g, world, id, t);
    } else {
      reply = await aiChat(settings, g, world, id);
    }
  } catch (e) {
    reply = null;
    toast(errText(e), true);
    // si falla la IA, el simulador local responde para no bloquear la partida
    reply = offlineChat(g, world, id, t);
  }
  $('#btn-send').disabled = false;
  g.chats[id].push({ who: 'them', text: reply.trim(), turn: g.turn, date: g.date, unread: chatWith !== id });
  if (chatWith === id) renderChat(); else renderDiplo();
  autosave();
}

// ── noticias ──────────────────────────────────────────────────────────────
function renderNews() {
  if (!g) return;
  if (!g.turns.length) {
    $('#news').innerHTML = `<div class="tab-head"><h3>Crónica del mundo</h3><p class="muted">Aquí aparecerán las noticias de cada turno.</p></div>
      <div class="note">${esc(g.context)}</div>`;
    return;
  }
  const html = g.turns.slice().reverse().map((t, k) => `
    <div class="turn-block">
      <header data-t="${g.turns.length - 1 - k}"><b>${fmtDate(t.date, true)} → ${fmtDate(t.dateTo, true)}</b><p>${esc(t.summary)}</p></header>
      <div class="events">${(t.events || []).map((e, j) => eventHTML(e, g.turns.length - 1 - k, j)).join('')}</div>
    </div>`).join('');
  $('#news').innerHTML = html;
  $$('#news .event').forEach(el => el.onclick = () => focusEvent(g.turns[+el.dataset.t].events[+el.dataset.e]));
  $$('#news .turn-block > header').forEach(h => h.onclick = () => showReport(g.turns[+h.dataset.t]));
}

function eventHTML(e, t, j) {
  const col = KIND_COLORS[e.kind] || '#999';
  const cs = (e.countries || []).map(id => g.countries[id] ? g.countries[id].name : id).join(' · ');
  return `<div class="event ${e.player ? 'mine' : ''}" data-t="${t}" data-e="${j}">
    <b><span class="k" style="background:${col}"></span>${esc(e.title)}</b>
    <small>${esc(e.date ? fmtDate(e.date) : '')}${e.place ? ' · ' + esc(e.place) : ''}${cs ? ' · ' + esc(cs) : ''}</small>
    <p>${esc(e.body)}</p></div>`;
}

function focusEvent(e) {
  let p = findProvince(world, e.place);
  if (p < 0 && e.countries && e.countries[0]) {
    const id = e.countries[0];
    if (g.countries[id]) { map.flyToCountry(id); return; }
  }
  if (p >= 0) {
    const P = world.provinces[p];
    map.flyTo(toX(P.clon), toY(P.clat), Math.max(map.cam.s, 4));
  }
}

// ── nación ────────────────────────────────────────────────────────────────
function renderNation() {
  if (!g) return;
  const id = selected && g.countries[selected] ? selected : g.player;
  const c = g.countries[id];
  const st = countryStats(g, world)[id];
  const me = g.player;
  const r = relation(g, me, id);
  const tag = (x) => `<span class="tag" data-id="${x}"><span class="sw" style="background:${g.countries[x].color}"></span>${esc(g.countries[x].name)}</span>`;
  const allies = alliesOf(g, id).filter(x => g.countries[x] && g.countries[x].alive);
  const enemies = enemiesOf(g, id);
  const blocs = g.alliances.filter(a => a.members.includes(id));
  const subjects = Object.values(g.countries).filter(x => x.alive && x.overlord === id).map(x => x.id);
  const wars = g.wars.filter(w => w.a === id || w.b === id);
  $('#nation').innerHTML = `
    <div class="nation-head"><div class="flag" style="background:${c.color}"></div>
      <div><h2>${esc(c.name)}</h2><small>${esc(c.gov || 'Gobierno')}${c.alive ? '' : ' · desaparecido'}</small></div></div>
    <div class="stats">
      <div class="stat"><small>Líder</small><b>${esc(c.leader || '—')}</b></div>
      <div class="stat"><small>Relación</small><b><span class="rel ${r}">${REL_TXT[r]}</span></b></div>
      <div class="stat"><small>Provincias</small><b>${st ? st.provinces : 0}</b></div>
      <div class="stat"><small>Población est.</small><b>${st ? fmtPop(estPopulation(st)) : '—'}</b></div>
      <div class="stat"><small>Superficie</small><b>${st ? Math.round(st.area / 1000).toLocaleString('es') + ' mil km²' : '—'}</b></div>
      <div class="stat"><small>Capital</small><b>${st && st.capital !== null ? esc(world.provinces[st.capital].name) : '—'}</b></div>
    </div>
    <div class="kv">
      ${c.overlord && g.countries[c.overlord] ? `<div><small>Bajo la tutela de</small><div class="tags">${tag(c.overlord)}</div></div>` : ''}
      ${subjects.length ? `<div><small>Súbditos</small><div class="tags">${subjects.map(tag).join('')}</div></div>` : ''}
      <div><small>Guerras</small><div class="tags">${wars.length ? wars.map(w => `<span class="tag" data-id="${w.a === id ? w.b : w.a}">⚔ ${esc(w.name || 'Guerra')} · ${esc(g.countries[w.a === id ? w.b : w.a].name)}</span>`).join('') : '<span class="muted">En paz</span>'}</div></div>
      <div><small>Bloques</small><div class="tags">${blocs.length ? blocs.map(a => `<span class="tag"><span class="sw" style="background:${a.color}"></span>${esc(a.name)} (${a.members.length})</span>`).join('') : '<span class="muted">Ninguno</span>'}</div></div>
      <div><small>Aliados</small><div class="tags">${allies.length ? allies.slice(0, 30).map(tag).join('') : '<span class="muted">Ninguno</span>'}</div></div>
      ${enemies.length ? `<div><small>Enemigos</small><div class="tags">${enemies.map(tag).join('')}</div></div>` : ''}
    </div>
    <div class="btn-row">
      ${id !== me && c.alive ? `<button id="btn-talk" class="primary">✉ Negociar</button>` : ''}
      <button id="btn-locate">⌖ Ver en el mapa</button>
      ${id !== me ? `<button id="btn-mine">Mi nación</button>` : ''}
    </div>`;
  $$('#nation .tag[data-id]').forEach(t => t.onclick = () => { selected = t.dataset.id; renderNation(); map.setFocus(selected); });
  if ($('#btn-talk')) $('#btn-talk').onclick = () => openChat(id);
  $('#btn-locate').onclick = () => map.flyToCountry(id);
  if ($('#btn-mine')) $('#btn-mine').onclick = () => { selected = me; map.setFocus(null); renderNation(); };
}

function renderLegend() {
  if (!g || !map) return;
  const m = map.mode;
  let html = '';
  if (m === 'diplomatic') {
    const items = [['self', 'Tu país'], ['ally', 'Aliados'], ['subject', 'Súbditos'], ['overlord', 'Señor'], ['war', 'En guerra'], ['neutral', 'Neutrales']];
    const C = { self: '#e9c46a', ally: '#57a773', subject: '#8fcf9f', overlord: '#4f8fd0', war: '#d1495b', neutral: '#9aa1ab' };
    html = items.map(([k, t]) => `<span><span class="sw" style="background:${C[k]}"></span>${t}</span>`).join('');
  } else if (m === 'alliances') {
    html = g.alliances.length ? g.alliances.map(a => `<span><span class="sw" style="background:${a.color}"></span>${esc(a.name)}</span>`).join('') : '<span>No hay bloques</span>';
  }
  $('#legend').innerHTML = html;
  $('#legend').classList.toggle('hidden', !html || state !== 'play');
}

// ── mapa ──────────────────────────────────────────────────────────────────
function onHover(p, x, y) {
  const tt = $('#tooltip');
  if (p < 0 || !g || state === 'scenario' || state === 'title') { tt.classList.add('hidden'); return; }
  const P = world.provinces[p], id = g.owner[p], c = g.countries[id];
  const r = g.player ? relation(g, g.player, id) : null;
  tt.innerHTML = `<b>${esc(c ? c.name : id)}</b><small>${esc(P.name)}${P.cap ? ' ★' : ''} · ${Math.round(P.area / 1000)} mil km²</small>` +
    (r && r !== 'self' ? `<small>${REL_TXT[r]}</small>` : '');
  tt.classList.remove('hidden');
  const w = tt.offsetWidth, h = tt.offsetHeight;
  tt.style.left = Math.min(window.innerWidth - w - 8, x + 14) + 'px';
  tt.style.top = Math.min(window.innerHeight - h - 8, y + 14) + 'px';
}

function onMapClick(p, e) {
  const mk = map.markerAt(e.offsetX, e.offsetY);
  if (mk && state === 'play') { showEventPopup(mk.event); return; }
  if (p < 0) { if (state === 'play') map.setFocus(null); return; }
  const id = g.owner[p];
  if (state === 'pick') { choosePick(id); return; }
  if (state === 'editor') { editorClick(p); return; }
  if (state !== 'play') return;
  selected = id;
  map.setFocus(id === g.player ? null : id);
  setTab('nation');
}

function showEventPopup(e) {
  openModal(`<div class="paper"><article class="${e.player ? 'mine' : ''}"><div class="dl">${esc(e.date ? fmtDate(e.date) : '')}${e.place ? ' · ' + esc(e.place) : ''}</div>
    <h4>${esc(e.title)}</h4><p>${esc(e.body)}</p></article></div>`);
}

// ── turnos ────────────────────────────────────────────────────────────────
const THINKING = [
  'Los embajadores cifran sus telegramas…', 'Los estados mayores despliegan sus mapas…',
  'Las rotativas imprimen la edición de mañana…', 'Los parlamentos debaten hasta el amanecer…',
  'Los mercados reaccionan a los rumores…', 'Las cancillerías estudian tus movimientos…',
  'Los generales mueven sus divisiones…', 'Los espías informan a sus gobiernos…',
];

async function advance() {
  if (busy || state !== 'play') return;
  if (!g.countries[g.player].alive) { toast('Tu nación ha desaparecido. Puedes rebobinar un turno o empezar una nueva partida.', true); return; }
  const jump = JUMPS.find(j => j.id === $('#jump').value) || JUMPS[1];
  const dateTo = addTime(g.date, jump);
  busy = true;
  $('#btn-advance').disabled = true;
  $('#thinking').classList.remove('hidden');
  $('#thinking-title').textContent = `${fmtDate(g.date)} → ${fmtDate(dateTo)}`;
  let k = 0;
  const tick = () => { $('#thinking-text').textContent = THINKING[k++ % THINKING.length]; };
  tick();
  const timer = setInterval(tick, 2600);

  const snap = snapshot(g);
  let res = null, usedOffline = false;
  try {
    if (settings.provider === 'none') {
      await sleep(900);
      res = offlineTurn(g, world, jump, dateTo);
      usedOffline = true;
    } else {
      res = await aiTurn(settings, g, world, jump, dateTo);
    }
  } catch (e) {
    clearInterval(timer);
    $('#thinking').classList.add('hidden');
    const choice = await confirmBox(`<h3>El director de juego no ha respondido</h3><p>${esc(errText(e))}</p>
      <p class="muted">Puedes reintentar o resolver este turno con el simulador local.</p>`, ['Reintentar', 'Usar simulador local', 'Cancelar']);
    busy = false;
    $('#btn-advance').disabled = false;
    if (choice === 0) return advance();
    if (choice !== 1) return;
    restore(g, snap);
    busy = true;
    res = offlineTurn(g, world, jump, dateTo);
    usedOffline = true;
  }
  clearInterval(timer);

  g.snapshots.push(snap);
  if (g.snapshots.length > 40) g.snapshots.splice(0, g.snapshots.length - 40);
  const log = applyChanges(g, world, res.changes);
  const turn = {
    turn: g.turn, date: g.date, dateTo, jump: jump.id,
    summary: res.summary, events: res.events, actions: g.actions.slice(), log, offline: usedOffline,
  };
  g.turns.push(turn);
  g.date = dateTo;
  g.turn++;
  g.actions = [];
  // los acuerdos de las negociaciones ya se aplicaron
  g.agreements = (g.agreements || []).filter(a => a.turn >= g.turn);

  $('#thinking').classList.add('hidden');
  busy = false;
  $('#btn-advance').disabled = false;
  map.refresh();
  map.flashProvinces(g.changed);
  map.setMarkers(res.events.filter(e => e.place).map(e => ({ prov: findProvince(world, e.place), kind: e.kind, event: e })).filter(m => m.prov >= 0));
  renderAll();
  autosave();
  showReport(turn);
}

function showReport(t) {
  const me = g.countries[g.player];
  const evs = (t.events || []).slice().sort((a, b) => (b.player ? 1 : 0) - (a.player ? 1 : 0));
  openModal(`
    <div class="paper">
      <div class="mast">
        <h1>La Crónica Mundial</h1>
        <div class="sub"><span>${fmtDate(t.date)}</span><span>Edición del turno ${t.turn + 1}</span><span>${fmtDate(t.dateTo)}</span></div>
      </div>
      <p class="lead">${esc(t.summary)}</p>
      <div class="cols">
        ${evs.map((e, i) => `<article class="${e.player ? 'mine' : ''}" data-i="${i}">
          <div class="dl">${esc(e.date ? fmtDate(e.date) : '')}${e.place ? ' · ' + esc(e.place) : ''}</div>
          <h4>${esc(e.title)}</h4><p>${esc(e.body)}</p></article>`).join('')}
      </div>
      ${t.log && t.log.length ? `<div class="changes"><b>Cambios en el mapa</b><ul>${t.log.map(l => `<li>${esc(l)}</li>`).join('')}</ul></div>` : ''}
    </div>
    <div class="paper-actions">
      ${t.offline && settings.provider !== 'none' ? '<span class="muted small">Turno resuelto por el simulador local.</span>' : ''}
      <button id="rep-ok" class="primary">Continuar gobernando ${esc(me.name)}</button>
    </div>`);
  $('#rep-ok').onclick = closeModal;
  $$('.paper article').forEach(a => a.onclick = () => { closeModal(); focusEvent(evs[+a.dataset.i]); });
}

// ── menú ──────────────────────────────────────────────────────────────────
function menuAction(a) {
  if (a === 'save') return saveAs();
  if (a === 'load') return openLoad();
  if (a === 'export') return exportFile();
  if (a === 'settings') return openSettings();
  if (a === 'help') return openHelp();
  if (a === 'rewind') return rewind();
  if (a === 'quit') {
    autosave();
    map.setFocus(null);
    map.setMarkers([]);
    state = 'title';
    showTitle();
  }
}

async function rewind() {
  if (!g.snapshots.length) { toast('No hay turnos anteriores a los que volver.'); return; }
  const ok = await confirmBox(`<h3>Rebobinar</h3><p>¿Volver al ${fmtDate(JSON.parse(g.snapshots[g.snapshots.length - 1]).date)}? Se perderá el último turno.</p>`, ['Rebobinar', 'Cancelar']);
  if (ok !== 0) return;
  restore(g, g.snapshots.pop());
  map.setMarkers([]);
  map.refresh();
  renderAll();
  autosave();
  toast('Has vuelto atrás en el tiempo.');
}

// ── guardado ──────────────────────────────────────────────────────────────
function autosave() {
  if (!g || !g.player) return;
  if (!store.setRaw('hm.save.auto', serialize(g))) {
    // sin espacio: se recortan las instantáneas más antiguas
    g.snapshots = g.snapshots.slice(-5);
    store.setRaw('hm.save.auto', serialize(g));
  }
}

function saveList() { return store.get('hm.saves', []); }

async function saveAs() {
  const name = await promptBox('Guardar partida', 'Nombre de la partida', `${g.countries[g.player].name} · ${fmtDate(g.date, true)}`);
  if (!name) return;
  const id = 's' + Date.now().toString(36);
  if (!store.setRaw('hm.save.' + id, serialize(g))) { toast('No hay espacio para guardar. Borra alguna partida antigua.', true); return; }
  const list = saveList();
  list.unshift({ id, name, date: g.date, player: g.countries[g.player].name, scenario: g.scenarioTitle, ts: Date.now() });
  store.set('hm.saves', list);
  toast('Partida guardada.');
}

function openLoad() {
  const list = saveList();
  const auto = store.raw('hm.save.auto');
  const rows = [];
  if (auto) {
    try {
      const a = JSON.parse(auto);
      rows.push({ id: 'auto', name: 'Autoguardado', date: a.date, player: a.countries[a.player].name, scenario: a.scenarioTitle });
    } catch { /* ignorar */ }
  }
  rows.push(...list);
  openModal(`<h2>Cargar partida</h2><div class="form">${rows.length ? rows.map(r => `
    <div class="save-row"><span class="nm"><b>${esc(r.name)}</b><small>${esc(r.player)} · ${fmtDate(r.date)} · ${esc(r.scenario)}</small></span>
    <button class="primary" data-load="${r.id}">Cargar</button>${r.id !== 'auto' ? `<button class="danger" data-del="${r.id}">Borrar</button>` : ''}</div>`).join('')
    : '<div class="empty">No hay partidas guardadas.</div>'}</div>`);
  $$('[data-load]').forEach(b => b.onclick = () => {
    const raw = store.raw('hm.save.' + b.dataset.load);
    if (!raw) { toast('No se encontró la partida.', true); return; }
    closeModal();
    resumeGame(deserialize(raw));
  });
  $$('[data-del]').forEach(b => b.onclick = () => {
    store.del('hm.save.' + b.dataset.del);
    store.set('hm.saves', saveList().filter(s => s.id !== b.dataset.del));
    openLoad();
  });
}

function exportFile() {
  const blob = new Blob([serialize(g)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `historia-mundi-${norm(g.countries[g.player].name).replace(/ /g, '-')}-${g.date}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function importFile(e) {
  const f = e.target.files[0];
  if (!f) return;
  f.text().then(txt => {
    try {
      const game = deserialize(txt);
      if (!game.owner || game.owner.length !== world.provinces.length) throw new Error('El archivo no corresponde a este mapa');
      resumeGame(game);
    } catch (err) {
      toast('No se pudo importar: ' + err.message, true);
    }
  });
  e.target.value = '';
}

// ── ajustes ───────────────────────────────────────────────────────────────
function openSettings() {
  const s = settings;
  openModal(`<h2>Ajustes de IA</h2>
    <div class="form">
      <div class="note">El director de juego puede ser un modelo de lenguaje: interpreta cualquier orden escrita, mueve al resto del mundo, redacta las noticias y da voz a los líderes en las negociaciones. La clave se guarda solo en este navegador y las peticiones van directamente de tu equipo al proveedor.</div>
      <label>Proveedor
        <select id="st-provider">${Object.entries(PROVIDERS).map(([k, v]) => `<option value="${k}" ${k === s.provider ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
      </label>
      <div id="st-ai" class="form">
        <label>Clave de API <input id="st-key" type="password" autocomplete="off" value="${esc(s.apiKey)}" placeholder="sk-…"></label>
        <label id="st-base-wrap">URL base (compatible con OpenAI) <input id="st-base" type="text" value="${esc(s.baseUrl)}"></label>
        <label>Modelo
          <input id="st-model" type="text" list="st-models" value="${esc(s.model)}">
          <datalist id="st-models">${PROVIDERS.anthropic.models.map(m => `<option value="${m}">`).join('')}</datalist>
        </label>
        <label id="st-effort-wrap">Profundidad de razonamiento
          <select id="st-effort">${['low', 'medium', 'high'].map(e => `<option value="${e}" ${e === s.effort ? 'selected' : ''}>${{ low: 'Baja (rápido)', medium: 'Media', high: 'Alta (más lento)' }[e]}</option>`).join('')}</select>
        </label>
      </div>
      <label>Estilo del mundo
        <select id="st-creat">${[['realista', 'Realista'], ['equilibrado', 'Equilibrado'], ['caotico', 'Caótico']].map(([k, v]) => `<option value="${k}" ${k === s.creativity ? 'selected' : ''}>${v}</option>`).join('')}</select>
      </label>
      <div class="row"><button id="st-save" class="primary">Guardar</button><button id="st-test">Probar conexión</button><span id="st-msg" class="muted small"></span></div>
    </div>`);
  const sync = () => {
    const p = $('#st-provider').value;
    $('#st-ai').classList.toggle('hidden', p === 'none');
    $('#st-base-wrap').classList.toggle('hidden', p !== 'openai');
    $('#st-effort-wrap').classList.toggle('hidden', p !== 'anthropic');
    if (p === 'anthropic' && !/^claude/.test($('#st-model').value)) $('#st-model').value = DEFAULT_SETTINGS.model;
  };
  $('#st-provider').onchange = sync;
  sync();
  const read = () => ({
    provider: $('#st-provider').value, apiKey: $('#st-key').value.trim(), model: $('#st-model').value.trim(),
    baseUrl: $('#st-base').value.trim(), effort: $('#st-effort').value, creativity: $('#st-creat').value,
  });
  $('#st-save').onclick = () => {
    settings = { ...settings, ...read() };
    store.set('hm.settings', settings);
    updateAIStatus();
    closeModal();
    toast('Ajustes guardados.');
  };
  $('#st-test').onclick = async () => {
    const t = read();
    if (t.provider === 'none') { $('#st-msg').textContent = 'El simulador local no necesita conexión.'; return; }
    $('#st-msg').textContent = 'Probando…';
    try {
      const r = await testConnection(t);
      $('#st-msg').textContent = '✓ Conectado: «' + r.slice(0, 40) + '»';
    } catch (e) {
      $('#st-msg').textContent = '✗ ' + errText(e);
    }
  };
}

function openHelp() {
  openModal(`<div class="help"><h2>Cómo se juega</h2>
    <p>Historia Mundi es un sandbox de historia alternativa. Eliges un país en un momento histórico y lo gobiernas como quieras: no hay árboles tecnológicos ni menús de decisiones, solo tus órdenes escritas y un mundo que reacciona.</p>
    <h3>1 · Da órdenes</h3>
    <p>En la pestaña <b>Acciones</b> escribe lo que hace tu gobierno, con tus propias palabras: «Invadir Polonia por el corredor de Danzig», «Nacionalizar el petróleo», «Proclamar la República Federal de Iberia», «Financiar a los rebeldes de Manchuria». Puedes añadir varias órdenes por turno.</p>
    <h3>2 · Negocia</h3>
    <p>En <b>Diplomacia</b> (o haciendo clic en un país y pulsando «Negociar») hablas directamente con sus líderes. Lo que acordéis —alianzas, paces, cesiones— se aplicará al avanzar el tiempo, si nadie traiciona a nadie.</p>
    <h3>3 · Avanza el tiempo</h3>
    <p>Elige el salto (de una semana a cinco años) y pulsa <b>Avanzar</b>. El director de juego resuelve tus órdenes, mueve al resto del mundo y publica <i>La Crónica Mundial</i> con lo ocurrido. Las fronteras cambian en el mapa y las provincias que cambian de manos parpadean.</p>
    <h3>4 · Explora</h3>
    <ul>
      <li>Arrastra para mover el mapa, rueda o pellizca para acercar. Con mucho zoom verás las provincias y sus ciudades.</li>
      <li>Modos de mapa: <b>Político</b>, <b>Diplomático</b> (tus amigos y enemigos) y <b>Alianzas</b>.</li>
      <li>Los puntos de colores marcan dónde ocurrieron las noticias del último turno.</li>
      <li>Si algo sale mal, <b>Rebobinar</b> deshace el último turno.</li>
    </ul>
    <h3>IA o simulador local</h3>
    <p>Con una clave de API (Ajustes de IA) el mundo lo dirige un modelo de lenguaje y todo es posible. Sin clave, un simulador local interpreta las órdenes más comunes (guerras, alianzas, paces, anexiones, reformas) y mantiene el mundo en movimiento.</p>
  </div>`);
}

// ── editor de escenarios ──────────────────────────────────────────────────
function openEditor(baseId = 'actual') {
  state = 'editor';
  show('#screen-editor');
  $('#ed-base').innerHTML = allScenarios().map(s => `<option value="${esc(s.id)}">${esc(s.title)} (${esc(s.year)})</option>`).join('');
  $('#ed-base').value = baseId;
  loadEditorBase(baseId);
}

function loadEditorBase(id) {
  const scn = getScenario(id);
  const eg = createGame(world, scn, null);
  edit = { tool: 'prov', brush: null, g: eg };
  g = eg;
  $('#ed-title').value = scn.custom ? scn.title : `${scn.title} (alternativo)`;
  $('#ed-date').value = scn.date;
  $('#ed-context').value = scn.context || '';
  map.focus = null;
  map.setMode('political');
  map.setGame(eg);
  map.setMarkers([]);
  const st = countryStats(eg, world);
  const first = Object.keys(st).sort((a, b) => st[b].provinces - st[a].provinces)[0];
  setBrush(first);
}

function setBrush(id) {
  if (!edit || !g.countries[id]) return;
  edit.brush = id;
  const c = g.countries[id];
  $('#ed-brush').innerHTML = `
    <div class="row"><input id="eb-color" type="color" value="${c.color}"><input id="eb-name" type="text" value="${esc(c.name)}"></div>
    <div class="row"><input id="eb-leader" type="text" placeholder="Líder" value="${esc(c.leader)}"><input id="eb-gov" type="text" placeholder="Gobierno" value="${esc(c.gov)}"></div>
    <small class="muted">Haz clic en el mapa para pintar con <b>${esc(c.name)}</b>.</small>`;
  const upd = () => {
    c.name = $('#eb-name').value.trim() || c.name;
    c.color = $('#eb-color').value;
    c.leader = $('#eb-leader').value.trim();
    c.gov = $('#eb-gov').value.trim();
    map.refresh();
  };
  ['#eb-color', '#eb-name', '#eb-leader', '#eb-gov'].forEach(sel => $(sel).onchange = upd);
  map.setFocus(id);
}

function editorClick(p) {
  const id = g.owner[p];
  if (edit.tool === 'pick') { setBrush(id); return; }
  if (!edit.brush || id === edit.brush) return;
  if (edit.tool === 'country') {
    for (let i = 0; i < g.owner.length; i++) if (g.owner[i] === id) g.owner[i] = edit.brush;
  } else {
    g.owner[p] = edit.brush;
  }
  const c = g.countries[edit.brush];
  c.alive = true;
  applyChanges(g, world, []);         // recalcula quién vive y limpia guerras y pactos huérfanos
  map._outlines = null;
  map.refresh();
}

function bindEditor() {
  $('#ed-base').onchange = (e) => loadEditorBase(e.target.value);
  $$('#edit-panel .tool').forEach(b => b.onclick = () => {
    $$('#edit-panel .tool').forEach(x => x.classList.toggle('active', x === b));
    edit.tool = b.dataset.tool;
  });
  $('#ed-search').oninput = (e) => {
    const q = norm(e.target.value);
    if (!q) { $('#ed-results').innerHTML = ''; return; }
    const res = Object.values(g.countries).filter(c => norm(c.name).includes(q)).slice(0, 10);
    $('#ed-results').innerHTML = res.map(c => `<div class="country-row" data-id="${c.id}"><span class="swatch" style="background:${c.color}"></span><span class="nm"><b>${esc(c.name)}</b><small>${c.alive ? '' : 'sin territorio'}</small></span></div>`).join('');
    $$('#ed-results .country-row').forEach(r => r.onclick = () => { setBrush(r.dataset.id); $('#ed-results').innerHTML = ''; $('#ed-search').value = ''; });
  };
  $('#ed-create').onclick = () => {
    const name = $('#ed-nname').value.trim();
    if (!name) { toast('Ponle nombre al nuevo país.', true); return; }
    let id = norm(name).replace(/ /g, '').toUpperCase().slice(0, 3) || 'NEW';
    let k = 2;
    while (g.countries[id]) id = id.slice(0, 2) + (k++);
    g.countries[id] = { id, name, color: $('#ed-ncolor').value, leader: $('#ed-nleader').value.trim(), gov: $('#ed-ngov').value.trim(), alive: false, overlord: null };
    $('#ed-nname').value = ''; $('#ed-nleader').value = ''; $('#ed-ngov').value = '';
    $('#ed-new').open = false;
    setBrush(id);
    toast(`${name} fundado. Pinta sus provincias en el mapa.`);
  };
  $('#ed-save').onclick = () => { const cs = saveCustom(); if (cs) toast(`Escenario «${cs.title}» guardado.`); };
  $('#ed-play').onclick = () => { const cs = saveCustom(); if (cs) startPick(cs.id); };
}

function saveCustom() {
  const date = $('#ed-date').value.trim();
  if (!/^-?\d{1,4}-\d{2}-\d{2}$/.test(date)) { toast('La fecha debe tener el formato AAAA-MM-DD.', true); return null; }
  const title = $('#ed-title').value.trim() || 'Escenario sin título';
  const countries = {};
  for (const c of Object.values(g.countries)) {
    if (!c.alive) continue;
    countries[c.id] = { id: c.id, name: c.name, color: c.color, leader: c.leader || '', gov: c.gov || '' };
  }
  const list = customList();
  const existing = edit.savedId && list.find(c => c.id === edit.savedId);
  const cs = {
    id: existing ? existing.id : 'c' + Date.now().toString(36),
    title, year: date.slice(0, date.indexOf('-', 1)).replace(/^0+/, '') || date.slice(0, 4), date,
    blurb: $('#ed-context').value.trim().slice(0, 240),
    context: $('#ed-context').value.trim() || `Escenario personalizado que comienza el ${date}.`,
    owner: g.owner.slice(), countries,
    wars: g.wars.map(w => ({ ...w })), alliances: g.alliances.map(a => ({ ...a, members: [...a.members] })),
    subjects: Object.values(g.countries).filter(c => c.alive && c.overlord && g.countries[c.overlord] && g.countries[c.overlord].alive).map(c => ({ overlord: c.overlord, subject: c.id })),
    featured: [],
  };
  const next = existing ? list.map(c => (c.id === cs.id ? cs : c)) : [...list, cs];
  if (!store.set('hm.customs', next)) { toast('No hay espacio para guardar el escenario.', true); return null; }
  edit.savedId = cs.id;
  return cs;
}

// ── utilidades de interfaz ────────────────────────────────────────────────
function openModal(html) {
  $('#modal-body').innerHTML = html;
  $('#modal').classList.remove('hidden');
  $('.modal-card').scrollTop = 0;
}
function closeModal() {
  $('#modal').classList.add('hidden');
  if (_modalResolve) { const r = _modalResolve; _modalResolve = null; r(-1); }
}
let _modalResolve = null;
function confirmBox(html, buttons) {
  return new Promise(res => {
    openModal(html + `<div class="paper-actions">${buttons.map((b, i) => `<button data-i="${i}" class="${i === 0 ? 'primary' : ''}">${esc(b)}</button>`).join('')}</div>`);
    _modalResolve = res;
    $$('#modal-body [data-i]').forEach(b => b.onclick = () => { _modalResolve = null; $('#modal').classList.add('hidden'); res(+b.dataset.i); });
  });
}
function promptBox(title, label, value) {
  return new Promise(res => {
    openModal(`<h2>${esc(title)}</h2><div class="form"><label>${esc(label)}<input id="pr-in" type="text" value="${esc(value)}"></label>
      <div class="row"><button id="pr-ok" class="primary">Aceptar</button></div></div>`);
    _modalResolve = () => res(null);
    const ok = () => { _modalResolve = null; const v = $('#pr-in').value.trim(); $('#modal').classList.add('hidden'); res(v || null); };
    $('#pr-ok').onclick = ok;
    $('#pr-in').onkeydown = (e) => { if (e.key === 'Enter') ok(); };
    setTimeout(() => $('#pr-in').select(), 30);
  });
}
function toast(msg, err = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), err ? 7000 : 4200);
}
function errText(e) {
  if (e instanceof AIError) {
    if (e.kind === 'auth') return 'La clave de API no es válida. Revísala en «Ajustes de IA».';
    if (e.kind === 'rate') return 'El proveedor limita la frecuencia de peticiones. Espera unos segundos.';
    return e.message;
  }
  return e && e.message ? e.message : String(e);
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// para la prueba automática del navegador
window.__hm = { get g() { return g; }, get world() { return world; }, get map() { return map; } };
