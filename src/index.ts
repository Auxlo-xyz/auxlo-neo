import type { Env, CustomProviderConfig } from "./types";
import { handleTelegramWebhook, setTelegramWebhook, registerTelegramCommands } from "./channels/telegram";
import { handleDiscordWebhook, registerDiscordCommands } from "./channels/discord";
import { handleChatCompletions } from "./channels/api";
import { listProviders } from "./providers";

const VERSION = "0.1.0";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function requireAuth(env: Env, request: Request): boolean {
  if (!env.API_KEY) return true;
  const auth = request.headers.get("Authorization");
  return auth === `Bearer ${env.API_KEY}`;
}

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
              providers: "GET /admin/providers",
              "add-provider": "POST /admin/providers",
              "delete-provider": "DELETE /admin/providers/:id",
              configure: "POST /admin/configure",
              "setup-telegram": "POST /admin/setup-telegram",
              "setup-discord": "POST /admin/setup-discord",
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

      // ---- Admin endpoints (require API_KEY) ----

      if (!requireAuth(env, request)) {
        return Response.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
      }

      // List providers (built-in + custom)
      if (path === "/admin/providers" && method === "GET") {
        const providers = await listProviders(env);
        return Response.json({ providers }, { headers: corsHeaders });
      }

      // Add/update custom provider
      if (path === "/admin/providers" && method === "POST") {
        const body = (await request.json()) as CustomProviderConfig;
        if (!body.id || !body.name || !body.base_url || !body.api_key || !body.default_model) {
          return Response.json(
            { error: "Required: id, name, base_url, api_key, default_model" },
            { status: 400, headers: corsHeaders }
          );
        }
        const config: CustomProviderConfig = {
          id: body.id,
          name: body.name,
          base_url: body.base_url,
          api_key: body.api_key,
          default_model: body.default_model,
          type: body.type || "openai",
        };
        await env.CONFIG.put(`custom_provider:${config.id}`, JSON.stringify(config));
        return Response.json({ ok: true, provider: config }, { headers: corsHeaders });
      }

      // Delete custom provider
      if (path.startsWith("/admin/providers/") && method === "DELETE") {
        const id = path.split("/admin/providers/")[1];
        if (!id) {
          return Response.json({ error: "Provider ID required" }, { status: 400, headers: corsHeaders });
        }
        await env.CONFIG.delete(`custom_provider:${id}`);
        return Response.json({ ok: true, deleted: id }, { headers: corsHeaders });
      }

      // Update global config
      if (path === "/admin/configure" && method === "POST") {
        const body = (await request.json()) as Record<string, string>;
        const allowed = ["persona", "default_model", "default_provider", "max_tokens", "temperature", "system_prompt"];
        let updated = 0;
        for (const [key, value] of Object.entries(body)) {
          if (allowed.includes(key)) {
            await env.CONFIG.put(key, String(value));
            updated++;
          }
        }
        return Response.json({ updated }, { headers: corsHeaders });
      }

      // Setup telegram (webhook + commands)
      if (path === "/admin/setup-telegram" && method === "POST") {
        const webhook = await setTelegramWebhook(env, url.origin);
        const commands = await registerTelegramCommands(env);
        return Response.json({ webhook, commands }, { headers: corsHeaders });
      }

      // Register discord commands
      if (path === "/admin/setup-discord" && method === "POST") {
        const result = await registerDiscordCommands(env);
        return Response.json({ result }, { headers: corsHeaders });
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
