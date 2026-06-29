// Tool definitions for Zero-Lock Studio Chat Agent
// These define the actions the AI can take

import { ToolDefinition } from '@/types/chat';

export const CHAT_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'runChaosTest',
      description: 'Execute a concurrent chaos test against Aurora DSQL to generate real transaction conflicts. Use this when the user wants to stress test their code or see how it handles concurrent load.',
      parameters: {
        type: 'object',
        properties: {
          threadCount: {
            type: 'number',
            description: 'Number of concurrent threads (1-50). Higher = more contention.',
          },
          iterations: {
            type: 'number',
            description: 'Number of iterations per thread (1-20).',
          },
          operationType: {
            type: 'string',
            enum: ['transfer', 'counter', 'custom'],
            description: 'Type of operation: transfer (balance between accounts), counter (increment hot key), custom (use editor code).',
          },
          chaosLevel: {
            type: 'string',
            enum: ['none', 'light', 'moderate', 'extreme'],
            description: 'Chaos level preset affecting latency and conflict probability.',
          },
        },
        required: ['threadCount'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'executeCode',
      description: 'Execute the current code in the editor against Aurora DSQL. Use this when the user wants to run their transaction code.',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'Optional: specific code to execute. If not provided, uses the code currently in the editor.',
          },
          language: {
            type: 'string',
            enum: ['typescript', 'sql'],
            description: 'Programming language of the code.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyzeCode',
      description: 'Analyze transaction code for write-skew vulnerabilities, race conditions, and conflict probability. Use this when the user asks about potential issues in their code.',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'Optional: specific code to analyze. If not provided, uses the code in the editor.',
          },
          analysisType: {
            type: 'string',
            enum: ['write-skew', 'conflict-probability', 'full'],
            description: 'Type of analysis to perform.',
          },
          concurrencyModel: {
            type: 'object',
            description: 'Expected concurrency parameters for conflict probability calculation.',
            properties: {
              expectedThreads: { type: 'number' },
              writeRate: { type: 'number' },
              keySpaceSize: { type: 'number' },
            },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'updateEditorCode',
      description: 'Update the code in the editor. Use this when providing code fixes, examples, or suggestions that the user should try.',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'The complete code to set in the editor.',
          },
          language: {
            type: 'string',
            enum: ['typescript', 'sql'],
            description: 'Programming language of the code.',
          },
        },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'discoverSchema',
      description: 'Discover and list all tables in the connected Aurora DSQL database. Use this when the user asks about their database schema or available tables.',
      parameters: {
        type: 'object',
        properties: {
          forceRefresh: {
            type: 'boolean',
            description: 'Force refresh the schema cache.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'explainTelemetry',
      description: 'Get and explain the current execution telemetry metrics. Use this when the user asks about performance, conflict rates, or what happened during execution.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generateTransactionCode',
      description: 'Generate transaction code for a specific pattern or use case. Use this when the user wants example code for common scenarios.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            enum: ['transfer', 'counter', 'batch_insert', 'select_for_update', 'retry_logic'],
            description: 'The transaction pattern to generate.',
          },
          language: {
            type: 'string',
            enum: ['typescript', 'sql'],
            description: 'Output language.',
          },
          tableName: {
            type: 'string',
            description: 'Optional: specific table name to use in the generated code.',
          },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'updateTransactionBuilder',
      description: 'Create or update a visual transaction flow in the Builder tab. Use this after understanding the user\'s requirements through conversation to show them a visual representation of their transaction design.',
      parameters: {
        type: 'object',
        properties: {
          patternName: {
            type: 'string',
            description: 'A short name for this transaction pattern (e.g., "Hotel Booking", "Checkout Flow").',
          },
          description: {
            type: 'string',
            description: 'Brief description of what this transaction does.',
          },
          operations: {
            type: 'array',
            description: 'List of database operations in order. The system will generate the visual flow from these.',
            items: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'Unique identifier for this operation (e.g., "lock-inventory", "create-order").',
                },
                type: {
                  type: 'string',
                  enum: ['select', 'select_for_update', 'update', 'insert', 'delete'],
                  description: 'Type of SQL operation.',
                },
                table: {
                  type: 'string',
                  description: 'Table name this operation targets.',
                },
                columns: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Columns involved in this operation.',
                },
                whereClause: {
                  type: 'string',
                  description: 'WHERE clause condition (e.g., "id = $productId").',
                },
                setValues: {
                  type: 'object',
                  description: 'For UPDATE operations, the SET values (e.g., {"stock": "stock - $quantity"}).',
                },
                dependsOn: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'IDs of operations this one depends on (for ordering).',
                },
              },
              required: ['id', 'type', 'table'],
            },
          },
          switchToBuilder: {
            type: 'boolean',
            description: 'Whether to automatically switch the user to the Builder tab.',
          },
        },
        required: ['patternName', 'operations'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'runScenarioTest',
      description: 'Run a realistic scenario-based chaos test. Use this after creating a transaction design to validate it works under concurrent load with specific constraints.',
      parameters: {
        type: 'object',
        properties: {
          scenario: {
            type: 'string',
            description: 'Name of the scenario being tested.',
          },
          concurrentUsers: {
            type: 'number',
            description: 'Number of concurrent users/threads to simulate (1-100).',
          },
          totalOperations: {
            type: 'number',
            description: 'Total number of operations to perform across all users.',
          },
          constraints: {
            type: 'object',
            description: 'Scenario-specific constraints.',
            properties: {
              limitedInventory: {
                type: 'number',
                description: 'For inventory scenarios: total available stock.',
              },
              accountBalance: {
                type: 'number',
                description: 'For transfer scenarios: starting account balance.',
              },
              targetSuccessRate: {
                type: 'number',
                description: 'Expected success rate (0-1) for validation.',
              },
            },
          },
          useBuilderFlow: {
            type: 'boolean',
            description: 'Use the current transaction flow from the Builder tab.',
          },
        },
        required: ['scenario', 'concurrentUsers'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'suggestFlowImprovement',
      description: 'After analyzing test results or code, suggest improvements to the transaction flow. Shows a diff of proposed changes and asks for user approval before applying.',
      parameters: {
        type: 'object',
        properties: {
          issue: {
            type: 'string',
            description: 'Description of the issue found (e.g., "High conflict rate due to missing FOR UPDATE").',
          },
          suggestion: {
            type: 'string',
            description: 'Description of the proposed fix.',
          },
          changes: {
            type: 'array',
            description: 'List of specific changes to make.',
            items: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: ['add_operation', 'modify_operation', 'remove_operation', 'reorder', 'add_lock'],
                  description: 'Type of change.',
                },
                operationId: {
                  type: 'string',
                  description: 'ID of operation to modify (for modify/remove).',
                },
                before: {
                  type: 'object',
                  description: 'The original state (for showing diff).',
                },
                after: {
                  type: 'object',
                  description: 'The proposed new state.',
                },
              },
              required: ['type'],
            },
          },
          autoApply: {
            type: 'boolean',
            description: 'If true, apply changes immediately. If false, show diff and wait for user approval.',
          },
        },
        required: ['issue', 'suggestion', 'changes'],
      },
    },
  },
];

// Map of tool names to their handlers (for reference)
export const TOOL_NAMES = CHAT_TOOLS.map((t) => t.function.name);
