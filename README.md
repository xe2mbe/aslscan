<p align="center"><img src="aslscan/static/logo.svg" width="96" alt="ASLSCAN"></p>

<h1 align="center">ASLSCAN</h1>

<p align="center"><a href="#english"><b>🇺🇸 English</b></a> · <a href="#espanol"><b>🇲🇽 Español</b></a></p>

<a name="english"></a>

## ASLSCAN — a web dashboard for your node

ASLSCAN is the **Dashboard of [HAMNA Web](https://github.com/xe2mbe/hamna)** as a program of its own, for whoever wants to see and control their node from the browser without the broadcast automation. It runs **inside the node** (AllStarLink 3, HamVOIP, ASL2 or IRLP), uses only Python's standard library and keeps HAMNA's user system.

> ASLSCAN is not related to AllScan (by NR9V); it can import AllScan's favorites the first time.

### What it does

- **Dashboard**: the nodes linked right now, with callsign and city (AllStar directory), mode, direction, time connected, IP and who is talking, plus the nodes reachable across the network; the direct links table has column headers and shows the favorites group each node belongs to. **Connect** (transceive, monitor or local monitor) and **disconnect** one or all.
- **Favorites in categories** below the direct links, shown as tabs, each category with its own color and box (how many nodes it has and how many are connected), with an editor (rename, reorder, drag between categories). The first time they're imported from AllScan.
- **Node search** in the AllStar directory by callsign, node number, description or location, with **● Online / ● No reply / ○ Offline** labels (AllStar DNS + IAX POKE).
- **IRLP**: the node or reflector it's connected to, COS/PTT, the other nodes on the reflector, connect/disconnect, enable/disable, inactivity timeout, AUX outputs, DTMF, the IRLP log and the switch to turn the old IRLPvCON off.
- **🕒 Connection history** (Dashboard): a timeline of every link — when it connected, incoming or outgoing, mode, IP, who asked for it, failed attempts, and how long it lasted when it disconnected (kept 90 days; also links made by DTMF or by other nodes).
- **🔊 Live listening** from the page (8 kHz, up to 8 listeners).
- **📢 Announcements** (Schedule → Announcements): short announcements (60 s by default, up to 170 s) that the node transmits on its own at given times, every N minutes or once, read by a voice (Azure, ElevenLabs or Piper/asl3-tts), with the time and the weather if you want; plus **⚠ automatic alerts** for weather, forecast and earthquakes, uploaded or recorded from the page; they wait for a quiet channel and never interrupt (AllStar nodes).
- **Telegram bot**: 📋 Menu → 🔗 Connections (see, connect with your favorites by category or by number, change the mode, disconnect), 🩺 Health and 🗺 Nodes. Alerts for health, failed backups and nodes that stop reporting.
- **Nodes panel**: each node reports its health, device and version to a hub every minute. ASLSCAN and HAMNA Web nodes can report to the same hub. With "Let the hub control this node" checked, the hub's Telegram bot (HAMNA Web 1.50 or newer) can also see and control this node: connections, announcements, weather and alerts, health — with permissions per node set on the hub.
- **Users** with roles (administrator, operator, read only), sessions, attempt lockout, photo and language (English / Spanish).
- **Backups**: download/restore, and an automatic daily backup to another node (ASLSCAN or HAMNA Web), Google Drive / OneDrive (rclone) or Telegram.
- **Equipment health**: SD card errors, slow writes, undervoltage, temperature, disk.

### Settings

| Section | What's there |
|---|---|
| **Node** | Node number, station name and logo; test the connection with Asterisk / IRLP |
| **Tones** (ASL3) | The courtesy tones in rpt.conf: listen in the browser, edit beeps and pauses, which tone plays when the node is linked or not, the pause before the tone (unkeywait) and the hang time. A copy is kept before each change; **Apply** restarts Asterisk and goes back to the previous file if the node doesn't come back |
| **Users** | Same as HAMNA: create, edit, roles, sessions, lockouts |
| **Voice** | The voice for announcements: Azure (key, region, voice, style, speed, pitch), ElevenLabs (key, voice, model) or Piper (`sudo apt install asl3-tts`), with a test, and the pronunciation dictionary |
| **Weather** | The location for the weather variables (Open-Meteo) and, optionally, your Weather Underground station |
| **Alerts** | Automatic weather, forecast and earthquake alerts: limits, hours, where they go out, examples |
| **DTMF** (ASL) | Every DTMF code of the node: see, test, add, edit and delete; ASLSCAN shortcuts for weather, earthquakes and announcements |
| **Telegram** | The bot (token, chat), who has it linked, and the alerts |
| **Backup** | Automatic, download and restore, receive from other nodes |
| **System** | Updates, equipment health, live audio, node info, IRLPvCON and the nodes panel |

### Roles

| Role | Can |
|---|---|
| Administrator | Everything: users, favorites, settings and backups |
| Operator | Connect and disconnect nodes (page and bot) |
| Read only | See the Dashboard and the nodes, and listen live |

### Requirements

- A node with **AllStarLink 3, ASL2, HamVOIP or IRLP** and **Python 3.5 or newer** (no packages to install).
- On IRLP, `alsa-utils` for live listening (the installer adds it).

### Installation

As root on the node:

```
curl -sL https://raw.githubusercontent.com/xe2mbe/aslscan/main/update.sh | sudo bash
```

or download the repository and run `sudo ./install.sh`. The installer detects the node type and number, creates the `aslscan` service and publishes the page through Apache at **`https://<node>/aslscan/`** (port 8095 stays inside the node). On HamVOIP run it as root without sudo.

Options: `--type asl|irlp`, `--node NUMBER`, `--port 8095`, `--password PASS`, `--no-packages`, `--no-apache`, `--listen-all`.

Change a password from the node's terminal: `aslscan-passwd USER`.

### Updating

```
sudo /opt/aslscan/update.sh
```

It installs the newest release (`vX.Y.Z` tag) and keeps users, favorites and settings; it backs up first to `/var/backups/aslscan/`. **Settings → System** says when there's a new version.

### Security checklist

ASLSCAN can change the node: an administrator can edit rpt.conf (tones, DTMF), and a DTMF `cmd` function runs programs as Asterisk's user (root on HamVOIP). Treat the administrator password like the node's root password.

1. **Long, unique passwords** for administrators; give **operator** users for day-to-day use.
2. **Always https** (`https://<node>/aslscan/`, through the node's Apache) or an SSH tunnel (`ssh -L 8095:127.0.0.1:8095 user@node`). Never forward port 8095 on the router. With `--listen-all` or on IRLP the installer opens 8095 only to the local network (10.x, 172.16–31.x, 192.168.x), and the page warns when it's opened over plain http.
3. **Every backup is a secret**: it carries the voice, Telegram and weather keys.
4. **Read before you run**: download the release tag, check its SHA-256 (it's in the release notes) and read `install.sh` instead of `curl | sudo bash`.
5. **Asterisk's AMI (port 5038) must not be reachable from the internet**. It isn't part of ASLSCAN, but **Health** warns if it listens beyond 127.0.0.1.

### Announcements

**Schedule → Announcements**: short announcements (60 s by default; up to 170 s in Settings → Voice) that the node transmits on its own.

- **What it says**: text read by the voice of Settings → Voice (with `{hora}`, `{son_las}`, `{dia}`, `{fecha}`, `{fecha_larga}`, `{saludo}`, `{despedida}`, `{nodo}` and the weather ones; if the text has variables the voice is generated again right before it goes out), an uploaded audio file, or a recording made from the page (needs https). Uploads and recordings are converted in the browser.
- **When**: at given times on the chosen days, every N minutes within a time window, just once; optionally only between two dates.
- **RF or RF + Net per time slot**: in «At these times» each time has two checkboxes, 📻 RF (always on: AllStar can't send audio only to the linked nodes) and 🌐 Net (e.g. 09:00 and 13:00 RF only, 20:50 to the whole network). The card shows it at a glance: *🌐 Net only 20:50*. «Transmit now» asks where it goes this time.
- **Where**: only this node's radio (`rpt localplay`) or also the linked nodes (`rpt playback`).
- **It never interrupts**: it waits for the channel to be quiet (nobody receiving, transmitting or talking through a link) for 3 s; if the channel doesn't clear in 5 min, that slot is skipped and logged.
- Each card has ▶ Listen, 📡 Transmit now, pause/activate, edit and delete, plus the next slot and the last result; the **announcement log** shows what went out, what was skipped and why. Administrators and operators create them; read-only users see them.
- **🌐 From an address** (administrators only): the text is downloaded from an `https://` address right before it goes out, with the channel already clear, and gets the variables and the pronunciation dictionary. If the server answers `204`, or the `X-HAMNA-Vence` header (ISO 8601 UTC) has passed, it doesn't go out that day and it's logged as *no content*. If it fails (another code, timeout, TLS, HTML…) it says the fallback text or it's skipped, as chosen. A text longer than the maximum length is split into parts **only between paragraphs** (separated by a blank line), waiting between parts for the node to unkey and the channel to clear, so the TOT starts over. Limits: 10 s, 16 KB, up to 3 redirects (all https), `User-Agent: ASLSCAN/<version>`, verified certificate. Addresses on the local network or the node itself are refused; Settings → Voice can limit them to some domains and give a certificate file for old devices. **🔎 Test the address** shows the text as received and as it will be said, and **▶ Test with voice** plays it with its parts.
- **📄 Load .txt** fills the text from a file on your computer (UTF-8 or the old Notepad's Windows-1252); a blank line is a short pause. The editor counts the characters against the limit.
- **🎙 Voice per announcement** (Azure): a different voice, style, speed and pitch for each one, with ▶ Listen; empty = the one in Settings → Voice. If that voice ever fails, it goes out with the one in Settings and it's noted in the log.
- **⬇ Download** the audio of each announcement (the 8 kHz WAV that goes on air).
- **Limits** in Settings → Voice: maximum length (30–170 s, default 60) and maximum characters (200–4000, default 2000). It shows the node's TOT (`totime` in rpt.conf) and warns if an announcement that long would be cut; check the TOT of the linked nodes too.
- They're included in backups.

Announcements need no ffmpeg or sox: everything is stored as 8 kHz WAV, which Asterisk reads directly.

### Weather and time in announcements

Set your location in **Settings → Weather** (search the city, use 📍 My location over https, or type latitude and longitude) and **🌤 Test** shows what each variable would say right now. The data comes from [Open-Meteo](https://open-meteo.com): free, no sign-up, anywhere in the world. If you have a station on Weather Underground, put its ID and API key and its readings replace Open-Meteo's (sky conditions and forecast still come from Open-Meteo).

- Variables: `{temperatura}`, `{sensacion}`, `{condicion}`, `{humedad}`, `{viento}`, `{racha}`, `{presion}`, `{pronostico}` (today's; tomorrow's after 4 pm), `{lugar}`; units °C/km/h or °F/mph. Plus `{son_las}`: the time in words («son las 3 y media de la tarde»).
- Templates for a new announcement: **🕐 Time** (every 30 min), **🕐 Time and temperature** and **🌤 Weather report** (every hour at :47). They're ordinary announcements: edit the text, the times, RF/Net or pause them.
- The weather is read a minute before the announcement goes out and kept 10 min. If the time or the weather can't be generated right then (no internet, voice down), that slot is skipped instead of airing old data.
- If another program already announces the time, the weather or plays audio on the node (`saytime.pl` and the like in the crontab), Schedule → Announcements says so, so it isn't heard twice. ASLSCAN never touches other programs.

### Automatic alerts (weather and earthquakes)

**Settings → Alerts** (everything off by default; an empty limit turns that check off). They use the location and units from Settings → Weather and the voice from Settings → Voice.

- **Current weather**: sustained wind, gusts, heavy rain, pressure dropping fast (in 3 h), heat and cold. Checked every 10 min, only within a time window (nobody gets woken up at night), and the same alert isn't repeated before N minutes.
- **Forecast**: thunderstorm, heavy rain (mm in an hour + probability), gusts, heat or cold expected in the next hours; announced N minutes ahead (e.g. `120, 30`).
- **Earthquakes** ([USGS](https://earthquake.usgs.gov), worldwide, keyless): nearby within a radius, regional within a bigger radius and, optionally, strong ones anywhere in the world. Only earthquakes from the last 30 minutes are announced, said a few times (e.g. twice, 10 min apart), at any hour.
- They go through the same queue as the announcements, ahead of them, and wait for a clear channel; RF only or RF + Net. **Schedule → Alerts** shows the current reading against each limit, what the forecast brings, the earthquakes within your limits and the alerts sent, with **↻ Check now**. Settings has **▶ Listen** examples.

### DTMF commands

**Settings → DTMF** (AllStar nodes) lists every code the node answers to: those from the ASL template (`[functions-main]`) and your node's own section (e.g. `[functions59624]`), each one explained in plain words, with its script or comment, and marked when it's risky (restart Asterisk, autopatch) or clashes with another code.

- **▶ Test** runs it as if it were dialed from the radio (`rpt fun`).
- **＋ Add command**, ✏️ edit and 🗑 delete in your node's section: run a script, links, information, node operation, macro, play an audio file, autopatch. A code can't be the start of another one or the other way around (`*8` would clash with `*81`). Template codes aren't deleted; ✏️ puts the same code in your node with another function.
- **ASLSCAN shortcuts**: a code for 🌤 *weather now*, another for 🌎 *recent earthquakes* (last 24 h, with the limits of Settings → Alerts) and, in each announcement's editor, a code that plays it. They go through the same queue and wait for a clear channel. ASLSCAN writes and keeps those lines (marked `; ASLSCAN`) and calls `bin/aslscan-dtmf`.
- A copy of rpt.conf is saved before each change; Asterisk reads the codes when it restarts (**Apply**, as in Tones).

### Times from another time zone

A net at "9 pm Chicago time" is 9 pm here in winter and 8 pm in summer. Instead of writing the time, insert it with **🕗 Time in another zone** (next to the variables): choose the time there, the zone and how to say it. The text gets `{hora 21:00 America/Chicago}` and the voice says the right local time on the day it goes out: «9 de la noche» now, «8 de la noche» after the US changes to daylight saving time, without touching the text.

- Formats: words («9 de la noche», the default), `| 24h` («21:00») or `| 12h` («9 pm»).
- In the editor these times are highlighted in green and below it says what they'll say today; a wrong one is flagged with ⚠ (and isn't read).
- The voice is generated at air time: announcements already do it, and that's why they always say the right time.
- The pronunciation dictionary isn't applied inside the token (the time is calculated first).

### Pronunciation dictionary

**Settings → Voice → Pronunciation dictionary**: a table of *Written* → *How it's said* (e.g. `WSPR → uísper`, `ON4KST → o ene cuatro ka ese te`). It's applied to everything the voice says (announcements and tests), with any voice engine, right before the text goes to the engine and after the variables; what's written doesn't change.

- Whole words only (`FT8` changes in "(FT8)," but not inside `FT8CALL`); longest terms first (`FT8 DX` before `FT8`); one single pass.
- Exact case by default; tick **Aa** on a term to ignore case.
- ▶ on each row plays just that term; **Try a text** shows what the voice gets and plays it, even before saving.
- **Paste list** takes one term per line (`WSPR = uísper`, add `| Aa` to ignore case) and shows what's new, what changes and which lines it didn't understand; **Copy list** gives the same format to share it.
- When you save, the stored voices that use a changed term (announcements) are generated again in the background. Up to 500 terms; it's included in backups.

### Live listening

On ASL / HamVOIP, add this line to your node's stanza in `/etc/asterisk/rpt.conf` and restart Asterisk (on ASL3, `sudo systemctl restart asterisk`; never `rpt restart`):

```
outstreamcmd = /opt/aslscan/bin/aslscan-live
```

On IRLP it's turned on from **Settings → System → Live audio**.

### Together with HAMNA Web

Both can be installed on the same node; each one has its own service, data and address:

| | HAMNA Web | ASLSCAN |
|---|---|---|
| Page | `/hamna/` (port 8090) | `/aslscan/` (port 8095) |
| Program / data | `/opt/hamna-web`, `/var/lib/hamna` | `/opt/aslscan`, `/var/lib/aslscan` |
| Live audio | UDP 8091 | UDP 8096 |

- **Live audio**: `rpt.conf` accepts only one `outstreamcmd`. `aslscan-live` sends the audio to both programs, and so does HAMNA Web's `hamna-live` from version 1.42; keep only one of the two lines. On IRLP, if HAMNA already turned live listening on, ASLSCAN uses the same audio.
- **Telegram**: use **a different bot** for each one (Telegram doesn't let two programs read the same bot's messages).
- **Users** are separate: each program has its own.
- **Backups and nodes panel** use the same protocol: an ASLSCAN node can report and send its backups to a HAMNA Web hub (1.42 or newer) and vice versa.

### Files

| Path | What |
|---|---|
| `/opt/aslscan/` | The program (`aslscan/`, `bin/`, `install.sh`, `update.sh`, `uninstall.sh`) |
| `/var/lib/aslscan/` | Data: `aslscan.db` (users, sessions, panel), `settings.json`, logo, photos, received backups, `aslscan.log` |
| `/etc/systemd/system/aslscan.service` | The service (`journalctl -u aslscan -f`) |

### Uninstall

```
sudo /opt/aslscan/uninstall.sh            # keeps /var/lib/aslscan
sudo /opt/aslscan/uninstall.sh --delete-data
```

HAMNA Web is not touched.

---

<a name="espanol"></a>

## ASLSCAN — el dashboard web de tu nodo

ASLSCAN es el **Dashboard de [HAMNA Web](https://github.com/xe2mbe/hamna)** como programa aparte, para quien quiere ver y controlar su nodo desde el navegador sin la automatización de transmisiones. Corre **dentro del nodo** (AllStarLink 3, HamVOIP, ASL2 o IRLP), solo usa la librería estándar de Python y conserva el sistema de usuarios de HAMNA.

> ASLSCAN no tiene relación con AllScan (de NR9V); la primera vez puede importar los favoritos de AllScan.

### Qué hace

- **Dashboard**: los nodos enlazados en este momento, con indicativo y ciudad (directorio de AllStar), modo, dirección, tiempo conectado, IP y quién está hablando, y los nodos alcanzables en toda la red; la tabla de enlaces directos tiene títulos de columna y muestra el grupo de favoritos de cada nodo. **Conectar** (transceptor, monitor o monitor local) y **desconectar** uno o todos.
- **Favoritos por categorías** debajo de los enlaces directos, en pestañas, cada categoría con su color y su recuadro (cuántos nodos tiene y cuántos están conectados), con editor (renombrar, ordenar, arrastrar entre categorías). La primera vez se importan de AllScan.
- **Buscador de nodos** en el directorio de AllStar por indicativo, número, descripción o lugar, con etiquetas **● En línea / ● Sin resp. / ○ Apagado** (DNS de AllStar + POKE de IAX).
- **IRLP**: a qué nodo o reflector está conectado, COS/PTT, los demás nodos del reflector, conectar/desconectar, habilitar/deshabilitar, desconexión por inactividad, salidas AUX, DTMF, la bitácora de IRLP y el botón para apagar el viejo IRLPvCON.
- **🕒 Historial de conexiones** (Dashboard): línea de tiempo de cada enlace — cuándo se conectó, si fue entrante o saliente, modo, IP, quién lo pidió, intentos fallidos y cuánto duró al desconectarse (se guarda 90 días; también los enlaces hechos por DTMF o por otros nodos).
- **🔊 Escuchar en vivo** desde la página (8 kHz, hasta 8 personas).
- **📢 Anuncios** (Programación → Anuncios): anuncios cortos (60 s de fábrica, hasta 170 s) que el nodo transmite solo a ciertas horas, cada N minutos o una vez, con voz (Azure, ElevenLabs o Piper/asl3-tts), y si quieres con la hora y el clima; además **⚠ alertas automáticas** de clima, pronóstico y sismos, subidos o grabados desde la página; esperan a que el canal esté libre y nunca interrumpen (nodos AllStar).
- **Bot de Telegram**: 📋 Menú → 🔗 Conexiones (ver, conectar con tus favoritos por categoría o por número, cambiar el modo, desconectar), 🩺 Salud y 🗺 Nodos. Avisos de salud, de respaldos fallidos y de nodos que dejan de reportar.
- **Panel de nodos**: cada nodo manda a un hub su salud, equipo y versión cada minuto. Los nodos con ASLSCAN y con HAMNA Web pueden reportar al mismo hub. Si marcas "Permitir que el hub controle este nodo", el bot de Telegram del hub (HAMNA Web 1.50 o más nueva) también puede ver y controlar este nodo: conexiones, anuncios, clima y alertas, salud — con permisos por nodo que se dan en el hub.
- **Usuarios** con roles (administrador, operador, solo lectura), sesiones, bloqueo por intentos, foto e idioma (inglés / español).
- **Respaldos**: descargar/restaurar, y respaldo automático diario a otro nodo (ASLSCAN o HAMNA Web), Google Drive / OneDrive (rclone) o Telegram.
- **Salud del equipo**: errores de la tarjeta SD, escritura lenta, bajo voltaje, temperatura, disco.

### Ajustes

| Sección | Qué tiene |
|---|---|
| **Nodo** | Número de nodo, nombre de la estación y logo; probar la conexión con Asterisk / IRLP |
| **Tonos** (ASL3) | Los tonos de cortesía de rpt.conf: escucharlos en el navegador, editar pitidos y pausas, qué tono suena con el nodo enlazado o sin enlaces, la pausa antes del tono (unkeywait) y la cola (hangtime). Se guarda una copia antes de cada cambio; **Aplicar** reinicia Asterisk y regresa al archivo anterior si el nodo no vuelve |
| **Usuarios** | Igual que en HAMNA: crear, editar, roles, sesiones, bloqueos |
| **Voz** | La voz de los anuncios: Azure (clave, región, voz, estilo, velocidad, tono), ElevenLabs (clave, voz, modelo) o Piper (`sudo apt install asl3-tts`), con prueba, y el diccionario de pronunciación |
| **Clima** | La ubicación para las variables del clima (Open-Meteo) y, si quieres, tu estación de Weather Underground |
| **Alertas** | Alertas automáticas de clima, pronóstico y sismos: límites, horario, por dónde salen, ejemplos |
| **DTMF** (ASL) | Todos los códigos DTMF del nodo: ver, probar, agregar, editar y borrar; atajos de ASLSCAN para clima, sismos y anuncios |
| **Telegram** | El bot (token, chat), quién lo tiene vinculado y los avisos |
| **Respaldo** | Automático, descargar y restaurar, recibir de otros nodos |
| **Sistema** | Actualizaciones, salud del equipo, audio en vivo, datos del nodo, IRLPvCON y el panel de nodos |

### Roles

| Rol | Puede |
|---|---|
| Administrador | Todo: usuarios, favoritos, ajustes y respaldos |
| Operador | Conectar y desconectar nodos (página y bot) |
| Solo lectura | Ver el Dashboard y los nodos, y escuchar en vivo |

### Requisitos

- Un nodo con **AllStarLink 3, ASL2, HamVOIP o IRLP** y **Python 3.5 o más nuevo** (no hay que instalar paquetes).
- En IRLP, `alsa-utils` para escuchar en vivo (lo agrega el instalador).

### Instalación

Como root en el nodo:

```
curl -sL https://raw.githubusercontent.com/xe2mbe/aslscan/main/update.sh | sudo bash
```

o baja el repositorio y corre `sudo ./install.sh`. El instalador detecta el tipo y número de nodo, crea el servicio `aslscan` y publica la página con Apache en **`https://<nodo>/aslscan/`** (el puerto 8095 queda solo dentro del nodo). En HamVOIP se corre como root, sin sudo.

Opciones: `--type asl|irlp`, `--node NÚMERO`, `--port 8095`, `--password CLAVE`, `--no-packages`, `--no-apache`, `--listen-all`.

Cambiar una contraseña desde la terminal del nodo: `aslscan-passwd USUARIO`.

### Actualizar

```
sudo /opt/aslscan/update.sh
```

Instala la versión publicada más nueva (etiqueta `vX.Y.Z`) y conserva usuarios, favoritos y ajustes; antes respalda en `/var/backups/aslscan/`. **Ajustes → Sistema** avisa cuando hay versión nueva.

### Seguridad: lista para quien instala

ASLSCAN puede cambiar el nodo: un administrador edita rpt.conf (tonos, DTMF) y una función DTMF `cmd` corre programas con el usuario de Asterisk (root en HamVOIP). Cuida la contraseña de administrador como la de root del nodo.

1. **Contraseñas largas y únicas** para los administradores; usuarios **operador** para el día a día.
2. **Siempre por https** (`https://<nodo>/aslscan/`, con el Apache del nodo) o por túnel SSH (`ssh -L 8095:127.0.0.1:8095 usuario@nodo`). Nunca reenvíes el 8095 en el router. Con `--listen-all` o en IRLP el instalador abre el 8095 solo a la red local (10.x, 172.16–31.x, 192.168.x), y la página avisa si entras por http sin cifrar.
3. **Cada respaldo es secreto**: lleva las claves de la voz, de Telegram y del clima.
4. **Lee antes de correr**: baja la etiqueta del release, revisa su SHA-256 (viene en las notas del release) y lee `install.sh` en lugar de `curl | sudo bash`.
5. **El AMI de Asterisk (puerto 5038) no debe verse desde internet**. No es de ASLSCAN, pero **Salud** avisa si escucha fuera de 127.0.0.1.

### Anuncios

**Programación → Anuncios**: anuncios cortos (60 s de fábrica; hasta 170 s en Ajustes → Voz) que el nodo transmite solo.

- **Qué dice**: un texto que lee la voz de Ajustes → Voz (con `{hora}`, `{son_las}`, `{dia}`, `{fecha}`, `{fecha_larga}`, `{saludo}`, `{despedida}`, `{nodo}` y las del clima; si el texto lleva variables la voz se genera otra vez justo antes de salir), un audio subido o una grabación hecha desde la página (requiere https). Lo subido y lo grabado se convierte en el navegador.
- **Cuándo**: a ciertas horas los días elegidos, cada N minutos dentro de un horario, una sola vez; si quieres, solo entre dos fechas.
- **RF o RF + Net en cada horario**: en «A estas horas» cada hora tiene dos casillas, 📻 RF (siempre marcada: AllStar no puede mandar un audio solo a los enlazados) y 🌐 Net (p. ej. 09:00 y 13:00 solo RF, 20:50 a toda la red). La tarjeta lo dice de un vistazo: *🌐 Net solo 20:50*. «Transmitir ahora» pregunta por dónde sale esa vez.
- **Dónde**: solo el radio de este nodo (`rpt localplay`) o también los nodos enlazados (`rpt playback`).
- **Nunca interrumpe**: espera a que el canal esté en silencio 3 s (nadie recibiendo, transmitiendo ni hablando por un enlace); si en 5 min no se libera, ese turno se salta y queda en la bitácora.
- Cada tarjeta tiene ▶ Escuchar, 📡 Transmitir ahora, pausar/activar, editar y borrar, con el próximo turno y el último resultado; la **bitácora de anuncios** dice qué salió, qué se saltó y por qué. Los crean el administrador y los operadores; solo lectura los ve.
- **🌐 Desde una dirección** (solo administradores): el texto se baja de una dirección `https://` justo antes de salir, ya con el canal libre, y le aplica las variables y el diccionario de pronunciación. Si el servidor responde `204`, o la cabecera `X-HAMNA-Vence` (ISO 8601 en UTC) ya pasó, ese día no sale y queda en la bitácora como *sin contenido*. Si falla (otro código, tiempo agotado, TLS, HTML…) dice el texto de respaldo o se salta, según se elija. Un texto más largo que la duración máxima se divide en tramos **solo entre párrafos** (separados por un renglón en blanco), esperando entre tramos a que el nodo suelte el PTT y el canal quede libre, para que el TOT vuelva a empezar. Límites: 10 s, 16 KB, hasta 3 redirecciones (todas https), `User-Agent: ASLSCAN/<versión>`, certificado verificado. No acepta direcciones de la red local ni del propio nodo; en Ajustes → Voz se puede limitar a ciertos dominios y dar un archivo de certificados para equipos viejos. **🔎 Probar la dirección** muestra el texto como llegó y como se dirá, y **▶ Probar con voz** lo hace oír con sus tramos.
- **📄 Cargar .txt** llena el texto con un archivo de tu equipo (UTF-8 o el Windows-1252 del Bloc de notas viejo); un renglón en blanco es una pausa breve. El editor cuenta los caracteres contra el tope.
- **🎙 Voz por anuncio** (Azure): otra voz, estilo, velocidad y tono para cada uno, con ▶ Escuchar; vacío = la de Ajustes → Voz. Si un día esa voz falla, sale con la de Ajustes y queda en la bitácora.
- **⬇ Descargar** el audio de cada anuncio (el WAV de 8 kHz que sale al aire).
- **Topes** en Ajustes → Voz: duración máxima (30–170 s, de fábrica 60) y caracteres máximos (200–4000, de fábrica 2000). Muestra el TOT del nodo (`totime` de rpt.conf) y avisa si un anuncio tan largo lo cortaría; revisa también el TOT de los nodos enlazados.
- Entran en los respaldos.

Los anuncios no necesitan ffmpeg ni sox: todo se guarda en WAV 8 kHz, que Asterisk lee directo.

### Clima y hora en los anuncios

Pon tu ubicación en **Ajustes → Clima** (busca la ciudad, usa 📍 Mi ubicación con https o escribe latitud y longitud) y **🌤 Probar** muestra qué diría cada variable en ese momento. Los datos son de [Open-Meteo](https://open-meteo.com): gratis, sin registro y para cualquier lugar del mundo. Si tienes una estación en Weather Underground, pon su ID y su clave de API y sus lecturas reemplazan a las de Open-Meteo (el cielo y el pronóstico siguen siendo de Open-Meteo).

- Variables: `{temperatura}`, `{sensacion}`, `{condicion}`, `{humedad}`, `{viento}`, `{racha}`, `{presion}`, `{pronostico}` (el de hoy; después de las 4 de la tarde, el de mañana), `{lugar}`; unidades °C/km/h o °F/mph. Además `{son_las}`: la hora dicha («son las 3 y media de la tarde»).
- Plantillas al crear un anuncio: **🕐 Hora** (cada 30 min), **🕐 Hora y temperatura** y **🌤 Reporte del clima** (cada hora a los :47). Son anuncios normales: cambias el texto, las horas, RF/Net o los pausas.
- El clima se lee un minuto antes de que salga el anuncio y se guarda 10 min. Si en ese momento no se puede generar la hora o el clima (sin internet, voz caída), ese turno se salta en vez de transmitir un dato viejo.
- Si otro programa ya anuncia la hora, el clima o reproduce audios en el nodo (`saytime.pl` y similares en el crontab), Programación → Anuncios lo avisa para que no se oiga dos veces. ASLSCAN nunca toca otros programas.

### Alertas automáticas (clima y sismos)

**Ajustes → Alertas** (todo viene apagado; un límite vacío apaga esa revisión). Usan la ubicación y las unidades de Ajustes → Clima y la voz de Ajustes → Voz.

- **Clima de este momento**: viento sostenido, rachas, lluvia intensa, presión que baja rápido (en 3 h), calor y frío. Se revisa cada 10 min, solo dentro de un horario (de noche no despierta a nadie) y el mismo aviso no se repite antes de N minutos.
- **Pronóstico**: tormenta eléctrica, lluvia fuerte (mm en una hora + probabilidad), rachas, calor o frío que se esperan en las próximas horas; se avisa N minutos antes (p. ej. `120, 30`).
- **Sismos** ([USGS](https://earthquake.usgs.gov), mundial y sin clave): cercanos dentro de un radio, de la región dentro de un radio mayor y, si quieres, los fuertes de cualquier parte del mundo. Solo se avisan los de hace menos de 30 minutos, se repiten unas veces (p. ej. 2, cada 10 min) y salen a cualquier hora.
- Salen por la misma cola que los anuncios, antes que ellos, y esperan canal libre; solo RF o RF + Net. **Programación → Alertas** muestra la lectura contra cada límite, lo que trae el pronóstico, los sismos que cumplen tus límites y las alertas enviadas, con **↻ Revisar ahora**. En Ajustes hay ejemplos para **▶ Escuchar**.

### Comandos DTMF

**Ajustes → DTMF** (nodos AllStar) muestra todos los códigos que entiende el nodo: los de la plantilla de ASL (`[functions-main]`) y los de la sección de tu nodo (p. ej. `[functions59624]`), cada uno explicado en palabras, con su script o comentario, y marcado si es de cuidado (reiniciar Asterisk, autopatch) o si choca con otro código.

- **▶ Probar** lo ejecuta como si lo marcaran desde el radio (`rpt fun`).
- **＋ Agregar comando**, ✏️ editar y 🗑 borrar en la sección de tu nodo: ejecutar un script, enlaces, información, operación del nodo, macro, reproducir un audio, autopatch. Un código no puede ser el principio de otro ni al revés (`*8` chocaría con `*81`). Los de la plantilla no se borran; ✏️ pone el mismo código en tu nodo con otra función.
- **Atajos de ASLSCAN**: un código para 🌤 *clima ahora*, otro para 🌎 *sismos recientes* (últimas 24 h, con los límites de Ajustes → Alertas) y, en el editor de cada anuncio, un código que lo transmite. Salen por la misma cola y esperan canal libre. ASLSCAN escribe y mantiene esas líneas (marcadas `; ASLSCAN`) y llama a `bin/aslscan-dtmf`.
- Antes de cada cambio se guarda una copia de rpt.conf; Asterisk lee los códigos al reiniciarse (**Aplicar**, como en Tonos).

### Horas de otra zona horaria

Una net «a las 9 pm de Chicago» es a las 9 pm aquí en invierno y a las 8 pm en verano. En lugar de escribir la hora, insértala con **🕗 Hora de otra zona** (junto a las variables): eliges la hora de allá, la zona y cómo decirla. En el texto queda `{hora 21:00 America/Chicago}` y la voz dice la hora correcta de aquí el día que sale: «9 de la noche» ahora, «8 de la noche» cuando EE. UU. cambie al horario de verano, sin tocar el texto.

- Formatos: palabras («9 de la noche», el de siempre), `| 24h` («21:00») o `| 12h` («9 pm»).
- En el editor estas horas se resaltan en verde y abajo dice qué dirán hoy; una mal escrita se marca con ⚠ (y no se lee).
- La voz se genera al momento de salir: los anuncios ya lo hacen, y por eso siempre dicen la hora correcta.
- El diccionario de pronunciación no se aplica dentro del token (la hora se calcula antes).

### Diccionario de pronunciación

**Ajustes → Voz → Diccionario de pronunciación**: una tabla *Escrito* → *Cómo se dice* (p. ej. `WSPR → uísper`, `ON4KST → o ene cuatro ka ese te`). Se aplica a todo lo que dice la voz (anuncios y pruebas), con cualquier motor, justo antes de mandar el texto al motor y después de las variables; lo escrito no cambia.

- Solo palabras completas (`FT8` cambia en «(FT8),» pero no dentro de `FT8CALL`); primero los términos más largos (`FT8 DX` antes que `FT8`); una sola pasada.
- Mayúsculas exactas por defecto; marca **Aa** en un término para ignorarlas.
- ▶ en cada renglón oye solo ese término; **Probar un texto** muestra lo que recibe la voz y lo reproduce, aun antes de guardar.
- **Pegar lista** acepta un término por renglón (`WSPR = uísper`, y `| Aa` para ignorar mayúsculas) y muestra qué es nuevo, qué cambia y qué renglones no entendió; **Copiar lista** da el mismo formato para compartirlo.
- Al guardar, las voces ya generadas que usan un término cambiado (anuncios) se vuelven a generar en segundo plano. Hasta 500 términos; entra en los respaldos.

### Escuchar en vivo

En ASL / HamVOIP agrega esta línea en la sección de tu nodo en `/etc/asterisk/rpt.conf` y reinicia Asterisk (en ASL3, `sudo systemctl restart asterisk`; nunca `rpt restart`):

```
outstreamcmd = /opt/aslscan/bin/aslscan-live
```

En IRLP se enciende en **Ajustes → Sistema → Audio en vivo**.

### Junto con HAMNA Web

Los dos se pueden instalar en el mismo nodo; cada uno tiene su servicio, sus datos y su dirección:

| | HAMNA Web | ASLSCAN |
|---|---|---|
| Página | `/hamna/` (puerto 8090) | `/aslscan/` (puerto 8095) |
| Programa / datos | `/opt/hamna-web`, `/var/lib/hamna` | `/opt/aslscan`, `/var/lib/aslscan` |
| Audio en vivo | UDP 8091 | UDP 8096 |

- **Audio en vivo**: `rpt.conf` acepta un solo `outstreamcmd`. `aslscan-live` manda el audio a los dos programas, y el `hamna-live` de HAMNA Web también desde la versión 1.42; deja solo una de las dos líneas. En IRLP, si HAMNA ya encendió escuchar en vivo, ASLSCAN usa el mismo audio.
- **Telegram**: usa **un bot distinto** para cada uno (Telegram no deja que dos programas lean los mensajes del mismo bot).
- **Los usuarios** son aparte: cada programa tiene los suyos.
- **Respaldos y panel de nodos** usan el mismo protocolo: un nodo con ASLSCAN puede reportar y mandar sus respaldos a un hub con HAMNA Web (1.42 o más nuevo) y al revés.

### Archivos

| Ruta | Qué es |
|---|---|
| `/opt/aslscan/` | El programa (`aslscan/`, `bin/`, `install.sh`, `update.sh`, `uninstall.sh`) |
| `/var/lib/aslscan/` | Datos: `aslscan.db` (usuarios, sesiones, panel), `settings.json`, logo, fotos, respaldos recibidos, `aslscan.log` |
| `/etc/systemd/system/aslscan.service` | El servicio (`journalctl -u aslscan -f`) |

### Desinstalar

```
sudo /opt/aslscan/uninstall.sh            # conserva /var/lib/aslscan
sudo /opt/aslscan/uninstall.sh --delete-data
```

HAMNA Web no se toca.
