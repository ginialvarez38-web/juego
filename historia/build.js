// Empaqueta Historia Mundi en un único HTML autocontenido: dist/historia-mundi.html
//
// Mismo esquema que el empaquetador de Theatrum Belli: cada módulo se envuelve
// en su propia función y se registra en __M; los `import` pasan a ser
// desestructuraciones del registro. Aquí los módulos vienen de dos carpetas
// (los datos geográficos son compartidos), así que se identifican por nombre.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SHARED = join(ROOT, '..', 'src');
const OWN = join(ROOT, 'src');

const ORDER = [
  [SHARED, 'geodata'], [SHARED, 'raster'],
  [OWN, 'exonyms'], [OWN, 'world'], [OWN, 'countries'], [OWN, 'scenarios'],
  [OWN, 'game'], [OWN, 'ai'], [OWN, 'offline'], [OWN, 'map'],
];
const ENTRY = [OWN, 'main'];

const RE_IMPORT = /^import\s*\{([\s\S]*?)\}\s*from\s*'(?:\.\.?\/)+(?:src\/)?([\w.-]+)\.js';?[ \t]*$/gm;
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
      if (!t) continue;
      const m = t.match(/^(\w+)\s+as\s+(\w+)$/);
      exports.add(m ? `${m[2]}: ${m[1]}` : t);
    }
    return '';
  });
  for (const m of out.matchAll(/^export\s+(?:async\s+)?(?:function|class)\s+(\w+)/gm)) exports.add(m[1]);
  for (const m of out.matchAll(/^export\s+(?:const|let|var)\s+(.+)$/gm)) {
    for (const d of m[1].matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*=(?![=>])/g)) exports.add(d[1]);
  }
  out = out.replace(RE_EXPORT_DECL, '');
  if (/^\s*(import|export)\s/m.test(out)) throw new Error(`${name}: import/export sin convertir`);
  if (isEntry) return `\n/* ── ${name}.js ── */\n(function(){\n${out}\n})();\n`;
  return `\n/* ── ${name}.js ── */\n__M['${name}'] = (function(){\n${out}\nreturn { ${[...exports].join(', ')} };\n})();\n`;
}

const parts = ORDER.map(([dir, n]) => transform(n, readFileSync(join(dir, n + '.js'), 'utf8'), false));
parts.push(transform(ENTRY[1], readFileSync(join(ENTRY[0], ENTRY[1] + '.js'), 'utf8'), true));

const css = readFileSync(join(ROOT, 'css', 'style.css'), 'utf8');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const body = html.split('<div id="app">')[1].split('<script')[0];

const page = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Historia Mundi</title>
<style>
@import url("https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700&family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Inter:wght@400;500;600&display=swap");
${css}
</style>
</head>
<body>
<div id="app">${body}
<script>
"use strict";
const __M = {};
${parts.join('')}
</script>
</body>
</html>
`;

mkdirSync(join(ROOT, '..', 'dist'), { recursive: true });
const outPath = join(ROOT, '..', 'dist', 'historia-mundi.html');
writeFileSync(outPath, page);
console.log(`dist/historia-mundi.html — ${(page.length / 1024).toFixed(0)} KB`);
