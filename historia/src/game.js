// Estado de la partida y las operaciones que lo cambian.
//
// El mundo estático (provincias, vecindades, costuras) vive en `world`; aquí
// solo está lo que cambia con la historia: de quién es cada provincia, qué
// Estados existen, quién está en guerra con quién y qué bloques hay. Todo lo
// que el director de juego (la IA o el simulador local) decide entra por
// applyChanges(), que acepta órdenes en un formato tolerante: nombres en lugar
// de códigos, ciudades en lugar de provincias, cantidades en palabras.

import { autoColor, colorDist, FIXED_COLORS, NEUTRAL, hexToRgb, rgbToHex } from './countries.js';
import { km, GW, lonToX, latToY } from './world.js';
import { CITIES } from '../../src/geodata.js';
import { EXONYMS } from './exonyms.js';

// ── fechas ────────────────────────────────────────────────────────────────
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function parseDate(s) {
  const m = String(s).match(/^(-?\d+)-(\d{1,2})-(\d{1,2})/);
  if (!m) return { y: 2000, m: 1, d: 1 };
  return { y: +m[1], m: +m[2], d: +m[3] };
}
/** Milisegundos desde 1970 para cualquier año (también 0-99 y antes de Cristo). */
export function dateToMs(s) {
  const { y, m, d } = parseDate(s);
  const dt = new Date(0);
  dt.setUTCFullYear(y, m - 1, d);
  dt.setUTCHours(0, 0, 0, 0);
  return dt.getTime();
}
export function msToDate(ms) {
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const ys = (y < 0 ? '-' : '') + String(Math.abs(y)).padStart(4, '0');
  return `${ys}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
const fmtYear = (y) => (y <= 0 ? `${1 - y} a. C.` : String(y));
export function fmtDate(s, short = false) {
  const { y, m, d } = parseDate(s);
  return short ? `${MESES[m - 1].slice(0, 3)} ${fmtYear(y)}` : `${d} de ${MESES[m - 1]} de ${fmtYear(y)}`;
}
export function addTime(s, jump) {
  const dt = new Date(dateToMs(s));
  if (jump.unit === 'day') dt.setUTCDate(dt.getUTCDate() + jump.n);
  else if (jump.unit === 'month') dt.setUTCMonth(dt.getUTCMonth() + jump.n);
  else if (jump.unit === 'year') dt.setUTCFullYear(dt.getUTCFullYear() + jump.n);
  return msToDate(dt.getTime());
}
export const JUMPS = [
  { id: '1w', label: '1 semana', unit: 'day', n: 7, months: 0.25 },
  { id: '1m', label: '1 mes', unit: 'month', n: 1, months: 1 },
  { id: '3m', label: '3 meses', unit: 'month', n: 3, months: 3 },
  { id: '6m', label: '6 meses', unit: 'month', n: 6, months: 6 },
  { id: '1y', label: '1 año', unit: 'year', n: 1, months: 12 },
  { id: '5y', label: '5 años', unit: 'year', n: 5, months: 60 },
];

// ── texto ─────────────────────────────────────────────────────────────────
const SPECIAL = { 'ł': 'l', 'Ł': 'L', 'ø': 'o', 'Ø': 'O', 'æ': 'ae', 'Æ': 'AE', 'œ': 'oe', 'ß': 'ss', 'đ': 'd', 'Đ': 'D', 'ı': 'i', 'ð': 'd', 'þ': 'th' };
export const norm = (s) => String(s || '').replace(/[łŁøØæÆœßđĐıðþ]/g, c => SPECIAL[c]).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ── creación ──────────────────────────────────────────────────────────────
export function createGame(world, scenario, player = null) {
  const provinces = world.provinces;
  const owner = new Array(provinces.length);
  const ne = (p) => world.neNames[p.cc] || '';
  for (const p of provinces) owner[p.id] = scenario.owner({ lon: p.clon, lat: p.clat, name: p.name }, ne(p), p);

  const countries = scenario.countries();
  // cualquier código que el escenario use sin definir recibe un nombre genérico
  for (const id of new Set(owner)) {
    if (!countries[id]) countries[id] = { id, name: id };
  }
  for (const c of Object.values(countries)) {
    c.alive = true;
    c.leader = c.leader || '';
    c.gov = c.gov || '';
    c.overlord = null;
    c.color = c.color || FIXED_COLORS[c.id] || null;
  }
  for (const s of scenario.subjects || []) {
    if (countries[s.subject]) countries[s.subject].overlord = s.overlord;
  }

  const g = {
    version: 1,
    scenario: scenario.id,
    scenarioTitle: scenario.title,
    context: scenario.context,
    date: scenario.date,
    turn: 0,
    player,
    owner,
    countries,
    wars: (scenario.wars || []).map(w => ({ ...w })),
    alliances: (scenario.alliances || []).map(a => ({ ...a, members: [...a.members] })),
    actions: [],          // órdenes del jugador pendientes para este turno
    chats: {},            // id → [{who:'me'|'them', text}]
    turns: [],            // historial: {turn,date,dateTo,events,actions,summary}
    snapshots: [],        // estado al comienzo de cada turno, para rebobinar
    changed: [],          // provincias que cambiaron de manos en el último turno
  };
  refreshAlive(g, world);
  assignColors(g, world);
  return g;
}

/** Colores automáticos que no se confundan con los de los vecinos. */
export function assignColors(g, world) {
  const nb = countryNeighbours(g, world);
  const ids = Object.keys(g.countries).sort();
  for (const id of ids) {
    const c = g.countries[id];
    if (c.color) continue;
    let best = null, bestScore = -1;
    for (let salt = 0; salt < 24; salt++) {
      const col = autoColor(id, salt);
      let worst = 1e9;
      for (const n of nb.get(id) || []) {
        const oc = g.countries[n] && g.countries[n].color;
        if (oc) worst = Math.min(worst, colorDist(col, oc));
      }
      if (worst > 160) { best = col; break; }
      if (worst > bestScore) { bestScore = worst; best = col; }
    }
    c.color = best;
  }
}

export function countryNeighbours(g, world) {
  const out = new Map();
  for (const p of world.provinces) {
    const a = g.owner[p.id];
    for (const q of p.nb) {
      const b = g.owner[q];
      if (a === b) continue;
      if (!out.has(a)) out.set(a, new Set());
      out.get(a).add(b);
    }
  }
  return out;
}

// ── consultas ─────────────────────────────────────────────────────────────
export function provincesOf(g, id) {
  const out = [];
  for (let i = 0; i < g.owner.length; i++) if (g.owner[i] === id) out.push(i);
  return out;
}

export function countryStats(g, world) {
  const st = {};
  for (const id of Object.keys(g.countries)) st[id] = { provinces: 0, area: 0, pop: 0, capital: null, capPop: -1 };
  for (const p of world.provinces) {
    const s = st[g.owner[p.id]];
    if (!s) continue;
    s.provinces++; s.area += p.area; s.pop += p.pop;
    // capital: la provincia que fue capital de Estado, o la más poblada
    const score = p.pop * (p.cap ? 4 : 1);
    if (score > s.capPop) { s.capPop = score; s.capital = p.id; }
  }
  return st;
}

/** Población estimada: las cifras de las ciudades son solo los núcleos urbanos. */
export function estPopulation(stat) {
  return Math.round(stat.pop * 2.6 + stat.area * 8);
}

export function atWar(g, a, b) {
  return g.wars.some(w => (w.a === a && w.b === b) || (w.a === b && w.b === a));
}
export function enemiesOf(g, id) {
  return g.wars.filter(w => w.a === id || w.b === id).map(w => (w.a === id ? w.b : w.a));
}
export function alliesOf(g, id) {
  const s = new Set();
  for (const a of g.alliances) if (a.members.includes(id)) for (const m of a.members) if (m !== id) s.add(m);
  for (const c of Object.values(g.countries)) {
    if (c.overlord === id) s.add(c.id);
    if (g.countries[id] && g.countries[id].overlord === c.id) s.add(c.id);
  }
  return [...s];
}
export function relation(g, a, b) {
  if (a === b) return 'self';
  if (atWar(g, a, b)) return 'war';
  if (g.countries[b] && g.countries[b].overlord === a) return 'subject';
  if (g.countries[a] && g.countries[a].overlord === b) return 'overlord';
  if (alliesOf(g, a).includes(b)) return 'ally';
  return 'neutral';
}

// ── búsqueda tolerante de países y provincias ─────────────────────────────
export function findCountry(g, ref) {
  if (!ref) return null;
  if (typeof ref === 'object') ref = ref.id || ref.name;
  const r = String(ref).trim();
  if (g.countries[r]) return r;
  const up = r.toUpperCase();
  if (g.countries[up]) return up;
  const n = norm(r);
  let partial = null;
  for (const c of Object.values(g.countries)) {
    const cn = norm(c.name);
    if (cn === n) return c.id;
    if (!partial && n.length > 3 && (cn.includes(n) || n.includes(cn)) && c.alive) partial = c.id;
  }
  return partial;
}

let _provIndex = null;
function provIndex(world) {
  if (_provIndex && _provIndex.world === world) return _provIndex;
  const byName = new Map();
  for (const p of world.provinces) byName.set(norm(p.name), p.id);
  const byCity = new Map();
  for (const c of CITIES) {
    const k = norm(c.n);
    if (!byCity.has(k)) byCity.set(k, c);
  }
  _provIndex = { world, byName, byCity };
  return _provIndex;
}

/** Provincia por nombre de provincia o de cualquier ciudad que caiga dentro. */
export function findProvince(world, ref) {
  if (ref === null || ref === undefined) return -1;
  if (typeof ref === 'number') return ref >= 0 && ref < world.provinces.length ? ref : -1;
  const idx = provIndex(world);
  const n = norm(ref);
  if (idx.byName.has(n)) return idx.byName.get(n);
  const c = idx.byCity.get(n);
  if (c) return provinceAt(world, c.x, c.y);
  // «Moscú» → «Moscow»: algunos exónimos frecuentes
  const alias = EXONYMS[n];
  if (alias) return findProvince(world, alias);
  return -1;
}

export function provinceAt(world, lon, lat) {
  const x = lonToX(lon), y = latToY(lat);
  if (y < 0 || y >= world.GH) return -1;
  const p = world.prov[y * GW + ((x % GW) + GW) % GW];
  if (p >= 0) return p;
  // ciudades costeras que caen en el agua: la provincia más cercana
  let best = -1, bd = 1e9;
  for (const q of world.provinces) {
    const d = km(q.lon, q.lat, lon, lat);
    if (d < bd) { bd = d; best = q.id; }
  }
  return bd < 300 ? best : -1;
}



// ── vida de los Estados ───────────────────────────────────────────────────
export function refreshAlive(g, world) {
  const has = new Set(g.owner);
  const died = [];
  for (const c of Object.values(g.countries)) {
    const alive = has.has(c.id);
    if (c.alive && !alive) died.push(c.id);
    c.alive = alive;
  }
  if (died.length) {
    const dead = new Set(died);
    g.wars = g.wars.filter(w => !dead.has(w.a) && !dead.has(w.b));
    for (const a of g.alliances) a.members = a.members.filter(m => !dead.has(m));
    g.alliances = g.alliances.filter(a => a.members.length >= 2);
    for (const c of Object.values(g.countries)) if (dead.has(c.overlord)) c.overlord = null;
  }
  return died;
}

// ── geometría de las conquistas ───────────────────────────────────────────
// Cantidades en palabras: un tope absoluto y una fracción del total, lo que sea
// menor, para que «pocas» no signifique dieciséis provincias de un imperio.
const AMOUNTS = {
  minimal: [1, 0.1], few: [3, 0.25], some: [6, 0.45], many: [12, 0.7], most: [Infinity, 0.65], all: [Infinity, 1],
};
const AMOUNT_WORDS = {
  minimo: 'minimal', minimal: 'minimal', tiny: 'minimal', 'poco': 'few', pocas: 'few', few: 'few', small: 'few',
  algunas: 'some', some: 'some', medium: 'some', moderate: 'some', muchas: 'many', many: 'many',
  large: 'many', major: 'many', mayoria: 'most', most: 'most', huge: 'most', todo: 'all', todas: 'all',
  all: 'all', total: 'all', complete: 'all',
};

function amountToCount(amount, total) {
  if (typeof amount === 'number' && isFinite(amount)) {
    if (amount > 0 && amount < 1) return Math.max(1, Math.round(total * amount));
    return Math.max(1, Math.min(total, Math.round(amount)));
  }
  const key = AMOUNT_WORDS[norm(amount)] || 'some';
  const [abs, frac] = AMOUNTS[key];
  return Math.max(1, Math.min(total, abs, Math.ceil(total * frac)));
}

/**
 * Elige `count` provincias de `defender` que pasarían a `attacker`: avanza
 * desde la frontera común hacia el objetivo, de forma contigua, como un frente
 * que se desplaza. Si no comparten frontera (ultramar) desembarca en la
 * provincia enemiga más cercana al objetivo o a la costa propia.
 */
export function pickFront(g, world, attacker, defender, count, target = -1, helpers = []) {
  const P = world.provinces;
  const own = new Set([attacker, ...helpers]);
  const cand = new Map();               // provincia → puntuación
  const tp = target >= 0 ? P[target] : null;
  // las capitales resisten más, salvo que sean el objetivo declarado
  const score = (q, hop) => (tp ? km(P[q].clon, P[q].clat, tp.clon, tp.clat) / 150 : 0) + hop + (P[q].cap && q !== target ? 1.2 : 0);

  let anchors = [];
  for (let i = 0; i < g.owner.length; i++) {
    if (g.owner[i] !== defender) continue;
    const touch = [...P[i].nb].some(q => own.has(g.owner[q]));
    if (touch) anchors.push(i);
  }
  if (!anchors.length) {
    // por mar
    for (let i = 0; i < g.owner.length; i++) {
      if (g.owner[i] !== defender) continue;
      if ((world.sea[i] || []).some(q => own.has(g.owner[q]))) anchors.push(i);
    }
  }
  if (!anchors.length) {
    // desembarco lejano: la provincia enemiga más cercana al objetivo (o a la capital enemiga)
    const mine = provincesOf(g, defender);
    if (!mine.length) return [];
    let ref = tp;
    if (!ref) {
      const ap = provincesOf(g, attacker);
      if (ap.length) {
        let bd = 1e9, best = mine[0];
        for (const i of mine) for (const j of ap.slice(0, 40)) {
          const d = km(P[i].clon, P[i].clat, P[j].clon, P[j].clat);
          if (d < bd) { bd = d; best = i; }
        }
        anchors = [best];
      } else anchors = [mine[0]];
    } else {
      let bd = 1e9, best = mine[0];
      for (const i of mine) {
        const d = km(P[i].clon, P[i].clat, ref.clon, ref.clat);
        if (d < bd) { bd = d; best = i; }
      }
      anchors = [best];
    }
  }
  for (const a of anchors) cand.set(a, score(a, 0));
  const hop = new Map(anchors.map(a => [a, 0]));
  const taken = [];
  const takenSet = new Set();
  while (taken.length < count && cand.size) {
    let best = -1, bs = 1e18;
    for (const [q, s] of cand) if (s < bs) { bs = s; best = q; }
    cand.delete(best);
    taken.push(best); takenSet.add(best);
    const h = hop.get(best) + 1;
    for (const q of [...P[best].nb, ...(world.sea[best] || [])]) {
      if (g.owner[q] !== defender || takenSet.has(q) || cand.has(q)) continue;
      hop.set(q, h);
      cand.set(q, score(q, h));
    }
  }
  return taken;
}

/** Provincias alrededor de un punto dentro de un país (para independencias). */
export function pickAround(g, world, country, center, count) {
  const P = world.provinces;
  let start = center;
  if (start < 0 || g.owner[start] !== country) {
    const mine = provincesOf(g, country);
    if (!mine.length) return [];
    if (start >= 0) {
      let bd = 1e9;
      for (const i of mine) {
        const d = km(P[i].clon, P[i].clat, P[start].clon, P[start].clat);
        if (d < bd) { bd = d; start = i; }
      }
    } else start = mine[mine.length >> 1];
  }
  const out = [start], seen = new Set(out);
  for (let i = 0; i < out.length && out.length < count; i++) {
    const nbs = [...P[out[i]].nb].filter(q => g.owner[q] === country && !seen.has(q))
      .sort((a, b) => km(P[a].clon, P[a].clat, P[start].clon, P[start].clat) - km(P[b].clon, P[b].clat, P[start].clon, P[start].clat));
    for (const q of nbs) {
      if (out.length >= count) break;
      seen.add(q); out.push(q);
    }
  }
  return out;
}

// ── aplicación de cambios ─────────────────────────────────────────────────
function newId(g, name) {
  let base = norm(name).replace(/ /g, '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || 'NEW';
  while (base.length < 3) base += 'X';
  let id = base, k = 2;
  while (g.countries[id]) id = base.slice(0, 2) + (k++);
  return id;
}

function ensureCountry(g, world, ch, fallbackName) {
  let id = findCountry(g, ch.id) || findCountry(g, ch.name);
  if (id && g.countries[id] && (g.countries[id].alive || ch.revive !== false)) return id;
  const name = ch.name || fallbackName || ch.id || 'Nuevo Estado';
  id = (ch.id && /^[A-Z0-9]{2,5}$/.test(ch.id) && !g.countries[ch.id]) ? ch.id : newId(g, name);
  g.countries[id] = {
    id, name, alive: true,
    leader: ch.leader || '', gov: ch.government || ch.gov || '',
    color: validColor(ch.color) || null, overlord: null,
  };
  return id;
}

function validColor(c) {
  return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c.toLowerCase() : null;
}

/**
 * Aplica la lista de cambios del director de juego. Devuelve un registro
 * legible de lo que de verdad ocurrió (los cambios imposibles se ignoran).
 */
export function applyChanges(g, world, changes) {
  const log = [];
  const changed = new Set();
  const give = (ids, to) => {
    let n = 0;
    for (const i of ids) {
      if (i < 0 || g.owner[i] === to) continue;
      g.owner[i] = to; changed.add(i); n++;
    }
    return n;
  };
  for (const raw of changes || []) {
    if (!raw || typeof raw !== 'object') continue;
    const ch = raw;
    const type = norm(ch.type).replace(/ /g, '_');
    try {
      switch (type) {
        case 'conquer': case 'occupy': case 'advance': case 'invade': {
          const a = findCountry(g, ch.attacker || ch.by || ch.to), d = findCountry(g, ch.defender || ch.from || ch.target);
          if (!a || !d || a === d) break;
          const total = provincesOf(g, d).length;
          if (!total) break;
          let ids = [];
          if (Array.isArray(ch.provinces) && ch.provinces.length) {
            ids = ch.provinces.map(r => findProvince(world, r)).filter(i => i >= 0 && g.owner[i] === d);
          }
          if (!ids.length) {
            const target = findProvince(world, ch.toward || ch.target_city || ch.region);
            const helpers = alliesOf(g, a).filter(x => atWar(g, x, d));
            ids = pickFront(g, world, a, d, amountToCount(ch.amount ?? ch.count ?? 'some', total), target, helpers);
          }
          const n = give(ids, a);
          if (n) log.push(`${g.countries[a].name} toma ${n} provincia${n > 1 ? 's' : ''} de ${g.countries[d].name}`);
          break;
        }
        case 'transfer': case 'cede': {
          const from = findCountry(g, ch.from), to = ensureCountry(g, world, { id: ch.to, name: ch.to_name || ch.to });
          if (!to) break;
          let ids = (ch.provinces || []).map(r => findProvince(world, r)).filter(i => i >= 0 && (!from || g.owner[i] === from));
          if (!ids.length && from && (ch.amount || ch.count)) {
            ids = pickFront(g, world, to, from, amountToCount(ch.amount ?? ch.count, provincesOf(g, from).length), findProvince(world, ch.toward));
          }
          const n = give(ids, to);
          if (n) log.push(`${n} provincia${n > 1 ? 's' : ''} pasa${n > 1 ? 'n' : ''} a ${g.countries[to].name}`);
          break;
        }
        case 'annex': case 'annexation': case 'merge': case 'unify': {
          const by = findCountry(g, ch.by || ch.into || ch.attacker);
          const targets = [].concat(ch.country || ch.countries || ch.target || []).map(r => findCountry(g, r)).filter(Boolean);
          if (!by) break;
          for (const t of targets) {
            if (t === by) continue;
            const n = give(provincesOf(g, t), by);
            if (n) log.push(`${g.countries[by].name} se anexiona ${g.countries[t].name}`);
          }
          break;
        }
        case 'new_country': case 'independence': case 'secession': case 'split': case 'revolt': case 'puppet': case 'create_country': {
          const from = findCountry(g, ch.from || ch.parent);
          const id = ensureCountry(g, world, { ...ch, revive: true }, ch.name);
          const c = g.countries[id];
          if (ch.name) c.name = ch.name;
          if (ch.leader) c.leader = ch.leader;
          if (ch.government || ch.gov) c.gov = ch.government || ch.gov;
          if (validColor(ch.color)) c.color = validColor(ch.color);
          let ids = (ch.provinces || []).map(r => findProvince(world, r)).filter(i => i >= 0 && (!from || g.owner[i] === from));
          if (!ids.length && from) {
            const total = provincesOf(g, from).length;
            ids = pickAround(g, world, from, findProvince(world, ch.around || ch.capital || ch.center), amountToCount(ch.size ?? ch.amount ?? 'few', total));
          }
          if (ch.overlord || type === 'puppet') {
            const ov = findCountry(g, ch.overlord || ch.by);
            if (ov) c.overlord = ov;
          }
          const n = give(ids, id);
          if (n) log.push(`Nace ${c.name} (${n} provincia${n > 1 ? 's' : ''})`);
          break;
        }
        case 'rename': case 'update_country': case 'government': case 'leader': case 'reform': {
          const id = findCountry(g, ch.country || ch.id || ch.target);
          if (!id) break;
          const c = g.countries[id];
          const old = c.name;
          if (ch.new_name || ch.name) c.name = ch.new_name || (findCountry(g, ch.name) === id ? c.name : ch.name);
          if (ch.leader) c.leader = ch.leader;
          if (ch.government || ch.gov) c.gov = ch.government || ch.gov;
          if (validColor(ch.color)) c.color = validColor(ch.color);
          if (c.name !== old) log.push(`${old} pasa a llamarse ${c.name}`);
          break;
        }
        case 'war': case 'declare_war': {
          const a = findCountry(g, ch.a || ch.attacker || ch.by), b = findCountry(g, ch.b || ch.defender || ch.target);
          if (!a || !b || a === b || atWar(g, a, b)) break;
          // la guerra rompe cualquier alianza entre ambos
          for (const al of g.alliances) if (al.members.includes(a) && al.members.includes(b)) al.members = al.members.filter(m => m !== a);
          g.wars.push({ a, b, name: ch.name || `Guerra ${adj(g, a)}-${adj(g, b)}`, since: g.date });
          log.push(`${g.countries[a].name} declara la guerra a ${g.countries[b].name}`);
          break;
        }
        case 'peace': case 'ceasefire': case 'armistice': case 'end_war': {
          const a = findCountry(g, ch.a || ch.attacker), b = findCountry(g, ch.b || ch.defender);
          if (!a || !b) break;
          const before = g.wars.length;
          g.wars = g.wars.filter(w => !((w.a === a && w.b === b) || (w.a === b && w.b === a)));
          if (g.wars.length < before) log.push(`Paz entre ${g.countries[a].name} y ${g.countries[b].name}`);
          break;
        }
        case 'alliance': case 'join_alliance': case 'pact': case 'treaty': {
          const members = [].concat(ch.members || [], ch.a || [], ch.b || [], ch.country || []).map(r => findCountry(g, r)).filter(Boolean);
          const uniq = [...new Set(members)];
          let al = ch.alliance || ch.name ? g.alliances.find(x => norm(x.name) === norm(ch.alliance || ch.name) || x.id === ch.alliance) : null;
          if (al) {
            const add = uniq.filter(m => !al.members.includes(m));
            al.members.push(...add);
            if (add.length) log.push(`${add.map(m => g.countries[m].name).join(', ')} se une${add.length > 1 ? 'n' : ''} a ${al.name}`);
          } else if (uniq.length >= 2) {
            for (const m of uniq) for (const n of uniq) if (m < n && atWar(g, m, n)) g.wars = g.wars.filter(w => !((w.a === m && w.b === n) || (w.a === n && w.b === m)));
            const name = ch.name || ch.alliance || `Pacto ${adj(g, uniq[0])}-${adj(g, uniq[1])}`;
            g.alliances.push({ id: newAllianceId(g), name, color: validColor(ch.color) || autoColor(name), members: uniq, since: g.date });
            log.push(`Nace ${name}: ${uniq.map(m => g.countries[m].name).join(', ')}`);
          }
          break;
        }
        case 'leave_alliance': case 'break_alliance': {
          const who = findCountry(g, ch.country || ch.a);
          const al = g.alliances.find(x => norm(x.name) === norm(ch.alliance || ch.name) || x.id === ch.alliance)
            || (ch.b ? g.alliances.find(x => x.members.includes(who) && x.members.includes(findCountry(g, ch.b))) : null);
          if (!who || !al) break;
          al.members = al.members.filter(m => m !== who);
          log.push(`${g.countries[who].name} abandona ${al.name}`);
          g.alliances = g.alliances.filter(x => x.members.length >= 2);
          break;
        }
        case 'subject': case 'vassal': case 'protectorate': {
          const s = findCountry(g, ch.subject || ch.country), o = findCountry(g, ch.overlord || ch.by);
          if (!s || !o || s === o) break;
          g.countries[s].overlord = o;
          log.push(`${g.countries[s].name} queda bajo la tutela de ${g.countries[o].name}`);
          break;
        }
        case 'release': case 'free': case 'end_subject': {
          const s = findCountry(g, ch.subject || ch.country);
          if (!s || !g.countries[s].overlord) break;
          g.countries[s].overlord = null;
          log.push(`${g.countries[s].name} recupera su plena soberanía`);
          break;
        }
        default: break;
      }
    } catch (e) {
      console.warn('cambio ignorado', ch, e);
    }
  }
  const died = refreshAlive(g, world);
  for (const d of died) log.push(`${g.countries[d].name} deja de existir`);
  assignColors(g, world);
  g.changed = [...changed];
  return log;
}

function newAllianceId(g) {
  let k = g.alliances.length + 1;
  while (g.alliances.some(a => a.id === 'A' + k)) k++;
  return 'A' + k;
}

/** Adjetivo corto para nombrar guerras y pactos: «germano», «franco»… */
function adj(g, id) {
  const n = (g.countries[id] && g.countries[id].name) || id;
  const A = { 'Alemania': 'germano', 'Francia': 'franco', 'Reino Unido': 'británico', 'Italia': 'italo',
    'Reino de Italia': 'italo', 'España': 'hispano', 'República Española': 'hispano', 'Rusia': 'ruso',
    'Unión Soviética': 'soviético', 'Estados Unidos': 'estadounidense', 'China': 'chino',
    'República de China': 'chino', 'Japón': 'japonés', 'Imperio del Japón': 'japonés', 'Polonia': 'polaco',
    'Turquía': 'turco', 'Grecia': 'greco', 'México': 'mexicano', 'Portugal': 'luso', 'Austria': 'austro',
    'Hungría': 'húngaro', 'Ucrania': 'ucraniano', 'India': 'indio', 'Pakistán': 'pakistaní', 'Irán': 'iraní' };
  return A[n] || n.split(' ').slice(-1)[0];
}

// ── historial: instantáneas para rebobinar ────────────────────────────────
export function snapshot(g) {
  return JSON.stringify({
    date: g.date, turn: g.turn, owner: g.owner, countries: g.countries,
    wars: g.wars, alliances: g.alliances, chats: g.chats, actions: g.actions,
    turnsLen: g.turns.length,
  });
}
export function restore(g, snap) {
  const s = JSON.parse(snap);
  g.date = s.date; g.turn = s.turn; g.owner = s.owner; g.countries = s.countries;
  g.wars = s.wars; g.alliances = s.alliances; g.chats = s.chats || {}; g.actions = s.actions || [];
  g.turns = g.turns.slice(0, s.turnsLen);
  g.changed = [];
}

export function serialize(g) {
  return JSON.stringify(g);
}
export function deserialize(txt) {
  const g = JSON.parse(txt);
  g.changed = g.changed || [];
  return g;
}

/** Mezcla de color para súbditos: el color propio teñido del de su señor. */
export function tint(a, b, t) {
  const x = hexToRgb(a), y = hexToRgb(b);
  return rgbToHex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
}
export { NEUTRAL };
