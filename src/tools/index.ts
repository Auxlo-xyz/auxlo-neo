import type { Env, ToolDefinition, ToolResult } from "../types";
import { saveMemory, getMemory } from "../memory";

interface ToolContext {
  channel?: string;
  sessionId?: string;
}

export function getToolDefinitions(env: Env, ctx?: ToolContext): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    {
      type: "function",
      function: {
        name: "web_search",
        description: "Search the web using DuckDuckGo. Returns titles, URLs, and snippets. Use for current information, facts, news.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "The search query" },
            num_results: { type: "number", description: "Number of results (default 5, max 10)" },
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
              enum: ["telegram", "discord"],
              description: ctx?.channel === "telegram"
                ? "Use 'telegram' (you are in a Telegram chat)"
                : ctx?.channel === "discord"
                  ? "Use 'discord' (you are in a Discord channel)"
                  : "Channel to send to: 'telegram' or 'discord'",
            },
            target: {
              type: "string",
              description: ctx?.channel === "telegram"
                ? `Chat ID (your current session: ${ctx?.sessionId || "unknown"})`
                : ctx?.channel === "discord"
                  ? `Channel/user ID (your current session: ${ctx?.sessionId || "unknown"})`
                  : "Chat ID (Telegram) or channel/user ID (Discord)",
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
        name: "current_time",
        description: "Get the current date and time in UTC.",
        parameters: { type: "object", properties: {} },
      },
    },
  ];

  return tools;
}

export async function executeTool(
  env: Env,
  name: string,
  args: Record<string, unknown>,
  ctx?: ToolContext
): Promise<ToolResult> {
  try {
    switch (name) {
      case "web_search":
        return await toolWebSearch(args.query as string, (args.num_results as number) || 5);
      case "web_fetch":
        return await toolWebFetch(args.url as string, (args.max_chars as number) || 10000);
      case "send_message":
        return await toolSendMessage(env, args.channel as string, args.target as string, args.message as string);
      case "remember":
        return await toolRemember(env, ctx?.sessionId, args.key as string, args.value as string);
      case "recall":
        return await toolRecall(env, ctx?.sessionId, args.query as string);
      case "current_time":
        return { content: new Date().toISOString() };
      default:
        return { content: `Unknown tool: ${name}`, error: true };
    }
  } catch (err: any) {
    return { content: `Tool error: ${err.message}`, error: true };
  }
}

// ---- Tool implementations ----

async function toolWebSearch(query: string, numResults: number): Promise<ToolResult> {
  const encoded = encodeURIComponent(query);
  const response = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (compatible; AuxloNeo/1.0)",
    },
    body: `q=${encoded}`,
  });

  if (!response.ok) {
    return { content: `Search failed: HTTP ${response.status}`, error: true };
  }

  const html = await response.text();
  const results: { title: string; url: string; snippet: string }[] = [];

  const resultRegex = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([^<]*)<\/a>/g;
  let match;
  while ((match = resultRegex.exec(html)) !== null && results.length < numResults) {
    const rawUrl = match[1];
    const title = match[2].trim();
    const snippet = match[3].trim();
    const urlMatch = rawUrl.match(/uddg=([^&]+)/);
    const url = urlMatch ? decodeURIComponent(urlMatch[1]) : rawUrl;
    if (title && url) {
      results.push({ title, url, snippet });
    }
  }

  if (results.length === 0) {
    const simpleRegex = /<a[^>]+result__url[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g;
    while ((match = simpleRegex.exec(html)) !== null && results.length < numResults) {
      const rawUrl = match[1];
      const urlMatch = rawUrl.match(/uddg=([^&]+)/);
      const url = urlMatch ? decodeURIComponent(urlMatch[1]) : rawUrl;
      results.push({ title: "", url, snippet: "" });
    }
  }

  if (results.length === 0) {
    return { content: "No results found." };
  }

  const formatted = results
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
    .join("\n\n");

  return { content: formatted };
}

async function toolWebFetch(url: string, maxChars: number): Promise<ToolResult> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; AuxloNeo/1.0)",
      "Accept": "text/html,application/xhtml+xml,text/plain,application/json",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    return { content: `Fetch failed: HTTP ${response.status}`, error: true };
  }

  const contentType = response.headers.get("content-type") || "";
  let text = await response.text();

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

  if (channel === "discord") {
    const token = env.DISCORD_BOT_TOKEN;
    if (!token) return { content: "DISCORD_BOT_TOKEN not configured", error: true };

    const response = await fetch(`https://discord.com/api/v10/channels/${target}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: message }),
    });

    if (!response.ok) {
      const err = await response.text();
      return { content: `Discord send failed: ${err}`, error: true };
    }
    return { content: "Message sent via Discord" };
  }

  return { content: `Unknown channel: ${channel}. Use 'telegram' or 'discord'.`, error: true };
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

  await saveMemory(env.MEMORY, sessionId, key, value);

  // Also save to global memory (cross-session) with a different prefix
  await env.MEMORY.put(`global:${key}`, value, { expirationTtl: 60 * 60 * 24 * 90 }); // 90 days

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

  const results: string[] = [];

  // Search session-scoped memory
  if (sessionId) {
    const sessionMem = await getMemory(env.MEMORY, sessionId);
    if (sessionMem) {
      // Simple keyword match
      const lines = sessionMem.split("\n").filter(line =>
        line.toLowerCase().includes(query.toLowerCase())
      );
      results.push(...lines);
    }
  }

  // Search global memory
  const globalList = await env.MEMORY.list({ prefix: "global:", limit: 50 });
  for (const key of globalList.keys) {
    const val = await env.MEMORY.get(key.name);
    if (val && (val.toLowerCase().includes(query.toLowerCase()) || key.name.toLowerCase().includes(query.toLowerCase()))) {
      const label = key.name.replace("global:", "");
      results.push(`${label}: ${val}`);
    }
  }

  if (results.length === 0) {
    return { content: `No memories found matching "${query}"` };
  }

  return { content: results.join("\n") };
}
