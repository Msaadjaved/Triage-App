"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import StrategyPicker, { DEFAULT_SETTINGS, type Settings } from "@/components/StrategyPicker";
import type { RunRecord } from "@/lib/runlog";

type Row = {
  ticket_id: string;
  subject: string;
  ok: boolean;
  predicted: { category: string; priority: string } | null;
  expected: { category: string | null; priority: string | null } | null;
  source: string | null;
  fallback_used: boolean;
  latency_ms: number;
  error: string | null;
};

export default function SmokePage() {
  const [dataset, setDataset] = useState<"100" | "500">("100");
  const [count, setCount] = useState(10);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<RunRecord | null>(null);
  const [rows, setRows] = useState<Row[]>([]);

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setRun(null);
    setRows([]);
    try {
      const res = await fetch("/api/smoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataset,
          count,
          strategy: settings.strategy,
          promptVersion: settings.promptVersion,
          model: settings.model || undefined,
        }),
      });
      const data: unknown = await res.json();
      if (!res.ok) {
        throw new Error(
          typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
            ? data.error
            : "Smoke test failed.",
        );
      }
      const d = data as { run: RunRecord; results: Row[] };
      setRun(d.run);
      setRows(d.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Smoke test failed.");
    } finally {
      setBusy(false);
    }
  }

  const labelled = dataset === "100";
  const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);

  return (
    <main className="page">
      <h1>Smoke test</h1>
      <form onSubmit={start} aria-busy={busy}>
        <StrategyPicker value={settings} onChange={setSettings} disabled={busy} />
        <div className="row">
          <label>
            Dataset
            <select value={dataset} onChange={(e) => setDataset(e.target.value as "100" | "500")} disabled={busy}>
              <option value="100">100 tickets (labelled)</option>
              <option value="500">500 tickets (unlabelled)</option>
            </select>
          </label>
          <label>
            Random sample size
            <input
              type="number"
              min={1}
              max={dataset === "100" ? 100 : 500}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              disabled={busy}
            />
          </label>
          <button type="submit" disabled={busy || !Number.isInteger(count) || count < 1}>
            {busy ? "Running..." : "Run smoke test"}
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
      </form>

      {run && (
        <section className="card" aria-label="Summary">
          <h2>Summary</h2>
          <p>
            Run <code>{run.id}</code> · {run.strategy} · {run.model} · {run.sampled} tickets ·{" "}
            <Link href="/admin">see /admin</Link>
          </p>
          {run.mismatches ? (
            <p>
              Mismatches: <strong>{run.mismatches.category}</strong> category, <strong>{run.mismatches.priority}</strong>{" "}
              priority (accuracy {pct(run.accuracy.category)} / {pct(run.accuracy.priority)})
            </p>
          ) : (
            <p>Unlabelled set: no accuracy available.</p>
          )}
          <p>
            OK {run.outcomes.ok} · errors {run.outcomes.errors} · fallbacks {run.outcomes.fallbacks} · avg latency{" "}
            {run.latency_ms.average} ms · cost ${run.cost_usd.toFixed(6)} · tokens {run.tokens.total}
          </p>
        </section>
      )}

      {rows.length > 0 && (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Predicted category</th>
                {labelled && <th>Labelled category</th>}
                <th>Predicted priority</th>
                {labelled && <th>Labelled priority</th>}
                <th>By</th>
                <th>ms</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const catBad = labelled && r.ok && r.predicted?.category !== r.expected?.category;
                const prioBad = labelled && r.ok && r.predicted?.priority !== r.expected?.priority;
                return (
                  <tr key={r.ticket_id}>
                    <td title={r.subject}>{r.ticket_id}</td>
                    <td className={catBad ? "bad" : ""}>{r.ok ? r.predicted?.category : `error: ${r.error}`}</td>
                    {labelled && <td>{r.expected?.category}</td>}
                    <td className={prioBad ? "bad" : ""}>{r.ok ? r.predicted?.priority : ""}</td>
                    {labelled && <td>{r.expected?.priority}</td>}
                    <td>
                      {r.source}
                      {r.fallback_used ? " (fallback)" : ""}
                    </td>
                    <td>{r.latency_ms}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
