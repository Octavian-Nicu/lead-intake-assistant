import { useRef, useState } from "react";
import { getSample } from "./api";

interface Props {
  busy: boolean;
  onFile: (name: string, csv: string) => void;
  onError: (message: string) => void;
}

const MAX_BYTES = 4 * 1024 * 1024;

export function Upload({ busy, onFile, onError }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const read = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) return onError("Choose a CSV file. Excel files need to be saved as CSV first.");
    if (file.size > MAX_BYTES) return onError("This file is larger than 4 MB. Split it and upload the parts.");
    onFile(file.name, await file.text());
  };

  return (
    <section>
      <h2>Upload a lead file</h2>
      <p className="lede">
        Bring the file as you received it from the event or the vendor. Column names do not need to match
        anything, the next step works them out.
      </p>
      <div
        className={`drop ${dragging ? "dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void read(event.dataTransfer.files[0]);
        }}
      >
        <p>{busy ? "Reading the file and matching columns…" : "Drop a CSV file here"}</p>
        <div className="actions">
          <button className="primary" disabled={busy} onClick={() => input.current?.click()}>
            Choose a file
          </button>
          <button
            disabled={busy}
            onClick={() =>
              getSample()
                .then((csv) => onFile("sample_leads.csv", csv))
                .catch((error: Error) => onError(error.message))
            }
          >
            Use the sample file
          </button>
        </div>
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(event) => {
            void read(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>
      <p className="hint">Up to 2,000 rows. The sample file contains made up people and companies.</p>
    </section>
  );
}
