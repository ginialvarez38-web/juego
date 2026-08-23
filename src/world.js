// Acceso a la geometria real del planeta ya decodificada.
import * as G from './geodata.js';
import { ringIndex, ringsIn, fillRings, strokeRings } from './raster.js';

let _w = null;

export function world() {
  if (_w) return _w;
  const globe = G.decodeRings(G.LAND_GLOBE, G.SCALE_GLOBE);
  const land = G.decodeRings(G.LAND_FINE, G.SCALE_FINE);
  const lakes = G.decodeRings(G.LAKES, G.SCALE_FINE);
  const rivers = G.decodeRings(G.RIVERS, G.SCALE_FINE);
  const relief = G.RELIEF.map(s => G.decodeRings(s, G.SCALE_RELIEF));
  _w = {
    globe, globeIdx: ringIndex(globe),
    land, landIdx: ringIndex(land),
    lakes, lakesIdx: ringIndex(lakes),
    rivers, riversIdx: ringIndex(rivers),
    relief, reliefIdx: relief.map(ringIndex),
    classes: G.RELIEF_CLASSES,
    cities: G.CITIES, peaks: G.PEAKS, countries: G.COUNTRIES,
  };
  return _w;
}

export function citiesIn(bbox, limit = 400) {
  return world().cities
    .filter(c => c.x >= bbox.w && c.x <= bbox.e && c.y >= bbox.s && c.y <= bbox.n)
    .sort((a, b) => b.p - a.p).slice(0, limit);
}
export function peaksIn(bbox) {
  return world().peaks.filter(p => p.x >= bbox.w && p.x <= bbox.e && p.y >= bbox.s && p.y <= bbox.n);
}

/**
 * Muestrea el planeta en una rejilla equirectangular sobre `bbox`.
 * Devuelve mascaras de tierra, agua interior, cauces y clase de region fisica.
 */
export function sampleRegion(bbox, RW, RH) {
  const w = world();
  const land = new Uint8Array(RW * RH);
  fillRings(ringsIn(w.landIdx, bbox), bbox, RW, RH, land, 1);
  fillRings(ringsIn(w.lakesIdx, bbox), bbox, RW, RH, land, 0);      // los lagos recortan
  const river = new Uint8Array(RW * RH);
  strokeRings(ringsIn(w.riversIdx, bbox), bbox, RW, RH, river, 1);
  const cls = new Uint8Array(RW * RH);                              // 0 = sin clasificar
  for (let i = 0; i < w.relief.length; i++) {
    const rs = ringsIn(w.reliefIdx[i], bbox);
    if (rs.length) fillRings(rs, bbox, RW, RH, cls, i + 1);
  }
  return { land, river, cls, RW, RH, bbox };
}

/** Proporcion de tierra firme del rectangulo: sirve para descartar teatros. */
export function landFraction(bbox, res = 48) {
  const s = sampleRegion(bbox, res, Math.max(8, Math.round(res * (bbox.n - bbox.s) / (bbox.e - bbox.w))));
  let n = 0;
  for (let i = 0; i < s.land.length; i++) n += s.land[i];
  return n / s.land.length;
}
