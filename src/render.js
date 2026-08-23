// Dibujo del teatro sobre el planeta.
//
// Todo pasa por la camara esferica de geo.js: los hexagonos son poligonos
// proyectados sobre la superficie terrestre, de modo que el frente, las bolsas
// y las flechas de avance se curvan con el terreno y se pierden tras el
// horizonte. Alejando la camara el mismo dibujo se convierte en el globo
// completo, con el teatro señalado sobre la geografia real.
import { neighbors, distance, HEX_KM } from './hex.js';
import { TERRAIN } from './terrain.js';
import { SIDES, other, projectsZOC } from './sim.js';
import { Camera, lonLatToVec, vecToLonLat, dot, norm, sub, add, mul, EDGE_CORNERS, R_EARTH } from './geo.js';
import { world } from './world.js';
import { ringsIn } from './raster.js';

const SIDE_COL = { BLUE: '#5b8fd4', RED: '#c9584c' };
const SIDE_FILL = { BLUE: 'rgba(80,130,200,0.15)', RED: 'rgba(200,72,58,0.15)' };
const SIDE_DEEP = { BLUE: 'rgba(80,130,200,0.27)', RED: 'rgba(200,72,58,0.27)' };
const OCEAN = '#1d3547', OCEAN_DEEP = '#122736';
const LAND_BASE = '#46533a';
// tinte por region fisica real: da al planeta su aspecto de mapa fisico
const RELIEF_TINT = {
  1: '#6d6452', 2: '#5d5c43', 3: '#5a5940', 4: '#4c5b3b', 5: '#47573c',
  6: '#8a7a56', 7: '#4f5940', 8: '#4a5540', 9: '#4a5a3e', 10: '#3f5445',
  11: '#3c5146', 12: '#6f7a76',
};
const DEG = Math.PI / 180;
const GRID_ALT = 0.34;        // por encima de esta altura se oculta la retícula

export class Renderer {
  constructor(canvas, game, ui) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.game = game; this.ui = ui;
    this.cam = new Camera();
    this.cam.lon = game.lon; this.cam.lat = game.lat;
    this.cam.alt = 0.055; this.cam.tilt = 0.42;
    this.t0 = performance.now();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    // el lienzo cambia de tamaño con la reja de la pagina, no solo con la ventana
    if (window.ResizeObserver) new ResizeObserver(() => this.resize()).observe(canvas);
    // memorias por fotograma
    this.px = new Float32Array(game.N);
    this.py = new Float32Array(game.N);
    this.pz = new Float32Array(game.N);
    this.pv = new Uint8Array(game.N);
    this.kx = new Float32Array(game.N * 6);
    this.ky = new Float32Array(game.N * 6);
  }

  /** Cambia de campaña reutilizando lienzo y memorias de proyeccion. */
  setGame(game) {
    this.game = game;
    this._mask = null; this._maskTurn = -1;
    if (this.px.length !== game.N) {
      this.px = new Float32Array(game.N); this.py = new Float32Array(game.N);
      this.pz = new Float32Array(game.N); this.pv = new Uint8Array(game.N);
      this.kx = new Float32Array(game.N * 6); this.ky = new Float32Array(game.N * 6);
    }
    this.cam.lon = game.lon; this.cam.lat = game.lat;
    this.cam.update();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.cv.getBoundingClientRect();
    this.cv.width = Math.max(1, r.width * dpr);
    this.cv.height = Math.max(1, r.height * dpr);
    this.dpr = dpr; this.vw = r.width; this.vh = r.height;
    this.cam.setViewport(this.vw, this.vh);
    this.cam.update();
  }

  /** Encuadra el teatro completo. */
  fitTheater() {
    const g = this.game, t = g.theater;
    this.cam.lon = g.lon; this.cam.lat = g.lat;
    // el campo horizontal no es el vertical escalado: hay que pasar por la
    // tangente, o el encuadre sale casi al doble de lejos de lo debido
    const halfH = Math.tan(this.cam.fov / 2);
    const halfW = Math.atan(halfH * (this.vw / this.vh));
    const need = (t.W * t.dx / 2) / Math.tan(halfW) * 1.10;
    this.cam.alt = Math.max(0.010, need / R_EARTH);
    this.cam.tilt = 0.30; this.cam.bearing = 0;
    this.cam.update();
  }
  viewGlobe() {
    this.cam.alt = 2.6; this.cam.tilt = 0; this.cam.bearing = 0;
    this.cam.update();
  }
  centerOn(col, row) {
    const [lon, lat] = this.game.theater.hexLonLat(col, row);
    this.cam.lon = lon; this.cam.lat = lat;
    this.cam.update();
  }
  get showGrid() { return this.cam.alt < GRID_ALT; }
  /** Tamaño en pixeles del circunradio de un hexagono a la profundidad z. */
  hexPx(z) { return this.cam.kmScale(z) * this.game.theater.s; }

  // ── proyeccion de la retícula ────────────────────────────────────────
  projectGrid() {
    const g = this.game, t = g.theater, cam = this.cam;
    const px = this.px, py = this.py, pz = this.pz, pv = this.pv;
    const V = this._v || (this._v = [0, 0, 0]);
    const p = this._p || (this._p = [0, 0, 0, 0]);
    let any = false;
    for (let row = 0; row < g.H; row++) {
      for (let col = 0; col < g.W; col++) {
        const i = row * g.W + col;
        t.hexVecInto(col, row, V);
        if (!cam.onNearSideXYZ(V[0], V[1], V[2])) { pv[i] = 0; continue; }
        cam.projectInto(V[0], V[1], V[2], p);
        if (!p[3] || p[0] < -400 || p[1] < -400 || p[0] > this.vw + 400 || p[1] > this.vh + 400) {
          pv[i] = 0; continue;
        }
        px[i] = p[0]; py[i] = p[1]; pz[i] = p[2]; pv[i] = 1; any = true;
        for (let k = 0; k < 6; k++) {
          t.cornerVecInto(col, row, k, V);
          cam.projectInto(V[0], V[1], V[2], p);
          this.kx[i * 6 + k] = p[0]; this.ky[i * 6 + k] = p[1];
        }
      }
    }
    return any;
  }

  hexPath(ctx, i) {
    const kx = this.kx, ky = this.ky, b = i * 6;
    ctx.beginPath();
    ctx.moveTo(kx[b], ky[b]);
    for (let k = 1; k < 6; k++) ctx.lineTo(kx[b + k], ky[b + k]);
    ctx.closePath();
  }
  edgeSeg(i, d) {
    const [a, b] = EDGE_CORNERS[d], o = i * 6;
    return [this.kx[o + a], this.ky[o + a], this.kx[o + b], this.ky[o + b]];
  }

  // ── proyeccion de geometria geografica ───────────────────────────────
  /**
   * Proyecta un trazo lon/lat. Los puntos del otro lado del horizonte se
   * arrastran hasta el limbo en vez de descartarse, de modo que un continente
   * que se pierde por el borde del planeta se dibuja completo hasta el borde.
   */
  projectRing(ring, out) {
    const cam = this.cam, e = cam.eyeHat, t = cam.horizon;
    const rHor = Math.sqrt(Math.max(0, 1 - t * t));
    const p = this._p2 || (this._p2 = [0, 0, 0, 0]);
    let n = 0, anyNear = false;
    for (let k = 0; k < ring.length; k += 2) {
      const a = ring[k] * DEG, b = ring[k + 1] * DEG, ca = Math.cos(b);
      let vx = ca * Math.cos(a), vy = ca * Math.sin(a), vz = Math.sin(b);
      const c = vx * e[0] + vy * e[1] + vz * e[2];
      if (c >= t) anyNear = true;
      else {
        // arrastre hasta el circulo del horizonte
        let qx = vx - e[0] * c, qy = vy - e[1] * c, qz = vz - e[2] * c;
        const pl = Math.hypot(qx, qy, qz) || 1, s2 = rHor / pl;
        vx = e[0] * t + qx * s2; vy = e[1] * t + qy * s2; vz = e[2] * t + qz * s2;
      }
      cam.projectInto(vx, vy, vz, p);
      if (!p[3]) continue;
      out[n * 2] = p[0]; out[n * 2 + 1] = p[1]; n++;
    }
    return anyNear ? n : 0;
  }

  fillRingsGeo(ctx, rings, style, close) {
    const buf = this._buf || (this._buf = new Float32Array(200000));
    ctx.fillStyle = style;
    ctx.beginPath();
    for (const r of rings) {
      if (r.length > buf.length) continue;
      const n = this.projectRing(r, buf);
      if (n < 2) continue;
      ctx.moveTo(buf[0], buf[1]);
      for (let k = 1; k < n; k++) ctx.lineTo(buf[k * 2], buf[k * 2 + 1]);
      if (close) ctx.closePath();
    }
    ctx.fill('evenodd');
  }
  strokeRingsGeo(ctx, rings, style, lw) {
    const buf = this._buf || (this._buf = new Float32Array(200000));
    ctx.strokeStyle = style; ctx.lineWidth = lw; ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const r of rings) {
      if (r.length > buf.length) continue;
      const n = this.projectRing(r, buf);
      if (n < 2) continue;
      ctx.moveTo(buf[0], buf[1]);
      for (let k = 1; k < n; k++) ctx.lineTo(buf[k * 2], buf[k * 2 + 1]);
    }
    ctx.stroke();
  }

  /** Contorno del hemisferio visible: el mar de fondo. */
  drawSphere(ctx) {
    const cam = this.cam;
    const t = cam.horizon, r = Math.sqrt(Math.max(0, 1 - t * t));
    const c = mul(cam.eyeHat, t);
    // dos tangentes al eje de vision para recorrer el circulo del horizonte
    let a = norm(sub([0, 0, 1], mul(cam.eyeHat, cam.eyeHat[2])));
    if (!isFinite(a[0]) || Math.hypot(a[0], a[1], a[2]) < 1e-6) a = [1, 0, 0];
    const b = norm([cam.eyeHat[1] * a[2] - cam.eyeHat[2] * a[1],
      cam.eyeHat[2] * a[0] - cam.eyeHat[0] * a[2],
      cam.eyeHat[0] * a[1] - cam.eyeHat[1] * a[0]]);
    const pts = [];
    for (let i = 0; i < 96; i++) {
      const th = i / 96 * Math.PI * 2;
      const V = add(c, add(mul(a, r * Math.cos(th)), mul(b, r * Math.sin(th))));
      const p = cam.project(V);
      if (p[3]) pts.push(p);
    }
    if (pts.length < 3) {
      ctx.fillStyle = OCEAN; ctx.fillRect(0, 0, this.vw, this.vh);
      return;
    }
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    const cp = cam.project(cam.target);
    const gr = ctx.createRadialGradient(cp[0], cp[1], 1, cp[0], cp[1],
      Math.max(60, Math.hypot(pts[0][0] - cp[0], pts[0][1] - cp[1])));
    gr.addColorStop(0, OCEAN); gr.addColorStop(1, OCEAN_DEEP);
    ctx.fillStyle = gr; ctx.fill();
    // halo atmosferico
    ctx.strokeStyle = 'rgba(130,190,235,.45)';
    ctx.lineWidth = Math.max(1.5, 5 / Math.max(0.6, this.cam.alt));
    ctx.stroke();
    ctx.strokeStyle = 'rgba(130,190,235,.14)';
    ctx.lineWidth = Math.max(4, 18 / Math.max(0.6, this.cam.alt));
    ctx.stroke();
  }

  // ── bucle principal ──────────────────────────────────────────────────
  /**
   * Bucle de dibujo en dos capas. El planeta, el terreno y la linea de contacto
   * solo cambian cuando se mueve la camara o pasa un turno, asi que se pintan
   * una vez sobre un lienzo aparte y despues se estampan. Encima van las capas
   * que laten —bolsas, pinzas, seleccion— y las fichas. Sin esta separacion,
   * redibujar la geometria del planeta sesenta veces por segundo deja la
   * partida a tres fotogramas.
   */
  draw() {
    const g = this.game, ctx = this.ctx, L = this.ui.layers;
    const time = (performance.now() - this.t0) / 1000;
    const far = this.cam.alt > GRID_ALT;
    const key = this.cam.key() + '|' + g.turn + '|' + g.seed + '|' +
      Object.keys(L).map(k => (L[k] ? 1 : 0)).join('');

    if (key !== this._bgKey) {
      this._bgKey = key;
      this._gridOK = !far && this.projectGrid();
      this.drawBackground(far, L, g.analysis);
    }

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.vw, this.vh);
    if (this._bg) ctx.drawImage(this._bg, 0, 0, this.vw, this.vh);
    this._labels = [];
    if (this._gridOK) this.drawDynamic(ctx, L, g.analysis, time);
    else this.drawTheaterMarker(ctx);
    ctx.restore();
  }

  /** Capa estatica: planeta, geografia, terreno, red y linea de contacto. */
  drawBackground(far, L, A) {
    const g = this.game, w = world(), cam = this.cam;
    const cw = Math.max(1, Math.round(this.vw * this.dpr));
    const ch = Math.max(1, Math.round(this.vh * this.dpr));
    if (!this._bg) this._bg = document.createElement('canvas');
    if (this._bg.width !== cw || this._bg.height !== ch) {
      this._bg.width = cw; this._bg.height = ch;
    }
    const ctx = this._bg.getContext('2d');
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, this.vw, this.vh);

    const view = this.viewBox();
    this.drawSphere(ctx);

    // ── geografia real ────────────────────────────────────────────────
    this.fillRingsGeo(ctx, far ? w.globe : ringsIn(w.landIdx, view), LAND_BASE, true);
    // relieve real por encima de la tierra: cordilleras, mesetas y desiertos
    for (let k = 0; k < w.relief.length; k++) {
      const tint = RELIEF_TINT[k + 1];
      if (!tint) continue;
      const rs = far ? w.relief[k] : ringsIn(w.reliefIdx[k], view);
      if (rs.length) this.fillRingsGeo(ctx, rs, tint, true);
    }
    this.fillRingsGeo(ctx, ringsIn(w.lakesIdx, view), OCEAN, true);
    if (!far) {
      this.strokeRingsGeo(ctx, ringsIn(w.riversIdx, view), 'rgba(105,165,200,.6)',
        Math.max(0.7, 0.035 / Math.max(0.02, cam.alt)));
    }
    if (this._gridOK) {
      // el terreno de alrededor queda en penumbra: el calco es lo que se lee
      ctx.fillStyle = 'rgba(6,9,12,.45)';
      ctx.fillRect(0, 0, this.vw, this.vh);
      this.drawTheater(ctx, L, A);
    }
    this.drawGraticule(ctx, far);
  }

  /** Rectangulo geografico visible, para no recorrer el planeta entero. */
  viewBox() {
    const cam = this.cam;
    const span = Math.min(80, Math.max(1.5, cam.alt * 70));
    return {
      w: cam.lon - span, e: cam.lon + span,
      s: Math.max(-90, cam.lat - span), n: Math.min(90, cam.lat + span),
    };
  }

  drawGraticule(ctx, far) {
    if (!far || !this.ui.layers.grid) return;
    ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 0.7;
    const rings = [];
    for (let lat = -60; lat <= 60; lat += 30) {
      const r = []; for (let lon = -180; lon <= 180; lon += 4) { r.push(lon, lat); }
      rings.push(Float32Array.from(r));
    }
    for (let lon = -180; lon < 180; lon += 30) {
      const r = []; for (let lat = -85; lat <= 85; lat += 4) { r.push(lon, lat); }
      rings.push(Float32Array.from(r));
    }
    this.strokeRingsGeo(ctx, rings, 'rgba(255,255,255,.07)', 0.7);
  }

  /** Con el planeta lejos, el teatro es solo una marca sobre su geografia. */
  drawTheaterMarker(ctx) {
    const g = this.game, t = g.theater, cam = this.cam;
    const V = lonLatToVec(g.lon, g.lat);
    if (!cam.onNearSide(V)) return;
    const p = cam.project(V);
    if (!p[3]) return;
    const bb = t.bbox(0);
    const ring = [bb.w, bb.n, bb.e, bb.n, bb.e, bb.s, bb.w, bb.s, bb.w, bb.n];
    this.strokeRingsGeo(ctx, [Float32Array.from(ring)], '#f0cc4a', 1.6);
    const pulse = 0.5 + 0.5 * Math.sin((performance.now() - this.t0) / 380);
    ctx.strokeStyle = `rgba(240,204,74,${0.35 + 0.4 * pulse})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(p[0], p[1], 10 + pulse * 8, 0, 7); ctx.stroke();
    ctx.fillStyle = '#f0cc4a';
    ctx.font = '600 12px "Barlow Condensed", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('TEATRO DE OPERACIONES', p[0], p[1] - 22);
  }

  // ── el teatro propiamente dicho ──────────────────────────────────────
  /** Parte del calco que solo cambia con la camara o con el turno. */
  drawTheater(ctx, L, A) {
    const g = this.game, cam = this.cam;
    const pv = this.pv, pz = this.pz;
    // orden de pintado de lejos a cerca
    const order = [];
    for (let i = 0; i < g.N; i++) if (pv[i]) order.push(i);
    order.sort((a, b) => pz[b] - pz[a]);
    const seen = this.visibilityMask();

    // 1. terreno
    for (const i of order) {
      const h = g.hexes[i];
      const T = TERRAIN[h.t];
      this.hexPath(ctx, i);
      const sh = 0.74 + 0.60 * h.elev;
      ctx.fillStyle = shade(T.color, sh * (L.fog && seen && !seen[i] ? 0.5 : 1));
      ctx.fill();
    }

    // 2. control territorial
    if (L.control && A) {
      for (const i of order) {
        const sd = SIDES[A.owner[i]];
        const enc = A.sides[sd].enclosure[i] || 0;
        this.hexPath(ctx, i);
        ctx.fillStyle = enc > 0.4 ? SIDE_DEEP[sd] : SIDE_FILL[sd];
        ctx.fill();
      }
    }
    if (L.supply) this.heat(ctx, order, (i) => g._supply[g.player].level[i] / 100, '#3fa8c8');
    if (L.threat) this.heat(ctx, order, (i) => this.threatAt(i), '#d24a3a');

    // 3. calzadas, vias y cauces
    ctx.lineCap = 'round';
    const lw = Math.max(0.7, this.hexPx(pz[order[order.length - 1]] || 1) * 0.10);
    for (const i of order) {
      const h = g.hexes[i];
      if (h.road) {
        const nb = neighbors(h.col, h.row);
        for (let d = 0; d < 3; d++) {
          const [nc, nr] = nb[d];
          if (nc < 0 || nr < 0 || nc >= g.W || nr >= g.H) continue;
          const j = nr * g.W + nc;
          if (!pv[j] || !g.hexes[j].road) continue;
          ctx.strokeStyle = (h.road >= 2 && g.hexes[j].road >= 2)
            ? 'rgba(216,196,146,.7)' : 'rgba(184,170,134,.42)';
          ctx.lineWidth = (h.road >= 2 && g.hexes[j].road >= 2) ? lw * 1.5 : lw;
          ctx.beginPath(); ctx.moveTo(this.px[i], this.py[i]); ctx.lineTo(this.px[j], this.py[j]); ctx.stroke();
        }
      }
      for (let d = 0; d < 6; d++) {
        if (!h.river[d]) continue;
        const [ax, ay, bx, by] = this.edgeSeg(i, d);
        ctx.strokeStyle = h.bridge[d] ? 'rgba(140,190,215,.55)' : '#3d7f9e';
        ctx.lineWidth = lw * 1.4;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        if (h.bridge[d]) {
          ctx.strokeStyle = '#d8c48a'; ctx.lineWidth = lw * 0.8;
          ctx.beginPath();
          ctx.moveTo((ax + bx) / 2 - 2, (ay + by) / 2); ctx.lineTo((ax + bx) / 2 + 2, (ay + by) / 2);
          ctx.stroke();
        }
      }
    }

    // 4. retícula
    if (L.grid) {
      ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 0.6;
      for (const i of order) { this.hexPath(ctx, i); ctx.stroke(); }
    }

    // 5. nucleos de poblacion
    for (const i of order) {
      const h = g.hexes[i];
      if (!h.city) continue;
      const s = this.hexPx(this.pz[i]);
      const x = this.px[i], y = this.py[i];
      const r = s * (0.16 + h.city.size * 0.05);
      ctx.fillStyle = '#d8d2c2'; ctx.strokeStyle = '#20242a'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.rect(x - r, y - r, r * 2, r * 2); ctx.fill(); ctx.stroke();
      if (s > 8.5) {
        ctx.font = `600 ${Math.round(Math.max(11, Math.min(16, s * 0.62)))}px "Barlow Condensed", system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,.85)';
        ctx.strokeText(h.city.name, x, y - r - 3);
        ctx.fillStyle = '#efe8d6'; ctx.fillText(h.city.name, x, y - r - 3);
      }
    }

    if (L.supply) this.drawSupplyNet(ctx, order);

    // 6. linea de contacto
    if (L.front && A) {
      for (const [i, d] of A.front) {
        if (!pv[i]) continue;
        const [ax, ay, bx, by] = this.edgeSeg(i, d);
        ctx.strokeStyle = 'rgba(16,18,22,.85)'; ctx.lineWidth = lw * 2.4;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        ctx.strokeStyle = '#e8dfc8'; ctx.lineWidth = lw * 1.15;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      }
    }
  }

  /** Capas que laten y se repintan en cada fotograma. */
  drawDynamic(ctx, L, A, time) {
    const g = this.game, pv = this.pv, pz = this.pz;
    const order = [];
    for (let i = 0; i < g.N; i++) if (pv[i]) order.push(i);
    order.sort((a, b) => pz[b] - pz[a]);
    const lw = Math.max(0.7, this.hexPx(pz[order[order.length - 1]] || 1) * 0.10);

    // 7. formas operacionales
    if (A) {
      if (L.salients) for (const sd of SIDES) {
        for (const sal of A.sides[sd].salients) {
          this.outline(ctx, sal.cells, sal.vulnerable ? '#e0a83a' : 'rgba(224,168,58,.45)',
            Math.max(1.5, lw * 1.1), [6, 4], time * 14);
        }
      }
      for (const sd of SIDES) {
        const a = A.sides[sd];
        if (L.pockets) for (const p of a.pockets) {
          const pulse = 0.55 + 0.45 * Math.sin(time * 3);
          this.fillCells(ctx, p.cells, `rgba(212,60,48,${0.16 + 0.12 * pulse})`);
          this.outline(ctx, p.cells, p.sealed ? `rgba(255,80,60,${0.6 + 0.4 * pulse})` : '#e08a3a',
            Math.max(2, lw * 1.5), p.sealed ? [] : [8, 5], 0);
          this.label(ctx, p.centroid,
            p.sealed ? `⊗ CERCO — ${sd === 'BLUE' ? 'AZUL' : 'ROJO'}` : `BOLSA — ${sd === 'BLUE' ? 'AZUL' : 'ROJO'}`,
            `${p.units.length} unid · ${fmt(p.men)} h · ${p.areaKm2} km² · ${p.turnsIsolated} turnos aislado`,
            p.sealed ? '#ff6a55' : '#e08a3a');
        }
        if (L.pincers) for (const p of a.pincers) this.drawPincer(ctx, p, sd, time, lw);
      }
      if (L.salients) for (const sd of SIDES) {
        for (const sal of A.sides[sd].salients.slice(0, 2)) {
          this.label(ctx, sal.centroid, `SALIENTE ${sd === 'BLUE' ? 'AZUL' : 'ROJO'}`,
            `${Math.round(sal.depthKm)} km prof · cuello ${Math.round(sal.neckKm)} km` +
            (sal.vulnerable ? ' · VULNERABLE' : ''), '#e0a83a');
        }
      }
      if (L.advance) {
        for (const v of A.advance) {
          const u = g.byId[v.id];
          if (!u) continue;
          if (u.side !== g.player && (u.detectedBy?.[g.player] ?? 0) < 45 && L.fog) continue;
          const a = this.projAt(v.from[0], v.from[1]), b = this.projAt(v.to[0], v.to[1]);
          if (!a || !b) continue;
          ctx.globalAlpha = 0.55;
          arrow(ctx, a[0], a[1], b[0], b[1], SIDE_COL[v.side], Math.max(1.4, lw), lw * 5);
          ctx.globalAlpha = 1;
        }
      }
    }

    // 8. unidades, de lejos a cerca
    const units = g.units.filter(u => u.status !== 'destroyed');
    units.sort((a, b) => (this.pz[b.row * g.W + b.col] || 0) - (this.pz[a.row * g.W + a.col] || 0));
    for (const u of units) {
      const vis = this.unitVisibility(u);
      if (vis === 0) continue;
      this.drawUnit(ctx, u, vis, time);
    }

    // 9. seleccion y orden en curso
    const sel = this.ui.selected;
    if (sel && sel.status !== 'destroyed') {
      const i = sel.row * g.W + sel.col;
      if (pv[i]) {
        this.hexPath(ctx, i);
        ctx.strokeStyle = '#f2d489'; ctx.lineWidth = 2.2;
        ctx.setLineDash([5, 3]); ctx.lineDashOffset = -time * 12; ctx.stroke(); ctx.setLineDash([]);
      }
      const o = sel.order || sel.pending;
      if (o) {
        const a = this.projAt(sel.col, sel.row), b = this.projAt(o.col, o.row);
        if (a && b) {
          arrow(ctx, a[0], a[1], b[0], b[1], o.type === 'attack' ? '#ff7a5c' : '#f2d489', 2, 9);
          if (sel.pending) {
            ctx.fillStyle = '#f2d489'; ctx.textAlign = 'center';
            ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace';
            ctx.fillText(`+${o.activeTurn - g.turn}T`, b[0], b[1] - 14);
          }
        }
      }
      if (this.ui.hoverPath) {
        ctx.strokeStyle = 'rgba(242,212,137,.6)'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
        ctx.beginPath();
        let first = true;
        for (const k of this.ui.hoverPath) {
          if (!pv[k]) continue;
          first ? (ctx.moveTo(this.px[k], this.py[k]), first = false) : ctx.lineTo(this.px[k], this.py[k]);
        }
        ctx.stroke(); ctx.setLineDash([]);
      }
    }
  }

  projAt(col, row) {
    const g = this.game;
    if (col < 0 || row < 0 || col >= g.W || row >= g.H) return null;
    const i = row * g.W + col;
    return this.pv[i] ? [this.px[i], this.py[i], this.pz[i]] : null;
  }

  fillCells(ctx, cells, style) {
    ctx.fillStyle = style;
    for (const i of cells) { if (this.pv[i]) { this.hexPath(ctx, i); ctx.fill(); } }
  }

  outline(ctx, cells, style, lw, dash, offset) {
    const g = this.game, set = new Set(cells);
    ctx.strokeStyle = style; ctx.lineWidth = lw;
    ctx.setLineDash(dash); ctx.lineDashOffset = -offset;
    ctx.beginPath();
    for (const i of cells) {
      if (!this.pv[i]) continue;
      const col = i % g.W, row = (i / g.W) | 0;
      const nb = neighbors(col, row);
      for (let d = 0; d < 6; d++) {
        const [nc, nr] = nb[d];
        const j = nr * g.W + nc;
        const outside = nc < 0 || nr < 0 || nc >= g.W || nr >= g.H || !set.has(j);
        if (!outside) continue;
        const [ax, ay, bx, by] = this.edgeSeg(i, d);
        ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
      }
    }
    ctx.stroke(); ctx.setLineDash([]);
  }

  label(ctx, centroid, title, sub, color) {
    const p = this.projAt(Math.round(centroid[0]), Math.round(centroid[1]));
    if (!p) return;
    let x = p[0], y = p[1];
    if (x < -200 || y < -80 || x > this.vw + 200 || y > this.vh + 80) return;
    ctx.textAlign = 'center';
    const fTitle = '600 13px "Barlow Condensed", system-ui, sans-serif';
    const fSub = '10.5px "IBM Plex Mono", ui-monospace, monospace';
    ctx.font = fTitle; const wT = ctx.measureText(title).width;
    ctx.font = fSub; const wS = ctx.measureText(sub).width;
    const w = Math.max(wT, wS) + 18;
    const hits = (yy) => this._labels.some(L =>
      Math.abs(L.x - x) < (L.w + w) / 2 && Math.abs(L.y - yy) < 36);
    let tries = 0;
    while (hits(y) && tries < 8) { y += (tries % 2 ? -1 : 1) * 36 * Math.ceil((tries + 1) / 2); tries++; }
    if (hits(y)) return;
    this._labels.push({ x, y, w });
    ctx.fillStyle = 'rgba(8,11,14,.85)';
    roundRect(ctx, x - w / 2, y - 17, w, 32, 4); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke();
    ctx.font = fTitle; ctx.fillStyle = color; ctx.fillText(title, x, y - 4);
    ctx.font = fSub; ctx.fillStyle = '#cbd4dc'; ctx.fillText(sub, x, y + 9);
  }

  drawPincer(ctx, p, side, time, lw) {
    const g = this.game;
    const A = this.projAt(p.armA.tip % g.W, (p.armA.tip / g.W) | 0);
    const B = this.projAt(p.armB.tip % g.W, (p.armB.tip / g.W) | 0);
    const bA = this.projAt(Math.round(p.armA.centroid[0]), Math.round(p.armA.centroid[1]));
    const bB = this.projAt(Math.round(p.armB.centroid[0]), Math.round(p.armB.centroid[1]));
    const col = '#f0cc4a';
    if (bA && A) arrow(ctx, bA[0], bA[1], A[0], A[1], col, Math.max(2.2, lw * 1.4), lw * 7);
    if (bB && B) arrow(ctx, bB[0], bB[1], B[0], B[1], col, Math.max(2.2, lw * 1.4), lw * 7);
    if (A && B) {
      ctx.strokeStyle = `rgba(240,204,74,${0.55 + 0.35 * Math.sin(time * 4)})`;
      ctx.lineWidth = Math.max(2, lw * 1.2);
      ctx.setLineDash([7, 6]); ctx.lineDashOffset = -time * 22;
      ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
      ctx.setLineDash([]);
    }
    this.label(ctx, [(p.armA.tip % g.W + p.armB.tip % g.W) / 2,
      (((p.armA.tip / g.W) | 0) + ((p.armB.tip / g.W) | 0)) / 2],
      `⇉ PINZA ${side === 'BLUE' ? 'AZUL' : 'ROJA'} — brecha ${p.gapKm} km`,
      `al cerrar: ${fmt(p.trappedMen)} h · ${p.trappedUnits.length} unid · ${p.trappedAreaKm2} km²`, col);
  }

  heat(ctx, order, fn, color) {
    for (const i of order) {
      const v = fn(i);
      if (v <= 0.02) continue;
      this.hexPath(ctx, i);
      ctx.fillStyle = hexA(color, Math.min(0.55, v * 0.55)); ctx.fill();
    }
  }

  threatAt(i) {
    const g = this.game, foe = other(g.player);
    const col = i % g.W, row = (i / g.W) | 0;
    let t = 0;
    for (const u of g.units) {
      if (u.side !== foe || u.status === 'destroyed') continue;
      if ((u.detectedBy?.[g.player] ?? 0) < 30) continue;
      const d = distance(u.col, u.row, col, row);
      if (d > 6) continue;
      t += (u.personnel / 15000) / (1 + d * d * 0.4);
    }
    return Math.min(1, t);
  }

  drawSupplyNet(ctx, order) {
    const g = this.game, sup = g._supply[g.player];
    for (const i of order) {
      if (sup.level[i] < 5) continue;
      const col = i % g.W, row = (i / g.W) | 0;
      const nb = neighbors(col, row);
      for (let d = 0; d < 3; d++) {
        const [nc, nr] = nb[d];
        if (nc < 0 || nr < 0 || nc >= g.W || nr >= g.H) continue;
        const j = nr * g.W + nc;
        if (!this.pv[j] || sup.level[j] < 5) continue;
        const v = Math.min(sup.level[i], sup.level[j]) / 100;
        ctx.strokeStyle = `rgba(90,200,230,${0.06 + v * 0.30})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(this.px[i], this.py[i]); ctx.lineTo(this.px[j], this.py[j]); ctx.stroke();
      }
    }
    for (const bi of g.sides[g.player].bases) {
      if (!this.pv[bi]) continue;
      ctx.fillStyle = '#6ad2f0';
      ctx.beginPath(); ctx.arc(this.px[bi], this.py[bi], 3.5, 0, 7); ctx.fill();
    }
  }

  visibilityMask() {
    const g = this.game;
    if (!this.ui.layers.fog) return null;
    if (this._maskTurn === g.turn && this._mask) return this._mask;
    const m = new Uint8Array(g.N);
    for (const u of g.units) {
      if (u.side !== g.player || u.status === 'destroyed') continue;
      const R = Math.round(TERRAIN[g.hexes[u.row * g.W + u.col].t].sight * Math.min(2.2, u.tpl.recon));
      for (let dr = -R; dr <= R; dr++) for (let dc = -R; dc <= R; dc++) {
        const c = u.col + dc, r = u.row + dr;
        if (c < 0 || r < 0 || c >= g.W || r >= g.H) continue;
        if (distance(u.col, u.row, c, r) <= R) m[r * g.W + c] = 1;
      }
    }
    for (let i = 0; i < g.N; i++) if (g._supply[g.player].level[i] > 8) m[i] = 1;
    this._mask = m; this._maskTurn = g.turn;
    return m;
  }

  unitVisibility(u) {
    const g = this.game;
    if (u.side === g.player) return 2;
    if (!this.ui.layers.fog) return 2;
    const d = u.detectedBy?.[g.player] ?? 0;
    if (d >= 65) return 2;
    if (d >= 25) return 1;
    return g.turn - u.lastSeenTurn <= 3 && u.lastSeen ? 1 : 0;
  }

  drawUnit(ctx, u, vis, time) {
    const g = this.game;
    const pos = (vis === 1 && u.side !== g.player && u.lastSeen) ? u.lastSeen : [u.col, u.row];
    const p = this.projAt(pos[0], pos[1]);
    if (!p) return;
    const x = p[0], y = p[1];
    if (x < -40 || y < -40 || x > this.vw + 40 || y > this.vh + 40) return;
    const s = Math.max(7, Math.min(34, this.hexPx(p[2])));
    const w = s * 1.05, h = s * 0.68;
    const col = SIDE_COL[u.side];

    ctx.globalAlpha = vis === 1 ? 0.45 : 1;
    ctx.fillStyle = u.side === g.player ? 'rgba(24,42,70,.95)' : 'rgba(62,24,22,.95)';
    ctx.strokeStyle = u.status === 'routed' ? '#e0b040' : col;
    ctx.lineWidth = u === this.ui.selected ? 2.4 : 1.4;
    roundRect(ctx, x - w / 2, y - h / 2, w, h, 2); ctx.fill(); ctx.stroke();

    if (vis === 2 || u.side === g.player) {
      drawSymbol(ctx, u.tpl.symbol, x, y, w, h);
      if (s > 13) {
        ctx.fillStyle = '#cfd8e0'; ctx.textAlign = 'center';
        ctx.font = `${Math.round(s * 0.3)}px "IBM Plex Mono", ui-monospace, monospace`;
        const ech = u.tpl.cmdRadius >= 15 ? 'XXXX' : u.tpl.cmdRadius > 0 ? 'XXX'
          : /Brigada|Regimiento/.test(u.tpl.name) ? 'X' : 'XX';
        ctx.fillText(ech, x, y - h / 2 - 1.5);
      }
      if (s > 11) {
        const bw = w, bh = Math.max(1.6, s * 0.075);
        const bars = [
          [u.personnel / u.personnelMax, '#7fc98a'],
          [u.morale / 100, '#d8c46a'],
          [Math.min(1, u.supplyLevel / 100), '#5fc0da'],
        ];
        bars.forEach((b, k) => {
          const by = y + h / 2 + 1 + k * (bh + 0.8);
          ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(x - bw / 2, by, bw, bh);
          ctx.fillStyle = b[1]; ctx.fillRect(x - bw / 2, by, bw * Math.max(0, Math.min(1, b[0])), bh);
        });
      }
      if (u.supplyLevel < 3) {
        ctx.fillStyle = `rgba(255,80,60,${0.6 + 0.4 * Math.sin(time * 5)})`;
        ctx.font = `bold ${Math.round(s * 0.5)}px "Barlow Condensed", system-ui, sans-serif`;
        ctx.textAlign = 'left'; ctx.fillText('⊗', x + w / 2 - 1, y - h / 2 + s * 0.42);
      } else if (u.supplyLevel < 25) {
        ctx.fillStyle = '#e0a040';
        ctx.font = `bold ${Math.round(s * 0.42)}px "Barlow Condensed", system-ui, sans-serif`;
        ctx.textAlign = 'left'; ctx.fillText('!', x + w / 2 - 1, y - h / 2 + s * 0.4);
      }
      if (u.entrench >= 3 && s > 12) {
        ctx.strokeStyle = '#9aa7b2'; ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x - w / 2, y + h / 2 + 0.5); ctx.lineTo(x - w / 2 - 3, y + h / 2 + 0.5);
        ctx.moveTo(x - w / 2 - 1.5, y - h / 2); ctx.lineTo(x - w / 2 - 1.5, y + h / 2);
        ctx.stroke();
      }
      if (s > 15 && (u.order || u.pending)) {
        const o = u.order || u.pending;
        ctx.fillStyle = o.type === 'attack' ? '#ff8a6a' : '#9fd0f0';
        ctx.beginPath(); ctx.arc(x - w / 2 + 2, y - h / 2 + 2, 2, 0, 7); ctx.fill();
      }
    } else {
      ctx.fillStyle = '#e8c07a'; ctx.textAlign = 'center';
      ctx.font = `bold ${Math.round(s * 0.5)}px "Barlow Condensed", system-ui, sans-serif`;
      ctx.fillText('?', x, y + s * 0.17);
    }
    ctx.globalAlpha = 1;
  }

  /** Retícula mas cercana a un punto de pantalla, o null. */
  pickHex(sx, sy) {
    const ll = this.cam.pick(sx, sy);
    if (!ll) return null;
    return this.game.theater.lonLatToHex(ll[0], ll[1]);
  }
}

// ── simbologia tipo OTAN, simplificada ────────────────────────────────
function drawSymbol(ctx, sym, x, y, w, h) {
  ctx.strokeStyle = '#dbe4ec'; ctx.lineWidth = 1.2; ctx.fillStyle = '#dbe4ec';
  const w2 = w * 0.34, h2 = h * 0.32;
  ctx.beginPath();
  switch (sym) {
    case 'inf': case 'mtn':
      ctx.moveTo(x - w2, y - h2); ctx.lineTo(x + w2, y + h2);
      ctx.moveTo(x + w2, y - h2); ctx.lineTo(x - w2, y + h2); ctx.stroke();
      if (sym === 'mtn') { ctx.beginPath(); ctx.moveTo(x - w2, y + h2); ctx.lineTo(x, y - h2); ctx.lineTo(x + w2, y + h2); ctx.stroke(); }
      break;
    case 'arm':
      ctx.ellipse(x, y, w2, h2 * 0.9, 0, 0, 7); ctx.stroke(); break;
    case 'mech':
      ctx.ellipse(x, y, w2, h2 * 0.9, 0, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - w2, y - h2); ctx.lineTo(x + w2, y + h2);
      ctx.moveTo(x + w2, y - h2); ctx.lineTo(x - w2, y + h2); ctx.stroke(); break;
    case 'mtz':
      ctx.moveTo(x - w2, y - h2); ctx.lineTo(x + w2, y + h2);
      ctx.moveTo(x + w2, y - h2); ctx.lineTo(x - w2, y + h2); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, h2 * 0.45, 0, 7); ctx.stroke(); break;
    case 'arty':
      ctx.arc(x, y, h2 * 0.55, 0, 7); ctx.fill(); break;
    case 'rocket':
      ctx.arc(x, y, h2 * 0.5, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x, y - h2); ctx.lineTo(x, y + h2); ctx.stroke(); break;
    case 'recon':
      ctx.moveTo(x - w2, y + h2); ctx.lineTo(x + w2, y - h2); ctx.stroke(); break;
    case 'eng':
      ctx.moveTo(x - w2, y + h2); ctx.lineTo(x - w2, y - h2); ctx.lineTo(x + w2, y - h2);
      ctx.moveTo(x - w2, y); ctx.lineTo(x + w2 * 0.4, y); ctx.stroke(); break;
    case 'aa':
      ctx.moveTo(x - w2, y + h2); ctx.lineTo(x, y - h2); ctx.lineTo(x + w2, y + h2); ctx.stroke(); break;
    case 'log':
      ctx.moveTo(x - w2, y); ctx.lineTo(x + w2, y);
      ctx.moveTo(x, y - h2); ctx.lineTo(x, y + h2); ctx.stroke(); break;
    case 'para':
      ctx.arc(x, y - h2 * 0.2, w2 * 0.8, Math.PI, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y - h2 * 0.2); ctx.lineTo(x, y + h2); ctx.stroke(); break;
    case 'hq':
      ctx.moveTo(x - w2, y + h2); ctx.lineTo(x - w2, y - h2); ctx.lineTo(x + w2, y - h2);
      ctx.lineTo(x + w2, y); ctx.lineTo(x - w2, y); ctx.stroke(); break;
    default:
      ctx.moveTo(x - w2, y); ctx.lineTo(x + w2, y); ctx.stroke();
  }
}

function arrow(ctx, x1, y1, x2, y2, color, lw, head) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const l = Math.hypot(x2 - x1, y2 - y1);
  if (l < 4) return;
  head = Math.max(4, Math.min(head, l * 0.5));
  const hx = x2 - Math.cos(a) * head * 0.6, hy = y2 - Math.sin(a) * head * 0.6;
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(hx, hy); ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - Math.cos(a - 0.42) * head, y2 - Math.sin(a - 0.42) * head);
  ctx.lineTo(x2 - Math.cos(a + 0.42) * head, y2 - Math.sin(a + 0.42) * head);
  ctx.closePath(); ctx.fill();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${Math.min(255, ((n >> 16) & 255) * k) | 0},${Math.min(255, ((n >> 8) & 255) * k) | 0},${Math.min(255, (n & 255) * k) | 0})`;
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function fmt(n) { return Math.round(n).toLocaleString('es-ES'); }
