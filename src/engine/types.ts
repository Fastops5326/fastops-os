export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  thinking?: string;
  toolCallId?: string;
  name?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ThinkingConfig {
  enabled: boolean;
  budgetTokens?: number;
}

export interface ChatRequest {
  model: string;
  systemPrompt: string;
  messages: Message[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  thinking?: ThinkingConfig;
  metadata?: Record<string, unknown>;
}

export interface ChatResponse {
  content: string;
  thinking?: string;
  toolCalls?: ToolCall[];
  usage: TokenUsage;
  model: string;
  provider: string;
  latencyMs: number;
  raw?: unknown;
}

export interface ChatChunk {
  delta: string;
  thinkingDelta?: string;
  toolCallDelta?: Partial<ToolCall>;
  done: boolean;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface ModelAdapter {
  readonly provider: string;
  readonly models: string[];

  chat(request: ChatRequest): Promise<ChatResponse>;
  chatStream(request: ChatRequest): AsyncIterable<ChatChunk>;
  ping(): Promise<boolean>;
}

export interface AdapterConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
}

export const PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-20250514': { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000 },
  'claude-3-5-sonnet-20241022': { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000 },
  'claude-3-5-haiku-20241022': { input: 0.8 / 1_000_000, output: 4.0 / 1_000_000 },
  'claude-3-opus-20240229': { input: 15.0 / 1_000_000, output: 75.0 / 1_000_000 },
  'gpt-4o': { input: 2.5 / 1_000_000, output: 10.0 / 1_000_000 },
  'gpt-4o-mini': { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
  'o3': { input: 10.0 / 1_000_000, output: 40.0 / 1_000_000 },
  'o3-mini': { input: 1.1 / 1_000_000, output: 4.4 / 1_000_000 },
  'gemini-2.5-pro-preview-05-06': { input: 1.25 / 1_000_000, output: 10.0 / 1_000_000 },
  'gemini-2.5-flash-preview-05-20': { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
  'gemini-2.0-flash': { input: 0.1 / 1_000_000, output: 0.4 / 1_000_000 },
};

export function calculateCost(model: string, usage: Omit<TokenUsage, 'cost'>): number {
  const pricing = PRICING[model];
  if (!pricing) return 0;
  return (usage.inputTokens * pricing.input) + (usage.outputTokens * pricing.output);
}
