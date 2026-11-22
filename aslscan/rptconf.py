"""
ASLSCAN — tonos de cortesía en rpt.conf (AllStarLink / HamVOIP).

Lee y cambia solo esto:
  · los tonos ctN de la sección de telemetría del nodo (la que dice su
    `telemetry =`; en ASL3 [telemetry], en HamVOIP [telemetry58788]);
  · remotetx y remotemon, en esa misma sección: el tono que suena al soltar el
    PTT cuando el nodo ESTÁ ENLAZADO (en transceptor / solo en monitor). Con
    enlaces app_rpt usa estos y no unlinkedct;
  · cuál ctN usa el nodo: unlinkedct (sin enlaces), linkunkeyct (al soltar
    alguien que llega por un enlace) y remotect (base remota enlazada);
  · dos tiempos: unkeywait (pausa entre que sueltas el PTT y el tono, en la
    sección de `wait_times =` del nodo) y hangtime (cuánto se queda arriba el
    transmisor después, en la sección del nodo).

Cada cambio guarda antes una copia de rpt.conf (rpt.conf.aslscan-FECHA, se
conservan las últimas 10) y cambia solo esos renglones, respetando los
comentarios. Asterisk lee rpt.conf al arrancar: los cambios se aplican al
reiniciarlo (en ASL3 con `systemctl restart asterisk`; nunca `rpt restart`,
que corrompe app_rpt). Si después de reiniciar el nodo no aparece, se
regresa la copia y se vuelve a reiniciar.
"""
import datetime as dt
import logging
import os
import re
import shutil
import subprocess
import threading
import time

from . import backends

log = logging.getLogger("aslscan.rptconf")

RPT_CONF = "/etc/asterisk/rpt.conf"
GUARDAR = 10
USOS = ("unlinkedct", "linkunkeyct", "remotect")
ENLACE = ("remotetx", "remotemon")      # tonos directos (no ctN) de la sección de telemetría
# (clave, dónde va, mínimo, máximo) — ms
TIEMPOS = {"unkeywait": ("espera", 0, 5000), "hangtime": ("nodo", 0, 10000)}
CT_RX = re.compile(r"^ct(\d{1,2})$")
SEG_RX = re.compile(r"\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)")
MAX_SEG = 12
HDR_RX = re.compile(r"^\s*\[([^\]]+)\]\s*(?:\(([^)]*)\))?")
KEY_RX = re.compile(r"^\s*([A-Za-z0-9_]+)\s*=>?\s*(.*?)\s*$")

_lock = threading.Lock()
_euid = getattr(os, "geteuid", lambda: 1000)
SEGURO = RPT_CONF + ".aslscan-seguro"     # la configuración con la que corría Asterisk antes de los cambios
_aplicar = {"estado": "", "mensaje": "", "t": 0.0}


# ── Leer ─────────────────────────────────────────────────────────────────────
def _sin_comentario(linea):
    # en rpt.conf el «;» empieza un comentario (los tonos no lo usan)
    i = linea.find(";")
    return linea if i < 0 else linea[:i]


def parse(texto):
    """{sección: {"plantillas": [...], "es_plantilla": bool, "claves": {k: v}}} (primera aparición manda)."""
    secs, cur = {}, None
    for ln in texto.splitlines():
        s = _sin_comentario(ln).strip()
        if not s or s.startswith("#"):
            continue
        m = HDR_RX.match(s)
        if m:
            name = m.group(1).strip()
            opts = [x.strip() for x in (m.group(2) or "").split(",") if x.strip()]
            cur = secs.setdefault(name, {"plantillas": [x for x in opts if x not in ("!", "+")],
                                         "es_plantilla": "!" in opts, "claves": {}})
            continue
        m = KEY_RX.match(s)
        if m and cur is not None:
            cur["claves"].setdefault(m.group(1).lower(), m.group(2))
    return secs


def _valor(secs, seccion, clave, _visto=None):
    """Valor efectivo de una clave: la sección y luego sus plantillas. (valor, sección donde está)."""
    _visto = _visto or set()
    if seccion in _visto or seccion not in secs:
        return None, None
    _visto.add(seccion)
    s = secs[seccion]
    if clave in s["claves"]:
        return s["claves"][clave], seccion
    for t in s["plantillas"]:
        v, donde = _valor(secs, t, clave, _visto)
        if v is not None:
            return v, donde
    return None, None


def segmentos(valor):
    """«|t(f1,f2,ms,amp)(…)» → [[f1, f2, ms, amp], …]; None si no es un tono (p. ej. un archivo de sonido)."""
    v = (valor or "").strip()
    if not v.startswith("|t"):
        return None
    cuerpo = v[2:].strip()
    segs = [[int(x) for x in m.groups()] for m in SEG_RX.finditer(cuerpo)]
    if not segs or SEG_RX.sub("", cuerpo).strip():
        return None
    return segs


def tono_texto(segs):
    return "|t" + "".join("({},{},{},{})".format(*s) for s in segs)


def validar_segmentos(segs):
    if not isinstance(segs, list) or not 1 <= len(segs) <= MAX_SEG:
        raise ValueError("Cada tono lleva de 1 a {} pitidos".format(MAX_SEG))
    out = []
    for s in segs:
        try:
            f1, f2, ms, amp = [int(float(x)) for x in s]
        except (TypeError, ValueError):
            raise ValueError("Valores inválidos en un tono")
        if not (0 <= f1 <= 4000 and 0 <= f2 <= 4000):
            raise ValueError("Las frecuencias van de 0 a 4000 Hz (0 = silencio)")
        if not 10 <= ms <= 5000:
            raise ValueError("Cada pitido dura de 10 a 5000 ms")
        if not 0 <= amp <= 16384:
            raise ValueError("El volumen (amplitud) va de 0 a 16384")
        out.append([f1, f2, ms, amp])
    return out


def _nodo(cfg):
    return str(cfg.get("node") or backends.detect_asl_node() or "")


def estado(cfg):
    """Lo que muestra la página."""
    base = {"disponible": False, "archivo": RPT_CONF, "aplicando": dict(_aplicar)}
    if backends.kind(cfg) != "asl":
        return dict(base, motivo="Solo en nodos AllStarLink / HamVOIP")
    try:
        with open(RPT_CONF, encoding="utf-8", errors="replace") as f:
            secs = parse(f.read())
    except OSError as e:
        return dict(base, motivo="No pude leer {}: {}".format(RPT_CONF, e))
    nodo = _nodo(cfg)
    if nodo not in secs:
        return dict(base, motivo="No encontré la sección [{}] en rpt.conf".format(nodo))
    tel, _ = _valor(secs, nodo, "telemetry")
    tel = (tel or "telemetry").strip()
    if tel not in secs:
        return dict(base, motivo="No encontré la sección de telemetría [{}] en rpt.conf".format(tel))
    # Tonos: los de las plantillas primero, los de la sección los reemplazan
    tonos, cadena, visto, pend = {}, [], set(), [tel]
    while pend:
        s = pend.pop(0)
        if s in visto or s not in secs:
            continue
        visto.add(s)
        cadena.append(s)
        pend.extend(secs[s]["plantillas"])
    for s in reversed(cadena):
        for k, v in secs[s]["claves"].items():
            if CT_RX.match(k) or k in ENLACE:
                tonos[k] = {"nombre": k, "valor": v, "segmentos": segmentos(v), "propio": s == tel,
                            "enlace": k in ENLACE}
    lista = sorted(tonos.values(), key=lambda t: (0, ENLACE.index(t["nombre"])) if t["enlace"]
                   else (1, int(CT_RX.match(t["nombre"]).group(1))))
    uso = {}
    for k in USOS:
        v, donde = _valor(secs, nodo, k)
        uso[k] = {"valor": (v or "").strip(), "propio": donde == nodo}
    esp, _ = _valor(secs, nodo, "wait_times")
    esp = (esp or "").strip()
    tiempos = {}
    for k, (donde, lo, hi) in TIEMPOS.items():
        sec = nodo if donde == "nodo" else esp
        if sec not in secs:
            continue
        v, de = _valor(secs, sec, k)
        try:
            v = int(float((v or "").strip()))
        except ValueError:
            v = None
        tiempos[k] = {"valor": v, "propio": de == sec, "min": lo, "max": hi}
    return dict(base, disponible=True, nodo=nodo, seccion_telemetria=tel, seccion_espera=esp if esp in secs else "",
                tonos=lista, uso=uso, tiempos=tiempos, pendiente=pendiente(), puede_aplicar=bool(_comando_reinicio()))


# ── Escribir ─────────────────────────────────────────────────────────────────
def _rango(lineas, seccion):
    """(inicio, fin) de la PRIMERA aparición de [seccion]: inicio = renglón del encabezado."""
    ini = None
    for i, ln in enumerate(lineas):
        m = HDR_RX.match(_sin_comentario(ln).strip())
        if m:
            if ini is not None:
                return ini, i
            if m.group(1).strip() == seccion:
                ini = i
    if ini is None:
        raise ValueError("No encontré la sección [{}]".format(seccion))
    return ini, len(lineas)


def poner(lineas, seccion, clave, valor):
    """Cambia (o agrega) «clave = valor» dentro de la sección; valor None la quita."""
    ini, fin = _rango(lineas, seccion)
    for i in range(ini + 1, fin):
        m = KEY_RX.match(_sin_comentario(lineas[i]))
        if m and m.group(1).lower() == clave:
            if valor is None:
                del lineas[i]
                return
            com = lineas[i][len(_sin_comentario(lineas[i])):]
            lineas[i] = "{} = {}{}".format(clave, valor, ("    " + com.strip()) if com.strip() else "")
            return
    if valor is None:
        return
    pos = ini + 1           # después del último renglón con clave de la sección
    for i in range(ini + 1, fin):
        if KEY_RX.match(_sin_comentario(lineas[i])):
            pos = i + 1
    lineas.insert(pos, "{} = {}".format(clave, valor))


def _respaldar():
    d = os.path.dirname(RPT_CONF)
    dest = "{}.aslscan-{}".format(RPT_CONF, dt.datetime.now().strftime("%Y%m%d_%H%M%S"))
    shutil.copy2(RPT_CONF, dest)
    viejos = sorted(f for f in os.listdir(d) if f.startswith(os.path.basename(RPT_CONF) + ".aslscan-"))
    for f in viejos[:-GUARDAR]:
        try:
            os.remove(os.path.join(d, f))
        except OSError:
            pass
    return dest


def guardar(cfg, tonos, uso, borrar=None, tiempos=None):
    """tonos: {ctN: [[f1,f2,ms,amp],…]}; uso: {unlinkedct: "ctN"|""}; borrar: [ctN] propios a quitar."""
    st = estado(cfg)
    if not st["disponible"]:
        raise ValueError(st.get("motivo") or "No disponible")
    nodo, tel = st["nodo"], st["seccion_telemetria"]
    existentes = {t["nombre"] for t in st["tonos"]}
    nuevos = {}
    for nombre, segs in (tonos or {}).items():
        nombre = str(nombre).lower()
        if nombre not in ENLACE and (not CT_RX.match(nombre) or not 1 <= int(nombre[2:]) <= 99):
            raise ValueError("Nombre de tono inválido: {} (usa ct1 a ct99)".format(nombre))
        nuevos[nombre] = tono_texto(validar_segmentos(segs))
    quitar = [str(b).lower() for b in (borrar or [])]
    if any(q in ENLACE for q in quitar):
        raise ValueError("Los tonos de cuando el nodo está enlazado no se pueden borrar")
    disponibles = ((existentes | set(nuevos)) - set(quitar)) - set(ENLACE)
    cambios_uso = {}
    for k, v in (uso or {}).items():
        if k not in USOS:
            continue
        v = str(v or "").strip().lower()
        if v and v not in disponibles:
            raise ValueError("El tono {} no existe".format(v))
        cambios_uso[k] = v
    cambios_t = {}
    for k, v in (tiempos or {}).items():
        if k not in TIEMPOS or k not in st["tiempos"]:
            continue
        _d, lo, hi = TIEMPOS[k]
        try:
            v = int(float(v))
        except (TypeError, ValueError):
            raise ValueError("Valor inválido en {}".format(k))
        if not lo <= v <= hi:
            raise ValueError("{} va de {} a {} ms".format(k, lo, hi))
        if v != st["tiempos"][k]["valor"]:
            cambios_t[k] = v
    for q in quitar:
        t = next((x for x in st["tonos"] if x["nombre"] == q), None)
        if not t or not t["propio"]:
            raise ValueError("Solo se pueden borrar los tonos que agregaste ({} es de la plantilla)".format(q))
        en_uso = [k for k in USOS if (cambios_uso.get(k, st["uso"][k]["valor"]) or "").lower() == q]
        if en_uso:
            raise ValueError("No puedes borrar {}: está en uso".format(q))
    with _lock:
        with open(RPT_CONF, encoding="utf-8", errors="replace", newline="") as f:
            original = f.read()
        eol = "\r\n" if "\r\n" in original else "\n"
        lineas = original.splitlines()
        for nombre, txt in nuevos.items():
            poner(lineas, tel, nombre, txt)
        for q in quitar:
            poner(lineas, tel, q, None)
        for k, v in cambios_uso.items():
            poner(lineas, nodo, k, v or None)
        for k, v in cambios_t.items():
            poner(lineas, nodo if TIEMPOS[k][0] == "nodo" else st["seccion_espera"], k, str(v))
        texto = eol.join(lineas) + (eol if original.endswith(("\n", "\r")) else "")
        if texto == original:
            return estado(cfg)
        # Revisión: lo escrito se vuelve a leer igual
        secs = parse(texto)
        for nombre, txt in nuevos.items():
            assert _valor(secs, tel, nombre)[0] == txt, nombre
        if not pendiente() or not os.path.exists(SEGURO):
            shutil.copy2(RPT_CONF, SEGURO)  # lo que Asterisk tiene cargado: a esto se regresa si algo falla
        copia = _respaldar()
        tmp = RPT_CONF + ".aslscan-tmp"
        with open(tmp, "w", encoding="utf-8", newline="") as f:
            f.write(texto)
        shutil.copymode(RPT_CONF, tmp)
        os.replace(tmp, RPT_CONF)
    log.info("Tonos guardados en rpt.conf (copia anterior: %s): %s%s%s", os.path.basename(copia),
             ", ".join(sorted(nuevos)) or "-", "; quitados " + ", ".join(quitar) if quitar else "",
             ("; uso " + ", ".join("{}={}".format(k, v or "ninguno") for k, v in cambios_uso.items()) if cambios_uso else "") +
             ("; tiempos " + ", ".join("{}={}".format(k, v) for k, v in cambios_t.items()) if cambios_t else ""))
    return estado(cfg)


# ── Aplicar (reiniciar Asterisk) ─────────────────────────────────────────────
def _asterisk_arranque():
    """Hora (epoch) en que arrancó Asterisk, o None."""
    try:
        r = subprocess.run([backends.asterisk_bin(), "-rx", "core show uptime seconds"],
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=8)
        m = re.search(r"System uptime:\s*(\d+)", r.stdout.decode(errors="ignore"))
        return time.time() - int(m.group(1)) if m else None
    except Exception:
        return None


def pendiente():
    """¿rpt.conf cambió después de que arrancó Asterisk?"""
    t = _asterisk_arranque()
    try:
        return t is not None and os.path.getmtime(RPT_CONF) > t + 2
    except OSError:
        return False


def _comando_reinicio():
    if os.path.exists("/usr/local/sbin/astres.sh"):          # HamVOIP (el servicio corre como root)
        return ["/usr/local/sbin/astres.sh"] if _euid() == 0 else None
    sc = shutil.which("systemctl") or "/usr/bin/systemctl"
    if _euid() == 0:
        return [sc, "restart", "asterisk"]
    return ["sudo", "-n", sc, "restart", "asterisk"]


def _nodo_arriba(nodo, espera=45):
    fin = time.time() + espera
    while time.time() < fin:
        time.sleep(3)
        try:
            r = subprocess.run([backends.asterisk_bin(), "-rx", "rpt localnodes"],
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=8)
            if re.search(r"^\s*{}\s*$".format(re.escape(nodo)), r.stdout.decode(errors="ignore"), re.M):
                return True
        except Exception:
            pass
    return False


def _reiniciar():
    cmd = _comando_reinicio()
    if not cmd:
        raise RuntimeError("Este nodo no permite reiniciar Asterisk desde la página")
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=90)
    if r.returncode != 0:
        raise RuntimeError("No se pudo reiniciar Asterisk: {}".format(r.stdout.decode(errors="ignore").strip()[-200:]
                                                                     or r.returncode))


def aplicar(cfg, usuario):
    """Reinicia Asterisk en segundo plano; si el nodo no vuelve, regresa la copia anterior."""
    if _aplicar["estado"] == "aplicando":
        raise ValueError("Ya se está aplicando")
    if not _comando_reinicio():
        raise ValueError("Este nodo no permite reiniciar Asterisk desde la página")
    nodo = _nodo(cfg)
    _aplicar.update(estado="aplicando", mensaje="Reiniciando Asterisk…", t=time.time())

    def work():
        try:
            log.warning("%s reinicia Asterisk para aplicar los tonos", usuario)
            _reiniciar()
            if _nodo_arriba(nodo):
                _aplicar.update(estado="ok", mensaje="Listo: Asterisk reinició con los tonos nuevos", t=time.time())
                try:
                    os.remove(SEGURO)
                except OSError:
                    pass
                return
            if not os.path.exists(SEGURO):
                raise RuntimeError("El nodo {} no volvió después de reiniciar y no hay copia para regresar".format(nodo))
            shutil.copy2(SEGURO, RPT_CONF)
            log.error("El nodo %s no volvió: se regresó la configuración anterior", nodo)
            _reiniciar()
            ok = _nodo_arriba(nodo)
            _aplicar.update(estado="error", t=time.time(), mensaje=(
                "El nodo no volvió con los cambios: se regresó la configuración anterior{}".format(
                    "" if ok else ", pero el nodo sigue sin aparecer; revisa Asterisk")))
        except Exception as e:
            log.exception("Aplicar tonos")
            _aplicar.update(estado="error", mensaje=str(e), t=time.time())
    threading.Thread(target=work, daemon=True, name="aslscan-aplicar").start()
    return dict(_aplicar)
