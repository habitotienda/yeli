# Yeli

Plataforma de streaming con cuentas, chat con stickers, seguidores, buscador, estudio tipo OBS y una
economía de monedas (**Yelis**) para apoyar a los streamers. Backend en Python (Flask + Supabase/Postgres; SQLite solo para desarrollo).

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

### Supabase (base de datos)

1. En [supabase.com](https://supabase.com) crea un proyecto y guarda la contraseña de la base de datos.
2. **Connect → Transaction pooler** → copia la cadena (puerto `6543`) y pon tu contraseña. Es tu `DATABASE_URL`.
3. En Render: *Environment* → `DATABASE_URL` = esa cadena. Al arrancar, la app crea las tablas sola (también puedes pegar
   `supabase/schema.sql` en el *SQL Editor*; se puede correr varias veces). Las tablas quedan con *Row Level Security* activado y sin
   políticas: la app habla directo con la base y la API pública de Supabase (clave `anon`) no puede leer nada.
4. Para llevar los datos de una base SQLite vieja: `DATABASE_URL=... python scripts/sqlite_to_supabase.py instance/yeli.db`.

Sin `DATABASE_URL` la app usa un archivo SQLite local (desarrollo y tests: `python -m unittest discover tests`).

Cosas que debes saber (Render, plan gratis):

- **La base de datos está en Supabase**, así que cuentas, Yelis, chats, comentarios, portadas y proyectos del editor sobreviven a los
  reinicios. Lo que **sí se pierde** en el plan gratis son los **archivos de video** de los directos y ediciones guardados (se escriben en el
  disco del servidor, que es efímero): por eso `YELI_DEMO=1` muestra un aviso. Para conservarlos: plan de pago con **disco persistente**
  (descomenta `disk` y `YELI_VOD_DIR` en `render.yaml`).
- **El primer acceso tras dormir tarda** (arranque en frío).
- **El servidor de medios (MediaMTX) no corre en Render**: necesita UDP, y un servicio web de Render se publica por HTTPS.
  Ejecútalo en otra máquina y pon su URL **https** en `YELI_MEDIA_URL`. Sin él, Yeli usa el modo P2P (sirve para pocos espectadores).
  Para que el P2P funcione tras redes estrictas, añade un servidor TURN con `YELI_ICE_SERVERS`.
- Esto lo preparé sin poder desplegarlo en Render desde mi entorno: los ajustes siguen su documentación, pero revisa el primer
  despliegue en los *Logs* y avísame si algo no cuadra.

---

## Editor de video, proyectos y publicación

- **Proyectos guardados**: en el editor, *Guardar* (o Ctrl+S) guarda el proyecto en el servidor y luego se autoguarda. Se continúa desde
  **Clips → Proyectos**, incluso desde otro dispositivo. Los videos del dispositivo y la música no se guardan (hay que volver a añadirlos).
- **Regla del 70%**: un video editado debe tener al menos `YELI_EDIT_MIN_LIVE_PCT` % (70 por defecto) de material de tus directos. El
  medidor está en la barra superior y el servidor lo vuelve a calcular desde el proyecto guardado al exportar. Límite: `YELI_EDIT_MAX_PROJECTS` (20).
- **Sin descarga**: el editor ya no exporta archivos, y `/api/vod/<id>/video` solo responde a un `<video>` de la propia web
  (cabeceras `Sec-Fetch-*`). Es una barrera contra "guardar como" y copias fáciles; no impide grabar la pantalla.
- **Publicar**: requiere portada (subir imagen o elegir un fotograma), título, categoría y quién lo ve (público / seguidores).
- **Herramientas**: cortar inicio/fin, dividir, velocidad, volumen, 12 filtros, brillo/contraste/saturación/desenfoque/opacidad, rotar,
  espejo, zoom y mover, fundidos, formatos 16:9 · 9:16 · 1:1 · 4:5, fondo (negro, desenfocado, blanco, color), textos (fuentes,
  contorno, sombra, animación, arrastrar sobre la imagen), stickers, marca de agua, música del dispositivo, 1080p.

---

## Notificaciones (en la app y por correo)

La campana de la barra superior avisa de: nuevos seguidores, Yelis/stickers recibidos, comentarios, respuestas a tus comentarios y me gusta en tus videos, y
cuando un canal que sigues empieza un directo. En **Editar perfil → Notificaciones** cada persona elige, por tipo, si quiere
el aviso en la app y/o por correo (por defecto: todo en la app; correo solo para seguidores, Yelis y comentarios).

Los correos necesitan configurar el envío (ver `.env.example`): `YELI_PUBLIC_URL` y `YELI_MAIL_FROM`, más **una** de estas
opciones: `YELI_RESEND_API_KEY` (API por HTTPS, la opción para Render gratis, que bloquea SMTP) o `YELI_SMTP_HOST` (+ usuario y
clave). Sin eso la app sigue funcionando y solo llegan los avisos de la campana. Cada correo lleva enlace para darse de baja,
hay un tope de correos por persona y hora, y el botón *Enviarme un correo de prueba* sirve para comprobar la configuración.

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

## Estilo, animaciones y celular

- **Rebote al cambiar de sección:** al pasar de *Home* a *Explore* o *Following* la página entra con un rebote desde la derecha, y al volver
  entra desde la izquierda (el orden lo decide `SECTION_RANK` en `static/js/script.js`). Las tarjetas entran escalonadas, el icono de la
  sección activa "salta" y su marcador se desliza. Los diálogos y avisos también rebotan al abrirse. La animación **no se repite** con el
  refresco automático de las listas, y quien pide "reducir movimiento" en su sistema no ve ninguna.
- **Estilo:** una sola esquina pequeña (5 a 7 px) en tarjetas, botones, paneles y reproductor; avatares redondos. Encabezado con
  brillo, títulos con barra de acento, tarjetas que se elevan al pasar el cursor, botones con efecto al pulsar.
- **Celular** (hasta 700 px): búsqueda como icono que abre una barra a todo el ancho, "Go live" solo en la barra inferior (con zonas
  seguras para el notch), video de borde a borde, acciones y botón de Yelis a todo el ancho, chat de alto cómodo, pestañas y
  filtros que se desplazan, tablas con scroll, tarjetas del wallet en 2 columnas, diálogos como **hojas desde abajo**, campos de 16 px
  (iOS no hace zoom) y objetivos táctiles de 44 px. En pantallas táctiles se muestran las herramientas que antes aparecían al pasar el cursor.
- Probado en Chromium a 390 px: sin desborde horizontal en las 11 páginas principales.
- Detalles que solo se vieron en un celular real y ya están corregidos: el menú de la foto se salía por arriba (un padre con
  `backdrop-filter` vuelve relativo a sí mismo a sus hijos `position: fixed`, así que en celular el encabezado no usa desenfoque),
  la búsqueda mostraba un doble contorno, y en el canal el chat quedaba muy abajo; ahora va justo después de los datos del streamer.

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
  largo máximo. La voz la genera el navegador de cada espectador (pueden silenciarla) y también suena en el estudio (con su propio botón de altavoz, y un botón *Test voice* para probar el dispositivo); no va
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

## Clips: el directo se guarda en privado

Cuando terminas un directo **no se publica**: se guarda como **clip privado**, que solo ve su dueño. Los clips viven en `#/clips`
(menú de tu foto → *Clips & editor*). Desde ahí puedes **publicarlo**, abrirlo en el **editor**, volverlo privado otra vez o borrarlo.
Solo los videos publicados salen en tu canal (`#/c/tunombre`). Los videos guardados antes de esta versión siguen publicados.

- **Cómo se graba:** el navegador del streamer graba lo que sale al aire (`MediaRecorder`) y lo sube por trozos de ~5 s mientras
  transmite (`POST /api/vod/<id>/chunk`). Si se cierra la pestaña de golpe, a los 2 minutos el servidor cierra la grabación con lo que
  ya llegó.
- **Privado de verdad:** el servidor no entrega ni el archivo ni la portada de un clip a nadie más que a su dueño, y un clip no
  admite me gusta ni comentarios hasta que se publica. Al volver a hacerlo privado se conservan sus me gusta y comentarios.
- **Editar título, descripción y portada:** mientras es clip se cambian **las veces que quieras**; una vez publicado hay **una sola
  edición** (botón *Edit (one time)*), que el servidor impone. Publicar no gasta esa edición.
- **Límites** (variables de entorno): `YELI_VOD_MAX_MB` (1024 por video), `YELI_VOD_MAX_PER_USER` (30 entre clips y videos publicados)
  y `YELI_VOD_DIR`. Al llegar al tamaño máximo el video se guarda tal cual está.
- **No se graba** un directo que viene de **OBS por WHIP**, porque ese video no pasa por el navegador (con la cámara virtual de OBS sí).
- **Render gratis:** el disco es efímero; los clips se pierden igual que la base de datos. Con disco persistente
  (`YELI_DB=/var/data/yeli.db`) quedan en `/var/data/vods`.
- Requiere **Flask 3.1 o superior** (el trozo de video usa un límite de tamaño propio solo en esa ruta).
- API: `GET /api/me/videos` (todos los míos), `POST /api/vod/<id>/publish`, `/unpublish`, `/edit`, `/delete`, y `POST /api/vod/new`
  (subida que no es un directo, la usa el editor).

## Editor de video

`#/editor` (o `#/editor/<id>` para abrir un clip directamente). Todo ocurre **en el navegador**: los videos se reproducen sobre un
`<canvas>` (con filtros y textos encima) y el sonido pasa por Web Audio.

- **Entradas:** tus clips y directos (privados o publicados) y videos de tu dispositivo.
- **Funciones:** línea de tiempo con zoom, **dividir** en el cursor, recortar arrastrando los bordes (o con números), **unir** varios
  videos en el orden que quieras, **velocidad** de 0,25× a 4×, **volumen** (hasta 200 %) y silencio, **8 filtros**, aparecer y
  desvanecer, **ajustar o recortar** al encuadre, formatos **16:9, 9:16 y 1:1**, **textos** con inicio, duración, tamaño, color,
  posición y caja de fondo, y **deshacer / rehacer**. Atajos: Espacio, `S` dividir, `Supr` borrar, `[` `]` mover, flechas, Ctrl+Z.
- **Exportar:** *Save as a private clip* (se sube como un clip nuevo; el original no se toca) o *Download a file*. La calidad es
  720p, 480p o 360p. **Se graba en tiempo real**: un video de 2 minutos tarda unos 2 minutos, y la pestaña debe seguir abierta y visible.
- **Límites que conviene saber:** el proyecto vive en la memoria de la pestaña (si recargas la página se pierde, y el navegador avisa
  si hay trabajo sin exportar); los filtros necesitan un navegador con `ctx.filter` (Chrome, Edge, Firefox; Safari no); el resultado es
  WebM (o MP4 en Safari); los clips grabados por el navegador no tienen índice, así que al saltar a un punto el fotograma puede tardar un instante.

## Cofre diario

Cada día (00:00 UTC) un espectador **con cuenta** puede desbloquear un cofre mirando directos **una hora** y abrirlo para recibir **una recompensa aleatoria**:

| Recompensa | Probabilidad | Qué es |
|---|---|---|
| Sticker exclusivo | 55 % | Uno de 8 stickers que solo salen de cofres (Ghost, Pizza, Moon, Alien, Kitty, Rainbow, Robot, Cupcake). Se envían gratis en cualquier chat desde la pestaña **Chest** del selector de stickers. |
| Color de nombre | 40 % | Uno de 12 colores. Se puede usar como color de nombre **sin** la mejora *Color de nombre* (en `#/chest` o en *Upgrades*). |
| Punto de mejora | 5 % | 1 punto, el mismo que se compra con Yelis. |

- Página: `#/chest` (menú de tu foto → *Daily chest*). Bajo el directo aparece una barra con el avance y, al desbloquearse, un aviso.
- El tiempo **se acumula durante el día** entre todos los directos (no hace falta una hora seguida) y solo cuenta mientras el latido de la página llega; una pausa de más de 1 minuto no suma. Ver dos directos a la vez no duplica el tiempo.
- Solo cuenta con cuenta (no invitados), en directos **de otros** (no el tuyo) y fuera de la red del streamer. Las cuentas nuevas también cuentan desde el primer segundo.
- Un cofre por cuenta y día; el servidor decide la recompensa (`secrets`) y lo hace de forma atómica. Lo que ya tienes no vuelve a salir; si completas todos los stickers y colores, el cofre da puntos.
- **Los puntos valen dinero** (100 Yelis cada uno), por eso su probabilidad es baja. Ajusta con `YELI_CHEST_WEIGHTS` o ponla en 0 si prefieres que el cofre no dé puntos.

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
| `YELI_CHEST_SECONDS`, `YELI_CHEST_WEIGHTS` | Cofre diario: segundos de directo para desbloquearlo (3600) y pesos de las recompensas, p. ej. `{"sticker":55,"color":40,"points":5}` |
| `YELI_ADMINS` | Usuarios que pueden abrir *Admin* (separados por comas) |
| `YELI_PAYMENTS`, `YELI_CURRENCY`, `YELI_TAX_RATE`, `YELI_PROCESSOR_*`, `YELI_PAYOUT_*`, `YELI_EARN_RATES`, `YELI_POINT_COST`, `YELI_PACKS` | Economía |
| `YELI_PROXY`, `YELI_DEMO`, `YELI_ALLOWED_HOSTS`, `HOST` | Hosting (Render) |
| `YELI_SECRET_KEY`, `YELI_HTTPS=1` | Sesiones |
| `YELI_DB`, `HOST`, `PORT`, `YELI_THREADS` | Base de datos y servidor |
| `YELI_MAX_VIEWERS`, `YELI_MAX_VIEWERS_SFU` | Límites de espectadores por directo |
| `YELI_ICE_SERVERS` | STUN/TURN (JSON). Detrás de NAT estrictos añade un TURN |
| `YELI_LIST_CACHE` | Segundos de caché de las listas públicas (2) |
| `YELI_VOD_DIR`, `YELI_VOD_MAX_MB`, `YELI_VOD_MAX_PER_USER` | Videos guardados: carpeta, tamaño máximo y cantidad por canal |

## Estructura

```
app.py              lanzador (Waitress si está instalado)
yeli/
  __init__.py       create_app()
  config.py         ajustes y límites
  db.py             esquema, conexión a Supabase (Postgres) y SQLite local, migraciones
  core.py           utilidades compartidas
  queries.py        canales, espectadores únicos, señalización
  accounts.py       registro, login, perfil, avatar
  channels.py       Home, Explore, búsqueda, seguir
  chat.py           chat y stickers
  wallet.py         Yelis, donaciones, cash-outs, estado de cuenta, admin
  streaming.py      ciclo del directo, miniaturas, señalización P2P
  vods.py           directos guardados como video: subida por trozos, lista, edición única
  media.py          servidor de medios: claves de stream y autenticación para MediaMTX
  chest.py          cofre diario: tiempo de visionado, recompensas y colección
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

## Tema, idioma y app instalable

- **Tema:** solo Oscuro y Claro (Ajustes → Apariencia). El color de acento es siempre naranja. El tema claro está en `static/css/theme-light.css`.
- **Idioma:** Automático (sigue al navegador), English o Español (Ajustes → Idioma). Las traducciones están en `static/js/i18n-es.js`; lo que no esté ahí se queda en inglés. Para añadir un texto nuevo: `"English": "Español",`. El motor es `static/js/i18n.js`.
- **Instalar como app (PWA):** `manifest.webmanifest` + `sw.js` (los sirve `yeli/pwa.py` desde la raíz). Necesita HTTPS (Render ya lo da). Android/Chrome: Ajustes → App → Instalar; iPhone: Compartir → Añadir a pantalla de inicio. El service worker solo guarda la interfaz; nunca toca `/api/` ni el video.
- **Compartir pantalla:** instalar la app **no** lo habilita en el celular: los navegadores móviles no implementan `getDisplayMedia`. En computadora funciona igual que antes.

## Videos: me gusta y comentarios

Cada video **publicado** tiene un botón de *me gusta* (uno por cuenta, se puede quitar) y comentarios de hasta 300 caracteres, del
más nuevo al más antiguo y de 20 en 20. **Cada comentario se puede likear y responder.** Las respuestas cuelgan del comentario
principal (un nivel, como YouTube), muestran a quién responden (`@usuario`), se ven con *View N replies* y se cargan de 20 en 20, de
la más antigua a la más nueva. Pueden borrarlos su autor, el streamer y los moderadores (al borrar un comentario se van sus
respuestas). Los comentarios y respuestas respetan las reglas del canal (bloqueos, palabras bloqueadas, enlaces y mayúsculas) y se
limitan a 5 por minuto. Quien recibe una respuesta a su comentario recibe una notificación (`reply`; en la app y por correo por defecto).
API: `POST /api/vod/<id>/like`, `GET|POST /api/vod/<id>/comments` (con `parent` para responder),
`GET /api/vod/<id>/comments/<n>/replies`, `POST /api/vod/<id>/comments/<n>/like` y `/delete`.

En la página de un directo, el botón de la cabecera del chat lo oculta (el video ocupa todo el ancho) y el botón *Chat* sobre el video lo
vuelve a mostrar; la elección se recuerda en el dispositivo.

## La voz del bot dentro del directo

Por defecto la voz (`!say`) sale **en el directo**: el servidor convierte el mensaje en audio con `espeak-ng`, el estudio del
streamer lo mezcla en el audio de la transmisión (aparece como *Voz del bot* en el mezclador, con su volumen y su silencio) y por eso
lo escuchan todos los que ven el directo, y queda guardado en el video. Los navegadores de los espectadores no la leen.

- Hace falta `espeak-ng` en el servidor: `apt install espeak-ng`, o usa el `Dockerfile` (en Render, `runtime: docker`; mira `render.yaml`).
  Con otra ruta: `YELI_TTS_BIN=/ruta/al/programa` (con los mismos argumentos que espeak-ng).
- Sin ese programa, o si en *Bot > Voz* eliges **En el dispositivo de cada espectador**, funciona como antes: cada navegador la lee en voz alta.
- El estudio tiene que estar abierto mientras transmites. Si transmites con OBS, elige la opción de los dispositivos de los espectadores.
- El idioma sale de *Voz > idioma* o, si está vacío, del idioma del navegador del streamer.
- Solo el streamer puede pedir ese audio: `GET /api/tts/<canal>/<id del mensaje>`.

---

## Conectar otras plataformas (TikTok Live, Kick, Twitch, YouTube...)

En el estudio, el botón **Plataformas** hace dos cosas, y el bot (comandos y voz) funciona en las dos:

**1. Enviar tu directo a otras plataformas a la vez.** Añade cada plataforma con su dirección de servidor RTMP y su clave de
transmisión (Twitch, YouTube y Facebook ya traen la dirección; en Kick y TikTok la copias de tu panel). Mientras estás en directo,
el servidor lanza un `ffmpeg` por plataforma que lee tu directo del servidor de medios y lo envía. Lo que sale es lo mismo que
ven tus espectadores: la imagen y el sonido ya mezclados en el estudio, con el chat, las alertas, los mensajes del bot y **la voz del bot**.
Cada plataforma tiene su estado (Enviando, Reintentando, Falló), se apaga y se enciende sin borrarla, y puede enviarse en **vertical 9:16**
(recortando el centro) para TikTok. Las claves se guardan en la base de datos (hacen falta para enviar), nunca vuelven al navegador y
se quitan de los mensajes de error.

Para que funcione necesitas:

- el **modo servidor de medios** (MediaMTX): en P2P no hay video en el servidor que reenviar;
- `ffmpeg` instalado donde corre Yeli (`apt install ffmpeg`, o usa el `Dockerfile`, que ya lo incluye);
- `YELI_MEDIA_RTSP=rtsp://127.0.0.1:8554` (la dirección RTSP de MediaMTX; el `mediamtx.yml` y el `docker-compose.yml` ya lo activan,
  solo en `127.0.0.1`: **no abras ese puerto a internet**). Si MediaMTX está en otra máquina, ffmpeg tiene que alcanzar ese puerto.

Sin eso, el diálogo lo explica y todo lo demás sigue funcionando. Ten en cuenta: reenviar **recodifica** a H.264 + AAC (la imagen sale del
navegador en VP8/H.264 con Opus), lo que usa CPU del servidor (aprox. un núcleo por plataforma a 720p). TikTok da una dirección y una clave
nuevas en cada directo y solo a cuentas con acceso a LIVE (suelen pedir 1.000 seguidores y 18 años); su exigencia puede cambiar.

**2. Traer el chat de otras plataformas al tuyo.** Los mensajes aparecen en el chat de Yeli y en el chat del directo con la etiqueta de
su plataforma, siguen las reglas de tu chat (palabras bloqueadas, enlaces, mayúsculas), puedes borrarlos y el bot responde a sus
comandos (`!dado`, tus comandos personalizados, `!say`, etc.; los comandos solo para el streamer o los moderadores no aplican a gente de fuera).

- **Twitch** se lee directamente (conexión IRC anónima y de solo lectura al canal que escribas, mientras estás en directo).
- **TikTok, Kick, YouTube y el resto** entran por un **enlace privado** (`POST /api/bridge/<clave>` con
  `{"platform": "tiktok", "user": "ana", "text": "hola"}`): se lo das a cualquier herramienta que escuche ese chat y pueda llamar a un
  enlace. La respuesta trae `reply` con lo que contesta el bot, para que la herramienta pueda decirlo en ese chat. Kick y TikTok no ofrecen una
  forma pública de leer su chat sin iniciar sesión como el streamer, por eso la conexión la hace una herramienta que ya uses. Puedes
  crear un enlace nuevo cuando quieras (el anterior deja de funcionar).

Lo que **no** hace: escribir de vuelta en esas plataformas por sí solo (haría falta iniciar sesión en cada una; con el enlace puedes hacerlo
desde tu herramienta usando `reply`), ni reenviar *desde el navegador* sin servidor de medios.
