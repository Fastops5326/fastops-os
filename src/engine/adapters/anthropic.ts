import Anthropic from '@anthropic-ai/sdk';
import { BaseAdapter } from './base.js';
import type { ChatRequest, ChatResponse, ChatChunk, AdapterConfig } from '../types.js';
import { calculateCost } from '../types.js';

export class AnthropicAdapter extends BaseAdapter {
  readonly provider = 'anthropic';
  readonly models = [
    'claude-sonnet-4-20250514',
    'claude-3-7-sonnet-20250219',
    'claude-3-5-haiku-20241022',
    'claude-haiku-4-20250514',
  ];

  private client: Anthropic;

  constructor(config: AdapterConfig) {
    super(config);
    this.client = new Anthropic({ apiKey: config.apiKey });
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    return this.withRetry(async () => {
      const start = Date.now();

      const messages = this.convertMessages(request.messages);

      const params: Anthropic.MessageCreateParams = {
        model: request.model || this.models[0],
        max_tokens: request.maxTokens ?? 4096,
        system: request.systemPrompt,
        messages,
      };

      // Enable extended thinking if requested
      if (request.thinking?.enabled) {
        (params as unknown as Record<string, unknown>).thinking = {
          type: 'enabled',
          budget_tokens: request.thinking.budgetTokens ?? 10000,
        };
        // Anthropic requires temperature to be unset (or 1) when thinking is enabled
        delete params.temperature;
      } else if (request.temperature !== undefined) {
        params.temperature = request.temperature;
      }

      if (request.tools?.length) {
        params.tools = request.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters as Anthropic.Tool['input_schema'],
        }));
      }

      const response = await this.client.messages.create(params);
      const latencyMs = Date.now() - start;

      let content = '';
      let thinking = '';
      const toolCalls: ChatResponse['toolCalls'] = [];

      for (const block of response.content) {
        if (block.type === 'thinking') {
          thinking += (block as { type: 'thinking'; thinking: string }).thinking;
        } else if (block.type === 'text') {
          content += block.text;
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: JSON.stringify(block.input),
          });
        }
      }

      const usage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cost: calculateCost(request.model || this.models[0], {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        }),
      };

      return {
        content,
        thinking: thinking || undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage,
        model: response.model,
        provider: this.provider,
        latencyMs,
        raw: response,
      };
    });
  }

  async *chatStream(request: ChatRequest): AsyncIterable<ChatChunk> {
    const messages = this.convertMessages(request.messages);

    const streamParams: Record<string, unknown> = {
      model: request.model || this.models[0],
      max_tokens: request.maxTokens ?? 4096,
      system: request.systemPrompt,
      messages,
    };

    if (request.thinking?.enabled) {
      streamParams.thinking = {
        type: 'enabled',
        budget_tokens: request.thinking.budgetTokens ?? 10000,
      };
    } else if (request.temperature !== undefined) {
      streamParams.temperature = request.temperature;
    }

    if (request.tools?.length) {
      streamParams.tools = request.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters as Anthropic.Tool['input_schema'],
      }));
    }

    const stream = this.client.messages.stream(streamParams as Anthropic.MessageStreamParams);

    // Track active tool_use blocks by content block index to handle parallel tool calls
    const toolBlockMap = new Map<number, { id: string; name: string }>();
    let activeBlockIndex = -1;

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        const block = event.content_block;
        if (block.type === 'tool_use') {
          toolBlockMap.set(event.index, { id: block.id, name: block.name });
          activeBlockIndex = event.index;
          yield {
            delta: '',
            toolCallDelta: {
              id: block.id,
              name: block.name,
            },
            done: false,
          };
        }
      } else if (event.type === 'content_block_delta') {
        const delta = event.delta;
        if (delta.type === 'thinking_delta') {
          yield { delta: '', thinkingDelta: (delta as { type: 'thinking_delta'; thinking: string }).thinking, done: false };
        } else if ('text' in delta) {
          yield { delta: delta.text, done: false };
        } else if (delta.type === 'input_json_delta') {
          // Use event.index to find the correct tool block
          const blockIndex = event.index ?? activeBlockIndex;
          const toolBlock = toolBlockMap.get(blockIndex);
          yield {
            delta: '',
            toolCallDelta: {
              id: toolBlock?.id,
              name: toolBlock?.name,
              arguments: delta.partial_json,
            },
            done: false,
          };
        }
      } else if (event.type === 'message_stop') {
        yield { delta: '', done: true };
      }
    }
  }

  private convertMessages(
    msgs: Array<{ role: string; content: string; toolCallId?: string; name?: string; toolCalls?: Array<{ id: string; name: string; arguments: string }> }>,
  ): Anthropic.MessageParam[] {
    const result: Anthropic.MessageParam[] = [];

    for (const m of msgs) {
      if (m.role === 'system') continue;

      if (m.role === 'assistant') {
        const contentBlocks: Anthropic.ContentBlockParam[] = [];
        if (m.content) {
          contentBlocks.push({ type: 'text', text: m.content });
        }
        if (m.toolCalls?.length) {
          for (const tc of m.toolCalls) {
            contentBlocks.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: JSON.parse(tc.arguments),
            });
          }
        }
        if (contentBlocks.length > 0) {
          result.push({ role: 'assistant', content: contentBlocks });
        }
        continue;
      }

      if (m.role === 'tool') {
        const lastMsg = result[result.length - 1];
        if (lastMsg?.role === 'user' && Array.isArray(lastMsg.content)) {
          (lastMsg.content as Anthropic.ToolResultBlockParam[]).push({
            type: 'tool_result',
            tool_use_id: m.toolCallId ?? '',
            content: m.content,
          });
        } else {
          result.push({
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: m.toolCallId ?? '',
              content: m.content,
            }],
          });
        }
        continue;
      }

      result.push({ role: 'user', content: m.content });
    }

    return result;
  }
}
