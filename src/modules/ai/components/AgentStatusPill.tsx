import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { AlertCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  useActiveAgentMeta,
  useChatStore,
  type AgentMeta,
} from "../store/chatStore";
import type { RunBudgetPhase } from "../lib/runBudget";
import type { SessionRunState } from "../lib/sessions";

type Props = {
  onClick: () => void;
};

export function AgentStatusPill({ onClick }: Props) {
  const meta = useActiveAgentMeta();
  const run = useChatStore((s) => {
    const id = s.activeSessionId;
    return s.sessions.find((session) => session.id === id)?.run;
  });
  const budgetPhase = run?.budget?.phase;
  const runState = run?.state;

  if (
    meta.status === "idle" &&
    !meta.error &&
    runState !== "failed" &&
    budgetPhase !== "soft-limit" &&
    budgetPhase !== "hard-limit"
  )
    return null;

  const { tone, icon, label } = describe(meta, budgetPhase, runState);

  return (
    <button
      key={`${meta.status}:${label}`}
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-6 items-center gap-1.5 rounded-[var(--clack-radius-button)] border px-1.5 text-[11px] transition-colors",
        "animate-in fade-in-0 slide-in-from-top-1 duration-150 ease-out",
        tone,
      )}
      title="Open AI Chat"
    >
      {icon}
      <span className="max-w-[180px] truncate">{label}</span>
    </button>
  );
}

function describe(
  meta: AgentMeta,
  budgetPhase?: RunBudgetPhase,
  runState?: SessionRunState,
): {
  tone: string;
  icon: React.ReactNode;
  label: string;
} {
  if (meta.status === "awaiting-approval") {
    return {
      tone: "border-[color:var(--clack-warning)]/50 bg-[color:var(--clack-warning)]/10 text-[var(--clack-warning)] hover:bg-[color:var(--clack-warning)]/15",
      icon: (
        <HugeiconsIcon icon={AlertCircleIcon} size={12} strokeWidth={1.75} />
      ),
      label: "AI · Approval required",
    };
  }
  if (runState === "failed") {
    return {
      tone: "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15",
      icon: (
        <HugeiconsIcon icon={AlertCircleIcon} size={12} strokeWidth={1.75} />
      ),
      label: "AI · Failed",
    };
  }
  if (meta.status === "retrying" && meta.providerRetry) {
    const provider = meta.providerRetry.error.provider ?? "provider";
    return {
      tone: "border-[color:var(--clack-warning)]/50 bg-[color:var(--clack-warning)]/10 text-[var(--clack-warning)] hover:bg-[color:var(--clack-warning)]/15",
      icon: <Spinner className="size-3" />,
      label:
        meta.providerRetry.error.kind === "rate_limit"
          ? `AI · ${provider} rate limit, retrying`
          : `AI · ${provider} retrying`,
    };
  }
  if (budgetPhase === "hard-limit") {
    return {
      tone: "border-[color:var(--clack-warning)]/50 bg-[color:var(--clack-warning)]/10 text-[var(--clack-warning)] hover:bg-[color:var(--clack-warning)]/15",
      icon: (
        <HugeiconsIcon icon={AlertCircleIcon} size={12} strokeWidth={1.75} />
      ),
      label: "AI · Run limit reached",
    };
  }
  if (budgetPhase === "soft-limit") {
    return {
      tone: "border-[color:var(--clack-warning)]/50 bg-[color:var(--clack-warning)]/10 text-[var(--clack-warning)] hover:bg-[color:var(--clack-warning)]/15",
      icon: (
        <HugeiconsIcon icon={AlertCircleIcon} size={12} strokeWidth={1.75} />
      ),
      label: "AI · Continue required",
    };
  }
  // thinking | streaming
  return {
    tone: "border-[color:var(--clack-border-subtle)] bg-[var(--clack-surface-1)] text-[var(--clack-text-3)] hover:text-[var(--clack-text-1)]",
    icon: <Spinner className="size-3" />,
    label: meta.step ? `AI · ${meta.step}` : "AI · Running",
  };
}
