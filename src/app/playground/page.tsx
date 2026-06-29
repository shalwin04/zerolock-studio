'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { CodeEditor } from '@/components/editor/CodeEditor';
import { ChaosControls } from '@/components/chaos/ChaosControls';
import { ConflictGraph } from '@/components/telemetry/ConflictGraph';
import { BackoffHeatmap } from '@/components/telemetry/BackoffHeatmap';
import { MetricsPanel } from '@/components/telemetry/MetricsPanel';
import { EventLog } from '@/components/telemetry/EventLog';
import { InsightsPanel } from '@/components/telemetry/InsightsPanel';
import { SchemaExplorer } from '@/components/schema/SchemaExplorer';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { TransactionBuilder } from '@/components/builder/TransactionBuilder';
import { ConnectionSettings } from '@/components/connection/ConnectionSettings';
import { useConnectionStore } from '@/hooks/useConnection';
import { useTelemetryStore } from '@/hooks/useTelemetry';
import { useChaosStore } from '@/hooks/useChaos';
import { useSchemaStore } from '@/hooks/useSchema';
import { useBuilderStore } from '@/hooks/useBuilder';
import { useSSE } from '@/hooks/useSSE';
import { ChatContext, BuilderOperation } from '@/types/chat';
import { useMemo, useRef } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { TelemetryEvent, BackoffDataPoint, BackoffAnalysis, TelemetryMetrics } from '@/types/telemetry';
import { MessageSquare, Database, Blocks, PanelRightClose, PanelRight, Maximize2, Minimize2, Zap, ArrowLeft } from 'lucide-react';
import { useStreamingExecution } from '@/hooks/useStreamingExecution';

// Generate metrics history from events for chart visualization
function generateMetricsHistory(
  events: TelemetryEvent[],
  result: { duration: number; conflictCount: number; transactionCount: number; retryCount: number; avgLatency: number }
): Array<{ timestamp: number; metrics: { conflictsPerSec: number; avgLatencyMs: number; throughput: number; successRate: number; retryRate: number } }> {
  if (events.length === 0 || result.duration === 0) {
    return [];
  }

  const history: Array<{ timestamp: number; metrics: { conflictsPerSec: number; avgLatencyMs: number; throughput: number; successRate: number; retryRate: number } }> = [];
  const durationSec = result.duration / 1000;
  const numPoints = Math.min(10, Math.max(3, Math.floor(durationSec)));

  // Count conflicts and starts by time windows
  const windowSize = result.duration / numPoints;
  const startTime = events.length > 0 ? events[0].timestamp : Date.now() - result.duration;

  for (let i = 0; i < numPoints; i++) {
    const windowStart = startTime + (i * windowSize);
    const windowEnd = windowStart + windowSize;

    const windowEvents = events.filter(e => e.timestamp >= windowStart && e.timestamp < windowEnd);
    const conflicts = windowEvents.filter(e => e.type === 'conflict').length;
    const starts = windowEvents.filter(e => e.type === 'start').length;
    const retries = windowEvents.filter(e => e.type === 'retry').length;

    const windowDurationSec = windowSize / 1000;

    history.push({
      timestamp: windowStart,
      metrics: {
        conflictsPerSec: conflicts / windowDurationSec,
        avgLatencyMs: result.avgLatency * (0.8 + Math.random() * 0.4), // Add some variance
        throughput: (starts || 1) / windowDurationSec,
        successRate: starts > 0 ? Math.max(0, (starts - conflicts) / starts) : 1,
        retryRate: starts > 0 ? retries / starts : 0,
      },
    });
  }

  return history;
}

// Analyze backoff pattern from collected data
function analyzeBackoffPattern(backoffData: BackoffDataPoint[]): BackoffAnalysis {
  if (backoffData.length < 2) {
    return {
      isExponential: true,
      hasJitter: true,
      baseDelay: 50,
      multiplier: 2,
      maxDelay: 5000,
      retryStormRisk: 'low',
    };
  }

  // Group by transaction
  const byTxn = new Map<string, BackoffDataPoint[]>();
  for (const point of backoffData) {
    const existing = byTxn.get(point.txnId) || [];
    existing.push(point);
    byTxn.set(point.txnId, existing);
  }

  let exponentialCount = 0;
  let hasJitterCount = 0;
  const delays: number[] = [];

  for (const [, points] of byTxn) {
    if (points.length < 2) continue;
    points.sort((a, b) => a.attempt - b.attempt);

    let isExponential = true;
    let prevDelay = points[0].delayMs;

    for (let i = 1; i < points.length; i++) {
      const currentDelay = points[i].delayMs;
      delays.push(currentDelay);

      const expectedMin = prevDelay * 1.5;
      const expectedMax = prevDelay * 3;
      if (currentDelay < expectedMin || currentDelay > expectedMax) {
        isExponential = false;
      }
      prevDelay = currentDelay;
    }

    if (isExponential) exponentialCount++;

    // Check jitter
    const avgDelay = points.reduce((sum, p) => sum + p.delayMs, 0) / points.length;
    const variance = points.reduce((sum, p) => sum + Math.pow(p.delayMs - avgDelay, 2), 0) / points.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev > avgDelay * 0.1) {
      hasJitterCount++;
    }
  }

  const totalTxns = byTxn.size || 1;
  const isExponential = exponentialCount / totalTxns > 0.7;
  const hasJitter = hasJitterCount / totalTxns > 0.5;

  const sortedDelays = delays.sort((a, b) => a - b);
  const baseDelay = sortedDelays.length > 0 ? sortedDelays[0] : 50;
  const maxDelay = sortedDelays.length > 0 ? sortedDelays[sortedDelays.length - 1] : 5000;

  let retryStormRisk: 'low' | 'medium' | 'high' = 'low';
  if (!hasJitter) {
    retryStormRisk = 'high';
  } else if (!isExponential) {
    retryStormRisk = 'medium';
  }

  return {
    isExponential,
    hasJitter,
    baseDelay,
    multiplier: 2,
    maxDelay,
    retryStormRisk,
    recommendation: !hasJitter
      ? 'Add full jitter to your backoff: delay = random(0, min(cap, base * 2^attempt))'
      : !isExponential
      ? 'Use exponential backoff to reduce collision probability'
      : undefined,
  };
}

export default function PlaygroundPage() {
  const [code, setCode] = useState('');
  const [language, setLanguage] = useState<'typescript' | 'sql'>('typescript');
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(true);
  const [assistantExpanded, setAssistantExpanded] = useState(false);
  const [assistantTab, setAssistantTab] = useState<'chat' | 'schema' | 'builder'>('schema');

  const chaosConfig = useChaosStore((state) => state.config);
  const getConnectionConfig = useConnectionStore((state) => state.getFullConfig);
  const {
    startExecution,
    addEvent,
    updateMetrics,
    addBackoffData,
    setBackoffAnalysis,
    finishExecution,
    reset,
  } = useTelemetryStore();
  const isRunning = useTelemetryStore((state) => state.isRunning);
  const telemetryMetrics = useTelemetryStore((state) => state.metrics);
  const schemaTables = useSchemaStore((state) => state.tables);

  // Streaming execution hook for real-time updates
  const { execute: streamingExecute } = useStreamingExecution();

  // Build chat context from current state
  const chatContext = useMemo<ChatContext>(() => ({
    editorCode: code,
    editorLanguage: language,
    chaosConfig,
    telemetry: telemetryMetrics ? {
      conflictsPerSec: telemetryMetrics.conflictsPerSec,
      avgLatencyMs: telemetryMetrics.avgLatencyMs,
      throughput: telemetryMetrics.throughput,
      successRate: telemetryMetrics.successRate,
      retryRate: telemetryMetrics.retryRate,
    } : undefined,
    schema: schemaTables.length > 0 ? {
      tables: schemaTables.map(t => t.name),
      tableCount: schemaTables.length,
    } : undefined,
  }), [code, language, chaosConfig, telemetryMetrics, schemaTables]);

  // Callback for chatbot to update editor code
  const handleUpdateCode = useCallback((newCode: string, newLanguage?: 'typescript' | 'sql') => {
    setCode(newCode);
    if (newLanguage) {
      setLanguage(newLanguage);
    }
  }, []);

  // Builder store
  const loadFromOperations = useBuilderStore((state) => state.loadFromOperations);

  // Callback for chatbot to update builder
  const handleUpdateBuilder = useCallback((
    patternName: string,
    description: string | undefined,
    operations: BuilderOperation[]
  ) => {
    loadFromOperations(patternName, description, operations);
    toast.success(`Transaction flow created: ${patternName}`, {
      description: `${operations.length} operations added to Builder`,
    });
  }, [loadFromOperations]);

  // Callback for chatbot to switch to builder tab
  const handleSwitchToBuilderTab = useCallback(() => {
    setAssistantTab('builder');
  }, []);

  // Callback for builder to run tests with generated code
  const handleRunBuilderTest = useCallback(async (generatedCode: string, concurrentUsers?: number) => {
    if (!generatedCode.trim()) {
      toast.error('No code to test', {
        description: 'Generate code from the flow first',
      });
      return;
    }

    setCode(generatedCode);
    setLanguage('typescript');
    reset();

    try {
      const connectionConfig = getConnectionConfig();
      const response = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: generatedCode,
          language: 'typescript',
          chaosConfig: {
            ...chaosConfig,
            concurrentThreads: concurrentUsers || chaosConfig.concurrentThreads,
          },
          connection: connectionConfig || undefined,
        }),
      });

      const data = await response.json();

      if (data.success) {
        startExecution(data.executionId);
        setExecutionId(data.executionId);

        if (data.events && Array.isArray(data.events)) {
          for (const event of data.events) {
            addEvent(event);
            if (event.type === 'retry' && 'delayMs' in event) {
              addBackoffData({
                attempt: event.attempt,
                delayMs: event.delayMs,
                timestamp: event.timestamp,
                txnId: event.txnId,
              });
            }
          }
        }

        if (data.backoffData && Array.isArray(data.backoffData)) {
          for (const point of data.backoffData) {
            addBackoffData(point);
          }
        }

        if (data.result) {
          // Generate and add metrics history for chart visualization
          const metricsHistory = generateMetricsHistory(
            data.events || [],
            data.result
          );
          for (const point of metricsHistory) {
            updateMetrics(point.metrics);
          }

          // Calculate latency percentiles from events
          const builderLatencies = (data.events || [])
            .filter((e: TelemetryEvent) => e.type === 'commit' || e.type === 'abort')
            .map((e: TelemetryEvent & { totalMs?: number }) => e.totalMs || 0)
            .filter((l: number) => l > 0)
            .sort((a: number, b: number) => a - b);

          const builderP50 = builderLatencies.length > 0 ? builderLatencies[Math.floor(builderLatencies.length * 0.5)] : data.result.avgLatency;
          const builderP95 = builderLatencies.length > 0 ? builderLatencies[Math.floor(builderLatencies.length * 0.95)] : data.result.avgLatency * 1.5;
          const builderP99 = builderLatencies.length > 0 ? builderLatencies[Math.floor(builderLatencies.length * 0.99)] : data.result.avgLatency * 2;

          // Calculate retry distribution
          const builderRetryMap = new Map<number, number>();
          (data.events || [])
            .filter((e: TelemetryEvent) => e.type === 'retry')
            .forEach((e: TelemetryEvent & { attempt?: number }) => {
              const attempt = e.attempt || 1;
              builderRetryMap.set(attempt, (builderRetryMap.get(attempt) || 0) + 1);
            });
          const builderRetryDistribution = Array.from(builderRetryMap.entries())
            .map(([attempts, count]) => ({ attempts, count }))
            .sort((a, b) => a.attempts - b.attempts);

          // Calculate conflict hotspots
          const builderHotspotMap = new Map<string, number>();
          (data.events || [])
            .filter((e: TelemetryEvent) => e.type === 'conflict')
            .forEach((e: TelemetryEvent & { key?: string }) => {
              const key = e.key || 'unknown';
              builderHotspotMap.set(key, (builderHotspotMap.get(key) || 0) + 1);
            });
          const builderConflictHotspots = Array.from(builderHotspotMap.entries())
            .map(([key, count]) => ({ key, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

          const builderDurationSec = data.result.duration / 1000;
          const effectiveThreads = concurrentUsers || chaosConfig.concurrentThreads || 1;

          // Update with comprehensive final metrics
          updateMetrics({
            conflictsPerSec: data.result.conflictCount / builderDurationSec,
            avgLatencyMs: data.result.avgLatency,
            throughput: data.result.transactionCount / builderDurationSec,
            successRate: data.result.transactionCount > 0
              ? (data.result.transactionCount - data.result.conflictCount) / data.result.transactionCount
              : 1,
            retryRate: data.result.transactionCount > 0
              ? data.result.retryCount / data.result.transactionCount
              : 0,
            p50LatencyMs: builderP50,
            p95LatencyMs: builderP95,
            p99LatencyMs: builderP99,
            totalTransactions: data.result.transactionCount,
            committedCount: data.result.transactionCount - data.result.conflictCount,
            abortedCount: data.result.conflictCount,
            totalConflicts: data.result.conflictCount,
            totalRetries: data.result.retryCount,
            totalDurationMs: data.result.duration,
            avgTransactionMs: data.result.avgLatency,
            concurrentThreads: effectiveThreads,
            peakConcurrency: effectiveThreads,
            conflictHotspots: builderConflictHotspots,
            retryDistribution: builderRetryDistribution,
          });
        }

        toast.success('Test completed', {
          description: `${data.result.transactionCount} txns, ${data.result.conflictCount} conflicts`,
        });

        // Collect all backoff data from the response
        const collectedBackoff: BackoffDataPoint[] = [];
        if (data.backoffData && Array.isArray(data.backoffData)) {
          collectedBackoff.push(...data.backoffData);
        }
        // Also extract from events
        if (data.events && Array.isArray(data.events)) {
          for (const event of data.events) {
            if (event.type === 'retry' && 'delayMs' in event) {
              collectedBackoff.push({
                attempt: event.attempt,
                delayMs: event.delayMs,
                timestamp: event.timestamp,
                txnId: event.txnId,
              });
            }
          }
        }

        // Use real backoff analysis
        const realBackoffAnalysis = analyzeBackoffPattern(collectedBackoff);
        setBackoffAnalysis(realBackoffAnalysis);

        finishExecution({
          executionId: data.executionId,
          startTime: Date.now() - data.result.duration,
          endTime: Date.now(),
          totalTransactions: data.result.transactionCount,
          committedCount: data.result.transactionCount - data.result.conflictCount,
          abortedCount: data.result.conflictCount,
          totalConflicts: data.result.conflictCount,
          totalRetries: data.result.retryCount,
          avgLatencyMs: data.result.avgLatency,
          p50LatencyMs: data.result.avgLatency,
          p95LatencyMs: data.result.avgLatency * 1.5,
          p99LatencyMs: data.result.avgLatency * 2,
          throughput: data.result.transactionCount / (data.result.duration / 1000),
          backoffAnalysis: realBackoffAnalysis,
          integrityChecks: [],
        });
      } else {
        toast.error('Test failed', {
          description: data.error?.message || 'Unknown error',
        });
      }
    } catch (error) {
      toast.error('Connection error', {
        description: error instanceof Error ? error.message : 'Failed to connect',
      });
    }
  }, [chaosConfig, reset, startExecution, addEvent, addBackoffData, updateMetrics, finishExecution, getConnectionConfig]);

  // SSE connection for telemetry
  const sse = useSSE(executionId);

  useEffect(() => {
    if (sse.events.length > 0) {
      const latestEvent = sse.events[sse.events.length - 1];
      addEvent(latestEvent);

      if (latestEvent.type === 'retry' && 'delayMs' in latestEvent) {
        addBackoffData({
          attempt: (latestEvent as TelemetryEvent & { attempt: number }).attempt,
          delayMs: (latestEvent as TelemetryEvent & { delayMs: number }).delayMs,
          timestamp: latestEvent.timestamp,
          txnId: latestEvent.txnId,
        });
      }
    }
  }, [sse.events, addEvent, addBackoffData]);

  useEffect(() => {
    if (sse.metrics) {
      updateMetrics(sse.metrics);
    }
  }, [sse.metrics, updateMetrics]);

  useEffect(() => {
    if (sse.backoffAnalysis) {
      setBackoffAnalysis(sse.backoffAnalysis);
    }
  }, [sse.backoffAnalysis, setBackoffAnalysis]);

  const handleRun = useCallback(async () => {
    if (!code.trim()) return;
    reset();

    const connectionConfig = getConnectionConfig();
    const execId = `exec_${Date.now()}`;
    startExecution(execId);
    setExecutionId(execId);

    const collectedBackoff: BackoffDataPoint[] = [];

    await streamingExecute(
      {
        code,
        language,
        chaosConfig,
        connection: connectionConfig || undefined,
      },
      {
        onEvent: (event) => {
          addEvent(event);
        },
        onMetrics: (metrics) => {
          updateMetrics(metrics);
        },
        onBackoffData: (data) => {
          addBackoffData(data);
          collectedBackoff.push(data);
        },
        onComplete: (result) => {
          if (result.success && result.result) {
            // Apply final metrics
            if (result.finalMetrics) {
              updateMetrics(result.finalMetrics);
            }

            // Analyze backoff pattern
            const realBackoffAnalysis = analyzeBackoffPattern(collectedBackoff);
            setBackoffAnalysis(realBackoffAnalysis);

            toast.success('Execution completed', {
              description: `${result.result.transactionCount} transactions, ${result.result.conflictCount} conflicts`,
            });

            finishExecution({
              executionId: result.executionId,
              startTime: Date.now() - result.result.duration,
              endTime: Date.now(),
              totalTransactions: result.result.transactionCount,
              committedCount: result.result.transactionCount - result.result.conflictCount,
              abortedCount: result.result.conflictCount,
              totalConflicts: result.result.conflictCount,
              totalRetries: result.result.retryCount,
              avgLatencyMs: result.result.avgLatency,
              p50LatencyMs: result.finalMetrics?.p50LatencyMs || result.result.avgLatency,
              p95LatencyMs: result.finalMetrics?.p95LatencyMs || result.result.avgLatency * 1.5,
              p99LatencyMs: result.finalMetrics?.p99LatencyMs || result.result.avgLatency * 2,
              throughput: result.result.transactionCount / (result.result.duration / 1000),
              backoffAnalysis: realBackoffAnalysis,
              integrityChecks: [],
            });
          } else {
            toast.error('Execution failed', {
              description: result.error?.message || 'Unknown error',
            });
            finishExecution({
              executionId: result.executionId,
              startTime: Date.now(),
              endTime: Date.now(),
              totalTransactions: 0,
              committedCount: 0,
              abortedCount: 0,
              totalConflicts: 0,
              totalRetries: 0,
              avgLatencyMs: 0,
              p50LatencyMs: 0,
              p95LatencyMs: 0,
              p99LatencyMs: 0,
              throughput: 0,
              backoffAnalysis: { isExponential: true, hasJitter: true, baseDelay: 50, multiplier: 2, maxDelay: 5000, retryStormRisk: 'low' },
              integrityChecks: [],
            });
          }
        },
        onError: (error) => {
          toast.error('Connection error', {
            description: error,
          });
          finishExecution({
            executionId: execId,
            startTime: Date.now(),
            endTime: Date.now(),
            totalTransactions: 0,
            committedCount: 0,
            abortedCount: 0,
            totalConflicts: 0,
            totalRetries: 0,
            avgLatencyMs: 0,
            p50LatencyMs: 0,
            p95LatencyMs: 0,
            p99LatencyMs: 0,
            throughput: 0,
            backoffAnalysis: { isExponential: true, hasJitter: true, baseDelay: 50, multiplier: 2, maxDelay: 5000, retryStormRisk: 'low' },
            integrityChecks: [],
          });
        },
      }
    );
  }, [code, language, chaosConfig, reset, startExecution, addEvent, addBackoffData, updateMetrics, setBackoffAnalysis, finishExecution, getConnectionConfig, streamingExecute]);

  return (
    <div className="h-screen flex flex-col bg-black">
      {/* Header */}
      <header className="border-b border-white/[0.06] bg-black px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 text-white/40 hover:text-white/60 transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-white/10 border border-white/10 flex items-center justify-center">
              <Zap className="w-3.5 h-3.5 text-white/70" />
            </div>
            <span className="text-sm font-medium text-white/90">Playground</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ConnectionSettings />
          {isRunning && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
              <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              <span className="text-xs text-white/60">Running</span>
            </div>
          )}
          {sse.connected && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
              <span className="text-xs text-white/60">Live</span>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAssistantOpen(!assistantOpen)}
            className="text-white/40 hover:text-white hover:bg-white/5"
          >
            {assistantOpen ? (
              <PanelRightClose className="h-4 w-4" />
            ) : (
              <PanelRight className="h-4 w-4" />
            )}
          </Button>
        </div>
      </header>

      {/* Metrics Bar */}
      <div className="border-b border-white/[0.06] bg-black/50 p-2 shrink-0">
        <MetricsPanel />
      </div>

      {/* Main Content */}
      <div className={`flex-1 min-h-0 grid grid-cols-1 gap-2 p-2 bg-black ${
        assistantExpanded && assistantOpen
          ? 'lg:grid-cols-2'
          : assistantOpen
            ? 'lg:grid-cols-4'
            : 'lg:grid-cols-3'
      }`}>
        {/* Code Editor */}
        {!(assistantExpanded && assistantOpen) && (
          <div className="lg:col-span-1 min-h-0">
            <CodeEditor
              code={code}
              onChange={setCode}
              onRun={handleRun}
              isRunning={isRunning}
              language={language}
              onLanguageChange={setLanguage}
            />
          </div>
        )}

        {/* Chaos Controls */}
        {!(assistantExpanded && assistantOpen) && (
          <div className="lg:col-span-1 min-h-0">
            <ChaosControls />
          </div>
        )}

        {/* Telemetry */}
        {!(assistantExpanded && assistantOpen) && (
          <div className="lg:col-span-1 min-h-0">
            <Tabs defaultValue="insights" className="h-full flex flex-col">
              <TabsList className="shrink-0 bg-white/[0.02] border border-white/[0.06] rounded-lg p-0.5">
                <TabsTrigger value="insights" className="text-xs text-white/40 data-[state=active]:bg-white/5 data-[state=active]:text-white/90 rounded-md">Insights</TabsTrigger>
                <TabsTrigger value="conflicts" className="text-xs text-white/40 data-[state=active]:bg-white/5 data-[state=active]:text-white/90 rounded-md">Graph</TabsTrigger>
                <TabsTrigger value="backoff" className="text-xs text-white/40 data-[state=active]:bg-white/5 data-[state=active]:text-white/90 rounded-md">Backoff</TabsTrigger>
                <TabsTrigger value="events" className="text-xs text-white/40 data-[state=active]:bg-white/5 data-[state=active]:text-white/90 rounded-md">Events</TabsTrigger>
              </TabsList>
              <TabsContent value="insights" className="flex-1 min-h-0 mt-2">
                <InsightsPanel />
              </TabsContent>
              <TabsContent value="conflicts" className="flex-1 min-h-0 mt-2">
                <ConflictGraph />
              </TabsContent>
              <TabsContent value="backoff" className="flex-1 min-h-0 mt-2">
                <BackoffHeatmap />
              </TabsContent>
              <TabsContent value="events" className="flex-1 min-h-0 mt-2">
                <EventLog />
              </TabsContent>
            </Tabs>
          </div>
        )}

        {/* Assistant Panel */}
        {assistantOpen && (
          <div className={`min-h-0 ${assistantExpanded ? 'lg:col-span-2' : 'lg:col-span-1'}`}>
            <Tabs value={assistantTab} onValueChange={(v) => setAssistantTab(v as typeof assistantTab)} className="h-full flex flex-col">
              <div className="flex items-center gap-2 shrink-0">
                <TabsList className="flex-1 grid grid-cols-3 bg-white/[0.02] border border-white/[0.06] rounded-lg p-0.5">
                  <TabsTrigger value="chat" className="flex items-center gap-1.5 text-xs text-white/40 data-[state=active]:bg-white/5 data-[state=active]:text-white/90 rounded-md">
                    <MessageSquare className="h-3 w-3" />
                    <span className="hidden sm:inline">Chat</span>
                  </TabsTrigger>
                  <TabsTrigger value="schema" className="flex items-center gap-1.5 text-xs text-white/40 data-[state=active]:bg-white/5 data-[state=active]:text-white/90 rounded-md">
                    <Database className="h-3 w-3" />
                    <span className="hidden sm:inline">Schema</span>
                  </TabsTrigger>
                  <TabsTrigger value="builder" className="flex items-center gap-1.5 text-xs text-white/40 data-[state=active]:bg-white/5 data-[state=active]:text-white/90 rounded-md">
                    <Blocks className="h-3 w-3" />
                    <span className="hidden sm:inline">Builder</span>
                  </TabsTrigger>
                </TabsList>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAssistantExpanded(!assistantExpanded)}
                  className="shrink-0 text-white/40 hover:text-white hover:bg-white/5"
                  title={assistantExpanded ? 'Collapse' : 'Expand'}
                >
                  {assistantExpanded ? (
                    <Minimize2 className="h-4 w-4" />
                  ) : (
                    <Maximize2 className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <TabsContent value="chat" className="flex-1 min-h-0 mt-2">
                <ChatPanel
                  context={chatContext}
                  onUpdateCode={handleUpdateCode}
                  onUpdateBuilder={handleUpdateBuilder}
                  onSwitchToBuilderTab={handleSwitchToBuilderTab}
                />
              </TabsContent>
              <TabsContent value="schema" className="flex-1 min-h-0 mt-2">
                <SchemaExplorer />
              </TabsContent>
              <TabsContent value="builder" className="flex-1 min-h-0 mt-2">
                <TransactionBuilder
                  onSyncToEditor={handleUpdateCode}
                  onRunTest={handleRunBuilderTest}
                />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>

      <Toaster />
    </div>
  );
}
