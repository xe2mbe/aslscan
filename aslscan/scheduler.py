"""
ASLSCAN — tareas periódicas: el respaldo automático diario y la limpieza de
tmp/. (En HAMNA Web esto lo hace el programador de transmisiones.)
"""
import datetime as dt
import logging
import os
import time

from . import autobackup, paths

log = logging.getLogger("aslscan.tareas")

TICK = 5                 # s
TMP_MAX_AGE = 86400      # archivos de tmp/ de más de un día se borran


def _limpiar_tmp():
    ahora = time.time()
    try:
        for f in paths.tmp_dir().iterdir():
            try:
                if f.is_file() and ahora - f.stat().st_mtime > TMP_MAX_AGE:
                    os.remove(str(f))
            except OSError:
                pass
    except OSError:
        pass


def loop():
    ultimo_tmp = 0.0
    while True:
        try:
            autobackup.tick(dt.datetime.now())
        except Exception:
            log.exception("Error en el respaldo automático")
        if time.time() - ultimo_tmp > 3600:
            ultimo_tmp = time.time()
            _limpiar_tmp()
        time.sleep(TICK)
