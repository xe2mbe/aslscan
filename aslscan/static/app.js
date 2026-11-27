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
  // Esta zona es translate="no" (números): sus títulos se ponen aquí
  $$("#sideMon [data-t]").forEach((el) => { el.title = el.dataset.t === "rx" ? L("Bajada", "Download") : L("Subida", "Upload"); });
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
const TABS = ["conexiones", "prog", "nodos", "ajustes"];
const TAB_ALIAS = { dashboard: "conexiones", sesiones: "conexiones" };   // nombres anteriores o nuevos de la misma vista
window.addEventListener("hashchange", () => { const t = TAB_ALIAS[location.hash.slice(1)] || location.hash.slice(1); if (TABS.includes(t) && t !== S.tab) showTab(t); });
function showTab(t) {
  t = TAB_ALIAS[t] || t;
  if (!TABS.includes(t)) t = "conexiones";
  if (t === "ajustes" && S.me && S.me.rol !== "admin") t = "conexiones";
  if (S.tab === "conexiones" && t !== "conexiones") stopSesiones();
  if (t !== "nodos") clearTimeout(S.nodosT);
  if (t !== "prog") clearTimeout(S.anT);
  S.tab = t;
  try { localStorage.setItem("aslscan.tab", t); } catch {}
  if (location.hash.slice(1) !== t) history.replaceState(null, "", "#" + t);
  $$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === t));
  $$(".view").forEach((v) => v.classList.toggle("hidden", v.id !== "view-" + t));
  ({ conexiones: loadSesiones, prog: loadProg, nodos: loadNodos, ajustes: loadAjustes })[t]();
  window.scrollTo(0, 0);
}

const sysChips = (list) => (list || []).map(([k, t]) => `<span class="sys-chip ${esc(k)}" translate="no" title="${window.HAMNA_LANG === "es" ? "Tipo de nodo detectado" : "Detected node type"}">${esc(t)}</span>`).join("");
function updateNodeLabel() {
  const c = S.cfg || {};
  $("#topStation").textContent = c.station_name || (c.node ? "Nodo " + c.node : "ASLSCAN");
  $("#nodeLabel").innerHTML = (c.station_name ? `<b>${esc(c.station_name)}</b>` : "") +
    `<span class="node-line">${c.node ? `<span class="sys-chip num" translate="no" title="${LG("Número de nodo", "Node number")}">#${esc(c.node)}</span>` : ""}<span id="sysChips" class="node-line"></span></span>`;
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
        <div class="muted" style="font-size:.84rem">${lv.recibiendo ? LG("Recibiendo audio del nodo", "Receiving audio from the node") : LG("Sin audio del nodo en los últimos segundos", "No audio from the node in the last few seconds")} · ${n} ${LG(n === 1 ? "persona escuchando" : "personas escuchando", n === 1 ? "person listening" : "people listening")}</div>
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
  $("#saveBar").classList.toggle("hidden", ["sistema", "usuarios", "tonos", "dtmf"].includes(k) || (k === "respaldo" && S.bkSub === "manual"));
  if (k === "sistema") loadSistema();
  if (k === "respaldo") loadRespaldo();
  if (k === "usuarios") loadUsers();
  if (k === "telegram") loadBotSt();
  if (k === "tonos") loadTonos();
  if (k === "voz") { loadVoz(); loadPron(); }
  if (k === "clima") loadClima();
  if (k === "alertas") loadAlertasSet();
  if (k === "dtmf") loadDtmf();
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
  const esAsl = (S.cfg.backend && S.cfg.backend !== "auto" ? S.cfg.backend : info.detectado) === "asl";
  $("#setNavTonos").classList.toggle("hidden", !esAsl);
  $("#setNavDtmf").classList.toggle("hidden", !esAsl);
  if (!esAsl && S.setSec === "dtmf") S.setSec = "nodo";
  if (!esAsl && S.setSec === "tonos") S.setSec = "nodo";
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
    loadHist();
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
    const asl = s.sistema === "asl";
    // Encabezados (escritorio); en celular cada fila es una tarjeta y el grupo lleva su etiqueta
    const cab = `<div class="lnk-h" aria-hidden="true"><span></span><span>${LG("Nodo", "Node")}</span>
      ${asl ? `<span title="${LG("La categoría de tus favoritos en la que está el nodo", "The category of your favorites the node is in")}">${LG("Grupo de favoritos", "Favorites group")}</span>` : ""}
      <span class="r">${LG("Modo · dirección", "Mode · direction")}</span><span class="r">${LG("Conectado · IP", "Connected · IP")}</span></div>`;
    $("#sesList").innerHTML = cab + s.enlaces.map((e) => {
      const desc = [e.descripcion, e.ubicacion].filter(Boolean).join(" · ");
      const dir = e.direccion === "IN" ? "↘ Entrante" : e.direccion === "OUT" ? "↗ Saliente" : "";
      const disc = s.sistema === "asl" ? `<button class="btn sm danger-soft" data-disc="${esc(e.nodo)}" title="Desconectar">Desconectar</button>` : "";
      return `<div class="lnk ${e.modo === "monitor" ? "monitor" : ""} ${e.transmitiendo ? "keyed" : ""}">
        <div class="av">${ICON_NODE}</div>
        <div class="who"><b>${esc(e.indicativo || "Nodo " + e.nodo)}</b><span class="num">${esc(e.nodo)}</span>
          <small>${esc(desc || e.ip || "")}</small></div>
        ${s.sistema === "asl" ? `<div class="grp" data-grp="${esc(e.nodo)}" data-lbl="${LG("Grupo", "Group")}"></div>` : ""}
        <div class="tags">
          ${e.transmitiendo ? '<span class="chip ok talk">Hablando</span>' : ""}
          ${e.modo ? `<span class="chip ${e.modo === "monitor" ? "warn" : ""}">${esc(e.modo[0].toUpperCase() + e.modo.slice(1))}</span>` : ""}
          ${dir ? `<span class="chip">${dir}</span>` : ""}
          ${e.estado && e.estado !== "ESTABLISHED" ? `<span class="chip warn">${esc(e.estado)}</span>` : ""}
        </div>
        <div class="row gap"><div class="time">${e.segundos != null ? `<span data-secs="${e.segundos}">${fmtUp(e.segundos)}</span>` : ""}<small>${esc(e.ip || "")}</small></div>${disc}</div>
      </div>`;
    }).join("");
    marcarGrupos(s);
  }
  const red = s.red || [];
  $("#sesRedWrap").classList.toggle("hidden", !red.length);
  if (s.sistema === "irlp") {
    // status.irlp.net: quién más está en el mismo reflector (se ve abierto)
    if (red.length && !S.sesRedOpened) { $("#sesRedWrap").open = true; S.sesRedOpened = true; }
    $("#sesRedTitle").textContent = LG(`En ${s.activo} · ${red.length} ${red.length === 1 ? "nodo más" : "nodos más"}`,
      `On ${s.activo} · ${red.length} more node${red.length === 1 ? "" : "s"}`);
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
/* ── Historial de conexiones: línea de tiempo (historial.py lo registra en el nodo) ──
   Cada conexión da hasta dos eventos: cuando se conectó y cuando se desconectó. */
const HIST_EVERY = 15000;
async function loadHist(force) {
  if (!force && S.histAt && Date.now() - S.histAt < HIST_EVERY) return;
  S.histAt = Date.now();
  try {
    const q = new URLSearchParams({ dias: $("#histDias").value });
    if (S.ses && S.ses.sistema === "asl" && S.ses.nodo) q.set("nodo", S.ses.nodo);
    S.hist = await api("api/sesiones/historial?" + q);
    renderHist();
  } catch (e) {
    $("#histList").innerHTML = `<p class="empty">${esc(e.message)}</p>`;
  }
}
function renderHist() {
  const d = S.hist; if (!d) return;
  const filtro = $("#histFiltro").value;
  const ev = [];
  for (const c of d.conexiones) {
    if (filtro === "fallida" && c.estado !== "fallida") continue;
    if ((filtro === "IN" || filtro === "OUT") && c.direccion !== filtro) continue;
    if (c.estado === "fallida") ev.push({ t: c.hora_inicio, k: "bad", c });
    else {
      ev.push({ t: c.hora_inicio, k: "on", c });
      if (c.estado === "cerrada" && c.hora_fin) ev.push({ t: c.hora_fin, k: "off", c });
    }
  }
  ev.sort((a, b) => (a.t < b.t ? 1 : a.t > b.t ? -1 : a.k === "off" ? -1 : 1));
  if (!ev.length) {
    $("#histList").innerHTML = `<p class="empty">${d.conexiones.length && filtro ? LG("Nada con este filtro.", "Nothing matches this filter.")
      : LG("Aún no hay conexiones registradas en este periodo. Se anotan desde que se instaló esta versión.", "No connections recorded in this period yet. They are logged since this version was installed.")}</p>`;
    return;
  }
  const hoy = d.ahora.slice(0, 10);
  const ayer = new Date(Date.parse(hoy + "T12:00:00") - 86400000).toISOString().slice(0, 10);
  const dia = (f) => {
    if (f === hoy) return LG("Hoy", "Today");
    if (f === ayer) return LG("Ayer", "Yesterday");
    const x = new Date(f + "T12:00:00");
    return isNaN(x) ? f : `${LG(DIAS[x.getDay()], DIAS_EN[x.getDay()])} ${pad2(x.getDate())}/${pad2(x.getMonth() + 1)}`;
  };
  const dirTxt = (x) => (x === "IN" ? LG("↘ Entrante", "↘ Incoming") : x === "OUT" ? LG("↗ Saliente", "↗ Outgoing") : "");
  const modoTxt = (m) => (m ? LG(m[0].toUpperCase() + m.slice(1), { transceptor: "Transceiver", monitor: "Monitor", "monitor local": "Local monitor" }[m] || m) : "");
  let html = "", ultDia = "";
  for (const e of ev) {
    const c = e.c, f = e.t.slice(0, 10);
    if (f !== ultDia) { ultDia = f; html += `<div class="hday">${esc(dia(f))}</div>`; }
    const quien = `<b>${esc(c.remoto)}</b>${c.indicativo ? ` <span class="hcall">${esc(c.indicativo)}</span>` : ""}`;
    const lugar = [c.descripcion, c.ubicacion].filter(Boolean).join(" · ");
    let tit, meta = [], extra = "";
    if (e.k === "bad") {
      tit = LG("No se pudo conectar", "Connection failed");
      meta = [dirTxt(c.direccion), c.ip && "IP " + c.ip,
        c.nota === "no respondió" ? LG("el nodo no respondió", "the node did not answer") : LG("no terminó de conectar", "did not finish connecting"),
        c.origen && LG("pedido desde ", "requested from ") + c.origen];
    } else if (e.k === "on") {
      tit = LG("Conectado", "Connected");
      meta = [dirTxt(c.direccion), modoTxt(c.modo), c.ip && "IP " + c.ip, c.origen && LG("desde ", "from ") + c.origen];
      if (c.estado === "activa") extra = `<span class="chip ok">${LG("Sigue conectado", "Still connected")} · <span data-hsecs="${c.duracion}">${fmtUp(c.duracion)}</span></span>`;
      else extra = `<span class="chip">${LG("Duró", "Lasted")} ${fmtUp(c.duracion)}</span>`;
    } else {
      tit = LG("Desconectado", "Disconnected");
      meta = [`${LG("estuvo conectado", "was connected for")} ${fmtUp(c.duracion)} (${c.hora_inicio.slice(11, 16)} → ${c.hora_fin.slice(11, 16)})`,
        c.cerro && LG("pedido desde ", "requested from ") + c.cerro,
        c.nota === "reconectó" && LG("se cayó y volvió a conectar", "dropped and reconnected"),
        c.aprox && LG("hora aproximada: ASLSCAN estaba detenido", "approximate time: ASLSCAN was stopped")];
    }
    html += `<div class="hev ${e.k}">
      <time>${esc(e.t.slice(11, 19))}</time><span class="hdot"></span>
      <div class="hbody"><div class="htit">${tit} · ${quien}${lugar ? ` <small>${esc(lugar)}</small>` : ""}</div>
        <div class="hmeta">${meta.filter(Boolean).map(esc).join(" · ")}</div></div>
      <div class="hext">${extra}</div></div>`;
  }
  $("#histList").innerHTML = html;
  S.histShown = Date.now();
}
setInterval(() => {
  if (!S.hist || document.hidden || S.tab !== "conexiones") return;
  const add = Math.floor((Date.now() - S.histShown) / 1000);
  $$("#histList [data-hsecs]").forEach((el) => (el.textContent = fmtUp(+el.dataset.hsecs + add)));
}, 1000);
$("#histDias").onchange = () => loadHist(true);
$("#histFiltro").onchange = () => renderHist();
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
const FAV_TODOS = "__todos__";
const FAV_COLORES = 6;                  // --g0 … --g5 en app.css
const catNom = (c) => (c === "Generales" ? LG("Generales", "General") : c);
/* [[categoría, favoritos]] en orden, sin categorías vacías; los sin categoría van en «Generales» */
function favGrupos(favs, cats) {
  const grupos = (cats || []).map((c) => [c, favs.filter((f) => f.categoria === c)]).filter(([, fs]) => fs.length);
  const sueltos = favs.filter((f) => !(cats || []).includes(f.categoria));
  if (sueltos.length) grupos.push(["Generales", sueltos]);
  return grupos;
}
/* Columna «Grupo» de los enlaces directos: la categoría de favoritos de cada nodo conectado */
function marcarGrupos(s) {
  if (!s || s.sistema !== "asl") return;
  const favs = (S.aslFavs || {})[s.nodo];
  if (!favs) return;
  const grupos = favGrupos(favs, (S.aslCats || {})[s.nodo] || []), de = {};
  grupos.forEach(([c, fs], i) => fs.forEach((f) => { de[f.nodo] = [c, i]; }));
  $$("#sesList [data-grp]").forEach((el) => {
    const g = de[el.dataset.grp];
    const html = !g ? `<span class="grp-none" title="${LG("No está en tus favoritos", "Not in your favorites")}">—</span>`
      : grupos.length < 2 ? `<span class="grp-chip" title="${LG("Está en tus favoritos", "It's in your favorites")}">⭐ ${LG("Favorito", "Favorite")}</span>`
      : `<span class="grp-chip" style="--gc:var(--g${g[1] % FAV_COLORES})" title="${LG("Grupo de favoritos", "Favorites group")}" translate="no"><i class="gdot"></i>${esc(catNom(g[0]))}</span>`;
    if (el.innerHTML !== html) el.innerHTML = html;
  });
}        // valor de la pestaña «Todos» (no choca con un nombre real)
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
  const grupos = favGrupos(favs, cats);
  if (grupos.length < 2) return head + `<div class="fav-grid">${favs.map(tarjeta).join("")}</div>`;
  const tab = favTab(editar, grupos.map(([c]) => c));
  // Cada categoría con su color (por su lugar en la lista: no cambia al elegir otra pestaña)
  const color = (c) => "--gc:var(--g" + (grupos.findIndex(([x]) => x === c) % FAV_COLORES) + ")";
  const tabs = `<div class="fav-tabs" role="tablist" translate="no">` +
    [[FAV_TODOS, LG("Todos", "All"), favs.length]].concat(grupos.map(([c, fs]) => [c, catNom(c), fs.length])).map(([k, txt, n]) =>
      `<button type="button" role="tab" class="fav-tab ${k === tab ? "active" : ""}" aria-selected="${k === tab}" data-favtab="${editar}" data-cat="${esc(k)}"${k === FAV_TODOS ? "" : ` style="${color(k)}"`}>${k === FAV_TODOS ? "" : '<i class="gdot"></i>'}${esc(txt)}<span class="cnt">${n}</span></button>`).join("") + `</div>`;
  const conectados = (fs) => fs.filter((f) => conectado(f.nodo)).length;
  const grupo = ([c, fs]) => `<section class="fav-cat" style="${color(c)}"><div class="fav-cat-h" translate="no"><i class="gdot"></i><b>${esc(catNom(c))}</b>
      <span class="cnt">${fs.length}</span>${conectados(fs) ? `<span class="fav-cat-on">● ${conectados(fs)} ${LG("conectado" + (conectados(fs) > 1 ? "s" : ""), "connected")}</span>` : ""}</div>
      <div class="fav-grid">${fs.map(tarjeta).join("")}</div></section>`;
  const cuerpo = tab === FAV_TODOS ? grupos.map(grupo).join("") : grupo(grupos.find(([c]) => c === tab));
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
      if (irlpEn(s.activo, n)) return toast(LG("Ya está conectado a ", "Already connected to ") + n);
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
  marcarGrupos(s);
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


/* ── Tonos de cortesía (rpt.conf) ────────────────────────────────────────── */
const USOS_CT = [["unlinkedct", "Sin enlaces", "Al soltar el PTT en el radio cuando el nodo no está conectado a ningún otro"],
  ["linkunkeyct", "Al soltar alguien que llega por un enlace", "Cuando termina de hablar alguien desde otro nodo"],
  ["remotect", "Con una base remota enlazada", "Casi nunca se usa"]];
const CT_EN = { "Sin enlaces": "Not linked", "Al soltar alguien que llega por un enlace": "When someone on a link unkeys",
  "Con una base remota enlazada": "With a remote base linked", "Enlazado en transceptor": "Linked in transceive",
  "Enlazado solo en monitor": "Linked in monitor only",
  "Al soltar el PTT en el radio cuando el nodo no está conectado a ningún otro": "When the radio unkeys and the node isn't connected to any other",
  "Cuando termina de hablar alguien desde otro nodo": "When someone on another node stops talking", "Casi nunca se usa": "Rarely used",
  "Al soltar el PTT en el radio mientras hay enlaces en transceptor (casi siempre: es el que más se oye)": "When the radio unkeys while there are transceive links (almost always: it's the one heard most)",
  "Al soltar el PTT en el radio cuando todos los enlaces son solo de monitor": "When the radio unkeys and every link is monitor only" };
const ENLACE_CT = { remotetx: ["Enlazado en transceptor", "Al soltar el PTT en el radio mientras hay enlaces en transceptor (casi siempre: es el que más se oye)"],
  remotemon: ["Enlazado solo en monitor", "Al soltar el PTT en el radio cuando todos los enlaces son solo de monitor"] };
const ctLG = (t) => LG(t, CT_EN[t] || t);
const ctNum = (n) => +String(n).replace(/\D/g, "") || 0;
const ctResumen = (segs) => segs ? segs.filter((x) => x[0] || x[1]).map((x) => x[1] ? `${x[0]}+${x[1]} Hz` : `${x[0]} Hz`).join(" · ") +
  ` · ${segs.reduce((a, x) => a + x[2], 0)} ms` : LG("archivo de sonido", "sound file");
let tonoCtx = null;
function tonoTocar(segs) {
  if (!segs || !segs.length) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!tonoCtx) tonoCtx = new Ctx();
  const ctx = tonoCtx;
  if (ctx.state === "suspended") ctx.resume();
  let t = ctx.currentTime + 0.05;
  for (const [f1, f2, ms, amp] of segs) {
    const dur = ms / 1000, vol = Math.min(0.9, amp / 8192) * ((f1 && f2) ? 0.5 : 1);
    for (const f of [f1, f2]) {
      if (!f || !vol) continue;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f; o.type = "sine";
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.004);
      g.gain.setValueAtTime(vol, t + Math.max(0.005, dur - 0.004)); g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + dur + 0.01);
    }
    t += dur;
  }
}
async function loadTonos() {
  const box = $("#tonosBox");
  let st;
  try { st = await api("api/tonos"); } catch (e) { box.innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
  S.tonosSt = st;
  S.tonosEd = { tonos: {}, uso: {}, borrar: [] };
  for (const t of st.tonos || []) S.tonosEd.tonos[t.nombre] = t.segmentos ? t.segmentos.map((x) => x.slice()) : null;
  for (const [k] of USOS_CT) S.tonosEd.uso[k] = ((st.uso || {})[k] || {}).valor || "";
  S.tonosEd.tiempos = {};
  for (const [k, v] of Object.entries(st.tiempos || {})) S.tonosEd.tiempos[k] = v.valor;
  S.tonosSucio = new Set();
  renderTonos();
  if (st.aplicando && st.aplicando.estado === "aplicando") setTimeout(() => { if (S.setSec === "tonos") loadTonos(); }, 3000);
}
function renderTonos() {
  const box = $("#tonosBox"), st = S.tonosSt, ed = S.tonosEd;
  if (!st.disponible) { box.innerHTML = `<p class="muted">${esc(st.motivo || "")}</p>`; return; }
  const nombres = Object.keys(ed.tonos).filter((n) => !ed.borrar.includes(n) && !ENLACE_CT[n]).sort((a, b) => ctNum(a) - ctNum(b));
  const enlaceN = Object.keys(ENLACE_CT).filter((n) => ed.tonos[n] !== undefined);
  const ap = st.aplicando || {};
  const sucio = S.tonosSucio.size || USOS_CT.some(([k]) => ed.uso[k] !== (((st.uso || {})[k] || {}).valor || "")) || ed.borrar.length
    || Object.keys(ed.tiempos || {}).some((k) => ed.tiempos[k] !== st.tiempos[k].valor);
  const TIEMPO_TXT = {
    unkeywait: [LG("Pausa antes del tono", "Pause before the tone"), LG("Desde que sueltas el PTT hasta que el nodo transmite el tono. Si tu radio no alcanza a pasar a recibir, súbela (HamVOIP traía 800 ms).", "From when you release the PTT until the node transmits the tone. If your radio can't switch back to receive in time, raise it (HamVOIP used 800 ms).")],
    hangtime: [LG("Cola después del tono", "Hang time after the tone"), LG("Cuánto se queda transmitiendo el nodo después del tono.", "How long the node keeps transmitting after the tone.")] };
  const tiempos = Object.keys(st.tiempos || {}).filter((k) => TIEMPO_TXT[k]);
  let aviso = "";
  if (ap.estado === "aplicando") aviso = `<div class="upd-box new"><b>⏳ ${esc(ap.mensaje)}</b><div class="muted" style="font-size:.84rem">${LG("Los enlaces se cortan unos segundos y se reconectan solos.", "Links drop for a few seconds and reconnect by themselves.")}</div></div>`;
  else if (st.pendiente) aviso = `<div class="upd-box new"><div class="upd-head"><div><b>⚠ ${LG("Hay cambios guardados en rpt.conf que todavía no se aplican", "There are saved changes in rpt.conf not applied yet")}</b>
      <div class="muted" style="font-size:.84rem">${LG("Asterisk los lee al reiniciarse. Los enlaces se cortan unos segundos y se reconectan solos.", "Asterisk reads them when it restarts. Links drop for a few seconds and reconnect by themselves.")}</div></div>
      ${st.puede_aplicar ? `<button type="button" class="btn sm primary" id="btnTonosAplicar">${LG("Aplicar ahora (reinicia Asterisk)", "Apply now (restarts Asterisk)")}</button>` : `<span class="muted">${LG("Reinicia Asterisk desde la terminal: sudo systemctl restart asterisk", "Restart Asterisk from the terminal: sudo systemctl restart asterisk")}</span>`}</div></div>`;
  else if (ap.estado === "ok" || ap.estado === "error") aviso = `<div class="upd-box${ap.estado === "error" ? " new" : ""}"><b>${ap.estado === "ok" ? "✅" : "❌"} ${esc(ap.mensaje)}</b></div>`;
  const opts = (sel) => `<option value="">${LG("— ninguno —", "— none —")}</option>` + nombres.map((n) =>
    `<option value="${esc(n)}" ${n === sel ? "selected" : ""}>${esc(n)} · ${esc(ctResumen(ed.tonos[n]))}</option>`).join("");
  const usado = (n) => USOS_CT.filter(([k]) => ed.uso[k] === n).map(([, l]) => ctLG(l));
  const propio = (n) => { const t = (st.tonos || []).find((x) => x.nombre === n); return !t || t.propio; };
  const tarjeta = (n) => {
    const segs = ed.tonos[n], u = usado(n), en = ENLACE_CT[n];
    return `<div class="ct-card${S.tonosSucio.has(n) ? " sucio" : ""}${en ? " ct-enl" : ""}" data-ct="${esc(n)}" translate="no">
        <div class="ct-head">${en ? `<div><b>${esc(ctLG(en[0]))}</b> <code>${esc(n)}</code><small class="muted ct-desc">${esc(ctLG(en[1]))}</small></div>` : `<b>${esc(n)}</b>`}${u.length ? `<span class="chip ok">${esc(u.join(" · "))}</span>` : ""}${propio(n) || en ? "" : `<span class="chip" title="${LG("Viene de la plantilla de ASL; al cambiarlo se guarda en tu sección", "Comes from the ASL template; changing it saves it in your section")}">${LG("plantilla", "template")}</span>`}
          <span class="ct-acc"><button type="button" class="btn sm" data-ctplay="${esc(n)}" ${segs ? "" : "disabled"}>▶ ${LG("Escuchar", "Listen")}</button>
          ${!en && propio(n) && !u.length && (st.tonos || []).some((x) => x.nombre === n) ? `<button type="button" class="btn sm ghost" data-ctdel="${esc(n)}" title="${LG("Borrar", "Delete")}">🗑</button>` : ""}
          ${!(st.tonos || []).some((x) => x.nombre === n) ? `<button type="button" class="btn sm ghost" data-ctdel="${esc(n)}" title="${LG("Quitar", "Remove")}">✕</button>` : ""}</span></div>
        ${en ? `<div class="ct-copia"><span class="muted">${LG("Copiar de", "Copy from")}</span><select data-ctcopia="${esc(n)}"><option value="">—</option>${nombres.filter((x) => ed.tonos[x]).map((x) => `<option value="${esc(x)}">${esc(x)} · ${esc(ctResumen(ed.tonos[x]))}</option>`).join("")}</select></div>` : ""}
        ${segs ? `<div class="ct-segs"><div class="ct-seg ct-segh"><span>${LG("Tono 1 (Hz)", "Tone 1 (Hz)")}</span><span>${LG("Tono 2 (Hz)", "Tone 2 (Hz)")}</span><span>ms</span><span>${LG("Volumen", "Volume")}</span><span></span></div>
          ${segs.map((x, i) => `<div class="ct-seg">${x.map((v, j) => `<input type="number" inputmode="numeric" data-ctv="${i}:${j}" value="${v}" min="0" max="${[4000, 4000, 5000, 16384][j]}" step="${j === 3 ? 256 : j === 2 ? 10 : 1}">`).join("")}
            <button type="button" class="btn sm ghost" data-ctsegdel="${i}" ${segs.length < 2 ? "disabled" : ""} title="${LG("Quitar pitido", "Remove beep")}">✕</button></div>`).join("")}
          <div class="row gap wrap"><button type="button" class="btn sm" data-ctsegadd="tono">＋ ${LG("Pitido", "Beep")}</button><button type="button" class="btn sm" data-ctsegadd="pausa">＋ ${LG("Pausa", "Pause")}</button>
            ${segs[0] && !segs[0][0] && !segs[0][1] ? "" : `<button type="button" class="btn sm" data-ctsegadd="inicio" title="${LG("Si el tono no se oye porque el transmisor o los radios tardan en abrir", "If the tone isn't heard because the transmitter or the radios take a moment to open")}">＋ ${LG("Silencio al inicio", "Leading silence")}</button>`}
            <span class="muted ct-res">${esc(ctResumen(segs))}</span></div></div>`
          : `<p class="muted">${LG("Es un archivo de sonido", "It's a sound file")}: <code>${esc(((st.tonos || []).find((x) => x.nombre === n) || {}).valor)}</code></p>`}
      </div>`;
  };
  box.innerHTML = aviso + `
    ${tiempos.length ? `<div class="bk-card"><h4>${LG("Tiempos", "Timing")}</h4>${tiempos.map((k) => `<div class="ct-uso"><div><b>${esc(TIEMPO_TXT[k][0])}</b> <code>${k}</code><small class="muted">${esc(TIEMPO_TXT[k][1])}</small></div>
        <label class="ct-ms"><input type="number" inputmode="numeric" data-cttiempo="${k}" value="${ed.tiempos[k] == null ? "" : ed.tiempos[k]}" min="${st.tiempos[k].min}" max="${st.tiempos[k].max}" step="50"> ms</label><span></span></div>`).join("")}</div>` : ""}
    ${enlaceN.length ? `<h4 class="bk-sub">${LG("Cuando el nodo está enlazado", "When the node is linked")}</h4>
      <p class="muted ct-ayuda">${LG("Mientras el nodo tenga algún enlace (por ejemplo, el enlace permanente con el hub), al soltar el PTT suena uno de estos dos y no el de «Sin enlaces».", "While the node has any link (for example the permanent link to the hub), one of these two plays when the PTT is released, not the «Not linked» one.")}</p>
      <div class="ct-lista">${enlaceN.map(tarjeta).join("")}</div>` : ""}
    <div class="bk-card"><h4>${LG("Qué tono se usa en los demás casos", "Which tone is used in the other cases")}</h4>
      ${USOS_CT.map(([k, l, h]) => `<div class="ct-uso"><div><b>${esc(ctLG(l))}</b><small class="muted">${esc(ctLG(h))}</small></div>
        <select data-ctuso="${k}" translate="no">${opts(ed.uso[k])}</select>
        <button type="button" class="btn sm" data-ctplay="${esc(ed.uso[k])}" ${ed.uso[k] && ed.tonos[ed.uso[k]] ? "" : "disabled"} title="${LG("Escuchar", "Listen")}">▶</button></div>`).join("")}
    </div>
    <h4 class="bk-sub">${LG("Tonos disponibles", "Available tones")}</h4>
    <div class="ct-lista">${nombres.map(tarjeta).join("")}</div>
    <p class="muted ct-ayuda">${LG("Frecuencia 0 = silencio. Con dos frecuencias suenan juntas (como DTMF). Volumen normal: 2048.", "Frequency 0 = silence. With two frequencies they sound together (like DTMF). Normal volume: 2048.")}</p>
    <div class="row gap wrap"><button type="button" class="btn" id="btnCtNuevo">＋ ${LG("Nuevo tono", "New tone")}</button>
      <button type="button" class="btn primary" id="btnCtGuardar" ${sucio ? "" : "disabled"}>${LG("Guardar en rpt.conf", "Save to rpt.conf")}</button>
      ${sucio ? `<span class="muted">${LG("Cambios sin guardar", "Unsaved changes")}</span>` : ""}</div>`;
}
document.addEventListener("click", async (e) => {
  if (!e.target.closest("#tonosBox")) return;
  const ed = S.tonosEd;
  const card = e.target.closest("[data-ct]"), n = card && card.dataset.ct;
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.ctplay !== undefined) return tonoTocar(ed.tonos[b.dataset.ctplay]);
  if (b.dataset.ctsegdel !== undefined) { ed.tonos[n].splice(+b.dataset.ctsegdel, 1); S.tonosSucio.add(n); return renderTonos(); }
  if (b.dataset.ctsegadd) {
    if (ed.tonos[n].length >= 12) return toast(LG("Máximo 12 pitidos por tono", "At most 12 beeps per tone"), true);
    if (b.dataset.ctsegadd === "inicio") ed.tonos[n].unshift([0, 0, 250, 0]);
    else ed.tonos[n].push(b.dataset.ctsegadd === "pausa" ? [0, 0, 50, 0] : [1000, 0, 100, 2048]);
    S.tonosSucio.add(n); return renderTonos();
  }
  if (b.dataset.ctdel) {
    const esNuevo = !(S.tonosSt.tonos || []).some((x) => x.nombre === b.dataset.ctdel);
    if (esNuevo) { delete ed.tonos[b.dataset.ctdel]; S.tonosSucio.delete(b.dataset.ctdel); }
    else if (await confirmBox(LG(`¿Borrar ${b.dataset.ctdel} de rpt.conf?`, `Delete ${b.dataset.ctdel} from rpt.conf?`), LG("Borrar", "Delete"))) { ed.borrar.push(b.dataset.ctdel); S.tonosSucio.delete(b.dataset.ctdel); }
    return renderTonos();
  }
  if (b.id === "btnCtNuevo") {
    let i = 1; while (ed.tonos["ct" + i] !== undefined && !ed.borrar.includes("ct" + i)) i++;
    if (i > 99) return;
    ed.borrar = ed.borrar.filter((x) => x !== "ct" + i);
    ed.tonos["ct" + i] = [[1000, 0, 100, 2048]]; S.tonosSucio.add("ct" + i);
    renderTonos();
    const c = $(`#tonosBox [data-ct="ct${i}"]`); if (c) c.scrollIntoView({ block: "center" });
    return;
  }
  if (b.id === "btnCtGuardar") {
    const tonos = {};
    for (const nn of S.tonosSucio) if (ed.tonos[nn]) tonos[nn] = ed.tonos[nn];
    busy(b, true, LG("Guardando…", "Saving…"));
    try {
      await api("api/tonos", { method: "PUT", json: { tonos, uso: ed.uso, borrar: ed.borrar, tiempos: ed.tiempos } });
      toast(LG("Guardado en rpt.conf", "Saved to rpt.conf")); loadTonos();
    } catch (err) { toast(err.message, true); busy(b, false); }
    return;
  }
  if (b.id === "btnTonosAplicar") {
    if (!(await confirmBox(LG("Se va a reiniciar Asterisk para aplicar los tonos. Los enlaces se cortan unos segundos y se reconectan solos. Si el nodo no vuelve, se regresa la configuración anterior. ¿Continuar?",
      "Asterisk will restart to apply the tones. Links drop for a few seconds and reconnect by themselves. If the node doesn't come back, the previous configuration is restored. Continue?"), LG("Reiniciar Asterisk", "Restart Asterisk")))) return;
    try { await api("api/tonos/aplicar", { method: "POST" }); } catch (err) { return toast(err.message, true); }
    loadTonos();
  }
});
document.addEventListener("change", (e) => {
  if (!e.target.closest("#tonosBox")) return;
  const ed = S.tonosEd, t = e.target;
  if (t.dataset.ctuso) { ed.uso[t.dataset.ctuso] = t.value; return renderTonos(); }
  if (t.dataset.cttiempo) {
    const r = S.tonosSt.tiempos[t.dataset.cttiempo];
    ed.tiempos[t.dataset.cttiempo] = Math.max(r.min, Math.min(r.max, Math.round(+t.value || 0)));
    return renderTonos();
  }
  if (t.dataset.ctcopia) {
    if (!t.value || !ed.tonos[t.value]) return;
    ed.tonos[t.dataset.ctcopia] = ed.tonos[t.value].map((x) => x.slice());
    S.tonosSucio.add(t.dataset.ctcopia); return renderTonos();
  }
  if (t.dataset.ctv) {
    const n = t.closest("[data-ct]").dataset.ct, [i, j] = t.dataset.ctv.split(":").map(Number);
    const max = [4000, 4000, 5000, 16384][j], min = j === 2 ? 10 : 0;
    ed.tonos[n][i][j] = Math.max(min, Math.min(max, Math.round(+t.value || 0)));
    S.tonosSucio.add(n); renderTonos();
  }
});

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

/* ── Programación → Anuncios ─────────────────────────────────────────────────
   Anuncios cortos que el nodo transmite solo. El audio subido o grabado se
   convierte aquí, en el navegador, a WAV 8 kHz mono (lo que lee Asterisk). */
const AN_DIAS = () => LG("L M X J V S D", "Mo Tu We Th Fr Sa Su").split(" ");
const AN_DIAS_LARGO = () => LG("Lun Mar Mié Jue Vie Sáb Dom", "Mon Tue Wed Thu Fri Sat Sun").split(" ");
const AN_VAR_EN = { "{hora}": "Current time (HH:MM)", "{dia}": "Day of the week", "{fecha}": "Date (dd/mm/yyyy)",
  "{fecha_larga}": "Date in words (2 de noviembre de 2026)", "{saludo}": "Buenos días / buenas tardes / buenas noches (by time of day)",
  "{despedida}": "Buen día / buena tarde / buena noche (by time of day)", "{nodo}": "Node number",
  "{son_las}": "The time in words: «son las 3 y media de la tarde» / «es la una de la tarde»",
  "{temperatura}": "Current temperature (22 grados)", "{sensacion}": "Feels-like temperature (20 grados)",
  "{condicion}": "Sky conditions (cielo parcialmente nublado)", "{humedad}": "Relative humidity (45 por ciento)",
  "{viento}": "Wind (15 kilómetros por hora del noreste / en calma)", "{racha}": "Highest wind gust (35 kilómetros por hora)",
  "{presion}": "Pressure (1013 hectopascales)", "{pronostico}": "Today's forecast (tomorrow's after 4 pm)",
  "{lugar}": "Place name (Settings → Weather)" };
/* Plantillas para un anuncio nuevo (lo que se transmite va en español, como el resto de las variables) */
const AN_PLANTILLAS = [
  { id: "hora", icono: "🕐", es: "Hora", en: "Time", nombre: "Hora", texto: "{saludo}. {son_las}.", modo: "cada", cada_min: 30, desde_h: "07:00", hasta_h: "22:00" },
  { id: "hora_clima", icono: "🕐", es: "Hora y temperatura", en: "Time and temperature", clima: true, nombre: "Hora y temperatura",
    texto: "{saludo}. {son_las}. En {lugar} tenemos {temperatura}.", modo: "cada", cada_min: 30, desde_h: "07:00", hasta_h: "22:00" },
  { id: "clima", icono: "🌤", es: "Reporte del clima", en: "Weather report", clima: true, nombre: "Reporte del clima",
    texto: "{saludo}. Reporte del clima en {lugar}: {condicion}. Temperatura de {temperatura}, sensación térmica de {sensacion}. Humedad del {humedad}. Viento {viento}. {pronostico}",
    modo: "cada", cada_min: 60, desde_h: "07:47", hasta_h: "21:47" },
];
const anDetalle = (t) => LG(t, String(t || "").replace(/^manual · /, "manual · ").replace(/^alerta · /, "alert · ").replace(/^DTMF · /, "DTMF · ").replace("solo este nodo", "this node only").replace("nodo y enlaces", "node and links")
  .replace(/^El canal estuvo ocupado (\d+) min$/, "The channel was busy for $1 min")
  .replace(/^Los anuncios solo salen en nodos AllStar.*$/, "Announcements only go out on AllStar nodes with a node number (Settings → Node)")
  .replace(/^Falta el audio del anuncio.*$/, "The announcement's audio is missing; edit it and save it again"));
const puedeAnunciar = () => S.me && (S.me.rol === "admin" || S.me.rol === "operador");
async function loadProg() {
  clearTimeout(S.anT);
  progSub(S.progSub);
  if (S.progSub === "alertas") return loadAlertas();
  try { S.an = await api("api/anuncios"); renderAnuncios(); }
  catch (e) { $("#anList").innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
  // Mientras se ve la pestaña: el estado (esperando canal / al aire) y el próximo se refrescan solos
  const ocupado = S.an && S.an.emisor && (S.an.emisor.actual || S.an.emisor.en_cola.length);
  S.anT = setTimeout(() => { if (S.tab === "prog" && !document.hidden) loadProg(); }, ocupado ? 3000 : 20000);
}
const anFecha = (s) => { const [d, h] = (s || "").split(" "); if (!d) return ""; const [y, m, dd] = d.split("-"); return `${dd}/${m}/${y}${h ? " " + h : ""}`; };
const anMinutos = (desde, hasta) => Math.round((new Date(hasta.replace(" ", "T")) - new Date(desde.replace(" ", "T"))) / 60000);
function anDiasTxt(d) {
  if (d === "0123456") return LG("Todos los días", "Every day");
  if (d === "01234") return LG("Lun a Vie", "Mon to Fri");
  if (d === "56") return LG("Sáb y Dom", "Sat and Sun");
  return d.split("").map((i) => AN_DIAS_LARGO()[+i]).join(", ");
}
/* Por dónde sale: RF (el radio de este nodo) siempre; Net (los nodos enlazados) solo con destino «red» */
const anVia = (a) => {
  // En «A estas horas» cada hora tiene su destino: Net puede ser «siempre», «solo a ciertas horas» o «nunca»
  const rojas = a.modo === "horas" ? a.horas.filter((x) => x.red).map((x) => x.h) : null;
  const net = rojas ? rojas.length > 0 : a.destino === "red";
  const solo = rojas && net && rojas.length < a.horas.length;
  return `<span class="via rf on" title="${LG("Sale por el radio de este nodo", "Goes out on this node's radio")}">📻 RF</span>` +
    `<span class="via net ${net ? "on" : ""}" title="${net ? LG("También sale a los nodos enlazados", "Also goes out to the linked nodes") : LG("No sale a los nodos enlazados", "Doesn't go out to the linked nodes")}">🌐 Net${solo ? " " + LG("solo", "only") + " " + rojas.join(", ") : ""}</span>`;
};
const anHoraTxt = (x) => x.h + (x.red ? " 🌐" : "");
const anY = (l) => l.length < 2 ? l.join("") : l.slice(0, -1).join(", ") + LG(" y ", " and ") + l[l.length - 1];
function anCuandoTxt(a) {
  let t;
  if (a.modo === "una") t = LG("Una vez", "Once") + " · " + anFecha(a.una_vez);
  else if (a.modo === "cada") {
    const m = a.cada_min, c = m % 60 === 0 ? `${m / 60} h` : `${m} min`;
    t = anDiasTxt(a.dias) + " · " + LG(`Cada ${c} de ${a.desde_h} a ${a.hasta_h}`, `Every ${c} from ${a.desde_h} to ${a.hasta_h}`);
  } else if (a.modo === "evento") {
    const m = anY(a.antes.map(String));
    return LG(`${m} min antes de «${a.evento_nombre || "evento borrado"}»`, `${m} min before «${a.evento_nombre || "deleted event"}»`);
  } else t = anDiasTxt(a.dias) + " · " + anY(a.horas.map(anHoraTxt));
  if (a.vig_desde || a.vig_hasta) t += " · " + (a.vig_desde && a.vig_hasta ? LG(`del ${anFecha(a.vig_desde)} al ${anFecha(a.vig_hasta)}`, `from ${anFecha(a.vig_desde)} to ${anFecha(a.vig_hasta)}`)
    : a.vig_desde ? LG("desde el ", "from ") + anFecha(a.vig_desde) : LG("hasta el ", "until ") + anFecha(a.vig_hasta));
  return t;
}
function renderAnuncios() {
  const d = S.an, lst = d.anuncios, puede = puedeAnunciar(), act = (d.emisor || {}).actual;
  $("#btnNewAnuncio").classList.toggle("hidden", !puede || !d.asl || S.progSub !== "anuncios");
  $("#anCnt").textContent = lst.length || "";
  let aviso = !d.asl ? `<div class="note warn">${LG("Los anuncios salen al aire solo en nodos AllStar (ASL). Este nodo no es ASL o no tiene número de nodo en Ajustes → Nodo.", "Announcements only go on air on AllStar (ASL) nodes. This node isn't ASL or has no node number in Settings → Node.")}</div>`
    : !d.voz.lista ? `<div class="note warn">${LG("La voz no está configurada", "The voice isn't set up")} (${esc(d.voz.nombre || "")}). ${isAdmin() ? LG("Revisa Ajustes → Voz. Mientras, puedes subir o grabar el audio.", "Check Settings → Voice. Meanwhile you can upload or record the audio.") : LG("Pídele al administrador que la configure; mientras, puedes subir o grabar el audio.", "Ask the administrator to set it up; meanwhile you can upload or record the audio.")}</div>` : "";
  if ((d.otros || []).length) {
    const QUE = { hora: LG("anuncia la hora", "announces the time"), clima: LG("anuncia el clima", "announces the weather"), audio: LG("reproduce audios", "plays audio") };
    aviso += `<details class="note an-otros"><summary>ⓘ ${LG("Otros programas también hablan en este nodo", "Other programs also talk on this node")}: ${[...new Set(d.otros.map((o) => QUE[o.que]))].join(", ")}</summary>
      <p class="muted">${LG("Si programas aquí lo mismo (por ejemplo la hora) se oirá dos veces, y sus audios no esperan a que el canal esté libre. Para dejarlo solo en ASLSCAN, quita esas líneas de su crontab. ASLSCAN no las toca.", "If you schedule the same thing here (the time, for example) it will be heard twice, and their audio doesn't wait for a clear channel. To leave it only in ASLSCAN, remove those lines from their crontab. ASLSCAN doesn't touch them.")}</p>
      <ul>${d.otros.map((o) => `<li><b>${esc(QUE[o.que])}</b> · <code translate="no">${esc(o.donde)}</code><br><small class="muted" translate="no">${esc(o.detalle)}</small></li>`).join("")}</ul></details>`;
  }
  // Solo se redibuja si cambió (se refresca cada pocos segundos y cerraría el aviso abierto)
  if (S.anAvisoHtml !== aviso) { $("#anAviso").innerHTML = aviso; S.anAvisoHtml = aviso; }
  const sig = d.siguiente;
  $("#anNext").innerHTML = act ? `<div class="an-next live"><span class="lbl">${act.estado === "al_aire" ? "📡 " + LG("Al aire", "On air") : "⏳ " + LG("Esperando a que se libere el canal", "Waiting for the channel to clear")}</span><b translate="no">${esc(act.nombre)}</b></div>`
    : sig ? `<div class="an-next"><span class="lbl">${LG("Próximo", "Next")}</span><b translate="no">📢 ${esc(sig.nombre)}</b><span>${anFecha(sig.cuando)} · ${LG("en", "in")} ${fmtLeft(anMinutos(d.ahora, sig.cuando) * 60)} · ${sig.red ? "📻 RF + 🌐 Net" : "📻 RF"}</span></div>` : "";
  if (!lst.length) {
    $("#anList").innerHTML = `<p class="empty">${LG("Todavía no hay anuncios.", "No announcements yet.")}${puede && d.asl ? " " + LG("Crea el primero con «＋ Nuevo anuncio».", "Create the first one with «＋ New announcement».") : ""}</p>`;
  } else $("#anList").innerHTML = lst.map((a) => {
    const enCola = act && act.id === a.id ? act.estado : (d.emisor.en_cola || []).includes(a.id) ? "cola" : "";
    const ult = a.ultimo ? `${LG("Último", "Last")}: ${anFecha(a.ultimo)} ${{ ok: "✓", saltado: "⚠ " + LG("saltado (canal ocupado)", "skipped (channel busy)"), error: "✗ " + LG("error", "error") }[a.ultimo_estado] || ""}` : LG("Todavía no ha salido", "Hasn't gone out yet");
    return `<div class="card an-card ${a.activo ? "" : "off"} ${enCola ? "live" : ""}">
      <div class="an-top"><h3 translate="no">📢 ${esc(a.nombre)}</h3>
        ${puede ? `<label class="switch" title="${a.activo ? LG("Activo: clic para pausarlo", "Active: click to pause it") : LG("Pausado: clic para activarlo", "Paused: click to activate it")}"><input type="checkbox" data-anon="${a.id}" ${a.activo ? "checked" : ""}><span></span></label>`
          : `<span class="chip ${a.activo ? "ok" : ""}">${a.activo ? LG("Activo", "Active") : LG("Pausado", "Paused")}</span>`}</div>
      <div class="an-via">${anVia(a)}${a.dtmf ? ` <span class="chip" title="${LG("Se dispara marcando este código", "Dialing this code plays it")}">☎ *${esc(a.dtmf)}</span>` : ""}</div>
      <div class="an-que">${a.tipo === "tts" ? `🗣 <span translate="no">«${esc(a.texto.length > 140 ? a.texto.slice(0, 140) + "…" : a.texto)}»</span>` : `🎵 <span translate="no">${esc(a.archivo_nombre || "audio.wav")}</span>`}<span class="an-dur">${fmt(a.duracion)}</span></div>
      <div class="meta">${esc(anCuandoTxt(a))}</div>
      <div class="meta">${enCola === "al_aire" ? "📡 " + LG("Al aire ahora", "On air now") : enCola ? "⏳ " + LG("Esperando canal libre", "Waiting for a clear channel")
        : a.activo && a.proximo ? LG("Próximo", "Next") + ": " + anFecha(a.proximo) + (a.proximo_red ? " · 📻🌐 RF + Net" : " · 📻 RF") : a.activo ? LG("Sin próximos turnos", "No upcoming slots") : ""}${a.creado_por ? ` · <span class="muted">${LG("creado por", "created by")} ${esc(a.creado_por)}</span>` : ""}</div>
      <div class="meta muted">${ult}</div>
      <div class="actions">
        <button type="button" class="btn sm ro" data-anplay="${a.id}" data-v="${esc(a.modificado)}">▶ ${LG("Escuchar", "Listen")}</button>
        ${puede && d.asl ? `<button type="button" class="btn sm danger-soft" data-anaire="${a.id}" ${enCola ? "disabled" : ""}>📡 ${LG("Transmitir ahora", "Transmit now")}</button>` : ""}
        ${puede ? `<button type="button" class="btn sm" data-anedit="${a.id}">✏️ ${LG("Editar", "Edit")}</button>
          <button type="button" class="btn sm ghost" data-andel="${a.id}" title="${LG("Borrar", "Delete")}">🗑</button>` : ""}
      </div></div>`;
  }).join("");
  const log = d.bitacora || [];
  $("#anLogWrap").classList.toggle("hidden", !log.length);
  $("#anLog").innerHTML = log.map((l) => `<div class="an-log-row ${esc(l.estado)}"><span class="when">${anFecha(l.cuando)}</span>
    <b translate="no">${esc(l.nombre)}</b><span>${{ ok: "✓ " + LG("Salió", "Went out"), saltado: "⚠ " + LG("Saltado", "Skipped"), error: "✗ Error" }[l.estado] || esc(l.estado)}</span>
    <small class="muted">${esc(anDetalle(l.detalle || ""))}</small></div>`).join("");
}
let anAudio = null;
$("#anList").addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.anplay) {
    if (anAudio && !anAudio.paused && anAudio.dataset.id === b.dataset.anplay) { anAudio.pause(); b.textContent = "▶ " + LG("Escuchar", "Listen"); return; }
    if (anAudio) anAudio.pause();
    $$("#anList [data-anplay]").forEach((x) => (x.textContent = "▶ " + LG("Escuchar", "Listen")));
    anAudio = new Audio(`api/anuncios/${b.dataset.anplay}/audio?v=${encodeURIComponent(b.dataset.v)}`);
    anAudio.dataset.id = b.dataset.anplay;
    anAudio.onended = () => (b.textContent = "▶ " + LG("Escuchar", "Listen"));
    b.textContent = "⏸ " + LG("Detener", "Stop");
    anAudio.play().catch((err) => { toast(err.message, true); b.textContent = "▶ " + LG("Escuchar", "Listen"); });
    return;
  }
  const id = +(b.dataset.anaire || b.dataset.anedit || b.dataset.andel);
  const a = (S.an.anuncios || []).find((x) => x.id === id); if (!a) return;
  if (b.dataset.anedit) return anuncioEditor(a);
  if (b.dataset.andel) {
    if (!(await confirmBox(LG(`¿Borrar el anuncio «${a.nombre}»? No se puede deshacer.`, `Delete the announcement «${a.nombre}»? This can't be undone.`), LG("Borrar", "Delete")))) return;
    await run(() => api("api/anuncios/" + id, { method: "DELETE" }), LG("Anuncio borrado", "Announcement deleted")).catch(() => {});
    return loadProg();
  }
  if (b.dataset.anaire) {
    const destino = await anElegirVia(a);
    if (!destino) return;
    await run(() => api(`api/anuncios/${id}/ahora`, { method: "POST", json: { destino } }), LG("En camino al aire", "On its way to air")).catch(() => {});
    return loadProg();
  }
});
$("#anList").addEventListener("change", async (e) => {
  const t = e.target.closest("[data-anon]"); if (!t) return;
  try { await run(() => api(`api/anuncios/${t.dataset.anon}/activo`, { method: "POST", json: { activo: t.checked } }), t.checked ? LG("Anuncio activado", "Announcement activated") : LG("Anuncio pausado", "Announcement paused")); }
  catch { t.checked = !t.checked; }
  loadProg();
});
$("#btnNewAnuncio").onclick = () => anuncioEditor(null);
/* «Transmitir ahora»: por dónde sale esta vez (marcado el destino de siempre del anuncio) */
function anElegirVia(a) {
  return new Promise((res) => {
    const red = a.destino === "red";
    openModal(LG("Transmitir ahora", "Transmit now"), `<p translate="no"><b>📢 ${esc(a.nombre)}</b></p>
      <p class="muted">${LG("¿Por dónde sale esta vez? Si alguien está hablando, espera a que se libere el canal.", "Where should it go out this time? If someone is talking, it waits for the channel to clear.")}</p>
      <div class="an-elegir">
        <button type="button" class="btn ${red ? "" : "primary"}" data-via="local"><span class="via rf on">📻 RF</span> ${LG("Solo este nodo", "This node only")}</button>
        <button type="button" class="btn ${red ? "primary" : ""}" data-via="red"><span class="via rf on">📻 RF</span><span class="via net on">🌐 Net</span> ${LG("Este nodo y los enlazados", "This node and the linked ones")}</button>
      </div>
      <div class="modal-actions"><button type="button" class="btn" id="anViaNo">${LG("Cancelar", "Cancel")}</button></div>`);
    $("#modalBody").onclick = (e) => {
      const b = e.target.closest("[data-via]"), no = e.target.closest("#anViaNo");
      if (!b && !no) return;
      $("#modalBody").onclick = null; closeModal(); res(b ? b.dataset.via : null);
    };
  });
}

/* Audio del navegador → WAV 8 kHz mono 16 bits, con el pico a -1 dB */
async function aWav8k(blob, nombre) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx || !window.OfflineAudioContext) throw new Error(LG("Este navegador no puede convertir audio", "This browser can't convert audio"));
  let buf;
  try { const ctx = new Ctx(); buf = await ctx.decodeAudioData(await blob.arrayBuffer()); ctx.close && ctx.close(); }
  catch { throw new Error(LG("No pude leer ese audio. Prueba con MP3, WAV, M4A u OGG.", "Couldn't read that audio. Try MP3, WAV, M4A or OGG.")); }
  const RATE = 8000, len = Math.max(1, Math.ceil(buf.duration * RATE));
  const off = new OfflineAudioContext(1, len, RATE);
  const src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  let pico = 0; for (let i = 0; i < pcm.length; i++) pico = Math.max(pico, Math.abs(pcm[i]));
  const g = pico > 0.001 ? Math.min(8, 0.89 / pico) : 1;
  const dv = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); dv.setUint32(4, 36 + pcm.length * 2, true); w(8, "WAVE"); w(12, "fmt ");
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, RATE, true);
  dv.setUint32(28, RATE * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, "data"); dv.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) { const v = Math.max(-1, Math.min(1, pcm[i] * g)); dv.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true); }
  return { file: new File([dv.buffer], (nombre || "anuncio").replace(/\.[^.]+$/, "") + ".wav", { type: "audio/wav" }), dur: buf.duration };
}

function anuncioEditor(a) {
  const d = S.an, nuevo = !a;
  a = a || { nombre: "", tipo: d.voz.lista ? "tts" : "audio", texto: "", dias: "0123456", modo: "horas", horas: [{ h: "09:00", red: false }], antes: [15, 5], evento_id: 0, cada_min: 60,
    desde_h: "08:00", hasta_h: "22:00", una_vez: "", vig_desde: "", vig_hasta: "", destino: "local", activo: true };
  const ed = { tipo: a.tipo, horas: a.horas.map((x) => ({ h: x.h, red: !!x.red })), antes: (a.antes || []).slice(), archivo: null, archivoNombre: a.archivo_nombre || "", dur: a.duracion || 0 };
  const puedeGrabar = !!(window.isSecureContext && navigator.mediaDevices && window.MediaRecorder);
  const chip = ([v, t]) => `<button type="button" class="chip" data-anvar="${esc(v)}" title="${esc(LG(t, AN_VAR_EN[v] || t))}" translate="no">${esc(v)}</button>`;
  const vars = (d.voz.variables || []).map(chip).join("");
  const climaListo = !!(d.clima && d.clima.listo);
  const varsClima = (d.voz.variables_clima || []).map(chip).join("");
  const plantillas = nuevo ? `<div class="an-plant"><span class="muted">${LG("Empezar con", "Start from")}:</span> ${AN_PLANTILLAS.map((p) => `<button type="button" class="chip" data-plant="${p.id}" ${p.clima && !climaListo ? "disabled" : ""} title="${p.clima && !climaListo ? esc(LG("Primero pon tu ubicación en Ajustes → Clima", "First set your location in Settings → Weather")) : ""}">${p.icono} ${esc(LG(p.es, p.en))}</button>`).join("")}</div>` : "";
  openModal(nuevo ? LG("Nuevo anuncio", "New announcement") : LG("Editar anuncio", "Edit announcement"), `<form id="anForm" class="an-form" autocomplete="off">
    ${plantillas}
    <label>${LG("Nombre", "Name")}<input name="nombre" maxlength="80" required value="${esc(a.nombre)}" placeholder="${LG("Red de los martes", "Tuesday net")}"></label>
    <div class="an-sec"><b>${LG("Qué dice", "What it says")}</b>
      <div class="seg" id="anTipo">
        <button type="button" data-tipo="tts">🗣 ${LG("Texto → voz", "Text → voice")}</button>
        <button type="button" data-tipo="audio">🎵 ${LG("Subir audio", "Upload audio")}</button>
        ${puedeGrabar ? `<button type="button" data-tipo="grabar">🎙 ${LG("Grabar aquí", "Record here")}</button>` : ""}
      </div>
      <div data-pane="tts"><textarea name="texto" rows="3" maxlength="2000" placeholder="${LG("Les recordamos que hoy martes a las 21:00 tenemos la red…", "Remember that tonight at 9 pm we have the net…")}">${esc(a.texto)}</textarea>
        <div class="an-dic hidden" id="anDic"></div>
        <div class="an-vars"><span class="muted">${LG("Variables", "Variables")}:</span> ${vars}</div>
        <div class="an-vars an-vars-clima"><span class="muted">🌤 ${LG("Clima", "Weather")}:</span> ${climaListo ? varsClima : `<span class="muted">${LG("pon tu ubicación en Ajustes → Clima para usarlas", "set your location in Settings → Weather to use them")}</span>`}</div>
        <div class="hz-box" id="anHz"></div>
        <div class="row gap wrap"><button type="button" class="btn sm" id="anVozPlay">▶ ${LG("Escuchar", "Listen")}</button><span class="muted" id="anVozMsg">${esc(d.voz.nombre || "")}${d.voz.lista ? "" : " · ⚠ " + LG("sin configurar", "not set up")}</span></div></div>
      <div data-pane="audio" class="hidden"><label class="btn sm" style="margin:0">📁 ${LG("Elegir archivo", "Choose file")}<input type="file" id="anFile" accept="audio/*" hidden></label>
        <span class="muted" id="anFileMsg">${ed.archivoNombre ? esc(ed.archivoNombre) + " · " + fmt(ed.dur) : LG("MP3, WAV, M4A u OGG", "MP3, WAV, M4A or OGG")}</span></div>
      <div data-pane="grabar" class="hidden"><button type="button" class="btn sm" id="anRec">⏺ ${LG("Grabar", "Record")}</button> <span class="muted" id="anRecMsg">${LG("Habla cerca del micrófono", "Speak close to the microphone")}</span></div>
      <audio id="anPrev" controls class="hidden"></audio>
      <small class="muted">${LG(`Máximo ${d.max_seg} s.`, `${d.max_seg} s maximum.`)}${puedeGrabar ? "" : " " + LG("Para grabar desde aquí la página debe abrirse con https.", "To record here the page must be opened over https.")}</small>
    </div>
    <div class="an-sec"><b>${LG("Cuándo", "When")}</b>
      <div class="seg" id="anModo">
        <button type="button" data-modo="horas">${LG("A estas horas", "At these times")}</button>
        <button type="button" data-modo="cada">${LG("Cada cierto tiempo", "Every so often")}</button>
        <button type="button" data-modo="una">${LG("Una sola vez", "Just once")}</button>
        ${d.eventos ? `<button type="button" data-modo="evento">${LG("Antes de un evento", "Before an event")}</button>` : ""}
      </div>
      <div class="an-dias" data-ver="horas cada">${AN_DIAS().map((t, i) => `<button type="button" data-dia="${i}" class="${a.dias.includes(String(i)) ? "on" : ""}">${t}</button>`).join("")}
        <button type="button" class="btn sm ghost" data-diasrap="0123456">${LG("Todos", "All")}</button><button type="button" class="btn sm ghost" data-diasrap="01234">${LG("Lun–Vie", "Mon–Fri")}</button></div>
      <div data-ver="horas"><div class="an-horas" id="anHoras"></div>
        <div class="row gap"><input type="time" id="anHoraNueva" value="12:00"><button type="button" class="btn sm" id="anHoraAdd">＋ ${LG("Hora", "Time")}</button></div>
        <small class="muted an-hint">ⓘ ${LG("📻 RF siempre va. Marca 🌐 Net en las horas que también deban salir a los nodos enlazados.", "📻 RF always goes. Check 🌐 Net on the times that should also go out to the linked nodes.")}</small></div>
      ${d.eventos ? `<div data-ver="evento" class="an-ev">
        <label>${LG("Evento", "Event")}<select name="evento_id"><option value="">— ${LG("Elige el evento", "Choose the event")} —</option>${d.eventos.map((e) => `<option value="${e.id}" ${+a.evento_id === e.id ? "selected" : ""}>${esc(e.nombre)}${e.programado ? "" : " · " + LG("sin programar", "not scheduled")}</option>`).join("")}</select></label>
        <div class="an-horas" id="anAntes"></div>
        <div class="row gap"><input type="number" id="anAntesNuevo" min="1" max="720" value="10"> ${LG("min antes", "min before")} <button type="button" class="btn sm" id="anAntesAdd">＋</button></div>
        <small class="muted an-hint">ⓘ ${LG("Sigue al evento: si cambias su hora, su zona horaria o lo pausas, el anuncio se mueve o se pausa solo.", "It follows the event: if you change its time or time zone, or pause it, the announcement moves or pauses with it.")}</small>
      </div>` : ""}
      <div data-ver="cada" class="row gap wrap an-cada">${LG("Cada", "Every")} <select name="cada_min">${[15, 30, 60, 90, 120, 180, 240, 360].map((m) => `<option value="${m}" ${+a.cada_min === m ? "selected" : ""}>${m % 60 ? m + " min" : m / 60 + " h"}</option>`).join("")}</select>
        ${LG("de", "from")} <input type="time" name="desde_h" value="${esc(a.desde_h)}"> ${LG("a", "to")} <input type="time" name="hasta_h" value="${esc(a.hasta_h)}"></div>
      <div data-ver="una"><input type="datetime-local" name="una_vez" value="${esc((a.una_vez || "").replace(" ", "T"))}"></div>
      <details class="an-vig" ${a.vig_desde || a.vig_hasta ? "open" : ""} data-ver="horas cada"><summary>${LG("Vigencia (opcional)", "Valid dates (optional)")}</summary>
        <div class="row gap wrap">${LG("desde", "from")} <input type="date" name="vig_desde" value="${esc(a.vig_desde)}"> ${LG("hasta", "to")} <input type="date" name="vig_hasta" value="${esc(a.vig_hasta)}"></div></details>
    </div>
    <div class="an-sec"><b>${LG("Dónde", "Where")}</b>
      <label class="check"><input type="radio" name="destino" value="local" ${a.destino !== "red" ? "checked" : ""}> <span class="via rf on">📻 RF</span> ${LG("Solo este nodo (el radio local)", "This node only (the local radio)")}</label>
      <label class="check"><input type="radio" name="destino" value="red" ${a.destino === "red" ? "checked" : ""}> <span class="via rf on">📻 RF</span><span class="via net on">🌐 Net</span> ${LG("Este nodo y los nodos enlazados", "This node and the linked nodes")}</label>
      <small class="muted hidden" id="anRedAviso">⚠ ${LG("Se oye en todos los nodos conectados en ese momento.", "It's heard on every node connected at that moment.")}</small>
      <small class="muted an-hint" id="anDondeNota" data-ver="horas">ⓘ ${LG("En «A estas horas» esto pone todas las horas igual; después cambia arriba la que deba ser distinta. También es lo que se marca primero en «Transmitir ahora».", "In «At these times» this sets every time the same; then change above the one that should be different. It's also what's preselected in «Transmit now».")}</small>
    </div>
    ${isAdmin() && d.asl ? `<div class="an-sec"><b>☎ DTMF</b>
      <div class="row gap wrap"><div class="dtmf-cod"><span>*</span><input name="dtmf" value="${esc(a.dtmf || "")}" maxlength="8" placeholder="${LG("sin código", "no code")}" spellcheck="false" autocapitalize="characters"></div>
        <small class="muted">${LG("Marcando este código desde el radio sale el anuncio (espera canal libre). Se escribe en rpt.conf y funciona después de aplicar en Ajustes → DTMF.", "Dialing this code from the radio plays the announcement (it waits for a clear channel). It's written to rpt.conf and works after applying in Settings → DTMF.")}</small></div></div>` : ""}
    <p class="muted an-nota">ⓘ ${LG(`Si alguien está hablando, espera hasta ${d.espera_min} min a que se libere el canal; si no se libera, ese turno se salta y queda en la bitácora.`, `If someone is talking, it waits up to ${d.espera_min} min for the channel to clear; if it doesn't, that slot is skipped and logged.`)}</p>
    <div class="modal-actions"><button type="button" class="btn" id="anCancel">${LG("Cancelar", "Cancel")}</button><button class="btn primary" id="anSave">${LG("Guardar", "Save")}</button></div>
  </form>`);
  const f = $("#anForm"), prev = $("#anPrev");
  const repinta = pronResaltar(f.texto, d.pronuncia || [], $("#anDic"));
  horaPanel($("#anHz"), f.texto, repinta, !!d.eventos);
  const setTipo = (t) => {
    ed.tipo = t === "tts" ? "tts" : "audio"; ed.pane = t;
    $$("#anTipo button").forEach((b) => b.classList.toggle("active", b.dataset.tipo === t));
    $$("#anForm [data-pane]").forEach((p) => p.classList.toggle("hidden", p.dataset.pane !== t));
  };
  const setModo = (m) => {
    // Un anuncio nuevo «antes de un evento» casi siempre es para toda la red
    if (m === "evento" && nuevo && !ed.dondeTocado) { f.destino.value = "red"; red(); }
    ed.modo = m;
    $$("#anModo button").forEach((b) => b.classList.toggle("active", b.dataset.modo === m));
    $$("#anForm [data-ver]").forEach((p) => p.classList.toggle("hidden", !p.dataset.ver.split(" ").includes(m)));
  };
  // Cada hora en su renglón con dos casillas: 📻 RF (siempre: AllStar no puede mandar solo a los enlazados) y 🌐 Net
  const pintaHoras = () => {
    $("#anHoras").innerHTML = ed.horas.length ? ed.horas.map((x) => `<div class="an-hrow ${x.red ? "red" : ""}">
      <b>${x.h}</b>
      <label class="an-cas rf" title="${LG("Siempre sale por el radio de este nodo: AllStar no puede mandar un audio solo a los nodos enlazados", "It always goes out on this node's radio: AllStar can't send audio only to the linked nodes")}"><input type="checkbox" checked disabled> 📻 RF</label>
      <label class="an-cas net" title="${LG("Marcada: también sale a los nodos enlazados", "Checked: also goes out to the linked nodes")}"><input type="checkbox" data-hnet="${x.h}" ${x.red ? "checked" : ""}> 🌐 Net</label>
      <button type="button" class="an-hdel" data-hdel="${x.h}" title="${LG("Quitar", "Remove")} ${x.h}">✕</button></div>`).join("")
      : `<span class="muted">${LG("Agrega al menos una hora", "Add at least one time")}</span>`;
  };
  const pintaAntes = () => {
    const box = $("#anAntes"); if (!box) return;
    box.innerHTML = ed.antes.length ? ed.antes.map((m) => `<span class="chip">${m} min <button type="button" data-adel="${m}" title="${LG("Quitar", "Remove")}">✕</button></span>`).join("")
      : `<span class="muted">${LG("Agrega cuántos minutos antes", "Add how many minutes before")}</span>`;
  };
  const oye = (url) => { prev.src = url; prev.classList.remove("hidden"); prev.play().catch(() => {}); };
  const red = () => $("#anRedAviso").classList.toggle("hidden", f.destino.value !== "red");
  setTipo(a.tipo === "audio" ? "audio" : "tts"); setModo(a.modo); pintaHoras(); pintaAntes(); red();
  if (!nuevo && a.tipo === "audio") oyeGuardado();
  function oyeGuardado() { prev.src = `api/anuncios/${a.id}/audio?v=${encodeURIComponent(a.modificado)}`; prev.classList.remove("hidden"); }
  $("#anTipo").onclick = (e) => { const b = e.target.closest("[data-tipo]"); if (b) setTipo(b.dataset.tipo); };
  $("#anModo").onclick = (e) => { const b = e.target.closest("[data-modo]"); if (b) setModo(b.dataset.modo); };
  f.addEventListener("change", (e) => {
    if (e.target.name !== "destino") return;
    ed.dondeTocado = true; red();
    if (ed.modo === "horas") { ed.horas.forEach((x) => (x.red = f.destino.value === "red")); pintaHoras(); }
  });
  f.querySelector(".an-dias").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.diasrap) $$("#anForm [data-dia]").forEach((x) => x.classList.toggle("on", b.dataset.diasrap.includes(x.dataset.dia)));
    else b.classList.toggle("on");
  };
  $("#anHoras").onchange = (e) => {
    const net = e.target.closest("[data-hnet]");
    if (net) { ed.horas.find((y) => y.h === net.dataset.hnet).red = net.checked; pintaHoras(); }
  };
  $("#anHoras").onclick = (e) => {
    const del = e.target.closest("[data-hdel]");
    if (del) { ed.horas = ed.horas.filter((x) => x.h !== del.dataset.hdel); return pintaHoras(); }
  };
  $("#anHoraAdd").onclick = () => {
    const v = $("#anHoraNueva").value;
    if (v && !ed.horas.some((x) => x.h === v)) { ed.horas.push({ h: v, red: f.destino.value === "red" }); ed.horas.sort((p, q) => p.h.localeCompare(q.h)); pintaHoras(); }
  };
  if ($("#anAntes")) {
    $("#anAntes").onclick = (e) => { const b = e.target.closest("[data-adel]"); if (b) { ed.antes = ed.antes.filter((m) => m !== +b.dataset.adel); pintaAntes(); } };
    $("#anAntesAdd").onclick = () => {
      const v = Math.round(+$("#anAntesNuevo").value);
      if (v >= 1 && v <= 720 && !ed.antes.includes(v)) { ed.antes.push(v); ed.antes.sort((p, q) => q - p); pintaAntes(); }
    };
  }
  const plant = f.querySelector(".an-plant");
  if (plant) plant.onclick = (e) => {
    const b = e.target.closest("[data-plant]"); if (!b || b.disabled) return;
    const p = AN_PLANTILLAS.find((x) => x.id === b.dataset.plant);
    if (!f.nombre.value.trim() || AN_PLANTILLAS.some((x) => [x.es, x.en].includes(f.nombre.value))) f.nombre.value = LG(p.es, p.en);
    f.texto.value = p.texto; setTipo("tts"); repinta();
    f.cada_min.value = String(p.cada_min); f.desde_h.value = p.desde_h; f.hasta_h.value = p.hasta_h; setModo(p.modo);
    $$("#anForm [data-dia]").forEach((x) => x.classList.add("on"));
    $$(".an-plant [data-plant]").forEach((x) => x.classList.toggle("active", x === b));
  };
  f.addEventListener("click", (e) => {
    const b = e.target.closest(".an-vars [data-anvar]"); if (!b) return;
    const t = f.texto, p = t.selectionStart ?? t.value.length;
    t.value = t.value.slice(0, p) + b.dataset.anvar + t.value.slice(t.selectionEnd ?? p); t.focus(); repinta();
  });
  $("#anVozPlay").onclick = async () => {
    const b = $("#anVozPlay"); busy(b, true, LG("Generando…", "Generating…"));
    try {
      const r = await api("api/anuncios/voz", { method: "POST", json: { texto: f.texto.value } });
      $("#anVozMsg").textContent = `${fmt(r.duracion)} ${LG("de", "of")} ${r.max_seg} s` + (r.duracion > r.max_seg ? " · ⚠ " + LG("muy largo", "too long") : "");
      oye(r.url);
    } catch (e) { toast(e.message, true); } finally { busy(b, false); }
  };
  $("#anFile").onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    $("#anFileMsg").textContent = LG("Convirtiendo…", "Converting…");
    try {
      const r = await aWav8k(file, file.name);
      if (r.dur > d.max_seg + 0.5) throw new Error(LG(`Dura ${Math.round(r.dur)} s; el máximo es ${d.max_seg} s`, `It's ${Math.round(r.dur)} s long; the maximum is ${d.max_seg} s`));
      ed.archivo = r.file; ed.archivoNombre = file.name; ed.dur = r.dur;
      $("#anFileMsg").textContent = `${file.name} · ${fmt(r.dur)}`;
      oye(URL.createObjectURL(r.file));
    } catch (err) { $("#anFileMsg").textContent = "⚠ " + err.message; ed.archivo = null; }
  };
  if (puedeGrabar) $("#anRec").onclick = async () => {
    const b = $("#anRec");
    if (ed.rec) { ed.rec.stop(); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { toast(LG("No hay permiso para usar el micrófono", "No permission to use the microphone"), true); return; }
    const trozos = [], rec = new MediaRecorder(stream); ed.rec = rec;
    const t0 = Date.now(), reloj = setInterval(() => {
      const s = (Date.now() - t0) / 1000;
      $("#anRecMsg").textContent = `⏺ ${fmt(s)} ${LG("de", "of")} ${d.max_seg} s`;
      if (s >= d.max_seg) rec.stop();
    }, 250);
    rec.ondataavailable = (e) => e.data.size && trozos.push(e.data);
    rec.onstop = async () => {
      clearInterval(reloj); stream.getTracks().forEach((t) => t.stop()); ed.rec = null;
      b.textContent = "⏺ " + LG("Grabar otra vez", "Record again");
      try {
        const r = await aWav8k(new Blob(trozos, { type: rec.mimeType }), "grabacion");
        ed.archivo = r.file; ed.archivoNombre = LG("Grabación", "Recording") + " " + new Date().toLocaleDateString(); ed.dur = r.dur;
        $("#anRecMsg").textContent = `${LG("Grabado", "Recorded")} · ${fmt(r.dur)}`;
        oye(URL.createObjectURL(r.file));
      } catch (err) { $("#anRecMsg").textContent = "⚠ " + err.message; }
    };
    rec.start(); b.textContent = "⏹ " + LG("Terminar", "Stop");
  };
  $("#anCancel").onclick = () => { if (ed.rec) ed.rec.stop(); closeModal(); };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const datos = {
      nombre: f.nombre.value, tipo: ed.tipo, texto: f.texto.value, modo: ed.modo,
      dias: $$("#anForm [data-dia].on").map((x) => x.dataset.dia).join(""), horas: ed.horas,
      cada_min: f.cada_min.value, desde_h: f.desde_h.value, hasta_h: f.hasta_h.value, una_vez: f.una_vez.value,
      vig_desde: f.vig_desde.value, vig_hasta: f.vig_hasta.value, destino: f.destino.value, activo: a.activo,
      evento_id: f.evento_id ? f.evento_id.value : 0, antes: ed.antes,
    };
    if (f.dtmf) datos.dtmf = f.dtmf.value.trim().replace(/^\*/, "").toUpperCase();
    const fd = new FormData();
    fd.append("datos", JSON.stringify(datos));
    if (ed.tipo === "audio" && ed.archivo) fd.append("archivo", ed.archivo, ed.archivo.name);
    const b = $("#anSave"); busy(b, true, ed.tipo === "tts" ? LG("Generando voz…", "Generating voice…") : LG("Guardando…", "Saving…"));
    try {
      await run(() => api(nuevo ? "api/anuncios" : "api/anuncios/" + a.id, { method: nuevo ? "POST" : "PUT", form: fd }), LG("Anuncio guardado", "Announcement saved"));
      if (f.dtmf && (datos.dtmf || "") !== (a.dtmf || "")) toast(LG("Código DTMF guardado en rpt.conf: aplica los cambios en Ajustes → DTMF para que funcione", "DTMF code saved to rpt.conf: apply the changes in Settings → DTMF for it to work"));
      closeModal(); loadProg();
    } catch {} finally { busy(b, false); }
  };
}

/* ── Ajustes → Voz ───────────────────────────────────────────────────────── */
async function loadVoz() {
  const f = $("#setForm");
  try {
    const v = await api("api/voz");
    $$("#setForm [name=tts_engine] option").forEach((o) => { o.disabled = !!o.value && !v.motores.includes(o.value); });
    $("#vozHint").textContent = LG("Ahora se usa: ", "Now in use: ") + (v.nombres[v.motor] || v.motor) + (v.lista ? "" : " · ⚠ " + LG("falta configurarla", "needs setting up")) +
      (v.motores.includes("piper") ? "" : " · " + LG("Piper no está instalado (sudo apt install asl3-tts)", "Piper isn't installed (sudo apt install asl3-tts)"));
    S.vozMotores = v.motores;
  } catch {}
  for (const [k, set] of [["azure_key", "azure_key_set"], ["eleven_key", "eleven_key_set"]]) {
    f[k].value = "";
    f[k].placeholder = S.cfg && S.cfg[set] ? "•••••• " + LG("(guardada; escribe para cambiarla)", "(saved; type to change it)") : "";
  }
  if (S.cfg) elevenOption(S.cfg.eleven_voice, S.cfg.eleven_voice_name);
  vozVer();
}
function vozVer() {
  const sel = $("#setForm").tts_engine.value || ((S.vozMotores || []).includes("piper") ? "piper" : "azure");
  $$("#setForm .only-azure").forEach((x) => x.classList.toggle("hidden", sel !== "azure"));
  $$("#setForm .only-elevenlabs").forEach((x) => x.classList.toggle("hidden", sel !== "elevenlabs"));
}
function elevenOption(id, name) {
  const sel = $("#elevenVoice");
  if (id && ![...sel.options].some((o) => o.value === id)) sel.insertAdjacentHTML("beforeend", `<option value="${esc(id)}">${esc(name || id)}</option>`);
  sel.value = id || "";
}
$("#elevenVoice").addEventListener("change", (e) => {
  const o = e.target.selectedOptions[0];
  $("#setForm").eleven_voice_name.value = o && o.value ? o.dataset.nombre || o.textContent : "";
});
$("#btnElevenVoices").onclick = async () => {
  const f = $("#setForm"), b = $("#btnElevenVoices"), sel = $("#elevenVoice"), antes = sel.value; busy(b, true, "…");
  try {
    const r = await api("api/elevenlabs/voces", { method: "POST", json: { eleven_key: f.eleven_key.value } });
    sel.innerHTML = `<option value="">— ${LG("Elige una voz", "Choose a voice")} —</option>` + r.voces.map((v) => `<option value="${esc(v.name)}" data-nombre="${esc(v.display)}">${esc(v.display)}${v.gender ? " · " + esc(LG(v.gender, { Femenina: "Female", Masculina: "Male" }[v.gender] || v.gender)) : ""}${v.locale ? " · " + esc(v.locale) : ""}</option>`).join("");
    if (antes) elevenOption(antes, S.cfg && S.cfg.eleven_voice_name);
    toast(LG(`${r.voces.length} voces en tu cuenta: elige una y guarda`, `${r.voces.length} voices in your account: pick one and save`));
  } catch (e) { toast(e.message, true); } finally { busy(b, false); }
};

/* ── Ajustes → Clima ─────────────────────────────────────────────────────── */
function loadClima() {
  const f = $("#setForm");
  f.wx_pws_key.value = "";
  f.wx_pws_key.placeholder = S.cfg && S.cfg.wx_pws_key_set ? "•••••• " + LG("(guardada; escribe para cambiarla)", "(saved; type to change it)") : "";
  if (S.cfg && S.cfg.wx_pws_station) $("#wxPws").open = true;
  $("#wxEstado").textContent = S.cfg && S.cfg.wx_lat && S.cfg.wx_lon ? "" : LG("Falta la ubicación", "Location missing");
  $("#btnWxAqui").classList.toggle("hidden", !(window.isSecureContext && navigator.geolocation));
}
$("#btnWxAqui").onclick = () => {
  const b = $("#btnWxAqui"); busy(b, true, "…");
  navigator.geolocation.getCurrentPosition((p) => {
    busy(b, false);
    const f = $("#setForm");
    f.wx_lat.value = p.coords.latitude.toFixed(4); f.wx_lon.value = p.coords.longitude.toFixed(4);
    toast(LG("Ubicación de este navegador puesta: escribe cómo se dice el lugar y guarda", "This browser's location set: type how to say the place and save"));
  }, (e) => { busy(b, false); toast(LG("El navegador no dio la ubicación", "The browser didn't give the location") + (e && e.message ? ": " + e.message : ""), true); },
  { timeout: 15000 });
};
async function wxBuscar() {
  const b = $("#btnWxBuscar"), box = $("#wxLugares"); busy(b, true, "…");
  try {
    const r = await api("api/clima/buscar?idioma=" + (window.HAMNA_LANG || "es") + "&q=" + encodeURIComponent($("#wxBuscar").value));
    box.innerHTML = r.lugares.length ? r.lugares.map((l, i) => `<button type="button" class="wx-lugar" data-wxi="${i}"><b translate="no">${esc(l.nombre)}</b> <span class="muted" translate="no">${esc([l.region, l.pais].filter(Boolean).join(", "))} · ${l.lat}, ${l.lon}${l.poblacion ? " · " + l.poblacion.toLocaleString() + " " + LG("hab.", "pop.") : ""}</span></button>`).join("")
      : `<p class="muted">${LG("No encontré ese lugar. Prueba con otro nombre o escribe la latitud y la longitud.", "I couldn't find that place. Try another name or type the latitude and longitude.")}</p>`;
    box.classList.remove("hidden");
    S.wxLugares = r.lugares;
  } catch (e) { toast(e.message, true); } finally { busy(b, false); }
}
$("#btnWxBuscar").onclick = wxBuscar;
$("#wxBuscar").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); wxBuscar(); } });
$("#wxLugares").onclick = (e) => {
  const b = e.target.closest("[data-wxi]"); if (!b) return;
  const l = S.wxLugares[+b.dataset.wxi], f = $("#setForm");
  f.wx_lat.value = l.lat; f.wx_lon.value = l.lon; f.wx_lugar.value = l.nombre;
  $("#wxLugares").classList.add("hidden");
  toast(LG(`${l.nombre}: guarda para usarlo`, `${l.nombre}: save to use it`));
};
$("#btnWxProbar").onclick = async () => {
  const f = $("#setForm"), b = $("#btnWxProbar"), box = $("#wxPrueba"); busy(b, true, LG("Consultando…", "Checking…"));
  try {
    const r = await api("api/clima/probar", { method: "POST", json: { wx_lat: f.wx_lat.value, wx_lon: f.wx_lon.value, wx_lugar: f.wx_lugar.value,
      wx_unidades: f.wx_unidades.value, wx_pws_station: f.wx_pws_station.value, wx_pws_key: f.wx_pws_key.value } });
    $("#wxEstado").textContent = "✅ " + LG("Fuente", "Source") + ": " + r.fuente;
    box.innerHTML = (r.avisos.length ? `<p class="note warn">⚠ ${r.avisos.map(esc).join("<br>")}</p>` : "") +
      `<table class="wx-tabla"><tbody>${r.variables.map((v) => `<tr><td translate="no"><code>${esc(v.var)}</code></td><td translate="no">${v.dice ? "«" + esc(v.dice) + "»" : `<span class="muted">${LG("(sin dato)", "(no data)")}</span>`}</td></tr>`).join("")}</tbody></table>` +
      `<small class="muted">${LG("Así lo diría la voz ahora. Si cambiaste algo, guarda para que los anuncios lo usen.", "This is what the voice would say now. If you changed something, save so the announcements use it.")}</small>`;
    box.classList.remove("hidden");
  } catch (e) { $("#wxEstado").textContent = "⚠ " + e.message; box.classList.add("hidden"); } finally { busy(b, false); }
};
$("#setForm").tts_engine.addEventListener("change", vozVer);
$("#btnVoices").onclick = async () => {
  const f = $("#setForm"), b = $("#btnVoices"); busy(b, true, "…");
  try {
    const r = await api("api/azure/voces", { method: "POST", json: { azure_key: f.azure_key.value, azure_region: f.azure_region.value } });
    $("#azureVoices").innerHTML = r.voces.map((v) => `<option value="${esc(v.name)}">${esc(v.display)} · ${esc(v.locale)} · ${esc(v.gender)}</option>`).join("");
    toast(LG(`${r.voces.length} voces cargadas: escribe o elige una en «Voz»`, `${r.voces.length} voices loaded: type or pick one in «Voice»`));
  } catch (e) { toast(e.message, true); } finally { busy(b, false); }
};
$("#btnVozTest").onclick = async () => {
  const b = $("#btnVozTest"); busy(b, true, LG("Generando…", "Generating…"));
  try {
    const r = await api("api/anuncios/voz", { method: "POST", json: { texto: $("#vozTest").value } });
    const au = $("#vozTestAudio"); au.src = r.url; au.classList.remove("hidden"); au.play().catch(() => {});
  } catch (e) { toast(e.message, true); } finally { busy(b, false); }
};

/* ── Programación → Alertas (clima, pronóstico y sismos) ─────────────────── */
S.progSub = (() => { try { return localStorage.getItem("aslscan.progsub") || "anuncios"; } catch { return "anuncios"; } })();
function progSub(k) {
  S.progSub = k === "alertas" ? "alertas" : "anuncios";
  try { localStorage.setItem("aslscan.progsub", S.progSub); } catch {}
  $$("#progTabs [data-prog]").forEach((b) => { b.classList.toggle("active", b.dataset.prog === S.progSub); b.setAttribute("aria-selected", b.dataset.prog === S.progSub); });
  $("#anView").classList.toggle("hidden", S.progSub !== "anuncios");
  $("#alView").classList.toggle("hidden", S.progSub !== "alertas");
  $("#btnNewAnuncio").classList.toggle("hidden", S.progSub !== "anuncios" || !(S.an && S.an.asl && puedeAnunciar()));
}
$("#progTabs").onclick = (e) => { const b = e.target.closest("[data-prog]"); if (b) { progSub(b.dataset.prog); loadProg(); } };
const AL_U = (imp) => ({ vel: imp ? "mph" : "km/h", lluvia: imp ? "in/h" : "mm/h", presion: imp ? "inHg" : "hPa", temp: imp ? "°F" : "°C", mm: imp ? "in" : "mm" });
const AL_TIPO_U = { viento: "vel", racha: "vel", lluvia: "lluvia", presion: "presion", calor: "temp", frio: "temp" };
const AL_NOMBRE_EN = { "Viento": "Wind", "Rachas": "Gusts", "Lluvia": "Rain", "Calor": "Heat", "Frío": "Cold", "Presión (baja en 3 h)": "Pressure (drop in 3 h)",
  "Tormenta eléctrica": "Thunderstorm", "Lluvia fuerte": "Heavy rain", "Rachas fuertes": "Strong gusts" };
const alN = (t) => LG(t, AL_NOMBRE_EN[t] || t);
const alNum = (v, d = 1) => v == null ? "—" : (Math.round(v * Math.pow(10, d)) / Math.pow(10, d)).toLocaleString();
const alHace = (ts) => { if (!ts) return LG("todavía no", "not yet"); const m = Math.round((Date.now() / 1000 - ts) / 60); return m < 1 ? LG("hace un momento", "just now") : LG(`hace ${m} min`, `${m} min ago`); };
async function loadAlertas() {
  clearTimeout(S.anT);
  let d;
  try { d = await api("api/alertas"); } catch (e) { $("#alView").innerHTML = `<p class="empty">${esc(e.message)}</p>`; return; }
  S.al = d; renderAlertas();
  S.anT = setTimeout(() => { if (S.tab === "prog" && S.progSub === "alertas" && !document.hidden) loadAlertas(); }, 60000);
}
function renderAlertas() {
  const d = S.al, u = AL_U(d.imperial), act = d.activas, algo = act.clima || act.pronostico || act.sismos;
  $("#alCnt").textContent = algo ? "●" : "";
  const chip = (on, t) => `<span class="chip ${on ? "ok" : ""}">${on ? "✓" : "○"} ${t}</span>`;
  let h = "";
  if (!d.configurado) h += `<div class="note warn">${LG("Primero pon la ubicación en Ajustes → Clima: sin ella no hay alertas.", "First set the location in Settings → Weather: without it there are no alerts.")}</div>`;
  else if (!algo) h += `<div class="note">${LG("Las alertas están apagadas.", "Alerts are off.")} ${isAdmin() ? LG("Enciéndelas en Ajustes → Alertas.", "Turn them on in Settings → Alerts.") : LG("El administrador las enciende en Ajustes → Alertas.", "The administrator turns them on in Settings → Alerts.")}</div>`;
  h += `<div class="row gap wrap al-top">${chip(act.clima, LG("Clima de este momento", "Current weather"))}${chip(act.pronostico, LG("Pronóstico", "Forecast"))}${chip(act.sismos, LG("Sismos", "Earthquakes"))}
    <span class="muted">${LG("Clima y pronóstico solo de", "Weather and forecast only from")} ${esc(d.horario[0])} ${LG("a", "to")} ${esc(d.horario[1])}</span>
    ${puedeAnunciar() && d.configurado ? `<button type="button" class="btn sm" id="btnAlRevisar">↻ ${LG("Revisar ahora", "Check now")}</button>` : ""}</div>`;
  // Clima de este momento
  const c = d.clima, lec = c.lectura || {};
  const filas = (c.evaluacion || []).map((x) => `<tr class="${x.alerta ? "al-on" : ""}"><td>${esc(alN(x.nombre))}</td><td>${alNum(x.valor)} ${u[AL_TIPO_U[x.tipo]] || ""}</td>
    <td class="muted">${x.tipo === "frio" ? "≤" : "≥"} ${alNum(x.umbral)}</td><td>${x.alerta ? `<span class="chip warn">⚠ ${LG("pasó el límite", "over the limit")}</span>` : `<span class="chip ok">${LG("normal", "normal")}</span>`}</td></tr>`).join("");
  h += `<div class="cards al-cards"><div class="card"><h3>🌬 ${LG("Clima de este momento", "Current weather")}${d.lugar ? ` · <span translate="no">${esc(d.lugar)}</span>` : ""}</h3>
    ${c.error ? `<p class="note warn">⚠ ${esc(c.error)}</p>` : ""}
    ${lec.temp != null || lec.viento != null ? `<p class="al-lec">🌡 ${alNum(lec.temp)} ${u.temp} · 💧 ${alNum(lec.humedad, 0)} % · 🌬 ${alNum(lec.viento)} ${u.vel} (${LG("rachas", "gusts")} ${alNum(lec.racha)}) · ${alNum(lec.presion)} ${u.presion}${c.presion_3h != null && Math.abs(c.presion_3h) >= 0.05 ? ` (${c.presion_3h > 0 ? "▼" : "▲"} ${alNum(Math.abs(c.presion_3h))} ${LG("en 3 h", "in 3 h")})` : ""} · ☔ ${alNum(lec.lluvia)} ${u.lluvia}</p>` : ""}
    ${filas ? `<table class="al-tabla"><tbody>${filas}</tbody></table>` : `<p class="muted">${act.clima ? LG("Todavía no se revisa.", "Not checked yet.") : LG("Apagado.", "Off.")}</p>`}
    <p class="meta muted">${c.fuente ? LG("Fuente", "Source") + ": " + esc(c.fuente) + " · " : ""}${LG("Revisado", "Checked")} ${alHace(c.revisado)}</p></div>`;
  // Pronóstico
  const pr = d.pronostico || [];
  h += `<div class="card"><h3>⛈ ${LG("Pronóstico", "Forecast")}</h3>${!act.pronostico ? `<p class="muted">${LG("Apagado.", "Off.")}</p>` : !pr.length ? `<p class="muted">${LG("Nada fuera de lo normal en las próximas horas.", "Nothing out of the ordinary in the coming hours.")}</p>`
    : pr.map((p) => `<div class="al-ev"><b>${esc(alN(p.nombre))}</b> · ${anFecha(p.desde)} → ${(p.hasta || "").slice(11)}
      <div class="muted" translate="no">«${esc(p.texto)}»</div>
      <small class="muted">${LG("Avisos", "Alerts")}: ${p.avisos.map((a) => anFecha(a).slice(-5)).join(", ")} · ${LG(`ya salieron ${p.hechos}`, `${p.hechos} sent`)}</small></div>`).join("")}</div>`;
  // Sismos
  const sm = d.sismos, NIV = { cerca: LG("cercano", "nearby"), region: LG("región", "region"), mundo: LG("mundo", "world") };
  h += `<div class="card"><h3>🌎 ${LG("Sismos que cumplen tus límites (últimas 24 h)", "Earthquakes within your limits (last 24 h)")}</h3>
    ${sm.error ? `<p class="note warn">⚠ ${esc(sm.error)}</p>` : ""}
    ${!act.sismos && !sm.revisado ? `<p class="muted">${LG("Apagado.", "Off.")}</p>` : !sm.lista.length ? `<p class="muted">${LG("Ninguno.", "None.")}</p>`
    : `<table class="al-tabla"><tbody>${sm.lista.map((s) => `<tr><td><b>M${s.mag.toFixed(1)}</b></td><td translate="no">${esc(LG((s.lugar_es || s.lugar).replace(/^(en|a) /, ""), s.lugar))}${s.dist != null ? ` <span class="muted">· ${s.dist.toLocaleString()} km</span>` : ""}</td>
      <td class="muted">${new Date(s.t * 1000).toLocaleString([], { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td><td><span class="chip">${NIV[s.nivel]}</span>${s.avisado ? ` <span class="chip ok">✓ ${LG("avisado", "announced")}</span>` : ""}</td></tr>`).join("")}</tbody></table>`}
    <p class="meta muted">USGS · ${LG("Revisado", "Checked")} ${alHace(sm.revisado)}</p></div></div>`;
  // Historial
  const hi = d.historial || [];
  h += `<details class="an-logwrap" ${hi.length ? "" : "hidden"}><summary>${LG("Alertas enviadas", "Alerts sent")} (${hi.length})</summary><div>${hi.map((x) => `<div class="an-log-row ok"><span class="when">${anFecha(x.cuando)}</span><b translate="no">${esc(x.nombre)}</b><small class="muted" translate="no">${esc(x.texto)}</small></div>`).join("")}</div></details>
    <p class="muted al-nota">ⓘ ${LG("Si una alerta sale, queda también en la bitácora de anuncios (✓ salió, ⚠ canal ocupado, ✗ error).", "When an alert goes out it is also in the announcement log (✓ went out, ⚠ channel busy, ✗ error).")}</p>`;
  const abierto = $("#alView details") && $("#alView details").open;
  $("#alView").innerHTML = h;
  if (abierto && $("#alView details")) $("#alView details").open = true;
  const rb = $("#btnAlRevisar");
  if (rb) rb.onclick = async () => {
    busy(rb, true, LG("Revisando…", "Checking…"));
    try { S.al = await api("api/alertas/revisar", { method: "POST" }); renderAlertas(); } catch (e) { toast(e.message, true); busy(rb, false); }
  };
}

/* ── Ajustes → Alertas ───────────────────────────────────────────────────── */
async function loadAlertasSet() {
  const imp = S.cfg && S.cfg.wx_unidades === "imperial", u = AL_U(imp);
  $$("#setForm .al-u").forEach((x) => (x.textContent = u[x.dataset.u] || ""));
  $("#alSinUbic").classList.toggle("hidden", !!(S.cfg && S.cfg.wx_lat && S.cfg.wx_lon));
  try { S.alEj = (await api("api/alertas")).ejemplos; } catch {}
}
$("#btnAlEj").onclick = async () => {
  const b = $("#btnAlEj"), t = (S.alEj || {})[$("#alEjTipo").value]; if (!t) return;
  busy(b, true, LG("Generando…", "Generating…"));
  try {
    const r = await api("api/anuncios/voz", { method: "POST", json: { texto: t } });
    const au = $("#alEjAudio"); au.src = r.url; au.classList.remove("hidden"); au.play().catch(() => {});
  } catch (e) { toast(e.message, true); } finally { busy(b, false); }
};

/* ── Ajustes → DTMF (funciones de rpt.conf) ──────────────────────────────── */
const DTMF_TIPOS = [["cmd", "Ejecutar un comando o script", "Run a command or script"], ["ilink", "Enlaces (conectar, desconectar…)", "Links (connect, disconnect…)"],
  ["status", "Información (ID, hora, versión…)", "Information (ID, time, version…)"], ["cop", "Operación del nodo", "Node operation"],
  ["macro", "Macro", "Macro"], ["localplay", "Reproducir un audio (solo local)", "Play an audio file (local only)"],
  ["playback", "Reproducir un audio (también a los enlaces)", "Play an audio file (also to links)"],
  ["autopatchup", "Autopatch: descolgar", "Autopatch: off hook"], ["autopatchdn", "Autopatch: colgar", "Autopatch: hang up"], ["remote", "Base remota", "Remote base"]];
const DTMF_EN = {
  "Desconecta un enlace (marca después el número de nodo)": "Disconnects a link (dial the node number after it)", "Conecta un nodo solo en monitor (marca después el número)": "Connects a node in monitor only (dial the number after it)",
  "Conecta un nodo en transceptor (marca después el número)": "Connects a node in transceive (dial the number after it)", "Entra al modo de comandos de un enlace": "Enters command mode on a link",
  "Dice el estado del sistema (enlaces)": "Says the system status (links)", "Desconecta todos los enlaces": "Disconnects all links", "Dice el último nodo que transmitió": "Says the last node that keyed up",
  "Conecta un nodo en monitor local (marca después el número)": "Connects a node in local monitor (dial the number after it)", "Dice el estado completo (todos los nodos)": "Says the full status (all nodes)",
  "Identificación (a toda la red)": "ID (whole network)", "Dice la hora (a toda la red)": "Says the time (whole network)", "Dice la versión (a toda la red)": "Says the version (whole network)",
  "Identificación (solo local)": "ID (local only)", "Dice la hora (solo local)": "Says the time (local only)", "Dice la versión (solo local)": "Says the version (local only)",
  "Dice el último usuario de DTMF (a toda la red)": "Says the last DTMF user (whole network)", "Dice la ubicación GPS (a toda la red)": "Says the GPS location (whole network)",
  "Descuelga el autopatch (llamada telefónica)": "Autopatch off hook (phone call)", "Cuelga el autopatch": "Autopatch hang up", "Loro una vez (graba y repite)": "Parrot once (records and repeats)",
  "Macro (marca después el número de la macro)": "Macro (dial the macro number after it)",
  "Manda un mensaje de texto": "Sends a text message",
  "Desconecta los enlaces RANGER": "Disconnects RANGER links",
  "Desconecta un enlace permanente (marca después el número)": "Disconnects a permanent link (dial the number after it)",
  "Conecta permanente en monitor (marca después el número)": "Permanently connects in monitor (dial the number after it)",
  "Conecta permanente en transceptor (marca después el número)": "Permanently connects in transceive (dial the number after it)",
  "Reconecta los enlaces que se desconectaron con «desconectar todos»": "Reconnects the links dropped with «disconnect all»",
  "Conecta permanente en monitor local (marca después el número)": "Permanently connects in local monitor (dial the number after it)",
  "Dice la ubicación GPS (solo local)": "Says the GPS location (local only)",
  "Dice el último usuario de DTMF (solo local)": "Says the last DTMF user (local only)",
  "Reinicio del sistema (warm boot)": "System warm boot",
  "Habilita el sistema": "Enables the system",
  "Deshabilita el sistema": "Disables the system",
  "Tono de prueba (prende/apaga)": "Test tone (on/off)",
  "Muestra las variables del sistema": "Dumps system variables",
  "PTT (modo teléfono)": "PTT (phone mode)",
  "Habilita el límite de tiempo de transmisión": "Enables the time-out timer",
  "Deshabilita el límite de tiempo de transmisión": "Disables the time-out timer",
  "Habilita el autopatch": "Enables autopatch",
  "Deshabilita el autopatch": "Disables autopatch",
  "Habilita los enlaces": "Enables links",
  "Deshabilita los enlaces": "Disables links",
  "Dice el estado del sistema": "Says the system state",
  "Cambia el estado del sistema": "Changes the system state",
  "Habilita el programador": "Enables the scheduler",
  "Deshabilita el programador": "Disables the scheduler",
  "Habilita las funciones de usuario": "Enables user functions",
  "Deshabilita las funciones de usuario": "Disables user functions",
  "Cola de transmisión alterna": "Alternate hang time",
  "Cola de transmisión normal": "Standard hang time",
  "Habilita el loro (parrot)": "Enables parrot",
  "Deshabilita el loro (parrot)": "Disables parrot",
  "Loro una vez": "Parrot once",
  "Vacía la cola de telemetría": "Flushes the telemetry queue",
  "Prueba de tonos DTMF": "DTMF touch-tone test",
  "Deshabilita la telemetría local": "Disables local telemetry",
  "Habilita la telemetría local": "Enables local telemetry",
  "Telemetría local apagada": "Local telemetry off",
  "Telemetría local encendida": "Local telemetry on",
  "Anuncio de EchoLink": "EchoLink announcement",
  "No acepta conexiones entrantes": "Refuses incoming connections",
  "Acepta conexiones entrantes": "Accepts incoming connections",
  "Atajo de ASLSCAN": "ASLSCAN shortcut",
  "Dice la ubicación GPS (a toda la red)": "Says the GPS location (whole network)",
};
const dtmfQue = (t) => LG(t, DTMF_EN[t] || t.replace(/^Ejecuta /, "Runs ").replace(/^Reproduce el audio /, "Plays ").replace(/^Ejecuta la macro /, "Runs macro "));
async function loadDtmf() {
  const box = $("#dtmfBox");
  let st;
  try { st = await api("api/dtmf"); } catch (e) { box.innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
  S.dtmf = st; renderDtmf();
  if (st.aplicando && st.aplicando.estado === "aplicando") setTimeout(() => { if (S.setSec === "dtmf") loadDtmf(); }, 3000);
}
function renderDtmf() {
  const box = $("#dtmfBox"), st = S.dtmf;
  if (!st.disponible) { box.innerHTML = `<p class="muted">${esc(st.motivo || "")}</p>`; return; }
  const ap = st.aplicando || {}, fc = st.funcchar || "*";
  let h = "";
  if (ap.estado === "aplicando") h += `<div class="upd-box new"><b>⏳ ${esc(ap.mensaje)}</b><div class="muted" style="font-size:.84rem">${LG("Los enlaces se cortan unos segundos y se reconectan solos.", "Links drop for a few seconds and reconnect by themselves.")}</div></div>`;
  else if (st.pendiente) h += `<div class="upd-box new"><div class="upd-head"><div><b>⚠ ${LG("Hay cambios guardados en rpt.conf que todavía no se aplican", "There are saved changes in rpt.conf not applied yet")}</b>
      <div class="muted" style="font-size:.84rem">${LG("Los códigos nuevos funcionan cuando Asterisk se reinicia. Los enlaces se cortan unos segundos y se reconectan solos.", "New codes work once Asterisk restarts. Links drop for a few seconds and reconnect by themselves.")}</div></div>
      ${st.puede_aplicar ? `<button type="button" class="btn sm primary" id="btnDtmfAplicar">${LG("Aplicar ahora (reinicia Asterisk)", "Apply now (restarts Asterisk)")}</button>` : `<span class="muted">${LG("Reinicia Asterisk desde la terminal: sudo systemctl restart asterisk", "Restart Asterisk from the terminal: sudo systemctl restart asterisk")}</span>`}</div></div>`;
  else if (ap.estado === "ok" || ap.estado === "error") h += `<div class="upd-box${ap.estado === "error" ? " new" : ""}"><b>${ap.estado === "ok" ? "✅" : "❌"} ${esc(ap.mensaje)}</b></div>`;
  const notas = [];
  if (st.link_functions === st.seccion) notas.push(LG("Estos códigos también se pueden marcar desde un nodo enlazado (link_functions usa la misma sección).", "These codes can also be dialed from a linked node (link_functions uses the same section)."));
  if (st.compartida.length) notas.push(LG(`La sección [${st.seccion}] también la usa el nodo ${st.compartida.join(", ")}: los cambios valen para todos.`, `Section [${st.seccion}] is also used by node ${st.compartida.join(", ")}: changes apply to all of them.`));
  h += `<p class="muted dtmf-sec">${LG("Sección del nodo", "Node section")}: <code translate="no">[${esc(st.seccion)}]</code>${st.plantillas.length ? ` · ${LG("plantilla", "template")}: <code translate="no">[${st.plantillas.map(esc).join("], [")}]</code>` : ""}${notas.length ? "<br>ⓘ " + notas.join("<br>ⓘ ") : ""}</p>`;
  // Atajos de ASLSCAN
  const at = st.atajos || {};
  h += `<div class="card dtmf-atajos"><h3>☎ ${LG("Atajos de ASLSCAN", "ASLSCAN shortcuts")}</h3>
    <div class="grid2"><label>🌤 ${LG("Clima ahora (reporte del clima)", "Weather now (weather report)")}<div class="dtmf-cod"><span>${esc(fc)}</span><input id="dtmfClima" value="${esc(at.clima || "")}" maxlength="8" placeholder="${LG("sin código", "no code")}" spellcheck="false" autocapitalize="characters"></div></label>
      <label>🌎 ${LG("Sismos recientes (últimas 24 h)", "Recent earthquakes (last 24 h)")}<div class="dtmf-cod"><span>${esc(fc)}</span><input id="dtmfSismos" value="${esc(at.sismos || "")}" maxlength="8" placeholder="${LG("sin código", "no code")}" spellcheck="false" autocapitalize="characters"></div></label></div>
    <div class="row gap wrap"><button type="button" class="btn sm primary" id="btnDtmfAtajos">${LG("Guardar atajos", "Save shortcuts")}</button>
      <small class="muted">${LG("Los sismos usan los límites de Ajustes → Alertas. Un anuncio recibe su código en su editor (Programación → Anuncios).", "Earthquakes use the limits in Settings → Alerts. An announcement gets its code in its editor (Schedule → Announcements).")}</small></div>
    ${(at.anuncios || []).length ? `<p class="muted dtmf-an">📢 ${at.anuncios.map((a) => `<b>${esc(fc + a.dtmf)}</b> <span translate="no">${esc(a.nombre)}</span>`).join(" · ")}</p>` : ""}</div>`;
  // Tabla
  const q = (S.dtmfQ || "").toLowerCase();
  const filas = st.comandos.filter((c) => !q || (c.codigo + " " + c.que + " " + c.valor + " " + c.comentario).toLowerCase().includes(q));
  h += `<div class="row gap wrap dtmf-barra"><input id="dtmfBuscar" placeholder="${LG("Buscar código o función…", "Search code or function…")}" value="${esc(S.dtmfQ || "")}"><button type="button" class="btn sm primary" id="btnDtmfNuevo">＋ ${LG("Agregar comando", "Add command")}</button></div>
    <div class="dtmf-lista">${filas.map((c) => `<div class="dtmf-fila ${c.propio ? "propio" : ""}">
      <div class="dtmf-codigo" translate="no">${esc(fc + c.codigo)}</div>
      <div class="dtmf-que"><b>${esc(dtmfQue(c.que))}</b>
        <div class="muted" translate="no"><code>${esc(c.valor)}</code>${c.comentario && !c.aslscan ? " · " + esc(c.comentario) : ""}</div>
        <div class="dtmf-chips">${c.aslscan ? `<span class="chip asl">ASLSCAN</span>` : c.propio ? `<span class="chip ok">${LG("este nodo", "this node")}</span>` : `<span class="chip">${LG("plantilla", "template")}</span>`}
          ${c.reemplaza ? `<span class="chip warn" title="${esc(c.reemplaza)}">${LG("reemplaza a la plantilla", "overrides the template")}</span>` : ""}
          ${c.cuidado ? `<span class="chip warn">⚠ ${LG("con cuidado", "careful")}</span>` : ""}
          ${c.choca ? `<span class="chip warn">⚠ ${LG("choca con", "clashes with")} ${esc(fc + c.choca)}</span>` : ""}</div></div>
      <div class="dtmf-acc"><button type="button" class="btn sm" data-dprobar="${esc(c.codigo)}" title="${LG("Ejecutarlo como si lo marcaran desde el radio", "Run it as if dialed from the radio")}">▶ ${LG("Probar", "Test")}</button>
        ${c.propio && !c.aslscan ? `<button type="button" class="btn sm" data-deditar="${esc(c.codigo)}" title="${LG("Editar", "Edit")}">✏️</button><button type="button" class="btn sm ghost" data-dborrar="${esc(c.codigo)}" title="${LG("Borrar", "Delete")}">🗑</button>`
          : !c.propio ? `<button type="button" class="btn sm ghost" data-dreemplazar="${esc(c.codigo)}" title="${LG("Poner otra función con este código en tu nodo", "Put another function with this code in your node")}">✏️</button>` : ""}</div></div>`).join("") || `<p class="muted">${LG("Nada coincide.", "Nothing matches.")}</p>`}</div>`;
  const foco = document.activeElement && document.activeElement.id === "dtmfBuscar";
  box.innerHTML = h;
  if (foco) { const i = $("#dtmfBuscar"); i.focus(); i.selectionStart = i.selectionEnd = i.value.length; }
}
function dtmfEditor(c, reemplazar) {
  const st = S.dtmf, fc = st.funcchar || "*", nuevo = !c || reemplazar;
  const partes = c ? c.valor.split(",") : ["cmd"], tipo0 = (partes[0] || "cmd").toLowerCase(), args0 = partes.slice(1).join(",");
  const cat = st.catalogo || {};
  openModal(reemplazar ? LG(`Cambiar ${fc}${c.codigo} en tu nodo`, `Change ${fc}${c.codigo} in your node`) : nuevo ? LG("Agregar comando DTMF", "Add DTMF command") : LG(`Editar ${fc}${c.codigo}`, `Edit ${fc}${c.codigo}`), `<form id="dtmfForm" autocomplete="off">
    ${reemplazar ? `<p class="muted">${LG(`En la plantilla [${esc(c.origen)}] ${fc}${esc(c.codigo)} hace: «${esc(dtmfQue(c.que))}». Lo que pongas aquí lo reemplaza solo en tu nodo; la plantilla no se toca.`, `In template [${esc(c.origen)}] ${fc}${esc(c.codigo)} does: «${esc(dtmfQue(c.que))}». What you put here replaces it only in your node; the template isn't touched.`)}</p>` : ""}
    <label>${LG("Código", "Code")}<div class="dtmf-cod"><span>${esc(fc)}</span><input name="codigo" value="${esc(c ? c.codigo : "")}" maxlength="8" required spellcheck="false" autocapitalize="characters" ${reemplazar ? "readonly" : ""}></div><small>${LG("Teclas 0-9 y A-D, hasta 8. No puede ser el principio de otro código ni al revés (*8 chocaría con *81).", "Keys 0-9 and A-D, up to 8. It can't be the start of another code or the other way around (*8 would clash with *81).")}</small></label>
    <label>${LG("Qué hace", "What it does")}<select name="tipo">${DTMF_TIPOS.map(([v, es, en]) => `<option value="${v}" ${v === tipo0 ? "selected" : ""}>${esc(LG(es, en))}</option>`).join("")}</select></label>
    <div id="dtmfArgs"></div>
    <label>${LG("Comentario (opcional)", "Comment (optional)")}<input name="comentario" maxlength="120" value="${esc(c && !reemplazar ? c.comentario : "")}"></label>
    <div class="modal-actions"><button type="button" class="btn" id="dtmfCancel">${LG("Cancelar", "Cancel")}</button><button class="btn primary">${LG("Guardar en rpt.conf", "Save to rpt.conf")}</button></div></form>`);
  const f = $("#dtmfForm");
  const pinta = (tipo, args) => {
    const opts = cat[tipo];
    let html;
    if (opts) {
      const num = (args || "").split(",")[0];
      html = `<label>${LG("Función", "Function")}<select name="args">${Object.entries(opts).map(([k, v]) => `<option value="${k}" ${k === num ? "selected" : ""}>${tipo} ${k} · ${esc(dtmfQue(v))}</option>`).join("")}
        ${num && !opts[num] ? `<option value="${esc(args)}" selected>${esc(args)}</option>` : ""}</select></label>`;
    } else if (tipo === "cmd") html = `<label>${LG("Comando o script", "Command or script")}<input name="args" value="${esc(args || "")}" placeholder="/usr/local/sbin/saytime.pl ${esc(st.nodo)}" spellcheck="false"><small>${LG("Se ejecuta con el usuario de Asterisk. Sin «;».", "It runs as the Asterisk user. No «;».")}</small></label>`;
    else if (tipo === "localplay" || tipo === "playback") html = `<label>${LG("Audio (ruta sin extensión)", "Audio (path without extension)")}<input name="args" value="${esc(args || "")}" placeholder="/var/lib/asterisk/sounds/custom/aviso" spellcheck="false"></label>`;
    else html = `<label>${LG("Opciones (opcional)", "Options (optional)")}<input name="args" value="${esc(args || "")}" spellcheck="false"></label>`;
    $("#dtmfArgs").innerHTML = html;
  };
  pinta(tipo0, args0);
  f.tipo.onchange = () => pinta(f.tipo.value, "");
  $("#dtmfCancel").onclick = closeModal;
  f.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await run(() => api("api/dtmf", { method: "POST", json: { codigo: f.codigo.value, tipo: f.tipo.value, args: f.args ? f.args.value : "",
        comentario: f.comentario.value, antes: c && !reemplazar ? c.codigo : "" } }), LG("Guardado en rpt.conf", "Saved to rpt.conf"));
      closeModal(); S.dtmf = r.estado; renderDtmf();
    } catch {}
  };
}
$("#dtmfBox").addEventListener("input", (e) => { if (e.target.id === "dtmfBuscar") { S.dtmfQ = e.target.value; renderDtmf(); } });
$("#dtmfBox").addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  const st = S.dtmf, fc = st.funcchar || "*", cod = b.dataset.dprobar || b.dataset.deditar || b.dataset.dborrar || b.dataset.dreemplazar;
  const c = st.comandos.find((x) => x.codigo === cod);
  if (b.id === "btnDtmfNuevo") return dtmfEditor(null);
  if (b.dataset.deditar) return dtmfEditor(c);
  if (b.dataset.dreemplazar) return dtmfEditor(c, true);
  if (b.dataset.dborrar) {
    if (!(await confirmBox(LG(`¿Borrar ${fc}${cod} («${dtmfQue(c.que)}») de rpt.conf? Se guarda una copia antes.`, `Delete ${fc}${cod} («${dtmfQue(c.que)}») from rpt.conf? A copy is saved first.`), LG("Borrar", "Delete")))) return;
    try { const r = await run(() => api("api/dtmf/" + encodeURIComponent(cod), { method: "DELETE" }), LG("Borrado de rpt.conf", "Deleted from rpt.conf")); S.dtmf = r.estado; renderDtmf(); } catch {}
    return;
  }
  if (b.dataset.dprobar) {
    if (!(await confirmBox(LG(`Se va a ejecutar ${fc}${cod} («${dtmfQue(c.que)}») como si lo marcaran desde el radio${c.cuidado ? ". ⚠ Este comando puede afectar el nodo" : ""}. Si es nuevo y no has aplicado los cambios, Asterisk todavía no lo conoce. ¿Continuar?`,
      `${fc}${cod} («${dtmfQue(c.que)}») will run as if dialed from the radio${c.cuidado ? ". ⚠ This command can affect the node" : ""}. If it's new and you haven't applied the changes, Asterisk doesn't know it yet. Continue?`), LG("Ejecutar", "Run")))) return;
    try { await run(() => api("api/dtmf/probar", { method: "POST", json: { codigo: cod } }), LG(`${fc}${cod} enviado al nodo`, `${fc}${cod} sent to the node`)); } catch {}
    return;
  }
  if (b.id === "btnDtmfAtajos") {
    try { const r = await run(() => api("api/dtmf/atajos", { method: "POST", json: { clima: $("#dtmfClima").value, sismos: $("#dtmfSismos").value } }), LG("Atajos guardados", "Shortcuts saved")); S.dtmf = r.estado; renderDtmf(); } catch {}
    return;
  }
  if (b.id === "btnDtmfAplicar") {
    if (!(await confirmBox(LG("Se va a reiniciar Asterisk para que tome los comandos DTMF. Los enlaces se cortan unos segundos y se reconectan solos. Si el nodo no vuelve, se regresa la configuración anterior. ¿Continuar?",
      "Asterisk will restart to load the DTMF commands. Links drop for a few seconds and reconnect by themselves. If the node doesn't come back, the previous configuration is restored. Continue?"), LG("Reiniciar Asterisk", "Restart Asterisk")))) return;
    try { await api("api/dtmf/aplicar", { method: "POST" }); } catch (err) { return toast(err.message, true); }
    loadDtmf();
  }
});

const PRON_VOZ = "api/anuncios/voz";      // dónde se oye la prueba
/* ── Ajustes → Voz: diccionario de pronunciación ─────────────────────────────
   «Escrito» → «Cómo se dice». Se edita aquí y se guarda con su propio botón;
   las pruebas usan la lista tal como está en pantalla, aunque no se haya guardado. */
const pronLimpia = () => (S.pron ? S.pron.lista : []).map((x) => ({ e: (x.e || "").trim().replace(/\s+/g, " "), d: (x.d || "").trim().replace(/\s+/g, " "), i: !!x.i })).filter((x) => x.e || x.d);
const pronSucio = () => S.pron && JSON.stringify(pronLimpia()) !== S.pron.guardada;
async function loadPron() {
  const box = $("#pronBox"); if (!box) return;
  try {
    const r = await api("api/pronuncia");
    S.pron = { lista: r.lista.map((x) => ({ e: x.e, d: x.d, i: !!x.i })), guardada: JSON.stringify(r.lista), max: r.max };
  } catch (e) { box.innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
  box.innerHTML = `<h3>${LG("Diccionario de pronunciación", "Pronunciation dictionary")}</h3>
    <p class="muted pron-ayuda">${LG("Cómo debe decir la voz las siglas y palabras difíciles. Se aplica a todo lo que dice la voz (secciones, anuncios y pruebas); lo escrito no cambia. Solo palabras completas y primero los términos más largos.",
      "How the voice should say acronyms and tricky words. It applies to everything the voice says (sections, announcements and tests); what's written doesn't change. Whole words only, longest terms first.")}
      <b>Aa</b> = ${LG("ignorar mayúsculas (si no está marcada, «WSPR» cambia pero «wspr» no)", "ignore case (unchecked: «WSPR» changes but «wspr» doesn't)")}.</p>
    <div class="pron-head" aria-hidden="true"><span>${LG("Escrito", "Written")}</span><span>${LG("Cómo se dice", "How it's said")}</span><span title="${LG("Ignorar mayúsculas", "Ignore case")}">Aa</span><span></span></div>
    <div id="pronRows"></div>
    <div class="row gap wrap pron-acc">
      <button type="button" class="btn sm" id="pronAdd">＋ ${LG("Agregar", "Add")}</button>
      <button type="button" class="btn sm" id="pronPaste">📋 ${LG("Pegar lista", "Paste list")}</button>
      <button type="button" class="btn sm" id="pronCopy">⧉ ${LG("Copiar lista", "Copy list")}</button>
      <span class="muted" id="pronCnt"></span>
    </div>
    <label>${LG("Probar un texto", "Try a text")}<input id="pronTest" value="${esc(S.pronTest || LG("Esta noche escuchamos WSPR y FT8 desde ON4KST.", "Tonight we listen to WSPR and FT8 from ON4KST."))}" spellcheck="false"></label>
    <div class="pron-out"><span class="muted">${LG("La voz recibe", "The voice gets")}:</span> <span id="pronOut" translate="no"></span></div>
    <div class="row gap wrap"><button type="button" class="btn sm" id="pronPlay">▶ ${LG("Escuchar", "Listen")}</button><audio id="pronAudio" class="hidden" controls></audio></div>
    <div class="row gap wrap pron-save"><button type="button" class="btn primary" id="pronSave">${LG("Guardar diccionario", "Save dictionary")}</button><span class="muted" id="pronMsg"></span></div>`;
  S.pron.lista.sort((a, b) => a.e.localeCompare(b.e, undefined, { sensitivity: "base" }));
  pronFilas(); pronProbar();
}
function pronFilas() {
  const l = S.pron.lista;
  $("#pronRows").innerHTML = l.length ? l.map((x, i) => `<div class="pron-row" data-i="${i}">
      <input data-k="e" value="${esc(x.e)}" maxlength="80" spellcheck="false" placeholder="${LG("p. ej. WSPR", "e.g. WSPR")}" translate="no">
      <input data-k="d" value="${esc(x.d)}" maxlength="200" spellcheck="false" placeholder="${LG("p. ej. uísper", "e.g. whisper")}" translate="no">
      <label class="pron-aa" title="${LG("Ignorar mayúsculas", "Ignore case")}"><input type="checkbox" data-k="i" ${x.i ? "checked" : ""}><span class="pron-aa-t">Aa</span></label>
      <span class="pron-btns"><button type="button" class="btn sm ghost" data-pplay="${i}" title="${LG("Escuchar este término", "Listen to this term")}">▶</button><button type="button" class="btn sm ghost" data-pdel="${i}" title="${LG("Quitar", "Remove")}">🗑</button></span>
    </div>`).join("")
    : `<p class="muted">${LG("Todavía no hay términos. Agrega uno o pega una lista.", "No terms yet. Add one or paste a list.")}</p>`;
  pronEstado();
}
function pronEstado() {
  const n = pronLimpia().length, sucio = pronSucio();
  $("#pronCnt").textContent = LG(`${n} de ${S.pron.max} términos`, `${n} of ${S.pron.max} terms`);
  $("#pronSave").disabled = !sucio;
  $("#pronMsg").textContent = sucio ? LG("Cambios sin guardar", "Unsaved changes") : "";
}
let pronT = null;
function pronProbar() {
  clearTimeout(pronT);
  pronT = setTimeout(async () => {
    const t = $("#pronTest"); if (!t) return;
    S.pronTest = t.value;
    try {
      const r = await api("api/pronuncia/probar", { method: "POST", json: { texto: t.value, diccionario: pronLimpia() } });
      $("#pronOut").innerHTML = `«${esc(r.texto)}»` + (r.usados.length ? ` <span class="muted">· ${LG("cambió", "changed")}: ${r.usados.map(esc).join(", ")}</span>` : "");
    } catch (e) { $("#pronOut").textContent = "⚠ " + e.message; }
  }, 300);
}
async function pronOir(texto, btn) {
  busy(btn, true, "…");
  try {
    const r = await api(PRON_VOZ, { method: "POST", json: { texto, diccionario: pronLimpia() } });
    const a = $("#pronAudio"); a.src = r.url; a.classList.remove("hidden"); a.play().catch(() => {});
  } catch (e) { toast(e.message, true); } finally { busy(btn, false); }
}
/* Lista en texto: «escrito = cómo se dice», y « | Aa» al final para ignorar mayúsculas */
function pronTexto(l) { return l.map((x) => `${x.e} = ${x.d}${x.i ? " | Aa" : ""}`).join("\n"); }
function pronLeer(txt) {
  const ok = [], mal = [];
  txt.split(/\r?\n/).forEach((linea, n) => {
    const s = linea.trim(); if (!s || s.startsWith("#")) return;
    let i = false, t = s;
    const m = t.match(/\s*\|\s*aa\s*$/i); if (m) { i = true; t = t.slice(0, m.index); }
    const p = t.match(/^(.+?)\s*(?:=|→|->|\t)\s*(.+)$/);
    if (!p || !p[1].trim() || !p[2].trim()) mal.push(`${n + 1}: ${s}`);
    else ok.push({ e: p[1].trim().replace(/\s+/g, " "), d: p[2].trim().replace(/\s+/g, " "), i });
  });
  return { ok, mal };
}
document.addEventListener("input", (e) => {
  if (!e.target.closest("#pronBox")) return;
  if (e.target.id === "pronTest") return pronProbar();
  const row = e.target.closest(".pron-row"); if (!row) return;
  const x = S.pron.lista[+row.dataset.i], k = e.target.dataset.k;
  if (k === "i") x.i = e.target.checked; else if (k) x[k] = e.target.value;
  pronEstado(); pronProbar();
});
document.addEventListener("change", (e) => {
  const c = e.target.closest("#pronBox .pron-row [data-k=i]"); if (!c) return;
  S.pron.lista[+c.closest(".pron-row").dataset.i].i = c.checked; pronEstado(); pronProbar();
});
// Enter en la tabla no debe mandar el formulario de Ajustes
document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.closest("#pronBox") && e.target.tagName === "INPUT") e.preventDefault(); });
document.addEventListener("click", async (e) => {
  const b = e.target.closest("#pronBox button"); if (!b) return;
  if (b.id === "pronAdd") {
    if (pronLimpia().length >= S.pron.max) return toast(LG(`Máximo ${S.pron.max} términos`, `${S.pron.max} terms maximum`), true);
    S.pron.lista.push({ e: "", d: "", i: false }); pronFilas();
    const r = $$("#pronRows .pron-row"); r[r.length - 1].querySelector("input").focus();
    return;
  }
  if (b.dataset.pdel) { S.pron.lista.splice(+b.dataset.pdel, 1); pronFilas(); pronProbar(); return; }
  if (b.dataset.pplay) {
    const x = S.pron.lista[+b.dataset.pplay];
    if (!x.e.trim()) return;
    return pronOir(x.e, b);
  }
  if (b.id === "pronPlay") return pronOir($("#pronTest").value, b);
  if (b.id === "pronCopy") {
    const t = pronTexto(pronLimpia());
    try { await navigator.clipboard.writeText(t); toast(LG("Lista copiada", "List copied")); }
    catch {
      openModal(LG("Copiar lista", "Copy list"), `<textarea rows="12" readonly style="width:100%" id="pronCopiaTxt">${esc(t)}</textarea>
        <div class="modal-actions"><button type="button" class="btn" onclick="closeModal()">${LG("Cerrar", "Close")}</button></div>`);
      $("#pronCopiaTxt").select();
    }
    return;
  }
  if (b.id === "pronPaste") return pronPegar();
  if (b.id === "pronSave") {
    busy(b, true, LG("Guardando…", "Saving…"));
    try {
      const r = await api("api/pronuncia", { method: "PUT", json: { lista: pronLimpia() } });
      S.pron.lista = r.lista.map((x) => ({ e: x.e, d: x.d, i: !!x.i })); S.pron.guardada = JSON.stringify(r.lista); S.info = null;
      S.pron.lista.sort((p, q) => p.e.localeCompare(q.e, undefined, { sensitivity: "base" }));
      pronFilas();
      const rehace = r.secciones.length + r.anuncios.length;
      toast(LG("Diccionario guardado", "Dictionary saved") + (rehace ? " · " + (rehace === 1 ? LG("se vuelve a generar 1 voz", "1 voice is being regenerated") : LG(`se vuelven a generar ${rehace} voces`, `${rehace} voices are being regenerated`)) : ""));
      if (rehace) $("#pronMsg").textContent = LG("Volviendo a generar", "Regenerating") + ": " + r.secciones.concat(r.anuncios).join(", ");
    } catch (err) { toast(err.message, true); } finally { busy(b, false); pronEstado(); }
  }
});
function pronPegar() {
  openModal(LG("Pegar lista", "Paste list"), `<p class="muted" style="margin-top:0">${LG("Un término por renglón:", "One term per line:")} <code>WSPR = uísper</code> · ${LG("agrega", "add")} <code>| Aa</code> ${LG("al final para ignorar mayúsculas. Si un término ya existe, se reemplaza.", "at the end to ignore case. If a term already exists, it's replaced.")}</p>
    <textarea id="pronPegarTxt" rows="10" style="width:100%" spellcheck="false" placeholder="ON4KST = o ene cuatro ka ese te&#10;iGates = ai géits | Aa&#10;CTCSS = ce te ce ese ese"></textarea>
    <p class="muted" id="pronPegarRes"></p>
    <div class="modal-actions"><button type="button" class="btn" id="pronPegarNo">${LG("Cancelar", "Cancel")}</button><button type="button" class="btn primary" id="pronPegarSi" disabled>${LG("Agregar a la tabla", "Add to the table")}</button></div>`);
  const ta = $("#pronPegarTxt"), res = $("#pronPegarRes"), si = $("#pronPegarSi");
  let leido = { ok: [], mal: [] };
  ta.oninput = () => {
    leido = pronLeer(ta.value);
    const clave = (x) => (x.i ? x.e.toLowerCase() : x.e);
    const ya = new Map(pronLimpia().map((x) => [clave(x), x]));
    const nuevos = leido.ok.filter((x) => !ya.has(clave(x))).length, cambian = leido.ok.filter((x) => ya.has(clave(x)) && ya.get(clave(x)).d !== x.d).length;
    res.innerHTML = leido.ok.length || leido.mal.length ? `✅ ${LG(`${nuevos} nuevos`, `${nuevos} new`)} · ✏️ ${LG(`${cambian} cambian`, `${cambian} change`)}` +
      (leido.mal.length ? `<br>⚠ ${LG("No entendí estos renglones", "I didn't understand these lines")}:<br><code>${leido.mal.map(esc).join("<br>")}</code>` : "") : "";
    si.disabled = !leido.ok.length;
  };
  $("#pronPegarNo").onclick = closeModal;
  si.onclick = () => {
    const clave = (x) => (x.i ? x.e.toLowerCase() : x.e);
    for (const x of leido.ok) {
      const j = S.pron.lista.findIndex((y) => clave({ e: y.e.trim(), i: y.i }) === clave(x));
      if (j >= 0) S.pron.lista[j] = x; else S.pron.lista.push(x);
    }
    S.pron.lista = S.pron.lista.filter((x) => x.e.trim() || x.d.trim());
    if (S.pron.lista.length > S.pron.max) toast(LG(`Quedaron más de ${S.pron.max} términos: quita algunos antes de guardar`, `More than ${S.pron.max} terms: remove some before saving`), true);
    S.pron.lista.sort((p, q) => p.e.localeCompare(q.e, undefined, { sensitivity: "base" }));
    closeModal(); pronFilas(); pronProbar();
    toast(LG("Agregados a la tabla: falta guardar", "Added to the table: remember to save"));
  };
  setTimeout(() => ta.focus(), 30);
}

/* Diccionario en el editor: mismas reglas que pronuncia.py (palabras completas, primero lo más
   largo, mayúsculas exactas salvo «Aa»). Devuelve [{i, j, e, d}] con las posiciones en el texto. */
function pronMarcas(texto, lista) {
  if (!texto || !lista || !lista.length) return [];
  const terms = lista.slice().sort((a, b) => b.e.length - a.e.length);
  const mapa = new Map();
  for (const t of terms) { const k = t.e.toLowerCase(); if (!mapa.has(k)) mapa.set(k, []); mapa.get(k).push(t); }
  const esc_ = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let rx;
  try { rx = new RegExp("(?<![\\p{L}\\p{N}_])(?:" + terms.map((t) => t.e.split(" ").map(esc_).join("\\s+")).join("|") + ")(?![\\p{L}\\p{N}_])", "giu"); }
  catch { return []; }
  const out = []; let m;
  while ((m = rx.exec(texto))) {
    const plano = m[0].replace(/\s+/g, " ");
    const t = (mapa.get(plano.toLowerCase()) || []).find((x) => x.i || x.e === plano);
    if (t) out.push({ i: m.index, j: m.index + m[0].length, e: t.e, d: t.d });
    if (!m[0].length) rx.lastIndex++;
  }
  return out;
}
/* Capa detrás del cuadro de texto que pinta las mismas letras y resalta las palabras del
   diccionario (azul) y las horas con zona {hora 21:00 America/Chicago} (verde, con lo que dirán hoy) */
const HZ_RX = /\{hora(_evento)?\s+[^{}|]+?\s*(?:\|\s*(?:palabras|24h|12h)\s*)?\}/g;
function pronResaltar(ta, lista, resumen) {
  const caja = document.createElement("div"); caja.className = "pron-caja";
  const capa = document.createElement("div"); capa.className = "pron-capa"; capa.setAttribute("aria-hidden", "true");
  ta.parentNode.insertBefore(caja, ta); caja.appendChild(capa); caja.appendChild(ta);
  const cs = getComputedStyle(ta);
  for (const p of ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderRadius", "boxSizing", "textIndent", "tabSize"]) capa.style[p] = cs[p];
  capa.style.backgroundColor = cs.backgroundColor;
  ta.classList.add("pron-ta");
  let horasHtml = "", dicHtml = "", tHz = null, ultimo = null;
  const muestra = () => {
    if (!resumen) return;
    resumen.innerHTML = [horasHtml, dicHtml].filter(Boolean).join("<br>");
    resumen.classList.toggle("hidden", !horasHtml && !dicHtml);
  };
  const horas = (t) => {
    const toks = t.match(HZ_RX) || [];
    const clave = toks.join("\n");
    if (clave === ultimo) return;
    ultimo = clave; clearTimeout(tHz);
    if (!toks.length) { horasHtml = ""; return muestra(); }
    tHz = setTimeout(async () => {
      try {
        const r = await api("api/horas/probar", { method: "POST", json: { texto: toks.join(" ") } });
        horasHtml = `🕗 ${LG("Hoy dirá", "Today it says")}: ` + r.items.map((x) => x.ok
          ? `<span class="pron-par" translate="no"><mark class="hz">${esc(x.detalle)}</mark> → «${esc(x.dice)}»</span>`
          : `<span class="pron-par hz-mal" translate="no">⚠ <code>${esc(x.token)}</code>: ${esc(x.error)}</span>`).join(" ");
      } catch (e) { horasHtml = "⚠ " + esc(e.message); }
      muestra();
    }, 350);
  };
  const pinta = () => {
    const t = ta.value, marcas = [];
    let m; HZ_RX.lastIndex = 0;
    while ((m = HZ_RX.exec(t))) marcas.push({ i: m.index, j: m.index + m[0].length, hz: true });
    // Las palabras del diccionario dentro de un token de hora no cuentan (la hora se calcula antes)
    const dentro = (x) => marcas.some((h) => x.i < h.j && x.j > h.i);
    const dic = pronMarcas(t, lista).filter((x) => !dentro(x));
    const todas = marcas.concat(dic).sort((a, b) => a.i - b.i);
    let h = "", k = 0;
    for (const x of todas) { h += esc(t.slice(k, x.i)) + `<mark${x.hz ? ' class="hz"' : ""}>${esc(t.slice(x.i, x.j))}</mark>`; k = x.j; }
    capa.innerHTML = h + esc(t.slice(k)) + "\n";
    capa.scrollTop = ta.scrollTop;
    const vistos = new Map(); dic.forEach((x) => vistos.set(x.e, x.d));
    dicHtml = vistos.size ? `📖 ${LG("Del diccionario", "From the dictionary")}: ` + [...vistos].map(([e, d]) => `<span class="pron-par" translate="no"><mark>${esc(e)}</mark> → «${esc(d)}»</span>`).join(" ") : "";
    muestra(); horas(t);
  };
  ta.addEventListener("input", pinta);
  ta.addEventListener("scroll", () => { capa.scrollTop = ta.scrollTop; });
  if (window.ResizeObserver) new ResizeObserver(() => { capa.style.height = ta.offsetHeight + "px"; }).observe(ta);
  pinta();
  return pinta;
}

/* Botones «🕗 Hora de otra zona» y «📅 Hora de un evento»: arman el token y lo insertan en el texto */
async function horaPanel(box, ta, despues, eventos) {
  if (!box) return;
  box.innerHTML = `<div class="row gap wrap hz-btns">
      <button type="button" class="btn sm" data-hzabre="zona">🕗 ${LG("Hora de otra zona", "Time in another zone")}</button>
      ${eventos ? `<button type="button" class="btn sm" data-hzabre="evento">📅 ${LG("Hora de un evento", "Time of an event")}</button>` : ""}
    </div>
    <div class="hz-panel hidden" data-hzp="zona">
      <div class="row gap wrap"><label>${LG("Hora allá", "Time there")}<input type="time" data-hz="h" value="21:00"></label>
        <label class="hz-zona">${LG("Zona", "Zone")}<select data-hz="z"><option>…</option></select></label></div>
      ${hzFormatos("z")}
      <p class="muted hz-prev" data-hzprev="zona"></p>
      <div class="row gap"><button type="button" class="btn sm primary" data-hzins="zona">${LG("Insertar", "Insert")}</button><button type="button" class="btn sm ghost" data-hzcerrar>${LG("Cerrar", "Close")}</button></div>
    </div>
    ${eventos ? `<div class="hz-panel hidden" data-hzp="evento">
      <label>${LG("Evento", "Event")}<select data-hz="ev"><option>…</option></select></label>
      ${hzFormatos("e")}
      <p class="muted hz-prev" data-hzprev="evento"></p>
      <div class="row gap"><button type="button" class="btn sm primary" data-hzins="evento">${LG("Insertar", "Insert")}</button><button type="button" class="btn sm ghost" data-hzcerrar>${LG("Cerrar", "Close")}</button></div>
    </div>` : ""}`;
  const q = (s) => box.querySelector(s);
  const token = (tipo) => {
    const fmt = (box.querySelector(`[name=hzf_${tipo === "zona" ? "z" : "e"}]:checked`) || {}).value || "palabras";
    if (tipo === "zona") return `{hora ${q("[data-hz=h]").value || "21:00"} ${q("[data-hz=z]").value}${fmt === "palabras" ? "" : " | " + fmt}}`;
    const ev = q("[data-hz=ev]").value;
    return ev ? `{hora_evento ${ev}${fmt === "palabras" ? "" : " | " + fmt}}` : "";
  };
  let tPrev = null;
  const prev = (tipo) => {
    clearTimeout(tPrev);
    tPrev = setTimeout(async () => {
      const t = token(tipo), out = q(`[data-hzprev=${tipo}]`); if (!out) return;
      if (!t) { out.textContent = ""; return; }
      try {
        const r = await api("api/horas/probar", { method: "POST", json: { texto: t } }), x = r.items[0];
        out.innerHTML = x && x.ok ? `${LG("Hoy aquí", "Today here")}: <b>${esc(anFecha(x.aqui))}</b> → ${LG("dirá", "it says")} «<b>${esc(x.dice)}</b>»`
          : "⚠ " + esc(x ? x.error : "");
      } catch (e) { out.textContent = "⚠ " + e.message; }
    }, 250);
  };
  box.onclick = async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.hzabre) {
      const tipo = b.dataset.hzabre;
      box.querySelectorAll("[data-hzp]").forEach((p) => p.classList.toggle("hidden", p.dataset.hzp !== tipo || !p.classList.contains("hidden")));
      if (tipo === "zona" && !S.hzZonas) {
        try { S.hzZonas = await api("api/zonas"); } catch { S.hzZonas = { zonas: [] }; }
      }
      if (tipo === "zona") {
        const sel = q("[data-hz=z]"), zs = S.hzZonas.zonas.filter((z) => z.id);
        if (sel.options.length < 2) sel.innerHTML = zs.map((z) => `<option value="${esc(z.id)}" ${z.id === "America/Chicago" ? "selected" : ""}>${esc(z.nombre)}</option>`).join("");
      }
      if (tipo === "evento") {
        const sel = q("[data-hz=ev]");
        if (sel.options.length < 2) {
          let evs = (S.an && S.an.eventos) || null;
          if (!evs) { try { evs = (await api("api/eventos")).eventos; } catch { evs = []; } }
          sel.innerHTML = `<option value="">— ${LG("Elige el evento", "Choose the event")} —</option>` + evs.map((x) => `<option value="${esc(x.nombre)}">${esc(x.nombre)}</option>`).join("");
        }
      }
      return prev(tipo);
    }
    if (b.dataset.hzcerrar !== undefined) { box.querySelectorAll("[data-hzp]").forEach((p) => p.classList.add("hidden")); return; }
    if (b.dataset.hzins) {
      const t = token(b.dataset.hzins); if (!t) return toast(LG("Elige el evento", "Choose the event"), true);
      const p = ta.selectionStart ?? ta.value.length;
      ta.value = ta.value.slice(0, p) + t + ta.value.slice(ta.selectionEnd ?? p);
      ta.focus(); ta.selectionStart = ta.selectionEnd = p + t.length;
      box.querySelectorAll("[data-hzp]").forEach((x) => x.classList.add("hidden"));
      if (despues) despues();
    }
  };
  box.addEventListener("input", (e) => { const p = e.target.closest("[data-hzp]"); if (p) prev(p.dataset.hzp); });
  box.addEventListener("change", (e) => { const p = e.target.closest("[data-hzp]"); if (p) prev(p.dataset.hzp); });
}
function hzFormatos(k) {
  return `<div class="hz-fmt"><span class="muted">${LG("Decir", "Say")}:</span>
    <label class="check"><input type="radio" name="hzf_${k}" value="palabras" checked> ${LG("9 de la noche", "9 de la noche (words)")}</label>
    <label class="check"><input type="radio" name="hzf_${k}" value="24h"> 21:00</label>
    <label class="check"><input type="radio" name="hzf_${k}" value="12h"> 9 pm</label></div>`;
}
