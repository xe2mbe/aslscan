"""
ASLSCAN — ¿hay otros programas que también hablen en este nodo?

Muchos nodos ya anuncian la hora (saytime.pl), el clima u otros audios desde
el cron. Si además se programa lo mismo en ASLSCAN se oiría dos veces y los
audios se pueden encimar. Aquí solo se avisa: nunca se toca nada de otros
programas.

Se revisa lo que el usuario del servicio puede leer: /etc/crontab,
/etc/cron.d, su propio crontab y los de /var/spool/cron cuando se dejan leer
(HamVOIP corre como root). El crontab de root en ASL3 no se puede leer; para
saytime.pl se mira además si su audio (/tmp/current-time.*) se generó hace poco.
"""
import glob
import os
import re
import subprocess
import threading
import time

CACHE = 600
RECIENTE = 3 * 3600
TIPOS = [
    ("hora", re.compile(r"say24time|saytime|say_time|sayhour", re.I)),
    ("clima", re.compile(r"severe_weather|say_?weather|weather_?alert|wx_?alert|saywx|weather.*\b(say|announce|play)", re.I)),
    ("audio", re.compile(r"rpt\s+(localplay|playback)|localannounce|playglobal|speaktext|asl-tts|\bplaytext\b", re.I)),
]

_lock = threading.Lock()
_cache = {"t": 0.0, "datos": []}


def _leer(p):
    try:
        with open(p, encoding="utf-8", errors="ignore") as f:
            return f.read()
    except OSError:
        return None


def _crontabs():
    """[(dónde, texto)] de los crontab que se dejan leer."""
    out = []
    for p in ["/etc/crontab"] + sorted(glob.glob("/etc/cron.d/*")) + sorted(glob.glob("/var/spool/cron/crontabs/*")) \
            + sorted(glob.glob("/var/spool/cron/*")):
        if os.path.isfile(p):
            t = _leer(p)
            if t:
                out.append((p, t))
    try:
        r = subprocess.run(["crontab", "-l"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=5)
        if r.returncode == 0 and r.stdout:
            out.append(("crontab -l", r.stdout.decode("utf-8", "ignore")))
    except (OSError, subprocess.SubprocessError):
        pass
    return out


def _corto(linea):
    linea = re.sub(r"\s+", " ", linea).strip()
    return linea if len(linea) <= 140 else linea[:137] + "…"


def _buscar():
    vistos, out = set(), []

    def agrega(que, donde, detalle):
        if (que, donde, detalle) not in vistos:
            vistos.add((que, donde, detalle))
            out.append({"que": que, "donde": donde, "detalle": detalle})

    for donde, texto in _crontabs():
        for linea in texto.splitlines():
            l = linea.strip()
            if not l or l.startswith("#") or re.match(r"^\w+\s*=", l):
                continue
            for que, rx in TIPOS:
                if rx.search(l):
                    # saytime.pl con estación (dos argumentos) también dice el clima
                    if que == "hora" and re.search(r"saytime\S*\s+\S+\s+\d{3,7}\b", l):
                        agrega("clima", donde, _corto(l))
                    agrega(que, donde, _corto(l))
                    break
    if not any(x["que"] == "hora" for x in out):
        for p in glob.glob("/tmp/current-time.*"):
            try:
                edad = time.time() - os.path.getmtime(p)
            except OSError:
                continue
            if edad < RECIENTE:
                agrega("hora", p, "saytime.pl generó este audio hace {} min (su cron no se puede leer desde aquí)".format(int(edad // 60)))
                break
    return out


def revisar(forzar=False):
    with _lock:
        if not forzar and time.time() - _cache["t"] < CACHE:
            return list(_cache["datos"])
    try:
        datos = _buscar()
    except Exception:
        datos = []
    with _lock:
        _cache.update(t=time.time(), datos=datos)
    return list(datos)
