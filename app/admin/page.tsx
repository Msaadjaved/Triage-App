import { readRuns, type RunRecord } from "@/lib/runlog";

export const dynamic = "force-dynamic";

const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);

function label(r: RunRecord) {
  return `${r.id} · ${r.strategy} · ${r.model} · ${r.dataset} · ${r.started_at.slice(0, 16).replace("T", " ")}`;
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const { a, b } = await searchParams;
  const runs = (await readRuns()).reverse(); // newest first
  const runA = runs.find((r) => r.id === a);
  const runB = runs.find((r) => r.id === b);

  const rows: [string, (r: RunRecord) => string][] = [
    ["Strategy", (r) => r.strategy],
    ["Model(s)", (r) => r.model],
    ["Prompt", (r) => r.prompt_version],
    ["Dataset / sample", (r) => `${r.dataset} / ${r.sampled}`],
    ["Category accuracy", (r) => pct(r.accuracy.category)],
    ["Priority accuracy", (r) => pct(r.accuracy.priority)],
    ["Both correct", (r) => pct(r.accuracy.both)],
    ["Mismatches (cat / prio)", (r) => (r.mismatches ? `${r.mismatches.category} / ${r.mismatches.priority}` : "n/a")],
    ["OK / errors / fallbacks", (r) => `${r.outcomes.ok} / ${r.outcomes.errors} / ${r.outcomes.fallbacks}`],
    ["Avg latency (ms)", (r) => String(r.latency_ms.average)],
    ["Total time (ms)", (r) => String(r.latency_ms.total)],
    ["Cost (USD)", (r) => r.cost_usd.toFixed(6)],
    ["Tokens in / out", (r) => `${r.tokens.input} / ${r.tokens.output}`],
  ];

  return (
    <main className="page">
      <h1>Admin: smoke test runs</h1>

      <form method="get" className="row">
        <label>
          Run A
          <select name="a" defaultValue={a ?? ""}>
            <option value="">-</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {label(r)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Run B
          <select name="b" defaultValue={b ?? ""}>
            <option value="">-</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {label(r)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Compare</button>
      </form>

      {runA && runB && (
        <section className="card" aria-label="Comparison">
          <h2>Side by side</h2>
          <table>
            <thead>
              <tr>
                <th></th>
                <th>
                  A: <code>{runA.id}</code>
                </th>
                <th>
                  B: <code>{runB.id}</code>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([name, fn]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>{fn(runA)}</td>
                  <td>{fn(runB)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <h2>All runs</h2>
      {runs.length === 0 ? (
        <p>No runs logged yet. Start one from the Smoke test page.</p>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Run</th>
                <th>Date</th>
                <th>Strategy</th>
                <th>Model(s)</th>
                <th>Set</th>
                <th>Cat acc.</th>
                <th>Prio acc.</th>
                <th>OK/err/fb</th>
                <th>Avg ms</th>
                <th>Cost $</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>
                    <code>{r.id}</code>
                  </td>
                  <td>{r.started_at.slice(0, 16).replace("T", " ")}</td>
                  <td>{r.strategy}</td>
                  <td>{r.model}</td>
                  <td>
                    {r.dataset} ({r.sampled})
                  </td>
                  <td>{pct(r.accuracy.category)}</td>
                  <td>{pct(r.accuracy.priority)}</td>
                  <td>
                    {r.outcomes.ok}/{r.outcomes.errors}/{r.outcomes.fallbacks}
                  </td>
                  <td>{r.latency_ms.average}</td>
                  <td>{r.cost_usd.toFixed(6)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
