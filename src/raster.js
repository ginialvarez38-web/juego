// Rasterizador de poligonos y polilineas geograficas.
//
// No usa lienzo del navegador a proposito: el mismo codigo tiene que poder
// generar un teatro dentro de la pagina y en una prueba sin interfaz. Trabaja
// sobre una rejilla equirectangular del rectangulo geografico pedido.

/** Convierte longitud/latitud a coordenadas de rejilla. */
function mapper(bbox, RW, RH) {
  const sx = RW / (bbox.e - bbox.w), sy = RH / (bbox.n - bbox.s);
  return (lon, lat) => [(lon - bbox.w) * sx, (bbox.n - lat) * sy];
}

/**
 * Rellena los anillos con la regla par-impar, de modo que un anillo interior
 * recorta al que lo contiene: asi los huecos de las masas continentales (mares
 * interiores, islas dentro de lagos) salen bien sin necesidad de conservar la
 * jerarquia de poligonos.
 */
export function fillRings(rings, bbox, RW, RH, out, value) {
  const to = mapper(bbox, RW, RH);
  // lista de aristas que cruzan la ventana
  const ex0 = [], ey0 = [], ex1 = [], ey1 = [];
  for (const r of rings) {
    const n = r.length / 2;
    if (n < 3) continue;
    let px = null, py = 0, fx = 0, fy = 0;
    for (let i = 0; i < n; i++) {
      const [x, y] = to(r[i * 2], r[i * 2 + 1]);
      if (px === null) { fx = x; fy = y; } else { push(px, py, x, y); }
      px = x; py = y;
    }
    if (px !== null) push(px, py, fx, fy);
  }
  function push(x0, y0, x1, y1) {
    if (y0 === y1) return;
    // Solo se descarta por Y. Descartar aristas por X romperia la paridad del
    // relleno: un continente que atraviesa la ventana perderia su segunda
    // interseccion y la fila entera quedaria sin rellenar.
    if (Math.max(y0, y1) < 0 || Math.min(y0, y1) > RH) return;
    ex0.push(x0); ey0.push(y0); ex1.push(x1); ey1.push(y1);
  }

  const xs = [];
  for (let row = 0; row < RH; row++) {
    const yc = row + 0.5;
    xs.length = 0;
    for (let i = 0; i < ey0.length; i++) {
      const y0 = ey0[i], y1 = ey1[i];
      if ((y0 <= yc) === (y1 <= yc)) continue;
      const t = (yc - y0) / (y1 - y0);
      xs.push(ex0[i] + t * (ex1[i] - ex0[i]));
    }
    if (!xs.length) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      let a = Math.ceil(xs[k] - 0.5), b = Math.floor(xs[k + 1] - 0.5);
      if (b < 0 || a > RW - 1) continue;
      if (a < 0) a = 0;
      if (b > RW - 1) b = RW - 1;
      const base = row * RW;
      for (let x = a; x <= b; x++) out[base + x] = value;
    }
  }
  return out;
}

/** Traza polilineas (rios, costas) con grosor de un pixel. */
export function strokeRings(rings, bbox, RW, RH, out, value) {
  const to = mapper(bbox, RW, RH);
  const put = (x, y) => {
    if (x >= 0 && y >= 0 && x < RW && y < RH) out[y * RW + x] = value;
  };
  for (const r of rings) {
    const n = r.length / 2;
    let px = null, py = 0;
    for (let i = 0; i < n; i++) {
      const [x, y] = to(r[i * 2], r[i * 2 + 1]);
      if (px !== null) line(px, py, x, y);
      px = x; py = y;
    }
  }
  function line(x0, y0, x1, y1) {
    if ((x0 < 0 && x1 < 0) || (y0 < 0 && y1 < 0) || (x0 > RW && x1 > RW) || (y0 > RH && y1 > RH)) return;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      put(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t));
    }
  }
  return out;
}

/** Índice de anillos por rectangulo, para no recorrer el planeta entero. */
export function ringIndex(rings) {
  return rings.map(r => {
    let w = 1e9, e = -1e9, s = 1e9, n = -1e9;
    for (let i = 0; i < r.length; i += 2) {
      const x = r[i], y = r[i + 1];
      if (x < w) w = x; if (x > e) e = x;
      if (y < s) s = y; if (y > n) n = y;
    }
    return { r, w, e, s, n };
  });
}

export function ringsIn(index, bbox) {
  const out = [];
  for (const it of index) {
    if (it.e < bbox.w || it.w > bbox.e || it.n < bbox.s || it.s > bbox.n) continue;
    out.push(it.r);
  }
  return out;
}
