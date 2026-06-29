# Zero-Lock Studio

> A Real-time Chaos Playground and Profiler for Serverless Distributed SQL

Zero-Lock Studio is a web-based SaaS dashboard that lets developers write or paste their database transaction blocks (Node-Postgres or Drizzle ORM code) directly into the browser, test them under simulated concurrent load, and visualize OCC (Optimistic Concurrency Control) conflicts in real-time.

## Features

### Core Playground
- **Code Editor**: Monaco-based editor with syntax highlighting for TypeScript/SQL
- **Transaction Templates**: Pre-built examples for common DSQL patterns
- **Live Execution**: Run your code against a real Aurora DSQL instance

### Chaos Engineering
- **Latency Injection**: Simulate cross-region network delays (0-500ms)
- **Concurrent Threads**: Spawn N parallel transactions on same keys
- **Conflict Generation**: Deliberately trigger OCC conflicts (SQLSTATE 40001)

### Real-time Telemetry
- **Conflict Graph**: Live visualization of OC000/OC001 errors over time
- **Backoff Heatmap**: Analyze retry patterns for jitter compliance
- **Integrity Ledger**: Transaction-by-transaction audit with before/after states
- **Latency Charts**: Monitor transaction round-trip times

### AI Agents
- **Schema Migrator**: Auto-refactor schemas for DSQL compatibility
- **Write-Skew Detector**: Identify anomaly-prone transaction patterns
- **CoAgent Advisory**: Smart conflict resolution for multi-agent systems

## Quick Start

```bash
# Install dependencies
npm install

# Set environment variables
cp .env.example .env.local

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to access the playground.

## Environment Variables

```env
# Aurora DSQL
AWS_REGION=us-east-1
AWS_DSQL_CLUSTER_ENDPOINT=your-cluster.dsql.us-east-1.on.aws
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx

# AI (choose one)
ANTHROPIC_API_KEY=xxx
# or
AWS_BEDROCK_REGION=us-east-1
```

## Tech Stack

- **Frontend**: Next.js 15, React, Tailwind CSS, shadcn/ui
- **Editor**: Monaco Editor
- **Charts**: Recharts
- **State**: Zustand
- **Database**: Amazon Aurora DSQL
- **AI**: Claude API / Amazon Bedrock
- **Deployment**: Vercel

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed system design.

## API Reference

See [API.md](./API.md) for endpoint documentation.

## License

MIT
