import type { Env, CustomProviderConfig } from "./types";
import { handleTelegramWebhook, setTelegramWebhook, registerTelegramCommands } from "./channels/telegram";
import { handleChatCompletions } from "./channels/api";
import { listProviders } from "./providers";

const VERSION = "0.1.1";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Telegram-Bot-Api-Secret-Token",
};

function requireAuth(env: Env, request: Request): boolean {
  if (!env.API_KEY) return false;
  const auth = request.headers.get("Authorization");
  return auth === `Bearer ${env.API_KEY}`;
}

// ---- Periodic Scan Functions ----

async function runPeriodicScan(env: Env): Promise<void> {
  try {
    const { results } = await env.DB.prepare("SELECT * FROM scan_targets").all();
    const targets = (results as any[]) || [];

    if (targets.length === 0) {
      console.log("No scan targets configured in D1");
      return;
    }

    // Import agent chat for autonomous analysis
    const { agentChat } = await import("./agent");

    for (const targetItem of targets.slice(0, 10)) { // Limit to 10 per run
      try {
        let targetText: string;
        let userId: string | undefined;
        let sessionId: string;
        let channel = "telegram";

        if (typeof targetItem === "string") {
          // Legacy string fallback
          targetText = targetItem;
          sessionId = `scan:${targetItem.replace(/[^a-zA-Z0-9]/g, "_")}`;
        } else {
          // Structured target
          targetText = targetItem.target;
          userId = targetItem.userId;
          const cleanTarget = targetText.slice(0, 30).replace(/[^a-zA-Z0-9]/g, "_");
          sessionId = targetItem.chatId
            ? `scan:${targetItem.chatId}:${cleanTarget}`
            : `scan:${targetText.slice(0, 40).replace(/[^a-zA-Z0-9]/g, "_")}`;
          channel = targetItem.channel || "telegram";
        }

        console.log(`Running user-contextual periodic scan for target: "${targetText}" (User: ${userId || "Anonymous"}, Chat ID: ${sessionId})`);

        // Create autonomous scan session under correct user context
        const req = {
          message: `Periodic scan: ${targetText}. Analyze it with available tools (web_search, web_fetch). Report findings if actionable.`,
          session_id: sessionId,
          userId: userId,
          channel: channel,
          requestUrl: env.APP_URL
        };

        const result = await agentChat(env, req);
        console.log(`Scan ${targetText}: ${result.content?.slice(0, 100)}...`);
      } catch (err) {
        console.error(`Scan failed for target:`, err, targetItem);
      }
    }
  } catch (err) {
    console.error("Periodic scan error:", err);
  }
}

async function runSingleScan(env: Env, targetItem: { target: string; userId: string; chatId: string; channel: string }): Promise<void> {
  try {
    const { agentChat } = await import("./agent");
    console.log(`Running user-contextual individual periodic scan for target: "${targetItem.target}" (User: ${targetItem.userId}, Chat ID: ${targetItem.chatId})`);

    const cleanTarget = targetItem.target.slice(0, 30).replace(/[^a-zA-Z0-9]/g, "_");
    const sessionId = `scan:${targetItem.chatId}:${cleanTarget}`;

    const req = {
      message: `Periodic scan: ${targetItem.target}. Analyze it with available tools (web_search, web_fetch). Report findings if actionable.`,
      session_id: sessionId,
      userId: targetItem.userId,
      channel: targetItem.channel || "telegram",
      requestUrl: env.APP_URL
    };

    const result = await agentChat(env, req);
    console.log(`Scan ${targetItem.target}: ${result.content?.slice(0, 100)}...`);
  } catch (err) {
    console.error(`Individual scan failed for target:`, err, targetItem);
  }
}

async function cleanupStaleSessions(env: Env): Promise<void> {
  try {
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
    const cutoff = now - maxAge;

    const res = await env.DB.prepare("DELETE FROM sessions WHERE updated_at < ?").bind(cutoff).run();
    console.log(`Cleaned up stale sessions. Rows affected: ${res.meta.changes}`);
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
              webhooks: ["telegram"],
              event_driven: "available via Durable Objects",
            },
            endpoints: {
              chat: "POST /v1/chat/completions",
              telegram: "POST /telegram",
              health: "GET /",
              providers: "GET /admin/providers",
              "add-provider": "POST /admin/providers",
              "delete-provider": "DELETE /admin/providers/:id",
              configure: "POST /admin/configure",
              "setup-telegram": "POST /admin/setup-telegram",
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

      // Internal agent continuation
      if (path === "/internal/telegram/continue" && method === "POST") {
        const body = await request.json() as any;
        const { continueTelegramAgent } = await import("./channels/telegram");
        const task = continueTelegramAgent(env, body.agentReq, body.trackerState, url.origin);
        ctx.waitUntil(task);
        // Hold the connection open to give the worker foreground execution time
        // The caller will likely abort before this, transferring this worker to its 30s background phase
        await Promise.race([task, new Promise(r => setTimeout(r, 58000))]);
        return new Response("OK");
      }

      // Setup telegram (webhook + commands) - bypass auth to allow flushing/setup natively
      if (path === "/admin/setup-telegram" && method === "POST") {
        const webhook = await setTelegramWebhook(env, url.origin);
        const commands = await registerTelegramCommands(env);
        return Response.json({ webhook, commands }, { headers: corsHeaders });
      }

      // Serve files from storage (D1 + R2 pointer fallback)
      if (path.startsWith("/files/") && method === "GET") {
        const fileId = path.split("/files/")[1];
        if (!fileId) {
          return new Response("File ID required", { status: 400 });
        }
        
        // Find the file metadata by ID in D1
        const fileRecord = await env.DB.prepare(
          "SELECT * FROM files WHERE id = ?"
        )
        .bind(fileId)
        .first<any>();

        if (!fileRecord) {
          return new Response("File not found", { status: 404 });
        }

        let fileContent: string | ArrayBuffer | null = null;
        if (fileRecord.content.startsWith("r2:")) {
          const r2Key = fileRecord.content.slice(3);
          if (env.STORAGE) {
            const obj = await env.STORAGE.get(r2Key);
            if (obj) {
              fileContent = await obj.arrayBuffer();
            }
          }
        } else {
          fileContent = fileRecord.content;
        }

        if (fileContent === null) {
          return new Response("File body not found in storage", { status: 404 });
        }

        const mimeType = fileRecord.mime_type || "application/octet-stream";
        const headers = new Headers();
        headers.set("Content-Type", mimeType);
        headers.set("Content-Disposition", `inline; filename="${encodeURIComponent(fileRecord.filename)}"`);
        headers.set("Access-Control-Allow-Origin", "*");

        return new Response(fileContent, { headers });
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

      // ---- Scan targets management (for periodic scanning) ----
      
      // List scan targets
      if (path === "/admin/scan-targets" && method === "GET") {
        const { results } = await env.DB.prepare("SELECT * FROM scan_targets").all();
        return Response.json({ targets: results }, { headers: corsHeaders });
      }

      // Add scan target (Admin)
      if (path === "/admin/scan-targets" && method === "POST") {
        const body = await request.json() as { target?: string, user_id?: string };
        if (!body.target) {
          return Response.json({ error: "target required" }, { status: 400, headers: corsHeaders });
        }
        const userId = body.user_id || "admin";
        const id = crypto.randomUUID();
        const now = Date.now();
        
        await env.DB.prepare(`
          INSERT INTO scan_targets (id, user_id, target, created_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id, target) DO NOTHING
        `)
        .bind(id, userId, body.target, now)
        .run();
        
        return Response.json({ ok: true }, { headers: corsHeaders });
      }

      // Remove scan target (Admin)
      if (path.startsWith("/admin/scan-targets/") && method === "DELETE") {
        const target = decodeURIComponent(path.split("/admin/scan-targets/")[1]);
        await env.DB.prepare("DELETE FROM scan_targets WHERE target = ?").bind(target).run();
        return Response.json({ ok: true }, { headers: corsHeaders });
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
    const nativeCron = event.cron;
    const scheduledTime = new Date(event.scheduledTime);
    console.log(`Native Cron triggered: ${nativeCron} at ${scheduledTime.toISOString()}`);

    // Retrieve active virtual cron schedules from the State Scheduler (CONFIG KV)
    const raw = await env.CONFIG.get("cron_schedules");
    let schedules: Array<{ cron: string; name?: string; action: string }> = [];
    if (raw) {
      try {
        schedules = JSON.parse(raw);
      } catch (e) {
        console.error("Failed to parse dynamic cron schedules:", e);
      }
    } else {
      // Default fallback schedules matching our pre-existing cron triggers
      schedules = [
        { cron: "*/5 * * * *", name: "scan", action: "scan" },
        { cron: "0 * * * *", name: "cleanup", action: "cleanup" }
      ];
    }

    // Execute matching schedules
    for (const schedule of schedules as Array<{ cron: string; name?: string; action: string; userId?: string; chatId?: string; channel?: string }>) {
      if (matchesCron(schedule.cron, scheduledTime)) {
        console.log(`Triggering secure virtual schedule: ${schedule.cron} (${schedule.name || schedule.action})`);
        try {
          if (schedule.action === "scan" || schedule.name?.includes("scan")) {
            if (schedule.userId && schedule.chatId) {
              await runSingleScan(env, {
                target: schedule.name || "Periodic market scan",
                userId: schedule.userId,
                chatId: schedule.chatId,
                channel: schedule.channel || "telegram"
              });
            } else {
              await runPeriodicScan(env);
            }
          } else if (schedule.action === "cleanup" || schedule.name?.includes("cleanup")) {
            await cleanupStaleSessions(env);
          } else {
            console.warn(`Unknown schedule action/name: ${schedule.action} / ${schedule.name}`);
          }
        } catch (err) {
          console.error(`Error running scheduled job [${schedule.cron}]:`, err);
        }
      }
    }
  },
};

function matchesCron(expression: string, date: Date): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const m = date.getMinutes();
  const h = date.getHours();
  const dom = date.getDate();
  const mon = date.getMonth() + 1; // 1-12
  const dow = date.getDay(); // 0-6 (Sunday is 0)

  const values = [m, h, dom, mon, dow];

  for (let i = 0; i < 5; i++) {
    const part = parts[i];
    const value = values[i];

    if (part === "*") continue;

    const subParts = part.split(",");
    let matched = false;
    for (const sub of subParts) {
      if (sub === "*") {
        matched = true;
        break;
      }
      if (sub.startsWith("*/")) {
        const step = parseInt(sub.substring(2), 10);
        if (!isNaN(step) && value % step === 0) {
          matched = true;
          break;
        }
      } else if (sub.includes("-")) {
        const [startStr, endStr] = sub.split("-");
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);
        if (!isNaN(start) && !isNaN(end) && value >= start && value <= end) {
          matched = true;
          break;
        }
      } else {
        const exact = parseInt(sub, 10);
        if (!isNaN(exact) && value === exact) {
          matched = true;
          break;
        }
      }
    }
    if (!matched) return false;
  }
  return true;
}
