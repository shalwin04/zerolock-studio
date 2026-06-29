// Schema Introspector for Aurora DSQL
// Discovers tables, columns, indexes, and detects potential hotspots

import { Pool } from 'pg';
import { DsqlSigner } from '@aws-sdk/dsql-signer';
import {
  TableInfo,
  ColumnInfo,
  IndexInfo,
  HotspotWarning,
  SchemaDiscoveryResult,
} from '@/types/schema';

// Connection pool singleton
let pool: Pool | null = null;
let tokenExpiresAt = 0;

async function getPool(): Promise<Pool> {
  const now = Date.now();

  // Refresh if token expired (14 min buffer for 15 min tokens)
  if (pool && now < tokenExpiresAt - 60000) {
    return pool;
  }

  const hostname = process.env.AWS_DSQL_CLUSTER_ENDPOINT;
  const region = process.env.AWS_REGION || 'us-east-1';

  if (!hostname) {
    throw new Error('AWS_DSQL_CLUSTER_ENDPOINT not configured');
  }

  const signer = new DsqlSigner({ hostname, region });
  const token = await signer.getDbConnectAdminAuthToken();

  if (pool) {
    await pool.end();
  }

  pool = new Pool({
    host: hostname,
    port: 5432,
    database: process.env.AWS_DSQL_DATABASE || 'postgres',
    user: 'admin',
    password: token,
    ssl: { rejectUnauthorized: true },
    max: 5,
    idleTimeoutMillis: 30000,
  });

  tokenExpiresAt = now + 14 * 60 * 1000;
  return pool;
}

// Get all tables in public schema
async function getTables(client: Pool): Promise<{ name: string; schema: string; description: string | null }[]> {
  const result = await client.query(`
    SELECT
      t.table_schema as schema,
      t.table_name as name,
      pg_catalog.obj_description(
        (quote_ident(t.table_schema) || '.' || quote_ident(t.table_name))::regclass::oid,
        'pg_class'
      ) as description
    FROM information_schema.tables t
    WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND t.table_type = 'BASE TABLE'
    ORDER BY t.table_schema, t.table_name
  `);

  return result.rows.map(row => ({
    name: row.name,
    schema: row.schema,
    description: row.description,
  }));
}

// Get columns for a table
async function getColumns(client: Pool, schema: string, table: string): Promise<ColumnInfo[]> {
  const result = await client.query(`
    SELECT
      c.column_name as name,
      c.data_type as data_type,
      c.is_nullable = 'YES' as nullable,
      c.column_default as default_value,
      c.ordinal_position
    FROM information_schema.columns c
    WHERE c.table_schema = $1 AND c.table_name = $2
    ORDER BY c.ordinal_position
  `, [schema, table]);

  // Get primary key columns
  const pkResult = await client.query(`
    SELECT a.attname as column_name
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = $1 AND n.nspname = $2 AND i.indisprimary
  `, [table, schema]);

  const pkColumns = new Set(pkResult.rows.map(r => r.column_name));

  return result.rows.map(row => ({
    name: row.name,
    dataType: row.data_type,
    nullable: row.nullable,
    defaultValue: row.default_value,
    isPrimaryKey: pkColumns.has(row.name),
    ordinalPosition: row.ordinal_position,
  }));
}

// Get indexes for a table
async function getIndexes(client: Pool, schema: string, table: string): Promise<IndexInfo[]> {
  const result = await client.query(`
    SELECT
      i.relname as index_name,
      array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)) as columns,
      ix.indisunique as is_unique,
      ix.indisprimary as is_primary
    FROM pg_index ix
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
    WHERE t.relname = $1 AND n.nspname = $2
    GROUP BY i.relname, ix.indisunique, ix.indisprimary
  `, [table, schema]);

  return result.rows.map(row => ({
    name: row.index_name,
    columns: row.columns,
    isUnique: row.is_unique,
    isPrimary: row.is_primary,
  }));
}

// Get estimated row count
async function getRowCount(client: Pool, schema: string, table: string): Promise<number> {
  const result = await client.query(`
    SELECT reltuples::bigint as estimate
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = $1 AND n.nspname = $2
  `, [table, schema]);

  return result.rows[0]?.estimate || 0;
}

// Detect primary key type
function detectPrimaryKeyType(columns: ColumnInfo[]): TableInfo['primaryKeyType'] {
  const pkColumns = columns.filter(c => c.isPrimaryKey);

  if (pkColumns.length === 0) return 'none';
  if (pkColumns.length > 1) return 'composite';

  const pkColumn = pkColumns[0];
  const dataType = pkColumn.dataType.toLowerCase();
  const defaultValue = pkColumn.defaultValue?.toLowerCase() || '';

  if (dataType === 'uuid') return 'uuid';
  if (defaultValue.includes('nextval')) {
    if (dataType === 'bigint') return 'bigserial';
    return 'serial';
  }
  if (dataType === 'integer' || dataType === 'bigint') return 'integer';

  return 'none';
}

// Detect hotspots in the schema
function detectHotspots(tables: TableInfo[]): HotspotWarning[] {
  const warnings: HotspotWarning[] = [];

  for (const table of tables) {
    // Check for SERIAL/BIGSERIAL primary keys (write hotspot)
    if (table.primaryKeyType === 'serial' || table.primaryKeyType === 'bigserial') {
      const pkColumn = table.columns.find(c => c.isPrimaryKey);
      warnings.push({
        table: table.name,
        column: pkColumn?.name || 'id',
        type: 'serial_pk',
        severity: 'warning',
        message: `SERIAL primary key causes write hotspots in distributed systems`,
        recommendation: 'Use UUID PRIMARY KEY DEFAULT gen_random_uuid() for better distribution',
      });
    }

    // Check for integer primary keys without auto-increment
    if (table.primaryKeyType === 'integer') {
      const pkColumn = table.columns.find(c => c.isPrimaryKey);
      warnings.push({
        table: table.name,
        column: pkColumn?.name || 'id',
        type: 'integer_pk',
        severity: 'info',
        message: `Integer primary key may cause hotspots if values are sequential`,
        recommendation: 'Consider using UUID for better write distribution',
      });
    }

    // Check for very small tables (potential hot keys)
    if (table.estimatedRowCount > 0 && table.estimatedRowCount < 10) {
      warnings.push({
        table: table.name,
        column: '',
        type: 'small_table',
        severity: 'info',
        message: `Small table (${table.estimatedRowCount} rows) may cause high contention`,
        recommendation: 'Consider if all operations need to touch the same rows',
      });
    }

    // Check for missing primary key
    if (table.primaryKeyType === 'none') {
      warnings.push({
        table: table.name,
        column: '',
        type: 'missing_index',
        severity: 'warning',
        message: 'Table has no primary key',
        recommendation: 'Add a UUID primary key for optimal performance',
      });
    }
  }

  return warnings;
}

// Main introspection function
export async function discoverSchema(forceRefresh = false): Promise<SchemaDiscoveryResult> {
  const client = await getPool();
  const clusterEndpoint = process.env.AWS_DSQL_CLUSTER_ENDPOINT || '';

  // Get all tables
  const tableList = await getTables(client);

  // Get details for each table
  const tables: TableInfo[] = await Promise.all(
    tableList.map(async ({ name, schema, description }) => {
      const [columns, indexes, rowCount] = await Promise.all([
        getColumns(client, schema, name),
        getIndexes(client, schema, name),
        getRowCount(client, schema, name),
      ]);

      return {
        name,
        schema,
        columns,
        indexes,
        primaryKeyType: detectPrimaryKeyType(columns),
        estimatedRowCount: rowCount,
        description: description || undefined,
      };
    })
  );

  // Detect potential hotspots
  const hotspots = detectHotspots(tables);

  return {
    tables,
    hotspots,
    cachedAt: Date.now(),
    clusterEndpoint,
  };
}

// Get a single table's info
export async function getTableInfo(tableName: string, schemaName = 'public'): Promise<TableInfo | null> {
  const client = await getPool();

  const [columns, indexes, rowCount] = await Promise.all([
    getColumns(client, schemaName, tableName),
    getIndexes(client, schemaName, tableName),
    getRowCount(client, schemaName, tableName),
  ]);

  if (columns.length === 0) return null;

  return {
    name: tableName,
    schema: schemaName,
    columns,
    indexes,
    primaryKeyType: detectPrimaryKeyType(columns),
    estimatedRowCount: rowCount,
  };
}
