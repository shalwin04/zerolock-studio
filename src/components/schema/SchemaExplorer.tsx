'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  RefreshCw,
  Database,
  Table2,
  AlertTriangle,
  Key,
  Hash,
  Type,
} from 'lucide-react';
import { useSchemaStore, useTables, useHotspots, useSchemaLoading } from '@/hooks/useSchema';
import { useConnectionStore } from '@/hooks/useConnection';
import { TableInfo, HotspotWarning } from '@/types/schema';

function TableRow({
  table,
  isSelected,
  onSelect,
  hotspots,
}: {
  table: TableInfo;
  isSelected: boolean;
  onSelect: () => void;
  hotspots: HotspotWarning[];
}) {
  const tableHotspots = hotspots.filter((h) => h.table === table.name);
  const hasWarning = tableHotspots.some((h) => h.severity === 'warning' || h.severity === 'error');

  const getPkIcon = () => {
    switch (table.primaryKeyType) {
      case 'uuid':
        return <Key className="h-3 w-3 text-white/60" />;
      case 'serial':
      case 'bigserial':
        return <Hash className="h-3 w-3 text-white/50" />;
      case 'integer':
        return <Hash className="h-3 w-3 text-white/40" />;
      default:
        return <Type className="h-3 w-3 text-white/30" />;
    }
  };

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
        isSelected
          ? 'bg-white/10 border border-white/10'
          : 'hover:bg-white/5'
      }`}
    >
      <div className="flex items-center gap-2">
        <Table2 className="h-4 w-4 text-white/40" />
        <span className="font-medium text-sm flex-1 truncate text-white/90">{table.name}</span>
        {hasWarning && <AlertTriangle className="h-3 w-3 text-white/60" />}
        {getPkIcon()}
      </div>
      <div className="flex items-center gap-2 mt-1 text-xs text-white/40">
        <span>{table.columns.length} columns</span>
        <span>·</span>
        <span>~{table.estimatedRowCount.toLocaleString()} rows</span>
      </div>
    </button>
  );
}

function TableDetails({ table, hotspots }: { table: TableInfo; hotspots: HotspotWarning[] }) {
  const tableHotspots = hotspots.filter((h) => h.table === table.name);

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-xs font-medium uppercase tracking-wider mb-2 text-white/50">Columns</h4>
        <div className="space-y-1">
          {table.columns.map((col) => (
            <div
              key={col.name}
              className="flex items-center gap-2 text-xs py-1.5 px-2 rounded-lg bg-white/[0.02]"
            >
              {col.isPrimaryKey && <Key className="h-3 w-3 text-white/50" />}
              <span className="font-mono flex-1 text-white/70">{col.name}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/50">
                {col.dataType}
              </span>
              {!col.nullable && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/60">
                  NOT NULL
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {table.indexes.length > 0 && (
        <div>
          <h4 className="text-xs font-medium uppercase tracking-wider mb-2 text-white/50">Indexes</h4>
          <div className="space-y-1">
            {table.indexes.map((idx) => (
              <div
                key={idx.name}
                className="text-xs py-1.5 px-2 rounded-lg bg-white/[0.02]"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-white/70">{idx.name}</span>
                  {idx.isPrimary && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/70">
                      PK
                    </span>
                  )}
                  {idx.isUnique && !idx.isPrimary && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/50">
                      UNIQUE
                    </span>
                  )}
                </div>
                <div className="text-white/40 mt-0.5">
                  ({Array.isArray(idx.columns) ? idx.columns.join(', ') : String(idx.columns)})
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tableHotspots.length > 0 && (
        <div>
          <h4 className="text-xs font-medium uppercase tracking-wider mb-2 flex items-center gap-1.5 text-white/50">
            <AlertTriangle className="h-3.5 w-3.5" />
            Warnings
          </h4>
          <div className="space-y-2">
            {tableHotspots.map((warning, i) => (
              <div
                key={i}
                className="text-xs p-3 rounded-lg bg-white/[0.03] border border-white/[0.08]"
              >
                <p className="font-medium text-white/70">{warning.message}</p>
                <p className="text-white/40 mt-1">{warning.recommendation}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function SchemaExplorer() {
  const tables = useTables();
  const hotspots = useHotspots();
  const isLoading = useSchemaLoading();
  const selectedTable = useSchemaStore((s) => s.selectedTable);
  const { discoverSchema, setSelectedTable } = useSchemaStore();
  const error = useSchemaStore((s) => s.error);
  const lastFetchedAt = useSchemaStore((s) => s.lastFetchedAt);

  // Get connection config
  const getConnectionConfig = useConnectionStore((s) => s.getFullConfig);
  const isConnected = useConnectionStore((s) => s.status.connected);

  // Wrapper to pass connection config
  const handleDiscoverSchema = (forceRefresh = false) => {
    const connectionConfig = getConnectionConfig();
    discoverSchema(forceRefresh, connectionConfig);
  };

  useEffect(() => {
    if (tables.length === 0 && !isLoading && !error) {
      handleDiscoverSchema();
    }
  }, [tables.length, isLoading, error]);

  const selectedTableInfo = tables.find((t) => t.name === selectedTable);

  return (
    <div className="h-full flex flex-col bg-white/[0.02] border border-white/[0.06] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.06]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-white/10 flex items-center justify-center">
              <Database className="h-3.5 w-3.5 text-white/70" />
            </div>
            <span className="text-sm font-medium text-white/90">Schema</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleDiscoverSchema(true)}
            disabled={isLoading}
            className="h-8 w-8 text-white/40 hover:text-white hover:bg-white/5"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
        {lastFetchedAt && (
          <p className="text-xs text-white/30 mt-1">
            {tables.length} tables · Updated {new Date(lastFetchedAt).toLocaleTimeString()}
          </p>
        )}
      </div>

      <div className="flex-1 min-h-0">
        {error && (
          <div className="p-4 text-sm text-white/60">
            {error}
          </div>
        )}

        {isLoading && tables.length === 0 && (
          <div className="p-4 space-y-2">
            <div className="h-12 w-full bg-white/[0.03] rounded-lg animate-pulse" />
            <div className="h-12 w-full bg-white/[0.03] rounded-lg animate-pulse" />
            <div className="h-12 w-full bg-white/[0.03] rounded-lg animate-pulse" />
          </div>
        )}

        {!isLoading && tables.length === 0 && !error && (
          <div className="p-4 text-center text-white/40 text-sm">
            <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-white/[0.03] flex items-center justify-center border border-white/[0.06]">
              <Database className="h-6 w-6 text-white/40" />
            </div>
            {!isConnected ? (
              <>
                <p className="text-white/50">Connect to a DSQL cluster to view schema</p>
                <p className="text-xs mt-1 text-white/30">Click "Connect DSQL" in the header</p>
              </>
            ) : (
              <>
                <p className="text-white/50">No tables found</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 border-white/[0.06] text-white/50 hover:bg-white/5 hover:text-white/70"
                  onClick={() => handleDiscoverSchema(true)}
                >
                  Refresh
                </Button>
              </>
            )}
          </div>
        )}

        {tables.length > 0 && (
          <div className="flex h-full">
            {/* Table list */}
            <ScrollArea className="w-1/2 border-r border-white/[0.06]">
              <div className="p-2 space-y-1">
                {tables.map((table) => (
                  <TableRow
                    key={table.name}
                    table={table}
                    isSelected={selectedTable === table.name}
                    onSelect={() => setSelectedTable(table.name)}
                    hotspots={hotspots}
                  />
                ))}
              </div>
            </ScrollArea>

            {/* Table details */}
            <ScrollArea className="w-1/2">
              <div className="p-3">
                {selectedTableInfo ? (
                  <TableDetails table={selectedTableInfo} hotspots={hotspots} />
                ) : (
                  <div className="text-center text-white/30 text-sm py-8">
                    Select a table to view details
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        )}
      </div>
    </div>
  );
}
