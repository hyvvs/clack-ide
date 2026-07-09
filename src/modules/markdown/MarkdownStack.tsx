import { cn } from "@/lib/utils";
import type { MarkdownTab, Tab } from "@/modules/tabs";
import { MarkdownPreviewPane } from "./MarkdownPreviewPane";

type Props = {
  tabs: Tab[];
  activeId: number;
  onSetMarkdownView: (id: number, mode: "rendered" | "raw") => void;
  onAskAiSelection: (selection: string) => void;
  onRevealInExplorer: () => void;
  onAttachFileToAgent: (path: string) => void;
};

export function MarkdownStack({
  tabs,
  activeId,
  onSetMarkdownView,
  onAskAiSelection,
  onRevealInExplorer,
  onAttachFileToAgent,
}: Props) {
  const markdowns = tabs.filter(
    (t): t is MarkdownTab => t.kind === "markdown" && !t.cold,
  );
  if (markdowns.length === 0) return null;
  return (
    <div className="relative h-full w-full">
      {markdowns.map((t) => {
        const visible = t.id === activeId;
        return (
          <div
            key={t.id}
            className={cn(
              "absolute inset-0",
              !visible && "invisible pointer-events-none",
            )}
            aria-hidden={!visible}
          >
            <MarkdownPreviewPane
              path={t.path}
              visible={visible}
              onSetView={(mode) => onSetMarkdownView(t.id, mode)}
              onAskAiSelection={onAskAiSelection}
              onRevealInExplorer={onRevealInExplorer}
              onAttachFileToAgent={onAttachFileToAgent}
            />
          </div>
        );
      })}
    </div>
  );
}
