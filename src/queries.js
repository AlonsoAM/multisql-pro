/**
 * Queries reutilizables. Reciben pool ya conectado.
 * Usan parametros (.input) en lugar de interpolacion para evitar injection.
 */
import sql from "mssql";

export async function runQuery(pool, query, maxRows) {
  const req = pool.request();
  const result = await req.query(query);
  const recordset = result.recordset || [];
  const truncated = maxRows && recordset.length > maxRows;
  const rows = truncated ? recordset.slice(0, maxRows) : recordset;
  return {
    success: true,
    rowCount: recordset.length,
    truncated: !!truncated,
    columns: rows.length > 0 ? Object.keys(rows[0]) : [],
    rows,
    recordsets: result.recordsets?.length > 1 ? result.recordsets.length : undefined,
  };
}

export async function listTables(pool, schema = "dbo") {
  const r = await pool
    .request()
    .input("schema", sql.NVarChar, schema).query(`
      SELECT
        t.TABLE_SCHEMA,
        t.TABLE_NAME,
        t.TABLE_TYPE,
        (SELECT COUNT(*) FROM sys.columns c
         INNER JOIN sys.tables ta ON c.object_id = ta.object_id
         WHERE ta.name = t.TABLE_NAME AND SCHEMA_NAME(ta.schema_id) = t.TABLE_SCHEMA) AS ColumnCount
      FROM INFORMATION_SCHEMA.TABLES t
      WHERE t.TABLE_SCHEMA = @schema
      ORDER BY t.TABLE_TYPE, t.TABLE_NAME
    `);
  return { success: true, rowCount: r.recordset.length, rows: r.recordset };
}

export async function describeTable(pool, tableName, schema = "dbo") {
  const r = await pool
    .request()
    .input("schema", sql.NVarChar, schema)
    .input("tbl", sql.NVarChar, tableName).query(`
      SELECT
        c.COLUMN_NAME,
        c.DATA_TYPE,
        c.CHARACTER_MAXIMUM_LENGTH,
        c.NUMERIC_PRECISION,
        c.NUMERIC_SCALE,
        c.IS_NULLABLE,
        c.COLUMN_DEFAULT,
        CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 'PRIMARY KEY' ELSE '' END AS KeyType,
        COLUMNPROPERTY(OBJECT_ID(QUOTENAME(@schema) + '.' + QUOTENAME(@tbl)), c.COLUMN_NAME, 'IsIdentity') AS IsIdentity
      FROM INFORMATION_SCHEMA.COLUMNS c
      LEFT JOIN (
        SELECT ku.TABLE_SCHEMA, ku.TABLE_NAME, ku.COLUMN_NAME
        FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
        INNER JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
          ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
         AND tc.TABLE_SCHEMA = ku.TABLE_SCHEMA
        WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
      ) pk
        ON c.TABLE_SCHEMA = pk.TABLE_SCHEMA
       AND c.TABLE_NAME = pk.TABLE_NAME
       AND c.COLUMN_NAME = pk.COLUMN_NAME
      WHERE c.TABLE_NAME = @tbl AND c.TABLE_SCHEMA = @schema
      ORDER BY c.ORDINAL_POSITION
    `);
  return { success: true, rowCount: r.recordset.length, rows: r.recordset };
}

export async function listSchemas(pool) {
  const r = await pool.request().query(`
    SELECT SCHEMA_NAME
    FROM INFORMATION_SCHEMA.SCHEMATA
    WHERE SCHEMA_NAME NOT IN ('information_schema', 'sys', 'db_accessadmin', 'db_backupoperator',
                              'db_datareader', 'db_datawriter', 'db_ddladmin', 'db_denydatareader',
                              'db_denydatawriter', 'db_owner', 'db_securityadmin')
    ORDER BY SCHEMA_NAME
  `);
  return { success: true, rowCount: r.recordset.length, rows: r.recordset };
}

export async function searchObjects(pool, term) {
  const r = await pool
    .request()
    .input("term", sql.NVarChar, `%${term}%`).query(`
      SELECT 'TABLE' AS ObjectType, TABLE_SCHEMA AS SchemaName, TABLE_NAME AS ObjectName
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME LIKE @term
      UNION ALL
      SELECT 'PROCEDURE', ROUTINE_SCHEMA, ROUTINE_NAME
      FROM INFORMATION_SCHEMA.ROUTINES
      WHERE ROUTINE_TYPE = 'PROCEDURE' AND ROUTINE_NAME LIKE @term
      UNION ALL
      SELECT 'FUNCTION', ROUTINE_SCHEMA, ROUTINE_NAME
      FROM INFORMATION_SCHEMA.ROUTINES
      WHERE ROUTINE_TYPE = 'FUNCTION' AND ROUTINE_NAME LIKE @term
      UNION ALL
      SELECT 'VIEW', TABLE_SCHEMA, TABLE_NAME
      FROM INFORMATION_SCHEMA.VIEWS
      WHERE TABLE_NAME LIKE @term
      ORDER BY ObjectType, SchemaName, ObjectName
    `);
  return { success: true, rowCount: r.recordset.length, rows: r.recordset };
}

export async function getObjectDefinition(pool, objectName, schema = "dbo") {
  const r = await pool
    .request()
    .input("schema", sql.NVarChar, schema)
    .input("name", sql.NVarChar, objectName).query(`
      SELECT
        o.type_desc AS ObjectType,
        OBJECT_DEFINITION(o.object_id) AS Definition
      FROM sys.objects o
      WHERE o.name = @name AND SCHEMA_NAME(o.schema_id) = @schema
    `);
  return { success: true, rowCount: r.recordset.length, rows: r.recordset };
}
