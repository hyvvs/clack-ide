import {
  AlertCircleIcon,
  CancelCircleIcon,
  InformationCircleIcon,
  Loading03Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type {
  AttachmentOutcome,
  AttachmentPresentation,
} from "../lib/attachmentPresentation";

export function AttachmentDetailsPopover({
  displayName,
  presentation,
  children,
}: {
  displayName: string;
  presentation: AttachmentPresentation;
  children: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-0 overflow-hidden p-0">
        <div className="flex items-start gap-2 border-b border-[color:var(--clack-border-subtle)] px-3 py-2.5">
          <AttachmentStateIcon outcome={presentation.outcome} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-[var(--clack-text-1)]">
              {displayName}
            </div>
            <div className="mt-0.5 text-[10.5px] text-[var(--clack-text-2)]">
              {presentation.statusLabel} · {presentation.summary}
            </div>
          </div>
        </div>
        <div className="space-y-2 px-3 py-2.5">
          <div className="text-[10px] font-medium uppercase text-[var(--clack-text-3)]">
            What the model will receive
          </div>
          <p className="text-[10.5px] leading-relaxed text-[var(--clack-text-2)]">
            {presentation.explanation}
          </p>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-[color:var(--clack-border-subtle)] pt-2 text-[10px]">
            {presentation.details.map((detail) => (
              <div key={detail.label} className="contents">
                <dt className="text-[var(--clack-text-3)]">{detail.label}</dt>
                <dd className="min-w-0 wrap-break-word text-right text-[var(--clack-text-1)]">
                  {detail.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function AttachmentStateIcon({
  outcome,
  className,
}: {
  outcome: AttachmentOutcome;
  className?: string;
}) {
  const icon =
    outcome === "ready"
      ? Tick02Icon
      : outcome === "unsupported"
        ? CancelCircleIcon
        : outcome === "processing"
          ? Loading03Icon
          : outcome === "limited"
            ? InformationCircleIcon
            : AlertCircleIcon;
  return (
    <HugeiconsIcon
      icon={icon}
      size={12}
      strokeWidth={1.8}
      className={cn(
        "mt-px shrink-0",
        outcome === "ready" && "text-[var(--clack-success)]",
        outcome === "limited" && "text-[var(--clack-warning)]",
        (outcome === "unsupported" ||
          outcome === "blocked" ||
          outcome === "failed") &&
          "text-destructive",
        outcome === "processing" && "animate-spin text-[var(--clack-accent)]",
        className,
      )}
      aria-hidden
    />
  );
}
