"""
ASLSCAN — anuncios cortos programados.

Cada anuncio es un audio corto (texto → voz, o un audio subido/grabado en el
navegador, siempre WAV 8 kHz mono) que el nodo transmite solo:

  · a ciertas horas, cada N minutos dentro de un horario, o una sola vez;
  · los días de la semana elegidos y, si se pide, solo entre dos fechas;
  · por el radio de este nodo (rpt localplay) o también a los nodos enlazados
    (rpt playback).

Nunca interrumpe: espera a que el canal quede en silencio (nadie recibiendo,
transmitiendo ni hablando por un enlace) unos segundos seguidos. Si en
ESPERA_MAX no se libera, ese turno se salta y queda en la bitácora.

Si el texto lleva variables ({hora}, {dia}, {temperatura}…) la voz se genera
otra vez al momento de salir; si eso falla, sale el audio guardado, salvo que
diga la hora o el clima (sería un dato viejo): entonces ese turno se salta.
"""
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

from . import backends, clima, db, paths, sessions, settings, textourl, tts

log = logging.getLogger("aslscan.anuncios")

MAX_SEG = 60                 # duración máxima de un anuncio (de fábrica; Ajustes → Voz la cambia)
MAX_SEG_RANGO = (30, 170)    # lo que se puede elegir: 170 s cabe en un TOT de 3 min
MAX_CHARS = 2000             # caracteres del texto (de fábrica)
MAX_CHARS_RANGO = (200, 4000)
VOZ_KEYS = ("azure_voice", "azure_style", "azure_rate", "azure_pitch")   # voz propia de un anuncio
ESPERA_MAX = 300             # s que se espera a que el canal se libere
SILENCIO = 3                 # s seguidos sin actividad para considerar el canal libre
BITACORA_MAX = 300
HORA_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
FECHA_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def max_seg(cfg=None):
    cfg = cfg if cfg is not None else settings.load()
    try:
        v = int(cfg.get("anuncio_max_seg") or MAX_SEG)
    except (TypeError, ValueError):
        v = MAX_SEG
    return max(MAX_SEG_RANGO[0], min(MAX_SEG_RANGO[1], v))


def max_chars(cfg=None):
    cfg = cfg if cfg is not None else settings.load()
    try:
        v = int(cfg.get("anuncio_max_chars") or MAX_CHARS)
    except (TypeError, ValueError):
        v = MAX_CHARS
    return max(MAX_CHARS_RANGO[0], min(MAX_CHARS_RANGO[1], v))


def tot_nodo(cfg=None):
    """TOT del nodo en segundos (totime de rpt.conf, en ms; app_rpt usa 180 s si no está). None si no se sabe."""
    cfg = cfg if cfg is not None else settings.load()
    if backends.kind(cfg) != "asl":
        return None
    try:
        from . import rptconf
        with open(rptconf.RPT_CONF, encoding="utf-8", errors="replace") as f:
            secs = rptconf.parse(f.read())
        nodo = str(cfg.get("node") or backends.detect_asl_node() or "")
        if nodo not in secs:
            return None
        v, _ = rptconf._valor(secs, nodo, "totime")
        ms = int(str(v).split(";")[0].strip()) if v not in (None, "") else 180000
        return ms // 1000
    except (OSError, ValueError, AttributeError, ImportError):
        return None


def voz_limpia(d):
    """La voz propia de un anuncio (solo Azure por ahora). {} = la de Ajustes."""
    if isinstance(d, str):
        try:
            d = json.loads(d or "{}")
        except ValueError:
            d = {}
    if not isinstance(d, dict) or not str(d.get("azure_voice") or "").strip():
        return {}
    v = {"azure_voice": str(d["azure_voice"]).strip()[:80]}
    if not re.match(r"^[A-Za-z]{2,3}-[A-Za-z0-9]{2,8}-[A-Za-z0-9:]+$", v["azure_voice"]):
        raise ValueError("Nombre de voz de Azure inválido")
    estilo = str(d.get("azure_style") or "general").strip()[:40]
    if not re.match(r"^[A-Za-z_-]+$", estilo):
        raise ValueError("Estilo de voz inválido")
    v["azure_style"] = estilo
    try:
        v["azure_rate"] = int(float(d.get("azure_rate") or 100))
        v["azure_pitch"] = int(float(d.get("azure_pitch") or 0))
    except (TypeError, ValueError):
        raise ValueError("Velocidad o tono inválidos")
    if not 50 <= v["azure_rate"] <= 200:
        raise ValueError("Velocidad de la voz: de 50 a 200 %")
    if not -50 <= v["azure_pitch"] <= 50:
        raise ValueError("Tono de la voz: de -50 a 50 Hz")
    return v


def cfg_con_voz(cfg, voz):
    try:
        voz = voz_limpia(voz)
    except ValueError:
        voz = {}
    if not voz or tts.motor(cfg) != "azure":
        return cfg
    return dict(cfg, **voz)


def sintetizar(texto, cfg, voz, out, now=None):
    """Como tts.sintetizar, con la voz propia del anuncio. Si esa voz falla (ya no existe…),
    sale con la de Ajustes. Devuelve (texto dicho, duración, aviso)."""
    c2 = cfg_con_voz(cfg, voz)
    if c2 is cfg:
        return tts.sintetizar(texto, cfg, out, now) + ("",)
    try:
        return tts.sintetizar(texto, c2, out, now) + ("",)
    except Exception as e:
        log.warning("La voz %s falló (%s); sale con la de Ajustes", c2.get("azure_voice"), e)
        dicho, dur = tts.sintetizar(texto, cfg, out, now)
        return dicho, dur, "La voz {} falló; salió con la de Ajustes".format(c2.get("azure_voice"))


def carpeta():
    d = paths.data_dir() / "anuncios"
    if not d.is_dir():
        os.makedirs(str(d), exist_ok=True)
    return d


def init():
    with db.conn() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS anuncios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            tipo TEXT NOT NULL DEFAULT 'tts',       -- tts | audio | url
            texto TEXT NOT NULL DEFAULT '',
            archivo TEXT NOT NULL DEFAULT '',       -- en anuncios/, WAV 8 kHz
            archivo_nombre TEXT NOT NULL DEFAULT '',
            duracion REAL NOT NULL DEFAULT 0,
            dias TEXT NOT NULL DEFAULT '0123456',   -- 0 = lunes
            modo TEXT NOT NULL DEFAULT 'horas',     -- horas | cada | una
            horas TEXT NOT NULL DEFAULT '[]',
            cada_min INTEGER NOT NULL DEFAULT 60,
            desde_h TEXT NOT NULL DEFAULT '08:00',
            hasta_h TEXT NOT NULL DEFAULT '22:00',
            una_vez TEXT NOT NULL DEFAULT '',       -- AAAA-MM-DD HH:MM
            vig_desde TEXT NOT NULL DEFAULT '',
            vig_hasta TEXT NOT NULL DEFAULT '',
            destino TEXT NOT NULL DEFAULT 'local',  -- local | red
            activo INTEGER NOT NULL DEFAULT 1,
            creado_por TEXT NOT NULL DEFAULT '',
            creado TEXT NOT NULL DEFAULT '',
            modificado TEXT NOT NULL DEFAULT '',
            ultima_clave TEXT NOT NULL DEFAULT '',  -- minuto del último turno tomado
            ultimo TEXT NOT NULL DEFAULT '',
            ultimo_estado TEXT NOT NULL DEFAULT '')""")
        c.execute("""CREATE TABLE IF NOT EXISTS anuncios_bitacora (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            anuncio_id INTEGER, nombre TEXT, cuando TEXT, estado TEXT, detalle TEXT)""")
        cols = {r[1] for r in c.execute("PRAGMA table_info(anuncios)").fetchall()}
        if "evento_id" not in cols:                 # «antes de un evento» (HAMNA)
            c.execute("ALTER TABLE anuncios ADD COLUMN evento_id INTEGER NOT NULL DEFAULT 0")
        if "antes" not in cols:
            c.execute("ALTER TABLE anuncios ADD COLUMN antes TEXT NOT NULL DEFAULT '[]'")
        if "voz" not in cols:                       # voz propia (JSON con azure_voice…); vacío = la de Ajustes
            c.execute("ALTER TABLE anuncios ADD COLUMN voz TEXT NOT NULL DEFAULT ''")
        if "url" not in cols:                       # tipo url: de dónde se baja el texto (textourl.py)
            c.execute("ALTER TABLE anuncios ADD COLUMN url TEXT NOT NULL DEFAULT ''")
        if "url_falla" not in cols:                 # si la dirección falla: respaldo | saltar
            c.execute("ALTER TABLE anuncios ADD COLUMN url_falla TEXT NOT NULL DEFAULT 'respaldo'")
        if "dtmf" not in cols:                      # código DTMF que lo dispara (dtmf.py)
            c.execute("ALTER TABLE anuncios ADD COLUMN dtmf TEXT NOT NULL DEFAULT ''")


def _ahora():
    return dt.datetime.now().replace(second=0, microsecond=0)


def _fmt(t):
    return t.strftime("%Y-%m-%d %H:%M")


def _min(hhmm):
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


# ── Antes de un evento (solo HAMNA; aquí sin eventos) ───────────────────────
EVENTOS = False


def _turnos_evento(a, dia):
    return []


def _evento_valido(d):
    raise ValueError("Este nodo no tiene eventos")


def _eventos_resumen():
    return None
# ── fin eventos ──


MODOS = ("horas", "cada", "una") + (("evento",) if EVENTOS else ())


# ── Cuándo toca ──────────────────────────────────────────────────────────────
def _vigente(a, fecha):
    f = fecha.strftime("%Y-%m-%d")
    return (not a["vig_desde"] or f >= a["vig_desde"]) and (not a["vig_hasta"] or f <= a["vig_hasta"])


def _turnos_del_dia(a, dia):
    """[(minuto desde medianoche, red)] en que toca el anuncio ese día, en orden.
    red = también sale a los nodos enlazados (RF + Net). En «A estas horas» cada
    hora tiene su propio destino; en los demás modos vale el del anuncio."""
    red = a["destino"] == "red"
    if a["modo"] == "evento":
        return _turnos_evento(a, dia)
    if not _vigente(a, dia):
        return []
    if a["modo"] == "una":
        try:
            t = dt.datetime.strptime(a["una_vez"], "%Y-%m-%d %H:%M")
        except ValueError:
            return []
        return [(t.hour * 60 + t.minute, red)] if t.date() == dia else []
    if str(dia.weekday()) not in a["dias"]:
        return []
    if a["modo"] == "horas":
        d = {}
        for x in a["horas"]:
            if HORA_RE.match(x["h"]):
                d[_min(x["h"])] = d.get(_min(x["h"]), False) or x["red"]
        return sorted(d.items())
    ini, fin, paso = _min(a["desde_h"]), _min(a["hasta_h"]), max(5, int(a["cada_min"] or 60))
    return [(m, red) for m in range(ini, fin + 1, paso)] if fin >= ini else []


def _minutos_del_dia(a, dia):
    return [m for m, _r in _turnos_del_dia(a, dia)]


def turno(a, t):
    """None si a esa hora no toca; si toca, el destino de ese turno: "red" o "local"."""
    if not a["activo"]:
        return None
    m = t.hour * 60 + t.minute
    for x, red in _turnos_del_dia(a, t.date()):
        if x == m:
            return "red" if red else "local"
    return None


def toca(a, t):
    return turno(a, t) is not None


def proximo_turno(a, desde=None, dias=8):
    """(fecha-hora, red) del siguiente turno, o (None, None)."""
    if not a["activo"]:
        return None, None
    desde = desde or _ahora()
    for d in range(dias):
        dia = desde.date() + dt.timedelta(days=d)
        for m, red in _turnos_del_dia(a, dia):
            t = dt.datetime.combine(dia, dt.time(m // 60, m % 60))
            if t > desde:
                return t, red
    return None, None


def proximo(a, desde=None, dias=8):
    return proximo_turno(a, desde, dias)[0]


# ── Datos ────────────────────────────────────────────────────────────────────
def _fila(r):
    a = dict(r)
    # horas: [{"h": "HH:MM", "red": bool}]; las de antes eran solo "HH:MM" con el destino del anuncio
    red = a.get("destino") == "red"
    try:
        crudo = json.loads(a["horas"] or "[]")
    except ValueError:
        crudo = []
    a["horas"] = []
    for x in crudo:
        if isinstance(x, str):
            a["horas"].append({"h": x, "red": red})
        elif isinstance(x, dict) and isinstance(x.get("h"), str):
            a["horas"].append({"h": x["h"], "red": bool(x.get("red"))})
    try:
        a["antes"] = [int(x) for x in json.loads(a.get("antes") or "[]")]
    except (TypeError, ValueError):
        a["antes"] = []
    a["activo"] = bool(a["activo"])
    return a


def lista():
    return [_fila(r) for r in db.rows("SELECT * FROM anuncios ORDER BY nombre COLLATE NOCASE")]


def uno(aid):
    r = db.row("SELECT * FROM anuncios WHERE id=?", (aid,))
    if not r:
        raise ValueError("Ese anuncio ya no existe")
    return _fila(r)


def ruta(a):
    return carpeta() / a["archivo"] if a.get("archivo") else None


def _limpio(d, actual=None):
    """Valida lo que manda la página. Devuelve el dict listo para guardar."""
    actual = actual or {}
    a = {}
    a["nombre"] = str(d.get("nombre") or "").strip()[:80]
    if not a["nombre"]:
        raise ValueError("Ponle un nombre al anuncio")
    a["tipo"] = d.get("tipo") if d.get("tipo") in ("audio", "url") else "tts"
    a["texto"] = str(d.get("texto") or "").strip()
    tope = max_chars()
    if len(a["texto"]) > tope:
        raise ValueError("El texto tiene {} caracteres; el máximo es {} (Ajustes → Voz)".format(len(a["texto"]), tope))
    if a["tipo"] == "tts" and not a["texto"]:
        raise ValueError("Escribe lo que dirá el anuncio")
    a["url"], a["url_falla"] = "", "respaldo"
    if a["tipo"] == "url":
        # En un anuncio «desde una dirección», texto = el de respaldo (opcional)
        a["url"] = textourl.validar(d.get("url"))
        a["url_falla"] = "saltar" if d.get("url_falla") == "saltar" else "respaldo"
        if a["url_falla"] == "respaldo" and not a["texto"]:
            raise ValueError("Escribe el texto de respaldo, o elige «no transmitir» si la dirección falla")
    voz = voz_limpia(d.get("voz") or {}) if a["tipo"] in ("tts", "url") else {}
    a["voz"] = json.dumps(voz, sort_keys=True) if voz else ""
    a["modo"] = d.get("modo") if d.get("modo") in MODOS else "horas"
    dias = "".join(sorted({c for c in str(d.get("dias") or "") if c in "0123456"}))
    a["dias"] = dias
    if a["modo"] in ("horas", "cada") and not dias:
        raise ValueError("Elige al menos un día")
    red_def = d.get("destino") == "red"
    hs = {}
    for x in d.get("horas") or []:
        h, r = (x, red_def) if isinstance(x, str) else ((x or {}).get("h"), bool((x or {}).get("red")))
        if isinstance(h, str) and HORA_RE.match(h):
            hs[h] = hs.get(h, False) or r
    horas = [{"h": h, "red": hs[h]} for h in sorted(hs)]
    a["horas"] = json.dumps(horas)
    if a["modo"] == "horas" and not horas:
        raise ValueError("Agrega al menos una hora")
    try:
        a["cada_min"] = int(d.get("cada_min") or 60)
    except (TypeError, ValueError):
        raise ValueError("Cada cuántos minutos: escribe un número")
    if a["modo"] == "cada" and not 5 <= a["cada_min"] <= 1440:
        raise ValueError("Cada cuántos minutos: de 5 a 1440")
    a["desde_h"] = str(d.get("desde_h") or "08:00")
    a["hasta_h"] = str(d.get("hasta_h") or "22:00")
    if a["modo"] == "cada":
        if not (HORA_RE.match(a["desde_h"]) and HORA_RE.match(a["hasta_h"])):
            raise ValueError("Horario inválido (HH:MM)")
        if _min(a["hasta_h"]) < _min(a["desde_h"]):
            raise ValueError("La hora final debe ser después de la inicial")
    a["una_vez"] = str(d.get("una_vez") or "").replace("T", " ")[:16]
    if a["modo"] == "una":
        try:
            dt.datetime.strptime(a["una_vez"], "%Y-%m-%d %H:%M")
        except ValueError:
            raise ValueError("Elige la fecha y la hora")
    a["evento_id"], a["antes"] = 0, "[]"
    if a["modo"] == "evento":
        a["evento_id"], antes = _evento_valido(d)
        a["antes"] = json.dumps(antes)
    for k in ("vig_desde", "vig_hasta"):
        v = str(d.get(k) or "")
        if v and not FECHA_RE.match(v):
            raise ValueError("Fecha de vigencia inválida")
        a[k] = v
    if a["vig_desde"] and a["vig_hasta"] and a["vig_hasta"] < a["vig_desde"]:
        raise ValueError("La vigencia termina antes de empezar")
    a["destino"] = "red" if d.get("destino") == "red" else "local"
    a["activo"] = 1 if d.get("activo", actual.get("activo", True)) not in (False, 0, "0", "false") else 0
    a["dtmf"] = str(d.get("dtmf", actual.get("dtmf", "")) or "").strip().upper().lstrip("*")   # app.py ya lo validó
    return a


def _guardar_audio(src, nombre_original=""):
    """WAV que manda el navegador (ya en 8 kHz mono) → anuncios/. Devuelve (archivo, duración)."""
    nombre = "an_{}.wav".format(uuid.uuid4().hex[:10])
    dest = carpeta() / nombre
    try:
        dur = tts.a_wav8k(src, dest)
    except Exception as e:
        paths.rm(dest)
        raise ValueError("No pude leer el audio ({}). Súbelo otra vez desde la página.".format(e))
    tope = max_seg()
    if dur > tope + 0.5:
        paths.rm(dest)
        raise ValueError("El audio dura {:.0f} s; el máximo es {} s".format(dur, tope))
    if dur < 0.3:
        paths.rm(dest)
        raise ValueError("El audio está vacío")
    return nombre, dur


def _voz(texto, cfg, voz=""):
    nombre = "an_{}.wav".format(uuid.uuid4().hex[:10])
    dest = carpeta() / nombre
    try:
        # Al guardar, si la voz elegida falla se avisa (no se cambia sola por la de Ajustes)
        _dicho, dur = tts.sintetizar(texto, cfg_con_voz(cfg, voz), dest)
    except Exception:
        paths.rm(dest)
        raise
    tope = max_seg(cfg)
    if dur > tope + 0.5:
        paths.rm(dest)
        raise ValueError("Con esa voz el anuncio dura {:.0f} s; el máximo es {} s. Acórtalo.".format(dur, tope))
    return nombre, dur


def _de_biblioteca(bib):
    """Copia el audio de la biblioteca a anuncios/ (no se comparte: cada uno queda con el suyo)."""
    from . import biblioteca
    tope = max_seg()
    if bib["duracion"] > tope + 0.5:
        raise ValueError("Ese audio dura {:.0f} s; el máximo de un anuncio es {} s (Ajustes → Voz)".format(bib["duracion"], tope))
    return biblioteca.copiar_a(bib, carpeta()), bib["duracion"]


def guardar(datos, archivo_subido=None, nombre_subido="", usuario="", aid=None):
    actual = uno(aid) if aid else {}
    a = _limpio(datos, actual)
    bib = None
    if datos.get("biblioteca_id") and not aid:
        from . import biblioteca
        bib = biblioteca.uno(int(datos["biblioteca_id"]))
    viejo = actual.get("archivo") or ""
    nuevo = None
    if a["tipo"] == "audio":
        if archivo_subido:
            nuevo, a["duracion"] = _guardar_audio(archivo_subido)
            a["archivo_nombre"] = (nombre_subido or "audio.wav")[:80]
        elif actual.get("tipo") == "audio" and viejo:
            a["duracion"], a["archivo_nombre"] = actual["duracion"], actual["archivo_nombre"]
        elif bib and bib["tipo"] == "audio":
            nuevo, a["duracion"] = _de_biblioteca(bib)
            a["archivo_nombre"] = (bib["archivo_nombre"] or bib["nombre"] + ".wav")[:80]
        else:
            raise ValueError("Sube o graba el audio del anuncio")
    elif a["tipo"] == "url":
        # El texto se baja y se convierte en voz al momento de salir: no se guarda audio
        a["archivo"], a["archivo_nombre"], a["duracion"] = "", "", 0
    else:
        a["archivo_nombre"] = ""
        if actual.get("tipo") == "tts" and actual.get("texto") == a["texto"] and viejo and \
                (actual.get("voz") or "") == a["voz"] and \
                (carpeta() / viejo).is_file() and not datos.get("rehacer_voz"):
            a["duracion"] = actual["duracion"]
        elif bib and bib["tipo"] == "tts" and bib["texto"] == a["texto"] and (bib["voz"] or "") == a["voz"]:
            nuevo, a["duracion"] = _de_biblioteca(bib)
        else:
            nuevo, a["duracion"] = _voz(a["texto"], settings.load(), a["voz"])
    if nuevo:
        a["archivo"] = nuevo
    ahora = _fmt(dt.datetime.now())
    a["modificado"] = ahora
    try:
        if aid:
            cols = ", ".join("{}=?".format(k) for k in a)
            db.execute("UPDATE anuncios SET {} WHERE id=?".format(cols), list(a.values()) + [aid])
        else:
            a["creado"], a["creado_por"] = ahora, usuario
            aid = db.execute("INSERT INTO anuncios ({}) VALUES ({})".format(
                ", ".join(a), ", ".join("?" * len(a))), list(a.values()))
    except Exception:
        if nuevo:
            paths.rm(carpeta() / nuevo)
        raise
    if viejo and (nuevo or a.get("archivo") == ""):
        paths.rm(carpeta() / viejo)
    log.info("%s %s el anuncio «%s»", usuario or "?", "editó" if actual else "creó", a["nombre"])
    return uno(aid)


def activar(aid, on, usuario=""):
    a = uno(aid)
    db.execute("UPDATE anuncios SET activo=? WHERE id=?", (1 if on else 0, aid))
    log.info("%s %s el anuncio «%s»", usuario, "activó" if on else "pausó", a["nombre"])
    return uno(aid)


def borrar(aid, usuario=""):
    a = uno(aid)
    db.execute("DELETE FROM anuncios WHERE id=?", (aid,))
    if a["archivo"]:
        paths.rm(carpeta() / a["archivo"])
    log.info("%s borró el anuncio «%s»", usuario, a["nombre"])


def vista_previa(texto, cfg, voz=None):
    """Voz de prueba para el editor: (url, texto dicho, duración)."""
    out = paths.tmp_dir() / "voz_{}.wav".format(uuid.uuid4().hex[:8])
    dicho, dur = tts.sintetizar(texto, cfg_con_voz(cfg, voz or {}), out)
    return out.name, dicho, dur


def _unir(wavs, out):
    """Pega WAV de 8 kHz mono (los que hace tts.a_wav8k) con medio segundo de silencio entre ellos."""
    import wave
    with wave.open(str(out), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(8000)
        for i, f in enumerate(wavs):
            if i:
                w.writeframes(b"\x00\x00" * 4000)
            with wave.open(str(f), "rb") as r:
                w.writeframes(r.readframes(r.getnframes()))
    return tts.duracion(out)


def tramos(texto, cfg, voz, tope=None):
    """Voz del texto en tramos de hasta *tope* s, cortados solo entre párrafos.
    Devuelve ([(wav, duración)], aviso). Lanza ValueError si un párrafo solo ya no cabe."""
    tope = tope or max_seg(cfg)
    parr = textourl.parrafos(texto) or [texto]
    hechos, aviso, sueltos = [], "", []
    try:
        for i, t in enumerate(parr):
            f = paths.tmp_dir() / "an_p{}_{}.wav".format(i, uuid.uuid4().hex[:6])
            sueltos.append(f)
            _d, dur, av = sintetizar(t, cfg, voz, f)
            aviso = aviso or av
            if dur > tope + 0.5:
                raise ValueError("Un párrafo dura {:.0f} s y el tope es {} s: divídelo en párrafos más cortos "
                                 "(separados por un renglón en blanco)".format(dur, tope))
            hechos.append((f, dur))
        grupos, actual, suma = [], [], 0.0
        for f, dur in hechos:
            if actual and suma + 0.5 + dur > tope:
                grupos.append(actual)
                actual, suma = [], 0.0
            actual.append(f)
            suma += dur + (0.5 if len(actual) > 1 else 0)
        if actual:
            grupos.append(actual)
        out = []
        for g in grupos:
            f = paths.tmp_dir() / "an_tramo_{}.wav".format(uuid.uuid4().hex[:8])
            out.append((f, _unir(g, f)))
        return out, aviso
    finally:
        for f in sueltos:
            paths.rm(f)


def _texto_url(a, cfg):
    """(texto, nota, estado) de un anuncio «desde una dirección». estado: ok | vacio | error."""
    try:
        texto, _info = textourl.bajar(a["url"], cfg)
    except textourl.SinContenido as e:
        return "", str(e), "vacio"
    except Exception as e:
        log.warning("Anuncio «%s»: la dirección falló (%s)", a["nombre"], e)
        if a.get("url_falla") != "saltar" and (a.get("texto") or "").strip():
            return a["texto"], "La dirección falló ({}); salió el texto de respaldo".format(e), "ok"
        return "", "La dirección falló: {}".format(e), "error"
    nota = "texto de la dirección"
    tope = max_chars(cfg)
    if len(texto) > tope:
        corto = ""
        for p in textourl.parrafos(texto):
            if len(corto) + len(p) + 2 > tope:
                break
            corto = (corto + "\n\n" + p).strip()
        texto = corto or texto[:tope]
        nota += " (se cortó a {} caracteres)".format(tope)
    return texto, nota, "ok"


def probar_url(url, cfg, voz=None, con_voz=False, respaldo=""):
    """Para el botón «Probar» del editor: baja el texto y, si se pide, hace la voz en tramos."""
    from . import pronuncia
    a = {"nombre": "prueba", "url": textourl.validar(url), "url_falla": "respaldo" if respaldo else "saltar",
         "texto": respaldo or ""}
    texto, nota, estado = _texto_url(a, cfg)
    r = {"estado": estado, "nota": nota, "texto": texto, "max_seg": max_seg(cfg), "max_chars": max_chars(cfg)}
    if not texto:
        return r
    r["dicho"] = pronuncia.para_voz(tts.resolver(texto, cfg), cfg)
    r["parrafos"] = len(textourl.parrafos(texto))
    if con_voz:
        partes, aviso = tramos(texto, cfg, voz)
        try:
            r["tramos"] = [round(d, 1) for _f, d in partes]
            out = paths.tmp_dir() / "voz_{}.wav".format(uuid.uuid4().hex[:8])
            r["duracion"] = round(_unir([f for f, _d in partes], out), 1)
            r["url_audio"] = out.name
            r["aviso"] = aviso
        finally:
            for f, _d in partes:
                paths.rm(f)
    return r


def bitacora(limite=50):
    return db.rows("SELECT * FROM anuncios_bitacora ORDER BY id DESC LIMIT ?", (limite,))


def _anotar(a, estado, detalle=""):
    cuando = _fmt(dt.datetime.now())
    with db.conn() as c:
        c.execute("INSERT INTO anuncios_bitacora (anuncio_id, nombre, cuando, estado, detalle) VALUES (?,?,?,?,?)",
                  (a["id"], a["nombre"], cuando, estado, detalle[:300]))
        c.execute("UPDATE anuncios SET ultimo=?, ultimo_estado=? WHERE id=?", (cuando, estado, a["id"]))
        c.execute("DELETE FROM anuncios_bitacora WHERE id <= (SELECT MAX(id) FROM anuncios_bitacora) - ?",
                  (BITACORA_MAX,))


# ── Al aire ──────────────────────────────────────────────────────────────────
class Emisor:
    """Una sola cola: los anuncios salen uno tras otro, cuando el canal está libre."""

    def __init__(self):
        self.cola = []                 # [(id, motivo, destino, alerta)]; destino None = el del anuncio
                                       # alerta = {"texto", "nombre"} (alertas.py: id 0, van primero)
        self.lock = threading.Lock()
        self.evento = threading.Event()
        self.actual = None             # {"id", "nombre", "estado": esperando|al_aire, "desde"}
        self.hilo = None

    def start(self):
        if not self.hilo:
            self.hilo = threading.Thread(target=self._loop, daemon=True, name="aslscan-anuncios")
            self.hilo.start()

    def encolar(self, aid, motivo="programado", destino=None):
        with self.lock:
            if any(x[0] == aid for x in self.cola) or (self.actual and self.actual["id"] == aid):
                return False
            self.cola.append((aid, motivo, destino, None))
        self.evento.set()
        return True

    def encolar_alerta(self, texto, nombre, destino="local", wav="", voz="", tipo="alerta", clave=None, motivo=""):
        """Alerta (clima, sismo): se dice con la voz al momento y sale antes que los anuncios en espera.
        Con tipo="biblioteca" (biblioteca.transmitir) es un audio ya hecho (*wav*) o un texto con variables,
        y se forma al final, detrás de los anuncios."""
        clave = clave or texto
        with self.lock:
            if any(x[3] and x[3].get("clave") == clave for x in self.cola) or \
                    (self.actual and self.actual.get("clave") == clave):
                return False
            item = (0, tipo, destino, {"texto": texto, "nombre": nombre, "wav": wav, "voz": voz, "tipo": tipo,
                                        "clave": clave, "motivo": motivo})
            if tipo == "alerta":
                i = 0
                while i < len(self.cola) and self.cola[i][3] and self.cola[i][3].get("tipo") == "alerta":
                    i += 1
                self.cola.insert(i, item)
            else:
                self.cola.append(item)
        self.evento.set()
        return True

    def estado(self):
        with self.lock:
            return {"actual": dict(self.actual) if self.actual else None, "en_cola": [x[0] for x in self.cola if not x[3]],
                    "alertas_en_cola": [x[3]["nombre"] for x in self.cola if x[3]]}

    def al_aire(self):
        with self.lock:
            return bool(self.actual and self.actual.get("estado") == "al_aire")

    def esperar_fin(self, maximo=MAX_SEG_RANGO[1] + 15):
        """Para quien va a transmitir otra cosa: espera a que termine el anuncio en curso."""
        fin = time.time() + maximo
        while self.al_aire() and time.time() < fin:
            time.sleep(0.5)

    def _loop(self):
        while True:
            self.evento.wait(5)
            self.evento.clear()
            while True:
                with self.lock:
                    if not self.cola:
                        break
                    aid, motivo, destino, alerta = self.cola.pop(0)
                    # Ya cuenta como «en curso»: que no se pueda encolar otra vez mientras arranca
                    self.actual = {"id": aid, "nombre": alerta["nombre"] if alerta else "", "estado": "esperando",
                                   "desde": time.time(), "motivo": motivo, "clave": alerta.get("clave") if alerta else None}
                try:
                    if alerta:
                        self._alerta(alerta, destino)
                    else:
                        self._uno(aid, motivo, destino)
                except Exception as e:
                    log.exception("Anuncio %s", aid)
                    try:
                        _anotar(uno(aid) if not alerta else {"id": 0, "nombre": alerta["nombre"]}, "error", str(e))
                    except Exception:
                        pass
                finally:
                    with self.lock:
                        self.actual = None

    def _uno(self, aid, motivo, destino=None):
        try:
            a = uno(aid)
        except ValueError:
            return
        destino = destino if destino in ("local", "red") else a["destino"]
        cfg = settings.load()
        node = str(cfg.get("node") or "").strip()
        if backends.kind(cfg) != "asl" or not node:
            _anotar(a, "error", "Los anuncios solo salen en nodos AllStar con número de nodo (Ajustes → Nodo)")
            return
        with self.lock:
            self.actual = {"id": aid, "nombre": a["nombre"], "estado": "esperando", "desde": time.time(), "motivo": motivo,
                           "destino": destino}
        if not self._esperar_libre(node):
            log.info("Anuncio «%s» saltado: el canal no se liberó en %d min", a["nombre"], ESPERA_MAX // 60)
            _anotar(a, "saltado", "El canal estuvo ocupado {} min".format(ESPERA_MAX // 60))
            return
        if a["tipo"] == "url":
            return self._url(a, cfg, node, destino, motivo)
        wav, temporal, aviso = ruta(a), None, ""
        if a["tipo"] == "tts" and tts.tiene_variables(a["texto"]):
            temporal = paths.tmp_dir() / "an_aire_{}.wav".format(uuid.uuid4().hex[:8])
            try:
                _d, _dur, aviso = sintetizar(a["texto"], cfg, a.get("voz"), temporal)
                wav = temporal
            except Exception as e:
                paths.rm(temporal)
                temporal = None
                if tts.volatil(a["texto"]):
                    log.warning("Anuncio «%s» saltado: no pude generar la voz al momento (%s)", a["nombre"], e)
                    _anotar(a, "error", "No pude generar la voz al momento: {}".format(e))
                    return
                log.warning("No pude generar la voz al momento (%s); sale el audio guardado", e)
        if not wav or not wav.is_file():
            _anotar(a, "error", "Falta el audio del anuncio; edítalo y guárdalo otra vez")
            return
        dur = tts.duracion(wav)
        modo = "playback" if destino == "red" else "localplay"
        try:
            with self.lock:
                self.actual.update(estado="al_aire", desde=time.time(), dur=dur)
            out = sessions._rx("rpt {} {} {}".format(modo, node, str(wav.with_suffix(""))), timeout=15)
            if re.search(r"(?i)no such|not found|unable|error|usage|invalid", out or ""):
                raise RuntimeError("Asterisk rechazó el comando: " + out.strip()[:200])
            log.info("Anuncio «%s» al aire (%s, %.1f s, %s)", a["nombre"], modo, dur, motivo)
            time.sleep(dur + 0.8)
            _anotar(a, "ok", {"programado": "", "dtmf": "DTMF · "}.get(motivo, "manual · ") +
                    ("nodo y enlaces" if modo == "playback" else "solo este nodo") + (" · " + aviso if aviso else ""))
        finally:
            if temporal:
                # Asterisk ya lo leyó; se borra un poco después por si va retrasado
                threading.Timer(30, paths.rm, (temporal,)).start()

    def _url(self, a, cfg, node, destino, motivo):
        """Ya con el canal libre: baja el texto, lo hace voz y lo transmite en uno o varios tramos.
        Entre tramos espera a que el nodo suelte el PTT y el canal quede libre (así el TOT vuelve a empezar)."""
        texto, nota, estado = _texto_url(a, cfg)
        if estado == "vacio":
            log.info("Anuncio «%s»: %s", a["nombre"], nota)
            _anotar(a, "vacio", nota)
            return
        if estado == "error":
            _anotar(a, "error", nota)
            return
        try:
            partes, aviso = tramos(texto, cfg, a.get("voz"))
        except Exception as e:
            _anotar(a, "error", "No pude generar la voz: {}".format(e))
            return
        modo = "playback" if destino == "red" else "localplay"
        try:
            for i, (wav, dur) in enumerate(partes):
                if i and not self._esperar_libre(node):
                    _anotar(a, "saltado", "Salieron {} de {} tramos: el canal se ocupó".format(i, len(partes)))
                    return
                with self.lock:
                    self.actual.update(estado="al_aire", desde=time.time(), dur=dur,
                                       tramo="{}/{}".format(i + 1, len(partes)) if len(partes) > 1 else "")
                out = sessions._rx("rpt {} {} {}".format(modo, node, str(wav.with_suffix(""))), timeout=15)
                if re.search(r"(?i)no such|not found|unable|error|usage|invalid", out or ""):
                    raise RuntimeError("Asterisk rechazó el comando: " + out.strip()[:200])
                log.info("Anuncio «%s» al aire (%s, tramo %d/%d, %.1f s, %s)", a["nombre"], modo, i + 1, len(partes), dur, motivo)
                time.sleep(dur + 0.8)
                if i + 1 < len(partes):
                    with self.lock:
                        self.actual.update(estado="esperando")
            _anotar(a, "ok", {"programado": "", "dtmf": "DTMF · "}.get(motivo, "manual · ") +
                    ("nodo y enlaces" if modo == "playback" else "solo este nodo") + " · " + nota +
                    (" · {} tramos".format(len(partes)) if len(partes) > 1 else "") + (" · " + aviso if aviso else ""))
        except Exception as e:
            _anotar(a, "error", str(e)[:250])
        finally:
            for wav, _d in partes:
                threading.Timer(30, paths.rm, (wav,)).start()

    def _alerta(self, al, destino):
        a = {"id": 0, "nombre": al["nombre"]}
        cfg = settings.load()
        node = str(cfg.get("node") or "").strip()
        if backends.kind(cfg) != "asl" or not node:
            _anotar(a, "error", "Las alertas solo salen en nodos AllStar con número de nodo (Ajustes → Nodo)")
            return
        with self.lock:
            self.actual = {"id": 0, "nombre": al["nombre"], "estado": "esperando", "desde": time.time(),
                           "motivo": al.get("tipo") or "alerta", "destino": destino, "clave": al.get("clave")}
        if not self._esperar_libre(node):
            _anotar(a, "saltado", "El canal estuvo ocupado {} min".format(ESPERA_MAX // 60))
            return
        wav = paths.tmp_dir() / "alerta_{}.wav".format(uuid.uuid4().hex[:8])
        aviso = ""
        try:
            if al.get("wav"):
                shutil.copyfile(al["wav"], str(wav))
            else:
                _d, _dur, aviso = sintetizar(al["texto"], cfg, al.get("voz"), wav)
        except Exception as e:
            paths.rm(wav)
            _anotar(a, "error", "No pude generar la voz: {}".format(e))
            return
        dur = tts.duracion(wav)
        modo = "playback" if destino == "red" else "localplay"
        try:
            with self.lock:
                self.actual.update(estado="al_aire", desde=time.time(), dur=dur)
            out = sessions._rx("rpt {} {} {}".format(modo, node, str(wav.with_suffix(""))), timeout=15)
            if re.search(r"(?i)no such|not found|unable|error|usage|invalid", out or ""):
                raise RuntimeError("Asterisk rechazó el comando: " + out.strip()[:200])
            log.info("Alerta «%s» al aire (%s, %.1f s)", al["nombre"], modo, dur)
            time.sleep(dur + 0.8)
            _anotar(a, "ok", (al.get("motivo") or al.get("tipo") or "alerta") + " · " +
                    ("nodo y enlaces" if modo == "playback" else "solo este nodo") + (" · " + aviso if aviso else ""))
        finally:
            threading.Timer(30, paths.rm, (wav,)).start()

    def _esperar_libre(self, node):
        fin = time.time() + ESPERA_MAX
        quieto = 0
        while time.time() < fin:
            if canal_libre(node):
                quieto += 1
                if quieto >= SILENCIO:
                    return True
            else:
                quieto = 0
            time.sleep(1)
        return False


def canal_libre(node):
    try:
        out = sessions._rx("rpt xnode {}".format(node), timeout=6)
    except Exception:
        return False
    if "RPT_" not in out:
        return False
    _e, _r, v = sessions.parse_xnode(out)
    if v.get("RPT_RXKEYED") == "1" or v.get("RPT_TXKEYED") == "1":
        return False
    # Alguien hablando por un enlace: RPT_ALINKS=2,59624TK,…  (K = transmitiendo)
    return not any(re.match(r"^\w+[TRCM]K$", x.strip()) for x in (v.get("RPT_ALINKS") or "").split(",")[1:])


emisor = Emisor()


# ── Programador (lo llama scheduler.loop cada pocos segundos) ────────────────
def tick(now=None):
    t = (now or dt.datetime.now()).replace(second=0, microsecond=0)
    clave = _fmt(t)
    todos = lista()
    # El clima se lee un minuto antes para que el anuncio no espere a internet
    sig = t + dt.timedelta(minutes=1)
    try:
        clima.precalentar(settings.load(), [a["texto"] for a in todos if a["tipo"] == "tts" and turno(a, sig)])
    except Exception:
        log.exception("Clima por adelantado")
    for a in todos:
        if a["ultima_clave"] == clave:
            continue
        destino = turno(a, t)
        if not destino:
            continue
        db.execute("UPDATE anuncios SET ultima_clave=? WHERE id=?", (clave, a["id"]))
        emisor.start()
        emisor.encolar(a["id"], "programado", destino)
        log.info("Toca el anuncio «%s» (%s)", a["nombre"], clave)


def resumen():
    """Lo que necesita la página: anuncios con su próximo turno, el siguiente, la cola y la bitácora."""
    ahora = _ahora()
    out = []
    eventos = _eventos_resumen()
    nombres = {e["id"]: e["nombre"] for e in eventos or []}
    for a in lista():
        p, red = proximo_turno(a, ahora)
        a["proximo"] = _fmt(p) if p else ""
        a["proximo_red"] = bool(red)
        if a["modo"] == "evento":
            a["evento_nombre"] = nombres.get(a["evento_id"], "")
        out.append(a)
    sig = min((a for a in out if a["proximo"]), key=lambda a: a["proximo"], default=None)
    cfg = settings.load()
    return {"anuncios": out, "siguiente": {"id": sig["id"], "nombre": sig["nombre"], "cuando": sig["proximo"], "red": sig["proximo_red"]} if sig else None,
            "eventos": eventos,
            "emisor": emisor.estado(), "bitacora": bitacora(30), "max_seg": max_seg(cfg), "max_chars": max_chars(cfg),
            "max_seg_rango": MAX_SEG_RANGO, "max_chars_rango": MAX_CHARS_RANGO, "tot_s": tot_nodo(cfg),
            "espera_min": ESPERA_MAX // 60,
            "voz": {"motor": tts.motor(cfg), "nombre": tts.NOMBRES.get(tts.motor(cfg)), "lista": tts.configurado(cfg),
                    "ajustes": {k: cfg.get(k) for k in VOZ_KEYS},
                    "variables": tts.VARIABLES, "variables_clima": clima.VARIABLES},
            "clima": {"listo": clima.configurado(cfg), "lugar": cfg.get("wx_lugar") or ""},
            "otros": _otros(),
            "pronuncia": cfg.get("pron_dict") or [],
            "asl": backends.kind(cfg) == "asl", "ahora": _fmt(ahora)}


def _otros():
    try:
        from . import conflictos
        return conflictos.revisar()
    except Exception:
        log.exception("Revisando otros programas que hablan")
        return []


def rehacer_voces(terminos, cfg=None):
    """El diccionario cambió: vuelve a generar la voz guardada de los anuncios que usan esos términos."""
    from . import pronuncia
    cfg = cfg or settings.load()
    n = 0
    for a in lista():
        if a["tipo"] != "tts" or not pronuncia.toca(a["texto"], terminos):
            continue
        try:
            nombre, dur = _voz(a["texto"], cfg, a.get("voz"))
        except Exception as e:
            log.warning("No pude rehacer la voz del anuncio «%s»: %s", a["nombre"], e)
            continue
        db.execute("UPDATE anuncios SET archivo=?, duracion=? WHERE id=?", (nombre, dur, a["id"]))
        if a["archivo"]:
            paths.rm(carpeta() / a["archivo"])
        n += 1
    return n


def usan(terminos):
    from . import pronuncia
    return [a["nombre"] for a in lista() if a["tipo"] == "tts" and pronuncia.toca(a["texto"], terminos)]
