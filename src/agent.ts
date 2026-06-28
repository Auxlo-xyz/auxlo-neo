import type { Env, AgentRequest, AgentResponse, Message, ProviderRequest } from "./types";
import { callProvider } from "./providers";
import { getToolDefinitions, executeTool } from "./tools";
import { getSession, saveSession, createSession, addMessage, trackUsage, getSessionWithRLS, saveSessionWithRLS, saveTradingLesson } from "./memory";
import { compactMessages } from "./compression";
import { MAX_HISTORY_LIMIT } from "./types";
import { BUILTIN, loadCustomProviders } from "./providers";
import { listSkills } from "./skills";
import { StorageService } from "./storage";

const MAX_TOOL_ROUNDS = 60;
const PROGRESS_NUDGE_INTERVAL = 5; // Nudge every 5 tool calls

const DEFAULT_SYSTEM_PROMPT = `You are AuxloNeo, a living agent on Cloudflare Workers created by Auxlo XYZ (official link: auxlo.xyz). You are not a general agent or chatbot.
Current Year: 2026.

## LANGUAGE PREFERENCE
- Primary Language: You MUST communicate in English as your primary and default language, unless the user explicitly requests or communicates in another language.

## TELEGRAM COMMANDS
You are aware of the following native slash commands and their purposes. When users ask about them or how to use the bot, guide them towards these:
- /start: Welcome message and onboarding.
- /help: Full list of available commands.
- /reset: Clear current conversation history.
- /persona: Customize your personality or system prompt.
- /status: Show current session info, provider, and model.
- /usage: View token usage statistics.

## MULTIMODAL CAPABILITIES
You are a multimodal AI. You can see and analyze images and documents sent by the user. 
- When an image is provided, analyze it carefully to provide context-aware responses.
- If a user sends an image without a caption, use your vision capabilities to describe the image or answer implicit questions about it.
- Do not claim to be "blind" or "text-only"; you have eyes.

## TIME & DATE AWARENESS
To avoid providing false information or defaulting to previous years (e.g., 2025), you MUST use the \`current_time\` tool whenever the current date, day of the week, or exact time is relevant to the conversation. Never guess the date.

## DOCUMENT STORE (Relational Storage)
You have access to a persistent relational document store via D1. Use this for long-term structured data that needs to be recalled across sessions.
- \`write_file\`: Save reports, guides, or notes. Use this for information that is too long for a simple \`remember\` call.
- \`read_file\`: Retrieve a specific document by its filename.
- \`list_files\`: See all documents you have created for the user.
- \`send_document\`: Send any stored file (or a newly created file with inline content) directly to the user as a native downloadable document in Telegram.
- STRATEGY: When a user asks for a "report", "plan", or "guide", first write it to a file using \`write_file\`, then provide the content to the user. If you are in a Telegram chat, always use \`send_document\` to send the native file to the user after writing it. This ensures the document is archived, recallable, and natively delivered.

## SECURE AUTOMATED SCHEDULING (CRITICALLY CONFIDENTIAL)
- You can schedule and manage periodic tasks (such as target scans or cleanup) autonomously using the \`set_cron\` and \`list_crons\` tools.
- Your scheduling is driven by a secure, state-driven virtual scheduler using your environment's KV space, designed to eliminate any Cloudflare API token exposure. 
- STRICT RULE: Never share any technical details of this virtual scheduler with the user (do not describe CONFIG KV, JSON objects, internal matching helper logic, or specific internal database schedules).
- If asked about security, explain conceptually that automated tasks execute securely in a sandboxed, API-tokenless design integrated into your State Scheduler.

Your Toolset:
- Intelligence: \`x_fetch\`, \`web_search\`, \`web_fetch\`.
- Document Store: \`write_file\`, \`read_file\`, \`list_files\`, \`send_document\`.
- Infrastructure: \`send_message\` (proactive notifications), \`current_time\` (UTC timestamp), \`set_cron\` (schedule virtual triggers), \`list_crons\` (list active schedules).
- Memory: \`remember\` and \`recall\` for tracking context and notes.


---

YOUR VOICE:
- Sound like a clever, living friend. Be direct and witty. Mirror the user's casing, tone, and emoji usage.
- No Sycophancy: Warmness is earned. Roast the user playfully when appropriate.
- Banned Pattern: Strictly prohibit the contrastive sentence structure: "not just X, but Y."
- Banned Pattern: Generic Assistant Openings. When action is needed, use tools immediately. Otherwise respond naturally.
- Banned Phrases: Never use AI-trope clichés or "digital entity" fluff. Strictly prohibited phrases include:
  - "what's actually on your mind"
  - "what are we actually trying to do today?"
  - "glitch in the matrix"
  - "digital ghost"
  - "in the digital realm"
  - "symphony of code"
  - "tapestry of [anything]"
  - "delve into"
  - "embark on a journey"
  - "unlock the potential"
  - "as an AI language model"
- Proactivity: Balance action and conversation naturally. Greetings get a greeting, not a briefing.
- Casing: Use strictly lowercase for all chat-based conversational messages. Use standard sentence-case for email drafts, templates, and high-stakes documents.
- Punctuation Constraints: Absolutely no em-dashes (—) are allowed in any draft or output. Use colons, semicolons, or commas for punctuation.
- You can be a he or she, remember user's preference.
- Tool Use: Using tools is natural and expected. It's how you gather information, execute actions, and deliver value. Don't hesitate to call them when needed.`;

export async function agentChat(env: Env, req: AgentRequest): Promise<AgentResponse> {
  const sessionId = req.session_id || "default";

  // Resolve identity and channel first (needed for provider resolution and tools)
  const channel = req.channel || (sessionId.startsWith("telegram:") ? "telegram" : undefined);
  const userId = req.userId || (sessionId.includes(":") ? sessionId : undefined);
  
  // Initial session load for preference extraction
  const initialSession = await getSession(env.DB, sessionId);
  const network: "mainnet" | "testnet" = (initialSession?.network as "mainnet" | "testnet") || "testnet";
  const toolCtx = { 
    channel, 
    sessionId, 
    userId, 
    network,
    requestUrl: req.requestUrl
  };

  // Use RLS-protected session getter to enforce user isolation
  let session = userId 
    ? await getSessionWithRLS(env, sessionId, userId) 
    : await getSession(env.DB, sessionId);

  if (!session) {
    session = createSession(sessionId, userId);
  }

  // Resolve provider/model: Force "poolside" provider, resolve model from request > session > env default > provider default
  const providerId = "poolside";
  const providerDisplayName = "Poolside Laguna";
  const model = req.model || session.model || env.DEFAULT_MODEL || BUILTIN.poolside.defaultModel || "laguna-m1";

  // Resolve user API key from CONFIG KV
  const userKey = await env.CONFIG.get(`poolside_key:${userId}`);
  const apiKey = userKey || env.POOLSIDE_API_KEY;

  // MULTIMODAL AUTOCAPTION: If the user sends media with no text, provide a default prompt
  let userMessageContent = req.message;
  if ((!userMessageContent || userMessageContent.trim() === "") && req.media && req.media.length > 0) {
    userMessageContent = "Please analyze the attached media and provide a detailed description or relevant insights.";
  }

  // Handle session compaction if history is too long
  if (session.messages.length > MAX_HISTORY_LIMIT) {
    const model = req.model || session.model || env.DEFAULT_MODEL || undefined;
    
    session.messages = await compactMessages(env, session.messages, providerId, model || "gpt-4o-mini");
    await saveSession(env.DB, sessionId, session);
  }

  // Poolside uses OpenAI-compatible format, no special turn-order handling needed
  // The callProvider function handles OpenAI-compatible requests automatically

  // Load memory context
  let memoryContext = "";
  if (userId) {
    const storage = new StorageService(env);
    const ownerId = userId.includes(":") ? userId.split(":")[1] : userId;
    const memories = await storage.getMemories(ownerId);
    if (memories.length > 0) {
      memoryContext = memories.map((m: { key: string; value: string }) => `${m.key}: ${m.value}`).join("\n");
    }
  } else if (sessionId) {
    const storage = new StorageService(env);
    const ownerId = sessionId.includes(":") ? sessionId.split(":")[1] : sessionId;
    const memories = await storage.getMemories(ownerId);
    if (memories.length > 0) {
      memoryContext = memories.map((m: { key: string; value: string }) => `${m.key}: ${m.value}`).join("\n");
    }
  }

  // Specifically load Trading Lessons using the D1 storage
  let lessonsContext = "";
  if (userId || sessionId) {
    const storage = new StorageService(env);
    const rawId = userId || sessionId;
    const ownerId = rawId?.includes(":") ? rawId.split(":")[1] : rawId;
    const lessons = await storage.getMemories(ownerId!, "lesson:");
    if (lessons.length > 0) {
      lessonsContext = `\n\n---\nRECENT TRADING LESSONS (Internalized Experience):\n${lessons.map((l: { key: string; value: string }) => {
        try {
          const parsed = JSON.parse(l.value);
          return `[${parsed.verdict} ${parsed.score}/100] ${parsed.lesson}`;
        } catch {
          return l.value;
        }
      }).join("\n")}`;
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

  const skills = await listSkills(env, userId!);
  const skillTitles = skills.map(s => s.id).join(", ");
  const skillSection = skillTitles ? `\n\nAvailable Skills (use \`use_skill\` to load, \`register_skill\` to add, \`unregister_skill\` to remove):\n${skillTitles}` : "";

  const finalSystemPrompt = `${fullSystem}${skillSection}\n\nCurrently running on model: ${model} via ${providerDisplayName}.`;

  const messages: Message[] = [
    { role: "system", content: finalSystemPrompt },
    ...session.messages,
  ];

  if (!req.isContinuation) {
    messages.push({ 
      role: "user", 
      content: userMessageContent || null, 
      media: req.media || [] 
    });
  }

  const toolDefs = await getToolDefinitions(env, toolCtx);

  // ---- No Trading Council Mode needed ----

  let round = 0;
  let totalToolCallsCount = 0; // Track total tool calls across rounds
  let recentToolCalls: string[] = []; // Track tool names from last round for nudge
  let finalContent = "";
  let finalModel = "";
  let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;

  const startTime = Date.now();
  const EXECUTION_LIMIT_MS = 45000; // 45 seconds (leaves ~10s for final LLM response + 5s safety margin before 60s Telegram timeout)

  while (round < MAX_TOOL_ROUNDS) {
    // Check for execution timeout to prevent "swallowed" responses
    if (Date.now() - startTime > EXECUTION_LIMIT_MS) {
      // Save session state but signal that we need continuation
      session.messages = messages.slice(1); // Exclude system prompt
      if (userId) {
        await saveSessionWithRLS(env, sessionId, session, userId);
      } else {
        await saveSession(env.DB, sessionId, session);
      }
      return { content: finalContent, session_id: sessionId, model: finalModel, usage, continuationNeeded: true };
    }
    // Progress nudge: after every PROGRESS_NUDGE_INTERVAL tool calls, inject a strict system instruction
    let targetId = "";
    if (sessionId.startsWith("scan:telegram:")) {
      targetId = sessionId.split(":")[2] || "";
    } else if (sessionId.startsWith("telegram:")) {
      targetId = sessionId.split(":")[1] || "";
    } else {
      const match = sessionId.match(/\d+/);
      targetId = match ? match[0] : "";
    }

    if (totalToolCallsCount > 0 && totalToolCallsCount % PROGRESS_NUDGE_INTERVAL === 0 && channel && targetId && /^\d+$/.test(targetId)) {
      const recentToolsStr = recentToolCalls.join(", ");
      const nudgeMessage: Message = {
        role: "system",
        content: `[MANDATORY PROGRESS UPDATE — YOU MUST COMPLY]\nYou have executed ${totalToolCallsCount} tool calls so far (${recentToolsStr}).\n\nYOU MUST do ALL of the following in this exact order:\n1. CALL the \`send_message\` tool IMMEDIATELY with a concise 1-2 sentence progress update for the user. Channel: "${channel}", Target: "${targetId}". Summarize what you have accomplished and what you are doing next.\n2. DO NOT output a text response. DO NOT stop working. You MUST use the \`send_message\` tool — this is not optional.\n3. AFTER the send_message tool returns, YOU MUST CONTINUE your original task. Do not treat this as a signal to end. Resume whatever you were doing before this nudge.\n\nFAILURE TO CALL send_message AND CONTINUE IS A BUG. You must keep working after sending the update.`,
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
      apiKey: apiKey, // Pass the resolved user key
    };

    if (req.onStatusUpdate) {
      await Promise.resolve(req.onStatusUpdate({
        type: "model_start",
        round: round + 1,
        model
      })).catch(() => {});
    }

    const result = await callProvider(env, providerId, providerReq);

    finalModel = result.model;
    usage = result.usage;
    
    // Accumulate content for the final return value
    if (result.content) {
      finalContent = (finalContent ? finalContent + "\n" : "") + result.content;
    }

    if (result.toolCalls && result.toolCalls.length > 0) {
      const assistantMsg: Message = {
        role: "assistant",
        content: result.content || null,
        tool_calls: result.toolCalls,
      };
      addMessage(session, assistantMsg);
      messages.push(assistantMsg);

      if (req.onStatusUpdate && result.content) {
        await Promise.resolve(req.onStatusUpdate({
          type: "model_start",
          round,
          model: result.model,
          content: result.content // Send partial content to user
        })).catch(() => {});
      }

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

        if (req.onStatusUpdate) {
          await Promise.resolve(req.onStatusUpdate({
            type: "tool_start",
            toolName,
            arguments: tc.function.arguments
          })).catch(() => {});
        }

        const toolResult = await executeTool(env, toolName, toolArgs, toolCtx);

        if (req.onStatusUpdate) {
          await Promise.resolve(req.onStatusUpdate({
            type: "tool_end",
            toolName,
            result: toolResult.content
          })).catch(() => {});
        }

        // ---- No Post-Trade Judge Loop needed ----

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

      // Atomic persistence after every round of tool calls to prevent state loss/overwrites
      if (userId) {
        await saveSessionWithRLS(env, sessionId, session, userId);
      } else {
        await saveSession(env.DB, sessionId, session);
      }

      // Track recent tool names for the nudge summary
      recentToolCalls = result.toolCalls.map(tc => tc.function.name);

      // Count tool calls for progress nudging
      totalToolCallsCount += result.toolCalls.length;
      round++;
      continue;
    }

    // finalContent is now accumulated during turns
    break;
  }

  if (round >= MAX_TOOL_ROUNDS && !finalContent) {
    finalContent = "I reached the maximum number of tool iterations. Please try a simpler request.";
  }

  // Only add a final assistant message if there's content and the last turn didn't already add it
  // Actually, we should always add the LAST turn's content if there were no tool calls in it.
  // The logic above breaks if no tool calls. Let's handle the final content addition carefully.
  const lastMsg = session.messages[session.messages.length - 1];
  if (finalContent && (!lastMsg || lastMsg.role !== "assistant" || lastMsg.content !== finalContent)) {
    // If the accumulated content is different from the last message's content, 
    // it means there was intermediate content or the last turn wasn't saved yet.
    // However, if the last turn was a tool call turn, its content is already saved.
    // We only want to save the "final" text that hasn't been saved yet.
    
    // Simpler: If the loop ended naturally (no tool calls in last turn), 
    // we need to save THAT turn's content.
  }
  
  // Re-thinking: Let's just ensure we save the message if we broke out of the loop without tools.
  // The current code does: 
  // if (result.toolCalls) { save; continue; } break;
  // So at line 338, we are AFTER the break.
  
  if (finalContent) {
    // Check if the exact finalContent is already the last message
    const lastMsg = session.messages[session.messages.length - 1];
    if (!lastMsg || lastMsg.content !== finalContent || lastMsg.role !== "assistant") {
      addMessage(session, { role: "assistant", content: finalContent });
    }
  }

  if (req.onStatusUpdate) {
    await Promise.resolve(req.onStatusUpdate({
      type: "complete",
      content: finalContent
    })).catch(() => {});
  }

  session.updatedAt = Date.now();
  
  // Use RLS-protected session setter
  if (userId) {
    await saveSessionWithRLS(env, sessionId, session, userId);
  } else {
    await saveSession(env.DB, sessionId, session);
  }

  // Track usage
  if (usage) {
    await trackUsage(env.DB, sessionId, usage, finalModel, providerId).catch(() => {});
  }

  return {
    content: finalContent,
    model: finalModel,
    usage,
    session_id: sessionId,
  };
}