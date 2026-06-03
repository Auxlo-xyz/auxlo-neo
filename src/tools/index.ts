import type { Env, ToolDefinition, ToolResult } from "../types";

export function getToolDefinitions(env: Env): ToolDefinition[] {
  return [
    {
      type: "function",
      function: {
        name: "web_search",
        description: "Search the web using DuckDuckGo. Returns titles, URLs, and snippets.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "The search query" },
            num_results: { type: "number", description: "Number of results to return (default 5, max 10)" },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "web_fetch",
        description: "Fetch a URL and return its text content. Useful for reading articles, docs, and web pages.",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "The URL to fetch" },
            max_chars: { type: "number", description: "Maximum characters to return (default 10000)" },
          },
          required: ["url"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "send_message",
        description: "Send a message to the user via Telegram or Discord.",
        parameters: {
          type: "object",
          properties: {
            channel: { type: "string", enum: ["telegram", "discord"], description: "Channel to send to" },
            target: { type: "string", description: "Chat ID (Telegram) or channel ID (Discord)" },
            message: { type: "string", description: "The message to send" },
          },
          required: ["channel", "target", "message"],
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
}

export async function executeTool(env: Env, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  try {
    switch (name) {
      case "web_search":
        return await toolWebSearch(args.query as string, (args.num_results as number) || 5);
      case "web_fetch":
        return await toolWebFetch(args.url as string, (args.max_chars as number) || 10000);
      case "send_message":
        return await toolSendMessage(env, args.channel as string, args.target as string, args.message as string);
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
  // Use DuckDuckGo HTML endpoint (no API key required)
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

  // Parse results from HTML
  const results: { title: string; url: string; snippet: string }[] = [];

  // Match result links -- DDG HTML format
  const resultRegex = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([^<]*)<\/a>/g;
  let match;
  while ((match = resultRegex.exec(html)) !== null && results.length < numResults) {
    const rawUrl = match[1];
    const title = match[2].trim();
    const snippet = match[3].trim();

    // DDG wraps URLs in a redirect -- extract actual URL
    const urlMatch = rawUrl.match(/uddg=([^&]+)/);
    const url = urlMatch ? decodeURIComponent(urlMatch[1]) : rawUrl;

    if (title && url) {
      results.push({ title, url, snippet });
    }
  }

  // Fallback: try a simpler regex if the above found nothing
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

  // Strip HTML tags for HTML content
  if (contentType.includes("text/html")) {
    // Remove scripts, styles, and tags
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
      body: JSON.stringify({
        chat_id: target,
        text: message,
        parse_mode: "Markdown",
      }),
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
