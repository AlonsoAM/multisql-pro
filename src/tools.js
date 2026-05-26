/**
 * Definicion de tools MCP parametricas.
 * Cada tool de SQL recibe 'connection' (id de conexion).
 * En descripcion se inyectan las conexiones disponibles para guiar al modelo.
 */

export function buildTools(config) {
  const connList = Object.entries(config.connections)
    .map(([id, c]) => `'${id}' (${c.name}, type=${c.type})`)
    .join(", ");
  const connDesc = connList || "(ninguna configurada - usa el dashboard: 'multisql config')";

  const connectionEnum = Object.keys(config.connections);
  const connectionProp = {
    type: "string",
    description: `ID de la conexion. Disponibles: ${connDesc}`,
    ...(connectionEnum.length > 0 ? { enum: connectionEnum } : {}),
  };

  return [
    {
      name: "list_connections",
      description:
        "Lista todas las conexiones configuradas con su id, nombre, tipo (dev/prod/qa/readonly), servidor y base de datos.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "execute_sql",
      description:
        "Ejecuta SQL en la conexion indicada. En conexiones type=prod/readonly solo se permiten queries de lectura (SELECT/WITH); cualquier verbo de escritura o DDL es rechazado.",
      inputSchema: {
        type: "object",
        properties: {
          connection: connectionProp,
          query: { type: "string", description: "Query SQL a ejecutar" },
        },
        required: ["connection", "query"],
      },
    },
    {
      name: "list_tables",
      description: "Lista tablas y vistas del esquema indicado en la conexion.",
      inputSchema: {
        type: "object",
        properties: {
          connection: connectionProp,
          schema: { type: "string", description: "Nombre del esquema (default: dbo)", default: "dbo" },
        },
        required: ["connection"],
      },
    },
    {
      name: "describe_table",
      description: "Describe columnas, tipos, nulabilidad, PK e identity de una tabla.",
      inputSchema: {
        type: "object",
        properties: {
          connection: connectionProp,
          tableName: { type: "string", description: "Nombre de la tabla" },
          schema: { type: "string", description: "Esquema (default: dbo)", default: "dbo" },
        },
        required: ["connection", "tableName"],
      },
    },
    {
      name: "list_schemas",
      description: "Lista los esquemas de usuario de la base de datos.",
      inputSchema: {
        type: "object",
        properties: { connection: connectionProp },
        required: ["connection"],
      },
    },
    {
      name: "search_objects",
      description: "Busca tablas, vistas, procedimientos y funciones por nombre (LIKE).",
      inputSchema: {
        type: "object",
        properties: {
          connection: connectionProp,
          searchTerm: { type: "string", description: "Texto a buscar" },
        },
        required: ["connection", "searchTerm"],
      },
    },
    {
      name: "get_object_definition",
      description: "Devuelve el CREATE / cuerpo de un SP, funcion o vista.",
      inputSchema: {
        type: "object",
        properties: {
          connection: connectionProp,
          objectName: { type: "string", description: "Nombre del objeto" },
          schema: { type: "string", description: "Esquema (default: dbo)", default: "dbo" },
        },
        required: ["connection", "objectName"],
      },
    },
  ];
}
