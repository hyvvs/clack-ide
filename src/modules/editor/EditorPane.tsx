import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { fmtShortcut, MOD_KEY } from "@/lib/platform";
import { getKey } from "@/modules/ai/lib/keyring";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { onKeysChanged } from "@/modules/settings/store";
import { isThemeFilePath } from "@/modules/theme/themeFiles";
import { redo, undo } from "@codemirror/commands";
import {
  findNext,
  findPrevious,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import { type Extension, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import {
  AiMagicIcon,
  Cancel01Icon,
  ClipboardPasteIcon,
  Copy01Icon,
  FileAttachmentIcon,
  FolderTreeIcon,
  SaveIcon,
  Scissor01Icon,
  TextSelectionIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { inlineCompletion } from "./lib/autocomplete/inlineExtension";
import {
  buildSharedExtensions,
  languageCompartment,
  vimCompartment,
} from "./lib/extensions";
import { resolveLanguage } from "./lib/languageResolver";
import { useEditorThemeExt } from "./lib/useEditorThemeExt";
import { useDocument } from "./lib/useDocument";
import { initVimGlobals, vimHandlersExtension } from "./lib/vim";

initVimGlobals();

export type EditorPaneHandle = {
  setQuery: (q: string) => void;
  findNext: () => void;
  findPrevious: () => void;
  clearQuery: () => void;
  focus: () => void;
  getSelection: () => string | null;
  getPath: () => string;
  /** Re-read the file from disk. Skips silently if the buffer is dirty. */
  reload: () => boolean;
  /** Move the cursor to a 1-based line and center it, once content is ready. */
  gotoLine: (line: number) => void;
  /** Apply CodeMirror's undo/redo commands. */
  undo: () => void;
  redo: () => void;
};

type Props = {
  path: string;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: () => void;
  onClose?: () => void;
  onAskAiSelection?: () => void;
  onRevealInExplorer?: () => void;
  onAttachFileToAgent?: (path: string) => void;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const EditorPane = forwardRef<EditorPaneHandle, Props>(
  function EditorPane(
    {
      path,
      onDirtyChange,
      onSaved,
      onClose,
      onAskAiSelection,
      onRevealInExplorer,
      onAttachFileToAgent,
    },
    ref,
  ) {
    const { doc, onChange, save, reload } = useDocument({
      path,
      onDirtyChange,
    });
    const reloadRef = useRef(reload);
    reloadRef.current = reload;
    const cmRef = useRef<ReactCodeMirrorRef>(null);
    const themeExt = useEditorThemeExt();
    const vimMode = usePreferencesStore((s) => s.vimMode);
    const languageRef = useRef<string | null>(null);
    const apiKeyRef = useRef<string | null>(null);
    const [hasSelection, setHasSelection] = useState(false);

    useEffect(() => {
      let cancelled = false;
      const refresh = async () => {
        const provider = usePreferencesStore.getState().autocompleteProvider;
        if (
          provider === "lmstudio" ||
          provider === "mlx" ||
          provider === "ollama"
        ) {
          apiKeyRef.current = null;
          return;
        }
        const k = await getKey(provider);
        if (!cancelled) apiKeyRef.current = k;
      };
      void refresh();
      let unlistenKeys: (() => void) | undefined;
      void onKeysChanged(() => void refresh()).then((un) => {
        unlistenKeys = un;
      });
      const unsubPrefs = usePreferencesStore.subscribe((state, prev) => {
        if (state.autocompleteProvider !== prev.autocompleteProvider) {
          void refresh();
        }
      });
      return () => {
        cancelled = true;
        unlistenKeys?.();
        unsubPrefs();
      };
    }, []);
    // Stabilize save + onSaved via refs so the extensions array never changes
    // identity — a new identity makes @uiw/react-codemirror reconfigure the
    // whole state, wiping the language compartment.
    const saveRef = useRef(save);
    saveRef.current = save;
    const onSavedRef = useRef(onSaved);
    onSavedRef.current = onSaved;
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    const pathRef = useRef(path);
    pathRef.current = path;

    const pendingLineRef = useRef<number | null>(null);
    const statusRef = useRef(doc.status);
    statusRef.current = doc.status;

    const applyPendingGoto = useCallback(() => {
      const view = cmRef.current?.view;
      const line = pendingLineRef.current;
      if (!view || line == null || statusRef.current !== "ready") return;
      const target = Math.max(1, Math.min(line, view.state.doc.lines));
      const at = view.state.doc.line(target).from;
      view.dispatch({
        selection: { anchor: at },
        effects: EditorView.scrollIntoView(at, { y: "center" }),
      });
      view.focus();
      pendingLineRef.current = null;
    }, []);

    useEffect(() => {
      if (doc.status === "ready") applyPendingGoto();
    }, [doc.status, applyPendingGoto]);

    const extensions = useMemo(
      () => [
        // basicSetup is added before user extensions by @uiw/react-codemirror,
        // so we must elevate vim's precedence to win the keymap.
        vimCompartment.of(
          usePreferencesStore.getState().vimMode ? Prec.highest(vim()) : [],
        ),
        vimHandlersExtension(() => ({
          save: () => {
            void (async () => {
              await saveRef.current();
              onSavedRef.current?.();
            })();
          },
          close: () => onCloseRef.current?.(),
        })),
        ...buildSharedExtensions(),
        languageCompartment.of([]),
        inlineCompletion({
          getPrefs: () => {
            const s = usePreferencesStore.getState();
            const p = s.autocompleteProvider;
            const modelId =
              p === "lmstudio"
                ? s.lmstudioModelId
                : p === "mlx"
                  ? s.mlxModelId
                  : p === "ollama"
                    ? s.ollamaModelId
                    : p === "openai-compatible"
                      ? s.openaiCompatibleModelId
                      : p === "openrouter"
                        ? s.openrouterModelId
                        : s.autocompleteModelId;
            return {
              enabled: s.autocompleteEnabled,
              provider: p,
              modelId,
              apiKey: apiKeyRef.current,
              lmstudioBaseURL: s.lmstudioBaseURL,
              mlxBaseURL: s.mlxBaseURL,
              ollamaBaseURL: s.ollamaBaseURL,
              openaiCompatibleBaseURL: s.openaiCompatibleBaseURL,
            };
          },
          getPath: () => pathRef.current,
          getLanguage: () => languageRef.current,
        }),
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              void (async () => {
                await saveRef.current();
                onSavedRef.current?.();
              })();
              return true;
            },
          },
        ]),
      ],
      [],
    );

    useEffect(() => {
      const view = cmRef.current?.view;
      if (!view) return;
      view.dispatch({
        effects: vimCompartment.reconfigure(vimMode ? Prec.highest(vim()) : []),
      });
    }, [vimMode]);

    useEffect(() => {
      const ext = path.split(".").pop()?.toLowerCase() ?? null;
      languageRef.current = ext;
      if (doc.status !== "ready") return;
      let cancelled = false;
      const resolve = async (): Promise<Extension> => {
        if (isThemeFilePath(path)) {
          const [{ json }, { colorSwatches }] = await Promise.all([
            import("@codemirror/lang-json"),
            import("./lib/colorSwatches"),
          ]);
          return [json(), colorSwatches()];
        }
        return (await resolveLanguage(path)) ?? [];
      };
      void resolve().then((extension) => {
        if (cancelled) return;
        const view = cmRef.current?.view;
        if (!view) return;
        view.dispatch({
          effects: languageCompartment.reconfigure(extension),
        });
      });
      return () => {
        cancelled = true;
      };
    }, [path, doc.status]);

    const copySelection = async (cut: boolean) => {
      const view = cmRef.current?.view;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      if (from === to) return;
      const text = view.state.sliceDoc(from, to);
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        return;
      }
      if (cut) {
        view.dispatch({
          changes: { from, to, insert: "" },
          selection: { anchor: from },
        });
      }
      view.focus();
    };

    const pasteClipboard = async () => {
      const view = cmRef.current?.view;
      if (!view) return;
      try {
        const text = await navigator.clipboard.readText();
        if (!text) return;
        view.dispatch(view.state.replaceSelection(text));
        view.focus();
      } catch {
        return;
      }
    };

    const selectAll = () => {
      const view = cmRef.current?.view;
      if (!view) return;
      view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
      view.focus();
    };

    useImperativeHandle(
      ref,
      () => ({
        setQuery: (q: string) => {
          const view = cmRef.current?.view;
          if (!view) return;
          view.dispatch({
            effects: setSearchQuery.of(
              new SearchQuery({ search: q, caseSensitive: false }),
            ),
          });
          if (q) findNext(view);
        },
        findNext: () => {
          const view = cmRef.current?.view;
          if (view) findNext(view);
        },
        findPrevious: () => {
          const view = cmRef.current?.view;
          if (view) findPrevious(view);
        },
        clearQuery: () => {
          const view = cmRef.current?.view;
          if (!view) return;
          view.dispatch({
            effects: setSearchQuery.of(new SearchQuery({ search: "" })),
          });
        },
        focus: () => {
          cmRef.current?.view?.focus();
        },
        getSelection: () => {
          const view = cmRef.current?.view;
          if (!view) return null;
          const { from, to } = view.state.selection.main;
          if (from === to) return null;
          return view.state.sliceDoc(from, to);
        },
        getPath: () => path,
        reload: () => reloadRef.current(),
        gotoLine: (line: number) => {
          pendingLineRef.current = line;
          applyPendingGoto();
        },
        undo: () => {
          const view = cmRef.current?.view;
          if (view) undo(view);
        },
        redo: () => {
          const view = cmRef.current?.view;
          if (view) redo(view);
        },
      }),
      [path, applyPendingGoto],
    );

    if (doc.status === "loading") {
      return (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          Loading…
        </div>
      );
    }
    if (doc.status === "error") {
      return (
        <div className="flex h-full items-center justify-center px-6 text-center text-xs text-destructive">
          {doc.message}
        </div>
      );
    }
    if (doc.status === "binary" || doc.status === "toolarge") {
      const ext = path.split(".").pop()?.toLowerCase() ?? "";
      const isImage = [
        "png",
        "jpg",
        "jpeg",
        "gif",
        "webp",
        "svg",
        "ico",
      ].includes(ext);
      const isVideo = ["mp4", "webm", "ogg", "mov"].includes(ext);
      const isAudio = ["mp3", "wav", "flac", "aac", "m4a"].includes(ext);
      const isPdf = ext === "pdf";

      if (isImage || isVideo || isAudio || isPdf) {
        const assetUrl = convertFileSrc(path);
        return (
          <div className="flex h-full min-h-0 flex-col items-center justify-center bg-background p-4 overflow-auto">
            {isImage && (
              <img
                src={assetUrl}
                loading="lazy"
                decoding="async"
                className="max-w-full max-h-full object-contain rounded-md border border-border shadow-sm"
                style={{
                  backgroundImage:
                    "conic-gradient(#e5e7eb 0.25turn, #f3f4f6 0.25turn 0.5turn, #e5e7eb 0.5turn 0.75turn, #f3f4f6 0.75turn)",
                  backgroundSize: "20px 20px",
                }}
                alt={path.split("/").pop()}
              />
            )}
            {isVideo && (
              // biome-ignore lint/a11y/useMediaCaption: local media preview opens arbitrary files with no caption track
              <video
                controls
                preload="metadata"
                className="max-w-full max-h-full"
                src={assetUrl}
              />
            )}
            {isAudio && (
              // biome-ignore lint/a11y/useMediaCaption: local media preview opens arbitrary files with no caption track
              <audio
                controls
                preload="metadata"
                className="w-full max-w-md"
                src={assetUrl}
              />
            )}
            {isPdf && (
              <iframe
                src={assetUrl}
                className="w-full h-full border-none"
                title={path.split("/").pop()}
              />
            )}
          </div>
        );
      }

      return (
        <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
          <div className="text-sm text-foreground">
            {doc.status === "binary" ? "Binary file" : "File too large"}
          </div>
          <div className="text-xs text-muted-foreground">
            {formatBytes(doc.size)} · preview not supported
          </div>
        </div>
      );
    }

    return (
      <ContextMenu
        onOpenChange={(open) => {
          if (!open) return;
          const selection = cmRef.current?.view?.state.selection.main;
          setHasSelection(
            Boolean(selection && selection.from !== selection.to),
          );
        }}
      >
        <ContextMenuTrigger asChild>
          <div
            className="flex h-full min-h-0 flex-col zoom-exempt"
            onContextMenuCapture={(event) => {
              const target = event.target as HTMLElement;
              if (target.closest("input, textarea")) event.stopPropagation();
            }}
          >
            <CodeMirror
              ref={cmRef}
              value={doc.content}
              onChange={onChange}
              theme={themeExt}
              extensions={extensions}
              height="100%"
              className="flex-1 min-h-0 overflow-hidden"
              basicSetup={{
                lineNumbers: true,
                highlightActiveLineGutter: true,
                foldGutter: true,
                bracketMatching: true,
                closeBrackets: true,
                autocompletion: true,
                highlightActiveLine: true,
                highlightSelectionMatches: true,
                searchKeymap: true,
              }}
            />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent
          className="min-w-56"
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <ContextMenuItem
            disabled={!hasSelection}
            onSelect={() => void copySelection(true)}
          >
            <HugeiconsIcon icon={Scissor01Icon} size={14} strokeWidth={1.75} />
            <span className="flex-1">Cut</span>
            <ContextMenuShortcut>
              {fmtShortcut(MOD_KEY, "X")}
            </ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!hasSelection}
            onSelect={() => void copySelection(false)}
          >
            <HugeiconsIcon icon={Copy01Icon} size={14} strokeWidth={1.75} />
            <span className="flex-1">Copy</span>
            <ContextMenuShortcut>
              {fmtShortcut(MOD_KEY, "C")}
            </ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void pasteClipboard()}>
            <HugeiconsIcon
              icon={ClipboardPasteIcon}
              size={14}
              strokeWidth={1.75}
            />
            <span className="flex-1">Paste</span>
            <ContextMenuShortcut>
              {fmtShortcut(MOD_KEY, "V")}
            </ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={selectAll}>
            <HugeiconsIcon
              icon={TextSelectionIcon}
              size={14}
              strokeWidth={1.75}
            />
            <span className="flex-1">Select All</span>
            <ContextMenuShortcut>
              {fmtShortcut(MOD_KEY, "A")}
            </ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() => {
              void saveRef
                .current()
                .then(() => onSavedRef.current?.())
                .catch((error) => console.error("[clack] save failed", error));
            }}
          >
            <HugeiconsIcon icon={SaveIcon} size={14} strokeWidth={1.75} />
            <span className="flex-1">Save File</span>
            <ContextMenuShortcut>
              {fmtShortcut(MOD_KEY, "S")}
            </ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              void navigator.clipboard.writeText(path).catch(() => {});
            }}
          >
            <HugeiconsIcon icon={Copy01Icon} size={14} strokeWidth={1.75} />
            <span>Copy Path</span>
          </ContextMenuItem>
          {onAskAiSelection && hasSelection ? (
            <ContextMenuItem onSelect={onAskAiSelection}>
              <HugeiconsIcon icon={AiMagicIcon} size={14} strokeWidth={1.75} />
              <span>Ask AI about Selection</span>
            </ContextMenuItem>
          ) : null}
          {onRevealInExplorer ? (
            <ContextMenuItem onSelect={onRevealInExplorer}>
              <HugeiconsIcon
                icon={FolderTreeIcon}
                size={14}
                strokeWidth={1.75}
              />
              <span>Reveal in Explorer</span>
            </ContextMenuItem>
          ) : null}
          {onAttachFileToAgent ? (
            <ContextMenuItem onSelect={() => onAttachFileToAgent(path)}>
              <HugeiconsIcon
                icon={FileAttachmentIcon}
                size={14}
                strokeWidth={1.75}
              />
              <span>Attach File to Agent</span>
            </ContextMenuItem>
          ) : null}
          {onClose ? (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={onClose}>
                <HugeiconsIcon
                  icon={Cancel01Icon}
                  size={14}
                  strokeWidth={1.75}
                />
                <span>Close Tab</span>
              </ContextMenuItem>
            </>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>
    );
  },
);
