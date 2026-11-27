import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  type BrowserRuntimeStatus,
  refreshTfBrowserRuntimeStatus,
} from "@/modules/ai/lib/browserRuntimeStatus";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { useCallback, useEffect, useMemo, useState } from "react";
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

  // A new scope (including close/reopen) must never render a previous
  // scope's sessions, even before effect cleanup has run.
  const scope = useMemo(
    () => ({
      open,
      actor,
      sessionId,
      workspaceRoot,
      active: false,
      request: 0,
    }),
    [open, actor, sessionId, workspaceRoot],
  );
  const [checked, setChecked] = useState<{
    scope: typeof scope;
    status: BrowserRuntimeStatus | null;
  } | null>(null);
  const status = open && checked?.scope === scope ? checked.status : null;

  const refresh = useCallback(() => {
    if (
      !scope.active ||
      !scope.open ||
      !scope.actor ||
      !scope.sessionId ||
      !scope.workspaceRoot
    )
      return;
    const request = ++scope.request;
    const publish = (next: BrowserRuntimeStatus | null) => {
      if (scope.active && scope.request === request) {
        setChecked({ scope, status: next });
      }
    };
    void refreshTfBrowserRuntimeStatus(
      scope.actor,
      scope.sessionId,
      scope.workspaceRoot,
    )
      .then(publish)
      .catch(() => publish(null));
  }, [scope]);

  useEffect(() => {
    scope.active = true;
    refresh();
    return () => {
      scope.active = false;
      ++scope.request;
    };
  }, [scope, refresh]);

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
              key={JSON.stringify([actor, sessionId, workspaceRoot])}
              actor={actor}
              sessionId={sessionId}
              workspaceRoot={workspaceRoot}
              sessions={status.sessions}
              onChanged={refresh}
            />
          ) : (
            <p role="status">
              {status
                ? "Native browser scope unavailable."
                : "Checking exact native browser scope…"}
            </p>
          )}
        </PopoverContent>
      </Popover>
    </section>
  );
}
