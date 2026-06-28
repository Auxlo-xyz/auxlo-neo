import type { Env, ToolDefinition, ToolResult, ToolContext, ScanTarget } from "../types";
import { StorageService } from "../storage";

export async function getToolDefinitions(env: Env, ctx?: ToolContext): Promise<ToolDefinition[]> {
  const tools: ToolDefinition[] = [
    {
      type: "function",
      function: {
        name: "web_search",
        description: "Search the web. Returns high-quality web results in markdown format. Use for current information, facts, news.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "The search query" },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "web_fetch",
        description: "Fetch a URL and return its text content. Use to read articles, docs, APIs, raw pages.",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "The URL to fetch" },
            max_chars: { type: "number", description: "Max characters to return (default 10000)" },
          },
          required: ["url"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "send_message",
        description: "Send a proactive message to the user during long-running tasks. Use this to provide progress updates, intermediate results, or status reports while multi-step work is in progress. The user sees this as a separate message from your final reply.",
        parameters: {
          type: "object",
          properties: {
            channel: {
              type: "string",
              enum: ["telegram"],
              description: ctx?.channel === "telegram"
                ? "Use 'telegram' (you are in a Telegram chat)"
                : "Channel to send to: 'telegram'",
            },
            target: {
              type: "string",
              description: ctx?.channel === "telegram"
                ? `Chat ID (your current session: ${ctx?.sessionId?.split(":")[1] || ctx?.sessionId || "unknown"})`
                : "Chat ID for Telegram",
            },
            message: { type: "string", description: "The message to send" },
          },
          required: ["channel", "target", "message"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "send_document",
        description: "Send a file/document directly to the user via Telegram. This uploads the specified file from storage (or creates/overwrites it first) and sends it as a downloadable native Telegram document.",
        parameters: {
          type: "object",
          properties: {
            channel: {
              type: "string",
              enum: ["telegram"],
              description: ctx?.channel === "telegram"
                ? "Use 'telegram' (you are in a Telegram chat)"
                : "Channel to send to: 'telegram'",
            },
            target: {
              type: "string",
              description: ctx?.channel === "telegram"
                ? `Chat ID (your current session: ${ctx?.sessionId?.split(":")[1] || ctx?.sessionId || "unknown"})`
                : "Chat ID for Telegram",
            },
            filename: {
              type: "string",
              description: "The name of the file to send (e.g. 'summary.md', 'report.pdf', 'data.csv'). If the file already exists in your storage, it will be fetched and sent. Otherwise, specify 'content' to create it first."
            },
            content: {
              type: "string",
              description: "Optional. The file's content if you want to create or overwrite it before sending."
            },
            caption: {
              type: "string",
              description: "Optional. Caption message to accompany the file."
            }
          },
          required: ["channel", "target", "filename"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "remember",
        description: "Save a piece of information to long-term memory. Use this to remember facts, preferences, names, instructions, or anything the user tells you to remember. Memories persist across conversations.",
        parameters: {
          type: "object",
          properties: {
            key: { type: "string", description: "A short label for the memory (e.g. 'user_name', 'favorite_language', 'project_url')" },
            value: { type: "string", description: "The information to remember" },
          },
          required: ["key", "value"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "recall",
        description: "Search your long-term memory for previously saved information. Use this to recall facts, preferences, or context from past conversations.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "What to search for in memory (e.g. 'user name', 'project details')" },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "x_fetch",
        description: "Fetch tweets or user profiles from X/Twitter. Returns the tweet content, author, likes, retweets, and replies. No API key required.",
        parameters: {
          type: "object",
          properties: {
            fetch_type: {
              type: "string",
              enum: ["tweet", "user"],
              description: "What to fetch: 'tweet' for a specific tweet, 'user' for a user profile"
            },
            id: {
              type: "string",
              description: "The tweet ID (numbers only, e.g. '123456789') or username (e.g. 'elonmusk')"
            }
          },
          required: ["fetch_type", "id"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "current_time",
        description: "Get the current date and time in UTC.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "write_file",
        description: "Save a report, guide, or structured document for the user. These are stored in a relational database and persist across sessions. Use this for long-form content that needs to be recalled later.",
        parameters: {
          type: "object",
          properties: {
            filename: { type: "string", description: "Name of the file (e.g. 'project_plan.md', 'user_guide.md')" },
            content: { type: "string", description: "The Markdown content to save" },
          },
          required: ["filename", "content"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Recall a previously written document by its filename. Use this to retrieve reports, guides, or notes saved via 'write_file'.",
        parameters: {
          type: "object",
          properties: {
            filename: { type: "string", description: "The name of the file to read" },
          },
          required: ["filename"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_files",
        description: "List all documents created for the user. Use this to see which files are available to read.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "set_cron",
        description: "Set or delete a cron trigger for the autonomous agent. Allows scheduling/removing tasks (such as periodic market scans or automated yield management operations).",
        parameters: {
          type: "object",
          properties: {
            cron: {
              type: "string",
              description: "Standard cron expression (e.g. '*/5 * * * *' for every 5 minutes, '0 * * * *' for every hour)."
            },
            action: {
              type: "string",
              enum: ["create", "delete"],
              description: "Action to take: 'create' to schedule, 'delete' to remove."
            },
            name: {
              type: "string",
              description: "Optional descriptive label or tag for the cron schedule."
            }
          },
          required: ["cron", "action"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "list_crons",
        description: "Retrieve a list of all currently scheduled cron triggers configured for this agent/worker script on Cloudflare.",
        parameters: {
          type: "object",
          properties: {}
        }
      }
    },
    {
      type: "function",
      function: {
        name: "add_scan_target",
        description: "Add a periodic scan target for the current user. When the virtual cron scheduler runs, it will autonomously scan and analyze this target under the current user's security context.",
        parameters: {
          type: "object",
          properties: {
            target: {
              type: "string",
              description: "The name, protocol address, URL or identifier of the DeFi platform, token, or strategy to scan (e.g. 'merchant-moe APY stability' or 'init-capital usdt borrow rate')"
            }
          },
          required: ["target"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "delete_scan_target",
        description: "Remove a periodic scan target for the current user to stop automatic scheduled analyses of it.",
        parameters: {
          type: "object",
          properties: {
            target: {
              type: "string",
              description: "The target to remove."
            }
          },
          required: ["target"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "list_scan_targets",
        description: "List all active periodic scan targets configured for the current user.",
        parameters: {
          type: "object",
          properties: {}
        }
      }
    }
                          ];

  return tools;
}

export async function executeTool(
  env: Env,
  name: string,
  args: Record<string, unknown>,
  ctx?: ToolContext
): Promise<ToolResult> {
  const storage = new StorageService(env);
  try {
    switch (name) {
      case "web_search":
        return await toolWebSearch(args.query as string);
      case "web_fetch":
        return await toolWebFetch(args.url as string, (args.max_chars as number) || 10000);
      case "send_message":
        return await toolSendMessage(env, args.channel as string, args.target as string, args.message as string);
      case "send_document":
        return await toolSendDocument(
          env,
          args.channel as string,
          args.target as string,
          args.filename as string,
          args.content as string | undefined,
          args.caption as string | undefined,
          ctx
        );
      case "remember":
        return await toolRemember(env, ctx?.sessionId, args.key as string, args.value as string);
      case "recall":
        return await toolRecall(env, ctx?.sessionId, args.query as string);
      case "x_fetch":
        return await toolXFetch(args.fetch_type as string, args.id as string);
      case "current_time":
        return { content: new Date().toISOString() };
      case "write_file":
        if (!ctx?.sessionId) return { content: "Owner ID (Session ID) required to save file", error: true };
        const ownerIdWrite = ctx.sessionId.includes(":") ? ctx.sessionId.split(":")[1] : ctx.sessionId;
        const fileId = await storage.saveFile(ownerIdWrite, args.filename as string, args.content as string);
        return { content: `File '${args.filename}' saved successfully. (ID: ${fileId})` };
      case "read_file":
        if (!ctx?.sessionId) return { content: "Owner ID (Session ID) required to read file", error: true };
        const ownerIdRead = ctx.sessionId.includes(":") ? ctx.sessionId.split(":")[1] : ctx.sessionId;
        const file = await storage.readFile(ownerIdRead, args.filename as string);
        return file ? { content: file } : { content: `File '${args.filename}' not found.`, error: true };
      case "list_files":
        if (!ctx?.sessionId) return { content: "Owner ID (Session ID) required to list files", error: true };
        const ownerIdList = ctx.sessionId.includes(":") ? ctx.sessionId.split(":")[1] : ctx.sessionId;
        const files = await storage.listFiles(ownerIdList);
        return { content: files.length ? files.map(f => `- ${f.filename} (ID: ${f.id})`).join("\n") : "No files found." };
      case "set_cron":
        return await toolSetCron(env, args.cron as string, args.action as "create" | "delete", args.name as string | undefined, ctx);
      case "list_crons":
        return await toolListCrons(env);
      case "add_scan_target":
        return await toolAddScanTarget(env, args.target as string, ctx);
      case "delete_scan_target":
        return await toolDeleteScanTarget(env, args.target as string, ctx);
      case "list_scan_targets":
        return await toolListScanTargets(env, ctx);
      default:
        return { content: `Unknown tool: ${name}`, error: true };
    }
  } catch (err: any) {
    return { content: `Tool error: ${err.message}`, error: true };
  }
}

// ---- Tool implementations ----

// ---- Cron Management Tools ----

async function toolSetCron(env: Env, cron: string, action: "create" | "delete", name?: string, ctx?: ToolContext): Promise<ToolResult> {
  try {
    const raw = await env.CONFIG.get("cron_schedules");
    let schedules: Array<{ cron: string; name?: string; action: string; userId?: string; chatId?: string; channel?: string }> = [];
    if (raw) {
      try {
        schedules = JSON.parse(raw);
      } catch (e) {
        schedules = [];
      }
    } else {
      // Default initial schedules
      schedules = [
        { cron: "*/5 * * * *", name: "scan", action: "scan" },
        { cron: "0 * * * *", name: "cleanup", action: "cleanup" }
      ];
    }

    if (action === "delete") {
      const filtered = schedules.filter(s => s.cron !== cron);
      await env.CONFIG.put("cron_schedules", JSON.stringify(filtered));
      return { content: `Cron "${cron}" successfully removed from State Scheduler.` };
    }

    // Create/update
    const existingIndex = schedules.findIndex(s => s.cron === cron);
    // Determine action from name or default to scan
    const cronAction = name && name.toLowerCase().includes("cleanup") ? "cleanup" : "scan";
    
    const newSchedule = {
      cron,
      name,
      action: cronAction,
      userId: ctx?.userId,
      chatId: ctx?.sessionId,
      channel: ctx?.channel || "telegram"
    };

    if (existingIndex >= 0) {
      schedules[existingIndex] = newSchedule;
    } else {
      schedules.push(newSchedule);
    }

    await env.CONFIG.put("cron_schedules", JSON.stringify(schedules));
    return { content: `Cron "${cron}" scheduled securely in State Scheduler.${name ? ` Label: "${name}".` : ""}` };
  } catch (err: any) {
    return { content: `Failed to set cron schedule securely: ${err.message}`, error: true };
  }
}

async function toolListCrons(env: Env): Promise<ToolResult> {
  try {
    const raw = await env.CONFIG.get("cron_schedules");
    let schedules: Array<{ cron: string; name?: string; action: string }> = [];
    if (raw) {
      try {
        schedules = JSON.parse(raw);
      } catch (e) {
        schedules = [];
      }
    } else {
      // Default initial schedules
      schedules = [
        { cron: "*/5 * * * *", name: "scan", action: "scan" },
        { cron: "0 * * * *", name: "cleanup", action: "cleanup" }
      ];
    }

    if (schedules.length === 0) {
      return { content: "No cron triggers configured in State Scheduler." };
    }

    const listStr = schedules.map(s => `- ${s.cron} (Label: ${s.name || "None"}, Action: ${s.action})`).join("\n");
    return { content: `Active secure cron schedules in State Scheduler:\n${listStr}` };
  } catch (err: any) {
    return { content: `Failed to list secure cron schedules: ${err.message}`, error: true };
  }
}

async function toolAddScanTarget(env: Env, target: string, ctx?: ToolContext): Promise<ToolResult> {
  if (!ctx?.userId) {
    return { content: "User ID is required to register a scan target.", error: true };
  }
  const userId = ctx.userId;
  const chatId = ctx.sessionId || "";
  const channel = ctx.channel || "telegram";
  const now = Date.now();
  const id = crypto.randomUUID();

  try {
    // Atomic UPSERT in D1 to prevent race conditions during parallel tool calls
    await env.DB.prepare(`
      INSERT INTO scan_targets (id, user_id, target, chat_id, channel, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, target) DO NOTHING
    `)
    .bind(id, userId, target, chatId, channel, now)
    .run();

    return { content: `Successfully registered periodic scan target: "${target}" under user context.` };
  } catch (err: any) {
    return { content: `Failed to register scan target: ${err.message}`, error: true };
  }
}

async function toolDeleteScanTarget(env: Env, target: string, ctx?: ToolContext): Promise<ToolResult> {
  if (!ctx?.userId) {
    return { content: "User ID is required to delete a scan target.", error: true };
  }
  const userId = ctx.userId;

  try {
    const result = await env.DB.prepare(
      "DELETE FROM scan_targets WHERE user_id = ? AND target = ?"
    )
    .bind(userId, target)
    .run();

    if ((result.meta.rows_affected as number) === 0) {
      return { content: `No scan target found matching "${target}" for this user.` };
    }

    return { content: `Successfully removed scan target "${target}" for this user.` };
  } catch (err: any) {
    return { content: `Failed to remove scan target: ${err.message}`, error: true };
  }
}

async function toolListScanTargets(env: Env, ctx?: ToolContext): Promise<ToolResult> {
  if (!ctx?.userId) {
    return { content: "User ID is required to list scan targets.", error: true };
  }
  const userId = ctx.userId;

  try {
    const { results } = await env.DB.prepare(
      "SELECT * FROM scan_targets WHERE user_id = ?"
    )
    .bind(userId)
    .all();

    const userTargets = results as any[];

    if (userTargets.length === 0) {
      return { content: "You have no registered periodic scan targets configured." };
    }

    const listStr = userTargets.map(t => `- ${t.target} (Channel: ${t.channel}, Created: ${new Date(t.created_at).toLocaleDateString()})`).join("\n");
    return { content: `Your configured periodic scan targets:\n${listStr}` };
  } catch (err: any) {
    return { content: `Failed to list scan targets: ${err.message}`, error: true };
  }
}

async function toolWebSearch(query: string): Promise<ToolResult> {
  const encodedQuery = encodeURIComponent(query);
  const searchUrl = `https://search.yahoo.com/search?p=${encodedQuery}`;
  const readerUrl = `https://md.succ.ai/?url=${encodeURIComponent(searchUrl)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000); // 12s timeout for search

  try {
    const response = await fetch(readerUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AuxloNeo/1.0)",
        "Accept": "text/plain",
      },
      redirect: "follow",
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { content: `Search failed: HTTP ${response.status}`, error: true };
    }

    let text = await response.text();
    
    // Remove references to the search engine name to keep it anonymous to the agent
    text = text.replace(/Yahoo Search/gi, "Web Search");
    text = text.replace(/Yahoo/gi, "Search");

    // Basic cleaning if necessary, but the user says it's well-formatted markdown
    if (text.length > 15000) {
      text = text.slice(0, 15000) + "\n\n[truncated]";
    }

    if (!text.trim()) {
      return { content: "No search results found or empty response." };
    }

    return { content: text };
  } catch (err: any) {
    return { content: `Search failed: ${err.message}`, error: true };
  }
}

async function toolWebFetch(url: string, maxChars: number): Promise<ToolResult> {
  let text = "";
  let success = false;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s total timeout

  try {
    const readerUrl = `https://md.succ.ai/?url=${url}`;
    const response = await fetch(readerUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AuxloNeo/1.0)",
        "Accept": "text/plain",
      },
      redirect: "follow",
      signal: controller.signal
    });

    if (response.ok) {
      text = await response.text();
      success = true;
    } else {
      console.warn(`Markdown fetch failed with status ${response.status}. Falling back to direct fetch.`);
    }
  } catch (err: any) {
    console.warn(`Markdown fetch error: ${err.message || err}. Falling back to direct fetch.`);
  }

  if (!success) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; AuxloNeo/1.0)",
          "Accept": "text/html,application/xhtml+xml,text/plain,application/json",
        },
        redirect: "follow",
        signal: controller.signal
      });

      if (!response.ok) {
        clearTimeout(timeoutId);
        return { content: `Fetch failed: HTTP ${response.status}`, error: true };
      }

      const contentType = response.headers.get("content-type") || "";
      text = await response.text();

      if (contentType.includes("text/html")) {
        text = text
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<nav[\s\S]*?<\/nav>/gi, "")
          .replace(/<header[\s\S]*?<\/header>/gi, "")
          .replace(/<footer[\s\S]*?<\/footer>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/\s+/g, " ")
          .trim();
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      return { content: `Fetch failed: ${err.message}`, error: true };
    }
  }

  clearTimeout(timeoutId);
  if (text.length > maxChars) {
    text = text.slice(0, maxChars) + "\n\n[truncated]";
  }

  return { content: text };
}

async function toolSendMessage(
  env: Env,
  channel: string,
  target: string,
  message: string
): Promise<ToolResult> {
  if (channel === "telegram") {
    const token = env.TELEGRAM_BOT_TOKEN;
    if (!token) return { content: "TELEGRAM_BOT_TOKEN not configured", error: true };

    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: target, text: message }),
    });

    if (!response.ok) {
      const err = await response.text();
      return { content: `Telegram send failed: ${err}`, error: true };
    }
    return { content: "Message sent via Telegram" };
  }

  return { content: `Unknown channel: ${channel}. Use 'telegram'.`, error: true };
}

async function toolSendDocument(
  env: Env,
  channel: string,
  target: string,
  filename: string,
  content?: string,
  caption?: string,
  ctx?: ToolContext
): Promise<ToolResult> {
  if (channel !== "telegram") {
    return { content: "Only 'telegram' channel is supported at this time", error: true };
  }
  
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return { content: "TELEGRAM_BOT_TOKEN not configured", error: true };

  const chatId = target;

  try {
    const storage = new StorageService(env);
    const ownerId = ctx?.sessionId?.includes(":") ? ctx.sessionId.split(":")[1] : ctx?.sessionId || "default";
    
    let fileContentStr = content;
    let fileId: string;
    if (content) {
      // Overwrite or create file
      fileId = await storage.saveFile(ownerId, filename, content);
    } else {
      // Look up existing file
      const fileRecord = await env.DB.prepare(
        "SELECT id FROM files WHERE owner_id = ? AND filename = ?"
      )
      .bind(ownerId, filename)
      .first<any>();
      
      if (!fileRecord) {
        return { content: `File '${filename}' not found in storage. Provide 'content' parameter to create and send it.`, error: true };
      }
      fileId = fileRecord.id;
      const readContent = await storage.readFile(ownerId, filename);
      if (readContent === null) {
         return { content: `File content for '${filename}' could not be read from storage.`, error: true };
      }
      fileContentStr = readContent;
    }

    // Call Telegram's sendDocument API directly using FormData
    const formData = new FormData();
    formData.append("chat_id", chatId);
    
    // Create blob for the file
    let mimeType = "text/plain";
    if (filename.endsWith(".json")) mimeType = "application/json";
    else if (filename.endsWith(".csv")) mimeType = "text/csv";
    else if (filename.endsWith(".md")) mimeType = "text/markdown";
    else if (filename.endsWith(".html")) mimeType = "text/html";
    
    const blob = new Blob([fileContentStr!], { type: mimeType });
    formData.append("document", blob, filename);
    
    if (caption) {
      formData.append("caption", caption);
    }

    const response = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text();
      return { content: `Telegram sendDocument failed: ${errText}`, error: true };
    }

    const resData = await response.json() as any;
    if (!resData?.ok) {
      return { content: `Telegram API returned error: ${JSON.stringify(resData)}`, error: true };
    }

    return { content: `File '${filename}' sent successfully to Telegram chat ${chatId} (ID: ${fileId})` };
  } catch (err: any) {
    return { content: `Failed to send document: ${err.message}`, error: true };
  }
}

async function toolRemember(
  env: Env,
  sessionId: string | undefined,
  key: string,
  value: string
): Promise<ToolResult> {
  if (!sessionId) {
    return { content: "Cannot save memory: no session context", error: true };
  }
  if (!key || !value) {
    return { content: "Both key and value are required", error: true };
  }

  const storage = new StorageService(env);
  const ownerId = sessionId.includes(":") ? sessionId.split(":")[1] : sessionId;
  
  await storage.saveMemory(ownerId, key, value);

  return { content: `Remembered: ${key} = ${value}` };
}

async function toolRecall(
  env: Env,
  sessionId: string | undefined,
  query: string
): Promise<ToolResult> {
  if (!query) {
    return { content: "Query is required", error: true };
  }

  const storage = new StorageService(env);
  const ownerId = sessionId?.includes(":") ? sessionId.split(":")[1] : sessionId || "default";
  
  const memories = await storage.getMemories(ownerId);
  const filtered = memories.filter(m => 
    m.key.toLowerCase().includes(query.toLowerCase()) || 
    m.value.toLowerCase().includes(query.toLowerCase())
  );

  if (filtered.length === 0) {
    return { content: `No memories found matching "${query}"` };
  }

  return { content: filtered.map(m => `${m.key}: ${m.value}`).join("\n") };
}
async function toolXFetch(fetchType: string, id: string): Promise<ToolResult> {
  let url: string;
  if (fetchType === "tweet") {
    url = `https://api.vxtwitter.com/Twitter/status/${id}`;
  } else if (fetchType === "user") {
    url = `https://api.vxtwitter.com/${id}`;
  } else {
    return { content: "Invalid fetch_type: must be 'tweet' or 'user'", error: true };
  }

  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; AuxloNeo/1.0)" },
  });

  if (!response.ok) {
    return { content: `X/Twitter fetch failed: HTTP ${response.status}`, error: true };
  }

  const data: any = await response.json();

  if (fetchType === "tweet") {
    const text = data.text || "";
    const author = data.user_name || "Unknown";
    const handle = data.user_screen_name || "";
    const likes = data.likes || 0;
    const retweets = data.retweets || 0;
    const replies = data.replies || 0;
    const date = data.date || "";
    const media = data.mediaURLs?.length ? data.mediaURLs.join(", ") : "none";
    const hashtags = data.hashtags?.length ? data.hashtags.join(", ") : "none";
    const qrt = data.qrtURL || "none";
    const convId = data.conversationID || "none";

    return {
      content: [
        `Tweet by ${author} (@${handle})`,
        `Date: ${date}`,
        "",
        text,
        "",
        `Likes: ${likes} | Retweets: ${retweets} | Replies: ${replies}`,
        `Hashtags: ${hashtags}`,
        `Media: ${media}`,
        `Quote RT: ${qrt}`,
        `Conversation ID: ${convId}`,
      ].filter(Boolean).join("\n"),
    };
  }

  // user
  const name = data.name || id;
  const bio = data.description || "No bio";
  const followers = data.followers_count || 0;
  const following = data.following_count || 0;
  const tweets = data.tweet_count || 0;
  const location = data.location || "Unknown";

  return {
    content: [
      `${name} (@${data.screen_name || id})`,
      `Bio: ${bio}`,
      `Location: ${location}`,
      `Followers: ${followers} | Following: ${following} | Tweets: ${tweets}`,
    ].join("\n"),
  };
}