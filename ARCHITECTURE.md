# MultiSQL Pro — Arquitectura Técnica

> Complemento técnico del README. Describe el diseño interno, flujo de datos, módulos y decisiones de implementación.

---

## Tabla de contenido

1. [Visión general](#visión-general)
2. [Diagrama de flujo de una tool call](#diagrama-de-flujo-de-una-tool-call)
3. [Módulos y responsabilidades](#módulos-y-responsabilidades)
4. [Capa de seguridad SQL](#capa-de-seguridad-sql)
5. [Pool de conexiones](#pool-de-conexiones)
6. [Esquema de configuración (Zod)](#esquema-de-configuración-zod)
7. [Herramientas MCP expuestas](#herramientas-mcp-expuestas)
8. [Dashboard (Express)](#dashboard-express)
9. [Decisiones de diseño](#decisiones-de-diseño)

---

## Visión general

MultiSQL Pro es un **servidor MCP** (Model Context Protocol) sobre `stdio`. El cliente AI (Claude Code, Claude Desktop, Cursor, etc.) lo lanza como subproceso y se comunica mediante JSON-RPC por stdin/stdout. Cada herramienta recibe el parámetro `connection` (ID de conexión) para operar contra la base de datos correcta.

```
Cliente AI (Claude / Cursor / VS Code)
        │  JSON-RPC / stdio
        ▼
  src/server.js          ← entry point MCP (stdio transport)
        │
        ├─ src/tools.js  ← define el schema de cada tool (inputSchema JSON)
        ├─ src/handlers.js ← despacha cada tool call
        │       ├─ src/security.js   ← valida SQL antes de enviarlo al motor
        │       ├─ src/connections.js ← pool manager (lazy connect, NTLM/SQL)
        │       └─ src/queries.js    ← queries parametrizadas a SQL Server
        └─ src/config.js  ← carga y valida config.json con Zod
```

El dashboard (`dashboard/server.js`) es un proceso **separado** (Express en localhost:4567) solo para configuración; no interviene en el flujo MCP normal.

---

## Diagrama de flujo de una tool call

```
AI llama: execute_sql { connection: "prod", query: "DELETE FROM ..." }
    │
    ▼
server.js  setRequestHandler(CallToolRequestSchema)
    │  extrae name + args
    ▼
handlers.js  handle("execute_sql", args, config)
    │
    ├─ getConnectionDef(config, "prod")
    │       si no existe → error inmediato con lista de IDs disponibles
    │
    ├─ validateQuery("DELETE ...", "prod")   ← security.js
    │       stripComments → splitStatements → extractVerb → WRITE_VERBS check
    │       "DELETE" ∈ WRITE_VERBS → { ok: false, error: "bloqueada" }
    │
    │   ← ERROR devuelto al agente. SQL Server nunca recibe el query.
    │
    ▼  (si fuera SELECT)
    getPool(config, "prod")   ← connections.js
        Si pool existe en Map → reutiliza
        Si no → buildMssqlConfig → sql.ConnectionPool.connect() → guarda en Map
    │
    ▼
    queries.js  runQuery(pool, query, maxRows)
        pool.request().query(sql)
        trunca a maxRows si aplica
    │
    ▼
server.js  envuelve resultado en { content: [{ type: "text", text: JSON }] }
    │  stdout
    ▼
Cliente AI recibe el resultado
```

---

## Módulos y responsabilidades

### `src/server.js`
- Crea el servidor MCP con `@modelcontextprotocol/sdk`.
- Registra dos handlers: `ListTools` (devuelve definiciones) y `CallTool` (ejecuta).
- Maneja `SIGINT`/`SIGTERM` para cierre limpio de pools.
- Carga `config.json` una sola vez al arrancar (no hot-reload; reiniciar el servidor si cambias la config manualmente).

### `src/tools.js`
- `buildTools(config)` genera la lista de tools con sus `inputSchema` JSON Schema.
- El parámetro `connection` es dinámico: inyecta los IDs configurados como `enum` para que el modelo sepa qué valores son válidos.
- Si no hay conexiones configuradas, el `enum` se omite y la descripción indica que se debe usar el dashboard.

### `src/handlers.js`
- Único punto de despacho para todas las tools.
- `list_connections` es la única tool sin parámetro `connection`; las demás lo requieren.
- Sigue el patrón: validar → obtener pool → ejecutar query → devolver resultado.
- Errores se devuelven como `{ success: false, error: "..." }` (no se lanzan excepciones; `server.js` las captura de todas formas).

### `src/security.js`
- **No depende de ningún otro módulo del proyecto** (pura lógica de strings).
- Pipeline: `stripComments` → `splitStatements` → `extractVerb` → lookup en `WRITE_VERBS`.
- `splitStatements` es un mini-parser que respeta comillas simples `'...'`, dobles `"..."` y corchetes `[...]` para no partir statements erroneamente.
- La whitelist de lectura (`READ_VERBS`) es explícita: si el verbo no está ni en write ni en read, también se bloquea (fail-closed).

### `src/connections.js`
- `pools: Map<string, ConnectionPool>` almacena pools reutilizables en memoria del proceso.
- `getPool` es lazy: conecta solo cuando se usa por primera vez.
- `buildMssqlConfig` traduce el formato interno de la config al formato que espera la librería `mssql`. Para auth Windows usa `authentication.type = "ntlm"`.
- `testConnection` crea un pool temporal (no se guarda en el Map), ejecuta `SELECT @@VERSION`, y lo cierra — usado por el dashboard y el CLI.
- `invalidatePool` cierra y elimina un pool específico (llamado por el dashboard al editar/eliminar una conexión).

### `src/config.js`
- Usa **Zod** para definir el schema y validar `config.json` en tiempo de carga.
- Si `config.json` no existe, lo crea copiando `config.example.json`.
- `maskConfig` enmascara passwords (`"********"`) antes de enviar la config al browser del dashboard.
- `saveConfig` valida con Zod antes de escribir a disco (previene config malformada).

### `src/queries.js`
- Todas las queries usan `.input(name, type, value)` de `mssql` para prevenir SQL injection (excepto `runQuery` que ejecuta el SQL crudo del agente, el cual ya pasó por `security.js`).
- `runQuery` respeta el límite `maxRows` (default 10 000) y reporta si el resultado fue truncado.
- Las queries de introspección (`listTables`, `describeTable`, etc.) usan `INFORMATION_SCHEMA` estándar, compatible con SQL Server 2016+.

---

## Capa de seguridad SQL

El parser en `security.js` opera en tres pasos antes de que cualquier query llegue al motor:

### 1. Eliminación de comentarios
```
/* comentario bloque */  →  espacio
-- comentario de línea  →  espacio
```
Evita bypass via `SELECT 1 /* DELETE */ FROM ...`.

### 2. Split de statements
El parser es stateful: mantiene flags `inSingle`, `inDouble`, `inBracket` para ignorar `;` dentro de literales y nombres con brackets:
```sql
INSERT INTO t VALUES('a;b');  -- el ';' dentro de '' no parte el statement
SELECT [col;name] FROM t;     -- el ';' dentro de [] tampoco
```

### 3. Extracción de verbo y lookup
Cada statement se limpia de espacios/paréntesis iniciales, luego se extrae la primera palabra:
```
extractVerb("  (SELECT * FROM t)")  →  "SELECT"
extractVerb("EXEC sp_help")         →  "EXEC"
```

**Lógica fail-closed**: si el verbo no está en `READ_VERBS` (ni siquiera es conocido), se bloquea. Esto protege contra verbos SQL no anticipados en versiones futuras de SQL Server.

### Verbos bloqueados en prod/readonly
`INSERT`, `UPDATE`, `DELETE`, `MERGE`, `TRUNCATE`, `DROP`, `CREATE`, `ALTER`, `RENAME`, `GRANT`, `REVOKE`, `DENY`, `BACKUP`, `RESTORE`, `BULK`, `EXEC`, `EXECUTE`, `SHUTDOWN`, `DBCC`, `DISABLE`, `ENABLE`

### Verbos permitidos en prod/readonly
`SELECT`, `WITH`, `DECLARE`, `SET`, `USE`, `PRINT`, `IF`, `BEGIN`, `COMMIT`, `ROLLBACK`, `SAVE`, `SHOW`

> `WITH` (CTEs) está permitido, pero el parser también verifica el statement que sigue al CTE. Un `WITH ... DELETE` sería bloqueado porque `DELETE` aparece como verbo de otro statement.

---

## Pool de conexiones

```
Primera llamada a getPool("cloud", config)
    │
    ▼
Map.has("cloud")? No
    │
    ▼
buildMssqlConfig(def, settings)
    ├── authType === "windows"?
    │       authentication: { type: "ntlm", options: { userName, password, domain } }
    └── else
            user, password directo en raíz del config
    │
    ▼
new sql.ConnectionPool(cfg)
pool.connect()        ← conexión TCP a SQL Server
pool.on("error", ...) ← errores asincrónicos logueados a stderr
pools.set("cloud", pool)
    │
    ▼
Llamadas subsecuentes: Map.has("cloud")? Sí → reutiliza pool

SIGINT/SIGTERM → closeAll() → pool.close() para cada ID → pools.clear()
```

El pool es de procesos/conversación: vive mientras el servidor MCP esté corriendo. Si el cliente MCP reinicia el servidor, se crean pools frescos.

---

## Esquema de configuración (Zod)

```typescript
// Forma canónica de config.json
{
  connections: {
    [id: string]: {
      name: string,                          // etiqueta legible
      type: "dev" | "prod" | "qa" | "readonly",
      config: {
        authType: "sql" | "windows",         // default "sql"
        server: string,                      // host o IP
        port: number,                        // default 1433
        database: string,
        domain?: string,                     // solo windows auth
        user: string,
        password: string,
        options: {
          encrypt: boolean,                  // default false
          trustServerCertificate: boolean,   // default true
        }
      }
    }
  },
  settings: {
    queryTimeout: number,    // ms, default 60000
    maxRows: number,         // default 10000
    dashboardPort: number,   // default 4567
  }
}
```

Zod valida en `loadConfig()` y `saveConfig()`. Si el JSON tiene campos extra, se ignoran (Zod por defecto hace strip). Si faltan campos con default, se rellenan.

---

## Herramientas MCP expuestas

| Tool | Parámetros requeridos | Parámetros opcionales | Bloqueable por security.js |
|---|---|---|---|
| `list_connections` | — | — | No |
| `execute_sql` | `connection`, `query` | — | Sí (prod/readonly) |
| `list_tables` | `connection` | `schema` (def: `dbo`) | No |
| `describe_table` | `connection`, `tableName` | `schema` (def: `dbo`) | No |
| `list_schemas` | `connection` | — | No |
| `search_objects` | `connection`, `searchTerm` | — | No |
| `get_object_definition` | `connection`, `objectName` | `schema` (def: `dbo`) | No |

Solo `execute_sql` pasa por el guard de `security.js`. Las demás tools usan queries internas parametrizadas (solo lectura por diseño).

---

## Dashboard (Express)

El dashboard en `dashboard/server.js` es un servidor Express **independiente** del MCP. Corre en `localhost:4567` (configurable) solo cuando se invoca `npm run config` o `multisql config`.

**No hay comunicación en tiempo real entre el dashboard y el servidor MCP**. Ambos comparten el mismo archivo `config.json` en disco. Si el MCP está corriendo y se modifica la config desde el dashboard, los cambios no se reflejan hasta que el servidor MCP se reinicia (el MCP carga la config una sola vez al arrancar).

El dashboard llama a `invalidatePool` para cerrar pools huérfanos cuando el usuario edita/elimina una conexión desde la UI, pero esto solo aplica si el dashboard y el MCP corren en el mismo proceso (lo cual no es el caso normal). En uso normal, reiniciar el cliente MCP es suficiente.

### Endpoints clave del dashboard

| Método | Ruta | Lógica |
|---|---|---|
| `GET /api/config` | Devuelve config con passwords enmascaradas (`maskConfig`) |
| `PUT /api/settings` | Valida con Zod parcial, fusiona con config actual, guarda |
| `POST /api/connections` | Valida con `ConnectionSchema`, añade al mapa, guarda |
| `PUT /api/connections/:id` | Si `password === "********"`, conserva la anterior |
| `DELETE /api/connections/:id` | Elimina del mapa, guarda, cierra pool si existe |
| `POST /api/connections/:id/test` | Llama `testConnection(def)` — pool temporal |
| `GET /api/windows-identity` | `process.env.USERDOMAIN`, `os.userInfo().username` |
| `POST /api/list-databases` | Conecta a `master`, `SELECT sys.databases` filtrado |

---

## Decisiones de diseño

**¿Por qué tools paramétricas en vez de una tool por conexión?**
Con N conexiones se evita registrar N×7 tools (lo cual contamina el contexto del modelo). Una sola tool `execute_sql` con `connection` como argumento es más limpia y escalable.

**¿Por qué bloquear en el servidor MCP y no solo en el motor SQL?**
El bloqueo a nivel de motor requiere configurar permisos en cada instancia SQL Server (defensa en profundidad recomendada pero no siempre posible). El guard en el MCP es universal, inmediato y visible en los logs — el query nunca sale del proceso.

**¿Por qué `config.json` en disco y no variables de entorno?**
Las variables de entorno son adecuadas para una sola conexión. Con N conexiones dinámicas un archivo JSON es más ergonómico, sobre todo con el dashboard. El archivo está en `.gitignore` para no exponer credenciales.

**¿Por qué la config no recarga en caliente?**
MCP sobre stdio es un proceso de corta vida: el cliente lo lanza, lo usa, y lo mata. El hot-reload añadiría complejidad (watchers, invalidación de pools) sin beneficio real para el caso de uso principal.

**¿Por qué Express para el dashboard y no la UI integrada en el MCP?**
El dashboard es una herramienta de configuración ocasional, no parte del protocolo MCP. Separarlo mantiene `server.js` pequeño y al dashboard independiente — si el dashboard falla, el MCP sigue funcionando.

---
