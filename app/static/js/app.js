
function applyTheme(theme) {
  const root = document.documentElement;
  const chosen = theme === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
  root.dataset.theme = chosen;
  const btn = $("#theme-toggle");
  if (btn) {
    btn.textContent = chosen === "dark" ? "☀" : "☾";
    btn.title = chosen === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro";
    btn.setAttribute("aria-label", btn.title);
  }
}

function initTheme() {
  const saved = localStorage.getItem("syner-check-theme") || "system";
  applyTheme(saved);
  $("#theme-toggle").onclick = () => {
    const current = document.documentElement.dataset.theme || "light";
    const next = current === "dark" ? "light" : "dark";
    localStorage.setItem("syner-check-theme", next);
    applyTheme(next);
  };
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    if ((localStorage.getItem("syner-check-theme") || "system") === "system") applyTheme("system");
  });
}
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const state = {
  rows: [],
  page: 1,
  pageSize: 25,
  mode: "range",
};

const today = new Date();
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const fmtDate = (s) => s ? new Date(String(s).slice(0, 10) + "T00:00:00").toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
const money = (n, c) => {
  if (n === null || n === undefined || n === "") return "—";
  try { return new Intl.NumberFormat("es-PE", { style: "currency", currency: c || "PEN" }).format(Number(n)); }
  catch { return String(n); }
};
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));

async function api(url, options = {}) {
  const r = await fetch(url, { credentials: "same-origin", ...options });
  if (r.status === 401) { showLogin(); throw new Error("auth"); }
  let j;
  try { j = await r.json(); } catch { throw new Error("Respuesta inválida del servidor."); }
  if (!r.ok) throw new Error(j.detail || "Error de consulta");
  return j;
}

function showLogin() {
  $("#login").classList.remove("hidden");
  $("#workspace").classList.add("hidden");
  $("#account").innerHTML = "";
}

function renderAccount(u) {
  $("#account").innerHTML = `<div class="account"><img class="avatar" src="${esc(u.picture || "/static/img/avatar.svg")}" alt=""><span class="email">${esc(u.email)}</span><form method="post" action="/auth/logout"><button class="logout">Salir</button></form></div>`;
}

function dateDefaults() {
  const end = iso(today), start = iso(new Date(today.getTime() - 6 * 86400000));
  $("#start").value = start; $("#end").value = end;
  $("#nstart").value = start; $("#nend").value = end;
}

function selectedTypes(group) {
  return $$(`.type-options[data-type-group="${group}"] input:checked`).map(x => x.value).join(",");
}

function setLoading(v) {
  $("#loading").classList.toggle("hidden", !v);
  $("#btn-range").disabled = v;
  $("#btn-number").disabled = v;
}

function setPreset(days) {
  const end = new Date();
  const start = new Date(end.getTime() - (days - 1) * 86400000);
  $("#start").value = iso(start); $("#end").value = iso(end);
}

function stats(rows) {
  const total = rows.length;
  const ok = rows.filter(x => x.in_sql).length;
  const miss = total - ok;
  const amount = rows.reduce((sum, x) => sum + (Number(x.crossTotal) || 0), 0);
  $("#stats").innerHTML = `
    <div class="stat"><span>Documentos</span><b>${total}</b></div>
    <div class="stat"><span>Encontrados en SQL</span><b>${ok}</b></div>
    <div class="stat"><span>No encontrados en SQL</span><b>${miss}</b></div>
    <div class="stat"><span>Total mostrado</span><b>${money(amount, rows[0]?.currency?.isoCode || "PEN")}</b></div>`;
  $("#stats").classList.remove("hidden");
}

function renderRows(rows) {
  state.rows = rows || [];
  state.page = 1;
  stats(state.rows);
  renderPage();
}

function renderPage() {
  const rows = state.rows;
  $("#result-subtitle").textContent = `${rows.length} documento${rows.length === 1 ? "" : "s"} encontrado${rows.length === 1 ? "" : "s"}`;
  if (!rows.length) {
    $("#results").innerHTML = `<div class="empty"><div class="empty-icon">⌕</div><b>No encontramos comprobantes</b><span>Prueba otro rango, tipo o número.</span></div>`;
    return;
  }
  const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  state.page = Math.min(state.page, pages);
  const from = (state.page - 1) * state.pageSize;
  const visible = rows.slice(from, from + state.pageSize);

  $("#results").innerHTML = `
    <div class="table-wrap"><table class="table"><thead><tr>
      <th>Documento</th><th>Tipo</th><th>Fecha</th><th>Cliente</th><th>Total</th><th>SQL</th>
    </tr></thead><tbody>${visible.map((d, i) => `<tr data-i="${from + i}">
      <td><span class="docnum">${esc(d.number || "—")}</span><small>${esc(d.seller || "")}</small></td>
      <td><span class="type">${esc(d.tipo)}</span></td>
      <td>${fmtDate(d.date)}</td>
      <td>${esc(d.contactName || d.contact?.name || "—")}</td>
      <td>${money(d.crossTotal, d.currency?.isoCode)}</td>
      <td><span class="status ${d.in_sql ? "ok" : "missing"}">${d.in_sql ? "Encontrado" : "No encontrado"}</span></td>
    </tr>`).join("")}</tbody></table></div>
    <div class="pagination">
      <span>Mostrando ${from + 1}–${Math.min(from + visible.length, rows.length)} de ${rows.length}</span>
      <div class="page-actions"><label>Filas <select id="page-size"><option ${state.pageSize === 25 ? "selected" : ""}>25</option><option ${state.pageSize === 50 ? "selected" : ""}>50</option><option ${state.pageSize === 100 ? "selected" : ""}>100</option></select></label>
      <button class="page-btn" id="prev-page" ${state.page <= 1 ? "disabled" : ""}>‹</button><b>${state.page} / ${pages}</b><button class="page-btn" id="next-page" ${state.page >= pages ? "disabled" : ""}>›</button></div>
    </div>`;

  $$('[data-i]').forEach(el => el.onclick = () => openDetail(rows[+el.dataset.i]));
  $("#prev-page").onclick = () => { state.page--; renderPage(); };
  $("#next-page").onclick = () => { state.page++; renderPage(); };
  $("#page-size").onchange = (e) => { state.pageSize = Number(e.target.value); state.page = 1; renderPage(); };
}

async function openDetail(d) {
  $("#drawer").classList.remove("hidden");
  $("#detail").innerHTML = `<div class="empty">Cargando detalle…</div>`;
  try {
    let full = d;
    if (!d.items) full = (await api(`/api/document/${encodeURIComponent(d.tipo)}/${encodeURIComponent(d.oid)}?doc_date=${encodeURIComponent(String(d.date).slice(0, 10))}`)).document;
    renderDetail(full);
  } catch (e) { $("#detail").innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

function renderDetail(d) {
  const c = d.currency?.isoCode || "PEN";
  $("#detail").innerHTML = `
    <div class="detail-title"><div class="eyebrow">${esc(d.tipo)}</div><h2>${esc(d.number || "Sin número")}</h2><p>${fmtDate(d.date)} · ${esc(d.contactName || d.contact?.name || "Cliente no informado")}</p><div class="detail-actions"><button class="btn secondary" id="copy-number">Copiar número</button><button class="btn secondary" id="print-detail">Imprimir</button></div></div>
    <div class="detail-grid">${kv("OID", d.oid)}${kv("Cliente", d.contact?.name || d.contactName)}${kv("Documento cliente", d.contact?.idNumber)}${kv("Correo", d.contact?.email)}${kv("Subtotal", money(d.netTotal, c))}${kv("Total", money(d.crossTotal, c))}${kv("Moneda", d.currency?.name || c)}${kv("Vendedor", d.seller)}</div>
    ${d.docRef ? `<div class="reference">Nota de crédito relacionada: <b>${esc(d.docRef)}</b></div>` : ""}
    ${d.items ? `<div class="detail-section"><h3>Productos (${d.items.length})</h3><div class="table-wrap"><table class="mini-table"><thead><tr><th>SKU</th><th>Descripción</th><th>Cant.</th><th>Precio</th><th>Total</th></tr></thead><tbody>${d.items.map(x => `<tr><td>${esc(x.sku || x.skuPu || "—")}</td><td>${esc(x.description || "—")}</td><td>${esc(x.quantity ?? "—")}</td><td>${money(x.crossUnitPrice, c)}</td><td>${money(x.crossPrice, c)}</td></tr>`).join("")}</tbody></table></div></div>` : ""}
    ${d.taxes?.length ? `<div class="detail-section"><h3>Impuestos</h3><table class="mini-table"><tbody>${d.taxes.map(x => `<tr><td>${esc(x.name)}</td><td>${money(x.base, c)}</td><td>${money(x.amount, c)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    ${d.payments?.length ? `<div class="detail-section"><h3>Pagos</h3><table class="mini-table"><thead><tr><th>Medio</th><th>Proveedor</th><th>Autorización</th><th>Importe</th></tr></thead><tbody>${d.payments.map(x => `<tr><td>${esc(x.medio || x.name)}</td><td>${esc(x.cardProvider || x.serviceProvider || "—")}</td><td>${esc(x.authorization || "—")}</td><td>${money(x.amount, x.currency?.isoCode || c)}</td></tr>`).join("")}</tbody></table></div>` : ""}`;
  $("#copy-number").onclick = async () => { try { await navigator.clipboard.writeText(String(d.number || "")); $("#copy-number").textContent = "Copiado ✓"; setTimeout(() => $("#copy-number").textContent = "Copiar número", 1500); } catch {} };
  $("#print-detail").onclick = () => window.print();
}

function kv(k, v) { return `<div class="kv"><span>${esc(k)}</span><b>${esc(v ?? "—")}</b></div>`; }

function exportCsv() {
  if (!state.rows.length) return;
  const headers = ["tipo", "numero", "fecha", "cliente", "total", "moneda", "vendedor", "en_sql"];
  const values = state.rows.map(d => [d.tipo, d.number, String(d.date || "").slice(0, 10), d.contactName || d.contact?.name || "", d.crossTotal ?? "", d.currency?.isoCode || "", d.seller || "", d.in_sql ? "SI" : "NO"]);
  const csv = [headers, ...values].map(row => row.map(v => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `syner-check-${iso(new Date())}.csv`; a.click(); URL.revokeObjectURL(a.href);
}

async function runRange() {
  if (!selectedTypes("range")) return alert("Selecciona al menos un tipo de documento.");
  setLoading(true); $("#stats").classList.add("hidden");
  try {
    const qs = new URLSearchParams({ start_date: $("#start").value, end_date: $("#end").value, types: selectedTypes("range") });
    const d = await api(`/api/summary?${qs}`);
    renderRows(Object.values(d.documents).flat());
  } catch (e) { if (e.message !== "auth") alert(e.message); }
  finally { setLoading(false); }
}

async function runNumber() {
  const n = $("#number").value.trim();
  if (!n) return alert("Ingresa un número.");
  if (!selectedTypes("number")) return alert("Selecciona al menos un tipo de documento.");
  setLoading(true); $("#stats").classList.add("hidden");
  try {
    const qs = new URLSearchParams({ number: n, types: selectedTypes("number") });
    if ($("#nstart").value && $("#nend").value) { qs.set("start_date", $("#nstart").value); qs.set("end_date", $("#nend").value); }
    const d = await api(`/api/search?${qs}`);
    renderRows(d.results);
    $("#result-subtitle").textContent = d.source === "sql_index" ? `${d.results.length} coincidencia(s) en el índice local` : `${d.results.length} coincidencia(s) en GraphQL · ${d.searched_range?.start || ""} a ${d.searched_range?.end || ""}`;
  } catch (e) { if (e.message !== "auth") alert(e.message); }
  finally { setLoading(false); }
}

async function boot() {
  try {
    const d = await api("/api/me");
    if (d.user) { $("#workspace").classList.remove("hidden"); renderAccount(d.user); dateDefaults(); }
    else showLogin();
  } catch { showLogin(); }
}

$$('.tab').forEach(t => t.onclick = () => {
  $$('.tab').forEach(x => x.classList.remove('active')); t.classList.add('active'); state.mode = t.dataset.tab;
  $("#range-search").classList.toggle("hidden", state.mode !== "range"); $("#number-search").classList.toggle("hidden", state.mode !== "number");
});

$("#btn-range").onclick = runRange;
$("#btn-number").onclick = runNumber;
$("#export-csv").onclick = exportCsv;
$("#preset-7").onclick = () => setPreset(7);
$("#preset-30").onclick = () => setPreset(30);
$("#close-drawer").onclick = () => $("#drawer").classList.add("hidden");
$(".drawer-backdrop").onclick = () => $("#drawer").classList.add("hidden");
$("#number").addEventListener("keydown", e => { if (e.key === "Enter") runNumber(); });
$("#start").addEventListener("change", () => { if (!$("#end").value) $("#end").value = $("#start").value; });
initTheme();
boot();
