// Schema state management with Zustand

import { create } from 'zustand';
import { TableInfo, HotspotWarning } from '@/types/schema';

interface ConnectionConfig {
  clusterEndpoint?: string;
  region?: string;
  database?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

interface SchemaState {
  // Data
  tables: TableInfo[];
  hotspots: HotspotWarning[];

  // Status
  isLoading: boolean;
  lastFetchedAt: number | null;
  error: string | null;

  // Selection
  selectedTable: string | null;

  // Actions
  discoverSchema: (forceRefresh?: boolean, connection?: ConnectionConfig | null) => Promise<void>;
  setSelectedTable: (tableName: string | null) => void;
  getTableByName: (name: string) => TableInfo | undefined;
  clearSchema: () => void;
}

export const useSchemaStore = create<SchemaState>((set, get) => ({
  tables: [],
  hotspots: [],
  isLoading: false,
  lastFetchedAt: null,
  error: null,
  selectedTable: null,

  discoverSchema: async (forceRefresh = false, connection?: ConnectionConfig | null) => {
    set({ isLoading: true, error: null });

    try {
      const response = await fetch('/api/schema/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          forceRefresh,
          connection: connection || undefined,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error?.message || 'Failed to discover schema');
      }

      set({
        tables: data.tables || [],
        hotspots: data.hotspots || [],
        lastFetchedAt: data.cachedAt || Date.now(),
        isLoading: false,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      });
    }
  },

  setSelectedTable: (tableName) => {
    set({ selectedTable: tableName });
  },

  getTableByName: (name) => {
    return get().tables.find((t) => t.name === name);
  },

  clearSchema: () => {
    set({
      tables: [],
      hotspots: [],
      lastFetchedAt: null,
      error: null,
      selectedTable: null,
    });
  },
}));

// Selector hooks
export const useTables = () => useSchemaStore((state) => state.tables);
export const useHotspots = () => useSchemaStore((state) => state.hotspots);
export const useSchemaLoading = () => useSchemaStore((state) => state.isLoading);
export const useSelectedTable = () => {
  const selectedTable = useSchemaStore((state) => state.selectedTable);
  const tables = useSchemaStore((state) => state.tables);
  return tables.find((t) => t.name === selectedTable);
};
