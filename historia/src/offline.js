// Simulador local: el director de juego cuando no hay modelo de lenguaje.
//
// No pretende igualar a la IA en imaginación, pero mantiene el mundo vivo con
// reglas sencillas: interpreta las órdenes del jugador por palabras clave,
// resuelve las guerras según la fuerza de cada bando (población, territorio,
// aliados y esfuerzo militar), hace que los demás Estados firmen pactos, se
// peleen, se fragmenten o cambien de gobierno, y redacta las noticias.

import {
  countryStats, estPopulation, atWar, enemiesOf, alliesOf, relation, provincesOf,
  findCountry, findProvince, norm, pickFront, fmtDate, countryNeighbours, addTime, parseDate, dateToMs, msToDate,
} from './game.js';
import { km } from './world.js';

// ── azar reproducible por partida y turno ─────────────────────────────────
function rngFor(g) {
  let s = (hashStr(g.scenario + g.date + g.turn) ^ 0x9e3779b9) >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

// ── fuerza ────────────────────────────────────────────────────────────────
function mods(g, id) {
  g.mods = g.mods || {};
  if (!g.mods[id]) g.mods[id] = { mil: 1, eco: 1, stab: 1 };
  return g.mods[id];
}
function power(g, st, id) {
  const s = st[id];
  if (!s || !s.provinces) return 0;
  const m = mods(g, id);
  return Math.pow(estPopulation(s), 0.55) * (0.6 + 0.4 * Math.sqrt(s.provinces)) * m.mil * (0.7 + 0.3 * m.eco) * (0.6 + 0.4 * m.stab);
}
function sidePower(g, st, id, enemy) {
  let p = power(g, st, id);
  for (const a of alliesOf(g, id)) {
    // los aliados empujan si también combaten al mismo enemigo
    if (atWar(g, a, enemy)) p += power(g, st, a) * 0.8;
  }
  return p;
}

/** Potencias con ganas de cambiar el mapa en cada escenario. */
const HAWKS = {
  1936: ['GER', 'ITA', 'JPN', 'SOV', 'MAN'],
  actual: ['RUS', 'CHN', 'PRK', 'IRN', 'AZE', 'ISR', 'TUR', 'VEN'],
};

// ── fechas dentro del turno ───────────────────────────────────────────────
function dateIn(r, from, to) {
  const a = dateToMs(from), b = dateToMs(to);
  return msToDate(a + r() * Math.max(0, b - a));
}

// ── lectura de órdenes ────────────────────────────────────────────────────
const KW = {
  war: /\b(declar\w* (la )?guerra|guerra (a|contra)|invad\w*|invasion|atac\w*|conquist\w*|ocupa\w*|ofensiva|bombarde\w*|war|invade|attack|conquer)\b/,
  peace: /\b(paz|armisticio|tregua|alto el fuego|cese (al|el) fuego|rendicion|peace|ceasefire|truce)\b/,
  alliance: /\b(alianza|aliar\w*|aliad\w*|pacto|coalicion|defensa mutua|alliance|ally)\b/,
  annex: /\b(anex\w*|unific\w*|absorb\w*|reunific\w*|annex|unify)\b/,
  release: /\b(independencia|liberar|descoloniz\w*|autonomia|release|independence)\b/,
  vassal: /\b(protectorado|vasall\w*|titere|satelite|puppet|vassal)\b/,
  mil: /\b(ejercito|rearm\w*|militar\w*|moviliz\w*|reclut\w*|tanques|flota|armada|aviacion|fuerza aerea|defensa|fortific\w*|army|military|navy)\b/,
  eco: /\b(econom\w*|industria\w*|fabrica\w*|comercio|infraestructura\w*|ferrocarril\w*|carretera\w*|inversion\w*|impuesto\w*|plan quinquenal|new deal|reforma agraria|tecnolog\w*|ciencia|investigacion|educacion|economy|industry|trade)\b/,
  stab: /\b(estabilidad|propaganda|elecciones|constitucion|reforma\w*|represion|policia|unidad nacional|bienestar|sanidad|salud|amnistia|purga\w*|stability)\b/,
  rename: /\b(renombr\w*|cambiar (el )?nombre|proclam\w*|rename)\b/,
};

/** Países que menciona un texto (por nombre o por ciudades suyas). */
function mentioned(g, world, text) {
  const t = ' ' + norm(text) + ' ';
  const out = [];
  for (const c of Object.values(g.countries)) {
    if (!c.alive || c.id === g.player) continue;
    const n = norm(c.name);
    const short = n.replace(/^(republica|reino|imperio|union) (de |del )?(la |los |las )?/, '');
    if (t.includes(' ' + n + ' ') || (short.length > 3 && t.includes(' ' + short + ' '))) out.push(c.id);
  }
  // adjetivos y gentilicios frecuentes
  for (const [re, name] of DEMONYMS) if (re.test(t)) { const id = findCountry(g, name); if (id && id !== g.player && !out.includes(id)) out.push(id); }
  return out;
}
const DEMONYMS = [
  [/ (aleman\w*|germano\w*|reich) /, 'Alemania'], [/ (frances\w*|galo\w*) /, 'Francia'],
  [/ (britanic\w*|ingles\w*|inglaterra) /, 'Reino Unido'], [/ (italian\w*) /, 'Italia'],
  [/ (sovietic\w*|urss) /, 'Unión Soviética'], [/ (rus[oa]s?) /, 'Rusia'], [/ (estadounidense\w*|eeuu|ee uu|norteamerican\w*|yanqui\w*) /, 'Estados Unidos'],
  [/ (japones\w*|nipon\w*) /, 'Japón'], [/ (chin[oa]s?) /, 'China'], [/ (polac[oa]s?) /, 'Polonia'],
  [/ (espanol\w*) /, 'España'], [/ (portugues\w*) /, 'Portugal'], [/ (turc[oa]s?|otoman\w*) /, 'Turquía'],
  [/ (mexican\w*) /, 'México'], [/ (argentin\w*) /, 'Argentina'], [/ (brasilen\w*) /, 'Brasil'],
  [/ (ucranian\w*) /, 'Ucrania'], [/ (indi[oa]s?|hindu\w*) /, 'India'],
];

/** Provincia citada en el texto (por su ciudad), si la hay. */
function mentionedProvince(world, text) {
  const words = norm(text).split(' ');
  for (let len = 3; len >= 1; len--) {
    for (let i = 0; i + len <= words.length; i++) {
      const w = words.slice(i, i + len).join(' ');
      if (w.length < 4) continue;
      const p = findProvince(world, w);
      if (p >= 0) return p;
    }
  }
  return -1;
}

// ── plantillas de noticias ────────────────────────────────────────────────
const T = {
  warDecl: [
    '{A} declara la guerra a {B}',
    'Estalla la guerra entre {A} y {B}',
    'Las tropas de {A} cruzan la frontera de {B}',
  ],
  warBody: [
    'El gobierno de {A} ha anunciado esta mañana el inicio de las hostilidades contra {B}. Las cancillerías de medio mundo convocan reuniones de urgencia mientras las primeras columnas se ponen en marcha.',
    'Tras semanas de tensión creciente, {A} ha roto relaciones con {B} y ha ordenado la movilización general. La comunidad internacional observa con inquietud.',
  ],
  advance: [
    'Ofensiva de {A}: cae {P}',
    '{A} avanza sobre territorio de {B}',
    'El frente se rompe: {A} toma {P}',
  ],
  advanceBody: [
    'Las fuerzas de {A} han logrado romper las líneas de {B} y controlan ya {N} provincias, entre ellas {P}. Los partes de guerra hablan de miles de bajas y de columnas de refugiados en las carreteras.',
    'Tras duros combates, {B} se repliega y cede {N} provincias. La caída de {P} supone un golpe para la moral de su población.',
    'El ejército de {A} explota su superioridad y ocupa {P}. El mando de {B} intenta establecer una nueva línea defensiva.',
  ],
  stalemate: [
    'Frente estancado entre {A} y {B}',
  ],
  stalemateBody: [
    'Ni {A} ni {B} consiguen avances significativos. Las trincheras se alargan y la guerra se convierte en una sangría de desgaste.',
  ],
  peace: ['{A} y {B} firman la paz', 'Armisticio entre {A} y {B}'],
  peaceBody: [
    'Tras {M} de guerra, los delegados de ambos países han firmado un acuerdo que pone fin a las hostilidades. Las fronteras quedan fijadas sobre la línea de contacto.',
    'Agotados por el conflicto, {A} y {B} aceptan un alto el fuego mediado por terceros países. La paz es frágil, pero las armas callan.',
  ],
  capitulate: ['{B} capitula ante {A}', 'Rendición incondicional de {B}'],
  capitulateBody: ['Con su capital ocupada y su ejército deshecho, el gobierno de {B} firma la rendición. {A} impone sus condiciones.'],
  alliance: ['{A} y {B} sellan una alianza', 'Nace el pacto {A}-{B}'],
  allianceBody: ['Los gobiernos de {A} y {B} firman un tratado de defensa mutua y cooperación. La noticia provoca inquietud entre sus rivales.'],
  allianceNo: ['{B} rechaza la alianza con {A}'],
  allianceNoBody: ['La cancillería de {B} ha declinado la propuesta de alianza de {A}, alegando que no sirve a sus intereses nacionales en este momento.'],
  annexOk: ['{B} se integra en {A}'],
  annexOkBody: ['Tras intensas negociaciones y una campaña de presión política, {B} acepta su integración en {A}. Las celebraciones contrastan con la indignación internacional.'],
  annexNo: ['{B} rechaza ser anexionado por {A}'],
  annexNoBody: ['El gobierno de {B} ha respondido con firmeza a las pretensiones de {A}. La tensión entre ambos países se dispara.'],
  mil: ['{A} acelera su programa militar', 'Gran movilización en {A}', '{A} moderniza sus fuerzas armadas'],
  milBody: ['El gobierno de {A} ha aprobado un ambicioso plan para ampliar y modernizar el ejército. Los vecinos toman nota.'],
  eco: ['Plan económico en {A}', '{A} impulsa su industria', 'Reformas económicas en {A}'],
  ecoBody: ['Las nuevas medidas económicas del gobierno de {A} empiezan a notarse: fábricas, obras públicas y comercio dan señales de vida.'],
  stab: ['{A} refuerza la unidad nacional', 'Reformas internas en {A}'],
  stabBody: ['El gobierno de {A} ha emprendido reformas para consolidar su autoridad y ganarse el apoyo de la población.'],
  generic: ['Decisión del gobierno de {A}'],
  genericBody: ['El gobierno de {A} anuncia: «{X}». Los observadores debaten sus consecuencias.'],
  revolt: ['Rebelión en {P}: nace {C}', 'Secesión en {B}: se proclama {C}'],
  revoltBody: ['Aprovechando la debilidad del gobierno central de {B}, los líderes locales de {P} han proclamado {C}. El ejército no ha logrado sofocar el levantamiento.'],
  disaster: ['Terremoto en {P}', 'Inundaciones devastadoras en {P}', 'Epidemia en {P}', 'Sequía y hambruna en {P}'],
  disasterBody: ['Miles de personas han perdido sus hogares. El gobierno de {B} decreta el estado de emergencia y pide ayuda internacional.'],
  science: ['Avance científico en {A}', '{A} presenta un nuevo invento', 'Hito tecnológico en {A}'],
  scienceBody: ['Investigadores de {A} anuncian un descubrimiento que, según la prensa, podría cambiar la industria y la vida cotidiana en las próximas décadas.'],
  politics: ['Cambio de gobierno en {A}', 'Crisis política en {A}', 'Elecciones en {A}'],
  politicsBody: ['La vida política de {A} se agita: dimisiones, mítines y titulares que anuncian un giro en la dirección del país.'],
};
function fill(s, v) {
  return s.replace(/\{(\w)\}/g, (_, k) => (v[k] !== undefined ? v[k] : ''));
}

// ── turno ─────────────────────────────────────────────────────────────────
/**
 * Resuelve un turno sin IA. Modifica g directamente para las guerras que
 * declara (para que la resolución de combates ya las vea) y devuelve los
 * cambios de mapa como operaciones, igual que el modelo.
 */
export function offlineTurn(g, world, jump, dateTo) {
  const r = rngFor(g);
  const st = countryStats(g, world);
  const events = [];
  const changes = [];
  const me = g.player;
  const N = (id) => (g.countries[id] ? g.countries[id].name : id);
  const months = jump.months;
  const ev = (kind, tpl, v, extra = {}) => {
    events.push({
      date: dateIn(r, g.date, dateTo), kind,
      title: fill(pick(r, T[tpl]), v), body: fill(pick(r, T[tpl + 'Body'] || T[tpl]), v),
      countries: extra.countries || [], place: extra.place || '', player: !!extra.player,
    });
  };
  // guerras declaradas en este mismo turno (aún no están en g.wars)
  const newWars = [];
  const isWar = (a, b) => atWar(g, a, b) || newWars.some(w => (w.a === a && w.b === b) || (w.a === b && w.b === a));
  g.opinion = g.opinion || {};
  const op = (id) => g.opinion[id] || 0;
  const bump = (id, d) => { g.opinion[id] = Math.max(-100, Math.min(100, op(id) + d)); };

  // 1. órdenes del jugador
  const focus = new Map();       // enemigo → provincia objetivo
  for (const act of g.actions) {
    const t = ' ' + norm(act) + ' ';
    const targets = mentioned(g, world, act);
    const tprov = mentionedProvince(world, act);
    if (tprov >= 0 && g.owner[tprov] !== me && !targets.includes(g.owner[tprov])) targets.push(g.owner[tprov]);
    let handled = false;

    if (KW.peace.test(t)) {
      for (const b of targets.filter(x => isWar(me, x))) {
        // aceptan si van perdiendo o si la guerra se alarga
        const w = g.wars.find(x => (x.a === me && x.b === b) || (x.a === b && x.b === me));
        const lost = w ? lossRatio(g, st, w, b) : 0;
        const pa = sidePower(g, st, me, b), pb = sidePower(g, st, b, me);
        const chance = 0.25 + lost * 0.8 + (pa > pb ? 0.2 : -0.1) + Math.min(0.3, warMonths(g, w) / 40);
        if (r() < chance) {
          changes.push({ type: 'peace', a: me, b });
          ev('diplomacia', 'peace', { A: N(me), B: N(b), M: monthsText(warMonths(g, w)) }, { countries: [me, b], player: true });
        } else {
          events.push({ date: dateIn(r, g.date, dateTo), kind: 'diplomacia', player: true, countries: [me, b],
            title: `${N(b)} rechaza negociar la paz`, body: `El gobierno de ${N(b)} considera que aún puede ganar la guerra y rechaza la propuesta de ${N(me)}. Los combates continúan.` });
        }
        handled = true;
      }
    }
    if (!handled && KW.war.test(t) && targets.length) {
      for (const b of targets) {
        if (alliesOf(g, me).includes(b) && !/traicion|romper/.test(t)) continue;
        if (!isWar(me, b)) {
          newWars.push({ a: me, b });
          changes.push({ type: 'war', a: me, b, name: `Guerra ${N(me)}-${N(b)}` });
          ev('guerra', 'warDecl', { A: N(me), B: N(b) }, { countries: [me, b], player: true });
          bump(b, -60);
          // los aliados del atacado acuden en su ayuda (a veces)
          for (const al of alliesOf(g, b)) {
            if (al === me || isWar(me, al)) continue;
            if (r() < 0.55) {
              newWars.push({ a: al, b: me });
              changes.push({ type: 'war', a: al, b: me, name: `Guerra ${N(me)}-${N(b)}` });
              events.push({ date: dateIn(r, g.date, dateTo), kind: 'guerra', countries: [al, me],
                title: `${N(al)} acude en defensa de ${N(b)}`, body: `Fiel a sus compromisos, ${N(al)} declara la guerra a ${N(me)}.` });
            }
          }
        }
        focus.set(b, tprov >= 0 && g.owner[tprov] === b ? tprov : -1);
        mods(g, me).mil *= 1.03;
      }
      handled = true;
    }
    if (!handled && KW.alliance.test(t) && targets.length) {
      for (const b of targets) {
        if (isWar(me, b)) continue;
        const common = enemiesOf(g, me).filter(e => enemiesOf(g, b).includes(e)).length;
        const chance = 0.3 + common * 0.35 + op(b) / 200 + (agreed(g, b, 'alliance') ? 0.6 : 0);
        if (r() < chance) {
          changes.push({ type: 'alliance', members: [me, b], name: `Pacto ${N(me)}-${N(b)}` });
          ev('diplomacia', 'alliance', { A: N(me), B: N(b) }, { countries: [me, b], player: true });
          bump(b, 20);
        } else {
          ev('diplomacia', 'allianceNo', { A: N(me), B: N(b) }, { countries: [me, b], player: true });
        }
      }
      handled = true;
    }
    if (!handled && KW.annex.test(t) && targets.length) {
      for (const b of targets) {
        const small = st[b] && st[me] && st[b].provinces * 4 <= st[me].provinces;
        const chance = (small ? 0.35 : 0.05) + (g.countries[b].overlord === me ? 0.45 : 0) + op(b) / 300 + (agreed(g, b, 'annex') ? 0.5 : 0);
        if (r() < chance) {
          changes.push({ type: 'annex', country: b, by: me });
          ev('politica', 'annexOk', { A: N(me), B: N(b) }, { countries: [me, b], player: true });
        } else {
          ev('diplomacia', 'annexNo', { A: N(me), B: N(b) }, { countries: [me, b], player: true });
          bump(b, -25);
        }
      }
      handled = true;
    }
    if (!handled && KW.release.test(t) && targets.length) {
      for (const b of targets) {
        if (g.countries[b].overlord === me) {
          changes.push({ type: 'release', subject: b });
          events.push({ date: dateIn(r, g.date, dateTo), kind: 'politica', player: true, countries: [me, b],
            title: `${N(me)} concede la plena independencia a ${N(b)}`, body: `En una ceremonia solemne, ${N(me)} renuncia a su tutela sobre ${N(b)}, que pasa a ser plenamente soberano.` });
        }
      }
      handled = true;
    }
    if (!handled && KW.vassal.test(t) && targets.length) {
      for (const b of targets) {
        const chance = st[b].provinces * 5 <= st[me].provinces ? 0.45 : 0.08;
        if (r() < chance) {
          changes.push({ type: 'subject', subject: b, overlord: me });
          events.push({ date: dateIn(r, g.date, dateTo), kind: 'diplomacia', player: true, countries: [me, b],
            title: `${N(b)} acepta la tutela de ${N(me)}`, body: `Bajo una fuerte presión, ${N(b)} firma un tratado que lo convierte en Estado protegido de ${N(me)}.` });
        } else {
          events.push({ date: dateIn(r, g.date, dateTo), kind: 'diplomacia', player: true, countries: [me, b],
            title: `${N(b)} rechaza someterse a ${N(me)}`, body: `${N(b)} defiende su soberanía y denuncia las presiones de ${N(me)}.` });
          bump(b, -20);
        }
      }
      handled = true;
    }
    if (!handled && KW.rename.test(t)) {
      const m = act.match(/[«"“']([^»"”']{3,60})[»"”']/);
      if (m) {
        changes.push({ type: 'rename', country: me, new_name: m[1] });
        events.push({ date: dateIn(r, g.date, dateTo), kind: 'politica', player: true, countries: [me],
          title: `Se proclama ${m[1]}`, body: `El gobierno de ${N(me)} adopta oficialmente el nombre de ${m[1]}, en una ceremonia multitudinaria.` });
        handled = true;
      }
    }
    // reformas internas: pueden ir en la misma orden que otra cosa
    let internal = false;
    if (KW.mil.test(t)) { mods(g, me).mil = Math.min(2.2, mods(g, me).mil * (1 + 0.04 * Math.min(12, months))); if (!handled) ev('politica', 'mil', { A: N(me) }, { countries: [me], player: true }); internal = true; }
    if (KW.eco.test(t)) { mods(g, me).eco = Math.min(2, mods(g, me).eco * (1 + 0.03 * Math.min(12, months))); if (!handled && !internal) ev('economia', 'eco', { A: N(me) }, { countries: [me], player: true }); internal = true; }
    if (KW.stab.test(t)) { mods(g, me).stab = Math.min(1.6, mods(g, me).stab * (1 + 0.03 * Math.min(12, months))); if (!handled && !internal) ev('politica', 'stab', { A: N(me) }, { countries: [me], player: true }); internal = true; }
    if (!handled && !internal) {
      ev('politica', 'generic', { A: N(me), X: act.length > 160 ? act.slice(0, 157) + '…' : act }, { countries: [me], player: true });
    }
  }

  // acuerdos de las negociaciones que no se convirtieron en órdenes
  for (const ag of (g.agreements || []).filter(a => a.turn === g.turn)) {
    if (ag.type === 'alliance' && !alliesOf(g, me).includes(ag.with) && !changes.some(c => c.type === 'alliance' && c.members && c.members.includes(ag.with))) {
      changes.push({ type: 'alliance', members: [me, ag.with], name: `Pacto ${N(me)}-${N(ag.with)}` });
      ev('diplomacia', 'alliance', { A: N(me), B: N(ag.with) }, { countries: [me, ag.with], player: true });
    }
    if (ag.type === 'peace' && atWar(g, me, ag.with) && !changes.some(c => c.type === 'peace' && (c.a === ag.with || c.b === ag.with))) {
      changes.push({ type: 'peace', a: me, b: ag.with });
      ev('diplomacia', 'peace', { A: N(me), B: N(ag.with), M: 'meses' }, { countries: [me, ag.with], player: true });
    }
  }

  // 2. combates de todas las guerras (incluidas las recién declaradas)
  const allWars = [...g.wars.map(w => ({ ...w })), ...newWars.filter(w => !atWar(g, w.a, w.b))];
  const peaceNow = new Set(changes.filter(c => c.type === 'peace').map(c => [c.a, c.b].sort().join('|')));
  // dueño provisional para encadenar avances dentro del turno
  const own = g.owner.slice();
  const gTmp = { ...g, owner: own };
  for (const w of allWars) {
    if (peaceNow.has([w.a, w.b].sort().join('|'))) continue;
    if (!provincesOf(gTmp, w.a).length || !provincesOf(gTmp, w.b).length) continue;
    const pa = sidePower(g, st, w.a, w.b), pb = sidePower(g, st, w.b, w.a);
    const ratio = pa / (pa + pb + 1e-9);
    const noise = (r() - 0.5) * 0.35;
    const edge = ratio - 0.5 + noise;
    const winner = edge >= 0 ? w.a : w.b, loser = winner === w.a ? w.b : w.a;
    const lp = provincesOf(gTmp, loser).length;
    // provincias en juego: crece con el tiempo y con la superioridad
    const tempo = Math.min(1, months / 6);
    let n = Math.round((Math.abs(edge) * 2.2 + 0.15) * Math.sqrt(lp) * tempo * (1 + r()));
    if (months < 1 && r() < 0.6) n = 0;
    if (n <= 0 || Math.abs(edge) < 0.04) {
      if (r() < 0.4) ev('guerra', 'stalemate', { A: N(w.a), B: N(w.b) }, { countries: [w.a, w.b], player: w.a === me || w.b === me });
      continue;
    }
    n = Math.min(n, lp);
    const target = focus.has(loser) && winner === me ? focus.get(loser) : capitalOf(gTmp, world, st, loser);
    const ids = pickFront(gTmp, world, winner, loser, n, target, alliesOf(g, winner).filter(x => atWar(g, x, loser)));
    if (!ids.length) continue;
    for (const i of ids) own[i] = winner;
    const names = ids.map(i => world.provinces[i].name);
    changes.push({ type: 'transfer', from: loser, to: winner, provinces: ids });
    ev('guerra', 'advance', { A: N(winner), B: N(loser), P: names.slice(0, 3).join(', '), N: ids.length },
      { countries: [winner, loser], place: names[0], player: winner === me || loser === me });
    // capitulación: el perdedor ha perdido su capital o casi todo
    const left = provincesOf(gTmp, loser).length;
    const lostCap = !provincesOf(gTmp, loser).includes(st[loser].capital);
    if (left === 0) continue;
    if ((lostCap && r() < 0.6) || left <= Math.max(1, Math.round(st[loser].provinces * 0.3))) {
      if (winner !== me && loser !== me && left <= 2 && st[loser].provinces * 4 < st[winner].provinces && r() < 0.6) {
        changes.push({ type: 'annex', country: loser, by: winner });
      } else if (loser !== me) {
        changes.push({ type: 'peace', a: winner, b: loser });
      } else {
        // el jugador no capitula solo: decide él
        continue;
      }
      ev('guerra', 'capitulate', { A: N(winner), B: N(loser) }, { countries: [winner, loser], player: winner === me || loser === me });
    }
  }
  // cansancio: las guerras largas entre IAs terminan
  for (const w of g.wars) {
    if (w.a === me || w.b === me) continue;
    if (peaceNow.has([w.a, w.b].sort().join('|'))) continue;
    if (r() < Math.min(0.5, warMonths(g, w) / 60 * months / 3)) {
      changes.push({ type: 'peace', a: w.a, b: w.b });
      ev('diplomacia', 'peace', { A: N(w.a), B: N(w.b), M: monthsText(warMonths(g, w)) }, { countries: [w.a, w.b] });
    }
  }
  // la IA enemiga ofrece la paz al jugador si va perdiendo
  for (const b of enemiesOf(g, me)) {
    const w = g.wars.find(x => (x.a === me && x.b === b) || (x.a === b && x.b === me));
    if (lossRatio(g, st, w, b) > 0.4 && r() < 0.3) {
      events.push({ date: dateIn(r, g.date, dateTo), kind: 'diplomacia', countries: [b, me], player: true,
        title: `${N(b)} pide negociar la paz`, body: `Emisarios de ${N(b)} han hecho llegar una propuesta de armisticio. Basta con ordenar «firmar la paz con ${N(b)}» para aceptarla.` });
    }
  }

  // 3. el resto del mundo
  const alive = Object.values(g.countries).filter(c => c.alive).map(c => c.id).filter(id => st[id] && st[id].provinces);
  const nb = countryNeighbours(g, world);
  const busy = new Set([me, ...allWars.flatMap(w => [w.a, w.b])]);
  // Guerras nuevas entre IAs: raras, y casi siempre las empieza una potencia
  // revisionista de la época contra un vecino mucho más débil que no tenga
  // aliados capaces de defenderlo.
  const hawks = new Set(HAWKS[g.scenario] || []);
  const warChance = Math.min(0.3, 0.025 * months * (hawks.size ? 1.4 : 1));
  if (r() < warChance) {
    const cand = [];
    for (const a of alive) {
      if (busy.has(a) || g.countries[a].overlord || st[a].provinces < 4) continue;
      const weight = hawks.has(a) ? 1 : 0.08;
      for (const b of nb.get(a) || []) {
        if (b === me || busy.has(b) || alliesOf(g, a).includes(b) || g.countries[b].overlord === a) continue;
        const pa = power(g, st, a), pb = power(g, st, b);
        const shield = alliesOf(g, b).reduce((x, y) => x + power(g, st, y), 0);
        if (pa > pb * 2.2 && shield < pa) cand.push([a, b, weight * Math.min(4, pa / pb)]);
      }
    }
    const total = cand.reduce((x, c) => x + c[2], 0);
    if (total > 0 && r() < Math.min(1, total / 3)) {
      let roll = r() * total, sel = cand[0];
      for (const c of cand) { roll -= c[2]; if (roll <= 0) { sel = c; break; } }
      const [a, b] = sel;
      changes.push({ type: 'war', a, b, name: `Guerra ${N(a)}-${N(b)}` });
      ev('guerra', 'warDecl', { A: N(a), B: N(b) }, { countries: [a, b] });
      busy.add(a); busy.add(b);
    }
  }
  // pactos entre vecinos que comparten enemigo
  if (r() < Math.min(0.5, 0.05 * months)) {
    for (const a of alive) {
      if (a === me) continue;
      const ea = enemiesOf(g, a);
      if (!ea.length) continue;
      const friend = [...(nb.get(a) || [])].find(b => b !== me && !alliesOf(g, a).includes(b) && enemiesOf(g, b).some(e => ea.includes(e)));
      if (friend) {
        changes.push({ type: 'alliance', members: [a, friend], name: `Pacto ${N(a)}-${N(friend)}` });
        ev('diplomacia', 'alliance', { A: N(a), B: N(friend) }, { countries: [a, friend] });
        break;
      }
    }
  }
  // fragmentación de imperios enormes e inestables
  if (r() < Math.min(0.2, 0.01 * months)) {
    const big = alive.filter(id => id !== me && st[id].provinces > 40 && mods(g, id).stab < 0.97);
    if (big.length) {
      const b = pick(r, big);
      const ps = provincesOf(g, b);
      const cap = st[b].capital;
      // la provincia más alejada de la capital
      let far = ps[0], fd = -1;
      for (const i of ps) {
        const d = km(world.provinces[i].clon, world.provinces[i].clat, world.provinces[cap].clon, world.provinces[cap].clat);
        if (d > fd) { fd = d; far = i; }
      }
      const pname = world.provinces[far].name;
      const cname = `República de ${pname}`;
      changes.push({ type: 'new_country', name: cname, from: b, around: far, size: Math.max(2, Math.round(ps.length * 0.06)), government: 'Gobierno revolucionario' });
      ev('politica', 'revolt', { B: N(b), P: pname, C: cname }, { countries: [b], place: pname });
    }
  }
  // sociedad, ciencia y desastres
  const flavour = Math.min(4, Math.round(months * 0.5 + r() * 2));
  for (let i = 0; i < flavour; i++) {
    const a = pick(r, alive.filter(id => id !== me).sort((x, y) => st[y].provinces - st[x].provinces).slice(0, 30));
    if (!a) break;
    const roll = r();
    if (roll < 0.35) {
      const ps = provincesOf(g, a);
      const p = world.provinces[pick(r, ps)];
      ev('desastre', 'disaster', { P: p.name, B: N(a) }, { countries: [a], place: p.name });
      mods(g, a).eco *= 0.97;
    } else if (roll < 0.65) {
      ev('ciencia', 'science', { A: N(a) }, { countries: [a] });
      mods(g, a).eco *= 1.02;
    } else {
      ev('politica', 'politics', { A: N(a) }, { countries: [a] });
      mods(g, a).stab = Math.max(0.6, Math.min(1.4, mods(g, a).stab * (0.94 + r() * 0.1)));
    }
  }

  events.sort((a, b) => a.date.localeCompare(b.date));
  const pe = events.filter(e => e.player).length;
  const wars = allWars.length;
  const summary = `Entre el ${fmtDate(g.date)} y el ${fmtDate(dateTo)}, ` +
    `${wars ? `el mundo vive ${wars} guerra${wars > 1 ? 's' : ''} abierta${wars > 1 ? 's' : ''}` : 'el mundo vive un período de relativa calma'}` +
    `${pe ? ` y ${N(me)} ve cómo sus decisiones empiezan a tener consecuencias` : ''}.`;
  return { summary, events, changes };
}

function capitalOf(g, world, st, id) {
  const c = st[id] && st[id].capital;
  if (c !== null && c !== undefined && g.owner[c] === id) return c;
  const ps = provincesOf(g, id);
  return ps.length ? ps[0] : -1;
}
function warMonths(g, w) {
  if (!w || !w.since) return 0;
  const a = parseDate(w.since), b = parseDate(g.date);
  return Math.max(0, (b.y - a.y) * 12 + (b.m - a.m));
}
function monthsText(m) {
  if (m >= 24) return `${Math.round(m / 12)} años`;
  if (m >= 12) return 'un año';
  return m <= 1 ? 'pocas semanas' : `${m} meses`;
}
/** Fracción del territorio que `id` ha perdido desde que empezó la guerra. */
function lossRatio(g, st, w, id) {
  if (!w) return 0;
  w.start = w.start || {};
  if (!w.start[id]) w.start[id] = st[id].provinces;
  return Math.max(0, 1 - st[id].provinces / w.start[id]);
}
function agreed(g, id, type) {
  return (g.agreements || []).some(a => a.with === id && a.type === type && a.turn === g.turn);
}

// ── diplomacia sin IA ─────────────────────────────────────────────────────
/**
 * Respuesta de un líder controlado por el simulador. Si acepta algo, lo deja
 * anotado en g.agreements para que el turno lo aplique.
 */
export function offlineChat(g, world, id, text) {
  const r = rngFor({ ...g, date: g.date + text.length + id });
  const st = countryStats(g, world);
  const me = g.player, c = g.countries[id], mine = g.countries[me];
  const t = ' ' + norm(text) + ' ';
  const rel = relation(g, id, me);
  g.opinion = g.opinion || {};
  const opv = g.opinion[id] || 0;
  const ratio = (power(g, st, me) + 1) / (power(g, st, id) + 1);
  const who = c.leader ? `${c.leader}` : `El gobierno de ${c.name}`;
  const agree = (type) => {
    g.agreements = g.agreements || [];
    g.agreements.push({ with: id, type, turn: g.turn });
  };
  const say = (s) => s;

  if (KW.peace.test(t) && rel === 'war') {
    const w = g.wars.find(x => (x.a === me && x.b === id) || (x.a === id && x.b === me));
    const lost = lossRatio(g, st, w, id);
    if (lost > 0.25 || ratio > 1.6 || r() < 0.2) {
      agree('peace');
      return say(`${pick(r, ['Esta guerra ya ha costado demasiado.', 'Mi pueblo está exhausto.', 'Nadie gana nada prolongando esta matanza.'])} ${c.name} acepta un alto el fuego sobre la línea actual del frente. Que nuestros delegados lo firmen cuanto antes.`);
    }
    return say(`¿Paz? ¿Ahora, cuando la victoria está a nuestro alcance? No. ${c.name} luchará hasta que ${mine.name} retire sus pretensiones.`);
  }
  if (KW.alliance.test(t)) {
    if (rel === 'war') return say('Hablar de alianzas mientras nuestros soldados se matan es una burla. Primero, la paz.');
    if (rel === 'ally') return say(`Nuestra amistad con ${mine.name} es firme. Seguiremos a su lado.`);
    const common = enemiesOf(g, me).filter(e => enemiesOf(g, id).includes(e)).length;
    const chance = 0.25 + common * 0.4 + opv / 150 + (ratio > 1 ? 0.15 : 0) - (KW.war.test(t) ? 0.1 : 0);
    if (r() < chance) {
      agree('alliance');
      g.opinion[id] = opv + 15;
      return say(`${pick(r, ['Tras consultarlo con mi gabinete,', 'Los intereses de nuestros pueblos coinciden:', 'Creo que este es el comienzo de una amistad provechosa.'])} ${c.name} acepta la alianza con ${mine.name}. Que se redacte el tratado.`);
    }
    return say(`Agradecemos la oferta, pero ${c.name} prefiere mantener su independencia de acción. ${pick(r, ['Quizá más adelante.', 'Las circunstancias no son propicias.', 'Nuestro parlamento jamás lo aprobaría.'])}`);
  }
  if (KW.annex.test(t) || KW.vassal.test(t)) {
    if (ratio > 6 && r() < 0.35) {
      agree('annex');
      return say(`Comprendemos la realidad de nuestra situación… ${c.name} está dispuesto a discutir su integración, siempre que se respeten nuestras costumbres y autoridades locales.`);
    }
    g.opinion[id] = opv - 20;
    return say(`¡Jamás! ${c.name} es una nación soberana y defenderá cada palmo de su territorio. Tomamos nota de esta amenaza.`);
  }
  if (KW.war.test(t) || /amenaz|ultimatum|exig/.test(t)) {
    g.opinion[id] = opv - 15;
    if (ratio > 3) return say(`Sus palabras son graves. ${c.name} no desea la guerra… estudiaremos sus exigencias con la máxima seriedad.`);
    return say(`${c.name} no se deja intimidar. Si ${mine.name} quiere guerra, la encontrará.`);
  }
  if (/comerci|acuerdo|tratado|inversion|petroleo|materias primas|trade/.test(t)) {
    if (rel !== 'war' && r() < 0.6 + opv / 200) {
      g.opinion[id] = opv + 8;
      agree('trade');
      return say(`Un acuerdo comercial beneficiaría a ambos. ${c.name} está de acuerdo en principio; nuestros ministros se ocuparán de los detalles.`);
    }
    return say('Ahora mismo no estamos en condiciones de comprometer nuestra economía en nuevos acuerdos.');
  }
  // saludo o cualquier otra cosa
  const greet = {
    war: `${who} recibe a su emisario con frialdad. Mientras dure la guerra, poco hay que hablar.`,
    ally: `${who} le saluda con afecto. ¿En qué puede ayudar ${c.name} a sus aliados?`,
    subject: `${c.name} está, como siempre, a disposición de ${mine.name}.`,
    overlord: `${c.name} escucha. Sea breve.`,
    neutral: `${who} le escucha. ¿Qué propone ${mine.name}?`,
  };
  return say(greet[rel] || greet.neutral);
}

export { addTime };
