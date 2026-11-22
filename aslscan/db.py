"""
ASLSCAN — base de datos SQLite (usuarios, sesiones, panel de nodos, códigos
de respaldo). Cada módulo crea sus propias tablas.
"""
import sqlite3
import threading
from contextlib import contextmanager

from . import paths

_lock = threading.RLock()


def _connect():
    conn = sqlite3.connect(str(paths.db_file()), timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def conn():
    with _lock:
        c = _connect()
        try:
            yield c
            c.commit()
        finally:
            c.close()


def rows(sql, args=()):
    with conn() as c:
        return [dict(r) for r in c.execute(sql, args).fetchall()]


def row(sql, args=()):
    with conn() as c:
        r = c.execute(sql, args).fetchone()
        return dict(r) if r else None


def execute(sql, args=()):
    with conn() as c:
        cur = c.execute(sql, args)
        return cur.lastrowid


def init_db():
    with conn() as c:
        c.execute("PRAGMA journal_mode = WAL")
