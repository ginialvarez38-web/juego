// Dibujo del teatro. La lectura del mapa es la mitad del juego: el frente, los
// salientes, las bolsas y las pinzas se pintan como los pintaria un oficial de
// operaciones sobre el calco de situacion.
import { hexToPixel, pixelToHex, hexCorners, neighbors, neighbor, distance, HEX_KM } from './hex.js';
import { TERRAIN } from './terrain.js';
import { SIDES, other, projectsZOC } from './sim.js';

const SIDE_COL = { BLUE: '#5b8fd4', RED: '#c9584c' };
const SIDE_FILL = { BLUE: 'rgba(80,130,200,0.13)', RED: 'rgba(200,72,58,0.13)' };
const SIDE_DEEP = { BLUE: 'rgba(80,130,200,0.24)', RED: 'rgba(200,72,58,0.24)' };

export class Renderer {
  constructor(canvas, game, ui) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.game = game; this.ui = ui;
    this.cam = { x: 0, y: 0, z: 1 };
    this.base = 19;
    this.layers = {};
    this.t0 = performance.now();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.cv.getBoundingClientRect();
    this.cv.width = Math.max(1, r.width * dpr);
    this.cv.height = Math.max(1, r.height * dpr);
    this.dpr = dpr; this.vw = r.width; this.vh = r.height;
  }
  get size() { return this.base * this.cam.z; }
  worldOf(col, row) { return hexToPixel(col, row, this.size); }
  toScreen(wx, wy) { return [wx - this.cam.x, wy - this.cam.y]; }
  screenToHex(sx, sy) { return pixelToHex(sx + this.cam.x, sy + this.cam.y, this.size); }
  centerOn(col, row) {
    const [wx, wy] = this.worldOf(col, row);
    this.cam.x = wx - this.vw / 2; this.cam.y = wy - this.vh / 2;
  }
  /** Encuadra el teatro completo: el mando ve primero el conjunto del frente. */
  fitTheater(margin = 24) {
    const g = this.game;
    const wWorld = (g.W + 0.5) * Math.sqrt(3) * this.base;
    const hWorld = (g.H * 1.5 + 0.5) * this.base;
    this.cam.z = Math.max(0.42, Math.min(3.2,
      Math.min((this.vw - margin) / wWorld, (this.vh - margin) / hWorld)));
    this.centerOn((g.W - 1) / 2, (g.H - 1) / 2);
  }
  zoomAt(sx, sy, factor) {
    const oldS = this.size;
    const wx = sx + this.cam.x, wy = sy + this.cam.y;
    this.cam.z = Math.max(0.42, Math.min(3.2, this.cam.z * factor));
    const k = this.size / oldS;
    this.cam.x = wx * k - sx; this.cam.y = wy * k - sy;
  }

  visibleRange() {
    const s = this.size;
    const r0 = Math.max(0, Math.floor(this.cam.y / (s * 1.5)) - 2);
    const r1 = Math.min(this.game.H - 1, Math.ceil((this.cam.y + this.vh) / (s * 1.5)) + 2);
    const c0 = Math.max(0, Math.floor(this.cam.x / (s * Math.sqrt(3))) - 2);
    const c1 = Math.min(this.game.W - 1, Math.ceil((this.cam.x + this.vw) / (s * Math.sqrt(3))) + 2);
    return [c0, r0, c1, r1];
  }

  hexPath(ctx, cx, cy, s, shrink = 1) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 180 * (60 * i - 30);
      const x = cx + s * shrink * Math.cos(a), y = cy + s * shrink * Math.sin(a);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
  }

  draw() {
    const g = this.game, ctx = this.ctx, L = this.ui.layers;
    const time = (performance.now() - this.t0) / 1000;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#0a0d10';
    ctx.fillRect(0, 0, this.vw, this.vh);

    const s = this.size;
    const [c0, r0, c1, r1] = this.visibleRange();
    const A = g.analysis;
    const seen = this.visibilityMask();
    this._labels = [];

    // ── 1. terreno ────────────────────────────────────────────────────
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const i = row * g.W + col, h = g.hexes[i];
        const [wx, wy] = hexToPixel(col, row, s);
        const x = wx - this.cam.x, y = wy - this.cam.y;
        const T = TERRAIN[h.t];
        this.hexPath(ctx, x, y, s);
        const sh = 0.82 + 0.36 * h.elev;
        ctx.fillStyle = shade(T.color, sh * (L.fog && !seen[i] ? 0.55 : 1));
        ctx.fill();
        if (h.city) {
          ctx.fillStyle = 'rgba(0,0,0,.30)';
          ctx.beginPath(); ctx.arc(x, y, s * 0.42, 0, 7); ctx.fill();
        }
      }
    }

    // ── 2. control territorial ───────────────────────────────────────
    if (L.control && A) {
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          const i = row * g.W + col;
          const sd = SIDES[A.owner[i]];
          const [wx, wy] = hexToPixel(col, row, s);
          const enc = A.sides[sd].enclosure[i] || 0;
          this.hexPath(ctx, wx - this.cam.x, wy - this.cam.y, s);
          ctx.fillStyle = enc > 0.4 ? SIDE_DEEP[sd] : SIDE_FILL[sd];
          ctx.fill();
        }
      }
    }

    // ── 3. mapas de calor ────────────────────────────────────────────
    if (L.supply) this.heat(ctx, (i) => g._supply[g.player].level[i] / 100, '#3fa8c8', c0, r0, c1, r1);
    if (L.threat) this.heat(ctx, (i) => this.threatAt(i), '#d24a3a', c0, r0, c1, r1);

    // ── 4. rios, carreteras, ferrocarril ─────────────────────────────
    ctx.lineCap = 'round';
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const i = row * g.W + col, h = g.hexes[i];
        const [wx, wy] = hexToPixel(col, row, s);
        const x = wx - this.cam.x, y = wy - this.cam.y;
        if (h.road) {
          const nb = neighbors(col, row);
          for (let d = 0; d < 3; d++) {
            const [nc, nr] = nb[d];
            if (nc < 0 || nr < 0 || nc >= g.W || nr >= g.H) continue;
            const o = g.hexes[nr * g.W + nc];
            if (!o.road) continue;
            const [ox, oy] = hexToPixel(nc, nr, s);
            ctx.strokeStyle = (h.road >= 2 && o.road >= 2) ? 'rgba(212,190,140,.75)' : 'rgba(180,165,130,.45)';
            ctx.lineWidth = (h.road >= 2 && o.road >= 2) ? Math.max(1.4, s * 0.11) : Math.max(0.8, s * 0.06);
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ox - this.cam.x, oy - this.cam.y); ctx.stroke();
          }
        }
        if (h.rail && s > 9) {
          ctx.strokeStyle = 'rgba(40,40,45,.75)'; ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          const nb = neighbors(col, row);
          for (let d = 0; d < 3; d++) {
            const [nc, nr] = nb[d];
            if (nc < 0 || nr < 0 || nc >= g.W || nr >= g.H) continue;
            if (!g.hexes[nr * g.W + nc].rail) continue;
            const [ox, oy] = hexToPixel(nc, nr, s);
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ox - this.cam.x, oy - this.cam.y); ctx.stroke();
          }
          ctx.setLineDash([]);
        }
        for (let d = 0; d < 6; d++) {
          if (!h.river[d]) continue;
          const [ax, ay, bx, by] = this.edgePoints(x, y, d, s);
          ctx.strokeStyle = h.bridge[d] ? 'rgba(120,180,210,.5)' : '#3d7f9e';
          ctx.lineWidth = Math.max(1.4, s * 0.13);
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
          if (h.bridge[d]) {
            ctx.strokeStyle = '#d8c48a'; ctx.lineWidth = Math.max(1, s * 0.07);
            ctx.beginPath(); ctx.moveTo((ax + bx) / 2 - 2, (ay + by) / 2); ctx.lineTo((ax + bx) / 2 + 2, (ay + by) / 2); ctx.stroke();
          }
        }
      }
    }

    // ── 5. retícula ──────────────────────────────────────────────────
    if (L.grid) {
      ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 0.6;
      for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
        const [wx, wy] = hexToPixel(col, row, s);
        this.hexPath(ctx, wx - this.cam.x, wy - this.cam.y, s); ctx.stroke();
      }
    }

    // ── 6. ciudades ──────────────────────────────────────────────────
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const h = g.hexes[row * g.W + col];
        if (!h.city) continue;
        const [wx, wy] = hexToPixel(col, row, s);
        const x = wx - this.cam.x, y = wy - this.cam.y;
        ctx.fillStyle = '#d8d2c2'; ctx.strokeStyle = '#20242a'; ctx.lineWidth = 1;
        const r = s * (0.14 + h.city.size * 0.045);
        ctx.beginPath(); ctx.rect(x - r, y - r, r * 2, r * 2); ctx.fill(); ctx.stroke();
        if (s > 13) {
          ctx.font = `${Math.round(s * 0.46)}px "Barlow Condensed", system-ui, sans-serif`;
          ctx.textAlign = 'center'; ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(0,0,0,.8)';
          ctx.strokeText(h.city.name, x, y - r - 3);
          ctx.fillStyle = '#efe8d6'; ctx.fillText(h.city.name, x, y - r - 3);
        }
      }
    }

    // ── 7. red logistica del jugador ─────────────────────────────────
    if (L.supply) this.drawSupplyNet(ctx, s);

    // ── 8. linea de contacto ─────────────────────────────────────────
    if (L.front && A) {
      ctx.lineCap = 'round';
      for (const [i, d] of A.front) {
        const col = i % g.W, row = (i / g.W) | 0;
        if (col < c0 - 2 || col > c1 + 2 || row < r0 - 2 || row > r1 + 2) continue;
        const [wx, wy] = hexToPixel(col, row, s);
        const [ax, ay, bx, by] = this.edgePoints(wx - this.cam.x, wy - this.cam.y, d, s);
        ctx.strokeStyle = 'rgba(20,22,26,.85)'; ctx.lineWidth = Math.max(2.4, s * 0.20);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        ctx.strokeStyle = '#e8dfc8'; ctx.lineWidth = Math.max(1.2, s * 0.10);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      }
    }

    // ── 9. formas operacionales ──────────────────────────────────────
    if (A) {
      // Los contornos se pintan primero y los rotulos despues, por orden de
      // importancia: cerco, pinza y luego saliente. Asi, cuando el calco se
      // llena, lo que sobrevive es lo que decide la batalla.
      if (L.salients) for (const sd of SIDES) {
        for (const sal of A.sides[sd].salients) {
          this.outline(ctx, sal.cells, sal.vulnerable ? '#e0a83a' : 'rgba(224,168,58,.45)',
            Math.max(1.6, s * 0.09), [6, 4], time * 14);
        }
      }
      for (const sd of SIDES) {
        const a = A.sides[sd];
        if (L.pockets) for (const p of a.pockets) {
          const pulse = 0.55 + 0.45 * Math.sin(time * 3);
          this.fillCells(ctx, p.cells, `rgba(212,60,48,${0.16 + 0.12 * pulse})`);
          this.outline(ctx, p.cells, p.sealed ? `rgba(255,80,60,${0.6 + 0.4 * pulse})` : '#e08a3a',
            Math.max(2, s * 0.13), p.sealed ? [] : [8, 5], 0);
          this.label(ctx, p.centroid,
            p.sealed ? `⊗ CERCO — ${sd === 'BLUE' ? 'AZUL' : 'ROJO'}` : `BOLSA — ${sd === 'BLUE' ? 'AZUL' : 'ROJO'}`,
            `${p.units.length} unid · ${fmt(p.men)} h · ${p.areaKm2} km² · ${p.turnsIsolated} turnos aislado`,
            p.sealed ? '#ff6a55' : '#e08a3a', s);
        }
        if (L.pincers) for (const p of a.pincers) {
          this.drawPincer(ctx, p, sd, s, time);
        }
      }
      if (L.salients) for (const sd of SIDES) {
        for (const sal of A.sides[sd].salients.slice(0, 2)) {
          this.label(ctx, sal.centroid, `SALIENTE ${sd === 'BLUE' ? 'AZUL' : 'ROJO'}`,
            `${Math.round(sal.depthKm)} km prof · cuello ${Math.round(sal.neckKm)} km` +
            (sal.vulnerable ? ' · VULNERABLE' : ''), '#e0a83a', s);
        }
      }
    }

    // ── 10. vectores de avance ───────────────────────────────────────
    if (L.advance && A) {
      for (const v of A.advance) {
        const u = g.byId[v.id];
        if (!u) continue;
        if (u.side !== g.player && (u.detectedBy?.[g.player] ?? 0) < 45 && L.fog) continue;
        const [fx, fy] = hexToPixel(v.from[0], v.from[1], s);
        const [tx, ty] = hexToPixel(v.to[0], v.to[1], s);
        ctx.globalAlpha = 0.55;
        arrow(ctx, fx - this.cam.x, fy - this.cam.y, tx - this.cam.x, ty - this.cam.y,
          SIDE_COL[v.side], Math.max(1.4, s * 0.08), s * 0.5);
        ctx.globalAlpha = 1;
      }
    }

    // ── 11. unidades ─────────────────────────────────────────────────
    for (const u of g.units) {
      if (u.status === 'destroyed') continue;
      const vis = this.unitVisibility(u);
      if (vis === 0) continue;
      this.drawUnit(ctx, u, s, vis, time);
    }

    // ── 12. seleccion y orden en curso ───────────────────────────────
    const sel = this.ui.selected;
    if (sel && sel.status !== 'destroyed') {
      const [wx, wy] = hexToPixel(sel.col, sel.row, s);
      this.hexPath(ctx, wx - this.cam.x, wy - this.cam.y, s, 0.97);
      ctx.strokeStyle = '#f2d489'; ctx.lineWidth = 2.2;
      ctx.setLineDash([5, 3]); ctx.lineDashOffset = -time * 12; ctx.stroke(); ctx.setLineDash([]);
      const o = sel.order || sel.pending;
      if (o) {
        const [tx, ty] = hexToPixel(o.col, o.row, s);
        arrow(ctx, wx - this.cam.x, wy - this.cam.y, tx - this.cam.x, ty - this.cam.y,
          o.type === 'attack' ? '#ff7a5c' : '#f2d489', 2, s * 0.55);
        if (sel.pending) {
          ctx.fillStyle = '#f2d489'; ctx.font = `${Math.round(s * 0.45)}px "IBM Plex Mono", ui-monospace, monospace`;
          ctx.textAlign = 'center';
          ctx.fillText(`+${o.activeTurn - g.turn}T`, tx - this.cam.x, ty - this.cam.y - s * 0.9);
        }
      }
      if (this.ui.hoverPath) {
        ctx.strokeStyle = 'rgba(242,212,137,.6)'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
        ctx.beginPath();
        let first = true;
        for (const i of this.ui.hoverPath) {
          const [px, py] = hexToPixel(i % g.W, (i / g.W) | 0, s);
          first ? (ctx.moveTo(px - this.cam.x, py - this.cam.y), first = false)
            : ctx.lineTo(px - this.cam.x, py - this.cam.y);
        }
        ctx.stroke(); ctx.setLineDash([]);
      }
    }
    ctx.restore();
  }

  // ── auxiliares de dibujo ───────────────────────────────────────────
  edgePoints(cx, cy, d, s) {
    // arista compartida con el vecino d: perpendicular al vector de centros
    const angs = [0, -60, -120, 180, 120, 60];
    const a = Math.PI / 180 * angs[d];
    const dx = Math.cos(a) * s * Math.sqrt(3) / 2, dy = Math.sin(a) * s * Math.sqrt(3) / 2;
    const mx = cx + dx, my = cy + dy;
    const px = -dy / (s * Math.sqrt(3) / 2) * (s / 2), py = dx / (s * Math.sqrt(3) / 2) * (s / 2);
    return [mx + px, my + py, mx - px, my - py];
  }

  fillCells(ctx, cells, style) {
    const s = this.size, g = this.game;
    ctx.fillStyle = style;
    for (const i of cells) {
      const [wx, wy] = hexToPixel(i % g.W, (i / g.W) | 0, s);
      const x = wx - this.cam.x, y = wy - this.cam.y;
      if (x < -s * 2 || y < -s * 2 || x > this.vw + s * 2 || y > this.vh + s * 2) continue;
      this.hexPath(ctx, x, y, s); ctx.fill();
    }
  }

  /** Contorno de un conjunto de hexagonos: solo las aristas de borde. */
  outline(ctx, cells, style, lw, dash, offset) {
    const s = this.size, g = this.game, set = new Set(cells);
    ctx.strokeStyle = style; ctx.lineWidth = lw;
    ctx.setLineDash(dash); ctx.lineDashOffset = -offset;
    ctx.beginPath();
    for (const i of cells) {
      const col = i % g.W, row = (i / g.W) | 0;
      const [wx, wy] = hexToPixel(col, row, s);
      const x = wx - this.cam.x, y = wy - this.cam.y;
      if (x < -s * 3 || y < -s * 3 || x > this.vw + s * 3 || y > this.vh + s * 3) continue;
      const nb = neighbors(col, row);
      for (let d = 0; d < 6; d++) {
        const [nc, nr] = nb[d];
        const j = nr * g.W + nc;
        const outside = nc < 0 || nr < 0 || nc >= g.W || nr >= g.H || !set.has(j);
        if (!outside) continue;
        const [ax, ay, bx, by] = this.edgePoints(x, y, d, s);
        ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
      }
    }
    ctx.stroke(); ctx.setLineDash([]);
  }

  /** Rotulo de una forma operacional, con desplazamiento para no pisar a otro. */
  label(ctx, centroid, title, sub, color, s) {
    const [wx, wy] = hexToPixel(centroid[0], centroid[1], s);
    let x = wx - this.cam.x, y = wy - this.cam.y;
    if (x < -200 || y < -80 || x > this.vw + 200 || y > this.vh + 80) return;
    ctx.textAlign = 'center';
    const fTitle = `600 ${Math.max(10, Math.round(s * 0.55))}px "Barlow Condensed", system-ui, sans-serif`;
    const fSub = `${Math.max(9, Math.round(s * 0.42))}px "IBM Plex Mono", ui-monospace, monospace`;
    ctx.font = fTitle; const wT = ctx.measureText(title).width;
    ctx.font = fSub; const wS = ctx.measureText(sub).width;
    const w = Math.max(wT, wS) + 18;
    ctx.font = fTitle;
    // el calco se vuelve ilegible si los rotulos se solapan: se busca hueco
    const hits = (yy) => this._labels.some(L =>
      Math.abs(L.x - x) < (L.w + w) / 2 && Math.abs(L.y - yy) < 36);
    let tries = 0;
    while (hits(y) && tries < 8) { y += (tries % 2 ? -1 : 1) * 36 * Math.ceil((tries + 1) / 2); tries++; }
    if (hits(y)) return;
    this._labels.push({ x, y, w });
    ctx.fillStyle = 'rgba(8,11,14,.82)';
    roundRect(ctx, x - w / 2, y - 17, w, 32, 4); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = color; ctx.fillText(title, x, y - 4);
    ctx.font = fSub;
    ctx.fillStyle = '#cbd4dc'; ctx.fillText(sub, x, y + 9);
  }

  drawPincer(ctx, p, side, s, time) {
    const g = this.game;
    const tip = (i) => { const [x, y] = hexToPixel(i % g.W, (i / g.W) | 0, s); return [x - this.cam.x, y - this.cam.y]; };
    const c = (arr) => { const [x, y] = hexToPixel(arr[0], arr[1], s); return [x - this.cam.x, y - this.cam.y]; };
    const A = tip(p.armA.tip), B = tip(p.armB.tip);
    const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    const baseA = c(p.armA.centroid), baseB = c(p.armB.centroid);
    const col = '#f0cc4a';
    arrow(ctx, baseA[0], baseA[1], A[0], A[1], col, Math.max(2.4, s * 0.14), s * 0.75);
    arrow(ctx, baseB[0], baseB[1], B[0], B[1], col, Math.max(2.4, s * 0.14), s * 0.75);
    ctx.strokeStyle = `rgba(240,204,74,${0.55 + 0.35 * Math.sin(time * 4)})`;
    ctx.lineWidth = Math.max(2, s * 0.11);
    ctx.setLineDash([7, 6]); ctx.lineDashOffset = -time * 22;
    ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
    ctx.setLineDash([]);
    this.label(ctx, [(p.armA.tip % g.W + p.armB.tip % g.W) / 2,
    (((p.armA.tip / g.W) | 0) + ((p.armB.tip / g.W) | 0)) / 2],
      `⇉ PINZA ${side === 'BLUE' ? 'AZUL' : 'ROJA'} — brecha ${p.gapKm} km`,
      `al cerrar: ${fmt(p.trappedMen)} h · ${p.trappedUnits.length} unid · ${p.trappedAreaKm2} km²`, col, s);
  }

  heat(ctx, fn, color, c0, r0, c1, r1) {
    const g = this.game, s = this.size;
    for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
      const i = row * g.W + col;
      const v = fn(i);
      if (v <= 0.02) continue;
      const [wx, wy] = hexToPixel(col, row, s);
      this.hexPath(ctx, wx - this.cam.x, wy - this.cam.y, s);
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

  drawSupplyNet(ctx, s) {
    const g = this.game, sup = g._supply[g.player];
    ctx.lineWidth = Math.max(1, s * 0.08);
    for (let i = 0; i < g.N; i++) {
      if (sup.level[i] < 5) continue;
      const col = i % g.W, row = (i / g.W) | 0;
      const [wx, wy] = hexToPixel(col, row, s);
      const x = wx - this.cam.x, y = wy - this.cam.y;
      if (x < -s || y < -s || x > this.vw + s || y > this.vh + s) continue;
      const nb = neighbors(col, row);
      for (let d = 0; d < 3; d++) {
        const [nc, nr] = nb[d];
        if (nc < 0 || nr < 0 || nc >= g.W || nr >= g.H) continue;
        const j = nr * g.W + nc;
        if (sup.level[j] < 5) continue;
        const v = Math.min(sup.level[i], sup.level[j]) / 100;
        const [ox, oy] = hexToPixel(nc, nr, s);
        ctx.strokeStyle = `rgba(90,200,230,${0.06 + v * 0.30})`;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ox - this.cam.x, oy - this.cam.y); ctx.stroke();
      }
    }
    for (const bi of g.sides[g.player].bases) {
      const [wx, wy] = hexToPixel(bi % g.W, (bi / g.W) | 0, s);
      ctx.fillStyle = '#6ad2f0';
      ctx.beginPath(); ctx.arc(wx - this.cam.x, wy - this.cam.y, s * 0.3, 0, 7); ctx.fill();
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

  drawUnit(ctx, u, s, vis, time) {
    const g = this.game;
    const pos = (vis === 1 && u.side !== g.player && u.lastSeen) ? u.lastSeen : [u.col, u.row];
    const [wx, wy] = hexToPixel(pos[0], pos[1], s);
    const x = wx - this.cam.x, y = wy - this.cam.y;
    if (x < -40 || y < -40 || x > this.vw + 40 || y > this.vh + 40) return;
    const w = s * 1.02, h = s * 0.66;
    const col = SIDE_COL[u.side];

    ctx.globalAlpha = vis === 1 ? 0.45 : 1;
    ctx.fillStyle = u.side === g.player ? 'rgba(24,42,70,.95)' : 'rgba(62,24,22,.95)';
    ctx.strokeStyle = u.status === 'routed' ? '#e0b040' : col;
    ctx.lineWidth = u === this.ui.selected ? 2.4 : 1.4;
    roundRect(ctx, x - w / 2, y - h / 2, w, h, 2); ctx.fill(); ctx.stroke();

    if (vis === 2 || u.side === g.player) {
      drawSymbol(ctx, u.tpl.symbol, x, y, w, h, col);
      // escalon
      if (s > 12) {
        ctx.fillStyle = '#cfd8e0'; ctx.font = `${Math.round(s * 0.32)}px "IBM Plex Mono", ui-monospace, monospace`;
        ctx.textAlign = 'center';
        const ech = u.tpl.cmdRadius >= 15 ? 'XXXX' : u.tpl.cmdRadius > 0 ? 'XXX'
          : /Brigada|Regimiento/.test(u.tpl.name) ? 'X' : 'XX';
        ctx.fillText(ech, x, y - h / 2 - 1.5);
      }
      // barras de estado: efectivos / moral / abastecimiento
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
      // indicadores
      if (u.supplyLevel < 3) {
        ctx.fillStyle = `rgba(255,80,60,${0.6 + 0.4 * Math.sin(time * 5)})`;
        ctx.font = `bold ${Math.round(s * 0.5)}px "Barlow Condensed", system-ui, sans-serif`; ctx.textAlign = 'left';
        ctx.fillText('⊗', x + w / 2 - 1, y - h / 2 + s * 0.42);
      } else if (u.supplyLevel < 25) {
        ctx.fillStyle = '#e0a040'; ctx.font = `bold ${Math.round(s * 0.42)}px "Barlow Condensed", system-ui, sans-serif`;
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
      ctx.fillStyle = '#e8c07a'; ctx.font = `bold ${Math.round(s * 0.5)}px "Barlow Condensed", system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.fillText('?', x, y + s * 0.17);
    }
    ctx.globalAlpha = 1;
  }
}

// ── simbologia tipo OTAN, simplificada ────────────────────────────────
function drawSymbol(ctx, sym, x, y, w, h, col) {
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
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 4) return;
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
  const r = Math.min(255, ((n >> 16) & 255) * k) | 0;
  const g = Math.min(255, ((n >> 8) & 255) * k) | 0;
  const b = Math.min(255, (n & 255) * k) | 0;
  return `rgb(${r},${g},${b})`;
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function fmt(n) { return Math.round(n).toLocaleString('es-ES'); }
