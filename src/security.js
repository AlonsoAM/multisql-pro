/**
 * Guard de SQL para conexiones read-only (type=prod o type=readonly).
 * Detecta el verbo SQL de cada statement y bloquea escritura/DDL.
 */

const WRITE_VERBS = new Set([
  "INSERT",
  "UPDATE",
  "DELETE",
  "MERGE",
  "TRUNCATE",
  "DROP",
  "CREATE",
  "ALTER",
  "RENAME",
  "GRANT",
  "REVOKE",
  "DENY",
  "BACKUP",
  "RESTORE",
  "BULK",
  "EXEC",
  "EXECUTE",
  "SHUTDOWN",
  "DBCC",
  "DISABLE",
  "ENABLE",
]);

const READ_VERBS = new Set([
  "SELECT",
  "WITH",
  "DECLARE",
  "SET",
  "USE",
  "PRINT",
  "IF",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "SAVE",
  "SHOW",
]);

const READONLY_TYPES = new Set(["prod", "readonly"]);

export function isReadOnlyType(type) {
  return READONLY_TYPES.has(type);
}

function stripComments(sql) {
  let out = sql.replace(/\/\*[\s\S]*?\*\//g, " ");
  out = out.replace(/--[^\n\r]*/g, " ");
  return out;
}

function splitStatements(sql) {
  const stripped = stripComments(sql);
  const parts = [];
  let buf = "";
  let inSingle = false;
  let inDouble = false;
  let inBracket = false;
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === "'" && !inDouble && !inBracket) {
      if (inSingle && stripped[i + 1] === "'") {
        buf += "''";
        i++;
        continue;
      }
      inSingle = !inSingle;
      buf += ch;
      continue;
    }
    if (ch === '"' && !inSingle && !inBracket) {
      inDouble = !inDouble;
      buf += ch;
      continue;
    }
    if (ch === "[" && !inSingle && !inDouble) {
      inBracket = true;
      buf += ch;
      continue;
    }
    if (ch === "]" && inBracket) {
      inBracket = false;
      buf += ch;
      continue;
    }
    if (ch === ";" && !inSingle && !inDouble && !inBracket) {
      const t = buf.trim();
      if (t) parts.push(t);
      buf = "";
      continue;
    }
    buf += ch;
  }
  const last = buf.trim();
  if (last) parts.push(last);
  return parts;
}

export function extractVerb(statement) {
  const cleaned = statement
    .replace(/^[\s\(]+/, "")
    .replace(/^\bWITH\b[\s\S]*?\)\s*(?=SELECT|INSERT|UPDATE|DELETE|MERGE)/i, "");
  const m = cleaned.match(/^\s*([A-Za-z_]+)/);
  if (!m) return null;
  return m[1].toUpperCase();
}

/**
 * Valida un query contra el tipo de conexion.
 * @returns {{ ok: boolean, error?: string, blockedVerb?: string }}
 */
export function validateQuery(query, connectionType) {
  if (!isReadOnlyType(connectionType)) {
    return { ok: true };
  }
  const statements = splitStatements(query);
  if (statements.length === 0) {
    return { ok: false, error: "Query vacio" };
  }
  for (const stmt of statements) {
    const verb = extractVerb(stmt);
    if (!verb) continue;
    if (WRITE_VERBS.has(verb)) {
      return {
        ok: false,
        blockedVerb: verb,
        error: `Operacion '${verb}' bloqueada en conexion read-only (type='${connectionType}'). Solo lectura permitida.`,
      };
    }
    if (!READ_VERBS.has(verb)) {
      return {
        ok: false,
        blockedVerb: verb,
        error: `Verbo SQL '${verb}' no esta en whitelist de lectura para conexion read-only (type='${connectionType}').`,
      };
    }
  }
  return { ok: true };
}

export const _internal = { splitStatements, stripComments };
