import type { Env, Skill, ToolDefinition, ToolResult } from "../../types";

export const mantleChainSkill: Skill = {
  id: "mantle-chain",
  title: "MantleChain",
  description:
    "Mantle Network on-chain operations: read/write contracts, deploy scripts, query balances, publish data streams, and interact with DeFi protocols on Mantle.",
  instructions: `# MantleChain Skill

## Role
You are an on-chain operator for Mantle Network. You can deploy contracts, read/write state, query balances, and interact with DeFi protocols using the Mantle RPC and Ethers/Viem via remote execution.

## Capabilities
- Query account balances on Mantle
- Read contract state with eth_call
- Write transactions via eth_sendRawTransaction
- Deploy Solidity contracts using Hardhat in the Muscle runtime
- Monitor pending transactions
- Interact with Mantle DeFi protocols (Merchant Moe, Agni Finance, Fluxion)

## Workflow
1. Always check current gas prices before writes
2. Use eth_estimateGas before sending transactions
3. Verify transaction receipts after submission
4. Use block explorer links in user-facing reports
5. Guard all private keys in secrets only`,
  builtin: true,
};

export function buildMantleChainToolDefinitions(): ToolDefinition[] {
  return [
    {
      type: "function",
      function: {
        name: "mantle_get_balance",
        description: "Get the native MNT balance of an address on Mantle Mainnet or Testnet.",
        parameters: {
          type: "object",
          properties: {
            address: { type: "string", description: "Wallet address (0x...)" },
            network: {
              type: "string",
              enum: ["mainnet", "testnet"],
              description: "Mantle network to query",
            },
          },
          required: ["address", "network"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "mantle_call_contract",
        description: "Call a read-only contract function on Mantle. Uses eth_call via RPC.",
        parameters: {
          type: "object",
          properties: {
            to: { type: "string", description: "Contract address (0x...)" },
            data: { type: "string", description: "Calldata (hex)" },
            network: { type: "string", enum: ["mainnet", "testnet"] },
          },
          required: ["to", "data", "network"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "mantle_send_transaction",
        description: "Send a signed transaction to Mantle. The signed raw tx must be provided. Use remote_exec with ethers for signing.",
        parameters: {
          type: "object",
          properties: {
            signed_tx: { type: "string", description: "Signed raw transaction hex (0x...)" },
            network: { type: "string", enum: ["mainnet", "testnet"] },
          },
          required: ["signed_tx", "network"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "mantle_deploy_contract",
        description: "Compile and deploy a Solidity contract to Mantle Testnet using Hardhat in the Muscle environment.",
        parameters: {
          type: "object",
          properties: {
            contract_source: { type: "string", description: "Solidity source code (full .sol content)" },
            contract_name: { type: "string", description: "Contract name (e.g. 'MyToken')" },
            constructor_args: { type: "array", items: { type: "string" }, description: "Constructor arguments as strings" },
          },
          required: ["contract_source", "contract_name"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "mantle_get_tx_receipt",
        description: "Get transaction receipt by hash on Mantle.",
        parameters: {
          type: "object",
          properties: {
            tx_hash: { type: "string", description: "Transaction hash (0x...)" },
            network: { type: "string", enum: ["mainnet", "testnet"] },
          },
          required: ["tx_hash", "network"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "mantle_get_block",
        description: "Get the latest block number or a specific block on Mantle.",
        parameters: {
          type: "object",
          properties: {
            block_number: { type: "string", description: "Block number or 'latest'" },
            network: { type: "string", enum: ["mainnet", "testnet"] },
          },
          required: ["network"],
        },
      },
    },
  ];
}

export async function getMantleChainToolDefinitions(_env: Env): Promise<ToolDefinition[]> {
  return buildMantleChainToolDefinitions();
}

export async function executeMantleChainTool(
  env: Env,
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const anyEnv = env as unknown as Record<string, string | undefined>;
  const rpcMainnet = anyEnv.MANTLE_RPC_MAINNET || "https://rpc.mantle.xyz";
  const rpcTestnet = anyEnv.MANTLE_RPC_TESTNET || "https://rpc.testnet.mantle.xyz";
  const explorerMainnet = "https://mantlescan.xyz";
  const explorerTestnet = "https://testnet.mantlescan.xyz";

  function rpc(network: string): string {
    return network === "mainnet" ? rpcMainnet : rpcTestnet;
  }
  function explorer(network: string): string {
    return network === "mainnet" ? explorerMainnet : explorerTestnet;
  }

  async function remoteExec(command: string, workspaceId?: string): Promise<ToolResult> {
    const executorUrl = anyEnv.EXECUTOR_URL;
    if (!executorUrl) {
      return { content: "Remote executor not configured. Set EXECUTOR_URL.", error: true };
    }
    try {
      const response = await fetch(executorUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command,
          workspace_id: workspaceId,
          api_key: anyEnv.MUSCLE_API_KEY,
        }),
      });
      if (!response.ok) {
        return { content: `Executor error: HTTP ${response.status}`, error: true };
      }
      const data: any = await response.json();
      const stdout = data.stdout || "";
      const stderr = data.stderr || "";
      return {
        content:
          (stdout && stderr)
            ? `STDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`
            : stdout || stderr || "Command executed successfully with no output.",
      };
    } catch (e: any) {
      return { content: `Execution failed: ${e.message}`, error: true };
    }
  }

  try {
    switch (name) {
      case "mantle_get_balance": {
        const address = args.address as string;
        const network = args.network as string;
        const endpoint = rpc(network);
        const payload = {
          jsonrpc: "2.0",
          method: "eth_getBalance",
          params: [address, "latest"],
          id: 1,
        };
        const resp = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data: any = await resp.json();
        if (data.error) {
          return { content: `RPC error: ${data.error.message}`, error: true };
        }
        const wei = BigInt(data.result);
        const mnt = Number(wei) / 1e18;
        const exp = explorer(network);
        return {
          content:
            `Balance for ${address} on Mantle ${network}:\n` +
            `${mnt.toFixed(4)} MNT\n` +
            `Raw: ${wei.toString()} wei\n` +
            `Explorer: ${exp}/address/${address}`,
        };
      }

      case "mantle_call_contract": {
        const to = args.to as string;
        const data = args.data as string;
        const network = args.network as string;
        const endpoint = rpc(network);
        const payload = {
          jsonrpc: "2.0",
          method: "eth_call",
          params: [{ to, data }, "latest"],
          id: 1,
        };
        const resp = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data2: any = await resp.json();
        if (data2.error) {
          return { content: `Contract call failed: ${data2.error.message}`, error: true };
        }
        return {
          content:
            `Contract call result:\n${data2.result}\nExplorer: ${explorer(network)}/address/${to}`,
        };
      }

      case "mantle_send_transaction": {
        const signed_tx = args.signed_tx as string;
        const network = args.network as string;
        const endpoint = rpc(network);
        const payload = {
          jsonrpc: "2.0",
          method: "eth_sendRawTransaction",
          params: [signed_tx],
          id: 1,
        };
        const resp = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data3: any = await resp.json();
        if (data3.error) {
          return { content: `Send failed: ${data3.error.message}`, error: true };
        }
        const txHash = data3.result;
        const exp = explorer(network);
        return {
          content:
            `Transaction submitted!\n` +
            `Hash: ${txHash}\n` +
            `Explorer: ${exp}/tx/${txHash}\n` +
            `Use mantle_get_tx_receipt to confirm.`,
        };
      }

      case "mantle_deploy_contract": {
        const contract_source = args.contract_source as string;
        const contract_name = args.contract_name as string;
        const constructor_args = (args.constructor_args as string[]) || [];
        const deployCmd = [
          "set -e",
          "mkdir -p /tmp/mantle-deploy && cd /tmp/mantle-deploy",
          "npm init -y >/dev/null 2>&1 || true",
          "npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox ethers@^6 >/dev/null 2>&1 || true",
          "cat > hardhat.config.ts << 'HARDHAT_EOF'\n" +
            "import type { HardhatUserConfig } from \"hardhat/config\";\n" +
            "import \"@nomicfoundation/hardhat-toolbox\";\n" +
            "const config: HardhatUserConfig = {\n" +
            "  solidity: \"0.8.20\",\n" +
            "  networks: {\n" +
            "    mantleTestnet: {\n" +
            `      url: "${rpcTestnet}",\n` +
            "      accounts: [process.env.MANTLE_PRIVATE_KEY || \"\"],\n" +
            "      chainId: 5001,\n" +
            "    },\n" +
            "  },\n" +
            "};\n" +
            "export default config;\n" +
            "HARDHAT_EOF",
          "mkdir -p contracts",
          `cat > contracts/${contract_name}.sol << 'SOL_EOF'\n${contract_source}\nSOL_EOF`,
          "mkdir -p scripts",
          "cat > scripts/deploy.ts << 'DEPLOY_EOF'\n" +
            "import { ethers } from \"hardhat\";\n" +
            "async function main() {\n" +
            `  const Factory = await ethers.getContractFactory("${contract_name}");\n` +
            `  const args = ${JSON.stringify(constructor_args)};\n` +
            "  const contract = await Factory.deploy(...args);\n" +
            "  await contract.waitForDeployment();\n" +
            "  const address = await contract.getAddress();\n" +
            '  console.log("DEPLOYED:" + address);\n' +
            "}\n" +
            "main().catch(console.error);\n" +
            "DEPLOY_EOF",
          "npx hardhat run scripts/deploy.ts --network mantleTestnet",
        ].join("\n");

        const result = await remoteExec(deployCmd, "mantle-deploy-" + Date.now());
        if (result.error) {
          return result;
        }
        const match = (result.content || "").match(/DEPLOYED:(0x[a-fA-F0-9]+)/);
        if (match) {
          const address = match[1];
          return {
            content:
              `Contract deployed to Mantle Testnet!\n` +
              `Address: ${address}\n` +
              `Explorer: ${explorerTestnet}/address/${address}`,
          };
        }
        return {
          content: `Deploy command executed. Check output for contract address:\n${result.content}`,
        };
      }

      case "mantle_get_tx_receipt": {
        const tx_hash = args.tx_hash as string;
        const network = args.network as string;
        const endpoint = rpc(network);
        const payload = {
          jsonrpc: "2.0",
          method: "eth_getTransactionReceipt",
          params: [tx_hash],
          id: 1,
        };
        const resp = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data4: any = await resp.json();
        if (data4.error) {
          return { content: `Receipt fetch failed: ${data4.error.message}`, error: true };
        }
        if (!data4.result) {
          return { content: "Transaction not yet mined. Try again in a few seconds.", error: true };
        }
        const receipt = data4.result;
        const status = receipt.status === "0x1" ? "SUCCESS" : "FAILED";
        return {
          content:
            `Transaction Receipt:\n` +
            `Status: ${status}\n` +
            `Block: ${receipt.blockNumber}\n` +
            `Gas Used: ${parseInt(receipt.gasUsed, 16)}\n` +
            `Explorer: ${explorer(network)}/tx/${tx_hash}`,
        };
      }

      case "mantle_get_block": {
        const block_number = args.block_number as string | undefined;
        const network = args.network as string;
        const endpoint = rpc(network);
        const blockParam = block_number || "latest";
        const payload = {
          jsonrpc: "2.0",
          method: "eth_getBlockByNumber",
          params: [blockParam, false],
          id: 1,
        };
        const resp = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data5: any = await resp.json();
        if (data5.error) {
          return { content: `Block fetch failed: ${data5.error.message}`, error: true };
        }
        const block = data5.result;
        return {
          content:
            `Block #${parseInt(block.number, 16)}\n` +
            `Transactions: ${block.transactions?.length || 0}\n` +
            `Timestamp: ${new Date(parseInt(block.timestamp, 16) * 1000).toISOString()}`,
        };
      }

      default:
        return { content: `Unknown mantle-chain tool: ${name}`, error: true };
    }
  } catch (err: any) {
    return { content: `MantleChain error: ${err.message}`, error: true };
  }
}
