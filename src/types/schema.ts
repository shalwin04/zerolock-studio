// Schema types for Zero-Lock Studio

export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  ordinalPosition: number;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  isUnique: boolean;
  isPrimary: boolean;
}

export interface TableInfo {
  name: string;
  schema: string;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  primaryKeyType: 'uuid' | 'serial' | 'bigserial' | 'integer' | 'composite' | 'none';
  estimatedRowCount: number;
  description?: string;
}

export interface HotspotWarning {
  table: string;
  column: string;
  type: 'serial_pk' | 'small_table' | 'missing_index' | 'integer_pk';
  severity: 'error' | 'warning' | 'info';
  message: string;
  recommendation: string;
}

export interface SchemaDiscoveryResult {
  tables: TableInfo[];
  hotspots: HotspotWarning[];
  cachedAt: number;
  clusterEndpoint: string;
}

export interface SchemaState {
  tables: TableInfo[];
  hotspots: HotspotWarning[];
  isLoading: boolean;
  lastFetchedAt: number | null;
  error: string | null;
  selectedTable: string | null;
}
