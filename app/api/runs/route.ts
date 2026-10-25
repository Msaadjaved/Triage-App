import { readRuns } from "@/lib/runlog";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ runs: (await readRuns()).reverse() });
}
