"""ASLSCAN — a qué reflector o nodo está conectado IRLP (lee $LOCAL)."""
import os

CODEC_FLAGS = (("UNCOMP", "-n"), ("ADPCM", "-f"), ("GSM", "-t"))
DEFAULT_PORT = 2074
STALE_SECS = 120


def _read(path):
    try:
        with open(path, encoding="utf-8", errors="ignore") as f:
            return f.read().strip()
    except OSError:
        return ""


def _mtime(path):
    try:
        return os.path.getmtime(path)
    except OSError:
        return 0.0


def target(local_dir):
    """A dónde mandar el audio: la conexión activa de IRLP.

    Devuelve None si el nodo no está conectado, o un dict con active, ip,
    port, codec y flag (ip vacía + error si no se puede saber la IP)."""
    f_active = os.path.join(local_dir, "active")
    active = _read(f_active)
    if not active:
        return None
    t = {"active": active, "ip": "", "port": DEFAULT_PORT, "codec": "", "flag": "-n", "error": ""}
    f_ip = os.path.join(local_dir, "calledip")
    ip = _read(f_ip)
    if not ip or _mtime(f_ip) < _mtime(f_active) - STALE_SECS:
        t["error"] = "IRLP no guardó la IP de esta conexión (¿llamada entrante?)"
        return t
    t["ip"] = ip.split()[0]
    port = _read(os.path.join(local_dir, "udp_port"))
    if port.isdigit():
        t["port"] = int(port)
    codec = _read(os.path.join(local_dir, "codec")).upper()
    t["codec"] = codec or "UNCOMP"
    t["flag"] = next((fl for name, fl in CODEC_FLAGS if codec.startswith(name)), "-n")
    return t


def describe(t):
    if not t:
        return "sin conexión: solo el radio local"
    if not t["ip"]:
        return "{} — {}".format(t["active"], t["error"])
    return "{} ({}:{}, {})".format(t["active"], t["ip"], t["port"], t["codec"])

