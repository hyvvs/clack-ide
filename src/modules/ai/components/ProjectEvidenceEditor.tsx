import { useState } from "react";
import type {
  ProjectEntry,
  ProjectMemoryView,
} from "@/modules/ai/lib/projectMemory";

export function ProjectEvidenceEditor({
  entry,
  view,
  busy,
  onVerify,
}: {
  entry: ProjectEntry;
  view: ProjectMemoryView;
  busy: boolean;
  onVerify: (files: string, environment: string, records: string[]) => void;
}) {
  const [files, setFiles] = useState(
    entry.knowledge?.dependencies
      .filter((d) => !d.environment)
      .map((d) => d.path)
      .join("\n") ?? "",
  );
  const [environment, setEnvironment] = useState(
    entry.knowledge?.dependencies
      .filter((d) => d.environment)
      .map((d) => d.path)
      .join("\n") ?? "",
  );
  const [records, setRecords] = useState(entry.knowledge?.records ?? []);
  const input = "w-full min-w-0 rounded border bg-background p-2";
  return (
    <details className="mt-2 min-w-0">
      <summary className="cursor-pointer">Review evidence</summary>
      <div className="mt-2 flex min-w-0 flex-col gap-2">
        <label>
          Source paths
          <textarea
            className={input}
            value={files}
            onChange={(e) => setFiles(e.target.value)}
            rows={3}
            maxLength={8192}
            placeholder="src/auth.ts"
          />
        </label>
        <label>
          Test-environment paths
          <textarea
            className={input}
            value={environment}
            onChange={(e) => setEnvironment(e.target.value)}
            rows={2}
            maxLength={8192}
            placeholder="package-lock.json"
          />
        </label>
        <label>
          Related requirements and records
          <select
            multiple
            className={input}
            value={records}
            onChange={(e) =>
              setRecords(Array.from(e.target.selectedOptions, (o) => o.value))
            }
          >
            {view.entries
              .filter((e) => e.id !== entry.id && e.status === "approved")
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.text.slice(0, 80)}
                </option>
              ))}
          </select>
        </label>
        <button
          type="button"
          className="self-start rounded border px-2 py-1 disabled:opacity-40"
          disabled={busy || (!files.trim() && !environment.trim())}
          onClick={() => onVerify(files, environment, records)}
        >
          Validate against current evidence
        </button>
      </div>
    </details>
  );
}
