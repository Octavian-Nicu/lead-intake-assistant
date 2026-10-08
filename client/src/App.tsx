import { useEffect, useState } from "react";
import type { ColumnMapping, RawRow, RowResult, RunStats } from "../../shared/schema";
import { analyze, getHealth, normalize, type Health } from "./api";
import { Mapping } from "./Mapping";
import { Review } from "./Review";
import { mergeStats, Stats } from "./Stats";
import { Upload } from "./Upload";

type Step = "upload" | "mapping" | "review";
const STEPS: { id: Step; label: string }[] = [
  { id: "upload", label: "Upload" },
  { id: "mapping", label: "Map columns" },
  { id: "review", label: "Review and export" },
];

export function App() {
  const [step, setStep] = useState<Step>("upload");
  const [health, setHealth] = useState<Health | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [rawRows, setRawRows] = useState<RawRow[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping[]>([]);
  const [results, setResults] = useState<RowResult[]>([]);
  const [stats, setStats] = useState<RunStats | null>(null);

  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch((e: Error) => setError(e.message));
  }, []);

  const threshold = health?.threshold ?? 0.8;

  // Wraps a server call with the busy flag and a visible error, so no failure is silent.
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const onFile = (name: string, csv: string) =>
    run(async () => {
      const response = await analyze(csv);
      setFileName(name);
      setRawRows(response.rows);
      setMapping(response.mapping);
      setStats(response.stats);
      setStep("mapping");
    });

  const onConfirm = () =>
    run(async () => {
      const response = await normalize(rawRows, mapping);
      setResults(response.rows);
      setStats((previous) => mergeStats(previous, response.stats));
      setStep("review");
    });

  const reset = () => {
    setStep("upload");
    setError(null);
    setStats(null);
    setResults([]);
  };

  const aiUnavailable = stats !== null && stats.llmFailures > 0 && stats.byMethod.fallback > 0;

  return (
    <div className="page">
      <header>
        <div>
          <h1>Lead intake assistant</h1>
          <p>Turn a raw lead list into a clean, import ready file.</p>
        </div>
        {health && (
          <p className={`mode mode-${health.mode}`}>
            {health.mode === "mock" ? "Demo mode: recorded AI answers, no cost" : `Live AI: ${health.model}`}
          </p>
        )}
      </header>

      <ol className="steps">
        {STEPS.map((s, index) => (
          <li key={s.id} className={s.id === step ? "current" : STEPS.findIndex((x) => x.id === step) > index ? "done" : ""}>
            <span className="step-number">{index + 1}</span> {s.label}
          </li>
        ))}
      </ol>

      {error && (
        <div className="banner error" role="alert">
          <span>{error}</span>
          <button className="link" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}
      {aiUnavailable && (
        <div className="banner warning" role="status">
          The AI service did not answer for part of this file. Everything the rules could handle is done, and the
          rest is marked "Needs you" so nothing is lost.
        </div>
      )}

      <main>
        {step === "upload" && <Upload busy={busy} onFile={onFile} onError={setError} />}
        {step === "mapping" && (
          <Mapping
            mapping={mapping}
            rowCount={rawRows.length}
            threshold={threshold}
            busy={busy}
            onChange={setMapping}
            onConfirm={onConfirm}
            onBack={reset}
          />
        )}
        {step === "review" && <Review rows={results} threshold={threshold} fileName={fileName} onBack={reset} />}
      </main>

      {stats && <Stats stats={stats} />}
    </div>
  );
}
