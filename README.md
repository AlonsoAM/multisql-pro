<div align="center">

# &#128202; MultiSQL Pro

### Servidor MCP profesional para SQL Server &middot; multi-conexion, permisos por entorno, dashboard con telemetria en vivo

[![Node](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![SQL Server](https://img.shields.io/badge/SQL%20Server-2016%2B-CC2927?style=flat-square&logo=microsoftsqlserver&logoColor=white)](https://www.microsoft.com/sql-server)
[![MCP](https://img.shields.io/badge/Protocol-MCP-4f7cff?style=flat-square)](https://modelcontextprotocol.io/)
[![License](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)](#licencia)
[![Author](https://img.shields.io/badge/author-Alonso%20Anchante-a78bfa?style=flat-square)](#autor)
[![Status](https://img.shields.io/badge/status-production%20ready-22c55e?style=flat-square)]()
[![Website](https://img.shields.io/badge/web-multisql--pro.vercel.app-000000?style=flat-square&logo=vercel&logoColor=white)](https://multisql-pro.vercel.app/es)

**Un solo MCP. N bases de datos. Permisos a prueba de balas. Configuracion en 30 segundos.**

[Sitio Web](https://multisql-pro.vercel.app/es) &middot;
[Caracteristicas](#caracteristicas) &middot;
[Instalacion](#instalacion) &middot;
[Dashboard](#configuracion-dashboard-web) &middot;
[Tools](#tools-expuestas-al-agente) &middot;
[Permisos](#modelo-de-permisos) &middot;
[API](#api-http-del-dashboard)

</div>

---

## Resumen

**MultiSQL Pro** es un servidor [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) que conecta cualquier agente de IA &mdash; **Claude Code**, **Claude Desktop**, **Cursor**, **Windsurf**, **VS Code MCP** &mdash; con multiples bases de datos **SQL Server** desde una sola interfaz parametrica.

Disenado para equipos que trabajan a diario contra varias instancias (cloud / on-prem / dev / qa / produccion) y necesitan que el agente:

- **Sepa contra cual BD esta operando** (sin tools duplicadas por entorno).
- **No pueda escribir en produccion ni por error** (parser SQL bloquea antes de tocar el motor).
- **Sea configurable sin tocar JSON a mano** (dashboard PRO con stats, status dots, auto-deteccion Windows y listado de BDs).

---

## Tabla de contenido

1. [Caracteristicas](#caracteristicas)
2. [Requisitos](#requisitos)
3. [Instalacion](#instalacion)
4. [Configuracion (dashboard web)](#configuracion-dashboard-web)
5. [Registrar el MCP en tu cliente](#registrar-el-mcp-en-tu-cliente)
6. [Migracion desde multisql-mcp v1](#migracion-desde-multisql-mcp-v1)
7. [Tools expuestas al agente](#tools-expuestas-al-agente)
8. [Modelo de permisos](#modelo-de-permisos)
9. [Comandos CLI](#comandos-cli)
10. [API HTTP del dashboard](#api-http-del-dashboard)
11. [Estructura del proyecto](#estructura-del-proyecto)
12. [Troubleshooting](#troubleshooting)
13. [Contribuir](#contribuir)
14. [Autor](#autor)
15. [Licencia](#licencia)

---

## Caracteristicas

- **N conexiones** identificadas por id libre (`cloud`, `local`, `qa`, `prod`, lo que necesites).
- **Autenticacion SQL y Windows (NTLM)** por conexion.
- **Tools parametricas**: una sola tool por accion (`execute_sql`, `list_tables`, ...) que recibe el `connection` como argumento.
- **Permisos por tipo de conexion**:
  - `dev` / `qa` -> lectura + escritura + DDL.
  - `readonly` / `prod` -> solo lectura. Un parser de SQL bloquea cualquier verbo de escritura (`INSERT`/`UPDATE`/`DELETE`/`MERGE`/`DROP`/`CREATE`/`ALTER`/`TRUNCATE`/`EXEC`/etc.) **antes** de que el query salga del servidor.
- **Dashboard web PRO** (Express + UI vanilla) con:
  - Tarjetas de estadisticas en vivo (Total / Online / Offline / Produccion).
  - **Status dot** por conexion (online / offline / probando) con latencia en ms.
  - **Auto-ping paralelo** al cargar y boton "Refrescar" manual.
  - **Buscador** en vivo por id, nombre, BD o host.
  - Modal de confirmacion custom (no usa `confirm()` nativo del browser).
  - **Auto-deteccion de identidad Windows** del usuario actual al elegir auth NTLM.
  - **Listado de bases de datos** disponibles en el servidor con un click (datalist autocomplete).
  - Atajos: `Esc` cierra modal, `Enter` confirma.
- **CLI** `multisql` con subcomandos `start`, `config`, `test`, `list`, `migrate`.
- **Migracion automatica** desde la version 1 (`multisql-mcp`).
- **Pools** reutilizables, cierre limpio en `SIGINT`/`SIGTERM`.

---

## Requisitos

- **Node.js 18 o superior** ([descargar](https://nodejs.org/)). Verifica con:
  ```bash
  node --version
  ```
- **SQL Server alcanzable** desde la maquina donde corras el MCP (puerto 1433 abierto, o el que uses).
- **Credenciales SQL** (usuario/password) **o** credenciales **Windows** (dominio/usuario/password) con permisos sobre la BD.
- Un **cliente MCP** compatible: Claude Code, Claude Desktop, Cursor, o cualquier IDE/agente que soporte el protocolo.

> Para conexiones tipo `prod` se recomienda **ademas** crear un usuario SQL con permisos de solo lectura en el motor (defensa en profundidad).

---

## Instalacion

### Opcion A: clonar desde GitHub

```bash
git clone https://github.com/<tu-org-o-usuario>/multisql-pro.git
cd multisql-pro
npm install
```

### Opcion B: descargar el ZIP

1. Descarga el ZIP del repositorio y descomprimelo donde prefieras.
2. Abre una terminal en esa carpeta.
3. Ejecuta:
   ```bash
   npm install
   ```

En cualquier caso, al terminar `npm install` ya tienes el MCP listo. La primera vez que ejecutes algun comando se generara automaticamente un `config.json` a partir de `config.example.json`.

---

## Configuracion (dashboard web)

La forma recomendada de configurar tus conexiones es el **dashboard**. Desde la raiz del proyecto:

```bash
npm run config
```

o equivalente:

```bash
node bin/multisql.js config
```

Esto:

1. Levanta un servidor local en `http://localhost:4567` (puerto configurable).
2. Abre tu navegador automaticamente.
3. Te muestra una UI tipo panel de control con:
   - **Stats en vivo** del estado de cada conexion (online/offline/produccion).
   - **Grid de conexiones** con borde lateral por estado y latencia en ms.
   - **Buscador** para filtrar conexiones cuando tienes muchas.
   - **+ Nueva conexion** para registrar una nueva.
   - Acciones por tarjeta: **Probar**, **Editar**, **Eliminar** (con modal custom de confirmacion).
   - Panel **Ajustes globales**: timeout de query, maximo de filas devueltas, puerto del dashboard.

### Crear una conexion

Al abrir el modal "Nueva conexion" / "Editar":

| Campo               | Detalle |
|---------------------|---------|
| **ID**              | Clave unica (ej. `cloud`, `qa`, `prod`). Es lo que usaras desde el agente. |
| **Nombre**          | Etiqueta legible (ej. `BD Produccion Cloud`). |
| **Tipo**            | `dev` / `qa` (RW) o `readonly` / `prod` (solo lectura, protegida). |
| **Autenticacion**   | `SQL Server` o `Windows (NTLM con dominio)`. |
| **Servidor / IP**   | Host o IP del motor SQL. |
| **Puerto**          | 1433 por defecto. |
| **Base de datos**   | Nombre directo, o usa el boton **Cargar** (ver abajo). |
| **Dominio**         | Solo visible en auth Windows. Usa el boton **Auto** para detectar el dominio actual. |
| **Usuario / Password** | Credenciales del motor. En modo Windows + auto-deteccion, el usuario se rellena solo. |
| **Encrypt / Trust** | Opciones TLS de `mssql`. |

#### Boton "Cargar" (base de datos)

Si rellenas servidor + usuario (+ password si es SQL auth) y presionas **Cargar**, el dashboard:

1. Se conecta a `master` con esas credenciales.
2. Lee `sys.databases` (filtra `master`, `tempdb`, `model`, `msdb`).
3. Pinta la lista en un `<datalist>` para que escribas con autocomplete y elijas la BD destino.

Util cuando no recuerdas el nombre exacto de la BD, o cuando exploras un servidor nuevo.

#### Boton "Auto" (dominio Windows)

Solo aparece cuando seleccionas auth `Windows (NTLM)`. Llama a `/api/windows-identity` y rellena:

- **Dominio** -> `process.env.USERDOMAIN` (o `USERDNSDOMAIN` / hostname como fallback).
- **Usuario** -> `os.userInfo().username`.

> **Importante:** la deteccion devuelve el usuario bajo el que corre el proceso del dashboard (`node`). Si levantas el dashboard tu mismo con `npm run config`, sera tu cuenta Windows. Si el server corre como servicio bajo otra cuenta, reportara esa cuenta.

> Las passwords nunca se devuelven al cliente del dashboard: se enmascaran como `********`. Si editas una conexion y dejas la password en blanco, se conserva la anterior.

### Configuracion manual (alternativa)

Si prefieres editar el JSON directamente, abre `config.json` (se crea en la raiz del proyecto):

```json
{
  "connections": {
    "cloud": {
      "name": "BD Cloud",
      "type": "dev",
      "config": {
        "authType": "sql",
        "server": "192.168.0.10",
        "port": 1433,
        "database": "MI_BD",
        "user": "miUsuario",
        "password": "miPassword",
        "options": { "encrypt": false, "trustServerCertificate": true }
      }
    },
    "intranet": {
      "name": "BD Intranet",
      "type": "dev",
      "config": {
        "authType": "windows",
        "server": "SRV-SQL01",
        "port": 1433,
        "database": "MI_BD",
        "domain": "MIDOMINIO",
        "user": "miUsuarioWindows",
        "password": "miPasswordWindows",
        "options": { "encrypt": false, "trustServerCertificate": true }
      }
    },
    "prod": {
      "name": "BD Produccion",
      "type": "prod",
      "config": {
        "authType": "sql",
        "server": "10.0.0.20",
        "port": 1433,
        "database": "MI_BD_PROD",
        "user": "lectorProd",
        "password": "***",
        "options": { "encrypt": false, "trustServerCertificate": true }
      }
    }
  },
  "settings": {
    "queryTimeout": 60000,
    "maxRows": 10000,
    "dashboardPort": 4567
  }
}
```

---

## Registrar el MCP en tu cliente

Una vez configuradas las conexiones, registra el MCP en tu cliente. **La ruta** a usar es la del archivo `src/server.js` dentro de la carpeta donde clonaste el proyecto.

### Claude Code

Edita (o crea) el archivo de configuracion de MCPs de Claude Code y agrega:

```json
{
  "mcpServers": {
    "multisql-pro": {
      "command": "node",
      "args": [
        "C:/ruta/absoluta/a/multisql-pro/src/server.js"
      ]
    }
  }
}
```

Tambien puedes registrar via CLI:

```bash
claude mcp add multisql-pro -- node "C:/ruta/absoluta/a/multisql-pro/src/server.js"
```

### Claude Desktop

Edita `claude_desktop_config.json`:

- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "multisql-pro": {
      "command": "node",
      "args": [
        "C:/ruta/absoluta/a/multisql-pro/src/server.js"
      ]
    }
  }
}
```

Reinicia Claude Desktop.

### Cursor / otros clientes MCP

La estructura es la misma: comando `node` + ruta absoluta a `src/server.js`. Consulta la documentacion de tu cliente sobre donde registrar servidores MCP.

### Verificar que el MCP esta activo

Una vez registrado y reiniciado el cliente, pidele al agente:

> "Lista las conexiones disponibles del MCP multisql-pro"

Deberia llamar a la tool `list_connections` y devolverte la lista que configuraste.

---

## Migracion desde multisql-mcp v1

Si ya tenias instalado el `multisql-mcp` original (v1, con tools `execute_sql_cloud` / `execute_sql_local`), migrar es de un comando:

```bash
node bin/multisql.js migrate "C:/ruta/al/viejo/multisql-mcp/config.json"
```

Que hace:

- Hace **backup** del `config.json` actual de MultiSQL Pro (si existe) con timestamp.
- Copia todas las conexiones de tu config v1.
- Las marca con `type: "dev"` y `authType: "sql"` por defecto. **Revisa cada una** despues y cambia a `prod`/`readonly` las que correspondan (puedes hacerlo en el dashboard).
- Conserva `queryTimeout` y `maxRows` si estaban configurados.

Despues:

1. Levanta el dashboard (`npm run config`) y ajusta el `type` de tus conexiones de produccion.
2. Actualiza el registro MCP de tu cliente: reemplaza el `command`/`args` del v1 por el de MultiSQL Pro (apuntando a `src/server.js` de este proyecto).
3. Reinicia el cliente.

> Las tools del v1 (`execute_sql_cloud`, `execute_sql_local`, ...) **no existen** en v2. Son reemplazadas por tools parametricas: `execute_sql` con `connection: "cloud"`. El agente de IA lo entiende automaticamente.

---

## Tools expuestas al agente

| Tool                    | Que hace                                                                            |
|-------------------------|-------------------------------------------------------------------------------------|
| `list_connections`      | Lista las conexiones configuradas (id, name, type, authType, server, database).     |
| `execute_sql`           | Ejecuta SQL en la `connection` indicada. Bloquea escritura en `prod`/`readonly`.    |
| `list_tables`           | Tablas y vistas del schema indicado (default: `dbo`).                                |
| `describe_table`        | Columnas, tipos, nulabilidad, PK e identity de una tabla.                            |
| `list_schemas`          | Esquemas de usuario.                                                                 |
| `search_objects`        | Busca tablas, vistas, SPs y funciones por nombre (LIKE).                             |
| `get_object_definition` | Devuelve el CREATE / cuerpo de un SP, funcion o vista.                               |

Todas reciben el parametro `connection` (excepto `list_connections`).

---

## Modelo de permisos

Cada conexion declara un `type` que define que puede hacer el agente sobre ella:

| type       | SELECT | INSERT/UPDATE/DELETE | DDL (CREATE/ALTER/DROP/...) | EXEC |
|------------|--------|----------------------|------------------------------|------|
| `dev`      | si     | si                   | si                           | si   |
| `qa`       | si     | si                   | si                           | si   |
| `readonly` | si     | **no**               | **no**                       | **no** |
| `prod`     | si     | **no**               | **no**                       | **no** |

### Como funciona el bloqueo

Antes de enviar el query al motor:

1. Se eliminan los comentarios SQL (`--`, `/* ... */`).
2. Se separa el query en statements por `;`, respetando comillas simples/dobles y `[...]`.
3. Se extrae el primer verbo SQL de cada statement.
4. Si la conexion es `readonly`/`prod` y algun verbo no pertenece a la whitelist de lectura (`SELECT`, `WITH`, `DECLARE`, `SET`, `USE`, `PRINT`, `IF`, `BEGIN`, `COMMIT`, `ROLLBACK`, ...), el query es **rechazado** con un mensaje claro y el motor SQL **nunca lo recibe**.

Se recomienda **ademas** configurar un usuario SQL con permisos minimos a nivel de motor (defensa en profundidad).

---

## Comandos CLI

```bash
node bin/multisql.js start                  # Inicia MCP server (stdio). Lo invoca tu cliente MCP.
node bin/multisql.js config                 # Abre el dashboard web.
node bin/multisql.js test <conn>            # Prueba una conexion por id.
node bin/multisql.js list                   # Lista conexiones (passwords enmascaradas).
node bin/multisql.js migrate <oldPath>      # Migra config.json de multisql-mcp v1.
node bin/multisql.js help                   # Ayuda.
```

Tambien disponibles via npm:

```bash
npm start              # equivalente a 'multisql start'
npm run config         # equivalente a 'multisql config'
npm run test-conn -- <conn>    # equivalente a 'multisql test <conn>'
```

---

## API HTTP del dashboard

El dashboard expone endpoints REST locales (consumidos por la UI, pero utiles si quieres automatizar):

| Metodo | Ruta                              | Descripcion                                                              |
|--------|-----------------------------------|--------------------------------------------------------------------------|
| GET    | `/api/config`                     | Config completa con passwords enmascaradas.                              |
| GET    | `/api/config/raw`                 | Config en crudo (uso interno, no exponer).                               |
| PUT    | `/api/settings`                   | Actualiza `settings` globales.                                           |
| POST   | `/api/connections`                | Crea conexion (`{ id, definition }`).                                    |
| PUT    | `/api/connections/:id`            | Actualiza conexion. `password === "********"` conserva la anterior.      |
| DELETE | `/api/connections/:id`            | Elimina conexion y cierra su pool.                                       |
| POST   | `/api/connections/:id/test`       | Prueba una conexion registrada. Devuelve version y database.             |
| POST   | `/api/test`                       | Prueba una definicion arbitraria (sin guardarla).                        |
| GET    | `/api/windows-identity`           | Devuelve `{ user, domain }` del proceso actual (auto-deteccion NTLM).    |
| POST   | `/api/list-databases`             | Conecta a `master` y devuelve `sys.databases` (sin BDs de sistema).      |

> El dashboard solo escucha en `localhost`. No lo expongas a internet sin autenticacion delante.

---

## Estructura del proyecto

```
multisql-pro/
├── package.json
├── config.example.json        # plantilla; copiada a config.json en el primer arranque
├── config.json                # tu configuracion (ignorada por git)
├── README.md
├── bin/
│   └── multisql.js            # CLI: start | config | test | list | migrate | help
├── src/
│   ├── server.js              # entrada MCP (stdio)
│   ├── config.js              # carga/guarda/valida config (zod)
│   ├── connections.js         # pool manager + buildMssqlConfig (SQL/Windows auth)
│   ├── security.js            # parser SQL + guard read-only
│   ├── queries.js             # queries reutilizables (listTables, describe, ...)
│   ├── tools.js               # definicion de tools parametricas
│   └── handlers.js            # logica por tool
└── dashboard/
    ├── server.js              # Express + endpoints CRUD + identity + list-databases
    └── public/
        ├── index.html         # UI PRO con stats, search, modal confirm
        ├── styles.css         # tema oscuro, gradients, status dots
        └── app.js             # ping paralelo, filtro, autodetect, load DBs
```

---

## Troubleshooting

**El cliente MCP no detecta el server.**
- Verifica que `node --version` >= 18.
- Verifica que la ruta a `src/server.js` en el registro MCP sea **absoluta** y exista.
- Revisa el log del cliente (Claude Code muestra los stderr de los MCPs en su panel de logs).

**`Login failed for user`.**
- Confirma usuario/password con el dashboard (boton "Probar conexion").
- Si usas Windows auth, asegurate de tener `authType: "windows"` y un `domain` correcto.
- En SQL Server, verifica que el modo de autenticacion del servidor coincida (mixed vs Windows).

**El boton "Auto" detecto un usuario que no esperaba.**
- `/api/windows-identity` reporta el usuario bajo el que corre el proceso `node`. Si lanzaste el dashboard tu mismo, es tu cuenta. Si corre como servicio, es la cuenta del servicio.

**El boton "Cargar" no lista bases de datos.**
- Tu usuario necesita permiso `VIEW ANY DATABASE` (o ser sysadmin) para enumerar `sys.databases`.
- Verifica que el servidor + puerto sean alcanzables y que la auth sea correcta.

**`self signed certificate` / `certificate not trusted`.**
- Pon `trustServerCertificate: true` y `encrypt: false` en `options` (default).
- En produccion con TLS real, usa `encrypt: true` y `trustServerCertificate: false` con un certificado valido.

**Una conexion `prod` rechaza mi query inocente.**
- El parser bloquea cualquier verbo que no este en la whitelist de lectura, incluyendo `EXEC` (porque un SP puede escribir). Si necesitas ejecutar un SP de lectura en prod, considera marcarla como `readonly` (no bloquea menos), o reescribe el query como `SELECT`.

**No tengo Node.js instalado.**
- Descarga e instala la version LTS desde [nodejs.org](https://nodejs.org/). En Windows puedes usar el instalador `.msi` o `winget install OpenJS.NodeJS.LTS`.

---

## Contribuir

Pull requests bienvenidos. Para cambios grandes, abre primero un issue para discutir el alcance.

Convenciones:

- Commits en español con [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, etc).
- Una sola responsabilidad por PR.
- Documenta en el README cualquier cambio que afecte la API publica de tools.

---

## Autor

<div align="center">
      <img src="https://img.shields.io/badge/AA-Alonso%20Anchante-4f7cff?style=for-the-badge" alt="Alonso Anchante" /><br/>
      <sub><b>Full Stack Engineer</b></sub><br/>
      <sub>Ica &middot; Peru</sub>
    </td>
</div>

---

## Licencia

Distribuido bajo licencia **MIT**. Consulta el archivo [`LICENSE`](LICENSE) para los terminos completos.

```
Copyright (c) 2026 Alonso Anchante

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, subject to the conditions of the MIT License.
```

---

<div align="center">

### MultiSQL Pro

<sub>Disenado y desarrollado con &#9889; por <b>Alonso Anchante</b></sub><br/>
<sub>SQL Server &middot; Model Context Protocol &middot; Node.js 18+</sub>

<br/>

[![Made with Node.js](https://img.shields.io/badge/made%20with-Node.js-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![SQL Server](https://img.shields.io/badge/powered%20by-SQL%20Server-CC2927?style=flat-square&logo=microsoftsqlserver&logoColor=white)](https://www.microsoft.com/sql-server)
[![MCP](https://img.shields.io/badge/MCP-compatible-4f7cff?style=flat-square)](https://modelcontextprotocol.io/)

<sub>&copy; 2026 Alonso Anchante &middot; Todos los derechos reservados &middot; MIT License</sub>

<sub><a href="#-multisql-pro">&#8593; Volver arriba</a></sub>

</div>
