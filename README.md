<p align="center"><img src="aslscan/static/logo.svg" width="96" alt="ASLSCAN"></p>

<h1 align="center">ASLSCAN</h1>

<p align="center"><a href="#english"><b>🇺🇸 English</b></a> · <a href="#espanol"><b>🇲🇽 Español</b></a></p>

<a name="english"></a>

## ASLSCAN — a web dashboard for your node

ASLSCAN is the **Dashboard of [HAMNA Web](https://github.com/xe2mbe/hamna)** as a program of its own, for whoever wants to see and control their node from the browser without the broadcast automation. It runs **inside the node** (AllStarLink 3, HamVOIP, ASL2 or IRLP), uses only Python's standard library and keeps HAMNA's user system.

> ASLSCAN is not related to AllScan (by NR9V); it can import AllScan's favorites the first time.

### What it does

- **Dashboard**: the nodes linked right now, with callsign and city (AllStar directory), mode, direction, time connected, IP and who is talking, plus the nodes reachable across the network. **Connect** (transceive, monitor or local monitor) and **disconnect** one or all.
- **Favorites in categories** shown as tabs, with an editor (rename, reorder, drag between categories). The first time they're imported from AllScan.
- **Node search** in the AllStar directory by callsign, node number, description or location, with **● Online / ● No reply / ○ Offline** labels (AllStar DNS + IAX POKE).
- **IRLP**: the node or reflector it's connected to, COS/PTT, the other nodes on the reflector, connect/disconnect, enable/disable, inactivity timeout, AUX outputs, DTMF, the IRLP log and the switch to turn the old IRLPvCON off.
- **🔊 Live listening** from the page (8 kHz, up to 8 listeners).
- **Telegram bot**: 📋 Menu → 🔗 Connections (see, connect with your favorites by category or by number, change the mode, disconnect), 🩺 Health and 🗺 Nodes. Alerts for health, failed backups and nodes that stop reporting.
- **Nodes panel**: each node reports its health, device and version to a hub every minute. ASLSCAN and HAMNA Web nodes can report to the same hub.
- **Users** with roles (administrator, operator, read only), sessions, attempt lockout, photo and language (English / Spanish).
- **Backups**: download/restore, and an automatic daily backup to another node (ASLSCAN or HAMNA Web), Google Drive / OneDrive (rclone) or Telegram.
- **Equipment health**: SD card errors, slow writes, undervoltage, temperature, disk.

### Settings

| Section | What's there |
|---|---|
| **Node** | Node number, station name and logo; test the connection with Asterisk / IRLP |
| **Users** | Same as HAMNA: create, edit, roles, sessions, lockouts |
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

- **Dashboard**: los nodos enlazados en este momento, con indicativo y ciudad (directorio de AllStar), modo, dirección, tiempo conectado, IP y quién está hablando, y los nodos alcanzables en toda la red. **Conectar** (transceptor, monitor o monitor local) y **desconectar** uno o todos.
- **Favoritos por categorías** en pestañas, con editor (renombrar, ordenar, arrastrar entre categorías). La primera vez se importan de AllScan.
- **Buscador de nodos** en el directorio de AllStar por indicativo, número, descripción o lugar, con etiquetas **● En línea / ● Sin resp. / ○ Apagado** (DNS de AllStar + POKE de IAX).
- **IRLP**: a qué nodo o reflector está conectado, COS/PTT, los demás nodos del reflector, conectar/desconectar, habilitar/deshabilitar, desconexión por inactividad, salidas AUX, DTMF, la bitácora de IRLP y el botón para apagar el viejo IRLPvCON.
- **🔊 Escuchar en vivo** desde la página (8 kHz, hasta 8 personas).
- **Bot de Telegram**: 📋 Menú → 🔗 Conexiones (ver, conectar con tus favoritos por categoría o por número, cambiar el modo, desconectar), 🩺 Salud y 🗺 Nodos. Avisos de salud, de respaldos fallidos y de nodos que dejan de reportar.
- **Panel de nodos**: cada nodo manda a un hub su salud, equipo y versión cada minuto. Los nodos con ASLSCAN y con HAMNA Web pueden reportar al mismo hub.
- **Usuarios** con roles (administrador, operador, solo lectura), sesiones, bloqueo por intentos, foto e idioma (inglés / español).
- **Respaldos**: descargar/restaurar, y respaldo automático diario a otro nodo (ASLSCAN o HAMNA Web), Google Drive / OneDrive (rclone) o Telegram.
- **Salud del equipo**: errores de la tarjeta SD, escritura lenta, bajo voltaje, temperatura, disco.

### Ajustes

| Sección | Qué tiene |
|---|---|
| **Nodo** | Número de nodo, nombre de la estación y logo; probar la conexión con Asterisk / IRLP |
| **Usuarios** | Igual que en HAMNA: crear, editar, roles, sesiones, bloqueos |
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
