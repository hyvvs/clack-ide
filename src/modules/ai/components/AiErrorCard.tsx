import {
  ArrowRight01Icon,
  AlertCircleIcon,
  Copy01Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { writeClipboardText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import {
  formatAiErrorDetails,
  type NormalizedAiError,
} from "@/modules/ai/lib/errors";

type Props = {
  error: NormalizedAiError;
  onDismiss: () => void;
  onOpenProviderSettings?: () => void;
};

export function AiErrorCard({
  error,
  onDismiss,
  onOpenProviderSettings,
}: Props) {
  const [copied, setCopied] = useState(false);
  if (
    error.disposition === "recoverable" ||
    error.disposition === "retrying"
  ) {
    return null;
  }
  const canOpenSettings =
    Boolean(onOpenProviderSettings) &&
    (error.kind === "authentication" || error.kind === "authorization");
  const metadata = [
    error.provider ? ["Provider", error.provider] : null,
    error.model ? ["Model", error.model] : null,
    error.statusCode ? ["HTTP", String(error.statusCode)] : null,
    error.retryAfter ? ["Retry after", error.retryAfter] : null,
    error.requestId ? ["Request ID", error.requestId] : null,
    error.toolName ? ["Tool", error.toolName] : null,
  ].filter((item): item is string[] => item !== null);

  const copyDetails = async () => {
    const didCopy = await writeClipboardText(formatAiErrorDetails(error));
    if (!didCopy) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  return (
    <div className="overflow-hidden rounded-[var(--clack-radius-panel)] border border-destructive/40 bg-destructive/10 text-xs text-[var(--clack-text-1)]">
      <div className="flex items-start gap-2 px-3 py-2.5">
        <HugeiconsIcon
          icon={AlertCircleIcon}
          size={14}
          strokeWidth={1.8}
          className="mt-0.5 shrink-0 text-destructive"
        />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-destructive">{error.title}</div>
          <div className="mt-0.5 leading-relaxed text-[var(--clack-text-2)]">
            {error.message}
          </div>
          {metadata.length > 0 ? (
            <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-[10.5px]">
              {metadata.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-[var(--clack-text-3)]">{label}</dt>
                  <dd className="truncate font-mono text-[var(--clack-text-2)]" title={value}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </div>

      <Collapsible className="group/error border-t border-destructive/20">
        <CollapsibleTrigger className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[10.5px] text-[var(--clack-text-3)] hover:bg-destructive/5 hover:text-[var(--clack-text-2)]">
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            size={10}
            strokeWidth={2}
            className="transition-transform group-data-[state=open]/error:rotate-90"
          />
          Technical details
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="max-h-44 overflow-auto border-t border-destructive/15 px-3 py-2 whitespace-pre-wrap wrap-break-word font-mono text-[10px] leading-relaxed text-[var(--clack-text-3)]">
            {formatAiErrorDetails(error)}
          </pre>
        </CollapsibleContent>
      </Collapsible>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-destructive/20 px-2.5 py-1.5">
        {canOpenSettings ? (
          <button
            type="button"
            onClick={onOpenProviderSettings}
            className={actionClass}
          >
            <HugeiconsIcon icon={Settings01Icon} size={11} strokeWidth={1.8} />
            Provider settings
          </button>
        ) : null}
        <button type="button" onClick={() => void copyDetails()} className={actionClass}>
          <HugeiconsIcon icon={Copy01Icon} size={11} strokeWidth={1.8} />
          {copied ? "Copied" : "Copy details"}
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onDismiss}
          className={cn(actionClass, "text-[var(--clack-text-3)]")}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

const actionClass = cn(
  "inline-flex h-6 items-center gap-1 rounded-[var(--clack-radius-button)] px-1.5",
  "text-[10.5px] font-medium text-[var(--clack-text-2)] transition-colors",
  "hover:bg-destructive/10 hover:text-[var(--clack-text-1)]",
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--clack-focus)]",
);
