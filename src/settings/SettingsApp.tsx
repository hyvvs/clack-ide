import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WindowControls } from "@/components/WindowControls";
import { IS_MAC, USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import type { SettingsTab } from "@/modules/settings/openSettingsWindow";
import { readSettingsRoute, SettingsTargetContext } from "@/modules/settings/settingsNavigation";
import { SettingsConnectionTarget } from "@/modules/settings/SettingsConnectionTarget";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  AiScanIcon,
  InformationCircleIcon,
  PaintBoardIcon,
  Settings01Icon,
  UserMultiple02Icon,
  KeyboardIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { type JSX, useEffect, useState } from "react";
import { AboutSection } from "./sections/AboutSection";
import { AgentsSection } from "./sections/AgentsSection";
import { GeneralSection } from "./sections/GeneralSection";
import { ModelsSection } from "./sections/ModelsSection";
import { ShortcutsSection } from "./sections/ShortcutsSection";
import { ThemesSection } from "./sections/ThemesSection";

const TABS: {
  id: SettingsTab;
  label: string;
  eyebrow: string;
  icon: typeof Settings01Icon;
  component: () => JSX.Element;
}[] = [
  {
    id: "general",
    label: "General",
    eyebrow: "Workspace, terminal, editor",
    icon: Settings01Icon,
    component: GeneralSection,
  },
  {
    id: "models",
    label: "Connections & models",
    eyebrow: "Cloud, local AI, voice",
    icon: AiScanIcon,
    component: ModelsSection,
  },
  {
    id: "agents",
    label: "Agents & tools",
    eyebrow: "Instructions, tools, permissions",
    icon: UserMultiple02Icon,
    component: AgentsSection,
  },
  {
    id: "themes",
    label: "Appearance",
    eyebrow: "Themes, editor, background",
    icon: PaintBoardIcon,
    component: ThemesSection,
  },
  {
    id: "shortcuts",
    label: "Keyboard shortcuts",
    eyebrow: "App commands",
    icon: KeyboardIcon,
    component: ShortcutsSection,
  },
  {
    id: "about",
    label: "About",
    eyebrow: "Build and upstream",
    icon: InformationCircleIcon,
    component: AboutSection,
  },
];

export function SettingsApp() {
  const [route, setRoute] = useState(() => readSettingsRoute(typeof window === "undefined" ? "" : window.location.search));
  const active = route.tab;
  const setActive = (tab: SettingsTab) => setRoute({ tab, target: {} });
  const init = usePreferencesStore((s) => s.init);
  const ActiveSection = TABS.find((t) => t.id === active)?.component;

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    const apply = (detail: string) => setRoute(readSettingsRoute(`tab=${detail}`));
    const unlistenPromise = getCurrentWebviewWindow().listen<string>(
      "terax:settings-tab",
      (e) => apply(e.payload),
    );
    return () => {
      void unlistenPromise.then((un) => un());
    };
  }, []);

  return (
    <div className="clack-workspace flex h-screen flex-col overflow-hidden text-foreground select-none">
      <header
        data-tauri-drag-region
        className={`clack-shell flex h-11 shrink-0 items-center border-b ${
          IS_MAC ? "pr-3 pl-22" : "pr-0 pl-3"
        }`}
      >
        <div className="flex flex-1 items-center gap-2" data-tauri-drag-region>
          <img src="/logo.png" alt="" className="size-6 rounded-[6px]" />
          <div className="flex flex-col leading-none">
            <span className="text-[12px] font-semibold text-[var(--clack-text-1)]">
              Clack Settings
            </span>
            <span className="text-[10px] text-[var(--clack-text-3)]">
              App settings
            </span>
          </div>
        </div>
        {USE_CUSTOM_WINDOW_CONTROLS && <WindowControls closeOnly />}
      </header>

      <main className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <Tabs
          value={active}
          onValueChange={(v) => setActive(v as SettingsTab)}
          orientation="vertical"
          className="contents"
        >
          <aside aria-label="Settings categories" className="clack-panel flex w-full shrink-0 flex-col border-b px-2 py-2 sm:w-64 sm:border-r sm:border-b-0 sm:px-3 sm:py-4">
            <TabsList className="grid h-auto grid-cols-2 gap-1 bg-transparent p-0 sm:grid-cols-1">
              {TABS.map((t) => (
                <TabsTrigger
                  key={t.id}
                  value={t.id}
                  className="group h-auto min-w-0 justify-start gap-2 rounded-[var(--clack-radius-button)] border border-transparent bg-transparent px-2 py-2 text-left whitespace-normal data-active:border-[color:var(--clack-border-accent)] data-active:bg-[var(--clack-accent-soft)] data-active:text-[var(--clack-text-1)] data-active:[&_svg]:text-[var(--clack-accent)]"
                >
                  <HugeiconsIcon
                    icon={t.icon}
                    size={15}
                    strokeWidth={1.75}
                    className="shrink-0 text-[var(--clack-text-3)]"
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-[12px] font-semibold">
                      {t.label}
                    </span>
                    <span className="hidden text-[10.5px] font-normal text-[var(--clack-text-3)] sm:block">
                      {t.eyebrow}
                    </span>
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </aside>
          <section className="min-h-0 min-w-0 flex-1 overflow-y-auto px-3 pt-4 pb-8 sm:px-8 sm:pt-7 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="mx-auto w-full max-w-3xl">
              {ActiveSection && <SettingsTargetContext value={route.target}><SettingsConnectionTarget><ActiveSection /></SettingsConnectionTarget></SettingsTargetContext>}
            </div>
          </section>
        </Tabs>
      </main>
    </div>
  );
}
