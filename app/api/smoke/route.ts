import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { SmokeRequestSchema, TriageRequestSchema, formatZodIssues, type TriageResponse } from "@/lib/schemas";
import { runTriage } from "@/lib/triage";
import { llmConfig } from "@/lib/llm";
import { decisionConfig } from "@/lib/decision";
import { appendRun, type RunRecord } from "@/lib/runlog";

export const maxDuration = 300;
const CONCURRENCY = 4;

type Ticket = {
  ticket_id: string;
  subject: string;
  body: string;
  category?: string;
  priority?: string;
};

function sample<T>(items: T[], n: number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = SmokeRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: formatZodIssues(parsed.error) }, { status: 400 });
  const cfg = parsed.data;

  const file = cfg.dataset === "100" ? "support_tickets_100_labelled.json" : "support_tickets_500.json";
  const all = JSON.parse(await fs.readFile(path.join(process.cwd(), "data", file), "utf8")) as Ticket[];
  const labelled = cfg.dataset === "100";
  const tickets = sample(all, Math.min(cfg.count, all.length));

  const started = Date.now();
  const results = await mapPool(tickets, CONCURRENCY, async (t) => {
    const req = TriageRequestSchema.parse({
      subject: t.subject,
      body: t.body,
      strategy: cfg.strategy,
      promptVersion: cfg.promptVersion,
      model: cfg.model,
    });
    try {
      const r: TriageResponse = await runTriage(req);
      return {
        ticket_id: t.ticket_id,
        subject: t.subject,
        ok: true as const,
        predicted: { category: r.category, priority: r.priority },
        expected: labelled ? { category: t.category ?? null, priority: t.priority ?? null } : null,
        source: r.source,
        fallback_used: r.fallback_used,
        latency_ms: r.latency_ms,
        cost_usd: r.cost_usd,
        usage: r.usage,
        error: null as string | null,
      };
    } catch (error) {
      return {
        ticket_id: t.ticket_id,
        subject: t.subject,
        ok: false as const,
        predicted: null,
        expected: labelled ? { category: t.category ?? null, priority: t.priority ?? null } : null,
        source: null,
        fallback_used: false,
        latency_ms: 0,
        cost_usd: 0,
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });
  const wall = Date.now() - started;

  const okRows = results.filter((r) => r.ok);
  let catMismatch = 0;
  let prioMismatch = 0;
  let bothOk = 0;
  if (labelled) {
    for (const r of okRows) {
      const c = r.predicted!.category === r.expected!.category;
      const p = r.predicted!.priority === r.expected!.priority;
      if (!c) catMismatch++;
      if (!p) prioMismatch++;
      if (c && p) bothOk++;
    }
  }
  const n = okRows.length;
  const ratio = (x: number) => (n ? x / n : null);

  const llm = llmConfig().defaultModel;
  const dm = decisionConfig().model;
  const llmName = cfg.model || llm;
  const run: RunRecord = {
    id: randomUUID().slice(0, 8),
    started_at: new Date(started).toISOString(),
    dataset: cfg.dataset,
    sampled: tickets.length,
    strategy: cfg.strategy,
    prompt_version: cfg.promptVersion,
    model: cfg.strategy === "llm" ? llmName : cfg.strategy === "dm" ? dm : `${dm} + ${llmName}`,
    models: {
      llm: cfg.strategy === "dm" ? null : llmName,
      dm: cfg.strategy === "llm" ? null : dm,
    },
    accuracy: labelled
      ? { category: ratio(n - catMismatch), priority: ratio(n - prioMismatch), both: ratio(bothOk) }
      : { category: null, priority: null, both: null },
    mismatches: labelled ? { category: catMismatch, priority: prioMismatch } : null,
    outcomes: {
      ok: n,
      errors: results.length - n,
      fallbacks: results.filter((r) => r.fallback_used).length,
    },
    latency_ms: {
      average: n ? Math.round(okRows.reduce((s, r) => s + r.latency_ms, 0) / n) : 0,
      total: wall,
    },
    cost_usd: results.reduce((s, r) => s + r.cost_usd, 0),
    tokens: {
      input: results.reduce((s, r) => s + r.usage.input_tokens, 0),
      output: results.reduce((s, r) => s + r.usage.output_tokens, 0),
      total: results.reduce((s, r) => s + r.usage.total_tokens, 0),
    },
  };
  await appendRun(run); // F4: every run is logged

  return Response.json({ run, results });
}
