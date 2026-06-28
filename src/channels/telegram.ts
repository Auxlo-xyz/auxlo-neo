import { markdownToTelegram, formatForTelegram } from "./markdown";
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

interface WalletWizardState {
  step: "confirm_save";
  wallet_details: string;
  address: string;
  encrypted_key: string;
  started_at: number;
}

interface GuardWizardState {
  step: "limit" | "slippage";
  started_at: number;
}

// ---- Bot commands for menu ----

const BOT_COMMANDS = [
  { command: "start", description: "Get started with AuxloNeo" },
  { command: "help", description: "List all available commands" },
  { command: "reset", description: "Clear conversation history" },
  { command: "persona", description: "Set my personality/prompt" },
  { command: "status", description: "Show current session info" },
  { command: "usage", description: "Show token usage stats" },
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
  const data = await resp.json() as any;
  if (!data?.ok) {
    console.error(`tgApi error on ${method}:`, data, "Body:", JSON.stringify(body).slice(0, 500));
  }
  return data;
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
      body.text = formatForTelegram(chunk);
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
    body.text = formatForTelegram(text);
    await tgApi(env, "editMessageText", body);
  }
}

async function answerCallback(env: Env, callbackId: string, text?: string): Promise<void> {
  const body: Record<string, unknown> = { callback_query_id: callbackId };
  if (text) body.text = text;
  await tgApi(env, "answerCallbackQuery", body);
}

// ---- Guard wizard helpers ----

interface GuardWizardState {
  step: "limit" | "slippage";
  started_at: number;
}

async function getGuardWizardState(env: Env, userId: string): Promise<GuardWizardState | null> {
  const raw = await env.CONFIG.get(`guard_wizard:${userId}`, "json");
  return raw as GuardWizardState | null;
}

async function setGuardWizardState(env: Env, userId: string, state: GuardWizardState): Promise<void> {
  await env.CONFIG.put(`guard_wizard:${userId}`, JSON.stringify(state), { expirationTtl: 600 });
}

async function clearGuardWizardState(env: Env, userId: string): Promise<void> {
  await env.CONFIG.delete(`guard_wizard:${userId}`);
}

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

function cancelKeyboard(callbackData: string = "endpoint_cancel"): Record<string, unknown> {
  return { inline_keyboard: [[{ text: "Cancel", callback_data: callbackData }]] };
}

function guardKeyboard(): Record<string, unknown> {
  return {
    inline_keyboard: [
      [{ text: "Set Max USD Limit", callback_data: "guard_set_limit" }, { text: "Set Slippage %", callback_data: "guard_set_slippage" }],
      [{ text: "View Current Limits", callback_data: "guard_status" }],
      [{ text: "Cancel", callback_data: "guard_cancel" }],
    ],
  };
}

function walletKeyboard(): Record<string, unknown> {
  return {
    inline_keyboard: [
      [{ text: "🆕 Create Wallet", callback_data: "wallet_create" }, { text: "💰 Check Balance", callback_data: "wallet_status" }],
      [{ text: "🔑 Import Wallet", callback_data: "wallet_import" }],
    ],
  };
}

function grantPermissionKeyboard(): Record<string, unknown> {
  return {
    inline_keyboard: [
      [{ text: "Read", callback_data: "grant_perm:read" }, { text: "Write", callback_data: "grant_perm:write" }],
      [{ text: "Admin", callback_data: "grant_perm:admin" }],
      [{ text: "Cancel", callback_data: "grant_cancel" }],
    ],
  };
}

function grantConfirmKeyboard(): Record<string, unknown> {
  return {
    inline_keyboard: [
      [{ text: "✅ Generate Invite Link", callback_data: "grant_confirm" }, { text: "❌ Cancel", callback_data: "grant_cancel" }],
    ],
  };
}

// ---- Callback query handler ----

async function handleCallbackQuery(env: Env, cb: TelegramCallbackQuery, ctx: ExecutionContext): Promise<void> {
  const data = cb.data || "";
  const userId = `telegram:${cb.from.id.toString()}`; // Channel-prefixed for isolation
  const chatId = cb.message?.chat.id || 0;
  const messageId = cb.message?.message_id;

  if (data.startsWith("wallet_") || data.startsWith("guard_")) {
    await answerCallback(env, cb.id, "Mantle features are no longer available");
    if (messageId) {
      await editText(env, chatId, messageId, "On-chain features and Mantle integrations have been removed.");
    }
    return;
  }

  // ---- Provider selection ----
  if (data.startsWith("set_provider:")) {
    const providerId = data.split(":")[1];
    const sessionId = `telegram:${chatId}`;
    const { getSession, saveSession, createSession } = await import("../memory");
    let session = await getSession(env.DB, sessionId);
    if (!session) {
      session = createSession(sessionId);
    }
    session.provider = providerId;
    // Auto-set custom provider's default model
    const rawP = await env.CONFIG.get("custom_providers", "json");
    const customsP: CustomProviderConfig[] = (rawP as CustomProviderConfig[]) || [];
    const customP = customsP.find((c) => c.id === providerId);
    if (customP?.default_model) session.model = customP.default_model;
    await saveSession(env.DB, sessionId, session);
    await answerCallback(env, cb.id, `Provider: ${providerId}`);
    if (messageId) {
      const modelNote = customP?.default_model ? `\nModel: ${customP.default_model}` : "";
      await editText(env, chatId, messageId, `Provider set to *${providerId}*${modelNote}`);
    }
    return;
  }

  // ---- Endpoint wizard: save ----
  if (data === "endpoint_save") {
    await answerCallback(env, cb.id, "Incomplete data");
    return;
  }

  // ---- Endpoint wizard: cancel ----
  if (data === "endpoint_cancel") {
    await answerCallback(env, cb.id, "Cancelled");
    if (messageId) {
      await editText(env, chatId, messageId, "Cancelled.");
    }
    return;
  }

  if (data === "wallet_import_cancel") {
    await env.CONFIG.delete(`wallet_import_wizard:${userId}`);
    await answerCallback(env, cb.id, "Cancelled");
    if (messageId) {
      await editText(env, chatId, messageId, "Import cancelled.");
    }
    return;
  }

  // ---- Guard Wizard callbacks ----
  if (data === "guard_cancel") {
    await clearGuardWizardState(env, userId);
    await answerCallback(env, cb.id, "Cancelled");
    if (messageId) {
      await editText(env, chatId, messageId, "Cancelled.");
    }
    return;
  }

  if (data === "guard_status") {
    const limits = (await env.CONFIG.get(`limits:${userId}`, "json")) as any || {
      max_trade_value_usd: 500,
      max_slippage_pct: 0.5,
      allowed_protocols: ["merchant-moe", "agni-finance"]
    };
    await answerCallback(env, cb.id, "Showing limits");
    if (messageId) {
      await editText(env, chatId, messageId, 
        `*Your Current Risk Guard*\n\n` +
        `Max Trade: \`${limits.max_trade_value_usd} USD\`\n` +
        `Max Slippage: \`${limits.max_slippage_pct}%\`\n` +
        `Protocols: \`${limits.allowed_protocols.join(", ")}\``, 
        guardKeyboard()
      );
    }
    return;
  }

  if (data === "guard_set_limit") {
    await setGuardWizardState(env, userId, { step: "limit", started_at: Date.now() });
    await answerCallback(env, cb.id, "Enter Limit");
    if (messageId) {
      await editText(env, chatId, messageId, "Please send the *Max Trade Value in USD* (e.g. 1000).", cancelKeyboard());
    }
    return;
  }

  if (data === "guard_set_slippage") {
    await setGuardWizardState(env, userId, { step: "slippage", started_at: Date.now() });
    await answerCallback(env, cb.id, "Enter Slippage");
    if (messageId) {
      await editText(env, chatId, messageId, "Please send the *Max Slippage Percentage* (e.g. 0.5 for 0.5%).", cancelKeyboard());
    }
    return;
  }

  if (data === "wallet_create") {
    await sendText(env, chatId, "Wallet generation is no longer available.");
    return;
  }

  if (data === "wallet_status") {
    const userId = `telegram:${cb.from.id.toString()}`;
    await answerCallback(env, cb.id, "Checking balance...");
    const walletData = await env.CONFIG.get(`wallet:${userId}`, "json");
    if (!walletData) {
      await sendText(env, chatId, "No wallet found. Use the 'Create' or 'Import' buttons above.");
      return;
    }
    const { address } = walletData as any;
    await sendText(env, chatId, `*Wallet Status*\n\nAddress: \`${address}\`\nBalance: 0.0000 MNT (Mantle integrations have been removed)`);
    return;
  }

  if (data === "wallet_import") {
    const userId = `telegram:${cb.from.id.toString()}`;
    await answerCallback(env, cb.id, "Import mode active");
    await env.CONFIG.put(`wallet_import_wizard:${userId}`, "true", { expirationTtl: 600 });
    await sendText(env, chatId, "Please send your Mantle private key (must start with `0x`).", cancelKeyboard("wallet_import_cancel"));
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

// ---- Progress tracker for agent streaming and tool tracking ----

interface ToolTrack {
  name: string;
  friendlyName: string;
  status: "running" | "completed";
}

function getFriendlyToolName(toolName: string): string {
  const mapper: Record<string, string> = {
    x_fetch: "Reading page",
    web_fetch: "Reading page",
    web_search: "Searching",
    write_file: "Writing file",
    read_file: "Reading file",
    list_files: "Listing files",
    send_message: "Sending notification",
    current_time: "Checking time",
    set_cron: "Scheduling task",
    list_crons: "Checking schedules",
    remember: "Saving memory",
    recall: "Recalling memory",
  };
  return mapper[toolName] || toolName.replace(/_/g, " ");
}

export interface TelegramProgressTrackerState {
  chatId: number;
  messageId: number | null;
  startTime: number;
  toolsTrack: ToolTrack[];
  lastStatusLine: string;
}

export class TelegramProgressTracker {
  private env: Env;
  private chatId: number;
  private messageId: number | null = null;
  private startTime: number;
  private toolsTrack: ToolTrack[] = [];
  private isComplete: boolean = false;
  private lastEditedText: string = "";
  private lastEditTime: number = 0;
  private timerActive: boolean = true;
  private lastStatusLine: string = "";

  constructor(env: Env, chatId: number) {
    this.env = env;
    this.chatId = chatId;
    this.startTime = Date.now();
  }

  getState(): TelegramProgressTrackerState {
    return {
      chatId: this.chatId,
      messageId: this.messageId,
      startTime: this.startTime,
      toolsTrack: this.toolsTrack,
      lastStatusLine: this.lastStatusLine,
    };
  }

  static fromState(env: Env, state: TelegramProgressTrackerState): TelegramProgressTracker {
    const tracker = new TelegramProgressTracker(env, state.chatId);
    tracker.messageId = state.messageId;
    tracker.startTime = state.startTime;
    tracker.toolsTrack = state.toolsTrack;
    tracker.lastStatusLine = state.lastStatusLine;
    return tracker;
  }

  async init() {
    const res = await tgApi(this.env, "sendMessage", {
      chat_id: this.chatId,
      text: "<blockquote>Thinking...\n0s</blockquote>",
      parse_mode: "HTML",
    });
    if (res?.ok && res.result?.message_id) {
      this.messageId = res.result.message_id;
    }
  }

  async tick() {
    if (this.isComplete || !this.timerActive) return;
    await this.flush(false);
  }

  async logEvent(event: {
    type: "model_start" | "tool_start" | "tool_end" | "complete";
    round?: number;
    model?: string;
    toolName?: string;
    arguments?: string;
    result?: string;
    content?: string;
  }) {
    if (event.type === "model_start" && event.content) {
      // Intermediate response found
      this.lastStatusLine = event.content.length > 50 ? event.content.slice(0, 50) + "..." : event.content;
    } else if (event.type === "tool_start") {
      const toolName = event.toolName || "unknown_tool";
      const friendlyName = getFriendlyToolName(toolName);
      this.toolsTrack.push({
        name: toolName,
        friendlyName,
        status: "running",
      });
      this.lastStatusLine = ""; // Reset intermediate line when tool starts
    } else if (event.type === "tool_end") {
      const toolName = event.toolName || "unknown_tool";
      const track = this.toolsTrack.find(t => t.name === toolName && t.status === "running");
      if (track) {
        track.status = "completed";
      }
    } else if (event.type === "complete") {
      this.isComplete = true;
      this.timerActive = false;
      await this.flush(true, event.content);
    }
    if (!this.isComplete) {
      await this.flush(false);
    }
  }

  private async flush(forceFinal: boolean = false, finalContent?: string) {
    if (!this.messageId) return;

    if (forceFinal) {
      this.isComplete = true;
      this.timerActive = false;
      const content = finalContent || "Done!";
      if (content.length <= 4000) {
        try {
          await editText(this.env, this.chatId, this.messageId, content);
        } catch {
          await tgApi(this.env, "editMessageText", {
            chat_id: this.chatId,
            message_id: this.messageId,
            text: formatForTelegram(content),
          });
        }
      } else {
        const firstChunk = content.slice(0, 4000);
        try {
          await editText(this.env, this.chatId, this.messageId, firstChunk);
        } catch {
          await tgApi(this.env, "editMessageText", {
            chat_id: this.chatId,
            message_id: this.messageId,
            text: formatForTelegram(firstChunk),
          });
        }
        await sendText(this.env, this.chatId, content.slice(4000));
      }
      return;
    }

    if (this.isComplete) return;

    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
    let toolsSection = "";
    if (this.toolsTrack.length > 0) {
      toolsSection = " • " + this.toolsTrack.map(t => {
        if (t.status === "completed") {
          return `${t.friendlyName} ✓`;
        } else {
          return `${t.friendlyName}...`;
        }
      }).join(" • ");
    }
    
    const intermediateLine = this.lastStatusLine ? `\n<i>${this.lastStatusLine}</i>` : "";
    const statusLine = `${elapsed}s${toolsSection}${intermediateLine}`;
    const messageText = `<blockquote>Thinking...\n${statusLine}</blockquote>`;

    const now = Date.now();
    if (now - this.lastEditTime < 1500) {
      return;
    }

    if (messageText === this.lastEditedText) {
      return;
    }

    this.lastEditedText = messageText;
    this.lastEditTime = now;

    try {
      await tgApi(this.env, "editMessageText", {
        chat_id: this.chatId,
        message_id: this.messageId,
        text: messageText,
        parse_mode: "HTML",
      });
    } catch (err) {
      console.error("Failed to edit message:", err);
    }
  }

  stop() {
    this.timerActive = false;
    this.isComplete = true;
  }
}

// ---- Message handler (commands + wizard text input) ----

async function handleMessage(env: Env, msg: TelegramMessage, ctx: ExecutionContext, requestUrl: string): Promise<void> {
  if (!msg.text) return;

  const chatId = msg.chat.id;
  const userId = `telegram:${msg.from.id.toString()}`; // Channel-prefixed for isolation
  let text = msg.text || msg.caption || "";
  const sessionId = `telegram:${chatId}`;

  // Handle /start command specifically for the welcome message and grant links
  if (text.startsWith("/start")) {
    const args = text.split(" ")[1];
    if (args && args.startsWith("grant_")) {
      // Grant links are no longer supported
      await sendText(env, chatId, "This invite link is no longer valid. Data sharing has been disabled for security reasons.");
      return;
    }

    const welcomeMsg = "welcome to auxloneo. i'm your edge-native agent created by auxlo xyz (auxlo.xyz).\n\n" +
      "here is what i can do:\n\n" +
      "- *smart chat*: just start typing. i can see images and docs.\n\n" +
      "- *custom ai*: use /endpoint for your own providers.\n\n" +
      "- *persona*: tweak how i act with /persona.\n\n" +
      "check /help for the full list.";
    
    await sendText(env, chatId, welcomeMsg);
    return;
  }

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

  // ---- Check if user is importing wallet ----
  const isImporting = await env.CONFIG.get(`wallet_import_wizard:${userId}`);
  if (isImporting) {
    if (text === "/cancel" || text === "/wallet") {
      await env.CONFIG.delete(`wallet_import_wizard:${userId}`);
      await sendText(env, chatId, "Import cancelled.");
      return;
    }
    const key = text.trim();
    if (!key.startsWith("0x")) {
      await sendText(env, chatId, "Invalid private key format. Must start with 0x.", cancelKeyboard("wallet_import_cancel"));
      return;
    }
    try {
      await env.CONFIG.delete(`wallet_import_wizard:${userId}`);
      await sendText(env, chatId, `Wallet import is no longer supported.`);
    } catch (err: any) {
      await sendText(env, chatId, `Import failed: ${err.message}`, cancelKeyboard("wallet_import_cancel"));
    }
    return;
  }

  // ---- Check if user is in guard wizard ----
  const guardWizard = await getGuardWizardState(env, userId);
  if (guardWizard) {
    if (text === "/cancel" || text === "/guard") {
      await clearGuardWizardState(env, userId);
      await sendText(env, chatId, "Guard configuration cancelled.");
      return;
    }

    if (guardWizard.step === "limit") {
      const value = parseFloat(text);
      if (isNaN(value) || value <= 0) {
        await sendText(env, chatId, "Invalid number. Please send a positive number for the USD limit (e.g. 1000).", cancelKeyboard("guard_cancel"));
        return;
      }
      const limits = (await env.CONFIG.get(`limits:${userId}`, "json")) as any || {
        max_trade_value_usd: 500,
        max_slippage_pct: 0.5,
        allowed_protocols: ["merchant-moe", "agni-finance"]
      };
      limits.max_trade_value_usd = value;
      await env.CONFIG.put(`limits:${userId}`, JSON.stringify(limits));
      await clearGuardWizardState(env, userId);
      await sendText(env, chatId, `✅ Max trade limit updated to *${value} USD*.`, guardKeyboard());
      return;
    }

    if (guardWizard.step === "slippage") {
      const value = parseFloat(text);
      if (isNaN(value) || value <= 0) {
        await sendText(env, chatId, "Invalid number. Please send a positive number for slippage (e.g. 0.5).", cancelKeyboard("guard_cancel"));
        return;
      }
      const limits = (await env.CONFIG.get(`limits:${userId}`, "json")) as any || {
        max_trade_value_usd: 500,
        max_slippage_pct: 0.5,
        allowed_protocols: ["merchant-moe", "agni-finance"]
      };
      limits.max_slippage_pct = value;
      await env.CONFIG.put(`limits:${userId}`, JSON.stringify(limits));
      await clearGuardWizardState(env, userId);
      await sendText(env, chatId, `✅ Max slippage updated to *${value}%*.`, guardKeyboard());
      return;
    }
  }

  // ---- Parse and handle commands ----
  const cmd = parseCommand(text);
  if (cmd) {
    switch (cmd.command) {
      case "reset": {
        const { getSession, saveSession, createSession, deleteSession } = await import("../memory");
        const session = await getSession(env.DB, sessionId);
        
        if (session) {
          const provider = session.provider;
          const model = session.model;
          
          // Create a new clean session but preserve preferences
          const newSession = createSession(sessionId);
          newSession.provider = provider;
          newSession.model = model;
          await saveSession(env.DB, sessionId, newSession);
        } else {
          await deleteSession(env.DB, sessionId);
        }
        
        await sendText(env, chatId, "Session cleared. Your provider and model preferences have been preserved.");
        return;
      }

      case "mainnet":
      case "testnet": {
        await sendText(env, chatId, "On-chain network selection is no longer available.");
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
        const session = await getSession(env.DB, sessionId);
        const msgCount = session?.messages?.length || 0;
        const provider = session?.provider || env.DEFAULT_PROVIDER || "openai";
        const model = session?.model || env.DEFAULT_MODEL || "(provider default)";
        const persona = (await env.CONFIG.get(`persona:${sessionId}`)) || env.DEFAULT_SYSTEM_PROMPT || "default";
        const network = session?.network || "testnet";
        await sendText(env, chatId,
          `*AuxloNeo Status*\n` +
          `Runtime: Cloudflare Workers\n` +
          `Network: \`${network}\`\n` +
          `Provider: \`${provider}\`\n` +
          `Model: \`${model}\`\n` +
          `Messages: ${msgCount}\n` +
          `Persona: ${persona.slice(0, 80)}${persona.length > 80 ? "..." : ""}`
        );
        return;
      }

      case "usage": {
        const { getUsage } = await import("../memory");
        const stats = await getUsage(env.DB, sessionId);
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

      case "trading":
      case "wallet":
      case "guard": {
        await sendText(env, chatId, "On-chain and Mantle features are no longer available in AuxloNeo.");
        return;
      }

      case "commands":
      case "help":
        const helpLines = BOT_COMMANDS.map((c) => `/${c.command} - ${c.description}`);
        await sendText(env, chatId, "*AuxloNeo Commands*\n" + helpLines.join("\n"));
        return;

      case "cancel":
        await clearGuardWizardState(env, userId);
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
    chatId: chatId,
  };

  return runTelegramAgent(env, agentReq, null, requestUrl);
}

export async function continueTelegramAgent(env: Env, agentReq: AgentRequest, trackerState: TelegramProgressTrackerState, requestUrl: string) {
  return runTelegramAgent(env, agentReq, trackerState, requestUrl);
}

async function runTelegramAgent(env: Env, agentReq: AgentRequest, trackerState: TelegramProgressTrackerState | null, requestUrl: string) {
  agentReq.requestUrl = requestUrl;
  const chatId = agentReq.chatId || Number(agentReq.userId?.split(":")[1]);
  const tracker = trackerState 
      ? TelegramProgressTracker.fromState(env, trackerState)
      : new TelegramProgressTracker(env, chatId);
      
  if (!trackerState) {
      await tracker.init();
  }

  agentReq.onStatusUpdate = async (status) => {
    await tracker.logEvent(status);
  };

  let active = true;
  const keepTyping = async () => {
    while (active) {
      try {
        await sendChatAction(env, chatId, "typing");
      } catch (e) {
        // ignore
      }
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
  };

  const keepTicking = async () => {
    while (active) {
      try {
        await tracker.tick();
      } catch (e) {
        // ignore
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  };

  const typingPromise = keepTyping();
  const tickingPromise = keepTicking();

  try {
    const res = await agentChat(env, agentReq);
    
    if (res.continuationNeeded) {
      active = false;
      await Promise.all([typingPromise, tickingPromise]);

      // Trigger continuation
      const url = new URL("/internal/telegram/continue", requestUrl);
      await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentReq: { ...agentReq, isContinuation: true },
          trackerState: tracker.getState()
        })
      });
      return;
    }
    
    active = false;
    tracker.stop();
    if (!res.content && agentReq.media && agentReq.media.length > 0) {
      await tracker.logEvent({ type: "complete", content: "I received your media, but I couldn't make sense of it. Could you provide a caption or question?" });
    }
  } catch (err: any) {
    active = false;
    tracker.stop();
    try {
      await tracker.logEvent({ type: "complete", content: `❌ Error: ${err.message}` });
    } catch {
      await sendText(env, chatId, `Error: ${err.message}`);
    }
  } finally {
    active = false;
    tracker.stop();
    await Promise.all([typingPromise, tickingPromise]);
  }
}

// ---- Webhook entry point ----

export async function handleTelegramWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  if (env.TELEGRAM_WEBHOOK_SECRET) {
    const token = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (token !== env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  const update: TelegramUpdate = await request.json();

  // Deduplicate updates to prevent double-processing on Telegram retries
  if (update.update_id) {
    const dedupKey = `processed_update:${update.update_id}`;
    if (await env.SESSIONS.get(dedupKey)) {
      return new Response("OK");
    }
    // Set a short TTL (1 day) to avoid filling up the KV
    ctx.waitUntil(env.SESSIONS.put(dedupKey, "1", { expirationTtl: 86400 }));
  }

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

    const messagePromise = handleMessage(env, update.message, ctx, request.url);
    ctx.waitUntil(messagePromise);

    // Telegram webhook timeout is 60s. We wait up to 58s before returning to prevent retries.
    // By keeping the HTTP request open, Cloudflare won't trigger the background limit prematurely.
    // The agent internally stops generating new tool calls at 45s, so it should finish before this 58s timeout.
    const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 58000));
    await Promise.race([messagePromise, timeoutPromise]);

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