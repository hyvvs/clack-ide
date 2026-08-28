import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { requestPeerTask } from "../lib/peerTaskCoordinator";
import type { PeerTaskKind } from "../lib/peerTasks";
import type { SessionMeta } from "../lib/sessions";

const KINDS: Array<{ id: PeerTaskKind; label: string }> = [
  { id: "question", label: "Ask" },
  { id: "review", label: "Review" },
  { id: "delegate", label: "Delegate" },
];

export function PeerTaskDialog({
  sourceSessionId,
  target,
  open,
  onOpenChange,
}: {
  sourceSessionId: string;
  target: SessionMeta | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [kind, setKind] = useState<PeerTaskKind>("question");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPrompt("");
    setError(null);
    setKind("question");
  }, [open]);

  const submit = async () => {
    if (!target || !prompt.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    const result = await requestPeerTask({
      sourceSessionId,
      targetSessionId: target.id,
      kind,
      prompt,
      awaitCompletion: false,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Work with {target?.title ?? "peer chat"}</DialogTitle>
          <DialogDescription>
            The target uses its own agent and model. The task and result stay
            visible in both conversations.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-1 rounded-[var(--clack-radius-button)] bg-[var(--clack-surface-2)] p-1">
            {KINDS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setKind(item.id)}
                className={cn(
                  "h-7 rounded-[var(--clack-radius-button)] text-[11px] transition-colors",
                  kind === item.id
                    ? "bg-[var(--clack-surface-1)] text-[var(--clack-text-1)] shadow-sm"
                    : "text-[var(--clack-text-3)] hover:text-[var(--clack-text-1)]",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
          <Textarea
            autoFocus
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={
              kind === "review"
                ? "What should this agent review?"
                : kind === "delegate"
                  ? "Describe the bounded task to delegate."
                  : "What should this agent answer?"
            }
            className="min-h-28 resize-y"
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
          <div className="text-[10px] text-muted-foreground">
            {target?.run?.state === "running"
              ? "This chat is busy, so the task will queue."
              : `Agent: ${target?.profile?.agentId ?? "missing"} · Model: ${target?.profile?.modelId ?? "missing"}`}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={!target || !prompt.trim() || submitting}
          >
            {submitting ? "Starting..." : target?.run?.state === "running" ? "Queue task" : "Start task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
