/**
 * Pool manager para N conexiones SQL Server.
 * Soporta autenticacion SQL (user/password) y Windows (NTLM con domain/user/password).
 * Lazy connect, cierre limpio, testConnection.
 */
import sql from "mssql";

const pools = new Map();

export function getConnectionDef(config, id) {
  const def = config.connections[id];
  if (!def) {
    const available = Object.keys(config.connections).join(", ") || "(ninguna)";
    throw new Error(`Conexion '${id}' no existe. Disponibles: ${available}`);
  }
  return def;
}

/**
 * Construye el objeto de configuracion que espera `mssql`.
 * Si authType === 'windows' usa autenticacion NTLM (driver tedious).
 */
export function buildMssqlConfig(connDef, settings = {}) {
  const c = connDef.config;
  const base = {
    server: c.server,
    port: c.port,
    database: c.database,
    options: {
      encrypt: c.options?.encrypt ?? false,
      trustServerCertificate: c.options?.trustServerCertificate ?? true,
    },
    requestTimeout: settings.queryTimeout ?? 60000,
    connectionTimeout: 15000,
  };
  if (c.authType === "windows") {
    base.authentication = {
      type: "ntlm",
      options: {
        userName: c.user,
        password: c.password,
        domain: c.domain || "",
      },
    };
  } else {
    base.user = c.user;
    base.password = c.password;
  }
  return base;
}

export async function getPool(config, id) {
  if (pools.has(id)) return pools.get(id);
  const def = getConnectionDef(config, id);
  const poolCfg = buildMssqlConfig(def, config.settings);
  const pool = new sql.ConnectionPool(poolCfg);
  pool.on("error", (err) => {
    console.error(`[${id}] pool error:`, err.message);
  });
  await pool.connect();
  pools.set(id, pool);
  const auth = def.config.authType === "windows" ? "windows" : "sql";
  console.error(`[${id}] conectado (${def.name}, type=${def.type}, auth=${auth})`);
  return pool;
}

export async function testConnection(connDef) {
  const poolCfg = buildMssqlConfig(connDef, { queryTimeout: 8000 });
  poolCfg.connectionTimeout = 8000;
  const pool = new sql.ConnectionPool(poolCfg);
  try {
    await pool.connect();
    const r = await pool
      .request()
      .query("SELECT @@VERSION AS version, DB_NAME() AS db, SUSER_SNAME() AS loginName");
    return {
      ok: true,
      version: r.recordset[0].version,
      database: r.recordset[0].db,
      loginName: r.recordset[0].loginName,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    try {
      await pool.close();
    } catch {}
  }
}

export async function closeAll() {
  for (const [id, pool] of pools.entries()) {
    try {
      await pool.close();
      console.error(`[${id}] cerrado`);
    } catch (e) {
      console.error(`[${id}] error cierre:`, e.message);
    }
  }
  pools.clear();
}

export function invalidatePool(id) {
  const p = pools.get(id);
  if (p) {
    p.close().catch(() => {});
    pools.delete(id);
  }
}
