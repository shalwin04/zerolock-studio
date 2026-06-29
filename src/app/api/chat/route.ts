// POST /api/chat - Streaming chat endpoint with tool calling
import { NextRequest } from 'next/server';
import { streamChat, executeTool } from '@/lib/chat/agent';
import { ChatMessage, ChatContext, ToolCall } from '@/types/chat';
import { v4 as uuidv4 } from 'uuid';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface ChatRequest {
  message: string;
  conversationId?: string;
  messages?: ChatMessage[];
  context?: ChatContext;
}

export async function POST(request: NextRequest) {
  try {
    const body: ChatRequest = await request.json();

    if (!body.message && (!body.messages || body.messages.length === 0)) {
      return Response.json(
        { success: false, error: { code: 'INVALID_REQUEST', message: 'Message is required' } },
        { status: 400 }
      );
    }

    // Check OpenAI configuration
    if (!process.env.OPENAI_API_KEY) {
      return Response.json(
        { success: false, error: { code: 'OPENAI_NOT_CONFIGURED', message: 'OpenAI API key is not configured' } },
        { status: 503 }
      );
    }

    // Build messages array
    const messages: ChatMessage[] = body.messages || [];
    if (body.message) {
      messages.push({
        id: uuidv4(),
        role: 'user',
        content: body.message,
        timestamp: Date.now(),
      });
    }

    const conversationId = body.conversationId || uuidv4();
    const context = body.context;

    // Create streaming response
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (event: string, data: unknown) => {
          const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(line));
        };

        try {
          let fullContent = '';
          const toolCalls: ToolCall[] = [];
          let shouldContinue = true;
          let currentMessages = [...messages];

          while (shouldContinue) {
            shouldContinue = false;
            fullContent = '';

            for await (const chunk of streamChat(currentMessages, context)) {
              switch (chunk.type) {
                case 'content':
                  fullContent += chunk.delta;
                  sendEvent('content', { delta: chunk.delta });
                  break;

                case 'tool_call':
                  sendEvent('tool_call', { toolCall: chunk.toolCall });
                  toolCalls.push(chunk.toolCall);
                  break;

                case 'done':
                  // If there were tool calls, execute them
                  if (toolCalls.length > 0) {
                    // Add assistant message with tool calls
                    currentMessages.push({
                      id: uuidv4(),
                      role: 'assistant',
                      content: fullContent,
                      timestamp: Date.now(),
                      toolCalls: [...toolCalls],
                    });

                    // Execute each tool call
                    for (const tc of toolCalls) {
                      sendEvent('tool_executing', { id: tc.id, name: tc.name });

                      const result = await executeTool(tc, context || {});

                      // Send result
                      sendEvent('tool_result', {
                        id: tc.id,
                        name: tc.name,
                        success: result.success,
                        result: result.result,
                        error: result.error,
                        sideEffects: result.sideEffects,
                      });

                      // Add tool response message
                      currentMessages.push({
                        id: uuidv4(),
                        role: 'tool',
                        content: JSON.stringify(result.success ? result.result : { error: result.error }),
                        timestamp: Date.now(),
                        toolCallId: tc.id,
                      });
                    }

                    // Clear tool calls and continue the conversation
                    toolCalls.length = 0;
                    shouldContinue = true;
                  }
                  break;

                case 'error':
                  sendEvent('error', { error: chunk.error });
                  break;
              }
            }
          }

          // Send final done event
          sendEvent('done', {
            conversationId,
            content: fullContent,
          });
        } catch (error) {
          sendEvent('error', {
            error: error instanceof Error ? error.message : 'Stream error',
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Chat error:', error);

    return Response.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      },
      { status: 500 }
    );
  }
}
