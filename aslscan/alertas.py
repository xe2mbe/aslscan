"""
ASLSCAN — alertas automáticas de clima y sismos.

Tres familias, cada una se enciende aparte (todo viene apagado):

  · Clima ahora: viento, rachas, lluvia intensa, presión que baja rápido,
    calor y frío fuertes, con la lectura de clima.py (Open-Meteo / estación).
    Solo dentro de un horario (de noche no despierta a nadie) y sin repetir el
    mismo aviso antes de N minutos.
  · Pronóstico: lluvia fuerte, tormenta eléctrica, rachas, calor o frío que se
    esperan en las próximas horas; se avisa N minutos antes («120, 30»).
  · Sismos (USGS, mundial y sin clave): cercanos dentro de un radio, de la
    región dentro de otro radio más grande y, si se quiere, los muy fuertes de
    cualquier parte del mundo. Se repiten unas veces.

Las alertas salen por la misma cola que los anuncios (anuncios.emisor), antes
que los anuncios normales y sin interrumpir a nadie: esperan canal libre.
Quedan en la bitácora de anuncios y en el historial de esta página.
"""
import datetime as dt
import json
import logging
import math
import os
import threading
import time
import urllib.error
import urllib.request

from . import clima, horas, paths, settings

log = logging.getLogger("aslscan.alertas")

USGS_URL = os.environ.get("ASLSCAN_USGS", "https://earthquake.usgs.gov") + \
    "/earthquakes/feed/v1.0/summary/2.5_day.geojson"
CADA_CLIMA = 600          # s entre revisiones del clima (lo mismo que dura la lectura en memoria)
CADA_SISMO = 180          # s entre consultas a USGS
SISMO_VIEJO = 1800        # un sismo de hace más de 30 min ya no se anuncia (p. ej. al arrancar)
PRESION_HORAS = 3
HISTORIAL = 40

_lock = threading.Lock()
_trabajando = threading.Event()
_estado = {"clima_t": 0.0, "sismo_t": 0.0, "sismos": [], "sismo_error": "", "clima_error": "",
           "evaluacion": [], "pronostico": []}


# ── Estado guardado (sobrevive reinicios) ────────────────────────────────────
def _archivo():
    return paths.data_dir() / "alertas.json"


def _leer():
    try:
        d = json.loads(_archivo().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        d = {}
    for k, v in (("sismos", {}), ("avisados", {}), ("presion", []), ("pendientes", []), ("historial", [])):
        d.setdefault(k, v)
    return d


def _guardar(d):
    f = _archivo()
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    os.replace(str(tmp), str(f))


# ── Ajustes ──────────────────────────────────────────────────────────────────
def _num(cfg, k):
    """Umbral numérico o None (vacío = esa revisión apagada)."""
    v = cfg.get(k)
    if v is None or str(v).strip() == "":
        return None
    try:
        return float(str(v).replace(",", "."))
    except ValueError:
        return None


def _lista_min(txt):
    out = []
    for x in str(txt or "").replace(";", ",").split(","):
        try:
            n = int(float(x))
        except ValueError:
            continue
        if 0 < n <= 1440 and n not in out:
            out.append(n)
    return sorted(out, reverse=True)


def _en_horario(cfg, now):
    a, b = (cfg.get("al_clima_desde") or "00:00"), (cfg.get("al_clima_hasta") or "23:59")
    hm = now.strftime("%H:%M")
    return a <= hm <= b if a <= b else (hm >= a or hm <= b)


def activas(cfg):
    return bool(cfg.get("al_clima_on") or cfg.get("al_pron_on") or cfg.get("al_sismo_on"))


# ── Cómo se dice ─────────────────────────────────────────────────────────────
def a_las(t):
    """«a las 6 de la tarde» / «a la una de la tarde»."""
    d = horas.decir(t)
    return ("a la una" + d[1:]) if t.hour % 12 == 1 else "a las " + d


def _cuando(t, now):
    dia = "" if t.date() == now.date() else " de mañana" if t.date() == now.date() + dt.timedelta(days=1) \
        else " del {}".format(t.day)
    return a_las(t) + dia


def _mag(m):
    return "{:.1f}".format(m).replace(".", " punto ")


def _lluvia_txt(x, cfg):
    if clima.imperial(cfg):
        return "{:.1f} pulgadas por hora".format(x).replace(".", " punto ")
    return "{} milímetros por hora".format(clima._n(x))


def _dist(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _rumbo_hacia(lat1, lon1, lat2, lon2):
    p1, p2, dl = math.radians(lat1), math.radians(lat2), math.radians(lon2 - lon1)
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return clima._rumbo((math.degrees(math.atan2(x, y)) + 360) % 360)


def _lugar(cfg):
    return (cfg.get("wx_lugar") or "").strip() or "este nodo"


# ── Clima ahora ──────────────────────────────────────────────────────────────
def evaluar_clima(d, cfg, presion_hist):
    """[{tipo, nombre, valor, umbral, alerta, texto}] — lo que se revisa con la lectura actual."""
    imp, lugar = clima.imperial(cfg), _lugar(cfg)
    out = []

    def chk(tipo, nombre, valor, umbral, mayor, texto):
        if umbral is None:
            return
        alerta = valor is not None and (valor >= umbral if mayor else valor <= umbral)
        out.append({"tipo": tipo, "nombre": nombre, "valor": valor, "umbral": umbral, "alerta": alerta,
                    "texto": "Aviso del clima en {}: {}".format(lugar, texto) if alerta else ""})

    t = clima.textos(d, cfg)
    chk("viento", "Viento", d.get("viento"), _num(cfg, "al_viento"), True,
        "viento fuerte de {}.".format(t["{viento}"]))
    chk("racha", "Rachas", d.get("racha"), _num(cfg, "al_racha"), True,
        "rachas de viento de hasta {}.".format(t["{racha}"]))
    chk("lluvia", "Lluvia", d.get("lluvia"), _num(cfg, "al_lluvia"), True,
        "lluvia intensa, de {}.".format(_lluvia_txt(d.get("lluvia") or 0, cfg)))
    chk("calor", "Calor", d.get("temp"), _num(cfg, "al_calor"), True,
        "temperatura muy alta, de {}. Tomen sus precauciones.".format(t["{temperatura}"]))
    chk("frio", "Frío", d.get("temp"), _num(cfg, "al_frio"), False,
        "temperatura muy baja, de {}. Tomen sus precauciones.".format(t["{temperatura}"]))
    um = _num(cfg, "al_presion")
    if um is not None:
        caida = None
        if d.get("presion") is not None and presion_hist:
            caida = max(p for _t, p in presion_hist) - d["presion"]
        alerta = caida is not None and caida >= um
        unidad = "décimas de pulgada" if imp else "hectopascales"
        cant = clima._n(caida * 10) if (imp and caida is not None) else clima._n(caida or 0)
        out.append({"tipo": "presion", "nombre": "Presión (baja en {} h)".format(PRESION_HORAS), "valor": caida,
                    "umbral": um, "alerta": alerta,
                    "texto": "Aviso del clima en {}: la presión bajó {} {} en las últimas {} horas; puede venir mal tiempo."
                    .format(lugar, cant, unidad, PRESION_HORAS) if alerta else ""})
    return out


# ── Pronóstico ───────────────────────────────────────────────────────────────
def _hora_alerta(h, cfg):
    """Qué alerta trae esa hora del pronóstico: [(tipo, valor)]."""
    out = []
    try:
        cod = int(h.get("codigo"))
    except (TypeError, ValueError):
        cod = -1
    if cfg.get("al_pron_tormenta") and cod in (95, 96, 99):
        out.append(("tormenta", cod))
    prob, mm, um_p, um_mm = h.get("prob"), h.get("mm"), _num(cfg, "al_pron_prob"), _num(cfg, "al_pron_mm")
    if um_mm is not None and mm is not None and mm >= um_mm and (um_p is None or (prob or 0) >= um_p):
        out.append(("lluvia", mm))
    for tipo, k, v, mayor in (("racha", "al_pron_racha", h.get("racha"), True), ("calor", "al_pron_calor", h.get("temp"), True),
                              ("frio", "al_pron_frio", h.get("temp"), False)):
        u = _num(cfg, k)
        if u is not None and v is not None and (v >= u if mayor else v <= u):
            out.append((tipo, v))
    return out


def eventos_pronostico(d, cfg, now):
    """Horas seguidas con la misma alerta → un evento: [{tipo, desde, hasta, pico, prob}]."""
    limite = now + dt.timedelta(hours=_num(cfg, "al_pron_horas") or 12)
    eventos, abiertos = [], {}
    for h in d.get("horas") or []:
        t = dt.datetime.strptime(h["t"], "%Y-%m-%d %H:%M")
        if t + dt.timedelta(hours=1) <= now or t > limite:
            continue
        tipos = dict(_hora_alerta(h, cfg))
        for tipo in list(abiertos):
            if tipo not in tipos:
                eventos.append(abiertos.pop(tipo))
        for tipo, v in tipos.items():
            e = abiertos.get(tipo)
            if not e:
                abiertos[tipo] = {"tipo": tipo, "desde": t, "hasta": t, "pico": v, "prob": h.get("prob")}
            else:
                e["hasta"] = t
                e["pico"] = min(e["pico"], v) if tipo == "frio" else max(e["pico"], v)
                e["prob"] = max(e["prob"] or 0, h.get("prob") or 0)
    eventos.extend(abiertos.values())
    return sorted(eventos, key=lambda e: e["desde"])


def texto_pronostico(e, cfg, now):
    lugar, imp = _lugar(cfg), clima.imperial(cfg)
    vel = "millas por hora" if imp else "kilómetros por hora"
    que = {
        "tormenta": "tormenta eléctrica",
        "lluvia": "lluvia fuerte, de hasta {}{}".format(
            "{:.1f} pulgadas".format(e["pico"]).replace(".", " punto ") if imp else "{} milímetros".format(clima._n(e["pico"])),
            " en una hora" + (", con {} por ciento de probabilidad".format(clima._n(e["prob"])) if e.get("prob") else "")),
        "racha": "rachas de viento de hasta {} {}".format(clima._n(e["pico"]), vel),
        "calor": "temperatura de hasta {}".format(clima._grados(e["pico"])),
        "frio": "temperatura de hasta {}".format(clima._grados(e["pico"])),
    }[e["tipo"]]
    if e["desde"] <= now:
        return "Aviso de pronóstico para {}: se espera {} en las próximas horas.".format(lugar, que)
    return "Aviso de pronóstico para {}: se espera {} a partir de {}.".format(lugar, que, _cuando(e["desde"], now)[2:])


NOMBRE_PRON = {"tormenta": "Tormenta eléctrica", "lluvia": "Lluvia fuerte", "racha": "Rachas fuertes",
               "calor": "Calor", "frio": "Frío"}


# ── Sismos ───────────────────────────────────────────────────────────────────
def _usgs():
    req = urllib.request.Request(USGS_URL, headers=clima.UA)
    try:
        d = json.loads(urllib.request.urlopen(req, timeout=20).read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise RuntimeError("USGS HTTP {}".format(e.code))
    except urllib.error.URLError as e:
        raise RuntimeError("sin conexión con USGS ({})".format(e.reason))
    except ValueError:
        raise RuntimeError("respuesta inválida de USGS")
    out = []
    for f in d.get("features") or []:
        p, g = f.get("properties") or {}, (f.get("geometry") or {}).get("coordinates") or []
        if p.get("mag") is None or len(g) < 2 or p.get("type", "earthquake") != "earthquake":
            continue
        out.append({"id": f.get("id"), "mag": float(p["mag"]), "t": (p.get("time") or 0) / 1000.0,
                    "lugar": p.get("place") or "", "lat": g[1], "lon": g[0], "prof": g[2] if len(g) > 2 else None,
                    "url": p.get("url") or ""})
    return out


RUMBO_EN = {"N": "norte", "NNE": "noreste", "NE": "noreste", "ENE": "noreste", "E": "este", "ESE": "sureste", "SE": "sureste",
            "SSE": "sureste", "S": "sur", "SSW": "suroeste", "SW": "suroeste", "WSW": "suroeste", "W": "oeste",
            "WNW": "noroeste", "NW": "noroeste", "NNW": "noroeste"}
PAISES = {"Mexico": "México", "Peru": "Perú", "Philippines": "Filipinas", "Japan": "Japón", "Russia": "Rusia",
          "Turkey": "Turquía", "Greece": "Grecia", "Italy": "Italia", "Iran": "Irán", "Panama": "Panamá",
          "New Zealand": "Nueva Zelanda", "Papua New Guinea": "Papúa Nueva Guinea", "Solomon Islands": "Islas Salomón",
          "Fiji Islands": "las islas Fiyi", "Fiji": "Fiyi", "Taiwan": "Taiwán", "Afghanistan": "Afganistán",
          "Pakistan": "Pakistán", "Canada": "Canadá", "Dominican Republic": "República Dominicana", "Haiti": "Haití",
          "Ecuador": "Ecuador", "Colombia": "Colombia", "Chile": "Chile", "Argentina": "Argentina", "Bolivia": "Bolivia",
          "Guatemala": "Guatemala", "El Salvador": "El Salvador", "Nicaragua": "Nicaragua", "Costa Rica": "Costa Rica",
          "Honduras": "Honduras", "Indonesia": "Indonesia", "China": "China", "India": "India", "Nepal": "Nepal",
          "Vanuatu": "Vanuatu", "Tonga": "Tonga", "Samoa": "Samoa", "Alaska": "Alaska", "Hawaii": "Hawái",
          "California": "California", "Puerto Rico": "Puerto Rico", "Cuba": "Cuba", "Jamaica": "Jamaica",
          "Venezuela": "Venezuela", "Spain": "España", "Portugal": "Portugal", "Morocco": "Marruecos", "Algeria": "Argelia"}


def lugar_usgs(txt):
    """«15 km NNE of Carhuamayo, Peru» → «a 15 kilómetros al noreste de Carhuamayo, Perú»; «Vanuatu region» → «la región de Vanuatu»."""
    import re
    t = (txt or "").strip()
    for en, es in sorted(PAISES.items(), key=lambda x: -len(x[0])):
        t = re.sub(r"(?<![A-Za-z])" + re.escape(en) + r"(?![A-Za-z])", es, t)
    m = re.match(r"^(\d+)\s*km\s+([NSEW]{1,3})\s+of\s+(.+)$", t)
    if m:
        return "a {} kilómetros al {} de {}".format(m.group(1), RUMBO_EN.get(m.group(2), m.group(2)), m.group(3))
    m = re.match(r"^(.+?)\s+region$", t, re.I)
    if m:
        return "en la región de {}".format(m.group(1))
    t = re.sub(r"^(near the coast of|off the coast of)\s+", "frente a la costa de ", t, flags=re.I)
    t = re.sub(r"^(south|north|east|west) of (the )?", lambda x: {"south": "al sur de ", "north": "al norte de ",
                                                                   "east": "al este de ", "west": "al oeste de "}[x.group(1).lower()], t, flags=re.I)
    return t if re.match(r"^(al |frente |a |en )", t) else "en " + t


def clasificar_sismo(s, cfg):
    """("cerca"|"region"|"mundo", distancia km) si cumple algún nivel, o (None, distancia)."""
    ub = clima.ubicacion(cfg)
    dist = _dist(ub[0], ub[1], s["lat"], s["lon"]) if ub else None
    for nivel, km, mag in (("cerca", "al_sismo_cerca_km", "al_sismo_cerca_mag"),
                           ("region", "al_sismo_region_km", "al_sismo_region_mag")):
        k, m = _num(cfg, km), _num(cfg, mag)
        if k is not None and m is not None and dist is not None and dist <= k and s["mag"] >= m:
            return nivel, dist
    m = _num(cfg, "al_sismo_mundo_mag")
    if m is not None and s["mag"] >= m:
        return "mundo", dist
    return None, dist


def texto_sismo(s, nivel, dist, cfg):
    ub = clima.ubicacion(cfg)
    cuando = a_las(dt.datetime.fromtimestamp(s["t"]))
    if nivel == "mundo" or not ub:
        donde = lugar_usgs(s["lugar"]) if s["lugar"] else "lejos de aquí"
    else:
        donde = "a {} kilómetros al {} de {}".format(clima._n(dist), _rumbo_hacia(ub[0], ub[1], s["lat"], s["lon"]), _lugar(cfg))
    return "Aviso de sismo: se registró un sismo de magnitud {}, {}, {}, hora local.".format(_mag(s["mag"]), donde, cuando)


# ── Revisión periódica ───────────────────────────────────────────────────────
def _encolar(st, tipo, nombre, texto, destino, now):
    from . import anuncios
    anuncios.emisor.start()
    anuncios.emisor.encolar_alerta(texto, "⚠ " + nombre, destino)
    st["historial"].insert(0, {"cuando": now.strftime("%Y-%m-%d %H:%M"), "tipo": tipo, "nombre": nombre, "texto": texto})
    del st["historial"][HISTORIAL:]
    log.info("Alerta «%s»: %s", nombre, texto)


def _revisar_clima(cfg, st, now):
    d = clima.datos(cfg)
    ahora = time.time()
    if d.get("presion") is not None:
        st["presion"] = [x for x in st["presion"] if ahora - x[0] <= PRESION_HORAS * 3600]
        hist = list(st["presion"])
        st["presion"].append([ahora, d["presion"]])
    else:
        hist = []
    ev = evaluar_clima(d, cfg, hist)
    rep = (_num(cfg, "al_repetir_min") or 60) * 60
    destino = "red" if cfg.get("al_clima_destino") == "red" else "local"
    if cfg.get("al_clima_on") and _en_horario(cfg, now):
        for x in ev:
            clave = "clima:" + x["tipo"]
            if x["alerta"] and ahora - st["avisados"].get(clave, 0) >= rep:
                st["avisados"][clave] = ahora
                _encolar(st, x["tipo"], "Clima: " + x["nombre"].lower(), x["texto"], destino, now)
    eventos = eventos_pronostico(d, cfg, now) if cfg.get("al_pron_on") else []
    antes = _lista_min(cfg.get("al_pron_antes") or "120, 30")
    pron = []
    for e in eventos:
        due = [m for m in antes if now >= e["desde"] - dt.timedelta(minutes=m)]
        clave = "pron:{}:{}".format(e["tipo"], e["desde"].strftime("%Y-%m-%d %H"))
        hechos = st["avisados"].get(clave) or []
        nuevos = [m for m in due if m not in hechos]
        texto = texto_pronostico(e, cfg, now)
        if nuevos and _en_horario(cfg, now) and e["hasta"] + dt.timedelta(hours=1) > now:
            st["avisados"][clave] = sorted(set(hechos) | set(due))
            _encolar(st, "pron_" + e["tipo"], "Pronóstico: " + NOMBRE_PRON[e["tipo"]].lower(), texto, destino, now)
        pron.append({"tipo": e["tipo"], "nombre": NOMBRE_PRON[e["tipo"]], "desde": e["desde"].strftime("%Y-%m-%d %H:%M"),
                     "hasta": (e["hasta"] + dt.timedelta(hours=1)).strftime("%Y-%m-%d %H:%M"), "texto": texto,
                     "avisos": [(e["desde"] - dt.timedelta(minutes=m)).strftime("%Y-%m-%d %H:%M") for m in antes],
                     "hechos": len(st["avisados"].get(clave) or [])})
    # Limpieza de claves viejas
    st["avisados"] = {k: v for k, v in st["avisados"].items()
                      if not k.startswith("pron:") or k.split(":")[2] >= (now - dt.timedelta(days=2)).strftime("%Y-%m-%d %H")}
    with _lock:
        _estado.update(evaluacion=ev, pronostico=pron, clima_error="", clima_fuente=d.get("fuente", ""),
                       clima_hora=d.get("hora", 0), lectura={k: d.get(k) for k in ("temp", "humedad", "viento", "racha", "presion", "lluvia")},
                       presion_3h=(max(p for _t, p in hist) - d["presion"]) if hist and d.get("presion") is not None else None)


def _revisar_sismos(cfg, st, now):
    lista = _usgs()
    ahora = time.time()
    st["sismos"] = {k: v for k, v in st["sismos"].items() if ahora - v < 3 * 86400}          # ya revisados
    dichos = st.setdefault("sismos_dichos", {})                                                # los que salieron al aire
    st["sismos_dichos"] = dichos = {k: v for k, v in dichos.items() if ahora - v < 3 * 86400}
    vistos = []
    destino = "red" if cfg.get("al_sismo_destino") == "red" else "local"
    veces = max(1, min(5, int(_num(cfg, "al_sismo_repetir") or 1)))
    cada = max(2, int(_num(cfg, "al_sismo_cada") or 10))
    for s in sorted(lista, key=lambda x: x["t"]):
        nivel, dist = clasificar_sismo(s, cfg)
        if nivel:
            vistos.append(dict(s, nivel=nivel, dist=round(dist) if dist is not None else None,
                               avisado=s["id"] in dichos, lugar_es=lugar_usgs(s["lugar"])))
        if not nivel or s["id"] in st["sismos"] or not cfg.get("al_sismo_on"):
            continue
        st["sismos"][s["id"]] = ahora
        if ahora - s["t"] > SISMO_VIEJO:
            continue                                   # ya es viejo (p. ej. el nodo estaba apagado)
        texto = texto_sismo(s, nivel, dist, cfg)
        _encolar(st, "sismo", "Sismo M{:.1f}".format(s["mag"]), texto, destino, now)
        dichos[s["id"]] = ahora
        vistos[-1]["avisado"] = True
        for i in range(1, veces):
            st["pendientes"].append({"cuando": ahora + i * cada * 60, "tipo": "sismo", "nombre": "Sismo M{:.1f} (repetición)".format(s["mag"]),
                                     "texto": texto, "destino": destino})
    with _lock:
        _estado.update(sismos=sorted(vistos, key=lambda x: -x["t"])[:30], sismo_error="")


def _trabajo(cfg, hacer_clima, hacer_sismo, now):
    try:
        st = _leer()
        if hacer_clima:
            try:
                _revisar_clima(cfg, st, now)
            except Exception as e:
                log.warning("Alertas de clima: %s", e)
                with _lock:
                    _estado["clima_error"] = str(e)
        if hacer_sismo:
            try:
                _revisar_sismos(cfg, st, now)
            except Exception as e:
                log.warning("Alertas de sismos: %s", e)
                with _lock:
                    _estado["sismo_error"] = str(e)
        _guardar(st)
    finally:
        _trabajando.clear()


def tick(now=None, forzar=False):
    """Lo llama scheduler.loop cada pocos segundos; el trabajo pesado va en otro hilo."""
    now = (now or dt.datetime.now()).replace(second=0, microsecond=0)
    cfg = settings.load()
    if not clima.configurado(cfg):
        return
    # Repeticiones pendientes (sismos)
    st = None
    ahora = time.time()
    try:
        st = _leer()
        listos = [p for p in st["pendientes"] if p["cuando"] <= ahora]
        if listos:
            st["pendientes"] = [p for p in st["pendientes"] if p["cuando"] > ahora]
            for p in listos:
                if ahora - p["cuando"] < 1800:
                    _encolar(st, p["tipo"], p["nombre"], p["texto"], p["destino"], now)
            _guardar(st)
    except Exception:
        log.exception("Alertas pendientes")
    with _lock:
        hc = forzar or ahora - _estado["clima_t"] >= CADA_CLIMA
        hs = forzar or ahora - _estado["sismo_t"] >= CADA_SISMO
        hc = hc and (cfg.get("al_clima_on") or cfg.get("al_pron_on") or forzar)
        hs = hs and (cfg.get("al_sismo_on") or forzar)
        if not (hc or hs) or _trabajando.is_set():
            return
        if hc:
            _estado["clima_t"] = ahora
        if hs:
            _estado["sismo_t"] = ahora
        _trabajando.set()
    threading.Thread(target=_trabajo, args=(cfg, hc, hs, now), daemon=True, name="aslscan-alertas").start()


def revisar_ahora():
    """Botón «Actualizar»: revisa ya (puede mandar alertas si toca) y espera hasta 30 s."""
    tick(forzar=True)
    fin = time.time() + 30
    while _trabajando.is_set() and time.time() < fin:
        time.sleep(0.3)


def resumen():
    cfg = settings.load()
    st = _leer()
    with _lock:
        e = dict(_estado)
    return {"configurado": clima.configurado(cfg), "lugar": cfg.get("wx_lugar") or "",
            "imperial": clima.imperial(cfg),
            "activas": {"clima": bool(cfg.get("al_clima_on")), "pronostico": bool(cfg.get("al_pron_on")),
                        "sismos": bool(cfg.get("al_sismo_on"))},
            "horario": [cfg.get("al_clima_desde") or "00:00", cfg.get("al_clima_hasta") or "23:59"],
            "clima": {"fuente": e.get("clima_fuente", ""), "hora": e.get("clima_hora", 0), "error": e.get("clima_error", ""),
                      "lectura": e.get("lectura") or {}, "presion_3h": e.get("presion_3h"), "evaluacion": e.get("evaluacion") or [],
                      "revisado": e.get("clima_t", 0)},
            "pronostico": e.get("pronostico") or [],
            "sismos": {"lista": e.get("sismos") or [], "error": e.get("sismo_error", ""), "revisado": e.get("sismo_t", 0)},
            "pendientes": len(st["pendientes"]), "historial": st["historial"][:20]}


EJEMPLOS = {
    "viento": "Aviso del clima en {lugar}: viento fuerte de 55 kilómetros por hora del norte.",
    "lluvia": "Aviso del clima en {lugar}: lluvia intensa, de 18 milímetros por hora.",
    "presion": "Aviso del clima en {lugar}: la presión bajó 4 hectopascales en las últimas 3 horas; puede venir mal tiempo.",
    "pronostico": "Aviso de pronóstico para {lugar}: se espera tormenta eléctrica a partir de las 6 de la tarde.",
    "sismo": "Aviso de sismo: se registró un sismo de magnitud 5 punto 2, a 120 kilómetros al suroeste de {lugar}, a las 3 y 20 de la tarde, hora local.",
}


def ejemplo(tipo, cfg):
    return EJEMPLOS.get(tipo, EJEMPLOS["viento"]).replace("{lugar}", _lugar(cfg))
