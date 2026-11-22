"""
ASLSCAN — qué sistema tiene este equipo (AllStarLink, HamVOIP o IRLP).

ASLSCAN no transmite audio: solo detecta el tipo de nodo, su número y si
Asterisk o los scripts de IRLP responden.
"""
import os
import re
import shlex
import shutil
import subprocess
from pathlib import Path


def asterisk_bin():
    return (shutil.which("asterisk") or
            next((p for p in ("/usr/sbin/asterisk", "/usr/bin/asterisk",
                              "/usr/local/sbin/asterisk") if os.path.exists(p)), "asterisk"))


def detect():
    if os.path.isdir("/home/irlp/scripts") or os.path.isfile("/home/irlp/custom/environment"):
        return "irlp"
    if os.path.isfile("/etc/asterisk/rpt.conf") and os.path.exists(asterisk_bin()):
        return "asl"
    return "simulado"


def kind(cfg):
    """Tipo de nodo según los ajustes (auto = detectado)."""
    k = cfg.get("backend") or "auto"
    return detect() if k == "auto" else k


_etiquetas = None


def etiquetas():
    """Tipo de nodo detectado para las etiquetas de color: [[clase, texto], …] (puede haber dos)."""
    global _etiquetas
    if _etiquetas is None:
        from . import links
        s = links.detect_systems()
        out = []
        if s.get("asl"):
            sabor = detect_flavor()
            out.append(["hamvoip", "HamVOIP"] if sabor == "hamvoip" else ["asl", "ASL3" if sabor == "asl3" else "ASL"])
        if s.get("irlp"):
            out.append(["irlp", "IRLP"])
        _etiquetas = out
    return _etiquetas


def detect_flavor():
    """asl3, hamvoip o asl (ASL2/otros)."""
    if os.path.exists("/usr/local/etc/allstar.env") or os.path.exists("/usr/local/hamvoip-sbin"):
        return "hamvoip"
    if os.path.exists("/etc/asterisk/rpt.conf"):
        try:
            if "asl3" in subprocess.run(["dpkg", "-l", "asl3"], stdout=subprocess.PIPE,
                                        stderr=subprocess.DEVNULL).stdout.decode():
                return "asl3"
        except Exception:
            pass
        return "asl"
    return ""


def detect_asl_node():
    try:
        txt = Path("/etc/asterisk/rpt.conf").read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""
    m = re.search(r"^\[(\d{3,7})\]", txt, re.M)
    return m.group(1) if m else ""


def _rx(cmd, timeout=8):
    r = subprocess.run([asterisk_bin(), "-rx", cmd], stdout=subprocess.PIPE,
                       stderr=subprocess.STDOUT, timeout=timeout)
    return r.returncode, r.stdout.decode(errors="ignore").strip()


def _irlp_sh(cfg, script, timeout=20):
    env = cfg.get("irlp_env") or "/home/irlp/custom/environment"
    q = shlex.quote(env)
    r = subprocess.run(["bash", "-c", "[ -f {0} ] && . {0}; {1}".format(q, script)],
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout)
    return r.returncode, r.stdout.decode(errors="ignore").strip()


def info(cfg):
    """Datos del nodo para Ajustes → Sistema."""
    k = kind(cfg)
    node = cfg.get("node") or (detect_asl_node() if k == "asl" else "")
    d = {"backend": k, "node": node}
    try:
        if k == "asl":
            code, out = _rx("core show version")
            d["asterisk"] = out.splitlines()[0][:120] if out else ""
            code, out = _rx("rpt stats {}".format(node))
            d["nodo_ok"] = "TX time today" in out or "Selected system state" in out
        elif k == "irlp":
            code, out = _irlp_sh(cfg, 'echo "$STATIONID"')
            d["stationid"] = out.splitlines()[-1] if out else ""
    except Exception as e:
        d["error"] = str(e)
    return d


def test(cfg):
    """(bien, mensaje): ¿responde el nodo?"""
    k = kind(cfg)
    if k == "asl":
        node = cfg.get("node") or detect_asl_node()
        try:
            code, out = _rx("rpt stats {}".format(node))
        except Exception as e:
            return False, "No se pudo hablar con Asterisk: {}".format(e)
        if "TX time today" in out or "Selected system state" in out:
            return True, "Asterisk responde y el nodo {} está activo".format(node)
        return False, "El nodo {} no respondió a 'rpt stats': {}".format(node, out[:150])
    if k == "irlp":
        code, out = _irlp_sh(cfg, '[ -x "$SCRIPT/decode" ] && echo "OK $STATIONID"')
        if out.startswith("OK"):
            return True, "Scripts de IRLP encontrados ({})".format(out[3:])
        return False, "No encontré los scripts de IRLP con {}".format(cfg.get("irlp_env"))
    return True, "Modo simulado: no hay radio"
