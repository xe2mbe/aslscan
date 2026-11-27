"""
ASLSCAN — API HTTP y página. Funciona con Python 3.5 a 3.13 sin paquetes extra.
"""
import binascii
import datetime as dt
import json
import logging
import os
import re
import shutil
import threading
import time
import uuid
from pathlib import Path

from . import VERSION, alertas, anuncios, auth, clima, dtmf, horas, pronuncia, tz, autobackup, backends, backup, health, db, links, notify, paths, sessions, settings, sysmon, tts, updates
from .live import live
from .web import App, HTTPError, Response, jsonr, send_file

log = logging.getLogger("aslscan.web")

STATIC = Path(__file__).parent / "static"
app = App(STATIC)


def init_app():
    db.init_db()
    cfg = settings.load()
    if not cfg.get("secret_key"):
        cfg = settings.save({"secret_key": binascii.hexlify(os.urandom(32)).decode()})
    app.secret = cfg["secret_key"]
    auth.init()
    autobackup.init()
    anuncios.init()
    from . import historial
    historial.init()
    anuncios.emisor.start()
    from . import hub
    hub.init()
    app.roles = auth.ROLES
    app.user_loader = lambda req: auth.user_for(req.token, req.ip)
    app.upload_limits["/api/respaldo/restaurar"] = 50 * 2**20
    app.raw_uploads["/api/remoto/respaldo"] = (
        4 * 2**30, lambda req: autobackup.code_check(req.headers.get("X-HAMNA-Backup", "")) is not None)


def require(req, rol):
    if auth.ROLES.get((req.user or {}).get("rol"), 0) < auth.ROLES[rol]:
        raise HTTPError(403, "Tu usuario no tiene permiso para esto")


# ── Utilidades ────────────────────────────────────────────────────────────────
def ok(**kw):
    d = {"ok": True}
    d.update(kw)
    return jsonr(d)


def truthy(v):
    return str(v).lower() in ("1", "true", "on", "yes", "si", "sí")

# ── Página y sesión ──────────────────────────────────────────────────────────
@app.route("/", auth=False)
def index(req):
    return send_file(STATIC / "index.html", "text/html; charset=utf-8")


@app.route("/api/login", ("POST",), auth=False)
def login(req):
    b = req.json()
    if not auth.has_admin():
        raise HTTPError(403, "Aún no hay usuarios. En el nodo ejecuta: aslscan-passwd")
    try:
        token, user = auth.login(b.get("usuario") or "admin", b.get("password") or "",
                                 req.ip, req.headers.get("User-Agent", ""))
    except auth.AuthError as e:
        log.warning("Entrada fallida de «%s» desde %s: %s", (b.get("usuario") or "")[:32], req.ip, e)
        raise HTTPError(401, str(e))
    log.info("Entró %s (%s) desde %s", user["usuario"], user["rol"], req.ip)
    req.login(token)
    return ok(usuario=user)


@app.route("/api/logout", ("POST",), auth=False)
def logout(req):
    auth.logout(req.token)
    req.logout()
    return ok()


@app.route("/api/me", auth=False)
def me(req):
    u = req.user
    return jsonr({"auth": req.authed, "version": VERSION,
                  "station": settings.get("station_name") or "",
                  "logo": _logo_url(),
                  "usuario": {k: u.get(k) for k in ("id", "usuario", "nombre", "rol", "rol_nombre", "idioma", "foto")} if u else None})


def _foto_path(uid):
    return paths.data_dir() / "fotos" / "{}.jpg".format(int(uid))


@app.route("/api/mi-foto", ("POST", "DELETE"), rol="lectura")
def mi_foto(req):
    """Foto de perfil: el navegador ya la manda recortada a 256×256 en JPEG."""
    uid = req.user["id"]
    p = _foto_path(uid)
    if req.method == "DELETE":
        paths.rm(p)
        auth.set_photo(uid, "")
        return ok(foto="")
    up = req.files.get("foto")
    if not up:
        raise ValueError("Elige una imagen")
    with open(up.path, "rb") as f:
        cabeza = f.read(3)
    if cabeza != b"\xff\xd8\xff":
        raise ValueError("La foto debe ser JPEG")
    if os.path.getsize(up.path) > 2 * 1024 * 1024:
        raise ValueError("La foto es muy grande")
    os.makedirs(str(p.parent), exist_ok=True)
    shutil.move(up.path, str(p))
    up.path = None
    v = str(int(time.time()))
    auth.set_photo(uid, v)
    return ok(foto=v)


@app.route("/api/fotos/<int:uid>", rol="lectura")
def foto_usuario(req, uid):
    p = _foto_path(uid)
    if not p.is_file():
        raise HTTPError(404)
    return send_file(p, "image/jpeg")


@app.route("/api/mi-telegram", rol="lectura")
def mi_telegram(req):
    from . import bot
    u = db.row("SELECT tg_id, tg_nombre FROM usuarios WHERE id=?", (req.user["id"],)) or {}
    return jsonr({"vinculado": bool(u.get("tg_id")), "nombre": u.get("tg_nombre") or "",
                  "disponible": bot.activo(), "bot": ("@" + bot.estado()["bot"]) if bot.estado()["bot"] else ""})


@app.route("/api/mi-telegram", ("POST", "DELETE"), rol="lectura")
def mi_telegram_cambiar(req):
    from . import bot
    if req.method == "DELETE":
        auth.set_tg(req.user["id"], "", "")
        log.info("%s desvinculó su Telegram", req.user["usuario"])
        return ok()
    return ok(**bot.nuevo_codigo(req.user["id"]))


@app.route("/api/bot", rol="admin")
def bot_estado(req):
    from . import bot
    return jsonr(bot.estado())


@app.route("/api/mi-nombre", ("PUT",), rol="lectura")
def mi_nombre(req):
    """Cada quien cambia el nombre con que aparece (no el usuario para entrar)."""
    nombre = (req.json().get("nombre") or "").strip()[:60]
    auth.update_user(req.user["id"], nombre=nombre)
    log.info("%s cambió su nombre a «%s»", req.user["usuario"], nombre)
    return ok(nombre=nombre)


@app.route("/api/mi-idioma", ("PUT",), rol="lectura")
def mi_idioma(req):
    auth.set_language(req.user["id"], (req.json().get("idioma") or "").lower())
    return ok()


# ── Usuarios y sesiones abiertas ─────────────────────────────────────────────
@app.route("/api/usuarios", rol="admin")
def usuarios(req):
    return jsonr({"usuarios": auth.users(), "sesiones": auth.sessions(),
                  "bloqueos": auth.locked_list(), "roles": auth.ROL_NOMBRE, "yo": req.user["id"],
                  "mi_sesion": req.user["sid"]})


@app.route("/api/usuarios", ("POST",), rol="admin")
def usuarios_crear(req):
    b = req.json()
    uid = auth.create_user(b.get("usuario"), b.get("nombre"), b.get("rol") or "operador", b.get("password"))
    log.info("%s creó el usuario %s (%s)", req.user["usuario"], b.get("usuario"), b.get("rol"))
    return ok(id=uid)


@app.route("/api/usuarios/<int:uid>", ("PUT",), rol="admin")
def usuarios_editar(req, uid):
    b = req.json()
    f = {k: b[k] for k in ("nombre", "rol", "activo", "password") if k in b}
    if uid == req.user["id"] and (f.get("rol", "admin") != "admin" or f.get("activo") is False):
        raise ValueError("No puedes quitarte el rol de administrador ni desactivarte a ti mismo")
    if b.get("desvincular_tg"):                     # solo quitar su Telegram (Ajustes → Usuarios)
        auth.set_tg(uid, "", "")
        log.info("%s desvinculó el Telegram del usuario #%s", req.user["usuario"], uid)
        if set(b) == {"desvincular_tg"}:
            return ok()
    auth.update_user(uid, cur_sid=req.user["sid"], **f)
    log.info("%s modificó el usuario #%s (%s)", req.user["usuario"], uid, ", ".join(sorted(f)))
    return ok()


@app.route("/api/usuarios/<int:uid>", ("DELETE",), rol="admin")
def usuarios_borrar(req, uid):
    auth.delete_user(uid, req.user["id"])
    paths.rm(_foto_path(uid))
    log.info("%s borró el usuario #%s", req.user["usuario"], uid)
    return ok()


@app.route("/api/usuarios/desbloquear", ("POST",), rol="admin")
def usuarios_desbloquear(req):
    auth.unlock_all()
    return ok()


@app.route("/api/mis-sesiones", rol="lectura")
def mis_sesiones(req):
    return jsonr({"sesiones": auth.sessions(req.user["id"]), "mi_sesion": req.user["sid"]})


@app.route("/api/mis-sesiones/<int:sid>", ("DELETE",), rol="lectura")
def cerrar_sesion(req, sid):
    if req.user["rol"] == "admin":
        auth.revoke(sid)                   # el administrador puede cerrar cualquiera
    else:
        auth.revoke(sid, req.user["id"])
    return ok()


@app.route("/api/mis-sesiones/otras", ("POST",), rol="lectura")
def cerrar_otras(req):
    auth.revoke_user(req.user["id"], except_sid=req.user["sid"])
    return ok()


# ── Logo de la estación ──────────────────────────────────────────────────────
# El navegador lo reduce antes de subirlo; aquí solo se valida y se guarda,
# para no gastar CPU de la Raspberry procesando imágenes.
LOGO_MAX = 2 * 2**20
LOGO_TYPES = ((b"\x89PNG\r\n\x1a\n", "png"), (b"\xff\xd8\xff", "jpg"),
              (b"GIF87a", "gif"), (b"GIF89a", "gif"))


def _logo_ext(head):
    for magic, ext in LOGO_TYPES:
        if head.startswith(magic):
            return ext
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    return None


def _logo_url():
    name = settings.get("logo_file") or ""
    return "api/logo?v=" + name if name and (paths.data_dir() / name).is_file() else ""


@app.route("/api/logo", auth=False)
def logo(req):
    name = settings.get("logo_file") or ""
    if not name:
        raise HTTPError(404)
    r = send_file(paths.data_dir() / name, cache=True)
    r.headers["X-Content-Type-Options"] = "nosniff"
    return r


@app.route("/api/ajustes/logo", ("POST", "DELETE"), rol="admin")
def ajustes_logo(req):
    cur = settings.get("logo_file") or ""
    dest = None
    if req.method == "POST":
        up = req.files.get("archivo")
        if not up:
            raise ValueError("Elige una imagen")
        if os.path.getsize(up.path) > LOGO_MAX:
            raise ValueError("La imagen pesa más de 2 MB")
        with open(up.path, "rb") as f:
            ext = _logo_ext(f.read(16))
        if not ext:
            raise ValueError("Formato no soportado. Usa PNG, JPG, WEBP o GIF")
        dest = paths.data_dir() / "logo_{}.{}".format(uuid.uuid4().hex[:6], ext)
        shutil.move(up.path, str(dest))
        up.path = None
    if cur and (dest is None or cur != dest.name):
        paths.rm(paths.data_dir() / cur)
    settings.save({"logo_file": dest.name if dest else ""})
    return ok(logo=_logo_url())


# ── Estado e información ─────────────────────────────────────────────────────
@app.route("/api/status")
def status(req):
    return jsonr({"on_air": False, "state": "idle",
                  "now": dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                  "utc": dt.datetime.utcnow().strftime("%H:%M"), "ts": round(time.time(), 1),
                  "sys": sysmon.snapshot(), "version": VERSION, "envivo": live.status(),
                  "salud": health.worst()})


@app.route("/api/salud")
def salud(req):
    return jsonr(health.status())


@app.route("/api/salud/revisar", ("POST",), rol="admin")
def salud_revisar(req):
    return jsonr(health.check_now())


# ── Escuchar en vivo ─────────────────────────────────────────────────────────
@app.route("/api/en-vivo/irlp", ("POST",), rol="admin")
def en_vivo_irlp(req):
    on = bool((req.json() or {}).get("on"))
    try:
        r = live.irlp_cambiar(on)
    except RuntimeError as e:
        raise HTTPError(400, str(e))
    log.info("%s %s escuchar en vivo (IRLP)", req.user["usuario"], "encendió" if on else "apagó")
    return jsonr(r)


@app.route("/api/en-vivo")
def en_vivo(req):
    if not live.started:
        raise RuntimeError("El audio en vivo no está activo en este nodo")
    gen = live.stream(req.ip, req.user["usuario"] if req.user else "-")
    return Response(stream=gen, ctype="application/octet-stream",
                    headers={"X-Audio-Format": "mulaw;rate=8000"})


@app.route("/api/info")
def info(req):
    cfg = settings.load()
    du = shutil.disk_usage(str(paths.data_dir()))
    return jsonr({
        "version": VERSION, "backend": backends.info(cfg), "detectado": backends.detect(),
        "sabor": backends.detect_flavor(), "nodo_detectado": backends.detect_asl_node(),
        "zona_horaria": time.strftime("%Z"), "disco_libre_mb": du.free // 2**20,
        "sistemas": links.detect_systems(),
    })


@app.route("/api/actualizaciones", rol="admin")
def actualizaciones(req):
    d = updates.check(force=req.query.get("forzar") == "1")
    d["sabor"] = backends.detect_flavor()
    return jsonr(d)


@app.route("/api/prueba/nodo", ("POST",))
def prueba_nodo(req):
    good, msg = backends.test(settings.load())
    return ok(bien=good, mensaje=msg)


# ── Telegram ─────────────────────────────────────────────────────────────────
@app.route("/api/avisos/chats", ("POST",), rol="admin")
def avisos_chats(req):
    return ok(**notify.find_chats(req.json().get("token")))


@app.route("/api/avisos/probar", ("POST",), rol="admin")
def avisos_probar(req):
    b = req.json()
    txt = "✅ Prueba de ASLSCAN (enviada por {}).".format(notify.esc(req.user["usuario"]))
    notify.send_now(notify.header() + "\n" + txt, b.get("token"), b.get("chat"))
    return ok()


# ── Sesiones (nodos conectados) ──────────────────────────────────────────────
@app.route("/api/sesiones")
def sesiones_get(req):
    return jsonr(sessions.status(settings.load(), req.query.get("nodo")))


@app.route("/api/sesiones/historial")
def sesiones_historial(req):
    from . import historial
    try:
        dias = int(req.query.get("dias") or 1)
    except ValueError:
        dias = 1
    return jsonr(historial.listar(dias, req.query.get("nodo") or ""))


@app.route("/api/sesiones/<accion>", ("POST",))
def sesiones_accion(req, accion):
    b = req.json()
    destino = str(b.get("destino") or "").strip()
    if accion == "conectar":
        acc = "conectar"
    elif accion == "desconectar":
        acc = "desconectar" if destino else "desconectar_todo"
    else:
        raise HTTPError(404)
    cmd = sessions.action(settings.load(), acc, destino, b.get("modo") or "transceptor", b.get("nodo"),
                          origen="Dashboard · " + req.user["usuario"])
    log.info("Sesiones: %s", cmd)
    return ok(comando=cmd)


# ── Control del nodo IRLP (lo que hacía IRLPvCON) ───────────────────────────
def _irlp_requerido(cfg):
    kind = cfg.get("backend") or "auto"
    if kind == "auto":
        kind = backends.detect()
    if kind != "irlp":
        raise HTTPError(404, "Este nodo no es IRLP")


@app.route("/api/irlp")
def irlp_estado(req):
    from . import irlpctl
    cfg = settings.load()
    _irlp_requerido(cfg)
    return jsonr(irlpctl.estado(cfg))


@app.route("/api/irlp/bitacora")
def irlp_bitacora(req):
    from . import irlpctl
    _irlp_requerido(settings.load())
    try:
        n = int(req.query.get("n") or 100)
    except ValueError:
        n = 100
    return jsonr({"lineas": irlpctl.bitacora(n)})


@app.route("/api/irlp/favoritos", ("PUT",), rol="admin")
def irlp_favoritos(req):
    from . import irlpctl
    _irlp_requerido(settings.load())
    b = req.json()
    favs, cats = irlpctl.guardar_favoritos(b.get("favoritos"), b.get("categorias"))
    log.info("%s guardó %d favoritos de IRLP en %d categorías", req.user["usuario"], len(favs), len(cats))
    return ok(favoritos=favs, categorias=cats)


@app.route("/api/irlp/vcon", rol="admin")
def irlp_vcon_estado(req):
    from . import irlpctl
    _irlp_requerido(settings.load())
    return jsonr(irlpctl.vcon_estado())


@app.route("/api/irlp/vcon", ("POST",), rol="admin")
def irlp_vcon(req):
    from . import irlpctl
    _irlp_requerido(settings.load())
    encender = bool(req.json().get("encender"))
    st = irlpctl.vcon(encender)
    log.info("%s %s IRLPvCON", req.user["usuario"], "encendió" if encender else "apagó")
    return ok(**st)


@app.route("/api/sesiones/buscar")
def sesiones_buscar(req):
    """Buscar nodos en el directorio de AllStar por número, indicativo o lugar."""
    q = str(req.query.get("q") or "")[:40]
    res, total, hay = sessions.search(q)
    return jsonr({"resultados": res, "total": total, "directorio": hay, "max": sessions.BUSCAR_MAX})


@app.route("/api/sesiones/presencia")
def sesiones_presencia(req):
    """¿En línea? responde / registrado (no contesta) / fuera, para ?nodos=1,2,3."""
    from . import presencia
    nodos = [n for n in str(req.query.get("nodos") or "").split(",") if n][:presencia.MAX_NODOS]
    return jsonr({"estados": presencia.estado(nodos)})


@app.route("/api/sesiones/favoritos")
def sesiones_favoritos(req):
    """Favoritos de ASL (los mismos que ofrece el bot; la primera vez se importan de AllScan)."""
    from . import favoritos
    nodo = str(req.query.get("nodo") or settings.get("node") or "")
    favs, cats = favoritos.asl_todo(nodo if re.match(r"^\d{3,7}$", nodo) else "")
    return jsonr({"favoritos": favs, "categorias": cats})


@app.route("/api/sesiones/favoritos", ("PUT",), rol="admin")
def sesiones_favoritos_guardar(req):
    from . import favoritos
    b = req.json()
    favs, cats = favoritos.guardar_asl(b.get("favoritos"), b.get("categorias"))
    log.info("%s guardó %d favoritos de ASL en %d categorías", req.user["usuario"], len(favs), len(cats))
    return ok(favoritos=favs, categorias=cats)


@app.route("/api/irlp/<accion>", ("POST",))
def irlp_accion(req, accion):
    from . import irlpctl
    _irlp_requerido(settings.load())
    if accion not in ("habilitar", "deshabilitar", "dtmf", "timeout", "aux"):
        raise HTTPError(404)
    hecho = irlpctl.accion(accion, req.json().get("valor"))
    with sessions._cache_lock:
        sessions._cache["key"] = None
    log.info("IRLP: %s (%s)", hecho, req.user["usuario"])
    return ok(hecho=hecho)


# ── Tonos de cortesía (rpt.conf) ─────────────────────────────────────────────
@app.route("/api/tonos", rol="admin")
def tonos(req):
    from . import rptconf
    return jsonr(rptconf.estado(settings.load()))


@app.route("/api/tonos", ("PUT",), rol="admin")
def tonos_guardar(req):
    from . import rptconf
    b = req.json()
    st = rptconf.guardar(settings.load(), b.get("tonos") or {}, b.get("uso") or {}, b.get("borrar") or [],
                         b.get("tiempos") or {})
    log.info("%s cambió los tonos de cortesía en rpt.conf", req.user["usuario"])
    return ok(**st)


@app.route("/api/tonos/aplicar", ("POST",), rol="admin")
def tonos_aplicar(req):
    from . import rptconf
    return ok(aplicando=rptconf.aplicar(settings.load(), req.user["usuario"]))


# ── Ajustes ──────────────────────────────────────────────────────────────────
NUM_KEYS = {"ab_keep": int, "ab_recv_keep": int, "hub_alerta_min": int, "azure_rate": int, "azure_pitch": int,
            "eleven_stability": int, "eleven_similarity": int, "eleven_speed": int}
BOOL_KEYS = {"rc_on", "tg_enabled", "tg_on_backup", "tg_on_health", "tg_bot_on", "ab_tg_on", "hub_on", "tg_on_nodes",
             "ab_enabled", "ab_node_on", "ab_cloud_on", "al_clima_on", "al_pron_on", "al_pron_tormenta", "al_sismo_on"}
AL_NUM = ("al_viento", "al_racha", "al_lluvia", "al_presion", "al_calor", "al_frio", "al_repetir_min", "al_pron_horas",
          "al_pron_prob", "al_pron_mm", "al_pron_racha", "al_pron_calor", "al_pron_frio", "al_sismo_cerca_km",
          "al_sismo_cerca_mag", "al_sismo_region_km", "al_sismo_region_mag", "al_sismo_mundo_mag", "al_sismo_repetir",
          "al_sismo_cada")
STR_KEYS = {"backend", "node", "irlp_env", "station_name", "tg_chat",
            "ab_hora", "ab_node_url", "ab_node_pin", "ab_cloud_folder", "hub_url", "hub_pin",
            "tts_engine", "azure_region", "azure_voice", "azure_style", "espeak_voice",
            "eleven_voice", "eleven_voice_name", "eleven_model",
            "wx_lat", "wx_lon", "wx_lugar", "wx_unidades", "wx_pws_station",
            "al_clima_desde", "al_clima_hasta", "al_clima_destino", "al_pron_antes", "al_sismo_destino"} | set(AL_NUM)
SECRET_IN = ("tg_token", "ab_node_token", "hub_token", "azure_key", "eleven_key", "wx_pws_key")


@app.route("/api/ajustes")
def ajustes(req):
    return jsonr(settings.public())


@app.route("/api/ajustes", ("PUT",), rol="admin")
def ajustes_save(req):
    upd = {}
    for k, v in req.json().items():
        if k in NUM_KEYS:
            try:
                upd[k] = NUM_KEYS[k](float(v))
            except (TypeError, ValueError):
                raise ValueError("Valor inválido en " + k)
        elif k in BOOL_KEYS:
            upd[k] = v if isinstance(v, bool) else truthy(v)
        elif k in STR_KEYS:
            upd[k] = str(v).strip()
        elif k in SECRET_IN and str(v).strip():
            upd[k] = str(v).strip()
    if "ab_hora" in upd and not re.match(r"^([01]\d|2[0-3]):[0-5]\d$", upd["ab_hora"]):
        raise ValueError("Hora del respaldo inválida (HH:MM)")
    if "hub_alerta_min" in upd and not 0 <= upd["hub_alerta_min"] <= 1440:
        raise ValueError("Minutos para avisar de un nodo: de 0 a 1440")
    for k in ("ab_keep", "ab_recv_keep"):
        if k in upd and not 1 <= upd[k] <= 60:
            raise ValueError("Copias a conservar: de 1 a 60")
    if upd.get("node") and not re.match(r"^[A-Za-z0-9]{1,10}$", upd["node"]):
        raise ValueError("Número de nodo inválido")
    if upd.get("backend") not in (None, "auto", "asl", "irlp", "simulado"):
        raise ValueError("Tipo de nodo inválido")
    if "azure_region" in upd:              # «South Central US» → southcentralus
        upd["azure_region"] = re.sub(r"[^a-z0-9]", "", upd["azure_region"].lower())
    if upd.get("tts_engine") not in (None, "", "azure", "elevenlabs", "piper", "espeak"):
        raise ValueError("Motor de voz inválido")
    if "azure_rate" in upd and not 50 <= upd["azure_rate"] <= 200:
        raise ValueError("Velocidad de la voz: de 50 a 200 %")
    if "azure_pitch" in upd and not -50 <= upd["azure_pitch"] <= 50:
        raise ValueError("Tono de la voz: de -50 a 50 Hz")
    for k in ("eleven_stability", "eleven_similarity"):
        if k in upd and not 0 <= upd[k] <= 100:
            raise ValueError("ElevenLabs: estabilidad y parecido van de 0 a 100 %")
    if "eleven_speed" in upd and not 70 <= upd["eleven_speed"] <= 120:
        raise ValueError("ElevenLabs: velocidad de 70 a 120 %")
    _clima_valida(upd)
    _alertas_valida(upd)
    settings.save(upd)
    return ok(ajustes=settings.public())


# ── Programación → Anuncios ──────────────────────────────────────────────────
def _anuncio_req(req, aid=None):
    try:
        datos = json.loads(req.form.get("datos") or "{}")
    except ValueError:
        raise ValueError("Datos del anuncio inválidos")
    up = req.files.get("archivo")
    actual = anuncios.uno(aid) if aid else {}
    # El código DTMF cambia rpt.conf: solo el administrador lo pone o lo quita
    if req.user["rol"] != "admin" or "dtmf" not in datos:
        datos["dtmf"] = actual.get("dtmf", "")
    elif datos["dtmf"]:
        datos["dtmf"] = dtmf.validar_atajo(datos["dtmf"], "anuncio:{}".format(aid or 0))
    a = anuncios.guardar(datos, up.path if up else None, up.filename if up else "", req.user["usuario"], aid)
    if (a.get("dtmf") or "") != (actual.get("dtmf") or "") or (a.get("dtmf") and a["nombre"] != actual.get("nombre")):
        _dtmf_sync()
    return a


def _dtmf_sync():
    try:
        dtmf.sincronizar()
    except Exception as e:
        log.exception("DTMF")
        raise ValueError("Se guardó, pero no pude escribir el código DTMF en rpt.conf: {}".format(e))


@app.route("/api/anuncios")
def anuncios_lista(req):
    return jsonr(anuncios.resumen())


@app.route("/api/anuncios", ("POST",), rol="operador")
def anuncios_nuevo(req):
    return ok(anuncio=_anuncio_req(req))


@app.route("/api/anuncios/<int:aid>", ("PUT",), rol="operador")
def anuncios_editar(req, aid):
    return ok(anuncio=_anuncio_req(req, aid))


@app.route("/api/anuncios/<int:aid>", ("DELETE",), rol="operador")
def anuncios_borrar(req, aid):
    tenia = (anuncios.uno(aid).get("dtmf") or "")
    anuncios.borrar(aid, req.user["usuario"])
    if tenia:
        _dtmf_sync()
    return ok()


# ── Ajustes → DTMF ───────────────────────────────────────────────────────────
@app.route("/api/dtmf", rol="admin")
def dtmf_info(req):
    return jsonr(dtmf.estado())


@app.route("/api/dtmf", ("POST",), rol="admin")
def dtmf_guardar(req):
    b = req.json()
    st = dtmf.guardar_comando(b.get("codigo"), b.get("tipo"), b.get("args"), b.get("comentario", ""), b.get("antes", ""))
    log.info("%s guardó el DTMF *%s", req.user["usuario"], dtmf.normalizar_codigo(b.get("codigo")))
    return ok(estado=st)


@app.route("/api/dtmf/<codigo>", ("DELETE",), rol="admin")
def dtmf_borrar(req, codigo):
    st = dtmf.borrar_comando(codigo)
    log.info("%s borró el DTMF *%s", req.user["usuario"], codigo)
    return ok(estado=st)


@app.route("/api/dtmf/probar", ("POST",), rol="admin")
def dtmf_probar(req):
    c = req.json().get("codigo")
    log.info("%s probó el DTMF *%s", req.user["usuario"], c)
    return ok(salida=dtmf.probar(c))


@app.route("/api/dtmf/atajos", ("POST",), rol="admin")
def dtmf_atajos(req):
    b = req.json()
    cfg = settings.load()
    upd = {"dtmf_clima": dtmf.validar_atajo(b.get("clima", ""), "clima", cfg),
           "dtmf_sismos": dtmf.validar_atajo(b.get("sismos", ""), "sismos", cfg)}
    if upd["dtmf_clima"] and upd["dtmf_clima"] == upd["dtmf_sismos"]:
        raise ValueError("Clima y sismos no pueden tener el mismo código")
    if upd["dtmf_clima"] and upd["dtmf_sismos"] and dtmf._conflicto(upd["dtmf_clima"], [upd["dtmf_sismos"]]):
        raise ValueError("Los códigos de clima y sismos chocan entre sí")
    settings.save(upd)
    _dtmf_sync()
    return ok(estado=dtmf.estado())


@app.route("/api/dtmf/aplicar", ("POST",), rol="admin")
def dtmf_aplicar(req):
    from . import rptconf
    return ok(aplicando=rptconf.aplicar(settings.load(), req.user["usuario"]))


@app.route("/api/anuncios/<int:aid>/activo", ("POST",), rol="operador")
def anuncios_activo(req, aid):
    return ok(anuncio=anuncios.activar(aid, truthy(req.json().get("activo")), req.user["usuario"]))


@app.route("/api/anuncios/<int:aid>/ahora", ("POST",), rol="operador")
def anuncios_ahora(req, aid):
    a = anuncios.uno(aid)
    destino = (req.json() or {}).get("destino")
    if destino not in (None, "local", "red"):
        raise ValueError("Destino inválido")
    if not anuncios.emisor.encolar(aid, "manual:" + req.user["usuario"], destino):
        raise ValueError("Ese anuncio ya está en espera o al aire")
    log.info("%s mandó al aire el anuncio «%s»", req.user["usuario"], a["nombre"])
    return ok()


@app.route("/api/anuncios/<int:aid>/audio")
def anuncios_audio(req, aid):
    p = anuncios.ruta(anuncios.uno(aid))
    if not p or not p.is_file():
        raise HTTPError(404)
    return send_file(p, "audio/wav")


@app.route("/api/anuncios/voz", ("POST",), rol="operador")
def anuncios_voz(req):
    """Escuchar el texto con la voz configurada antes de guardar."""
    b = req.json()
    cfg = settings.load()
    if isinstance(b.get("diccionario"), list):         # probar el diccionario antes de guardarlo
        cfg = dict(cfg, pron_dict=pronuncia.normalizar(b["diccionario"]))
    nombre, dicho, dur = anuncios.vista_previa(str(b.get("texto") or "")[:2000], cfg)
    return ok(url="api/tmp/" + nombre, texto=dicho, duracion=round(dur, 1), max_seg=anuncios.MAX_SEG)


@app.route("/api/tmp/<name>")
def tmp_audio(req, name):
    if not re.match(r"^voz_[0-9a-f]{8}\.wav$", name):
        raise HTTPError(404)
    return send_file(paths.tmp_dir() / name, "audio/wav")


# ── Variables de hora con zona ({hora 21:00 America/Chicago}, {hora_evento …}) ──
@app.route("/api/horas/probar", ("POST",), rol="lectura")
def horas_probar(req):
    return ok(items=horas.revisar(str(req.json().get("texto") or "")[:4000]))


@app.route("/api/zonas", rol="lectura")
def zonas(req):
    return jsonr({"nodo": tz.node_zone(), "zonas": [{"id": z, "nombre": n} for z, n in tz.ZONAS if z and tz.valid(z)]})


# ── Diccionario de pronunciación ────────────────────────────────────────────
@app.route("/api/pronuncia", rol="admin")
def pronuncia_ver(req):
    return jsonr({"lista": settings.get("pron_dict") or [], "max": pronuncia.MAX})


@app.route("/api/pronuncia/probar", ("POST",), rol="admin")
def pronuncia_probar(req):
    b = req.json()
    lista = pronuncia.normalizar(b.get("diccionario")) if isinstance(b.get("diccionario"), list) else settings.get("pron_dict") or []
    texto, usados = pronuncia.aplicar(str(b.get("texto") or "")[:2000], lista)
    return ok(texto=texto, usados=usados)


@app.route("/api/pronuncia", ("PUT",), rol="admin")
def pronuncia_guardar(req):
    nueva = pronuncia.normalizar(req.json().get("lista"))
    vieja = settings.get("pron_dict") or []
    settings.save({"pron_dict": nueva})
    cambios = pronuncia.cambiados(vieja, nueva)
    log.info("%s guardó el diccionario de pronunciación (%d términos, %d cambios)", req.user["usuario"], len(nueva), len(cambios))
    ans = anuncios.usan(cambios) if cambios else []
    if ans:
        threading.Thread(target=anuncios.rehacer_voces, args=(cambios,), daemon=True, name="aslscan-pronuncia").start()
    return ok(lista=nueva, secciones=[], anuncios=ans)


@app.route("/api/voz", rol="lectura")
def voz_info(req):
    cfg = settings.load()
    return jsonr({"motores": tts.motores(), "motor": tts.motor(cfg), "lista": tts.configurado(cfg),
                  "nombres": tts.NOMBRES, "azure_key_set": bool(cfg.get("azure_key")),
                  "eleven_key_set": bool(cfg.get("eleven_key"))})


@app.route("/api/elevenlabs/voces", ("POST",), rol="admin")
def eleven_voces(req):
    key = (req.json().get("eleven_key") or settings.load().get("eleven_key") or "").strip()
    if not key:
        raise ValueError("Escribe la clave de ElevenLabs")
    return ok(voces=tts.eleven_voces(key))


# ── Ajustes → Clima ──────────────────────────────────────────────────────────
def _clima_valida(upd):
    for k, lim in (("wx_lat", 90), ("wx_lon", 180)):
        if upd.get(k):
            try:
                v = float(upd[k].replace(",", "."))
            except ValueError:
                raise ValueError("Latitud y longitud: números, p. ej. 24.0277 y -104.6532")
            if not -lim <= v <= lim:
                raise ValueError("Latitud de -90 a 90 y longitud de -180 a 180")
            upd[k] = "{:.4f}".format(v)
    if upd.get("wx_unidades") not in (None, "metric", "imperial"):
        raise ValueError("Unidades inválidas")
    if "wx_lugar" in upd:
        upd["wx_lugar"] = upd["wx_lugar"][:60]
    if "wx_pws_station" in upd:
        upd["wx_pws_station"] = re.sub(r"[^A-Za-z0-9_-]", "", upd["wx_pws_station"])[:30]


def _alertas_valida(upd):
    for k in AL_NUM:
        if upd.get(k):
            try:
                upd[k] = "{:g}".format(float(upd[k].replace(",", ".")))
            except ValueError:
                raise ValueError("Alertas: «{}» no es un número".format(upd[k]))
    for k in ("al_clima_desde", "al_clima_hasta"):
        if k in upd and not re.match(r"^([01]\d|2[0-3]):[0-5]\d$", upd[k]):
            raise ValueError("Horario de las alertas del clima inválido (HH:MM)")
    for k in ("al_clima_destino", "al_sismo_destino"):
        if k in upd and upd[k] not in ("local", "red"):
            raise ValueError("Destino de las alertas inválido")
    if "al_pron_antes" in upd:
        mins = alertas._lista_min(upd["al_pron_antes"])
        if upd["al_pron_antes"].strip() and not mins:
            raise ValueError("Pronóstico: escribe los minutos antes, separados por coma (p. ej. 120, 30)")
        upd["al_pron_antes"] = ", ".join(str(m) for m in mins)


@app.route("/api/alertas", rol="lectura")
def alertas_info(req):
    r = alertas.resumen()
    cfg = settings.load()
    r["ejemplos"] = {k: alertas.ejemplo(k, cfg) for k in alertas.EJEMPLOS}
    return jsonr(r)


@app.route("/api/alertas/revisar", ("POST",), rol="operador")
def alertas_revisar(req):
    if not clima.configurado(settings.load()):
        raise ValueError("Primero pon la ubicación en Ajustes → Clima")
    alertas.revisar_ahora()
    return alertas_info(req)


@app.route("/api/clima/buscar", rol="admin")
def clima_buscar(req):
    return ok(lugares=clima.buscar_lugar(req.query.get("q", ""), req.query.get("idioma", "es")))


@app.route("/api/clima/probar", ("POST",), rol="admin")
def clima_probar(req):
    """Prueba con lo que está escrito en la página (sin guardar); la clave vacía = la guardada."""
    cfg = settings.load()
    b = req.json()
    upd = {k: str(b[k]).strip() for k in ("wx_lat", "wx_lon", "wx_lugar", "wx_unidades", "wx_pws_station") if k in b}
    _clima_valida(upd)
    cfg.update(upd)
    if str(b.get("wx_pws_key") or "").strip():
        cfg["wx_pws_key"] = str(b["wx_pws_key"]).strip()
    return ok(**clima.probar(cfg))


@app.route("/api/azure/voces", ("POST",), rol="admin")
def azure_voces(req):
    cfg = settings.load()
    b = req.json()
    key = (b.get("azure_key") or cfg.get("azure_key") or "").strip()
    region = re.sub(r"[^a-z0-9]", "", (b.get("azure_region") or cfg.get("azure_region") or "").lower())
    if not key or not region:
        raise ValueError("Escribe la clave y la región de Azure")
    try:
        return ok(voces=tts.azure_voces(key, region))
    except RuntimeError:
        raise
    except Exception as e:
        raise RuntimeError("Azure no respondió: {}".format(e))


# ── Respaldo y restauración ──────────────────────────────────────────────────
@app.route("/api/respaldo", rol="admin")
def respaldo_info(req):
    e = backup.estimate()
    e["copias"] = [d.name for d in backup._old_copies()]
    e["libre"] = shutil.disk_usage(str(paths.data_dir())).free
    return jsonr(e)


@app.route("/api/respaldo/descargar", rol="admin")
def respaldo_descargar(req):
    con = truthy(req.query.get("audios", "0"))
    nombre = backup.filename(con)
    gen = backup.stream(con, req.user["usuario"])
    return Response(stream=gen, ctype="application/gzip",
                    headers={"Content-Disposition": 'attachment; filename="{}"'.format(nombre)})


@app.route("/api/respaldo/restaurar", ("POST",), rol="admin")
def respaldo_restaurar(req):
    up = req.files.get("archivo")
    if not up:
        raise ValueError("Elige el archivo de respaldo (.tar.gz)")
    r = backup.restore(up.path, truthy(req.form.get("conservar_nodo", "1")), req.user["usuario"])
    backup.restart_soon()
    return ok(**r)


# ── Respaldo automático ──────────────────────────────────────────────────────
@app.route("/api/autorespaldo", rol="admin")
def autorespaldo_info(req):
    cfg = settings.load()
    st = autobackup.load_state()
    return jsonr({"estado": st, "corriendo": autobackup.running(),
                  "destinos": autobackup.destinations(cfg), "rclone": autobackup.rclone_version(),
                  "nube": autobackup.cloud_info(), "nube_carpeta": autobackup._cloud_dir(cfg).split(":", 1)[1],
                  "audios_cambiaron": autobackup.audios_changed(st), "telegram": autobackup.tg_info(cfg)})


@app.route("/api/autorespaldo/ahora", ("POST",), rol="admin")
def autorespaldo_ahora(req):
    audios = str(req.json().get("audios") or "auto")
    if audios not in ("auto", "si", "no"):
        raise ValueError("Opción de audios inválida")
    if autobackup.running():
        raise ValueError("Ya se está haciendo un respaldo")
    if not autobackup.destinations(settings.load()):
        raise ValueError("Primero configura y guarda al menos un destino (otro nodo o nube)")
    autobackup.run_bg("manual · " + req.user["usuario"], audios)
    return ok()


@app.route("/api/autorespaldo/probar-nodo", ("POST",), rol="admin")
def autorespaldo_probar(req):
    b = req.json()
    codigo = (b.get("codigo") or "").strip() or settings.get("ab_node_token") or ""
    if not codigo:
        raise ValueError("Falta el código de acceso del nodo destino")
    return ok(**autobackup.probe_node(b.get("url") or "", codigo))



# ── Panel de nodos ───────────────────────────────────────────────────────────
@app.route("/api/remoto/latido", ("POST",), auth=False)
def remoto_latido(req):
    """Un nodo reporta su estado al hub (mismo código de acceso que el respaldo)."""
    from . import hub
    if not autobackup.code_check(req.headers.get("X-HAMNA-Backup", "")):
        raise HTTPError(401, "Código de acceso inválido")
    hub.recibir(req.json(), req.ip)
    cfg = settings.load()
    return ok(estacion=cfg.get("station_name") or "", nodo=cfg.get("node") or "", version=VERSION)


@app.route("/api/nodos")
def nodos_panel(req):
    from . import hub
    return jsonr(hub.panel())


@app.route("/api/nodos/<nodo>", ("DELETE",), rol="admin")
def nodos_quitar(req, nodo):
    from . import hub
    hub.quitar(nodo)
    log.info("%s quitó el nodo %s del panel", req.user["usuario"], nodo)
    return ok()


@app.route("/api/nodos/<nodo>/urls", ("PUT",), rol="admin")
def nodos_urls(req, nodo):
    from . import hub
    b = req.json()
    r = hub.guardar_urls(nodo, b.get("url_int"), b.get("url_ext"))
    log.info("%s cambió las direcciones del dashboard del nodo %s", req.user["usuario"], nodo)
    return ok(**r)


@app.route("/api/hub", rol="admin")
def hub_estado(req):
    from . import hub
    return jsonr(hub.estado_envio())


@app.route("/api/hub/probar", ("POST",), rol="admin")
def hub_probar(req):
    from . import hub
    b = req.json()
    url = (b.get("url") or "").strip()
    codigo = (b.get("codigo") or "").strip()
    d_url, d_tok, _pin = hub.destino()
    url, codigo = url or d_url, codigo or (settings.get("hub_token") if url else "") or d_tok
    if not url or not codigo:
        raise ValueError("Falta la dirección o el código de acceso del hub")
    return ok(**autobackup.probe_node(url, codigo))


@app.route("/api/autorespaldo/nube", ("POST", "DELETE"), rol="admin")
def autorespaldo_nube(req):
    if req.method == "DELETE":
        autobackup.cloud_remove()
        log.info("%s quitó la nube de respaldos", req.user["usuario"])
        return ok()
    b = req.json()
    tipo = autobackup.cloud_setup(str(b.get("tipo") or ""), str(b.get("token") or ""))
    log.info("%s configuró la nube de respaldos (%s)", req.user["usuario"], tipo)
    return ok(nube=tipo)


# Lado que recibe
@app.route("/api/respaldos-recibidos", rol="admin")
def recibidos(req):
    return jsonr({"codigos": autobackup.codes(), "nodos": autobackup.received(),
                  "conservar": int(settings.get("ab_recv_keep") or 7), "con_audios": autobackup.KEEP_CON_AUDIOS})


@app.route("/api/respaldos-recibidos/codigos", ("POST",), rol="admin")
def recibidos_codigo(req):
    token = autobackup.code_create(req.json().get("etiqueta") or "")
    log.info("%s creó un código para recibir respaldos", req.user["usuario"])
    return ok(codigo=token)


@app.route("/api/respaldos-recibidos/codigos/<int:cid>", ("DELETE",), rol="admin")
def recibidos_codigo_del(req, cid):
    autobackup.code_revoke(cid)
    return ok()


@app.route("/api/respaldos-recibidos/<nodo>/<nombre>", rol="admin")
def recibidos_archivo(req, nodo, nombre):
    f = autobackup.received_file(str(nodo), str(nombre))
    if not f:
        raise HTTPError(404, "Ese respaldo ya no existe")
    r = send_file(f, "application/gzip")
    r.headers["Content-Disposition"] = 'attachment; filename="{}"'.format(f.name)
    return r


@app.route("/api/remoto/respaldo", ("GET", "POST"), auth=False)
def remoto_respaldo(req):
    token = req.headers.get("X-HAMNA-Backup", "")
    if not autobackup.code_check(token):
        raise HTTPError(401, "Código de acceso inválido")
    if req.method == "GET":
        cfg = settings.load()
        return ok(estacion=cfg.get("station_name") or "", nodo=cfg.get("node") or "", version=VERSION,
                  libre_mb=shutil.disk_usage(str(paths.data_dir())).free // 2**20)
    up = req.files.get("cuerpo")
    if not up:
        raise ValueError("No llegó el respaldo")
    try:
        est = bytes.fromhex(req.headers.get("X-HAMNA-Estacion", "")).decode("utf-8", "replace")[:80]
    except ValueError:
        est = ""
    name = autobackup.receive(token, up.path, req.headers.get("X-HAMNA-Nodo", ""), est,
                              req.headers.get("X-HAMNA-Version", "")[:20], req.ip)
    up.path = None
    return ok(guardado=name)


@app.route("/api/ajustes/password", ("POST",), rol="lectura")
def ajustes_password(req):
    """Cada quien cambia su propia contraseña; cierra sus otras sesiones."""
    b = req.json()
    auth.change_own_password(req.user, b.get("actual"), b.get("nueva"))
    log.info("%s cambió su contraseña", req.user["usuario"])
    return ok()
