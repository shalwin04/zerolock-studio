// Chat Agent for Zero-Lock Studio
// Handles OpenAI function calling and tool execution

import OpenAI from 'openai';
import { ChatMessage, ChatContext, ToolCall, ToolExecutionResult } from '@/types/chat';
import { CHAT_TOOLS } from './tools';

// Get the base URL for API calls (handles both dev and production)
function getBaseUrl(): string {
  // Server-side: use NEXTAUTH_URL or construct from environment
  if (process.env.NEXTAUTH_URL) {
    return process.env.NEXTAUTH_URL;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  // Default for local development
  return process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
}

// System prompt for the chat agent
const SYSTEM_PROMPT = `You are the Zero-Lock Studio AI Assistant, an expert in Aurora DSQL, distributed databases, and optimistic concurrency control (OCC).

## Your Role
You help developers design, visualize, and test transaction patterns for Aurora DSQL. You can create visual transaction flows, run stress tests, and iteratively improve designs based on results.

## Conversation Flow for Transaction Design
When a user describes a use case (e.g., "I need to build a checkout system"), follow this flow:

1. **Understand the Use Case**: Ask 2-3 clarifying questions about:
   - What tables are involved? (Check schema first with discoverSchema if available)
   - What's the expected concurrency? (users, requests/sec)
   - What are the critical constraints? (no overselling, no double-booking, etc.)

2. **Design the Flow**: Once you understand the requirements:
   - Use \`updateTransactionBuilder\` to create a visual transaction flow
   - Explain why you chose specific operations (e.g., SELECT FOR UPDATE to prevent race conditions)
   - The Builder tab will show the visual representation

3. **Test the Design**: Offer to stress test:
   - Use \`runScenarioTest\` with realistic concurrency and constraints
   - Analyze the results for conflict rates, success rates, and edge cases

4. **Iterate and Improve**: Based on test results:
   - If issues found, use \`suggestFlowImprovement\` to propose fixes
   - Show a diff of proposed changes
   - Wait for user approval before applying changes
   - Re-test after improvements

## Key Knowledge
- Aurora DSQL uses Optimistic Concurrency Control (OCC)
- Conflicts appear as SQLSTATE 40001 errors (OC000 for data conflicts, OC001 for schema)
- Proper retry logic: exponential backoff with full jitter
- Use SELECT FOR UPDATE to prevent read-modify-write race conditions
- SERIAL primary keys cause write hotspots - recommend UUIDs
- DSQL doesn't support: foreign keys, triggers, stored procedures

## Tool Usage Guidelines
- **discoverSchema**: Use first to understand the user's database
- **updateTransactionBuilder**: Create visual flows after gathering requirements
- **runScenarioTest**: Test with realistic scenarios after creating a design
- **suggestFlowImprovement**: Propose fixes with diffs, don't auto-apply unless asked
- **analyzeCode**: Check existing code for vulnerabilities
- **generateTransactionCode**: Generate code after the visual design is approved

## Response Style
- Be concise but thorough
- Use markdown for formatting (code blocks, lists, bold)
- After creating a builder flow, summarize what was created
- After tests, provide actionable insights (not just raw numbers)
- When suggesting improvements, explain the "why" behind each change

Remember: You can take real actions. Use tools proactively to help the user visualize and test their designs.`;

// Initialize OpenAI client
function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  return new OpenAI({ apiKey });
}

// Convert our message format to OpenAI format
function toOpenAIMessages(
  messages: ChatMessage[],
  context?: ChatContext
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const result: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];

  // Add context as a system message if provided
  if (context) {
    let contextMsg = 'Current Context:\n';

    if (context.editorCode) {
      contextMsg += `\nEditor Code (${context.editorLanguage || 'typescript'}):\n\`\`\`${context.editorLanguage || 'typescript'}\n${context.editorCode.slice(0, 2000)}\n\`\`\`\n`;
    }

    if (context.telemetry) {
      contextMsg += `\nTelemetry:\n- Conflicts/sec: ${context.telemetry.conflictsPerSec.toFixed(1)}\n- Throughput: ${context.telemetry.throughput.toFixed(1)} txn/s\n- Avg Latency: ${context.telemetry.avgLatencyMs.toFixed(0)}ms\n- Success Rate: ${(context.telemetry.successRate * 100).toFixed(0)}%\n`;
    }

    if (context.schema) {
      contextMsg += `\nDatabase Schema: ${context.schema.tableCount} tables (${context.schema.tables.slice(0, 10).join(', ')}${context.schema.tableCount > 10 ? '...' : ''})\n`;
    }

    if (context.chaosConfig?.enabled) {
      contextMsg += `\nChaos Config: ${context.chaosConfig.chaosLevel} level, ${context.chaosConfig.latencyMs}ms latency, ${context.chaosConfig.concurrentThreads} threads\n`;
    }

    result.push({ role: 'system', content: contextMsg });
  }

  // Add conversation messages
  for (const msg of messages) {
    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'assistant') {
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        result.push({
          role: 'assistant',
          content: msg.content || null,
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        });
      } else {
        result.push({ role: 'assistant', content: msg.content });
      }
    } else if (msg.role === 'tool' && msg.toolCallId) {
      result.push({
        role: 'tool',
        tool_call_id: msg.toolCallId,
        content: msg.content,
      });
    }
  }

  return result;
}

// Stream chat completion
export async function* streamChat(
  messages: ChatMessage[],
  context?: ChatContext
): AsyncGenerator<
  | { type: 'content'; delta: string }
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'done'; usage?: { promptTokens: number; completionTokens: number } }
  | { type: 'error'; error: string }
> {
  try {
    const openai = getOpenAI();
    const openaiMessages = toOpenAIMessages(messages, context);

    const stream = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: openaiMessages,
      tools: CHAT_TOOLS,
      tool_choice: 'auto',
      stream: true,
      max_tokens: 2000,
      temperature: 0.7,
    });

    let currentToolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      if (!delta) continue;

      // Handle content
      if (delta.content) {
        yield { type: 'content', delta: delta.content };
      }

      // Handle tool calls
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const index = tc.index;

          if (!currentToolCalls.has(index)) {
            currentToolCalls.set(index, {
              id: tc.id || `call_${Date.now()}_${index}`,
              name: tc.function?.name || '',
              arguments: '',
            });
          }

          const current = currentToolCalls.get(index)!;

          if (tc.function?.name) {
            current.name = tc.function.name;
          }
          if (tc.function?.arguments) {
            current.arguments += tc.function.arguments;
          }
        }
      }

      // Check for finish reason
      if (chunk.choices[0]?.finish_reason === 'tool_calls') {
        // Emit all collected tool calls
        for (const [, tc] of currentToolCalls) {
          try {
            const args = tc.arguments ? JSON.parse(tc.arguments) : {};
            yield {
              type: 'tool_call',
              toolCall: {
                id: tc.id,
                name: tc.name,
                arguments: args,
                status: 'pending',
              },
            };
          } catch {
            yield {
              type: 'tool_call',
              toolCall: {
                id: tc.id,
                name: tc.name,
                arguments: {},
                status: 'pending',
              },
            };
          }
        }
      }
    }

    yield { type: 'done' };
  } catch (error) {
    yield {
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Execute a single tool call
export async function executeTool(
  toolCall: ToolCall,
  context: ChatContext
): Promise<ToolExecutionResult> {
  const { name, arguments: args } = toolCall;

  const baseUrl = getBaseUrl();

  try {
    switch (name) {
      case 'runChaosTest': {
        const response = await fetch(`${baseUrl}/api/chaos/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            threadCount: args.threadCount || 5,
            iterations: args.iterations || 3,
            operationType: args.operationType || 'transfer',
            chaosLevel: args.chaosLevel || 'moderate',
          }),
        });
        const data = await response.json();

        if (!data.success) {
          return { success: false, result: null, error: data.error?.message };
        }

        return {
          success: true,
          result: {
            runId: data.runId,
            duration: data.duration,
            summary: data.summary,
            threadResults: data.threadResults?.slice(0, 5), // Limit for context
          },
        };
      }

      case 'executeCode': {
        const code = args.code || context.editorCode;
        if (!code) {
          return { success: false, result: null, error: 'No code to execute' };
        }

        const response = await fetch(`${baseUrl}/api/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code,
            language: args.language || context.editorLanguage || 'typescript',
          }),
        });
        const data = await response.json();

        return {
          success: data.success,
          result: data.success ? data.result : null,
          error: data.error?.message,
        };
      }

      case 'analyzeCode': {
        const code = args.code || context.editorCode;
        if (!code) {
          return { success: false, result: null, error: 'No code to analyze' };
        }

        const response = await fetch(`${baseUrl}/api/ai/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code,
            analysisType: args.analysisType || 'full',
            concurrencyModel: args.concurrencyModel,
            autoFix: true,
          }),
        });
        const data = await response.json();

        return {
          success: data.success,
          result: data.success ? {
            hasAnomalies: data.hasAnomalies,
            conflictProbability: data.conflictProbability,
            recommendations: data.recommendations?.slice(0, 3),
            fixedCode: data.fixedCode,
          } : null,
          error: data.error?.message,
          sideEffects: data.fixedCode ? {
            updateEditorCode: data.fixedCode,
          } : undefined,
        };
      }

      case 'updateEditorCode': {
        if (!args.code) {
          return { success: false, result: null, error: 'No code provided' };
        }

        return {
          success: true,
          result: { updated: true },
          sideEffects: {
            updateEditorCode: args.code as string,
            updateEditorLanguage: args.language as 'typescript' | 'sql',
          },
        };
      }

      case 'discoverSchema': {
        const response = await fetch(`${baseUrl}/api/schema/discover`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ forceRefresh: args.forceRefresh || false }),
        });
        const data = await response.json();

        if (!data.success) {
          return { success: false, result: null, error: data.error?.message };
        }

        return {
          success: true,
          result: {
            tableCount: data.tableCount,
            tables: data.tables?.map((t: { name: string; columns: unknown[]; estimatedRowCount: number }) => ({
              name: t.name,
              columnCount: t.columns?.length,
              rowCount: t.estimatedRowCount,
            })),
            hotspots: data.hotspots,
          },
        };
      }

      case 'explainTelemetry': {
        if (!context.telemetry) {
          return {
            success: true,
            result: { message: 'No telemetry data available. Run some code first to generate metrics.' },
          };
        }

        return {
          success: true,
          result: {
            metrics: context.telemetry,
            analysis: {
              conflictStatus: context.telemetry.conflictsPerSec > 1 ? 'high' : context.telemetry.conflictsPerSec > 0.1 ? 'moderate' : 'low',
              throughputStatus: context.telemetry.throughput > 10 ? 'good' : 'low',
              successStatus: context.telemetry.successRate > 0.95 ? 'excellent' : context.telemetry.successRate > 0.8 ? 'acceptable' : 'poor',
            },
          },
        };
      }

      case 'generateTransactionCode': {
        const pattern = args.pattern as string;
        const language = (args.language as string) || 'typescript';
        const tableName = (args.tableName as string) || 'accounts';

        const patterns: Record<string, { ts: string; sql: string }> = {
          transfer: {
            ts: `// Balance Transfer with FOR UPDATE
async function transfer(client: PoolClient, fromId: string, toId: string, amount: number) {
  await client.query('BEGIN');

  // Lock both accounts to prevent concurrent modifications
  const { rows } = await client.query(
    'SELECT id, balance FROM ${tableName} WHERE id IN ($1, $2) FOR UPDATE',
    [fromId, toId]
  );

  const fromAccount = rows.find(r => r.id === fromId);
  const toAccount = rows.find(r => r.id === toId);

  if (fromAccount.balance < amount) {
    await client.query('ROLLBACK');
    throw new Error('Insufficient balance');
  }

  await client.query('UPDATE ${tableName} SET balance = balance - $1 WHERE id = $2', [amount, fromId]);
  await client.query('UPDATE ${tableName} SET balance = balance + $1 WHERE id = $2', [amount, toId]);

  await client.query('COMMIT');
}`,
            sql: `-- Balance Transfer Transaction
BEGIN;

-- Lock accounts to prevent concurrent modifications
SELECT id, balance FROM ${tableName}
WHERE id IN ('account1', 'account2')
FOR UPDATE;

-- Perform transfer
UPDATE ${tableName} SET balance = balance - 100 WHERE id = 'account1';
UPDATE ${tableName} SET balance = balance + 100 WHERE id = 'account2';

COMMIT;`,
          },
          counter: {
            ts: `// Atomic Counter Increment
async function incrementCounter(client: PoolClient, counterId: string) {
  const { rows } = await client.query(
    'UPDATE counters SET value = value + 1 WHERE id = $1 RETURNING value',
    [counterId]
  );
  return rows[0].value;
}`,
            sql: `-- Atomic Counter Increment
UPDATE counters
SET value = value + 1,
    update_count = update_count + 1,
    last_updated_at = NOW()
WHERE id = 'my_counter'
RETURNING value;`,
          },
          retry_logic: {
            ts: `// Exponential Backoff with Full Jitter
async function executeWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  const MAX_RETRIES = 5;
  const BASE_DELAY = 50;
  const MAX_DELAY = 5000;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      if (error.code === '40001' && attempt < MAX_RETRIES) {
        // Full jitter exponential backoff
        const maxDelay = Math.min(MAX_DELAY, BASE_DELAY * Math.pow(2, attempt));
        const delay = Math.random() * maxDelay;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}`,
            sql: `-- Note: Retry logic should be handled in application code
-- This shows the transaction that should be retried

BEGIN;
-- Your transaction operations here
SELECT * FROM ${tableName} WHERE id = 'xxx' FOR UPDATE;
UPDATE ${tableName} SET value = value + 1 WHERE id = 'xxx';
COMMIT;

-- On SQLSTATE 40001, retry with exponential backoff`,
          },
          select_for_update: {
            ts: `// SELECT FOR UPDATE Pattern
async function updateWithLock(client: PoolClient, id: string, newValue: number) {
  await client.query('BEGIN');

  // Lock the row first
  const { rows } = await client.query(
    'SELECT * FROM ${tableName} WHERE id = $1 FOR UPDATE',
    [id]
  );

  if (rows.length === 0) {
    await client.query('ROLLBACK');
    throw new Error('Record not found');
  }

  // Now safe to update
  await client.query(
    'UPDATE ${tableName} SET value = $1 WHERE id = $2',
    [newValue, id]
  );

  await client.query('COMMIT');
}`,
            sql: `-- SELECT FOR UPDATE Pattern
BEGIN;

-- Lock the row to prevent concurrent modifications
SELECT * FROM ${tableName} WHERE id = 'xxx' FOR UPDATE;

-- Perform update
UPDATE ${tableName} SET value = 100 WHERE id = 'xxx';

COMMIT;`,
          },
          batch_insert: {
            ts: `// Chunked Batch Insert (respects DSQL 3000 row limit)
async function batchInsert(client: PoolClient, records: any[]) {
  const CHUNK_SIZE = 1000; // Safe under 3000 limit

  for (let i = 0; i < records.length; i += CHUNK_SIZE) {
    const chunk = records.slice(i, i + CHUNK_SIZE);
    const values = chunk.map((_, idx) =>
      \`($\${idx * 2 + 1}, $\${idx * 2 + 2})\`
    ).join(', ');

    const params = chunk.flatMap(r => [r.id, r.value]);

    await client.query(
      \`INSERT INTO ${tableName} (id, value) VALUES \${values}\`,
      params
    );
  }
}`,
            sql: `-- Batch Insert (keep under 3000 rows per transaction)
INSERT INTO ${tableName} (id, value) VALUES
  (gen_random_uuid(), 'value1'),
  (gen_random_uuid(), 'value2'),
  (gen_random_uuid(), 'value3');
-- Add more rows as needed, but keep under 3000 per INSERT`,
          },
        };

        const code = patterns[pattern]?.[language as 'ts' | 'sql'] || patterns.transfer.ts;

        return {
          success: true,
          result: { pattern, language, generated: true },
          sideEffects: {
            updateEditorCode: code,
            updateEditorLanguage: language as 'typescript' | 'sql',
          },
        };
      }

      case 'updateTransactionBuilder': {
        const patternName = args.patternName as string;
        const description = args.description as string | undefined;
        const operations = args.operations as Array<{
          id: string;
          type: string;
          table: string;
          columns?: string[];
          whereClause?: string;
          setValues?: Record<string, string>;
          dependsOn?: string[];
        }>;
        const switchToBuilder = args.switchToBuilder as boolean | undefined;

        // Convert operations to builder format
        const builderOperations = operations.map(op => ({
          id: op.id,
          type: op.type as 'select' | 'select_for_update' | 'update' | 'insert' | 'delete',
          table: op.table,
          columns: op.columns || ['*'],
          whereClause: op.whereClause,
          setValues: op.setValues,
          dependsOn: op.dependsOn,
        }));

        return {
          success: true,
          result: {
            patternName,
            description,
            operationCount: operations.length,
            message: `Created transaction flow "${patternName}" with ${operations.length} operations`,
          },
          sideEffects: {
            updateBuilder: {
              patternName,
              description,
              operations: builderOperations,
            },
            switchToBuilderTab: switchToBuilder !== false,
          },
        };
      }

      case 'runScenarioTest': {
        const scenario = args.scenario as string;
        const concurrentUsers = args.concurrentUsers as number;
        const totalOperations = (args.totalOperations as number) || concurrentUsers * 5;
        const constraints = args.constraints as {
          limitedInventory?: number;
          accountBalance?: number;
          targetSuccessRate?: number;
        } | undefined;
        const useBuilderFlow = args.useBuilderFlow as boolean | undefined;

        // Run the chaos test with scenario parameters
        const response = await fetch(`${baseUrl}/api/chaos/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            threadCount: Math.min(concurrentUsers, 50),
            iterations: Math.ceil(totalOperations / concurrentUsers),
            operationType: 'custom',
            chaosLevel: 'moderate',
            scenario: {
              name: scenario,
              constraints,
              useBuilderFlow,
            },
          }),
        });

        const data = await response.json();

        if (!data.success) {
          return { success: false, result: null, error: data.error?.message };
        }

        // Analyze results against constraints
        const analysis: Record<string, unknown> = {
          scenario,
          concurrentUsers,
          totalOperations: data.summary?.totalTransactions || totalOperations,
          results: data.summary,
        };

        if (constraints?.targetSuccessRate !== undefined) {
          const actualSuccessRate = data.summary?.successRate || 0;
          analysis.targetMet = actualSuccessRate >= constraints.targetSuccessRate;
          analysis.targetSuccessRate = constraints.targetSuccessRate;
          analysis.actualSuccessRate = actualSuccessRate;
        }

        if (constraints?.limitedInventory !== undefined) {
          analysis.inventoryConstraint = constraints.limitedInventory;
          analysis.oversellCheck = data.summary?.oversells === 0 ? 'PASSED' : 'FAILED';
        }

        return {
          success: true,
          result: analysis,
        };
      }

      case 'suggestFlowImprovement': {
        const issue = args.issue as string;
        const suggestion = args.suggestion as string;
        const changes = args.changes as Array<{
          type: string;
          operationId?: string;
          before?: Record<string, unknown>;
          after?: Record<string, unknown>;
        }>;
        const autoApply = args.autoApply as boolean | undefined;

        // Format the changes for the side effect
        const formattedChanges = changes.map(c => ({
          type: c.type as 'add_operation' | 'modify_operation' | 'remove_operation' | 'reorder' | 'add_lock',
          operationId: c.operationId,
          before: c.before,
          after: c.after,
        }));

        return {
          success: true,
          result: {
            issue,
            suggestion,
            changeCount: changes.length,
            awaitingApproval: !autoApply,
          },
          sideEffects: {
            proposeImprovement: {
              issue,
              suggestion,
              changes: formattedChanges,
              autoApply: autoApply || false,
            },
          },
        };
      }

      default:
        return { success: false, result: null, error: `Unknown tool: ${name}` };
    }
  } catch (error) {
    return {
      success: false,
      result: null,
      error: error instanceof Error ? error.message : 'Tool execution failed',
    };
  }
}
