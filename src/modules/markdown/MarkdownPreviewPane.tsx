import { MarkdownCode } from "@/components/ai-elements/markdown-code";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { writeClipboardText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { currentWorkspaceEnv } from "@/modules/workspace";
import {
  AiMagicIcon,
  Copy01Icon,
  FileAttachmentIcon,
  FolderTreeIcon,
  Image01Icon,
  Link01Icon,
  LinkSquare02Icon,
  TextSelectionIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import {
  defaultUrlTransform,
  defaultRehypePlugins,
  Streamdown,
  type Components,
  type ExtraProps,
  type StreamdownProps,
  type UrlTransform,
} from "streamdown";
import {
  markdownContextActions,
  openableMarkdownLink,
  type MarkdownContext as MarkdownContextState,
} from "./lib/contextActions";
import {
  isConvertedLocalAssetUrl,
  resolveMarkdownImageRenderSrc,
} from "./lib/imagePolicy";
import { MarkdownViewToggle } from "./MarkdownViewToggle";

type ReadResult =
  | { kind: "text"; content: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "toolarge"; size: number; limit: number };

type Status =
  | { kind: "loading" }
  | { kind: "ready"; content: string }
  | { kind: "binary" }
  | { kind: "toolarge"; size: number; limit: number }
  | { kind: "error"; message: string };

type Props = {
  path: string;
  visible: boolean;
  onSetView: (mode: "rendered" | "raw") => void;
  onAskAiSelection?: (selection: string) => void;
  onRevealInExplorer?: () => void;
  onAttachFileToAgent?: (path: string) => void;
  workspaceRoot?: string | null;
};

const BLOCKED_IMAGE_PREFIX = "clack-blocked-image:";
const EMPTY_CONTEXT: MarkdownContextState = {
  selectedText: "",
  linkUrl: null,
  imageUrl: null,
};

function blockedImageSrc(reason: string): string {
  return `${BLOCKED_IMAGE_PREFIX}${encodeURIComponent(reason)}`;
}

function blockedReasonFromSrc(src: string | undefined): string | null {
  if (!src?.startsWith(BLOCKED_IMAGE_PREFIX)) return null;
  try {
    return decodeURIComponent(src.slice(BLOCKED_IMAGE_PREFIX.length));
  } catch {
    return "blocked by policy";
  }
}

type HastNode = {
  type?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  value?: string;
};

type MarkdownImageResolverOptions = {
  markdownPath: string;
  workspaceRoot: string | null | undefined;
};

function stringProperty(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(String).join(" ");
  return null;
}

function blockedImageNode(reason: string): HastNode {
  return {
    type: "element",
    tagName: "span",
    properties: { title: reason },
    children: [{ type: "text", value: `Image blocked: ${reason}` }],
  };
}

function rewriteMarkdownImages(
  node: HastNode,
  options: MarkdownImageResolverOptions,
): void {
  if (!Array.isArray(node.children)) return;

  for (let i = 0; i < node.children.length; i += 1) {
    const child = node.children[i];
    if (child?.type === "element" && child.tagName === "img") {
      const properties = child.properties ?? {};
      const src = stringProperty(properties.src);
      if (src && isConvertedLocalAssetUrl(src)) continue;
      const resolved = resolveMarkdownImageRenderSrc(
        {
          src,
          markdownPath: options.markdownPath,
          workspaceRoot: options.workspaceRoot,
        },
        convertFileSrc,
      );
      if (resolved.kind === "render") {
        child.properties = { ...properties, src: resolved.src };
      } else {
        node.children[i] = blockedImageNode(resolved.reason);
      }
      continue;
    }
    rewriteMarkdownImages(child, options);
  }
}

function markdownImageResolverPlugin(
  options: MarkdownImageResolverOptions = {
    markdownPath: "",
    workspaceRoot: null,
  },
) {
  return (tree: HastNode) => rewriteMarkdownImages(tree, options);
}

function MarkdownImage({
  node: _node,
  src,
  alt,
  className,
  onError,
  ...props
}: ComponentProps<"img"> & ExtraProps) {
  const [failed, setFailed] = useState(false);
  const blockedReason = blockedReasonFromSrc(src);
  if (blockedReason || failed) {
    const reason = blockedReason ?? "image failed to load";
    return (
      <span
        className="inline-flex max-w-full items-center rounded border border-[var(--clack-border-subtle)] bg-[var(--clack-surface-raised)] px-2 py-1 text-[12px] text-[var(--clack-text-3)]"
        title={reason}
      >
        Image blocked: {reason}
      </span>
    );
  }
  return (
    <span
      className="clack-image-transparency-canvas my-2 inline-flex max-w-full overflow-hidden rounded border border-[var(--clack-border-subtle)] p-1 align-middle"
    >
      <img
        {...props}
        src={src}
        alt={alt}
        className={cn("max-w-full object-contain opacity-100", className)}
        style={{ opacity: 1, mixBlendMode: "normal" }}
        onError={(event) => {
          setFailed(true);
          onError?.(event);
        }}
      />
    </span>
  );
}

const MarkdownCodeComponent: Components["code"] = ({
  node: _node,
  ...props
}) => <MarkdownCode {...props} />;

const components: Components = {
  code: MarkdownCodeComponent,
  img: MarkdownImage,
};

function selectedTextWithin(root: HTMLElement | null): string {
  const selection = window.getSelection();
  if (
    !root ||
    !selection ||
    selection.isCollapsed ||
    selection.rangeCount === 0
  ) {
    return "";
  }
  const range = selection.getRangeAt(0);
  const container =
    range.commonAncestorContainer instanceof HTMLElement
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
  return container && root.contains(container) ? selection.toString() : "";
}

export function MarkdownPreviewPane({
  path,
  visible,
  onSetView,
  onAskAiSelection,
  onRevealInExplorer,
  onAttachFileToAgent,
  workspaceRoot,
}: Props) {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [menuContext, setMenuContext] =
    useState<MarkdownContextState>(EMPTY_CONTEXT);
  const renderedRootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus({ kind: "loading" });
    invoke<ReadResult>("fs_read_file", {
      path,
      workspace: currentWorkspaceEnv(),
    })
      .then((res) => {
        if (cancelled) return;
        if (res.kind === "text") {
          setStatus({ kind: "ready", content: res.content });
        } else if (res.kind === "binary") {
          setStatus({ kind: "binary" });
        } else {
          setStatus({ kind: "toolarge", size: res.size, limit: res.limit });
        }
      })
      .catch((error) => {
        if (!cancelled) setStatus({ kind: "error", message: String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const actions = markdownContextActions(menuContext, {
    canReveal: Boolean(onRevealInExplorer),
    canAskAi: Boolean(onAskAiSelection),
    canAttach: Boolean(onAttachFileToAgent),
  });
  const openableLink = openableMarkdownLink(menuContext.linkUrl);
  const markdownUrlTransform = useMemo<UrlTransform>(
    () => (url, key, node) => {
      if (key === "src" && node.tagName === "img") {
        if (isConvertedLocalAssetUrl(url)) return url;
        const resolved = resolveMarkdownImageRenderSrc({
          src: url,
          markdownPath: path,
          workspaceRoot,
        }, convertFileSrc);
        if (resolved.kind === "render") return resolved.src;
        return blockedImageSrc(resolved.reason);
      }
      return defaultUrlTransform(url, key, node);
    },
    [path, workspaceRoot],
  );
  const markdownRehypePlugins = useMemo<
    NonNullable<StreamdownProps["rehypePlugins"]>
  >(
    () => [
      defaultRehypePlugins.raw,
      [
        markdownImageResolverPlugin,
        { markdownPath: path, workspaceRoot },
      ],
      defaultRehypePlugins.sanitize,
      defaultRehypePlugins.harden,
    ],
    [path, workspaceRoot],
  );

  const selectAllRendered = () => {
    const root = renderedRootRef.current;
    if (!root) return;
    requestAnimationFrame(() => {
      const selection = window.getSelection();
      if (!selection) return;
      const range = document.createRange();
      range.selectNodeContents(root);
      selection.removeAllRanges();
      selection.addRange(range);
    });
  };

  return (
    <div
      className={cn(
        "relative flex h-full w-full flex-col overflow-hidden rounded-md border border-border/60 bg-background",
        !visible && "pointer-events-none",
      )}
    >
      <MarkdownViewToggle mode="rendered" onChange={onSetView} />
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className="flex-1 overflow-auto"
            style={{ userSelect: "text" }}
            onContextMenuCapture={(event) => {
              const target =
                event.target instanceof Element ? event.target : null;
              const link = target?.closest<HTMLAnchorElement>("a[href]");
              const image = target?.closest<HTMLImageElement>("img[src]");
              setMenuContext({
                selectedText: selectedTextWithin(renderedRootRef.current),
                linkUrl: link?.getAttribute("href") ?? null,
                imageUrl:
                  image?.currentSrc ||
                  image?.src ||
                  image?.getAttribute("src") ||
                  null,
              });
            }}
          >
            <div ref={renderedRootRef} className="px-8 py-6">
              {status.kind === "loading" && (
                <p className="text-[12px] text-muted-foreground">Loading...</p>
              )}
              {status.kind === "error" && (
                <p className="text-[12px] text-destructive">
                  Failed to read file: {status.message}
                </p>
              )}
              {status.kind === "binary" && (
                <p className="text-[12px] text-muted-foreground">
                  Binary file - cannot render as markdown.
                </p>
              )}
              {status.kind === "toolarge" && (
                <p className="text-[12px] text-muted-foreground">
                  File is {status.size} bytes; limit {status.limit}.
                </p>
              )}
              {status.kind === "ready" && (
                <Streamdown
                  className="select-text [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                  components={components}
                  rehypePlugins={markdownRehypePlugins}
                  urlTransform={markdownUrlTransform}
                >
                  {status.content}
                </Streamdown>
              )}
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent
          className="min-w-56"
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <ContextMenuItem
            disabled={!actions.copySelection}
            onSelect={() => void writeClipboardText(menuContext.selectedText)}
          >
            <HugeiconsIcon icon={Copy01Icon} size={14} strokeWidth={1.75} />
            <span>Copy</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={selectAllRendered}>
            <HugeiconsIcon
              icon={TextSelectionIcon}
              size={14}
              strokeWidth={1.75}
            />
            <span>Select All</span>
          </ContextMenuItem>
          {actions.copyLink || actions.copyImageUrl ? (
            <ContextMenuSeparator />
          ) : null}
          {actions.copyLink && menuContext.linkUrl ? (
            <ContextMenuItem
              onSelect={() =>
                void writeClipboardText(menuContext.linkUrl ?? "")
              }
            >
              <HugeiconsIcon icon={Link01Icon} size={14} strokeWidth={1.75} />
              <span>Copy Link</span>
            </ContextMenuItem>
          ) : null}
          {actions.openLink && openableLink ? (
            <ContextMenuItem onSelect={() => void openUrl(openableLink)}>
              <HugeiconsIcon
                icon={LinkSquare02Icon}
                size={14}
                strokeWidth={1.75}
              />
              <span>Open Link</span>
            </ContextMenuItem>
          ) : null}
          {actions.copyImageUrl && menuContext.imageUrl ? (
            <ContextMenuItem
              onSelect={() =>
                void writeClipboardText(menuContext.imageUrl ?? "")
              }
            >
              <HugeiconsIcon icon={Image01Icon} size={14} strokeWidth={1.75} />
              <span>Copy Image URL</span>
            </ContextMenuItem>
          ) : null}
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => void writeClipboardText(path)}>
            <HugeiconsIcon icon={Copy01Icon} size={14} strokeWidth={1.75} />
            <span>Copy File Path</span>
          </ContextMenuItem>
          {actions.revealInExplorer && onRevealInExplorer ? (
            <ContextMenuItem onSelect={onRevealInExplorer}>
              <HugeiconsIcon
                icon={FolderTreeIcon}
                size={14}
                strokeWidth={1.75}
              />
              <span>Reveal in Explorer</span>
            </ContextMenuItem>
          ) : null}
          {actions.askAiSelection && onAskAiSelection ? (
            <ContextMenuItem
              onSelect={() => onAskAiSelection(menuContext.selectedText)}
            >
              <HugeiconsIcon icon={AiMagicIcon} size={14} strokeWidth={1.75} />
              <span>Ask AI about Selection</span>
            </ContextMenuItem>
          ) : null}
          {actions.attachFileToAgent && onAttachFileToAgent ? (
            <ContextMenuItem onSelect={() => onAttachFileToAgent(path)}>
              <HugeiconsIcon
                icon={FileAttachmentIcon}
                size={14}
                strokeWidth={1.75}
              />
              <span>Attach File to Agent</span>
            </ContextMenuItem>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}
