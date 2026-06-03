import type { Env, AgentRequest } from "../types";
import { agentChat } from "../agent";
import { listProviders } from "../providers";

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: { id: number; first_name: string; username?: string };
    chat: { id: number; type: string };
    text?: string;
  };
}

// Telegram Bot API commands for the menu
const BOT_COMMANDS = [
  { command: "start", description: "Welcome message" },
  { command: "help", description: "Show all commands" },
  { command: "reset", description: "Clear conversation history" },
  { command: "model", description: "Set model (e.g. /model gpt-4o)" },
  { command: "provider", description: "Switch provider (e.g. /provider groq)" },
  { command: "persona", description: "Set system prompt (e.g. /persona You are a pirate)" },
  { command: "status", description: "Show current session info" },
  { command: "commands", description: "List available commands" },
];

function parseCommand(text: string): { command: string; args: string } | null {
  const match = text.match(/^\/(\w+)(?:\s+(.*))?$/);
  if (!match) return null;
  return { command: match[1].toLowerCase(), args: match[2]?.trim() || "" };
}

async function sendTelegramMessage(env: Env, chatId: number, text: string): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

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
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: chunk }),
    });
  }
}

export async function handleTelegramWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const update: TelegramUpdate = await request.json();
  if (!update.message?.text) return new Response("OK");

  const msg = update.message!;
  const chatId = msg!.chat.id;
  const userId = msg!.from.id.toString();
  const text = msg!.text!;
  const sessionId = `telegram:${chatId}`;

  const cmd = parseCommand(text);
  if (cmd) {
    switch (cmd.command) {
      case "start":
        await sendTelegramMessage(
          env,
          chatId,
          "Welcome to AuxloNeo! I'm your edge-native AI assistant.\n\n" +
            "Send me any message and I'll respond. Use /help to see all commands."
        );
        return new Response("OK");

      case "reset":
        await env.SESSIONS.delete(`session:${sessionId}`);
        await sendTelegramMessage(env, chatId, "Session cleared. Fresh start.");
        return new Response("OK");

      case "model":
        if (cmd.args) {
          // Store model override in session
          const session = await (await import("../memory")).getSession(env.SESSIONS, sessionId);
          if (session) {
            session.model = cmd.args;
            await (await import("../memory")).saveSession(env.SESSIONS, sessionId, session);
          }
          await sendTelegramMessage(env, chatId, `Model set to: ${cmd.args}`);
        } else {
          await sendTelegramMessage(
            env,
            chatId,
            "Usage: /model <model-name>\nExamples:\n  /model gpt-4o\n  /model claude-sonnet-4-20250514\n  /model gemini-2.0-flash\n  /model deepseek-chat"
          );
        }
        return new Response("OK");

      case "provider":
        if (cmd.args) {
          const session = await (await import("../memory")).getSession(env.SESSIONS, sessionId);
          if (session) {
            session.provider = cmd.args;
            await (await import("../memory")).saveSession(env.SESSIONS, sessionId, session);
          }
          await sendTelegramMessage(env, chatId, `Provider set to: ${cmd.args}`);
        } else {
          const providers = await listProviders(env);
          const lines = providers.map((p) => `  ${p.id} - ${p.model} (${p.type})`);
          await sendTelegramMessage(
            env,
            chatId,
            "Usage: /provider <id>\n\nAvailable providers:\n" + lines.join("\n")
          );
        }
        return new Response("OK");

      case "persona":
        if (cmd.args) {
          await env.CONFIG.put(`persona:${sessionId}`, cmd.args);
          await sendTelegramMessage(env, chatId, "Persona updated. I'll use that for new conversations.");
        } else {
          const current = (await env.CONFIG.get(`persona:${sessionId}`)) || env.DEFAULT_SYSTEM_PROMPT || "default";
          await sendTelegramMessage(
            env,
            chatId,
            `Current persona: ${current}\n\nUsage: /persona <prompt>\nExample: /persona You are a senior Rust engineer. Be concise.`
          );
        }
        return new Response("OK");

      case "status":
        const session = await (await import("../memory")).getSession(env.SESSIONS, sessionId);
        const msgCount = session?.messages?.length || 0;
        const provider = session?.provider || env.DEFAULT_PROVIDER || "openai";
        const model = session?.model || env.DEFAULT_MODEL || "(provider default)";
        const persona = (await env.CONFIG.get(`persona:${sessionId}`)) || env.DEFAULT_SYSTEM_PROMPT || "default";
        await sendTelegramMessage(
          env,
          chatId,
          `AuxloNeo Status\n` +
            `Provider: ${provider}\n` +
            `Model: ${model}\n` +
            `Messages in session: ${msgCount}\n` +
            `Persona: ${persona.slice(0, 100)}${persona.length > 100 ? "..." : ""}`
        );
        return new Response("OK");

      case "commands":
      case "help":
        const helpLines = BOT_COMMANDS.map((c) => `/${c.command} - ${c.description}`);
        await sendTelegramMessage(env, chatId, "AuxloNeo Commands:\n" + helpLines.join("\n"));
        return new Response("OK");
    }
  }

  // Not a command -- send to agent
  const req: AgentRequest = {
    message: text,
    session_id: sessionId,
  };

  ctx.waitUntil(
    agentChat(env, req)
      .then((res) => sendTelegramMessage(env, chatId, res.content))
      .catch((err) => sendTelegramMessage(env, chatId, `Error: ${err.message}`))
  );

  return new Response("OK");
}

// Register slash commands with Telegram (call once on deploy)
export async function registerTelegramCommands(env: Env): Promise<string> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return "TELEGRAM_BOT_TOKEN not set";

  const resp = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commands: BOT_COMMANDS }),
  });

  const data = await resp.json();
  return JSON.stringify(data);
}

export async function setTelegramWebhook(env: Env, origin: string): Promise<string> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return "TELEGRAM_BOT_TOKEN not set";

  const body: any = {
    url: `${origin}/telegram`,
    allowed_updates: ["message"],
  };

  if (env.TELEGRAM_WEBHOOK_SECRET) {
    body.secret_token = env.TELEGRAM_WEBHOOK_SECRET;
  }

  const resp = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await resp.json();
  return JSON.stringify(data);
}
