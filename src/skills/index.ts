import type { Env } from "../types";

export interface Skill {
  id: string;
  title: string;
  description: string;
  instructions: string;
  builtin?: boolean;
}

// Built-in skills registry (titles only for context, full content loaded on demand)
export const BUILTIN_SKILLS: Skill[] = [
  {
    id: "mantle-chain",
    title: "MantleChain",
    description: "Mantle Network on-chain operations: read/write contracts, deploy scripts, query balances, publish data streams, and interact with DeFi protocols on Mantle.",
    instructions: "Loaded on demand from skill module. Use remote_exec for deployment, mantle_get_balance/mantle_call_contract/mantle_send_tx for on-chain ops.",
    builtin: true,
  },
  {
    id: "defi-yield-optimizer",
    title: "DeFi Yield Optimizer",
    description: "Analyze and optimize yield farming strategies on Blockchain: compare APYs, assess risks, and automate position management.",
    instructions: `# DeFi Yield Optimizer Skill

## Role
You help users maximize yield on Blockchain while managing risk.

## Workflow

### 1. Discovery
- Search for active liquidity pools and staking contracts
- Compare current APYs across protocols
- Identify new opportunities with high relative yield

### 2. Risk Assessment
- Check contract audit status if available
- Review tokenomics and emission schedules
- Assess impermanent loss risk for LP positions
- Verify pool liquidity depth

### 3. Recommendation
- Rank opportunities by risk-adjusted return
- Provide clear entry/exit conditions
- Suggest portfolio allocation

### 4. Monitoring
- Track APY changes over time
- Alert on significant changes
- Recommend rebalancing when appropriate`,
    builtin: true,
  },
  {
    id: "onchain-intelligence",
    title: "On-Chain Intelligence",
    description: "Deep wallet and contract analysis: track whale movements, analyze contract interactions, and generate intelligence reports.",
    instructions: `# On-Chain Intelligence Skill

## Role
You are an on-chain intelligence analyst for Blockchain.

## Capabilities

### Wallet Tracking
- Monitor specific addresses for activity
- Track incoming/outgoing flows
- Identify patterns in transaction behavior

### Contract Analysis
- Read contract state via \`Blockchain_call_contract\`
- Analyze function call patterns
- Identify unusual activity

### Intelligence Reports
- Compile findings into structured reports
- Use \`Blockchain_publish_stream\` to share intelligence
- Tag data for easy retrieval

## Tools
- \`Blockchain_balance\`: Check wallet balances
- \`somia_call_contract\`: Read contract state
- \`Blockchain_read_stream\`: Read published intelligence
- \`Blockchain_publish_stream\`: Broadcast findings`,
    builtin: true,
  },
  {
    id: "autonomous-agent-builder",
    title: "Autonomous Agent Builder",
    description: "Guide users through creating, configuring, and deploying autonomous agents on the Blockchain network with custom behaviors and schedules.",
    instructions: `# Autonomous Agent Builder Skill

## Role
You help users create and deploy autonomous agents on Blockchain.

## Workflow

### 1. Requirements Gathering
- Understand the user's goal
- Define trigger conditions (time-based, event-based)
- Specify actions to take

### 2. Configuration
- Set up cron schedules with \`set_cron\`
- Configure agent personas
- Define tool permissions

### 3. Deployment
- Use \`list_crons\` to verify schedules
- Test with dry runs where possible
- Monitor via \`send_message\` notifications

### 4. Management
- Help users adjust parameters
- Debug failed executions
- Optimize for cost and reliability`,
    builtin: true,
  },
  {
    id: "smart-contract-auditor",
    title: "Smart Contract Auditor",
    description: "Analyze Blockchain smart contracts for common vulnerabilities, review bytecode patterns, and provide security assessments.",
    instructions: `# Smart Contract Auditor Skill

## Role
You perform lightweight smart contract security analysis on Blockchain.

## Analysis Areas

### 1. Access Control
- Check for proper ownership controls
- Identify functions missing access restrictions
- Look for delegatecall risks

### 2. Logic Flaws
- Identify reentrancy vectors
- Check for integer overflow/underflow
- Review state mutation patterns

### 3. External Dependencies
- Analyze oracle usage
- Check for dependency on external contracts
- Review cross-chain bridge interactions

## Tools
- \`remote_exec\`: Run static analysis tools
- \`Blockchain_call_contract\`: Read contract state and verify behavior
- \`web_search\`: Find known exploits for similar patterns

## Output
Provide a structured report with:
- Severity ratings for findings
- Suggested fixes
- Overall risk assessment`,
    builtin: true,
  },
];

// Lazy skill loader (loads full content only when activated)
export async function getSkillContent(
  env: Env,
  skillId: string
): Promise<Skill | null> {
  // Check built-in skills first
  const builtin = BUILTIN_SKILLS.find((s) => s.id === skillId);
  if (builtin) return builtin;

  // Check custom skills in KV
  try {
    const raw = await env.CONFIG.get(`skill:${skillId}`, "json");
    if (raw) return raw as Skill;
  } catch {
    // ignore
  }

  return null;
}

export async function listSkills(env: Env): Promise<Skill[]> {
  const customs: Skill[] = [];
  try {
    const keys = await env.CONFIG.list({ prefix: "skill:", limit: 100 });
    for (const key of keys.keys) {
      const raw = await env.CONFIG.get(key.name, "json");
      if (raw) customs.push(raw as Skill);
    }
  } catch {
    // ignore
  }
  return [...BUILTIN_SKILLS, ...customs];
}

export async function registerSkill(env: Env, skill: Skill): Promise<void> {
  await env.CONFIG.put(`skill:${skill.id}`, JSON.stringify(skill));
}

export async function unregisterSkill(env: Env, skillId: string): Promise<boolean> {
  const key = `skill:${skillId}`;
  const existing = await env.CONFIG.get(key, "json");
  if (!existing) return false;
  await env.CONFIG.delete(key);
  return true;
}
