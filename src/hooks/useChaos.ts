// Chaos configuration state management

import { create } from 'zustand';
import { ChaosConfig, ChaosLevel, CHAOS_PRESETS } from '@/types/chaos';

interface ChaosState {
  config: ChaosConfig;
  sessionId: string | null;

  // Actions
  setLatency: (ms: number) => void;
  setThreads: (count: number) => void;
  setConflictProbability: (percent: number) => void;
  setTargetKeys: (keys: string[]) => void;
  applyPreset: (level: ChaosLevel) => void;
  toggleEnabled: () => void;
  setSessionId: (id: string | null) => void;
  reset: () => void;
}

const initialConfig: ChaosConfig = {
  ...CHAOS_PRESETS.none,
  enabled: false,
};

export const useChaosStore = create<ChaosState>((set) => ({
  config: initialConfig,
  sessionId: null,

  setLatency: (latencyMs) => {
    set((state) => ({
      config: {
        ...state.config,
        latencyMs: Math.max(0, Math.min(500, latencyMs)),
        chaosLevel: 'none' as ChaosLevel, // Custom config
      },
    }));
  },

  setThreads: (concurrentThreads) => {
    set((state) => ({
      config: {
        ...state.config,
        concurrentThreads: Math.max(1, Math.min(50, concurrentThreads)),
        chaosLevel: 'none' as ChaosLevel,
      },
    }));
  },

  setConflictProbability: (conflictProbability) => {
    set((state) => ({
      config: {
        ...state.config,
        conflictProbability: Math.max(0, Math.min(100, conflictProbability)),
        chaosLevel: 'none' as ChaosLevel,
      },
    }));
  },

  setTargetKeys: (targetKeys) => {
    set((state) => ({
      config: {
        ...state.config,
        targetKeys,
      },
    }));
  },

  applyPreset: (level) => {
    set({
      config: {
        ...CHAOS_PRESETS[level],
        enabled: level !== 'none',
      },
    });
  },

  toggleEnabled: () => {
    set((state) => ({
      config: {
        ...state.config,
        enabled: !state.config.enabled,
      },
    }));
  },

  setSessionId: (sessionId) => {
    set({ sessionId });
  },

  reset: () => {
    set({
      config: initialConfig,
      sessionId: null,
    });
  },
}));

// Selector hooks
export const useChaosConfig = () => useChaosStore((state) => state.config);
export const useChaosEnabled = () => useChaosStore((state) => state.config.enabled);
export const useChaosLevel = () => useChaosStore((state) => state.config.chaosLevel);
