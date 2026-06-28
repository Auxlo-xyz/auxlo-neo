import type { Env, ProviderRequest, ProviderResponse, Message } from "./types";

interface ProviderConfig {
  name: string;
  keyEnv: "OPENAI_API_KEY" | "ANTHROPIC_API_KEY" | "POOLSIDE_API_KEY" | "OPENROUTER_API_KEY" | "GROQ_API_KEY" | "DEEPSEEK_API_KEY";
  baseUrl: string;
  defaultModel: string;
  buildHeaders: (key: string) => Record<string, string>;
  transformRequest?: (req: ProviderRequest, model: string) => unknown;
  transformResponse?: (data: any) => ProviderResponse;
  getEndpointUrl?: (model: string, apiKey: string) => string;
}

export interface CustomProviderConfig {
  id: string;
  name: string;
  base_url: string;
  api_key: string;
  default_model: string;
  type: "openai" | "anthropic";
}

export const BUILTIN: Record<string, ProviderConfig> = {
  poolside: {
    name: "poolside",
    keyEnv: "POOLSIDE_API_KEY",
    baseUrl: "https://gemini-api-failover-proxy.georgeo-qie.workers.dev/v1",
    defaultModel: "cohere/north-mini-code:free",
    buildHeaders: (key) => ({
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json, application/problem+json",
    }),
  },
  openai: {
    name: "openai",
    keyEnv: "OPENAI_API_KEY",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
    buildHeaders: (key) => ({
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    }),
  },
  anthropic: {
    name: "anthropic",
    keyEnv: "ANTHROPIC_API_KEY",
    baseUrl: "https://api.anthropic.com",
    defaultModel: "claude-sonnet-4-20250514",
    buildHeaders: (key) => ({
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    }),
    transformRequest: async (req, model) => {
      const messages = req.messages.filter((m) => m.role !== "system");
      const systemMsg = req.messages.find((m) => m.role === "system");
      
      // Enforce alternating roles (user -> assistant -> user)
      const alternatingMessages: Message[] = [];
      for (const m of messages) {
        const lastMsg = alternatingMessages[alternatingMessages.length - 1];
        if (lastMsg && lastMsg.role === m.role) {
          // Merge consecutive messages of the same role
          if (typeof lastMsg.content === "string" && typeof m.content === "string") {
            lastMsg.content += "\n" + m.content;
          } else if (typeof m.content === "string") {
            // If last was multimodal, just append text to a new part or handle simply
            // For simplicity in this edge-case, we just append as a new message if we can't merge
            alternatingMessages.push(m);
          } else {
            alternatingMessages.push(m);
          }
        } else {
          alternatingMessages.push(m);
        }
      }

      // Ensure the conversation starts with a user message
      const finalMessages = [...alternatingMessages];
      if (finalMessages.length > 0 && finalMessages[0].role !== "user") {
        finalMessages.unshift({ role: "user", content: "Hello", media: [] });
      }

      const transformedMessages = await Promise.all(finalMessages.map(async (m) => {
        const content: any[] = [];
        if (m.content) content.push({ type: "text", text: m.content });
        if (m.media) {
          for (const media of m.media) {
            if (media.type === "image") {
              const resp = await fetch(media.url);
              const buffer = await resp.arrayBuffer();
              content.push({
                type: "image",
                source: {
                  type: "base64",
                  media_type: resp.headers.get("content-type") || "image/jpeg",
                  data: btoa(String.fromCharCode(...new Uint8Array(buffer))),
                },
              });
            }
          }
        }
        return { role: m.role, content };
      }));

      const body: any = {
        model,
        max_tokens: req.max_tokens || 4096,
        messages: transformedMessages,
      };
      if (systemMsg) body.system = systemMsg.content;
      if (req.tools && req.tools.length > 0) {
        body.tools = req.tools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          input_schema: t.function.parameters,
        }));
      }
      return body;
    },
    transformResponse: (data: any): ProviderResponse => {
      const content = stripThinkTags(data.content?.filter((b: any) => b.type === "text").map((b: any) => b.text).join("") || "");
      const toolCalls = data.content?.filter((b: any) => b.type === "tool_use").map((b: any) => ({
        id: b.id,
        type: "function" as const,
        function: { name: b.name, arguments: JSON.stringify(b.input) },
      })) || [];
      return {
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        model: data.model,
        usage: data.usage ? { prompt_tokens: data.usage.input_tokens, completion_tokens: data.usage.output_tokens } : undefined,
        finishReason: data.stop_reason || "stop",
      };
    },
  },
  openrouter: {
    name: "openrouter",
    keyEnv: "OPENROUTER_API_KEY",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "anthropic/claude-sonnet-4",
    buildHeaders: (key) => ({ Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "https://auxlo-neo.workers.dev" }),
  },
  groq: {
    name: "groq",
    keyEnv: "GROQ_API_KEY",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    buildHeaders: (key) => ({ Authorization: `Bearer ${key}`, "Content-Type": "application/json" }),
  },
  deepseek: {
    name: "deepseek",
    keyEnv: "DEEPSEEK_API_KEY",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    buildHeaders: (key) => ({ Authorization: `Bearer ${key}`, "Content-Type": "application/json" }),
  },
};

// Load custom providers from KV and convert to ProviderConfig
export async function loadCustomProviders(env: Env, userId: string): Promise<Record<string, ProviderConfig>> {
  const raw = await env.CONFIG.get(`user:${userId}:custom_providers`, "json");
  if (!raw) return {};
  const customs = raw as CustomProviderConfig[];
  const result: Record<string, ProviderConfig> = {};
  for (const cp of customs) {
    result[cp.id] = customToProviderConfig(cp);
  }
  return result;
}

function customToProviderConfig(cp: CustomProviderConfig): ProviderConfig {
  if (cp.type === "anthropic") {
    return {
      name: cp.name,
      keyEnv: "__custom__" as any,
      baseUrl: cp.base_url,
      defaultModel: cp.default_model,
      buildHeaders: () => ({
        "x-api-key": cp.api_key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      }),
      transformRequest: BUILTIN.anthropic.transformRequest,
      transformResponse: BUILTIN.anthropic.transformResponse,
    };
  }
  // openai_compatible (default)
  return {
    name: cp.name,
    keyEnv: "__custom__" as any,
    baseUrl: cp.base_url,
    defaultModel: cp.default_model,
    buildHeaders: () => ({ Authorization: `Bearer ${cp.api_key}`, "Content-Type": "application/json" }),
  };
}

export async function listProviders(env: Env, userId?: string): Promise<{ id: string; name: string; model: string; type: string }[]> {
  const result: { id: string; name: string; model: string; type: string }[] = [];
  for (const [id, cfg] of Object.entries(BUILTIN)) {
    const key = env[cfg.keyEnv];
    result.push({ id, name: cfg.name, model: cfg.defaultModel, type: key ? "builtin" : "builtin (no key)" });
  }
  if (userId) {
    const customs = await loadCustomProviders(env, userId);
    for (const [id, cfg] of Object.entries(customs)) {
      result.push({ id, name: cfg.name, model: cfg.defaultModel, type: "custom" });
    }
  }
  return result;
}

export async function addCustomProvider(env: Env, userId: string, cp: CustomProviderConfig): Promise<void> {
  const raw = await env.CONFIG.get(`user:${userId}:custom_providers`, "json");
  const customs: CustomProviderConfig[] = (raw as CustomProviderConfig[]) || [];
  const idx = customs.findIndex((c) => c.id === cp.id);
  if (idx >= 0) customs[idx] = cp;
  else customs.push(cp);
  await env.CONFIG.put(`user:${userId}:custom_providers`, JSON.stringify(customs));
  await env.CONFIG.put(`user:${userId}:custom_provider:${cp.id}`, JSON.stringify(cp));
}

export async function removeCustomProvider(env: Env, userId: string, id: string): Promise<boolean> {
  const raw = await env.CONFIG.get(`user:${userId}:custom_providers`, "json");
  const customs: CustomProviderConfig[] = (raw as CustomProviderConfig[]) || [];
  const filtered = customs.filter((c) => c.id !== id);
  if (filtered.length === customs.length) return false;
  await env.CONFIG.put(`user:${userId}:custom_providers`, JSON.stringify(filtered));
  await env.CONFIG.delete(`user:${userId}:custom_provider:${id}`);
  return true;
}

function normalizeToolCalls(toolCalls: any[] | undefined): any[] | undefined {
  if (!toolCalls || toolCalls.length === 0) return undefined;
  return toolCalls.map((tc) => ({
    id: tc.id || `call_${crypto.randomUUID().slice(0, 8)}`,
    type: "function" as const,
    function: {
      name: tc.function?.name || tc.name,
      arguments: typeof tc.function?.arguments === "string" ? tc.function.arguments : JSON.stringify(tc.function?.arguments || tc.arguments || {}),
    },
  }));
}
/**
 * Strip <think>/<thought> reasoning blocks from model output.
 * Handles balanced blocks, unclosed opening (streaming cutoff),
 * orphaned closing tags, case-insensitive + whitespace-tolerant tags,
 * and multiple blocks. Trims leftover whitespace.
 */
function stripThinkTags(text: string): string {
  if (!text) return text;
  // 1. Balanced <think>...</think> / <thought>...</thought> (non-greedy, case-insensitive, backreference matches open/close)
  let out = text.replace(/<\s*(think|thought)\b[\s\S]*?<\/\s*\1\s*>/gi, "");
  // 2. Unclosed opening tag to end (truncated / streaming cutoff)
  out = out.replace(/<\s*(think|thought)\b[\s\S]*$/gi, "");
  // 3. Stray lone tags (orphaned </think>, malformed)
  out = out.replace(/<\/?\s*(think|thought)\b[^>]*>/gi, "");
  return out.trim();
}

export async function callProvider(env: Env, providerName: string, req: ProviderRequest): Promise<ProviderResponse> {
  // Resolve: check builtins first, then custom providers in KV
  let config = BUILTIN[providerName];
  let apiKey: string;

  if (config) {
    apiKey = req.apiKey || env[config.keyEnv] || "";
    if (!apiKey) throw new Error(`Missing API key for ${providerName}. Use /key to set it or set ${config.keyEnv} as a secret.`);
  } else {
    const userId = req.userId;
    if (!userId) throw new Error(`userId is required to load custom providers.`);
    const customs = await loadCustomProviders(env, userId);
    config = customs[providerName];
    if (!config) throw new Error(`Unknown provider: ${providerName}. Available: ${[...Object.keys(BUILTIN), ...Object.keys(customs)].join(", ")}`);
    apiKey = ""; // key is embedded in headers via customToProviderConfig
  }

  const model = req.model || config.defaultModel;

  let url: string;
  let headers: Record<string, string>;
  let body: unknown;

  if (config.transformRequest) {
    body = await config.transformRequest(req, model);
  } else {
    // OpenAI-compatible transformation with multimodal support
    const messages = await Promise.all(req.messages.map(async (m) => {
      if (m.role === "system") return m;
      
      const content: any[] = [];
      if (m.content) content.push({ type: "text", text: m.content });
      if (m.media) {
        for (const media of m.media) {
          if (media.type === "image") {
            try {
              const resp = await fetch(media.url);
              const buffer = await resp.arrayBuffer();
              const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
              const mimeType = resp.headers.get("content-type") || "image/jpeg";
              content.push({
                type: "image_url",
                image_url: { url: `data:${mimeType};base64,${base64}` },
              });
            } catch (e) {
              console.error(`Failed to fetch image for multimodal input: ${e}`);
            }
          }
        }
      }
      
      return {
        ...m,
        content: content.length > 0 ? content : m.content,
      };
    }));

    body = { 
      model, 
      messages, 
      max_tokens: req.max_tokens || 4096, 
      temperature: req.temperature, 
      tools: req.tools,
      tool_choice: req.tools && req.tools.length > 0 ? "auto" : undefined
    };
  }

  if (config.getEndpointUrl) {
    url = config.getEndpointUrl(model, apiKey);
  } else if (config.name === "anthropic") {
    url = `${config.baseUrl.replace(/\/+$/,"")}/v1/messages`;
  } else {
    url = `${config.baseUrl.replace(/\/+$/,"")}/chat/completions`;
  }

  headers = config.buildHeaders(apiKey);

  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`${config.name} API error ${response.status}: ${errText}`);
  }

  const data: any = await response.json();
  if (data.error) throw new Error(`${config.name} error: ${data.error.message || JSON.stringify(data.error)}`);

  if (config.transformResponse) return config.transformResponse(data);

  const choice = data.choices?.[0];
  if (!choice) throw new Error(`${config.name}: No choices in response`);

  return {
    content: stripThinkTags(choice.message?.content || ""),
    toolCalls: normalizeToolCalls(choice.message?.tool_calls),
    model: data.model,
    usage: data.usage,
    finishReason: choice.finish_reason || "stop",
  };
}
