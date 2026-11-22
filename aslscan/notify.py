"""
ASLSCAN — avisos por Telegram.

Se configuran en Ajustes → Telegram: el token de un bot (se crea con
@BotFather) y el chat donde llegan los mensajes. Los envíos van en segundo
plano y un mismo aviso no se repite en 15 minutos.
"""
import os
import html
import http.client
import json
import socket
import ssl
import logging
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from . import settings

log = logging.getLogger("aslscan.avisos")

BASE = os.environ.get("ASLSCAN_TG_API", "https://api.telegram.org").rstrip("/")   # cambiable solo para pruebas
API = BASE + "/bot{}/{}"
FILE_API = BASE + "/file/bot{}/{}"
DEDUPE_SECS = 15 * 60
_recent = {}
_lock = threading.Lock()

# Qué se avisa (claves de settings) y su valor por defecto
KINDS = {
    "respaldo": "tg_on_backup",      # respaldo automático fallido
    "salud": "tg_on_health",         # SD, voltaje, temperatura, disco (health.py)
    "nodos": "tg_on_nodes",          # un nodo dejó de reportar al hub (o volvió)
}
MAX_LINES = 40          # Telegram corta en 4096 caracteres



def esc(s):
    return html.escape(str(s if s is not None else ""), quote=False)


def header(cfg=None):
    cfg = cfg or settings.load()
    est = cfg.get("station_name") or "ASLSCAN"
    nodo = cfg.get("node") or ""
    return "📻 <b>{}</b>{}".format(esc(est), " · nodo {}".format(esc(nodo)) if nodo else "")


# ── Conexión a Telegram sin atorarse ────────────────────────────────────────
# Con IPv6 a veces la conexión inicial se pierde y Python espera todo el
# tiempo límite (15–40 s) antes de probar la otra dirección: el bot «tarda» en
# contestar. Aquí cada dirección tiene CONECTAR_SECS para conectar; si no,
# se prueba la siguiente (IPv4) y se recuerda la que funcionó.
CONECTAR_SECS = 4
_familia = {"ok": None}


def _conectar(host, port, timeout):
    addrs = socket.getaddrinfo(host, port, 0, socket.SOCK_STREAM)
    pref = _familia["ok"]
    if pref is not None:
        addrs.sort(key=lambda a: a[0] != pref)
    err = None
    for fam, tipo, proto, _c, addr in addrs:
        s = socket.socket(fam, tipo, proto)
        try:
            s.settimeout(min(CONECTAR_SECS, timeout or CONECTAR_SECS))
            s.connect(addr)
            s.settimeout(timeout)
            if _familia["ok"] != fam:
                if _familia["ok"] is not None:
                    log.info("Telegram: ahora conecto por %s", "IPv6" if fam == socket.AF_INET6 else "IPv4")
                _familia["ok"] = fam
            return s
        except OSError as e:
            err = e
            s.close()
            if fam == _familia["ok"]:
                _familia["ok"] = None
    raise err or OSError("No encontré la dirección de {}".format(host))


class _Conexion(http.client.HTTPSConnection):
    def connect(self):
        self.sock = self._context.wrap_socket(_conectar(self.host, self.port, self.timeout), server_hostname=self.host)


class _Manejador(urllib.request.HTTPSHandler):
    def https_open(self, req):
        return self.do_open(_Conexion, req, context=ssl.create_default_context())


_abridor = urllib.request.build_opener(_Manejador())


def abrir(req, timeout):
    """urlopen para Telegram (ver arriba)."""
    return _abridor.open(req, timeout=timeout)


def _call(token, method, params, timeout=15):
    data = urllib.parse.urlencode(params).encode()
    req = urllib.request.Request(API.format(token, method), data=data,
                                 headers={"User-Agent": "ASLSCAN"})
    try:
        with abrir(req, timeout) as r:
            out = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            out = json.loads(e.read().decode("utf-8"))
        except Exception:
            out = {"ok": False, "description": "HTTP {}".format(e.code)}
    except Exception as e:
        raise RuntimeError("No pude conectar con Telegram: {}".format(e))
    if not out.get("ok"):
        raise RuntimeError("Telegram respondió: {}".format(out.get("description") or "error"))
    return out.get("result")


def send_document(token, chat, path, filename, caption="", timeout=300, metodo="sendDocument",
                  campo="document", tipo="application/gzip"):
    """Manda un archivo al chat (Telegram acepta hasta 50 MB por bot)."""
    bd = "aslscan" + os.urandom(12).hex()
    head = []
    for k, v in (("chat_id", str(chat)), ("caption", caption), ("parse_mode", "HTML")):
        head.append('--{}\r\nContent-Disposition: form-data; name="{}"\r\n\r\n{}\r\n'.format(bd, k, v))
    head.append('--{}\r\nContent-Disposition: form-data; name="{}"; filename="{}"\r\n'
                'Content-Type: {}\r\n\r\n'.format(bd, campo, filename, tipo))
    pre = "".join(head).encode("utf-8")
    post = "\r\n--{}--\r\n".format(bd).encode()
    with open(path, "rb") as f:
        body = pre + f.read() + post
    req = urllib.request.Request(API.format(token, metodo), data=body, headers={
        "User-Agent": "ASLSCAN", "Content-Type": "multipart/form-data; boundary=" + bd})
    try:
        with abrir(req, timeout) as r:
            out = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            out = json.loads(e.read().decode("utf-8"))
        except Exception:
            out = {"ok": False, "description": "HTTP {}".format(e.code)}
    except Exception as e:
        raise RuntimeError("No pude conectar con Telegram: {}".format(e))
    if not out.get("ok"):
        raise RuntimeError("Telegram respondió: {}".format(out.get("description") or "error"))
    return out.get("result")


def send_now(text, token=None, chat=None, botones=None):
    """Envía ya (para la prueba). Devuelve nada o lanza RuntimeError."""
    cfg = settings.load()
    token = (token or cfg.get("tg_token") or "").strip()
    chat = (chat or cfg.get("tg_chat") or "").strip()
    if not token or not chat:
        raise ValueError("Falta el token del bot o el chat")
    p = {"chat_id": chat, "text": text, "parse_mode": "HTML", "disable_web_page_preview": "true"}
    if botones:
        from .bot import teclado
        p["reply_markup"] = teclado(botones)
    _call(token, "sendMessage", p)


def send(kind, text, dedupe=None, botones=None):
    """Aviso en segundo plano si está activado ese tipo. No lanza errores."""
    cfg = settings.load()
    if not cfg.get("tg_enabled") or not cfg.get("tg_token") or not cfg.get("tg_chat"):
        return
    key = KINDS.get(kind)
    if key and not cfg.get(key):
        return
    dk = dedupe or (kind + ":" + text)
    now = time.time()
    with _lock:
        if now - _recent.get(dk, 0) < DEDUPE_SECS:
            return
        _recent[dk] = now
        if len(_recent) > 300:
            for k in [k for k, t in _recent.items() if now - t > DEDUPE_SECS]:
                del _recent[k]
    msg = header(cfg) + "\n" + text

    def work():
        for intento in range(3):
            try:
                send_now(msg, botones=botones)
                return
            except Exception as e:
                if intento == 2:
                    log.warning("No se pudo enviar el aviso de Telegram: %s", e)
                time.sleep(5 * (intento + 1))
    threading.Thread(target=work, daemon=True).start()


def find_chats(token=None):
    """Chats que le escribieron al bot recientemente (para no buscar el ID a mano)."""
    token = (token or settings.get("tg_token") or "").strip()
    if not token:
        raise ValueError("Falta el token del bot")
    me = _call(token, "getMe", {})
    from . import bot
    if bot.activo():    # el bot ya está escuchando: Telegram no deja leer los mensajes dos veces a la vez
        return {"bot": "@" + (me or {}).get("username", ""), "chats": bot.chats_vistos()}
    upd = _call(token, "getUpdates", {"limit": 100, "timeout": 0})
    chats = {}
    for u in upd or []:
        m = u.get("message") or u.get("channel_post") or u.get("my_chat_member") or {}
        c = m.get("chat") or {}
        if "id" in c:
            name = c.get("title") or " ".join(x for x in (c.get("first_name"), c.get("last_name")) if x) \
                or c.get("username") or str(c["id"])
            chats[str(c["id"])] = {"id": str(c["id"]), "nombre": name, "tipo": c.get("type", "")}
    return {"bot": "@" + (me or {}).get("username", ""), "chats": list(chats.values())}
