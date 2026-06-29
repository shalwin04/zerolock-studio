# API Reference

## Overview

Zero-Lock Studio exposes REST and Server-Sent Events (SSE) endpoints for code execution, chaos configuration, and real-time telemetry.

Base URL: `https://your-deployment.vercel.app/api`

---

## Endpoints

### POST /api/execute

Execute user-submitted transaction code in a sandboxed environment.

**Request Body**:
```json
{
  "code": "string",           // TypeScript/SQL code to execute
  "language": "typescript",   // "typescript" | "sql"
  "chaosConfig": {
    "latencyMs": 100,         // 0-500
    "concurrentThreads": 10,  // 1-50
    "conflictProbability": 25, // 0-100
    "chaosLevel": "moderate"  // "none" | "light" | "moderate" | "extreme"
  },
  "timeout": 30000            // Execution timeout in ms (max 60000)
}
```

**Response**:
```json
{
  "success": true,
  "executionId": "exec_abc123",
  "result": {
    "output": "any",
    "duration": 1234,
    "transactionCount": 10,
    "conflictCount": 3,
    "retryCount": 5
  },
  "telemetryUrl": "/api/telemetry?executionId=exec_abc123"
}
```

**Error Codes**:
- `400` - Invalid code or configuration
- `408` - Execution timeout
- `422` - Code compilation failed
- `500` - Internal execution error

---

### POST /api/chaos

Configure chaos injection settings for a session.

**Request Body**:
```json
{
  "latencyMs": 150,
  "concurrentThreads": 15,
  "conflictProbability": 30,
  "chaosLevel": "moderate",
  "targetKeys": ["user_123", "order_456"]  // Optional: specific keys to conflict on
}
```

**Response**:
```json
{
  "success": true,
  "sessionId": "chaos_xyz789",
  "config": {
    "latencyMs": 150,
    "concurrentThreads": 15,
    "conflictProbability": 30,
    "chaosLevel": "moderate"
  }
}
```

**Chaos Levels Preset Values**:
| Level | Latency | Threads | Conflict % |
|-------|---------|---------|------------|
| none | 0 | 1 | 0 |
| light | 50 | 5 | 10 |
| moderate | 150 | 15 | 30 |
| extreme | 300 | 50 | 60 |

---

### GET /api/telemetry

Server-Sent Events stream for real-time execution telemetry.

**Query Parameters**:
- `executionId` (required): Execution session ID

**SSE Event Types**:

```
event: txn_start
data: {"txnId": "txn_001", "timestamp": 1719504000000}

event: query
data: {"txnId": "txn_001", "sql": "SELECT...", "durationMs": 12}

event: conflict
data: {"txnId": "txn_001", "code": "40001", "subcode": "OC000", "key": "user_123"}

event: retry
data: {"txnId": "txn_001", "attempt": 2, "delayMs": 150}

event: txn_end
data: {"txnId": "txn_001", "status": "committed", "totalMs": 234}

event: metrics
data: {"conflictsPerSec": 5.2, "avgLatencyMs": 45, "throughput": 120}

event: done
data: {"executionId": "exec_abc123", "summary": {...}}
```

**Connection**:
```javascript
const eventSource = new EventSource('/api/telemetry?executionId=exec_abc123');

eventSource.addEventListener('conflict', (e) => {
  const data = JSON.parse(e.data);
  console.log('Conflict detected:', data);
});
```

---

### POST /api/ai/schema-migrate

Analyze and refactor schema for Aurora DSQL compatibility.

**Request Body**:
```json
{
  "schema": "string",    // SQL DDL or Drizzle schema code
  "format": "sql",       // "sql" | "drizzle"
  "options": {
    "autoFix": true,     // Automatically apply fixes
    "verbose": false     // Include detailed explanations
  }
}
```

**Response**:
```json
{
  "compatible": false,
  "issues": [
    {
      "severity": "error",
      "code": "UNSUPPORTED_FK",
      "message": "Foreign key constraints not supported in Aurora DSQL",
      "line": 5,
      "suggestion": "Use Drizzle relations() API instead"
    },
    {
      "severity": "warning",
      "code": "SERIAL_HOTSPOT",
      "message": "SERIAL primary key may cause write hotspots",
      "line": 2,
      "suggestion": "Use gen_random_uuid() for distributed writes"
    }
  ],
  "refactoredSchema": "string",  // Fixed schema code
  "explanation": "string"         // AI-generated explanation (if verbose)
}
```

---

### POST /api/ai/analyze

Analyze transaction code for write-skew and other anomalies.

**Request Body**:
```json
{
  "code": "string",
  "analysisType": "write-skew",  // "write-skew" | "conflict-probability" | "full"
  "concurrencyModel": {
    "expectedThreads": 10,
    "writeRate": 100,           // Writes per second
    "keySpaceSize": 1000        // Unique key count
  }
}
```

**Response**:
```json
{
  "hasAnomalies": true,
  "conflictProbability": 0.32,
  "analysis": {
    "readSet": ["users.balance", "accounts.status"],
    "writeSet": ["users.balance"],
    "overlap": true,
    "writeSkewRisk": "high"
  },
  "recommendations": [
    {
      "type": "SELECT_FOR_UPDATE",
      "description": "Add FOR UPDATE to lock rows during read",
      "codeFix": "SELECT * FROM users WHERE id = $1 FOR UPDATE"
    }
  ],
  "formula": {
    "expression": "P(conflict) = 1 - e^(-N² * λ * t / 2K)",
    "variables": {
      "N": 10,
      "λ": 100,
      "t": 0.05,
      "K": 1000
    },
    "result": 0.32
  }
}
```

---

## Error Response Format

All endpoints return errors in a consistent format:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {}  // Optional additional context
  }
}
```

**Common Error Codes**:
- `INVALID_CODE` - Code syntax error
- `EXECUTION_TIMEOUT` - Code exceeded time limit
- `DSQL_CONNECTION_FAILED` - Cannot connect to Aurora DSQL
- `DSQL_AUTH_FAILED` - IAM authentication failed
- `CONFLICT_40001` - OCC conflict during execution
- `RATE_LIMITED` - Too many requests
- `SCHEMA_INVALID` - Schema parsing failed

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| /api/execute | 10 requests/minute |
| /api/chaos | 20 requests/minute |
| /api/telemetry | 5 concurrent connections |
| /api/ai/* | 30 requests/minute |

Rate limit headers included in responses:
- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`
