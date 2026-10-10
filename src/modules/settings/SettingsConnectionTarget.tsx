import { useEffect, useRef, type ReactNode } from "react";
import { useSettingsTarget } from "@/modules/settings/settingsNavigation";

export function SettingsConnectionTarget({
  children,
}: {
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const { connectionId, sessionId } = useSettingsTarget();
  useEffect(() => {
    if ((!connectionId && !sessionId) || !root.current) return;
    const container = root.current;
    const focus = () => {
      const match = connectionId
        ? Array.from(
            container.querySelectorAll<HTMLElement>(
              "[data-settings-connection]",
            ),
          ).find((el) => el.dataset.settingsConnection === connectionId)
        : container.querySelector<HTMLElement>("[data-settings-tools]");
      if (!match) return false;
      match.scrollIntoView({ block: "center" });
      match.focus({ preventScroll: true });
      return true;
    };
    if (focus()) return;
    const observer = new MutationObserver(() => {
      if (focus()) observer.disconnect();
    });
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [connectionId, sessionId]);
  return (
    <div ref={root} className="min-w-0">
      {children}
    </div>
  );
}
