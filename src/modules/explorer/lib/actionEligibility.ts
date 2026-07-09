import type { ExplorerEntryRef } from "./createTarget";

export type ExplorerActionEligibility = {
  canOpenFile: boolean;
  canOpenFolderInTerminal: boolean;
  canOpenAsWorkspace: boolean;
  canRevealSingle: boolean;
  canAttachSingle: boolean;
  canDelete: boolean;
  canCopyPaths: boolean;
};

export function explorerActionEligibility(
  entries: ExplorerEntryRef[],
): ExplorerActionEligibility {
  const single = entries.length === 1 ? entries[0] : null;
  return {
    canOpenFile: Boolean(single && !single.isDir),
    canOpenFolderInTerminal: Boolean(single?.isDir),
    canOpenAsWorkspace: Boolean(single?.isDir),
    canRevealSingle: Boolean(single),
    canAttachSingle: Boolean(single),
    canDelete: entries.length > 0,
    canCopyPaths: entries.length > 0,
  };
}
