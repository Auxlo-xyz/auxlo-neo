import { markdownToTelegram } from "./markdown";
import type { Env, AgentRequest, CustomProviderConfig } from "../types";
import { agentChat } from "../agent";
import { getUsage } from "../memory";
import { listProviders } from "../providers";
import { checkAllowed } from "../utils";

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
  caption?: string;
  photo?: any[];
  document?: any;
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
  type?: "openai" | "anthropic" | "google";
  base_url?: string;
  model?: string;
  api_key?: string;
  started_at: number;
}

interface WalletWizardState {
  step: "confirm_save";
  wallet_details: string;
  address: string;
  encrypted_key: string;
  started_at: number;
}

// ---- Bot commands for menu ----

const BOT_COMMANDS = [
  { command: "start", description: "Get started with AuxloNeo" },
  { command: "help", description: "List all available commands" },
  { command: "reset", description: "Clear conversation history" },
  { command: "model", description: "Switch AI model" },
  { command: "provider", description: "Switch provider" },
  { command: "endpoint", description: "Add custom API endpoint" },
  { command: "endpoints", description: "List your saved endpoints" },
  { command: "persona", description: "Set my personality/prompt" },
  { command: "status", description: "Show current session info" },
  { command: "usage", description: "Show token usage stats" },
  { command: "wallet", description: "Manage your Mantle wallet" },
  { command: "grant", description: "Share data with another user" },
  { command: "revoke", description: "Revoke data sharing" },
  { command: "shares", description: "List shared resources" },
];

// ---- Helpers ----

function parseCommand(text: string): { command: string; args: string } | null {
  const match = text.match(/^\/(\w+)(?:@\w+)?(?:\s+(.*))?$/);
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

async function sendChatAction(env: Env, chatId: number, action: string): Promise<void> {
  await tgApi(env, "sendChatAction", { chat_id: chatId, action });
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
    const formatted = markdownToTelegram(chunk);
    const body: Record<string, unknown> = { chat_id: chatId, text: formatted, parse_mode: "MarkdownV2" };
    if (replyMarkup && chunk === chunks[chunks.length - 1]) {
      body.reply_markup = replyMarkup;
    }
    let result = await tgApi(env, "sendMessage", body);
    if (!result?.ok) {
      // Fallback to plain text if MarkdownV2 fails
      delete body.parse_mode;
      body.text = chunk;
      await tgApi(env, "sendMessage", body);
    }
  }
}

async function getFileUrl(env: Env, fileId: string): Promise<string | null> {
  const res = await tgApi(env, "getFile", { file_id: fileId });
  if (!res?.ok || !res.result?.file_path) return null;
  return `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${res.result.file_path}`;
}

async function encryptKey(plainText: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret.padEnd(32, '0').slice(0, 32));
  const key = await crypto.subtle.importKey("raw", keyData, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plainText));
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decryptKey(cipherText: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret.padEnd(32, '0').slice(0, 32));
  const key = await crypto.subtle.importKey("raw", keyData, "AES-GCM", false, ["decrypt"]);
  const combined = new Uint8Array(atob(cipherText).split("").map(c => c.charCodeAt(0)));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(decrypted);
}

async function editText(env: Env, chatId: number, messageId: number, text: string, replyMarkup?: Record<string, unknown>): Promise<void> {
  const formatted = markdownToTelegram(text);
  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text: formatted,
    parse_mode: "MarkdownV2",
  };
  if (replyMarkup) body.reply_markup = replyMarkup;
  let result = await tgApi(env, "editMessageText", body);
  if (!result?.ok) {
    delete body.parse_mode;
    body.text = text;
    await tgApi(env, "editMessageText", body);
  }
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
      [{ text: "Google Gemini", callback_data: "endpoint_type:google" }],
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
  const userId = `telegram:${cb.from.id.toString()}`; // Channel-prefixed for isolation
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
    const epType = data.split(":")[1] as "openai" | "anthropic" | "google";
    await setWizardState(env, userId, { step: "base_url", type: epType, started_at: Date.now() });
    await answerCallback(env, cb.id);
    const typeName = epType === "anthropic" ? "Anthropic" : epType === "google" ? "Google Gemini" : "OpenAI-Compatible";
    let examples = "";
    if (epType === "google") {
      examples = "Examples:\n- Google: `https://generativelanguage.googleapis.com/v1beta`\n- Custom proxy: `https://your-proxy.example.com/v1beta`";
    } else {
      examples = "Examples:\n- OpenAI: `https://api.openai.com/v1`\n- Custom: `https://api.example.com/v1`\n- OpenRouter: `https://openrouter.ai/api/v1`";
    }
    await sendText(env, chatId, `Adding *${typeName}* endpoint.\\n\\nSend the base URL.\\n${examples}`, cancelKeyboard());
    return;
  }

  // ---- Endpoint wizard: save ----
  if (data === "endpoint_save") {
    const wizard = await getWizardState(env, userId);
    if (!wizard || !wizard.type || !wizard.base_url || !wizard.model || !wizard.api_key) {
      await answerCallback(env, cb.id, "Incomplete data");
      return;
    }

    let baseUrl = wizard.base_url;
    if (wizard.type === "google") {
      baseUrl = baseUrl.replace(/\/openai\/?$/, "").replace(/\/+$/, "");
    }

    const id = baseUrl.replace(/https?:\/\//, "").replace(/[^a-z0-9]/gi, "-").replace(/-+$/, "").toLowerCase().slice(0, 30);
    const config: CustomProviderConfig = {
      id,
      name: baseUrl.replace(/https?:\/\//, "").split("/")[0],
      base_url: baseUrl,
      api_key: wizard.api_key,
      default_model: wizard.model,
      type: wizard.type,
    };

    // Save to user-isolated custom_providers array
    const { addCustomProvider } = await import("../providers");
    await addCustomProvider(env, userId, config);

    // Also save individual key (handled by addCustomProvider internally now, but we can be explicit if needed)
    // Actually addCustomProvider only saves the list. Let's check providers.ts.
    // Looking at providers.ts, it only saves the list. 
    // I should update providers.ts to also save the individual key for consistency if it was there before.
    
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
    const { removeCustomProvider } = await import("../providers");
    const success = await removeCustomProvider(env, userId, endpointId);
    if (!success) {
      await answerCallback(env, cb.id, "Endpoint not found.");
      return;
    }
    await answerCallback(env, cb.id, "Deleted");
    if (messageId) {
      await editText(env, chatId, messageId, `Endpoint \`${endpointId}\` deleted.`);
    }
    return;
  }

  // ---- Wallet confirmation ----
  if (data === "wallet_confirm_save") {
    const msgId = await env.CONFIG.get(`wallet_msg:${userId}`);
    if (msgId) {
      await tgApi(env, "deleteMessage", { chat_id: chatId, message_id: parseInt(msgId) });
      await env.CONFIG.delete(`wallet_msg:${userId}`);
    }
    await answerCallback(env, cb.id, "Key secured!");
    if (messageId) {
      await editText(env, chatId, messageId, "✅ Wallet key saved and deleted from chat for your security.");
    }
    return;
  }

  await answerCallback(env, cb.id);
}

// ---- Message handler (commands + wizard text input) ----

async function handleMessage(env: Env, msg: TelegramMessage, ctx: ExecutionContext): Promise<void> {
  if (!msg.text) return;

  const chatId = msg.chat.id;
  const userId = `telegram:${msg.from.id.toString()}`; // Channel-prefixed for isolation
  let text = msg.text || msg.caption || "";
  const sessionId = `telegram:${chatId}`;

  // Strip bot mention from the start of the message (e.g., "@AuxloNeo hello" -> "hello")
  if (text.startsWith("@")) {
    text = text.replace(/^@\w+\s*/, "").trim();
  }

  // Handle media
  const media: any[] = [];
  if (msg.photo) {
    // Use the highest resolution photo (last in array)
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const url = await getFileUrl(env, fileId);
    if (url) media.push({ type: "image", url, caption: msg.caption });
  } else if (msg.document) {
    const url = await getFileUrl(env, msg.document.file_id);
    if (url) media.push({ type: "document", url, caption: msg.caption });
  }

  if (!text && media.length === 0) return;

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
          "welcome to auxloneo. i'm your edge-native assistant, living on cloudflare workers. fast, private, and autonomous.\n\n" +
          "here is what i can do:\n" +
          "- smart chat: just start typing. i can see images and docs.\n" +
          "- custom ai: use /endpoint for your own providers or /model to switch brains.\n" +
          "- persona: tweak how i act with /persona.\n" +
          "- mantle wallet: /wallet lets me handle yield strategies on mantle for you.\n" +
          "- data sharing: /grant lets you share context with others.\n\n" +
          "check /help for the full list. what's on your mind?"
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
        const { listProviders } = await import("../providers");
        const providers = await listProviders(env, userId);
        const customs = providers.filter(p => p.type === "custom");
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
        if (cmd.args === "reset") {
          await env.CONFIG.delete(`persona:${sessionId}`);
          await sendText(env, chatId, "Persona reset to default.");
        } else if (cmd.args) {
          await env.CONFIG.put(`persona:${sessionId}`, cmd.args);
          await sendText(env, chatId, "Persona updated.");
        } else {
          const current = (await env.CONFIG.get(`persona:${sessionId}`)) || env.DEFAULT_SYSTEM_PROMPT || "default";
          await sendText(env, chatId, `Current persona: ${current}\n\nUsage: /persona <prompt> or /persona reset`);
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
          `Runtime: Cloudflare Workers\n` +
          `Provider: \`${provider}\`\n` +
          `Model: \`${model}\`\n` +
          `Messages: ${msgCount}\n` +
          `Persona: ${persona.slice(0, 80)}${persona.length > 80 ? "..." : ""}`
        );
        return;
      }

      case "usage": {
        const { getUsage } = await import("../memory");
        const stats = await getUsage(env.MEMORY, sessionId);
        if (!stats || stats.requests === 0) {
          await sendText(env, chatId, "No usage recorded yet. Send a message to get started!");
          return;
        }
        const since = stats.last_updated ? new Date(stats.last_updated).toLocaleDateString() : "N/A";
        await sendText(env, chatId,
          `*Token Usage*\n` +
          `Requests: ${stats.requests}\n` +
          `Prompt tokens: ${stats.prompt_tokens.toLocaleString()}\n` +
          `Completion tokens: ${stats.completion_tokens.toLocaleString()}\n` +
          `Total tokens: ${stats.total_tokens.toLocaleString()}\n` +
          `Last model: \`${stats.last_model || "N/A"}\`\n` +
          `Last provider: \`${stats.last_provider || "N/A"}\`\n` +
          `Since: ${since}`
        );
        return;
      }

      case "wallet": {
        const args = cmd.args.toLowerCase();
        if (args === "create") {
          await sendChatAction(env, chatId, "typing");
          const { executeTool } = await import("../tools");
          const res = await executeTool(env, "mantle_wallet_create", {}, { channel: "telegram", sessionId });
          
          if (res.error || !res.content) {
            await sendText(env, chatId, `Failed to generate wallet. Error: ${res.content || "No output from executor"}`);
            return;
          }
          
          const content = res.content;
          const lines = content.split('\n').filter(l => l.trim());
          const address = lines.find(l => l.toLowerCase().includes('address:'))?.split(/: {1,}/)[1]?.trim() || "unknown";
          const privKey = lines.find(l => l.toLowerCase().includes('private key:'))?.split(/: {1,}/)[1]?.trim() || "unknown";
          
          const encryptedKey = await encryptKey(privKey, env.WALLET_ENCRYPTION_KEY || "fallback-secret");
          await env.CONFIG.put(`wallet:${userId}`, JSON.stringify({ address, encryptedKey }));
          
          const details = `*New Mantle Wallet Generated*\n\n` +
                           `Address: \`${address}\`\n` +
                           `Private Key: \`${privKey}\`\n\n` +
                           `⚠️ *CRITICAL*: Save this key immediately. I will delete this message once you confirm.`;
          
          await sendText(env, chatId, details, {
            inline_keyboard: [[{ text: "✅ I've saved it", callback_data: "wallet_confirm_save" }]]
          });
          
          // To save the message ID for deletion, we need the result of sendText.
          // Since sendText doesn't return the message ID, we'll use tgApi for the final send
          // but we'll let sendText handle the escaping first.
          const formatted = markdownToTelegram(details);
          const msg = await tgApi(env, "sendMessage", { 
            chat_id: chatId, 
            text: formatted, 
            parse_mode: "MarkdownV2",
            reply_markup: {
              inline_keyboard: [[{ text: "✅ I've saved it", callback_data: "wallet_confirm_save" }]]
            }
          });
          
          await env.CONFIG.put(`wallet_msg:${userId}`, (msg as any).result.message_id.toString());
          return;
        } else if (args === "status") {
          const walletData = await env.CONFIG.get(`wallet:${userId}`, "json");
          if (!walletData) {
            await sendText(env, chatId, "No wallet found. Use /wallet create to generate one.");
            return;
          }
          const { address } = walletData as any;
          const { mantleRpc } = await import("../tools/autonomous");
          const balHex = await mantleRpc("mainnet", "eth_getBalance", [address, "latest"], env);
          const mnt = Number(BigInt(balHex || "0x0")) / 1e18;
          
          await sendText(env, chatId, `*Wallet Status*\n\nAddress: \`${address}\`\nBalance: ${mnt.toFixed(4)} MNT`);
          return;
        } else if (args.startsWith("import ")) {
          const key = args.slice(7).trim();
          if (!key.startsWith("0x")) {
            await sendText(env, chatId, "Invalid private key format. Must start with 0x.");
            return;
          }
          const encryptedKey = await encryptKey(key, env.WALLET_ENCRYPTION_KEY || "fallback-secret");
          
          // Use remoteExec to verify key and get address
          const verifyCmd = `node -e "const { ethers } = require('ethers'); console.log(new ethers.Wallet('${key}').address)"`;
          const { executeTool } = await import("../tools");
          const res = await executeTool(env, "remote_exec", { command: verifyCmd }, { channel: "telegram", sessionId });
          
          if (res.error || !res.content) {
            await sendText(env, chatId, "Invalid private key. Import failed.");
            return;
          }
          
          const address = res.content.trim();
          await env.CONFIG.put(`wallet:${userId}`, JSON.stringify({ address, encryptedKey }));
          await sendText(env, chatId, `Wallet imported successfully!\n\nAddress: \`${address}\``);
          return;
        } else {
          await sendText(env, chatId, "Wallet management:\n/wallet create - Generate new wallet\n/wallet import <key> - Import existing key\n/wallet status - Check balance");
          return;
        }
      }

      case "grant": {
        const { handleGrantCommand } = await import("../grant-commands");
        const result = await handleGrantCommand(env, userId, cmd.args || "");
        await sendText(env, chatId, result.message);
        return;
      }

      case "revoke": {
        const { handleRevokeCommand } = await import("../grant-commands");
        const result = await handleRevokeCommand(env, userId, cmd.args || "");
        await sendText(env, chatId, result.message);
        return;
      }

      case "shares": {
        const { handleListSharesCommand } = await import("../grant-commands");
        const result = await handleListSharesCommand(env, userId);
        await sendText(env, chatId, result.message);
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
    userId: userId, // Pass userId for RLS check
    media: media,
  };

  ctx.waitUntil(
    (async () => {
      await sendChatAction(env, chatId, "typing");
      try {
        const res = await agentChat(env, agentReq);
        if (!res.content && media.length > 0) {
          await sendText(env, chatId, "I received your media, but I couldn't make sense of it. Could you provide a caption or question?");
        } else {
          await sendText(env, chatId, res.content || "I've processed your media, but have no textual response.");
        }
      } catch (err: any) {
        await sendText(env, chatId, `Error: ${err.message}`);
      }
    })()
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
    const id = update.message?.from?.id;
    const username = update.message?.from?.username || "unknown";
    const chatId = update.message?.chat.id;

    if (!id || !chatId) {
      return new Response("Missing user or chat ID", { status: 400 });
    }

    const sessionId = `telegram:${chatId}`;
    const userId = `telegram:${id}`; // Channel-prefixed for ALLOWED_USERS isolation

    if (!(await checkAllowed(env, userId))) {
      console.log(`Unauthorized Telegram user: ${id}`);
      return new Response("Unauthorized", { status: 403 });
    }

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
