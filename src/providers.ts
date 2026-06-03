import type { Env, ProviderRequest, ProviderResponse } from "./types";

interface ProviderConfig {
  name: string;
  keyEnv: keyof Env;
  baseUrl: string;
  defaultModel: string;
  buildHeaders: (key: string) => Record<string, string>;
  transformRequest?: (req: ProviderRequest, model: string) => unknown;
  transformResponse?: (data: any) => ProviderResponse;
  getEndpointUrl?: (model: string, apiKey: string) => string;
}

const PROVIDERS: Record<string, ProviderConfig> = {
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
      const content =
        data.content
          ?.filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("") || "";

      const toolCalls =
        data.content
          ?.filter((b: any) => b.type === "tool_use")
          .map((b: any) => ({
            id: b.id,
            type: "function" as const,
            function: { name: b.name, arguments: JSON.stringify(b.input) },
          })) || [];

      return {
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        model: data.model,
        usage: data.usage
          ? {
              prompt_tokens: data.usage.input_tokens,
              completion_tokens: data.usage.output_tokens,
            }
          : undefined,
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
      const contents = req.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content || "" }],
        }));

      const systemMsg = req.messages.find((m) => m.role === "system");

      const body: any = {
        contents,
        generationConfig: {
          maxOutputTokens: req.max_tokens || 4096,
          temperature: req.temperature,
        },
      };

      if (systemMsg) {
        body.systemInstruction = { parts: [{ text: systemMsg.content }] };
      }

      if (req.tools && req.tools.length > 0) {
        body.tools = [
          {
            functionDeclarations: req.tools.map((t) => ({
              name: t.function.name,
              description: t.function.description,
              parameters: t.function.parameters,
            })),
          },
        ];
      }

      return body;
    },
    getEndpointUrl: (model, apiKey) =>
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    transformResponse: (data: any): ProviderResponse => {
      const candidate = data.candidates?.[0];
      const parts = candidate?.content?.parts || [];

      const content = parts
        .filter((p: any) => p.text)
        .map((p: any) => p.text)
        .join("");

      const toolCalls = parts
        .filter((p: any) => p.functionCall)
        .map((p: any, i: number) => ({
          id: `call_${i}`,
          type: "function" as const,
          function: {
            name: p.functionCall.name,
            arguments: JSON.stringify(p.functionCall.args || {}),
          },
        }));

      return {
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        model: data.modelVersion || "gemini",
        usage: data.usageMetadata
          ? {
              prompt_tokens: data.usageMetadata.promptTokenCount,
              completion_tokens: data.usageMetadata.candidatesTokenCount,
            }
          : undefined,
        finishReason: candidate?.finishReason || "stop",
      };
    },
  },
  openrouter: {
    name: "openrouter",
    keyEnv: "OPENROUTER_API_KEY",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "anthropic/claude-sonnet-4",
    buildHeaders: (key) => ({
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://auxlo-neo.workers.dev",
    }),
  },
  groq: {
    name: "groq",
    keyEnv: "GROQ_API_KEY",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    buildHeaders: (key) => ({
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    }),
  },
  deepseek: {
    name: "deepseek",
    keyEnv: "DEEPSEEK_API_KEY",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    buildHeaders: (key) => ({
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    }),
  },
};

function resolveProvider(env: Env, name: string): { config: ProviderConfig; model: string } {
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(`Unknown provider: ${name}. Available: ${Object.keys(PROVIDERS).join(", ")}`);
  }

  const key = env[provider.keyEnv] as string;
  if (!key) {
    throw new Error(`Missing API key for ${name}. Set ${provider.keyEnv} as a secret.`);
  }

  return { config: provider, model: provider.defaultModel };
}

function normalizeToolCalls(toolCalls: any[] | undefined): any[] | undefined {
  if (!toolCalls || toolCalls.length === 0) return undefined;
  return toolCalls.map((tc) => ({
    id: tc.id || `call_${crypto.randomUUID().slice(0, 8)}`,
    type: "function" as const,
    function: {
      name: tc.function?.name || tc.name,
      arguments:
        typeof tc.function?.arguments === "string"
          ? tc.function.arguments
          : JSON.stringify(tc.function?.arguments || tc.arguments || {}),
    },
  }));
}

export async function callProvider(
  env: Env,
  providerName: string,
  req: ProviderRequest
): Promise<ProviderResponse> {
  const { config } = resolveProvider(env, providerName);
  const key = env[config.keyEnv] as string;
  const model = req.model || config.defaultModel;

  let url: string;
  let headers: Record<string, string>;
  let body: unknown;

  if (config.transformRequest) {
    body = config.transformRequest(req, model);
  } else {
    body = {
      model,
      messages: req.messages,
      max_tokens: req.max_tokens || 4096,
      temperature: req.temperature,
      tools: req.tools,
    };
  }

  if (config.getEndpointUrl) {
    url = config.getEndpointUrl(model, key);
  } else if (config.name === "anthropic") {
    url = `${config.baseUrl}/v1/messages`;
  } else {
    url = `${config.baseUrl}/chat/completions`;
  }

  headers = config.buildHeaders(key);

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`${config.name} API error ${response.status}: ${errText}`);
  }

  const data: any = await response.json();

  if (data.error) {
    throw new Error(`${config.name} error: ${data.error.message || JSON.stringify(data.error)}`);
  }

  if (config.transformResponse) {
    return config.transformResponse(data);
  }

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

export async function streamProvider(
  env: Env,
  providerName: string,
  req: ProviderRequest
): Promise<ReadableStream<string>> {
  const { config } = resolveProvider(env, providerName);
  const key = env[config.keyEnv] as string;
  const model = req.model || config.defaultModel;

  const url = `${config.baseUrl}/chat/completions`;
  const headers = config.buildHeaders(key);

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: req.messages,
      max_tokens: req.max_tokens || 4096,
      temperature: req.temperature,
      tools: req.tools,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`${config.name} API error ${response.status}: ${errText}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  return new ReadableStream<string>({
    async pull(controller) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") {
            controller.close();
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) controller.enqueue(content);
          } catch {
            // Skip malformed chunks
          }
        }
      }
    },
  });
}
