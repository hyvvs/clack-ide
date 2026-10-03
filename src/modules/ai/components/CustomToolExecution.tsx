import { useEffect, useId, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  executeCustomTool,
  executionHistory,
  type ExecutionRecord,
} from "@/modules/ai/lib/customToolExecution";
import type { ToolEntry } from "@/modules/ai/lib/customTools";

function outcome(record: ExecutionRecord) {
  return `${record.state}${record.effect === "unknown" ? " / effect unknown" : ""}`;
}
export function CustomToolHistory({ sessionId }: { sessionId: string }) {
  const [records, setRecords] = useState<ExecutionRecord[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    let generation = 0;
    const refresh = () => {
      const requested = ++generation;
      void executionHistory(sessionId)
        .then((value) => {
          if (live && requested === generation) {
            setRecords(value);
            setError("");
          }
        })
        .catch(() => {
          if (live) setError("Execution history unavailable");
        });
    };
    refresh();
    const pending = listen<{ sessionId: string }>(
      "clack:custom-tool-execution",
      ({ payload }) => {
        if (payload.sessionId === sessionId) refresh();
      },
    );
    return () => {
      live = false;
      void pending.then((stop) => stop());
    };
  }, [sessionId]);
  return (
    <section
      aria-label="Custom tool execution history"
      className="min-w-0 space-y-2"
    >
      <h3 className="text-sm font-medium">Recent executions</h3>
      {error && (
        <p role="alert" className="text-xs">
          {error}
        </p>
      )}
      {!records.length && !error && (
        <p className="text-xs text-muted-foreground">No executions</p>
      )}
      {records
        .slice(-16)
        .reverse()
        .map((record) => (
          <details key={record.id} className="min-w-0 border-b py-2 text-xs">
            <summary className="break-all">
              {record.toolName} v{record.tool.version}: {outcome(record)}
            </summary>
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all">
              {JSON.stringify(record, null, 2)}
            </pre>
          </details>
        ))}
    </section>
  );
}

export function CustomToolTest({
  sessionId,
  entry,
  onClose,
}: {
  sessionId: string;
  entry: ToolEntry;
  onClose: () => void;
}) {
  const inputId = useId();
  const binding = entry.current.definition.binding;
  const [input, setInput] = useState(
    JSON.stringify(
      binding.kind === "native"
        ? { path: "" }
        : binding.kind === "http" && binding.method === "POST"
          ? { body: {} }
          : {},
      null,
      2,
    ),
  );
  const [record, setRecord] = useState<ExecutionRecord>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);
  const test = async () => {
    setError("");
    setRecord(undefined);
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    try {
      const argumentsValue: unknown = JSON.parse(input);
      await executeCustomTool({
        sessionId,
        callId: crypto.randomUUID(),
        tool: {
          id: entry.id,
          version: entry.current.version,
          hash: entry.current.hash,
        },
        arguments: argumentsValue,
        test: true,
        signal: abort.signal,
        isCurrent: () => alive.current,
        onRecord: setRecord,
      });
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof SyntaxError
            ? "Invalid argument JSON"
            : e instanceof DOMException && e.name === "AbortError"
              ? "Cancelled"
              : String(e),
        );
    } finally {
      if (alive.current) setBusy(false);
      controller.current = null;
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="flex max-h-[90vh] w-[calc(100vw-24px)] max-w-2xl flex-col overflow-hidden p-4">
        <DialogHeader className="pr-7">
          <DialogTitle className="break-all leading-snug tracking-normal">
            Test {entry.current.definition.name}
          </DialogTitle>
          <DialogDescription>
            Real operation. Native approval required. Not a dry run.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto">
          <p className="break-all text-xs">
            Version {entry.current.version} · {entry.current.hash}
          </p>
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all text-xs">
            {JSON.stringify(binding, null, 2)}
          </pre>
          <label htmlFor={inputId} className="block text-xs">
            Arguments
          </label>
          <Textarea
            id={inputId}
            aria-label="Test arguments"
            className="max-h-48 font-mono text-xs"
            maxLength={16384}
            disabled={busy}
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          {record && (
            <>
              <p role="status" className="break-words text-xs">
                {outcome(record)}
              </p>
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all text-xs">
                {JSON.stringify(
                  record.state === "succeeded"
                    ? record.result
                    : { error: record.error, transitions: record.transitions },
                  null,
                  2,
                )}
              </pre>
            </>
          )}
          {error && (
            <p role="alert" className="break-all text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t pt-3">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Close
          </Button>
          {busy ? (
            <Button
              variant="outline"
              onClick={() => controller.current?.abort()}
            >
              Cancel test
            </Button>
          ) : (
            <Button disabled={!entry.executable} onClick={() => void test()}>
              Request test
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
