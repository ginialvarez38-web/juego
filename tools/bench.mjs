// Mide el coste real de un fotograma en un navegador de verdad.
//
// El modo de tiempo virtual de Chrome congela performance.now(), asi que los
// contadores de fotogramas y los cronometros dentro de la pagina dan cero. Se
// arranca el navegador en tiempo real y se le habla por el protocolo de
// depuracion para evaluar la medicion dentro de la pagina.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_ = process.argv[2] || 'http://localhost:8099/dist/_test.html?brief=0';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PORT = 9333;

const profile = mkdtempSync(join(tmpdir(), 'bench-'));
const proc = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  '--window-size=1500,900', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, URL_,
], { stdio: 'ignore' });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function targetWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* aun arrancando */ }
    await sleep(400);
  }
  throw new Error('el navegador no respondio');
}

const EXPR = `(() => {
  const R = window.THEATRUM && window.THEATRUM.rnd;
  if (!R) return { error: 'sin renderizador' };
  const bench = (n) => { const t = performance.now(); for (let i = 0; i < n; i++) R.draw(); return (performance.now() - t) / n; };
  bench(5);
  const warm = bench(40);
  let repintados = 0;
  const orig = R.drawBackground.bind(R);
  R.drawBackground = (...a) => { repintados++; return orig(...a); };
  bench(20);
  const conCache = repintados;
  R._bgKey = null;
  const cold = bench(8);
  return {
    fotograma_ms: +warm.toFixed(2),
    con_fondo_ms: +cold.toFixed(2),
    repintados_de_fondo_en_20_fotogramas: conCache,
    alt: +R.cam.alt.toFixed(4), reticula: R.showGrid,
  };
})()`;

const ws = new WebSocket(await targetWs());
await new Promise(r => ws.addEventListener('open', r, { once: true }));
await sleep(3500);                                  // que cargue y genere el teatro

const send = (id, method, params) => new Promise((res) => {
  const on = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id === id) { ws.removeEventListener('message', on); res(m.result); }
  };
  ws.addEventListener('message', on);
  ws.send(JSON.stringify({ id, method, params }));
});

const r = await send(1, 'Runtime.evaluate', { expression: EXPR, returnByValue: true });
console.log(URL_.replace(/^.*_test\.html/, ''), '→', JSON.stringify(r?.result?.value ?? r));
ws.close();
proc.kill();
process.exit(0);
