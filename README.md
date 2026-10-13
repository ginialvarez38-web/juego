# Theatrum Belli

> Este repositorio contiene también **[Historia Mundi](historia/README.md)**, un
> sandbox de historia alternativa con IA al estilo de *Pax Historia*: eliges un
> país, escribes tus órdenes, negocias con los líderes del mundo y avanzas el
> tiempo. Se juega en `http://localhost:8080/historia/` (con `npm start`) o
> abriendo `dist/historia-mundi.html`.

Simulador de guerra a **nivel operacional** que se juega **sobre la Tierra**. Un
ejército completo —con su cadena de mando, su logística y su aviación— maniobra
en un teatro de 280 × 150 km recortado de la geografía real del planeta, y todo
se dibuja proyectado sobre la esfera: alejando la cámara el mismo tablero se
convierte en el globo terráqueo, y desde ahí puedes abrir un teatro nuevo en
cualquier punto de tierra firme con un clic.

El mapa no es un tablero decorativo — es el instrumento de trabajo: la línea de
contacto, los salientes, las bolsas, los cercos y las pinzas a punto de cerrarse
se calculan a partir del estado de la simulación y se dibujan curvados sobre el
terreno turno a turno.

```
npm start          # sirve el juego en http://localhost:8080
npm test           # prueba el modelo sin interfaz (ambos bandos automáticos)
npm run build      # empaqueta todo en dist/theatrum-belli.html, un único archivo
npm run geodata    # regenera src/geodata.js desde los archivos de Natural Earth
```

Los módulos son ES modules: hace falta servirlo por HTTP, no vale abrir el
`index.html` con `file://`. `serve.py` no tiene dependencias.

---

## Parte I — La investigación

Antes de programar nada hay que decidir *qué* se está modelando. Un juego de
guerra puede simular la puntería de un fusil, el fuego de un batallón o la
respiración de un ejército; son tres problemas distintos y las matemáticas que
sirven para uno no sirven para los otros. Este simulador trabaja en el **nivel
operacional** — el que une la táctica con la estrategia, el de las campañas —,
así que el resumen que sigue se centra en lo que decide una campaña.

### 1. El arte operacional y la batalla en profundidad

La teoría soviética de la **operación en profundidad** (*glubokaya operatsiya*),
formulada por Triandafíllov y Tujachevski en los años veinte y treinta, parte de
una observación incómoda: romper el frente no gana nada por sí solo. En 1916-1918
los ataques abrían brechas que se cerraban antes de poder explotarlas, porque el
defensor movía reservas por ferrocarril más rápido de lo que el atacante avanzaba
a pie sobre un campo destrozado por su propia preparación artillera.

La respuesta doctrinal fue atacar **simultáneamente en toda la profundidad** del
dispositivo enemigo: un primer escalón rompe el frente táctico, un segundo
escalón móvil e intacto pasa por la brecha y ataca reservas, cuarteles generales
y líneas de comunicaciones antes de que reaccionen. Lo que se destruye no es el
ejército contrario, sino su capacidad de funcionar como sistema.

De aquí salen tres exigencias que el simulador tiene que cumplir:

- **Escalonamiento.** Debe existir la diferencia entre una división que rompe y
  otra que explota, y la segunda debe llegar intacta al hueco.
- **Tiempo de reacción.** Si el defensor pudiera reaccionar instantáneamente, la
  profundidad no valdría nada. Hacen falta retardos de mando reales.
- **Retaguardia vulnerable.** Cortar comunicaciones tiene que doler más que matar
  soldados.

> Fuentes: [Deep operation (Wikipedia)](https://en.wikipedia.org/wiki/Deep_operation) ·
> [*Deep Operations: Theoretical Approaches to Fighting Deep*, Army University Press](https://www.armyupress.army.mil/Portals/7/combat-studies-institute/images/LSCO%20DeepOps%20book%20interactive%20with%20cover%20spread%2012Nov21.pdf)

### 2. Salientes, bolsas, cercos y pinzas

Estas cuatro palabras describen **geometría**, y la geometría del frente es
consecuencia, no causa: aparece sola cuando unas unidades avanzan más que otras.

- Un **saliente** es una porción del frente propio que sobresale dentro del
  dispositivo contrario. Su defecto es estructural: tiene más perímetro que
  fondo, hay que guarnecerlo con más tropa de la que rinde, y su base —el
  **cuello**— es más estrecha que su profundidad. Un saliente cuyo cuello mide
  menos que su fondo es una bolsa que todavía no ha ocurrido.
- Un **re-entrante** es lo mismo visto desde el otro lado.
- Una **pinza** (doble envolvimiento) es el ataque simultáneo contra los dos
  flancos de la base de un saliente. Si las puntas se juntan, lo que había dentro
  queda **cercado**.
- La palabra alemana para el resultado es **Kessel**, «caldera», y a la batalla
  correspondiente *Kesselschlacht*. El vocabulario es revelador: lo que ocurre
  dentro de una bolsa no es un combate, es una cocción lenta.

El caso canónico es Kursk, 1943: un saliente soviético de 150 km de profundidad
al que la Wehrmacht atacó por las dos bases. El caso contrario —una bolsa que
aguantó— es Demiansk, 1942, donde seis divisiones alemanas resistieron cercadas
porque un puente aéreo mantuvo abierta la única cosa que importaba: el
abastecimiento.

> Fuentes: [Salient (military)](https://en.wikipedia.org/wiki/Salient_(military)) ·
> [Salients, re-entrants and pockets](https://military-history.fandom.com/wiki/Salients,_re-entrants_and_pockets) ·
> [Pincer movement](https://en.wikipedia.org/wiki/Pincer_movement) ·
> [Cauldron of Death: the Demyansk Salient](https://warfarehistorynetwork.com/article/cauldron-of-death-the-demyansk-salient-and-the-eastern-front/)

### 3. Cómo se modela el combate: Lanchester y sus límites

Las **ecuaciones de Lanchester** (1916) son el punto de partida de casi toda la
modelización de desgaste. En su forma de *ley cuadrática*, aplicable al fuego
directo con adquisición de blancos, la potencia de una fuerza crece con el
cuadrado del número: doblar los efectivos cuadruplica la capacidad de destrucción.
En su forma *lineal*, aplicable al fuego de área y al combate antiguo, crece
proporcionalmente.

Su límite es conocido y grave: **no tienen espacio**. No hay terreno, ni flancos,
ni frente, ni tácticas; sólo dos números que se comen mutuamente. Aplicadas
directamente a un juego operacional producen resultados absurdos —el bando
ligeramente superior aniquila al otro sin bajas—, porque en la realidad un
defensor no se deja batir en campo abierto: se atrinchera, cede terreno, y limita
el frente por el que puede ser atacado.

Por eso este simulador usa Lanchester sólo como **forma** de la tasa de bajas, y
mete toda la sustancia en los multiplicadores: terreno, atrincheramiento,
apoyo de flancos, munición disponible, supresión, fatiga y moral.

> Fuentes: [*A Generalization of Lanchester's Model of Warfare*](https://arxiv.org/pdf/2112.06973) ·
> [*Lanchester Models for Irregular Warfare*, M. Kress (NPS)](https://faculty.nps.edu/mkress/docs/Lanchester_Models.pdf) ·
> [*Fractal Effects in Lanchester Models of Combat*](https://apps.dtic.mil/sti/tr/pdf/ADA523328.pdf)

### 4. La regla del 3:1, y por qué no se programa

La máxima de que el atacante necesita superioridad de 3:1 es la regla más citada
y peor entendida de la profesión. El estudio de RAND sobre agregación y
desagregación concluye que **la regla es válida a unos niveles de agregación y no
a otros**, y que su aplicabilidad depende de la relación entre las escalas de
tiempo de la información, la decisión, la maniobra y la duración del combate de
ruptura.

La decisión de diseño aquí es deliberada: **la regla del 3:1 no está programada
en ninguna parte**. Lo que hay es una función de éxito del asalto sobre la
relación de fuerzas efectiva:

```
P(éxito) = R^1.7 / (R^1.7 + 1)
```

que da 50 % a 1:1, 76 % a 2:1, 87 % a 3:1 y 95 % a 6:1. Como la relación *R* se
calcula después de aplicar los multiplicadores del defensor, atacar en llano
contra tropa sin fortificar exige alrededor de 3:1 en efectivos, y atacar una
posición urbana preparada exige más de 6:1. El umbral emerge; no se impone.

> Fuente: [*Aggregation, Disaggregation, and the 3:1 Rules in Ground Combat*, RAND](https://www.rand.org/pubs/monograph_reports/MR638.html)

### 5. Factores humanos: el trabajo de Dupuy

Trevor Dupuy construyó el **Quantified Judgement Model** sobre el análisis
cuantitativo de más de 600 combates terrestres entre 1600 y 1973. Su hallazgo
central para nuestro propósito es que los números y el material **no explican los
resultados**: entre un 20 % y un 50 % de la variación en la eficacia de combate
se atribuye a factores intangibles —moral, cohesión, liderazgo, instrucción,
sorpresa, historial reciente de la unidad—, agrupados en el *Combat Effectiveness
Value*.

Consecuencia de diseño: la potencia de una unidad no es su plantilla, sino su
plantilla multiplicada por un **índice de eficacia** que se degrada con las bajas
acumuladas, la fatiga, la falta de munición, la supresión y el aislamiento. Una
división al 70 % de efectivos pero descansada y abastecida vale más que una al
95 % exhausta y sin proyectiles.

> Fuentes: [*Human Factors In Warfare: Combat Effectiveness*, The Dupuy Institute](https://dupuyinstitute.org/2017/10/04/human-factors-in-warfare-combat-effectiveness/) ·
> [*Human Factors in Warfare: Quantifying Morale*](https://dupuyinstitute.org/2016/05/09/human-factors-in-warfare-quantifying-morale/) ·
> [*The Quantified Judgement Model and Historic Ground Combat* (DTIC)](https://apps.dtic.mil/sti/tr/pdf/ADA201164.pdf)

### 6. Sostenimiento: alcance operacional y punto culminante

La doctrina de sostenimiento (ADP 4-0) define el **alcance operacional** como la
distancia y la duración a la que una fuerza puede emplear con éxito su capacidad
militar, y el **punto culminante** como el momento en que ya no puede continuar
la operación. El sostenimiento no acompaña a la maniobra: la **hace posible**, y
su agotamiento la detiene con independencia de lo bien que vaya el combate.

Esto es lo que convierte el cerco en una forma de destrucción y no en una
curiosidad cartográfica. Una unidad cercada no muere de fuego: muere porque su
traza de abastecimiento se ha cortado. Primero consume sus reservas de combate,
luego abandona el material pesado por falta de combustible, luego se queda sin
munición, y por último capitula.

> Fuentes: [ADP 4-0 *Sustainment*](https://irp.fas.org/doddir/army/adp4_0.pdf) ·
> [ADP 3-0 *Operations*](https://irp.fas.org/doddir/army/adp3_0.pdf) ·
> [Principles of sustainment](https://en.wikipedia.org/wiki/Principles_of_sustainment)

### 7. El terreno real como problema operacional

La razón de jugar sobre la Tierra y no sobre un continente inventado no es
estética. El terreno es el primer factor del problema operacional: decide por
dónde se puede atacar, cuánto frente hay que guarnecer, dónde se puede cortar
una línea de comunicaciones y qué obstáculos exigen una operación aparte para
cruzarlos. Un generador de mapas produce terreno *plausible*; la Tierra produce
terreno *con historia*, y esa historia se nota al jugar.

En la Gran Llanura húngara no hay dónde apoyar un flanco y las divisiones
acorazadas mandan. Cuarenta kilómetros al norte, en los Cárpatos, el mismo
ejército no cabe por los valles. En Normandía el bocage duplica el coste de cada
kilómetro y el mar cierra un flanco. En Kursk no hay un solo accidente natural
que detenga un envolvimiento — que es exactamente por lo que ocurrió allí lo que
ocurrió. Ninguna de esas situaciones hubo que diseñarlas: salen de los datos.

> Fuente cartográfica: [Natural Earth](https://www.naturalearthdata.com/) 1.4 (dominio público),
> vía [martynafford/natural-earth-geojson](https://github.com/martynafford/natural-earth-geojson).

---

## Parte II — Cómo se traduce todo eso a código

| Concepto doctrinal | Dónde vive | Cómo funciona |
|---|---|---|
| Potencia de combate = masa × calidad × factores humanos | `sim.js: rawPower`, `readiness` | Personal y material dan la masa; moral, cohesión, fatiga, supresión, munición, combustible y experiencia dan un multiplicador de 0,02 a ~1,4 |
| Umbral 3:1 emergente | `sim.js: resolveAssault` | Sigmoide `R^1.7/(R^1.7+1)` sobre la relación **después** de los multiplicadores del defensor |
| Ventaja defensiva del terreno | `terrain.js`, `sim.js: combatPower` | Multiplicadores separados de defensa y de **frente utilizable**: la montaña no sólo defiende mejor, es que sólo cabe atacar por un sitio |
| Atrincheramiento | `sim.js: moralePhase` | Crece si la unidad no se mueve, más rápido con ingenieros cerca, con un techo que fija el terreno; se pierde al maniobrar |
| Zonas de control | `sim.js: computeZOC`, `findPath` | Entrar en una ZDC contraria detiene la marcha; **pasar de una ZDC a otra está prohibido**. Sin esta regla los ejércitos se atraviesan y no llega a formarse frente |
| Alcance operacional y punto culminante | `sim.js: computeSupply` | Dijkstra multiorigen desde las bases de teatro. El ferrocarril cuesta 0,30 por hexágono, la carretera 0,60, el campo a través 2,4 × dificultad. El presupuesto es el alcance; agotarlo es culminar |
| El cerco mata por logística | `sim.js: supplyPhase`, `moralePhase` | Sin traza: se consumen reservas → se abandona material por falta de combustible → se agota la munición → se capitula |
| Sin vía de repliegue | `sim.js: retreatHex` | Un defensor desalojado que no encuentra hexágono libre sufre **bajas dobles**. Es la mecánica que convierte una pinza cerrada en una bolsa |
| Escalonamiento y explotación | `sim.js: exploitationPhase` | Tras una ruptura, las unidades móviles cercanas reciben movimiento adicional según su índice de explotación y la doctrina del ejército |
| Retardo de mando | `orders.js: c2Delay` | La orden tarda en llegar según la distancia al CG, su radio de mando y la doctrina. Un CG destruido cuesta dos turnos por orden |
| Fuegos indirectos | `sim.js: artillerySupport` | Cuatro misiones: apoyo, preparación, contrabatería e interdicción, cada una con su efecto y su consumo |
| Aviación | `sim.js: airPhase` | Reparto de salidas entre superioridad, apoyo cercano, interdicción y reconocimiento. La interdicción **encarece la traza logística enemiga**: se puede asfixiar una bolsa sin asaltarla |
| Niebla de guerra | `sim.js: computeDetection` | Detección por proximidad, calidad de reconocimiento, cobertura del terreno, meteorología y hora. Lo no detectado no cuenta en la relación de fuerzas |
| Meteorología y estado del suelo | `terrain.js`, `sim.js: advanceClock` | Cadena de Markov con inercia; el barro es un factor operacional de primer orden |

### La Tierra (`geodata.js`, `world.js`, `raster.js`, `worldgen.js`)

El planeta entero viaja dentro del juego en **703 KB**. `tools/extract-geo.py`
toma los archivos de Natural Earth y los deja en `src/geodata.js` con una
codificación compacta: las coordenadas se cuantifican a una centésima de grado,
se recorren en cadena guardando solo la diferencia con el punto anterior, y cada
diferencia se escribe en varint de 5 bits sobre un alfabeto de 64 caracteres.
La línea de costa mundial pasa así de 2,7 MB de JSON a 109 KB de texto.

| Conjunto | Contenido | Tamaño |
|---|---|---|
| `LAND_GLOBE` | silueta de los continentes para el globo | 10 KB |
| `LAND_FINE` | costas de detalle (Natural Earth 50 m) | 109 KB |
| `LAKES` / `RIVERS` | lagos y cursos de agua (10 m) | 25 + 116 KB |
| `RELIEF` | regiones físicas reales por clase: cordillera, meseta, llanura, desierto, cuenca, humedal… | 42 KB |
| `CITIES` | 5.763 núcleos con nombre, población y país | 365 KB |
| `PEAKS` | 711 cumbres con su cota | 34 KB |

Al abrir un teatro, `worldgen.js` recorta el rectángulo correspondiente y deduce
de él todo lo que el motor necesita:

- **Mar y costa** rasterizando los polígonos de tierra con la regla par‑impar, de
  modo que los anillos interiores recortan a los que los contienen y los mares
  interiores salen bien. El rasterizador es propio (`raster.js`) y no usa el
  lienzo del navegador a propósito: así el mismo código genera un teatro dentro
  de la página y en la prueba sin interfaz.
- **Relieve** a partir de la clase de región física real —una cota base por
  cordillera, meseta o llanura—, elevada alrededor de las cumbres con cota
  conocida y detallada por debajo de la resolución del dato con ruido fractal.
- **Vegetación** por un modelo climático de latitud (convergencia ecuatorial,
  cinturón desértico hacia los 25°, franja templada húmeda, desecación polar)
  corregido por la cercanía de cauces reales y del mar. Es esa corrección la que
  impide que la llanura del Ganges salga desierto por estar en el paralelo del
  Sáhara.
- **Cauces** trazados sobre las aristas de la retícula siguiendo la geometría
  real de los ríos, con puentes donde una calzada los cruza.
- **Ciudades** con su nombre y su valor operacional según población y capitalidad.
- **Carreteras y ferrocarril** — lo único inventado — uniendo los núcleos reales
  por el camino de menor coste sobre el terreno real.

### La cámara esférica (`geo.js`, `render.js`)

Cada hexágono tiene longitud y latitud reales. Todo lo que se dibuja pasa por
`Camera.project()`, que lleva un punto de la esfera a la pantalla en
perspectiva, y por `onNearSide()`, que descarta lo que queda tras el horizonte.
La consecuencia es que no hay dos motores de dibujo: el mismo código que pinta
un hexágono pinta el frente, el contorno de una bolsa y las flechas de una
pinza, y todos se curvan con el planeta. Alejando la cámara, la retícula se
apaga y queda el globo con el teatro señalado sobre la geografía real.

### El análisis del mapa (`analysis.js`)

Todo lo que se rotula sobre el mapa sale de dos campos calculados cada turno:

1. **Campo de control.** Difusión de distancia ponderada: cada bando propaga
   alcance desde sus unidades y sus bases; recorrer terreno difícil cuesta más y
   penetrar en la ZDC contraria cuesta bastante más. Cada hexágono es de quien
   llega antes. El resultado son regiones **contiguas**, que es como se pinta un
   frente en un calco de verdad.
2. **Campo logístico**, el de `computeSupply`.

Y de su intersección salen las formas:

- **Bolsa / cerco** — componente conexa de territorio propio que no contiene
  ninguna base y cuya traza máxima está por debajo del 12 %. Si además está por
  debajo del 2 %, está **sellada**; si no, tiene corredor. Se informa de las
  unidades dentro, los efectivos, el área y los turnos que llevan aislados.
- **Saliente** — se calcula el *grado de envolvimiento* de cada hexágono (qué
  proporción de su entorno a tres hexágonos es enemiga) y se agrupan los que
  superan 0,40. Los hexágonos del grupo que enlazan con el cuerpo principal del
  frente son el **cuello**; la distancia máxima a ellos es la **profundidad**. Si
  el cuello es más estrecho que la profundidad, el saliente se marca como
  **vulnerable**.
- **Pinza** — dos salientes propios cuyas puntas están a menos de 12 hexágonos y
  con dispositivo enemigo en medio. Aquí está la parte interesante: **se simula
  el cierre**. Se marca la línea entre las puntas como propia, se rehace la
  conectividad enemiga hacia sus bases, y se cuenta qué quedaría aislado. Por eso
  el panel puede decir *«al cerrar: 49.736 hombres y 4 unidades en la bolsa»*
  antes de que hayas cerrado nada.
- **Brecha** — tramo de la línea de contacto sin tropas propias a menos de 10 km.

### El mando automático (`ai.js`)

El adversario no juega hexágono a hexágono. Cada turno:

1. Evalúa la relación de fuerzas y decide ofensiva, contención o defensiva.
2. Ordena la ruptura del cerco a lo que tenga embolsado, y manda socorro desde fuera.
3. Busca salientes contrarios vulnerables y aplica fuerza **a los dos hombros del
   cuello** — es decir, forma una pinza.
4. Si ya tiene una pinza abierta, concentra las unidades más móviles sobre la brecha.
5. Elige uno o dos *Schwerpunkt* donde la densidad defensiva contraria es mínima
   y el terreno permite atacar, y los ataca en dos escalones, con la artillería
   en misión de preparación.
6. Tapona sus propias brechas con reservas.
7. Respeta una **fuerza de cobertura**: una unidad en contacto que es la única
   propia en su sector puede combatir donde está, pero no la retira para
   concentrarla en otro sitio.

---

## Parte III — Cómo se juega

Mandas el **1.er Ejército azul**, tres cuerpos y una reserva de ejército, frente
al 4.º Ejército rojo en defensa preparada. Cada turno son seis horas. Los dos
bandos son fuerzas de maniobra abstractas —azul y rojo, como en cualquier
ejercicio de estado mayor— sobre terreno real: el juego no representa a países
ni a ejércitos concretos.

- **Clic** sobre una ficha para asumir su mando. **Clic derecho** sobre el mapa
  para ordenarle marchar; si el hexágono es enemigo y contiguo, la orden será de
  ataque. **Espacio** salta a la siguiente unidad sin órdenes, **intro** ejecuta
  el turno.
- **Arrastrar** desplaza la cámara sobre la superficie, **la rueda** sube y baja,
  **Mayús + arrastrar** inclina y gira el punto de vista.
- **G** aleja hasta ver el planeta entero; desde ahí, un clic sobre cualquier
  tierra firme abre un teatro nuevo allí, generado de su geografía real. **T**
  devuelve al teatro actual.
- Las órdenes **tardan en llegar**. El panel te dice cuántos turnos.

De cada unidad se controla: postura táctica (ocho, de asalto deliberado a
retirada), intensidad de esfuerzo, fuerza retenida en reserva, prioridad
logística, misión de fuegos si tiene artillería, reglas de enfrentamiento
(umbrales de bajas y de moral para romper contacto), autorización de repliegue y
orden de fortificar.

Del ejército se controla: doctrina (batalla en profundidad, guerra relámpago,
desgaste metódico, defensa elástica), reparto de las salidas de aviación entre
sus cuatro misiones y esfuerzo de transporte hacia vanguardia, que amplía el
alcance operacional a costa del depósito de teatro.

Las capas del mapa —control territorial, línea de frente, red de abastecimiento,
bolsas, salientes, pinzas, vectores de avance, mapa de amenaza, niebla de
guerra— se activan por separado en el panel de la izquierda.

### Tres cosas que deciden la campaña

1. **Nada mata como cortar la traza.** Antes de asaltar una posición, mira si
   puedes cortarle la carretera por detrás.
2. **Vigila tus propios salientes.** El panel te avisa cuando el cuello es más
   estrecho que la profundidad. Si el mando rojo lo ve antes que tú, atacará los
   dos hombros a la vez.
3. **El punto culminante existe.** Una ofensiva que se aleja de su cabeza de
   ferrocarril se detiene sola, aunque esté ganando todos los combates. Adelanta
   las brigadas logísticas o para a consolidar.

---

## Estructura

```
index.html            interfaz
css/style.css
build.js              empaquetado a un único archivo autocontenido
tools/extract-geo.py  genera src/geodata.js desde Natural Earth
src/hex.js            topología hexagonal: vecinos, distancias, trazados
src/geo.js            esfera terrestre, cámara en perspectiva y encaje del teatro
src/geodata.js        geometría real del planeta, codificada (generado)
src/raster.js         rasterizador propio de polígonos y polilíneas geográficas
src/world.js          acceso a la geografía ya decodificada
src/worldgen.js       recorte del teatro: mar, relieve, clima, cauces, ciudades, carreteras
src/heap.js           montículo binario para Dijkstra y A*
src/rng.js            PRNG determinista y ruido fractal
src/terrain.js        terrenos, meteorología, estado del suelo
src/units.js          plantillas de unidad, posturas, doctrinas, orden de batalla
src/orders.js         emisión de órdenes y retardo de la cadena de mando
src/sim.js            motor: potencia de combate, ZDC, movimiento, logística, combate, moral, turno
src/analysis.js       control del terreno, frente, bolsas, salientes, pinzas, brechas
src/ai.js             mando automático operacional
src/render.js         dibujo sobre la esfera y todas las capas
src/ui.js             paneles de mando
src/scenario.js       escenario y estado inicial
src/main.js           arranque, cámara, entrada, bucle
test/selftest.js      prueba del modelo sin interfaz
```

Parámetros de depuración en la URL: `?lon=` y `?lat=` abren el teatro en un
punto concreto, `?seed=N` fija la semilla, `?auto=N` resuelve N turnos con las
dos partes automáticas, `?alt=` y `?tilt=` colocan la cámara, `?brief=0` omite
la orden de operaciones inicial.
