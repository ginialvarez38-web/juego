#!/usr/bin/env python3
"""
Extrae la geometria real del planeta (Natural Earth) y la deja en src/geodata.js
en un formato compacto.

La codificacion es la misma para todos los conjuntos: las coordenadas se
cuantifican a una fraccion de grado, se recorren en cadena guardando solo la
diferencia con el punto anterior, y cada diferencia se escribe en varint de 5
bits sobre un alfabeto de 64 caracteres. Un contorno de costa mundial cabe asi
en unas decenas de kilobytes en vez de varios megabytes de JSON.

Fuente: Natural Earth (dominio publico), via martynafford/natural-earth-geojson.
"""
import json, os, sys

NE = sys.argv[1] if len(sys.argv) > 1 else '/workspace/martynafford/natural-earth-geojson'
OUT = 'src/geodata.js'
A64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'


# ── codificacion ──────────────────────────────────────────────────────────
class Writer:
    def __init__(self):
        self.buf = []

    def num(self, v):                      # zigzag + varint de 5 bits
        u = (v << 1) ^ (v >> 63) if v < 0 else (v << 1)
        while True:
            c = u & 31
            u >>= 5
            self.buf.append(A64[c | (32 if u else 0)])
            if not u:
                break

    def __str__(self):
        return ''.join(self.buf)


def dp(pts, eps):
    """Douglas-Peucker: quita los vertices que no cambian la forma."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        ax, ay = pts[a]; bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        den = dx * dx + dy * dy
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            if den == 0:
                d = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / den))
                d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if d > best:
                best, bi = d, i
        if best > eps * eps:
            keep[bi] = True
            stack.append((a, bi)); stack.append((bi, b))
    return [p for p, k in zip(pts, keep) if k]


def rings_of(geom, want_lines=False):
    if geom is None:
        return []
    t, c = geom['type'], geom['coordinates']
    if t == 'Polygon':
        return c
    if t == 'MultiPolygon':
        return [r for poly in c for r in poly]
    if t == 'LineString':
        return [c]
    if t == 'MultiLineString':
        return c
    return []


def bbox_span(ring):
    xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
    return max(xs) - min(xs), max(ys) - min(ys)


def encode(rings, scale, eps, min_span=0.0):
    """Devuelve (cadena, n_anillos, n_puntos)."""
    w = Writer()
    out = []
    for r in rings:
        r = [(p[0], p[1]) for p in r if p and len(p) >= 2]
        if len(r) < 2:
            continue
        if min_span:
            sx, sy = bbox_span(r)
            if max(sx, sy) < min_span:
                continue
        r = dp(r, eps)
        q, prev = [], None
        for x, y in r:
            qx, qy = round(x * scale), round(y * scale)
            if prev == (qx, qy):
                continue
            q.append((qx, qy)); prev = (qx, qy)
        if len(q) >= 2:
            out.append(q)
    w.num(len(out))
    cx = cy = 0
    npts = 0
    for q in out:
        w.num(len(q))
        for qx, qy in q:
            w.num(qx - cx); w.num(qy - cy)
            cx, cy = qx, qy
            npts += 1
    return str(w), len(out), npts


def load(path):
    with open(os.path.join(NE, path)) as f:
        return json.load(f)


def report(name, s, nr, np_):
    print(f'  {name:<10} {len(s)/1024:7.1f} KB   {nr:>5} trazos  {np_:>7} puntos')
    return s


print('Extrayendo geometria real del planeta…')
blobs = {}

# ── 1. silueta del globo (poca resolucion, se ve entera de golpe) ──────────
d = load('110m/physical/ne_110m_land.json')
rings = [r for f in d['features'] for r in rings_of(f['geometry'])]
blobs['LAND_GLOBE'] = report('globo', *encode(rings, 20, 0.12, min_span=1.2))

# ── 2. costas de detalle (rasterizadas por teatro en el navegador) ─────────
d = load('50m/physical/ne_50m_land.json')
rings = [r for f in d['features'] for r in rings_of(f['geometry'])]
blobs['LAND_FINE'] = report('costas', *encode(rings, 100, 0.012, min_span=0.10))

# ── 3. lagos y rios ───────────────────────────────────────────────────────
d = load('50m/physical/ne_50m_lakes.json')
rings = [r for f in d['features'] for r in rings_of(f['geometry'])]
blobs['LAKES'] = report('lagos', *encode(rings, 100, 0.012, min_span=0.14))

d = load('10m/physical/ne_10m_rivers_lake_centerlines.json')
rings = []
for f in d['features']:
    rings += rings_of(f['geometry'])
blobs['RIVERS'] = report('rios', *encode(rings, 100, 0.02))

# ── 4. regiones fisicas reales: de aqui sale el relieve del teatro ────────
CLASSES = ['Range/mtn', 'Plateau', 'Foothills', 'Plain', 'Lowland',
           'Desert', 'Basin', 'Depression', 'Valley', 'Delta', 'Wetlands', 'Tundra']
d = load('10m/physical/ne_10m_geography_regions_polys.json')
per_class = {c: [] for c in CLASSES}
for f in d['features']:
    fc = f['properties'].get('featurecla')
    if fc in per_class:
        per_class[fc] += rings_of(f['geometry'])
parts, tot_r, tot_p = [], 0, 0
for c in CLASSES:
    s, nr, np_ = encode(per_class[c], 50, 0.03, min_span=0.25)
    parts.append(s); tot_r += nr; tot_p += np_
blobs['RELIEF'] = report('relieve', '~'.join(parts), tot_r, tot_p)

# ── 5. ciudades reales con su nombre ──────────────────────────────────────
# El pais se guarda en una tabla aparte y las ciudades lo referencian por
# indice: repetir «Federacion Rusa» seis mil veces costaria mas que la geometria.
d = load('10m/cultural/ne_10m_populated_places_simple.json')
countries, cidx = [], {}
cities = []
for f in d['features']:
    p = f['properties']
    g = f['geometry']
    if not g or g['type'] != 'Point':
        continue
    pop = int(p.get('pop_max') or 0)
    if pop < 15000:
        continue
    cn = p.get('adm0name') or ''
    if cn not in cidx:
        cidx[cn] = len(countries); countries.append(cn)
    cities.append({
        'n': p.get('name') or '?',
        'x': round(g['coordinates'][0], 3), 'y': round(g['coordinates'][1], 3),
        'p': pop, 'c': cidx[cn],
        'cap': 1 if int(p.get('adm0cap') or 0) else 0,
    })
cities.sort(key=lambda c: -c['p'])
cities_json = json.dumps(cities, ensure_ascii=False, separators=(',', ':'))
countries_json = json.dumps(countries, ensure_ascii=False, separators=(',', ':'))
print(f'  {"ciudades":<10} {(len(cities_json)+len(countries_json))/1024:7.1f} KB   {len(cities):>5} nucleos'
      f'  ({len(countries)} paises)')

# ── 6. cumbres con cota: fijan la amplitud del relieve ────────────────────
peaks = []
for res in ('10m', '50m'):
    path = f'{res}/physical/ne_{res}_geography_regions_elevation_points.json'
    if not os.path.exists(os.path.join(NE, path)):
        continue
    for f in load(path)['features']:
        g = f['geometry']; p = f['properties']
        if not g or g['type'] != 'Point':
            continue
        el = p.get('elevation') or p.get('ELEVATION') or 0
        if not el:
            continue
        peaks.append({'n': p.get('name') or '', 'x': round(g['coordinates'][0], 2),
                      'y': round(g['coordinates'][1], 2), 'e': int(el)})
    break
peaks_json = json.dumps(peaks, ensure_ascii=False, separators=(',', ':'))
print(f'  {"cumbres":<10} {len(peaks_json)/1024:7.1f} KB   {len(peaks):>5} cotas')

# ── salida ────────────────────────────────────────────────────────────────
lines = ['''// Geometria real del planeta, generada por tools/extract-geo.py.
// Fuente: Natural Earth 1.4 (dominio publico).
//
// Formato: coordenadas cuantificadas a una fraccion de grado, recorridas en
// cadena guardando la diferencia con el punto anterior, en varint de 5 bits
// sobre un alfabeto de 64 caracteres. decodeRings() lo devuelve a grados.

const A64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const IDX = (() => { const m = new Int8Array(128).fill(-1); for (let i = 0; i < 64; i++) m[A64.charCodeAt(i)] = i; return m; })();

/** Devuelve un array de trazos, cada uno Float32Array [lon,lat,lon,lat,...]. */
export function decodeRings(str, scale) {
  let p = 0;
  const num = () => {
    let u = 0, sh = 0, c;
    do { c = IDX[str.charCodeAt(p++)]; u |= (c & 31) << sh; sh += 5; } while (c & 32);
    return (u & 1) ? ~(u >>> 1) : (u >>> 1);
  };
  const n = num(), out = new Array(n);
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) {
    const m = num(), a = new Float32Array(m * 2);
    for (let k = 0; k < m; k++) {
      cx += num(); cy += num();
      a[k * 2] = cx / scale; a[k * 2 + 1] = cy / scale;
    }
    out[i] = a;
  }
  return out;
}

export const RELIEF_CLASSES = ''' + json.dumps(CLASSES) + ''';
export const SCALE_GLOBE = 20, SCALE_FINE = 100, SCALE_RELIEF = 50;
''']

for k, v in blobs.items():
    if k == 'RELIEF':
        lines.append(f"\nexport const {k} = {json.dumps(v.split('~'))};\n")
    else:
        lines.append(f"\nexport const {k} = {json.dumps(v)};\n")
lines.append(f'\nexport const COUNTRIES = {countries_json};\n')
lines.append(f'\nexport const CITIES = {cities_json};\n')
lines.append(f'\nexport const PEAKS = {peaks_json};\n')

os.makedirs('src', exist_ok=True)
with open(OUT, 'w') as f:
    f.write(''.join(lines))
print(f'\n{OUT} — {os.path.getsize(OUT)/1024:.0f} KB')
