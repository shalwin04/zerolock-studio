// Chat state management with Zustand

import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { ChatMessage, ChatContext, ToolCall, BuilderOperation, FlowImprovement } from '@/types/chat';

interface ChatState {
  // Conversation state
  conversationId: string | null;
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;

  // Context options
  includeEditorCode: boolean;
  includeTelemetry: boolean;
  includeSchema: boolean;

  // Pending improvement (awaiting user approval)
  pendingImprovement: FlowImprovement | null;

  // Side effects callbacks (set by playground)
  onUpdateEditorCode?: (code: string, language?: 'typescript' | 'sql') => void;
  onUpdateBuilder?: (patternName: string, description: string | undefined, operations: BuilderOperation[]) => void;
  onSwitchToBuilderTab?: () => void;

  // Actions
  sendMessage: (content: string, context?: ChatContext) => Promise<void>;
  addMessage: (message: ChatMessage) => void;
  updateLastMessage: (update: Partial<ChatMessage>) => void;
  appendToLastMessage: (delta: string) => void;
  addToolCall: (messageId: string, toolCall: ToolCall) => void;
  updateToolCall: (messageId: string, toolCallId: string, update: Partial<ToolCall>) => void;
  clearConversation: () => void;
  setContextOptions: (options: { includeEditorCode?: boolean; includeTelemetry?: boolean; includeSchema?: boolean }) => void;
  setOnUpdateEditorCode: (callback: (code: string, language?: 'typescript' | 'sql') => void) => void;
  setOnUpdateBuilder: (callback: (patternName: string, description: string | undefined, operations: BuilderOperation[]) => void) => void;
  setOnSwitchToBuilderTab: (callback: () => void) => void;
  setPendingImprovement: (improvement: FlowImprovement | null) => void;
  approveImprovement: () => void;
  rejectImprovement: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversationId: null,
  messages: [],
  isStreaming: false,
  error: null,

  includeEditorCode: true,
  includeTelemetry: true,
  includeSchema: true,

  pendingImprovement: null,

  onUpdateEditorCode: undefined,
  onUpdateBuilder: undefined,
  onSwitchToBuilderTab: undefined,

  sendMessage: async (content: string, context?: ChatContext) => {
    const state = get();

    // Add user message
    const userMessage: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content,
      timestamp: Date.now(),
    };

    set((s) => ({
      messages: [...s.messages, userMessage],
      isStreaming: true,
      error: null,
    }));

    // Create assistant message placeholder
    const assistantMessage: ChatMessage = {
      id: uuidv4(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
    };

    set((s) => ({
      messages: [...s.messages, assistantMessage],
    }));

    try {
      // Build context based on options
      const chatContext: ChatContext = {};
      if (state.includeEditorCode && context?.editorCode) {
        chatContext.editorCode = context.editorCode;
        chatContext.editorLanguage = context.editorLanguage;
      }
      if (state.includeTelemetry && context?.telemetry) {
        chatContext.telemetry = context.telemetry;
      }
      if (state.includeSchema && context?.schema) {
        chatContext.schema = context.schema;
      }
      if (context?.chaosConfig) {
        chatContext.chaosConfig = context.chaosConfig;
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: content,
          conversationId: state.conversationId,
          messages: state.messages.slice(0, -1), // Exclude the placeholder
          context: chatContext,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message || 'Failed to send message');
      }

      // Read the stream
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let eventType = '';
        let eventData = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7);
          } else if (line.startsWith('data: ')) {
            eventData = line.slice(6);

            if (eventType && eventData) {
              try {
                const data = JSON.parse(eventData);
                handleStreamEvent(eventType, data, get, set);
              } catch {
                // Ignore parse errors
              }
              eventType = '';
              eventData = '';
            }
          }
        }
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isStreaming: false,
      });

      // Update last message to show error
      set((s) => {
        const messages = [...s.messages];
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.role === 'assistant') {
          lastMsg.content = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
          lastMsg.isStreaming = false;
        }
        return { messages };
      });
    }
  },

  addMessage: (message) => {
    set((s) => ({
      messages: [...s.messages, message],
    }));
  },

  updateLastMessage: (update) => {
    set((s) => {
      const messages = [...s.messages];
      const lastMsg = messages[messages.length - 1];
      if (lastMsg) {
        Object.assign(lastMsg, update);
      }
      return { messages };
    });
  },

  appendToLastMessage: (delta) => {
    set((s) => {
      const messages = [...s.messages];
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.role === 'assistant') {
        lastMsg.content += delta;
      }
      return { messages };
    });
  },

  addToolCall: (messageId, toolCall) => {
    set((s) => {
      const messages = [...s.messages];
      const msg = messages.find((m) => m.id === messageId);
      if (msg) {
        msg.toolCalls = [...(msg.toolCalls || []), toolCall];
      }
      return { messages };
    });
  },

  updateToolCall: (messageId, toolCallId, update) => {
    set((s) => {
      const messages = [...s.messages];
      const msg = messages.find((m) => m.id === messageId);
      if (msg?.toolCalls) {
        const tc = msg.toolCalls.find((t) => t.id === toolCallId);
        if (tc) {
          Object.assign(tc, update);
        }
      }
      return { messages };
    });
  },

  clearConversation: () => {
    set({
      conversationId: uuidv4(),
      messages: [],
      error: null,
      isStreaming: false,
    });
  },

  setContextOptions: (options) => {
    set((s) => ({
      includeEditorCode: options.includeEditorCode ?? s.includeEditorCode,
      includeTelemetry: options.includeTelemetry ?? s.includeTelemetry,
      includeSchema: options.includeSchema ?? s.includeSchema,
    }));
  },

  setOnUpdateEditorCode: (callback) => {
    set({ onUpdateEditorCode: callback });
  },

  setOnUpdateBuilder: (callback) => {
    set({ onUpdateBuilder: callback });
  },

  setOnSwitchToBuilderTab: (callback) => {
    set({ onSwitchToBuilderTab: callback });
  },

  setPendingImprovement: (improvement) => {
    set({ pendingImprovement: improvement });
  },

  approveImprovement: () => {
    const { pendingImprovement, onUpdateBuilder } = get();
    if (pendingImprovement && onUpdateBuilder) {
      // Apply the improvement changes to the builder
      // This would need to be expanded to actually apply the changes
      console.log('Applying improvement:', pendingImprovement);
    }
    set({ pendingImprovement: null });
  },

  rejectImprovement: () => {
    set({ pendingImprovement: null });
  },
}));

// Handle stream events
function handleStreamEvent(
  eventType: string,
  data: Record<string, unknown>,
  get: () => ChatState,
  set: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void
) {
  switch (eventType) {
    case 'content':
      get().appendToLastMessage(data.delta as string);
      break;

    case 'tool_call': {
      const toolCall = data.toolCall as ToolCall;
      set((s) => {
        const messages = [...s.messages];
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.role === 'assistant') {
          lastMsg.toolCalls = [...(lastMsg.toolCalls || []), toolCall];
        }
        return { messages };
      });
      break;
    }

    case 'tool_executing': {
      set((s) => {
        const messages = [...s.messages];
        const lastMsg = messages[messages.length - 1];
        if (lastMsg?.toolCalls) {
          const tc = lastMsg.toolCalls.find((t) => t.id === data.id);
          if (tc) tc.status = 'executing';
        }
        return { messages };
      });
      break;
    }

    case 'tool_result': {
      const state = get();

      set((s) => {
        const messages = [...s.messages];
        const lastMsg = messages[messages.length - 1];
        if (lastMsg?.toolCalls) {
          const tc = lastMsg.toolCalls.find((t) => t.id === data.id);
          if (tc) {
            tc.status = data.success ? 'completed' : 'failed';
            tc.result = data.result;
            tc.error = data.error as string | undefined;
          }
        }
        return { messages };
      });

      // Handle side effects
      const sideEffects = data.sideEffects as {
        updateEditorCode?: string;
        updateEditorLanguage?: 'typescript' | 'sql';
        updateBuilder?: {
          patternName: string;
          description?: string;
          operations: Array<{
            id: string;
            type: string;
            table: string;
            columns?: string[];
            whereClause?: string;
            setValues?: Record<string, string>;
          }>;
        };
        switchToBuilderTab?: boolean;
        proposeImprovement?: {
          issue: string;
          suggestion: string;
          changes: Array<{
            type: string;
            operationId?: string;
            before?: Record<string, unknown>;
            after?: Record<string, unknown>;
          }>;
          autoApply: boolean;
        };
      } | undefined;

      if (sideEffects?.updateEditorCode && state.onUpdateEditorCode) {
        state.onUpdateEditorCode(sideEffects.updateEditorCode, sideEffects.updateEditorLanguage);
      }

      if (sideEffects?.updateBuilder && state.onUpdateBuilder) {
        state.onUpdateBuilder(
          sideEffects.updateBuilder.patternName,
          sideEffects.updateBuilder.description,
          sideEffects.updateBuilder.operations as BuilderOperation[]
        );
      }

      if (sideEffects?.switchToBuilderTab && state.onSwitchToBuilderTab) {
        state.onSwitchToBuilderTab();
      }

      if (sideEffects?.proposeImprovement) {
        set({
          pendingImprovement: {
            issue: sideEffects.proposeImprovement.issue,
            suggestion: sideEffects.proposeImprovement.suggestion,
            changes: sideEffects.proposeImprovement.changes.map(c => ({
              type: c.type as 'add_operation' | 'modify_operation' | 'remove_operation' | 'reorder' | 'add_lock',
              operationId: c.operationId,
              before: c.before,
              after: c.after,
            })),
            autoApply: sideEffects.proposeImprovement.autoApply,
          },
        });
      }
      break;
    }

    case 'done':
      set((s) => {
        const messages = [...s.messages];
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.role === 'assistant') {
          lastMsg.isStreaming = false;
          if (data.content && !lastMsg.content) {
            lastMsg.content = data.content as string;
          }
        }
        return {
          messages,
          isStreaming: false,
          conversationId: data.conversationId as string,
        };
      });
      break;

    case 'error':
      set({
        error: data.error as string,
        isStreaming: false,
      });
      break;
  }
}

// Selector hooks
export const useChatMessages = () => useChatStore((s) => s.messages);
export const useIsStreaming = () => useChatStore((s) => s.isStreaming);
export const useChatError = () => useChatStore((s) => s.error);
