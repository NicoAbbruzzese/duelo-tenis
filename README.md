# Duelo Tenis

Tenis arcade **1 contra 1 online** que corre en el navegador: uno juega desde el celular (mando táctil con cruceta y 4 botones) y el otro desde la PC (teclado o mando). Solo tiene modo jugador contra jugador.

Es un juego original: física, reglas, gráficos 3D y sonido están hechos desde cero para este proyecto. No usa ni copia material de ningún juego comercial.

## Cómo jugar

1. Los dos abren la página del juego (la dirección de GitHub Pages del repositorio).
2. Uno toca **Crear sala** y le pasa al otro el enlace (botón *Compartir enlace*) o el código de 4 letras.
3. El otro abre el enlace y toca **Entrar a la sala**.
4. El que creó la sala elige duración y cancha y toca **¡Jugar!**

En Android conviene abrirlo con Chrome. Se juega con el teléfono en horizontal y pantalla completa (el juego lo pide solo). Opcional: menú de Chrome → *Agregar a la pantalla principal* para tenerlo como una app.

### Controles

| | Celular | PC |
|---|---|---|
| Mover / apuntar | Cruceta | `W A S D` o flechas |
| Golpe liftado | **GOLPE** | `J` (o `Z`, `Espacio`) |
| Cortado (bajo y lento) | **CORTADO** | `K` (o `X`) |
| Globo | **GLOBO** | `L` (o `C`) |
| Dejada | **DEJADA** | `I` (o `V`) |
| Pausa | botón ❚❚ | `Esc` |

También funciona un mando conectado a la PC (cruceta + 4 botones).

- **Colócate y pulsa pronto.** Corre hasta donde viene la pelota y pulsa el botón antes de que llegue: el jugador le pega solo cuando la pelota llega. Cuanto antes te prepares, más fuerte y preciso sale (se llena el anillo bajo tus pies).
- **Apunta con la cruceta** mientras preparas: izquierda/derecha elige el lado, arriba tira profundo, abajo tira corto.
- **Saque:** pulsa un botón para lanzar la pelota y otra vez cuando la marca pase por el centro de la barra.
- Si la pelota queda lejos, el jugador se estira y devuelve flojo. Sube a la red para volear y rematar.

## Cómo se conectan

- **Conexión directa (WebRTC, con PeerJS):** es la normal. Sirve si están en la misma wifi o cada uno en su casa; los datos van directo de un dispositivo al otro.
- **Respaldo:** si la conexión directa no se logra (algunas redes móviles), el juego usa solo un canal alternativo por servidores MQTT públicos. Funciona, pero con más retraso; en pantalla aparece como *Respaldo (lenta)*.

El que crea la sala es el anfitrión: su dispositivo lleva el partido. Si al invitado se le corta la conexión o recarga la página, puede volver a entrar con el mismo código y el partido sigue donde estaba. Quien crea la sala responde unos milisegundos antes; para que sea parejo, túrnense.

## Desarrollo

No hay paso de compilación: son archivos estáticos.

```bash
npm start          # servidor local en http://localhost:8123 (muestra también la dirección para la misma wifi)
npm test           # reglas, física y partidos completos entre bots
node tests/proto.test.js    # empaquetado de red
node tests/netsim.test.js   # red simulada con retardo, variación y pérdida
```

`tests/dual.html` abre anfitrión e invitado en la misma ventana (con bots) para probar la red real.

| Archivo | Qué hace |
|---|---|
| `js/sim.js` | Simulación: física de la pelota, golpes, saque, reglas y marcador |
| `js/net.js`, `js/mqtt-lite.js` | Salas, conexión directa y respaldo |
| `js/proto.js`, `js/predict.js` | Estado por red, interpolación y predicción del jugador propio |
| `js/render.js`, `js/figure.js` | Cancha, estadio y jugadores en 3D |
| `js/input.js`, `js/audio.js`, `js/hud.js`, `js/main.js` | Controles, sonido, interfaz y programa principal |

## Créditos

- [three.js](https://threejs.org) (MIT) para el dibujo 3D.
- [PeerJS](https://peerjs.com) (MIT) para la conexión directa.

Las licencias de ambas bibliotecas están en `vendor/`.
