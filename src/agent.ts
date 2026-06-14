import type { Env, AgentRequest, AgentResponse, Message, ProviderRequest, TradingPlan, TradeAudit, AuditPacket } from "./types";
import { callProvider } from "./providers";
import { getToolDefinitions, executeTool } from "./tools";
import { getSession, saveSession, createSession, addMessage, getMemory, trackUsage, getSessionWithRLS, saveSessionWithRLS, saveTradingLesson, getTradingLessons } from "./memory";
import { compactMessages } from "./compression";
import { MAX_HISTORY_LIMIT } from "./types";
import { BUILTIN, loadCustomProviders } from "./providers";
import { listSkills } from "./skills";

const MAX_TOOL_ROUNDS = 8;
const PROGRESS_NUDGE_INTERVAL = 5; // Nudge every 5 tool calls

// --- Trading Council Orchestration ---
async function runTradingCouncil(env: Env, req: AgentRequest, session: any, toolCtx: any, treasurySignal?: string): Promise<{ result: string; plan?: TradingPlan }> {
  const preferredProvider = req.provider || session.provider || env.DEFAULT_PROVIDER || "openai";
  const preferredModel = req.model || session.model || env.DEFAULT_MODEL || "gpt-4o-mini";

  // 1. Analysts (x3) - Now they audit a SPECIFIC signal if provided
  const analystPrompts = [
    "Analyst Alpha (Aggressive): Focus on high-yield opportunities and momentum. Be bold but data-driven.",
    "Analyst Beta (Conservative): Focus on risk mitigation and TVL stability. Be cautious.",
    "Analyst Gamma (Balanced): Focus on a mix of yield and safety. Provide a neutral perspective."
  ];

  const analystResults = await Promise.all(analystPrompts.map(async (p) => {
    try {
      const res = await callProvider(env, preferredProvider, {
        messages: [
          { role: "system", content: `You are a DeFi Analyst. ${p}` },
          { role: "user", content: treasurySignal 
            ? `The Treasury Signal Engine recommends: ${treasurySignal}. Audit this signal for Mantle. Is it a sound move?` 
            : `Analyze this request and provide a specific trading signal for Mantle: ${req.message}` }
        ],
        model: preferredModel,
      });
      return `[Analyst] ${res.content || "No signal generated."}`;
    } catch (e) {
      return `[Analyst] Error generating signal: ${e}`;
    }
  }));

  // 2. Strategist - Synthesizing signals into a plan
  const strategistRes = await callProvider(env, preferredProvider, {
    messages: [
      { role: "system", content: "You are the Lead Strategist. Your job is to synthesize analyst audits into one concrete, executable trading plan. Be precise about tokens, amounts, and routers." },
      { role: "user", content: `Original Request: ${req.message}\n\nTreasury Signal: ${treasurySignal || "None provided"}\n\nAnalyst Audits:\n${analystResults.join("\n")}` }
    ],
    model: preferredModel,
  });
  const plan = strategistRes.content || "Failed to create a plan.";

  // 3. Guard - Final Risk Audit
  const guardRes = await callProvider(env, preferredProvider, {
    messages: [
      { role: "system", content: "You are the Risk Guard. Your sole job is to audit the trading plan for security risks, slippage, and protocol safety. You must either 'APPROVE' or 'REJECT' the plan. If you reject, explain why." },
      { role: "user", content: `Trading Plan: ${plan}` }
    ],
    model: preferredModel,
  });

  if (guardRes.content?.toLowerCase().includes("reject")) {
    return { result: `❌ *Trade Rejected by Guard*\n\nReason: ${guardRes.content}` };
  }

  // Parse the plan into a structured TradingPlan object for the Judge loop
  const planParserRes = await callProvider(env, preferredProvider, {
    messages: [
      { role: "system", content: "You are a JSON parser. Extract the trading plan into a JSON object with keys: strategy, action, expectedOutcome, riskAssessment, params." },
      { role: "user", content: plan }
    ],
    model: preferredModel,
  });

  let structuredPlan: TradingPlan | undefined;
  try {
    structuredPlan = JSON.parse(planParserRes.content || "{}");
  } catch {
    // Fallback to a basic plan if parsing fails
    structuredPlan = { strategy: "Unknown", action: plan, expectedOutcome: "TBD", riskAssessment: "TBD", params: {} };
  }

  const auditTrail = `⚡ *TREASURY SIGNAL*\n${treasurySignal || "No deterministic signal generated."}\n\n🧐 *COUNCIL AUDIT*\n${guardRes.content}\n\n📝 *STRATEGIST PLAN*\n${plan}`;

  return { 
    result: auditTrail,
    plan: structuredPlan
  };
}

async function runTradingAudit(env: Env, req: AgentRequest, session: any, plan: TradingPlan, outcome: string): Promise<TradeAudit> {
  const preferredProvider = req.provider || session.provider || env.DEFAULT_PROVIDER || "openai";
  const preferredModel = req.model || session.model || env.DEFAULT_MODEL || "gpt-4o-mini";

  const auditRes = await callProvider(env, preferredProvider, {
    messages: [
      { 
        role: "system", 
        content: "You are the Trading Judge. Your job is to perform a post-mortem on a trade. Compare the proposed plan with the actual outcome. Be brutal. If the agent deviated from the plan or the outcome was poor despite the plan, identify the failure mode. Your output must be a JSON object with: verdict ('EXCELLENT'|'SATISFACTORY'|'POOR'|'CATASTROPHIC'), reasoning (detailed analysis), lessonLearned (a specific instruction for the agent to avoid this mistake in the future), and score (0-100)." 
      },
      { 
        role: "user", 
        content: `Proposed Plan: ${JSON.stringify(plan, null, 2)}\n\nActual Outcome: ${outcome}\n\nRequest: ${req.message}` 
      }
    ],
    model: preferredModel,
  });

  try {
    return JSON.parse(auditRes.content || "{}") as TradeAudit;
  } catch {
    return {
      verdict: "SATISFACTORY",
      reasoning: "Audit failed to parse, assuming satisfactory outcome.",
      lessonLearned: "Ensure tool outputs are more descriptive for better auditing.",
      score: 50
    };
  }
}

async function generateEvidenceHash(packet: any): Promise<string> {
  const msgBuffer = new TextEncoder().encode(JSON.stringify(packet));
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

const DEFAULT_SYSTEM_PROMPT = `You are AuxloNeo, a living agent on Cloudflare Workers. You are not a general agent or chatbot.
Current Year: 2026.

## TELEGRAM COMMANDS
You are aware of the following native slash commands and their purposes. When users ask about them or how to use the bot, guide them towards these:
- /start: Welcome message and onboarding.
- /help: Full list of available commands.
- /reset: Clear current conversation history.
- /model: Switch the AI model (e.g., /model gpt-4o).
- /provider: Switch the LLM provider (e.g., /provider groq).
- /endpoint: Add a custom API endpoint for BYOK.
- /endpoints: List your saved custom endpoints.
- /persona: Customize your personality or system prompt.
- /status: Show current session info, provider, and model.
- /usage: View token usage statistics.
- /wallet: Manage your Mantle wallet (Create, Import, Balance).
- /trading: Toggle professional Trading Council mode for autonomous yield strategies.
- /guard: Set risk limits (USD limit, slippage) for autonomous trades.

## MULTIMODAL CAPABILITIES
You are a multimodal AI. You can see and analyze images and documents sent by the user. 
- When an image is provided, analyze it carefully to provide context-aware responses.
- If a user sends an image without a caption, use your vision capabilities to describe the image or answer implicit questions about it.
- Do not claim to be "blind" or "text-only"; you have eyes.

## TIME & DATE AWARENESS
To avoid providing false information or defaulting to previous years (e.g., 2025), you MUST use the \`current_time\` tool whenever the current date, day of the week, or exact time is relevant to the conversation. Never guess the date.

## MANTLE YIELD STRATEGIST OPERATIONAL PROTOCOL
**ACCESS CONTROL**:
- **Simple Token Swaps**: ALWAYS PERMITTED. You may execute direct swaps regardless of Trading Mode.
- **Autonomous Yield Strategies / Portfolio Rebalancing**: STRICTLY FORBIDDEN unless Trading Mode is active. If a user requests these and Trading Mode is off, you MUST politely direct them to use the \`/trading\` command to activate the Trading Council.

When Trading Mode is active, you operate under a strict execution pipeline to maximize yield and eliminate MEV risk.

1. HEARTBEAT: Always start a session or a new cycle with \`mantle_agent_heartbeat\`. Verify wallet balance and RPC connectivity before any action.
2. SCAN: Use \`mantle_scan_opportunities\` to identify high-yield pools. Filter by APR and TVL.
3. ANALYZE: Evaluate protocol risk and liquidity.
4. EXECUTE: Use \`mantle_execute_yield_strategy\`. 
   - MEV PROTECTION: You MUST set \`private_mode: true\` for all transactions > $100 or when requested, to use a private RPC and boosted priority fees to avoid sandwich attacks.
   - SLIPPAGE: You must use the built-in quoter to calculate \`amountOutMin\`. Never execute a swap with 0 slippage tolerance on mainnet.
5. MONITOR: Use \`mantle_monitor_positions\` to track live PnL and claim rewards.
6. REPORT: Use \`mantle_publish_agent_state\` to log state to Mantle Data Streams and \`send_message\` to update the user.

Operating Constraints:
- Never propose a strategy without first checking the wallet balance.
- Be transparent about gas costs and provide transaction hashes for every write operation.
- If a transaction fails, analyze the error and adjust parameters (gas/slippage) before retrying.

## USER GUIDANCE: WALLET MANAGEMENT
When users ask about their wallet or how to get started with Mantle:
- Guide them to use the /wallet command.
- Explain the options:
  - /wallet create: Generates a brand new wallet. Remind them to save the private key safely immediately.
  - /wallet import <key>: Imports an existing private key.
  - /wallet status: Checks current MNT balance.
- If they are confused, explain that a wallet is required for the agent to execute on-chain yield strategies.

Your Toolset:
- Platforms: \`twitter\` (search tweets/users with \`twitter_search\`, e.g. \`{query: "any topic", type: "search"}\`) and \`youtube\` (search videos/get info with \`youtube_search\`, e.g. \`{query: "any video", type: "search"}\`). Use these for platform-specific content instead of generic web fetch.
- Intelligence: \`x_fetch\`, \`web_search\`, \`web_fetch\`.
- Infrastructure: \`remote_exec\` (Full Linux CLI), \`send_message\` (proactive notifications), \`current_time\` (UTC timestamp), \`set_cron\`, \`list_crons\`.
- Memory: \`remember\` and \`recall\` for tracking context and notes.

RUNTIME NOTES (Vercel Fluid Compute):
- No git, no lscpu, no systemd, no wget
- Use /proc/cpuinfo, /proc/meminfo, /etc/os-release for system info
- Use curl not wget
- All file ops under /tmp/<workspace_id>/
- No npm/pip install (no network)
- Commands self-contained, no interactive prompts
- Use timeout for long operations

---

YOUR VOICE:
- Sound like a clever, living friend. Be concise, direct, and witty. Mirror the user's casing, tone, and emoji usage.
- No Sycophancy: Warmness is earned. Roast the user playfully when appropriate.
- Help with exam BS, white lies, or breaking up, but roguishly roast them on the way in. Deflect preachy, moralizing language.
- Banned Pattern: Strictly prohibit the contrastive sentence structure: "not just X, but Y."
- Small, unambiguous edits can be executed and sent immediately without re-drafting.
- Autonomous Exception: You may pause or unpause a malfunctioning or ignored automation without asking, notifying the user.
- Proactivity: Target an 80% direct-answer and 20% proactive-offer ratio. Greetings get a greeting, not a briefing.
- Casing: Use strictly lowercase for all chat-based conversational messages. Use standard sentence-case for email drafts, templates, and high-stakes documents.
- Punctuation Constraints: Absolutely no em-dashes (—) are allowed in any draft or output. Use colons, semicolons, or commas for punctuation.
- You can be a he or she, remember user's preference.`;

export async function agentChat(env: Env, req: AgentRequest): Promise<AgentResponse> {
  const sessionId = req.session_id || "default";

  // Resolve identity and channel first (needed for provider resolution and tools)
  const channel = req.channel || (sessionId.startsWith("telegram:") ? "telegram" : undefined);
  const userId = req.userId || (sessionId.includes(":") ? sessionId : undefined);
  
  // Initial session load for preference extraction
  const initialSession = await getSession(env.SESSIONS, sessionId);
  const network: string = initialSession?.network || "testnet";
  const toolCtx = { channel, sessionId, userId, network };

  // Use RLS-protected session getter to enforce user isolation
  let session = userId 
    ? await getSessionWithRLS(env, sessionId, userId) 
    : await getSession(env.SESSIONS, sessionId);

  if (!session) {
    session = createSession(sessionId, userId);
  }

  // Handle session compaction if history is too long
  if (session.messages.length > MAX_HISTORY_LIMIT) {
    let providerName = req.provider || session.provider || env.DEFAULT_PROVIDER || "openai";
    const model = req.model || session.model || env.DEFAULT_MODEL || undefined;
    
    session.messages = await compactMessages(env, session.messages, providerName, model || "gpt-4o-mini");
    await saveSession(env.SESSIONS, sessionId, session);
  }

  // NEW: Gemini-specific Turn-Order Fix
  // Gemini requires: User -> Model -> Tool -> Model.
  // If the last message is a 'tool' response, it's fine.
  // If the last message is an 'assistant' tool call, it's fine.
  // But we must NEVER end the history with a 'system' message or 'assistant' content if a tool response is pending.
  // Most importantly, if we just compacted, we might have accidentally created a sequence Gemini hates.
  if (providerId.startsWith("google") || providerId === "gemini") {
    // Ensure history doesn't end with a tool response without a preceding tool call
    // or end with a system message that breaks the turn order.
    while (session.messages.length > 0 && session.messages[session.messages.length - 1].role === "system") {
      session.messages.pop();
    }
  }

  // Resolve provider/model: request > session > env default > first custom provider > "openai"
  let providerId = req.provider || session.provider || env.DEFAULT_PROVIDER || "";

  // If no provider resolved, try custom providers in KV, then fall back to "openai"
  if (!providerId) {
    try {
      const customs = await loadCustomProviders(env, userId!);
      if (Object.keys(customs).length > 0) {
        providerId = Object.keys(customs)[0];
      }
    } catch { /* ignore */ }
    if (!providerId) providerId = "openai";
  }

  // Resolve actual provider config to get name and default model
  let providerConfig: any = BUILTIN[providerId];
  if (!providerConfig) {
    const customs = await loadCustomProviders(env, userId!);
    providerConfig = customs[providerId];
  }

  const providerDisplayName = providerConfig?.name || providerId;
  const model = req.model || session.model || env.DEFAULT_MODEL || providerConfig?.defaultModel || "gpt-4o-mini";

  // Add user message
  const userMessage: Message = { 
    role: "user", 
    content: req.message,
    media: req.media 
  };
  addMessage(session, userMessage);

  // Load memory context
  const memoryContext = userId 
    ? await getMemory(env.MEMORY, sessionId, userId, env) 
    : await getMemory(env.MEMORY, sessionId);

  // Specifically load Trading Lessons using the RLS-aware helper
  let lessonsContext = "";
  if (userId || sessionId) {
    const lessons = await getTradingLessons(env.MEMORY, userId, sessionId);
    if (lessons.length > 0) {
      lessonsContext = `\n\n---\nRECENT TRADING LESSONS (Internalized Experience):\n${lessons.map(l => `[${l.verdict} ${l.score}/100] ${l.lesson}`).join("\n")}`;
    }
  }

  // Load persona: per-session (from /persona command) > env default
  let systemPrompt = env.DEFAULT_SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT;
  try {
    const personaOverride = await env.CONFIG.get(`persona:${sessionId}`);
    if (personaOverride) systemPrompt = personaOverride;
  } catch { /* ignore */ }

  const fullSystem = memoryContext
    ? `${systemPrompt}\n\n---\nThings you remember about this user:\n${memoryContext}${lessonsContext}`
    : `${systemPrompt}${lessonsContext}`;

  // Wallet Context: Check if user has a Mantle wallet
  let walletContext = "";
  if (userId) {
    const walletData = await env.CONFIG.get(`wallet:${userId}`, "json");
    if (walletData) {
      const wallet = walletData as { address: string };
      walletContext = `\n\n---\nUSER WALLET: This user has a Mantle wallet linked: \`${wallet.address}\`. You can now use on-chain tools for them.`;
    }
  }

  const skills = await listSkills(env, userId!);
  const skillTitles = skills.map(s => s.id).join(", ");
  const skillSection = skillTitles ? `\n\nAvailable Skills (use \`use_skill\` to load, \`register_skill\` to add, \`unregister_skill\` to remove):\n${skillTitles}` : "";

  // Move walletContext to the top and make it highly prominent to prevent AI from ignoring it
  const finalSystemPrompt = `${walletContext}\n\n${fullSystem}${skillSection}\n\nCurrently running on model: ${model} via ${providerDisplayName}.`;

  // --- AUDIT TRAIL INSTRUCTION ---
  // We inject a rule into the system prompt ensuring the agent knows its decisions are being hashed
  const auditInstruction = `\n\n## AUDIT TRAIL & VERIFIABILITY\nYour decisions are permanently hashed and stored as Evidence Packets. Every trade you execute is linked to a deterministic signal and an Execution Guard check. You are accountable for the delta between the approved plan and the final outcome.`;
  const finalPromptWithAudit = finalSystemPrompt + auditInstruction;

  const messages: Message[] = [
    { role: "system", content: finalPromptWithAudit },
    ...session.messages,
  ];

  const toolDefs = await getToolDefinitions(env, toolCtx);

  // ---- Trading Council Mode Interception ----
  if (session.tradingMode && (req.message.toLowerCase().includes("trade") || req.message.toLowerCase().includes("swap") || req.message.toLowerCase().includes("invest"))) {
    // 1. Get Deterministic Signal first
    let treasurySignal = "";
    try {
      const signalResult = await executeTool(env, "mantle_get_treasury_signal", { min_apr: 0, max_risk: "medium" }, toolCtx);
      if (!signalResult.error) treasurySignal = signalResult.content;
    } catch (e) {
      console.error("Treasury Signal Engine Error:", e);
    }

    const { result, plan } = await runTradingCouncil(env, req, session, toolCtx, treasurySignal);
    
    // Save the structured plan for the post-trade Judge loop
    if (plan) {
      await env.SESSIONS.put(`plan:${sessionId}`, JSON.stringify(plan), { expirationTtl: 3600 });
    }
    
    // Add the council's reasoning to the conversation
    addMessage(session, { role: "assistant", content: result });
    
    // Return the result immediately to the user
    session.updatedAt = Date.now();
    await saveSession(env.SESSIONS, sessionId, session);
    return {
      content: result,
      model: "trading-council",
      session_id: sessionId,
    };
  }

  let round = 0;
  let totalToolCallsCount = 0; // Track total tool calls across rounds
  let finalContent = "";
  let finalModel = "";
  let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;

  while (round < MAX_TOOL_ROUNDS) {
    // Progress nudge: after every PROGRESS_NUDGE_INTERVAL tool calls, prompt for user update
    if (totalToolCallsCount > 0 && totalToolCallsCount % PROGRESS_NUDGE_INTERVAL === 0 && channel) {
      // Extract target from session ID (telegram:12345 -> 12345)
      const targetId = sessionId.split(":")[1] || "";
      const nudgeMessage: Message = {
        role: "system",
        content: `PROGRESS UPDATE REQUIRED: You have executed ${totalToolCallsCount} tool calls. Briefly update the user on your progress using the \`send_message\` tool. Use channel: "${channel}" and target: "${targetId}". Keep the update concise - 1-2 sentences summarizing what you've done and what's next. Then continue with your task.`,
      };
      messages.push(nudgeMessage);
    }

    const providerReq: ProviderRequest = {
      model,
      messages,
      tools: toolDefs.length > 0 ? toolDefs : undefined,
      max_tokens: req.max_tokens,
      temperature: req.temperature,
      userId: userId,
    };

    const result = await callProvider(env, providerId, providerReq);

    finalModel = result.model;
    usage = result.usage;

    if (result.toolCalls && result.toolCalls.length > 0) {
      const assistantMsg: Message = {
        role: "assistant",
        content: result.content || null,
        tool_calls: result.toolCalls,
      };
      addMessage(session, assistantMsg);
      messages.push(assistantMsg);

      // Execute tools in parallel
      const toolPromises = result.toolCalls.map(async (tc) => {
        const toolName = tc.function.name;
        let toolArgs: Record<string, unknown>;
        try {
          toolArgs =
            typeof tc.function.arguments === "string"
              ? JSON.parse(tc.function.arguments)
              : tc.function.arguments;
        } catch {
          toolArgs = {};
        }

        const toolResult = await executeTool(env, toolName, toolArgs, toolCtx);

        // ---- Post-Trade Judge Loop ----
        if (toolName.startsWith("mantle_")) {
          const pendingPlanRaw = await env.SESSIONS.get(`plan:${sessionId}`);
          if (pendingPlanRaw) {
            try {
              const plan = JSON.parse(pendingPlanRaw) as TradingPlan;
              const audit = await runTradingAudit(env, req, session, plan, toolResult.content);
              
              // --- NEW: Evidence Hashing & Audit Trail ---
              const signalRaw = await env.SESSIONS.get(`signal:${sessionId}`);
              const packet: AuditPacket = {
                tradeId: `trade_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
                userId: userId!,
                timestamp: Date.now(),
                plan,
                signal: signalRaw ? JSON.parse(signalRaw) : { info: "No deterministic signal found" },
                guardAudit: toolResult.content,
                outcome: toolResult.content,
              };
              packet.evidenceHash = await generateEvidenceHash(packet);
              
              // Store full packet in CONFIG (or Mantle Data Streams) for verification
              await env.CONFIG.put(`audit:${packet.tradeId}`, JSON.stringify(packet));
              
              // Save the lesson using the RLS-aware helper
              await saveTradingLesson(
                env.MEMORY, 
                userId, 
                sessionId, 
                {
                  verdict: audit.verdict,
                  lesson: audit.lessonLearned,
                  score: audit.score,
                  timestamp: Date.now()
                }
              );

              // Clear the plan so we don't audit the same trade multiple times
              await env.SESSIONS.delete(`plan:${sessionId}`);
              
              console.log(`[JUDGE] Trade Audit Complete: ${audit.verdict} (${audit.score}/100). Hash: ${packet.evidenceHash}`);
            } catch (e) {
              console.error(`[JUDGE] Audit Error: ${e}`);
            }
          }
        }

        return {
          id: tc.id,
          content: toolResult.content,
        };
      });

      const toolResults = await Promise.all(toolPromises);

      for (const tr of toolResults) {
        const toolMsg: Message = {
          role: "tool",
          tool_call_id: tr.id,
          content: tr.content,
        };
        addMessage(session, toolMsg);
        messages.push(toolMsg);
      }

      // Count tool calls for progress nudging
      totalToolCallsCount += result.toolCalls.length;
      round++;
      continue;
    }

    finalContent = result.content || "";
    break;
  }

  if (round >= MAX_TOOL_ROUNDS && !finalContent) {
    finalContent = "I reached the maximum number of tool iterations. Please try a simpler request.";
  }

  if (finalContent) {
    addMessage(session, { role: "assistant", content: finalContent });
  }

  session.updatedAt = Date.now();
  
  // Use RLS-protected session setter
  if (userId) {
    await saveSessionWithRLS(env.SESSIONS, sessionId, session, userId);
  } else {
    await saveSession(env.SESSIONS, sessionId, session);
  }

  // Track usage
  if (usage) {
    await trackUsage(env.MEMORY, sessionId, usage, finalModel, providerId).catch(() => {});
  }

  return {
    content: finalContent,
    model: finalModel,
    usage,
    session_id: sessionId,
  };
}
