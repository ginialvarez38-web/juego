// Mapa político en Mercator.
//
// El relleno de las provincias es una textura (un píxel por celda de la
// rejilla, remuestreada a Mercator) que se repinta solo cuando cambia algún
// dueño; las fronteras, las costas y los nombres son vectoriales y se dibujan
// encima en cada fotograma, así que se ven nítidos a cualquier escala. El
// mundo se repite en horizontal: se puede dar la vuelta al planeta.

import { decodeRings, LAND_FINE, LAND_GLOBE, SCALE_FINE, SCALE_GLOBE } from '../../src/geodata.js';
import { GW, LAT_N, LAT_S, RES } from './world.js';
import { relation, tint, NEUTRAL } from './game.js';
import { hexToRgb } from './countries.js';

const D2R = Math.PI / 180;
export const WW = GW;                                 // ancho del mundo en unidades
const K = WW / (2 * Math.PI);
const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + lat * D2R / 2));
const M_TOP = merc(LAT_N);
export const WH = Math.ceil((M_TOP - merc(LAT_S)) * K);
export const toX = (lon) => (lon + 180) / RES;
export const toY = (lat) => (M_TOP - merc(Math.max(LAT_S, Math.min(LAT_N, lat)))) * K;
export const fromX = (x) => x * RES - 180;
export const fromY = (y) => (2 * Math.atan(Math.exp(M_TOP - y / K)) - Math.PI / 2) / D2R;

const REL_COLORS = {
  self: '#e9c46a', ally: '#57a773', subject: '#8fcf9f', overlord: '#4f8fd0',
  war: '#d1495b', neutral: '#9aa1ab',
};

export class MapView {
  constructor(canvas, world) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.g = null;
    this.mode = 'political';
    this.focus = null;            // país seleccionado
    this.hoverProv = -1;
    this.markers = [];            // [{prov, kind, title, t0}]
    this.flash = null;            // {ids:Set, t0}
    this.dpr = 1;
    this.cam = { x: WW / 2, y: WH * 0.42, s: 1 };   // centro en unidades de mundo; s = px por unidad
    this.listeners = {};
    this._buildStatic();
    this._bind();
    this.resize();
    this.fitWorld();
  }

  on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  emit(ev, ...a) { for (const f of this.listeners[ev] || []) f(...a); }

  // ── geometría estática ─────────────────────────────────────────────────
  _buildStatic() {
    const w = this.world;
    // textura: qué provincia cae en cada píxel Mercator
    const TW = WW, TH = WH;
    const tp = new Int16Array(TW * TH);
    for (let ty = 0; ty < TH; ty++) {
      const lat = fromY(ty + 0.5);
      const gy = Math.min(w.GH - 1, Math.max(0, Math.floor((LAT_N - lat) / RES)));
      tp.set(w.prov.subarray(gy * GW, gy * GW + GW), ty * TW);
    }
    this.texProv = tp;
    this.tex = document.createElement('canvas');
    this.tex.width = TW; this.tex.height = TH;
    this.texCtx = this.tex.getContext('2d');
    this.img = this.texCtx.createImageData(TW, TH);
    this.pix = new Uint32Array(this.img.data.buffer);

    // costas (dos niveles de detalle)
    this.coastFine = ringsPath(decodeRings(LAND_FINE, SCALE_FINE));
    this.coastCoarse = ringsPath(decodeRings(LAND_GLOBE, SCALE_GLOBE));
    this.lakesPath = ringsPath(w.lakes);

    // costuras entre provincias en coordenadas de mundo
    this.borderPaths = w.borders.map(b => {
      const p = new Path2D();
      const a = b.pts;
      for (let i = 0; i < a.length; i += 2) {
        const x = toX(a[i]), y = toY(a[i + 1]);
        if (i) p.lineTo(x, y); else p.moveTo(x, y);
      }
      return p;
    });
    // centro de cada provincia en coordenadas de mundo
    this.pc = w.provinces.map(p => [toX(p.clon), toY(p.clat)]);
  }

  setGame(g) {
    this.g = g;
    this.refresh();
  }

  /** Recolorea la textura y recalcula fronteras y nombres. */
  refresh() {
    if (!this.g) return;
    this._recolor();
    this._rebuildBorders();
    this._computeLabels();
    this.draw();
  }

  countryColor(id) {
    const g = this.g, c = g.countries[id];
    if (!c) return NEUTRAL;
    if (this.mode === 'diplomatic') {
      const ref = this.focus || g.player;
      if (!ref) return c.color;
      return REL_COLORS[relation(g, ref, id)] || REL_COLORS.neutral;
    }
    if (this.mode === 'alliances') {
      const al = g.alliances.find(a => a.members.includes(id));
      if (al) return al.color || '#7a8fb0';
      const ov = c.overlord && g.alliances.find(a => a.members.includes(c.overlord));
      if (ov) return tint(ov.color || '#7a8fb0', '#ffffff', 0.35);
      return '#a7adb6';
    }
    if (c.overlord && g.countries[c.overlord]) return tint(c.color, g.countries[c.overlord].color, 0.35);
    return c.color;
  }

  _recolor() {
    const g = this.g, P = this.world.provinces;
    const cache = new Map();
    const pal = new Uint32Array(P.length);
    const focus = this.focus;
    for (let i = 0; i < P.length; i++) {
      const id = g.owner[i];
      let col = cache.get(id);
      if (col === undefined) {
        let hex = this.countryColor(id);
        if (focus && this.mode === 'political' && id !== focus) hex = tint(hex, '#2a3140', 0.18);
        const [r, gg, b] = hexToRgb(hex);
        col = (255 << 24) | (b << 16) | (gg << 8) | r;
        cache.set(id, col);
      }
      pal[i] = col;
    }
    const tp = this.texProv, pix = this.pix;
    for (let i = 0; i < tp.length; i++) {
      const p = tp[i];
      pix[i] = p < 0 ? 0 : pal[p];
    }
    // Se ensancha el color dos píxeles hacia el mar: la costa vectorial recorta
    // después el sobrante, y así no quedan huecos entre la rejilla y la costa.
    const TW = WW, TH = WH, n = tp.length;
    for (let pass = 0; pass < 2; pass++) {
      const src = pass ? new Uint32Array(pix) : pix.slice();
      for (let i = 0; i < n; i++) {
        if (src[i]) continue;
        const x = i % TW;
        const v = (x + 1 < TW && src[i + 1]) || (x > 0 && src[i - 1]) || (i + TW < n && src[i + TW]) || (i >= TW && src[i - TW]);
        if (v) pix[i] = v;
      }
    }
    this.texCtx.putImageData(this.img, 0, 0);
  }

  _rebuildBorders() {
    const g = this.g, w = this.world;
    const inner = new Path2D(), outer = new Path2D(), focusP = new Path2D();
    for (let i = 0; i < w.borders.length; i++) {
      const b = w.borders[i];
      const oa = g.owner[b.a], ob = g.owner[b.b];
      if (oa === ob) inner.addPath(this.borderPaths[i]);
      else {
        outer.addPath(this.borderPaths[i]);
        if (this.focus && (oa === this.focus || ob === this.focus)) focusP.addPath(this.borderPaths[i]);
      }
    }
    this.innerPath = inner; this.outerPath = outer; this.focusPath = focusP;
  }

  /**
   * Nombres de país: cada bloque territorial grande recibe su etiqueta,
   * orientada según el eje mayor del territorio y con un tamaño que lo llena.
   */
  _computeLabels() {
    const g = this.g, w = this.world, P = w.provinces;
    const byOwner = new Map();
    for (let i = 0; i < P.length; i++) {
      const o = g.owner[i];
      if (!byOwner.has(o)) byOwner.set(o, []);
      byOwner.get(o).push(i);
    }
    const labels = [];
    for (const [id, list] of byOwner) {
      const c = g.countries[id];
      if (!c) continue;
      const set = new Set(list), seen = new Set();
      const comps = [];
      for (const s of list) {
        if (seen.has(s)) continue;
        const comp = [s]; seen.add(s);
        for (let k = 0; k < comp.length; k++) {
          for (const q of P[comp[k]].nb) if (set.has(q) && !seen.has(q)) { seen.add(q); comp.push(q); }
          // las islas cercanas cuentan como parte del mismo bloque
          for (const q of w.sea[comp[k]] || []) if (set.has(q) && !seen.has(q)) { seen.add(q); comp.push(q); }
        }
        comps.push({ ids: comp, area: comp.reduce((a, i) => a + P[i].area, 0) });
      }
      comps.sort((a, b) => b.area - a.area);
      const main = comps[0].area;
      for (const cp of comps) {
        if (cp !== comps[0] && (cp.area < main * 0.25 || cp.area < 120000)) continue;
        const L = this._labelFor(cp.ids, c.name);
        if (L) { L.id = id; L.area = cp.area; L.ids = cp.ids; L.main = cp === comps[0]; labels.push(L); }
      }
    }
    labels.sort((a, b) => b.area - a.area);
    this.labels = labels;
  }

  _labelFor(ids, name) {
    const P = this.world.provinces, pc = this.pc;
    // centro y covarianza ponderados por superficie (desenrollando la longitud)
    const x0 = pc[ids[0]][0];
    let sw = 0, mx = 0, my = 0;
    const pts = ids.map(i => {
      let x = pc[i][0];
      if (x - x0 > WW / 2) x -= WW; else if (x0 - x > WW / 2) x += WW;
      return [x, pc[i][1], P[i].area];
    });
    for (const [x, y, a] of pts) { sw += a; mx += x * a; my += y * a; }
    mx /= sw; my /= sw;
    let sxx = 0, syy = 0, sxy = 0;
    for (const [x, y, a] of pts) { sxx += (x - mx) ** 2 * a; syy += (y - my) ** 2 * a; sxy += (x - mx) * (y - my) * a; }
    sxx /= sw; syy /= sw; sxy /= sw;
    // superficie de una provincia sola: su propio tamaño cuenta
    const own = Math.sqrt(sw) / 111 / RES * 0.5;
    const tr = sxx + syy, det = sxx * syy - sxy * sxy;
    const l1 = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const l2 = Math.max(0, tr - l1);
    let ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
    ang = Math.max(-0.6, Math.min(0.6, ang));
    const major = Math.max(Math.sqrt(l1) * 3.4, own * 1.6);
    const minor = Math.max(Math.sqrt(l2) * 3.4, own * 1.2);
    // un territorio casi redondo se rotula en horizontal, como en un atlas
    const elong = major / Math.max(1e-6, minor);
    if (elong < 1.5) ang = 0; else if (elong < 2.2) ang *= (elong - 1.5) / 0.7;
    // si el centro cae fuera del país (formas en media luna), se ancla en su provincia más cercana
    let cx = mx, cy = my;
    let best = ids[0], bd = Infinity;
    for (let k = 0; k < pts.length; k++) {
      const d = (pts[k][0] - mx) ** 2 + (pts[k][1] - my) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    const hereProv = this.provAtWorld(mx, my);
    if (!ids.includes(hereProv)) { cx = pts[best][0]; cy = pts[best][1]; }
    const text = name.toUpperCase();
    const size = Math.min(major * 1.05 / (text.length * 0.72 + 1), minor * 0.55, 90);
    return { x: ((cx % WW) + WW) % WW, y: cy, ang, size, text };
  }

  // ── cámara ──────────────────────────────────────────────────────────────
  resize() {
    const r = this.cv.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cv.width = Math.max(1, Math.round(r.width * this.dpr));
    this.cv.height = Math.max(1, Math.round(r.height * this.dpr));
    this.vw = r.width; this.vh = r.height;
    this.clamp();
    this.draw();
  }
  fitWorld() {
    this.cam.s = Math.max(this.vw / WW, this.vh / WH) * 1.0;
    this.cam.x = WW * 0.52; this.cam.y = WH * 0.45;
    this.clamp(); this.draw();
  }
  minScale() { return Math.max(this.vw / WW * 0.9, this.vh / WH); }
  clamp() {
    const c = this.cam;
    c.s = Math.max(this.minScale(), Math.min(60, c.s));
    const half = this.vh / 2 / c.s;
    c.y = Math.max(half, Math.min(WH - half, c.y));
    c.x = ((c.x % WW) + WW) % WW;
  }
  screenToWorld(sx, sy) {
    return [this.cam.x + (sx - this.vw / 2) / this.cam.s, this.cam.y + (sy - this.vh / 2) / this.cam.s];
  }
  worldToScreen(x, y) {
    let dx = x - this.cam.x;
    if (dx > WW / 2) dx -= WW; else if (dx < -WW / 2) dx += WW;
    return [this.vw / 2 + dx * this.cam.s, this.vh / 2 + (y - this.cam.y) * this.cam.s];
  }
  provAtWorld(x, y) {
    const lon = fromX(((x % WW) + WW) % WW), lat = fromY(y);
    if (lat >= LAT_N || lat <= LAT_S) return -1;
    const gx = Math.floor((lon + 180) / RES), gy = Math.floor((LAT_N - lat) / RES);
    if (gy < 0 || gy >= this.world.GH) return -1;
    return this.world.prov[gy * GW + ((gx % GW) + GW) % GW];
  }
  provAt(sx, sy) { return this.provAtWorld(...this.screenToWorld(sx, sy)); }

  /** Vuelo suave hasta una provincia o un país. */
  flyTo(x, y, s = null, ms = 700) {
    const c = this.cam, from = { x: c.x, y: c.y, s: c.s };
    let dx = x - c.x;
    if (dx > WW / 2) dx -= WW; else if (dx < -WW / 2) dx += WW;
    const to = { x: c.x + dx, y, s: s || c.s };
    const t0 = performance.now();
    cancelAnimationFrame(this._fly);
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      // zoom en escala logarítmica para que el vuelo no dé tirones
      c.x = from.x + (to.x - from.x) * e;
      c.y = from.y + (to.y - from.y) * e;
      c.s = Math.exp(Math.log(from.s) + (Math.log(to.s) - Math.log(from.s)) * e);
      this._touch();
      this.clamp(); this.draw();
      if (k < 1) this._fly = requestAnimationFrame(step);
    };
    this._fly = requestAnimationFrame(step);
  }
  flyToCountry(id) {
    const L = (this.labels || []).find(l => l.id === id && l.main);
    if (!L) return;
    const ids = L.ids;
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (const i of ids) {
      let x = this.pc[i][0];
      if (x - L.x > WW / 2) x -= WW; else if (L.x - x > WW / 2) x += WW;
      minx = Math.min(minx, x); maxx = Math.max(maxx, x);
      miny = Math.min(miny, this.pc[i][1]); maxy = Math.max(maxy, this.pc[i][1]);
    }
    const span = Math.max(maxx - minx, (maxy - miny) * this.vw / this.vh, 40);
    const s = Math.min(14, this.vw / (span * 1.8));
    this.flyTo((minx + maxx) / 2, (miny + maxy) / 2, Math.max(this.minScale(), s));
  }

  // ── entrada ─────────────────────────────────────────────────────────────
  _bind() {
    const cv = this.cv;
    const pts = new Map();
    let drag = null, moved = 0, pinch = null;
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, [e.offsetX, e.offsetY]);
      if (pts.size === 1) { drag = [e.offsetX, e.offsetY]; moved = 0; }
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: this.cam.s };
      }
    });
    cv.addEventListener('pointermove', (e) => {
      if (pts.has(e.pointerId)) pts.set(e.pointerId, [e.offsetX, e.offsetY]);
      if (pinch && pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        this.zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, pinch.s * d / pinch.d / this.cam.s);
        moved += 10;
        return;
      }
      if (drag && pts.size === 1) {
        const dx = e.offsetX - drag[0], dy = e.offsetY - drag[1];
        moved += Math.abs(dx) + Math.abs(dy);
        this.cam.x -= dx / this.cam.s; this.cam.y -= dy / this.cam.s;
        drag = [e.offsetX, e.offsetY];
        if (moved > 6) this._touch();
        this.clamp(); this.draw();
        return;
      }
      const p = this.provAt(e.offsetX, e.offsetY);
      if (p !== this.hoverProv) {
        this.hoverProv = p;
        this.draw();
      }
      this.emit('hover', p, e.clientX, e.clientY);
    });
    const up = (e) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (drag && pts.size === 0) {
        if (moved < 6) this.emit('click', this.provAt(e.offsetX, e.offsetY), e);
        drag = null;
      }
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', () => { this.hoverProv = -1; this.emit('hover', -1); this.draw(); });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const k = Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0015));
      this.zoomAt(e.offsetX, e.offsetY, k);
    }, { passive: false });
    cv.addEventListener('dblclick', (e) => this.zoomAt(e.offsetX, e.offsetY, 2));
    window.addEventListener('resize', () => this.resize());
  }
  zoomAt(sx, sy, k) {
    this._touch();
    const [wx, wy] = this.screenToWorld(sx, sy);
    this.cam.s *= k;
    this.clamp();
    const [nx, ny] = this.screenToWorld(sx, sy);
    this.cam.x += wx - nx; this.cam.y += wy - ny;
    this.clamp(); this.draw();
  }

  // ── dibujo ──────────────────────────────────────────────────────────────
  /** Marca que el usuario está moviendo el mapa: se dibuja en modo rápido. */
  _touch() {
    this._lastMove = performance.now();
    clearTimeout(this._idle);
    this._idle = setTimeout(() => this.draw(), 140);
  }
  draw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this._draw(); });
  }
  _draw() {
    const ctx = this.ctx, c = this.cam, dpr = this.dpr;
    const W = this.vw, H = this.vh;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // océano
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#0d2033'); grad.addColorStop(1, '#0a1a2a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    const ox = W / 2 - c.x * c.s, oy = H / 2 - c.y * c.s;
    const span = WW * c.s;
    const k0 = Math.floor(-ox / span) - 1, k1 = Math.ceil((W - ox) / span);
    const now = performance.now();
    const fast = now - (this._lastMove || 0) < 120;
    let animate = false;

    for (let k = k0; k <= k1; k++) {
      const x0 = ox + k * span;
      if (x0 > W || x0 + span < 0) continue;
      // retícula
      ctx.setTransform(dpr * c.s, 0, 0, dpr * c.s, dpr * x0, dpr * oy);
      this._graticule(ctx);
      // relleno, recortado por la costa vectorial
      const coast = c.s > 1.4 && !(fast && c.s < 3) ? this.coastFine : this.coastCoarse;
      ctx.imageSmoothingEnabled = true;
      ctx.save();
      ctx.clip(coast, 'evenodd');
      ctx.drawImage(this.tex, 0, 0);
      ctx.restore();
      ctx.fillStyle = '#0c1d2f';
      ctx.fill(this.lakesPath);
      // destello de provincias que cambiaron de manos
      if (this.flash) {
        const t = (now - this.flash.t0) / 1000;
        if (t < 6) {
          ctx.globalAlpha = 0.55 * Math.abs(Math.sin(t * 2.4)) * (1 - t / 6);
          ctx.drawImage(this.flash.canvas, 0, 0);
          ctx.globalAlpha = 1;
          animate = true;
        } else this.flash = null;
      }
      const px = 1 / c.s;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      if (c.s > 0.9 && !fast) {
        ctx.strokeStyle = 'rgba(20,25,35,0.28)';
        ctx.lineWidth = px * Math.min(1, 0.4 + c.s * 0.12);
        ctx.stroke(this.innerPath);
      }
      ctx.strokeStyle = 'rgba(15,18,26,0.85)';
      ctx.lineWidth = px * Math.min(2.2, 0.9 + c.s * 0.25);
      ctx.stroke(this.outerPath);
      ctx.strokeStyle = 'rgba(8,14,22,0.9)';
      ctx.lineWidth = px * 1.1;
      ctx.stroke(coast);
      if (c.s > 1.4) { ctx.lineWidth = px * 0.7; ctx.stroke(this.lakesPath); }
      if (this.focus && this.focusPath) {
        ctx.strokeStyle = 'rgba(255,240,200,0.95)';
        ctx.lineWidth = px * 2.4;
        ctx.stroke(this.focusPath);
      }
      // provincia bajo el ratón
      if (this.hoverProv >= 0) {
        const hp = this._provOutline(this.hoverProv);
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = px * 1.6;
        ctx.stroke(hp);
      }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._drawLabels(ctx);
    if (this._drawMarkers(ctx, now)) animate = true;
    if (animate) this.draw();
  }

  _graticule(ctx) {
    if (!this._grat) {
      const p = new Path2D();
      for (let lon = -180; lon <= 180; lon += 15) { p.moveTo(toX(lon), 0); p.lineTo(toX(lon), WH); }
      for (let lat = -45; lat <= 75; lat += 15) { p.moveTo(0, toY(lat)); p.lineTo(WW, toY(lat)); }
      this._grat = p;
    }
    ctx.strokeStyle = 'rgba(120,160,200,0.07)';
    ctx.lineWidth = 1 / this.cam.s;
    ctx.stroke(this._grat);
  }

  _provOutline(id) {
    this._outlines = this._outlines || new Map();
    let p = this._outlines.get(id);
    if (!p) {
      p = new Path2D();
      const w = this.world;
      for (let i = 0; i < w.borders.length; i++) {
        const b = w.borders[i];
        if (b.a === id || b.b === id) p.addPath(this.borderPaths[i]);
      }
      this._outlines.set(id, p);
    }
    return p;
  }

  _drawLabels(ctx) {
    if (!this.labels) return;
    const c = this.cam;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const placed = [];
    for (const L of this.labels) {
      const fs = L.size * c.s;
      if (fs < 7.5) continue;
      const size = Math.min(fs, 46);
      const [sx, sy] = this.worldToScreen(L.x, L.y);
      const wTxt = L.text.length * size * 0.78;
      if (sx < -wTxt || sx > this.vw + wTxt || sy < -60 || sy > this.vh + 60) continue;
      // evita amontonar nombres pequeños encima de otros
      const box = [sx - wTxt / 2, sy - size / 2, sx + wTxt / 2, sy + size / 2];
      if (size < 16 && placed.some(b => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) continue;
      placed.push(box);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(L.ang);
      ctx.font = `600 ${size.toFixed(1)}px Cinzel, "Cormorant Garamond", Georgia, serif`;
      try { ctx.letterSpacing = `${(size * 0.12).toFixed(1)}px`; } catch { /* navegadores antiguos */ }
      const a = Math.min(1, (fs - 7.5) / 6) * (fs > 46 ? Math.max(0.3, 1 - (fs - 46) / 160) : 1);
      ctx.globalAlpha = a;
      ctx.lineWidth = Math.max(2, size * 0.16);
      ctx.strokeStyle = 'rgba(10,14,22,0.55)';
      ctx.strokeText(L.text, 0, 0);
      ctx.fillStyle = 'rgba(255,250,240,0.93)';
      ctx.fillText(L.text, 0, 0);
      ctx.restore();
    }
    try { ctx.letterSpacing = '0px'; } catch { /* nada */ }
    ctx.globalAlpha = 1;
    // nombres de provincia con mucho zoom
    if (c.s > 5) {
      const P = this.world.provinces;
      ctx.font = '500 11px Inter, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(15,18,26,0.85)';
      for (let i = 0; i < P.length; i++) {
        const [sx, sy] = this.worldToScreen(this.pc[i][0], this.pc[i][1]);
        if (sx < -50 || sx > this.vw + 50 || sy < -20 || sy > this.vh + 20) continue;
        if (Math.sqrt(P[i].area) / 11 * c.s < 40) continue;
        ctx.fillText(P[i].name, sx, sy + 12);
        ctx.beginPath(); ctx.arc(sx, sy, P[i].cap ? 3 : 1.8, 0, 7); ctx.fill();
      }
    }
  }

  _drawMarkers(ctx, now) {
    let anim = false;
    for (const m of this.markers) {
      if (m.prov < 0) continue;
      const [sx, sy] = this.worldToScreen(this.pc[m.prov][0], this.pc[m.prov][1]);
      if (sx < -20 || sx > this.vw + 20 || sy < -20 || sy > this.vh + 20) continue;
      const t = (now - m.t0) / 1000;
      const col = KIND_COLORS[m.kind] || '#e9c46a';
      if (t < 30) {
        const r = 6 + (t * 14) % 14;
        ctx.strokeStyle = col; ctx.globalAlpha = Math.max(0, 1 - ((t * 14) % 14) / 14);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, 7); ctx.stroke();
        ctx.globalAlpha = 1;
        anim = true;
      }
      ctx.fillStyle = col;
      ctx.strokeStyle = 'rgba(10,14,22,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx, sy, 5.5, 0, 7); ctx.fill(); ctx.stroke();
      m.sx = sx; m.sy = sy;
    }
    return anim;
  }
  markerAt(sx, sy) {
    return this.markers.find(m => m.sx !== undefined && Math.hypot(m.sx - sx, m.sy - sy) < 9);
  }

  setMarkers(list) {
    const t0 = performance.now();
    this.markers = list.map(m => ({ ...m, t0 }));
    this.draw();
  }

  /** Hace parpadear las provincias que acaban de cambiar de dueño. */
  flashProvinces(ids) {
    if (!ids || !ids.length) return;
    const set = new Set(ids);
    const cv = document.createElement('canvas');
    cv.width = WW; cv.height = WH;
    const cx = cv.getContext('2d');
    const img = cx.createImageData(WW, WH);
    const px = new Uint32Array(img.data.buffer);
    const tp = this.texProv;
    for (let i = 0; i < tp.length; i++) if (set.has(tp[i])) px[i] = 0xffffffff;
    cx.putImageData(img, 0, 0);
    this.flash = { canvas: cv, t0: performance.now() };
    this.draw();
  }

  setMode(m) { this.mode = m; this.refresh(); }
  setFocus(id) {
    if (this.focus === id) return;
    this.focus = id;
    this._recolor();
    this._rebuildBorders();
    this.draw();
  }
}

export const KIND_COLORS = {
  guerra: '#e05a5a', diplomacia: '#5aa0e0', politica: '#c58be0', economia: '#e0b84a',
  sociedad: '#6fc3a0', ciencia: '#5ad0e0', desastre: '#e0884a', cultura: '#e07ab8',
};

function ringsPath(rings) {
  const p = new Path2D();
  for (const r of rings) {
    let any = false;
    for (let i = 0; i < r.length; i += 2) if (r[i + 1] > LAT_S - 2) { any = true; break; }
    if (!any) continue;
    for (let i = 0; i < r.length; i += 2) {
      const x = toX(r[i]), y = toY(r[i + 1]);
      if (i) p.lineTo(x, y); else p.moveTo(x, y);
    }
    p.closePath();
  }
  return p;
}
