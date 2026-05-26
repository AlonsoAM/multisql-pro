#!/usr/bin/env node
/**
 * CLI de MultiSQL Pro.
 *   multisql start          -> levanta MCP server (stdio)
 *   multisql config         -> dashboard web de configuracion
 *   multisql test <conn>    -> prueba una conexion
 *   multisql list           -> lista conexiones configuradas
 */
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync, readFileSync, copyFileSync } from "fs";
import { loadConfig, maskConfig, saveConfig, CONFIG_PATH } from "../src/config.js";
import { testConnection } from "../src/connections.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");

const [, , cmd, ...rest] = process.argv;

function usage() {
  console.log(`
MultiSQL Pro CLI

Comandos:
  multisql start                Inicia servidor MCP (stdio).
  multisql config               Abre dashboard web de configuracion.
  multisql test <conn>          Prueba una conexion por id.
  multisql list                 Lista conexiones configuradas.
  multisql migrate <oldPath>    Migra config.json de multisql-mcp v1 a v2.
  multisql help                 Esta ayuda.
`);
}

async function runStart() {
  await import("../src/server.js");
}

async function runConfig() {
  const child = spawn(process.execPath, [join(ROOT, "dashboard", "server.js")], {
    stdio: "inherit",
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}

async function runTest(connId) {
  if (!connId) {
    console.error("Uso: multisql test <conn>");
    process.exit(1);
  }
  const cfg = loadConfig();
  const def = cfg.connections[connId];
  if (!def) {
    console.error(`Conexion '${connId}' no existe. Disponibles: ${Object.keys(cfg.connections).join(", ") || "(ninguna)"}`);
    process.exit(1);
  }
  console.log(`Probando '${connId}' (${def.name}) -> ${def.config.server}/${def.config.database} ...`);
  const r = await testConnection(def);
  if (r.ok) {
    console.log(`OK | db=${r.database}`);
    console.log(r.version);
  } else {
    console.error(`FAIL: ${r.error}`);
    process.exit(2);
  }
}

async function runList() {
  const cfg = loadConfig();
  const masked = maskConfig(cfg);
  const rows = Object.entries(masked.connections).map(([id, c]) => ({
    id,
    name: c.name,
    type: c.type,
    server: c.config.server,
    database: c.config.database,
  }));
  if (rows.length === 0) {
    console.log("Sin conexiones. Configura con: multisql config");
    return;
  }
  console.table(rows);
}

async function runMigrate(oldPath) {
  if (!oldPath) {
    console.error("Uso: multisql migrate <ruta a config.json de multisql-mcp v1>");
    process.exit(1);
  }
  if (!existsSync(oldPath)) {
    console.error(`No existe: ${oldPath}`);
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(oldPath, "utf-8"));
  if (!raw.connections || typeof raw.connections !== "object") {
    console.error("config.json invalido: falta 'connections'");
    process.exit(1);
  }
  if (existsSync(CONFIG_PATH)) {
    const backup = CONFIG_PATH + ".bak-" + Date.now();
    copyFileSync(CONFIG_PATH, backup);
    console.log(`Backup del config actual -> ${backup}`);
  }
  const migrated = {
    connections: {},
    settings: {
      queryTimeout: raw.settings?.queryTimeout ?? 60000,
      maxRows: raw.settings?.maxRows ?? 10000,
      dashboardPort: 4567,
    },
  };
  let count = 0;
  for (const [id, c] of Object.entries(raw.connections)) {
    if (!c?.config) {
      console.warn(`- Omitiendo '${id}' (sin config)`);
      continue;
    }
    migrated.connections[id] = {
      name: c.name || id,
      type: "dev",
      config: {
        authType: "sql",
        server: c.config.server,
        port: c.config.port ?? 1433,
        database: c.config.database,
        user: c.config.user,
        password: c.config.password,
        options: {
          encrypt: c.config.options?.encrypt ?? false,
          trustServerCertificate: c.config.options?.trustServerCertificate ?? true,
        },
      },
    };
    count++;
    console.log(`+ ${id} (type=dev por defecto, authType=sql)`);
  }
  saveConfig(migrated);
  console.log(`\nMigracion completada. ${count} conexiones -> ${CONFIG_PATH}`);
  console.log("Revisa los 'type' (dev/qa/readonly/prod) en el dashboard: multisql config");
}

(async () => {
  switch (cmd) {
    case "start":
      return runStart();
    case "config":
      return runConfig();
    case "test":
      return runTest(rest[0]);
    case "list":
      return runList();
    case "migrate":
      return runMigrate(rest[0]);
    case "help":
    case "--help":
    case "-h":
    case undefined:
      return usage();
    default:
      console.error(`Comando desconocido: ${cmd}`);
      usage();
      process.exit(1);
  }
})().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
