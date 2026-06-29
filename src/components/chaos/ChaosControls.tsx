'use client';

import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Zap, Clock, Users, AlertTriangle } from 'lucide-react';
import { useChaosStore, useChaosConfig } from '@/hooks/useChaos';
import { ChaosLevel, CHAOS_PRESETS } from '@/types/chaos';

const CHAOS_LEVEL_LABELS: Record<ChaosLevel, string> = {
  none: 'Off',
  light: 'Light',
  moderate: 'Medium',
  extreme: 'Extreme',
};

export function ChaosControls() {
  const config = useChaosConfig();
  const { setLatency, setThreads, setConflictProbability, applyPreset, toggleEnabled } =
    useChaosStore();

  return (
    <div className="flex flex-col h-full bg-white/[0.02] border border-white/[0.06] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
        <span className="text-sm font-medium text-white/90">Chaos</span>
        <span className={`text-xs px-2 py-0.5 rounded-full ${
          config.enabled ? 'bg-white/10 text-white/70' : 'bg-white/5 text-white/40'
        }`}>
          {CHAOS_LEVEL_LABELS[config.chaosLevel]}
        </span>
      </div>

      <div className="flex-1 p-4 space-y-6 overflow-auto">
        {/* Preset Buttons */}
        <div className="grid grid-cols-4 gap-1.5">
          {(Object.keys(CHAOS_PRESETS) as ChaosLevel[]).map((level) => (
            <button
              key={level}
              onClick={() => applyPreset(level)}
              className={`px-2 py-1.5 text-xs rounded-lg capitalize transition-colors ${
                config.chaosLevel === level
                  ? 'bg-white text-black font-medium'
                  : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/70'
              }`}
            >
              {level}
            </button>
          ))}
        </div>

        <div className="h-px bg-white/[0.06]" />

        {/* Latency */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-2 text-xs text-white/50 font-medium">
              <Clock className="h-3.5 w-3.5" />
              Latency
            </Label>
            <span className="text-sm font-medium tabular-nums text-white/90">{config.latencyMs}ms</span>
          </div>
          <Slider
            value={[config.latencyMs]}
            onValueChange={(value) => setLatency(Array.isArray(value) ? value[0] : value)}
            min={0}
            max={500}
            step={10}
            className="w-full"
          />
          <p className="text-[10px] text-white/30">
            Network delay simulation
          </p>
        </div>

        {/* Threads */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-2 text-xs text-white/50 font-medium">
              <Users className="h-3.5 w-3.5" />
              Threads
            </Label>
            <span className="text-sm font-medium tabular-nums text-white/90">{config.concurrentThreads}</span>
          </div>
          <Slider
            value={[config.concurrentThreads]}
            onValueChange={(value) => setThreads(Array.isArray(value) ? value[0] : value)}
            min={1}
            max={50}
            step={1}
            className="w-full"
          />
          <p className="text-[10px] text-white/30">
            Parallel transactions
          </p>
        </div>

        {/* Conflict Probability */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-2 text-xs text-white/50 font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />
              Conflict %
            </Label>
            <span className="text-sm font-medium tabular-nums text-white/90">{config.conflictProbability}%</span>
          </div>
          <Slider
            value={[config.conflictProbability]}
            onValueChange={(value) => setConflictProbability(Array.isArray(value) ? value[0] : value)}
            min={0}
            max={100}
            step={5}
            className="w-full"
          />
          <p className="text-[10px] text-white/30">
            OCC 40001 injection rate
          </p>
        </div>

        <div className="h-px bg-white/[0.06]" />

        {/* Toggle */}
        <Button
          onClick={toggleEnabled}
          className={`w-full font-medium ${
            config.enabled
              ? 'bg-white/10 text-white/90 hover:bg-white/15 border border-white/10'
              : 'bg-white text-black hover:bg-white/90'
          }`}
        >
          {config.enabled ? 'Disable Chaos' : 'Enable Chaos'}
        </Button>

        {/* Active config summary */}
        {config.enabled && (
          <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.06] text-xs space-y-1">
            <p className="text-white/50">Active:</p>
            <p className="text-white/70">{config.latencyMs}ms latency, {config.concurrentThreads} threads, {config.conflictProbability}% conflicts</p>
          </div>
        )}
      </div>
    </div>
  );
}
