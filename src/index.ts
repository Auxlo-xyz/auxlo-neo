import type { Env } from "./types";
import { handleTelegramWebhook, setTelegramWebhook } from "./channels/telegram";
import { handleDiscordWebhook, registerDiscordCommands } from "./channels/discord";
import { handleChatCompletions } from "./channels/api";

const VERSION = "0.1.0";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Health check
      if (path === "/" && method === "GET") {
        return Response.json(
          {
            name: "AuxloNeo",
            version: VERSION,
            edge: "cloudflare",
            status: "online",
            endpoints: {
              chat: "POST /v1/chat/completions",
              telegram: "POST /telegram",
              discord: "POST /discord",
              health: "GET /",
              configure: "POST /admin/configure",
            },
          },
          { headers: corsHeaders }
        );
      }

      // OpenAI-compatible API
      if (
        (path === "/v1/chat/completions" || path === "/api/chat/completions") &&
        method === "POST"
      ) {
        return handleChatCompletions(request, env, ctx);
      }

      // Telegram webhook
      if (path === "/telegram" && method === "POST") {
        return handleTelegramWebhook(request, env, ctx);
      }

      // Discord webhook
      if (path === "/discord" && method === "POST") {
        return handleDiscordWebhook(request, env, ctx);
      }

      // Admin: configure
      if (path === "/admin/configure" && method === "POST") {
        const auth = request.headers.get("Authorization");
        if (env.API_KEY && auth !== `Bearer ${env.API_KEY}`) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        const body = (await request.json()) as Record<string, string>;
        const allowed = ["persona", "default_model", "default_provider", "max_tokens", "temperature"];
        let updated = 0;
        for (const [key, value] of Object.entries(body)) {
          if (allowed.includes(key)) {
            await env.CONFIG.put(key, String(value));
            updated++;
          }
        }
        return Response.json({ updated });
      }

      // Admin: setup telegram webhook
      if (path === "/admin/setup-telegram" && method === "POST") {
        const result = await setTelegramWebhook(env, url.origin);
        return Response.json({ result });
      }

      // Admin: register discord commands
      if (path === "/admin/setup-discord" && method === "POST") {
        const result = await registerDiscordCommands(env);
        return Response.json({ result });
      }

      return Response.json({ error: "Not found" }, { status: 404, headers: corsHeaders });
    } catch (err) {
      console.error("Unhandled error:", err);
      return Response.json(
        { error: err instanceof Error ? err.message : "Internal error" },
        { status: 500, headers: corsHeaders }
      );
    }
  },

  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    console.log(`Cron triggered at ${new Date(event.scheduledTime).toISOString()}`);
  },
};
