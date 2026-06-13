import { Message, Env } from "./types";
import { callProvider } from "./providers";

export async function compactMessages(
  env: Env,
  messages: Message[],
  provider: string,
  model: string
): Promise<Message[]> {
  // Keep the system prompt (if any)
  const systemMessage = messages.find(m => m.role === "system");
  const chatMessages = messages.filter(m => m.role !== "system");

  // Determine a tool-safe split point to avoid orphaning tool responses
  let splitIndex = chatMessages.length - 20;
  if (splitIndex < 0) splitIndex = 0;
  
  // Gemini requires that tool responses are immediately preceded by the assistant's tool call.
  // If we start the active window with a tool response, the model will error 400.
  while (splitIndex < chatMessages.length && chatMessages[splitIndex].role === "tool") {
    splitIndex--;
    if (splitIndex < 0) {
      splitIndex = 0;
      break;
    }
  }
  
  const summaryTarget = chatMessages.slice(0, splitIndex);
  const activeWindow = chatMessages.slice(splitIndex);

  const summaryPrompt = `You are a memory compression engine. 
Analyze the following conversation history and create a concise, high-density summary of the key facts, user preferences, and current state of the task. 
Preserve names, specific technical details, and explicit instructions.
Respond only with the summary.

HISTORY:
${summaryTarget.map(m => `${m.role}: ${m.content}`).join("\n")}
`;

  try {
    const res = await callProvider(env, provider, {
      messages: [{ role: "user", content: summaryPrompt }],
      model: model,
    });

    const summary = res.content || "Previous conversation summary unavailable.";
    
    const newMessages: Message[] = [];
    if (systemMessage) newMessages.push(systemMessage);
    
    newMessages.push({
      role: "system",
      content: `[Context Summary of previous interaction]: ${summary}`,
    });
    
    newMessages.push(...activeWindow);
    
    return newMessages;
  } catch (e) {
    console.error("Compaction failed:", e);
    return messages; // Fallback to original on error
  }
}
