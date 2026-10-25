import { z } from "zod";
import type { Usage } from "./schemas";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export class UpstreamError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
  }
}

export function llmConfig() {
  return {
    baseUrl: (process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, ""),
    apiKey: process.env.LLM_API_KEY || "",
    defaultModel: process.env.LLM_MODEL || "openai/gpt-4o-mini",
  };
}

export function availableModels(): string[] {
  const { defaultModel } = llmConfig();
  const extra = (process.env.LLM_MODELS || "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return Array.from(new Set([defaultModel, ...extra]));
}

const CompletionSchema = z.object({
  model: z.string().optional(),
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
  usage: z
    .object({
      prompt_tokens: z.number().default(0),
      completion_tokens: z.number().default(0),
      total_tokens: z.number().optional(),
      cost: z.number().optional(), // OpenRouter returns this with usage.include
    })
    .optional(),
});

export type ChatResult = { content: string; model: string; usage: Usage; costUsd: number };

export async function chatCompletion(opts: {
  messages: ChatMessage[];
  model?: string;
  jsonSchema?: { name: string; schema: Record<string, unknown> };
}): Promise<ChatResult> {
  const { baseUrl, apiKey, defaultModel } = llmConfig();
  if (!apiKey) throw new UpstreamError("LLM_API_KEY is not set. Copy .env.example to .env.local.", 500);
  const model = opts.model || defaultModel;

  const call = (withSchema: boolean) =>
    fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: opts.messages,
        temperature: 0,
        usage: { include: true },
        ...(withSchema && opts.jsonSchema
          ? {
              response_format: {
                type: "json_schema",
                json_schema: { name: opts.jsonSchema.name, strict: true, schema: opts.jsonSchema.schema },
              },
            }
          : {}),
      }),
    });

  let res = await call(true);
  // Some models reject structured outputs: retry once without response_format.
  if (res.status === 400 && opts.jsonSchema) res = await call(false);
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    throw new UpstreamError(`LLM provider error ${res.status}: ${text}`, 502);
  }

  const parsed = CompletionSchema.safeParse(await res.json());
  if (!parsed.success) throw new UpstreamError("LLM provider returned an unexpected response shape.");
  const data = parsed.data;
  const input = data.usage?.prompt_tokens ?? 0;
  const output = data.usage?.completion_tokens ?? 0;
  return {
    content: data.choices[0].message.content ?? "",
    model: data.model || model,
    usage: {
      input_tokens: input,
      output_tokens: output,
      total_tokens: data.usage?.total_tokens ?? input + output,
    },
    costUsd: data.usage?.cost ?? 0,
  };
}

/** Pull a JSON object out of model text (handles ```json fences and chatter). */
export function extractJson(text: string): unknown {
  const stripped = text.replace(/```(?:json)?/gi, "").trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(stripped.slice(start, end + 1));
    throw new UpstreamError("The model did not return valid JSON.");
  }
}
