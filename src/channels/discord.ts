import type { Env, AgentRequest } from "../types";
import { agentChat } from "../agent";
import { checkAllowed } from "../utils";

interface DiscordInteraction {
  id: string;
  application_id: string;
  type: number;
  token: string;
  data?: { name: string; options?: { name: string; value: string }[] };
  member?: { user: { id: string; username: string } };
  user?: { id: string; username: string };
  channel_id?: string;
}

async function verifyDiscordSignature(
  body: string,
  signature: string,
  timestamp: string,
  publicKey: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const message = encoder.encode(timestamp + body);
  const pubKeyBytes = hexToBytes(publicKey);
  const sigBytes = hexToBytes(signature);

  const cryptoKey = await crypto.subtle.importKey("raw", pubKeyBytes, { name: "Ed25519" }, false, [
    "verify",
  ]);

  return crypto.subtle.verify("Ed25519", cryptoKey, sigBytes, message);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

async function sendDiscordFollowup(env: Env, interactionToken: string, content: string) {
  const chunks: string[] = [];
  if (content.length <= 2000) {
    chunks.push(content);
  } else {
    let remaining = content;
    while (remaining.length > 0) {
      chunks.push(remaining.slice(0, 2000));
      remaining = remaining.slice(2000);
    }
  }

  for (const chunk of chunks) {
    await fetch(
      `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${interactionToken}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: chunk }),
      }
    );
  }
}

export async function handleDiscordWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const body = await request.text();

  if (env.DISCORD_PUBLIC_KEY) {
    const signature = request.headers.get("x-signature-ed25519");
    const timestamp = request.headers.get("x-signature-timestamp");
    if (!signature || !timestamp) {
      return new Response("Missing signature", { status: 401 });
    }
    const valid = await verifyDiscordSignature(body, signature, timestamp, env.DISCORD_PUBLIC_KEY);
    if (!valid) return new Response("Invalid signature", { status: 401 });
  }

  const interaction: DiscordInteraction = JSON.parse(body);

  // PING
  if (interaction.type === 1) {
    return new Response(JSON.stringify({ type: 1 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Application command
  if (interaction.type === 2) {
    const commandName = interaction.data?.name;
    const userId_num = interaction.member?.user?.id || interaction.user?.id;
    const username = interaction.member?.user?.username || interaction.user?.username || "unknown";

    if (!userId_num) {
      return new Response("Missing user ID", { status: 400 });
    }

    const sessionId = `discord:${userId_num}`;
    const userId = `discord:${userId_num}`; // Channel-prefixed for ALLOWED_USERS isolation

    if (!(await checkAllowed(env, userId))) {
      console.log(`Unauthorized Discord user: ${userId_num}`);
      return new Response("Unauthorized", { status: 403 });
    }

    const args = interaction.data?.options?.[0]?.value || "";

    switch (commandName) {
      case "chat": {
        if (!args) {
          return new Response(
            JSON.stringify({ type: 4, data: { content: "Provide a message.", flags: 64 } }),
            { headers: { "Content-Type": "application/json" } }
          );
        }

        ctx.waitUntil(
          (async () => {
            const req: AgentRequest = {
              message: args,
              session_id: sessionId,
              userId: userId, // Pass userId for RLS check
            };
            try {
              const res = await agentChat(env, req);
              await sendDiscordFollowup(env, interaction.token, res.content);
            } catch (err: any) {
              await sendDiscordFollowup(env, interaction.token, `Error: ${err.message}`);
            }
          })()
        );

        return new Response(JSON.stringify({ type: 5 }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      case "reset": {
        await env.SESSIONS.delete(`session:discord:${userId_num}`);
        return new Response(
          JSON.stringify({ type: 4, data: { content: "Session reset.", flags: 64 } }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      case "help": {
        return new Response(
          JSON.stringify({
            type: 4,
            data: {
              content:
                "**AuxloNeo Commands**\n" +
                "`/chat <message>` - Talk to AI\n" +
                "`/reset` - Clear history\n" +
                "`/grant <recipient> <resource> <permission> [days]` - Grant access\n" +
                "`/revoke <grantId>` - Revoke access\n" +
                "`/shares` - List your grants\n" +
                "`/help` - This message",
              flags: 64,
            },
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      case "grant": {
        const args = interaction.data?.options?.map(o => o.value).join(" ") || "";
        const { handleGrantCommand } = await import("../grant-commands");
        const result = await handleGrantCommand(env, userId, args);
        
        return new Response(
          JSON.stringify({ type: 4, data: { content: result.message, flags: 64 } }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      case "revoke": {
        const grantId = interaction.data?.options?.find(o => o.name === "grant_id")?.value;

        if (!grantId) {
          return new Response(
            JSON.stringify({ type: 4, data: { content: "Usage: `/revoke grant_id:<grantId>`", flags: 64 } }),
            { headers: { "Content-Type": "application/json" } }
          );
        }

        const { handleRevokeCommand } = await import("../grant-commands");
        const result = await handleRevokeCommand(env, userId, grantId);

        return new Response(
          JSON.stringify({ type: 4, data: { content: result.message, flags: 64 } }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      case "shares": {
        const { handleListSharesCommand } = await import("../grant-commands");
        const result = await handleListSharesCommand(env, userId);

        return new Response(
          JSON.stringify({ type: 4, data: { content: result.message.substring(0, 2000), flags: 64 } }),
          { headers: { "Content-Type": "application/json" } }
        );
      }
    }
  }

  return new Response("Unknown", { status: 400 });
}

export async function registerDiscordCommands(env: Env): Promise<string> {
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_APPLICATION_ID) {
    return "DISCORD_BOT_TOKEN and DISCORD_APPLICATION_ID required";
  }

  const commands = [
    {
      name: "chat",
      description: "Send a message to the AI",
      type: 1,
      options: [{ name: "message", description: "Your message", type: 3, required: true }],
    },
    { name: "reset", description: "Clear conversation history", type: 1 },
    { name: "help", description: "Show available commands", type: 1 },
    {
      name: "grant",
      description: "Grant access to your data",
      type: 1,
      options: [
        { name: "recipient", description: "User ID (e.g., telegram:123)", type: 3, required: true },
        { name: "resource", description: "Resource ID (e.g., session:telegram:123)", type: 3, required: true },
        { name: "permission", description: "read or write", type: 3, required: false },
        { name: "days", description: "Days until expiry", type: 4, required: false },
      ],
    },
    {
      name: "revoke",
      description: "Revoke access to your data",
      type: 1,
      options: [
        { name: "grant_id", description: "Grant ID to revoke", type: 3, required: true },
      ],
    },
    {
      name: "shares",
      description: "List your shared data grants",
      type: 1,
    },
  ];

  const resp = await fetch(
    `https://discord.com/api/v10/applications/${env.DISCORD_APPLICATION_ID}/commands`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commands),
    }
  );

  const data = await resp.json();
  return JSON.stringify({ success: true, commands: data });
}
