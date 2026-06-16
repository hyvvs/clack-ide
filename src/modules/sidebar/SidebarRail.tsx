import { cn } from "@/lib/utils";
import { FolderGitTwoIcon, FolderTreeIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { SidebarViewId } from "./types";

export const SIDEBAR_RAIL_HEIGHT = 36;

type RailItem = {
  id: SidebarViewId;
  label: string;
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
  badge?: number;
};

type Props = {
  activeView: SidebarViewId;
  onSelectView: (view: SidebarViewId) => void;
  changedCount: number;
};

export function SidebarRail({ activeView, onSelectView, changedCount }: Props) {
  const items: RailItem[] = [
    { id: "explorer", label: "Files", icon: FolderTreeIcon },
    {
      id: "source-control",
      label: "Source Control",
      icon: FolderGitTwoIcon,
      badge: changedCount,
    },
  ];

  return (
    <div
      style={{ height: SIDEBAR_RAIL_HEIGHT }}
      className="clack-rail flex shrink-0 items-stretch gap-1 border-t px-1.5 py-1"
    >
      {items.map((item) => {
        const isActive = item.id === activeView;
        const showBadge = !!item.badge && item.badge > 0;
        return (
          <button
            key={item.id}
            type="button"
            aria-label={item.label}
            aria-pressed={isActive}
            data-active={isActive ? "true" : undefined}
            onClick={() => onSelectView(item.id)}
            className={cn(
              "clack-rail-button group relative flex flex-1 cursor-pointer items-center justify-center gap-1.5 text-[11px] font-medium outline-none transition-colors duration-[var(--dur-base)]",
              "focus-visible:ring-2 focus-visible:ring-primary/40",
            )}
          >
            <HugeiconsIcon
              icon={item.icon}
              size={14}
              strokeWidth={isActive ? 2 : 1.75}
              className="shrink-0 transition-[stroke-width] duration-[var(--dur-base)]"
            />
            <span>{item.label}</span>
            {showBadge ? (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-[color:var(--clack-border-accent)] bg-[var(--clack-surface-1)] px-1 text-[9px] font-semibold leading-none tabular-nums text-[var(--clack-text-2)]">
                {item.badge! > 99 ? "99+" : item.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
