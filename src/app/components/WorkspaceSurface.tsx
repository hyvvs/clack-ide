import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AiDiffStack, EditorStack, GitDiffStack } from "@/modules/editor";
import { GitHistoryStack } from "@/modules/git-history";
import { MarkdownStack } from "@/modules/markdown";
import { PreviewStack } from "@/modules/preview";
import type { Tab } from "@/modules/tabs";
import {
  CommandIcon,
  FileEditIcon,
  Globe02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

type EditorStackProps = ComponentProps<typeof EditorStack>;
type PreviewStackProps = ComponentProps<typeof PreviewStack>;
type AiDiffStackProps = ComponentProps<typeof AiDiffStack>;
type GitHistoryStackProps = ComponentProps<typeof GitHistoryStack>;

type Props = {
  tabs: Tab[];
  activeId: number;
  activeTab: Tab | undefined;
  registerEditorHandle: EditorStackProps["registerHandle"];
  onEditorDirtyChange: EditorStackProps["onDirtyChange"];
  onEditorCloseTab: EditorStackProps["onCloseTab"];
  registerPreviewHandle: PreviewStackProps["registerHandle"];
  onPreviewUrlChange: PreviewStackProps["onUrlChange"];
  onAiDiffAccept: AiDiffStackProps["onAccept"];
  onAiDiffReject: AiDiffStackProps["onReject"];
  onOpenCommitFile: GitHistoryStackProps["onOpenCommitFile"];
  onGitHistorySearchHandle: GitHistoryStackProps["onSearchHandle"];
  onSetMarkdownView: EditorStackProps["onSetMarkdownView"];
  onAskAiSelection: EditorStackProps["onAskAiSelection"];
  onRevealInExplorer: EditorStackProps["onRevealInExplorer"];
  onAttachFileToAgent: EditorStackProps["onAttachFileToAgent"];
  onNewEditor: () => void;
  onNewPreview: () => void;
  onOpenCommandPalette: () => void;
};

/**
 * Stacks editor-like surfaces absolutely on top of each other and toggles
 * visibility off the active workspace tab, so editors, previews, and diffs keep
 * their mounted state when switching tabs.
 */
export function WorkspaceSurface({
  tabs,
  activeId,
  activeTab,
  registerEditorHandle,
  onEditorDirtyChange,
  onEditorCloseTab,
  registerPreviewHandle,
  onPreviewUrlChange,
  onAiDiffAccept,
  onAiDiffReject,
  onOpenCommitFile,
  onGitHistorySearchHandle,
  onSetMarkdownView,
  onAskAiSelection,
  onRevealInExplorer,
  onAttachFileToAgent,
  onNewEditor,
  onNewPreview,
  onOpenCommandPalette,
}: Props) {
  const kind = activeTab?.kind;
  const isEditorTab = kind === "editor";
  const isPreviewTab = kind === "preview";
  const isMarkdownTab = kind === "markdown";
  const isAiDiffTab = kind === "ai-diff";
  const isGitDiffTab = kind === "git-diff" || kind === "git-commit-file";
  const isGitHistoryTab = kind === "git-history";

  return (
    <div className="clack-workspace relative h-full min-h-0">
      <div
        className={cn(
          "absolute inset-0 px-3 pt-2 pb-2",
          !isEditorTab && "invisible pointer-events-none",
        )}
        aria-hidden={!isEditorTab}
      >
        <EditorStack
          tabs={tabs}
          activeId={activeId}
          registerHandle={registerEditorHandle}
          onDirtyChange={onEditorDirtyChange}
          onCloseTab={onEditorCloseTab}
          onSetMarkdownView={onSetMarkdownView}
          onAskAiSelection={onAskAiSelection}
          onRevealInExplorer={onRevealInExplorer}
          onAttachFileToAgent={onAttachFileToAgent}
        />
      </div>
      <div
        className={cn(
          "absolute inset-0 px-3 pt-2 pb-2",
          !isPreviewTab && "invisible pointer-events-none",
        )}
        aria-hidden={!isPreviewTab}
      >
        <PreviewStack
          tabs={tabs}
          activeId={activeId}
          registerHandle={registerPreviewHandle}
          onUrlChange={onPreviewUrlChange}
        />
      </div>
      <div
        className={cn(
          "absolute inset-0 px-3 pt-2 pb-2",
          !isMarkdownTab && "invisible pointer-events-none",
        )}
        aria-hidden={!isMarkdownTab}
      >
        <MarkdownStack
          tabs={tabs}
          activeId={activeId}
          onSetMarkdownView={onSetMarkdownView}
        />
      </div>
      <div
        className={cn(
          "absolute inset-0 px-3 pt-2 pb-2",
          !isAiDiffTab && "invisible pointer-events-none",
        )}
        aria-hidden={!isAiDiffTab}
      >
        <AiDiffStack
          tabs={tabs}
          activeId={activeId}
          onAccept={onAiDiffAccept}
          onReject={onAiDiffReject}
        />
      </div>
      <div
        className={cn(
          "absolute inset-0 px-3 pt-2 pb-2",
          !isGitDiffTab && "invisible pointer-events-none",
        )}
        aria-hidden={!isGitDiffTab}
      >
        <GitDiffStack tabs={tabs} activeId={activeId} />
      </div>
      <div
        className={cn(
          "absolute inset-0",
          !isGitHistoryTab && "invisible pointer-events-none",
        )}
        aria-hidden={!isGitHistoryTab}
      >
        <GitHistoryStack
          tabs={tabs}
          activeId={activeId}
          onOpenCommitFile={onOpenCommitFile}
          onSearchHandle={onGitHistorySearchHandle}
        />
      </div>
      {!activeTab ? (
        <div className="absolute inset-0 flex items-center justify-center px-6">
          <div className="flex max-w-md flex-col items-center gap-4 text-center">
            <img
              src="/logo.png"
              alt=""
              className="size-14 rounded-[var(--clack-radius-panel)] shadow-[var(--clack-shadow-high)]"
              draggable={false}
            />
            <div className="space-y-1">
              <h1 className="text-sm font-semibold tracking-wide text-foreground">
                Clack workspace
              </h1>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button size="sm" className="h-8 gap-1.5" onClick={onNewEditor}>
                <HugeiconsIcon
                  icon={FileEditIcon}
                  size={13}
                  strokeWidth={1.8}
                />
                New file
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="h-8 gap-1.5"
                onClick={onNewPreview}
              >
                <HugeiconsIcon icon={Globe02Icon} size={13} strokeWidth={1.8} />
                Preview
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 gap-1.5"
                onClick={onOpenCommandPalette}
              >
                <HugeiconsIcon icon={CommandIcon} size={13} strokeWidth={1.8} />
                Commands
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
