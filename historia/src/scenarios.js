// Escenarios de partida. Cada uno decide a quién pertenece cada provincia a
// partir del país actual de su ciudad cabecera y de su posición, y define los
// Estados de la época con su gobierno, sus guerras y sus bloques.

import { MODERN, FIXED_COLORS } from './countries.js';

// ── utilidades ────────────────────────────────────────────────────────────
const inBox = (p, w, e, s, n) => p.lon >= w && p.lon <= e && p.lat >= s && p.lat <= n;
const modernId = (ne) => (MODERN[ne] || ['XXX'])[0];

function modernCountries() {
  const out = {};
  for (const [, [id, name]] of Object.entries(MODERN)) {
    if (!out[id]) out[id] = { id, name };
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════
//  MUNDO ACTUAL
// ═════════════════════════════════════════════════════════════════════════
const LEADERS_2026 = {
  USA: ['Donald Trump', 'República federal presidencialista'],
  CHN: ['Xi Jinping', 'Estado socialista de partido único'],
  RUS: ['Vladímir Putin', 'República federal semipresidencialista'],
  UKR: ['Volodímir Zelenski', 'República semipresidencialista'],
  FRA: ['Emmanuel Macron', 'República semipresidencialista'],
  DEU: ['Friedrich Merz', 'República federal parlamentaria'],
  GBR: ['Keir Starmer', 'Monarquía parlamentaria'],
  ITA: ['Giorgia Meloni', 'República parlamentaria'],
  ESP: ['Pedro Sánchez', 'Monarquía parlamentaria'],
  TUR: ['Recep Tayyip Erdoğan', 'República presidencialista'],
  IND: ['Narendra Modi', 'República federal parlamentaria'],
  BRA: ['Luiz Inácio Lula da Silva', 'República federal presidencialista'],
  MEX: ['Claudia Sheinbaum', 'República federal presidencialista'],
  ARG: ['Javier Milei', 'República federal presidencialista'],
  CAN: ['Mark Carney', 'Monarquía parlamentaria federal'],
  JPN: ['Sanae Takaichi', 'Monarquía parlamentaria'],
  KOR: ['Lee Jae-myung', 'República presidencialista'],
  PRK: ['Kim Jong-un', 'Dictadura de partido único'],
  IRN: ['Alí Jamenei', 'República islámica teocrática'],
  SAU: ['Mohammed bin Salmán', 'Monarquía absoluta'],
  ISR: ['Benjamín Netanyahu', 'República parlamentaria'],
  POL: ['Donald Tusk', 'República parlamentaria'],
  AUS: ['Anthony Albanese', 'Monarquía parlamentaria federal'],
  ZAF: ['Cyril Ramaphosa', 'República parlamentaria'],
  EGY: ['Abdelfatah al Sisi', 'República presidencialista'],
  VEN: ['Gobierno de Venezuela', 'República presidencialista'],
  CUB: ['Miguel Díaz-Canel', 'Estado socialista de partido único'],
  BLR: ['Aleksandr Lukashenko', 'República presidencialista autoritaria'],
  HUN: ['Gobierno de Hungría', 'República parlamentaria'],
  PAK: ['Shehbaz Sharif', 'República federal parlamentaria'],
  IDN: ['Prabowo Subianto', 'República presidencialista'],
  NGA: ['Bola Tinubu', 'República federal presidencialista'],
  TWN: ['Lai Ching-te', 'República semipresidencialista'],
};

const NATO = ['USA', 'CAN', 'GBR', 'FRA', 'DEU', 'ITA', 'ESP', 'PRT', 'NLD', 'BEL', 'LUX',
  'DNK', 'NOR', 'ISL', 'TUR', 'GRC', 'POL', 'CZE', 'SVK', 'HUN', 'ROU', 'BGR', 'EST',
  'LVA', 'LTU', 'SVN', 'HRV', 'ALB', 'MNE', 'MKD', 'FIN', 'SWE'];

const MODERN_SCENARIO = {
  id: 'actual',
  title: 'El mundo actual',
  year: '2026',
  date: '2026-10-13',
  blurb: 'El presente, tal y como es. Las grandes potencias compiten por un orden mundial que se resquebraja: guerras abiertas en Europa del Este y Oriente Próximo, una carrera tecnológica sin precedentes y alianzas puestas a prueba.',
  context: 'Fecha de inicio: octubre de 2026. Mundo contemporáneo con las fronteras reconocidas actuales. La guerra entre Rusia y Ucrania sigue abierta. La OTAN agrupa a Norteamérica y la mayor parte de Europa. Tensión en el estrecho de Taiwán y en Oriente Próximo. Rivalidad tecnológica y comercial entre Estados Unidos y China.',
  owner(p, ne) { return modernId(ne); },
  countries() {
    const c = modernCountries();
    for (const [id, [leader, gov]] of Object.entries(LEADERS_2026)) {
      if (c[id]) { c[id].leader = leader; c[id].gov = gov; }
    }
    return c;
  },
  wars: [{ a: 'RUS', b: 'UKR', name: 'Guerra ruso-ucraniana', since: '2022-02-24' }],
  alliances: [
    { id: 'OTAN', name: 'OTAN', color: '#3f6fb5', members: NATO },
    { id: 'OTSC', name: 'OTSC', color: '#b5473f', members: ['RUS', 'BLR', 'KAZ', 'KGZ', 'TJK'] },
  ],
  subjects: [],
  featured: ['USA', 'CHN', 'RUS', 'UKR', 'ESP', 'MEX', 'ARG', 'BRA', 'FRA', 'DEU', 'GBR', 'IND', 'JPN', 'TUR', 'IRN', 'COL'],
};

// ═════════════════════════════════════════════════════════════════════════
//  1936 — LA VÍSPERA
// ═════════════════════════════════════════════════════════════════════════
const C1936 = {
  GER: ['Alemania', 'Adolf Hitler', 'Dictadura nacionalsocialista', '#6b6f78'],
  ITA: ['Reino de Italia', 'Benito Mussolini', 'Monarquía fascista', '#4f9d5d'],
  GBR: ['Reino Unido', 'Stanley Baldwin', 'Monarquía parlamentaria (Imperio británico)', '#c8424b'],
  FRA: ['Francia', 'Pierre Laval', 'Tercera República', '#2f5fbf'],
  SOV: ['Unión Soviética', 'Iósif Stalin', 'Estado socialista de partido único', '#7a2424'],
  USA: ['Estados Unidos', 'Franklin D. Roosevelt', 'República federal', '#3f78b5'],
  JPN: ['Imperio del Japón', 'Hirohito', 'Monarquía militarista', '#e8a0a8'],
  CHN: ['República de China', 'Chiang Kai-shek', 'República nacionalista (Kuomintang)', '#d9a441'],
  MAN: ['Manchukuo', 'Puyi', 'Estado títere japonés', '#b37aa0'],
  MNG: ['Mongolia', 'Khorloogiin Choibalsan', 'República popular', '#4c6ea8'],
  TUV: ['Tannu Tuva', 'Salchak Toka', 'República popular', '#7c94c9'],
  TIB: ['Tíbet', 'Regencia de Reting Rinpoche', 'Teocracia budista', '#c9a76b'],
  ESP: ['República Española', 'Niceto Alcalá-Zamora', 'Segunda República', '#9e5ba8'],
  POR: ['Portugal', 'António de Oliveira Salazar', 'Estado Novo', '#2e8b57'],
  POL: ['Polonia', 'Ignacy Mościcki', 'República autoritaria (Sanacja)', '#d65a7a'],
  CZE: ['Checoslovaquia', 'Edvard Beneš', 'República parlamentaria', '#5aa0c8'],
  AUT: ['Austria', 'Kurt Schuschnigg', 'Estado corporativo', '#e4e4e4'],
  HUN: ['Hungría', 'Miklós Horthy', 'Regencia', '#5b8c5a'],
  ROU: ['Rumanía', 'Carlos II', 'Monarquía', '#e0c341'],
  YUG: ['Yugoslavia', 'Príncipe Pablo (regente)', 'Monarquía', '#8a6fb0'],
  BUL: ['Bulgaria', 'Boris III', 'Monarquía', '#4e8b3a'],
  GRE: ['Grecia', 'Jorge II', 'Monarquía', '#6fa8dc'],
  ALB: ['Albania', 'Zog I', 'Monarquía', '#a0522d'],
  TUR: ['Turquía', 'Mustafa Kemal Atatürk', 'República de partido único', '#b5651d'],
  FIN: ['Finlandia', 'Pehr Evind Svinhufvud', 'República', '#d8e6f5'],
  EST: ['Estonia', 'Konstantin Päts', 'República autoritaria', '#4b86b4'],
  LAT: ['Letonia', 'Kārlis Ulmanis', 'República autoritaria', '#9c4a4a'],
  LIT: ['Lituania', 'Antanas Smetona', 'República autoritaria', '#c9b037'],
  SWE: ['Suecia', 'Per Albin Hansson', 'Monarquía parlamentaria', '#3a7bd5'],
  NOR: ['Noruega', 'Johan Nygaardsvold', 'Monarquía parlamentaria', '#a05050'],
  DNK: ['Dinamarca', 'Thorvald Stauning', 'Monarquía parlamentaria', '#c96b6b'],
  ISL: ['Islandia', 'Hermann Jónasson', 'Reino en unión con Dinamarca', '#87a9d6'],
  IRL: ['Estado Libre Irlandés', 'Éamon de Valera', 'Dominio británico', '#3f9b5f'],
  BEL: ['Bélgica', 'Leopoldo III', 'Monarquía parlamentaria', '#d4b400'],
  NLD: ['Países Bajos', 'Guillermina', 'Monarquía parlamentaria', '#f08a24'],
  CHE: ['Suiza', 'Albert Meyer', 'Confederación', '#b22222'],
  LUX: ['Luxemburgo', 'Carlota', 'Gran Ducado', '#7fb3d5'],
  ETH: ['Imperio etíope', 'Haile Selassie', 'Monarquía absoluta', '#e0b040'],
  EGY: ['Reino de Egipto', 'Fuad I', 'Monarquía bajo influencia británica', '#d6b85a'],
  IRQ: ['Reino de Irak', 'Ghazi I', 'Monarquía', '#8f7a4a'],
  SAU: ['Arabia Saudí', 'Abdulaziz ibn Saud', 'Monarquía absoluta', '#7a9a3a'],
  YEM: ['Reino de Yemen', 'Imán Yahya', 'Imanato', '#a8835a'],
  OMN: ['Mascate y Omán', 'Said bin Taimur', 'Sultanato', '#b36a5e'],
  IRN: ['Irán', 'Reza Shah Pahlaví', 'Monarquía autoritaria', '#5ca57a'],
  AFG: ['Afganistán', 'Mohammed Zahir Shah', 'Monarquía', '#7a6a4f'],
  RAJ: ['Raj británico', 'Lord Linlithgow (virrey)', 'Colonia de la Corona', '#e8875a'],
  SIA: ['Siam', 'Phraya Phahon', 'Monarquía constitucional', '#58a8a0'],
  NPL: ['Nepal', 'Juddha Shamsher Rana', 'Monarquía (régimen Rana)', '#c25a7c'],
  BTN: ['Bután', 'Jigme Wangchuck', 'Monarquía', '#e09a5a'],
  LBR: ['Liberia', 'Edwin Barclay', 'República', '#5a6fb0'],
  ZAF: ['Unión Sudafricana', 'J. B. M. Hertzog', 'Dominio británico', '#d4a017'],
  CAN: ['Canadá', 'William Lyon Mackenzie King', 'Dominio británico', '#c8505a'],
  NFL: ['Terranova', 'Comisión de Gobierno', 'Dominio británico (administración directa)', '#d08080'],
  AUS: ['Australia', 'Joseph Lyons', 'Dominio británico', '#2a9d8f'],
  NZL: ['Nueva Zelanda', 'Michael Joseph Savage', 'Dominio británico', '#4fb3a8'],
  MEX: ['México', 'Lázaro Cárdenas', 'República federal', '#3e8f5e'],
  BRA: ['Brasil', 'Getúlio Vargas', 'República (Era Vargas)', '#4caf50'],
  ARG: ['Argentina', 'Agustín P. Justo', 'República (Década Infame)', '#8ecae6'],
  CHL: ['Chile', 'Arturo Alessandri', 'República', '#a3332f'],
  PER: ['Perú', 'Óscar R. Benavides', 'República autoritaria', '#c94f4f'],
  COL: ['Colombia', 'Alfonso López Pumarejo', 'República', '#e8c547'],
  VEN: ['Venezuela', 'Eleazar López Contreras', 'República', '#9b4f96'],
  BOL: ['Bolivia', 'David Toro', 'Junta militar', '#6aa84f'],
  PRY: ['Paraguay', 'Eusebio Ayala', 'República', '#4a7ab0'],
  URY: ['Uruguay', 'Gabriel Terra', 'República', '#7fa7d9'],
  ECU: ['Ecuador', 'Federico Páez', 'República', '#c9c24a'],
  CUB: ['Cuba', 'Miguel Mariano Gómez', 'República', '#2557a6'],
  GTM: ['Guatemala', 'Jorge Ubico', 'Dictadura', '#4f97a3'],
};

/** Raíz moderna → país de 1936 por defecto (sin contar las excepciones geográficas). */
const BASE_1936 = {
  DEU: 'GER', ITA: 'ITA', GBR: 'GBR', FRA: 'FRA', USA: 'USA', JPN: 'JPN', CHN: 'CHN',
  MNG: 'MNG', ESP: 'ESP', PRT: 'POR', POL: 'POL', CZE: 'CZE', SVK: 'CZE', AUT: 'AUT',
  HUN: 'HUN', ROU: 'ROU', MDA: 'ROU', BGR: 'BUL', GRC: 'GRE', ALB: 'ALB', TUR: 'TUR',
  FIN: 'FIN', EST: 'EST', LVA: 'LAT', LTU: 'LIT', SWE: 'SWE', NOR: 'NOR', DNK: 'DNK',
  ISL: 'ISL', IRL: 'IRL', BEL: 'BEL', NLD: 'NLD', CHE: 'CHE', LUX: 'LUX', LIE: 'CHE',
  AND: 'ESP', MCO: 'FRA', SMR: 'ITA', MLT: 'GBR', CYP: 'GBR', CYN: 'GBR',
  SRB: 'YUG', HRV: 'YUG', SVN: 'YUG', BIH: 'YUG', MNE: 'YUG', MKD: 'YUG', XKX: 'YUG',
  RUS: 'SOV', UKR: 'SOV', BLR: 'SOV', KAZ: 'SOV', UZB: 'SOV', TKM: 'SOV', KGZ: 'SOV',
  TJK: 'SOV', GEO: 'SOV', ARM: 'SOV', AZE: 'SOV',
  // Oriente Próximo
  EGY: 'EGY', IRQ: 'IRQ', SAU: 'SAU', YEM: 'YEM', OMN: 'OMN', IRN: 'IRN', AFG: 'AFG',
  SYR: 'FRA', LBN: 'FRA', JOR: 'GBR', ISR: 'GBR', PSE: 'GBR', KWT: 'GBR', QAT: 'GBR',
  ARE: 'GBR', BHR: 'GBR',
  // Asia
  IND: 'RAJ', PAK: 'RAJ', BGD: 'RAJ', MMR: 'RAJ', LKA: 'GBR', NPL: 'NPL', BTN: 'BTN',
  THA: 'SIA', VNM: 'FRA', LAO: 'FRA', KHM: 'FRA', MYS: 'GBR', SGP: 'GBR', BRN: 'GBR',
  IDN: 'NLD', TLS: 'POR', PHL: 'USA', KOR: 'JPN', PRK: 'JPN', TWN: 'JPN', MDV: 'GBR',
  // África
  MAR: 'FRA', DZA: 'FRA', TUN: 'FRA', LBY: 'ITA', ERI: 'ITA', SOM: 'ITA', SOL: 'GBR',
  DJI: 'FRA', ETH: 'ETH', SDN: 'GBR', SSD: 'GBR', MRT: 'FRA', SEN: 'FRA', MLI: 'FRA',
  BFA: 'FRA', NER: 'FRA', GIN: 'FRA', CIV: 'FRA', BEN: 'FRA', TGO: 'FRA', TCD: 'FRA',
  CAF: 'FRA', COG: 'FRA', GAB: 'FRA', CMR: 'FRA', MDG: 'FRA', COM: 'FRA',
  GMB: 'GBR', SLE: 'GBR', GHA: 'GBR', NGA: 'GBR', KEN: 'GBR', UGA: 'GBR', TZA: 'GBR',
  MWI: 'GBR', ZMB: 'GBR', ZWE: 'GBR', BWA: 'GBR', LSO: 'GBR', SWZ: 'GBR', MUS: 'GBR',
  SYC: 'GBR', COD: 'BEL', RWA: 'BEL', BDI: 'BEL', AGO: 'POR', MOZ: 'POR', GNB: 'POR',
  CPV: 'POR', STP: 'POR', GNQ: 'ESP', LBR: 'LBR', ZAF: 'ZAF', NAM: 'ZAF',
  // Oceanía
  AUS: 'AUS', NZL: 'NZL', PNG: 'AUS', SLB: 'GBR', VUT: 'FRA', FJI: 'GBR', TON: 'GBR',
  WSM: 'NZL', KIR: 'GBR', MHL: 'JPN',
  // América
  CAN: 'CAN', MEX: 'MEX', BRA: 'BRA', ARG: 'ARG', CHL: 'CHL', PER: 'PER', COL: 'COL',
  VEN: 'VEN', BOL: 'BOL', PRY: 'PRY', URY: 'URY', ECU: 'ECU', CUB: 'CUB', GTM: 'GTM',
  GUY: 'GBR', SUR: 'NLD', BLZ: 'GBR', JAM: 'GBR', TTO: 'GBR', BRB: 'GBR', BHS: 'GBR',
  GRD: 'GBR', LCA: 'GBR', VCT: 'GBR', KNA: 'GBR', ATG: 'GBR', DMA: 'GBR',
};

/** Excepciones geográficas: las fronteras de entreguerras no son las de hoy. */
function owner1936(p, ne) {
  const m = modernId(ne);
  // Alemania: Pomerania, Silesia y Prusia Oriental
  if (m === 'POL') {
    if (p.lon < 15.9) return 'GER';
    if (p.lat < 51.8 && p.lon < 18.4) return 'GER';
    if (p.lat > 53.4 && p.lon < 17.2) return 'GER';
    if (p.lat > 53.35 && p.lon > 19.3 && p.lon < 22.9) return 'GER';
  }
  if (m === 'RUS' && p.lon < 23 && p.lat > 54) return 'GER';          // Königsberg
  if (m === 'LTU' && p.lon < 21.4 && p.lat > 55.4) return 'LIT';        // Memel, lituana
  // Polonia oriental: Galitzia, Volinia, Bielorrusia occidental, Vilna
  if (m === 'UKR') {
    if (p.lon < 24.2 && p.lat < 48.7) return 'CZE';                    // Rutenia subcarpática
    if (p.lon < 26.6 && p.lat < 48.45) return 'ROU';                   // Bucovina
    if (p.lon < 26.6 && p.lat >= 48.45) return 'POL';
    if (p.lon < 30 && p.lat < 46.5 && p.lon > 28.2) return 'ROU';      // Besarabia meridional
  }
  if (m === 'BLR' && p.lon < 27.2) return 'POL';
  if (m === 'LTU' && p.lon > 24.6 && p.lat < 55.2) return 'POL';       // Vilna
  // Rumanía: Dobruja meridional
  if (m === 'BGR' && p.lat > 43.45 && p.lon > 26.6) return 'ROU';
  // Finlandia: Carelia y Petsamo
  if (m === 'RUS' && p.lat > 60.4 && p.lat < 62.6 && p.lon < 31.2) return 'FIN';
  if (m === 'RUS' && p.lat > 68.8 && p.lon < 31.6) return 'FIN';
  // Tuvá
  if (m === 'RUS' && inBox(p, 88.5, 99.5, 49.6, 53.2)) return 'TUV';
  // Japón: Karafuto, Kuriles y Kwantung
  if (m === 'RUS' && inBox(p, 141, 144.8, 45.5, 50)) return 'JPN';
  if (m === 'RUS' && inBox(p, 145, 157, 43, 51)) return 'JPN';
  if (m === 'CHN' && inBox(p, 120.8, 122.6, 38.6, 39.6)) return 'JPN';
  // Manchukuo (incluida Jehol) y Tíbet
  if (m === 'CHN') {
    if ((p.lon >= 119 && p.lat >= 40.2) || (p.lon >= 116.2 && p.lat >= 41.1)) return 'MAN';
    if (p.lon < 98.6 && p.lon > 78 && p.lat < 36 && p.lat > 26.5) return 'TIB';
    if (inBox(p, 113.8, 114.5, 22.1, 22.6)) return 'GBR';               // Hong Kong
    if (inBox(p, 113.4, 113.7, 22.0, 22.3)) return 'POR';               // Macao
  }
  if (ne === 'Hong Kong S.A.R.') return 'GBR';
  if (ne === 'Macau S.A.R') return 'POR';
  // Italia: Istria, Zara, Dodecaneso
  if ((m === 'HRV' || m === 'SVN') && p.lon < 14.6 && p.lat > 44.9) return 'ITA';
  if (m === 'GRC' && inBox(p, 26.8, 28.4, 35.8, 37.6)) return 'ITA';
  // Francia: el sanjak de Alejandreta
  if (m === 'TUR' && inBox(p, 35.6, 36.8, 35.8, 37.0)) return 'FRA';
  // España: protectorado del norte de Marruecos y Sáhara
  if (m === 'MAR' && p.lat > 34.6 && p.lon < -2.2) return 'ESP';
  if (m === 'MAR' && p.lat < 27.7) return 'ESP';
  // Reino Unido: Adén y los Camerunes británicos
  if (m === 'YEM' && p.lat < 14.6 && p.lon > 44.6) return 'GBR';
  if (m === 'CMR' && p.lon < 11.2 && p.lat > 4.4) return 'GBR';
  // Terranova y Labrador
  if (m === 'CAN' && (p.lon > -59.5 || (p.lon > -67 && p.lat > 51.5 && p.lat < 60.5 && p.lon > -64.5)) && p.lat > 46.5) return 'NFL';
  return BASE_1936[m] || m;
}

const SCENARIO_1936 = {
  id: '1936',
  title: 'La víspera de la tormenta',
  year: '1936',
  date: '1936-01-01',
  blurb: 'Enero de 1936. Alemania se rearma a las órdenes de Hitler, Italia invade Etiopía, Japón domina Manchuria y Europa entera presiente otra gran guerra. Los imperios coloniales cubren medio planeta. Todo puede cambiar.',
  context: 'Fecha de inicio: 1 de enero de 1936. Período de entreguerras. Alemania nazi rearmándose (la remilitarización de Renania aún no ha ocurrido). Italia fascista en guerra con Etiopía. Japón controla Corea, Taiwán y el Estado títere de Manchukuo. La Unión Soviética de Stalin. Imperios coloniales británico, francés, neerlandés, belga y portugués. España es una república inestable a meses de la guerra civil. Estados Unidos en la Gran Depresión y el New Deal, aislacionista. China dividida entre nacionalistas, comunistas y señores de la guerra.',
  owner: owner1936,
  countries() {
    const out = {};
    for (const [id, [name, leader, gov, color]] of Object.entries(C1936)) out[id] = { id, name, leader, gov, color };
    return out;
  },
  wars: [{ a: 'ITA', b: 'ETH', name: 'Segunda guerra ítalo-etíope', since: '1935-10-03' }],
  alliances: [
    { id: 'PEQ', name: 'Pequeña Entente', color: '#5aa0c8', members: ['CZE', 'YUG', 'ROU'] },
    { id: 'BAL', name: 'Entente Balcánica', color: '#8a6fb0', members: ['YUG', 'ROU', 'GRE', 'TUR'] },
    { id: 'FSV', name: 'Pacto franco-soviético', color: '#7a5a9a', members: ['FRA', 'SOV'] },
  ],
  subjects: [
    { overlord: 'GBR', subject: 'RAJ' }, { overlord: 'GBR', subject: 'NFL' },
    { overlord: 'JPN', subject: 'MAN' }, { overlord: 'SOV', subject: 'MNG' },
    { overlord: 'SOV', subject: 'TUV' },
  ],
  featured: ['GER', 'ITA', 'GBR', 'FRA', 'SOV', 'USA', 'JPN', 'CHN', 'ESP', 'POL', 'ETH', 'TUR', 'MEX', 'ARG', 'BRA', 'RAJ'],
};

export const SCENARIOS = [MODERN_SCENARIO, SCENARIO_1936];
export const scenarioById = (id) => SCENARIOS.find(s => s.id === id);
export { FIXED_COLORS };
