import { memo, useState } from "react";
import { activityText } from "@/modules/ai/lib/activity";

export const ProviderOutput = memo(function ProviderOutput({
  label,
  text,
}: {
  label: string;
  text: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="min-w-0 text-[11px] text-[var(--clack-text-3)]"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer [overflow-wrap:anywhere]">
        {label}
      </summary>
      {open ? (
        <p className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere]">
          {activityText(text, text.length)}
        </p>
      ) : null}
    </details>
  );
});
