// Connection state management with Zustand

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ConnectionConfig, ConnectionStatus, ConnectionTestResult, SetupTablesResult } from '@/types/connection';

interface ConnectionState {
  // Connection config (persisted - but secrets only in memory)
  config: Partial<ConnectionConfig>;

  // Runtime secrets (NOT persisted)
  secrets: {
    accessKeyId: string;
    secretAccessKey: string;
  } | null;

  // Connection status
  status: ConnectionStatus;

  // Loading states
  isConnecting: boolean;
  isSettingUp: boolean;

  // Actions
  setConfig: (config: Partial<ConnectionConfig>) => void;
  setSecrets: (accessKeyId: string, secretAccessKey: string) => void;
  clearSecrets: () => void;

  testConnection: () => Promise<ConnectionTestResult>;
  setupTestTables: () => Promise<SetupTablesResult>;
  disconnect: () => void;

  // Get full config with secrets
  getFullConfig: () => ConnectionConfig | null;
}

export const useConnectionStore = create<ConnectionState>()(
  persist(
    (set, get) => ({
      config: {
        clusterEndpoint: '',
        region: 'us-east-1',
        database: 'postgres',
      },

      secrets: null,

      status: {
        connected: false,
        clusterEndpoint: null,
        region: null,
        database: null,
        lastConnectedAt: null,
        error: null,
      },

      isConnecting: false,
      isSettingUp: false,

      setConfig: (config) => {
        set((state) => ({
          config: { ...state.config, ...config },
        }));
      },

      setSecrets: (accessKeyId, secretAccessKey) => {
        set({ secrets: { accessKeyId, secretAccessKey } });
      },

      clearSecrets: () => {
        set({ secrets: null });
      },

      getFullConfig: () => {
        const { config, secrets } = get();
        if (!config.clusterEndpoint || !config.region || !secrets) {
          return null;
        }
        return {
          clusterEndpoint: config.clusterEndpoint,
          region: config.region,
          database: config.database || 'postgres',
          accessKeyId: secrets.accessKeyId,
          secretAccessKey: secrets.secretAccessKey,
        };
      },

      testConnection: async () => {
        const fullConfig = get().getFullConfig();

        if (!fullConfig) {
          return {
            success: false,
            message: 'Missing connection configuration or credentials',
          };
        }

        set({ isConnecting: true });

        try {
          const response = await fetch('/api/connection/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fullConfig),
          });

          const result = await response.json();

          if (result.success) {
            set({
              status: {
                connected: true,
                clusterEndpoint: fullConfig.clusterEndpoint,
                region: fullConfig.region,
                database: fullConfig.database,
                lastConnectedAt: Date.now(),
                error: null,
              },
            });
          } else {
            set({
              status: {
                ...get().status,
                connected: false,
                error: result.message,
              },
            });
          }

          return result;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Connection failed';
          set({
            status: {
              ...get().status,
              connected: false,
              error: message,
            },
          });
          return { success: false, message };
        } finally {
          set({ isConnecting: false });
        }
      },

      setupTestTables: async () => {
        const fullConfig = get().getFullConfig();

        if (!fullConfig) {
          return {
            success: false,
            message: 'Not connected',
            tablesCreated: [],
            errors: ['Missing connection configuration'],
          };
        }

        set({ isSettingUp: true });

        try {
          const response = await fetch('/api/connection/setup-tables', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fullConfig),
          });

          const result = await response.json();
          return result;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Setup failed';
          return {
            success: false,
            message,
            tablesCreated: [],
            errors: [message],
          };
        } finally {
          set({ isSettingUp: false });
        }
      },

      disconnect: () => {
        set({
          secrets: null,
          status: {
            connected: false,
            clusterEndpoint: null,
            region: null,
            database: null,
            lastConnectedAt: null,
            error: null,
          },
        });
      },
    }),
    {
      name: 'zerolock-connection',
      // Only persist non-sensitive config
      partialize: (state) => ({
        config: {
          clusterEndpoint: state.config.clusterEndpoint,
          region: state.config.region,
          database: state.config.database,
        },
      }),
    }
  )
);

// Selector hooks
export const useConnectionStatus = () => useConnectionStore((s) => s.status);
export const useIsConnected = () => useConnectionStore((s) => s.status.connected);
