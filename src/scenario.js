// Definicion del escenario y construccion del estado inicial de la campaña.
import { makeRng } from './rng.js';
import { generateTheater, assignSupplyBases } from './worldgen.js';
import { buildArmy } from './units.js';
import { SIDES, occupancy, computeZOC, computeSupply, computeDetection } from './sim.js';
import { analyze } from './analysis.js';

export const MAP_W = 56, MAP_H = 30;

function newSide(name, color, opts) {
  return {
    name, color, doctrine: opts.doctrine, ai: opts.ai, aggression: opts.aggression ?? 0.6,
    bases: [], logRangeBase: opts.logRange, logRange: opts.logRange, transportPush: 50,
    stockpile: 420, stockpileMax: 700, production: opts.production, demand: 0,
    replacements: opts.replacements,
    air: {
      capacity: opts.airCapacity, readiness: 92, quality: opts.airQuality,
      alloc: { cap: 35, cas: 30, interdiction: 20, recon: 15 }, sorties: 0,
    },
    airSuperiority: 0, interdictedBy: 0, counterBatteryPenalty: 0,
    casualties: { total: 0, pow: 0 }, vp: 0, plan: {},
  };
}

export function createGame(seed, { W = MAP_W, H = MAP_H } = {}) {
  const rng = makeRng(seed);
  const world = generateTheater(W, H, rng);
  const game = {
    seed, W, H, N: W * H, hexes: world.hexes, cities: world.cities, rng,
    turn: 0, time: { day: 1, hour: 5 }, season: 'otoño',
    weather: { type: 'despejado', ground: 'firme' },
    player: 'BLUE',
    sides: {
      BLUE: newSide('Fuerzas Azules', '#5b8fd4', {
        doctrine: 'profunda', ai: false, logRange: 60, production: 52,
        replacements: 70000, airCapacity: 140, airQuality: 0.6,
      }),
      RED: newSide('Fuerzas Rojas', '#c9584c', {
        doctrine: 'elastica', ai: true, aggression: 0.55, logRange: 56, production: 46,
        replacements: 62000, airCapacity: 115, airQuality: 0.45,
      }),
    },
    units: [], byId: {}, _supply: {}, analysis: null, over: null,
  };

  game.sides.BLUE.bases = assignSupplyBases(world, 'BLUE', 'W');
  game.sides.RED.bases = assignSupplyBases(world, 'RED', 'E');

  const blue = buildArmy(world, 'BLUE', rng, {
    armyName: '1.er Ejército «Adalid»',
    corpsNames: ['Hierro', 'Tormenta', 'Lanza'],
    corps: [
      { line: ['mech', 'mech', 'inf', 'inf'], support: ['arty', 'eng', 'recon'] },
      { line: ['arm', 'mech', 'inf', 'inf'], support: ['arty', 'rocket', 'eng'] },
      { line: ['inf', 'inf', 'mtz', 'inf'], support: ['arty', 'aa', 'log'] },
    ],
    reserve: ['gd', 'arm', 'mech', 'rocket', 'log', 'para'],
    frontCol: Math.round(W * 0.44), supportCol: Math.round(W * 0.33), hqCol: Math.round(W * 0.26),
    rearCol: Math.round(W * 0.12), reserveCol: Math.round(W * 0.22),
    startPosture: 'defensa', startEntrench: 1.5,
  });
  const red = buildArmy(world, 'RED', rng, {
    armyName: '4.º Ejército «Baluarte»',
    corpsNames: ['Roble', 'Yunque', 'Granito'],
    corps: [
      { line: ['inf', 'inf', 'inf', 'mtz'], support: ['arty', 'eng', 'aa'] },
      { line: ['inf', 'mech', 'inf', 'inf'], support: ['arty', 'rocket', 'log'] },
      { line: ['inf', 'inf', 'mtn', 'inf'], support: ['arty', 'eng', 'recon'] },
    ],
    reserve: ['arm', 'mech', 'arm', 'log', 'aa'],
    frontCol: Math.round(W * 0.54), supportCol: Math.round(W * 0.65), hqCol: Math.round(W * 0.72),
    rearCol: Math.round(W * 0.87), reserveCol: Math.round(W * 0.78),
    startPosture: 'fortificada', startEntrench: 3.0,
  });
  game.units = [...blue, ...red];
  for (const u of game.units) game.byId[u.id] = u;

  game._occ = occupancy(game);
  game._zoc = computeZOC(game);
  for (const s of SIDES) game._supply[s] = computeSupply(game, s);
  computeDetection(game);
  for (const u of game.units) u.supplyLevel = game._supply[u.side].level[u.row * game.W + u.col];
  analyze(game);
  return game;
}
