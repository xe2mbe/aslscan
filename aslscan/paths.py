"""Rutas de datos. Todo vive bajo ASLSCAN_DATA (por defecto /var/lib/aslscan)."""
import os
from pathlib import Path


def data_dir():
    d = Path(os.environ.get("ASLSCAN_DATA", "/var/lib/aslscan"))
    if not d.is_dir():
        os.makedirs(str(d), exist_ok=True)
    return d


def _sub(name):
    d = data_dir() / name
    if not d.is_dir():
        os.makedirs(str(d), exist_ok=True)
    return d


def db_file():
    return data_dir() / "aslscan.db"


def settings_file():
    return data_dir() / "settings.json"


def tmp_dir():         # subidas y respaldos en curso; se limpia solo
    return _sub("tmp")


def log_file():
    return data_dir() / "aslscan.log"


def rm(path):
    """Borra un archivo si existe (Path.unlink(missing_ok) es de Python 3.8)."""
    try:
        os.remove(str(path))
    except FileNotFoundError:
        pass
