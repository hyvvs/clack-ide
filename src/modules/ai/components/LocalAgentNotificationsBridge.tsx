import { routeAgentNotification } from "@/modules/agents/lib/route";
import { useWindowFocus } from "@/modules/agents/lib/useWindowFocus";
import { useAgentStore } from "@/modules/agents/store/agentStore";
import type { AgentStatus } from "@/modules/agents/lib/types";
import { useEffect, useRef } from "react";
import { useActiveAgentMeta, useChatStore } from "../store/chatStore";

const AGENT = "Clack";

type RunStatus =
  | "idle"
  | "thinking"
  | "streaming"
  | "retrying"
  | "awaiting-approval"
  | "error";

function isBusy(s: RunStatus): boolean {
  return (
    s === "thinking" ||
    s === "streaming" ||
    s === "retrying" ||
    s === "awaiting-approval"
  );
}

function liveStatus(s: RunStatus): AgentStatus | null {
  if (s === "awaiting-approval") return "waiting";
  if (s === "thinking" || s === "streaming" || s === "retrying")
    return "working";
  return null;
}

export function LocalAgentNotificationsBridge() {
  const activeRuntime = useActiveAgentMeta();
  const status = activeRuntime.status as RunStatus;
  const error = activeRuntime.error;
  const visible = useChatStore((s) => s.panelOpen || s.mini.open);
  const focused = useWindowFocus();

  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const prev = useRef<RunStatus>(status);

  useEffect(() => {
    const nextStatus = liveStatus(status);
    useAgentStore
      .getState()
      .setLocalAgent(nextStatus ? { agent: AGENT, status: nextStatus } : null);

    const was = prev.current;
    prev.current = status;
    if (was === status) return;

    const fire = (
      kind: "attention" | "finished" | "error",
      title: string,
      body?: string,
    ) =>
      routeAgentNotification({
        source: "local",
        agent: AGENT,
        kind,
        title,
        body,
        focused: focusedRef.current,
        visible: visibleRef.current,
        allowToast: true,
        onActivate: () => useChatStore.getState().openPanel(),
      });

    if (status === "awaiting-approval") {
      fire("attention", "Clack needs your approval", "Approve a tool to continue");
    } else if (status === "error") {
      fire("error", "Clack run failed", error?.message);
    } else if (status === "idle" && isBusy(was)) {
      fire("finished", "Clack finished", "Your task is ready");
    }
  }, [status, error]);

  return null;
}
