import { useState } from "react";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  isManagedLocalSelectionId,
} from "@/modules/ai/lib/managedLocalModels";
import { deploymentQualificationView } from "@/modules/ai/lib/deploymentQualificationView";
import type { ManagedLocalNativeStatus } from "@/modules/ai/lib/managedLocalRuntime";

/** Advanced qualification detail. Simply opening the panel never generates
 * text. A separate, explicit user action runs one bounded Chat-only probe. */
export function DeploymentQualificationControl({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const [native, setNative] = useState<ManagedLocalNativeStatus | null>(null);
  const [readAt, setReadAt] = useState(0);
  const [qualifying, setQualifying] = useState(false);
  const [qualifyingResult, setQualifyingResult] = useState("");
  const state = usePreferencesStore(s => s.selfHostedInference);
  const selection = useChatStore(s => {
    const session = s.sessions.find(item => item.id === sessionId);
    return session?.run?.state === "running"
      ? session.run.modelId : session?.profile?.modelId;
  });
  if (!selection || (!isManagedLocalSelectionId(selection) && !selection.startsWith("self-hosted:")))
    return null;
  const refresh = () => {
    setReadAt(Date.now());
    setNative(null);
    if (isManagedLocalSelectionId(selection))
      void invoke<ManagedLocalNativeStatus>("managed_local_runtime_status")
        .then(setNative).catch(() => setNative(null));
  };
  const runQualification = () => {
    if (!selection || !isManagedLocalSelectionId(selection) || qualifying) return;
    setQualifying(true);
    setQualifyingResult("");
    void import("@/modules/ai/lib/deploymentQualificationRuntime")
      .then(module => module.runManagedChatQualification(selection))
      .then(result => {
        const message = `Qualification stored: Chat ${result.chat}, streaming ${result.streaming}, completion ${result.terminalCompletion}, instruction adherence ${result.instructionAdherence}.`;
        setQualifyingResult(message);
        // The runner temporarily selects a separate retained Coder session.
        // The originating popover can unmount; a global notification survives
        // that transition. This is display-only, never qualification authority.
        toast.success(message);
      })
      .catch(error => {
        const stage = error instanceof Error &&
          /^Bounded qualification unverified at (session-capture|bounded-request|flight-observation|persisted-chat-evidence|native-revalidation|receipt-scoring|cas-commit)$/.exec(error.message)?.[1];
        const message = `Qualification evidence was incomplete or could not be stored${stage ? ` (${stage})` : ""}; no passing capability was granted. The retained test Chat is not a qualification receipt.`;
        setQualifyingResult(message);
        toast.warning(message);
      })
      .finally(() => {
        setQualifying(false);
        refresh();
      });
  };
  // Observations are deliberately short-lived; a previously open panel must
  // not retain Ready when the runtime process has gone away.
  const observed = open && Date.now() - readAt < 30_000 ? native : null;
  const view = open ? deploymentQualificationView(state, selection, observed) : null;
  return (
    <Popover open={open} onOpenChange={next => {
      setOpen(next);
      if (next) refresh();
    }}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost"
          className="h-7 gap-1 px-1.5 text-xs"
          aria-label="Deployment qualification details">
          Qualification
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start"
        className="w-80 max-w-[calc(100vw-16px)] max-h-[70dvh] overflow-y-auto text-xs">
        <h3 className="font-medium">Deployment qualification</h3>
        <p className="text-muted-foreground">Runtime claims are not proof of this model's behavior.</p>
        {!view ? <p role="status">No current exact deployment qualification available.</p> : (
          <div className="space-y-2">
            <p className="text-muted-foreground">{view.readiness}</p>
            {([
              ["Chat", view.panel.chat],
              ["Streaming", view.panel.streaming],
              ["Structured JSON Schema", view.panel.structured],
              ["Native tools", view.panel.nativeTools],
              ["Instruction adherence", view.instruction],
            ] as const).map(([label, decision]) => (
              <p key={label} title={decision.reason}>
                <span className="font-medium">{label}:</span> {decision.state}
                {decision.lastResultAt !== null &&
                  <span className="text-muted-foreground">
                    {" "}· Last {decision.lastResult ?? "unknown"} {new Date(decision.lastResultAt).toLocaleString()}
                  </span>}
              </p>
            ))}
            <p title={view.panel.agent.reason}>
              <span className="font-medium">Agent:</span>{" "}
              {view.panel.agent.eligible ? "Qualified" : "Unavailable"}
            </p>
            {!view.panel.agent.eligible && <p className="text-muted-foreground">{view.panel.agent.reason}</p>}
            {view.legacyNativeToolQualification &&
              <p className="text-muted-foreground">
                Legacy Ollama native tool evidence: {view.legacyNativeToolQualification}.
                Additional LM2F Agent requirements remain independently unqualified.
              </p>}
            <details className="border-t pt-1 text-muted-foreground">
              <summary className="cursor-pointer">Other capabilities and qualification reasons</summary>
              <div className="space-y-1 pt-2">
                {([
                  ["Terminal completion", view.panel.completion],
                  ["Cancellation", view.panel.cancellation],
                  ["JSON output", view.panel.jsonMode],
                  ["Grammar", view.panel.grammar],
                  ["Runtime tool protocol", view.panel.toolProtocol],
                  ["Chat reason", view.panel.chat],
                  ["Streaming reason", view.panel.streaming],
                  ["Native tools reason", view.panel.nativeTools],
                  ["Instruction-adherence reason", view.instruction],
                ] as const).map(([label, decision]) => (
                  <p key={label}>
                    <strong>{label}:</strong> {decision.state}. {decision.reason}
                  </p>
                ))}
              </div>
            </details>
          </div>
        )}
        <Button size="sm" variant="outline" onClick={refresh}>Refresh observation</Button>
        {isManagedLocalSelectionId(selection) && (
          <div className="space-y-1 border-t pt-2">
            <p className="text-muted-foreground">
              Optional: run one bounded Chat-only qualification under Coder
              in a separate, retained Chat session. No tools, retries,
              continuation or permission changes. Only complete, scoped
              evidence is stored; otherwise capabilities remain unqualified.
            </p>
            <Button size="sm" variant="outline"
              disabled={qualifying || !observed || observed.state !== "Ready"}
              onClick={runQualification}>
              {qualifying ? "Qualifying..." : "Run bounded Chat qualification"}
            </Button>
            {qualifyingResult && <p role="status">{qualifyingResult}</p>}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
