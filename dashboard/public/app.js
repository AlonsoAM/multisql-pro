const state = {
  config: null,
  editingId: null,
  status: {},        // id -> { state: 'online'|'offline'|'checking'|'unknown', error, database, latency }
  filter: "",
};

/* ---------- Theme manager ---------- */
const THEME_KEY = "multisql.theme";
const themeMql = window.matchMedia("(prefers-color-scheme: light)");

function getThemePref() {
  return localStorage.getItem(THEME_KEY) || "system";
}
function applyTheme(pref) {
  const resolved = pref === "system" ? (themeMql.matches ? "light" : "dark") : pref;
  document.documentElement.setAttribute("data-theme", resolved);
  document.querySelectorAll(".theme-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.themeSet === pref);
  });
}
function setTheme(pref) {
  if (pref === "system") localStorage.removeItem(THEME_KEY);
  else localStorage.setItem(THEME_KEY, pref);
  applyTheme(pref);
}
themeMql.addEventListener?.("change", () => {
  if (getThemePref() === "system") applyTheme("system");
});
applyTheme(getThemePref());

const $ = (id) => document.getElementById(id);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return res.json();
}

function toast(msg, ok = true) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast " + (ok ? "ok" : "fail");
  t.hidden = false;
  clearTimeout(toast._t);
  clearTimeout(toast._tHide);
  toast._t = setTimeout(() => {
    t.classList.add("leaving");
    toast._tHide = setTimeout(() => {
      t.hidden = true;
      t.classList.remove("leaving");
    }, 200);
  }, 2800);
}

/* ---------- Smooth number count-up for stats ---------- */
function animateNumber(el, to) {
  const from = parseInt(el.textContent, 10) || 0;
  if (from === to) { el.textContent = String(to); return; }
  const start = performance.now();
  const dur = 360;
  const step = (now) => {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(from + (to - from) * eased).toString();
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------- Confirm modal ---------- */
function confirmDialog({ title = "Confirmar accion", message = "", okText = "Confirmar", cancelText = "Cancelar", danger = true } = {}) {
  return new Promise((resolve) => {
    $("confirmTitle").textContent = title;
    $("confirmText").innerHTML = message;
    const okBtn = $("confirmOk");
    const cancelBtn = $("confirmCancel");
    const iconBox = $("confirmIcon");
    okBtn.textContent = okText;
    cancelBtn.textContent = cancelText;
    okBtn.className = "btn " + (danger ? "danger solid" : "primary");
    iconBox.className = "confirm-icon" + (danger ? "" : " info");
    $("confirmModal").hidden = false;

    const done = (value) => {
      $("confirmModal").hidden = true;
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      document.removeEventListener("keydown", onKey);
      resolve(value);
    };
    const onOk = () => done(true);
    const onCancel = () => done(false);
    const onKey = (e) => {
      if (e.key === "Escape") done(false);
      if (e.key === "Enter") done(true);
    };
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    document.addEventListener("keydown", onKey);
    setTimeout(() => okBtn.focus(), 50);
  });
}

/* ---------- Load + render ---------- */
async function load() {
  const r = await api("/api/config");
  if (!r.ok) {
    toast("Error cargando config: " + r.error, false);
    return;
  }
  state.config = r.config;
  $("configPath").textContent = r.path;
  render();
  pingAll();
}

function statusOf(id) {
  return state.status[id] || { state: "unknown" };
}

function statusPill(id) {
  const st = statusOf(id);
  const map = {
    online: { label: "online", dot: "dot-online" },
    offline: { label: "offline", dot: "dot-offline" },
    checking: { label: "probing", dot: "dot-checking" },
    unknown: { label: "idle", dot: "" },
  };
  const m = map[st.state] || map.unknown;
  const lat = st.latency ? `<span class="latency">· ${st.latency}ms</span>` : "";
  return `<span class="status-pill"><span class="dot ${m.dot}"></span>${m.label}${lat}</span>`;
}

function render() {
  const grid = $("connGrid");
  const conns = state.config.connections || {};
  const allIds = Object.keys(conns);
  const filter = state.filter.toLowerCase().trim();
  const ids = filter
    ? allIds.filter(id => {
        const c = conns[id];
        return (
          id.toLowerCase().includes(filter) ||
          (c.name || "").toLowerCase().includes(filter) ||
          (c.config.database || "").toLowerCase().includes(filter) ||
          (c.config.server || "").toLowerCase().includes(filter)
        );
      })
    : allIds;

  const hasConns = allIds.length > 0;
  const isFiltering = !!filter;
  const matched = ids.length;

  $("emptyInitial").hidden = hasConns;
  $("emptyFilter").hidden = !(hasConns && isFiltering && matched === 0);
  if (hasConns && isFiltering && matched === 0) {
    $("emptyFilterTerm").textContent = `"${filter}"`;
  }

  const filterMeta = $("filterMeta");
  if (hasConns && isFiltering && matched > 0) {
    $("filterCount").textContent = matched;
    $("filterTotal").textContent = allIds.length;
    filterMeta.hidden = false;
  } else {
    filterMeta.hidden = true;
  }

  grid.hidden = matched === 0;
  grid.innerHTML = "";
  for (const id of ids) {
    const c = conns[id];
    const st = statusOf(id);
    const card = document.createElement("div");
    card.className = `card status-${st.state}`;
    card.innerHTML = `
      <div class="card-head">
        <div class="card-head-left">
          <span class="card-id">${escapeHtml(id)}</span>
          <span class="badge ${c.type}">${c.type}</span>
        </div>
        ${statusPill(id)}
      </div>
      <div class="card-name">${escapeHtml(c.name)}</div>
      <div class="meta"><span class="meta-key">Host</span><span class="meta-val">${escapeHtml(c.config.server)}:${c.config.port}</span></div>
      <div class="meta"><span class="meta-key">DB</span><span class="meta-val">${escapeHtml(c.config.database)}</span></div>
      <div class="meta"><span class="meta-key">User</span><span class="meta-val">${escapeHtml(c.config.user)} (${c.config.authType || "sql"})</span></div>
      <div class="card-divider"></div>
      <div class="card-actions">
        <button class="btn sm primary" data-act="details" data-id="${id}">Ver detalles</button>
        <button class="btn sm" data-act="test" data-id="${id}">Probar</button>
        <button class="btn sm" data-act="edit" data-id="${id}">Editar</button>
        <button class="btn sm danger" data-act="del" data-id="${id}">Eliminar</button>
      </div>
    `;
    grid.appendChild(card);
  }

  const s = state.config.settings || {};
  $("setTimeout").value = s.queryTimeout ?? 60000;
  $("setMaxRows").value = s.maxRows ?? 10000;
  $("setPort").value = s.dashboardPort ?? 4567;

  updateStats();
}

function updateStats() {
  const conns = state.config?.connections || {};
  const ids = Object.keys(conns);
  let online = 0, offline = 0, prod = 0;
  for (const id of ids) {
    const st = statusOf(id).state;
    if (st === "online") online++;
    else if (st === "offline") offline++;
    if (conns[id].type === "prod") prod++;
  }
  animateNumber($("statTotal"), ids.length);
  animateNumber($("statOnline"), online);
  animateNumber($("statOffline"), offline);
  animateNumber($("statProd"), prod);
}

function escapeHtml(s = "") {
  return String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}

/* ---------- Status pinging ---------- */
async function pingOne(id) {
  state.status[id] = { state: "checking" };
  patchCardStatus(id);
  const t0 = performance.now();
  const r = await api(`/api/connections/${encodeURIComponent(id)}/test`, { method: "POST" });
  const latency = Math.round(performance.now() - t0);
  if (r.ok) {
    state.status[id] = { state: "online", database: r.database, latency };
  } else {
    state.status[id] = { state: "offline", error: r.error, latency };
  }
  patchCardStatus(id);
  updateStats();
}

function patchCardStatus(id) {
  const card = document.querySelector(`.card [data-id="${CSS.escape(id)}"]`)?.closest(".card");
  if (!card) return;
  card.className = `card status-${statusOf(id).state}`;
  const head = card.querySelector(".card-head");
  if (head) {
    const pill = head.querySelector(".status-pill");
    if (pill) pill.outerHTML = statusPill(id);
  }
}

async function pingAll() {
  const ids = Object.keys(state.config?.connections || {});
  await Promise.all(ids.map(id => pingOne(id).catch(() => {
    state.status[id] = { state: "offline", error: "fetch failed" };
    patchCardStatus(id);
    updateStats();
  })));
}

/* ---------- Details modal ---------- */
const detailsState = { tab: "overview", data: null, id: null };

const LOADER_STEPS = [
  { key: "connect",   label: "Estableciendo conexion TCP" },
  { key: "auth",      label: "Autenticando credenciales" },
  { key: "server",    label: "Leyendo metadata del servidor" },
  { key: "database",  label: "Inspeccionando base de datos" },
  { key: "objects",   label: "Contando tablas, vistas y procedures" },
  { key: "identity",  label: "Resolviendo roles y permisos" },
  { key: "tools",     label: "Calculando tools MCP disponibles" },
];

function loaderHtml(host) {
  return `
    <div class="details-loading">
      <div class="spinner-ring"></div>
      <div class="loader-text">
        <div class="loader-title">Conectando con ${escapeHtml(host)}</div>
        <div class="loader-sub">Recolectando metadata, roles y permisos...</div>
      </div>
      <ul class="loader-steps" id="loaderSteps">
        ${LOADER_STEPS.map((s, i) => `
          <li class="loader-step" data-step="${s.key}">
            <span class="step-bullet"><span>${i + 1}</span></span>
            <span>${escapeHtml(s.label)}</span>
          </li>
        `).join("")}
      </ul>
    </div>
  `;
}

function advanceLoader(idx) {
  const steps = document.querySelectorAll("#loaderSteps .loader-step");
  steps.forEach((el, i) => {
    el.classList.remove("active", "done");
    if (i < idx) el.classList.add("done");
    else if (i === idx) el.classList.add("active");
  });
}

async function openDetails(id) {
  detailsState.id = id;
  detailsState.tab = "overview";
  const conns = state.config?.connections || {};
  const c = conns[id];
  $("detailsTitle").textContent = `${c?.name || id}`;
  $("detailsSub").textContent = `${id} · ${c?.config.server}:${c?.config.port} · ${c?.config.database}`;
  const host = `${c?.config.server}:${c?.config.port}`;
  $("detailsBody").innerHTML = loaderHtml(host);
  switchTab("overview");
  $("detailsModal").hidden = false;

  let stepIdx = 0;
  advanceLoader(stepIdx);
  const tick = setInterval(() => {
    if (stepIdx < LOADER_STEPS.length - 1) {
      stepIdx++;
      advanceLoader(stepIdx);
    }
  }, 450);

  const r = await api(`/api/connections/${encodeURIComponent(id)}/details`, { method: "POST" });
  clearInterval(tick);

  if (!r.ok) {
    $("detailsBody").innerHTML = `<div class="details-error">No se pudo obtener detalles:\n\n${escapeHtml(r.error || "Error desconocido")}</div>`;
    detailsState.data = null;
    return;
  }
  // marcar todos los pasos como done brevemente antes de renderizar
  const all = document.querySelectorAll("#loaderSteps .loader-step");
  all.forEach(el => { el.classList.remove("active"); el.classList.add("done"); });
  detailsState.data = r;
  setTimeout(renderDetails, 180);
}

function closeDetails() {
  $("detailsModal").hidden = true;
  detailsState.data = null;
  detailsState.id = null;
}

function switchTab(tab) {
  detailsState.tab = tab;
  document.querySelectorAll("#detailsTabs .tab").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
  if (detailsState.data) renderDetails();
}

function fmtDate(s) {
  if (!s) return "-";
  try { return new Date(s).toLocaleString(); } catch { return String(s); }
}
function fmtNum(n) {
  if (n === null || n === undefined) return "-";
  return Number(n).toLocaleString();
}
function fmtMB(mb) {
  if (mb === null || mb === undefined) return "-";
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${fmtNum(mb)} MB`;
}

function renderDetails() {
  const d = detailsState.data;
  if (!d) return;
  const tab = detailsState.tab;
  let html = "";

  if (tab === "overview") {
    const typeColor = d.mcpType === "prod" ? "chip-red" : d.mcpType === "qa" ? "chip-amber" : d.mcpType === "readonly" ? "chip-green" : "chip";
    const warningsHtml = d.warnings && d.warnings.length
      ? `<div class="section"><div class="callout warn">Algunos datos no pudieron obtenerse (probablemente por permisos limitados del usuario):<br>${d.warnings.map(w => `&middot; ${escapeHtml(w)}`).join("<br>")}</div></div>`
      : "";
    html = warningsHtml + `
      <div class="section">
        <h4 class="section-title">Resumen</h4>
        <div class="metric-grid">
          <div class="metric"><div class="metric-val">${escapeHtml(d.connection.latencyMs)}<span class="unit">ms</span></div><div class="metric-key">Latencia</div></div>
          <div class="metric"><div class="metric-val">${fmtMB(d.database.sizeMB)}</div><div class="metric-key">Tamano BD</div></div>
          <div class="metric"><div class="metric-val">${fmtNum(d.counts.tables)}</div><div class="metric-key">Tablas</div></div>
          <div class="metric"><div class="metric-val">${fmtNum(d.counts.views)}</div><div class="metric-key">Vistas</div></div>
          <div class="metric"><div class="metric-val">${fmtNum(d.counts.procedures)}</div><div class="metric-key">Procedures</div></div>
          <div class="metric"><div class="metric-val">${fmtNum(d.counts.functions)}</div><div class="metric-key">Funciones</div></div>
          <div class="metric"><div class="metric-val">${fmtNum(d.counts.triggers)}</div><div class="metric-key">Triggers</div></div>
          <div class="metric"><div class="metric-val">${fmtNum(d.counts.indexes)}</div><div class="metric-key">Indices</div></div>
        </div>
      </div>
      <div class="section">
        <h4 class="section-title">Conexion</h4>
        <div class="kv-grid">
          ${kv("ID", d.connection.id)}
          ${kv("Nombre", d.connection.name)}
          ${kv("Tipo MCP", `<span class="chip ${typeColor}">${d.connection.type.toUpperCase()}</span>`, true)}
          ${kv("Autenticacion", d.connection.authType.toUpperCase())}
          ${kv("Servidor", `${d.connection.server}:${d.connection.port}`)}
          ${kv("Base de datos", d.connection.database)}
          ${kv("Usuario", d.connection.user)}
          ${d.connection.domain ? kv("Dominio", d.connection.domain) : ""}
        </div>
      </div>
      ${d.otherDatabases.length ? `
      <div class="section">
        <h4 class="section-title">Otras BDs en el servidor</h4>
        <div class="chips">
          ${d.otherDatabases.map(n => `<span class="chip chip-muted">${escapeHtml(n)}</span>`).join("")}
        </div>
      </div>` : ""}
    `;
  }
  else if (tab === "server") {
    html = `
      <div class="section">
        <h4 class="section-title">Instancia SQL Server</h4>
        <div class="kv-grid">
          ${kv("Server name", d.server.name)}
          ${kv("Edition", d.server.edition)}
          ${kv("Product version", d.server.productVersion)}
          ${kv("Product level", d.server.productLevel)}
          ${kv("Collation servidor", d.server.collation)}
        </div>
      </div>
      <div class="section">
        <h4 class="section-title">Base de datos</h4>
        <div class="kv-grid">
          ${kv("Nombre", d.database.name)}
          ${kv("Estado", d.database.state)}
          ${kv("Recovery model", d.database.recoveryModel)}
          ${kv("Compatibility level", d.database.compatibilityLevel)}
          ${kv("Collation BD", d.database.collation)}
          ${kv("Creada", fmtDate(d.database.created))}
          ${kv("Tamano total", fmtMB(d.database.sizeMB))}
          ${kv("Data files", fmtMB(d.database.dataMB))}
          ${kv("Log files", fmtMB(d.database.logMB))}
        </div>
      </div>
      <div class="section">
        <h4 class="section-title">@@VERSION</h4>
        <pre class="code-block">${escapeHtml(d.server.version)}</pre>
      </div>
    `;
  }
  else if (tab === "identity") {
    const serverRoles = d.identity.serverRoles;
    const dbRoles = d.identity.dbRoles;
    const perms = d.identity.permissions;
    html = `
      <div class="section">
        <h4 class="section-title">Identidad</h4>
        <div class="kv-grid">
          ${kv("Login SQL", d.identity.loginName)}
          ${kv("Original login", d.identity.originalLogin)}
          ${kv("Usuario en BD", d.identity.dbUser)}
        </div>
      </div>
      <div class="section">
        <h4 class="section-title">Roles a nivel de servidor (${serverRoles.length})</h4>
        <div class="chips">
          ${serverRoles.length
            ? serverRoles.map(r => `<span class="chip chip-violet">${escapeHtml(r)}</span>`).join("")
            : `<span class="chip-empty">Sin roles de servidor asignados.</span>`}
        </div>
      </div>
      <div class="section">
        <h4 class="section-title">Roles en la BD (${dbRoles.length})</h4>
        <div class="chips">
          ${dbRoles.length
            ? dbRoles.map(r => {
                const color = r === "db_owner" ? "chip-red" : r.includes("datawriter") || r.includes("ddladmin") ? "chip-amber" : r.includes("datareader") ? "chip-green" : "chip";
                return `<span class="chip ${color}">${escapeHtml(r)}</span>`;
              }).join("")
            : `<span class="chip-empty">Sin roles de BD asignados.</span>`}
        </div>
      </div>
      <div class="section">
        <h4 class="section-title">Permisos efectivos en la BD (${perms.length})</h4>
        ${perms.length ? `
        <table class="perms-table">
          <thead><tr><th>Permiso</th><th>Estado</th></tr></thead>
          <tbody>
            ${perms.map(p => `<tr>
              <td>${escapeHtml(p.permission)}</td>
              <td><span class="perms-state ${p.state}">${escapeHtml(p.state)}</span></td>
            </tr>`).join("")}
          </tbody>
        </table>` : `<span class="chip-empty">Sin permisos explicitos enumerables.</span>`}
      </div>
    `;
  }
  else if (tab === "tools") {
    const isReadOnly = d.mcpType === "prod" || d.mcpType === "readonly";
    html = `
      <div class="section">
        <div class="callout ${isReadOnly ? "warn" : ""}">
          Esta conexion es de tipo <strong>${d.mcpType.toUpperCase()}</strong>.
          ${isReadOnly
            ? `El agente solo puede usar <strong>verbos de lectura</strong>: <code>${d.readVerbs.join(", ")}</code>. Cualquier <code>INSERT/UPDATE/DELETE/DDL/EXEC</code> es <strong>rechazado antes</strong> de llegar al motor SQL.`
            : `El agente tiene <strong>acceso completo</strong> (lectura, escritura y DDL). Sus permisos efectivos quedan acotados ademas por las credenciales SQL del motor.`}
        </div>
      </div>
      <div class="section">
        <h4 class="section-title">Tools MCP expuestas al agente</h4>
        ${d.tools.map(t => {
          const cls = t.restricted ? "warn" : t.allowed ? "on" : "off";
          const label = t.restricted ? "RESTRINGIDA" : t.allowed ? "PERMITIDA" : "BLOQUEADA";
          const icon = t.restricted ? "!" : t.allowed ? "&#10003;" : "&#10007;";
          return `
            <div class="tool-row ${t.restricted ? "restricted" : t.allowed ? "" : "disabled"}">
              <div class="tool-icon ${cls}">${icon}</div>
              <div class="tool-body">
                <div class="tool-name">${escapeHtml(t.name)}</div>
                <div class="tool-purpose">${escapeHtml(t.purpose)}</div>
                ${t.note ? `<div class="tool-note">${escapeHtml(t.note)}</div>` : ""}
              </div>
              <span class="tool-badge ${cls}">${label}</span>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }
  else if (tab === "raw") {
    const masked = {
      ...d.connection,
      password: "********",
    };
    html = `
      <div class="section">
        <h4 class="section-title">Datos de conexion</h4>
        <div class="kv-grid">
          ${kv("Server", `${d.connection.server}:${d.connection.port}`)}
          ${kv("Database", d.connection.database)}
          ${kv("Auth type", d.connection.authType)}
          ${kv("User", d.connection.user)}
          ${d.connection.domain ? kv("Domain", d.connection.domain) : ""}
          ${kv("Encrypt", d.connection.encrypt ? "true" : "false")}
          ${kv("Trust certificate", d.connection.trustServerCertificate ? "true" : "false")}
          ${kv("Latencia ultima conexion", `${d.connection.latencyMs} ms`)}
        </div>
      </div>
      <div class="section">
        <h4 class="section-title">JSON de la conexion</h4>
        <pre class="code-block">${escapeHtml(JSON.stringify(masked, null, 2))}</pre>
      </div>
    `;
  }

  $("detailsBody").innerHTML = html;
}

function kv(key, val, raw = false) {
  return `<div class="kv"><div class="kv-key">${escapeHtml(key)}</div><div class="kv-val">${raw ? val : escapeHtml(val ?? "-")}</div></div>`;
}

/* ---------- Modal: connection editor ---------- */
function toggleDomain() {
  const isWin = $("fAuthType").value === "windows";
  $("fDomainLabel").hidden = !isWin;
  if (isWin) autoFillWindowsIdentity(false);
}

async function autoFillWindowsIdentity(force) {
  const r = await api("/api/windows-identity");
  if (!r.ok) return;
  if (force || !$("fUser").value.trim()) $("fUser").value = r.user || "";
  if (force || !$("fDomain").value.trim()) $("fDomain").value = r.domain || "";
  if (force) toast(`Detectado: ${r.domain}\\${r.user}`, true);
}

async function loadDatabases() {
  const { definition } = collectForm();
  const c = definition.config;
  if (!c.server || !c.user) {
    toast("Servidor y usuario son obligatorios", false);
    return;
  }
  if (c.authType === "sql" && !c.password) {
    toast("Password requerido para listar BDs", false);
    return;
  }
  const btn = $("btnLoadDbs");
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = "...";
  const r = await api("/api/list-databases", { method: "POST", body: definition });
  btn.disabled = false;
  btn.textContent = prev;
  if (!r.ok) return toast("Error: " + r.error, false);
  const dl = $("fDatabaseList");
  dl.innerHTML = r.databases.map(n => `<option value="${escapeHtml(n)}"></option>`).join("");
  toast(`${r.databases.length} bases de datos disponibles`, true);
  $("fDatabase").focus();
}

function openModal(id) {
  state.editingId = id;
  $("modalTitle").textContent = id ? `Editar: ${id}` : "Nueva conexion";
  if (id) {
    const c = state.config.connections[id];
    $("fId").value = id;
    $("fId").disabled = true;
    $("fName").value = c.name;
    $("fType").value = c.type;
    $("fAuthType").value = c.config.authType || "sql";
    $("fServer").value = c.config.server;
    $("fPort").value = c.config.port;
    $("fDatabase").value = c.config.database;
    $("fDomain").value = c.config.domain || "";
    $("fUser").value = c.config.user;
    $("fPassword").value = c.config.password === "********" ? "" : c.config.password;
    $("fPassword").placeholder = c.config.password === "********" ? "(sin cambios)" : "";
    $("fEncrypt").checked = !!c.config.options?.encrypt;
    $("fTrust").checked = c.config.options?.trustServerCertificate !== false;
  } else {
    ["fId","fName","fServer","fDatabase","fDomain","fUser","fPassword"].forEach(k => $(k).value = "");
    $("fId").disabled = false;
    $("fPort").value = 1433;
    $("fType").value = "dev";
    $("fAuthType").value = "sql";
    $("fEncrypt").checked = false;
    $("fTrust").checked = true;
    $("fPassword").placeholder = "";
  }
  toggleDomain();
  $("testResult").className = "test-result";
  $("testResult").textContent = "";
  $("modal").hidden = false;
}

function closeModal() {
  $("modal").hidden = true;
  state.editingId = null;
}

function collectForm() {
  const password = $("fPassword").value;
  const authType = $("fAuthType").value;
  const cfg = {
    authType,
    server: $("fServer").value.trim(),
    port: parseInt($("fPort").value, 10) || 1433,
    database: $("fDatabase").value.trim(),
    user: $("fUser").value.trim(),
    password: password === "" && state.editingId ? "********" : password,
    options: {
      encrypt: $("fEncrypt").checked,
      trustServerCertificate: $("fTrust").checked,
    },
  };
  if (authType === "windows") cfg.domain = $("fDomain").value.trim();
  return {
    id: $("fId").value.trim(),
    definition: {
      name: $("fName").value.trim(),
      type: $("fType").value,
      config: cfg,
    },
  };
}

async function onSave() {
  const { id, definition } = collectForm();
  if (!id || !definition.name || !definition.config.server || !definition.config.database || !definition.config.user) {
    toast("Faltan campos obligatorios", false);
    return;
  }
  let r;
  if (state.editingId) {
    r = await api(`/api/connections/${encodeURIComponent(state.editingId)}`, { method: "PUT", body: definition });
  } else {
    r = await api("/api/connections", { method: "POST", body: { id, definition } });
  }
  if (!r.ok) return toast(r.error || "Error", false);
  toast("Guardado");
  closeModal();
  await load();
}

async function onTest() {
  const tr = $("testResult");
  tr.className = "test-result run";
  tr.textContent = "probando conexión…";
  const { definition } = collectForm();
  if (state.editingId && (!definition.config.password || definition.config.password === "********")) {
    const r = await api(`/api/connections/${encodeURIComponent(state.editingId)}/test`, { method: "POST" });
    showTest(r);
    return;
  }
  const r = await api("/api/test", { method: "POST", body: definition });
  showTest(r);
}

function showTest(r) {
  const tr = $("testResult");
  if (r.ok) {
    tr.className = "test-result ok";
    tr.textContent = `OK · ${r.database}\n${r.version}`;
  } else {
    tr.className = "test-result fail";
    tr.textContent = `FAIL · ${r.error}`;
  }
}

async function onDelete(id) {
  const ok = await confirmDialog({
    title: "Eliminar conexion",
    message: `Vas a eliminar la conexion <strong>${escapeHtml(id)}</strong>.<br>Esta accion no se puede deshacer.`,
    okText: "Si, eliminar",
    cancelText: "Cancelar",
    danger: true,
  });
  if (!ok) return;
  const r = await api(`/api/connections/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!r.ok) return toast(r.error, false);
  toast("Eliminada");
  delete state.status[id];
  await load();
}

async function onTestExisting(id) {
  await pingOne(id);
  const st = statusOf(id);
  if (st.state === "online") toast(`OK -> ${st.database} (${st.latency}ms)`, true);
  else toast(`FAIL: ${st.error}`, false);
}

async function onSaveSettings() {
  const body = {
    queryTimeout: parseInt($("setTimeout").value, 10),
    maxRows: parseInt($("setMaxRows").value, 10),
    dashboardPort: parseInt($("setPort").value, 10),
  };
  const r = await api("/api/settings", { method: "PUT", body });
  if (!r.ok) return toast(r.error, false);
  toast("Ajustes guardados");
}

/* ---------- Events ---------- */
document.addEventListener("change", (e) => {
  if (e.target.id === "fAuthType") toggleDomain();
});

document.addEventListener("input", (e) => {
  if (e.target.id === "searchInput") {
    state.filter = e.target.value;
    render();
  }
});

document.addEventListener("click", (e) => {
  const themeBtn = e.target.closest("[data-theme-set]");
  if (themeBtn) { setTheme(themeBtn.dataset.themeSet); return; }
  const t = e.target.closest("[id], [data-act], [data-tab]");
  if (!t) return;
  if (t.id === "btnNew" || t.id === "emptyCta") openModal(null);
  else if (t.id === "btnCancel" || t.id === "modalClose") closeModal();
  else if (t.id === "btnSave") onSave();
  else if (t.id === "btnTest") onTest();
  else if (t.id === "btnSaveSettings") onSaveSettings();
  else if (t.id === "btnRefreshAll") { toast("Refrescando estados…"); pingAll(); }
  else if (t.id === "btnLoadDbs") loadDatabases();
  else if (t.id === "btnAutoWin") autoFillWindowsIdentity(true);
  else if (t.id === "btnTogglePwd") togglePasswordVisibility();
  else if (t.id === "btnClearFilter" || t.id === "emptyClearBtn") {
    state.filter = "";
    const si = $("searchInput");
    if (si) { si.value = ""; si.focus(); }
    render();
  }
  else if (t.id === "detailsClose") closeDetails();
  else if (t.classList && t.classList.contains("tab") && t.dataset.tab) switchTab(t.dataset.tab);
  else if (t.dataset.act) {
    const id = t.dataset.id;
    if (t.dataset.act === "edit") openModal(id);
    if (t.dataset.act === "del") onDelete(id);
    if (t.dataset.act === "test") onTestExisting(id);
    if (t.dataset.act === "details") openDetails(id);
  }
});

/* ---------- Password show/hide ---------- */
function togglePasswordVisibility() {
  const input = $("fPassword");
  const icon = $("pwdIcon");
  if (!input || !icon) return;
  const isPwd = input.type === "password";
  input.type = isPwd ? "text" : "password";
  // swap the <use> reference inside the existing SVG
  const use = icon.querySelector("use");
  if (use) use.setAttribute("href", isPwd ? "#i-eye-off" : "#i-eye");
}

/* ---------- Keyboard ---------- */
function isTypingInField(target) {
  if (!target) return false;
  const tag = (target.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

document.addEventListener("keydown", (e) => {
  // Esc closes modals
  if (e.key === "Escape") {
    if (!$("confirmModal").hidden) return; // confirm modal has its own handler
    if (!$("detailsModal").hidden) { closeDetails(); return; }
    if (!$("modal").hidden) { closeModal(); return; }
  }

  // ⌘K / Ctrl+K → focus search
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    const s = $("searchInput");
    s.focus();
    s.select();
    return;
  }

  // "/" → focus search (only when not typing)
  if (e.key === "/" && !isTypingInField(e.target)) {
    // skip if any modal is open
    if (!$("modal").hidden || !$("detailsModal").hidden || !$("confirmModal").hidden) return;
    e.preventDefault();
    $("searchInput").focus();
  }
});

/* ---------- Live clock ---------- */
function tickClock() {
  const el = $("liveTime");
  if (!el) return;
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  el.textContent = `${hh}:${mm}:${ss}`;
}
setInterval(tickClock, 1000);
tickClock();

load();
