"""Ajustes en JSON (settings.json en la carpeta de datos)."""
import json
import os
import threading

from . import paths

DEFAULTS = {
    # Nodo
    "backend": "auto",          # auto | asl | irlp | simulado
    "node": "",                 # número de nodo ASL o stationid IRLP
    "irlp_env": "/home/irlp/custom/environment",
    "station_name": "",
    "logo_file": "",            # logo de la estación (en la carpeta de datos)

    # Telegram (bot para conectar nodos y avisos)
    "tg_enabled": False,
    "tg_token": "",
    "tg_chat": "",
    "tg_bot_on": True,
    "tg_on_backup": True,
    "tg_on_health": True,
    "tg_on_nodes": True,
    "ab_tg_on": False,
    "ab_sin_claves_nodo": False,   # respaldo automático sin claves: a otro nodo (tuyo) con claves de fábrica
    "ab_sin_claves_nube": True,    # a la nube y por Telegram, sin claves de fábrica
    "ab_sin_claves_tg": True,

    # Panel de nodos (hub.py)
    "hub_on": False,              # mandar el estado de este nodo a un hub cada minuto
    "hub_url": "",                # vacíos: se usan la dirección y el código del respaldo a otro nodo
    "hub_token": "",
    "hub_pin": "",
    "hub_alerta_min": 10,         # en el hub: avisar si un nodo deja de reportar (0 = no avisar)

    # Respaldo automático (ver autobackup.py)
    "ab_enabled": False,
    "ab_hora": "03:30",
    "ab_keep": 7,                 # respaldos que se guardan en la nube
    "ab_node_on": False,
    "ab_node_url": "",
    "ab_node_token": "",
    "ab_node_pin": "",            # huella del certificado del nodo destino
    "ab_cloud_on": False,
    "ab_cloud_folder": "ASLSCAN",
    "ab_recv_keep": 7,            # al recibir: respaldos por nodo

    # Voz de los anuncios (tts.py)
    "tts_engine": "",           # azure | elevenlabs | piper | espeak (vacío = Piper si está, si no Azure)
    "azure_key": "",
    "azure_region": "",
    "azure_voice": "es-MX-DaliaNeural",
    "azure_style": "general",
    "azure_rate": 100,
    "azure_pitch": 0,
    "anuncio_max_seg": 60,      # duración máxima de un anuncio (30–170 s)
    "anuncio_max_chars": 2000,  # caracteres máximos del texto (200–4000)
    "url_dominios": "",         # anuncios desde una dirección: solo estos dominios (vacío = cualquiera público)
    "url_cafile": "",           # archivo de certificados propio para esas direcciones (equipos viejos)
    "espeak_voice": "es-419",
    "eleven_key": "",
    "eleven_voice": "",         # voice_id
    "eleven_voice_name": "",    # solo para mostrarla en Ajustes
    "eleven_model": "eleven_multilingual_v2",
    "eleven_stability": 50,     # %
    "eleven_similarity": 75,    # %
    "eleven_speed": 100,        # % (70–120)

    # Clima para los anuncios (clima.py)
    "wx_lat": "",
    "wx_lon": "",
    "wx_lugar": "",             # cómo se dice el lugar: {lugar}
    "wx_unidades": "metric",    # metric | imperial
    "wx_pws_station": "",       # estación propia en Weather Underground (opcional)
    "wx_pws_key": "",

    # Alertas automáticas (alertas.py); todo apagado. Umbral vacío = esa revisión no se hace.
    "al_clima_on": False,
    "al_viento": "50", "al_racha": "70", "al_lluvia": "20", "al_presion": "4", "al_calor": "40", "al_frio": "-2",
    "al_repetir_min": "60",
    "al_clima_desde": "07:00", "al_clima_hasta": "22:00",
    "al_clima_destino": "local",
    "al_pron_on": False,
    "al_pron_horas": "12", "al_pron_antes": "120, 30",
    "al_pron_prob": "60", "al_pron_mm": "10", "al_pron_racha": "70", "al_pron_calor": "40", "al_pron_frio": "-2",
    "al_pron_tormenta": True,
    "al_sismo_on": False,
    "al_sismo_cerca_km": "300", "al_sismo_cerca_mag": "4.0",
    "al_sismo_region_km": "1500", "al_sismo_region_mag": "6.0",
    "al_sismo_mundo_mag": "7.5",
    "al_sismo_repetir": "2", "al_sismo_cada": "10",
    "al_sismo_destino": "local",

    # Atajos DTMF de ASLSCAN (dtmf.py): código sin el *, vacío = sin atajo
    "dtmf_clima": "",
    "dtmf_sismos": "",
    "pron_dict": [],            # diccionario de pronunciación (pronuncia.py)

    # Seguridad
    "password_hash": "",
    "secret_key": "",
}

DEFAULTS["rc_on"] = False         # permitir que el hub controle este nodo desde su bot (remoto.py)

# Claves que nunca se mandan al navegador
SECRET_KEYS = {"password_hash", "secret_key", "tg_token", "ab_node_token", "hub_token", "azure_key", "eleven_key", "wx_pws_key"}

_lock = threading.Lock()
_cache = None
_mtime = None


def _file_mtime():
    try:
        return paths.settings_file().stat().st_mtime
    except OSError:
        return None


def load():
    """Ajustes en memoria; se releen si otro proceso cambió el archivo
    (por ejemplo aslscan-passwd)."""
    global _cache, _mtime
    with _lock:
        mt = _file_mtime()
        if _cache is None or mt != _mtime:
            _mtime = mt
            data = {}
            f = paths.settings_file()
            if f.is_file():
                try:
                    data = json.loads(f.read_text(encoding="utf-8"))
                except Exception:
                    data = {}
            _cache = {**DEFAULTS, **data}
        return dict(_cache)


def get(key, default=None):
    return load().get(key, DEFAULTS.get(key, default))


def save(updates):
    global _cache, _mtime
    cfg = load()
    cfg.update(updates)
    with _lock:
        f = paths.settings_file()
        tmp = f.with_suffix(".tmp")
        tmp.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
        os.replace(str(tmp), str(f))
        try:
            os.chmod(str(f), 0o600)
        except OSError:
            pass
        _cache = cfg
        _mtime = _file_mtime()
    return dict(cfg)


def public():
    cfg = load()
    out = {k: v for k, v in cfg.items() if k not in SECRET_KEYS}
    out["tg_token_set"] = bool(cfg.get("tg_token"))
    out["ab_node_token_set"] = bool(cfg.get("ab_node_token"))
    out["hub_token_set"] = bool(cfg.get("hub_token"))
    out["azure_key_set"] = bool(cfg.get("azure_key"))
    out["eleven_key_set"] = bool(cfg.get("eleven_key"))
    out["wx_pws_key_set"] = bool(cfg.get("wx_pws_key"))
    return out
