"""
ASLSCAN — comandos DTMF del nodo (las «functions» de rpt.conf).

Lee la sección de funciones del nodo (la que dice su `functions =`, p. ej.
[functions59624]) junto con sus plantillas ([functions-main] en ASL3), y
permite agregar, cambiar y borrar comandos de la sección propia del nodo.
Las líneas de la plantilla no se tocan: para cambiar una, se agrega en la
sección del nodo el mismo código con otro valor (app_rpt usa el del nodo).

Atajos de ASLSCAN: un anuncio, «clima ahora» o «sismos recientes» pueden tener
su código. ASLSCAN escribe y mantiene esas líneas (las marca con
«; ASLSCAN …»): llaman a bin/aslscan-dtmf, que deja un aviso en
<datos>/dtmf/ y aquí se toma y se pone en la cola de anuncios.

Cada cambio guarda antes una copia de rpt.conf (como Ajustes → Tonos) y se
aplica al reiniciar Asterisk (rptconf.aplicar).
"""
import logging
import os
import re
import threading
import time
from pathlib import Path

from . import backends, paths, rptconf, settings

log = logging.getLogger("aslscan.dtmf")

CODIGO_RX = re.compile(r"^[0-9A-D]{1,8}$")
LINEA_RX = re.compile(r"^\s*([0-9A-Da-d*#]+)\s*=>?\s*(.*?)\s*$")
TIPOS = ("cmd", "ilink", "status", "cop", "macro", "autopatchup", "autopatchdn", "remote", "playback", "localplay")
MARCA = "ASLSCAN"
PROGRAMA = str(Path(__file__).resolve().parent.parent / "bin" / "aslscan-dtmf")
REPETIR_SEG = 20          # el mismo atajo marcado dos veces seguidas no se encola dos veces

ILINK = {
    "1": "Desconecta un enlace (marca después el número de nodo)",
    "2": "Conecta un nodo solo en monitor (marca después el número)",
    "3": "Conecta un nodo en transceptor (marca después el número)",
    "4": "Entra al modo de comandos de un enlace",
    "5": "Dice el estado del sistema (enlaces)",
    "6": "Desconecta todos los enlaces",
    "7": "Dice el último nodo que transmitió",
    "8": "Conecta un nodo en monitor local (marca después el número)",
    "9": "Manda un mensaje de texto",
    "10": "Desconecta los enlaces RANGER",
    "11": "Desconecta un enlace permanente (marca después el número)",
    "12": "Conecta permanente en monitor (marca después el número)",
    "13": "Conecta permanente en transceptor (marca después el número)",
    "15": "Dice el estado completo (todos los nodos)",
    "16": "Reconecta los enlaces que se desconectaron con «desconectar todos»",
    "18": "Conecta permanente en monitor local (marca después el número)",
}
STATUS = {
    "1": "Identificación (a toda la red)", "2": "Dice la hora (a toda la red)", "3": "Dice la versión (a toda la red)",
    "4": "Dice la ubicación GPS (a toda la red)", "5": "Dice el último usuario de DTMF (a toda la red)",
    "11": "Identificación (solo local)", "12": "Dice la hora (solo local)", "13": "Dice la versión (solo local)",
    "14": "Dice la ubicación GPS (solo local)", "15": "Dice el último usuario de DTMF (solo local)",
}
COP = {
    "1": "Reinicio del sistema (warm boot)", "2": "Habilita el sistema", "3": "Deshabilita el sistema",
    "4": "Tono de prueba (prende/apaga)", "5": "Muestra las variables del sistema", "6": "PTT (modo teléfono)",
    "7": "Habilita el límite de tiempo de transmisión", "8": "Deshabilita el límite de tiempo de transmisión",
    "9": "Habilita el autopatch", "10": "Deshabilita el autopatch", "11": "Habilita los enlaces",
    "12": "Deshabilita los enlaces", "13": "Dice el estado del sistema", "14": "Cambia el estado del sistema",
    "15": "Habilita el programador", "16": "Deshabilita el programador", "17": "Habilita las funciones de usuario",
    "18": "Deshabilita las funciones de usuario", "19": "Cola de transmisión alterna", "20": "Cola de transmisión normal",
    "21": "Habilita el loro (parrot)", "22": "Deshabilita el loro (parrot)", "23": "Loro una vez", "24": "Vacía la cola de telemetría",
    "32": "Prueba de tonos DTMF", "33": "Deshabilita la telemetría local", "34": "Habilita la telemetría local",
    "35": "Telemetría local apagada", "36": "Telemetría local encendida", "42": "Anuncio de EchoLink",
    "49": "No acepta conexiones entrantes", "50": "Acepta conexiones entrantes", "55": "Loro una vez (graba y repite)",
}
CUIDADO_CMD = re.compile(r"astres|restart|reboot|shutdown|poweroff|halt|rm\s", re.I)
CUIDADO_COP = {"1", "2", "3", "9", "10", "11", "12", "14", "17", "18"}

_lock = threading.Lock()
_ultimo = {}
_hilo = {"t": None}


# ── Leer ─────────────────────────────────────────────────────────────────────
def _leer_conf():
    with open(rptconf.RPT_CONF, encoding="utf-8", errors="replace", newline="") as f:
        return f.read()


def _funciones(texto):
    """{sección: [{codigo, valor, comentario}]} de TODAS las secciones (en orden)."""
    out, cur = {}, None
    for ln in texto.splitlines():
        s = ln.strip()
        if not s or s.startswith((";", "#")):
            continue
        m = rptconf.HDR_RX.match(rptconf._sin_comentario(s).strip())
        if m:
            cur = out.setdefault(m.group(1).strip(), [])
            continue
        i = ln.find(";")
        cuerpo, com = (ln, "") if i < 0 else (ln[:i], ln[i + 1:].strip())
        m = LINEA_RX.match(cuerpo)
        if m and cur is not None:
            cur.append({"codigo": m.group(1).upper(), "valor": m.group(2).strip(), "comentario": com})
    return out


def _cadena(secs, seccion, visto=None):
    """[sección, plantilla, plantilla de la plantilla…]"""
    visto = visto or []
    if seccion in visto or seccion not in secs:
        return visto
    visto.append(seccion)
    for t in secs[seccion]["plantillas"]:
        _cadena(secs, t, visto)
    return visto


def describir(valor, comentario=""):
    """(tipo, qué hace en palabras, ¿cuidado?)"""
    partes = [x.strip() for x in (valor or "").split(",")]
    tipo = partes[0].lower()
    arg = partes[1] if len(partes) > 1 else ""
    if tipo == "cmd":
        prog = (",".join(partes[1:])).strip()
        nombre = os.path.basename(prog.split()[0]) if prog else ""
        if MARCA in comentario or "aslscan-dtmf" in prog:
            return tipo, comentario.replace(MARCA + ":", "").strip() or "Atajo de ASLSCAN", False
        return tipo, "Ejecuta {}".format(nombre or "un comando"), bool(CUIDADO_CMD.search(prog))
    if tipo == "ilink":
        return tipo, ILINK.get(arg, "Enlaces (ilink {})".format(arg)), arg in ("6", "10")
    if tipo == "status":
        return tipo, STATUS.get(arg, "Información (status {})".format(arg)), False
    if tipo == "cop":
        return tipo, COP.get(arg, "Operación del nodo (cop {})".format(arg)), arg in CUIDADO_COP
    if tipo == "macro":
        return tipo, "Ejecuta la macro {}".format(arg) if arg else "Macro (marca después el número de la macro)", False
    if tipo == "autopatchup":
        return tipo, "Descuelga el autopatch (llamada telefónica)", True
    if tipo == "autopatchdn":
        return tipo, "Cuelga el autopatch", False
    if tipo == "remote":
        return tipo, "Base remota ({})".format(arg or "control"), False
    if tipo in ("playback", "localplay"):
        return tipo, "Reproduce el audio {}".format(os.path.basename(arg)) if arg else "Reproduce un audio", False
    return tipo, "Función {}".format(tipo or "?"), False


def _conflicto(codigo, otros):
    """El primer código que choca: igual, o uno es el principio del otro (*8 y *81)."""
    for o in otros:
        if o == codigo or o.startswith(codigo) or codigo.startswith(o):
            return o
    return None


def estado(cfg=None):
    cfg = cfg or settings.load()
    base = {"disponible": False, "archivo": rptconf.RPT_CONF, "aplicando": dict(rptconf._aplicar)}
    if backends.kind(cfg) != "asl":
        return dict(base, motivo="Solo en nodos AllStarLink / HamVOIP")
    try:
        texto = _leer_conf()
    except OSError as e:
        return dict(base, motivo="No pude leer {}: {}".format(rptconf.RPT_CONF, e))
    secs, funcs = rptconf.parse(texto), _funciones(texto)
    nodo = rptconf._nodo(cfg)
    if nodo not in secs:
        return dict(base, motivo="No encontré la sección [{}] en rpt.conf".format(nodo))
    propia, _ = rptconf._valor(secs, nodo, "functions")
    if not propia or propia not in secs:
        return dict(base, motivo="El nodo {} no tiene «functions =» en rpt.conf".format(nodo))
    funcchar = (rptconf._valor(secs, nodo, "funcchar")[0] or "*").strip()[:1] or "*"
    otras = {k: rptconf._valor(secs, nodo, k)[0] for k in ("link_functions", "phone_functions")}
    compartida = sorted(n for n, s in secs.items() if re.match(r"^\d+$", n) and n != nodo
                        and rptconf._valor(secs, n, "functions")[0] == propia)
    vistos, lista = {}, []
    for sec in _cadena(secs, propia):
        for e in funcs.get(sec, []):
            if e["codigo"] in vistos:
                if sec != propia:
                    vistos[e["codigo"]]["reemplaza"] = e["valor"]
                continue
            tipo, que, cuidado = describir(e["valor"], e["comentario"])
            x = dict(e, tipo=tipo, que=que, cuidado=cuidado, origen=sec, propio=sec == propia,
                     aslscan=sec == propia and MARCA in e["comentario"], reemplaza="")
            vistos[e["codigo"]] = x
            lista.append(x)
    codigos = [x["codigo"] for x in lista]
    for x in lista:
        x["choca"] = _conflicto(x["codigo"], [c for c in codigos if c != x["codigo"]]) or ""
    lista.sort(key=lambda x: (len(x["codigo"]) > 2, x["codigo"]))
    return dict(base, disponible=True, nodo=nodo, seccion=propia, funcchar=funcchar, plantillas=_cadena(secs, propia)[1:],
                link_functions=otras["link_functions"], phone_functions=otras["phone_functions"], compartida=compartida,
                comandos=lista, pendiente=rptconf.pendiente(), puede_aplicar=bool(rptconf._comando_reinicio()),
                atajos=atajos_estado(cfg), catalogo={"ilink": ILINK, "status": STATUS, "cop": COP})


# ── Escribir ─────────────────────────────────────────────────────────────────
def _limpiar(t, maximo=200):
    t = re.sub(r"[\r\n;]+", " ", str(t or "")).strip()
    return t[:maximo]


def normalizar_codigo(c):
    c = str(c or "").strip().upper().lstrip("*")
    if c and not CODIGO_RX.match(c):
        raise ValueError("El código DTMF solo lleva 0-9 y A-D (de 1 a 8 teclas, sin el *)")
    return c


def armar_valor(tipo, args):
    tipo = str(tipo or "").strip().lower()
    if tipo not in TIPOS:
        raise ValueError("Tipo de comando inválido")
    if re.search(r"[;\r\n]", str(args or "")):
        raise ValueError("El comando no puede llevar «;» (en rpt.conf empieza un comentario) ni saltos de línea")
    args = _limpiar(args, 300)
    if tipo in ("cmd", "playback", "localplay") and not args:
        raise ValueError("Escribe el comando o el audio")
    if tipo in ("ilink", "status", "cop") and not re.match(r"^\d{1,4}(,.*)?$", args):
        raise ValueError("Escribe el número de {} (p. ej. 3)".format(tipo))
    return tipo + ("," + args if args else "")


def _cambiar(quitar=(), poner=()):
    """quitar: [código] de la sección propia; poner: [(código, valor, comentario)]."""
    cfg = settings.load()
    st = estado(cfg)
    if not st["disponible"]:
        raise ValueError(st.get("motivo") or "No disponible")
    sec = st["seccion"]
    with rptconf._lock:
        original = _leer_conf()
        eol = "\r\n" if "\r\n" in original else "\n"
        lineas = original.splitlines()
        quitar = {q.upper() for q in quitar} | {c.upper() for c, _v, _k in poner}
        ini, fin = rptconf._rango(lineas, sec)
        i = ini + 1
        while i < fin:
            ln = lineas[i]
            j = ln.find(";")
            m = LINEA_RX.match(ln if j < 0 else ln[:j])
            if m and not ln.strip().startswith((";", "#")) and m.group(1).upper() in quitar:
                del lineas[i]
                fin -= 1
                continue
            i += 1
        pos = ini + 1
        for i in range(ini + 1, fin):
            j = lineas[i].find(";")
            if LINEA_RX.match(lineas[i] if j < 0 else lineas[i][:j]) and not lineas[i].strip().startswith((";", "#")):
                pos = i + 1
        for c, v, k in poner:
            lineas.insert(pos, "{} = {}{}".format(c, v, ("    ; " + k) if k else ""))
            pos += 1
        texto = eol.join(lineas) + (eol if original.endswith(("\n", "\r")) else "")
        if texto == original:
            return False
        nuevas = {e["codigo"]: e["valor"] for e in _funciones(texto).get(sec, [])}
        for c, v, _k in poner:
            assert nuevas.get(c.upper()) == v, c
        copia = rptconf._escribir(texto)
    log.info("DTMF en [%s] (copia anterior: %s): %s%s", sec, os.path.basename(copia),
             ", ".join("{}={}".format(c, v) for c, v, _k in poner) or "-",
             "; quitados " + ", ".join(sorted(quitar - {c.upper() for c, _v, _k in poner})) if quitar else "")
    return True


def guardar_comando(codigo, tipo, args, comentario="", antes=""):
    """Agrega o cambia un comando de la sección del nodo. *antes* = el código que se está editando."""
    codigo, antes = normalizar_codigo(codigo), normalizar_codigo(antes)
    if not codigo:
        raise ValueError("Escribe el código DTMF")
    st = estado()
    if not st["disponible"]:
        raise ValueError(st.get("motivo") or "No disponible")
    previo = next((x for x in st["comandos"] if x["codigo"] == antes), None) if antes else None
    if previo and previo["aslscan"]:
        raise ValueError("Ese código es un atajo de ASLSCAN: cámbialo en su anuncio o en los atajos")
    otros = [x["codigo"] for x in st["comandos"] if x["codigo"] not in (antes, codigo)]
    mismo = next((x for x in st["comandos"] if x["codigo"] == codigo), None)
    if mismo and codigo != antes and mismo["propio"]:
        raise ValueError("El código *{} ya existe en este nodo".format(codigo))
    choca = _conflicto(codigo, otros)
    if choca:
        raise ValueError("*{} choca con *{}: al marcarlo el nodo no sabría cuál es".format(codigo, choca))
    valor = armar_valor(tipo, args)
    quitar = [antes] if antes and antes != codigo else []
    _cambiar(quitar, [(codigo, valor, _limpiar(comentario, 120))])
    return estado()


def borrar_comando(codigo):
    codigo = normalizar_codigo(codigo)
    st = estado()
    x = next((c for c in st.get("comandos", []) if c["codigo"] == codigo), None)
    if not x:
        raise ValueError("Ese código ya no existe")
    if not x["propio"]:
        raise ValueError("*{} viene de la plantilla [{}]: no se borra; puedes agregar el mismo código con otro valor".format(codigo, x["origen"]))
    if x["aslscan"]:
        raise ValueError("Ese código es un atajo de ASLSCAN: quítalo en su anuncio o en los atajos")
    _cambiar([codigo], [])
    return estado()


def probar(codigo):
    codigo = normalizar_codigo(codigo)
    st = estado()
    if not st["disponible"]:
        raise ValueError(st.get("motivo") or "No disponible")
    from . import sessions
    out = sessions._rx("rpt fun {} {}{}".format(st["nodo"], st["funcchar"], codigo), timeout=10)
    if re.search(r"(?i)no such|not found|unable|usage|invalid", out or ""):
        raise RuntimeError("Asterisk respondió: " + out.strip()[:200])
    return out.strip()


# ── Atajos de ASLSCAN ────────────────────────────────────────────────────────
def _deseados(cfg):
    """{código: (valor, comentario, destino)} de los atajos que ASLSCAN debe tener en rpt.conf."""
    from . import anuncios
    out = {}
    for a in anuncios.lista():
        c = (a.get("dtmf") or "").upper()
        if c:
            out[c] = ("cmd,{} anuncio {}".format(PROGRAMA, a["id"]), "{}: anuncio {}".format(MARCA, _limpiar(a["nombre"], 60)), "anuncio:{}".format(a["id"]))
    for k, tipo, nombre in (("dtmf_clima", "clima", "clima ahora"), ("dtmf_sismos", "sismos", "sismos recientes")):
        c = (cfg.get(k) or "").upper()
        if c:
            out[c] = ("cmd,{} {} 0".format(PROGRAMA, tipo), "{}: {}".format(MARCA, nombre), tipo)
    return out


def atajos_estado(cfg):
    from . import anuncios
    return {"clima": cfg.get("dtmf_clima") or "", "sismos": cfg.get("dtmf_sismos") or "",
            "anuncios": [{"id": a["id"], "nombre": a["nombre"], "dtmf": a.get("dtmf") or ""} for a in anuncios.lista() if a.get("dtmf")]}


def validar_atajo(codigo, destino, cfg=None):
    """¿Se puede usar *codigo* para *destino* («anuncio:3», «clima», «sismos»)? Devuelve el código limpio."""
    codigo = normalizar_codigo(codigo)
    if not codigo:
        return ""
    cfg = cfg or settings.load()
    st = estado(cfg)
    if not st["disponible"]:
        raise ValueError("DTMF: " + (st.get("motivo") or "no disponible en este nodo"))
    deseados = _deseados(cfg)
    mio = {c for c, (_v, _k, d) in deseados.items() if d == destino}
    otros_aslscan = {c for c, (_v, _k, d) in deseados.items() if d != destino}
    if codigo in otros_aslscan:
        raise ValueError("El código *{} ya lo usa otro atajo de ASLSCAN".format(codigo))
    existentes = [x["codigo"] for x in st["comandos"] if x["codigo"] not in mio]
    choca = _conflicto(codigo, existentes + list(otros_aslscan))
    if choca:
        raise ValueError("*{} choca con *{} que ya tiene el nodo: elige otro".format(codigo, choca))
    return codigo


def sincronizar(cfg=None):
    """Deja en rpt.conf exactamente los atajos de ASLSCAN que tocan. Devuelve True si cambió algo."""
    cfg = cfg or settings.load()
    st = estado(cfg)
    if not st["disponible"]:
        return False
    deseados = _deseados(cfg)
    actuales = {x["codigo"]: x for x in st["comandos"] if x["aslscan"]}
    quitar = [c for c in actuales if c not in deseados]
    poner = [(c, v, k) for c, (v, k, _d) in deseados.items()
             if c not in actuales or actuales[c]["valor"] != v or actuales[c]["comentario"] != k]
    if not quitar and not poner:
        return False
    return _cambiar(quitar, poner)


# ── Lo que llega de Asterisk (bin/aslscan-dtmf) ──────────────────────────────
def carpeta():
    d = paths.data_dir() / "dtmf"
    if not d.is_dir():
        os.makedirs(str(d), exist_ok=True)
        try:
            os.chmod(str(d), 0o1777)          # Asterisk puede correr con otro usuario
        except OSError:
            pass
    return d


def _atender(tipo, n):
    from . import alertas, anuncios
    clave = "{}:{}".format(tipo, n)
    ahora = time.time()
    if ahora - _ultimo.get(clave, 0) < REPETIR_SEG:
        return
    _ultimo[clave] = ahora
    cfg = settings.load()
    if tipo == "anuncio":
        a = next((x for x in anuncios.lista() if x["id"] == n and x.get("dtmf")), None)
        if not a:
            log.warning("DTMF: el anuncio %s ya no tiene código", n)
            return
        anuncios.emisor.start()
        anuncios.emisor.encolar(n, "dtmf")
        log.info("DTMF: anuncio «%s»", a["nombre"])
    elif tipo == "clima" and cfg.get("dtmf_clima"):
        anuncios.emisor.start()
        anuncios.emisor.encolar_alerta(TEXTO_CLIMA, "DTMF: clima ahora", "local")
        log.info("DTMF: clima ahora")
    elif tipo == "sismos" and cfg.get("dtmf_sismos"):
        anuncios.emisor.start()
        anuncios.emisor.encolar_alerta(alertas.texto_sismos_recientes(cfg), "DTMF: sismos recientes", "local")
        log.info("DTMF: sismos recientes")


TEXTO_CLIMA = ("{saludo}. Reporte del clima en {lugar}: {condicion}. Temperatura de {temperatura}, "
               "sensación térmica de {sensacion}. Humedad del {humedad}. Viento {viento}. {pronostico}")


def revisar_carpeta():
    d = carpeta()
    for f in sorted(d.glob("*.req")):
        try:
            txt = f.read_text(encoding="utf-8", errors="ignore").split()
            viejo = time.time() - f.stat().st_mtime > 120
        except OSError:
            continue
        finally:
            try:
                os.remove(str(f))
            except OSError:
                pass
        if viejo or len(txt) < 1 or txt[0] not in ("anuncio", "clima", "sismos"):
            continue
        try:
            _atender(txt[0], int(txt[1]) if len(txt) > 1 and txt[1].isdigit() else 0)
        except Exception:
            log.exception("DTMF %s", txt)
    for f in d.glob("*.tmp"):
        try:
            if time.time() - f.stat().st_mtime > 120:
                os.remove(str(f))
        except OSError:
            pass


def _loop():
    while True:
        try:
            revisar_carpeta()
        except Exception:
            log.exception("Revisando la carpeta de DTMF")
        time.sleep(1)


def start():
    if not _hilo["t"]:
        _hilo["t"] = threading.Thread(target=_loop, daemon=True, name="aslscan-dtmf")
        _hilo["t"].start()
