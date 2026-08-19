// Geometria hexagonal (offset odd-r, hexagonos "pointy-top").
// Escala operacional: cada hexagono = 5 km entre lados opuestos.
export const HEX_KM = 5;

// Direcciones: 0=E 1=NE 2=NO 3=O 4=SO 5=SE  (filas pares / impares)
const ODDR = [
  [[+1, 0], [0, -1], [-1, -1], [-1, 0], [-1, +1], [0, +1]],
  [[+1, 0], [+1, -1], [0, -1], [-1, 0], [0, +1], [+1, +1]],
];
export const DIR_NAME = ['E', 'NE', 'NO', 'O', 'SO', 'SE'];
export const OPPOSITE = [3, 4, 5, 0, 1, 2];

export function neighbor(col, row, d) {
  const p = ODDR[row & 1][d];
  return [col + p[0], row + p[1]];
}
export function neighbors(col, row) {
  const t = ODDR[row & 1];
  return [
    [col + t[0][0], row + t[0][1]], [col + t[1][0], row + t[1][1]],
    [col + t[2][0], row + t[2][1]], [col + t[3][0], row + t[3][1]],
    [col + t[4][0], row + t[4][1]], [col + t[5][0], row + t[5][1]],
  ];
}

export function toCube(col, row) {
  const x = col - ((row - (row & 1)) / 2);
  const z = row;
  return [x, -x - z, z];
}
export function fromCube(x, z) {
  return [x + ((z - (z & 1)) / 2), z];
}
export function distance(c1, r1, c2, r2) {
  const a = toCube(c1, r1), b = toCube(c2, r2);
  return (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 2;
}

function cubeRound(x, y, z) {
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return [rx, ry, rz];
}

/** Hexagonos atravesados por el segmento A-B (para trazas de fuego, ejes, cierres de pinza). */
export function lineHexes(c1, r1, c2, r2) {
  const n = distance(c1, r1, c2, r2);
  if (n === 0) return [[c1, r1]];
  const a = toCube(c1, r1), b = toCube(c2, r2), out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const [x, , z] = cubeRound(
      a[0] + (b[0] - a[0]) * t + 1e-6,
      a[1] + (b[1] - a[1]) * t + 1e-6,
      a[2] + (b[2] - a[2]) * t - 2e-6);
    out.push(fromCube(x, z));
  }
  return out;
}

/** Todos los hexagonos a distancia <= rad. */
export function disc(col, row, rad) {
  const out = [];
  const [ax, , az] = toCube(col, row);
  for (let dx = -rad; dx <= rad; dx++) {
    for (let dz = Math.max(-rad, -dx - rad); dz <= Math.min(rad, -dx + rad); dz++) {
      out.push(fromCube(ax + dx, az + dz));
    }
  }
  return out;
}

export function ring(col, row, rad) {
  if (rad === 0) return [[col, row]];
  const out = [];
  let c = col, r = row;
  for (let i = 0; i < rad; i++)[c, r] = neighbor(c, r, 4);
  for (let d = 0; d < 6; d++) {
    for (let i = 0; i < rad; i++) { out.push([c, r]);[c, r] = neighbor(c, r, d); }
  }
  return out;
}

// ---- pixeles (pointy-top, size = circunradio) ----
const S3 = Math.sqrt(3);
export function hexToPixel(col, row, size) {
  return [size * S3 * (col + 0.5 * (row & 1)), size * 1.5 * row];
}
export function pixelToHex(x, y, size) {
  const q = (S3 / 3 * x - y / 3) / size;
  const r = (2 / 3 * y) / size;
  const [rx, , rz] = cubeRound(q, -q - r, r);
  return fromCube(rx, rz);
}
export function hexCorners(cx, cy, size) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 180 * (60 * i - 30);
    pts.push([cx + size * Math.cos(a), cy + size * Math.sin(a)]);
  }
  return pts;
}
