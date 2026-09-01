import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useWhisperRecording } from "../hooks/useWhisperRecording";
import {
  ACCEPTED_ATTACHMENT_FILES,
  ATTACHMENT_LIMITS,
  type AttachmentRecord,
  createSelectionAttachment,
  formatSelectionAttachmentBlock,
  formatTextAttachmentBlock,
  isDeliverableAttachment,
  mergeAttachmentRecords,
  normalizePickerAttachment,
  normalizeWorkspaceAttachment,
} from "./attachments";
import { expandSnippetTokens, type Snippet } from "../lib/snippets";
import { tryRunSlashCommand, type SlashCommandMeta } from "./slashCommands";
import { cancelRun, useChatStore } from "../store/chatStore";
import { useSnippetsStore } from "../store/snippetsStore";

type MessagePart =
  | { type: "text"; text: string }
  | { type: "file"; mediaType: string; url: string; filename?: string };

export const MAX_TEXT_INLINE = ATTACHMENT_LIMITS.maxTextBytes;
export const ACCEPTED_FILES = ACCEPTED_ATTACHMENT_FILES;

type Voice = ReturnType<typeof useWhisperRecording>;

type ComposerCtx = {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  setValue: React.Dispatch<React.SetStateAction<string>>;
  files: AttachmentRecord[];
  addFiles: (list: FileList | null) => Promise<void>;
  /** Attach a file by absolute path — used by the file explorer's "Attach to Agent". */
  attachFileByPath: (path: string) => Promise<void>;
  removeFile: (id: string) => void;
  pickedSnippets: Snippet[];
  addSnippet: (s: Snippet) => void;
  removeSnippet: (id: string) => void;
  pickedCommands: SlashCommandMeta[];
  addCommand: (c: SlashCommandMeta) => void;
  removeCommand: (name: string) => void;
  isBusy: boolean;
  submit: () => void;
  stop: () => void;
  voice: Voice;
  canSend: boolean;
};

const Ctx = createContext<ComposerCtx | null>(null);

export function useComposer(): ComposerCtx {
  const ctx = useContext(Ctx);
  if (!ctx)
    throw new Error("useComposer must be used inside <AiComposerProvider>");
  return ctx;
}

type ProviderProps = {
  children: React.ReactNode;
  sessionId?: string | null;
  consumeExternalEvents?: boolean;
};

export function AiComposerProvider({
  children,
  sessionId: explicitSessionId,
  consumeExternalEvents = true,
}: ProviderProps) {
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const sessionId =
    explicitSessionId === undefined ? activeSessionId : explicitSessionId;
  const status = useChatStore((s) =>
    sessionId ? (s.runtimeBySession[sessionId]?.status ?? "idle") : "idle",
  );
  const runState = useChatStore(
    (s) => s.sessions.find((session) => session.id === sessionId)?.run?.state,
  );
  const isBusy =
    status === "thinking" || status === "streaming" || runState === "running";

  const [value, setValue] = useState("");
  const [files, setFiles] = useState<AttachmentRecord[]>([]);
  const filesRef = useRef<AttachmentRecord[]>([]);
  const [pickedSnippets, setPickedSnippets] = useState<Snippet[]>([]);
  const [pickedCommands, setPickedCommands] = useState<SlashCommandMeta[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const focusSignal = useChatStore((s) => s.focusSignal);
  const pendingPrefill = useChatStore((s) => s.pendingPrefill);
  const consumePrefill = useChatStore((s) => s.consumePrefill);
  const pendingSelections = useChatStore((s) => s.pendingSelections);
  const consumeSelections = useChatStore((s) => s.consumeSelections);

  const appendAttachments = useCallback((incoming: AttachmentRecord[]) => {
    const merged = mergeAttachmentRecords(filesRef.current, incoming);
    filesRef.current = merged.records;
    setFiles(merged.records);
    for (const record of incoming) {
      if (!record.error) continue;
      const message = `${record.displayName}: ${record.error.message}`;
      if (record.processingState === "unsupported") toast.warning(message);
      else toast.error(message);
    }
    for (const rejection of merged.rejected) {
      toast.error(`${rejection.displayName}: ${rejection.message}`);
    }
  }, []);

  const attachFileByPath = useCallback(
    async (path: string) => {
      const workspaceRoot = useChatStore.getState().live.getWorkspaceRoot();
      const attachment = await normalizeWorkspaceAttachment(
        path,
        workspaceRoot,
      );
      appendAttachments([attachment]);
      useChatStore.getState().focusInput();
    },
    [appendAttachments],
  );

  useEffect(() => {
    if (!consumeExternalEvents) return;
    if (focusSignal === 0) return;
    textareaRef.current?.focus();
    if (pendingPrefill != null) {
      const text = consumePrefill();
      if (text) setValue((v) => (v ? `${text}${v}` : text));
    }
  }, [consumeExternalEvents, focusSignal, pendingPrefill, consumePrefill]);

  // Re-focus the textarea whenever the agent finishes a response
  const prevIsBusyRef = useRef(false);
  useEffect(() => {
    if (prevIsBusyRef.current && !isBusy) {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
    prevIsBusyRef.current = isBusy;
  }, [isBusy]);

  // Listen for explorer's "Attach to Agent" event.
  useEffect(() => {
    if (!consumeExternalEvents) return;
    const onAttach = (e: Event) => {
      const path = (e as CustomEvent<string>).detail;
      if (typeof path === "string" && path.length > 0) {
        void attachFileByPath(path);
      }
    };
    window.addEventListener("terax:ai-attach-file", onAttach);
    return () => window.removeEventListener("terax:ai-attach-file", onAttach);
  }, [attachFileByPath, consumeExternalEvents]);

  useEffect(() => {
    if (!consumeExternalEvents) return;
    if (pendingSelections.length === 0) return;
    const drained = consumeSelections();
    if (drained.length === 0) return;
    appendAttachments(
      drained.map((selection) =>
        createSelectionAttachment({
          id: selection.id,
          text: selection.text,
          surface: selection.source,
        }),
      ),
    );
  }, [
    appendAttachments,
    consumeExternalEvents,
    pendingSelections,
    consumeSelections,
  ]);

  const voice = useWhisperRecording({
    onResult: (transcript: string) => {
      setValue((v) => (v ? `${v} ${transcript}` : transcript));
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
  });

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    const next: AttachmentRecord[] = [];
    for (const f of Array.from(list)) {
      next.push(await normalizePickerAttachment(f));
    }
    if (next.length) appendAttachments(next);
  };

  const removeFile = (id: string) => {
    const next = filesRef.current.filter((file) => file.id !== id);
    filesRef.current = next;
    setFiles(next);
  };

  const addSnippet = (s: Snippet) =>
    setPickedSnippets((prev) =>
      prev.some((p) => p.id === s.id) ? prev : [...prev, s],
    );
  const removeSnippet = (id: string) =>
    setPickedSnippets((prev) => prev.filter((s) => s.id !== id));

  const addCommand = (cmd: SlashCommandMeta) =>
    setPickedCommands((prev) =>
      prev.some((p) => p.name === cmd.name) ? prev : [...prev, cmd],
    );
  const removeCommand = (name: string) =>
    setPickedCommands((prev) => prev.filter((c) => c.name !== name));

  const submit = () => {
    if (isBusy) return;
    const trimmed = value.trim();
    if (
      !trimmed &&
      !files.some(isDeliverableAttachment) &&
      pickedSnippets.length === 0 &&
      pickedCommands.length === 0
    )
      return;

    // Slash-command interception. `/plan` toggles plan mode; `/init` rewrites
    // the prompt to the project memory scan template before sending.
    let effectiveText = trimmed;
    let commandMarker: string | null = null;
    let commandSource = trimmed;
    if (
      pickedCommands.length > 0 &&
      !trimmed.startsWith("/") &&
      !trimmed.startsWith("#")
    ) {
      commandSource = `#${pickedCommands[0].name} ${trimmed}`.trim();
    }
    if (commandSource.startsWith("/") || commandSource.startsWith("#")) {
      const outcome = tryRunSlashCommand(commandSource);
      if (outcome.kind === "handled") {
        setValue("");
        if (outcome.toast) console.info(outcome.toast);
        return;
      }
      if (outcome.kind === "send-prompt") {
        effectiveText = outcome.prompt;
        if (outcome.commandName) {
          commandMarker = `<terax-command name="${outcome.commandName}" />`;
        }
      }
    }

    const parts: MessagePart[] = [];
    const fileBlocks = files
      .filter(
        (f) =>
          f.processingState === "ready" &&
          f.contentKind === "text" &&
          f.textRepresentation !== undefined,
      )
      .map(formatTextAttachmentBlock);
    const selectionBlocks = files
      .filter(
        (f) =>
          f.processingState === "ready" &&
          f.contentKind === "selection" &&
          f.textRepresentation !== undefined,
      )
      .map(formatSelectionAttachmentBlock);
    const { body: bodyAfterTokens, blocks: snippetBlocks } =
      expandSnippetTokens(effectiveText, useSnippetsStore.getState().snippets);
    const seenHandles = new Set<string>();
    const allSnippetBlocks: string[] = [];
    for (const s of pickedSnippets) {
      if (seenHandles.has(s.handle)) continue;
      seenHandles.add(s.handle);
      allSnippetBlocks.push(
        `<snippet name="${s.handle}">\n${s.content}\n</snippet>`,
      );
    }
    for (const block of snippetBlocks) {
      const m = block.match(/^<snippet name="([^"]+)"/);
      if (m && seenHandles.has(m[1])) continue;
      if (m) seenHandles.add(m[1]);
      allSnippetBlocks.push(block);
    }
    const composed = [
      commandMarker ?? "",
      allSnippetBlocks.join("\n\n"),
      selectionBlocks.join("\n\n"),
      fileBlocks.join("\n\n"),
      bodyAfterTokens,
    ]
      .filter(Boolean)
      .join("\n\n");
    if (composed) parts.push({ type: "text", text: composed });

    for (const f of files) {
      if (
        f.processingState === "ready" &&
        f.contentKind === "image" &&
        f.imageRepresentation
      ) {
        parts.push({
          type: "file",
          mediaType: f.detectedMediaType,
          url: f.imageRepresentation,
          filename: f.displayName,
        });
      }
    }

    if (!sessionId) return;
    const store = useChatStore.getState();
    store.patchAgentMeta(sessionId, {
      hitStepCap: false,
      compactionNotice: null,
    });
    void (async () => {
      const { sendMessageToSession } = await import("../store/chatRuntime");
      await sendMessageToSession(sessionId, { role: "user", parts });
    })();
    setValue("");
    filesRef.current = [];
    setFiles([]);
    setPickedSnippets([]);
    setPickedCommands([]);
    // Re-focus immediately after submit so the user can type a follow-up
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const stop = () => {
    if (sessionId) void cancelRun(sessionId);
  };

  const canSend =
    !isBusy &&
    (value.trim().length > 0 ||
      files.some(isDeliverableAttachment) ||
      pickedSnippets.length > 0 ||
      pickedCommands.length > 0);

  const ctx: ComposerCtx = {
    textareaRef,
    value,
    setValue,
    files,
    addFiles,
    attachFileByPath,
    removeFile,
    pickedSnippets,
    addSnippet,
    removeSnippet,
    pickedCommands,
    addCommand,
    removeCommand,
    isBusy,
    submit,
    stop,
    voice,
    canSend,
  };

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}
