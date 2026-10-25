import { availableModels, llmConfig } from "@/lib/llm";
import { decisionConfig } from "@/lib/decision";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    models: availableModels(),
    defaultModel: llmConfig().defaultModel,
    dmModel: decisionConfig().model,
    threshold: decisionConfig().threshold,
  });
}
