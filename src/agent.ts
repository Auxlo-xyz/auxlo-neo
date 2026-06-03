import type { Env, AgentRequest, AgentResponse, Message, ProviderRequest } from "./types";
import { callProvider } from "./providers";
import { getToolDefinitions, executeTool } from "./tools";
import { getSession, saveSession, createSession, addMessage, getMemory } from "./memory";

const MAX_TOOL_ROUNDS = 8;

const DEFAULT_SYSTEM_PROMPT = `You are AuxloNeo, a fast, capable AI assistant running on the edge. You are concise, direct, and helpful.

You have access to tools -- use them when they can help answer a question better than your training data. Prefer web_search for current information and web_fetch to read specific pages.

Be direct. Don't apologize unnecessarily or add filler. Give substantive answers.`;

export async function agentChat(env: Env, req: AgentRequest): Promise<AgentResponse> {
  const sessionId = req.session_id || "default";
  const providerName = req.provider || env.DEFAULT_PROVIDER || "openai";
  const model = req.model || env.DEFAULT_MODEL || undefined;

  let session = await getSession(env.SESSIONS, sessionId);
  if (!session) {
    session = createSession(sessionId);
  }

  const userMessage: Message = { role: "user", content: req.message };
  addMessage(session, userMessage);

  const memoryContext = await getMemory(env.MEMORY, sessionId);

  const systemPrompt = env.DEFAULT_SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT;
  const fullSystem = memoryContext
    ? `${systemPrompt}\n\n---\nPrevious conversation context:\n${memoryContext}`
    : systemPrompt;

  const messages: Message[] = [
    { role: "system", content: fullSystem },
    ...session.messages,
  ];

  const toolDefs = getToolDefinitions(env);

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

    const result = await callProvider(env, providerName, providerReq);

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

        const toolResult = await executeTool(env, toolName, toolArgs);

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

  return {
    content: finalContent,
    model: finalModel,
    usage,
    session_id: sessionId,
  };
}
