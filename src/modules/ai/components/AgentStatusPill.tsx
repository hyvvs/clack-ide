import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { AlertCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useChatStore, type AgentMeta } from "../store/chatStore";

type Props = {
  onClick: () => void;
};

export function AgentStatusPill({ onClick }: Props) {
  const meta = useChatStore((s) => s.agentMeta);

  // awaiting-approval is surfaced by the notification + auto-opened mini window.
  if (meta.status === "awaiting-approval") return null;
  if (meta.status === "idle" && !meta.error) return null;

  const { tone, icon, label } = describe(meta);

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
      title="Open AI log"
    >
      {icon}
      <span className="max-w-[180px] truncate">{label}</span>
    </button>
  );
}

function describe(meta: AgentMeta): {
  tone: string;
  icon: React.ReactNode;
  label: string;
} {
  if (meta.status === "error") {
    return {
      tone:
        "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15",
      icon: (
        <HugeiconsIcon icon={AlertCircleIcon} size={12} strokeWidth={1.75} />
      ),
      label: meta.error ?? "Error",
    };
  }
  // thinking | streaming
  return {
    tone:
      "border-[color:var(--clack-border-subtle)] bg-[var(--clack-surface-1)] text-[var(--clack-text-3)] hover:text-[var(--clack-text-1)]",
    icon: <Spinner className="size-3" />,
    label: meta.step ?? "Thinking...",
  };
}
