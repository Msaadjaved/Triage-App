import { promises as fs } from "fs";
import path from "path";
import type { Strategy } from "./schemas";

export type RunRecord = {
  id: string;
  started_at: string;
  dataset: "100" | "500";
  sampled: number;
  strategy: Strategy;
  prompt_version: string;
  /** Name of the model(s) used: LLM, DM, or "dm+llm" pair. */
  model: string;
  models: { llm: string | null; dm: string | null };
  accuracy: { category: number | null; priority: number | null; both: number | null };
  mismatches: { category: number; priority: number } | null;
  outcomes: { ok: number; errors: number; fallbacks: number };
  latency_ms: { average: number; total: number };
  cost_usd: number;
  tokens: { input: number; output: number; total: number };
};

const FILE = path.join(process.cwd(), "data", "runs.json");
let queue: Promise<unknown> = Promise.resolve();

export async function readRuns(): Promise<RunRecord[]> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as RunRecord[];
  } catch {
    return [];
  }
}

/** Append one run. Writes are serialised so two smoke tests cannot corrupt the file. */
export function appendRun(run: RunRecord): Promise<void> {
  const next = queue.then(async () => {
    const runs = await readRuns();
    runs.push(run);
    await fs.writeFile(FILE, JSON.stringify(runs, null, 2), "utf8");
  });
  queue = next.catch(() => undefined);
  return next;
}
