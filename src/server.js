#!/usr/bin/env node
/**
 * MultiSQL Pro - MCP Server (stdio).
 * N conexiones, tools parametricas, permisos por tipo de conexion.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { loadConfig } from "./config.js";
import { buildTools } from "./tools.js";
import { handle } from "./handlers.js";
import { closeAll } from "./connections.js";

let config = loadConfig();

const server = new Server(
  { name: "multisql-pro", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: buildTools(config) };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await handle(name, args || {}, config);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      isError: result?.success === false,
    };
  } catch (err) {
    console.error(`[${name}] error:`, err);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { success: false, error: err.message, tool: name },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
});

async function shutdown(signal) {
  console.error(`\n[${signal}] cerrando MultiSQL Pro...`);
  await closeAll();
  try {
    await server.close();
  } catch {}
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

async function main() {
  const transport = new StdioServerTransport();
  console.error("MultiSQL Pro 2.0 iniciando...");
  const ids = Object.keys(config.connections);
  console.error(`Conexiones configuradas (${ids.length}): ${ids.join(", ") || "(ninguna)"}`);
  await server.connect(transport);
  console.error("MCP listo (stdio)");
}

main().catch((err) => {
  console.error("Error fatal:", err);
  process.exit(1);
});
