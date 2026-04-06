import type { ChatRequest, ChatResponse, ThinkingConfig } from '../types.js';
import type { AdapterRegistry } from '../adapters/registry.js';
import type { ContextManager } from '../context/manager.js';
import type { SessionManager } from './session.js';
import type { ToolExecutor } from '../tools/executor.js';
import type { ToolResult } from '../tools/types.js';
import type { EventBus } from './event-bus.js';
import type { StateStore } from './state-store.js';
import type { MiddlewareStack } from '../middleware/stack.js';
import type { MiddlewareContext } from '../middleware/types.js';

export interface TaskPayload {
  type: 'contract' | 'freeform' | 'qc' | 'review';
  contractId?: string;
  prompt: string;
  model?: string;
  activeProductId?: string;
  thinking?: ThinkingConfig;
  contextOverrides?: {
    kbQuery?: string;
    includeComms?: boolean;
    commsWindow?: number;
  };
}

export interface TaskResult {
  sessionId: string;
  modelId: string;
  response: ChatResponse;
  toolResults: ToolResult[];
  duration: number;
  success: boolean;
  error?: string;
  toolCallCount: number;
}

export interface DispatcherConfig {
  maxToolCalls: number;
  timeoutMs: number;
  workingDirectory: string;
  securityTier?: 'development' | 'enterprise';
  allowElevatedBash?: boolean;
  allowWriteBash?: boolean;
  enterpriseBashStrict?: boolean;
  toolAuditDir?: string;
}

export type DispatchStreamEvent =
  | { type: 'delta'; delta: string; done: boolean }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_call'; tool: string; id: string; arguments: string }
  | { type: 'tool_result'; tool: string; id: string; output: string; isError: boolean }
  | { type: 'complete'; sessionId: string; modelId: string; duration: number; toolCallCount: number }
  | { type: 'error'; error: string };

const DEFAULT_CONFIG: DispatcherConfig = {
  maxToolCalls: 25,
  timeoutMs: 10 * 60 * 1000,
  workingDirectory: process.cwd(),
  securityTier: 'development',
  allowElevatedBash: false,
  allowWriteBash: false,
  enterpriseBashStrict: false,
};

export class Dispatcher {
  private registry: AdapterRegistry;
  private contextManager: ContextManager;
  private sessions: SessionManager;
  private tools: ToolExecutor;
  private events: EventBus;
  private stateStore: StateStore;
  private config: DispatcherConfig;
  private middleware?: MiddlewareStack;

  constructor(
    registry: AdapterRegistry,
    contextManager: ContextManager,
    sessions: SessionManager,
    tools: ToolExecutor,
    events: EventBus,
    stateStore: StateStore,
    config?: Partial<DispatcherConfig>,
    middleware?: MiddlewareStack,
  ) {
    this.registry = registry;
    this.contextManager = contextManager;
    this.sessions = sessions;
    this.tools = tools;
    this.events = events;
    this.stateStore = stateStore;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.middleware = middleware;
  }

  async dispatch(sessionId: string, task: TaskPayload): Promise<TaskResult> {
    const session = this.sessions.getOrThrow(sessionId);

    if (session.status === 'working') {
      throw new Error(`Session ${sessionId} is already working. Cannot dispatch concurrent tasks.`);
    }

    if (this.stateStore.isHalted()) {
      throw new Error('Engine is halted. Kill switch is active.');
    }

    this.sessions.setStatus(sessionId, 'working');
    this.sessions.setTask(sessionId, task.contractId ?? 'freeform');
    this.events.emit('task.dispatched', { sessionId, modelId: session.modelId, task });

    const startTime = Date.now();
    const toolResults: ToolResult[] = [];
    let totalToolCalls = 0;

    try {
      const adapter = this.registry.getOrThrow(session.provider);
      const model = task.model ?? session.model;

      this.sessions.addMessage(sessionId, { role: 'user', content: task.prompt });

      let lastResponse: ChatResponse | undefined;

      while (true) {
        if (Date.now() - startTime > this.config.timeoutMs) {
          throw new Error(`Task timed out after ${this.config.timeoutMs / 1000}s`);
        }

        if (this.stateStore.isHalted()) {
          throw new Error('Engine halted during task execution.');
        }

        const contextPayload = this.contextManager.buildContext(
          {
            modelId: session.modelId,
            provider: session.provider,
            model,
            sessionId,
            currentTask: task.contractId ? {
              id: task.contractId,
              name: task.contractId,
              type: task.type,
              specification: task.prompt,
              acceptanceCriteria: [],
            } : undefined,
            includeComms: task.contextOverrides?.includeComms,
            commsWindow: task.contextOverrides?.commsWindow,
            kbQuery: task.contextOverrides?.kbQuery,
            activeProductId: task.activeProductId,
          },
          session.messages,
        );

        const toolDefs = this.tools.getDefinitions(session.modelId);

        const request: ChatRequest = {
          model,
          systemPrompt: contextPayload.systemPrompt,
          messages: session.messages,
          tools: toolDefs.length > 0 ? toolDefs.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })) : undefined,
          maxTokens: 4096,
          thinking: task.thinking,
        };

        if (this.middleware) {
          const mwCtx: MiddlewareContext = {
            sessionId,
            modelId: session.modelId,
            provider: session.provider,
            request,
            metadata: { taskType: task.type, contractId: task.contractId },
          };
          const preResult = await this.middleware.executeRequest(mwCtx);
          if (preResult.action === 'block') {
            throw new Error(`Blocked by middleware: ${preResult.reason}`);
          }
        }

        const response = await adapter.chat(request);
        lastResponse = response;

        if (this.middleware) {
          const mwCtx: MiddlewareContext = {
            sessionId,
            modelId: session.modelId,
            provider: session.provider,
            request,
            metadata: {},
          };
          const postResult = await this.middleware.executeResponse(mwCtx, response);
          if (postResult.action === 'block') {
            throw new Error(`Response blocked by middleware: ${postResult.reason}`);
          }
        }

        this.sessions.addTokens(sessionId, response.usage.inputTokens + response.usage.outputTokens);
        this.sessions.addCost(sessionId, response.usage.cost);
        this.stateStore.addCost(sessionId, response.usage.cost);
        this.contextManager.addCost(response.usage.cost);

        if (response.content || response.toolCalls?.length) {
          this.sessions.addMessage(sessionId, {
            role: 'assistant',
            content: response.content ?? '',
            thinking: response.thinking,
            toolCalls: response.toolCalls,
          });
        }

        // Emit thinking blocks for real-time observation by parent agents
        if (response.thinking) {
          this.events.emit('thinking.received', {
            sessionId,
            modelId: session.modelId,
            thinking: response.thinking,
            turnIndex: session.messages.length - 1,
          });
        }

        if (!response.toolCalls?.length) {
          break;
        }

        totalToolCalls += response.toolCalls.length;

        if (totalToolCalls > this.config.maxToolCalls) {
          this.events.emit('loop.limit_reached', {
            sessionId,
            modelId: session.modelId,
            toolCallCount: totalToolCalls,
            limit: this.config.maxToolCalls,
          });

          this.sessions.addMessage(sessionId, {
            role: 'user',
            content: `[SYSTEM] Tool call limit reached (${this.config.maxToolCalls}). Please provide your final response without further tool calls.`,
          });
          continue;
        }

        for (const toolCall of response.toolCalls) {
          this.sessions.incrementToolCalls(sessionId);
          this.events.emit('tool.executed', {
            sessionId,
            modelId: session.modelId,
            tool: toolCall.name,
          });

          const result = await this.tools.execute(
            { id: toolCall.id, name: toolCall.name, arguments: toolCall.arguments },
            {
              sessionId,
              modelId: session.modelId,
              workingDirectory: this.config.workingDirectory,
              sandboxRoot: this.config.workingDirectory,
              securityTier: this.config.securityTier ?? 'development',
              allowElevatedBash: this.config.allowElevatedBash ?? false,
              allowWriteBash: this.config.allowWriteBash ?? false,
              enterpriseBashStrict: this.config.enterpriseBashStrict ?? false,
              toolAuditDir: this.config.toolAuditDir,
            },
          );

          this.events.emit('tool.finished', {
            sessionId,
            modelId: session.modelId,
            tool: toolCall.name,
            isError: result.isError,
          });

          toolResults.push(result);

          this.sessions.addMessage(sessionId, {
            role: 'tool',
            content: result.output,
            toolCallId: toolCall.id,
            name: toolCall.name,
          });
        }
      }

      const duration = Date.now() - startTime;

      this.sessions.setStatus(sessionId, 'idle');
      this.sessions.setTask(sessionId, undefined);

      const taskResult: TaskResult = {
        sessionId,
        modelId: session.modelId,
        response: lastResponse!,
        toolResults,
        duration,
        success: true,
        toolCallCount: totalToolCalls,
      };

      this.events.emit('task.completed', taskResult);
      return taskResult;
    } catch (err) {
      const duration = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);

      this.sessions.setStatus(sessionId, 'error');
      this.sessions.setTask(sessionId, undefined);

      const taskResult: TaskResult = {
        sessionId,
        modelId: session.modelId,
        response: {
          content: `Error: ${errorMsg}`,
          usage: { inputTokens: 0, outputTokens: 0, cost: 0 },
          model: session.model,
          provider: session.provider,
          latencyMs: duration,
        },
        toolResults,
        duration,
        success: false,
        error: errorMsg,
        toolCallCount: totalToolCalls,
      };

      this.events.emit('task.failed', taskResult);
      return taskResult;
    }
  }

  async *dispatchStream(
    sessionId: string,
    task: TaskPayload,
  ): AsyncIterable<DispatchStreamEvent> {
    const session = this.sessions.getOrThrow(sessionId);

    if (session.status === 'working') {
      throw new Error(`Session ${sessionId} is already working. Cannot dispatch concurrent tasks.`);
    }

    if (this.stateStore.isHalted()) {
      throw new Error('Engine is halted. Kill switch is active.');
    }

    this.sessions.setStatus(sessionId, 'working');
    this.sessions.setTask(sessionId, task.contractId ?? 'freeform');
    this.events.emit('task.dispatched', { sessionId, modelId: session.modelId, task });

    const startTime = Date.now();
    const toolResults: ToolResult[] = [];
    let totalToolCalls = 0;

    try {
      const adapter = this.registry.getOrThrow(session.provider);
      const model = task.model ?? session.model;

      this.sessions.addMessage(sessionId, { role: 'user', content: task.prompt });

      while (true) {
        if (Date.now() - startTime > this.config.timeoutMs) {
          throw new Error(`Task timed out after ${this.config.timeoutMs / 1000}s`);
        }

        if (this.stateStore.isHalted()) {
          throw new Error('Engine halted during task execution.');
        }

        const contextPayload = this.contextManager.buildContext(
          {
            modelId: session.modelId,
            provider: session.provider,
            model,
            sessionId,
            currentTask: task.contractId ? {
              id: task.contractId,
              name: task.contractId,
              type: task.type,
              specification: task.prompt,
              acceptanceCriteria: [],
            } : undefined,
            includeComms: task.contextOverrides?.includeComms,
            commsWindow: task.contextOverrides?.commsWindow,
            kbQuery: task.contextOverrides?.kbQuery,
            activeProductId: task.activeProductId,
          },
          session.messages,
        );

        const toolDefs = this.tools.getDefinitions(session.modelId);

        const request: ChatRequest = {
          model,
          systemPrompt: contextPayload.systemPrompt,
          messages: session.messages,
          tools: toolDefs.length > 0 ? toolDefs.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })) : undefined,
          maxTokens: 4096,
          thinking: task.thinking,
        };

        if (this.middleware) {
          const mwCtx: MiddlewareContext = {
            sessionId,
            modelId: session.modelId,
            provider: session.provider,
            request,
            metadata: { taskType: task.type, contractId: task.contractId },
          };
          const preResult = await this.middleware.executeRequest(mwCtx);
          if (preResult.action === 'block') {
            throw new Error(`Blocked by middleware: ${preResult.reason}`);
          }
        }

        // Stream the response, accumulating text, thinking, and tool call deltas
        let accumulatedContent = '';
        let accumulatedThinking = '';
        const streamedToolCalls = new Map<string, { id: string; name: string; arguments: string }>();

        for await (const chunk of adapter.chatStream(request)) {
          if (chunk.thinkingDelta) {
            accumulatedThinking += chunk.thinkingDelta;
            yield { type: 'thinking', thinking: chunk.thinkingDelta };
          }

          if (chunk.delta) {
            accumulatedContent += chunk.delta;
            yield { type: 'delta', delta: chunk.delta, done: false };
          }

          // Accumulate tool call deltas into complete tool calls
          if (chunk.toolCallDelta) {
            const td = chunk.toolCallDelta;
            const key = td.id ?? '__pending';
            if (!streamedToolCalls.has(key) && td.id) {
              streamedToolCalls.set(key, { id: td.id, name: td.name ?? '', arguments: '' });
            }
            const acc = streamedToolCalls.get(key);
            if (acc) {
              if (td.name && !acc.name) acc.name = td.name;
              if (td.arguments) acc.arguments += td.arguments;
            }
          }

          if (chunk.done) {
            yield { type: 'delta', delta: '', done: true };
          }
        }

        // Persist assistant message with any accumulated tool calls
        const toolCalls = Array.from(streamedToolCalls.values()).filter((tc) => tc.id && tc.name);

        if (accumulatedContent || toolCalls.length > 0) {
          this.sessions.addMessage(sessionId, {
            role: 'assistant',
            content: accumulatedContent,
            thinking: accumulatedThinking || undefined,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          });
        }

        // Emit thinking for real-time observation by parent agents
        if (accumulatedThinking) {
          this.events.emit('thinking.received', {
            sessionId,
            modelId: session.modelId,
            thinking: accumulatedThinking,
            turnIndex: session.messages.length - 1,
          });
        }

        // If no tool calls, we're done
        if (toolCalls.length === 0) {
          break;
        }

        // Execute tool calls and continue the loop
        totalToolCalls += toolCalls.length;

        if (totalToolCalls > this.config.maxToolCalls) {
          this.events.emit('loop.limit_reached', {
            sessionId,
            modelId: session.modelId,
            toolCallCount: totalToolCalls,
            limit: this.config.maxToolCalls,
          });

          this.sessions.addMessage(sessionId, {
            role: 'user',
            content: `[SYSTEM] Tool call limit reached (${this.config.maxToolCalls}). Please provide your final response without further tool calls.`,
          });
          continue;
        }

        for (const toolCall of toolCalls) {
          this.sessions.incrementToolCalls(sessionId);
          this.events.emit('tool.executed', {
            sessionId,
            modelId: session.modelId,
            tool: toolCall.name,
          });

          yield { type: 'tool_call', tool: toolCall.name, id: toolCall.id, arguments: toolCall.arguments };

          const result = await this.tools.execute(
            { id: toolCall.id, name: toolCall.name, arguments: toolCall.arguments },
            {
              sessionId,
              modelId: session.modelId,
              workingDirectory: this.config.workingDirectory,
              sandboxRoot: this.config.workingDirectory,
              securityTier: this.config.securityTier ?? 'development',
              allowElevatedBash: this.config.allowElevatedBash ?? false,
              allowWriteBash: this.config.allowWriteBash ?? false,
              enterpriseBashStrict: this.config.enterpriseBashStrict ?? false,
              toolAuditDir: this.config.toolAuditDir,
            },
          );

          this.events.emit('tool.finished', {
            sessionId,
            modelId: session.modelId,
            tool: toolCall.name,
            isError: result.isError,
          });

          toolResults.push(result);

          yield { type: 'tool_result', tool: toolCall.name, id: toolCall.id, output: result.output, isError: result.isError };

          this.sessions.addMessage(sessionId, {
            role: 'tool',
            content: result.output,
            toolCallId: toolCall.id,
            name: toolCall.name,
          });
        }
      }

      const duration = Date.now() - startTime;

      this.sessions.setStatus(sessionId, 'idle');
      this.sessions.setTask(sessionId, undefined);

      yield {
        type: 'complete',
        sessionId,
        modelId: session.modelId,
        duration,
        toolCallCount: totalToolCalls,
      };

      this.events.emit('task.completed', {
        sessionId,
        modelId: session.modelId,
        duration,
        success: true,
        toolCallCount: totalToolCalls,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.sessions.setStatus(sessionId, 'error');
      this.sessions.setTask(sessionId, undefined);

      yield { type: 'error', error: errorMsg };

      this.events.emit('task.failed', {
        sessionId,
        modelId: session.modelId,
        error: errorMsg,
        success: false,
      });
    }
  }

  async dispatchParallel(
    tasks: Array<{ sessionId: string; task: TaskPayload }>,
  ): Promise<TaskResult[]> {
    const promises = tasks.map(({ sessionId, task }) => this.dispatch(sessionId, task));
    const results = await Promise.allSettled(promises);

    return results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      return {
        sessionId: tasks[i].sessionId,
        modelId: 'unknown',
        response: {
          content: `Error: ${r.reason}`,
          usage: { inputTokens: 0, outputTokens: 0, cost: 0 },
          model: 'unknown',
          provider: 'unknown',
          latencyMs: 0,
        },
        toolResults: [],
        duration: 0,
        success: false,
        error: String(r.reason),
        toolCallCount: 0,
      };
    });
  }
}
