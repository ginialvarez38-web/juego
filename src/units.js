// Orden de batalla. Escalon operacional: la ficha es una division o brigada
// independiente; el turno son 6 horas; el hexagono 5 km. Los efectivos, dotaciones
// y consumos siguen ordenes de magnitud de una TOE mecanizada contemporanea.

export const POSTURES = {
  asalto:      { name: 'Asalto deliberado', atk: 1.35, def: 0.65, cas: 1.55, ammo: 2.4, fuel: 1.5, entrench: -1.0, move: 0.5, fatigue: 2.3 },
  ataque:      { name: 'Ataque',            atk: 1.00, def: 0.80, cas: 1.15, ammo: 1.6, fuel: 1.2, entrench: -0.5, move: 0.8, fatigue: 1.6 },
  sondeo:      { name: 'Reconocimiento en fuerza', atk: 0.45, def: 0.95, cas: 0.55, ammo: 0.8, fuel: 1.0, entrench: 0, move: 1.0, fatigue: 1.0 },
  avance:      { name: 'Marcha de aproximación', atk: 0.55, def: 0.70, cas: 0.75, ammo: 0.5, fuel: 1.6, entrench: 0, move: 1.35, fatigue: 1.2 },
  defensa:     { name: 'Defensa móvil',     atk: 0.60, def: 1.15, cas: 0.85, ammo: 0.9, fuel: 0.8, entrench: 0.6, move: 0.7, fatigue: 0.8 },
  fortificada: { name: 'Defensa firme',     atk: 0.25, def: 1.45, cas: 0.75, ammo: 0.8, fuel: 0.3, entrench: 1.4, move: 0.2, fatigue: 0.5 },
  reserva:     { name: 'Reserva operativa', atk: 0.40, def: 0.90, cas: 0.60, ammo: 0.2, fuel: 0.4, entrench: 0.4, move: 1.0, fatigue: -0.6 },
  retirada:    { name: 'Retirada / ruptura de contacto', atk: 0.10, def: 0.45, cas: 1.05, ammo: 0.4, fuel: 1.4, entrench: -1.5, move: 1.4, fatigue: 1.3 },
};

export const DOCTRINES = {
  profunda:  { name: 'Batalla en profundidad', exploit: 1.35, cohesion: 1.05, artyPrep: 1.15, defBonus: 0.90, c2: 1.10,
    desc: 'Ruptura en un punto y explotación inmediata con escalones móviles hacia la retaguardia enemiga.' },
  relampago: { name: 'Guerra relámpago',      exploit: 1.50, cohesion: 0.95, artyPrep: 0.85, defBonus: 0.85, c2: 1.25,
    desc: 'Schwerpunkt estrecho, iniciativa delegada al mando local, tempo por encima de la consolidación.' },
  desgaste:  { name: 'Desgaste metódico',     exploit: 0.75, cohesion: 1.15, artyPrep: 1.45, defBonus: 1.05, c2: 0.85,
    desc: 'Preparación artillera masiva, avances cortos y consolidados. Menos riesgo, más bajas por kilómetro.' },
  elastica:  { name: 'Defensa elástica',      exploit: 0.90, cohesion: 1.10, artyPrep: 1.00, defBonus: 1.30, c2: 1.00,
    desc: 'Cede terreno para conservar fuerzas; contraataques de reserva contra el flanco del penetrante.' },
};

const T = (o) => Object.assign({
  personnel: 10000, tanks: 0, ifv: 0, apc: 0, guns: 0, mlrs: 0, atgm: 0, aa: 0, trucks: 500,
  soft: 1.0, hard: 0.5, def: 1.0, mp: 12, roadMp: 20, indRange: 2, recon: 1.0,
  engineer: 0.2, entrenchRate: 1.0, cmdRadius: 0, logBoost: 0, exploit: 1.0, symbol: 'inf',
}, o);

export const TEMPLATES = {
  inf:      T({ name: 'División de Infantería',   personnel: 12800, apc: 140, guns: 54, atgm: 96, aa: 36, trucks: 950,
                soft: 1.00, hard: 0.42, def: 1.20, mp: 11, roadMp: 20, entrenchRate: 1.25, symbol: 'inf' }),
  mtz:      T({ name: 'División Motorizada',      personnel: 13400, tanks: 40, apc: 320, guns: 54, atgm: 72, aa: 30, trucks: 1500,
                soft: 1.10, hard: 0.62, def: 1.10, mp: 15, roadMp: 30, exploit: 1.15, symbol: 'mtz' }),
  mech:     T({ name: 'División Mecanizada',      personnel: 15200, tanks: 118, ifv: 262, guns: 72, atgm: 60, aa: 42, trucks: 1800,
                soft: 1.30, hard: 1.05, def: 1.15, mp: 16, roadMp: 30, exploit: 1.30, symbol: 'mech' }),
  arm:      T({ name: 'División Acorazada',       personnel: 11600, tanks: 296, ifv: 172, guns: 54, atgm: 24, aa: 36, trucks: 1600,
                soft: 1.45, hard: 1.85, def: 1.00, mp: 18, roadMp: 34, exploit: 1.55, entrenchRate: 0.7, symbol: 'arm' }),
  gd:       T({ name: 'División Acorazada de la Guardia', personnel: 12200, tanks: 320, ifv: 190, guns: 60, atgm: 24, aa: 40, trucks: 1700,
                soft: 1.58, hard: 2.00, def: 1.05, mp: 18, roadMp: 34, exploit: 1.65, entrenchRate: 0.7, symbol: 'arm' }),
  para:     T({ name: 'Brigada Paracaidista',     personnel: 4600, apc: 40, guns: 18, atgm: 54, aa: 18, trucks: 220,
                soft: 0.55, hard: 0.20, def: 0.95, mp: 12, roadMp: 18, entrenchRate: 1.4, symbol: 'para' }),
  mtn:      T({ name: 'Brigada de Montaña',       personnel: 5200, guns: 24, atgm: 48, aa: 12, trucks: 260,
                soft: 0.60, hard: 0.22, def: 1.35, mp: 10, roadMp: 15, entrenchRate: 1.35, symbol: 'mtn' }),
  arty:     T({ name: 'Brigada de Artillería',    personnel: 3400, guns: 96, mlrs: 18, aa: 12, trucks: 900,
                soft: 0.35, hard: 0.20, def: 0.55, mp: 12, roadMp: 22, indRange: 3, symbol: 'arty' }),
  rocket:   T({ name: 'Brigada de Cohetes',       personnel: 2400, mlrs: 54, aa: 8, trucks: 700,
                soft: 0.25, hard: 0.15, def: 0.40, mp: 13, roadMp: 24, indRange: 5, symbol: 'rocket' }),
  recon:    T({ name: 'Regimiento de Reconocimiento', personnel: 1900, tanks: 18, ifv: 64, guns: 12, aa: 6, trucks: 260,
                soft: 0.32, hard: 0.28, def: 0.50, mp: 22, roadMp: 40, recon: 4.2, exploit: 1.4, symbol: 'recon' }),
  eng:      T({ name: 'Brigada de Ingenieros',    personnel: 2900, apc: 60, trucks: 620,
                soft: 0.18, hard: 0.10, def: 0.60, mp: 12, roadMp: 22, engineer: 3.5, entrenchRate: 2.6, symbol: 'eng' }),
  aa:       T({ name: 'Brigada Antiaérea',        personnel: 2100, aa: 108, trucks: 420,
                soft: 0.20, hard: 0.12, def: 0.50, mp: 13, roadMp: 24, symbol: 'aa' }),
  log:      T({ name: 'Brigada Logística',        personnel: 2800, trucks: 2600,
                soft: 0.06, hard: 0.03, def: 0.30, mp: 13, roadMp: 26, logBoost: 3.0, symbol: 'log' }),
  corpsHQ:  T({ name: 'Cuartel General de Cuerpo', personnel: 1300, apc: 40, trucks: 300,
                soft: 0.10, hard: 0.05, def: 0.45, mp: 14, roadMp: 26, cmdRadius: 9, recon: 1.5, symbol: 'hq' }),
  armyHQ:   T({ name: 'Cuartel General de Ejército', personnel: 2200, apc: 60, trucks: 500,
                soft: 0.12, hard: 0.06, def: 0.50, mp: 12, roadMp: 24, cmdRadius: 15, recon: 2.0, logBoost: 1.5, symbol: 'hq' }),
};

export const ECHELON = { armyHQ: 'EJÉRCITO', corpsHQ: 'CUERPO', default: 'DIVISIÓN' };

let _uid = 1;
export function makeUnit(side, type, col, row, name, hqId = null, opts = {}) {
  const t = TEMPLATES[type];
  const u = {
    id: _uid++, side, type, name, hqId, col, row,
    tpl: t,
    personnel: t.personnel, personnelMax: t.personnel,
    equip: { tanks: t.tanks, ifv: t.ifv, apc: t.apc, guns: t.guns, mlrs: t.mlrs, atgm: t.atgm, aa: t.aa, trucks: t.trucks },
    equipMax: { tanks: t.tanks, ifv: t.ifv, apc: t.apc, guns: t.guns, mlrs: t.mlrs, atgm: t.atgm, aa: t.aa, trucks: t.trucks },

    morale: 78, cohesion: 82, fatigue: 6, suppression: 0,
    experience: opts.exp ?? 45, entrench: opts.entrench ?? 0,
    ammo: 100, fuel: 100, stores: 100,     // porcentaje sobre dotacion de combate
    supplyLevel: 100,                       // trazabilidad desde la base (0-100)
    isolatedTurns: 0,

    posture: 'defensa',
    order: null,                            // { type, col, row, path, issuedTurn, activeTurn }
    pending: null,                          // orden en transito por la cadena de mando
    effort: 0.7,                            // intensidad de esfuerzo (consumo/bajas)
    logPriority: 1,                         // 0 baja, 1 normal, 2 prioritaria
    reservePct: 0.15,                       // fuerza retenida en segundo escalon
    roeCasualty: 35,                        // se rompe contacto si bajas acumuladas > %
    roeMorale: 25,                          // se rompe contacto si moral < %
    artyMission: 'apoyo',                   // apoyo | contrabateria | interdiccion | preparacion
    allowRetreat: true, digIn: true,

    detected: 0, lastSeen: null, lastSeenTurn: -99,
    status: 'ok', trail: [], engagedTurn: -9,
    casualtiesTotal: 0, kills: 0, mpLeft: 0, movedThisTurn: 0,
    combatLog: [],
  };
  return u;
}

/** Genera un ejercito completo desplegado en una banda vertical del mapa. */
export function buildArmy(world, side, rng, cfg) {
  const { W, H } = world;
  const units = [];
  const corpsNames = cfg.corpsNames;
  const rnum = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  const ord = ['1.ª', '2.ª', '3.ª', '4.ª', '5.ª', '6.ª', '7.ª', '8.ª', '9.ª', '10.ª',
    '11.ª', '12.ª', '13.ª', '14.ª', '15.ª', '16.ª', '17.ª', '18.ª', '19.ª', '20.ª'];
  let divIdx = 0;

  const free = (col, row) => {
    const h = world.hexes[row * W + col];
    return h && h.t !== 'agua' && h.t !== 'montana' && !units.some(u => u.col === col && u.row === row);
  };
  const place = (colWish, rowWish) => {
    for (let r = 0; r < 60; r++) {
      const c = Math.max(1, Math.min(W - 2, colWish + Math.round(rng.gauss(0, r * 0.25))));
      const rr = Math.max(1, Math.min(H - 2, rowWish + Math.round(rng.gauss(0, 1 + r * 0.25))));
      if (free(c, rr)) return [c, rr];
    }
    return [colWish, rowWish];
  };

  // Cuartel general de ejercito, en profundidad
  const [ahc, ahr] = place(cfg.rearCol, Math.floor(H / 2));
  const armyHQ = makeUnit(side, 'armyHQ', ahc, ahr, `${cfg.armyName}`, null, { exp: 70 });
  armyHQ.posture = 'reserva';
  units.push(armyHQ);

  const nCorps = cfg.corps.length;
  for (let ci = 0; ci < nCorps; ci++) {
    const spec = cfg.corps[ci];
    const bandTop = Math.floor(H * (ci / nCorps)) + 1;
    const bandBot = Math.floor(H * ((ci + 1) / nCorps)) - 1;
    const midRow = Math.floor((bandTop + bandBot) / 2);

    const [hc, hr] = place(cfg.hqCol, midRow);
    const hq = makeUnit(side, 'corpsHQ', hc, hr, `${rnum[ci]} Cuerpo «${corpsNames[ci]}»`, armyHQ.id, { exp: 60 });
    hq.posture = 'reserva';
    units.push(hq);

    let slot = 0;
    const span = Math.max(1, bandBot - bandTop);
    for (const type of spec.line) {
      const row = bandTop + Math.round(span * (slot + 0.5) / spec.line.length);
      const [c, r] = place(cfg.frontCol + rng.int(2), row);
      const nm = `${ord[divIdx++] || (divIdx + '.ª')} ${shortName(type)}`;
      const u = makeUnit(side, type, c, r, nm, hq.id, { exp: 35 + rng.int(35), entrench: cfg.startEntrench });
      u.posture = cfg.startPosture;
      units.push(u); slot++;
    }
    for (const type of spec.support) {
      const [c, r] = place(cfg.supportCol, midRow + rng.int(5) - 2);
      const nm = `${ord[divIdx++] || (divIdx + '.ª')} ${shortName(type)}`;
      const u = makeUnit(side, type, c, r, nm, hq.id, { exp: 40 + rng.int(30) });
      u.posture = type === 'arty' || type === 'rocket' ? 'defensa' : 'reserva';
      units.push(u);
    }
  }
  // Reserva de ejercito (los escalones de explotacion)
  for (const type of cfg.reserve) {
    const [c, r] = place(cfg.reserveCol, 3 + rng.int(H - 6));
    const nm = `${ord[divIdx++] || (divIdx + '.ª')} ${shortName(type)}`;
    const u = makeUnit(side, type, c, r, nm, armyHQ.id, { exp: 50 + rng.int(30) });
    u.posture = 'reserva';
    units.push(u);
  }
  return units;
}

function shortName(type) {
  return {
    inf: 'División de Infantería', mtz: 'División Motorizada', mech: 'División Mecanizada',
    arm: 'División Acorazada', gd: 'División Acorazada de la Guardia', para: 'Brigada Paracaidista',
    mtn: 'Brigada de Montaña', arty: 'Brigada de Artillería', rocket: 'Brigada de Cohetes',
    recon: 'Regimiento de Reconocimiento', eng: 'Brigada de Ingenieros', aa: 'Brigada Antiaérea',
    log: 'Brigada Logística',
  }[type] || TEMPLATES[type].name;
}

export function unitStrengthFrac(u) { return u.personnel / u.personnelMax; }

export function equipFrac(u) {
  let cur = 0, max = 0;
  for (const k of ['tanks', 'ifv', 'apc', 'guns', 'mlrs', 'atgm', 'aa']) {
    cur += u.equip[k]; max += u.equipMax[k];
  }
  return max > 0 ? cur / max : 1;
}
