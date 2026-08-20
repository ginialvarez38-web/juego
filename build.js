// Empaqueta el juego en un unico archivo HTML autocontenido.
//
// No hay bundler externo: cada modulo se envuelve en su propia funcion y se
// registra en __M, de modo que los nombres de un modulo no pueden colisionar con
// los de otro. Los `import` se convierten en desestructuraciones del registro y
// los `export` se recogen en el objeto que la funcion devuelve.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const ORDER = ['heap', 'hex', 'rng', 'terrain', 'units', 'orders',
  'worldgen', 'sim', 'analysis', 'ai', 'scenario', 'render', 'ui'];
const ENTRY = 'main';

const RE_IMPORT = /^import\s*\{([\s\S]*?)\}\s*from\s*'\.\/([\w.-]+)\.js';?[ \t]*$/gm;
const RE_EXPORT_LIST = /^export\s*\{([^}]*)\};?[ \t]*$/gm;
const RE_EXPORT_DECL = /^export\s+(?=(?:async\s+)?(?:function|const|let|var|class)\b)/gm;

function transform(name, src, isEntry) {
  const exports = new Set();

  let out = src.replace(RE_IMPORT, (_, names, mod) => {
    const binds = names.split(',').map(s => s.trim()).filter(Boolean)
      .map(s => {
        const m = s.match(/^(\w+)\s+as\s+(\w+)$/);
        return m ? `${m[1]}: ${m[2]}` : s;
      });
    return `const { ${binds.join(', ')} } = __M['${mod}'];`;
  });

  out = out.replace(RE_EXPORT_LIST, (_, names) => {
    for (const n of names.split(',')) {
      const t = n.trim();
      if (t) exports.add(t.includes(' as ') ? t.split(/\s+as\s+/)[1].trim() : t);
    }
    return '';
  });

  // nombres declarados con `export`
  for (const m of out.matchAll(/^export\s+(?:async\s+)?(?:function|class)\s+(\w+)/gm)) exports.add(m[1]);
  for (const m of out.matchAll(/^export\s+(?:const|let|var)\s+(.+)$/gm)) {
    for (const d of m[1].matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*=(?!=)/g)) exports.add(d[1]);
  }
  out = out.replace(RE_EXPORT_DECL, '');

  if (isEntry) return `\n/* ── ${name}.js ── */\n(function(){\n${out}\n})();\n`;
  const ret = [...exports].join(', ');
  return `\n/* ── ${name}.js ── */\n__M['${name}'] = (function(){\n${out}\nreturn { ${ret} };\n})();\n`;
}

const parts = ORDER.map(n => transform(n, readFileSync(`src/${n}.js`, 'utf8'), false));
parts.push(transform(ENTRY, readFileSync(`src/${ENTRY}.js`, 'utf8'), true));

const css = readFileSync('css/style.css', 'utf8');
const html = readFileSync('index.html', 'utf8');
const body = html.split('<div id="app">')[1].split('<script')[0];

const page = `<title>Theatrum Belli</title>
<style>
@import url("https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap");
${css}
</style>

<div id="app">${body}

<script>
"use strict";
const __M = {};
${parts.join('')}
</script>
`;

mkdirSync('dist', { recursive: true });
writeFileSync('dist/theatrum-belli.html', page);
console.log(`dist/theatrum-belli.html — ${(page.length / 1024).toFixed(0)} KB`);
