/* ASLSCAN — interfaz (Dashboard de HAMNA Web por separado) */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

const S = { tab: "conexiones", status: null, cfg: null, info: null, setSec: "nodo" };
try { S.setSec = new URLSearchParams(location.search).get("set") || localStorage.getItem("aslscan.set") || "nodo"; } catch {}

/* ── API ─────────────────────────────────────────────────────────────────── */
async function api(path, { method = "GET", json, form } = {}) {
  const opt = { method, headers: { "X-ASLSCAN": "1" }, credentials: "same-origin" };
  if (json !== undefined) { opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(json); }
  if (form) opt.body = form;
  const r = await fetch(path, opt);
  if (r.status === 401 && path !== "api/login") { showLogin(); throw new Error("Inicia sesión"); }
  let data = null;
  try { data = await r.json(); } catch { data = null; }
  if (!r.ok || (data && data.ok === false)) throw new Error((data && data.error) || `Error ${r.status}`);
  return data;
}

function toast(msg, isErr = false) {
  const t = $("#toast");
  t.textContent = msg; t.className = "toast" + (isErr ? " error" : "");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), isErr ? 6000 : 2800);
}
async function run(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; }
  catch (e) { toast(e.message, true); throw e; }
}
function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = label || "Procesando…"; }
  else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
}

const fmt = (s) => {
  s = Math.max(0, Math.round(+s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0");
};
const fmtLeft = (s) => {
  if (s == null) return "";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d} d ${h} h`;
  if (h) return `${h} h ${m} min`;
  if (m) return `${m} min`;
  return `${s} s`;
};

/* ── Modal ───────────────────────────────────────────────────────────────── */
function openModal(title, html) {
  $("#modalTitle").textContent = title;
  $("#modalBody").innerHTML = html;
  $("#modal").classList.remove("hidden");
  const f = $("#modalBody input:not([type=hidden]):not([type=checkbox]), #modalBody textarea");
  if (f) setTimeout(() => f.focus(), 30);
}
function closeModal() {
  $$("#modalBody audio").forEach((a) => a.pause());
  $("#modal").classList.add("hidden");
  $("#modalBody").innerHTML = "";
}
$("#modalClose").onclick = closeModal;
$("#modal").addEventListener("mousedown", (e) => { if (e.target.id === "modal") closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
function confirmBox(msg, okLabel = "Sí, continuar", danger = true) {
  return new Promise((res) => {
    openModal("Confirmar", `<p>${esc(msg)}</p><div class="modal-actions">
      <button class="btn" id="cNo">Cancelar</button>
      <button class="btn ${danger ? "danger" : "primary"}" id="cYes">${esc(okLabel)}</button></div>`);
    $("#cNo").onclick = () => { closeModal(); res(false); };
    $("#cYes").onclick = () => { closeModal(); res(true); };
  });
}

/* ── Sesión ──────────────────────────────────────────────────────────────── */
function showLogin() {
  $("#app").classList.add("hidden"); $("#login").classList.remove("hidden");
  // el panel «Mi perfil» y las ventanas están fuera de la página: también se cierran
  $("#perfil").classList.add("hidden"); $("#pwOld").value = $("#pwNew").value = "";
  if (!$("#modal").classList.contains("hidden")) closeModal();
  S.polling = false; clearTimeout(S.pollTimer);
  clearInterval(S.clockTimer); S.clockTimer = null;
  let last = ""; try { last = localStorage.getItem("aslscan.user") || ""; } catch {}
  if (last && !$("#loginUser").value) $("#loginUser").value = last;
  setTimeout(() => ($("#loginUser").value ? $("#loginPw") : $("#loginUser")).focus(), 50);
}
$$(".lang-pick button").forEach((b) => {
  b.classList.toggle("on", b.dataset.lang === window.HAMNA_LANG);
  b.onclick = () => window.hamnaSetLang(b.dataset.lang);
});
$("#loginForm").onsubmit = async (e) => {
  e.preventDefault();
  $("#loginErr").textContent = "";
  const b = $("#loginForm button"); busy(b, true, "Entrando…");
  const usuario = $("#loginUser").value.trim();
  try {
    const r = await api("api/login", { method: "POST", json: { usuario, password: $("#loginPw").value } });
    $("#loginPw").value = ""; S.me = r.usuario;
    try { localStorage.setItem("aslscan.user", usuario); } catch {}
    start();
  }
  catch (err) { $("#loginErr").textContent = err.message; }
  finally { busy(b, false); }
};

async function start() {
  $("#login").classList.add("hidden");
  let me = null;
  try { me = await api("api/me"); S.me = me.usuario; } catch {}
  $("#app").classList.remove("hidden");
  try { S.cfg = await api("api/ajustes"); } catch { return; }
  try { S.me = (await api("api/me")).usuario; } catch {}
  if (S.me) {
    if (S.me.idioma && S.me.idioma !== window.HAMNA_LANG) { window.hamnaSetLang(S.me.idioma); return; }
    if (!S.me.idioma) api("api/mi-idioma", { method: "PUT", json: { idioma: window.HAMNA_LANG } }).catch(() => {});
  }
  applyRole();
  updateNodeLabel();
  if (isAdmin()) api("api/actualizaciones").then(markUpdate).catch(() => {});
  S.polling = true;
  await poll();
  if (!S.clockTimer) S.clockTimer = setInterval(tickClock, 1000);
  const q = new URLSearchParams(location.search).get("tab");
  let saved = ""; try { saved = localStorage.getItem("aslscan.tab") || ""; } catch {}
  const pedida = location.hash.slice(1) || q || saved || "conexiones";   // la primera vez: el Dashboard
  showTab(pedida);
}

/* ── Monitor del equipo ──────────────────────────────────────────────────────
   Los datos vienen en /api/status (sin consultas extra). */
const fmtB = (b) => b == null ? "—" : b >= 1e9 ? (b / 1e9).toFixed(1) + " GB" : b >= 1e6 ? Math.round(b / 1e6) + " MB" : Math.round(b / 1e3) + " kB";
const fmtRate = (b) => b == null ? "—" : b >= 125000 ? (b * 8 / 1e6).toFixed(1) + " Mb/s" : Math.round(b * 8 / 1e3) + " kb/s";
function setBar(id, pct) {
  const el = $(id); if (!el) return;
  el.style.width = (pct == null ? 0 : Math.min(100, pct)) + "%";
  el.className = pct >= 90 ? "bad" : pct >= 75 ? "warn" : "";
}
function renderSys(d, ver) {
  if (ver && $("#appVer").textContent !== "v" + ver) $("#appVer").textContent = "v" + ver;
  if (!d) { $("#sideMon").classList.add("hidden"); return; }
  $("#sideMon").classList.remove("hidden");
  const L = (es, en) => (window.HAMNA_LANG === "es" ? es : en);
  $$("#sideMon [data-l]").forEach((el) => {
    const k = el.dataset.l, en = { "Equipo": "System", "Disco": "Disk", "Temp.": "Temp.", "Carga": "Load" }[k];
    el.textContent = window.HAMNA_LANG === "es" ? k : (en || k);
  });
  setBar("#mbCpu", d.cpu); $("#mvCpu").textContent = d.cpu == null ? "—" : Math.round(d.cpu) + " %";
  const mp = d.mem && d.mem.total ? (d.mem.usada / d.mem.total) * 100 : null;
  setBar("#mbMem", mp); $("#mvMem").textContent = d.mem ? `${fmtB(d.mem.usada)} / ${fmtB(d.mem.total)}` : "—";
  const dp = d.disco && d.disco.total ? (d.disco.usada / d.disco.total) * 100 : null;
  setBar("#mbDisk", dp); $("#mvDisk").textContent = d.disco ? `${fmtB(d.disco.usada)} / ${fmtB(d.disco.total)}` : "—";
  $("#tmCpu").textContent = d.cpu == null ? "—" : Math.round(d.cpu) + " %";
  $("#tmCpu").className = d.cpu >= 90 ? "bad" : d.cpu >= 75 ? "warn" : "";
  $("#tmTemp").textContent = d.temp == null ? "—" : Math.round(d.temp) + " °C";
  $("#tmTemp").className = d.temp >= 80 ? "bad" : d.temp >= 70 ? "warn" : "";
  $(".tm-temp").classList.toggle("hidden", d.temp == null);
  const t = $("#mvTemp");
  t.textContent = d.temp == null ? "—" : d.temp.toFixed(1) + " °C";
  t.className = d.temp >= 80 ? "bad" : d.temp >= 70 ? "warn" : "";
  const ld = $("#mvLoad");
  ld.textContent = d.carga == null ? "—" : d.carga.toFixed(2);
  ld.className = d.carga >= d.nucleos ? "bad" : d.carga >= d.nucleos * 0.75 ? "warn" : "";
  $("#mvRx").textContent = fmtRate(d.rx_bps); $("#mvTx").textContent = fmtRate(d.tx_bps);
  if (d.encendido_s != null) {
    const s = d.encendido_s, dd = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), mm = Math.floor((s % 3600) / 60);
    $("#monUp").textContent = L("encendido ", "up ") + (dd ? `${dd} d ${hh} h` : hh ? `${hh} h ${mm} min` : `${mm} min`);
  }
  $("#sideMon").title = L("Datos del equipo del nodo · se actualizan con el estado", "Node system data · updated with the status");
}

/* ── Logo ────────────────────────────────────────────────────────────────── */
function applyLogo(url) {
  S.logo = url || "";
  for (const id of ["#brandLogo", "#loginLogo", "#topLogo"]) {
    const img = $(id);
    if (url) { if (img.getAttribute("src") !== url) img.src = url; img.classList.remove("hidden"); }
    else { img.removeAttribute("src"); img.classList.add("hidden"); }
  }
  const pv = $("#logoPreview");
  if (pv) pv.innerHTML = url ? `<img src="${esc(url)}" alt="Logo">` : '<span class="muted">Sin logo</span>';
  const del = $("#btnLogoDel");
  if (del) del.classList.toggle("hidden", !url);
}
/* Reduce la imagen en el navegador (máx. 400 px) para que el nodo no procese nada */
function shrinkImage(file, max = 400) {
  return new Promise((res, rej) => {
    if (file.type === "image/gif") return res(file);           // conservar animación
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const k = Math.min(1, max / Math.max(img.width, img.height));
      if (k === 1 && file.size < 300 * 1024) return res(file);
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      // WEBP conserva la transparencia; si el navegador no lo sabe hacer, devuelve PNG
      c.toBlob((b) => b ? res(b) : rej(new Error("No pude leer la imagen")), "image/webp", 0.9);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("No pude leer la imagen")); };
    img.src = url;
  });
}
$("#logoFile").onchange = async (e) => {
  const file = e.target.files[0]; e.target.value = "";
  if (!file) return;
  try {
    const blob = await shrinkImage(file);
    const ext = { "image/webp": ".webp", "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif" }[blob.type] || ".png";
    const fd = new FormData(); fd.append("archivo", blob, "logo" + ext);
    const r = await upload("api/ajustes/logo", fd);
    applyLogo(r.logo); toast("Logo guardado");
  } catch (err) { toast(err.message, true); }
};
$("#btnLogoDel").onclick = async () => {
  if (!(await confirmBox("¿Quitar el logo?", "Quitar"))) return;
  const r = await run(() => api("api/ajustes/logo", { method: "DELETE" }), "Logo quitado");
  applyLogo(r.logo);
};

/* ── Pestañas ────────────────────────────────────────────────────────────── */
$$("#tabs button").forEach((b) => (b.onclick = () => { showTab(b.dataset.tab); closeDrawer(); }));

/* ── Menú de hamburguesa ──────────────────────────────────────────────────────
   Computadora: la barra lateral se esconde y se recuerda. Celular: cajón. */
const isMobile = () => matchMedia("(max-width: 960px)").matches;
function syncMenuBtn() {
  const open = isMobile() ? document.body.classList.contains("nav-open") : !document.body.classList.contains("nav-collapsed");
  $("#btnMenu").setAttribute("aria-expanded", String(open));
}
function closeDrawer() { document.body.classList.remove("nav-open"); syncMenuBtn(); }
$("#btnMenu").onclick = () => {
  if (isMobile()) document.body.classList.toggle("nav-open");
  else {
    document.body.classList.remove("nav-collapsed");
    try { localStorage.setItem("aslscan.nav", "open"); } catch {}
  }
  syncMenuBtn();
};
$("#btnHideMenu").onclick = () => {
  if (isMobile()) return closeDrawer();
  document.body.classList.add("nav-collapsed");
  try { localStorage.setItem("aslscan.nav", "collapsed"); } catch {}
  syncMenuBtn();
};
$("#scrim").onclick = closeDrawer;
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });
try { if (localStorage.getItem("aslscan.nav") === "collapsed") document.body.classList.add("nav-collapsed"); } catch {}
const TABS = ["conexiones", "nodos", "ajustes"];
const TAB_ALIAS = { dashboard: "conexiones", sesiones: "conexiones" };   // nombres anteriores o nuevos de la misma vista
window.addEventListener("hashchange", () => { const t = TAB_ALIAS[location.hash.slice(1)] || location.hash.slice(1); if (TABS.includes(t) && t !== S.tab) showTab(t); });
function showTab(t) {
  t = TAB_ALIAS[t] || t;
  if (!TABS.includes(t)) t = "conexiones";
  if (t === "ajustes" && S.me && S.me.rol !== "admin") t = "conexiones";
  if (S.tab === "conexiones" && t !== "conexiones") stopSesiones();
  if (t !== "nodos") clearTimeout(S.nodosT);
  S.tab = t;
  try { localStorage.setItem("aslscan.tab", t); } catch {}
  if (location.hash.slice(1) !== t) history.replaceState(null, "", "#" + t);
  $$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === t));
  $$(".view").forEach((v) => v.classList.toggle("hidden", v.id !== "view-" + t));
  ({ conexiones: loadSesiones, nodos: loadNodos, ajustes: loadAjustes })[t]();
  window.scrollTo(0, 0);
}

const sysChips = (list) => (list || []).map(([k, t]) => `<span class="sys-chip ${esc(k)}" translate="no" title="${window.HAMNA_LANG === "es" ? "Tipo de nodo detectado" : "Detected node type"}">${esc(t)}</span>`).join("");
function updateNodeLabel() {
  const c = S.cfg || {};
  $("#topStation").textContent = c.station_name || (c.node ? "Nodo " + c.node : "ASLSCAN");
  $("#nodeLabel").innerHTML = (c.station_name ? `<b>${esc(c.station_name)}</b>` : "") +
    `<span class="node-line">${c.node ? `<span class="sys-chip num" translate="no" title="Número de nodo">#${esc(c.node)}</span>` : ""}<span id="sysChips" class="node-line"></span></span>`;
  // Etiqueta de color con el tipo de nodo detectado (ASL3 / ASL / HamVOIP / IRLP; puede haber dos)
  getInfo().then((i) => {
    const s = i.sistemas || {}, out = [];
    if (s.asl) out.push(i.sabor === "hamvoip" ? ["hamvoip", "HamVOIP"] : ["asl", i.sabor === "asl3" ? "ASL3" : "ASL"]);
    if (s.irlp) out.push(["irlp", "IRLP"]);
    if (!out.length && c.backend && c.backend !== "auto") out.push(["", c.backend.toUpperCase()]);
    const box = $("#sysChips");
    if (box) box.innerHTML = sysChips(out);
  }).catch(() => {});
}

/* ── Estado del equipo ───────────────────────────────────────────────────────
   Para no cargar la Raspberry: cada 5 s y nada con la pestaña oculta. El reloj
   avanza solo en el navegador con la hora que mandó el nodo. */
const POLL_IDLE = 5000;
function schedulePoll() {
  clearTimeout(S.pollTimer);
  if (!S.polling || document.hidden) return;
  S.pollTimer = setTimeout(poll, POLL_IDLE);
}
document.addEventListener("visibilitychange", () => {
  if (!S.polling) return;
  if (document.hidden) { clearTimeout(S.pollTimer); stopSesiones(); }
  else { poll(); if (S.tab === "conexiones") loadSesiones(); }
});
const pad2 = (n) => String(n).padStart(2, "0");
function tickClock() {
  if (S.tzOff == null || document.hidden) return;
  const now = Date.now() + S.skew;
  const loc = new Date(now + S.tzOff), utc = new Date(now);
  $("#clockLocal").textContent = `${pad2(loc.getUTCHours())}:${pad2(loc.getUTCMinutes())}:${pad2(loc.getUTCSeconds())}`;
  $("#clockUtc").textContent = `UTC ${pad2(utc.getUTCHours())}:${pad2(utc.getUTCMinutes())}`;
  $("#clockTop").textContent = $("#clockLocal").textContent;
}
// ── Escuchar en vivo ─────────────────────────────────────────────────────────
// El nodo manda µ-law 8 kHz; aquí se decodifica y se reproduce con Web Audio.
const LIVE = { on: false, ctx: null, ctrl: null, next: 0 };
const MULAW = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const u = ~i & 0xff, exp = (u >> 4) & 7, s = (((u & 0x0f) << 3) + 0x84) << exp;
    t[i] = ((u & 0x80) ? -(s - 0x84) : (s - 0x84)) / 32768;
  }
  return t;
})();
function irlpBtn(lv) {
  if (!S.me || S.me.rol !== "admin") return "";
  return lv.irlp_activado
    ? `<div class="actions" style="margin-top:8px"><button type="button" class="btn sm ghost" data-irlplive="0">Apagar escuchar en vivo</button></div>`
    : `<div class="actions"><button type="button" class="btn sm primary" data-irlplive="1">🔊 Encender escuchar en vivo</button></div>`;
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-irlplive]");
  if (!b) return;
  const on = b.dataset.irlplive === "1";
  if (!on && !(await confirmBox("Ya no se podrá escuchar este nodo desde la página. ¿Apagar?", "Apagar"))) return;
  busy(b, true, on ? "Probando…" : "Apagando…");
  try {
    await api("api/en-vivo/irlp", { method: "POST", json: { on } });
    toast(on ? "Listo: escuchar en vivo encendido" : "Escuchar en vivo apagado");
  } catch (err) { toast(err.message); }
  busy(b, false);
  try { renderLive((await api("api/status")).envivo); } catch {}
});
function renderLive(lv) {
  if (!lv) return;
  $$(".live-btn").forEach((b) => b.classList.toggle("hidden", !lv.configurado && !LIVE.on));
  const box = $("#liveBox");
  if (!box || box.closest(".hidden")) return;
  const n = lv.oyentes.length;
  const html = lv.configurado
    ? `<div class="live-box"><h4>🔊 Audio en vivo</h4>
        <div class="muted" style="font-size:.84rem">${lv.recibiendo ? "Recibiendo audio del nodo" : "Sin audio del nodo en los últimos segundos"} · ${n} ${n === 1 ? "persona escuchando" : "personas escuchando"}</div>
        ${n ? `<ul class="upd-list">${lv.oyentes.map((o) => `<li><span class="d">${esc(o.usuario)}</span><span>${esc(o.ip)} · ${fmt(o.desde)}</span></li>`).join("")}</ul>` : ""}${lv.tipo === "irlp" ? irlpBtn(lv) : ""}</div>`
    : lv.tipo === "irlp" ? `<div class="live-box"><h4>🔊 Audio en vivo</h4>
        <p class="muted" style="margin:0 0 8px">Escuchar este nodo IRLP desde la página (reflector y estaciones locales). Está apagado. Al encenderlo, ASLSCAN agrega un bloque en <code>/home/irlp/.asoundrc</code> y lo prueba; si algo falla, lo deja como estaba.</p>
        ${irlpBtn(lv)}${lv.error ? `<p class="muted">${esc(lv.error)}</p>` : ""}</div>`
    : `<div class="live-box"><h4>🔊 Audio en vivo</h4>
        <p class="muted" style="margin:0 0 6px">Para escuchar el nodo desde esta página, agrega esta línea en la sección de tu nodo en <code>/etc/asterisk/rpt.conf</code> y reinicia Asterisk cuando no haya emisión:</p>
        <pre translate="no">outstreamcmd = /opt/aslscan/bin/aslscan-live</pre>
        <p class="muted" style="margin:6px 0 0">Si HAMNA Web también está en el nodo y ya tiene su línea <code>outstreamcmd</code>, no agregues otra: con HAMNA Web 1.42 o más nuevo, el mismo audio llega a los dos.</p>${lv.error ? `<p class="muted">${esc(lv.error)}</p>` : ""}</div>`;
  if (box.innerHTML !== html) box.innerHTML = html;
}
async function liveStart() {
  LIVE.on = true;
  $$(".live-btn").forEach((b) => { b.classList.add("on", "wait"); b.title = "Detener"; });
  const Ctx = window.AudioContext || window.webkitAudioContext;
  LIVE.ctx = new Ctx();
  LIVE.next = 0;
  LIVE.ctrl = new AbortController();
  try {
    const r = await fetch("api/en-vivo", { credentials: "same-origin", signal: LIVE.ctrl.signal });
    if (!r.ok) {
      let msg = "No se pudo conectar";
      try { msg = (await r.json()).error || msg; } catch {}
      throw new Error(msg);
    }
    const rd = r.body.getReader();
    for (;;) {
      const { value, done } = await rd.read();
      if (done || !LIVE.on) break;
      if (value && value.length) livePlay(value);
    }
    if (LIVE.on) toast("Se cortó el audio en vivo", true);
  } catch (e) {
    if (LIVE.on && e.name !== "AbortError") toast(e.message, true);
  }
  liveStop();
}
function livePlay(bytes) {
  const ctx = LIVE.ctx, buf = ctx.createBuffer(1, bytes.length, 8000), d = buf.getChannelData(0);
  for (let i = 0; i < bytes.length; i++) d[i] = MULAW[bytes[i]];
  const now = ctx.currentTime;
  if (LIVE.next < now + 0.05) LIVE.next = now + 0.4;   // se vació el colchón: 0.4 s de margen
  if (LIVE.next > now + 3) return;                     // demasiado atrasado: tirar este pedazo
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start(LIVE.next);
  LIVE.next += buf.duration;
  if (LIVE.wait !== false) { $$(".live-btn").forEach((b) => b.classList.remove("wait")); LIVE.wait = false; }
}
function liveStop() {
  LIVE.on = false;
  try { LIVE.ctrl && LIVE.ctrl.abort(); } catch {}
  try { LIVE.ctx && LIVE.ctx.close(); } catch {}
  LIVE.ctx = LIVE.ctrl = null;
  LIVE.wait = true;
  $$(".live-btn").forEach((b) => { b.classList.remove("on", "wait"); b.title = "Escuchar el nodo en vivo"; });
}

async function poll() {
  clearTimeout(S.pollTimer);
  let s;
  try { s = await api("api/status"); } catch { schedulePoll(); return; }
  S.status = s;
  renderSys(s.sys, s.version);
  renderLive(s.envivo);
  renderHealthBadge(s.salud);
  if (s.ts) {
    // Hora del nodo: s.now (hora local) y s.ts (época UTC) → desfase y zona horaria
    const [d, t] = s.now.split(" "), [Y, M, D] = d.split("-").map(Number), [h, m, x] = t.split(":").map(Number);
    S.skew = s.ts * 1000 - Date.now();
    S.tzOff = Math.round((Date.UTC(Y, M - 1, D, h, m, x) - s.ts * 1000) / 60000) * 60000;
    tickClock();
  }
  schedulePoll();
}
async function getInfo() { if (!S.info) S.info = await api("api/info"); return S.info; }
/* Subida con barra de progreso (fetch no informa el avance) */
function upload(url, fd, btn, bar) {
  return new Promise((res, rej) => {
    const x = new XMLHttpRequest();
    x.open("POST", url); x.setRequestHeader("X-ASLSCAN", "1");
    busy(btn, true, "Subiendo…");
    if (bar) { bar.classList.remove("hidden"); x.upload.onprogress = (e) => { if (e.lengthComputable) $("div", bar).style.width = (e.loaded / e.total * 100) + "%"; }; }
    x.upload.onload = () => busy(btn, true, "Procesando…");
    x.onload = () => {
      busy(btn, false);
      let d = {}; try { d = JSON.parse(x.responseText); } catch {}
      if (x.status === 401) { showLogin(); return rej(new Error("Inicia sesión")); }
      if (x.status >= 400 || d.ok === false) rej(new Error(d.error || "Error " + x.status)); else res(d);
    };
    x.onerror = () => { busy(btn, false); rej(new Error("Se perdió la conexión con el nodo")); };
    x.send(fd);
  });
}

/* ── Ajustes ─────────────────────────────────────────────────────────────── */
$$("#setNav button").forEach((b) => (b.onclick = () => showSet(b.dataset.set)));
function showSet(k) {
  if (!$(`#setForm fieldset[data-set="${k}"]`)) k = "nodo";       // «Mi cuenta» pasó al panel «Mi perfil»
  S.setSec = k;
  try { localStorage.setItem("aslscan.set", k); } catch {}
  $$("#setNav button").forEach((b) => {
    b.classList.toggle("active", b.dataset.set === k);
    if (b.dataset.set === k && b.scrollIntoView && b.parentElement.scrollWidth > b.parentElement.clientWidth)
      b.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
  $$("#setForm fieldset").forEach((f) => f.classList.toggle("hidden", f.dataset.set !== k));
  $("#saveBar").classList.toggle("hidden", ["sistema", "usuarios"].includes(k) || (k === "respaldo" && S.bkSub === "manual"));
  if (k === "sistema") loadSistema();
  if (k === "respaldo") loadRespaldo();
  if (k === "usuarios") loadUsers();
  if (k === "telegram") loadBotSt();
  if (k === "sistema") loadHubSt();
}
async function loadBotSt() {
  const el = $("#botSt"); if (!el) return;
  try {
    const b = await api("api/bot");
    el.textContent = b.activo ? `✅ El bot @${b.bot} está escuchando.` : b.error ? "⚠ " + b.error : "El bot no está escuchando (activa Telegram y esta casilla, y guarda).";
    el.className = "muted bot-st" + (b.activo ? " ok" : b.error ? " bad" : "");
  } catch { el.textContent = ""; }
  const bu = $("#botUsers"); if (!bu) return;
  try {
    const r = await api("api/usuarios");
    const act = r.usuarios.filter((u) => u.activo), con = act.filter((u) => u.tg)
      .sort((a, b) => (b.tg_ultimo || 0) - (a.tg_ultimo || 0));
    bu.innerHTML = `<p class="muted" style="margin:6px 0">👥 ${con.length} de ${act.length} usuarios tienen el bot vinculado</p>` +
      (con.length ? `<div class="row gap wrap">${con.map((u) => `<span class="chip" title="${esc(u.tg_nombre || "")}">${esc(u.nombre || u.usuario)} · ${
        u.tg_ultimo ? `<span>${esc(ago(u.tg_ultimo))}</span>` : "<span>sin usar</span>"}</span>`).join("")}</div>` : "") +
      (act.length > con.length ? `<p class="muted" style="margin:6px 0;font-size:.85rem">Sin vincular: ${act.filter((u) => !u.tg).map((u) => esc(u.nombre || u.usuario)).join(", ")}</p>` : "");
  } catch { bu.innerHTML = ""; }
}
async function loadAjustes() {
  S.cfg = await api("api/ajustes");
  const info = await getInfo();
  const f = $("#setForm");
  for (const el of f.elements) {
    if (!el.name || !(el.name in S.cfg)) continue;
    if (el.type === "checkbox") el.checked = !!S.cfg[el.name];
    else if (el.name !== "tg_token" && !("secret" in el.dataset)) el.value = S.cfg[el.name] ?? "";
  }
  f.tg_token.placeholder = S.cfg.tg_token_set ? "•••••• (guardado; escribe para cambiarlo)" : "123456789:ABC…";
  f.tg_token.value = "";
  f.ab_node_token.value = "";
  f.ab_node_token.placeholder = S.cfg.ab_node_token_set ? "•••••• (guardado; escribe para cambiarlo)" : "hb_…";
  f.hub_token.value = "";
  f.hub_token.placeholder = S.cfg.hub_token_set ? "•••••• (guardado; escribe para cambiarlo)" : "Vacío = el del respaldo";
  $("#detectHint").textContent = `Detectado en este equipo: ${{ asl3: "AllStarLink 3", hamvoip: "HamVOIP", asl: "AllStarLink" }[info.sabor] || info.detectado.toUpperCase()}${info.nodo_detectado ? " · nodo " + info.nodo_detectado : ""}`;
  applyLogo(S.logo);
  showSet(S.setSec);
}
$("#setForm").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target, data = {};
  for (const el of f.elements) {
    if (!el.name) continue;
    if (el.type === "checkbox") data[el.name] = el.checked;
    else if (el.name === "tg_token" || "secret" in el.dataset) { if (el.value.trim()) data[el.name] = el.value.trim(); }
    else data[el.name] = el.value;
  }
  const r = await run(() => api("api/ajustes", { method: "PUT", json: data }), "Ajustes guardados");
  S.cfg = r.ajustes; S.info = null; updateNodeLabel(); loadAjustes();
};
$("#btnTestNode").onclick = async () => {
  const b = $("#btnTestNode"); busy(b, true, "Probando…");
  try { const r = await api("api/prueba/nodo", { method: "POST" });
    $("#testNodeMsg").textContent = (r.bien ? "✅ " : "❌ ") + r.mensaje; }
  catch (e) { $("#testNodeMsg").textContent = "❌ " + e.message; } finally { busy(b, false); }
};
$("#btnMeNombre").onclick = async () => {
  try {
    const r = await run(() => api("api/mi-nombre", { method: "PUT", json: { nombre: $("#meNombre").value } }), "Nombre guardado");
    S.me.nombre = r.nombre; refreshMe();
  } catch {}
};
/* ── Telegram en Mi perfil ─────────────────────────────────────────────── */
async function loadMiTelegram() {
  const box = $("#meTg");
  let r;
  try { r = await api("api/mi-telegram"); } catch (e) { box.innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
  clearInterval(S.tgPoll);
  if (r.vinculado) {
    box.innerHTML = `<div class="row gap wrap" style="align-items:center"><span>✅ Vinculado con <b>${esc(r.nombre || "tu Telegram")}</b>${r.bot ? ` · bot ${esc(r.bot)}` : ""}</span>
      <button type="button" class="btn sm" id="btnTgOff">Desvincular</button></div>
      <p class="muted tg-help">Escríbele al bot o toca <b>📋 Menú</b>: ahí están 🔗 Conexiones, 🩺 Salud y 🗺 Nodos.</p>`;
    $("#btnTgOff").onclick = async () => {
      if (!(await confirmBox("¿Desvincular tu Telegram? El bot ya no te reconocerá hasta que lo vuelvas a vincular.", "Desvincular"))) return;
      try { await run(() => api("api/mi-telegram", { method: "DELETE" }), "Telegram desvinculado"); loadMiTelegram(); } catch {}
    };
  } else if (!r.disponible) {
    box.innerHTML = `<p class="muted tg-help">El bot de Telegram no está activo en este nodo. ${isAdmin() ? "Actívalo en Ajustes → Telegram." : "Pídele al administrador que lo active."}</p>`;
  } else {
    box.innerHTML = `<p class="muted tg-help">Vincula tu Telegram para consultar el nodo desde el celular${S.me && ["operador", "admin"].includes(S.me.rol) ? " y conectar o desconectar nodos" : ""}.</p>
      <button type="button" class="btn sm primary" id="btnTgOn">🔗 Vincular Telegram</button>`;
    $("#btnTgOn").onclick = async () => {
      let c;
      try { c = await api("api/mi-telegram", { method: "POST" }); } catch (e) { return toast(e.message, true); }
      box.innerHTML = `<div class="tg-code"><span class="muted">Tu código</span><b translate="no">${esc(c.codigo)}</b><small class="muted">vale ${c.minutos} min</small></div>
        ${c.enlace ? `<a class="btn primary sm" href="${esc(c.enlace)}" target="_blank" rel="noopener">Abrir Telegram</a>` : ""}
        <p class="muted tg-help">Con el botón se abre el chat con ${esc(c.bot || "el bot")}: toca <b>Iniciar</b> y listo. Si no se abre, mándale al bot <code>/vincular ${esc(c.codigo)}</code>.</p>`;
      const hasta = Date.now() + c.minutos * 60000;
      S.tgPoll = setInterval(async () => {
        if ($("#perfil").classList.contains("hidden") || Date.now() > hasta) return clearInterval(S.tgPoll);
        try { const x = await api("api/mi-telegram"); if (x.vinculado) { toast("Telegram vinculado ✓"); loadMiTelegram(); } } catch {}
      }, 3000);
    };
  }
}
/* ── Mi perfil (todos los usuarios) ─────────────────────────────────────── */
function openPerfil() { $("#perfil").classList.remove("hidden"); loadMyAccount(); }
function closePerfil() { $("#perfil").classList.add("hidden"); $("#pwOld").value = $("#pwNew").value = ""; }
$("#btnPerfil").onclick = openPerfil;
$("#perfilClose").onclick = closePerfil;
$("#perfil").addEventListener("mousedown", (e) => { if (e.target.id === "perfil") closePerfil(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#modal").classList.contains("hidden")) closePerfil(); });
/* Contenido del círculo: la foto si hay (con las iniciales si no carga) o las iniciales */
function avatarInner(u) {
  const ini = esc(initials(u || {}));
  return u && u.foto ? `<img src="api/fotos/${u.id}?v=${encodeURIComponent(u.foto)}" alt="" data-i="${ini}" onerror="this.replaceWith(this.dataset.i)">` : ini;
}
function refreshMe() {
  applyRole();
  if (!$("#perfil").classList.contains("hidden")) loadMyAccount();
}
async function fotoJpeg(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("No pude leer la imagen")); i.src = url; });
    const s = Math.min(img.naturalWidth, img.naturalHeight), N = 256, c = document.createElement("canvas");
    c.width = c.height = N;
    c.getContext("2d").drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, N, N);
    return await new Promise((res) => c.toBlob(res, "image/jpeg", 0.85));
  } finally { URL.revokeObjectURL(url); }
}
$("#meFoto").onchange = async (e) => {
  const file = e.target.files[0]; e.target.value = "";
  if (!file) return;
  try {
    const fd = new FormData(); fd.append("foto", await fotoJpeg(file), "foto.jpg");
    const r = await api("api/mi-foto", { method: "POST", form: fd });
    S.me.foto = r.foto; refreshMe(); toast("Foto guardada");
  } catch (err) { toast(err.message, true); }
};
$("#btnFotoDel").onclick = async () => {
  try { await run(() => api("api/mi-foto", { method: "DELETE" }), "Foto quitada"); S.me.foto = ""; refreshMe(); } catch {}
};
$("#btnPw").onclick = async () => {
  try {
    await run(() => api("api/ajustes/password", { method: "POST", json: { actual: $("#pwOld").value, nueva: $("#pwNew").value } }), "Contraseña cambiada; tus otras sesiones se cerraron");
    $("#pwOld").value = $("#pwNew").value = ""; loadMyAccount();
  } catch {}
};
/* ── Panel de nodos ───────────────────────────────────────────────────────── */
const vNum = (v) => String(v || "0").split(".").map((x) => parseInt(x, 10) || 0);
const vMenor = (a, b) => { const x = vNum(a), y = vNum(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); } return false; };
// Textos de la tarjeta en el idioma de quien la ve (se arman aquí: el traductor
// de la página solo cambia textos fijos y estos llevan fechas y números)
const LG = (es, en) => (window.HAMNA_LANG === "es" ? es : en);
const trTxt = (t) => (window.HAMNA_LANG !== "es" && window.hamnaT ? window.hamnaT(t || "") : t || "");
const DIAS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const fechaCortaLG = (s) => {
  const d = new Date(String(s || "").replace(" ", "T"));
  if (isNaN(d)) return s || "";
  return `${LG(DIAS[d.getDay()], DIAS_EN[d.getDay()])} ${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
const lapso = (s) => (s < 90 ? Math.max(1, Math.round(s)) + " s" : s < 5400 ? Math.round(s / 60) + " min"
  : s < 172800 ? Math.round(s / 3600) + " h" : Math.round(s / 86400) + " d");
function haceTxt(s) { return LG("hace " + lapso(s), lapso(s) + " ago"); }
function nodoCard(d, p) {
  const lim = (p.alerta_min || 10) * 60;
  const est = d.propio ? "ok" : d.edad < 180 ? "ok" : d.edad < lim ? "tarde" : "caido";
  const sal = (d.salud || {}).peor, eq = d.equipo || {};
  const volt = ((d.salud || {}).checks || []).find((c) => c.id === "voltaje");
  const chips = [];
  if (eq.temp != null) chips.push(`🌡 ${Math.round(eq.temp)} °C`);
  if (volt && volt.nivel !== "nd") chips.push(volt.nivel === "ok" ? "⚡ " + LG("voltaje bien", "voltage OK") : "⚠️ " + LG("bajo voltaje", "undervoltage"));
  if (eq.disco != null) chips.push(`💾 ${LG("disco", "disk")} ${eq.disco}%`);
  if (eq.cpu != null) chips.push(`CPU ${Math.round(eq.cpu)}%`);
  const malos = ((d.salud || {}).checks || []).filter((c) => c.nivel === "aviso" || c.nivel === "grave");
  const viejo = d.version && vMenor(d.version, p.ultima_version);
  // Nodos con versión vieja no mandan «sistemas»: entonces el tipo de Ajustes, en gris
  const sis = (d.sistemas || []).length ? d.sistemas : d.tipo && d.tipo !== "auto" ? [["", d.tipo.toUpperCase()]] : [];
  const r = d.respaldo || {};
  const titulo = d.estacion || LG("Nodo ", "Node ") + d.nodo;
  const clave = d.clave || d.nodo;
  const url = webUrl(dashUrl(d));
  const ligas = [webUrl(d.url_int) ? `<a href="${esc(d.url_int)}" target="_blank" rel="noopener" title="${esc(d.url_int)}">🏠 ${LG("red local", "local network")}</a>` : "",
    webUrl(d.url_ext) ? `<a href="${esc(d.url_ext)}" target="_blank" rel="noopener" title="${esc(d.url_ext)}">🌐 internet</a>` : ""].filter(Boolean).join(" · ");
  const edad = d.propio ? LG("ahora", "now") : est === "caido" ? "⚠ " + LG("sin reportar " + haceTxt(d.edad), "no report for " + lapso(d.edad)) : haceTxt(d.edad);
  const verTit = viejo ? LG("Hay una versión más nueva: v", "A newer version is available: v") + p.ultima_version : LG("Al día", "Up to date");
  const salud = sal === "ok" ? LG("Salud bien", "Health OK") : sal === "grave" || sal === "aviso"
    ? LG("Salud", "Health") + (malos.length ? ": " + malos.map((c) => esc(trTxt(c.nombre)) + " — " + esc(trTxt(c.detalle))).join("; ") : "")
    : LG("Salud: todavía sin revisar", "Health: not checked yet");
  const resp = (r.ultimo_ok ? LG("Respaldo exitoso: ", "Backup successful: ") + esc(fechaCortaLG(r.ultimo_ok)) : LG("Sin respaldos exitosos", "No successful backups"))
    + (r.ok === false && r.fecha ? ` · <span style="color:var(--warn)">${LG("el último falló", "the last one failed")} (${esc(fechaCortaLG(r.fecha))})</span>` : "")
    + (d.recibido ? ` · ${LG("en este hub", "on this hub")}: ${esc(fechaCortaLG(d.recibido.fecha))} (${mb(d.recibido.tam)})` : "");
  return `<div class="card nodo-card ${est}" translate="no">
    <div class="nodo-head"><span class="dot ${est}"></span><div class="nodo-tit">${url
        ? `<a class="nodo-link" href="${esc(url)}" target="_blank" rel="noopener" title="${LG("Abrir el dashboard del nodo", "Open the node's dashboard")}: ${esc(url)}"><b>${esc(titulo)}</b> ↗</a>`
        : `<b>${esc(titulo)}</b>`}
      <small>${[d.propio ? LG("este hub", "this hub") : esc(d.ip || ""), ligas].filter(Boolean).join(" · ")}</small></div>
      <span class="muted nodo-edad">${esc(edad)}</span></div>
    <div class="nodo-ver">${d.nodo ? `<span class="sys-chip num" title="${LG("Número de nodo", "Node number")}">#${esc(d.nodo)}</span>` : ""}${sysChips(sis)}<span class="sys-chip ${viejo ? "old" : "aldia"}" title="${esc(verTit)}">v${esc(d.version || "?")}${viejo ? LG(" · actualizar", " · update") : ""}</span>${d.app === "ASLSCAN" ? '<span class="sys-chip">ASLSCAN</span>' : '<span class="sys-chip">HAMNA</span>'}${d.bot ? '<span class="sys-chip">🤖 bot</span>' : ""}</div>
    ${d.al_aire ? `<div class="nodo-aire">🔴 <b>${LG("Al aire", "On air")}:</b> ${esc(d.al_aire.evento)}${d.al_aire.seccion ? ` · ${esc(d.al_aire.i)}/${esc(d.al_aire.n)} ${esc(d.al_aire.seccion)}` : ""} · ${LG("faltan", "remaining")} ${fmt(d.al_aire.falta)}</div>`
      : d.proximo ? `<div class="meta">📅 ${esc(d.proximo.evento)}${d.proximo.num ? " " + esc(d.proximo.num) : ""} · ${esc(fechaCortaLG(d.proximo.fecha))}</div>` : d.app === "ASLSCAN" ? "" : `<div class="meta muted">${LG("Sin eventos programados", "No scheduled events")}</div>`}
    ${d.grabando ? `<div class="meta" style="color:var(--danger)">⏺ ${LG("Grabando", "Recording")} «${esc(d.grabando.titulo)}» · ${fmt(d.grabando.dur)}</div>` : ""}
    ${chips.length ? `<div class="nodo-chips">${chips.map((c) => `<span>${esc(c)}</span>`).join("")}</div>` : ""}
    <div class="meta">${sal === "grave" ? "❌" : sal === "aviso" ? "⚠️" : sal === "ok" ? "✅" : "➖"} ${salud}</div>
    <div class="meta">💾 ${resp}</div>
    ${isAdmin() ? `<div class="actions"><button type="button" class="btn sm accent-soft" data-editurl="${esc(clave)}" data-int="${esc(d.url_int || "")}" data-ext="${esc(d.url_ext || "")}" data-nombre="${esc(titulo)}">✏️ ${LG("Editar", "Edit")}</button>` : ""}${!d.propio && isAdmin() ? `<button type="button" class="btn sm danger-soft" data-quitar="${esc(d.nodo)}" title="${LG("Si el nodo sigue reportando, vuelve a aparecer en un minuto", "If the node keeps reporting, it comes back within a minute")}">🗑 ${LG("Quitar del panel", "Remove from panel")}</button>` : ""}${isAdmin() ? "</div>" : ""}
  </div>`;
}
// Solo enlaces http(s): nunca javascript:, data:…
const webUrl = (u) => /^https?:\/\//i.test(String(u || "")) ? String(u) : "";
// Desde la red de la casa conviene la dirección interna; desde fuera, la de internet
function dashUrl(d) {
  const h = location.hostname;
  const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|\.local$/.test(h);
  return local ? d.url_int || d.url_ext || "" : d.url_ext || d.url_int || "";
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-editurl]");
  if (!b) return;
  openModal(LG("Dashboard de ", "Dashboard of ") + b.dataset.nombre, `<form id="urlForm" autocomplete="off" translate="no">
    <label>${LG("Dirección en la red local", "Local network address")}<input name="url_int" value="${esc(b.dataset.int)}" placeholder="http://192.168.1.5/supermon/">
      <small>${LG("Se usa cuando abres esta página desde tu red (192.168…, 10…).", "Used when you open this page from your own network (192.168…, 10…).")}</small></label>
    <label>${LG("Dirección de internet", "Internet address")}<input name="url_ext" value="${esc(b.dataset.ext)}" placeholder="https://minodo.ddns.net/supermon/">
      <small>${LG("Se usa cuando abres esta página desde fuera. Déjala vacía si no tiene.", "Used when you open this page from outside. Leave it empty if there is none.")}</small></label>
    <p class="muted" style="font-size:.84rem">${LG("Al hacer clic en el nombre del nodo se abre su dashboard en otra pestaña.", "Clicking the node's name opens its dashboard in a new tab.")}</p>
    <div class="modal-actions"><button type="button" class="btn" id="urlNo">${LG("Cancelar", "Cancel")}</button>
      <button type="submit" class="btn primary">${LG("Guardar", "Save")}</button></div></form>`);
  $("#urlNo").onclick = closeModal;
  $("#urlForm").onsubmit = async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    try {
      await api("api/nodos/" + encodeURIComponent(b.dataset.editurl) + "/urls", { method: "PUT", json: { url_int: f.url_int.value, url_ext: f.url_ext.value } });
      closeModal(); toast(LG("Direcciones guardadas", "Addresses saved")); loadNodos();
    } catch (err) { toast(err.message, true); }
  };
});
async function loadNodos() {
  clearTimeout(S.nodosT);
  let p;
  try { p = await api("api/nodos"); } catch (e) { $("#nodosList").innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
  S.nodos = p;
  const todos = [p.este].concat(p.nodos);
  $("#nodosList").innerHTML = todos.map((d) => nodoCard(d, p)).join("");
  const caidos = p.nodos.filter((d) => d.edad >= (p.alerta_min || 10) * 60).length;
  const n = p.nodos.length;
  $("#nodosSub").textContent = !n ? LG("Estado de los nodos que reportan a este hub", "Status of the nodes that report to this hub")
    : LG(`${n} ${n > 1 ? "nodos reportan" : "nodo reporta"} a este hub`, `${n} node${n > 1 ? "s report" : " reports"} to this hub`)
      + (caidos ? LG(` · ${caidos} sin reportar`, ` · ${caidos} not reporting`) : "");
  $("#nodosHelp").setAttribute("translate", "no");
  $("#nodosHelp").innerHTML = p.nodos.length
    ? LG("Se actualiza solo cada 30 s. Cada nodo manda su estado cada minuto.", "Refreshes by itself every 30 s. Each node sends its status every minute.")
    : LG("Ningún otro nodo reporta todavía. En cada nodo: <b>Ajustes → Sistema → Panel de nodos</b> (en HAMNA Web: Ajustes → Nodo) → «Reportar el estado de este nodo a un hub» (si ya manda su respaldo a este hub, basta con marcar la casilla).",
      "No other node reports yet. On each node: <b>Settings → System → Node panel</b> (in HAMNA Web: Settings → Node) → “Report this node's status to a hub” (if it already sends its backup to this hub, just tick the box).");
  if (S.tab === "nodos") S.nodosT = setTimeout(() => { if (S.tab === "nodos" && !document.hidden) loadNodos(); }, 30000);
}
$("#btnNodosReload").onclick = loadNodos;
$("#nodosList").onclick = async (e) => {
  const b = e.target.closest("[data-quitar]"); if (!b) return;
  if (!(await confirmBox(LG(`¿Quitar el nodo ${b.dataset.quitar} del panel? Si sigue reportando, vuelve a aparecer en un minuto.`,
    `Remove node ${b.dataset.quitar} from the panel? If it keeps reporting, it comes back within a minute.`), LG("Quitar", "Remove")))) return;
  try { await run(() => api("api/nodos/" + encodeURIComponent(b.dataset.quitar), { method: "DELETE" }), "Quitado del panel"); loadNodos(); } catch {}
};
$("#btnHubProbe").onclick = async () => {
  const f = $("#setForm"), m = $("#hubMsg"), b = $("#btnHubProbe");
  busy(b, true, "Probando…"); m.textContent = "";
  try {
    const r = await api("api/hub/probar", { method: "POST", json: { url: f.hub_url.value, codigo: f.hub_token.value } });
    if (f.hub_url.value.trim()) f.hub_pin.value = r.huella || "";
    m.textContent = `✅ Conecta con ${r.estacion || "el hub"}${r.nodo ? " (nodo " + r.nodo + ")" : ""} · v${r.version}. Guarda los ajustes.`;
  } catch (e) { m.textContent = "❌ " + e.message; } finally { busy(b, false); }
};
async function loadHubSt() {
  try {
    const h = await api("api/hub");
    if (!h.activo) return;
    $("#hubMsg").textContent = h.error ? "⚠ " + h.error : h.ultimo_ok ? `✅ Reportando a ${h.hub || h.url} · último latido ${haceTxt(Date.now() / 1000 - h.ultimo_ok)}` : "Enviando el primer latido…";
  } catch {}
}
const SALUD_ICO = { ok: "✅", nd: "➖", aviso: "⚠️", grave: "❌" };
function renderHealthBadge(worst) {
  const b = $("#monHealth");
  if (!b) return;
  const bad = worst === "aviso" || worst === "grave";
  b.classList.toggle("hidden", !bad);
  b.classList.toggle("bad", worst === "grave");
  b.textContent = bad ? SALUD_ICO[worst] + " " + (window.HAMNA_LANG === "es" ? "Revisar" : "Check") : "";
  b.title = window.HAMNA_LANG === "es" ? "La salud del equipo necesita atención: ver Ajustes → Sistema" : "The node's health needs attention: see Settings → System";
}
$("#monHealth").onclick = () => { S.setSec = "sistema"; showTab("ajustes"); };
async function loadHealth(force) {
  const box = $("#healthBox");
  if (!box) return;
  let d;
  try { d = force ? await api("api/salud/revisar", { method: "POST" }) : await api("api/salud"); }
  catch (e) { box.innerHTML = `<span class="muted">${esc(e.message)}</span>`; return; }
  renderHealthBadge(d.peor);
  const rows = d.checks.map((c) => `<li class="h-${c.nivel}"><span class="d"><span>${SALUD_ICO[c.nivel]}</span> <span>${esc(c.nombre)}</span></span>
      <span>${esc(c.detalle)}${c.consejo ? `<br><i class="muted">${esc(c.consejo)}</i>` : ""}</span></li>`).join("");
  box.className = "upd-box" + (d.peor === "grave" || d.peor === "aviso" ? " new" : "");
  box.innerHTML = `<div class="upd-head"><div><b>${d.peor === "grave" ? "❌ El equipo necesita atención" : d.peor === "aviso" ? "⚠️ Hay algo que revisar en el equipo" : d.checks.length ? "✅ El equipo está bien" : "Revisando el equipo…"}</b>
      <div class="muted" style="font-size:.84rem">Salud del equipo${d.actualizado ? " · revisado " + esc(d.actualizado) : ""} · se revisa cada minuto</div></div>
      ${isAdmin() ? `<button type="button" class="btn sm" id="btnHealth">↻ Revisar ahora</button>` : ""}</div>
    ${rows ? `<ul class="upd-list">${rows}</ul>` : ""}`;
  const b = $("#btnHealth");
  if (b) b.onclick = async () => { busy(b, true, "Revisando…"); await loadHealth(true); };
}
/* ── Respaldo y restauración ──────────────────────────────────────────────── */
const mb = (b) => (b / 1048576 < 10 ? (b / 1048576).toFixed(1) : Math.round(b / 1048576)) + " MB";
/* Sub-pestañas de Respaldo */
try { S.bkSub = localStorage.getItem("aslscan.bksub") || "auto"; } catch { S.bkSub = "auto"; }
function showBkSub(k) {
  S.bkSub = k;
  try { localStorage.setItem("aslscan.bksub", k); } catch {}
  $$("#bkTabs button").forEach((b) => b.classList.toggle("active", b.dataset.sub === k));
  $$("#setForm .subpane").forEach((p) => p.classList.toggle("hidden", p.dataset.sub !== k));
  if (S.setSec === "respaldo") $("#saveBar").classList.toggle("hidden", k === "manual");
}
$$("#bkTabs button").forEach((b) => (b.onclick = () => showBkSub(b.dataset.sub)));
async function loadRespaldo() {
  showBkSub(S.bkSub || "auto");
  loadAutoBackup(); loadRecv();
  let d;
  try { d = await api("api/respaldo"); } catch (e) { $("#bkSize").textContent = e.message; return; }
  $("#bkSize").textContent = `Tamaño aproximado: ${mb(d.base)}`;
}
$("#btnBackup").onclick = () => toast("Preparando el respaldo; la descarga empieza en unos segundos…");
$("#btnRestore").onclick = async () => {
  const f = $("#bkFile").files[0];
  if (!f) { toast("Elige el archivo de respaldo", true); return; }
  if (!(await confirmBox(`¿Restaurar «${f.name}»? Se reemplazan los usuarios, los favoritos y los ajustes de este nodo; ASLSCAN se reiniciará y tendrás que entrar de nuevo.`, "Sí, restaurar"))) return;
  const btn = $("#btnRestore"), msg = $("#bkMsg");
  busy(btn, true, "Restaurando…");
  const fd = new FormData();
  fd.append("conservar_nodo", $("#bkKeepNode").checked ? "1" : "0");
  fd.append("archivo", f);
  const xhr = new XMLHttpRequest();
  xhr.open("POST", "api/respaldo/restaurar");
  xhr.setRequestHeader("X-ASLSCAN", "1");
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) msg.textContent = e.loaded < e.total
      ? `Subiendo… ${Math.round(e.loaded * 100 / e.total)} %` : "Revisando y restaurando…";
  };
  xhr.onload = () => {
    let r = null;
    try { r = JSON.parse(xhr.responseText); } catch {}
    if (xhr.status !== 200 || !r || r.ok === false) {
      busy(btn, false); msg.textContent = "";
      toast((r && r.error) || `Error ${xhr.status}`, true); return;
    }
    msg.textContent = `✅ Restaurado (nodo ${r.nodo || "?"}, ${r.fecha}). Reiniciando ASLSCAN…`;
    setTimeout(() => location.reload(), 9000);
  };
  xhr.onerror = () => { busy(btn, false); msg.textContent = ""; toast("Se cortó la conexión al subir el respaldo", true); };
  xhr.send(fd);
};
/* ── Respaldo automático ─────────────────────────────────────────────────── */
const fechaTs = (t) => (t ? new Date(t * 1000).toLocaleString() : "—");
const DEST = { nodo: "otro nodo", nube: "nube", telegram: "Telegram" };
async function loadAutoBackup() {
  let d;
  try { d = await api("api/autorespaldo"); } catch (e) { $("#abStatus").textContent = e.message; return; }
  const u = (d.estado || {}).ultimo;
  let html = "";
  if (d.corriendo) html = `<b>⏳ Haciendo un respaldo…</b>`;
  else if (u) {
    const res = Object.entries(u.resultados || {}).map(([k, v]) =>
      `<li><span class="d">${v.ok ? "✅" : "❌"} ${esc(DEST[k] || k)}</span><span translate="no">${esc(v.detalle || "")}</span></li>`).join("");
    html = `<b>${u.ok ? "✅" : "❌"} ${esc(u.fecha)}</b>
      <div class="muted" style="font-size:.84rem">${esc(u.origen)}${u.tam ? ` · ${mb(u.tam)}` : ""}${u.nota ? " · " + esc(u.nota) : ""}</div>
      ${res ? `<ul class="upd-list">${res}</ul>` : ""}`;
  } else html = `<span class="muted">Todavía no se ha hecho ningún respaldo automático.</span>`;
  $("#abStatus").innerHTML = html;
  renderCloud(d);
  const t = d.telegram || {};
  $("#abTg").innerHTML = !t.configurado ? "⚠ Primero configura el bot de Telegram en Ajustes → Telegram."
    : t.admins.length ? `✅ Llega a: <b>${t.admins.map(esc).join(", ")}</b>`
    : "⚠ Ningún administrador tiene su Telegram vinculado. Vincúlalo en Mi perfil (clic en tu foto o nombre).";
  clearTimeout(loadAutoBackup._t);
  if (d.corriendo) loadAutoBackup._t = setTimeout(() => { if (S.setSec === "respaldo") loadAutoBackup(); }, 3000);
}
function renderCloud(d) {
  const box = $("#abCloud"), name = { drive: "Google Drive", onedrive: "OneDrive" };
  if (!d.rclone) {
    box.innerHTML = `<b>Falta rclone en este nodo</b>
      <p class="muted" style="margin:4px 0">rclone es el programa que sube los respaldos a Google Drive u OneDrive. Para instalarlo, en la terminal del nodo:</p>
      <pre translate="no">sudo apt install rclone</pre>
      <p class="muted" style="margin:4px 0">Si apt no lo encuentra (por ejemplo en HamVOIP):</p>
      <pre translate="no">curl https://rclone.org/install.sh | sudo bash</pre>`;
    return;
  }
  if (d.nube) {
    box.innerHTML = `<div class="upd-head"><div><b>✅ Conectado a ${esc(name[d.nube] || d.nube)}</b>
      <div class="muted" style="font-size:.84rem">Los respaldos van a <span translate="no">${esc(d.nube_carpeta)}</span> · <span translate="no">${esc(d.rclone)}</span></div></div>
      <button type="button" class="btn sm ghost" id="btnCloudDel">Desconectar</button></div>`;
    $("#btnCloudDel").onclick = async () => {
      if (!(await confirmBox("¿Desconectar la nube? Los respaldos que ya están ahí no se borran."))) return;
      await run(() => api("api/autorespaldo/nube", { method: "DELETE" }), "Nube desconectada");
      loadAutoBackup();
    };
    return;
  }
  box.innerHTML = `<b>Conectar con la nube</b>
    <ol class="muted" style="margin:6px 0;padding-left:20px;font-size:.88rem">
      <li>En tu computadora instala rclone (<a href="https://rclone.org/downloads/" target="_blank" rel="noopener">rclone.org/downloads</a>).</li>
      <li>En una terminal de tu computadora corre el comando de abajo. Se abre el navegador para que autorices con tu cuenta.</li>
      <li>Copia todo el texto que aparece entre <code>---></code> y <code><---</code> y pégalo aquí.</li>
    </ol>
    <label>Servicio<select id="cloudTipo"><option value="drive">Google Drive</option><option value="onedrive">OneDrive</option></select></label>
    <pre translate="no" id="cloudCmd">rclone authorize "drive"</pre>
    <label>Texto que te dio rclone<textarea id="cloudTok" rows="3" placeholder='{"access_token":"…","token_type":"Bearer","refresh_token":"…","expiry":"…"}' translate="no"></textarea></label>
    <div class="row gap"><button type="button" class="btn primary sm" id="btnCloudSet">Conectar</button></div>`;
  $("#cloudTipo").onchange = () => { $("#cloudCmd").textContent = `rclone authorize "${$("#cloudTipo").value}"`; };
  $("#btnCloudSet").onclick = async () => {
    const b = $("#btnCloudSet"); busy(b, true, "Conectando…");
    try {
      await run(() => api("api/autorespaldo/nube", { method: "POST", json: { tipo: $("#cloudTipo").value, token: $("#cloudTok").value } }),
        "Nube conectada");
      loadAutoBackup();
    } catch {} finally { busy(b, false); }
  };
}
$("#btnAbProbe").onclick = async () => {
  const f = $("#setForm"), b = $("#btnAbProbe"), msg = $("#abProbeMsg");
  busy(b, true, "Probando…"); msg.textContent = "";
  try {
    const r = await api("api/autorespaldo/probar-nodo", { method: "POST", json: { url: f.ab_node_url.value, codigo: f.ab_node_token.value } });
    f.ab_node_pin.value = r.huella || "";
    msg.textContent = `✅ Conectado con ${r.estacion || "el nodo"}${r.nodo ? " · nodo " + r.nodo : ""} (v${r.version}, ${r.libre_mb} MB libres). Guarda los ajustes.`;
  } catch (e) { msg.textContent = "❌ " + e.message; }
  finally { busy(b, false); }
};
$("#setForm").ab_node_url.addEventListener("input", () => { $("#setForm").ab_node_pin.value = ""; });
$("#btnAbNow").onclick = async () => {
  // Primero se guardan los ajustes del respaldo tal como están en pantalla
  const f = $("#setForm"), data = {};
  for (const el of f.elements) {
    if (!el.name || !el.name.startsWith("ab_")) continue;
    if (el.type === "checkbox") data[el.name] = el.checked;
    else if ("secret" in el.dataset) { if (el.value.trim()) data[el.name] = el.value.trim(); }
    else data[el.name] = el.value;
  }
  try {
    const r = await api("api/ajustes", { method: "PUT", json: data });
    S.cfg = r.ajustes;
    await run(() => api("api/autorespaldo/ahora", { method: "POST", json: { audios: "no" } }), "Respaldo iniciado");
  } catch (e) { toast(e.message, true); }
  loadAutoBackup();
};
/* Recibir respaldos de otros nodos */
async function loadRecv() {
  const box = $("#recvBox");
  let d;
  try { d = await api("api/respaldos-recibidos"); } catch (e) { box.textContent = e.message; return; }
  const codes = d.codigos.map((c) => `<li><span class="d">${esc(c.etiqueta || "(sin nombre)")}</span>
      <span>Creado ${esc(fechaTs(c.creado))} · ${c.ultimo_uso ? `último respaldo ${esc(fechaTs(c.ultimo_uso))} del nodo ${esc(c.ultimo_nodo)} (${esc(c.ultima_ip)})` : "sin usar"}</span>
      <button type="button" class="btn sm ghost" data-del="${c.id}">Quitar</button></li>`).join("");
  const nodos = d.nodos.map((n) => `<div class="upd-box"><b>Nodo ${esc(n.nodo)}</b>${n.estacion ? ` · ${esc(n.estacion)}` : ""}
      <div class="muted" style="font-size:.84rem">${n.ultimo ? `Último: ${esc(n.ultimo)} desde ${esc(n.ip || "?")} · v${esc(n.version || "?")}` : ""}</div>
      <ul class="upd-list">${n.archivos.map((a) => `<li><span class="d">${esc(a.fecha)}</span><span><a href="api/respaldos-recibidos/${encodeURIComponent(n.nodo)}/${encodeURIComponent(a.nombre)}" download translate="no">${esc(a.nombre)}</a> · ${mb(a.tam)}</span></li>`).join("")}</ul></div>`).join("");
  box.innerHTML = `<h4>Códigos de acceso</h4>
    ${codes ? `<ul class="upd-list">${codes}</ul>` : `<p class="muted">No hay códigos. Crea uno para cada nodo que mandará respaldos aquí.</p>`}
    <div class="row gap wrap" style="margin:8px 0 14px"><input id="recvLabel" placeholder="Nombre (p. ej. nodo 58788)" style="max-width:260px"><button type="button" class="btn sm" id="btnRecvNew">+ Nuevo código</button></div>
    <h4>Respaldos guardados</h4>
    ${nodos || `<p class="muted">Todavía no ha llegado ningún respaldo.</p>`}`;
  $$("[data-del]", box).forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox("¿Quitar este código? El nodo que lo usa ya no podrá mandar respaldos aquí. Los respaldos guardados no se borran."))) return;
    await run(() => api("api/respaldos-recibidos/codigos/" + b.dataset.del, { method: "DELETE" }), "Código quitado");
    loadRecv();
  }));
  $("#btnRecvNew").onclick = async () => {
    const r = await run(() => api("api/respaldos-recibidos/codigos", { method: "POST", json: { etiqueta: $("#recvLabel").value } }));
    const url = location.origin + location.pathname.replace(/[^/]*$/, "");
    openModal("Código para recibir respaldos", `<p>En el nodo que mandará los respaldos (ASLSCAN o HAMNA Web), ve a Ajustes → Respaldo → Automático → «A otro nodo» y pega:</p>
      <label>Dirección del nodo destino<input readonly value="${esc(url)}" translate="no"></label>
      <label>Código de acceso<input readonly value="${esc(r.codigo)}" translate="no" id="newRecvCode"></label>
      <p class="muted">Copia el código ahora: por seguridad no se vuelve a mostrar.</p>
      <div class="modal-actions"><button class="btn" id="cpRecv">Copiar código</button><button class="btn primary" id="okRecv">Listo</button></div>`);
    $("#cpRecv").onclick = () => { const i = $("#newRecvCode"); i.select(); try { navigator.clipboard.writeText(i.value); toast("Código copiado"); } catch { document.execCommand("copy"); } };
    $("#okRecv").onclick = () => closeModal();
    loadRecv();
  };
}
/* ── Actualizaciones (GitHub) ─────────────────────────────────────────────── */
function updCmd(d) {
  return d.sabor === "hamvoip" ? "/opt/aslscan/update.sh" : "sudo /opt/aslscan/update.sh";
}
async function loadUpdates(force) {
  const box = $("#updBox");
  if (!box) return;
  if (!isAdmin()) { box.classList.add("hidden"); return; }
  box.classList.remove("hidden");
  if (force) box.innerHTML = '<p class="muted">Buscando actualizaciones…</p>';
  let d;
  try { d = await api("api/actualizaciones" + (force ? "?forzar=1" : "")); }
  catch (e) {
    markUpdate(null);
    box.className = "upd-box";
    box.innerHTML = `<div class="upd-head"><span class="muted">${esc(e.message)}</span>
      <button type="button" class="btn sm" id="btnUpd">↻ Buscar de nuevo</button></div>`;
    $("#btnUpd").onclick = () => loadUpdates(true); return;
  }
  markUpdate(d);
  box.className = "upd-box" + (d.hay_actualizacion ? " new" : "");
  box.innerHTML = `<div class="upd-head">
      <div>${d.hay_actualizacion ? `<b>Hay una versión nueva: v${esc(d.ultima)}</b>` : `<b>ASLSCAN está al día</b>`}
        <div class="muted" style="font-size:.84rem">Instalada: v${esc(d.instalada)} · En GitHub: v${esc(d.ultima || "?")} · Consultado: ${esc(d.consultado)}</div></div>
      <div class="row gap"><a class="btn sm ghost" href="${esc(d.notas || d.url)}" target="_blank" rel="noopener">GitHub ↗</a>
        <button type="button" class="btn sm" id="btnUpd">↻ Buscar de nuevo</button></div></div>
    ${d.cambios.length ? `<ul class="upd-list">${d.cambios.map((c) =>
      `<li><span class="d">${esc(c.fecha)}</span><span>${esc(c.titulo)}</span></li>`).join("")}</ul>` : ""}
    ${d.hay_actualizacion ? `<div class="upd-cmd">Para instalarla, en la terminal del nodo:
      <pre translate="no">${esc(updCmd(d))}</pre>
      <span class="muted">Conserva los datos, usuarios y ajustes.</span></div>` : ""}`;
  $("#btnUpd").onclick = () => loadUpdates(true);
}
/* Etiqueta de versión: verde = al día, ámbar = hay versión nueva, gris = sin saber */
function markUpdate(d) {
  const v = $("#appVer"), es = window.HAMNA_LANG === "es";
  const nueva = !!(d && d.hay_actualizacion), aldia = !!(d && d.ultima && !d.hay_actualizacion);
  v.classList.toggle("has-update", nueva);
  v.classList.toggle("up-to-date", aldia);
  v.title = nueva ? (es ? `Hay una versión nueva: v${d.ultima}` : `A new version is available: v${d.ultima}`)
    : aldia ? (es ? "ASLSCAN está al día" : "ASLSCAN is up to date") : "";
}
$("#appVer").onclick = () => { if ($("#appVer").classList.contains("has-update")) { S.setSec = "sistema"; showTab("ajustes"); } };

async function loadSistema() {
  S.info = null;
  loadUpdates(false);
  loadHealth(false);
  const i = await getInfo();
  const be = i.backend || {};
  const rows = [["Versión", "ASLSCAN " + i.version],
    ["Sistema", { asl3: "AllStarLink 3", hamvoip: "HamVOIP", asl: "AllStarLink" }[i.sabor] || (i.detectado || "").toUpperCase()],
    ["Nodo", be.node || be.stationid || "—"], ["Asterisk", be.asterisk], ["Nodo responde", be.nodo_ok == null ? null : be.nodo_ok ? "Sí" : "No"],
    ["Zona horaria", i.zona_horaria], ["Espacio libre", i.disco_libre_mb + " MB"], ["Error", be.error]].filter((r) => r[1] != null && r[1] !== "");
  $("#sysInfo").innerHTML = `<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
  if (S.status) renderLive(S.status.envivo);
  loadVcon(S.cfg && S.cfg.backend && S.cfg.backend !== "auto" ? S.cfg.backend : i.detectado);
}

/* ── Tema claro / oscuro ─────────────────────────────────────────────────── */
function applyTheme(th) {
  if (th === "light" || th === "dark") document.documentElement.dataset.theme = th;
  else delete document.documentElement.dataset.theme;
}
try { applyTheme(localStorage.getItem("aslscan.theme")); } catch {}
$$(".live-btn").forEach((b) => { b.onclick = () => (LIVE.on ? liveStop() : liveStart()); });
$("#btnTheme").onclick = () => {
  const cur = document.documentElement.dataset.theme ||
    (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  const next = cur === "light" ? "dark" : "light";
  applyTheme(next);
  try { localStorage.setItem("aslscan.theme", next); } catch {}
};

/* ── Conexiones: nodos conectados ──────────────────────────────────────────────
   Se consulta cada 4 s solo con esta pestaña abierta y visible. */
const SES_EVERY = 4000;
const ICON_NODE = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4"/></svg>';
function stopSesiones() { clearTimeout(S.sesTimer); clearInterval(S.sesTick); S.sesTimer = S.sesTick = null; }
async function loadSesiones() {
  clearTimeout(S.sesTimer);
  if (S.tab !== "conexiones" || document.hidden) return;
  try {
    const q = S.sesNodo ? "?nodo=" + encodeURIComponent(S.sesNodo) : "";
    S.ses = await api("api/sesiones" + q); S.sesAt = Date.now();
    renderSesiones();
  } catch (e) {
    $("#sesList").innerHTML = `<p class="empty">${esc(e.message)}</p>`;
  }
  if (!S.sesTick) S.sesTick = setInterval(tickSesiones, 1000);
  // IRLP: COS y PTT cambian rápido, se leen más seguido
  S.sesTimer = setTimeout(loadSesiones, S.ses && S.ses.sistema === "irlp" ? 1500 : SES_EVERY);
}
const fmtUp = (s) => {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d} d ${h} h` : h ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min ${String(s % 60).padStart(2, "0")} s`;
};
function tickSesiones() {
  if (!S.ses || document.hidden) return;
  const add = Math.floor((Date.now() - S.sesAt) / 1000);
  $$("#sesList [data-secs]").forEach((el) => (el.textContent = fmtUp(+el.dataset.secs + add)));
}
function renderSesiones() {
  const s = S.ses;
  const sel = $("#sesNodo");
  if ((s.nodos_locales || []).length > 1) {
    sel.innerHTML = s.nodos_locales.map((n) => `<option ${n === s.nodo ? "selected" : ""}>${esc(n)}</option>`).join("");
    sel.classList.remove("hidden");
  } else sel.classList.add("hidden");
  $("#sesConnect").classList.toggle("hidden", s.sistema !== "asl");
  $("#aslBuscar").classList.toggle("hidden", s.sistema !== "asl");
  if (S.bus) renderBuscar();
  $("#irlpCtl").classList.toggle("hidden", s.sistema !== "irlp");
  if (s.sistema === "irlp") renderIrlpCtl(s);
  renderAslFavs(s);
  if (s.sistema !== "asl" && s.sistema !== "irlp") {
    $("#sesStats").innerHTML = "";
    $("#sesList").innerHTML = `<p class="empty">En modo simulado no hay enlaces que mostrar.</p>`;
    $("#sesRedWrap").classList.add("hidden");
    return;
  }
  const loc = s.local || {};
  $("#sesSub").textContent = `Nodo ${s.nodo}${loc.indicativo ? " · " + loc.indicativo : ""} — el nodo y sus conexiones en este momento`;
  const estado = s.tx ? ["Transmitiendo", "tx"] : s.rx ? ["Recibiendo", "rx"] : ["En reposo", ""];
  const talking = s.enlaces.filter((e) => e.transmitiendo);
  const line = (on, label, cls) => `<span class="chip ${on ? cls : ""}">${label} ${on == null ? "?" : on ? "●" : "○"}</span>`;
  $("#sesStats").innerHTML = s.sistema === "irlp" ? `
    <div class="stat"><div class="k">IRLP</div><div class="v sm">${s.activo ? "Conectado a " + esc(s.activo) : "Sin conexión"}</div>${s.detalle ? `<div class="d">${esc(s.detalle)}</div>` : ""}</div>
    <div class="stat ${estado[1]}"><div class="k">Radio</div><div class="v sm">${estado[0]}</div>
      <div class="d row gap">${line(s.cos, "COS", "ok")}${line(s.ptt, "PTT", "live")}</div></div>` : `
    <div class="stat"><div class="k">Enlaces directos</div><div class="v">${s.enlaces.length}</div>
      <div class="d">${s.enlaces.filter((e) => e.direccion === "IN").length} entrantes · ${s.enlaces.filter((e) => e.direccion === "OUT").length} salientes</div></div>
    <div class="stat"><div class="k">Nodos en la red</div><div class="v">${s.total_red}</div><div class="d">alcanzables a través de los enlaces</div></div>
    <div class="stat ${estado[1]}"><div class="k">Estado del nodo</div><div class="v sm">${estado[0]}</div>
      <div class="d">${talking.length ? "Habla: " + talking.map((e) => esc(e.indicativo || e.nodo)).join(", ") : "Nadie transmitiendo"}</div></div>`;
  if (!s.enlaces.length) {
    $("#sesList").innerHTML = `<p class="empty">No hay nodos conectados.</p>`;
  } else {
    $("#sesList").innerHTML = s.enlaces.map((e) => {
      const desc = [e.descripcion, e.ubicacion].filter(Boolean).join(" · ");
      const dir = e.direccion === "IN" ? "↘ Entrante" : e.direccion === "OUT" ? "↗ Saliente" : "";
      const disc = s.sistema === "asl" ? `<button class="btn sm danger-soft" data-disc="${esc(e.nodo)}" title="Desconectar">Desconectar</button>` : "";
      return `<div class="lnk ${e.modo === "monitor" ? "monitor" : ""} ${e.transmitiendo ? "keyed" : ""}">
        <div class="av">${ICON_NODE}</div>
        <div class="who"><b>${esc(e.indicativo || "Nodo " + e.nodo)}</b><span class="num">${esc(e.nodo)}</span>
          <small>${esc(desc || e.ip || "")}</small></div>
        <div class="tags">
          ${e.transmitiendo ? '<span class="chip ok talk">Hablando</span>' : ""}
          ${e.modo ? `<span class="chip ${e.modo === "monitor" ? "warn" : ""}">${esc(e.modo[0].toUpperCase() + e.modo.slice(1))}</span>` : ""}
          ${dir ? `<span class="chip">${dir}</span>` : ""}
          ${e.estado && e.estado !== "ESTABLISHED" ? `<span class="chip warn">${esc(e.estado)}</span>` : ""}
        </div>
        <div class="row gap"><div class="time">${e.segundos != null ? `<span data-secs="${e.segundos}">${fmtUp(e.segundos)}</span>` : ""}<small>${esc(e.ip || "")}</small></div>${disc}</div>
      </div>`;
    }).join("");
  }
  const red = s.red || [];
  $("#sesRedWrap").classList.toggle("hidden", !red.length);
  if (s.sistema === "irlp") {
    // status.irlp.net: quién más está en el mismo reflector (se ve abierto)
    if (red.length && !S.sesRedOpened) { $("#sesRedWrap").open = true; S.sesRedOpened = true; }
    $("#sesRedTitle").textContent = `En ${s.activo} · ${red.length} ${red.length === 1 ? "nodo más" : "nodos más"}`;
    $("#sesRed").innerHTML = red.map((r) => `<span class="nchip" title="${esc([r.descripcion, r.frecuencia, (window.HAMNA_LANG === "es" ? "conectado " : "connected ") + r.tiempo].filter(Boolean).join(" · "))}">
      <b>${esc(r.nodo)} ${esc(r.indicativo || "")}</b><small>${esc(r.ubicacion || r.descripcion || "—")}</small></span>`).join("") +
      `<p class="muted small" style="flex-basis:100%">Según status.irlp.net (se actualiza cada pocos minutos).</p>`;
    return;
  }
  $("#sesRedTitle").textContent = `Red completa · ${red.length} nodos más`;
  $("#sesRed").innerHTML = red.map((r) => `<span class="nchip" title="${esc([r.descripcion, r.ubicacion].filter(Boolean).join(" · "))}">
    <b>${esc(r.nodo)}</b><small>${esc(r.indicativo || "—")}</small></span>`).join("");
}
$("#sesNodo").onchange = (e) => { S.sesNodo = e.target.value; loadSesiones(); };
$("#btnSesReload").onclick = () => loadSesiones();
$("#sesList").onclick = async (e) => {
  const b = e.target.closest("[data-disc]"); if (!b) return;
  const n = b.dataset.disc;
  if (!(await confirmBox(`¿Desconectar el nodo ${n}? Dejará de oír y de mandar audio por este enlace.`, "Desconectar"))) return;
  try {
    await run(() => api("api/sesiones/desconectar", { method: "POST", json: { destino: n, nodo: S.ses.nodo } }), "Desconectando " + n);
    setTimeout(loadSesiones, 1500);
  } catch {}
};
$("#sesConnect").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target, n = f.destino.value.trim();
  const b = $("button", f); busy(b, true, "Conectando…");
  try {
    await run(() => api("api/sesiones/conectar", { method: "POST", json: { destino: n, modo: f.modo.value, nodo: S.ses && S.ses.nodo } }), "Conectando " + n);
    f.destino.value = "";
    setTimeout(loadSesiones, 2500);
  } catch {} finally { busy(b, false); }
};

// Favoritos como mini tarjetas: el número grande a la izquierda y la descripción abajo.
// Con más de una categoría, arriba van pestañas (Todos + una por categoría); la elegida se recuerda.
const FAV_TODOS = "__todos__";        // valor de la pestaña «Todos» (no choca con un nombre real)
function favTab(tipo, cats) {
  S.favTab = S.favTab || {};
  if (S.favTab[tipo] === undefined) { try { S.favTab[tipo] = localStorage.getItem("aslscan.favtab." + tipo) || FAV_TODOS; } catch { S.favTab[tipo] = FAV_TODOS; } }
  return cats.includes(S.favTab[tipo]) ? S.favTab[tipo] : FAV_TODOS;
}
function favCards(favs, conectado, attr, titulo, editar, estado, cats) {
  const head = `<div class="fav-head"><span class="lbl">${titulo}</span>${editar && isAdmin() ? `<button type="button" class="btn sm ghost ro" data-favedit="${editar}">✏️ Editar</button>` : ""}</div>`;
  if (!favs.length) return head + `<p class="muted fav-empty">Todavía no hay favoritos.${editar && isAdmin() ? " Agrégalos con ✏️ Editar." : ""}</p>`;
  const tarjeta = (f) => {
    const on = conectado(f.nodo);
    return `<button type="button" class="favc ${on ? "on" : ""}" ${attr}="${esc(f.nodo)}" title="${on ? "Conectado" : "Conectar a " + esc(f.nodo)}">
      <span class="n"><span>${esc(f.nodo)}</span>${on ? '<span class="st">● Conectado</span>' : (estado && estado(f.nodo)) || '<span class="st">⭐</span>'}</span>
      <small>${esc(f.nombre || "Sin descripción")}</small></button>`;
  };
  const grupos = (cats || []).map((c) => [c, favs.filter((f) => f.categoria === c)]).filter(([, fs]) => fs.length);
  const sueltos = favs.filter((f) => !(cats || []).includes(f.categoria));
  if (sueltos.length) grupos.push(["Generales", sueltos]);
  if (grupos.length < 2) return head + `<div class="fav-grid">${favs.map(tarjeta).join("")}</div>`;
  const tab = favTab(editar, grupos.map(([c]) => c));
  const tabs = `<div class="fav-tabs" role="tablist" translate="no">` +
    [[FAV_TODOS, LG("Todos", "All"), favs.length]].concat(grupos.map(([c, fs]) => [c, c, fs.length])).map(([k, txt, n]) =>
      `<button type="button" role="tab" class="fav-tab ${k === tab ? "active" : ""}" aria-selected="${k === tab}" data-favtab="${editar}" data-cat="${esc(k)}">${esc(txt)}<span class="cnt">${n}</span></button>`).join("") + `</div>`;
  const cuerpo = tab === FAV_TODOS
    ? grupos.map(([c, fs]) => `<div class="fav-cat"><div class="fav-cat-h" translate="no">${esc(c)}</div><div class="fav-grid">${fs.map(tarjeta).join("")}</div></div>`).join("")
    : `<div class="fav-grid">${grupos.find(([c]) => c === tab)[1].map(tarjeta).join("")}</div>`;
  return head + tabs + cuerpo;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-favtab]"); if (!b) return;
  const tipo = b.dataset.favtab;
  S.favTab = S.favTab || {}; S.favTab[tipo] = b.dataset.cat;
  try { localStorage.setItem("aslscan.favtab." + tipo, b.dataset.cat); } catch {}
  if (tipo === "asl" && S.ses) renderAslFavs(S.ses); else if (S.ses) renderIrlpCtl(S.ses);
});

/* ── Control del nodo IRLP (lo que hacía IRLPvCON) ─────────────────────────── */
async function irlpInfo(force) {
  if (!S.irlp || force) { try { S.irlp = await api("api/irlp"); } catch { S.irlp = { favoritos: [] }; } }
  return S.irlp;
}
const irlpEn = (activo, nodo) => { const d = String(activo || "").replace(/\D/g, ""); return !!d && d.slice(-4) === nodo.slice(-4); };
function setHtml(el, html) { if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; } }
async function renderIrlpCtl(s) {
  const info = await irlpInfo();
  $("#irlpEnd").classList.toggle("hidden", !s.activo);
  const favs = info.favoritos || [];
  setHtml($("#irlpFavs"), favCards(favs, (n) => irlpEn(s.activo, n), "data-irlpfav", "Favoritos", "irlp", null, info.categorias || []));
  const hab = s.habilitado !== false;
  const aux = info.aux ? [1, 2, 3].map((n) => `<span class="grp"><span class="lbl">AUX${n}</span>
      <button type="button" class="btn sm" data-irlpaux="${n}on">Encender</button><button type="button" class="btn sm" data-irlpaux="${n}off">Apagar</button></span>`).join("") : "";
  setHtml($("#irlpRow"), `
    <span class="grp"><span class="chip ${hab ? "ok" : "warn"}">${hab ? "✅ Habilitado" : "⛔ Deshabilitado"}</span>
      <button type="button" class="btn sm ${hab ? "danger-soft" : "primary"}" data-irlpacc="${hab ? "deshabilitar" : "habilitar"}">${hab ? "Deshabilitar" : "Habilitar"}</button></span>
    <span class="grp" title="IRLP se desconecta solo tras un rato sin actividad"><span class="lbl">Desconexión por inactividad</span>
      <span class="chip ${s.timeout ? "ok" : ""}">${s.timeout ? "Activada" : "Desactivada"}</span>
      <button type="button" class="btn sm" data-irlptout="${s.timeout ? "off" : "on"}">${s.timeout ? "Desactivar" : "Activar"}</button></span>${aux}`);
}
async function irlpHacer(accion, valor, msg) {
  await run(() => api("api/irlp/" + accion, { method: "POST", json: { valor } }), msg);
  setTimeout(loadSesiones, 1200);
}
async function irlpConectar(n) {
  await run(() => api("api/sesiones/conectar", { method: "POST", json: { destino: n } }), "Conectando a " + n);
  setTimeout(loadSesiones, 3000);
}
$("#irlpConnect").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target, n = f.destino.value.trim(), b = $("button[type=submit]", f);
  const s = S.ses || {};
  if (s.activo && !(await confirmBox(`El nodo está conectado a ${s.activo}. ¿Conectar a ${n}?`, "Conectar", false))) return;
  busy(b, true, "Conectando…");
  try { await irlpConectar(n); f.destino.value = ""; } catch {} finally { busy(b, false); }
};
$("#irlpEnd").onclick = async () => {
  const s = S.ses || {};
  if (!(await confirmBox(`¿Desconectar de ${s.activo || "IRLP"}?`, "Desconectar"))) return;
  try {
    await run(() => api("api/sesiones/desconectar", { method: "POST", json: {} }), "Desconectando");
    setTimeout(loadSesiones, 2000);
  } catch {}
};
$("#irlpDtmf").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target, c = f.codigo.value.trim().toUpperCase();
  if (!(await confirmBox(`¿Ejecutar el código DTMF ${c}? IRLP lo toma como si llegara por el radio.`, "Ejecutar", false))) return;
  try { await irlpHacer("dtmf", c, "Código " + c + " enviado"); f.codigo.value = ""; } catch {}
};
$("#irlpCtl").addEventListener("click", async (e) => {
  const fav = e.target.closest("[data-irlpfav]"), acc = e.target.closest("[data-irlpacc]");
  const tout = e.target.closest("[data-irlptout]"), aux = e.target.closest("[data-irlpaux]");
  try {
    if (fav) {
      const n = fav.dataset.irlpfav, s = S.ses || {};
      if (irlpEn(s.activo, n)) return toast("Ya está conectado a " + n);
      if (!(await confirmBox(s.activo ? `El nodo está conectado a ${s.activo}. ¿Conectar a ${n}?` : `¿Conectar a ${n}?`, "Conectar", false))) return;
      await irlpConectar(n);
    } else if (acc) {
      const a = acc.dataset.irlpacc;
      if (a === "deshabilitar" && !(await confirmBox("¿Deshabilitar el nodo? IRLP deja de aceptar conexiones y códigos DTMF del radio hasta que lo habilites.", "Deshabilitar"))) return;
      await irlpHacer(a, "", a === "habilitar" ? "Nodo habilitado" : "Nodo deshabilitado");
    } else if (tout) {
      const on = tout.dataset.irlptout === "on";
      await irlpHacer("timeout", tout.dataset.irlptout, on ? "Desconexión por inactividad activada" : "Desconexión por inactividad desactivada");
    } else if (aux) {
      const v = aux.dataset.irlpaux;
      await irlpHacer("aux", v, "AUX" + v[0] + (v.endsWith("on") ? " encendida" : " apagada"));
    }
  } catch {}
});
/* Editor de favoritos por categorías: una sección por categoría (nombre editable, ↑↓ para
   moverla, 🗑 para borrarla); en cada una sus nodos con el nombre editable, ↑↓ y arrastre
   (también entre categorías) y un selector para cambiarlo de categoría. Abajo se agrega
   (en ASL buscando en el directorio) a la categoría elegida. Nada se guarda hasta Guardar. */
const FAV_MAX = 120, FAV_MAX_CATS = 30, FAV_GENERAL = "Generales";
function favEditor(tipo) {
  const asl = tipo === "asl";
  const src = asl ? ((S.aslFavs || {})[S.ses.nodo] || []) : ((S.irlp && S.irlp.favoritos) || []);
  const C = ((asl ? (S.aslCats || {})[S.ses.nodo] : S.irlp && S.irlp.categorias) || []).slice();
  const L = src.map((f) => ({ nodo: f.nodo, nombre: f.nombre || "", categoria: f.categoria || FAV_GENERAL }));
  L.forEach((f) => { if (!C.includes(f.categoria)) C.push(f.categoria); });
  if (!C.length) C.push(FAV_GENERAL);
  const numOk = asl ? /^\d{3,7}$/ : /^\d{4,6}$/;
  let catAdd = C[0];
  openModal(asl ? LG("Favoritos de ASL", "ASL favorites") : LG("Favoritos de IRLP", "IRLP favorites"), `<form id="favForm" autocomplete="off">
    <p class="muted fe-help">${LG("Cada categoría es una pestaña en el Dashboard y un botón en el bot. Cambia los nombres ahí mismo, arrastra ⠿ (o usa ↑ ↓) para ordenar, y el selector o el arrastre para pasar un nodo a otra categoría.", "Each category is a tab in the Dashboard and a button in the bot. Edit names in place, drag ⠿ (or use ↑ ↓) to reorder, and use the selector or drag to move a node to another category.")}</p>
    <div class="fe-list" id="feList" translate="no"></div>
    <div class="fe-catbar"><button type="button" class="btn sm" id="feNewCat">＋ ${LG("Nueva categoría", "New category")}</button></div>
    <div class="fe-add">
      <div class="fe-add-row">
        <input id="feQ" placeholder="${asl ? LG("Agregar: indicativo, nodo o lugar…", "Add: callsign, node or place…") : LG("Nodo o reflector", "Node or reflector")}" maxlength="40" spellcheck="false" ${asl ? "" : 'inputmode="numeric"'}>
        ${asl ? "" : `<input id="feNom" placeholder="${LG("Descripción", "Description")}" maxlength="40">`}
        <label class="fe-en">${LG("en", "in")} <select id="feCatAdd" translate="no"></select></label>
        ${asl ? "" : `<button type="button" class="btn" id="feAddIrlp">＋ ${LG("Agregar", "Add")}</button>`}
      </div>
      <div class="fe-res" id="feRes" translate="no"></div>
    </div>
    <div class="modal-actions"><button type="button" class="btn" id="favNo">${LG("Cancelar", "Cancel")}</button><button class="btn primary">${LG("Guardar", "Save")}</button></div></form>`);
  const list = $("#feList"), res = $("#feRes");
  let feRes = [], feSeq = 0, feT = 0;
  const nombreDe = (r) => [r.indicativo, r.descripcion, r.ubicacion].filter(Boolean).join(" · ").slice(0, asl ? 60 : 40);
  const opciones = (sel) => C.map((c) => `<option value="${esc(c)}" ${c === sel ? "selected" : ""}>${esc(c)}</option>`).join("");

  function pintar(foco) {
    if (!C.includes(catAdd)) catAdd = C[0];
    list.innerHTML = C.map((c, ci) => {
      const filas = L.map((f, i) => [f, i]).filter(([f]) => f.categoria === c);
      const borrable = C.length > 1;
      return `<section class="fe-cat" data-ci="${ci}">
        <div class="fe-cat-h" data-ci="${ci}">
          <span class="fe-cat-ic">📁</span>
          <input class="fe-catnom" data-ci="${ci}" value="${esc(c)}" maxlength="40" aria-label="${LG("Nombre de la categoría", "Category name")}">
          <span class="muted fe-cnt">${filas.length}</span>
          <span class="fe-btns">
            <button type="button" class="btn sm ghost" data-fec="up" data-ci="${ci}" ${ci === 0 ? "disabled" : ""} title="${LG("Subir la categoría", "Move category up")}">↑</button>
            <button type="button" class="btn sm ghost" data-fec="down" data-ci="${ci}" ${ci === C.length - 1 ? "disabled" : ""} title="${LG("Bajar la categoría", "Move category down")}">↓</button>
            <button type="button" class="btn sm ghost fe-del" data-fec="del" data-ci="${ci}" ${borrable ? "" : "disabled"} title="${borrable ? LG("Borrar la categoría (sus nodos pasan a otra)", "Delete the category (its nodes move to another one)") : LG("Tiene que quedar al menos una categoría", "At least one category must remain")}">🗑</button>
          </span>
        </div>
        ${filas.length ? filas.map(([f, i], k) => `<div class="fe-row" draggable="true" data-i="${i}">
          <span class="fe-grip" title="${LG("Arrastra para moverlo (también a otra categoría)", "Drag to move it (also to another category)")}">⠿</span>
          <b class="fe-n">${esc(f.nodo)}</b>
          <input class="fe-nom" data-i="${i}" value="${esc(f.nombre)}" maxlength="${asl ? 60 : 40}" placeholder="${LG("Sin descripción", "No description")}">
          ${C.length > 1 ? `<select class="fe-catsel" data-i="${i}" title="${LG("Categoría", "Category")}">${opciones(f.categoria)}</select>` : ""}
          <span class="fe-btns">
            <button type="button" class="btn sm ghost" data-fe="up" data-i="${i}" ${k === 0 ? "disabled" : ""} title="${LG("Subir", "Move up")}">↑</button>
            <button type="button" class="btn sm ghost" data-fe="down" data-i="${i}" ${k === filas.length - 1 ? "disabled" : ""} title="${LG("Bajar", "Move down")}">↓</button>
            <button type="button" class="btn sm ghost fe-del" data-fe="del" data-i="${i}" title="${LG("Quitar", "Remove")}">🗑</button>
          </span></div>`).join("")
        : `<p class="muted fe-vacia" data-ci="${ci}">${LG("Vacía: agrega nodos abajo o arrástralos aquí.", "Empty: add nodes below or drag them here.")}</p>`}
      </section>`;
    }).join("");
    $("#feCatAdd").innerHTML = opciones(catAdd);
    if (asl) pintarRes();
    if (foco) { const el = $(foco, list); if (el) { el.focus(); if (el.select) el.select(); if (el.scrollIntoView) el.scrollIntoView({ block: "nearest" }); } }
  }
  function pintarRes() {
    const q = $("#feQ").value.trim(), ya = new Map(L.map((f) => [f.nodo, f.categoria]));
    let filas = feRes.slice(0, 8).map((r) => `<div class="fe-hit"><b>${esc(r.nodo)}</b><span>${esc(nombreDe(r))}</span>${ya.has(r.nodo)
      ? `<span class="muted fe-ya">⭐ ${esc(ya.get(r.nodo))}</span>`
      : `<button type="button" class="btn sm" data-feadd="${esc(r.nodo)}">＋ ${LG("Agregar", "Add")}</button>`}</div>`).join("");
    if (numOk.test(q) && !feRes.some((r) => r.nodo === q) && !ya.has(q))
      filas += `<div class="fe-hit"><b>${esc(q)}</b><span class="muted">${LG("No está en el directorio (EchoLink, privado o nuevo)", "Not in the directory (EchoLink, private or new)")}</span><button type="button" class="btn sm" data-feadd="${esc(q)}">＋ ${LG("Agregar", "Add")}</button></div>`;
    if (feRes.length > 8) filas += `<p class="muted fe-mas">${LG(`y ${feRes.length - 8} más; escribe más para afinar.`, `and ${feRes.length - 8} more; type more to narrow it down.`)}</p>`;
    res.innerHTML = filas;
  }
  // Índices (en L) de los nodos de una categoría, en orden
  const deCat = (c) => L.map((f, i) => (f.categoria === c ? i : -1)).filter((i) => i >= 0);
  // Pone el nodo i justo antes del nodo j (o al final de la categoría c si j < 0)
  function colocar(i, j, c) {
    const x = L[i], ref = j >= 0 ? L[j] : null;
    L.splice(i, 1);
    x.categoria = c;
    if (ref && ref !== x) L.splice(L.indexOf(ref), 0, x);
    else { const idx = deCat(c); L.splice(idx.length ? idx[idx.length - 1] + 1 : L.length, 0, x); }
  }
  list.oninput = (e) => {
    const t = e.target;
    if (t.classList.contains("fe-nom")) L[+t.dataset.i].nombre = t.value;
  };
  list.onchange = (e) => {
    const t = e.target;
    if (t.classList.contains("fe-catsel")) { const i = +t.dataset.i; colocar(i, -1, t.value); pintar(); }
    else if (t.classList.contains("fe-catnom")) {
      const ci = +t.dataset.ci, viejo = C[ci], nuevo = t.value.replace(/\s+/g, " ").trim().slice(0, 40);
      if (!nuevo) { toast(LG("La categoría necesita un nombre.", "The category needs a name."), true); t.value = viejo; return; }
      if (nuevo !== viejo && C.some((c, k) => k !== ci && c.toLowerCase() === nuevo.toLowerCase())) { toast(LG(`Ya hay una categoría «${nuevo}».`, `There's already a category “${nuevo}”.`), true); t.value = viejo; return; }
      C[ci] = nuevo; L.forEach((f) => { if (f.categoria === viejo) f.categoria = nuevo; });
      if (catAdd === viejo) catAdd = nuevo;
      pintar();
    }
  };
  list.onclick = (e) => {
    const b = e.target.closest("[data-fe],[data-fec]"); if (!b) return;
    if (b.dataset.fec) {
      const ci = +b.dataset.ci, c = C[ci];
      if (b.dataset.fec === "up" || b.dataset.fec === "down") {
        const cj = ci + (b.dataset.fec === "up" ? -1 : 1); if (cj < 0 || cj >= C.length) return;
        [C[ci], C[cj]] = [C[cj], C[ci]]; return pintar();
      }
      if (C.length < 2) return;
      const destino = c !== FAV_GENERAL && C.includes(FAV_GENERAL) ? FAV_GENERAL : (c !== FAV_GENERAL ? FAV_GENERAL : C.find((x) => x !== c));
      const n = deCat(c).length;
      C.splice(ci, 1);
      if (n) { if (!C.includes(destino)) C.push(destino); L.forEach((f) => { if (f.categoria === c) f.categoria = destino; }); }
      if (n) toast(LG(`${n === 1 ? "Su nodo pasó" : `Sus ${n} nodos pasaron`} a «${destino}».`, `${n === 1 ? "Its node moved" : `Its ${n} nodes moved`} to “${destino}”.`));
      return pintar();
    }
    const i = +b.dataset.i, c = L[i].categoria, idx = deCat(c), k = idx.indexOf(i);
    if (b.dataset.fe === "up" && k > 0) { [L[idx[k - 1]], L[i]] = [L[i], L[idx[k - 1]]]; pintar(); }
    else if (b.dataset.fe === "down" && k < idx.length - 1) { [L[idx[k + 1]], L[i]] = [L[i], L[idx[k + 1]]]; pintar(); }
    else if (b.dataset.fe === "del") { L.splice(i, 1); pintar(); }
  };
  // Arrastrar y soltar (computadora); en el celular quedan ↑ ↓ y el selector de categoría
  let desde = -1;
  const limpiar = () => $$(".over", list).forEach((x) => x.classList.remove("over"));
  list.ondragstart = (e) => {
    const r = e.target.closest && e.target.closest(".fe-row");
    if (!r || e.target.closest("input,select")) { e.preventDefault(); return; }
    desde = +r.dataset.i; r.classList.add("drag"); e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", String(desde)); } catch {}
  };
  list.ondragover = (e) => {
    if (desde < 0) return; e.preventDefault();
    const t = e.target.closest(".fe-row, .fe-cat-h, .fe-vacia"); limpiar(); if (t) t.classList.add("over");
  };
  list.ondrop = (e) => {
    e.preventDefault(); limpiar();
    if (desde < 0) return;
    const r = e.target.closest(".fe-row"), h = e.target.closest(".fe-cat-h, .fe-vacia, .fe-cat");
    if (r) { const j = +r.dataset.i; if (j !== desde) colocar(desde, j, L[j].categoria); }
    else if (h) colocar(desde, -1, C[+h.dataset.ci]);
    desde = -1; pintar();
  };
  list.ondragend = () => { desde = -1; limpiar(); $$(".fe-row", list).forEach((x) => x.classList.remove("drag")); };
  list.onkeydown = (e) => { if (e.key === "Enter" && e.target.closest(".fe-nom, .fe-catnom")) { e.preventDefault(); e.target.blur(); } };

  $("#feNewCat").onclick = () => {
    if (C.length >= FAV_MAX_CATS) return toast(LG(`Máximo ${FAV_MAX_CATS} categorías.`, `${FAV_MAX_CATS} categories at most.`), true);
    let base = LG("Nueva categoría", "New category"), nom = base, k = 2;
    while (C.some((c) => c.toLowerCase() === nom.toLowerCase())) nom = base + " " + k++;
    C.push(nom); catAdd = nom;
    pintar(`.fe-catnom[data-ci="${C.length - 1}"]`);
  };
  $("#feCatAdd").onchange = (e) => { catAdd = e.target.value; };

  const agregar = (nodo, nombre) => {
    nodo = String(nodo).trim();
    if (!numOk.test(nodo)) { toast(asl ? LG("El número de nodo debe tener de 3 a 7 dígitos.", "The node number must have 3 to 7 digits.") : LG("El nodo o reflector debe tener de 4 a 6 dígitos.", "The node or reflector must have 4 to 6 digits."), true); return false; }
    const ya = L.find((f) => f.nodo === nodo);
    if (ya) { toast(LG(`El nodo ${nodo} ya está en «${ya.categoria}».`, `Node ${nodo} is already in “${ya.categoria}”.`), true); return false; }
    if (L.length >= FAV_MAX) { toast(LG(`Máximo ${FAV_MAX} favoritos.`, `${FAV_MAX} favorites at most.`), true); return false; }
    const c = C.includes(catAdd) ? catAdd : C[0];
    const idx = deCat(c);
    L.splice(idx.length ? idx[idx.length - 1] + 1 : L.length, 0, { nodo, nombre: String(nombre || "").slice(0, asl ? 60 : 40), categoria: c });
    pintar(`.fe-nom[data-i="${L.findIndex((f) => f.nodo === nodo)}"]`);
    return true;
  };

  if (asl) {
    $("#feQ").oninput = () => {
      clearTimeout(feT);
      feT = setTimeout(async () => {
        const q = $("#feQ").value.trim(), seq = ++feSeq;
        if (q.length < (/^\d+$/.test(q) ? 3 : 2)) { feRes = []; pintarRes(); return; }
        try { const r = await api("api/sesiones/buscar?q=" + encodeURIComponent(q)); if (seq === feSeq) { feRes = r.resultados || []; pintarRes(); } } catch {}
      }, 300);
    };
    res.onclick = (e) => {
      const b = e.target.closest("[data-feadd]"); if (!b) return;
      const n = b.dataset.feadd, r = feRes.find((x) => x.nodo === n);
      if (agregar(n, r ? nombreDe(r) : "")) $("#feQ").focus();
    };
  } else {
    const add = () => { if (agregar($("#feQ").value, $("#feNom").value.trim())) { $("#feQ").value = ""; $("#feNom").value = ""; $("#feQ").focus(); } };
    $("#feAddIrlp").onclick = add;
    $("#feNom").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } };
  }
  $("#feQ").onkeydown = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (asl) { const b = $("[data-feadd]", res); if (b) b.click(); } else $("#feNom").focus();
  };
  pintar();
  $("#favNo").onclick = closeModal;
  $("#favForm").onsubmit = async (e) => {
    e.preventDefault();
    if (document.activeElement && document.activeElement.classList.contains("fe-catnom")) document.activeElement.blur();
    const lista = L.map((f) => ({ nodo: f.nodo, nombre: f.nombre.trim(), categoria: f.categoria }));
    try {
      const r = await run(() => api(asl ? "api/sesiones/favoritos" : "api/irlp/favoritos", { method: "PUT", json: { favoritos: lista, categorias: C } }), LG("Favoritos guardados", "Favorites saved"));
      if (asl) { S.aslFavs = { [S.ses.nodo]: r.favoritos }; S.aslCats = { [S.ses.nodo]: r.categorias }; }
      else { S.irlp.favoritos = r.favoritos; S.irlp.categorias = r.categorias; }
      closeModal();
      if (S.ses) renderSesiones();
      if (S.bus) renderBuscar();
    } catch {}
  };
}
document.addEventListener("click", (e) => { const b = e.target.closest("[data-favedit]"); if (b) favEditor(b.dataset.favedit); });
async function loadIrlpLog() {
  const pre = $("#irlpLog");
  try { const r = await api("api/irlp/bitacora?n=100"); pre.textContent = r.lineas.slice().reverse().join("\n") || "(vacía)"; }
  catch (e) { pre.textContent = e.message; }
}
$("#irlpLogWrap").addEventListener("toggle", (e) => { if (e.target.open) loadIrlpLog(); });
$("#irlpLogReload").onclick = loadIrlpLog;

/* Favoritos de ASL en el Dashboard: los mismos que ofrece el bot (la primera vez, los de AllScan) */
async function aslFavsLoad(nodo, force) {
  S.aslFavs = S.aslFavs || {}; S.aslCats = S.aslCats || {};
  if (!S.aslFavs[nodo] || force) {
    try {
      const r = await api("api/sesiones/favoritos?nodo=" + encodeURIComponent(nodo));
      S.aslFavs[nodo] = r.favoritos || []; S.aslCats[nodo] = r.categorias || [];
    } catch { S.aslFavs[nodo] = S.aslFavs[nodo] || []; S.aslCats[nodo] = S.aslCats[nodo] || []; }
  }
  return S.aslFavs[nodo];
}
async function renderAslFavs(s) {
  const box = $("#aslFavs");
  const favs = s.sistema === "asl" ? await aslFavsLoad(s.nodo) : [];
  box.classList.toggle("hidden", s.sistema !== "asl" || (!favs.length && !isAdmin()));
  const con = new Set((s.enlaces || []).map((e) => e.nodo));
  setHtml(box, favCards(favs, (n) => con.has(n), "data-aslfav", "Favoritos", "asl", presChip, (S.aslCats || {})[s.nodo] || []));
  presenciaCargar(favs.map((f) => f.nodo).filter((n) => !con.has(n) && n !== s.nodo));
  $("#sesAll").classList.toggle("hidden", !(s.enlaces || []).length);
}
$("#aslFavs").onclick = async (e) => {
  const b = e.target.closest("[data-aslfav]"); if (!b) return;
  const n = b.dataset.aslfav, sel = $("#sesConnect").modo, modo = sel.value;
  const modoTxt = sel.options[sel.selectedIndex].text.toLowerCase();
  const ya = (S.ses.enlaces || []).some((x) => x.nodo === n);
  if (!(await confirmBox(ya ? `El nodo ${n} ya está conectado. ¿Cambiarlo a ${modoTxt}?` : `¿Conectar el nodo ${n} como ${modoTxt}?`, "Conectar", false))) return;
  try {
    await run(() => api("api/sesiones/conectar", { method: "POST", json: { destino: n, modo, nodo: S.ses.nodo } }), "Conectando " + n);
    setTimeout(loadSesiones, 2500);
  } catch {}
};
/* Buscar nodos en el directorio de AllStar (astdb.txt del propio nodo) */
let busTimer = 0, busSeq = 0;
$("#busQ").oninput = () => { clearTimeout(busTimer); busTimer = setTimeout(buscarNodos, 350); };
$("#busForm").onsubmit = (e) => { e.preventDefault(); clearTimeout(busTimer); buscarNodos(); };
async function buscarNodos() {
  const q = $("#busQ").value.trim();
  const seq = ++busSeq;
  if (q.length < (/^\d+$/.test(q) ? 3 : 2)) {
    S.bus = null; $("#busList").innerHTML = "";
    $("#busInfo").textContent = q ? LG("Escribe al menos 2 letras o 3 dígitos.", "Type at least 2 letters or 3 digits.")
      : LG("Busca en el directorio de AllStar: el indicativo o el número de nodo por cómo empiezan; con 3 letras o más también por descripción o lugar.",
           "Searches the AllStar directory: callsign or node number by how they start; with 3 letters or more also by description or location.");
    return;
  }
  $("#busInfo").textContent = LG("Buscando…", "Searching…");
  try {
    const r = await api("api/sesiones/buscar?q=" + encodeURIComponent(q));
    if (seq !== busSeq) return;             // llegó tarde: ya se escribió otra cosa
    S.bus = { q, ...r };
    renderBuscar();
  } catch (e) {
    if (seq === busSeq) $("#busInfo").textContent = LG("No se pudo buscar: ", "Search failed: ") + (e.message || e);
  }
}
function renderBuscar() {
  const b = S.bus; if (!b) return;
  const info = $("#busInfo"), box = $("#busList");
  if (!b.directorio) {
    info.textContent = LG("Este nodo no tiene el directorio de AllStar (astdb.txt); no hay dónde buscar.", "This node has no AllStar directory (astdb.txt); nothing to search.");
    box.innerHTML = ""; return;
  }
  const n = b.resultados.length;
  info.textContent = !n ? LG(`Sin resultados para “${b.q}”.`, `No results for “${b.q}”.`)
    : b.total > n ? LG(`${b.total} nodos; se muestran los primeros ${n}. Escribe más para afinar.`, `${b.total} nodes; showing the first ${n}. Type more to narrow it down.`)
    : LG(`${n} ${n === 1 ? "nodo" : "nodos"}`, `${n} ${n === 1 ? "node" : "nodes"}`);
  const con = new Set(((S.ses && S.ses.enlaces) || []).map((e) => e.nodo));
  const local = S.ses && S.ses.nodo;
  const Q = b.q.toUpperCase();
  const hl = (txt, pref) => {        // resalta lo que coincide
    const t = String(txt || ""), i = pref ? (t.toUpperCase().startsWith(Q) ? 0 : -1) : t.toUpperCase().indexOf(Q);
    return i < 0 || Q.length < 1 ? esc(t) : esc(t.slice(0, i)) + "<mark>" + esc(t.slice(i, i + Q.length)) + "</mark>" + esc(t.slice(i + Q.length));
  };
  const txtHl = Q.length >= 3;
  setHtml(box, !n ? "" : `<div class="bus-rows" translate="no">` + b.resultados.map((r) => {
    const on = con.has(r.nodo), yo = r.nodo === local;
    return `<div class="bus-row ${on ? "on" : ""}">
      <span class="n">${hl(r.nodo, true)}</span>
      <span class="c">${hl(r.indicativo, true)}</span>
      <span class="d">${txtHl ? hl(r.descripcion) : esc(r.descripcion)}${r.ubicacion ? `<small>${txtHl ? hl(r.ubicacion) : esc(r.ubicacion)}</small>` : ""}</span>
      <span class="acc">${yo ? `<span class="st">${LG("Este nodo", "This node")}</span>`
        : `${on ? `<span class="st">● ${LG("Conectado", "Connected")}</span>` : presChip(r.nodo)}<button type="button" class="btn sm" data-buscon="${esc(r.nodo)}">${on ? LG("Cambiar modo", "Change mode") : LG("Conectar", "Connect")}</button>`}${favBtn(r)}</span>
    </div>`;
  }).join("") + `</div>`);
  presenciaCargar(b.resultados.map((r) => r.nodo).filter((n) => n !== local && !con.has(n)));
}

/* ¿En línea? responde (verde) / registrado pero no contesta (amarillo) / fuera (gris).
   El servidor lo averigua (DNS de AllStar + POKE de IAX) y lo guarda unos minutos. */
const PRES_TTL = 120000;
S.pres = S.pres || {}; var presPend = presPend || new Set(), presTimer = presTimer || 0;
function presChip(n) {
  const p = S.pres[n];
  if (!p || !p.estado) return p && p.cargando ? `<span class="pres wait" title="${LG("Revisando si está en línea…", "Checking whether it's online…")}">···</span>` : "";
  if (p.estado === "responde") return `<span class="pres ok" title="${LG(`Registrado en AllStar y responde (${p.ms} ms): se le puede conectar.`, `Registered with AllStar and answering (${p.ms} ms): it can be connected.`)}">● ${LG("En línea", "Online")}</span>`;
  if (p.estado === "registrado") return `<span class="pres warn" title="${LG("Está prendido y registrado en AllStar, pero no contesta conexiones de fuera (casi siempre falta reenviar el puerto UDP " + (p.puerto || 4569) + " en su router). Él sí puede conectarse a ti.", "It's on and registered with AllStar, but doesn't answer incoming connections (usually UDP port " + (p.puerto || 4569) + " isn't forwarded on its router). It can still connect to you.")}">● ${LG("Sin resp.", "No reply")}</span>`;
  return `<span class="pres off" title="${LG("No está registrado en AllStar: apagado o sin internet.", "Not registered with AllStar: off or without internet.")}">○ ${LG("Apagado", "Offline")}</span>`;
}
function presenciaCargar(nodos) {
  const ahora = Date.now();
  nodos.forEach((n) => {
    const p = S.pres[n];
    if (/^\d{4,7}$/.test(n) && (!p || (!p.cargando && ahora - p.t > PRES_TTL))) presPend.add(n);
  });
  if (presPend.size && !presTimer) presTimer = setTimeout(presenciaPedir, 150);
}
async function presenciaPedir() {
  presTimer = 0;
  const lote = [...presPend].slice(0, 200);
  lote.forEach((n) => { presPend.delete(n); S.pres[n] = { ...(S.pres[n] || {}), cargando: true }; });
  if (!lote.length) return;
  presPintar();
  let r = {};
  try { r = (await api("api/sesiones/presencia?nodos=" + lote.join(","))).estados || {}; } catch {}
  const t = Date.now();
  lote.forEach((n) => { S.pres[n] = { ...(r[n] || { estado: "" }), t, cargando: false }; });
  presPintar();
  if (presPend.size) presTimer = setTimeout(presenciaPedir, 50);
}
function presPintar() {
  if (S.bus && !$("#aslBuscar").classList.contains("hidden")) renderBuscar();
  if (S.ses && S.ses.sistema === "asl") renderAslFavs(S.ses);
}
/* ☆ Agregar a favoritos desde el buscador (solo admin: la lista es la misma del bot).
   Pregunta en qué categoría (o crea una nueva ahí mismo). */
function favBtn(r) {
  if (!isAdmin()) return "";
  const favs = ((S.aslFavs || {})[S.ses && S.ses.nodo]) || [];
  const ya = favs.find((f) => f.nodo === r.nodo);
  return ya ? `<button type="button" class="btn sm fav-on" data-busfav="${esc(r.nodo)}" data-quitar="1" title="${LG(`Está en favoritos (${ya.categoria || "Generales"}). Clic para quitarlo.`, `In favorites (${ya.categoria || "Generales"}). Click to remove it.`)}">⭐ ${LG("En favoritos", "In favorites")}</button>`
    : `<button type="button" class="btn sm" data-busfav="${esc(r.nodo)}" title="${LG("Agregarlo a los favoritos del Dashboard y del bot", "Add it to the Dashboard and bot favorites")}">☆ ${LG("Agregar a favoritos", "Add to favorites")}</button>`;
}
function elegirCategoria(n, cats) {
  return new Promise((ok) => {
    openModal(LG(`Agregar ${n} a favoritos`, `Add ${n} to favorites`), `<form id="ecForm" autocomplete="off">
      <p class="muted" style="margin-top:0">${LG("¿En qué categoría?", "Which category?")}</p>
      <div class="ec-cats" translate="no">${cats.map((c, i) => `<button type="button" class="btn ec-cat" data-ec="${i}">📁 ${esc(c)}</button>`).join("")}</div>
      <div class="ec-new"><input id="ecNueva" maxlength="40" placeholder="${LG("O una nueva, p. ej. Nodos XE", "Or a new one, e.g. XE nodes")}">
        <button class="btn primary" id="ecCrear">＋ ${LG("Crear y agregar", "Create and add")}</button></div>
      <div class="modal-actions"><button type="button" class="btn" id="ecNo">${LG("Cancelar", "Cancel")}</button></div></form>`);
    $("#ecNo").onclick = () => { closeModal(); ok(null); };
    $(".ec-cats").onclick = (e) => { const b = e.target.closest("[data-ec]"); if (b) { closeModal(); ok(cats[+b.dataset.ec]); } };
    $("#ecForm").onsubmit = (e) => {
      e.preventDefault();
      const v = $("#ecNueva").value.replace(/\s+/g, " ").trim().slice(0, 40);
      if (!v) return toast(LG("Escribe el nombre de la categoría nueva o elige una de arriba.", "Type the new category's name or pick one above."), true);
      closeModal(); ok(cats.find((c) => c.toLowerCase() === v.toLowerCase()) || v);
    };
    setTimeout(() => { const b = $(".ec-cat"); if (b) b.focus(); }, 40);
  });
}
async function busFavorito(b) {
  const n = b.dataset.busfav, quitar = !!b.dataset.quitar;
  const r = ((S.bus && S.bus.resultados) || []).find((x) => x.nodo === n) || { nodo: n };
  // Se lee la lista del servidor justo antes, por si alguien la cambió en otra pestaña o el bot
  let favs, cats;
  try { const d = await api("api/sesiones/favoritos?nodo=" + encodeURIComponent(S.ses.nodo)); favs = d.favoritos || []; cats = d.categorias || []; }
  catch { return; }
  const guardarLocal = (f, c) => { S.aslFavs = { [S.ses.nodo]: f }; S.aslCats = { [S.ses.nodo]: c }; renderBuscar(); renderAslFavs(S.ses); };
  if (quitar) {
    if (!(await confirmBox(LG(`¿Quitar el nodo ${n} de favoritos?`, `Remove node ${n} from favorites?`), LG("Quitar", "Remove")))) return;
    favs = favs.filter((f) => f.nodo !== n);
  } else {
    if (favs.some((f) => f.nodo === n)) return guardarLocal(favs, cats);
    if (favs.length >= FAV_MAX) { toast(LG(`Ya hay ${FAV_MAX} favoritos, que es el máximo. Quita alguno con ✏️ Editar.`, `There are already ${FAV_MAX} favorites (the maximum). Remove one with ✏️ Edit.`), true); return; }
    const cat = await elegirCategoria(n, cats.length ? cats : [FAV_GENERAL]);
    if (!cat) return;
    if (!cats.includes(cat)) {
      if (cats.length >= FAV_MAX_CATS) { toast(LG(`Máximo ${FAV_MAX_CATS} categorías.`, `${FAV_MAX_CATS} categories at most.`), true); return; }
      cats = cats.concat([cat]);
    }
    const nombre = [r.indicativo, r.descripcion, r.ubicacion].filter(Boolean).join(" · ").slice(0, 60);
    favs = favs.concat([{ nodo: n, nombre, categoria: cat }]);
    b = $(`[data-busfav="${n}"]`) || b;
  }
  busy(b, true, "…");
  try {
    const res = await run(() => api("api/sesiones/favoritos", { method: "PUT", json: { favoritos: favs, categorias: cats } }),
      quitar ? LG(`Nodo ${n} quitado de favoritos`, `Node ${n} removed from favorites`)
        : LG(`Nodo ${n} agregado a «${favs[favs.length - 1].categoria}»`, `Node ${n} added to “${favs[favs.length - 1].categoria}”`));
    guardarLocal(res.favoritos, res.categorias);
  } catch {} finally { busy(b, false); }
}
$("#busList").onclick = async (e) => {
  const fb = e.target.closest("[data-busfav]"); if (fb) return busFavorito(fb);
  const b = e.target.closest("[data-buscon]"); if (!b) return;
  const n = b.dataset.buscon, sel = $("#sesConnect").modo, modo = sel.value;
  const modoTxt = sel.options[sel.selectedIndex].text.toLowerCase();
  const ya = (S.ses.enlaces || []).some((x) => x.nodo === n);
  if (!(await confirmBox(ya ? LG(`El nodo ${n} ya está conectado. ¿Cambiarlo a ${modoTxt}?`, `Node ${n} is already connected. Change it to ${modoTxt}?`)
    : LG(`¿Conectar el nodo ${n} como ${modoTxt}?`, `Connect node ${n} as ${modoTxt}?`), LG("Conectar", "Connect"), false))) return;
  try {
    await run(() => api("api/sesiones/conectar", { method: "POST", json: { destino: n, modo, nodo: S.ses.nodo } }), "Conectando " + n);
    setTimeout(loadSesiones, 2500);
  } catch {}
};
$("#sesAll").onclick = async () => {
  const n = (S.ses.enlaces || []).length;
  if (!(await confirmBox(`¿Desconectar los ${n} enlaces del nodo ${S.ses.nodo}? También se sueltan los permanentes.`, "Desconectar todos"))) return;
  try {
    await run(() => api("api/sesiones/desconectar", { method: "POST", json: { nodo: S.ses.nodo } }), "Desconectando todos");
    setTimeout(loadSesiones, 3000);
  } catch {}
};

/* IRLPvCON: el admin lo apaga o enciende desde Ajustes → Sistema */
async function loadVcon(be) {
  const box = $("#vconBox");
  if (be !== "irlp") { box.classList.add("hidden"); return; }
  let st;
  try { st = await api("api/irlp/vcon"); } catch { box.classList.add("hidden"); return; }
  box.classList.toggle("hidden", !st.instalado);
  if (!st.instalado) return;
  box.innerHTML = `<div class="upd-head"><div><b>IRLPvCON</b> <span class="chip ${st.encendido ? "warn" : "ok"}">${st.encendido ? "Encendido" : "Apagado"}</span>
      <div class="muted" style="font-size:.84rem">La consola web vieja de IRLP (/irlpvcon/). Su contraseña viaja sin cifrar y no tiene límite de intentos; ASLSCAN hace lo mismo con tus usuarios. Al apagarla, Apache deja de servirla; al encenderla vuelve exactamente como estaba.</div></div>
    <button type="button" class="btn sm ${st.encendido ? "danger-soft" : ""}" id="btnVcon" data-on="${st.encendido ? 0 : 1}">${st.encendido ? "Apagar IRLPvCON" : "Encender IRLPvCON"}</button></div>`;
  $("#btnVcon").onclick = async (e) => {
    const encender = e.target.dataset.on === "1";
    if (!encender && !(await confirmBox("¿Apagar IRLPvCON? Nadie podrá abrir /irlpvcon/ hasta que lo vuelvas a encender aquí.", "Apagar"))) return;
    try { await run(() => api("api/irlp/vcon", { method: "POST", json: { encender } }), encender ? "IRLPvCON encendido" : "IRLPvCON apagado"); } catch {}
    loadVcon(be);
  };
}


/* ── Usuarios, roles y sesiones ─────────────────────────────────────────────── */
const ROL_TXT = { admin: "Administrador", operador: "Operador", lectura: "Solo lectura" };
const isAdmin = () => S.me && S.me.rol === "admin";
const initials = (u) => ((u.nombre || u.usuario || "?").trim().split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w))
  .map((w) => w[0]).join("").slice(0, 2) || "?").toUpperCase();
function applyRole() {
  const u = S.me || {};
  document.body.classList.remove("rol-admin", "rol-operador", "rol-lectura");
  if (u.rol) document.body.classList.add("rol-" + u.rol);
  $("#userAvatar").innerHTML = avatarInner(u);
  // Ajustes es del nodo: solo el admin. Lo personal está en «Mi perfil».
  $('#tabs [data-tab="ajustes"]').classList.toggle("hidden", u.rol !== "admin");
  $("#userName").textContent = u.nombre || u.usuario || "";
  $("#userRole").textContent = (u.usuario ? u.usuario + " · " : "") + (ROL_TXT[u.rol] || "");
}
async function logoutNow() {
  liveStop();
  await api("api/logout", { method: "POST" }).catch(() => {});
  S.me = null; showLogin();
}
$("#btnSideLogout").onclick = logoutNow;

function uaShort(ua) {
  ua = ua || "";
  const b = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /curl|python/i.test(ua) ? "Programa" : "Navegador";
  const o = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Windows/.test(ua) ? "Windows"
    : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  return o ? `${b} en ${o}` : b;
}
function ago(ts) {
  const s = Math.max(0, Math.round((Date.now() + (S.skew || 0)) / 1000 - ts));
  if (s < 90) return "ahora";
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}
function sessionRows(list, mine, showUser) {
  if (!list.length) return '<p class="muted">No hay sesiones abiertas.</p>';
  return list.map((s) => `<div class="srow">
      <div class="sico"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg></div>
      <div class="sinfo"><b>${esc(uaShort(s.agente))}</b>${s.id === mine ? ' <span class="chip ok">Esta sesión</span>' : ""}
        <small>${showUser ? `<b>${esc(s.nombre || s.usuario)}</b> (${esc(s.usuario)}) · ` : ""}${esc(s.ip || "IP desconocida")} · activa ${ago(s.ultima)} · entró ${ago(s.creada)}</small></div>
      ${s.id === mine ? "" : `<button type="button" class="btn icon ghost ses-out" data-close-ses="${s.id}" title="Cerrar la sesión en ese equipo" aria-label="Cerrar la sesión en ese equipo"><svg viewBox="0 0 24 24"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4"/></svg></button>`}
    </div>`).join("");
}
$("#meLang").onchange = async (e) => {
  const l = e.target.value;
  try { await api("api/mi-idioma", { method: "PUT", json: { idioma: l } }); window.hamnaSetLang(l); }
  catch (err) { toast(err.message, true); }
};
async function loadMyAccount() {
  const u = S.me || {};
  $("#meLang").value = window.HAMNA_LANG;
  $("#meAvatar").innerHTML = avatarInner(u);
  $("#btnFotoDel").classList.toggle("hidden", !u.foto);
  $("#meName").textContent = u.nombre || u.usuario || "";
  $("#meNombre").value = u.nombre || "";
  $("#meRole").textContent = `${u.usuario || ""} · ${ROL_TXT[u.rol] || ""}`;
  try {
    const r = await api("api/mis-sesiones");
    $("#mySessions").innerHTML = sessionRows(r.sesiones, r.mi_sesion, false);
    loadMiTelegram();
    // «Cerrar las demás» solo vale la pena con 2 o más sesiones en otros equipos
    $("#btnCloseOthers").classList.toggle("hidden", r.sesiones.filter((s) => s.id !== r.mi_sesion).length < 2);
  } catch (e) { $("#mySessions").innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
}
const ROL_AYUDA = {
  admin: "Todo, incluidos usuarios, favoritos, ajustes y respaldos.",
  operador: "Conecta y desconecta nodos (en la página y en el bot de Telegram).",
  lectura: "Solo ve el Dashboard y los nodos, y escucha en vivo; no puede cambiar nada.",
};
async function loadUsers() {
  let r;
  try { r = await api("api/usuarios"); } catch (e) { $("#userList").innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
  S.users = r.usuarios;
  $("#userList").innerHTML = r.usuarios.map((u) => `<div class="urow ${u.activo ? "" : "off"}">
      <div class="avatar">${avatarInner(u)}</div>
      <div class="uinfo"><b>${esc(u.nombre || u.usuario)}</b>${u.id === r.yo ? ' <span class="chip ok">Tú</span>' : ""}
        <small>${esc(u.usuario)} · ${u.ultimo_acceso ? "último acceso " + esc(u.ultimo_acceso.slice(0, 16)) : "nunca ha entrado"}${u.sesiones ? ` · ${u.sesiones} sesión${u.sesiones > 1 ? "es" : ""} abierta${u.sesiones > 1 ? "s" : ""}` : ""}</small>
        ${tgLinea(u)}</div>
      <span class="chip rol-${u.rol}">${esc(u.rol_nombre)}</span>
      ${u.activo ? "" : '<span class="chip warn">Desactivado</span>'}
      <div class="mini"><button type="button" class="btn" data-uedit="${u.id}" title="Editar">✎</button>
        ${u.id === r.yo ? "" : `<button type="button" class="btn" data-udel="${u.id}" title="Borrar">🗑</button>`}</div>
    </div>`).join("");
  $("#allSessions").innerHTML = sessionRows(r.sesiones, r.mi_sesion, true);
  const lk = r.bloqueos || [];
  $("#lockBox").classList.toggle("hidden", !lk.length);
  $("#lockBox").innerHTML = lk.length ? `<div class="tl-warn row gap wrap" style="justify-content:space-between;margin-top:14px">
      <span>🔒 Bloqueados por intentos fallidos: ${lk.map((l) => esc(l.clave.replace("|", " desde ")) + ` (${Math.ceil(l.segundos / 60)} min)`).join(", ")}</span>
      <button type="button" class="btn sm" id="btnUnlock">Desbloquear</button></div>` : "";
}
/* Telegram de cada usuario: con quién está vinculado y cuándo usó el bot por última vez */
const tgUso = (u) => u.tg_ultimo ? `<span>usó el bot ${esc(ago(u.tg_ultimo))}</span>` : `<span>vinculado, sin usar</span>`;
function tgLinea(u) {
  if (!u.tg) return `<small class="muted tg-line"><span>Sin Telegram</span></small>`;
  return `<small class="tg-line" title="${u.tg_desde ? "Vinculado el " + esc(fmtTs(u.tg_desde)) : ""}"><span>📲 ${esc(u.tg_nombre || "Telegram")}</span> · ${tgUso(u)}</small>`;
}
function userForm(u) {
  const isNew = !u;
  u = u || { usuario: "", nombre: "", rol: "operador", activo: 1 };
  openModal(isNew ? "Nuevo usuario" : "Editar usuario", `<form id="ufForm" autocomplete="off">
      <div class="grid2">
        <label>Usuario<input name="usuario" value="${esc(u.usuario)}" ${isNew ? "required" : "disabled"} pattern="[A-Za-z0-9._\\-]{2,32}" autocapitalize="off" spellcheck="false">
          <small>Para entrar. Letras, números, punto o guion.</small></label>
        <label>Nombre<input name="nombre" value="${esc(u.nombre || "")}" placeholder="Pedro · XE2ABC"></label>
      </div>
      <label>Rol<select name="rol">${Object.entries(ROL_TXT).map(([k, v]) => `<option value="${k}" ${u.rol === k ? "selected" : ""}>${v}</option>`).join("")}</select>
        <small id="ufRolHelp"></small></label>
      <label>${isNew ? "Contraseña" : "Contraseña nueva"}<input name="password" type="password" autocomplete="new-password" minlength="8" ${isNew ? "required" : ""} placeholder="${isNew ? "" : "Déjala vacía para no cambiarla"}">
        <small>Al menos 8 caracteres.${isNew ? "" : " Si la cambias, se cierran sus sesiones."}</small></label>
      ${isNew ? "" : `<label class="check"><input type="checkbox" name="activo" ${u.activo ? "checked" : ""}> Activo (si lo desactivas, sale de inmediato y no puede entrar)</label>`}
      ${!isNew && u.tg ? `<div class="row gap wrap tg-box" style="justify-content:space-between;align-items:center;margin:10px 0">
          <span><b>📲 Telegram:</b> <span>${esc(u.tg_nombre || "vinculado")}</span> · ${tgUso(u)}${u.tg_desde ? ` · <span>vinculado el ${esc(fmtTs(u.tg_desde))}</span>` : ""}</span>
          <button type="button" class="btn sm" id="ufTgOff">Desvincular Telegram</button></div>` : ""}
      <div class="modal-actions"><button type="button" class="btn" onclick="closeModal()">Cancelar</button>
        <button class="btn primary">${isNew ? "Crear usuario" : "Guardar"}</button></div>
    </form>`);
  const uf = $("#ufForm");
  const rolUi = () => {
    $("#ufRolHelp").textContent = ROL_AYUDA[uf.rol.value] || "";
  };
  uf.rol.onchange = rolUi; rolUi();
  const tgOff = $("#ufTgOff");
  if (tgOff) tgOff.onclick = async () => {
    if (!(await confirmBox(`¿Desvincular el Telegram de «${u.usuario}»? El bot deja de reconocerlo hasta que lo vuelva a vincular desde Mi perfil.`, "Desvincular"))) return;
    try { await run(() => api("api/usuarios/" + u.id, { method: "PUT", json: { desvincular_tg: true } }), "Telegram desvinculado"); closeModal(); loadUsers(); } catch {}
  };
  $("#ufForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, body = { nombre: f.nombre.value, rol: f.rol.value };
    if (f.password.value) body.password = f.password.value;
    try {
      if (isNew) { body.usuario = f.usuario.value.trim(); await api("api/usuarios", { method: "POST", json: body }); }
      else { body.activo = f.activo.checked; await api("api/usuarios/" + u.id, { method: "PUT", json: body }); }
      closeModal(); toast(isNew ? "Usuario creado" : "Usuario guardado"); loadUsers();
    } catch (err) { toast(err.message, true); }
  };
}
$("#btnUserNew").onclick = () => userForm(null);
$("#userList").onclick = async (e) => {
  const ed = e.target.closest("[data-uedit]"), del = e.target.closest("[data-udel]");
  if (ed) return userForm(S.users.find((u) => u.id === +ed.dataset.uedit));
  if (del) {
    const u = S.users.find((x) => x.id === +del.dataset.udel);
    if (!(await confirmBox(`¿Borrar el usuario «${u.usuario}»? Se cierran sus sesiones. Si solo quieres quitarle el acceso por un tiempo, mejor desactívalo.`, "Borrar"))) return;
    try { await run(() => api("api/usuarios/" + u.id, { method: "DELETE" }), "Usuario borrado"); loadUsers(); } catch {}
  }
};
$("#lockBox").onclick = async (e) => {
  if (!e.target.closest("#btnUnlock")) return;
  try { await run(() => api("api/usuarios/desbloquear", { method: "POST" }), "Desbloqueado"); loadUsers(); } catch {}
};
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-close-ses]"); if (!b) return;
  try {
    await run(() => api("api/mis-sesiones/" + b.dataset.closeSes, { method: "DELETE" }), "Sesión cerrada");
    if (!$("#perfil").classList.contains("hidden")) loadMyAccount();
    if (S.tab === "ajustes" && S.setSec === "usuarios") loadUsers();
  } catch {}
});
$("#btnCloseOthers").onclick = async () => {
  if (!(await confirmBox("¿Cerrar todas tus sesiones en otros equipos?", "Cerrar las demás"))) return;
  try { await run(() => api("api/mis-sesiones/otras", { method: "POST" }), "Listo: solo queda esta sesión"); loadMyAccount(); } catch {}
};


const fmtTs = (ts) => {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/* ── Telegram ────────────────────────────────────────────────────────────── */
$("#btnTgChats").onclick = async () => {
  const f = $("#setForm"), b = $("#btnTgChats"); busy(b, true, "Buscando…");
  try {
    const r = await api("api/avisos/chats", { method: "POST", json: { token: f.tg_token.value.trim() } });
    const box = $("#tgChats");
    $("#tgChatsMsg").textContent = r.chats.length ? `Bot ${r.bot}: elige el chat` : `Bot ${r.bot}: todavía no hay mensajes. Escríbele algo al bot y vuelve a buscar.`;
    box.classList.toggle("hidden", !r.chats.length);
    box.innerHTML = r.chats.map((c) => `<div class="srow"><div class="sinfo"><b>${esc(c.nombre)}</b><small>${esc(c.tipo)} · ${esc(c.id)}</small></div>
      <button type="button" class="btn sm" data-chat="${esc(c.id)}">Usar este</button></div>`).join("");
  } catch (e) { $("#tgChatsMsg").textContent = "❌ " + e.message; }
  finally { busy(b, false); }
};
$("#tgChats").onclick = (e) => {
  const b = e.target.closest("[data-chat]"); if (!b) return;
  $("#setForm").tg_chat.value = b.dataset.chat; $("#tgChats").classList.add("hidden");
  $("#tgChatsMsg").textContent = "Listo. Guarda los ajustes.";
};
$("#btnTgTest").onclick = async () => {
  const f = $("#setForm"), b = $("#btnTgTest"); busy(b, true, "Enviando…");
  $("#tgTestMsg").textContent = "";
  try {
    await api("api/avisos/probar", { method: "POST", json: {
      token: f.tg_token.value.trim(), chat: f.tg_chat.value.trim() } });
    $("#tgTestMsg").textContent = "✅ Enviado: revisa Telegram";
  } catch (e) { $("#tgTestMsg").textContent = "❌ " + e.message; }
  finally { busy(b, false); }
};

/* ── Arranque ────────────────────────────────────────────────────────────── */
(async () => {
  try {
    const me = await (await fetch("api/me", { credentials: "same-origin" })).json();
    if (me.station) {
      document.title = "ASLSCAN · " + me.station;
      $("#loginStation").textContent = me.station; $("#loginStation").classList.remove("hidden");
    }
    applyLogo(me.logo);
    if (me.version) $("#loginVer").textContent = "ASLSCAN v" + me.version;
    me.auth ? start() : showLogin();
  } catch { showLogin(); }
})();
