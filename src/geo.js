// Geometria del planeta y camara en perspectiva.
//
// El tablero deja de ser un plano: cada hexagono tiene una longitud y una latitud
// reales sobre la esfera terrestre. Todo lo que se dibuja pasa por project(), de
// modo que el frente, las bolsas y las flechas de avance se curvan con el terreno
// y desaparecen tras el horizonte igual que lo haria el propio terreno.

export const R_EARTH = 6371;          // km
export const KM_PER_DEG = 111.3195;   // meridiano

// ── vectores ──────────────────────────────────────────────────────────────
const D2R = Math.PI / 180, R2D = 180 / Math.PI;

export function lonLatToVec(lon, lat) {
  const a = lon * D2R, b = lat * D2R, c = Math.cos(b);
  return [c * Math.cos(a), c * Math.sin(a), Math.sin(b)];
}
/** Igual, pero escribiendo en un vector ya reservado: en los bucles de dibujo
 *  se llama decenas de miles de veces por fotograma y reservar mata. */
export function lonLatToVecInto(lon, lat, o) {
  const a = lon * D2R, b = lat * D2R, c = Math.cos(b);
  o[0] = c * Math.cos(a); o[1] = c * Math.sin(a); o[2] = Math.sin(b);
  return o;
}
export function vecToLonLat(v) {
  return [Math.atan2(v[1], v[0]) * R2D, Math.asin(Math.max(-1, Math.min(1, v[2]))) * R2D];
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export { dot, cross, norm, add, sub, mul, len };

/** Diferencia angular de longitud normalizada a [-180,180). */
export function dlon(a, b) {
  let d = a - b;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

/**
 * Camara orbital sobre un punto de la superficie.
 *   target : [lon, lat] del punto observado
 *   alt    : altura del ojo sobre la superficie, en radios terrestres
 *   tilt   : inclinacion respecto de la vertical local (0 = cenital)
 *   bearing: giro alrededor de la vertical local
 */
export class Camera {
  constructor() {
    this.lon = 12; this.lat = 30;
    this.alt = 2.2; this.tilt = 0; this.bearing = 0;
    this.fov = 42 * D2R;
    this.vw = 1; this.vh = 1;
    this.update();
  }
  setViewport(w, h) {
    this.vw = w; this.vh = h;
    this.cx = w / 2; this.cy = h / 2;
    this.f = (h / 2) / Math.tan(this.fov / 2);
  }

  update() {
    const T = lonLatToVec(this.lon, this.lat);
    const U = T;                                   // vertical local
    const zAxis = [0, 0, 1];
    let N = sub(zAxis, mul(U, dot(zAxis, U)));     // norte tangente
    if (len(N) < 1e-6) N = [1, 0, 0];
    N = norm(N);
    const E = norm(cross(N, U));                   // este tangente
    const cb = Math.cos(this.bearing), sb = Math.sin(this.bearing);
    const fwdH = add(mul(N, cb), mul(E, sb));      // direccion horizontal de la mirada
    const ct = Math.cos(this.tilt), st = Math.sin(this.tilt);
    // el ojo se retira por la vertical y se echa hacia atras segun la inclinacion
    const off = add(mul(U, this.alt * ct), mul(fwdH, -this.alt * st));
    this.eye = add(T, off);
    this.eyeLen = len(this.eye);
    this.eyeHat = mul(this.eye, 1 / this.eyeLen);
    this.fwd = norm(sub(T, this.eye));
    this.right = norm(cross(this.fwd, U));
    this.up = cross(this.right, this.fwd);
    // coseno limite del horizonte: un punto de la esfera se ve si dot(P,eyeHat) >= 1/|eye|
    this.horizon = 1 / this.eyeLen;
    this.target = T;
    this.frameU = U; this.frameN = N; this.frameE = E;
  }

  /** Proyecta un punto (en radios terrestres). Devuelve [x, y, z, visible]. */
  project(P) {
    const d = sub(P, this.eye);
    const z = dot(d, this.fwd);
    if (z <= 0.0001) return [0, 0, z, false];
    const x = dot(d, this.right), y = dot(d, this.up);
    return [this.vw / 2 + this.f * x / z, this.vh / 2 - this.f * y / z, z, true];
  }

  /** Proyeccion sin reservar memoria: escribe [x, y, z, visible] en `out`. */
  projectInto(x, y, z, out) {
    const dx = x - this.eye[0], dy = y - this.eye[1], dz = z - this.eye[2];
    const f0 = this.fwd, r0 = this.right, u0 = this.up;
    const zz = dx * f0[0] + dy * f0[1] + dz * f0[2];
    if (zz <= 0.0001) { out[3] = 0; out[2] = zz; return out; }
    const xx = dx * r0[0] + dy * r0[1] + dz * r0[2];
    const yy = dx * u0[0] + dy * u0[1] + dz * u0[2];
    out[0] = this.cx + this.f * xx / zz;
    out[1] = this.cy - this.f * yy / zz;
    out[2] = zz; out[3] = 1;
    return out;
  }

  /** ¿Está el punto de superficie de este lado del horizonte? */
  onNearSide(P) { return dot(P, this.eyeHat) >= this.horizon; }
  onNearSideXYZ(x, y, z) {
    const e = this.eyeHat;
    return x * e[0] + y * e[1] + z * e[2] >= this.horizon;
  }

  /** Clave que resume el estado de la camara: sirve para no repetir dibujo. */
  key() {
    return `${this.lon.toFixed(5)},${this.lat.toFixed(5)},${this.alt.toFixed(6)},` +
      `${this.tilt.toFixed(4)},${this.bearing.toFixed(4)},${this.vw},${this.vh}`;
  }

  /** Rayo de pantalla a esfera. Devuelve [lon,lat] o null si no corta. */
  pick(sx, sy) {
    const x = (sx - this.vw / 2) / this.f, y = -(sy - this.vh / 2) / this.f;
    const dir = norm(add(add(mul(this.right, x), mul(this.up, y)), this.fwd));
    const b = dot(this.eye, dir), c = dot(this.eye, this.eye) - 1;
    const disc = b * b - c;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    if (t < 0) return null;
    return vecToLonLat(add(this.eye, mul(dir, t)));
  }

  /** Escala aproximada en pixeles por kilometro a la profundidad z. */
  kmScale(z) { return this.f / z / R_EARTH; }

  /** Altura del ojo en kilometros. */
  get altKm() { return this.alt * R_EARTH; }
}

/**
 * Un teatro de operaciones: un rectangulo de terreno real donde vive la retícula
 * hexagonal. Convierte coordenadas de retícula a longitud y latitud mediante una
 * proyeccion local plana, cuyo error a 300 km del centro es de pocas decenas de
 * metros: irrelevante frente a un hexagono de 5 km.
 */
export class Theater {
  constructor(lon0, lat0, W, H, hexKm) {
    this.lon0 = lon0; this.lat0 = lat0;
    this.W = W; this.H = H;
    this.hexKm = hexKm;
    this.s = hexKm / Math.sqrt(3);          // circunradio del hexagono, en km
    this.dx = hexKm;                        // separacion horizontal de centros
    this.dy = this.s * 1.5;                 // separacion vertical de centros
    this.cx = (W - 1) / 2 * this.dx + this.dx / 4;
    this.cy = (H - 1) / 2 * this.dy;
    this.cosLat = Math.cos(lat0 * Math.PI / 180) || 1e-3;
    // esquinas del hexagono en km respecto de su centro
    this.corner = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 180 * (60 * i - 30);
      this.corner.push([this.s * Math.cos(a), this.s * Math.sin(a)]);
    }
  }
  /** km respecto del centro del teatro (x al este, y al sur). */
  hexKmXY(col, row) {
    return [col * this.dx + (row & 1) * this.dx / 2 - this.cx, row * this.dy - this.cy];
  }
  kmToLonLat(x, y) {
    const lat = this.lat0 - y / KM_PER_DEG;
    const lon = this.lon0 + x / (KM_PER_DEG * this.cosLat);
    return [lon, lat];
  }
  lonLatToKm(lon, lat) {
    return [dlon(lon, this.lon0) * KM_PER_DEG * this.cosLat, (this.lat0 - lat) * KM_PER_DEG];
  }
  hexLonLat(col, row) { const [x, y] = this.hexKmXY(col, row); return this.kmToLonLat(x, y); }
  hexVec(col, row) { const [lo, la] = this.hexLonLat(col, row); return lonLatToVec(lo, la); }
  cornerVec(col, row, i) {
    const [x, y] = this.hexKmXY(col, row);
    const c = this.corner[i];
    const [lo, la] = this.kmToLonLat(x + c[0], y + c[1]);
    return lonLatToVec(lo, la);
  }
  /** Versiones sin reserva de memoria para los bucles de dibujo. */
  hexVecInto(col, row, o) {
    const x = col * this.dx + (row & 1) * this.dx / 2 - this.cx;
    const y = row * this.dy - this.cy;
    return lonLatToVecInto(this.lon0 + x / (KM_PER_DEG * this.cosLat),
      this.lat0 - y / KM_PER_DEG, o);
  }
  cornerVecInto(col, row, i, o) {
    const c = this.corner[i];
    const x = col * this.dx + (row & 1) * this.dx / 2 - this.cx + c[0];
    const y = row * this.dy - this.cy + c[1];
    return lonLatToVecInto(this.lon0 + x / (KM_PER_DEG * this.cosLat),
      this.lat0 - y / KM_PER_DEG, o);
  }
  /** Rectangulo geografico que cubre el teatro, con margen en grados. */
  bbox(marginDeg = 0) {
    const halfY = (this.H * this.dy) / 2 / KM_PER_DEG;
    const halfX = (this.W * this.dx) / 2 / (KM_PER_DEG * this.cosLat);
    return {
      w: this.lon0 - halfX - marginDeg, e: this.lon0 + halfX + marginDeg,
      s: this.lat0 - halfY - marginDeg, n: this.lat0 + halfY + marginDeg,
    };
  }
  /** Retícula mas cercana a una posicion geografica; null si cae fuera. */
  lonLatToHex(lon, lat) {
    const [x, y] = this.lonLatToKm(lon, lat);
    const row = Math.round((y + this.cy) / this.dy);
    const col = Math.round((x + this.cx - (row & 1) * this.dx / 2) / this.dx);
    if (col < 0 || row < 0 || col >= this.W || row >= this.H) return null;
    return [col, row];
  }
}

/** Emparejamiento direccion de vecino → par de esquinas de la arista compartida. */
export const EDGE_CORNERS = [[0, 1], [5, 0], [4, 5], [3, 4], [2, 3], [1, 2]];
