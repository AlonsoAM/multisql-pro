/**
 * Dashboard de configuracion MultiSQL Pro.
 * Express con endpoints CRUD y UI estatica.
 */
import express from "express";
import os from "node:os";
import sql from "mssql";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { spawn } from "node:child_process";
import { loadConfig, saveConfig, maskConfig, CONFIG_PATH } from "../src/config.js";
import { testConnection, invalidatePool, buildMssqlConfig } from "../src/connections.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(join(__dirname, "public")));

function readCfg() {
  return loadConfig();
}

app.get("/api/config", (_req, res) => {
  try {
    const cfg = readCfg();
    res.json({ ok: true, config: maskConfig(cfg), path: CONFIG_PATH });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/config/raw", (_req, res) => {
  try {
    const cfg = readCfg();
    res.json({ ok: true, config: cfg });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.put("/api/settings", (req, res) => {
  try {
    const cfg = readCfg();
    cfg.settings = { ...cfg.settings, ...req.body };
    const saved = saveConfig(cfg);
    res.json({ ok: true, settings: saved.settings });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post("/api/connections", (req, res) => {
  try {
    const { id, definition } = req.body;
    if (!id || !definition) {
      return res.status(400).json({ ok: false, error: "id y definition requeridos" });
    }
    const cfg = readCfg();
    if (cfg.connections[id]) {
      return res.status(409).json({ ok: false, error: `Conexion '${id}' ya existe` });
    }
    cfg.connections[id] = definition;
    saveConfig(cfg);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.put("/api/connections/:id", (req, res) => {
  try {
    const id = req.params.id;
    const cfg = readCfg();
    if (!cfg.connections[id]) {
      return res.status(404).json({ ok: false, error: "no existe" });
    }
    const incoming = req.body;
    const existing = cfg.connections[id];
    if (incoming?.config?.password === "********") {
      incoming.config.password = existing.config.password;
    }
    cfg.connections[id] = incoming;
    saveConfig(cfg);
    invalidatePool(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.delete("/api/connections/:id", (req, res) => {
  try {
    const id = req.params.id;
    const cfg = readCfg();
    if (!cfg.connections[id]) {
      return res.status(404).json({ ok: false, error: "no existe" });
    }
    delete cfg.connections[id];
    saveConfig(cfg);
    invalidatePool(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post("/api/connections/:id/test", async (req, res) => {
  try {
    const id = req.params.id;
    const cfg = readCfg();
    const def = cfg.connections[id];
    if (!def) {
      return res.status(404).json({ ok: false, error: "no existe" });
    }
    const r = await testConnection(def);
    res.json(r);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/test", async (req, res) => {
  try {
    const def = req.body;
    const r = await testConnection(def);
    res.json(r);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

const READ_VERBS = ["SELECT","WITH","DECLARE","SET","USE","PRINT","IF","BEGIN","COMMIT","ROLLBACK"];
const TOOL_CATALOG = [
  { name: "list_connections", purpose: "Listar todas las conexiones registradas en el MCP.", access: "all" },
  { name: "execute_sql", purpose: "Ejecutar SQL arbitrario contra la conexion.", access: "rw" },
  { name: "list_tables", purpose: "Listar tablas y vistas de un esquema.", access: "read" },
  { name: "describe_table", purpose: "Describir columnas, tipos, PK e identity de una tabla.", access: "read" },
  { name: "list_schemas", purpose: "Listar esquemas de usuario.", access: "read" },
  { name: "search_objects", purpose: "Buscar tablas, vistas, SPs y funciones por nombre (LIKE).", access: "read" },
  { name: "get_object_definition", purpose: "Devolver el CREATE / cuerpo de un SP, funcion o vista.", access: "read" },
];

function toolsForType(type) {
  const isReadOnly = type === "prod" || type === "readonly";
  return TOOL_CATALOG.map(t => ({
    ...t,
    allowed: t.access === "all" || t.access === "read" || (t.access === "rw" && !isReadOnly),
    restricted: t.access === "rw" && isReadOnly,
    note: t.access === "rw" && isReadOnly
      ? `Permitido solo en modo lectura: ${READ_VERBS.join(", ")}`
      : null,
  }));
}

async function safeQuery(pool, query, fallback = []) {
  try {
    const r = await pool.request().query(query);
    return r.recordset || fallback;
  } catch (err) {
    console.error("safeQuery error:", err.message);
    return { __error: err.message, __fallback: fallback };
  }
}
function unwrap(result, def = []) {
  if (result && result.__error) return def;
  return result;
}
function firstRow(result) {
  const rows = unwrap(result, []);
  return rows[0] || {};
}

app.post("/api/connections/:id/details", async (req, res) => {
  const id = req.params.id;
  const cfg = readCfg();
  const def = cfg.connections[id];
  if (!def) return res.status(404).json({ ok: false, error: "no existe" });
  const poolCfg = buildMssqlConfig(def, { queryTimeout: 12000 });
  poolCfg.connectionTimeout = 8000;
  const pool = new sql.ConnectionPool(poolCfg);
  const t0 = Date.now();
  const warnings = [];
  try {
    await pool.connect();
    const latencyMs = Date.now() - t0;

    const serverInfo = firstRow(await safeQuery(pool, `
      SELECT
        CAST(@@SERVERNAME AS NVARCHAR(256)) AS serverName,
        CAST(@@VERSION AS NVARCHAR(MAX)) AS version,
        CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(50)) AS productVersion,
        CAST(SERVERPROPERTY('ProductLevel') AS NVARCHAR(50)) AS productLevel,
        CAST(SERVERPROPERTY('Edition') AS NVARCHAR(100)) AS edition,
        CAST(SERVERPROPERTY('Collation') AS NVARCHAR(100)) AS serverCollation,
        CAST(DB_NAME() AS NVARCHAR(256)) AS dbName,
        CAST(SUSER_SNAME() AS NVARCHAR(256)) AS loginName,
        CAST(USER_NAME() AS NVARCHAR(256)) AS dbUser,
        CAST(ORIGINAL_LOGIN() AS NVARCHAR(256)) AS originalLogin
    `));

    // database info: usar DB_ID() + variables locales para evitar problemas de subqueries
    const dbInfoQ = await safeQuery(pool, `
      DECLARE @dbId INT = DB_ID();
      SELECT
        CAST(d.collation_name AS NVARCHAR(100)) AS dbCollation,
        CAST(d.recovery_model_desc AS NVARCHAR(50)) AS recoveryModel,
        CAST(d.state_desc AS NVARCHAR(50)) AS dbState,
        d.create_date AS dbCreated,
        d.compatibility_level AS compatLevel
      FROM sys.databases d
      WHERE d.database_id = @dbId
    `);
    let dbInfo = firstRow(dbInfoQ);
    if (dbInfoQ && dbInfoQ.__error) {
      warnings.push("sys.databases: " + dbInfoQ.__error);
      // fallback con DATABASEPROPERTYEX
      const fallback = firstRow(await safeQuery(pool, `
        SELECT
          CAST(DATABASEPROPERTYEX(DB_NAME(), 'Collation') AS NVARCHAR(100)) AS dbCollation,
          CAST(DATABASEPROPERTYEX(DB_NAME(), 'Recovery') AS NVARCHAR(50)) AS recoveryModel,
          CAST(DATABASEPROPERTYEX(DB_NAME(), 'Status') AS NVARCHAR(50)) AS dbState,
          CAST(NULL AS DATETIME) AS dbCreated,
          CAST(DATABASEPROPERTYEX(DB_NAME(), 'Version') AS INT) AS compatLevel
      `));
      dbInfo = fallback;
    }

    const sizeRow = firstRow(await safeQuery(pool, `
      SELECT
        SUM(CAST(size AS BIGINT) * 8 / 1024) AS sizeMB,
        SUM(CASE WHEN type_desc = 'ROWS' THEN CAST(size AS BIGINT) * 8 / 1024 END) AS dataMB,
        SUM(CASE WHEN type_desc = 'LOG' THEN CAST(size AS BIGINT) * 8 / 1024 END) AS logMB
      FROM sys.database_files
    `));

    const counts = firstRow(await safeQuery(pool, `
      SELECT
        (SELECT COUNT(*) FROM sys.tables WHERE is_ms_shipped = 0) AS tables,
        (SELECT COUNT(*) FROM sys.views WHERE is_ms_shipped = 0) AS views,
        (SELECT COUNT(*) FROM sys.procedures WHERE is_ms_shipped = 0) AS procedures,
        (SELECT COUNT(*) FROM sys.objects WHERE type IN ('FN','TF','IF','AF') AND is_ms_shipped = 0) AS functions,
        (SELECT COUNT(*) FROM sys.triggers WHERE is_ms_shipped = 0) AS triggers,
        (SELECT COUNT(*) FROM sys.schemas) AS schemas,
        (SELECT COUNT(*) FROM sys.indexes WHERE index_id > 0
           AND object_id IN (SELECT object_id FROM sys.tables WHERE is_ms_shipped = 0)) AS indexes
    `));

    const serverRolesQ = await safeQuery(pool, `
      SELECT r.name AS roleName
      FROM sys.server_role_members rm
      JOIN sys.server_principals r ON rm.role_principal_id = r.principal_id
      JOIN sys.server_principals m ON rm.member_principal_id = m.principal_id
      WHERE m.name = SUSER_SNAME()
      ORDER BY r.name
    `);
    const serverRoles = unwrap(serverRolesQ).map(x => x.roleName);
    if (serverRolesQ && serverRolesQ.__error) warnings.push("server roles: sin permisos para listar");

    const dbRolesQ = await safeQuery(pool, `
      SELECT r.name AS roleName
      FROM sys.database_role_members rm
      JOIN sys.database_principals r ON rm.role_principal_id = r.principal_id
      JOIN sys.database_principals m ON rm.member_principal_id = m.principal_id
      WHERE m.name = USER_NAME()
      ORDER BY r.name
    `);
    const dbRoles = unwrap(dbRolesQ).map(x => x.roleName);

    const permsQ = await safeQuery(pool, `
      SELECT permission_name AS permission, state_desc AS state
      FROM fn_my_permissions(NULL, 'DATABASE')
      ORDER BY permission_name
    `);
    let permissions = unwrap(permsQ);
    if (permsQ && permsQ.__error) {
      const fallback = await safeQuery(pool, `
        SELECT CAST(permission_name AS NVARCHAR(128)) AS permission,
               CAST([state] AS NVARCHAR(20)) AS state
        FROM fn_my_permissions(NULL, 'DATABASE')
        ORDER BY permission_name
      `);
      permissions = unwrap(fallback);
    }

    const otherDbsQ = await safeQuery(pool, `
      SELECT TOP 15 name
      FROM sys.databases
      WHERE database_id > 4
      ORDER BY name
    `);
    const otherDbs = unwrap(otherDbsQ).map(x => x.name);

    res.json({
      ok: true,
      warnings,
      connection: {
        id,
        name: def.name,
        type: def.type,
        authType: def.config.authType || "sql",
        server: def.config.server,
        port: def.config.port,
        database: def.config.database,
        user: def.config.user,
        domain: def.config.domain || null,
        encrypt: def.config.options?.encrypt ?? false,
        trustServerCertificate: def.config.options?.trustServerCertificate ?? true,
        latencyMs,
      },
      server: {
        name: serverInfo.serverName || null,
        version: serverInfo.version || null,
        productVersion: serverInfo.productVersion || null,
        productLevel: serverInfo.productLevel || null,
        edition: serverInfo.edition || null,
        collation: serverInfo.serverCollation || null,
      },
      database: {
        name: serverInfo.dbName || def.config.database,
        collation: dbInfo.dbCollation || null,
        recoveryModel: dbInfo.recoveryModel || null,
        state: dbInfo.dbState || null,
        created: dbInfo.dbCreated || null,
        compatibilityLevel: dbInfo.compatLevel || null,
        sizeMB: sizeRow.sizeMB ?? 0,
        dataMB: sizeRow.dataMB ?? 0,
        logMB: sizeRow.logMB ?? 0,
      },
      identity: {
        loginName: serverInfo.loginName || null,
        originalLogin: serverInfo.originalLogin || null,
        dbUser: serverInfo.dbUser || null,
        serverRoles,
        dbRoles,
        permissions,
      },
      counts: {
        tables: counts.tables ?? 0,
        views: counts.views ?? 0,
        procedures: counts.procedures ?? 0,
        functions: counts.functions ?? 0,
        triggers: counts.triggers ?? 0,
        schemas: counts.schemas ?? 0,
        indexes: counts.indexes ?? 0,
      },
      otherDatabases: otherDbs,
      tools: toolsForType(def.type),
      mcpType: def.type,
      readVerbs: READ_VERBS,
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  } finally {
    try { await pool.close(); } catch {}
  }
});

app.get("/api/windows-identity", (_req, res) => {
  try {
    const info = os.userInfo();
    const username = info.username || process.env.USERNAME || "";
    const domain = process.env.USERDOMAIN || process.env.USERDNSDOMAIN || os.hostname();
    res.json({ ok: true, user: username, domain });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/list-databases", async (req, res) => {
  const def = req.body;
  if (!def?.config?.server) {
    return res.status(400).json({ ok: false, error: "server requerido" });
  }
  const probeDef = {
    ...def,
    config: { ...def.config, database: "master" },
  };
  const poolCfg = buildMssqlConfig(probeDef, { queryTimeout: 8000 });
  poolCfg.connectionTimeout = 8000;
  const pool = new sql.ConnectionPool(poolCfg);
  try {
    await pool.connect();
    const r = await pool.request().query(`
      SELECT name
      FROM sys.databases
      WHERE state_desc = 'ONLINE'
        AND name NOT IN ('master','tempdb','model','msdb')
      ORDER BY name
    `);
    res.json({ ok: true, databases: r.recordset.map(x => x.name) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  } finally {
    try { await pool.close(); } catch {}
  }
});

const cfgOnStart = readCfg();
const PORT = cfgOnStart.settings.dashboardPort || 4567;
app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\nMultiSQL Pro Dashboard -> ${url}`);
  console.log(`Config: ${CONFIG_PATH}\n`);
  try {
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {}
});
