import type { Env, Skill, ToolDefinition, ToolResult } from "../../types";

export const byrealCliWrapperSkill: Skill = {
  id: "byreal-cli-wrapper",
  title: "Byreal Agent Wrapper",
  description:
    "Autonomous Byreal DEX operations on Solana: monitor pools, execute swaps, manage CLMM positions, and broadcast alpha signals. Wraps the byreal-agent-skills CLI for AI agents.",
  instructions: `# Byreal Agent Wrapper Skill

## Role
You are an autonomous DeFi operator for Byreal DEX on Solana. You monitor pools, execute swaps, manage CLMM positions, and publish alpha signals — all without user prompts.

## Capabilities
- Real-time pool monitoring (APR, TVL, volume, risk)
- Autonomous swap execution with slippage guards
- Position lifecycle: open, increase, decrease, close, claim
- Wallet balance and address checks
- Alpha signal publishing via Mantle Data Streams
- Autonomous rebalancing based on market conditions

## Hard Constraints
1. Never expose private keys
2. Always preview with --dry-run before --confirm
3. Abort if slippage > 200 bps without explicit user override
4. Large amounts (>$1000) require confirmation
5. Full transaction hashes and addresses only — never truncate
6. Use -o json for parsing only; render human-readable output for users`,
  builtin: true,
};

// Tool definitions for Byreal agent integration
export function getByrealToolDefinitions(): ToolDefinition[] {
  return [
    {
      type: "function",
      function: {
        name: "byreal_pools_list",
        description:
          "List Byreal CLMM pools with sorting/filtering. Returns pool addresses, APR, TVL, volume, and token pairs.",
        parameters: {
          type: "object",
          properties: {
            sort_field: {
              type: "string",
              enum: ["apr24h", "tvl", "volume24h", "fee24h"],
              description: "Sort field (default: apr24h)",
            },
            min_apr: { type: "number", description: "Minimum APR filter" },
            min_tvl: { type: "number", description: "Minimum TVL in USD" },
            limit: { type: "number", description: "Max results (default 20)" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "byreal_pools_analyze",
        description:
          "Deep analysis of a Byreal pool: APR breakdown, risk score, volatility, recommended price ranges, and impermanent loss projection.",
        parameters: {
          type: "object",
          properties: {
            pool_address: { type: "string", description: "Pool address (mint)" },
          },
          required: ["pool_address"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "byreal_positions_list",
        description:
          "List CLMM positions. Can show own wallet or any address via --user.",
        parameters: {
          type: "object",
          properties: {
            user_address: {
              type: "string",
              description: "Wallet address (omit for own wallet)",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "byreal_positions_open",
        description:
          "Open a new CLMM position on Byreal. Supports --auto-swap for single-token entry.",
        parameters: {
          type: "object",
          properties: {
            pool_address: { type: "string", description: "Pool address" },
            price_lower: { type: "number", description: "Lower price bound" },
            price_upper: { type: "number", description: "Upper price bound" },
            amount: { type: "number", description: "Amount in base token" },
            base_mint: { type: "string", description: "Base token mint address" },
            auto_swap: { type: "boolean", description: "Use auto-swap (default false)" },
            dry_run: { type: "boolean", description: "Preview only (default true)" },
            confirm: { type: "boolean", description: "Execute transaction" },
          },
          required: ["pool_address", "price_lower", "price_upper", "amount"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "byreal_positions_close",
        description: "Close a CLMM position and withdraw liquidity.",
        parameters: {
          type: "object",
          properties: {
            nft_mint: { type: "string", description: "Position NFT mint address" },
            auto_swap: { type: "boolean", description: "Auto-swap to single token" },
            output_mint: {
              type: "string",
              description: "Token mint to receive (if auto-swap)",
            },
            dry_run: { type: "boolean", description: "Preview only (default true)" },
            confirm: { type: "boolean", description: "Execute transaction" },
          },
          required: ["nft_mint"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "byreal_positions_claim",
        description:
          "Claim trading fees and incentive rewards from a CLMM position.",
        parameters: {
          type: "object",
          properties: {
            nft_mint: { type: "string", description: "Position NFT mint address" },
            claim_rewards: { type: "boolean", description: "Also claim incentive rewards" },
          },
          required: ["nft_mint"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "byreal_swap_execute",
        description:
          "Execute a token swap on Byreal with slippage control and price impact estimation.",
        parameters: {
          type: "object",
          properties: {
            input_mint: { type: "string", description: "Input token mint" },
            output_mint: { type: "string", description: "Output token mint" },
            amount: { type: "number", description: "Amount to swap" },
            slippage_bps: { type: "number", description: "Slippage tolerance (bps, default 50)" },
            dry_run: { type: "boolean", description: "Preview only (default true)" },
            confirm: { type: "boolean", description: "Execute transaction" },
          },
          required: ["input_mint", "output_mint", "amount"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "byreal_wallet_address",
        description: "Get the configured Byreal wallet address.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "byreal_wallet_balance",
        description: "Get token balances for the Byreal wallet.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "byreal_overview",
        description:
          "Get global Byreal DEX statistics: TVL, 24h volume, fees, and top pools.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "byreal_publish_alpha",
        description:
          "Publish an alpha signal to Mantle Data Streams for other agents to consume.",
        parameters: {
          type: "object",
          properties: {
            signal_type: {
              type: "string",
              enum: ["pool_opportunity", "whale_alert", "rebalance_signal", "risk_update"],
            },
            pool_address: { type: "string", description: "Related pool address" },
            apr: { type: "number", description: "Current APR percentage" },
            risk_score: { type: "number", description: "Risk score 0-100" },
            message: { type: "string", description: "Alpha signal details" },
          },
          required: ["signal_type", "message"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "byreal_autonomous_scan",
        description:
          "Run an autonomous market scan: find top pools by APR, analyze risk, and optionally execute positions.",
        parameters: {
          type: "object",
          properties: {
            min_apr: { type: "number", description: "Minimum APR threshold (default 20)" },
            max_risk: { type: "number", description: "Max risk score 0-100 (default 30)" },
            auto_execute: { type: "boolean", description: "Auto-open positions if criteria met" },
            dry_run: { type: "boolean", description: "Preview only (default true)" },
          },
        },
      },
    },
  ];
}

// Execute a Byreal tool via remote_exec (Muscle environment runs byreal-cli)
export async function executeByrealTool(
  env: Env,
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const executorUrl = env.EXECUTOR_URL;
  if (!executorUrl) {
    return { content: "Remote executor not configured. Set EXECUTOR_URL.", error: true };
  }

  // Build byreal-cli command
  let command: string;
  const dryRun = args.dry_run !== false;
  const confirm = args.confirm === true;

  switch (name) {
    case "byreal_pools_list": {
      const sort = (args.sort_field as string) || "apr24h";
      const minApr = args.min_apr ? `--min-apr ${args.min_apr}` : "";
      const minTvl = args.min_tvl ? `--min-tvl ${args.min_tvl}` : "";
      const limit = args.limit ? `--limit ${args.limit}` : "--limit 20";
      command = `byreal-cli pools list --sort-field ${sort} ${minApr} ${minTvl} ${limit}`;
      break;
    }
    case "byreal_pools_analyze": {
      const pool = args.pool_address as string;
      command = `byreal-cli pools analyze ${pool}`;
      break;
    }
    case "byreal_positions_list": {
      const user = args.user_address ? `--user ${args.user_address}` : "";
      command = `byreal-cli positions list ${user}`;
      break;
    }
    case "byreal_positions_open": {
      const pool = args.pool_address as string;
      const lower = args.price_lower as number;
      const upper = args.price_upper as number;
      const amount = args.amount as number;
      const base = args.base_mint as string;
      const autoSwap = args.auto_swap ? "--auto-swap" : "";
      const flags = dryRun ? "--dry-run" : confirm ? "--confirm" : "";
      command = `byreal-cli positions open --pool ${pool} --price-lower ${lower} --price-upper ${upper} --amount ${amount} --base ${base} ${autoSwap} ${flags}`;
      break;
    }
    case "byreal_positions_close": {
      const nft = args.nft_mint as string;
      const autoSwap = args.auto_swap ? "--auto-swap" : "";
      const output = args.output_mint ? `--output-mint ${args.output_mint}` : "";
      const flags = dryRun ? "--dry-run" : confirm ? "--confirm" : "";
      command = `byreal-cli positions close --nft-mint ${nft} ${autoSwap} ${output} ${flags}`;
      break;
    }
    case "byreal_positions_claim": {
      const nft = args.nft_mint as string;
      const rewards = args.claim_rewards ? "--claim-rewards" : "";
      command = `byreal-cli positions claim --nft-mint ${nft} ${rewards}`;
      break;
    }
    case "byreal_swap_execute": {
      const inMint = args.input_mint as string;
      const outMint = args.output_mint as string;
      const amount = args.amount as number;
      const slippage = args.slippage_bps ? `--slippage-bps ${args.slippage_bps}` : "";
      const flags = dryRun ? "--dry-run" : confirm ? "--confirm" : "";
      command = `byreal-cli swap execute --input-mint ${inMint} --output-mint ${outMint} --amount ${amount} ${slippage} ${flags}`;
      break;
    }
    case "byreal_wallet_address":
      command = "byreal-cli wallet address";
      break;
    case "byreal_wallet_balance":
      command = "byreal-cli wallet balance";
      break;
    case "byreal_overview":
      command = "byreal-cli overview";
      break;
    case "byreal_publish_alpha": {
      const signalType = args.signal_type as string;
      const pool = args.pool_address as string;
      const apr = args.apr as number;
      const risk = args.risk_score as number;
      const msg = args.message as string;
      const jsonPayload = JSON.stringify({
        schema: "string signal_type, string pool_address, number apr, number risk_score, string message, uint256 timestamp",
        data: [signalType, pool, apr, risk, msg, Math.floor(Date.now() / 1000)],
        data_id: `alpha_${Date.now()}`,
      });
      command = `curl -s -X POST ${env.MANTLE_RPC_MAINNET || "https://rpc.mantle.xyz"} -H "Content-Type: application/json" -d '${jsonPayload}'`;
      break;
    }
    case "byreal_autonomous_scan": {
      const minApr = args.min_apr || 20;
      const maxRisk = args.max_risk || 30;
      const autoExec = args.auto_execute ? "--auto-execute" : "";
      const flags = dryRun ? "--dry-run" : "";
      command = `byreal-cli autonomous scan --min-apr ${minApr} --max-risk ${maxRisk} ${autoExec} ${flags}`;
      break;
    }
    default:
      return { content: `Unknown Byreal tool: ${name}`, error: true };
  }

  const result = await toolRemoteExec(env, command, "byreal-" + Date.now());
  if (result.error) {
    return result;
  }

  // Post-process: add explorer links for pool/tx data
  if (name.startsWith("byreal_pools") && result.content) {
    return {
      content: result.content + "\n\nSolscan: https://solscan.io",
    };
  }
  return result;
}

// Remote exec helper (shared with mantle-chain skill)
async function toolRemoteExec(env: Env, command: string, workspaceId?: string): Promise<ToolResult> {
  const response = await fetch(env.EXECUTOR_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      command,
      workspace_id: workspaceId,
      api_key: env.MUSCLE_API_KEY,
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
}
