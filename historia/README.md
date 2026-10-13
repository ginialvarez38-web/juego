# Historia Mundi

Sandbox de **historia alternativa** en el navegador, al estilo de *Pax Historia*:
eliges un país en un momento histórico, escribes con tus propias palabras lo que
hace tu gobierno, negocias cara a cara con los líderes del mundo y avanzas el
tiempo. Un director de juego —un modelo de lenguaje o, sin clave, un simulador
local— resuelve tus órdenes, mueve al resto de naciones, redacta las noticias y
redibuja las fronteras del mapa.

```
npm start                 # desde la raíz del repo: http://localhost:8080/historia/
npm run historia:test     # prueba del modelo sin interfaz
npm run historia:build    # empaqueta todo en dist/historia-mundi.html (un solo archivo)
```

`dist/historia-mundi.html` funciona abriéndolo directamente, sin servidor.

## Cómo se juega

1. **Elige un escenario**: *El mundo actual (2026)*, *La víspera de la tormenta
   (1936)* —con los imperios coloniales, Manchukuo, el Raj británico y las
   fronteras de entreguerras— o uno creado por ti.
2. **Elige tu país** haciendo clic en el mapa o en los destacados.
3. **Acciones**: escribe órdenes libres («Invadir Polonia por el corredor de
   Danzig», «Nacionalizar el petróleo», «Proclamar la República Federal de
   Iberia»…). Puedes encadenar varias por turno.
4. **Diplomacia**: conversación directa con cualquier jefe de Estado, en
   personaje. Lo que acordéis se aplica al avanzar.
5. **Avanzar**: salto de una semana a cinco años. Llega *La Crónica Mundial* con
   lo ocurrido; las provincias que cambian de manos parpadean y los puntos de
   colores marcan dónde pasó cada noticia.
6. **Noticias** guarda la crónica de toda la partida; **Nación** muestra
   cualquier país (líder, gobierno, guerras, bloques, aliados); los modos de mapa
   *Político*, *Diplomático* y *Alianzas* cambian la lectura del mapa.
7. **Rebobinar** deshace turnos; las partidas se guardan solas y se pueden
   exportar a un archivo.

### Crear escenarios

El editor parte de cualquier escenario y permite pintar provincias (una a una o
países enteros), usar el cuentagotas, fundar países nuevos con nombre, color,
líder y gobierno, fijar la fecha de inicio (también años antiguos o antes de
Cristo) y escribir el contexto que leerá el director de juego.

## El director de juego

En **Ajustes de IA** se elige el proveedor:

| Proveedor | Qué hace |
|---|---|
| Simulador local | Sin conexión. Interpreta las órdenes más comunes por palabras clave (guerra, paz, alianza, anexión, protectorado, independencia, reformas militares, económicas e internas, cambios de nombre), resuelve los frentes según población, territorio, aliados y esfuerzo militar, y hace que las potencias de cada época actúen por su cuenta. |
| Claude (Anthropic) | La experiencia completa. Por defecto `claude-opus-5-5`; también `claude-sonnet-5-5` (más rápido) o `claude-haiku-5-5` (más barato). |
| Compatible con OpenAI | OpenRouter, LM Studio, Ollama o cualquier servicio con `/chat/completions`. |

La clave se guarda solo en el `localStorage` del navegador y las peticiones van
directamente del equipo del jugador al proveedor.

El modelo recibe un resumen del mundo (Estados relevantes con líder, gobierno y
tamaño; guerras; bloques; las provincias del jugador y las limítrofes de sus
vecinos; la historia reciente), las órdenes y las negociaciones del turno, y
devuelve un JSON con la crónica y una lista de operaciones sobre el mapa:

```json
{"type":"conquer","attacker":"GER","defender":"POL","amount":"some","toward":"Varsovia"}
{"type":"new_country","name":"Estat Català","from":"ESP","around":"Barcelona","size":"few"}
{"type":"alliance","name":"Eje","members":["GER","ITA"]}
```

`game.js` aplica esas operaciones de forma tolerante: acepta nombres en lugar de
códigos, ciudades en español o en su forma internacional, cantidades en
palabras, y elige por sí mismo las provincias de un avance militar (un frente
contiguo que progresa hacia el objetivo). Si la respuesta no es JSON válido se
pide una vez más; si la IA falla, el turno puede resolverse con el simulador
local.

## El mapa

El repositorio no trae fronteras políticas, solo costas, lagos y ~5.800 ciudades
reales de Natural Earth con el país al que pertenecen. Con eso se construye todo
en el navegador en un par de segundos (`src/world.js`):

1. Se rasteriza la tierra firme en una rejilla de 0,1°.
2. Cada ciudad «crece» por tierra (Voronoi a pie: cruzar el mar cuesta siete
   veces más) y así se reparte el planeta entre países. Unas pocas correcciones a
   mano fijan lo que las ciudades no resuelven (Groenlandia, Alaska, el paralelo
   49, la Raya hispano-portuguesa, Kaliningrado).
3. Dentro de cada país se siembran provincias en sus ciudades principales, más
   densas donde hay más ciudades (Europa, la India) y con relleno en los vacíos
   (Sáhara, Siberia), hasta unas 1.800 provincias con nombre.
4. Las costuras entre provincias se convierten en polilíneas suavizadas.

El dibujo (`src/map.js`) usa Mercator con vuelta al mundo horizontal: el relleno
es una textura que solo se repinta cuando cambia algún dueño, recortada por la
costa vectorial; fronteras, costas y nombres son vectoriales. Los nombres de los
países se orientan según el eje mayor de su territorio.

## Archivos

| Archivo | Contenido |
|---|---|
| `src/world.js` | Generación de provincias, vecindades terrestres y marítimas, costuras |
| `src/countries.js` | Países actuales: códigos, nombres en español, colores |
| `src/scenarios.js` | Escenarios 2026 y 1936 (dueños, líderes, guerras, bloques, súbditos) |
| `src/game.js` | Estado de la partida, operaciones sobre el mapa, búsquedas, fechas, guardado |
| `src/ai.js` | Llamadas al modelo, prompts del director de juego y de los líderes |
| `src/offline.js` | Simulador local: órdenes, combates, mundo autónomo, diplomacia |
| `src/map.js` | Renderizado e interacción del mapa |
| `src/main.js` | Pantallas, panel lateral, turnos, editor, partidas guardadas |
| `src/exonyms.js` | Nombres en español de las ciudades más conocidas |

---

*Historia Mundi es un proyecto independiente inspirado en el género de los
sandbox de historia con IA; no está afiliado a Pax Historia ni usa nada de su
marca, su código o sus recursos.*
