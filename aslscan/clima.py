"""
ASLSCAN — clima para los anuncios.

Variables que cualquier anuncio puede usar ({temperatura}, {condicion},
{pronostico}…). Los datos salen de:

  · Open-Meteo (open-meteo.com): gratis, sin registro y para cualquier lugar
    del mundo; da las condiciones actuales y el pronóstico.
  · Una estación meteorológica propia en Weather Underground (opcional, con
    su clave de API): si está, sus lecturas (temperatura, humedad, viento,
    presión) reemplazan a las de Open-Meteo.

Se guarda en memoria 10 min. Si en ese momento no se puede consultar, se usa
la última lectura de hasta 3 h; más vieja que eso no se dice (el anuncio se
salta en vez de dar un clima equivocado).
"""
import datetime as dt
import json
import logging
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

log = logging.getLogger("aslscan.clima")

FRESCO = 600                 # s que una lectura se considera actual
VIEJO_MAX = 3 * 3600         # s que se acepta una lectura vieja si no hay conexión
# Para pruebas se pueden apuntar a otro servidor
OM_URL = os.environ.get("ASLSCAN_OPENMETEO", "https://api.open-meteo.com") + "/v1/forecast"
GEO_URL = os.environ.get("ASLSCAN_OPENMETEO_GEO", "https://geocoding-api.open-meteo.com") + "/v1/search"
PWS_URL = os.environ.get("ASLSCAN_PWS", "https://api.weather.com") + "/v2/pws/observations/current"
UA = {"User-Agent": "ASLSCAN (AllStar node dashboard)"}

VARIABLES = [
    ("{temperatura}", "Temperatura actual (22 grados)"),
    ("{sensacion}", "Sensación térmica (20 grados)"),
    ("{condicion}", "Cómo está el cielo (cielo parcialmente nublado)"),
    ("{humedad}", "Humedad relativa (45 por ciento)"),
    ("{viento}", "Viento (15 kilómetros por hora del noreste / en calma)"),
    ("{racha}", "Racha máxima de viento (35 kilómetros por hora)"),
    ("{presion}", "Presión atmosférica (1013 hectopascales)"),
    ("{pronostico}", "Pronóstico de hoy (o de mañana, después de las 4 de la tarde)"),
    ("{lugar}", "Nombre del lugar (Ajustes → Clima)"),
]
NOMBRES_VARS = [v for v, _ in VARIABLES]

# Códigos WMO de Open-Meteo → cómo se dice
WMO = {
    0: "cielo despejado", 1: "cielo mayormente despejado", 2: "cielo parcialmente nublado", 3: "cielo nublado",
    45: "niebla", 48: "niebla con escarcha",
    51: "llovizna ligera", 53: "llovizna", 55: "llovizna intensa", 56: "llovizna helada", 57: "llovizna helada intensa",
    61: "lluvia ligera", 63: "lluvia moderada", 65: "lluvia fuerte", 66: "lluvia helada", 67: "lluvia helada fuerte",
    71: "nevada ligera", 73: "nevada moderada", 75: "nevada fuerte", 77: "granizo menudo",
    80: "chubascos ligeros", 81: "chubascos", 82: "chubascos fuertes", 85: "chubascos de nieve", 86: "chubascos de nieve fuertes",
    95: "tormenta eléctrica", 96: "tormenta eléctrica con granizo", 99: "tormenta eléctrica con granizo fuerte",
}
RUMBOS = ["norte", "noreste", "este", "sureste", "sur", "suroeste", "oeste", "noroeste"]

_lock = threading.Lock()
_cache = {"t": 0.0, "clave": None, "datos": None, "error": ""}


# ── Ajustes ──────────────────────────────────────────────────────────────────
def ubicacion(cfg):
    """(lat, lon) como float, o None si no está configurada."""
    try:
        lat, lon = float(cfg.get("wx_lat")), float(cfg.get("wx_lon"))
    except (TypeError, ValueError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180) or (lat == 0 and lon == 0):
        return None
    return lat, lon


def configurado(cfg):
    return ubicacion(cfg) is not None


def imperial(cfg):
    return cfg.get("wx_unidades") == "imperial"


def tiene(texto):
    return any(v in (texto or "") for v in NOMBRES_VARS)


# ── Consultas ────────────────────────────────────────────────────────────────
def _get(url, timeout=12):
    req = urllib.request.Request(url, headers=UA)
    try:
        return json.loads(urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise RuntimeError("HTTP {}".format(e.code))
    except urllib.error.URLError as e:
        raise RuntimeError("sin conexión ({})".format(e.reason))
    except ValueError:
        raise RuntimeError("respuesta inválida")


def _open_meteo(cfg):
    lat, lon = ubicacion(cfg)
    imp = imperial(cfg)
    q = {"latitude": "{:.4f}".format(lat), "longitude": "{:.4f}".format(lon), "timezone": "auto", "forecast_days": 2,
         "current": "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,"
                    "wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl",
         "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
         "wind_speed_unit": "mph" if imp else "kmh", "temperature_unit": "fahrenheit" if imp else "celsius"}
    d = _get(OM_URL + "?" + urllib.parse.urlencode(q))
    c, dia = d.get("current") or {}, d.get("daily") or {}
    if c.get("temperature_2m") is None:
        raise RuntimeError("Open-Meteo no trajo datos para esa ubicación")
    presion = c.get("pressure_msl")
    if imp and presion is not None:
        presion = presion * 0.02953                     # hPa → inHg
    out = {"temp": c.get("temperature_2m"), "sensacion": c.get("apparent_temperature"),
           "humedad": c.get("relative_humidity_2m"), "viento": c.get("wind_speed_10m"),
           "rumbo": c.get("wind_direction_10m"), "racha": c.get("wind_gusts_10m"), "presion": presion,
           "codigo": c.get("weather_code"), "dias": []}
    for i, fecha in enumerate(dia.get("time") or []):
        def v(k):
            lst = dia.get(k) or []
            return lst[i] if i < len(lst) else None
        out["dias"].append({"fecha": fecha, "codigo": v("weather_code"), "max": v("temperature_2m_max"),
                            "min": v("temperature_2m_min"), "lluvia": v("precipitation_probability_max")})
    return out


def _pws(cfg):
    est, key = (cfg.get("wx_pws_station") or "").strip(), (cfg.get("wx_pws_key") or "").strip()
    imp = imperial(cfg)
    q = {"stationId": est, "format": "json", "units": "e" if imp else "m", "numericPrecision": "decimal", "apiKey": key}
    d = _get(PWS_URL + "?" + urllib.parse.urlencode(q))
    obs = (d.get("observations") or [None])[0]
    if not obs:
        raise RuntimeError("la estación {} no tiene lecturas recientes".format(est))
    u = obs.get("imperial" if imp else "metric") or {}
    temp = u.get("temp")
    sens = temp
    if temp is not None:
        calor, frio = (80, 50) if imp else (27, 10)
        if temp >= calor and u.get("heatIndex") is not None:
            sens = u["heatIndex"]
        elif temp <= frio and u.get("windChill") is not None:
            sens = u["windChill"]
    return {"temp": temp, "sensacion": sens, "humedad": obs.get("humidity"), "viento": u.get("windSpeed"),
            "rumbo": obs.get("winddir"), "racha": u.get("windGust"), "presion": u.get("pressure"),
            "estacion": obs.get("stationID") or est}


def consultar(cfg):
    """Lee Open-Meteo y, si hay, la estación. Devuelve (datos, avisos)."""
    if not configurado(cfg):
        raise RuntimeError("Falta la ubicación del clima (Ajustes → Clima)")
    avisos, datos = [], None
    try:
        datos = _open_meteo(cfg)
        datos["fuente"] = "Open-Meteo"
    except RuntimeError as e:
        avisos.append("Open-Meteo: {}".format(e))
    if (cfg.get("wx_pws_station") or "").strip() and (cfg.get("wx_pws_key") or "").strip():
        try:
            p = _pws(cfg)
            base = datos or {"codigo": None, "dias": []}
            base.update({k: v for k, v in p.items() if v is not None})
            base["fuente"] = "estación {}".format(p["estacion"]) + (" + Open-Meteo" if datos else "")
            datos = base
        except RuntimeError as e:
            avisos.append("Estación: {}".format(e))
    if not datos:
        raise RuntimeError("No pude leer el clima: " + "; ".join(avisos))
    datos["hora"] = time.time()
    return datos, avisos


def _clave(cfg):
    return json.dumps([cfg.get(k) for k in ("wx_lat", "wx_lon", "wx_unidades", "wx_pws_station", "wx_pws_key")])


def datos(cfg, forzar=False):
    """Lectura actual (de la memoria si tiene menos de 10 min). Lanza RuntimeError si no hay nada usable."""
    clave = _clave(cfg)
    with _lock:
        c = dict(_cache)
    edad = time.time() - c["t"]
    if c["datos"] and c["clave"] == clave and edad < FRESCO and not forzar:
        return c["datos"]
    try:
        d, avisos = consultar(cfg)
    except RuntimeError as e:
        with _lock:
            _cache["error"] = str(e)
        if c["datos"] and c["clave"] == clave and edad < VIEJO_MAX:
            log.warning("%s; uso la lectura de hace %d min", e, edad // 60)
            return c["datos"]
        raise
    for a in avisos:
        log.warning("Clima: %s", a)
    with _lock:
        _cache.update(t=time.time(), clave=clave, datos=d, error="; ".join(avisos))
    return d


def en_memoria():
    """Lo último leído (sin consultar), para la página."""
    with _lock:
        return dict(_cache)


def _sin_acentos(t):
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", t.lower()) if unicodedata.category(c) != "Mn")


def buscar_lugar(texto, idioma="es"):
    """Buscador de ciudades de Open-Meteo → [{nombre, region, pais, lat, lon, poblacion}].
    «Durango, México» busca Durango y deja solo los que dicen México en el estado o el país.
    Los más poblados primero."""
    partes = [p.strip() for p in (texto or "").split(",")]
    nombre, filtros = partes[0], [_sin_acentos(p) for p in partes[1:] if p]
    if len(nombre) < 2:
        raise ValueError("Escribe al menos 2 letras del lugar")
    q = {"name": nombre[:80], "count": 30, "language": "en" if idioma == "en" else "es", "format": "json"}
    d = _get(GEO_URL + "?" + urllib.parse.urlencode(q))
    out = []
    for r in d.get("results") or []:
        donde = _sin_acentos(" ".join(str(r.get(k) or "") for k in ("admin1", "admin2", "country", "country_code")))
        if all(f in donde for f in filtros):
            out.append({"nombre": r.get("name", ""), "region": r.get("admin1", ""), "pais": r.get("country", ""),
                        "lat": round(r.get("latitude", 0), 4), "lon": round(r.get("longitude", 0), 4),
                        "poblacion": int(r.get("population") or 0)})
    out.sort(key=lambda x: -x["poblacion"])
    return out[:10]


# ── Cómo se dice ─────────────────────────────────────────────────────────────
def _n(x):
    """Número entero para la voz: -3 → «menos 3»."""
    n = int(round(float(x)))
    return "menos {}".format(-n) if n < 0 else str(n)


def _grados(x):
    return "{} grado{}".format(_n(x), "" if abs(int(round(float(x)))) == 1 else "s")


def _vel(x, cfg):
    return "{} {}".format(_n(x), "millas por hora" if imperial(cfg) else "kilómetros por hora")


def condicion_txt(codigo):
    try:
        return WMO.get(int(codigo), "")
    except (TypeError, ValueError):
        return ""


def _rumbo(grados):
    return RUMBOS[int((float(grados) % 360) / 45.0 + 0.5) % 8]


def _pronostico(d, cfg, now):
    dias = d.get("dias") or []
    hoy = now.strftime("%Y-%m-%d")
    manana = (now + dt.timedelta(days=1)).strftime("%Y-%m-%d")
    quiero, cuando = (manana, "Para mañana") if now.hour >= 16 else (hoy, "Para hoy")
    dia = next((x for x in dias if x["fecha"] == quiero), None)
    if not dia or dia["max"] is None:
        return ""
    t = "{} se espera {}".format(cuando, condicion_txt(dia["codigo"]) or "tiempo variable")
    t += ", con máxima de {} y mínima de {}".format(_grados(dia["max"]), _grados(dia["min"])) if dia["min"] is not None \
        else ", con máxima de {}".format(_grados(dia["max"]))
    if dia["lluvia"] is not None and dia["lluvia"] >= 20:
        t += ", y {} por ciento de probabilidad de lluvia".format(_n(dia["lluvia"]))
    return t + "."


def textos(d, cfg, now=None):
    """{variable: cómo se dice} con la lectura *d*."""
    now = now or dt.datetime.now()
    out = {"{lugar}": (cfg.get("wx_lugar") or "").strip()}
    out["{temperatura}"] = _grados(d["temp"]) if d.get("temp") is not None else ""
    out["{sensacion}"] = _grados(d["sensacion"]) if d.get("sensacion") is not None else out["{temperatura}"]
    out["{humedad}"] = "{} por ciento".format(_n(d["humedad"])) if d.get("humedad") is not None else ""
    v = d.get("viento")
    if v is None:
        out["{viento}"] = ""
    elif float(v) < (2 if imperial(cfg) else 3):
        out["{viento}"] = "en calma"
    else:
        out["{viento}"] = _vel(v, cfg) + (" del {}".format(_rumbo(d["rumbo"])) if d.get("rumbo") is not None else "")
    out["{racha}"] = _vel(d["racha"], cfg) if d.get("racha") is not None else ""
    p = d.get("presion")
    if p is None:
        out["{presion}"] = ""
    elif imperial(cfg):
        out["{presion}"] = "{:.2f} pulgadas de mercurio".format(p).replace(".", " punto ")
    else:
        out["{presion}"] = "{} hectopascales".format(_n(p))
    out["{condicion}"] = condicion_txt(d.get("codigo"))
    out["{pronostico}"] = _pronostico(d, cfg, now)
    return out


def resolver(texto, cfg, now=None):
    """Cambia las variables del clima. Si no hay datos lanza RuntimeError (mejor no decir un clima falso)."""
    if not tiene(texto):
        return texto
    rep = textos(datos(cfg), cfg, now) if any(v in texto for v in NOMBRES_VARS if v != "{lugar}") \
        else {"{lugar}": (cfg.get("wx_lugar") or "").strip()}
    for k, v in rep.items():
        texto = texto.replace(k, v)
    return texto


def probar(cfg):
    """Para Ajustes → Clima: consulta ya y dice qué diría cada variable."""
    d, avisos = consultar(cfg)
    with _lock:
        _cache.update(t=time.time(), clave=_clave(cfg), datos=d, error="; ".join(avisos))
    t = textos(d, cfg)
    return {"fuente": d.get("fuente", ""), "avisos": avisos,
            "variables": [{"var": v, "dice": t.get(v, "")} for v in NOMBRES_VARS]}


def precalentar(cfg, textos_proximos):
    """Si en el próximo minuto sale un anuncio con clima, lee el clima ya (en otro hilo)."""
    if not configurado(cfg) or not any(tiene(t) for t in textos_proximos):
        return
    with _lock:
        c = dict(_cache)
    if c["clave"] == _clave(cfg) and time.time() - c["t"] < FRESCO - 90:
        return

    def leer():
        try:
            datos(cfg, forzar=True)
        except Exception as e:
            log.warning("No pude leer el clima por adelantado: %s", e)
    threading.Thread(target=leer, daemon=True, name="aslscan-clima").start()
