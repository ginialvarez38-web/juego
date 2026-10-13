// El director de juego con modelo de lenguaje.
//
// Igual que en los sandbox de historia alternativa con IA, el motor no tiene
// reglas fijas: el jugador escribe lo que quiere hacer y un modelo de lenguaje
// decide qué pasa en el mundo durante el salto de tiempo, redacta las noticias
// y emite cambios estructurados (conquistas, independencias, guerras, pactos)
// que game.js aplica sobre el mapa. Las negociaciones son conversaciones en
// personaje con el líder de cada país.
//
// La llamada sale directamente del navegador con la clave del jugador, que se
// guarda solo en su localStorage. Sin clave, el juego usa el simulador local.

import {
  countryStats, estPopulation, enemiesOf, alliesOf, fmtDate, provincesOf, norm, relation,
} from './game.js';

// ── ajustes ───────────────────────────────────────────────────────────────
export const PROVIDERS = {
  none: { label: 'Simulador local (sin IA)' },
  anthropic: { label: 'Claude (Anthropic)', models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'] },
  openai: { label: 'Compatible con OpenAI (OpenRouter, LM Studio, Ollama…)', models: [] },
};

export const DEFAULT_SETTINGS = {
  provider: 'none',
  apiKey: '',
  model: 'claude-opus-5-5',
  baseUrl: 'https://openrouter.ai/api/v1',
  effort: 'medium',
  creativity: 'realista',   // realista | equilibrado | caótico
};

// Modelos de Claude que admiten la red de seguridad de reintentar en otro
// modelo cuando un clasificador rechaza la petición.
const FALLBACK_OK = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-opus-5']);

export class AIError extends Error {
  constructor(msg, kind = 'api') { super(msg); this.kind = kind; }
}

/**
 * Una llamada al modelo. `messages` es [{role:'user'|'assistant', content}].
 * Devuelve el texto de la respuesta.
 */
export async function callLLM(settings, system, messages, { maxTokens = 4000, effort } = {}) {
  if (settings.provider === 'anthropic') return callAnthropic(settings, system, messages, maxTokens, effort);
  if (settings.provider === 'openai') return callOpenAI(settings, system, messages, maxTokens);
  throw new AIError('No hay ningún proveedor de IA configurado', 'config');
}

async function callAnthropic(st, system, messages, maxTokens, effort) {
  if (!st.apiKey) throw new AIError('Falta la clave de API de Anthropic', 'config');
  const model = st.model || DEFAULT_SETTINGS.model;
  const body = {
    model,
    max_tokens: maxTokens,
    system,
    messages,
  };
  const headers = {
    'content-type': 'application/json',
    'x-api-key': st.apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  if (!/haiku-4/.test(model)) body.output_config = { effort: effort || st.effort || 'medium' };
  if (FALLBACK_OK.has(model)) {
    body.fallbacks = 'default';
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
  }
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) });
  } catch (e) {
    throw new AIError('No se pudo conectar con la API de Anthropic: ' + e.message, 'network');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data.error && data.error.message) || res.statusText;
    const kind = res.status === 401 ? 'auth' : res.status === 429 ? 'rate' : res.status >= 500 ? 'server' : 'api';
    throw new AIError(`Anthropic ${res.status}: ${msg}`, kind);
  }
  if (data.stop_reason === 'refusal') {
    throw new AIError('El modelo se negó a continuar con esta petición. Prueba a reformular las acciones.', 'refusal');
  }
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  if (!text) throw new AIError('Respuesta vacía del modelo', 'empty');
  return text;
}

async function callOpenAI(st, system, messages, maxTokens) {
  const base = (st.baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new AIError('Falta la URL base del servicio', 'config');
  const headers = { 'content-type': 'application/json' };
  if (st.apiKey) headers.authorization = `Bearer ${st.apiKey}`;
  let res;
  try {
    res = await fetch(base + '/chat/completions', {
      method: 'POST', headers,
      body: JSON.stringify({
        model: st.model,
        max_tokens: maxTokens,
        messages: [{ role: 'system', content: system }, ...messages],
      }),
    });
  } catch (e) {
    throw new AIError('No se pudo conectar con ' + base + ': ' + e.message, 'network');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data.error && (data.error.message || data.error)) || res.statusText;
    throw new AIError(`${res.status}: ${msg}`, res.status === 401 ? 'auth' : 'api');
  }
  const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) throw new AIError('Respuesta vacía del modelo', 'empty');
  return text;
}

// ── JSON tolerante ────────────────────────────────────────────────────────
/** Extrae el primer objeto JSON de un texto (con o sin bloque de código). */
export function parseJSONLoose(text) {
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1];
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('sin objeto JSON');
  let s = t.slice(a, b + 1);
  try { return JSON.parse(s); } catch { /* sigue */ }
  // comas colgantes y comillas tipográficas, los dos fallos más comunes
  s = s.replace(/,\s*([}\]])/g, '$1').replace(/[“”]/g, '"');
  return JSON.parse(s);
}

// ── resumen del mundo para el modelo ──────────────────────────────────────
function countryLine(g, st, id) {
  const c = g.countries[id], s = st[id];
  const bits = [`${id} | ${c.name}`];
  if (c.leader) bits.push(`líder: ${c.leader}`);
  if (c.gov) bits.push(c.gov);
  bits.push(`${s.provinces} prov.`, `~${fmtPop(estPopulation(s))} hab.`);
  if (c.overlord) bits.push(`súbdito de ${c.overlord}`);
  return bits.join(' | ');
}
export function fmtPop(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2).replace('.', ',') + ' mil M';
  if (n >= 1e6) return Math.round(n / 1e6) + ' M';
  if (n >= 1e3) return Math.round(n / 1e3) + ' mil';
  return String(n);
}

/** Países que importan este turno: grandes, vecinos y mencionados. */
function relevantCountries(g, world, st, extraText) {
  const alive = Object.values(g.countries).filter(c => c.alive).map(c => c.id);
  const set = new Set();
  alive.slice().sort((a, b) => st[b].provinces - st[a].provinces).slice(0, 40).forEach(id => set.add(id));
  if (g.player) {
    set.add(g.player);
    for (const p of provincesOf(g, g.player)) {
      for (const q of world.provinces[p].nb) set.add(g.owner[q]);
      for (const q of world.sea[p] || []) set.add(g.owner[q]);
    }
  }
  for (const w of g.wars) { set.add(w.a); set.add(w.b); }
  for (const a of g.alliances) a.members.forEach(m => set.add(m));
  const tn = norm(extraText);
  for (const id of alive) {
    const n = norm(g.countries[id].name);
    if (n.length > 3 && tn.includes(n)) set.add(id);
  }
  return [...set].filter(id => g.countries[id] && g.countries[id].alive);
}

function borderProvinces(g, world, a, b, max = 8) {
  const out = [];
  for (const p of provincesOf(g, a)) {
    if ([...world.provinces[p].nb].some(q => g.owner[q] === b)) out.push(world.provinces[p].name);
    if (out.length >= max) break;
  }
  return out;
}

export function worldDigest(g, world, extraText = '') {
  const st = countryStats(g, world);
  const rel = relevantCountries(g, world, st, extraText);
  const lines = [];
  lines.push(`ESCENARIO: ${g.scenarioTitle}`);
  lines.push(`CONTEXTO INICIAL: ${g.context}`);
  lines.push(`FECHA ACTUAL: ${fmtDate(g.date)} (${g.date}) · turno ${g.turn}`);
  lines.push('');
  lines.push('ESTADOS RELEVANTES (código | nombre | líder | gobierno | tamaño):');
  for (const id of rel) lines.push('- ' + countryLine(g, st, id));
  const others = Object.values(g.countries).filter(c => c.alive && !rel.includes(c.id));
  if (others.length) lines.push(`Otros Estados existentes: ${others.map(c => `${c.id} ${c.name}`).join(', ')}`);
  lines.push('');
  lines.push('GUERRAS EN CURSO: ' + (g.wars.length ? g.wars.map(w => `${w.name || 'guerra'} (${w.a} contra ${w.b}, desde ${w.since || '?'})`).join('; ') : 'ninguna'));
  lines.push('ALIANZAS Y BLOQUES: ' + (g.alliances.length ? g.alliances.map(a => `${a.name} [${a.members.join(', ')}]`).join('; ') : 'ninguna'));
  if (g.player) {
    const me = g.player, c = g.countries[me];
    lines.push('');
    lines.push(`JUGADOR: ${c.name} (${me}). Provincias propias (${provincesOf(g, me).length}): ` +
      provincesOf(g, me).slice(0, 70).map(i => world.provinces[i].name).join(', '));
    const nbs = new Set();
    for (const p of provincesOf(g, me)) for (const q of world.provinces[p].nb) if (g.owner[q] !== me) nbs.add(g.owner[q]);
    for (const n of nbs) {
      const r = relation(g, me, n);
      lines.push(`Frontera con ${g.countries[n].name} (${n}, relación: ${REL_ES[r]}): sus provincias limítrofes ${borderProvinces(g, world, n, me).join(', ')}`);
    }
  }
  const recent = g.turns.slice(-3);
  if (recent.length) {
    lines.push('');
    lines.push('HISTORIA RECIENTE:');
    for (const t of recent) {
      lines.push(`[${t.date} → ${t.dateTo}] ${t.summary || ''}`);
      for (const e of (t.events || []).slice(0, 8)) lines.push(`  · ${e.title}: ${trim(e.body, 220)}`);
    }
  }
  return lines.join('\n');
}
const REL_ES = { war: 'en guerra', ally: 'aliado', subject: 'súbdito nuestro', overlord: 'nuestro señor', neutral: 'neutral', self: '-' };
const trim = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');

// ── turno ─────────────────────────────────────────────────────────────────
const CREATIVITY = {
  realista: 'Sé estrictamente plausible: los cambios grandes requieren causas y tiempo. Respeta la lógica histórica, la logística y la política interna. El jugador no es omnipotente: sus órdenes pueden fracasar, quedarse a medias o tener costes.',
  equilibrado: 'Busca un equilibrio entre plausibilidad y drama: permite giros sorprendentes si están bien justificados.',
  caotico: 'Favorece el drama y los giros inesperados: revoluciones, magnicidios, golpes de suerte. Aun así, mantén la coherencia interna.',
};

export function turnSystemPrompt(settings) {
  return `Eres el director de juego de un simulador de historia alternativa por turnos sobre un mapa del mundo dividido en provincias. El jugador gobierna un país y escribe sus órdenes en lenguaje natural; tú decides qué ocurre en el mundo entero durante el salto de tiempo indicado y lo narras como un cronista.

PRINCIPIOS
- ${CREATIVITY[settings.creativity] || CREATIVITY.realista}
- El mundo no espera al jugador: el resto de Estados persigue sus propios intereses, reacciona a lo que hace el jugador y genera sus propios acontecimientos (elecciones, crisis, golpes, tratados, guerras, avances técnicos, catástrofes).
- Resuelve TODAS las órdenes del jugador, una por una, con su resultado (éxito, éxito parcial, fracaso o consecuencia inesperada).
- Respeta lo acordado en las negociaciones diplomáticas del turno salvo que haya motivos para la traición; si un líder rechazó algo, no lo concedas.
- Las guerras avanzan poco a poco según el equilibrio de fuerzas y el tiempo transcurrido: en una semana casi nada cambia de manos; en un año pueden caer regiones enteras. No conquistes un país grande en un solo turno salvo colapso total.
- Escribe en español, con tono de crónica periodística o de libro de historia, con nombres, cifras y detalles concretos de la época.
- Los cambios de mapa solo se producen mediante la lista "changes". Nunca describas un cambio territorial que no vaya acompañado de su cambio.

FORMATO DE RESPUESTA
Responde EXCLUSIVAMENTE con un objeto JSON válido, sin texto antes ni después:
{
  "summary": "2-4 frases que resumen el período",
  "events": [
    {"date": "AAAA-MM-DD", "title": "titular breve", "body": "2-5 frases de crónica", "countries": ["COD"], "place": "ciudad principal o vacío", "kind": "guerra|diplomacia|politica|economia|sociedad|ciencia|desastre|cultura", "player": true}
  ],
  "changes": [ ...operaciones... ]
}
- Entre 4 y 12 eventos, ordenados por fecha, dentro del período del turno. Marca con "player": true los que responden a órdenes del jugador.
- Usa los códigos de país que aparecen en el estado (p. ej. "FRA"). Las provincias se nombran por su ciudad (en el idioma original del mapa o en español conocido: "Paris", "Varsovia").

OPERACIONES DISPONIBLES EN "changes"
{"type":"conquer","attacker":"COD","defender":"COD","amount":"minimal|few|some|many|most|all","toward":"Ciudad objetivo"}   ← avance militar: el mapa elige las provincias del frente en dirección al objetivo
{"type":"transfer","from":"COD","to":"COD","provinces":["Ciudad","Ciudad"]}   ← cesión concreta por tratado o compra
{"type":"annex","country":"COD","by":"COD"}   ← anexión completa (pacífica o tras derrota total)
{"type":"new_country","id":"COD_NUEVO","name":"Nombre","from":"COD","around":"Ciudad","size":"few|some|many","leader":"…","government":"…","color":"#rrggbb","overlord":"COD opcional"}   ← independencia, secesión, Estado títere
{"type":"rename","country":"COD","new_name":"…","leader":"…","government":"…","color":"#rrggbb"}   ← cambio de régimen, de líder o de nombre (todos los campos opcionales)
{"type":"war","a":"COD","b":"COD","name":"nombre de la guerra"}
{"type":"peace","a":"COD","b":"COD"}
{"type":"alliance","name":"Nombre del pacto","members":["COD","COD"]}   ← crea un bloque o añade miembros a uno existente con el mismo nombre
{"type":"leave_alliance","country":"COD","alliance":"Nombre"}
{"type":"subject","subject":"COD","overlord":"COD"}  /  {"type":"release","subject":"COD"}
Un turno tranquilo puede no tener ningún cambio. No inventes códigos para países que ya existen.`;
}

export function turnUserPrompt(g, world, jump, dateTo) {
  const acts = g.actions.length ? g.actions.map((a, i) => `${i + 1}. ${a}`).join('\n') : '(el jugador no dio órdenes este turno: solo observa)';
  const chats = Object.entries(g.chats).filter(([, m]) => m.some(x => x.turn === g.turn))
    .map(([id, m]) => `Conversación con ${g.countries[id] ? g.countries[id].name : id}:\n` +
      m.filter(x => x.turn === g.turn).map(x => `  ${x.who === 'me' ? 'Jugador' : 'Ellos'}: ${trim(x.text, 600)}`).join('\n'))
    .join('\n');
  return `${worldDigest(g, world, acts + ' ' + chats)}

PERÍODO A SIMULAR: del ${fmtDate(g.date)} al ${fmtDate(dateTo)} (${jump.label}).

ÓRDENES DEL JUGADOR (${g.countries[g.player].name}):
${acts}
${chats ? '\nNEGOCIACIONES DE ESTE TURNO:\n' + chats : ''}

Simula el período y responde con el JSON.`;
}

/** Resuelve un turno con el modelo. Devuelve {summary, events, changes}. */
export async function aiTurn(settings, g, world, jump, dateTo) {
  const system = turnSystemPrompt(settings);
  const user = turnUserPrompt(g, world, jump, dateTo);
  const messages = [{ role: 'user', content: user }];
  let text = await callLLM(settings, system, messages, { maxTokens: 12000 });
  let out;
  try {
    out = parseJSONLoose(text);
  } catch {
    messages.push({ role: 'assistant', content: text });
    messages.push({ role: 'user', content: 'Tu respuesta no era un JSON válido. Repite la respuesta completa como un único objeto JSON válido, sin ningún otro texto.' });
    text = await callLLM(settings, system, messages, { maxTokens: 12000, effort: 'low' });
    out = parseJSONLoose(text);
  }
  return {
    summary: String(out.summary || ''),
    events: Array.isArray(out.events) ? out.events.filter(e => e && e.title) : [],
    changes: Array.isArray(out.changes) ? out.changes : [],
  };
}

// ── diplomacia ────────────────────────────────────────────────────────────
export function chatSystemPrompt(g, world, id) {
  const c = g.countries[id], me = g.countries[g.player];
  const st = countryStats(g, world);
  const r = relation(g, id, g.player);
  return `Interpretas a ${c.leader || 'el jefe de Estado'} de ${c.name} (${c.gov || 'gobierno de la época'}) el ${fmtDate(g.date)}. Hablas con el representante de ${me.name}, gobernado por ${me.leader || 'su gobierno'}.

Situación: ${c.name} tiene ${st[id].provinces} provincias y unos ${fmtPop(estPopulation(st[id]))} habitantes; ${me.name} tiene ${st[g.player].provinces} provincias y unos ${fmtPop(estPopulation(st[g.player]))} habitantes. Relación actual: ${REL_ES[r]}.
Tus enemigos: ${enemiesOf(g, id).map(x => g.countries[x].name).join(', ') || 'ninguno'}. Tus aliados: ${alliesOf(g, id).map(x => g.countries[x].name).join(', ') || 'ninguno'}.
Contexto del mundo: ${g.context}
${g.turns.length ? 'Lo último que ha pasado: ' + g.turns.slice(-2).map(t => t.summary).join(' ') : ''}

Reglas:
- Responde en español, en primera persona y en personaje, con la voz, la ideología y los intereses reales de tu país y de tu época. Sé breve: 1-3 párrafos.
- Defiende tus intereses nacionales. No aceptes propuestas que te perjudiquen sin contrapartidas. Puedes negociar, exigir, amenazar, mentir o aceptar.
- Si aceptas o rechazas algo concreto (alianza, paz, cesión, comercio, acceso militar), dilo claramente: lo acordado se aplicará al avanzar el tiempo.
- No rompas el personaje ni hables de que esto es un juego.`;
}

export async function aiChat(settings, g, world, id) {
  const hist = (g.chats[id] || []).slice(-16);
  const messages = [];
  for (const m of hist) {
    const role = m.who === 'me' ? 'user' : 'assistant';
    if (messages.length && messages[messages.length - 1].role === role) messages[messages.length - 1].content += '\n\n' + m.text;
    else messages.push({ role, content: m.text });
  }
  if (!messages.length || messages[0].role !== 'user') messages.unshift({ role: 'user', content: '(Se abre el canal diplomático.)' });
  return callLLM(settings, chatSystemPrompt(g, world, id), messages, { maxTokens: 1500, effort: 'low' });
}

/** Prueba de conexión: una frase corta. */
export async function testConnection(settings) {
  const t = await callLLM(settings, 'Responde con una sola palabra.', [{ role: 'user', content: 'Di «listo».' }], { maxTokens: 300, effort: 'low' });
  return t.trim();
}
