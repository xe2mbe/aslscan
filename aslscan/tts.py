"""
ASLSCAN — voz (texto → audio) para los anuncios.

Motores:
  azure   Azure Speech por REST (voces neuronales; requiere internet y clave)
  piper   asl-tts de AllStarLink (Piper, voz neuronal local; apt install asl3-tts)
  espeak  espeak-ng local (sin internet; voz sintética), si está instalado

Todo termina en WAV 8 kHz, 16 bits, mono (lo que Asterisk lee directo con
rpt localplay/playback) sin necesitar ffmpeg ni sox: Azure ya lo entrega así,
asl-tts da µ-law 8 kHz y eSpeak se remuestrea aquí mismo.
"""
import array
import datetime
import html
import json
import logging
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
import wave
from pathlib import Path

from . import horas, paths, pronuncia

log = logging.getLogger("aslscan.voz")

RATE = 8000
NOMBRES = {"azure": "Azure", "piper": "Piper (asl3-tts)", "espeak": "eSpeak NG"}

DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
         "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
VARIABLES = [
    ("{hora}", "Hora actual (HH:MM)"),
    ("{dia}", "Día de la semana"),
    ("{fecha}", "Fecha (dd/mm/aaaa)"),
    ("{fecha_larga}", "Fecha en palabras (2 de noviembre de 2026)"),
    ("{saludo}", "Buenos días / buenas tardes / buenas noches"),
    ("{despedida}", "Buen día / buena tarde / buena noche"),
    ("{nodo}", "Número de nodo"),
]


def _saludo(now, desp=False):
    h = now.hour
    if 5 <= h < 12:
        return "buen día" if desp else "buenos días"
    if 12 <= h < 19:
        return "buena tarde" if desp else "buenas tardes"
    return "buena noche" if desp else "buenas noches"


def tiene_variables(text):
    return any(v in (text or "") for v, _ in VARIABLES) or horas.tiene(text)


def resolver(text, cfg, now=None):
    now = now or datetime.datetime.now()
    text = horas.resolver(text, cfg, now)        # {hora 21:00 America/Chicago}
    rep = {
        "{hora}": now.strftime("%H:%M"),
        "{dia}": DIAS[now.weekday()],
        "{fecha}": now.strftime("%d/%m/%Y"),
        "{fecha_larga}": "{} de {} de {}".format(now.day, MESES[now.month - 1], now.year),
        "{saludo}": _saludo(now),
        "{despedida}": _saludo(now, True),
        "{nodo}": " ".join(str(cfg.get("node") or "")),     # dígito por dígito
    }
    for k, v in rep.items():
        text = text.replace(k, v)
    return text


# ── WAV 8 kHz mono 16 bits ───────────────────────────────────────────────────
def _ulaw_tabla():
    t = []
    for i in range(256):
        u = ~i & 0xFF
        signo, exp, man = u & 0x80, (u >> 4) & 7, u & 0x0F
        v = ((man << 3) + 0x84) << exp
        v -= 0x84
        t.append(-v if signo else v)
    return t


_ULAW = None


def _escribir(out, muestras):
    a = array.array("h", muestras)
    if sys.byteorder == "big":
        a.byteswap()
    with wave.open(str(out), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(a.tobytes())


def a_wav8k(src, out):
    """Convierte un WAV PCM 16 bits (cualquier frecuencia, mono o estéreo) o un
    .ul (µ-law 8 kHz) a WAV 8 kHz mono 16 bits. Devuelve la duración en s."""
    global _ULAW
    src, out = Path(src), Path(out)
    if src.suffix.lower() in (".ul", ".ulaw"):
        if _ULAW is None:
            _ULAW = _ulaw_tabla()
        datos = src.read_bytes()
        _escribir(out, [_ULAW[b] for b in bytearray(datos)])
        return len(datos) / float(RATE)
    with wave.open(str(src), "rb") as w:
        ch, sw, rate, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        crudo = w.readframes(n)
    if sw != 2:
        raise RuntimeError("El audio debe ser PCM de 16 bits")
    a = array.array("h")
    a.frombytes(crudo)
    if sys.byteorder == "big":
        a.byteswap()
    if ch > 1:
        a = array.array("h", [int(sum(a[i:i + ch]) / ch) for i in range(0, len(a) - ch + 1, ch)])
    if rate != RATE:
        paso, m, sal = rate / float(RATE), len(a), []
        total = int(m / paso)
        for i in range(total):
            x = i * paso
            j = int(x)
            f = x - j
            b = a[j + 1] if j + 1 < m else a[j]
            sal.append(int(a[j] + (b - a[j]) * f))
        a = sal
    _escribir(out, a)
    return len(a) / float(RATE)


def duracion(path):
    try:
        with wave.open(str(path), "rb") as w:
            return w.getnframes() / float(w.getframerate())
    except Exception:
        return 0.0


# ── Motores ──────────────────────────────────────────────────────────────────
def piper_disponible():
    return bool(shutil.which("asl-tts"))


def espeak_disponible():
    return bool(shutil.which("espeak-ng") or shutil.which("espeak"))


def motores():
    """Motores que se pueden elegir en este nodo (Azure siempre: solo pide clave)."""
    out = ["azure"]
    if piper_disponible():
        out.append("piper")
    if espeak_disponible():
        out.append("espeak")
    return out


def motor(cfg):
    m = cfg.get("tts_engine") or ""
    if m in motores():
        return m
    return "piper" if piper_disponible() else "azure"


def configurado(cfg):
    m = motor(cfg)
    if m == "azure":
        return bool((cfg.get("azure_key") or "").strip() and (cfg.get("azure_region") or "").strip())
    return True


def _sin_conexion(region, e):
    """«Name or service not known»: casi siempre la región está mal escrita (p. ej. southcentral)."""
    if "not known" in str(e.reason) or "nodename" in str(e.reason) or "getaddrinfo" in str(e.reason):
        return ("La región «{}» no existe en Azure. Escribe el nombre exacto de la región de tu recurso de Speech, "
                "todo junto y en minúsculas: por ejemplo southcentralus, eastus o westus2.".format(region))
    return "No pude conectar con Azure: {}".format(e.reason)


def _azure(text, cfg, out):
    key = (cfg.get("azure_key") or "").strip()
    region = (cfg.get("azure_region") or "").strip()
    if not key or not region:
        raise RuntimeError("Falta la clave o la región de Azure (Ajustes → Voz)")
    voice = cfg.get("azure_voice") or "es-MX-DaliaNeural"
    style = cfg.get("azure_style") or "general"
    rate = int(cfg.get("azure_rate") or 100)
    pitch = int(cfg.get("azure_pitch") or 0)
    locale = voice[:5] if len(voice) >= 5 else "es-MX"
    rate_str = "+{}%".format(rate - 100) if rate >= 100 else "-{}%".format(100 - rate)
    pitch_str = "+{}Hz".format(pitch) if pitch >= 0 else "{}Hz".format(pitch)
    body = '<prosody rate="{}" pitch="{}">{}</prosody>'.format(rate_str, pitch_str, html.escape(text))
    if style and style != "general":
        body = '<mstts:express-as style="{}">{}</mstts:express-as>'.format(html.escape(style), body)
    ssml = ('<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" '
            'xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="{}">'
            '<voice name="{}">{}</voice></speak>').format(locale, html.escape(voice), body)
    req = urllib.request.Request(
        "https://{}.tts.speech.microsoft.com/cognitiveservices/v1".format(region),
        data=ssml.encode("utf-8"), method="POST",
        headers={"Ocp-Apim-Subscription-Key": key, "Content-Type": "application/ssml+xml",
                 "X-Microsoft-OutputFormat": "riff-8khz-16bit-mono-pcm", "User-Agent": "ASLSCAN/1.0"})
    try:
        data = urllib.request.urlopen(req, timeout=60).read()
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise RuntimeError("Azure rechazó la clave (HTTP {}). La clave solo sirve en la región donde se creó: "
                               "revisa que la región («{}») sea la de tu recurso.".format(e.code, region))
        raise RuntimeError("Azure HTTP {}: {}".format(e.code, e.read().decode(errors="ignore")[:200]))
    except urllib.error.URLError as e:
        raise RuntimeError(_sin_conexion(region, e))
    crudo = out.with_name(out.stem + ".az.wav")
    crudo.write_bytes(data)
    return crudo


def _piper(text, cfg, out):
    exe = shutil.which("asl-tts")
    if not exe:
        raise RuntimeError("asl-tts (Piper) no está instalado: sudo apt install asl3-tts")
    base = out.with_name(out.stem + ".pp")
    r = subprocess.run([exe, "-n", str(cfg.get("node") or "0"), "-t", text, "-f", str(base)],
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=300)
    for ext in (".ul", ".ulaw", ".wav"):
        cand = Path(str(base) + ext)
        if cand.is_file() and cand.stat().st_size > 0:
            return cand
    raise RuntimeError("asl-tts no generó audio: " + r.stderr.decode(errors="ignore")[:200])


def _espeak(text, cfg, out):
    exe = shutil.which("espeak-ng") or shutil.which("espeak")
    if not exe:
        raise RuntimeError("eSpeak no está instalado en este nodo")
    crudo = out.with_name(out.stem + ".es.wav")
    txt = out.with_name(out.stem + ".txt")
    txt.write_text(text, encoding="utf-8")
    try:
        r = subprocess.run([exe, "-b", "1", "-v", str(cfg.get("espeak_voice") or "es-419"),
                            "-w", str(crudo), "-f", str(txt)],
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180)
    finally:
        paths.rm(txt)
    if r.returncode != 0 or not crudo.is_file():
        raise RuntimeError("eSpeak falló: " + r.stderr.decode(errors="ignore")[:200])
    return crudo


_MOTORES = {"azure": _azure, "piper": _piper, "espeak": _espeak}


def sintetizar(text, cfg, out, now=None):
    """Texto (con variables resueltas) → WAV 8 kHz en *out*. Devuelve (texto dicho, duración)."""
    dicho = pronuncia.para_voz(resolver(text, cfg, now), cfg).strip()
    if not dicho:
        raise ValueError("Escribe el texto del anuncio")
    out = Path(out)
    m = motor(cfg)
    log.info("Voz %s: %s", m, dicho[:80].replace("\n", " "))
    crudo = _MOTORES[m](dicho, cfg, out)
    try:
        dur = a_wav8k(crudo, out)
    finally:
        if crudo != out:
            paths.rm(crudo)
    return dicho, dur


def azure_voces(key, region):
    req = urllib.request.Request(
        "https://{}.tts.speech.microsoft.com/cognitiveservices/voices/list".format(region),
        headers={"Ocp-Apim-Subscription-Key": key})
    try:
        data = json.loads(urllib.request.urlopen(req, timeout=15).read().decode("utf-8"))
    except urllib.error.HTTPError:
        raise
    except urllib.error.URLError as e:
        raise RuntimeError(_sin_conexion(region, e))
    return [{"name": v["ShortName"], "display": v.get("LocalName", v["ShortName"]),
             "locale": v["Locale"], "gender": v.get("Gender", ""), "styles": v.get("StyleList", [])}
            for v in data if v.get("Locale", "").startswith(("es", "en"))]
