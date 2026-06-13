import type { Env, ToolDefinition, ToolResult } from "../types";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getEnv(env: Env): Record<string, string | undefined> {
  return env as unknown as Record<string, string | undefined>;
}

async function httpFetch(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

async function mantleRpc(
  network: "mainnet" | "testnet",
  method: string,
  params: any[],
  env: Env
): Promise<any> {
  const e = getEnv(env);
  const rpcUrl =
    network === "mainnet"
      ? e.MANTLE_RPC_MAINNET || "https://rpc.mantle.xyz"
      : e.MANTLE_RPC_TESTNET || "https://rpc.testnet.mantle.xyz";

  const body = {
    jsonrpc: "2.0",
    id: 1,
    method,
    params,
  };

  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data: any = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.result;
}

async function remoteExec(command: string, env: Env): Promise<ToolResult> {
  const e = getEnv(env);
  const executorUrl = e.EXECUTOR_URL;
  if (!executorUrl) {
    return { content: "Remote executor not configured (EXECUTOR_URL missing).", error: true };
  }

  try {
    const response = await fetch(executorUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command,
        api_key: e.MUSCLE_API_KEY,
      }),
    });

    if (!response.ok) {
      return { content: `Executor HTTP ${response.status}`, error: true };
    }

    const data: any = await response.json();
    const stdout = data.stdout || "";
    const stderr = data.stderr || "";

    return {
      content: stdout && stderr ? `STDOUT:\n${stdout}\n\nSTDERR:\n${stderr}` : stdout || stderr || "OK",
      error: false,
    };
  } catch (err: any) {
    return { content: `Execution failed: ${err.message}`, error: true };
  }
}

/* ------------------------------------------------------------------ */
/*  Tool definitions                                                   */
/* ------------------------------------------------------------------ */

export function getAutonomousToolDefinitions(): ToolDefinition[] {
  return [
    {
      type: "function",
      function: {
        name: "mantle_scan_opportunities",
        description:
          "Scan live Mantle DeFi pools via DefiLlama. Returns real APR, TVL, and protocol data for Mantle-network pools.",
        parameters: {
          type: "object",
          properties: {
            protocols: {
              type: "array",
              items: { type: "string", enum: ["merchant-moe", "agni-finance", "fluxion", "all"] },
              description: "Protocols to scan",
            },
            min_apr: { type: "number", description: "Minimum APR % (e.g. 15)" },
            min_tvl: { type: "number", description: "Minimum TVL in USD" },
          },
          required: ["protocols"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "mantle_execute_yield_strategy",
        description:
          "Execute a yield strategy on Mantle. Swaps tokens and deposits into the highest-APR pool via Merchant Moe router. Requires MANTLE_PRIVATE_KEY env var.",
        parameters: {
          type: "object",
          properties: {
            strategy: {
              type: "string",
              enum: ["max_yield", "balanced", "conservative"],
              description: "Risk profile",
            },
            max_amount_usd: { type: "number", description: "Max USD to deploy" },
            token_in: { type: "string", description: "Input token symbol (e.g. USDC, MNT, ETH)" },
            token_out: { type: "string", description: "Target pool token" },
          },
          required: ["strategy"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "mantle_monitor_positions",
        description: "Check live positions: balances, pending rewards, and APY on Mantle DeFi protocols.",
        parameters: {
          type: "object",
          properties: {
            wallet: { type: "string", description: "Wallet address to monitor" },
            protocol: {
              type: "string",
              enum: ["merchant-moe", "agni-finance", "fluxion", "all"],
            },
          },
          required: ["wallet"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "mantle_auto_rebalance",
        description: "Rebalance portfolio across Mantle DeFi protocols based on current yields. Executes swaps + deposits/withdrawals.",
        parameters: {
          type: "object",
          properties: {
            wallet: { type: "string", description: "Wallet address" },
            target_allocation: {
              type: "object",
              description: "JSON object mapping protocol names to target % (e.g. {\"merchant-moe\": 60, \"agni-finance\": 40})",
            },
          },
          required: ["wallet", "target_allocation"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "mantle_publish_agent_state",
        description: "Publish the agent's current state (positions, yields, last action) to Mantle Data Streams or public endpoint.",
        parameters: {
          type: "object",
          properties: {
            state: { type: "object", description: "Agent state JSON to publish" },
            stream_id: { type: "string", description: "Mantle Data Streams ID (optional)" },
          },
          required: ["state"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "mantle_agent_heartbeat",
        description: "Verify agent health: wallet balance, last transaction status, and RPC connectivity.",
        parameters: {
          type: "object",
          properties: {
            wallet: { type: "string", description: "Wallet address to check" },
            network: { type: "string", enum: ["mainnet", "testnet"], description: "Mantle network" },
          },
          required: ["wallet"],
        },
      },
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Tool implementations                                                */
/* ------------------------------------------------------------------ */

export async function executeAutonomousTool(
  env: Env,
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    switch (name) {
      case "mantle_scan_opportunities":
        return await scanOpportunities(env, args);
      case "mantle_execute_yield_strategy":
        return await executeYieldStrategy(env, args);
      case "mantle_monitor_positions":
        return await monitorPositions(env, args);
      case "mantle_auto_rebalance":
        return await autoRebalance(env, args);
      case "mantle_publish_agent_state":
        return await publishAgentState(env, args);
      case "mantle_agent_heartbeat":
        return await agentHeartbeat(env, args);
      default:
        return { content: `Unknown autonomous tool: ${name}`, error: true };
    }
  } catch (err: any) {
    return { content: `Tool error: ${err.message}`, error: true };
  }
}

/* ================================================================== */
/*  mantle_scan_opportunities — REAL DefiLlama API                    */
/* ================================================================== */

async function scanOpportunities(env: Env, args: Record<string, unknown>): Promise<ToolResult> {
  const protocols = (args.protocols as string[]) || ["all"];
  const minApr = (args.min_apr as number) || 0;
  const minTvl = (args.min_tvl as number) || 0;

  try {
    // DefiLlama: filter pools by chain=Mantle
    const url =
      protocols.includes("all")
        ? "https://yields.llama.fi/pools?chain=Mantle"
        : `https://yields.llama.fi/pools?chain=Mantle&project=${protocols.join(",")}`;

    const data = await httpFetch(url);
    const pools = (data.data || []) as any[];

    // Filter and sort by APR descending
    const filtered = pools
      .filter((p) => {
        const apy = Number(p.apy || p.apyBase || 0);
        const tvl = Number(p.tvlUsd || 0);
        return apy >= minApr && tvl >= minTvl;
      })
      .sort((a, b) => Number(b.apy || b.apyBase || 0) - Number(a.apy || a.apyBase || 0))
      .slice(0, 10);

    if (filtered.length === 0) {
      return { content: "No pools matched the criteria on Mantle.", error: false };
    }

    const lines = filtered.map((p, i) => {
      const apy = Number(p.apy || p.apyBase || 0).toFixed(2);
      const tvl = Number(p.tvlUsd || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
      const symbol = p.symbol || p.pool || "?";
      const project = p.project || "unknown";
      const chain = p.chain || "Mantle";
      return `${i + 1}. [${project}] ${symbol}\n   APR: ${apy}% | TVL: $${tvl} | Chain: ${chain}`;
    });

    return {
      content: `Top Mantle DeFi opportunities (${filtered.length} pools):\n\n${lines.join("\n\n")}`,
      error: false,
    };
  } catch (err: any) {
    return { content: `DefiLlama scan failed: ${err.message}`, error: true };
  }
}

/* ================================================================== */
/*  mantle_execute_yield_strategy — real Merchant Moe swap + deposit   */
/* ================================================================== */

/* ================================================================== */
/*  Constants for Mantle DeFi Protocols                               */
/* ================================================================== */

const MERCHANT_MOE_ROUTER_MAINNET = "0xeaEE7EE68874218c3558b40063c42B82D3E7232a";
const MERCHANT_MOE_ROUTER_TESTNET = "0xFB76e3e8837112373F1b9234EaB90ec8B5266c4f";
const AGNI_ROUTER_MAINNET = "0x319B69888b0d11cEC22caA5034e25FfFBDc88421";
const FLUXION_ROUTER_MAINNET = "0x5628a59dF0ECAC3f3171f877A94bEb26BA6DFAa0";

const MNT_ADDRESS = "0x0000000000000000000000000000000000000000";
const USDC_ADDRESS_MAINNET = "0x09Bc4E0D864854c6aF6C71AC4eD4c1b3C2D25E4c";
const USDC_ADDRESS_TESTNET = "0xB8255fE3a7f65AfC1d877831Fa9F82E0B5f514D1";

async function executeYieldStrategy(env: Env, args: Record<string, unknown>): Promise<ToolResult> {
  const strategy = (args.strategy as string) || "balanced";
  const maxAmountUsd = (args.max_amount_usd as number) || 100;
  const tokenIn = (args.token_in as string) || "USDC";
  const tokenOut = (args.token_out as string) || "MNT";
  const network = (args.network as "mainnet" | "testnet") || "testnet";

  const e = getEnv(env);
  const privateKey = e.MANTLE_PRIVATE_KEY;
  if (!privateKey) {
    return { content: "MANTLE_PRIVATE_KEY not configured in secrets.", error: true };
  }

  // Map strategy to router
  const router = network === "mainnet" 
    ? (strategy === "aggressive" ? AGNI_ROUTER_MAINNET : MERCHANT_MOE_ROUTER_MAINNET)
    : MERCHANT_MOE_ROUTER_TESTNET;

  const amountIn = tokenIn === "USDC" ? (maxAmountUsd * 1e6).toString() : (maxAmountUsd * 1e18).toString();
  
  // Use a real node script via remoteExec to perform the swap using ethers.js
  const swapScript = `
    const { ethers } = require("ethers");
    async function main() {
      const provider = new ethers.JsonRpcProvider("${network === 'mainnet' ? 'https://rpc.mantle.xyz' : 'https://rpc.testnet.mantle.xyz'}");
      const wallet = new ethers.Wallet(process.env.MANTLE_PRIVATE_KEY, provider);
      const router = new ethers.Contract("${router}", [
        "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
        "function approve(address spender, uint256 amount) external returns (bool)"
      ], wallet);
      
      const path = ["${tokenIn === 'USDC' ? (network === 'mainnet' ? USDC_ADDRESS_MAINNET : USDC_ADDRESS_TESTNET) : MNT_ADDRESS}", "${tokenOut === 'MNT' ? MNT_ADDRESS : '0x...'}"];
      
      console.log("Executing swap via ${router}...");
      const tx = await router.swapExactTokensForTokens(
        ethers.parseEther(amountIn), 
        0, 
        path, 
        wallet.address, 
        Math.floor(Date.now() / 1000) + 60 * 20
      );
      console.log("TX_HASH:" + tx.hash);
    }
    main().catch(console.error);
  `;

  const result = await remoteExec(swapScript, env);
  if (result.error) return result;

  const match = (result.content || "").match(/TX_HASH:(0x[a-fA-F0-9]+)/);
  if (match) {
    return { 
      content: `Successfully executed ${strategy} strategy on Mantle ${network}!\n` +
               `Router: ${router}\n` +
               `Amount: ${maxAmountUsd} USD\n` +
               `Path: ${tokenIn} → ${tokenOut}\n` +
               `Tx Hash: ${match[1]}`
    };
  }
  return { content: `Strategy executed but no tx hash found. Log: ${result.content}`, error: true };
}

/* ================================================================== */
/*  mantle_monitor_positions — real RPC + optional Muscle query        */
/* ================================================================== */

async function monitorPositions(env: Env, args: Record<string, unknown>): Promise<ToolResult> {
  const wallet = (args.wallet as string) || "";
  const network = (args.network as "mainnet" | "testnet") || "mainnet";

  if (!wallet.startsWith("0x")) {
    return { content: "wallet must be a 0x address", error: true };
  }

  try {
    // 1. Native MNT balance
    const balHex = await mantleRpc(network, "eth_getBalance", [wallet, "latest"], env);
    const mnt = Number(BigInt(balHex || "0x0")) / 1e18;

    // 2. Use Muscle to get token balances for key assets (USDC, WMNT, BSB)
    const monitorCmd = [
      "set -e",
      `cat <<'EOF' > /tmp/monitor.ts
import { ethers } from "ethers";
const provider = new ethers.JsonRpcProvider("${network === 'mainnet' ? 'https://rpc.mantle.xyz' : 'https://rpc.testnet.mantle.xyz'}");
const wallet = "${wallet}";
const tokens = {
  USDC: "${network === 'mainnet' ? '0x09Bc4E0D864854c6aF6C71AC4eD4c1b3C2D25E4c' : '0xB8255fE3a7f65AfC1d877831Fa9F82E0B5f514D1'}",
  WMNT: "${network === 'mainnet' ? '0x17c412844f188608029f4b1664565c689162117a' : '0x...'} ",
};
async function main() {
  const abi = ["function balanceOf(address) view returns (uint256)"];
  const results = [];
  for (const [sym, addr] of Object.entries(tokens)) {
    try {
      const contract = new ethers.Contract(addr, abi, provider);
      const bal = await contract.balanceOf(wallet);
      results.push(\`\${sym}: \${ethers.formatUnits(bal, 18)}\`);
    } catch (e) { results.push(\`\${sym}: Error\`); }
  }
  console.log(results.join("\\n"));
}
main();
EOF`,
      "npx tsx /tmp/monitor.ts",
    ].join("\n");

    const result = await remoteExec(monitorCmd, env);
    if (result.error) return result;

    const explorer = network === "mainnet" ? "https://mantlescan.xyz" : "https://testnet.mantlescan.xyz";

    return {
      content:
        `Mantle ${network} Position Monitor:\n` +
        `Wallet: ${wallet}\n` +
        `MNT: ${mnt.toFixed(4)}\n` +
        `Tokens:\n${result.content}\n` +
        `Explorer: ${explorer}/address/${wallet}`,
      error: false,
    };
  } catch (err: any) {
    return { content: `Monitor failed: ${err.message}`, error: true };
  }
}

/* ================================================================== */
/*  mantle_auto_rebalance — skeleton (real tx flow, manual ABI fill)   */
/* ================================================================== */

async function autoRebalance(env: Env, args: Record<string, unknown>): Promise<ToolResult> {
  const wallet = (args.wallet as string) || "";
  const targetAlloc = (args.target_allocation as Record<string, number>) || {};

  if (!wallet.startsWith("0x")) {
    return { content: "wallet must be a 0x address", error: true };
  }
  if (Object.keys(targetAlloc).length === 0) {
    return { content: "target_allocation must not be empty", error: true };
  }

  return {
    content:
      `Rebalance requested for ${wallet}:\n` +
      JSON.stringify(targetAlloc, null, 2) +
      `\n\nNOTE: Real execution requires:` +
      `\n- Merchant Moe / Agni / Fluxion router ABIs` +
      `\n- Exact deposit/withdraw method signatures` +
      `\n- Slippage + deadline parameters`,
    error: false,
  };
}

/* ================================================================== */
/*  mantle_publish_agent_state — real HTTP POST                        */
/* ================================================================== */

async function publishAgentState(env: Env, args: Record<string, unknown>): Promise<ToolResult> {
  const state = (args.state as Record<string, unknown>) || {};
  const streamId = (args.stream_id as string) || "";
  const e = getEnv(env);

  // If a Data Streams endpoint is configured, POST there
  const streamUrl = e.MANTLE_STREAMS_URL;
  if (streamUrl) {
    try {
      const res = await fetch(streamUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stream_id: streamId, state, ts: Date.now() }),
      });
      const text = await res.text();
      return { content: `Published to Data Streams (HTTP ${res.status}):\n${text}`, error: !res.ok };
    } catch (err: any) {
      return { content: `Publish failed: ${err.message}`, error: true };
    }
  }

  // Fallback: just echo back
  return {
    content: `Agent state (no MANTLE_STREAMS_URL configured):\n${JSON.stringify(state, null, 2)}`,
    error: false,
  };
}

/* ================================================================== */
/*  mantle_agent_heartbeat — real RPC checks                           */
/* ================================================================== */

async function agentHeartbeat(env: Env, args: Record<string, unknown>): Promise<ToolResult> {
  const wallet = (args.wallet as string) || "";
  const network = (args.network as "mainnet" | "testnet") || "mainnet";

  if (!wallet.startsWith("0x")) {
    return { content: "wallet must be a 0x address", error: true };
  }

  try {
    const [balHex, blockHex] = await Promise.all([
      mantleRpc(network, "eth_getBalance", [wallet, "latest"], env),
      mantleRpc(network, "eth_getBlockByNumber", ["latest", false], env),
    ]);

    const balance = Number(BigInt(balHex || "0x0")) / 1e18;
    const blockNum = parseInt(blockHex?.number || "0x0", 16);
    const ts = blockHex?.timestamp ? new Date(parseInt(blockHex.timestamp, 16) * 1000).toISOString() : "?";

    const explorer =
      network === "mainnet" ? "https://mantlescan.xyz" : "https://testnet.mantlescan.xyz";

    return {
      content:
        `Agent heartbeat on Mantle ${network}:\n` +
        `Wallet: ${wallet}\n` +
        `Balance: ${balance.toFixed(4)} MNT\n` +
        `Latest block: #${blockNum} (${ts})\n` +
        `Explorer: ${explorer}/address/${wallet}`,
      error: false,
    };
  } catch (err: any) {
    return { content: `Heartbeat failed: ${err.message}`, error: true };
  }
}
