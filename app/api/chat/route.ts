import { ChatRequestSchema, formatZodIssues } from "@/lib/schemas";
import { chatCompletion, UpstreamError } from "@/lib/llm";

const SYSTEM_PROMPT =
  "You are a helpful customer support assistant. Be concise and friendly. Use the conversation so far to answer.";
const MAX_HISTORY = 20; // keep the context window (and the bill) bounded

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = ChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: formatZodIssues(parsed.error) }, { status: 400 });
  }

  try {
    // Memory = the conversation history sent by the client, replayed on every call.
    const history = parsed.data.messages.slice(-MAX_HISTORY);
    const result = await chatCompletion({
      model: parsed.data.model,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history],
    });
    return Response.json({ answer: result.content, model: result.model, usage: result.usage });
  } catch (error) {
    const status = error instanceof UpstreamError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return Response.json({ error: message }, { status });
  }
}
