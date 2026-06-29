// Chat types for Zero-Lock Studio Agentic Chatbot

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  result?: unknown;
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  toolCallId?: string; // For tool response messages
  isStreaming?: boolean;
}

export interface ChatContext {
  editorCode?: string;
  editorLanguage?: 'typescript' | 'sql';
  chaosConfig?: {
    latencyMs: number;
    concurrentThreads: number;
    conflictProbability: number;
    chaosLevel: string;
    enabled: boolean;
  };
  telemetry?: {
    conflictsPerSec: number;
    avgLatencyMs: number;
    throughput: number;
    successRate: number;
    retryRate: number;
  };
  schema?: {
    tables: string[];
    tableCount: number;
  };
}

export interface ChatState {
  conversationId: string | null;
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;

  // Context options
  includeEditorCode: boolean;
  includeTelemetry: boolean;
  includeSchema: boolean;
}

// Tool definitions for OpenAI function calling
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

// Builder operation for transaction flows
export interface BuilderOperation {
  id: string;
  type: 'select' | 'select_for_update' | 'update' | 'insert' | 'delete';
  table: string;
  columns?: string[];
  whereClause?: string;
  setValues?: Record<string, string>;
  dependsOn?: string[];
}

// Proposed change for flow improvements
export interface ProposedChange {
  type: 'add_operation' | 'modify_operation' | 'remove_operation' | 'reorder' | 'add_lock';
  operationId?: string;
  before?: Partial<BuilderOperation>;
  after?: Partial<BuilderOperation>;
}

// Improvement suggestion from the agent
export interface FlowImprovement {
  issue: string;
  suggestion: string;
  changes: ProposedChange[];
  autoApply: boolean;
}

// Tool execution result
export interface ToolExecutionResult {
  success: boolean;
  result: unknown;
  error?: string;
  sideEffects?: {
    updateEditorCode?: string;
    updateEditorLanguage?: 'typescript' | 'sql';
    triggerRun?: boolean;
    showToast?: { type: 'success' | 'error'; message: string };
    // Builder-related side effects
    updateBuilder?: {
      patternName: string;
      description?: string;
      operations: BuilderOperation[];
    };
    switchToBuilderTab?: boolean;
    // Improvement proposals
    proposeImprovement?: FlowImprovement;
  };
}
