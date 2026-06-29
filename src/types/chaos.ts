// Chaos engineering types for Zero-Lock Studio

export type ChaosLevel = 'none' | 'light' | 'moderate' | 'extreme';

export interface ChaosConfig {
  latencyMs: number;           // 0-500ms injected latency
  concurrentThreads: number;   // 1-50 concurrent transactions
  conflictProbability: number; // 0-100% chance of synthetic conflict
  chaosLevel: ChaosLevel;      // Preset configuration level
  targetKeys?: string[];       // Specific keys to conflict on
  enabled: boolean;
}

export const CHAOS_PRESETS: Record<ChaosLevel, Omit<ChaosConfig, 'targetKeys' | 'enabled'>> = {
  none: {
    latencyMs: 0,
    concurrentThreads: 1,
    conflictProbability: 0,
    chaosLevel: 'none',
  },
  light: {
    latencyMs: 50,
    concurrentThreads: 5,
    conflictProbability: 10,
    chaosLevel: 'light',
  },
  moderate: {
    latencyMs: 150,
    concurrentThreads: 15,
    conflictProbability: 30,
    chaosLevel: 'moderate',
  },
  extreme: {
    latencyMs: 300,
    concurrentThreads: 50,
    conflictProbability: 60,
    chaosLevel: 'extreme',
  },
};

export interface ChaosSession {
  sessionId: string;
  config: ChaosConfig;
  startedAt: number;
  injectedLatencyCount: number;
  injectedConflictCount: number;
}

export interface ChaosInjectionResult {
  injected: boolean;
  type: 'latency' | 'conflict' | 'none';
  details?: {
    delayMs?: number;
    errorCode?: string;
    targetKey?: string;
  };
}

export interface ChaosStore {
  config: ChaosConfig;
  session: ChaosSession | null;

  // Actions
  setLatency: (ms: number) => void;
  setThreads: (count: number) => void;
  setConflictProbability: (percent: number) => void;
  setChaosLevel: (level: ChaosLevel) => void;
  setTargetKeys: (keys: string[]) => void;
  toggleEnabled: () => void;
  applyPreset: (level: ChaosLevel) => void;
  startSession: (sessionId: string) => void;
  endSession: () => void;
  reset: () => void;
}
