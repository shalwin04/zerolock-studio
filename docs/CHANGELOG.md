# Changelog

All notable changes to Zero-Lock Studio will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- N/A

### Changed
- N/A

### Fixed
- N/A

---

## [0.1.0] - 2026-06-27

### Added

#### Core Infrastructure
- Project initialization with Next.js 15, TypeScript, Tailwind CSS
- shadcn/ui component library (button, card, slider, badge, tabs, dialog, sonner, alert, skeleton, separator, scroll-area, select, input, label)
- Dark theme by default

#### Aurora DSQL Integration (`src/lib/dsql/`)
- IAM authentication with DsqlSigner (`auth.ts`)
- Connection pooling with token refresh (`connection.ts`)
- Transaction execution with exponential backoff retry (`connection.ts`)
- Transaction monitoring and event tracking (`monitor.ts`)
- DSQL limits validation (3000 rows, 10MB, 5 min)

#### Sandbox Execution Engine (`src/lib/sandbox/`)
- Code execution engine with DSQL connection injection (`executor.ts`)
- Pre-built transaction templates for learning (`templates.ts`)
  - Basic operations (insert, select)
  - Conflict-prone patterns (balance transfer, counter increment)
  - Retry patterns (exponential backoff, fixed interval anti-pattern)
  - Batch operations (chunked inserts)
  - Advanced patterns (SELECT FOR UPDATE, distributed UUIDs)

#### Chaos Engineering (`src/lib/chaos/`)
- Chaos injection with configurable latency (0-500ms) (`injector.ts`)
- Synthetic 40001 error injection (`injector.ts`)
- Concurrent transaction spawning (1-50 threads) (`injector.ts`)
- Conflict probability calculation (`injector.ts`)
- Query interception and proxy (`proxy.ts`)
- Four chaos presets: none, light, moderate, extreme

#### Real-Time Telemetry (`src/lib/telemetry/`)
- Metrics collection with rolling windows (`collector.ts`)
- Backoff pattern analysis (`analyzer.ts`)
- Exponential backoff validation
- Jitter detection (full jitter vs fixed interval)
- Retry storm risk assessment
- Thundering herd detection

#### AI Agents (`src/lib/ai/`)
- Schema migration agent (`schema-agent.ts`)
  - Static analysis for DSQL incompatibilities (FK, triggers, procedures, SERIAL)
  - AI-powered schema refactoring with Claude
  - Drizzle ORM schema generation
  - DSQL limits validation
- Write-skew anomaly detector (`write-skew-detector.ts`)
  - Read-set/write-set analysis
  - Conflict probability formula: P = 1 - e^(-N² * λ * t / 2K)
  - Pattern detection (cross-table dependency, missing FOR UPDATE, read-modify-write)
  - Code fix suggestions (FOR UPDATE, safety guard rows, atomic updates)

#### API Endpoints (`src/app/api/`)
- `POST /api/execute` - Execute transaction code with chaos config
- `POST /api/chaos` - Configure chaos injection settings
- `GET /api/chaos` - Get chaos presets and stats
- `GET /api/telemetry` - SSE stream for real-time metrics
- `POST /api/telemetry` - Get historical telemetry data
- `POST /api/ai/schema-migrate` - Analyze schema for DSQL compatibility
- `POST /api/ai/analyze` - Detect write-skew anomalies

#### UI Components (`src/components/`)
- Monaco-based code editor with template selector (`editor/CodeEditor.tsx`)
- Chaos controls with sliders and presets (`chaos/ChaosControls.tsx`)
- Real-time conflict graph with Recharts (`telemetry/ConflictGraph.tsx`)
- Backoff heatmap with risk assessment (`telemetry/BackoffHeatmap.tsx`)
- Metrics panel with key stats (`telemetry/MetricsPanel.tsx`)
- Event log with color-coded events (`telemetry/EventLog.tsx`)

#### Pages
- Landing page with hero section and feature highlights (`app/page.tsx`)
- 3-panel playground with editor, chaos controls, telemetry (`app/playground/page.tsx`)

#### State Management (`src/hooks/`)
- SSE connection hook (`useSSE.ts`)
- Telemetry store with Zustand (`useTelemetry.ts`)
- Chaos configuration store (`useChaos.ts`)

#### Type Definitions (`src/types/`)
- Telemetry types (events, metrics, backoff analysis)
- Chaos types (config, presets, sessions)
- DSQL types (connection, errors, limits)

#### Documentation (`docs/`)
- README.md with quick start guide
- ARCHITECTURE.md with system design and data flow
- API.md with endpoint documentation
- CHANGELOG.md (this file)

### Technical Details
- Full TypeScript throughout
- Server-Sent Events (SSE) for real-time updates
- Zustand for client-side state management
- Recharts for data visualization
- Framer Motion for animations (available)
- Environment variable configuration for AWS credentials
