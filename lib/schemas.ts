import { z } from "zod";

export const CATEGORIES = ["technical_bug", "feature_request", "account", "billing"] as const;
export const PRIORITIES = ["low", "medium", "high"] as const;
export const STRATEGIES = ["llm", "dm", "dm+llm"] as const;
export const PROMPT_VERSIONS = ["v1", "v2"] as const;

export type Category = (typeof CATEGORIES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Strategy = (typeof STRATEGIES)[number];

// ---------- Triage request (F1) ----------
export const TriageRequestSchema = z.object({
  subject: z.string().trim().max(300, "Subject is too long (300 characters max).").default(""),
  body: z
    .string()
    .trim()
    .min(1, "The ticket body must not be empty.")
    .max(10_000, "The ticket body is too long (10,000 characters max)."),
  strategy: z.enum(STRATEGIES).default("llm"),
  promptVersion: z.enum(PROMPT_VERSIONS).default("v2"),
  model: z.string().trim().min(1).max(200).optional(),
});
export type TriageRequest = z.infer<typeof TriageRequestSchema>;

// What the LLM itself must produce.
export const LlmTriageSchema = z.object({
  category: z.enum(CATEGORIES),
  priority: z.enum(PRIORITIES),
  needs_human_review: z.boolean(),
  summary: z.string().trim().min(1).max(500),
});
export type LlmTriage = z.infer<typeof LlmTriageSchema>;

// ---------- Usage (F2) ----------
export const UsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
});
export type Usage = z.infer<typeof UsageSchema>;

// ---------- Triage response (F1) ----------
export const TriageResponseSchema = z.object({
  category: z.enum(CATEGORIES),
  priority: z.enum(PRIORITIES),
  needs_human_review: z.boolean(),
  summary: z.string().nullable(), // null when a decision model answered alone
  strategy: z.enum(STRATEGIES),
  source: z.enum(["llm", "dm"]), // who produced the final answer
  model_used: z.string(), // model that produced the final answer
  models_called: z.array(z.string()), // every model called (dm+llm may call two)
  fallback_used: z.boolean(),
  confidence: z.number().min(0).max(1).nullable(), // DM confidence, null for pure LLM
  usage: UsageSchema, // summed over every call
  latency_ms: z.number().nonnegative(),
  cost_usd: z.number().nonnegative(),
});
export type TriageResponse = z.infer<typeof TriageResponseSchema>;

// JSON Schemas derived from the Zod schemas (single source of truth).
function toJsonSchema(schema: z.ZodType, io: "input" | "output"): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { io }) as Record<string, unknown>;
  return rest;
}
export const triageRequestJsonSchema = toJsonSchema(TriageRequestSchema, "input");
export const triageResponseJsonSchema = toJsonSchema(TriageResponseSchema, "output");
export const llmTriageJsonSchema = toJsonSchema(LlmTriageSchema, "output");

// ---------- Chat ----------
export const ChatRequestSchema = z
  .object({
    messages: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string().trim().min(1, "Messages must not be empty.").max(8000),
        }),
      )
      .min(1)
      .max(100),
    model: z.string().trim().min(1).max(200).optional(),
  })
  .refine((v) => v.messages[v.messages.length - 1].role === "user", {
    message: "The last message must come from the user.",
    path: ["messages"],
  });
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

// ---------- Smoke test ----------
export const SmokeRequestSchema = z.object({
  dataset: z.enum(["100", "500"]),
  count: z.number().int().min(1, "Sample at least 1 ticket.").max(500),
  strategy: z.enum(STRATEGIES).default("llm"),
  promptVersion: z.enum(PROMPT_VERSIONS).default("v2"),
  model: z.string().trim().min(1).max(200).optional(),
});
export type SmokeRequest = z.infer<typeof SmokeRequestSchema>;

export function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
    .join(" | ");
}
