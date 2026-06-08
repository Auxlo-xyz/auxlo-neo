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
    {
      type: "function",
      function: {
        name: "somnia_balance",
        description: "Check the STT (Somnia Token) balance of a wallet address on the Somnia blockchain.",
        parameters: {
          type: "object",
          properties: {
            address: { type: "string", description: "The wallet address to check" },
          },
          required: ["address"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "somnia_send",
        description: "Send STT tokens to a wallet address on the Somnia blockchain.",
        parameters: {
          type: "object",
          properties: {
            to: { type: "string", description: "The recipient address" },
            amount: { type: "string", description: "The amount of STT to send (in ether units, e.g. '0.1')" },
          },
          required: ["to", "amount"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "somnia_call_contract",
        description: "Execute a function on a Somnia smart contract. Use this for minting, swapping, or interacting with dApps.",
        parameters: {
          type: "object",
          properties: {
            contract_address: { type: "string", description: "The address of the smart contract" },
            function_signature: { type: "string", description: "The function signature (e.g. 'mint(address,uint256)')" },
            args: { type: "array", items: { type: "string" }, description: "Arguments for the function" },
          },
          required: ["contract_address", "function_signature", "args"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "somnia_publish_stream",
        description: "Publish structured data to a Somnia Data Stream. Use this to broadcast your status, offer services to other agents, or record on-chain events.",
        parameters: {
          type: "object",
          properties: {
            schema: { type: "string", description: "The schema string (e.g. 'string message, uint256 timestamp')" },
            data: { type: "array", items: { type: "string" }, description: "The data values matching the schema" },
            data_id: { type: "string", description: "A unique ID for this data entry" },
          },
          required: ["schema", "data", "data_id"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "somnia_read_stream",
        description: "Read and decode data from a Somnia Data Stream. Use this to monitor other agents or projects.",
        parameters: {
          type: "object",
          properties: {
            schema: { type: "string", description: "The schema string to decode against" },
            publisher: { type: "string", description: "The wallet address of the publisher" },
          },
          required: ["schema", "publisher"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "somnia_snoop",
        description: "Advanced analysis tool: monitors a target (X handle or URL), analyzes its Somnia activity, and returns a 'Legitimacy Score' and action recommendation.",
        parameters: {
          type: "object",
          properties: {
            target: { type: "string", description: "X handle (e.g. '@somnia_network') or website URL" },
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
      case "somnia_balance":
        return await toolSomniaBalance(env, args.address as string);
      case "somnia_send":
        return await toolSomniaSend(env, args.to as string, args.amount as string);
      case "somnia_call_contract":
        return await toolSomniaCall(env, args.contract_address as string, args.function_signature as string, args.args as string[]);
      case "somnia_publish_stream":
        return await toolSomniaPublish(env, args.schema as string, args.data as string[], args.data_id as string);
      case "somnia_read_stream":
        return await toolSomniaRead(env, args.schema as string, args.publisher as string);
      case "somnia_snoop":
        return await toolSomniaSnoop(env, args.target as string, ctx);
      default:
        return { content: `Unknown tool: ${name}`, error: true };
    }
  } catch (err: any) {
    return { content: `Tool error: ${err.message}`, error: true };
  }
}

// ---- Tool implementations ----

async function toolSomniaBalance(env: Env, address: string): Promise<ToolResult> {
  const rpcUrl = env.SOMNIA_RPC_URL || "https://rpc.somnia.network";
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_getBalance",
      params: [address, "latest"],
      id: 1,
    }),
  });

  if (!response.ok) return { content: `RPC Error: ${response.status}`, error: true };
  const data = (await response.json()) as any;
  if (data.error) return { content: `RPC Error: ${data.error.message}`, error: true };

  const balanceHex = data.result;
  const balanceWei = BigInt(balanceHex);
  const balanceEth = Number(balanceWei) / 1e18;

  return { content: `Balance for ${address}: ${balanceEth} STT` };
}

async function toolSomniaSend(env: Env, to: string, amount: string): Promise<ToolResult> {
  // We use the Muscle (remote_exec) to sign and send the transaction
  const rpcUrl = env.SOMNIA_RPC_URL || "https://rpc.somnia.network";
  const privateKey = env.SOMNIA_PRIVATE_KEY;
  if (!privateKey) return { content: "SOMNIA_PRIVATE_KEY not configured", error: true };

  // Build a one-liner node script that uses ethers to send tokens
  // We install ethers on the fly in the muscle if not present
  const script = `
    const { ethers } = require('ethers');
    async function main() {
      const provider = new ethers.JsonRpcProvider('${rpcUrl}');
      const wallet = new ethers.Wallet('${privateKey}', provider);
      const tx = await wallet.sendTransaction({
        to: '${to}',
        value: ethers.parseEther('${amount}')
      });
      console.log(tx.hash);
      await tx.wait();
    }
    main().catch(console.error);
  `;

  const command = `npm install ethers && node -e "${script.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
  
  // Reuse the existing remote_exec logic
  return await toolRemoteExec(env, command);
}

async function toolSomniaCall(env: Env, contract: string, sig: string, args: string[]): Promise<ToolResult> {
  const rpcUrl = env.SOMNIA_RPC_URL || "https://rpc.somnia.network";
  const privateKey = env.SOMNIA_PRIVATE_KEY;
  if (!privateKey) return { content: "SOMNIA_PRIVATE_KEY not configured", error: true };

  const script = `
    const { ethers } = require('ethers');
    async function main() {
      const provider = new ethers.JsonRpcProvider('${rpcUrl}');
      const wallet = new ethers.Wallet('${privateKey}', provider);
      const iface = new ethers.Interface([ '${sig}' ]);
      const data = iface.encodeFunctionData('${sig}', ${JSON.stringify(args)});
      const tx = await wallet.sendTransaction({
        to: '${contract}',
        data: data
      });
      console.log(tx.hash);
      await tx.wait();
    }
    main().catch(console.error);
  `;

  const command = `npm install ethers && node -e "${script.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
  
  return await toolRemoteExec(env, command);
}

async function toolSomniaPublish(env: Env, schema: string, data: string[], dataId: string): Promise<ToolResult> {
  const rpcUrl = env.SOMNIA_RPC_URL || "https://rpc.somnia.network";
  const privateKey = env.SOMNIA_PRIVATE_KEY;
  if (!privateKey) return { content: "SOMNIA_PRIVATE_KEY not configured", error: true };

  const script = `
    const { ethers } = require('ethers');
    const { SDK } = require('@somnia-chain/streams');
    async function main() {
      const publicClient = ethers.JsonRpcProvider('${rpcUrl}');
      const walletClient = new ethers.Wallet('${privateKey}', publicClient);
      const sdk = new SDK({ public: publicClient, wallet: walletClient });
      const schemaId = sdk.streams.computeSchemaId('${schema}');
      await sdk.streams.set([{ id: '${dataId}', schemaId, data: JSON.stringify(${JSON.stringify(data)}) }]);
      console.log('Published successfully to stream');
    }
    main().catch(console.error);
  `;

  const command = `npm install ethers @somnia-chain/streams && node -e "${script.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
  return await toolRemoteExec(env, command);
}

async function toolSomniaRead(env: Env, schema: string, publisher: string): Promise<ToolResult> {
  const rpcUrl = env.SOMNIA_RPC_URL || "https://rpc.somnia.network";
  const script = `
    const { ethers } = require('ethers');
    const { SDK } = require('@somnia-chain/streams');
    async function main() {
      const publicClient = ethers.JsonRpcProvider('${rpcUrl}');
      const sdk = new SDK({ public: publicClient });
      const schemaId = sdk.streams.computeSchemaId('${schema}');
      const data = await sdk.streams.getAllPublisherDataForSchema(schemaId, '${publisher}');
      console.log(JSON.stringify(data));
    }
    main().catch(console.error);
  `;

  const command = `npm install ethers @somnia-chain/streams && node -e "${script.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
  return await toolRemoteExec(env, command);
}

async function toolSomniaSnoop(env: Env, target: string, ctx?: ToolContext): Promise<ToolResult> {
  let xInfo = "";
  let webInfo = "";
  let balanceInfo = "No associated wallet found in content.";
  let score = 0;
  let findings: string[] = [];

  // 1. X Intelligence
  try {
    const isUser = target.startsWith('@') || (!target.includes('://') && !target.includes('.') && !target.includes('/'));
    const xTarget = target.startsWith('@') ? target.slice(1) : target;
    const xResult = await toolXFetch(isUser ? "user" : "tweet", xTarget);
    if (!xResult.error) {
      xInfo = xResult.content;
      findings.push("X profile/tweet intelligence gathered.");
      if (xInfo.includes("[Verified]")) {
        score += 25;
        findings.push("Target is X Verified.");
      }
    }
  } catch (e: any) {
    findings.push(`X intelligence failed: ${e.message}`);
  }

  // 2. Web Intelligence
  try {
    const webResult = await toolWebFetch(target, 5000);
    if (!webResult.error) {
      webInfo = webResult.content;
      findings.push("Web/Doc intelligence gathered.");
      if (webInfo.length > 500) score += 25; // Content density check
    }
  } catch (e: any) {
    findings.push(`Web intelligence failed: ${e.message}`);
  }

  // 3. On-Chain Intelligence (Heuristic search for 0x...)
  const addressMatch = (xInfo + webInfo).match(/0x[a-fA-F0-9]{40}/);
  if (addressMatch) {
    const address = addressMatch[0];
    findings.push(`Detected wallet: ${address}`);
    const balResult = await toolSomniaBalance(env, address);
    if (!balResult.error) {
      balanceInfo = balResult.content;
      findings.push("Somnia on-chain activity verified.");
      const balMatch = balanceInfo.match(/(\d+\.?\d*) STT/);
      if (balMatch && parseFloat(balMatch[1]) > 0) {
        score += 50;
        findings.push("Wallet has active STT balance.");
      }
    } else {
      balanceInfo = balResult.content;
    }
  }

  // 4. Synthesis
  const summary = [
    `--- Somnia Snoop Report: ${target} ---`,
    `Legitimacy Score: ${score}/100`,
    `Findings:`,
    findings.map(f => `- ${f}`).join('\n'),
    `\nSummary:`,
    `X Intel: ${xInfo.slice(0, 150)}${xInfo.length > 150 ? '...' : ''}`,
    `Web Intel: ${webInfo.slice(0, 150)}${webInfo.length > 150 ? '...' : ''}`,
    `Balance: ${balanceInfo}`
  ].join('\n');

  return { content: summary };
}

// ---- Cron Management Tools ----

async function toolSetCron(env: Env, cron: string, action: "create" | "delete", name?: string): Promise<ToolResult> {
  const apiToken = env.CLOUDFLARE_API_TOKEN;
  if (!apiToken) {
    return { content: "CLOUDFLARE_API_TOKEN not configured. Required for autonomous cron management.", error: true };
  }

  const accountId = "44a1ecaec103e8647173ede4e002fc26";
  const workerName = "auxlo-neo";

  try {
    // Get existing schedules
    const listUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}/schedules`;
    const listResp = await fetch(listUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!listResp.ok) {
      const err = await listResp.text();
      return { content: `Failed to list schedules: ${err}`, error: true };
    }

    const listData = await listResp.json() as { result?: Array<{ cron: string }> };
    const existing = listData.result || [];

    if (action === "delete") {
      const filtered = existing.filter(s => s.cron !== cron);
      const result = await fetch(listUrl, {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(filtered),
      });
      if (!result.ok) {
        const err = await result.text();
        return { content: `Failed to delete cron: ${err}`, error: true };
      }
      return { content: `Cron "${cron}" deleted.` };
    }

    // Create/update
    if (!existing.find(s => s.cron === cron)) {
      existing.push({ cron });
    }
    const result = await fetch(listUrl, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(existing),
    });
    if (!result.ok) {
      const err = await result.text();
      return { content: `Failed to set cron: ${err}`, error: true };
    }
    return { content: `Cron "${cron}" scheduled. Worker will run on this schedule.` };
  } catch (err: any) {
    return { content: `Cron management failed: ${err.message}`, error: true };
  }
}

async function toolListCrons(env: Env): Promise<ToolResult> {
  const apiToken = env.CLOUDFLARE_API_TOKEN;
  if (!apiToken) {
    return { content: "CLOUDFLARE_API_TOKEN not configured.", error: true };
  }

  const accountId = "44a1ecaec103e8647173ede4e002fc26";
  const workerName = "auxlo-neo";

  try {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}/schedules`;
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!resp.ok) {
      const err = await resp.text();
      return { content: `Failed to list crons: ${err}`, error: true };
    }

    const data = await resp.json() as { result?: Array<{ cron: string }> };
    const schedules = data.result || [];

    if (schedules.length === 0) {
      return { content: "No cron triggers configured." };
    }

    return { content: `Active cron schedules:\n${schedules.map(s => `- ${s.cron}`).join("\n")}` };
  } catch (err: any) {
    return { content: `List crons failed: ${err.message}`, error: true };
  }
}

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
    const author = data.author?.name || "Unknown";
    const handle = data.author?.screenName || "";
    const likes = data.likes || 0;
    const retweets = data.retweets || 0;
    const replies = data.replies || 0;
    const date = data.date || "";
    const media = data.mediaURLs?.length ? data.mediaURLs.join(", ") : "none";

    return {
      content: [
        `Tweet by ${author} (@${handle})`,
        `Date: ${date}`,
        "",
        text,
        "",
        `Likes: ${likes} | Retweets: ${retweets} | Replies: ${replies}`,
        media !== "none" ? `Media: ${media}` : "",
      ].filter(Boolean).join("\n"),
    };
  }

  // user
  const name = data.name || id;
  const bio = data.bio || "No bio";
  const followers = data.followers || 0;
  const following = data.following || 0;
  const tweets = data.statusesCount || 0;
  const verified = data.verified || false;

  return {
    content: [
      `${name} (@${id})${verified ? " [Verified]" : ""}`,
      bio,
      `Followers: ${followers} | Following: ${following} | Tweets: ${tweets}`,
    ].join("\n"),
  };
}

async function toolRemoteExec(env: Env, command: string, workspaceId?: string): Promise<ToolResult> {
  const executorUrl = env.EXECUTOR_URL;
  if (!executorUrl) {
    return { content: "Remote executor not configured. Please set EXECUTOR_URL in environment.", error: true };
  }

  try {
    const response = await fetch(executorUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command,
        workspace_id: workspaceId,
        api_key: env.MUSCLE_API_KEY, // Use the specific Muscle API Key for authentication
      }),
    });

    if (!response.ok) {
      return { content: `Executor error: HTTP ${response.status}`, error: true };
    }

    const data: any = await response.json();
    const stdout = data.stdout || "";
    const stderr = data.stderr || "";

    return {
      content: (stdout && stderr) 
        ? `STDOUT:\n${stdout}\n\nSTDERR:\n${stderr}` 
        : stdout || stderr || "Command executed successfully with no output.",
    };
  } catch (e: any) {
    return { content: `Execution failed: ${e.message}`, error: true };
  }
}

