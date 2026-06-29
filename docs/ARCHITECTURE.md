# Technical Architecture

## System Overview

Zero-Lock Studio is a three-tier application designed to safely execute untrusted database transaction code while providing real-time observability into distributed database behavior.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              ZERO-LOCK STUDIO                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌───────────────┐    ┌───────────────┐    ┌─────────────────────────────┐ │
│  │   Next.js     │    │   Sandbox     │    │      Telemetry Dashboard    │ │
│  │   Frontend    │───▶│   Executor    │───▶│      (SSE + Recharts)       │ │
│  │ (Monaco+shadcn)    │   (Isolated)  │    │                             │ │
│  └───────────────┘    └───────────────┘    └─────────────────────────────┘ │
│         │                    │                           ▲                  │
│         │                    ▼                           │                  │
│         │             ┌───────────────┐                  │                  │
│         │             │  Chaos Proxy  │──────────────────┘                  │
│         │             │  (Injector)   │                                     │
│         │             └───────────────┘                                     │
│         │                    │                                              │
│         ▼                    ▼                                              │
│  ┌───────────────┐    ┌───────────────┐                                    │
│  │   AI Agents   │    │  Aurora DSQL  │                                    │
│  │ (Claude/Bedrock)   │  Multi-Region │                                    │
│  └───────────────┘    └───────────────┘                                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Component Details

### 1. Frontend Layer

**Technology**: Next.js 15 App Router, React 18, Tailwind CSS

**Key Components**:
- `CodeEditor.tsx` - Monaco-based code editor with TypeScript support
- `ChaosControls.tsx` - Sliders and toggles for chaos configuration
- `ConflictGraph.tsx` - Real-time line chart for conflict visualization
- `BackoffHeatmap.tsx` - 2D heatmap for retry pattern analysis
- `IntegrityLedger.tsx` - Transaction audit log component

**State Management**: Zustand stores for:
- Editor state (code, cursor position, templates)
- Chaos configuration (latency, threads, level)
- Telemetry data (conflicts, retries, latencies)
- Execution state (running, results, errors)

### 2. Execution Layer

**Sandbox Executor** (`src/lib/sandbox/executor.ts`):
- Compiles TypeScript code using isolated environment
- Injects DSQL connection with IAM authentication
- Captures execution metrics and errors
- Returns structured telemetry data

**Security Model**:
- Code runs in isolated context (vm2/isolated-vm as fallback)
- No filesystem or network access beyond DSQL
- Execution timeout (30 seconds default)
- Memory limits enforced

### 3. Chaos Engineering Layer

**Chaos Proxy** (`src/lib/chaos/proxy.ts`):
- Intercepts database connections
- Injects configurable latency (0-500ms)
- Simulates cross-region network conditions

**Conflict Injector** (`src/lib/chaos/injector.ts`):
- Spawns N concurrent transactions on same keys
- Injects synthetic 40001 errors based on probability
- Tracks collision frequency and patterns

**Chaos Levels**:
| Level | Latency | Threads | Conflict Rate |
|-------|---------|---------|---------------|
| None | 0ms | 1 | 0% |
| Light | 50ms | 5 | 10% |
| Moderate | 150ms | 15 | 30% |
| Extreme | 300ms | 50 | 60% |

### 4. Database Layer

**Aurora DSQL Integration** (`src/lib/dsql/`):

**Connection** (`connection.ts`):
- IAM-authenticated connections
- Token refresh with 15-min expiry
- Connection pooling with 60-min session lifetime

**Authentication** (`auth.ts`):
- Uses @aws/aurora-dsql-node-postgres-connector
- OIDC federation support for Vercel deployment
- STS token exchange for serverless environments

**Monitoring** (`monitor.ts`):
- Transaction lifecycle tracking
- Query execution timing
- Error code classification (40001, OC000, OC001)

### 5. Telemetry Layer

**Metrics Collector** (`src/lib/telemetry/collector.ts`):
- Aggregates transaction events
- Calculates conflict rates per second
- Tracks retry attempt timestamps

**Backoff Analyzer** (`src/lib/telemetry/analyzer.ts`):
- Validates exponential backoff pattern
- Detects fixed-interval retries (anti-pattern)
- Calculates jitter compliance score

**Formula Verification**:
```
t_sleep ~ Uniform(0, min(t_max, t_initial * M^A))

Where:
- t_max = Maximum delay cap
- t_initial = Base delay
- M = Multiplier (typically 2)
- A = Retry attempt number
```

### 6. AI Agent Layer

**Schema Migration Agent** (`src/lib/ai/schema-agent.ts`):
- Analyzes SQL/Drizzle schemas
- Checks DSQL compatibility:
  - No foreign key constraints
  - No triggers
  - No PL/pgSQL stored procedures
  - UUID vs SERIAL primary keys
- Generates refactored code

**Write-Skew Detector** (`src/lib/ai/write-skew-detector.ts`):
- Static analysis of transaction code
- Identifies read-set/write-set overlaps
- Calculates conflict probability
- Suggests SELECT FOR UPDATE guards

## Data Flow

### Execution Flow

```
1. User submits code in editor
2. POST /api/execute with code + chaos config
3. Sandbox executor compiles code
4. Chaos proxy wraps DSQL connection
5. Code executes with injected faults
6. Telemetry streamed via SSE
7. Frontend updates visualizations
```

### Telemetry Flow

```
1. Transaction starts → emit "txn_start" event
2. Query executed → emit "query" event with timing
3. Conflict detected → emit "conflict" event with code
4. Retry attempted → emit "retry" event with delay
5. Transaction commits/aborts → emit "txn_end" event
```

## Security Considerations

1. **Code Isolation**: User code runs in sandboxed environment
2. **Credential Safety**: IAM tokens are short-lived (15 min)
3. **Rate Limiting**: API endpoints throttled per user
4. **Input Validation**: Code sanitized before execution
5. **Output Filtering**: Sensitive data redacted from responses

## Aurora DSQL-Specific Optimizations

1. **Optimistic Concurrency Control (OCC)**:
   - Transactions execute without locks
   - Conflicts detected at commit time
   - Adjudicators resolve conflicts deterministically

2. **Multi-Region Active-Active**:
   - Support for multiple regional endpoints
   - Sub-100ms global transaction consistency
   - No single leader bottleneck

3. **Serverless Limits Awareness**:
   - Max 3,000 rows per transaction
   - 10 MiB commit size limit
   - 5-minute transaction timeout
   - Code analyzer warns on violations
