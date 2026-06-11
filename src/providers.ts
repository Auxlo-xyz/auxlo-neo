import type { Env, ProviderRequest, ProviderResponse } from "./types";

interface ProviderConfig {
  name: string;
  keyEnv: "OPENAI_API_KEY" | "ANTHROPIC_API_KEY" | "GOOGLE_API_KEY" | "OPENROUTER_API_KEY" | "GROQ_API_KEY" | "DEEPSEEK_API_KEY";
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
  type: "openai" | "anthropic" | "google";
}

export const BUILTIN: Record<string, ProviderConfig> = {
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
    transformRequest: (req, model) => {
      const messages = req.messages.filter((m) => m.role !== "system");
      const systemMsg = req.messages.find((m) => m.role === "system");
      const body: any = {
        model,
        max_tokens: req.max_tokens || 4096,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
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
      const content = data.content?.filter((b: any) => b.type === "text").map((b: any) => b.text).join("") || "";
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
  google: {
    name: "google",
    keyEnv: "GOOGLE_API_KEY",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.0-flash",
    buildHeaders: () => ({ "Content-Type": "application/json" }),
    transformRequest: (req, model) => {
      const contents = req.messages.filter((m) => m.role !== "system").map((m) => {
        if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
          // Build functionCall parts with thoughtSignatures for assistant/model messages
          const parts = m.tool_calls.map((tc) => {
            const part: any = {
              functionCall: {
                name: tc.function.name,
                args: JSON.parse(tc.function.arguments || "{}"),
              },
            };
            if (tc.thoughtSignature) {
              part.functionCall.thoughtSignature = tc.thoughtSignature;
            }
            return part;
          });
          return { role: "model", parts };
        }
        return {
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content || "" }],
        };
      });
      const systemMsg = req.messages.find((m) => m.role === "system");
      const body: any = { contents, generationConfig: { maxOutputTokens: req.max_tokens || 4096, temperature: req.temperature } };
      if (systemMsg) body.systemInstruction = { parts: [{ text: systemMsg.content }] };
      if (req.tools && req.tools.length > 0) {
        body.tools = [{ functionDeclarations: req.tools.map((t) => ({ name: t.function.name, description: t.function.description, parameters: t.function.parameters })) }];
      }
      return body;
    },
    getEndpointUrl: (model, apiKey) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    transformResponse: (data: any): ProviderResponse => {
      const candidate = data.candidates?.[0];
      const parts = candidate?.content?.parts || [];
      const content = parts.filter((p: any) => p.text).map((p: any) => p.text).join("");
      const toolCalls = parts.filter((p: any) => p.functionCall).map((p: any, i: number) => ({
        id: `call_${i}`,
        type: "function" as const,
        function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) },
        thoughtSignature: p.functionCall.thoughtSignature,
      }));
      return {
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        model: data.modelVersion || "gemini",
        usage: data.usageMetadata ? { prompt_tokens: data.usageMetadata.promptTokenCount, completion_tokens: data.usageMetadata.candidatesTokenCount } : undefined,
        finishReason: candidate?.finishReason || "stop",
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
export async function loadCustomProviders(env: Env): Promise<Record<string, ProviderConfig>> {
  const raw = await env.CONFIG.get("custom_providers", "json");
  if (!raw) return {};
  const customs = raw as CustomProviderConfig[];
  const result: Record<string, ProviderConfig> = {};
  for (const cp of customs) {
    result[cp.id] = customToProviderConfig(cp);
  }
  return result;
}

function customToProviderConfig(cp: CustomProviderConfig): ProviderConfig {
  if (cp.type === "google") {
    // Google custom providers use native Gemini API format
    const baseUrl = cp.base_url.replace(/\/openai\/?$/, "").replace(/\/+$/, "");
    return {
      name: cp.name,
      keyEnv: "__custom__" as any,
      baseUrl: baseUrl,
      defaultModel: cp.default_model,
      buildHeaders: () => ({ "Content-Type": "application/json" }),
      transformRequest: BUILTIN.google.transformRequest,
      getEndpointUrl: (model, _key) => `${baseUrl}/models/${model}:generateContent?key=${cp.api_key}`,
      transformResponse: BUILTIN.google.transformResponse,
    };
  }
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

export async function listProviders(env: Env): Promise<{ id: string; name: string; model: string; type: string }[]> {
  const result: { id: string; name: string; model: string; type: string }[] = [];
  for (const [id, cfg] of Object.entries(BUILTIN)) {
    const key = env[cfg.keyEnv];
    result.push({ id, name: cfg.name, model: cfg.defaultModel, type: key ? "builtin" : "builtin (no key)" });
  }
  const customs = await loadCustomProviders(env);
  for (const [id, cfg] of Object.entries(customs)) {
    result.push({ id, name: cfg.name, model: cfg.defaultModel, type: "custom" });
  }
  return result;
}

export async function addCustomProvider(env: Env, cp: CustomProviderConfig): Promise<void> {
  const raw = await env.CONFIG.get("custom_providers", "json");
  const customs: CustomProviderConfig[] = (raw as CustomProviderConfig[]) || [];
  const idx = customs.findIndex((c) => c.id === cp.id);
  if (idx >= 0) customs[idx] = cp;
  else customs.push(cp);
  await env.CONFIG.put("custom_providers", JSON.stringify(customs));
}

export async function removeCustomProvider(env: Env, id: string): Promise<boolean> {
  const raw = await env.CONFIG.get("custom_providers", "json");
  const customs: CustomProviderConfig[] = (raw as CustomProviderConfig[]) || [];
  const filtered = customs.filter((c) => c.id !== id);
  if (filtered.length === customs.length) return false;
  await env.CONFIG.put("custom_providers", JSON.stringify(filtered));
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

export async function callProvider(env: Env, providerName: string, req: ProviderRequest): Promise<ProviderResponse> {
  // Resolve: check builtins first, then custom providers in KV
  let config = BUILTIN[providerName];
  let apiKey: string;

  if (config) {
    apiKey = env[config.keyEnv] || "";
    if (!apiKey) throw new Error(`Missing API key for ${providerName}. Set ${config.keyEnv} as a secret.`);
  } else {
    const customs = await loadCustomProviders(env);
    config = customs[providerName];
    if (!config) throw new Error(`Unknown provider: ${providerName}. Available: ${[...Object.keys(BUILTIN), ...Object.keys(customs)].join(", ")}`);
    apiKey = ""; // key is embedded in headers via customToProviderConfig
  }

  const model = req.model || config.defaultModel;

  let url: string;
  let headers: Record<string, string>;
  let body: unknown;

  if (config.transformRequest) {
    body = config.transformRequest(req, model);
  } else {
    body = { model, messages: req.messages, max_tokens: req.max_tokens || 4096, temperature: req.temperature, tools: req.tools };
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
    content: choice.message?.content || "",
    toolCalls: normalizeToolCalls(choice.message?.tool_calls),
    model: data.model,
    usage: data.usage,
    finishReason: choice.finish_reason || "stop",
  };
}
