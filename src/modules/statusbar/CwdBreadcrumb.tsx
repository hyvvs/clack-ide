import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowDown01Icon,
  Folder01Icon,
  Home03Icon,
  MoreHorizontalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { currentWorkspaceEnv } from "@/modules/workspace";
import {
  copyToClipboard,
  revealInFinder,
} from "@/modules/explorer/lib/contextActions";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { getBreadcrumbFolderActions } from "./lib/breadcrumbActions";
import { segmentsFromCwd } from "./lib/pathUtils";

type Props = {
  cwd: string | null;
  filePath?: string | null;
  home: string | null;
  onCd: (path: string) => void;
  workspaceRoot?: string | null;
  onOpenWorkspace?: (path: string) => void;
  onReturnToWorkspaceRoot?: () => void;
};

function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (i <= 0) return "/";
  return path.slice(0, i);
}

function basename(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i === -1 ? path : path.slice(i + 1);
}

export function CwdBreadcrumb({
  cwd,
  filePath,
  home,
  onCd,
  workspaceRoot,
  onOpenWorkspace,
  onReturnToWorkspaceRoot,
}: Props) {
  // File mode: dir segments navigate; filename is the terminal leaf.
  if (filePath) {
    const dir = dirname(filePath);
    const name = basename(filePath);
    const segments = segmentsFromCwd(dir, home);
    const first = segments[0];
    const middle = segments.slice(1);
    return (
      <Breadcrumb>
        <BreadcrumbList className="gap-1 text-xs sm:gap-1.5">
          {first ? (
            <BreadcrumbSegment
              label={first.label}
              isHome={first.isHome}
              path={first.fullPath}
              onCd={onCd}
              workspaceRoot={workspaceRoot}
              onOpenWorkspace={onOpenWorkspace}
              onReturnToWorkspaceRoot={onReturnToWorkspaceRoot}
            />
          ) : null}
          {middle.length > 0 ? (
            <CollapsedSegments
              segments={middle}
              onCd={onCd}
              workspaceRoot={workspaceRoot}
              onOpenWorkspace={onOpenWorkspace}
              onReturnToWorkspaceRoot={onReturnToWorkspaceRoot}
            />
          ) : null}
          {middle.map((s) => (
            <span key={s.fullPath} className="contents max-md:hidden">
              <BreadcrumbSegment
                label={s.label}
                isHome={s.isHome}
                path={s.fullPath}
                onCd={onCd}
                workspaceRoot={workspaceRoot}
                onOpenWorkspace={onOpenWorkspace}
                onReturnToWorkspaceRoot={onReturnToWorkspaceRoot}
              />
            </span>
          ))}
          <BreadcrumbItem>
            <BreadcrumbPage className="text-foreground">{name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );
  }

  if (!cwd) {
    return (
      <span className="text-xs text-muted-foreground/70">no directory</span>
    );
  }

  const segments = segmentsFromCwd(cwd, home);
  const current = segments[segments.length - 1];
  const parents = segments.slice(0, -1);

  const firstParent = parents[0];
  const middleParents = parents.slice(1);
  return (
    <Breadcrumb>
      <BreadcrumbList className="gap-1 text-xs sm:gap-1.5">
        {firstParent ? (
          <BreadcrumbSegment
            label={firstParent.label}
            isHome={firstParent.isHome}
            path={firstParent.fullPath}
            onCd={onCd}
            workspaceRoot={workspaceRoot}
            onOpenWorkspace={onOpenWorkspace}
            onReturnToWorkspaceRoot={onReturnToWorkspaceRoot}
          />
        ) : null}
        {middleParents.length > 0 ? (
          <CollapsedSegments
            segments={middleParents}
            onCd={onCd}
            workspaceRoot={workspaceRoot}
            onOpenWorkspace={onOpenWorkspace}
            onReturnToWorkspaceRoot={onReturnToWorkspaceRoot}
          />
        ) : null}
        {middleParents.map((s) => (
          <span key={s.fullPath} className="contents max-md:hidden">
            <BreadcrumbSegment
              label={s.label}
              isHome={s.isHome}
              path={s.fullPath}
              onCd={onCd}
              workspaceRoot={workspaceRoot}
              onOpenWorkspace={onOpenWorkspace}
              onReturnToWorkspaceRoot={onReturnToWorkspaceRoot}
            />
          </span>
        ))}
        <BreadcrumbItem>
          <CurrentSegmentDropdown
            label={current.label}
            path={current.fullPath}
            onCd={onCd}
            workspaceRoot={workspaceRoot}
            onOpenWorkspace={onOpenWorkspace}
            onReturnToWorkspaceRoot={onReturnToWorkspaceRoot}
          />
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function BreadcrumbSegment({
  label,
  isHome,
  path,
  onCd,
  workspaceRoot,
  onOpenWorkspace,
  onReturnToWorkspaceRoot,
}: {
  label: string;
  isHome: boolean;
  path: string;
  onCd: (p: string) => void;
  workspaceRoot?: string | null;
  onOpenWorkspace?: (p: string) => void;
  onReturnToWorkspaceRoot?: () => void;
}) {
  return (
    <>
      <BreadcrumbItem>
        <FolderSegmentMenu
          label={label}
          isHome={isHome}
          path={path}
          workspaceRoot={workspaceRoot}
          onCd={onCd}
          onOpenWorkspace={onOpenWorkspace}
          onReturnToWorkspaceRoot={onReturnToWorkspaceRoot}
          trigger={
            <button type="button" className="cursor-pointer">
              <Badge
                variant="outline"
                className="gap-1 text-muted-foreground hover:text-foreground"
              >
                {isHome ? (
                  <HugeiconsIcon
                    icon={Home03Icon}
                    className="size-3"
                    strokeWidth={1.75}
                  />
                ) : null}
                {isHome ? "Home" : label}
              </Badge>
            </button>
          }
        />
      </BreadcrumbItem>
      <BreadcrumbSeparator className="[&>svg]:size-3" />
    </>
  );
}

function FolderSegmentMenu({
  label,
  isHome,
  path,
  workspaceRoot,
  onCd,
  onOpenWorkspace,
  onReturnToWorkspaceRoot,
  trigger,
}: {
  label: string;
  isHome: boolean;
  path: string;
  workspaceRoot?: string | null;
  onCd: (p: string) => void;
  onOpenWorkspace?: (p: string) => void;
  onReturnToWorkspaceRoot?: () => void;
  trigger: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <div className="px-2 py-1 text-[10px] text-muted-foreground">
          {isHome ? "Home" : label}
        </div>
        <FolderActionItems
          path={path}
          workspaceRoot={workspaceRoot}
          onCd={onCd}
          onOpenWorkspace={onOpenWorkspace}
          onReturnToWorkspaceRoot={onReturnToWorkspaceRoot}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FolderActionItems({
  path,
  workspaceRoot,
  onCd,
  onOpenWorkspace,
  onReturnToWorkspaceRoot,
}: {
  path: string;
  workspaceRoot?: string | null;
  onCd: (p: string) => void;
  onOpenWorkspace?: (p: string) => void;
  onReturnToWorkspaceRoot?: () => void;
}) {
  const actions = getBreadcrumbFolderActions({
    path,
    workspaceRoot,
    canOpenWorkspace: Boolean(onOpenWorkspace),
  });
  return (
    <>
      <DropdownMenuItem onSelect={() => onCd(path)}>
        Navigate to this folder
      </DropdownMenuItem>
      {actions.canOpenAsWorkspace ? (
        <DropdownMenuItem onSelect={() => onOpenWorkspace?.(path)}>
          Open this folder as Workspace
        </DropdownMenuItem>
      ) : null}
      {actions.canOpenParentAsWorkspace && actions.parentPath ? (
        <DropdownMenuItem
          onSelect={() => onOpenWorkspace?.(actions.parentPath ?? path)}
        >
          Open Parent as Workspace
        </DropdownMenuItem>
      ) : null}
      {actions.canReturnToWorkspaceRoot ? (
        <DropdownMenuItem onSelect={() => onReturnToWorkspaceRoot?.()}>
          Return to Workspace Root
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => void copyToClipboard(path)}>
        Copy Path
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void revealInFinder(path)}>
        Reveal in Explorer
      </DropdownMenuItem>
    </>
  );
}

function CurrentSegmentDropdown({
  label,
  path,
  onCd,
  workspaceRoot,
  onOpenWorkspace,
  onReturnToWorkspaceRoot,
}: {
  label: string;
  path: string;
  onCd: (p: string) => void;
  workspaceRoot?: string | null;
  onOpenWorkspace?: (p: string) => void;
  onReturnToWorkspaceRoot?: () => void;
}) {
  const showHidden = usePreferencesStore((s) => s.showHidden);
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const dirs = await invoke<string[]>("list_subdirs", {
        path,
        showHidden,
        workspace: currentWorkspaceEnv(),
      });
      setChildren(dirs);
    } catch (e) {
      setError(String(e));
      setChildren([]);
    }
  }, [path, showHidden]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <BreadcrumbPage className="flex cursor-pointer items-center gap-1 rounded-sm px-1 py-0.5 text-foreground hover:bg-accent">
          {label === "~" ? (
            <>
              <HugeiconsIcon
                icon={Home03Icon}
                className="size-3"
                strokeWidth={1.75}
              />
              Home
            </>
          ) : (
            label
          )}
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            className="size-3 opacity-70"
            strokeWidth={2}
          />
        </BreadcrumbPage>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        <FolderActionItems
          path={path}
          workspaceRoot={workspaceRoot}
          onCd={onCd}
          onOpenWorkspace={onOpenWorkspace}
          onReturnToWorkspaceRoot={onReturnToWorkspaceRoot}
        />
        <DropdownMenuSeparator />
        {children === null ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            Loading...
          </div>
        ) : children.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            {error ?? "No subfolders"}
          </div>
        ) : (
          children.map((name) => (
            <DropdownMenuItem
              key={name}
              onSelect={() =>
                onCd(path.endsWith("/") ? `${path}${name}` : `${path}/${name}`)
              }
            >
              <HugeiconsIcon
                icon={Folder01Icon}
                className="size-3.5 text-muted-foreground"
                strokeWidth={1.75}
              />
              {name}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CollapsedSegments({
  segments,
  onCd,
  workspaceRoot,
  onOpenWorkspace,
  onReturnToWorkspaceRoot,
}: {
  segments: { fullPath: string; label: string; isHome: boolean }[];
  onCd: (p: string) => void;
  workspaceRoot?: string | null;
  onOpenWorkspace?: (p: string) => void;
  onReturnToWorkspaceRoot?: () => void;
}) {
  return (
    <span className="contents md:hidden">
      <BreadcrumbItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title="Show hidden folders"
              className="flex items-center rounded-sm px-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <HugeiconsIcon
                icon={MoreHorizontalIcon}
                className="size-3"
                strokeWidth={1.75}
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-44">
            {segments.map((s) => (
              <DropdownMenuSubFolder
                key={s.fullPath}
                segment={s}
                workspaceRoot={workspaceRoot}
                onCd={onCd}
                onOpenWorkspace={onOpenWorkspace}
                onReturnToWorkspaceRoot={onReturnToWorkspaceRoot}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </BreadcrumbItem>
      <BreadcrumbSeparator className="[&>svg]:size-3" />
    </span>
  );
}

function DropdownMenuSubFolder({
  segment,
  workspaceRoot,
  onCd,
  onOpenWorkspace,
  onReturnToWorkspaceRoot,
}: {
  segment: { fullPath: string; label: string; isHome: boolean };
  workspaceRoot?: string | null;
  onCd: (p: string) => void;
  onOpenWorkspace?: (p: string) => void;
  onReturnToWorkspaceRoot?: () => void;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <HugeiconsIcon
          icon={segment.isHome ? Home03Icon : Folder01Icon}
          className="size-3.5 text-muted-foreground"
          strokeWidth={1.75}
        />
        <span className="truncate">
          {segment.isHome ? "Home" : segment.label}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-56">
        <FolderActionItems
          path={segment.fullPath}
          workspaceRoot={workspaceRoot}
          onCd={onCd}
          onOpenWorkspace={onOpenWorkspace}
          onReturnToWorkspaceRoot={onReturnToWorkspaceRoot}
        />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
