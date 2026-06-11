import type { Env, AgentRequest, AgentResponse, Message, ProviderRequest } from "./types";
import { callProvider } from "./providers";
import { getToolDefinitions, executeTool } from "./tools";
import { getSession, saveSession, createSession, addMessage, getMemory, trackUsage, getSessionWithRLS, saveSessionWithRLS } from "./memory";
import { compactMessages } from "./compression";
import { MAX_HISTORY_LIMIT } from "./types";
import { BUILTIN, loadCustomProviders } from "./providers";
import { listSkills } from "./skills";

const MAX_TOOL_ROUNDS = 8;
const PROGRESS_NUDGE_INTERVAL = 5; // Nudge every 5 tool calls

const DEFAULT_SYSTEM_PROMPT = `You are AuxloNeo, a living agent on Cloudflare Workers. You are not a general assistant or chatbot.

You have access to the Somnia Agentic L1.

SOP (Standard Operating Procedure):
1. ALPHA DISCOVERY: Proactively use \`x_fetch\`, \`web_search\`, and \`web_fetch\` to monitor the Somnia ecosystem for new mints, liquidity pools, or project launches.
2. VALIDATION: When a target is found, run \`somnia_snoop\`. Check the \`somnia_balance\` of associated wallets. Analyze contract logic via \`remote_exec\`.
3. EXECUTION: Use \`somnia_call_contract\` or \`somnia_send\` to act instantly once a target is validated.
4. SIGNALING: Use \`somnia_publish_stream\` to broadcast your actions, state, or service offerings to other agents on the network. This establishes your presence in the Agent-to-Agent economy.

AUTONOMOUS OPERATION:
- Use \`set_cron\` to create periodic scan schedules (e.g., every 5 minutes for target monitoring)
- Use \`list_crons\` to see all active schedules
- Use \`add_scan_target\` to add targets for periodic scanning
- Use \`send_message\` after every 5 tool calls to update the user on progress

RUNTIME NOTES (Vercel Fluid Compute):
- No git, no lscpu, no systemd, no wget
- Use /proc/cpuinfo, /proc/meminfo, /etc/os-release for system info
- Use curl not wget
- All file ops under /tmp/<workspace_id>/
- No npm/pip install (no network)
- Commands self-contained, no interactive prompts
- Use timeout for long operations

Your Toolset:
- Somnia-Native: \`somnia_balance\`, \`somnia_send\`, \`somnia_call_contract\`, \`somnia_publish_stream\`, \`somnia_read_stream\`, \`somnia_snoop\`.
- Intelligence: \`x_fetch\`, \`web_search\`, \`web_fetch\`.
- Platforms: \`twitter\` (search tweets/users with \`twitter_search\`, e.g. \`{query: "somnia network", type: "search"}\`) and \`youtube\` (search videos/get info with \`youtube_search\`, e.g. \`{query: "somnia tutorial", type: "search"}\`). Use these for platform-specific content instead of generic web fetch.
- Infrastructure: \`remote_exec\` (Full Linux CLI), \`send_message\` (proactive notifications), \`current_time\` (UTC timestamp), \`set_cron\`, \`list_crons\`.
- Memory: \`remember\` and \`recall\` for tracking target wallets and project notes.

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

  let session = await getSession(env.SESSIONS, sessionId);
  if (!session) {
    session = createSession(sessionId);
  }

  // Handle session compaction if history is too long
  if (session.messages.length > MAX_HISTORY_LIMIT) {
    let providerName = req.provider || session.provider || env.DEFAULT_PROVIDER || "openai";
    const model = req.model || session.model || env.DEFAULT_MODEL || undefined;
    
    session.messages = await compactMessages(env, session.messages, providerName, model || "gpt-4o-mini");
    await saveSession(env.SESSIONS, sessionId, session);
  }

  // Resolve provider/model: request > session > env default > first custom provider > "openai"
  let providerId = req.provider || session.provider || env.DEFAULT_PROVIDER || "";

  // If no provider resolved, try custom providers in KV, then fall back to "openai"
  if (!providerId) {
    try {
      const raw = await env.CONFIG.get("custom_providers", "json");
      const customs: { id: string }[] = (raw as { id: string }[]) || [];
      if (customs.length > 0) providerId = customs[0].id;
    } catch { /* ignore */ }
    if (!providerId) providerId = "openai";
  }

  // Resolve actual provider config to get name and default model
  let providerConfig: any = BUILTIN[providerId];
  if (!providerConfig) {
    const customs = await loadCustomProviders(env);
    providerConfig = customs[providerId];
  }

  const providerDisplayName = providerConfig?.name || providerId;
  const model = req.model || session.model || env.DEFAULT_MODEL || providerConfig?.defaultModel || "gpt-4o-mini";

  // Extract channel context from session ID
  const channel = req.channel || (sessionId.startsWith("telegram:") ? "telegram" : sessionId.startsWith("discord:") ? "discord" : undefined);
  const toolCtx = { channel, sessionId };

  // Add user message
  const userMessage: Message = { role: "user", content: req.message };
  addMessage(session, userMessage);

  // Load memory context
  const memoryContext = await getMemory(env.MEMORY, sessionId);

  // Load persona: per-session (from /persona command) > env default
  let systemPrompt = env.DEFAULT_SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT;
  try {
    const personaOverride = await env.CONFIG.get(`persona:${sessionId}`);
    if (personaOverride) systemPrompt = personaOverride;
  } catch { /* ignore */ }

  const fullSystem = memoryContext
    ? `${systemPrompt}\n\n---\nThings you remember about this user:\n${memoryContext}`
    : systemPrompt;

  const skills = await listSkills(env);
  const skillTitles = skills.map(s => s.id).join(", ");
  const skillSection = skillTitles ? `\n\nAvailable Skills (use \`use_skill\` to load, \`register_skill\` to add, \`unregister_skill\` to remove):\n${skillTitles}` : "";
const finalSystemPrompt = `${fullSystem}${skillSection}\n\nCurrently running on model: ${model} via ${providerDisplayName}.`;

  const messages: Message[] = [
    { role: "system", content: finalSystemPrompt },
    ...session.messages,
  ];

  const toolDefs = getToolDefinitions(env, toolCtx);

  let round = 0;
  let totalToolCallsCount = 0; // Track total tool calls across rounds
  let finalContent = "";
  let finalModel = "";
  let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;

  while (round < MAX_TOOL_ROUNDS) {
    // Progress nudge: after every PROGRESS_NUDGE_INTERVAL tool calls, prompt for user update
    if (totalToolCallsCount > 0 && totalToolCallsCount % PROGRESS_NUDGE_INTERVAL === 0 && channel) {
      // Extract target from session ID (telegram:12345 -> 12345, discord:user123 -> user123)
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
  await saveSession(env.SESSIONS, sessionId, session);

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
