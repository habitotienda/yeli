# Yeli

Plataforma de streaming con cuentas, chat con stickers, seguidores, buscador, estudio tipo OBS y una
economía de monedas (**Yelis**) para apoyar a los streamers. Backend en Python (Flask + SQLite).

## Empezar (2 minutos)

```bash
pip install -r requirements.txt
python app.py            # usa Waitress, un servidor multihilo de verdad
```

Abre http://localhost:5000. La base de datos (`instance/yeli.db`) se crea y se actualiza sola.

> La cámara, el micrófono y la pantalla solo funcionan en `localhost` o con **HTTPS**.

Con esto ya funciona el **modo peer-to-peer (P2P)**: sirve para probar y para pocos espectadores.
Para que varias personas hagan directo a la vez y cada una tenga muchos espectadores, activa el servidor de medios.

## Publicarlo en Render (https://yeli.onrender.com)

1. Sube esta carpeta a un repositorio de GitHub.
2. En Render: **New → Blueprint**, elige el repositorio (usa `render.yaml`), o **New → Web Service** con
   *Build* `pip install -r requirements.txt` y *Start* `python app.py`. El **nombre del servicio** (`yeli`) decide la
   dirección `yeli.onrender.com`.
3. Variables: las del `render.yaml` (HTTPS, proxy, clave secreta generada). Pon tu usuario en `YELI_ADMINS`.
4. Abre `https://yeli.onrender.com`. Por ser HTTPS, la cámara y el micrófono funcionan también desde el celular.

Cosas que debes saber (Render, plan gratis):

- **Los datos se pierden.** El sistema de archivos del plan gratis es efímero: la base SQLite se borra en cada reinicio,
  redespliegue o cuando el servicio se duerme tras ~15 minutos sin visitas. Cuentas, Yelis y chats desaparecerían. Sirve para una demo
  (por eso `YELI_DEMO=1` muestra un aviso). Para conservar los datos: plan de pago con **disco persistente** (descomenta
  `disk` y `YELI_DB` en `render.yaml`), o una base de datos externa (no incluida: habría que portar las consultas a Postgres).
- **El primer acceso tras dormir tarda** (arranque en frío).
- **El servidor de medios (MediaMTX) no corre en Render**: necesita UDP, y un servicio web de Render se publica por HTTPS.
  Ejecútalo en otra máquina y pon su URL **https** en `YELI_MEDIA_URL`. Sin él, Yeli usa el modo P2P (sirve para pocos espectadores).
  Para que el P2P funcione tras redes estrictas, añade un servidor TURN con `YELI_ICE_SERVERS`.
- Esto lo preparé sin poder desplegarlo en Render desde mi entorno: los ajustes siguen su documentación, pero revisa el primer
  despliegue en los *Logs* y avísame si algo no cuadra.

---

## Por qué "no aguantaba": P2P contra servidor de medios

| | P2P (por defecto) | Servidor de medios (MediaMTX) |
|---|---|---|
| Quién envía el video a cada espectador | El navegador del streamer, **una codificación por espectador** | El servidor. El streamer sube **una sola vez** |
| Espectadores por directo | Unos pocos (límite `YELI_MAX_VIEWERS`, 25) | Miles (límite `YELI_MAX_VIEWERS_SFU`, 2000), según tu ancho de banda |
| Varios directos a la vez | Sí, pero cada PC sufre con sus espectadores | Sí, cada uno sube una vez |
| OBS | Cámara virtual de OBS | **Directo desde OBS (WHIP)** |
| Calidad que elige el espectador | Sí (720p a 240p) | No (reenvía un solo stream) |
| Peticiones al servidor de Yeli | Muchas (señalización cada ~0.7 s) | Pocas (un latido cada 4–6 s) |

Además, el servidor de Yeli ahora usa Waitress, cachea 2 s las listas públicas (Home, Explore) y los
clientes hacen mucho menos polling.

### Activar el servidor de medios (gratis)

[MediaMTX](https://github.com/bluenviron/mediamtx) es software libre (MIT), un solo programa, sin dependencias.

1. Descárgalo desde su página de *releases* (Windows, Mac o Linux), o usa Docker: `docker compose up -d`.
2. Ejecútalo con la configuración incluida: `mediamtx mediamtx/mediamtx.yml`.
   Esa configuración hace que MediaMTX le **pregunte a Yeli** (`/api/media/auth`) quién puede publicar:
   solo el dueño de cada canal, con su clave privada. Ver es público.
3. Arranca Yeli apuntando a él: `YELI_MEDIA_URL=http://localhost:8889 python app.py`
   (en Windows: `set YELI_MEDIA_URL=http://localhost:8889` y luego `python app.py`).
4. Abre el estudio: la barra de estado dirá **Media server** y *Go live* publicará con WHIP.

Para que gente fuera de tu red te vea: abre los puertos **8889/TCP** y **8189/UDP** (y TCP) de la máquina donde corre
MediaMTX, y pon su IP pública o dominio en `webrtcAdditionalHosts` y en `YELI_MEDIA_URL`. Si el sitio usa HTTPS,
MediaMTX también debe servirse por HTTPS. Alojarlo en un servidor remoto normalmente requiere una cuenta del
proveedor (suele pedir una persona adulta).

### Directo desde OBS

Con el servidor de medios activo, en el estudio abre **Settings → Connect OBS**. Verás la URL WHIP y tu clave privada.
En **OBS 30 o superior**: Ajustes → Emisión → Servicio **WHIP**, pega el servidor y la clave como *Bearer Token*.
Luego pulsa **Go live from OBS** en Yeli (deja esa pestaña abierta: es el latido que mantiene el canal en vivo)
y **Iniciar transmisión** en OBS. Si la clave se filtra, "Make a new key" invalida la anterior.

Sin servidor de medios, OBS funciona con **Start Virtual Camera** (aparece como cámara en el estudio).

### Alternativas alojadas (no integradas)

Servicios como LiveKit Cloud tienen plan gratuito, pero con límites bajos. Al buscarlo, su documentación indicaba
100 participantes simultáneos y 5,000 minutos-participante al mes (un directo de 1 hora con 10 espectadores gasta
unos 660) y piden cuenta y claves de API. Verifica las condiciones actuales antes de depender de uno.
Como Yeli usa WHIP/WHEP estándar, otro servidor compatible puede reemplazar a MediaMTX.

---

## Qué hace

- **Cuentas** con contraseña protegida, perfil (bio, avatar SVG o foto), seguidores y búsqueda con sugerencias.
- **Viewers únicos:** cuenta una vez por cuenta (los invitados, por una cookie), aunque abras 10 pestañas.
  La pestaña nueva reemplaza a la anterior, que muestra *"You're watching in another tab"*. El streamer no se cuenta a sí mismo.
- **Estudio tipo OBS:** escenas, fuentes (cámara, pantalla, imagen, texto) que se arrastran y redimensionan,
  mezclador de audio, estado en vivo (fps, kb/s reales, espectadores) y chat a la derecha.
  Se adapta a escritorio, tablet (paneles en cuadrícula) y móvil (pestañas, objetivos táctiles grandes).
- **Chat** con stickers: 12 gratis y 6 premium (cuestan Yelis y salen grandes y destacados).
- **Reproductor propio** con volumen, pantalla completa, picture-in-picture y calidad (en P2P).

## Mejoras, bot, alertas y chat

- **Wallet** (`#/wallet`) con pestañas: *Buy Yelis*, *Upgrades*, *Cash out* e *History*.
- **Mejoras** (puntos de 100 Yelis, pagados con Yelis comprados o ganados): **Ganancias** (tu parte sube del 50 % al 80 %),
  **Recomendación de la cuenta** (más veces en *Recommended*, incluso sin estar en vivo), **Insignia** (bronce, plata, oro) y
  **Color de nombre** (4 colores, luego 8, luego cualquiera). El bot y las alertas no tienen mejoras: son para todos.
- **Punto de mejora gratis:** si un espectador **con cuenta** se queda **una hora seguida** viendo tu directo, ganas 1 punto.
  Para que nadie se regale puntos: no cuenta tu propia cuenta ni tu misma red, la cuenta no puede ser nueva, cada espectador da
  1 punto por streamer al día y hay un tope de 3 al día (`YELI_FREE_POINTS_PER_DAY`). El estudio muestra la cuenta atrás y avisa al ganarlo.
- **Estudio:** además de cámara, pantalla, imagen y texto, hay dos fuentes nuevas:
  - **Chat:** dibuja el chat de tu canal dentro del directo (ancho, líneas, tamaño y fondo ajustables).
  - **Alerts:** muestra alertas de donaciones y seguidores con **texto, imagen y sonido** que tú eliges en el mismo editor
    (menú de fuentes → *Alerts* → *Edit alerts*). Imágenes: stickers incluidos o las tuyas (PNG, JPG, GIF, WebP hasta 60 KB). Sonidos:
    6 incluidos o los tuyos (MP3, OGG, WAV hasta 90 KB). El sonido sale mezclado en el audio del directo.
  - **Transiciones de escena** (corte, fundido, deslizar, zoom, cortina) con duración ajustable, en el panel *Scenes*.
- **Comando de voz** (`#/bot` → *Voice*): un espectador escribe `!say Hola a todos` y todos los que miran lo **escuchan**. Tú eliges
  el comando, quién puede usarlo, si **dice el nombre** ("bob dice: Hola a todos") o no, la plantilla, el idioma, el enfriamiento y el
  largo máximo. La voz la genera el navegador de cada espectador (pueden silenciarla) y también suena en el estudio; no va
  dentro del video. Las reglas del chat (palabras prohibidas, enlaces) también se aplican a lo que se lee.
- **Moderación** (`#/moderation`): **bans** (10 min, 1 h, 1 día, 7 días o permanente, con motivo y opción de borrar sus mensajes) y
  **moderadores** que eligen los streamers. Los moderadores ven botones de borrar, *10m* y *Ban* en el chat, pueden banear y desbanear,
  usan comandos "solo moderadores" y no les afectan las reglas del chat. Solo el streamer puede banear a un moderador.
- **Chat en ventana aparte:** botón de pop-out sobre el chat, o `#/popout/tunombre?overlay=1` como *Browser Source* de OBS.
- **Bot (YeliBot)** en `#/bot`: comandos propios con variables, permisos (todos, seguidores, moderadores, solo tú), enfriamiento,
  auto-publicación cada N minutos mientras estás en vivo, comandos incluidos (`!commands`, `!uptime`, `!followers`, `!viewers`,
  `!title`, `!dice`, `!coinflip`, `!8ball`, `!lurk`, `!hug`, `!so`, `!yelis`), modo lento, solo seguidores, bloqueo de enlaces, palabras
  prohibidas, filtro de mayúsculas, saludo a nuevos seguidores y agradecimiento de donaciones.
- **Menú de tu foto:** cabecera con tu cuenta, saldo de Yelis, secciones (cuenta, herramientas de creador, dinero), navegación con el
  teclado (flechas, Inicio, Fin, Esc) y, en móvil, una hoja desde abajo.

> Verificación: el backend de todo esto tiene 31 pruebas automáticas, y la interfaz se probó en Chromium con varias cuentas:
> menú de la foto con teclado, comando de voz (con y sin nombre), moderador que banea y desbanea, fuente de Chat dibujando mensajes,
> alertas (de prueba y por una donación real, con su sonido), transiciones, mejoras, color de nombre y el menú en móvil.
> Lo que **no** se pudo comprobar: que la voz suene de verdad (se verificó que el navegador recibe el texto a leer, no el audio),
> el punto gratis por una hora real (el backend se probó adelantando el reloj) y el despliegue en Render.

## Yelis: donaciones con monedas

1. Los espectadores **compran Yelis** (paquetes en la página *Wallet*).
2. Los **donan** a un canal (botón *Send Yelis*, o stickers premium). Aparece destacado en el chat.
3. El streamer los **cobra** pidiendo un cash-out. Solo se pueden cobrar los Yelis *recibidos*, nunca los comprados.
4. **Tú (dueño del sitio)** revisas la solicitud en `#/admin`, pagas por fuera (PayPal, transferencia…) y la marcas como pagada.

### Cómo ganas tú y cómo entran los impuestos

Quien compra paga un precio; el streamer cobra un valor menor por cada Yeli. La diferencia es tu margen:

```
precio pagado (impuesto incluido)
  - impuesto             → YELI_TAX_RATE (lo apartas para pagarlo)
  - comisión del cobro   → YELI_PROCESSOR_PCT + YELI_PROCESSOR_FIXED_CENTS (estimada)
  = neto
  - lo que se paga al streamer (50 a 80 centavos por cada 100 Yelis, según su mejora Ganancias)
  = tu margen
```

El streamer **empieza llevándose el 50 %** (50 centavos por cada 100 Yelis cobrados) y, con la mejora **Ganancias**,
llega hasta el **80 %**. Con los valores por defecto el margen por paquete es:

| Paquete | Precio | Sin impuesto (50 % / 80 %) | Con 21 % de IVA incluido (50 % / 80 %) |
|---|---|---|---|
| 100 Yelis | 1.49 | 0.63 / 0.33 | 0.37 / 0.07 |
| 500 | 6.99 | 3.92 / 2.42 | 2.71 / 1.21 |
| 1,000 | 12.99 | 7.18 / 4.18 | 4.93 / 1.93 |
| 5,000 | 59.99 | 32.35 / 17.35 | 21.94 / 6.94 |

La página **Admin** recalcula esto con tu configuración y marca en rojo cualquier paquete que pierda dinero.
Cada compra guarda precio, impuesto, comisión y neto; cada cash-out guarda valor, retención, comisión y neto.
Los streamers descargan un **estado de cuenta anual (CSV)** para su declaración.

Protecciones: los Yelis recibidos esperan 14 días antes de poder cobrarse (`YELI_PAYOUT_HOLD_DAYS`) para cubrir
reembolsos y contracargos; hay un mínimo de cobro; un cash-out a la vez; el saldo se descuenta de forma atómica.

### Importante: modo de pruebas y dinero real

Por defecto `YELI_PAYMENTS=sandbox`: **los Yelis son dinero de mentira**, comprar es gratis y no se puede cobrar nada real.
No conecté un procesador de pagos real, a propósito:

- No se puede probar de forma segura sin cuentas y claves reales.
- Los procesadores de pago normalmente exigen que el titular sea **mayor de edad** (revisa sus términos). Si eres menor,
  el camino habitual es que **un adulto de confianza** (madre, padre o tutor) abra y sea titular de la cuenta.
- Cobrar dinero y pagarlo a terceros tiene obligaciones fiscales y legales (impuestos sobre ventas y sobre ingresos,
  verificación de identidad, términos de uso, reembolsos). Esto no es asesoría legal ni fiscal: consulta a un contador.

Para conectar pagos reales, un adulto debe implementar el proveedor y llamar a `fulfil_purchase(db, id, user_id, ref)`
en `yeli/wallet.py` **solo después de verificar la firma del webhook del proveedor**. Nunca acredites Yelis por lo que
diga el navegador o una redirección. `fulfil_purchase` ya es idempotente (acredita una sola vez). Mientras no exista un
proveedor, poner otro modo desactiva las compras (devuelven 503).

---

## Variables de entorno

Todas son opcionales; hay una lista comentada en `.env.example`.

| Variable | Para qué |
|---|---|
| `YELI_MEDIA_URL` | Dirección de MediaMTX (WHIP/WHEP). Vacío = P2P |
| `YELI_ADMINS` | Usuarios que pueden abrir *Admin* (separados por comas) |
| `YELI_PAYMENTS`, `YELI_CURRENCY`, `YELI_TAX_RATE`, `YELI_PROCESSOR_*`, `YELI_PAYOUT_*`, `YELI_EARN_RATES`, `YELI_POINT_COST`, `YELI_PACKS` | Economía |
| `YELI_PROXY`, `YELI_DEMO`, `YELI_ALLOWED_HOSTS`, `HOST` | Hosting (Render) |
| `YELI_SECRET_KEY`, `YELI_HTTPS=1` | Sesiones |
| `YELI_DB`, `HOST`, `PORT`, `YELI_THREADS` | Base de datos y servidor |
| `YELI_MAX_VIEWERS`, `YELI_MAX_VIEWERS_SFU` | Límites de espectadores por directo |
| `YELI_ICE_SERVERS` | STUN/TURN (JSON). Detrás de NAT estrictos añade un TURN |
| `YELI_LIST_CACHE` | Segundos de caché de las listas públicas (2) |

## Estructura

```
app.py              lanzador (Waitress si está instalado)
yeli/
  __init__.py       create_app()
  config.py         ajustes y límites
  db.py             esquema SQLite y migraciones
  core.py           utilidades compartidas
  queries.py        canales, espectadores únicos, señalización
  accounts.py       registro, login, perfil, avatar
  channels.py       Home, Explore, búsqueda, seguir
  chat.py           chat y stickers
  wallet.py         Yelis, donaciones, cash-outs, estado de cuenta, admin
  streaming.py      ciclo del directo, miniaturas, señalización P2P
  media.py          servidor de medios: claves de stream y autenticación para MediaMTX
  economy.py        precios, impuestos, comisiones, stickers
  cache.py          caché corta de listas
  security.py       CSP y protección CSRF
mediamtx/           configuración de MediaMTX
templates/, static/ interfaz (JS por función: studio-core, studio-ui, broadcast, watch-sfu, wallet, chat…)
tests/              pruebas del backend
```

## Pruebas

```bash
python -m unittest discover tests     # 31 pruebas: cuentas, viewers únicos, Yelis, impuestos, cash-outs,
                                      # servidor de medios, varios streamers a la vez, migraciones…
```

Qué se verificó y qué no: además de esas pruebas, el flujo completo se probó en Chromium con varias cuentas
(compras, donaciones, stickers, cash-out y admin, estudio en móvil/tablet/escritorio, dos directos simultáneos
en P2P). El modo servidor de medios se probó con un **SFU simulado** que implementa WHIP/WHEP en el navegador,
no con MediaMTX real, que no se pudo instalar en ese entorno. Pruébalo con tu MediaMTX y avisa si algo no encaja.
Tampoco había Waitress instalado en ese entorno (las pruebas corrieron con el servidor de Flask); `app.py` lo usa en cuanto lo instalas.

## Notas de seguridad

- Las claves de stream son secretas; el webhook `/api/media/auth` solo acepta publicar con la clave correcta y limita los intentos fallidos.
- Los cash-outs guardan el destino de pago en la base de datos: protege el archivo y usa HTTPS.
- El contador de intentos de login y los límites por red son por proceso; detrás de un proxy configura `ProxyFix` para ver la IP real.
