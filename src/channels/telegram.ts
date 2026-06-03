import type { Env, AgentRequest } from "../types";
import { agentChat } from "../agent";

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: { id: number; first_name: string; username?: string };
    chat: { id: number; type: string };
    text?: string;
  };
}

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

  // Handle commands
  const cmd = parseCommand(text);
  if (cmd) {
    switch (cmd.command) {
      case "start":
        await sendTelegramMessage(env, chatId, "Welcome to AuxloNeo! Send me a message.");
        return new Response("OK");
      case "reset":
        await env.SESSIONS.delete(`session:${sessionId}`);
        await sendTelegramMessage(env, chatId, "Session reset.");
        return new Response("OK");
      case "help":
        await sendTelegramMessage(
          env,
          chatId,
          "AuxloNeo Commands:\n/start - Welcome\n/reset - Clear conversation\n/model <provider/model> - Set model\n/help - This message"
        );
        return new Response("OK");
    }
  }

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
