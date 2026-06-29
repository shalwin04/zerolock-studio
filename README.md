# ZeroLock-Studio

**Interactive Testing Environment for Amazon Aurora DSQL**

Test Aurora DSQL transactions before production. Stress-test your code with real conflicts, watch real-time telemetry, and validate retry logic - all against a live DSQL cluster.

## The Problem

Aurora DSQL uses Optimistic Concurrency Control (OCC), which means conflicts only occur when multiple transactions modify the same row simultaneously. This rarely happens on a developer's laptop but is inevitable in production.

**How do you validate retry logic you can't trigger? How do you test backoff strategies you can't observe?**

## The Solution

ZeroLock-Studio provides a real testing environment where developers can:

- **Stress Test with Chaos Engineering** - Inject conflicts, add latency, simulate 50+ concurrent threads hitting the same rows
- **Watch Real-Time Telemetry** - See conflicts, retries, and latency percentiles (P50/P95/P99) update live via Server-Sent Events
- **Validate Retry Logic** - Backoff heatmaps show if your exponential backoff + jitter is actually spreading retries correctly
- **Get AI-Powered Analysis** - Ask the AI assistant to analyze test results, explain conflicts, or design safe transaction patterns
- **Auto-Discover Schema** - Connect to DSQL and automatically detect tables, columns, and potential hotspots

## Tech Stack

**Frontend:**
- Next.js 14 with React 19 and TypeScript
- Monaco Editor for code editing
- Recharts for real-time metrics visualization
- React Flow for visual transaction builder
- Zustand for state management
- Tailwind CSS for styling

**Backend:**
- Next.js API routes with Server-Sent Events (SSE)
- AWS SDK for DSQL authentication (IAM-based token signing)
- PostgreSQL driver (pg) for DSQL connections
- OpenAI GPT-4 for AI assistant

**Database:**
- Amazon Aurora DSQL
- Optimistic Concurrency Control with full ACID compliance

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         BROWSER                                  │
│  ┌─────────────┬──────────────┬─────────────┬─────────────────┐ │
│  │ Code Editor │ Chaos        │ Telemetry   │ AI Assistant    │ │
│  │ (Monaco)    │ Controls     │ (SSE Live)  │ (GPT-4)         │ │
│  └─────────────┴──────────────┴─────────────┴─────────────────┘ │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTPS
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    VERCEL (Next.js API)                          │
│  ┌──────────────┬──────────────┬──────────────┬───────────────┐ │
│  │ /api/execute │ /api/schema  │ /api/chat    │ /api/execute  │ │
│  │              │ /discover    │              │ /stream (SSE) │ │
│  └──────────────┴──────────────┴──────────────┴───────────────┘ │
└───────────────────────────┬─────────────────────────────────────┘
                            │ IAM Auth + TLS
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AMAZON AURORA DSQL                            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Optimistic Concurrency Control (OCC)                     │   │
│  │  - Automatic conflict detection                           │   │
│  │  - Error 40001 on serialization failure                   │   │
│  │  - ACID transactions across regions                       │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Getting Started

### Prerequisites

- Node.js 18+
- AWS account with Aurora DSQL cluster
- OpenAI API key (for AI assistant)

### Environment Variables

Create a `.env.local` file:

```env
# Aurora DSQL
DSQL_ENDPOINT=your-cluster.dsql.eu-north-1.on.aws
DSQL_REGION=eu-north-1

# AWS Credentials
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key

# OpenAI (for AI assistant)
OPENAI_API_KEY=your-openai-key

# App URL (for production)
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app
```

### Installation

```bash
# Install dependencies
npm install

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to access the application.

### Production Deployment

Deploy to Vercel:

```bash
vercel --prod
```

Make sure to add all environment variables in your Vercel project settings.

## Usage

1. **Navigate to Playground** - Go to `/playground` to access the testing environment
2. **Write Transaction Code** - Use the Monaco editor to write your DSQL transaction code
3. **Configure Chaos Settings** - Set concurrent threads, conflict injection, and latency simulation
4. **Run Tests** - Execute and watch real-time metrics stream in
5. **Analyze Results** - Use the AI assistant to understand conflicts and optimize your code

## Key Features

### Chaos Engineering Controls
- **Concurrent Threads**: 1-100 simultaneous transactions
- **Conflict Injection**: Force transactions to target same rows
- **Latency Simulation**: Add artificial delays to expose race conditions

### Real-Time Telemetry
- **Live Metrics**: Conflicts, successes, and retries update in real-time
- **Latency Percentiles**: P50, P95, P99 latency tracking
- **Backoff Heatmap**: Visualize retry distribution over time

### AI Assistant
- Analyze test results and explain conflict patterns
- Suggest retry strategies and backoff configurations
- Design safe transaction patterns for your use case

## What We Learned

- Aurora DSQL's OCC is remarkably efficient - even under extreme contention, non-conflicting transactions succeed immediately
- Exponential backoff without jitter causes "thundering herd" - seeing this visualized makes the concept click
- P99 latency is where the pain hides - easy to ignore until you see a 500ms P99 next to a 30ms P50
- Real testing beats documentation - 5 minutes with ZeroLock-Studio teaches more than hours of reading

## License

MIT

## Acknowledgments

Built for the AWS + Vercel Hackathon 2025
