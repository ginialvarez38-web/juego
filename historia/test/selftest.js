// Prueba sin interfaz: genera el mundo, monta los dos escenarios, aplica
// cambios con el formato que devuelve la IA y juega muchos turnos con el
// simulador local comprobando que el estado sigue siendo coherente.
import { buildWorld } from '../src/world.js';
import { SCENARIOS } from '../src/scenarios.js';
import {
  createGame, applyChanges, countryStats, provincesOf, findProvince, findCountry,
  addTime, JUMPS, atWar, snapshot, restore, serialize, deserialize,
} from '../src/game.js';
import { offlineTurn, offlineChat } from '../src/offline.js';
import { parseJSONLoose, turnUserPrompt, turnSystemPrompt, DEFAULT_SETTINGS } from '../src/ai.js';

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ok  ' : ' FALLA'} ${msg}`); if (!cond) fails++; };

console.log('== Historia Mundi · prueba del modelo ==\n');
const world = buildWorld();
console.log(`Mundo: ${world.provinces.length} provincias, ${world.borders.length} costuras, ${world.ms} ms\n`);
ok(world.provinces.length > 1200 && world.provinces.length < 4000, 'número de provincias razonable');
ok(world.provinces.every(p => p.name && p.area > 0), 'todas las provincias tienen nombre y superficie');
ok(new Set(world.provinces.map(p => p.name)).size === world.provinces.length, 'nombres de provincia únicos');
ok(findProvince(world, 'Varsovia') >= 0 && findProvince(world, 'Warsaw') === findProvince(world, 'Varsovia'), 'exónimos: Varsovia = Warsaw');
ok(findProvince(world, 'Breslau') >= 0, 'exónimos con letras especiales (Wrocław)');

// ── escenarios ────────────────────────────────────────────────────────────
for (const scn of SCENARIOS) {
  console.log(`\n-- Escenario ${scn.year}: ${scn.title}`);
  const g = createGame(world, scn, scn.featured[0]);
  const st = countryStats(g, world);
  const alive = Object.values(g.countries).filter(c => c.alive);
  ok(alive.length > 40, `${alive.length} Estados vivos`);
  ok(!g.owner.includes('XXX') && g.owner.every(Boolean), 'todas las provincias tienen dueño conocido');
  ok(scn.featured.every(id => g.countries[id] && st[id].provinces > 0), 'los países destacados existen y tienen territorio');
  ok(Object.values(g.countries).every(c => /^#[0-9a-f]{6}$/i.test(c.color)), 'todos los países tienen color');
  ok(g.wars.every(w => g.countries[w.a] && g.countries[w.b]), 'las guerras iniciales son entre Estados existentes');
  const top = Object.keys(st).filter(id => st[id].provinces).sort((a, b) => st[b].provinces - st[a].provinces).slice(0, 8);
  console.log('   mayores: ' + top.map(id => `${g.countries[id].name} ${st[id].provinces}`).join(', '));
  if (scn.id === '1936') {
    const own = (city) => g.owner[findProvince(world, city)];
    ok(own('Seoul') === 'JPN', 'Corea es japonesa');
    ok(own('Harbin') === 'MAN', 'Harbin está en Manchukuo');
    ok(own('Mumbai') === 'RAJ', 'Bombay pertenece al Raj británico');
    ok(own('Hanoi') === 'FRA', 'Indochina es francesa');
    ok(own('Kinshasa') === 'BEL', 'el Congo es belga');
    ok(own('Kiev') === 'SOV' && own('Tbilisi') === 'SOV', 'Ucrania y Georgia son soviéticas');
    ok(own('Lviv') === 'POL', 'Leópolis es polaca');
    ok(own('Wrocław') === 'GER', 'Breslavia es alemana');
    ok(own('Tripoli') === 'ITA', 'Libia es italiana');
    ok(own('Jakarta') === 'NLD', 'Batavia es neerlandesa');
    ok(own('Luanda') === 'POR', 'Angola es portuguesa');
  } else {
    ok(atWar(g, 'RUS', 'UKR'), 'Rusia y Ucrania en guerra');
    ok(g.owner[findProvince(world, 'Nuuk')] === 'DNK' || provincesOf(g, 'DNK').length > 3, 'Groenlandia es danesa');
  }
}

// ── cambios con el formato de la IA ───────────────────────────────────────
console.log('\n-- Cambios estilo IA');
{
  const g = createGame(world, SCENARIOS[1], 'GER');
  const pl0 = provincesOf(g, 'POL').length;
  const log = applyChanges(g, world, [
    { type: 'war', a: 'Alemania', b: 'POL', name: 'Campaña de Polonia' },
    { type: 'conquer', attacker: 'GER', defender: 'Polonia', amount: 'many', toward: 'Varsovia' },
    { type: 'alliance', name: 'Eje', members: ['GER', 'ITA'] },
    { type: 'alliance', name: 'Eje', members: ['JPN'] },
    { type: 'new_country', id: 'CAT', name: 'República Catalana', from: 'ESP', around: 'Barcelona', size: 'few', color: '#e8c547' },
    { type: 'rename', country: 'SOV', leader: 'León Trotski' },
    { type: 'annex', country: 'Austria', by: 'GER' },
    { type: 'transfer', from: 'CZE', to: 'GER', provinces: ['Pizen', 'Karlovy Vary', 'NoExiste'] },
    { type: 'nonsense', foo: 1 },
    { type: 'conquer', attacker: 'XXX', defender: 'GER' },
  ]);
  console.log('   ' + log.join('\n   '));
  ok(atWar(g, 'GER', 'POL'), 'guerra declarada por nombre');
  ok(provincesOf(g, 'POL').length < pl0, 'la conquista quita provincias a Polonia');
  ok(g.alliances.find(a => a.name === 'Eje').members.length === 3, 'el Eje crece al añadir miembros por nombre');
  ok(g.countries.CAT && provincesOf(g, 'CAT').length >= 1, 'nace la República Catalana');
  ok(g.owner[findProvince(world, 'Barcelona')] === 'CAT', 'Barcelona pertenece al nuevo Estado');
  ok(g.countries.SOV.leader === 'León Trotski', 'cambio de líder');
  ok(!g.countries.AUT.alive, 'Austria anexionada deja de existir');
  ok(g.changed.length > 0, 'se registran las provincias cambiadas');
  const snap = snapshot(g);
  applyChanges(g, world, [{ type: 'annex', country: 'FRA', by: 'GER' }]);
  ok(!g.countries.FRA.alive, 'anexión de Francia');
  restore(g, snap);
  ok(g.countries.FRA.alive && provincesOf(g, 'FRA').length > 10, 'rebobinar restaura el estado');
  const g2 = deserialize(serialize(g));
  ok(g2.owner.length === g.owner.length && g2.countries.CAT, 'guardar y cargar conserva la partida');
  ok(findCountry(g, 'francia') === 'FRA' && findCountry(g, 'Reino Unido') === 'GBR', 'búsqueda de países por nombre');
}

// ── JSON tolerante ────────────────────────────────────────────────────────
console.log('\n-- Lectura de respuestas');
{
  const a = parseJSONLoose('Aquí tienes:\n```json\n{"summary":"x","events":[{"title":"a",},],"changes":[]}\n```');
  ok(a.summary === 'x' && a.events.length === 1, 'JSON con bloque de código y comas colgantes');
  const b = parseJSONLoose('{"summary":"comillas “raras”","events":[],"changes":[]}');
  ok(b.events.length === 0, 'JSON con texto tipográfico');
  const g = createGame(world, SCENARIOS[0], 'ESP');
  g.actions = ['Proponer a Portugal una federación ibérica'];
  const prompt = turnUserPrompt(g, world, JUMPS[1], addTime(g.date, JUMPS[1]));
  ok(prompt.includes('Portugal') && prompt.includes('ÓRDENES DEL JUGADOR'), 'el prompt del turno incluye las órdenes y los países citados');
  ok(prompt.length < 40000, `prompt del turno de tamaño razonable (${prompt.length} caracteres)`);
  ok(turnSystemPrompt(DEFAULT_SETTINGS).includes('"changes"'), 'el prompt de sistema explica las operaciones');
}

// ── muchos turnos con el simulador local ──────────────────────────────────
for (const scn of SCENARIOS) {
  console.log(`\n-- 30 turnos sin IA (${scn.year})`);
  const player = scn.id === '1936' ? 'GER' : 'MEX';
  const g = createGame(world, scn, player);
  const orders = scn.id === '1936'
    ? [['Rearmar el ejército', 'Proponer una alianza a Italia'], ['Declarar la guerra a Polonia y avanzar hacia Varsovia'], [], ['Invertir en industria'], ['Firmar la paz con Polonia']]
    : [['Invertir en industria y tecnología'], ['Proponer una alianza a Estados Unidos'], ['Declarar la guerra a Guatemala'], [], ['Firmar la paz con Guatemala']];
  let events = 0, mapChanges = 0;
  for (let t = 0; t < 30; t++) {
    g.actions = orders[t % orders.length].slice();
    if (t === 1) offlineChat(g, world, scn.id === '1936' ? 'ITA' : 'USA', 'Propongo una alianza entre nuestros países');
    const jump = JUMPS[t % 2 ? 2 : 1];
    const to = addTime(g.date, jump);
    const res = offlineTurn(g, world, jump, to);
    const log = applyChanges(g, world, res.changes);
    g.turns.push({ turn: g.turn, date: g.date, dateTo: to, events: res.events, summary: res.summary, log });
    g.date = to; g.turn++; g.actions = [];
    events += res.events.length; mapChanges += g.changed.length;
    if (!res.events.every(e => e.title && e.body && e.date >= g.turns[t].date)) { ok(false, `eventos mal formados en el turno ${t}`); break; }
  }
  const st = countryStats(g, world);
  ok(events > 60, `${events} noticias generadas`);
  ok(mapChanges > 0, `${mapChanges} provincias cambiaron de manos`);
  ok(g.wars.every(w => g.countries[w.a].alive && g.countries[w.b].alive), 'no hay guerras con Estados muertos');
  ok(g.alliances.every(a => a.members.length >= 2 && a.members.every(m => g.countries[m].alive)), 'las alianzas solo tienen miembros vivos');
  ok(g.owner.every(id => g.countries[id] && g.countries[id].alive), 'todo dueño de provincia está vivo');
  const alive = Object.values(g.countries).filter(c => c.alive).length;
  console.log(`   fecha final ${g.date}; ${alive} Estados; ${g.wars.length} guerras abiertas; jugador con ${st[player].provinces} provincias`);
  ok(alive > 60, 'el mundo no colapsa en un puñado de imperios');
}

console.log(fails ? `\n${fails} FALLOS` : '\nTodo correcto.');
process.exit(fails ? 1 : 0);
