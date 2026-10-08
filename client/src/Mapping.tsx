import { TARGET_FIELDS, type ColumnMapping, type MappingTarget } from "../../shared/schema";
import { Confidence, SourceBadge } from "./Badge";

interface Props {
  mapping: ColumnMapping[];
  rowCount: number;
  threshold: number;
  busy: boolean;
  onChange: (mapping: ColumnMapping[]) => void;
  onConfirm: () => void;
  onBack: () => void;
}

export const FIELD_LABELS: Record<MappingTarget, string> = {
  email: "Email",
  first_name: "First name",
  last_name: "Last name",
  company: "Company",
  job_title: "Job title",
  country: "Country",
  phone: "Phone",
  ignore: "Do not import",
};

export function Mapping({ mapping, rowCount, threshold, busy, onChange, onConfirm, onBack }: Props) {
  const used = mapping.map((m) => m.target).filter((t) => t !== "ignore");
  const duplicates = used.filter((target, i) => used.indexOf(target) !== i);
  const problem = !used.includes("email")
    ? "Choose which column holds the email address. Rows cannot be imported without one."
    : duplicates.length > 0
      ? `Two columns are mapped to ${FIELD_LABELS[duplicates[0]]}. Each field can only come from one column.`
      : null;

  const setTarget = (index: number, target: MappingTarget) =>
    onChange(mapping.map((m, i) => (i === index ? { ...m, target } : m)));

  return (
    <section>
      <h2>Check the column mapping</h2>
      <p className="lede">
        {rowCount} rows found. Each column of your file is matched to a standard field. Change anything that
        looks wrong before the rows are checked.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Column in your file</th>
              <th>Example values</th>
              <th>Import as</th>
              <th>Suggested by</th>
              <th>Confidence</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            {mapping.map((m, index) => (
              <tr key={m.source} className={m.method === "fallback" || m.confidence < threshold ? "attention" : ""}>
                <td className="strong">{m.source}</td>
                <td className="muted">{m.samples.join(", ") || "(empty)"}</td>
                <td>
                  <select
                    aria-label={`Import ${m.source} as`}
                    value={m.target}
                    onChange={(event) => setTarget(index, event.target.value as MappingTarget)}
                  >
                    {[...TARGET_FIELDS, "ignore" as const].map((field) => (
                      <option key={field} value={field}>
                        {FIELD_LABELS[field]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <SourceBadge method={m.method} />
                </td>
                <td>{m.method === "fallback" ? "" : <Confidence value={m.confidence} threshold={threshold} />}</td>
                <td className="muted">{m.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {problem && <p className="inline-error">{problem}</p>}
      <div className="actions">
        <button className="primary" disabled={busy || !!problem} onClick={onConfirm}>
          {busy ? `Checking ${rowCount} rows…` : "Confirm mapping and check rows"}
        </button>
        <button disabled={busy} onClick={onBack}>
          Start over
        </button>
      </div>
      {busy && (
        <p className="hint">
          Clear job titles are handled by rules straight away. The rest go to the AI in batches, which can take
          a few seconds.
        </p>
      )}
    </section>
  );
}
