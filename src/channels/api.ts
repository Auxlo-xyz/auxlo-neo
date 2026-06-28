import type { Env, AgentRequest } from "../types";
import { agentChat } from "../agent";

interface ChatCompletionRequest {
  model?: string;
  messages?: { role: string; content: string }[];
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  session_id?: string;
  provider?: string;
}

export async function handleChatCompletions(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  // Auth check: fail closed unless API_KEY is configured and supplied.
  const auth = request.headers.get("Authorization");
  if (!env.API_KEY || auth !== `Bearer ${env.API_KEY}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  const body: ChatCompletionRequest = await request.json();

  if (!body.messages || body.messages.length === 0) {
    return Response.json({ error: "messages required" }, { status: 400, headers: corsHeaders });
  }

  // Extract last user message
  const lastUser = [...body.messages].reverse().find((m) => m.role === "user");
  if (!lastUser) {
    return Response.json({ error: "No user message found" }, { status: 400, headers: corsHeaders });
  }

  const agentReq: AgentRequest = {
    message: lastUser.content,
    session_id: body.session_id || "api",
    model: body.model,
    provider: body.provider,
    max_tokens: body.max_tokens,
    temperature: body.temperature,
  };

  // Streaming
  if (body.stream) {
    const encoder = new TextEncoder();
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    ctx.waitUntil(
      (async () => {
        try {
          const result = await agentChat(env, agentReq);
          const chunk = {
            id: `chatcmpl-${crypto.randomUUID().slice(0, 8)}`,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: result.model || "auxlo-neo",
            choices: [
              {
                index: 0,
                delta: { content: result.content },
                finish_reason: null,
              },
            ],
          };
          await writer.write(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));

          const done = {
            ...chunk,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          };
          await writer.write(encoder.encode(`data: ${JSON.stringify(done)}\n\n`));
          await writer.write(encoder.encode("data: [DONE]\n\n"));
        } catch (err: any) {
          const errChunk = { error: { message: err.message, type: "server_error" } };
          await writer.write(encoder.encode(`data: ${JSON.stringify(errChunk)}\n\n`));
        } finally {
          await writer.close();
        }
      })()
    );

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  // Non-streaming
  try {
    const result = await agentChat(env, agentReq);

    return Response.json(
      {
        id: `chatcmpl-${crypto.randomUUID().slice(0, 8)}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: result.model || "auxlo-neo",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: result.content },
            finish_reason: "stop",
          },
        ],
        usage: result.usage || {},
      },
      { headers: corsHeaders }
    );
  } catch (err: any) {
    return Response.json(
      { error: { message: err.message, type: "server_error" } },
      { status: 500, headers: corsHeaders }
    );
  }
}
