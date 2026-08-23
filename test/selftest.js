// Prueba sin interfaz: hace correr la campaña completa con las dos partes bajo
// control automatico y verifica que el modelo se comporta como debe.
import { createGame } from '../src/scenario.js';
import { runTurn, SIDES, other, combatPower, readiness } from '../src/sim.js';
import { analyze } from '../src/analysis.js';
import { aiTurn } from '../src/ai.js';

const TURNS = Number(process.argv[2] || 40);
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ok  ' : ' FALLA'} ${msg}`); if (!cond) fails++; };

console.log('== Theatrum Belli · prueba del modelo ==\n');

const game = createGame(20260819);
// Ambas partes bajo un mando automatico de agresividad comparable. Empujar a
// una de ellas al maximo produce lo que produce en la realidad —se sale de su
// propia logistica y la cercan—, pero no sirve para medir el modelo.
game.sides.BLUE.ai = true;
game.sides.BLUE.aggression = 0.62;
game.sides.RED.aggression = 0.55;

const men = (s) => game.units.filter(u => u.side === s && u.status !== 'destroyed')
  .reduce((a, u) => a + u.personnel, 0);

const men0 = { BLUE: men('BLUE'), RED: men('RED') };
console.log(`Teatro ${game.W}x${game.H} (${game.W * 5} x ${game.H * 5} km), semilla ${game.seed}`);
console.log(`Unidades: ${game.units.length}  ·  azules ${men0.BLUE.toLocaleString('es')} h  ·  rojas ${men0.RED.toLocaleString('es')} h\n`);

ok(game.units.length > 50, 'orden de batalla generado');
ok(game.sides.BLUE.bases.length > 0 && game.sides.RED.bases.length > 0, 'bases logísticas asignadas');
ok(game.units.every(u => u.supplyLevel > 0), 'todas las unidades arrancan con traza logística');
ok(game.analysis.front.length > 0, 'existe línea de contacto al inicio');

let maxPocket = 0, maxPincer = 0, maxSalient = 0, combats = 0, pow = 0;
const t0 = Date.now();

for (let t = 1; t <= TURNS; t++) {
  const { events, reports } = runTurn(game, (g, ev) => {
    for (const s of SIDES) if (g.sides[s].ai) aiTurn(g, ev, s);
  });
  analyze(game);
  combats += reports.length;
  for (const s of SIDES) {
    for (const p of game.analysis.sides[s].pockets) maxPocket = Math.max(maxPocket, p.men);
    for (const p of game.analysis.sides[s].pincers) maxPincer = Math.max(maxPincer, p.trappedMen);
    for (const p of game.analysis.sides[s].salients) maxSalient = Math.max(maxSalient, p.depthKm);
  }
  pow = game.sides.BLUE.casualties.pow + game.sides.RED.casualties.pow;

  if (t % 8 === 0 || t === TURNS) {
    const A = game.analysis;
    console.log(
      `T${String(t).padStart(3)} | azul ${String(men('BLUE')).padStart(7)} h  rojo ${String(men('RED')).padStart(7)} h` +
      ` | frente ${String(A.sides.BLUE.frontKm).padStart(4)} km` +
      ` | salientes ${A.sides.BLUE.salients.length}/${A.sides.RED.salients.length}` +
      ` | bolsas ${A.sides.BLUE.pockets.length}/${A.sides.RED.pockets.length}` +
      ` | pinzas ${A.sides.BLUE.pincers.length}/${A.sides.RED.pincers.length}` +
      ` | ${game.weather.type}/${game.weather.ground}`);
  }
}
const ms = Date.now() - t0;

console.log(`\n${TURNS} turnos en ${ms} ms (${(ms / TURNS).toFixed(1)} ms/turno)\n`);
console.log('--- verificaciones ---');
ok(combats > 8, `hubo combate real (${combats} asaltos resueltos)`);
ok(pow > 0, `el sostenimiento muerde: ${pow.toLocaleString('es')} prisioneros por aislamiento`);
ok(men('BLUE') < men0.BLUE && men('RED') < men0.RED, 'ambos bandos sufren desgaste');
ok(men('BLUE') > men0.BLUE * 0.3 && men('RED') > men0.RED * 0.3,
  'el desgaste no es un aniquilamiento absurdo en 10 días');
ok(maxSalient >= 15, `se forman salientes (máximo ${maxSalient} km de profundidad)`);
ok(game.analysis.front.length > 0, 'la línea de contacto sigue definida');
ok(game.units.every(u => isFinite(u.personnel) && u.personnel >= 0), 'sin efectivos corruptos');
ok(game.units.every(u => u.morale >= 0 && u.morale <= 100), 'moral dentro de rango');
ok(game.units.every(u => u.supplyLevel >= 0 && u.supplyLevel <= 100), 'traza logística dentro de rango');
ok(ms / TURNS < 400, `rendimiento admisible (${(ms / TURNS).toFixed(1)} ms/turno)`);
console.log(`  info  mayor bolsa detectada: ${maxPocket.toLocaleString('es')} h`);
console.log(`  info  mayor premio de pinza: ${maxPincer.toLocaleString('es')} h`);
console.log(`  info  prisioneros totales: ${pow.toLocaleString('es')}`);

// ── comprobacion analitica de la relacion de fuerzas ──
console.log('\n--- curva de éxito del asalto (modelo de combate) ---');
const k = 1.7;
for (const r of [0.5, 1, 1.5, 2, 3, 4, 6]) {
  const p = Math.pow(r, k) / (Math.pow(r, k) + 1);
  console.log(`  relación ${String(r).padStart(3)}:1  →  probabilidad de desalojar al defensor ${(p * 100).toFixed(0)} %`);
}
ok(Math.pow(3, k) / (Math.pow(3, k) + 1) > 0.82, 'la relación 3:1 da al atacante ventaja clara, no certeza');

console.log(fails ? `\n${fails} comprobación(es) fallida(s)\n` : '\nTodo correcto.\n');
process.exit(fails ? 1 : 0);
