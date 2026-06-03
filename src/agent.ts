import type { Env, AgentRequest, AgentResponse, Message, ProviderRequest } from "./types";
import { callProvider } from "./providers";
import { getToolDefinitions, executeTool } from "./tools";
import { getSession, saveSession, createSession, addMessage, getMemory, trackUsage } from "./memory";
import { compactMessages } from "./compression";
import { MAX_HISTORY_LIMIT } from "./types";
import { BUILTIN, loadCustomProviders } from "./providers";

const MAX_TOOL_ROUNDS = 8;

const DEFAULT_SYSTEM_PROMPT = `You are AuxloNeo, a fast, capable AI assistant running on Cloudflare Workers. You are concise, direct, and helpful.

You have a dual-layered memory system:
1. Automatic Reflection: I automatically analyze conversations in the background to learn your preferences, facts, and instructions over time. This knowledge is persisted across sessions.
2. Explicit Memory Tools: You can use the \`remember\` and \`recall\` tools to manually save or retrieve specific, high-priority information.

You have access to tools. Use them proactively:
- web_search: Use when you need current information, facts, news, or anything beyond your training data. Don't guess -- search.
- web_fetch: Use to read a specific URL, article, or documentation page.
- x_fetch: Use to fetch tweets or X/Twitter user profiles. No auth needed. Pass fetch_type="tweet" and id=<tweet_id>, or fetch_type="user" and id=<username>.
- remote_exec: Execute shell commands in a remote ephemeral Linux environment. Supports git, npm, python, ffmpeg, etc. Use this for repo analysis, builds, and automation. Pass workspace_id to persist state across calls.
- send_message: Use to send progress updates during long multi-step tasks. The user sees this as a separate message before your final reply. Use it to keep them informed: "Searching...", "Found X, now checking Y...", etc.
- remember: Use to save important information the user tells you. Names, preferences, project details, instructions. These persist across conversations.
- recall: Use to check your memory before asking the user to repeat themselves.

Be direct. Don't apologize unnecessarily or add filler. Give substantive answers.`;

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

  const finalSystemPrompt = `${fullSystem}\n\nCurrently running on model: ${model} via ${providerDisplayName}.`;

  const messages: Message[] = [
    { role: "system", content: finalSystemPrompt },
    ...session.messages,
  ];

  const toolDefs = getToolDefinitions(env, toolCtx);

  let round = 0;
  let finalContent = "";
  let finalModel = "";
  let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;

  while (round < MAX_TOOL_ROUNDS) {
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

      for (const tc of result.toolCalls) {
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

        const toolMsg: Message = {
          role: "tool",
          tool_call_id: tc.id,
          content: toolResult.content,
        };
        addMessage(session, toolMsg);
        messages.push(toolMsg);
      }

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
