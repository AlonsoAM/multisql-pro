/**
 * Logica de cada tool MCP.
 */
import { getPool, getConnectionDef } from "./connections.js";
import { validateQuery } from "./security.js";
import {
  runQuery,
  listTables,
  describeTable,
  listSchemas,
  searchObjects,
  getObjectDefinition,
} from "./queries.js";

function listConnections(config) {
  return {
    success: true,
    connections: Object.entries(config.connections).map(([id, c]) => ({
      id,
      name: c.name,
      type: c.type,
      authType: c.config.authType || "sql",
      server: c.config.server,
      database: c.config.database,
      readOnly: c.type === "prod" || c.type === "readonly",
    })),
  };
}

export async function handle(toolName, args, config) {
  if (toolName === "list_connections") {
    return listConnections(config);
  }

  const connId = args?.connection;
  if (!connId) {
    return { success: false, error: "Parametro 'connection' requerido" };
  }
  const def = getConnectionDef(config, connId);

  switch (toolName) {
    case "execute_sql": {
      const q = args.query;
      if (!q || typeof q !== "string") {
        return { success: false, error: "Parametro 'query' requerido" };
      }
      const check = validateQuery(q, def.type);
      if (!check.ok) {
        return {
          success: false,
          error: check.error,
          blockedVerb: check.blockedVerb,
          connection: connId,
          connectionType: def.type,
        };
      }
      const pool = await getPool(config, connId);
      return await runQuery(pool, q, config.settings.maxRows);
    }
    case "list_tables": {
      const pool = await getPool(config, connId);
      return await listTables(pool, args.schema || "dbo");
    }
    case "describe_table": {
      if (!args.tableName) return { success: false, error: "tableName requerido" };
      const pool = await getPool(config, connId);
      return await describeTable(pool, args.tableName, args.schema || "dbo");
    }
    case "list_schemas": {
      const pool = await getPool(config, connId);
      return await listSchemas(pool);
    }
    case "search_objects": {
      if (!args.searchTerm) return { success: false, error: "searchTerm requerido" };
      const pool = await getPool(config, connId);
      return await searchObjects(pool, args.searchTerm);
    }
    case "get_object_definition": {
      if (!args.objectName) return { success: false, error: "objectName requerido" };
      const pool = await getPool(config, connId);
      return await getObjectDefinition(pool, args.objectName, args.schema || "dbo");
    }
    default:
      return { success: false, error: `Tool desconocida: ${toolName}` };
  }
}
