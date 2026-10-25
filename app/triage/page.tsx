"use client";

import { useState, type FormEvent } from "react";
import StrategyPicker, { DEFAULT_SETTINGS, type Settings } from "@/components/StrategyPicker";
import type { TriageResponse } from "@/lib/schemas";

export default function TriagePage() {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [result, setResult] = useState<TriageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          body,
          strategy: settings.strategy,
          promptVersion: settings.promptVersion,
          model: settings.model || undefined,
        }),
      });
      const data: unknown = await res.json();
      if (!res.ok) {
        const msg =
          typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
            ? data.error
            : "Triage failed.";
        throw new Error(msg); // F1: a clear error, never a silent failure
      }
      setResult(data as TriageResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Triage failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <h1>Ticket triage</h1>
      <form onSubmit={submit} aria-busy={busy}>
        <StrategyPicker value={settings} onChange={setSettings} disabled={busy} />
        <label>
          Subject
          <input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={busy} />
        </label>
        <label>
          Ticket body
          <textarea rows={7} value={body} onChange={(e) => setBody(e.target.value)} disabled={busy} />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "Triaging..." : "Triage ticket"}
        </button>
        {error && <p role="alert">{error}</p>}
      </form>

      {result && (
        <section className="card" aria-label="Triage result">
          <h2>Result</h2>
          <dl>
            <dt>Category</dt>
            <dd>{result.category}</dd>
            <dt>Priority</dt>
            <dd>{result.priority}</dd>
            <dt>Needs human review</dt>
            <dd>{result.needs_human_review ? "yes" : "no"}</dd>
            <dt>Summary</dt>
            <dd>{result.summary ?? "(none: decision model only)"}</dd>
            <dt>Answered by</dt>
            <dd>
              {result.source.toUpperCase()}: {result.model_used}
              {result.fallback_used && " (fallback after low DM confidence)"}
            </dd>
            <dt>DM confidence</dt>
            <dd>{result.confidence === null ? "n/a" : result.confidence.toFixed(3)}</dd>
            <dt>Models called</dt>
            <dd>{result.models_called.join(", ")}</dd>
            <dt>Token usage</dt>
            <dd>
              input {result.usage.input_tokens} · output {result.usage.output_tokens} · total{" "}
              {result.usage.total_tokens}
            </dd>
            <dt>Latency / cost</dt>
            <dd>
              {result.latency_ms} ms · ${result.cost_usd.toFixed(6)}
            </dd>
          </dl>
        </section>
      )}
    </main>
  );
}
