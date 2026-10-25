import { TriageRequestSchema, TriageResponseSchema, formatZodIssues } from "@/lib/schemas";
import { runTriage } from "@/lib/triage";
import { UpstreamError } from "@/lib/llm";
import { ZodError } from "zod";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // F1: validate the request against its schema, with a clear error for the front end.
  const parsed = TriageRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: formatZodIssues(parsed.error) }, { status: 400 });
  }

  try {
    const result = await runTriage(parsed.data);
    // F1: validate the response before forwarding it.
    const checked = TriageResponseSchema.safeParse(result);
    if (!checked.success) {
      return Response.json(
        { error: `Internal response validation failed: ${formatZodIssues(checked.error)}` },
        { status: 502 },
      );
    }
    return Response.json(checked.data);
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json(
        { error: `The model answer did not match the expected schema: ${formatZodIssues(error)}` },
        { status: 502 },
      );
    }
    const status = error instanceof UpstreamError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return Response.json({ error: message }, { status });
  }
}
