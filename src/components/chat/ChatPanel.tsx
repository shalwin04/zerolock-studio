'use client';

import { useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Bot,
  User,
  Send,
  Trash2,
  Loader2,
  CheckCircle,
  XCircle,
  Wrench,
  Code,
  FileText,
  AlertTriangle,
} from 'lucide-react';
import { useChatStore, useChatMessages, useIsStreaming } from '@/hooks/useChat';
import { ChatMessage, ToolCall, ChatContext, BuilderOperation } from '@/types/chat';

interface ChatPanelProps {
  context?: ChatContext;
  onUpdateCode?: (code: string, language?: 'typescript' | 'sql') => void;
  onUpdateBuilder?: (patternName: string, description: string | undefined, operations: BuilderOperation[]) => void;
  onSwitchToBuilderTab?: () => void;
}

function ToolCallDisplay({ toolCall }: { toolCall: ToolCall }) {
  const getStatusIcon = () => {
    switch (toolCall.status) {
      case 'executing':
        return <Loader2 className="h-3 w-3 animate-spin text-white/60" />;
      case 'completed':
        return <CheckCircle className="h-3 w-3 text-white/60" />;
      case 'failed':
        return <XCircle className="h-3 w-3 text-white/70" />;
      default:
        return <Wrench className="h-3 w-3 text-white/40" />;
    }
  };

  return (
    <div className="bg-white/[0.03] rounded-lg p-2 text-xs mt-2 border border-white/[0.06]">
      <div className="flex items-center gap-2">
        {getStatusIcon()}
        <span className="font-mono font-medium text-white/80">{toolCall.name}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/50">
          {toolCall.status}
        </span>
      </div>
      {toolCall.status === 'completed' && toolCall.result !== undefined && (
        <div className="mt-1 text-white/40">
          <pre className="whitespace-pre-wrap text-[10px] max-h-20 overflow-auto">
            {(() => {
              const resultStr = JSON.stringify(toolCall.result, null, 2);
              return resultStr.length > 300 ? resultStr.slice(0, 300) + '...' : resultStr;
            })()}
          </pre>
        </div>
      )}
      {toolCall.status === 'failed' && toolCall.error && (
        <div className="mt-1 text-white/60">
          {toolCall.error}
        </div>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';

  if (message.role === 'tool') {
    return null; // Tool messages are shown as part of assistant messages
  }

  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${
          isUser ? 'bg-white text-black' : 'bg-white/10'
        }`}
      >
        {isUser ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3 text-white/60" />}
      </div>
      <div
        className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
          isUser
            ? 'bg-white text-black'
            : 'bg-white/[0.03] border border-white/[0.06] text-white/90'
        }`}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap break-words">
            {message.content}
          </div>
        ) : (
          <div className="chat-markdown break-words">
            <ReactMarkdown>{message.content}</ReactMarkdown>
            {message.isStreaming && (
              <span className="inline-block w-1 h-4 bg-white/60 animate-pulse ml-0.5" />
            )}
          </div>
        )}

        {/* Tool calls */}
        {isAssistant && message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-2 space-y-1">
            {message.toolCalls.map((tc) => (
              <ToolCallDisplay key={tc.id} toolCall={tc} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatPanel({ context, onUpdateCode, onUpdateBuilder, onSwitchToBuilderTab }: ChatPanelProps) {
  const messages = useChatMessages();
  const isStreaming = useIsStreaming();
  const {
    sendMessage,
    clearConversation,
    setContextOptions,
    setOnUpdateEditorCode,
    setOnUpdateBuilder,
    setOnSwitchToBuilderTab,
    includeEditorCode,
    includeTelemetry,
    includeSchema,
    pendingImprovement,
    approveImprovement,
    rejectImprovement,
  } = useChatStore();

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Register callbacks
  useEffect(() => {
    if (onUpdateCode) {
      setOnUpdateEditorCode(onUpdateCode);
    }
    if (onUpdateBuilder) {
      setOnUpdateBuilder(onUpdateBuilder);
    }
    if (onSwitchToBuilderTab) {
      setOnSwitchToBuilderTab(onSwitchToBuilderTab);
    }
  }, [onUpdateCode, onUpdateBuilder, onSwitchToBuilderTab, setOnUpdateEditorCode, setOnUpdateBuilder, setOnSwitchToBuilderTab]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = useCallback(async () => {
    const input = inputRef.current;
    if (!input || !input.value.trim() || isStreaming) return;

    const content = input.value.trim();
    input.value = '';

    await sendMessage(content, context);
  }, [sendMessage, context, isStreaming]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="h-full flex flex-col bg-white/[0.02] border border-white/[0.06] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.06]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-white/10 flex items-center justify-center">
              <Bot className="h-3.5 w-3.5 text-white/70" />
            </div>
            <span className="text-sm font-medium text-white/90">DSQL Assistant</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={clearConversation}
            disabled={isStreaming}
            className="h-8 w-8 text-white/40 hover:text-white hover:bg-white/5"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        {/* Context toggles */}
        <div className="flex flex-wrap gap-3 text-xs mt-3">
          <div className="flex items-center gap-1.5">
            <Checkbox
              id="ctx-code"
              checked={includeEditorCode}
              onCheckedChange={(checked) =>
                setContextOptions({ includeEditorCode: !!checked })
              }
              className="border-white/20 data-[state=checked]:bg-white data-[state=checked]:border-white data-[state=checked]:text-black"
            />
            <Label htmlFor="ctx-code" className="text-xs flex items-center gap-1 cursor-pointer text-white/50">
              <Code className="h-3 w-3" /> Code
            </Label>
          </div>
          <div className="flex items-center gap-1.5">
            <Checkbox
              id="ctx-telemetry"
              checked={includeTelemetry}
              onCheckedChange={(checked) =>
                setContextOptions({ includeTelemetry: !!checked })
              }
              className="border-white/20 data-[state=checked]:bg-white data-[state=checked]:border-white data-[state=checked]:text-black"
            />
            <Label htmlFor="ctx-telemetry" className="text-xs flex items-center gap-1 cursor-pointer text-white/50">
              <FileText className="h-3 w-3" /> Telemetry
            </Label>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4"
        >
          <div className="space-y-4 py-4">
            {messages.length === 0 && (
              <div className="text-center text-white/40 text-sm py-8">
                <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-white/[0.03] flex items-center justify-center border border-white/[0.06]">
                  <Bot className="h-6 w-6 text-white/40" />
                </div>
                <p className="text-white/50">Ask me about DSQL, run chaos tests, or analyze your code.</p>
                <div className="mt-4 space-y-2">
                  <p className="text-xs text-white/30">Try:</p>
                  <div className="flex flex-wrap gap-1.5 justify-center">
                    {[
                      'Run 10 concurrent transfers',
                      'Analyze my code for issues',
                      'Show me the database schema',
                      'Generate retry logic code',
                    ].map((suggestion) => (
                      <Button
                        key={suggestion}
                        variant="outline"
                        size="sm"
                        className="text-xs h-7 border-white/[0.06] bg-white/[0.02] text-white/50 hover:bg-white/5 hover:text-white/70"
                        onClick={() => {
                          if (inputRef.current) {
                            inputRef.current.value = suggestion;
                            handleSend();
                          }
                        }}
                      >
                        {suggestion}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
          </div>
        </div>

        {/* Pending Improvement Proposal */}
        {pendingImprovement && (
          <div className="mx-4 mb-2 p-3 bg-white/[0.03] border border-white/[0.08] rounded-xl">
            <div className="flex items-start gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-white/60 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white/80">
                  Suggested Improvement
                </p>
                <p className="text-xs text-white/50 mt-1">
                  {pendingImprovement.issue}
                </p>
              </div>
            </div>
            <div className="bg-white/[0.02] rounded-lg p-2 mb-2 border border-white/[0.06]">
              <p className="text-xs font-medium mb-1 text-white/70">Proposed Fix:</p>
              <p className="text-xs text-white/50">{pendingImprovement.suggestion}</p>
              {pendingImprovement.changes.length > 0 && (
                <div className="mt-2 space-y-1">
                  {pendingImprovement.changes.map((change, i) => (
                    <div key={i} className="text-[10px] font-mono bg-white/[0.03] p-1 rounded">
                      <span className="text-white/60">{change.type}</span>
                      {change.operationId && (
                        <span className="text-white/30"> on {change.operationId}</span>
                      )}
                      {change.after && (
                        <span className="text-white/50 ml-1">
                          → {JSON.stringify(change.after).slice(0, 50)}...
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="h-7 text-xs bg-white text-black hover:bg-white/90"
                onClick={approveImprovement}
              >
                <CheckCircle className="h-3 w-3 mr-1" />
                Apply Changes
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs border-white/[0.06] text-white/50 hover:bg-white/5"
                onClick={rejectImprovement}
              >
                <XCircle className="h-3 w-3 mr-1" />
                Dismiss
              </Button>
            </div>
          </div>
        )}

        {/* Input */}
        <div className="p-4 border-t border-white/[0.06]">
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              placeholder="Ask about DSQL or run a test..."
              onKeyDown={handleKeyDown}
              disabled={isStreaming}
              className="flex-1 bg-white/[0.02] border-white/[0.06] text-white placeholder:text-white/30 focus:border-white/20 focus:ring-0"
            />
            <Button
              onClick={handleSend}
              disabled={isStreaming}
              size="icon"
              className="bg-white text-black hover:bg-white/90"
            >
              {isStreaming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
