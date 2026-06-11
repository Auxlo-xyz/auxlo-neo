import type { Env, ToolDefinition, ToolResult } from "../types";
import { saveMemory, getMemory } from "../memory";
import { twitter } from "./platforms/twitter";
import { youtube } from "./platforms/youtube";

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
        name: "remote_exec",
        description: "Execute a shell command in a remote ephemeral Linux environment (Vercel Fluid Compute). Supports git, npm, python, ffmpeg, etc. Use this for repo analysis, builds, and automation.",
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "The shell command to execute (e.g., 'git clone ... && ls -R')"
            },
            workspace_id: {
              type: "string",
              description: "Optional ID to persist state across multiple execution calls."
            }
          },
          required: ["command"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "set_cron",
        description: "Create or update a cron trigger for autonomous periodic scanning. Requires CLOUDFLARE_API_TOKEN with Workers:Cron:Edit permission.",
        parameters: {
          type: "object",
          properties: {
            schedule: {
              type: "string",
              description: "Cron expression (e.g. '*/5 * * * *' for every 5 minutes, '0 * * * *' for hourly)"
            },
            action: {
              type: "string",
              enum: ["create", "delete"],
              description: "Create or delete the cron trigger"
            }
          },
          required: ["schedule", "action"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "list_crons",
        description: "List all cron triggers currently configured for this worker.",
        parameters: { type: "object", properties: {} }
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
          required: ["address"],
        },
      },
    },
          required: ["to", "amount"],
        },
      },
    },
          required: ["contract_address", "function_signature", "args"],
        },
      },
    },
          required: ["schema", "data", "data_id"],
        },
      },
    },
          required: ["schema", "publisher"],
        },
      },
    },
          required: ["target"],
        },
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
      case "x_fetch":
        return await toolXFetch(args.fetch_type as string, args.id as string);
      case "remote_exec":
        // Automatically inject workspace_id if missing to prevent LLM forgetfulness
        const workspaceId = (args.workspace_id as string) || ctx?.sessionId || "default_workspace";
        return await toolRemoteExec(env, args.command as string, workspaceId);
      case "current_time":
        return { content: new Date().toISOString() };
      case "set_cron":
        return await toolSetCron(env, args.cron as string, args.action as "create" | "delete", args.name as string | undefined);
      case "list_crons":
        return await toolListCrons(env);
