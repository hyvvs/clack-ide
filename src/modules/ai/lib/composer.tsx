import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useWhisperRecording } from "../hooks/useWhisperRecording";
import {
  ACCEPTED_ATTACHMENT_FILES,
  ATTACHMENT_LIMITS,
  type AttachmentRecord,
  createPendingPickerAttachment,
  createSelectionAttachment,
  isDeliverableAttachment,
  mergeAttachmentRecords,
  normalizePickerAttachment,
  normalizeWorkspaceAttachment,
  persistAttachmentRecord,
  releaseAttachmentPreview,
  releaseAttachmentRecordContent,
} from "./attachments";
import {
  type AttachmentMessagePart,
  toAttachmentMessagePart,
} from "./attachmentMessages";
import {
  attachmentCapabilityStatus,
  firstBlockedAttachment,
  resolveModelInputCapabilities,
  type AttachmentCapabilityStatus,
} from "./modelCapabilities";
import { expandSnippetTokens, type Snippet } from "../lib/snippets";
import { tryRunSlashCommand, type SlashCommandMeta } from "./slashCommands";
import { cancelRun, useChatStore } from "../store/chatStore";
import { useSnippetsStore } from "../store/snippetsStore";
import { resolveModelSelectionInfo } from "./savedProviderModels";

type MessagePart = { type: "text"; text: string } | AttachmentMessagePart;

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
  materializeArchiveEntry: (
    archiveAttachmentId: string,
    entryIndex: number,
  ) => Promise<void>;
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
  modelLabel: string;
  attachmentCapabilities: Readonly<Record<string, AttachmentCapabilityStatus>>;
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
  const modelId = useChatStore((state) => {
    const session = state.sessions.find(
      (candidate) => candidate.id === sessionId,
    );
    return session?.profile?.modelId ?? state.selectedModelId;
  });
  const modelCapabilities = useMemo(
    () => resolveModelInputCapabilities(modelId),
    [modelId],
  );
  const customEndpoints = usePreferencesStore((state) => state.customEndpoints);
  const savedProviderModels = usePreferencesStore(
    (state) => state.savedProviderModels,
  );
  const modelLabel = useMemo(() => {
    try {
      return resolveModelSelectionInfo(
        modelId,
        customEndpoints,
        savedProviderModels,
      ).label;
    } catch {
      return modelId || "Selected model";
    }
  }, [customEndpoints, modelId, savedProviderModels]);

  const [value, setValue] = useState("");
  const [files, setFiles] = useState<AttachmentRecord[]>([]);
  const filesRef = useRef<AttachmentRecord[]>([]);
  const pendingArchiveEntriesRef = useRef(new Set<string>());
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
    const retainedIds = new Set(merged.records.map((record) => record.id));
    for (const record of incoming) {
      if (!retainedIds.has(record.id) && record.contentRef) {
        releaseAttachmentRecordContent(record);
        releaseAttachmentPreview(record);
      }
    }
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
    return retainedIds;
  }, []);

  const settlePickerAttachment = useCallback(
    (pendingId: string, normalized: AttachmentRecord) => {
      const pendingIndex = filesRef.current.findIndex(
        (record) => record.id === pendingId,
      );
      if (pendingIndex === -1) {
        releaseAttachmentRecordContent(normalized);
        releaseAttachmentPreview(normalized);
        return;
      }
      const remaining = filesRef.current.filter(
        (record) => record.id !== pendingId,
      );
      const merged = mergeAttachmentRecords(remaining, [normalized]);
      const insertedIndex = merged.records.findIndex(
        (record) => record.id === normalized.id,
      );
      const inserted =
        insertedIndex === -1 ? null : merged.records[insertedIndex];
      const next =
        insertedIndex === -1
          ? merged.records
          : merged.records.filter((_, index) => index !== insertedIndex);
      if (inserted) {
        next.splice(Math.min(pendingIndex, next.length), 0, inserted);
      } else {
        releaseAttachmentRecordContent(normalized);
        releaseAttachmentPreview(normalized);
      }
      filesRef.current = next;
      setFiles(next);
      if (normalized.error) {
        const message = `${normalized.displayName}: ${normalized.error.message}`;
        if (normalized.processingState === "unsupported")
          toast.warning(message);
        else toast.error(message);
      }
      for (const rejection of merged.rejected) {
        toast.error(`${rejection.displayName}: ${rejection.message}`);
      }
    },
    [],
  );

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
    void Promise.all(
      drained.map((selection) => {
        const record = createSelectionAttachment({
          id: selection.id,
          text: selection.text,
          surface: selection.source,
        });
        return persistAttachmentRecord(
          record,
          new TextEncoder().encode(selection.text),
        );
      }),
    ).then(appendAttachments);
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

  const attachmentCapabilities = useMemo(
    () =>
      Object.fromEntries(
        files.map((file) => [
          file.id,
          attachmentCapabilityStatus(file, modelCapabilities),
        ]),
      ),
    [files, modelCapabilities],
  );

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    const selected = Array.from(list).map((file) => ({
      file,
      pending: createPendingPickerAttachment(file),
    }));
    if (selected.length === 0) return;
    const retainedIds = appendAttachments(
      selected.map(({ pending }) => pending),
    );
    await Promise.all(
      selected
        .filter(({ pending }) => retainedIds.has(pending.id))
        .map(async ({ file, pending }) => {
          const normalized = await normalizePickerAttachment(file, {
            id: pending.id,
            createdAt: pending.createdAt,
          });
          settlePickerAttachment(pending.id, normalized);
        }),
    );
  };

  const removeFile = (id: string) => {
    const removed = filesRef.current.filter(
      (file) =>
        file.id === id ||
        (file.source.kind === "archive-entry" &&
          file.source.archiveAttachmentId === id),
    );
    for (const file of removed) {
      releaseAttachmentPreview(file);
      releaseAttachmentRecordContent(file);
    }
    const removedIds = new Set(removed.map((file) => file.id));
    const next = filesRef.current.filter((file) => !removedIds.has(file.id));
    filesRef.current = next;
    setFiles(next);
  };

  const materializeArchiveEntry = useCallback(
    async (archiveAttachmentId: string, entryIndex: number) => {
      const key = `${archiveAttachmentId}:${entryIndex}`;
      if (pendingArchiveEntriesRef.current.has(key)) return;
      if (
        filesRef.current.some(
          (file) =>
            file.source.kind === "archive-entry" &&
            file.source.archiveAttachmentId === archiveAttachmentId &&
            file.source.entryIndex === entryIndex,
        )
      ) {
        return;
      }
      const archive = filesRef.current.find(
        (file) => file.id === archiveAttachmentId,
      );
      if (!archive) return;
      pendingArchiveEntriesRef.current.add(key);
      try {
        const { materializeArchiveEntry } = await import(
          "./archiveAttachments"
        );
        const entry = await materializeArchiveEntry(archive, entryIndex);
        appendAttachments([entry]);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      } finally {
        pendingArchiveEntriesRef.current.delete(key);
      }
    },
    [appendAttachments],
  );

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
    const blockedAttachment = firstBlockedAttachment(
      filesRef.current,
      modelCapabilities,
    );
    if (blockedAttachment) {
      toast.warning(
        `${blockedAttachment.attachment.displayName}: ${blockedAttachment.status.message}`,
      );
      return;
    }
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
      bodyAfterTokens,
    ]
      .filter(Boolean)
      .join("\n\n");
    if (composed) parts.push({ type: "text", text: composed });

    for (const file of files.filter(isDeliverableAttachment)) {
      parts.push(toAttachmentMessagePart(file));
    }

    if (!sessionId) return;
    const sentFiles = [...filesRef.current];
    const store = useChatStore.getState();
    store.patchAgentMeta(sessionId, {
      hitStepCap: false,
      compactionNotice: null,
    });
    void (async () => {
      try {
        const { sendMessageToSession } = await import("../store/chatRuntime");
        await sendMessageToSession(sessionId, { role: "user", parts });
      } finally {
        for (const file of sentFiles) {
          releaseAttachmentRecordContent(file);
        }
      }
    })();
    setValue("");
    for (const file of filesRef.current) releaseAttachmentPreview(file);
    filesRef.current = [];
    setFiles([]);
    setPickedSnippets([]);
    setPickedCommands([]);
    // Re-focus immediately after submit so the user can type a follow-up
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  useEffect(
    () => () => {
      for (const file of filesRef.current) {
        releaseAttachmentPreview(file);
        releaseAttachmentRecordContent(file);
      }
      filesRef.current = [];
    },
    [],
  );

  const stop = () => {
    if (sessionId) void cancelRun(sessionId);
  };

  const canSend =
    !isBusy &&
    !firstBlockedAttachment(files, modelCapabilities) &&
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
    materializeArchiveEntry,
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
    modelLabel,
    attachmentCapabilities,
  };

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}
