import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  refreshTfBrowserRuntimeStatus,
  type BrowserRuntimeStatus,
} from "@/modules/ai/lib/browserRuntimeStatus";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { NativeBrowserOperatorPanel } from "./NativeBrowserOperatorPanel";

/**
 * Explicitly human-operated TF4 acceptance must not depend on a configured
 * AI provider. This surface is NOT a model tool and confers no Tauri/browser
 * authority; it reuses the owning saved chat's actor/workspace scope, the
 * existing central TF4 status and the native Windows per-operation dialog.
 *
 * Never guess an actor/root from the active project or invent a chat session.
 * If no saved chat has a real owning profile, fail closed without a panel.
 */
export function StandaloneNativeAcceptance() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<BrowserRuntimeStatus | null>(null);
  const session = useChatStore((state) =>
    state.sessions.find((entry) => entry.id === state.activeSessionId),
  );
  const actor = session?.run?.agentId ?? session?.profile?.agentId ?? null;
  const workspaceRoot =
    session?.run?.checkoutRoot ??
    session?.run?.workspaceRoot ??
    session?.profile?.workspaceRoot ??
    null;
  const sessionId = session?.id ?? null;

  useEffect(() => {
    setStatus(null);
    if (!open || !actor || !workspaceRoot || !sessionId) return;
    let alive = true;
    void refreshTfBrowserRuntimeStatus(actor, sessionId, workspaceRoot)
      .then((next) => {
        if (alive) setStatus(next);
      })
      .catch(() => {
        if (alive) setStatus(null);
      });
    return () => {
      alive = false;
    };
  }, [open, actor, workspaceRoot, sessionId]);

  if (!sessionId || !actor || !workspaceRoot) return null;

  return (
    <section
      className="flex items-center gap-1 border-t px-2 py-1 text-xs"
      aria-label="Human-operated native acceptance without an AI provider"
    >
      <span className="text-muted-foreground">
        No AI model configured. Native browser testing is human-operated.
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            aria-label="Tools for this chat"
            className="h-7 text-xs"
          >
            Tools
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-96 max-w-[calc(100vw-16px)] max-h-[75dvh] overflow-y-auto text-xs"
        >
          <p className="text-muted-foreground">
            Exact saved chat/WorkspaceRegistry ownership is required. No
            model-native browser tool is enabled. Every operation has its own
            genuine Windows security or privacy decision.
          </p>
          {status?.available ? (
            <NativeBrowserOperatorPanel
              key={`${actor}:${sessionId}:${workspaceRoot}`}
              actor={actor}
              sessionId={sessionId}
              workspaceRoot={workspaceRoot}
              sessions={status.sessions}
              onChanged={() => {
                void refreshTfBrowserRuntimeStatus(actor, sessionId, workspaceRoot)
                  .then(setStatus)
                  .catch(() => setStatus(null));
              }}
            />
          ) : (
            <p role="status">
              {status ? "Native browser scope unavailable." : "Checking exact native browser scope…"}
            </p>
          )}
        </PopoverContent>
      </Popover>
    </section>
  );
}
