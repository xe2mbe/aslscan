"""
ASLSCAN — bot de Telegram para conectar y desconectar nodos.

Un hilo le pregunta a Telegram por mensajes nuevos (getUpdates con espera
larga: casi no gasta), así funciona detrás del módem sin abrir puertos.

  Vincular   en «Mi perfil» se pide un código de 6 dígitos (10 min); el usuario
             se lo manda al bot (/start CÓDIGO o /vincular CÓDIGO) y su Telegram
             queda ligado a su usuario de ASLSCAN.
  Menú       🔗 Conexiones (ver, conectar con favoritos por categoría o por
             número, cambiar el modo, desconectar), 🩺 Salud y 🗺 Nodos.
  Permisos   ver: lectura en adelante · conectar y desconectar: operador o admin.

A quien no está vinculado solo se le explica cómo vincularse. Si HAMNA Web
también está en el nodo, cada uno necesita su propio bot (Telegram no deja
que dos programas lean los mensajes del mismo bot).
"""
import json
import logging
import random
import threading
import time

from . import auth, health, notify, paths, settings, sysmon

log = logging.getLogger("aslscan.bot")

CODE_SECS = 10 * 60
_rand = random.SystemRandom()
_lock = threading.Lock()
_codes = {}                     # código → (usuario_id, vence)
_estado = {"activo": False, "error": "", "bot": "", "chats": {}, "token": ""}
_COMANDOS = [
    ("menu", "Menú con botones"),
    ("start", "Iniciar"),
]


# ── Estado / vinculación ────────────────────────────────────────────────────
def activo():
    """¿El bot está escuchando? (si no, los botones no tendrían quién los atienda)"""
    return bool(_estado["activo"])


def estado():
    return {"activo": _estado["activo"], "error": _estado["error"], "bot": _estado["bot"]}


def chats_vistos():
    return list(_estado["chats"].values())


def nuevo_codigo(uid):
    if not activo():
        raise ValueError("El bot de Telegram no está escuchando en este nodo "
                         "(el administrador lo activa en Ajustes → Telegram)")
    now = time.time()
    with _lock:
        for c in [c for c, (_u, t) in _codes.items() if t < now or _u == uid]:
            del _codes[c]
        code = "{:06d}".format(_rand.randint(0, 999999))
        while code in _codes:
            code = "{:06d}".format(_rand.randint(0, 999999))
        _codes[code] = (uid, now + CODE_SECS)
    bot = _estado["bot"]
    return {"codigo": code, "bot": "@" + bot if bot else "",
            "enlace": "https://t.me/{}?start={}".format(bot, code) if bot else "",
            "minutos": CODE_SECS // 60}


def _usar_codigo(code):
    now = time.time()
    with _lock:
        v = _codes.pop(code, None)
    if not v or v[1] < now:
        return None
    return v[0]


# ── Hilo que escucha ────────────────────────────────────────────────────────
def start():
    threading.Thread(target=_loop, name="aslscan-bot", daemon=True).start()


def _offset_file():
    return paths.data_dir() / "bot.json"


def _leer_offset():
    try:
        return int(json.loads(_offset_file().read_text()).get("offset") or 0)
    except Exception:
        return 0


def _guardar_offset(off):
    try:
        tmp = _offset_file().with_suffix(".tmp")
        tmp.write_text(json.dumps({"offset": off}))
        tmp.replace(_offset_file())
    except Exception:
        pass


def _loop():
    off = _leer_offset()
    avisado = ""
    while True:
        cfg = settings.load()
        token = (cfg.get("tg_token") or "").strip()
        if not (cfg.get("tg_enabled") and token and cfg.get("tg_bot_on", True)):
            _estado.update(activo=False, error="")
            time.sleep(15)
            continue
        try:
            if _estado["token"] != token:
                me = notify._call(token, "getMe", {})
                _estado.update(bot=(me or {}).get("username", ""), token=token, chats={})
                try:
                    notify._call(token, "setMyCommands", {"commands": json.dumps(
                        [{"command": c, "description": d} for c, d in _COMANDOS])})
                except Exception:
                    pass
            ups = notify._call(token, "getUpdates", {
                "offset": off, "timeout": 25,
                "allowed_updates": json.dumps(["message", "callback_query", "my_chat_member"])}, timeout=40)
            _estado.update(activo=True, error="")
            avisado = ""
            for u in ups or []:
                off = max(off, int(u.get("update_id", 0)) + 1)
                _guardar_offset(off)
                try:
                    _atender(token, u)
                except Exception:
                    log.exception("El bot no pudo atender un mensaje")
        except Exception as e:
            msg = str(e)
            if "Conflict" in msg:
                err = ("Otro programa está usando este mismo bot (¿otro nodo con el mismo token?). "
                       "Solo un nodo puede responder; apaga «Responder comandos» en los demás.")
            elif "Unauthorized" in msg or "Not Found" in msg:
                err = "Telegram no reconoce el token del bot"
            else:
                err = msg
            _estado.update(activo=False, error=err)
            if err != avisado:
                log.warning("Bot de Telegram: %s", err)
                avisado = err
            time.sleep(30 if "Conflict" in msg else 10)


# ── Atender mensajes y botones ──────────────────────────────────────────────
def _responder(token, chat, texto, botones=None, a=None, markup=None):
    p = {"chat_id": chat, "text": texto, "parse_mode": "HTML", "disable_web_page_preview": "true"}
    if a:
        p["reply_to_message_id"] = a
    if botones:
        p["reply_markup"] = teclado(botones)
    elif markup:
        p["reply_markup"] = markup
    notify._call(token, "sendMessage", p)


def teclado(filas):
    return json.dumps({"inline_keyboard": [[{"text": t, "callback_data": d} for t, d in fila] for fila in filas]})


def _indicativo(u):
    """Para saludar: el usuario de ASLSCAN es el indicativo (xe2mbe → XE2MBE)."""
    return ((u or {}).get("usuario") or (u or {}).get("nombre") or "").upper()


def _nivel(u):
    return auth.ROLES.get((u or {}).get("rol"), -1)


def _atender(token, u):
    m = u.get("message")
    if u.get("my_chat_member"):
        m = u["my_chat_member"]
    if m and m.get("chat"):
        c = m["chat"]
        nombre = c.get("title") or " ".join(x for x in (c.get("first_name"), c.get("last_name")) if x) \
            or c.get("username") or str(c["id"])
        _estado["chats"][str(c["id"])] = {"id": str(c["id"]), "nombre": nombre, "tipo": c.get("type", "")}
    if u.get("callback_query"):
        return _boton(token, u["callback_query"])
    if not u.get("message"):
        return
    m = u["message"]
    if m.get("date") and time.time() - float(m["date"]) > 600:
        return                                      # mensaje viejo (de antes de que el bot escuchara)
    texto = (m.get("text") or "").strip()
    chat = m["chat"]["id"]
    privado = m["chat"].get("type") == "private"
    quien = m.get("from") or {}
    if not texto:
        return
    if privado and not texto.startswith("/") and texto != "📋 Menú":
        esp = _espera_de(quien.get("id"))
        user = auth.user_by_tg(quien.get("id")) if esp else None
        if esp and user:                            # estaba esperando el número de un nodo
            return _nodo_recibido(token, m["chat"]["id"], m.get("message_id"), user, texto, quien.get("id"))
    if texto.startswith("/"):
        partes = texto.split(None, 1)
        cmd, _, para = partes[0][1:].partition("@")
        if para and _estado["bot"] and para.lower() != _estado["bot"].lower():
            return                                  # era para otro bot del grupo
        cmd = cmd.lower()
        arg = partes[1].strip() if len(partes) > 1 else ""
    elif privado and texto.isdigit() and len(texto) == 6:
        cmd, arg = "vincular", texto
    elif privado:
        cmd, arg = "menu", ""                         # «📋 Menú» o cualquier texto: el menú
    else:
        return                                      # conversación normal del grupo
    if cmd in ("start", "vincular") and arg:
        return _vincular(token, chat, quien, arg, m.get("message_id"))
    user = auth.user_by_tg(quien.get("id"))
    if not user:
        return _responder(token, chat, (
            "👋 Hola. Todavía no sé quién eres.\n\n"
            "Entra a ASLSCAN → <b>Mi perfil</b> (clic en tu foto o nombre) → <b>🔗 Vincular Telegram</b>, "
            "y mándame el código que te da."), a=None if privado else m.get("message_id"))
    if cmd in ("menu", "start"):
        _espera_quitar(quien.get("id"))
        if privado and cmd == "start":
            _responder(token, chat, "👋 Hola, <b>{}</b>. Abajo tienes el botón <b>📋 Menú</b> para abrirlo cuando quieras.".format(
                notify.esc(_indicativo(user))), markup=TECLADO_FIJO)
        texto, botones = _pantalla("menu", user)
        return _responder(token, chat, texto, botones=botones, a=None if privado else m.get("message_id"))
    resp = _comando(cmd, user, arg, chat)
    if isinstance(resp, tuple):
        resp, botones = resp
    else:
        botones = None
    if resp:
        _responder(token, chat, resp, botones=botones, a=None if privado else m.get("message_id"))



CODIGO_MAX_TODOS = 30          # códigos malos de todos juntos en 15 min: se anulan los pendientes
_codigo_fallos = []


def _vincular(token, chat, quien, code, msg_id):
    # Frenar a quien prueba códigos al azar: 5 malos por cuenta de Telegram bloquean 15 min
    # (lo lleva auth, como las contraseñas) y 30 malos entre todos anulan los códigos pendientes.
    clave = "tg:{}".format(quien.get("id"))
    if auth.locked_for("codigo", clave):
        return _responder(token, chat, "⏳ Demasiados códigos equivocados. Espera 15 minutos y pide uno nuevo.")
    uid = _usar_codigo(code.strip())
    if not uid:
        auth._fail("codigo", clave)
        now = time.time()
        with _lock:
            _codigo_fallos[:] = [t for t in _codigo_fallos if now - t < auth.LOCK_SECS] + [now]
            if len(_codigo_fallos) >= CODIGO_MAX_TODOS:
                _codes.clear()
                del _codigo_fallos[:]
                log.warning("Demasiados códigos de Telegram equivocados: se anularon los pendientes")
        return _responder(token, chat, "❌ Ese código no existe o ya venció. Pide uno nuevo en ASLSCAN → Mi perfil.")
    tg_nombre = "@" + quien["username"] if quien.get("username") else \
        " ".join(x for x in (quien.get("first_name"), quien.get("last_name")) if x)
    auth.set_tg(uid, str(quien.get("id")), tg_nombre)
    u = auth.user_by_tg(quien.get("id")) or {}
    log.info("Telegram %s vinculado con el usuario %s", tg_nombre, u.get("usuario"))
    _responder(token, chat, "✅ Listo, <b>{}</b>. Tu Telegram quedó vinculado con tu usuario de ASLSCAN ({}).\n\n"
                            "Usa el botón <b>📋 Menú</b> de abajo para ver todo lo que puedo hacer.".format(
        notify.esc(_indicativo(u)), notify.esc(u.get("rol_nombre"))), markup=TECLADO_FIJO)
    texto, botones = _pantalla("menu", u)
    _responder(token, chat, texto, botones=botones)



def _ayuda(user):
    t = ["<b>Lo que puedo hacer</b>",
         "📋 Menú · los botones para todo",
         "/conexiones · los nodos conectados a este nodo",
         "/salud · temperatura, voltaje, disco y memoria",
         "/nodos · cómo están los nodos que reportan a este hub"]
    if _gestor(user):
        t += ["", "En 🔗 Conexiones puedes <b>conectar</b> (con tus favoritos o escribiendo el número), "
                  "<b>cambiar el modo</b> o <b>desconectar</b> nodos."]
    return "\n".join(t)


def _comando(cmd, user, arg="", chat=None):
    if cmd in ("ayuda", "help", "start"):
        return _ayuda(user)
    if cmd in ("conexiones", "estado", "con"):
        return _pantalla("con", user)
    if cmd == "salud":
        return _txt_salud()
    if cmd == "nodos":
        return _txt_nodos()
    return "No conozco ese comando.\n\n" + _ayuda(user)


def _hm(s):
    s = int(max(0, s or 0))
    h, r = divmod(s, 3600)
    return "{}:{:02d}:{:02d}".format(h, r // 60, r % 60) if h else "{}:{:02d}".format(r // 60, r % 60)


def _falta(seg):
    seg = int(max(0, seg))
    d, r = divmod(seg, 86400)
    h, r = divmod(r, 3600)
    m = r // 60
    if d:
        return "{} d {} h".format(d, h)
    if h:
        return "{} h {} min".format(h, m)
    return "{} min".format(max(1, m))



def _txt_salud():
    st = health.status()
    ico = {"ok": "✅", "nd": "➖", "aviso": "⚠️", "grave": "❌"}
    t = ["🩺 <b>Salud del nodo</b>"]
    for c in st.get("checks") or []:
        t.append("{} {}: {}".format(ico.get(c["nivel"], "•"), notify.esc(c["nombre"]), notify.esc(c["detalle"])))
    if not st.get("checks"):
        t.append("La revisión completa (SD, voltaje, temperatura) se hace un minuto después de arrancar.")
    s = sysmon.snapshot()
    extra = []
    if s.get("cpu") is not None:
        extra.append("CPU {}%".format(s["cpu"]))
    if s.get("temp") is not None:
        extra.append("{} °C".format(s["temp"]))
    m = s.get("mem") or {}
    if m.get("total"):
        extra.append("RAM {}%".format(int(round(100.0 * m.get("usada", 0) / m["total"]))))
    d = s.get("disco") or {}
    if d.get("total"):
        extra.append("disco {}%".format(int(round(100.0 * d.get("usada", 0) / d["total"]))))
    if s.get("encendido_s"):
        extra.append("encendido hace " + _falta(s["encendido_s"]))
    if extra:
        t += ["", " · ".join(extra)]
    return "\n".join(t)


def _txt_nodos():
    from . import hub
    p = hub.panel()
    if not p["nodos"]:
        return "Ningún nodo reporta a este hub todavía (en cada nodo: Ajustes → Sistema → Panel de nodos; en HAMNA Web: Ajustes → Nodo)."
    lim = (p["alerta_min"] or 10) * 60
    t = ["🗺 <b>Nodos</b>"]
    for d in p["nodos"]:
        ico = "🟢" if d["edad"] < 180 else "🟡" if d["edad"] < lim else "🔴"
        nombre = notify.esc(d.get("estacion") or "") + " · " if d.get("estacion") else ""
        linea = "{} {}nodo {}".format(ico, nombre, notify.esc(d["nodo"]))
        if d["edad"] >= 180:
            linea += " · sin reportar desde hace " + _falta(d["edad"])
        elif d.get("al_aire"):
            linea += " · 🔴 al aire: " + notify.esc(d["al_aire"].get("evento"))
        elif d.get("app"):
            linea += " · " + notify.esc(d["app"])
        sal = (d.get("salud") or {}).get("peor")
        if sal in ("aviso", "grave"):
            linea += " · " + ("⚠️" if sal == "aviso" else "❌") + " salud"
        t.append(linea)
    return "\n".join(t)




# ── Menú con botones («tarjetas» que se reemplazan en el mismo mensaje) ────
TECLADO_FIJO = json.dumps({"keyboard": [[{"text": "📋 Menú"}]], "resize_keyboard": True, "is_persistent": True})
VOLVER = ("« Menú", "m:menu")


def _editar(token, chat, mid, texto, botones):
    p = {"chat_id": chat, "message_id": mid, "text": texto, "parse_mode": "HTML", "disable_web_page_preview": "true",
         "reply_markup": teclado(botones) if botones else json.dumps({"inline_keyboard": []})}
    try:
        notify._call(token, "editMessageText", p)
    except RuntimeError as e:
        if "not modified" not in str(e):
            raise


def _pantalla(cual, user, arg=""):
    """(texto, botones) de cada pantalla del menú."""
    if cual == "menu":
        cfg = settings.load()
        est = cfg.get("station_name") or "ASLSCAN"
        t = "📻 <b>{}</b>{}\n\n¿Qué quieres hacer?".format(
            notify.esc(est), " · nodo " + notify.esc(cfg.get("node")) if cfg.get("node") else "")
        return t, [[("🔗 Conexiones", "m:con")],
                   [("🩺 Salud", "m:salud"), ("🗺 Nodos", "m:nodos")],
                   [("❓ Ayuda", "m:ayuda")]]
    if cual in ("salud", "nodos"):
        filas = [[("🔄 Actualizar", "m:" + cual), VOLVER]]
        if cual == "nodos":
            filas.insert(0, [("🔗 Conexiones de este nodo", "m:con")])
        return (_txt_salud if cual == "salud" else _txt_nodos)(), filas
    if cual == "ayuda":
        return _ayuda(user), [[VOLVER]]
    if cual in ("con", "conl", "condq"):
        return _pantalla_con(cual, user, arg)
    return "No conozco esa opción.", [[VOLVER]]


def _boton(token, q):
    data = q.get("data") or ""
    msg = q.get("message") or {}
    chat = (msg.get("chat") or {}).get("id")
    mid = msg.get("message_id")

    def avisa(texto, alerta=False):
        try:
            notify._call(token, "answerCallbackQuery", {"callback_query_id": q["id"], "text": texto[:190],
                                                        "show_alert": "true" if alerta else "false"})
        except RuntimeError as e:                   # botón de un mensaje viejo: Telegram ya no acepta la respuesta
            log.info("Telegram no aceptó la respuesta al botón: %s", e)

    user = auth.user_by_tg((q.get("from") or {}).get("id"))
    if not user:
        return avisa("Primero vincula tu Telegram en ASLSCAN → Mi perfil.", True)
    if not data.startswith("m:"):
        return avisa("Botón desconocido")
    p = data.split(":")
    cual, arg = p[1], ":".join(p[2:])
    try:
        if cual in CON_ACCIONES:
            return _boton_con(token, chat, mid, user, cual, arg, avisa, (q.get("from") or {}).get("id"))
        texto, botones = _pantalla(cual, user, arg)
        _editar(token, chat, mid, texto, botones)
        avisa("")
    except Exception as e:
        log.exception("Menú del bot")
        avisa("No pude: {}".format(e), True)


# ── Lo que el bot espera que le escriban (el número de un nodo) ────────────
ESPERA_SECS = 15 * 60
_espera = {}                    # Telegram id → qué le estoy esperando


def _gestor(user):
    return _nivel(user) >= auth.ROLES["operador"]


def _espera_de(tg, modos=None):
    now = time.time()
    with _lock:
        for k in [k for k, v in _espera.items() if v["exp"] < now]:
            del _espera[k]
        e = _espera.get(str(tg or ""))
    return e if e and (modos is None or e["modo"] in modos) else None


def _espera_poner(tg, **datos):
    datos["exp"] = time.time() + ESPERA_SECS
    with _lock:
        _espera[str(tg)] = datos


def _espera_quitar(tg):
    with _lock:
        _espera.pop(str(tg or ""), None)


def _ints(arg):
    out = []
    for x in (arg or "").split(":"):
        try:
            out.append(int(x))
        except ValueError:
            out.append(0)
    return out + [0, 0]


# ── Conexiones del nodo (Nodos → 🔗 Conexiones) ─────────────────────────────
#   ASL   enlaces directos con su modo; conectar como transceptor, monitor o
#         monitor local (ilink 3 / 2 / 8), cambiar el modo, desconectar uno o todos.
#   IRLP  el reflector o nodo activo; conectar (decode) o desconectar (end).
#   Ver: lectura en adelante · conectar y desconectar: operador o admin.
CON_ACCIONES = ("conn", "conk", "conm", "condx", "conx", "conf")
FAV_PAG = 8
# Dónde busca AllScan su favorites.ini (CfgModel.php: favsIniLoc), en ASL3 y en HamVOIP
FAV_ARCHIVOS = ("/var/www/html/allscan/favorites.ini", "/var/www/html/supermon/favorites.ini",
                "/srv/http/allscan/favorites.ini", "/srv/http/supermon/favorites.ini", "/etc/allscan/favorites.ini")


def _favoritos(node):
    """[(nombre, nodo)]: los favoritos de ASL (la primera vez se importan de AllScan)."""
    from . import favoritos
    return [(f.get("nombre") or f["nodo"], f["nodo"]) for f in favoritos.asl(node)]


def _favs_por_categoria(kind, cfg):
    """[(categoría, [(nombre, nodo)])] en orden, sin categorías vacías."""
    from . import favoritos
    if kind == "irlp":
        from . import irlpctl
        favs, cats = irlpctl.favoritos_todo()
    else:
        favs, cats = favoritos.asl_todo(cfg.get("node") or "")
    return [(c, [(f.get("nombre") or f["nodo"], f["nodo"]) for f in fs]) for c, fs in favoritos.agrupar(favs, cats)]


def _favoritos_allscan(node):
    """[(etiqueta, nodo)] de los favoritos de AllScan: la sección [general] y la del nodo."""
    import re
    for ruta in FAV_ARCHIVOS:
        try:
            with open(ruta, encoding="utf-8", errors="replace") as f:
                lineas = f.read().splitlines()
        except OSError:
            continue
        out, seccion, etiqueta = [], "", None
        for ln in lineas:
            ln = ln.strip()
            if not ln or ln.startswith(";"):
                continue
            m = re.match(r"^\[(.+)\]$", ln)
            if m:
                seccion = m.group(1).strip()
                continue
            if seccion not in ("general", str(node)):
                continue
            m = re.match(r'^(label|cmd)\[\]\s*=\s*"?(.*?)"?\s*$', ln)
            if not m:
                continue
            if m.group(1) == "label":
                etiqueta = m.group(2).strip()
                continue
            n = re.search(r"\bilink\s+\d+\s+(\d{3,7})\b", m.group(2))
            if n and etiqueta and n.group(1) not in {x[1] for x in out}:
                out.append((etiqueta, n.group(1)))
            etiqueta = None
        return out
    return []
CON_MODOS = [("transceptor", "🔁 Transceptor"), ("monitor", "👂 Monitor"), ("monitor_local", "🏠 Monitor local")]
MODO_ICO = {"transceptor": "🔁", "monitor": "👂", "conectando": "⏳"}
MODOS_AYUDA = ("🔁 <b>Transceptor</b>: se oyen y se hablan los dos nodos.\n"
               "👂 <b>Monitor</b>: este nodo oye al otro, pero no le manda audio.\n"
               "🏠 <b>Monitor local</b>: como monitor, pero lo que llega solo sale por el radio de este nodo "
               "(no pasa a los demás nodos conectados).")


def _sistema():
    from . import backends
    cfg = settings.load()
    kind = cfg.get("backend") or "auto"
    if kind == "auto":
        kind = backends.detect()
    return kind, cfg


def _nombre_nodo(d):
    return " · ".join(x for x in ((d or {}).get("indicativo"), (d or {}).get("descripcion"),
                                  (d or {}).get("ubicacion")) if x)[:70]


def _pantalla_con(cual, user, arg):
    from . import sessions
    op = _gestor(user)
    abajo = [("🔄 Actualizar", "m:con"), VOLVER]
    kind, cfg = _sistema()
    if kind not in ("asl", "irlp"):
        return "Este nodo no es ASL ni IRLP: no hay conexiones que manejar.", [[VOLVER]]
    try:
        st = sessions.status(cfg)
    except Exception as e:
        return "❌ No pude leer las conexiones: {}".format(notify.esc(e)), [abajo]
    if kind == "irlp":
        return _pantalla_irlp(cual, st, op, abajo, arg)

    enlaces = sorted(st.get("enlaces") or [], key=lambda e: e["nodo"])
    por_nodo = {e["nodo"]: e for e in enlaces}
    if cual == "condq":
        if arg == "all":
            return ("⛔ <b>¿Desconectar todos los enlaces del nodo {}?</b>\nSon {}: {}.".format(
                notify.esc(st["nodo"]), len(enlaces), ", ".join(e["nodo"] for e in enlaces)),
                [[("✅ Sí, desconectar todos", "m:condx:all")], [("Cancelar", "m:con")]])
        e = por_nodo.get(arg)
        if not e:
            return "El nodo {} ya no está conectado.".format(notify.esc(arg)), [abajo]
        return ("✖ <b>¿Desconectar el nodo {}?</b>{}".format(
            notify.esc(arg), "\n" + notify.esc(_nombre_nodo(e)) if _nombre_nodo(e) else ""),
            [[("✅ Sí, desconectar", "m:condx:" + arg)], [("Cancelar", "m:conl:" + arg)]])
    if cual == "conl":
        e = por_nodo.get(arg)
        if not e:
            return "El nodo {} ya no está conectado.".format(notify.esc(arg)), [[("« Conexiones", "m:con"), VOLVER]]
        t = ["🔗 <b>Nodo {}</b>".format(notify.esc(arg))]
        if _nombre_nodo(e):
            t.append(notify.esc(_nombre_nodo(e)))
        t += ["", "Modo: {} {}".format(MODO_ICO.get(e.get("modo"), "•"), notify.esc(e.get("modo") or "?")),
              "Conectado hace {} · {}".format(_hm(e.get("segundos")), "lo conectamos nosotros" if e.get("direccion") == "OUT"
                                               else "él se conectó a nosotros")]
        if e.get("transmitiendo"):
            t.append("🔊 Está transmitiendo ahora")
        filas = []
        if op:
            t += ["", "Puedes cambiarle el modo:", MODOS_AYUDA]
            filas = [[(lbl + (" ✓" if m == e.get("modo") else ""), "m:conm:{}:{}".format(arg, m)) for m, lbl in CON_MODOS[:2]],
                     [("{}".format(CON_MODOS[2][1]), "m:conm:{}:monitor_local".format(arg)), ("✖ Desconectar", "m:condq:" + arg)]]
        filas.append([("« Conexiones", "m:con"), VOLVER])
        return "\n".join(t), filas

    # con: la lista
    loc = _nombre_nodo(st.get("local"))
    t = ["🔗 <b>Conexiones del nodo {}</b>{}".format(notify.esc(st["nodo"]), "\n" + notify.esc(loc) if loc else "")]
    estado = [x for x, si in (("📥 recibiendo", st.get("rx")), ("📤 transmitiendo", st.get("tx"))) if si]
    if estado:
        t.append(" · ".join(estado))
    t.append("")
    if not enlaces:
        t.append("Sin conexiones en este momento.")
    for e in enlaces:
        nom = e.get("indicativo") or ""
        t.append("{} <b>{}</b>{} · {} · {}{}".format(
            MODO_ICO.get(e.get("modo"), "•"), notify.esc(e["nodo"]), " " + notify.esc(nom) if nom else "",
            notify.esc(e.get("modo") or "?"), _hm(e.get("segundos")), " · 🔊" if e.get("transmitiendo") else ""))
    if st.get("total_red"):
        t += ["", "🌐 {} nodos en total en la red conectada.".format(st["total_red"])]
    filas = []
    if op:
        botones = [("{} {}{}".format(MODO_ICO.get(e.get("modo"), "•"), e["nodo"], " " + e["indicativo"] if e.get("indicativo") else ""),
                    "m:conl:" + e["nodo"]) for e in enlaces[:20]]
        filas += [botones[i:i + 2] for i in range(0, len(botones), 2)]
        fila = [("➕ Conectar nodo", "m:conn")]
        if enlaces:
            fila.append(("⛔ Desconectar todos", "m:condq:all"))
        filas.append(fila)
        if enlaces:
            t += ["", "Toca un nodo para cambiarle el modo o desconectarlo."]
    filas.append(abajo)
    return "\n".join(t), filas


def _pantalla_irlp(cual, st, op, abajo, arg=""):
    activo = st.get("activo") or ""
    if cual == "condq" and arg == "dis":
        return ("⛔ <b>¿Deshabilitar el nodo IRLP?</b>\nDeja de aceptar conexiones y códigos DTMF del radio "
                "hasta que lo habilites."), [[("✅ Sí, deshabilitar", "m:condx:dis")], [("Cancelar", "m:con")]]
    if cual == "condq" and arg == "ena":
        return "✅ <b>¿Habilitar el nodo IRLP?</b>", [[("✅ Sí, habilitar", "m:condx:ena")], [("Cancelar", "m:con")]]
    if cual == "condq":
        if not activo:
            return "El nodo no está conectado a nada.", [abajo]
        return "✖ <b>¿Desconectar de {}?</b>".format(notify.esc(activo)), \
            [[("✅ Sí, desconectar", "m:condx:end")], [("Cancelar", "m:con")]]
    t = ["🔗 <b>Conexión IRLP</b>{}".format(" · nodo " + notify.esc(st["nodo"]) if st.get("nodo") else ""), ""]
    if activo:
        t.append("Conectado a <b>{}</b>".format(notify.esc(activo)))
        if st.get("red"):
            t.append("👥 {} nodos más en ese reflector".format(len(st["red"])))
    else:
        t.append("Sin conexión en este momento.")
    estado = [x for x, si in (("📥 recibiendo (COS)", st.get("cos")), ("📤 transmitiendo (PTT)", st.get("ptt"))) if si]
    if estado:
        t.append(" · ".join(estado))
    habilitado = st.get("habilitado") is not False
    if not habilitado:
        t.append("⛔ <b>Nodo deshabilitado</b>: no acepta conexiones ni códigos del radio.")
    filas = []
    if op:
        fila = [("➕ Conectar", "m:conn")]
        if activo:
            fila.append(("✖ Desconectar", "m:condq:end"))
        filas.append(fila)
        filas.append([("⛔ Deshabilitar nodo", "m:condq:dis") if habilitado else ("✅ Habilitar nodo", "m:condq:ena")])
    filas.append(abajo)
    return "\n".join(t), filas


def _boton_con(token, chat, mid, user, cual, arg, avisa, tg):
    if not _gestor(user):
        return avisa("Solo un operador o el administrador pueden conectar o desconectar.", True)
    kind, _cfg = _sistema()
    if cual == "conx":
        _espera_quitar(tg)
        avisa("Cancelado")
        texto, botones = _pantalla("con", user)
        return _editar(token, chat, mid, texto, botones)
    if cual in ("conn", "conk"):
        # conn[:pág] = favoritos (o las categorías, si hay más de una); conk:<cat>[:pág] = los de una categoría
        _espera_poner(tg, modo="nodo")
        avisa("")
        pide = "✍ Escríbeme el número del {}.".format(
            "nodo o reflector IRLP (por ejemplo 9990)" if kind == "irlp" else "nodo ASL (por ejemplo 59624)")
        grupos = _favs_por_categoria(kind, _cfg)
        if not grupos:
            return _editar(token, chat, mid, "➕ <b>Conectar</b>\n\n" + pide, [[("Cancelar", "m:conx")]])
        from . import sessions
        try:
            conectados = {e["nodo"] for e in sessions.status(_cfg).get("enlaces") or []}
        except Exception:
            conectados = set()
        if kind == "irlp":                          # «I- 0077,Experimental» → 0077
            import re
            conectados = {n for _c, fs in grupos for _et, n in fs for c in conectados
                          if re.sub(r"\D", "", c)[-4:] == n[-4:]}
        nums = _ints(arg) if arg else []
        if cual == "conn" and len(grupos) > 1:      # primero las categorías
            filas = [[("📁 {} ({}{})".format(c, len(fs), ", ✅ {}".format(sum(1 for _e, n in fs if n in conectados))
                                              if any(n in conectados for _e, n in fs) else "")[:56],
                       "m:conk:{}".format(i))] for i, (c, fs) in enumerate(grupos)]
            filas.append([("Cancelar", "m:conx")])
            return _editar(token, chat, mid, "➕ <b>Conectar</b>\n\n📁 Elige una categoría de tus favoritos, o {}".format(
                pide[2].lower() + pide[3:]), filas)
        if cual == "conk":
            ci = nums[0] if nums else 0
            pag = nums[1] if len(nums) > 1 else 0
        else:
            ci, pag = 0, (nums[0] if nums else 0)
        ci = max(0, min(ci, len(grupos) - 1))
        cat, favs = grupos[ci]
        npag = (len(favs) + FAV_PAG - 1) // FAV_PAG
        pag = max(0, min(pag, npag - 1))
        varias = len(grupos) > 1
        def boton(et, n):                           # el número primero: las etiquetas largas se cortan
            base = et[:-len(n)].rstrip(" ,") if et.endswith(n) else et
            return ("{} {}{}".format("✅" if n in conectados else "⭐", n, " · " + base if base else ""))[:56]
        filas = [[(boton(et, n), "m:conf:" + n)] for et, n in favs[pag * FAV_PAG:(pag + 1) * FAV_PAG]]
        ir = (lambda p: "m:conk:{}:{}".format(ci, p)) if varias else (lambda p: "m:conn:{}".format(p))
        nav = []
        if pag > 0:
            nav.append(("◀ Anteriores", ir(pag - 1)))
        if pag < npag - 1:
            nav.append(("Siguientes ▶", ir(pag + 1)))
        if nav:
            filas.append(nav)
        filas.append(([("« Categorías", "m:conn")] if varias else []) + [("Cancelar", "m:conx")])
        return _editar(token, chat, mid, "➕ <b>Conectar</b>\n\n{}⭐ Elige uno de tus favoritos{}, o {}\n"
                                         "✅ = ya está conectado{}.".format(
                                             "📁 <b>{}</b>\n".format(notify.esc(cat)) if varias else "",
                                             " (página {} de {})".format(pag + 1, npag) if npag > 1 else "",
                                             pide[2].lower() + pide[3:],
                                             " (tócalo para cambiarle el modo)" if kind == "asl" else ""), filas)
    if cual == "conf":                              # eligió un favorito
        if not arg.isdigit():
            return avisa("Nodo inválido.", True)
        _espera_quitar(tg)
        if kind == "irlp":                          # IRLP no tiene modos: conecta directo
            avisa("Conectando {}…".format(arg))
            _editar(token, chat, mid, "⏳ Conectando {}…".format(notify.esc(arg)), None)
            return threading.Thread(target=_con_hacer, args=(token, chat, mid, user, "conectar", arg),
                                    daemon=True).start()
        avisa("")
        texto, botones = _pantalla_modo(arg, user)
        return _editar(token, chat, mid, texto, botones)
    if cual == "conm":
        destino, _, modo = arg.partition(":")
        avisa("Conectando {}…".format(destino))
        _editar(token, chat, mid, "⏳ Conectando {}…".format(notify.esc(destino)), None)
        return threading.Thread(target=_con_hacer, args=(token, chat, mid, user, "conectar", destino, modo or "transceptor"),
                                daemon=True).start()
    if cual == "condx":
        que = {"dis": "Deshabilitando el nodo…", "ena": "Habilitando el nodo…"}.get(arg, "Desconectando…")
        avisa(que)
        _editar(token, chat, mid, "⏳ " + que, None)
        return threading.Thread(target=_con_hacer, args=(token, chat, mid, user, "desconectar", arg), daemon=True).start()
    avisa("Botón desconocido")


def _con_hacer(token, chat, mid, user, accion, destino, modo="transceptor"):
    """Conecta o desconecta (en un hilo: Asterisk o IRLP tardan unos segundos) y vuelve a la lista."""
    from . import links, sessions
    kind, cfg = _sistema()
    try:
        if accion == "conectar":
            cmd = sessions.action(cfg, "conectar", destino, modo if kind == "asl" else "transceptor")
            que = "🔗 Conecté el nodo {} como {}".format(destino, links.ASL_MODO_NOMBRE.get(modo, modo)) if kind == "asl" \
                else "🔗 Conecté a {}".format(destino)
        elif kind == "irlp" and destino in ("dis", "ena"):
            from . import irlpctl
            cmd = irlpctl.accion("deshabilitar" if destino == "dis" else "habilitar")
            que = "⛔ Deshabilité el nodo IRLP" if destino == "dis" else "✅ Habilité el nodo IRLP"
        elif destino in ("all", "end", ""):
            cmd = sessions.action(cfg, "desconectar_todo")
            que = "⛔ Desconecté todos los enlaces" if kind == "asl" else "✖ Desconecté IRLP"
        else:
            cmd = sessions.action(cfg, "desconectar", destino)
            que = "✖ Desconecté el nodo {}".format(destino)
        log.info("%s desde Telegram: %s", user["usuario"], cmd)
        time.sleep(4 if accion == "conectar" else 2)    # que la lista ya muestre el cambio
        pre = notify.esc(que) + ".\n\n"
        if kind == "asl" and destino not in ("all", "end", ""):
            with sessions._cache_lock:
                sessions._cache["key"] = None
            sigue = destino in {e["nodo"] for e in sessions.status(cfg).get("enlaces") or []}
            if accion == "desconectar" and sigue:
                pre = "⚠ Mandé desconectar el nodo {} pero sigue conectado (¿se reconecta desde el otro lado?).\n\n".format(
                    notify.esc(destino))
            elif accion == "conectar" and not sigue:
                pre = "⏳ Mandé conectar el nodo {}; todavía no aparece. Toca 🔄 Actualizar en unos segundos.\n\n".format(
                    notify.esc(destino))
    except Exception as e:
        log.warning("Conexiones desde Telegram (%s): %s", user["usuario"], e)
        pre = "❌ No pude: {}\n\n".format(notify.esc(e))
    try:
        texto, botones = _pantalla("con", user)
        _editar(token, chat, mid, pre + texto, botones)
    except Exception:
        log.exception("Conexiones desde Telegram")


def _nodo_recibido(token, chat, mid, user, texto, tg):
    kind, cfg = _sistema()
    n = "".join(c for c in texto if c.isdigit())
    cancelar = [("Cancelar", "m:conx")]
    if not (4 <= len(n) <= 6 if kind == "irlp" else 3 <= len(n) <= 7) or len(n) != len(texto.strip()):
        return _responder(token, chat, "Escríbeme solo el número del {} ({} dígitos).".format(
            "nodo o reflector" if kind == "irlp" else "nodo", "4 a 6" if kind == "irlp" else "3 a 7"),
            botones=[cancelar], a=mid)
    _espera_quitar(tg)
    texto, botones = _pantalla_modo(n, user)
    return _responder(token, chat, texto, botones=botones, a=mid)


def _pantalla_modo(n, user):
    """¿Cómo lo conecto? (después de escribir el número o de elegir un favorito)."""
    from . import sessions
    kind, cfg = _sistema()
    cancelar = [("« Favoritos", "m:conn"), ("Cancelar", "m:conx")]
    if kind == "irlp":
        return "🔗 ¿Conectar a <b>{}</b>?".format(notify.esc(n)), \
            [[("✅ Sí, conectar", "m:conm:{}:x".format(n))], [("Cancelar", "m:conx")]]
    nom = _nombre_nodo(sessions.lookup([n]).get(n))
    fav = next((et for et, x in _favoritos(cfg.get("node") or "") if x == n), "")
    ya = ""
    try:
        e = {x["nodo"]: x for x in sessions.status(cfg).get("enlaces") or []}.get(n)
        if e:
            ya = "\nYa está conectado como <b>{}</b>; elige otro modo para cambiarlo.".format(notify.esc(e.get("modo") or "?"))
    except Exception:
        pass
    return ("🔗 <b>Nodo {}</b>{}{}\n\n¿Cómo lo conecto?\n\n{}".format(
        notify.esc(n), "\n" + notify.esc(nom or fav) if (nom or fav) else "\n(no está en la lista de nodos de este equipo)",
        ya, MODOS_AYUDA),
        [[(lbl, "m:conm:{}:{}".format(n, m))] for m, lbl in CON_MODOS] + [cancelar])
