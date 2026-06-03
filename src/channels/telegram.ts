import type { Env, AgentRequest, CustomProviderConfig } from "../types";
import { agentChat } from "../agent";
import { listProviders } from "../providers";

// ---- Telegram types ----

interface TelegramUser {
  id: number;
  first_name: string;
  username?: string;
}

interface TelegramMessage {
  message_id: number;
  from: TelegramUser;
  chat: { id: number; type: string };
  text?: string;
}

interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

// ---- Endpoint wizard state (stored in CONFIG KV) ----

interface EndpointWizardState {
  step: "type" | "base_url" | "model" | "api_key" | "confirm";
  type?: "openai" | "anthropic";
  base_url?: string;
  model?: string;
  api_key?: string;
  started_at: number;
}

// ---- Bot commands for menu ----

const BOT_COMMANDS = [
  { command: "start", description: "Welcome message" },
  { command: "help", description: "Show all commands" },
  { command: "reset", description: "Clear conversation history" },
  { command: "model", description: "Switch AI model" },
  { command: "provider", description: "Switch provider" },
  { command: "endpoint", description: "Add custom API endpoint" },
  { command: "persona", description: "Set system prompt" },
  { command: "status", description: "Show current session info" },
  { command: "endpoints", description: "List saved endpoints" },
];

// ---- Helpers ----

function parseCommand(text: string): { command: string; args: string } | null {
  const match = text.match(/^\/(\w+)(?:\s+(.*))?$/);
  if (!match) return null;
  return { command: match[1].toLowerCase(), args: match[2]?.trim() || "" };
}

async function tgApi(env: Env, method: string, body: Record<string, unknown>): Promise<any> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  const resp = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return resp.json();
}

async function sendText(env: Env, chatId: number, text: string, replyMarkup?: Record<string, unknown>): Promise<void> {
  const chunks: string[] = [];
  if (text.length <= 4000) {
    chunks.push(text);
  } else {
    let remaining = text;
    while (remaining.length > 0) {
      chunks.push(remaining.slice(0, 4000));
      remaining = remaining.slice(4000);
    }
  }
  for (const chunk of chunks) {
    const body: Record<string, unknown> = { chat_id: chatId, text: chunk };
    if (replyMarkup && chunk === chunks[chunks.length - 1]) {
      body.reply_markup = replyMarkup;
    }
    await tgApi(env, "sendMessage", body);
  }
}

async function editText(env: Env, chatId: number, messageId: number, text: string, replyMarkup?: Record<string, unknown>): Promise<void> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text,
  };
  if (replyMarkup) body.reply_markup = replyMarkup;
  await tgApi(env, "editMessageText", body);
}

async function answerCallback(env: Env, callbackId: string, text?: string): Promise<void> {
  const body: Record<string, unknown> = { callback_query_id: callbackId };
  if (text) body.text = text;
  await tgApi(env, "answerCallbackQuery", body);
}

// ---- Endpoint wizard state management ----

async function getWizardState(env: Env, userId: string): Promise<EndpointWizardState | null> {
  const raw = await env.CONFIG.get(`wizard:${userId}`, "json");
  return raw as EndpointWizardState | null;
}

async function setWizardState(env: Env, userId: string, state: EndpointWizardState): Promise<void> {
  await env.CONFIG.put(`wizard:${userId}`, JSON.stringify(state), { expirationTtl: 600 });
}

async function clearWizardState(env: Env, userId: string): Promise<void> {
  await env.CONFIG.delete(`wizard:${userId}`);
}

// ---- Keyboard builders ----

function providerKeyboard(providers: { id: string; name: string; model: string; type: string }[]): Record<string, unknown> {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (let i = 0; i < providers.length; i += 2) {
    const row: Array<{ text: string; callback_data: string }> = [];
    row.push({ text: `${providers[i].id} (${providers[i].model})`, callback_data: `set_provider:${providers[i].id}` });
    if (providers[i + 1]) {
      row.push({ text: `${providers[i + 1].id} (${providers[i + 1].model})`, callback_data: `set_provider:${providers[i + 1].id}` });
    }
    rows.push(row);
  }
  return { inline_keyboard: rows };
}

async function modelKeyboard(env: Env): Promise<Record<string, unknown>> {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [
    [{ text: "GPT-4o", callback_data: "set_model:gpt-4o" }, { text: "GPT-4o Mini", callback_data: "set_model:gpt-4o-mini" }],
    [{ text: "Claude Sonnet", callback_data: "set_model:claude-sonnet-4-20250514" }, { text: "Claude Haiku", callback_data: "set_model:claude-3-5-haiku-20241022" }],
    [{ text: "Gemini Flash", callback_data: "set_model:gemini-2.0-flash" }, { text: "Gemini Pro", callback_data: "set_model:gemini-2.5-pro-preview-05-06" }],
    [{ text: "Llama 3.3 70B", callback_data: "set_model:llama-3.3-70b-versatile" }, { text: "DeepSeek Chat", callback_data: "set_model:deepseek-chat" }],
    [{ text: "DeepSeek R1", callback_data: "set_model:deepseek-reasoner" }, { text: "Qwen 3 235B", callback_data: "set_model:qwen/qwen3-235b-a22b" }],
  ];

  // Add models from custom endpoints
  const raw = await env.CONFIG.get("custom_providers", "json");
  const customs: CustomProviderConfig[] = (raw as CustomProviderConfig[]) || [];
  const seen = new Set(rows.flat().map((b) => b.callback_data));
  for (const cp of customs) {
    const cbData = `set_model:${cp.default_model}`;
    if (!seen.has(cbData)) {
      seen.add(cbData);
      rows.push([{ text: `${cp.name}: ${cp.default_model}`, callback_data: cbData }]);
    }
  }

  return { inline_keyboard: rows };
}

function endpointTypeKeyboard(): Record<string, unknown> {
  return {
    inline_keyboard: [
      [{ text: "OpenAI-Compatible", callback_data: "endpoint_type:openai" }, { text: "Anthropic", callback_data: "endpoint_type:anthropic" }],
      [{ text: "Cancel", callback_data: "endpoint_cancel" }],
    ],
  };
}

function confirmKeyboard(): Record<string, unknown> {
  return {
    inline_keyboard: [
      [{ text: "Save Endpoint", callback_data: "endpoint_save" }, { text: "Cancel", callback_data: "endpoint_cancel" }],
    ],
  };
}

function cancelKeyboard(): Record<string, unknown> {
  return { inline_keyboard: [[{ text: "Cancel", callback_data: "endpoint_cancel" }]] };
}

// ---- Callback query handler ----

async function handleCallbackQuery(env: Env, cb: TelegramCallbackQuery, ctx: ExecutionContext): Promise<void> {
  const data = cb.data || "";
  const userId = cb.from.id.toString();
  const chatId = cb.message?.chat.id;
  const messageId = cb.message?.message_id;

  if (!chatId) return;

  // ---- Provider selection ----
  if (data.startsWith("set_provider:")) {
    const providerId = data.split(":")[1];
    const sessionId = `telegram:${chatId}`;
    const { getSession, saveSession, createSession } = await import("../memory");
    let session = await getSession(env.SESSIONS, sessionId);
    if (!session) {
      session = createSession(sessionId);
    }
    session.provider = providerId;
    // Auto-set custom provider's default model
    const rawP = await env.CONFIG.get("custom_providers", "json");
    const customsP: CustomProviderConfig[] = (rawP as CustomProviderConfig[]) || [];
    const customP = customsP.find((c) => c.id === providerId);
    if (customP?.default_model) session.model = customP.default_model;
    await saveSession(env.SESSIONS, sessionId, session);
    await answerCallback(env, cb.id, `Provider: ${providerId}`);
    if (messageId) {
      const modelNote = customP?.default_model ? `\nModel: ${customP.default_model}` : "";
      await editText(env, chatId, messageId, `Provider set to *${providerId}*${modelNote}`);
    }
    return;
  }

  // ---- Model selection ----
  if (data.startsWith("set_model:")) {
    const modelId = data.split(":")[1];
    const sessionId = `telegram:${chatId}`;
    const { getSession, saveSession, createSession } = await import("../memory");
    let session = await getSession(env.SESSIONS, sessionId);
    if (!session) {
      session = createSession(sessionId);
    }
    session.model = modelId;
    await saveSession(env.SESSIONS, sessionId, session);
    await answerCallback(env, cb.id, `Model: ${modelId}`);
    if (messageId) {
      await editText(env, chatId, messageId, `Model set to *${modelId}*.`);
    }
    return;
  }

  // ---- Endpoint wizard: type selection ----
  if (data.startsWith("endpoint_type:")) {
    const epType = data.split(":")[1] as "openai" | "anthropic";
    await setWizardState(env, userId, { step: "base_url", type: epType, started_at: Date.now() });
    await answerCallback(env, cb.id);
    const typeName = epType === "anthropic" ? "Anthropic" : "OpenAI-Compatible";
    await sendText(env, chatId, `Adding *${typeName}* endpoint.\n\nSend the base URL.\nExamples:\n- OpenAI: \`https://api.openai.com/v1\`\n- Custom: \`https://api.example.com/v1\`\n- OpenRouter: \`https://openrouter.ai/api/v1\``, cancelKeyboard());
    return;
  }

  // ---- Endpoint wizard: save ----
  if (data === "endpoint_save") {
    const wizard = await getWizardState(env, userId);
    if (!wizard || !wizard.type || !wizard.base_url || !wizard.model || !wizard.api_key) {
      await answerCallback(env, cb.id, "Incomplete data");
      return;
    }

    const id = wizard.base_url.replace(/https?:\/\//, "").replace(/[^a-z0-9]/gi, "-").replace(/-+$/, "").toLowerCase().slice(0, 30);
    const config: CustomProviderConfig = {
      id,
      name: wizard.base_url.replace(/https?:\/\//, "").split("/")[0],
      base_url: wizard.base_url,
      api_key: wizard.api_key,
      default_model: wizard.model,
      type: wizard.type,
    };

    // Save to custom_providers array
    const raw = await env.CONFIG.get("custom_providers", "json");
    const customs: CustomProviderConfig[] = (raw as CustomProviderConfig[]) || [];
    const idx = customs.findIndex((c) => c.id === config.id);
    if (idx >= 0) customs[idx] = config;
    else customs.push(config);
    await env.CONFIG.put("custom_providers", JSON.stringify(customs));

    // Also save individual key
    await env.CONFIG.put(`custom_provider:${config.id}`, JSON.stringify(config));

    await clearWizardState(env, userId);
    await answerCallback(env, cb.id, "Saved!");
    if (messageId) {
      await editText(env, chatId, messageId,
        `Endpoint saved.\n\n` +
        `ID: \`${config.id}\`\n` +
        `Type: ${config.type}\n` +
        `URL: \`${config.base_url}\`\n` +
        `Model: \`${config.default_model}\`\n\n` +
        `Use /provider to switch to it.`
      );
    }
    return;
  }

  // ---- Endpoint wizard: cancel ----
  if (data === "endpoint_cancel") {
    await clearWizardState(env, userId);
    await answerCallback(env, cb.id, "Cancelled");
    if (messageId) {
      await editText(env, chatId, messageId, "Cancelled.");
    }
    return;
  }

  // ---- Delete endpoint ----
  if (data.startsWith("del_endpoint:")) {
    const endpointId = data.split(":")[1];
    const raw = await env.CONFIG.get("custom_providers", "json");
    const customs: CustomProviderConfig[] = (raw as CustomProviderConfig[]) || [];
    const filtered = customs.filter((c) => c.id !== endpointId);
    await env.CONFIG.put("custom_providers", JSON.stringify(filtered));
    await env.CONFIG.delete(`custom_provider:${endpointId}`);
    await answerCallback(env, cb.id, "Deleted");
    if (messageId) {
      await editText(env, chatId, messageId, `Endpoint \`${endpointId}\` deleted.`);
    }
    return;
  }

  await answerCallback(env, cb.id);
}

// ---- Message handler (commands + wizard text input) ----

async function handleMessage(env: Env, msg: TelegramMessage, ctx: ExecutionContext): Promise<void> {
  if (!msg.text) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const text = msg.text;
  const sessionId = `telegram:${chatId}`;

  // ---- Check if user is in endpoint wizard ----
  const wizard = await getWizardState(env, userId);
  if (wizard && wizard.step !== "type" && wizard.step !== "confirm") {
    // Cancel on /cancel
    if (text === "/cancel" || text === "/endpoint") {
      await clearWizardState(env, userId);
      await sendText(env, chatId, "Cancelled.");
      return;
    }

    switch (wizard.step) {
      case "base_url": {
        let url = text.trim();
        if (!url.startsWith("http")) url = `https://${url}`;
        wizard.base_url = url;
        wizard.step = "model";
        await setWizardState(env, userId, wizard);
        await sendText(env, chatId, `Base URL: \`${url}\`\n\nNow send the model ID.\nExamples:\n- \`gpt-4o\`\n- \`claude-sonnet-4-20250514\`\n- \`my-custom-model\``, cancelKeyboard());
        return;
      }
      case "model": {
        wizard.model = text.trim();
        wizard.step = "api_key";
        await setWizardState(env, userId, wizard);
        await sendText(env, chatId, `Model: \`${wizard.model}\`\n\nNow send the API key.`, cancelKeyboard());
        return;
      }
      case "api_key": {
        wizard.api_key = text.trim();
        wizard.step = "confirm";
        await setWizardState(env, userId, wizard);
        await sendText(env, chatId,
          `Confirm endpoint:\n\n` +
          `Type: ${wizard.type === "anthropic" ? "Anthropic" : "OpenAI-Compatible"}\n` +
          `URL: \`${wizard.base_url}\`\n` +
          `Model: \`${wizard.model}\`\n` +
          `Key: \`${wizard.api_key!.slice(0, 8)}...${wizard.api_key!.slice(-4)}\``,
          confirmKeyboard()
        );
        return;
      }
    }
    return;
  }

  // ---- Parse and handle commands ----
  const cmd = parseCommand(text);
  if (cmd) {
    switch (cmd.command) {
      case "start":
        await sendText(env, chatId,
          "Welcome to AuxloNeo. Your edge-native AI assistant.\n\n" +
          "Send any message and I'll respond. Use /help to see commands."
        );
        return;

      case "reset":
        await env.SESSIONS.delete(`session:${sessionId}`);
        await sendText(env, chatId, "Session cleared.");
        return;

      case "model":
        if (cmd.args) {
          const { getSession, saveSession, createSession } = await import("../memory");
          let session = await getSession(env.SESSIONS, sessionId);
          if (!session) session = createSession(sessionId);
          session.model = cmd.args;
          await saveSession(env.SESSIONS, sessionId, session);
          await sendText(env, chatId, `Model set to: ${cmd.args}`);
        } else {
          const kb = await modelKeyboard(env);
          await sendText(env, chatId, "Choose a model:", kb);
        }
        return;

      case "provider":
        if (cmd.args) {
          const { getSession, saveSession, createSession } = await import("../memory");
          let session = await getSession(env.SESSIONS, sessionId);
          if (!session) session = createSession(sessionId);
          session.provider = cmd.args;
          // Auto-set custom provider's default model
          const rawC = await env.CONFIG.get("custom_providers", "json");
          const customsC: CustomProviderConfig[] = (rawC as CustomProviderConfig[]) || [];
          const customC = customsC.find((c) => c.id === cmd.args);
          if (customC?.default_model) session.model = customC.default_model;
          await saveSession(env.SESSIONS, sessionId, session);
          await sendText(env, chatId, `Provider set to: ${cmd.args}`);
        } else {
          const providers = await listProviders(env);
          await sendText(env, chatId, "Choose a provider:", providerKeyboard(providers));
        }
        return;

      case "endpoint":
        await setWizardState(env, userId, { step: "type", started_at: Date.now() });
        await sendText(env, chatId, "Add a custom API endpoint.\n\nChoose the endpoint type:", endpointTypeKeyboard());
        return;

      case "endpoints": {
        const raw = await env.CONFIG.get("custom_providers", "json");
        const customs: CustomProviderConfig[] = (raw as CustomProviderConfig[]) || [];
        if (customs.length === 0) {
          await sendText(env, chatId, "No custom endpoints saved. Use /endpoint to add one.");
          return;
        }
        const lines = customs.map((c) => `- \`${c.id}\` | ${c.type} | ${c.base_url} | ${c.default_model}`);
        const rows = customs.map((c) => [{ text: `Delete ${c.id}`, callback_data: `del_endpoint:${c.id}` }]);
        await sendText(env, chatId, "Saved endpoints:\n\n" + lines.join("\n"), { inline_keyboard: rows });
        return;
      }

      case "persona":
        if (cmd.args) {
          await env.CONFIG.put(`persona:${sessionId}`, cmd.args);
          await sendText(env, chatId, "Persona updated.");
        } else {
          const current = (await env.CONFIG.get(`persona:${sessionId}`)) || env.DEFAULT_SYSTEM_PROMPT || "default";
          await sendText(env, chatId, `Current persona: ${current}\n\nUsage: /persona <prompt>`);
        }
        return;

      case "status": {
        const { getSession } = await import("../memory");
        const session = await getSession(env.SESSIONS, sessionId);
        const msgCount = session?.messages?.length || 0;
        const provider = session?.provider || env.DEFAULT_PROVIDER || "openai";
        const model = session?.model || env.DEFAULT_MODEL || "(provider default)";
        const persona = (await env.CONFIG.get(`persona:${sessionId}`)) || env.DEFAULT_SYSTEM_PROMPT || "default";
        await sendText(env, chatId,
          `*AuxloNeo Status*\n` +
          `Provider: \`${provider}\`\n` +
          `Model: \`${model}\`\n` +
          `Messages: ${msgCount}\n` +
          `Persona: ${persona.slice(0, 80)}${persona.length > 80 ? "..." : ""}`
        );
        return;
      }

      case "commands":
      case "help":
        const helpLines = BOT_COMMANDS.map((c) => `/${c.command} - ${c.description}`);
        await sendText(env, chatId, "*AuxloNeo Commands*\n" + helpLines.join("\n"));
        return;

      case "cancel":
        await clearWizardState(env, userId);
        await sendText(env, chatId, "Cancelled.");
        return;
    }
  }

  // ---- Not a command -- send to agent ----
  const agentReq: AgentRequest = {
    message: text,
    session_id: sessionId,
  };

  ctx.waitUntil(
    agentChat(env, agentReq)
      .then((res) => sendText(env, chatId, res.content))
      .catch((err) => sendText(env, chatId, `Error: ${err.message}`))
  );
}

// ---- Webhook entry point ----

export async function handleTelegramWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const update: TelegramUpdate = await request.json();

  if (update.callback_query) {
    ctx.waitUntil(handleCallbackQuery(env, update.callback_query, ctx));
    return new Response("OK");
  }

  if (update.message) {
    ctx.waitUntil(handleMessage(env, update.message, ctx));
    return new Response("OK");
  }

  return new Response("OK");
}

// ---- Register slash commands ----

export async function registerTelegramCommands(env: Env): Promise<string> {
  const result = await tgApi(env, "setMyCommands", { commands: BOT_COMMANDS });
  return JSON.stringify(result);
}

// ---- Set webhook ----

export async function setTelegramWebhook(env: Env, origin: string): Promise<string> {
  const body: Record<string, unknown> = {
    url: `${origin}/telegram`,
    allowed_updates: ["message", "callback_query"],
  };
  if (env.TELEGRAM_WEBHOOK_SECRET) {
    body.secret_token = env.TELEGRAM_WEBHOOK_SECRET;
  }
  const result = await tgApi(env, "setWebhook", body);
  return JSON.stringify(result);
}
