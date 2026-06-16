import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type Props = {
  title: ReactNode;
  description?: string;
  children: React.ReactNode;
  className?: string;
};

export function SettingRow({ title, description, children, className }: Props) {
  return (
    <div
      className={cn(
        "clack-settings-card flex items-start justify-between gap-4 px-3 py-2.5",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[12.5px] font-semibold text-[var(--clack-text-1)]">
          {title}
        </span>
        {description ? (
          <span className="text-[10.5px] leading-relaxed text-[var(--clack-text-3)]">
            {description}
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  );
}
