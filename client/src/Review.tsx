import Papa from "papaparse";
import { useState } from "react";
import { safeRecord } from "../../shared/csv";
import { DEPARTMENTS, SENIORITIES, type Department, type RowResult, type Seniority } from "../../shared/schema";
import { Confidence, SourceBadge } from "./Badge";

interface Decision {
  action: "accepted" | "rejected";
  seniority: Seniority;
  department: Department;
}

interface Props {
  rows: RowResult[];
  threshold: number;
  fileName: string;
  onBack: () => void;
}

function download(name: string, records: Record<string, string>[]) {
  const csv = Papa.unparse(records.map(safeRecord));
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

const person = (row: RowResult) => [row.data.first_name, row.data.last_name].filter(Boolean).join(" ") || row.data.email;

export function Review({ rows, threshold, fileName, onBack }: Props) {
  // What the reviewer currently has in the dropdowns, and what they have finally decided.
  const [edits, setEdits] = useState<Record<number, { seniority: Seniority; department: Department }>>({});
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});

  const ready = rows.filter((r) => r.status === "ok");
  const review = rows.filter((r) => r.status === "needs_review");
  const invalid = rows.filter((r) => r.status === "invalid");
  const decided = review.filter((r) => decisions[r.index]).length;
  const allDecided = decided === review.length;

  const current = (row: RowResult) =>
    edits[row.index] ?? { seniority: row.title.seniority, department: row.title.department };

  const decide = (row: RowResult, action: Decision["action"]) =>
    setDecisions({ ...decisions, [row.index]: { action, ...current(row) } });

  const undo = (row: RowResult) => {
    const { [row.index]: _removed, ...rest } = decisions;
    setDecisions(rest);
  };

  const exportClean = () => {
    const auto = ready.map((r) => ({
      ...r.data,
      seniority: r.title.seniority,
      department: r.title.department,
      review_status: "auto",
    }));
    const reviewed = review
      .filter((r) => decisions[r.index]?.action === "accepted")
      .map((r) => {
        const d = decisions[r.index];
        const edited = d.seniority !== r.title.seniority || d.department !== r.title.department;
        return { ...r.data, seniority: d.seniority, department: d.department, review_status: edited ? "edited" : "accepted" };
      });
    download(fileName.replace(/\.csv$/i, "") + "_clean.csv", [...auto, ...reviewed]);
  };

  const exportRejected = () => {
    const automatic = invalid.map((r) => ({ source_row: String(r.index + 2), ...r.data, reject_reason: r.issues.join("; ") }));
    const manual = review
      .filter((r) => decisions[r.index]?.action === "rejected")
      .map((r) => ({ source_row: String(r.index + 2), ...r.data, reject_reason: "Rejected during review" }));
    download(fileName.replace(/\.csv$/i, "") + "_rejected.csv", [...automatic, ...manual]);
  };

  const rejectedCount = invalid.length + review.filter((r) => decisions[r.index]?.action === "rejected").length;
  const cleanCount = ready.length + review.filter((r) => decisions[r.index]?.action === "accepted").length;

  return (
    <section>
      <h2>Review the rows that need you</h2>
      <p className="lede">
        {ready.length} of {rows.length} rows are ready. {review.length} need a decision from you and{" "}
        {invalid.length} cannot be imported.
      </p>

      {review.length > 0 && (
        <>
          <h3>
            Need your decision <span className="count">{decided} of {review.length} done</span>
          </h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Person</th>
                  <th>Job title in file</th>
                  <th>Seniority</th>
                  <th>Department</th>
                  <th>AI note</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {review.map((row) => {
                  const decision = decisions[row.index];
                  const value = decision ?? current(row);
                  const change = (patch: Partial<{ seniority: Seniority; department: Department }>) =>
                    setEdits({ ...edits, [row.index]: { ...current(row), ...patch } });
                  return (
                    <tr key={row.index} className={decision ? `decided ${decision.action}` : "attention"}>
                      <td className="num">{row.index + 2}</td>
                      <td>
                        <span className="strong">{person(row)}</span>
                        <br />
                        <span className="muted">{row.data.company}</span>
                      </td>
                      <td className="strong">{row.data.job_title}</td>
                      <td>
                        <select
                          aria-label="Seniority"
                          disabled={!!decision}
                          value={value.seniority}
                          onChange={(e) => change({ seniority: e.target.value as Seniority })}
                        >
                          {SENIORITIES.map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          aria-label="Department"
                          disabled={!!decision}
                          value={value.department}
                          onChange={(e) => change({ department: e.target.value as Department })}
                        >
                          {DEPARTMENTS.map((d) => (
                            <option key={d}>{d}</option>
                          ))}
                        </select>
                      </td>
                      <td className="muted">
                        <SourceBadge method={row.title.method} />{" "}
                        {row.title.method !== "fallback" && <Confidence value={row.title.confidence} threshold={threshold} />}
                        <br />
                        {row.title.reason}
                      </td>
                      <td className="decision">
                        {decision ? (
                          <>
                            <span className="strong">{decision.action === "accepted" ? "Accepted" : "Rejected"}</span>
                            <button className="link" onClick={() => undo(row)}>
                              Undo
                            </button>
                          </>
                        ) : (
                          <>
                            <button className="primary small" onClick={() => decide(row, "accepted")}>
                              Accept
                            </button>
                            <button className="small" onClick={() => decide(row, "rejected")}>
                              Reject
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {invalid.length > 0 && (
        <>
          <h3>Cannot be imported</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Person</th>
                  <th>Email in file</th>
                  <th>Problem</th>
                </tr>
              </thead>
              <tbody>
                {invalid.map((row) => (
                  <tr key={row.index}>
                    <td className="num">{row.index + 2}</td>
                    <td>{person(row) || "(no name)"}</td>
                    <td className="muted">{row.data.email || "(empty)"}</td>
                    <td className="problem">{row.issues.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <details>
        <summary>Show the {ready.length} rows that are ready</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Row</th>
                <th>Person</th>
                <th>Job title in file</th>
                <th>Seniority</th>
                <th>Department</th>
                <th>Decided by</th>
              </tr>
            </thead>
            <tbody>
              {ready.map((row) => (
                <tr key={row.index}>
                  <td className="num">{row.index + 2}</td>
                  <td>{person(row)}</td>
                  <td>{row.data.job_title || "(none)"}</td>
                  <td>{row.title.seniority}</td>
                  <td>{row.title.department}</td>
                  <td>
                    <SourceBadge method={row.title.method} />{" "}
                    {row.title.method !== "empty" && <Confidence value={row.title.confidence} threshold={threshold} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <div className="export">
        <div className="actions">
          <button className="primary" disabled={!allDecided} onClick={exportClean}>
            Download clean file ({cleanCount} rows)
          </button>
          <button disabled={!allDecided || rejectedCount === 0} onClick={exportRejected}>
            Download rejection report ({rejectedCount} rows)
          </button>
          <button onClick={onBack}>Start over</button>
        </div>
        {!allDecided && (
          <p className="hint">
            Accept or reject the remaining {review.length - decided} rows to unlock the downloads.
          </p>
        )}
      </div>
    </section>
  );
}
