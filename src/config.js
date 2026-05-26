/**
 * Carga, validacion y persistencia de configuracion.
 * Crea config.json desde config.example.json si no existe.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");

export const CONFIG_PATH = join(ROOT, "config.json");
export const EXAMPLE_PATH = join(ROOT, "config.example.json");

const ConnectionConfigSchema = z.object({
  authType: z.enum(["sql", "windows"]).default("sql"),
  server: z.string().min(1),
  port: z.number().int().positive().default(1433),
  database: z.string().min(1),
  domain: z.string().optional(),
  user: z.string().min(1),
  password: z.string(),
  options: z
    .object({
      encrypt: z.boolean().default(false),
      trustServerCertificate: z.boolean().default(true),
    })
    .partial()
    .default({}),
});

const ConnectionSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["dev", "prod", "qa", "readonly"]).default("dev"),
  config: ConnectionConfigSchema,
});

const ConfigSchema = z.object({
  connections: z.record(z.string(), ConnectionSchema).default({}),
  settings: z
    .object({
      queryTimeout: z.number().int().positive().default(60000),
      maxRows: z.number().int().positive().default(10000),
      dashboardPort: z.number().int().positive().default(4567),
    })
    .default({}),
});

export function ensureConfigExists() {
  if (!existsSync(CONFIG_PATH)) {
    if (existsSync(EXAMPLE_PATH)) {
      copyFileSync(EXAMPLE_PATH, CONFIG_PATH);
      console.error(`[config] Generado config.json desde example. Edita ${CONFIG_PATH}`);
    } else {
      writeFileSync(
        CONFIG_PATH,
        JSON.stringify({ connections: {}, settings: {} }, null, 2),
        "utf-8"
      );
    }
  }
}

export function loadConfig() {
  ensureConfigExists();
  const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  return ConfigSchema.parse(raw);
}

export function saveConfig(cfg) {
  const validated = ConfigSchema.parse(cfg);
  writeFileSync(CONFIG_PATH, JSON.stringify(validated, null, 2), "utf-8");
  return validated;
}

export function maskConfig(cfg) {
  const clone = JSON.parse(JSON.stringify(cfg));
  for (const id of Object.keys(clone.connections || {})) {
    if (clone.connections[id]?.config?.password) {
      clone.connections[id].config.password = "********";
    }
  }
  return clone;
}

export { ConfigSchema, ConnectionSchema };
