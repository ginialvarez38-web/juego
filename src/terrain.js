// Definicion de terrenos. Los valores siguen la logica de los manuales de campana:
// el terreno multiplica la potencia defensiva, limita el frente utilizable por el
// atacante (canalizacion), fija el atrincheramiento maximo alcanzable y determina
// el coste de movimiento y la distancia de observacion.
export const TERRAIN = {
  llanura:   { name: 'Llanura',        move: 1.0, def: 1.00, atkFront: 1.00, entrenchMax: 4, sight: 4, cover: 0.05, color: '#5f6b46' },
  cultivo:   { name: 'Campo cultivado',move: 1.1, def: 1.05, atkFront: 0.95, entrenchMax: 4, sight: 4, cover: 0.10, color: '#6e763f' },
  bocage:    { name: 'Bocage',         move: 1.9, def: 1.55, atkFront: 0.55, entrenchMax: 5, sight: 2, cover: 0.40, color: '#4d6438' },
  bosque:    { name: 'Bosque',         move: 1.8, def: 1.40, atkFront: 0.60, entrenchMax: 5, sight: 2, cover: 0.45, color: '#37502f' },
  colinas:   { name: 'Colinas',        move: 1.5, def: 1.35, atkFront: 0.75, entrenchMax: 5, sight: 6, cover: 0.25, color: '#6d6449' },
  montana:   { name: 'Montaña',        move: 2.6, def: 1.90, atkFront: 0.40, entrenchMax: 6, sight: 7, cover: 0.35, color: '#7b7367' },
  pantano:   { name: 'Marisma',        move: 2.8, def: 1.15, atkFront: 0.35, entrenchMax: 1, sight: 3, cover: 0.15, color: '#3f5450' },
  urbano:    { name: 'Zona urbana',    move: 1.6, def: 1.85, atkFront: 0.50, entrenchMax: 6, sight: 2, cover: 0.55, color: '#6a6a70' },
  industrial:{ name: 'Complejo industrial', move: 1.7, def: 2.00, atkFront: 0.45, entrenchMax: 6, sight: 2, cover: 0.60, color: '#5c5a5f' },
  agua:      { name: 'Lago',           move: 99,  def: 1.00, atkFront: 0.00, entrenchMax: 0, sight: 5, cover: 0.00, color: '#26404f' },
};

export const WEATHER = {
  despejado: { name: 'Despejado',   move: 1.00, sight: 1.00, air: 1.00, supply: 1.00 },
  nublado:   { name: 'Nublado',     move: 1.00, sight: 0.85, air: 0.60, supply: 1.00 },
  lluvia:    { name: 'Lluvia',      move: 1.25, sight: 0.65, air: 0.30, supply: 0.90 },
  tormenta:  { name: 'Temporal',    move: 1.55, sight: 0.45, air: 0.05, supply: 0.75 },
  niebla:    { name: 'Niebla',      move: 1.10, sight: 0.30, air: 0.10, supply: 0.95 },
  nieve:     { name: 'Nieve',       move: 1.60, sight: 0.55, air: 0.25, supply: 0.70 },
};

// Estado del suelo: la "rasputitsa" es un factor operacional de primer orden.
export const GROUND = {
  firme:  { name: 'Firme',    move: 1.00, offroad: 1.00 },
  humedo: { name: 'Húmedo',   move: 1.15, offroad: 1.30 },
  barro:  { name: 'Barro',    move: 1.45, offroad: 2.10 },
  helado: { name: 'Helado',   move: 0.95, offroad: 0.90 },
};
