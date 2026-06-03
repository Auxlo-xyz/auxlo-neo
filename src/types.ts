export interface Env {
  SESSIONS: KVNamespace;
  MEMORY: KVNamespace;
  CONFIG: KVNamespace;

  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  GROQ_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;

  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  DISCORD_BOT_TOKEN?: string;
  DISCORD_PUBLIC_KEY?: string;
  DISCORD_APPLICATION_ID?: string;

  DEFAULT_PROVIDER?: string;
  DEFAULT_MODEL?: string;
  DEFAULT_SYSTEM_PROMPT?: string;
  ALLOWED_USERS?: string;
  API_KEY?: string;
}

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolResult {
  content: string;
  error?: boolean;
}

export interface SessionState {
  sessionId: string;
  messages: Message[];
  model?: string;
  provider?: string;
  systemPrompt?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AgentRequest {
  message: string;
  session_id?: string;
  model?: string;
  provider?: string;
  max_tokens?: number;
  temperature?: number;
  system_prompt?: string;
  channel?: string;
  userId?: string;
  username?: string;
}

export interface AgentResponse {
  content: string;
  session_id: string;
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

export interface ProviderRequest {
  messages: Message[];
  tools?: ToolDefinition[];
  model?: string;
  max_tokens?: number;
  temperature?: number;
}

export interface ProviderResponse {
  content: string | null;
  toolCalls?: ToolCall[];
  model: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  finishReason?: string;
}

export interface CustomProviderConfig {
  id: string;
  name: string;
  base_url: string;
  api_key: string;
  default_model: string;
  type: "openai" | "anthropic" | "google";
}

export interface ProviderConfig {
  name: string;
  keyEnv: keyof Env;
  baseUrl: string;
  defaultModel: string;
  buildHeaders: (key: string) => Record<string, string>;
  transformRequest?: (req: ProviderRequest, model: string) => unknown;
  transformResponse?: (data: any) => ProviderResponse;
  getEndpointUrl?: (model: string, apiKey: string) => string;
}

export const MAX_HISTORY_LIMIT = 50;
export const ACTIVE_WINDOW_SIZE = 20;
