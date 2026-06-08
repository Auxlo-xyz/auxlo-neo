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

// ---- Periodic Scan Functions ----

async function runPeriodicScan(env: Env): Promise<void> {
  try {
    const targetsRaw = await env.CONFIG.get("scan_targets", "json");
    const targets: string[] = (targetsRaw as string[]) || [];

    if (targets.length === 0) {
      console.log("No scan targets configured");
      return;
    }

    // Import agent chat for autonomous analysis
    const { agentChat } = await import("./agent");

    for (const target of targets.slice(0, 3)) { // Limit to 3 per run
      try {
        // Create autonomous scan session
        const req = {
          message: `Periodic scan: ${target}. Use somnia_snoop to analyze. Report findings if actionable.`,
          session_id: `scan:${target}`,
          channel: "telegram", // Default to telegram notifications
        };

        const result = await agentChat(env, req);
        console.log(`Scan ${target}: ${result.content?.slice(0, 100)}...`);
      } catch (err) {
        console.error(`Scan failed for ${target}:`, err);
      }
    }
  } catch (err) {
    console.error("Periodic scan error:", err);
  }
}

async function cleanupStaleSessions(env: Env): Promise<void> {
  try {
    const list = await env.SESSIONS.list({ prefix: "session:", limit: 100 });
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days

    for (const key of list.keys) {
      const raw = await env.SESSIONS.get(key.name, "json");
      const session = raw as { updatedAt?: number } | null;

      if (session?.updatedAt && now - session.updatedAt > maxAge) {
        await env.SESSIONS.delete(key.name);
        console.log(`Deleted stale session: ${key.name}`);
      }
    }
  } catch (err) {
    console.error("Cleanup error:", err);
  }
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
            capabilities: {
              cron_triggers: "*/5 * * * * (scan), 0 * * * * (cleanup)",
              webhooks: ["telegram", "discord"],
              event_driven: "available via Durable Objects",
            },
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
              "scan-targets": "GET /admin/scan-targets",
              "add-scan-target": "POST /admin/scan-targets",
              "delete-scan-target": "DELETE /admin/scan-targets/:target",
              "scan-now": "POST /admin/scan-now",
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

      // ---- Scan targets management (for periodic scanning) ----

      // List scan targets
      if (path === "/admin/scan-targets" && method === "GET") {
        const raw = await env.CONFIG.get("scan_targets", "json");
        const targets: string[] = (raw as string[]) || [];
        return Response.json({ targets }, { headers: corsHeaders });
      }

      // Add scan target
      if (path === "/admin/scan-targets" && method === "POST") {
        const body = await request.json() as { target?: string };
        if (!body.target) {
          return Response.json({ error: "target required" }, { status: 400, headers: corsHeaders });
        }
        const raw = await env.CONFIG.get("scan_targets", "json");
        const targets: string[] = (raw as string[]) || [];
        if (!targets.includes(body.target)) {
          targets.push(body.target);
          await env.CONFIG.put("scan_targets", JSON.stringify(targets));
        }
        return Response.json({ ok: true, targets }, { headers: corsHeaders });
      }

      // Remove scan target
      if (path.startsWith("/admin/scan-targets/") && method === "DELETE") {
        const target = decodeURIComponent(path.split("/admin/scan-targets/")[1]);
        const raw = await env.CONFIG.get("scan_targets", "json");
        let targets: string[] = (raw as string[]) || [];
        targets = targets.filter(t => t !== target);
        await env.CONFIG.put("scan_targets", JSON.stringify(targets));
        return Response.json({ ok: true, targets }, { headers: corsHeaders });
      }

      // Trigger manual scan
      if (path === "/admin/scan-now" && method === "POST") {
        await runPeriodicScan(env);
        return Response.json({ ok: true, message: "Scan triggered" }, { headers: corsHeaders });
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
    const cron = event.cron;
    console.log(`Cron triggered: ${cron} at ${new Date(event.scheduledTime).toISOString()}`);

    // Every 5 minutes: scan for Somnia opportunities
    if (cron === "*/5 * * * *") {
      await runPeriodicScan(env);
    }

    // Every hour: cleanup stale sessions
    if (cron === "0 * * * *") {
      await cleanupStaleSessions(env);
    }
  },
};
