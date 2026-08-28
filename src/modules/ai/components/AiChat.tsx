import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Tool } from "@/components/ai-elements/tool";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowRight01Icon,
  CodeIcon,
  File01Icon,
  HashtagIcon,
  TerminalIcon,
  StopCircleIcon,
} from "@hugeicons/core-free-icons";
import { SLASH_COMMANDS, TERAX_CMD_RE } from "../lib/slashCommands";
import { Spinner } from "@/components/ui/spinner";
import {
  useChatStore,
  type ProviderRetryState,
} from "../store/chatStore";
import { continueActiveRun } from "../store/chatRuntime";
import { describeRunBudgetStop, type RunBudgetState } from "../lib/runBudget";
import type {
  ChatStatus,
  DynamicToolUIPart,
  ToolUIPart,
  UIMessage,
  UIMessagePart,
} from "ai";
import { memo, useCallback, useMemo } from "react";
import { AiToolApproval } from "./AiToolApproval";
import { AiErrorCard } from "./AiErrorCard";
import {
  normalizeAiError,
  sanitizeAiErrorText,
  shouldPresentAiError,
} from "@/modules/ai/lib/errors";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";

function CommandSnippet({ name }: { name: string }) {
  const meta = SLASH_COMMANDS[name];
  if (!meta) {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-[var(--clack-radius-button)] border border-[color:var(--clack-border-subtle)] bg-[var(--clack-surface-2)] px-2 py-1 font-mono text-[11px] text-[var(--clack-text-2)]">
        /{name}
      </div>
    );
  }
  return (
    <div className="inline-flex max-w-full items-center gap-2 rounded-[var(--clack-radius-button)] border border-[color:var(--clack-border-subtle)] bg-[var(--clack-surface-2)] px-2 py-1">
      <HugeiconsIcon
        icon={meta.icon}
        size={12}
        strokeWidth={1.75}
        className="shrink-0 text-[var(--clack-accent)]"
      />
      <span className="font-mono text-[11px] text-[var(--clack-text-1)]">
        {meta.invocation}
      </span>
      <span className="truncate text-[11px] text-[var(--clack-text-3)]">
        {meta.label}
      </span>
    </div>
  );
}

type AnyToolPart = ToolUIPart | DynamicToolUIPart;

type ContextChip =
  | { kind: "selection"; source: "terminal" | "editor"; lines: number }
  | { kind: "file"; name: string; lines: number }
  | { kind: "snippet"; name: string };

const SELECTION_RE =
  /<selection\s+source="(terminal|editor)">\n?([\s\S]*?)\n?<\/selection>/g;
const FILE_RE = /<file\s+name="([^"]+)"[^>]*>\n?([\s\S]*?)\n?<\/file>/g;
const SNIPPET_RE = /<snippet\s+name="([^"]+)">\n?[\s\S]*?\n?<\/snippet>/g;

function countLines(s: string): number {
  if (!s) return 0;
  const trimmed = s.replace(/\n+$/, "");
  if (!trimmed) return 0;
  return trimmed.split("\n").length;
}

function stripUserContextBlocks(text: string): {
  text: string;
  chips: ContextChip[];
} {
  const chips: ContextChip[] = [];
  let out = text;
  out = out.replace(SELECTION_RE, (_m, source: string, body: string) => {
    chips.push({
      kind: "selection",
      source: source === "editor" ? "editor" : "terminal",
      lines: countLines(body),
    });
    return "";
  });
  out = out.replace(FILE_RE, (_m, name: string, body: string) => {
    chips.push({ kind: "file", name, lines: countLines(body) });
    return "";
  });
  out = out.replace(SNIPPET_RE, (_m, name: string) => {
    chips.push({ kind: "snippet", name });
    return "";
  });
  return { text: out.trim(), chips };
}

const ContextChips = memo(function ContextChips({
  chips,
}: {
  chips: ContextChip[];
}) {
  return (
    <div className="mb-1 flex flex-wrap gap-1">
      {chips.map((c, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 rounded-[var(--clack-radius-button)] border border-[color:var(--clack-border-subtle)] bg-[var(--clack-surface-2)] px-1.5 py-0.5 text-[10.5px] text-[var(--clack-text-3)]"
        >
          {chipIcon(c)}
          <span className="font-medium text-[var(--clack-text-1)]">
            {chipLabel(c)}
          </span>
          {"lines" in c && c.lines > 0 ? (
            <span className="opacity-70">| {c.lines}L</span>
          ) : null}
        </span>
      ))}
    </div>
  );
});

function chipIcon(c: ContextChip) {
  if (c.kind === "selection") {
    return (
      <HugeiconsIcon
        icon={c.source === "editor" ? CodeIcon : TerminalIcon}
        size={10}
        strokeWidth={1.75}
      />
    );
  }
  if (c.kind === "file") {
    return <HugeiconsIcon icon={File01Icon} size={10} strokeWidth={1.75} />;
  }
  return <HugeiconsIcon icon={HashtagIcon} size={10} strokeWidth={1.75} />;
}

function chipLabel(c: ContextChip): string {
  if (c.kind === "selection") {
    return c.source === "editor" ? "Editor selection" : "Terminal selection";
  }
  if (c.kind === "file") return c.name;
  return `#${c.name}`;
}
type AnyPart = UIMessagePart<Record<string, never>, Record<string, never>>;

type ApprovalArg = {
  id: string;
  approved: boolean;
  reason?: string;
};

type Props = {
  messages: UIMessage[];
  status: ChatStatus;
  error: Error | undefined;
  clearError: () => void;
  addToolApprovalResponse: (arg: ApprovalArg) => void | PromiseLike<void>;
  stop: () => void | PromiseLike<void>;
};

export function AiChatView({
  messages,
  status,
  error,
  clearError,
  addToolApprovalResponse,
  stop,
}: Props) {
  const chatIsBusy = status === "submitted" || status === "streaming";
  const lastMessage = messages[messages.length - 1];
  const streamingMessageId =
    status === "streaming" && lastMessage?.role === "assistant"
      ? lastMessage.id
      : null;
  const step = useChatStore((s) => s.agentMeta.step);
  const compactionNotice = useChatStore((s) => s.agentMeta.compactionNotice);
  const storedError = useChatStore((s) => s.agentMeta.error);
  const providerRetry = useChatStore((s) => s.agentMeta.providerRetry);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const run = useChatStore(
    (s) => s.sessions.find((session) => session.id === activeSessionId)?.run,
  );
  const isBusy = run?.state === "running" && chatIsBusy;
  const showSpinner = isBusy && lastMessage?.role === "user";
  const patchAgentMeta = useChatStore((s) => s.patchAgentMeta);
  const hookError = useMemo(
    () =>
      error ? normalizeAiError(error, { disposition: "terminal" }) : null,
    [error],
  );
  const normalizedError = storedError ?? hookError;
  const visibleError = shouldPresentAiError(normalizedError, run?.state)
    ? normalizedError
    : null;
  const showContinue =
    !isBusy &&
    run?.budget?.phase === "soft-limit" &&
    lastMessage?.role === "assistant";
  const showHardLimit =
    !isBusy &&
    run?.budget?.phase === "hard-limit" &&
    lastMessage?.role === "assistant";

  const onApproval = useCallback(
    (id: string, approved: boolean) =>
      addToolApprovalResponse({ id, approved }),
    [addToolApprovalResponse],
  );

  if (messages.length === 0) {
    return (
      <Conversation>
        <ConversationContent>
          <ConversationEmptyState
            title="Ask Clack anything"
            description="Explain command output, fix errors, generate snippets, or run a task."
          />
        </ConversationContent>
      </Conversation>
    );
  }

  return (
    <Conversation>
      <ConversationContent className="gap-5 p-3">
        {messages.map((m) => (
          <RenderedMessage
            key={m.id}
            message={m}
            onApproval={onApproval}
            streaming={m.id === streamingMessageId}
          />
        ))}
        {compactionNotice && (
          <CompactionNotice
            droppedCount={compactionNotice.droppedCount}
            onDismiss={() => patchAgentMeta({ compactionNotice: null })}
          />
        )}
        {showSpinner && (
          <div className="flex items-center gap-2 text-xs text-[var(--clack-text-3)]">
            <Spinner />
            <span className="truncate">{step ?? "Thinking..."}</span>
            <button
              type="button"
              onClick={() => void stop()}
              className="ml-auto inline-flex items-center gap-1 rounded-[var(--clack-radius-button)] px-1.5 py-0.5 text-[10.5px] hover:bg-[var(--clack-accent-soft)] hover:text-[var(--clack-text-1)]"
              aria-label="Stop active AI run"
            >
              <HugeiconsIcon
                icon={StopCircleIcon}
                size={11}
                strokeWidth={1.9}
              />
              Stop
            </button>
          </div>
        )}
        {run?.state === "running" && providerRetry ? (
          <ProviderRetryNotice retry={providerRetry} />
        ) : null}
        {run &&
        run.state !== "running" &&
        run.state !== "completed" &&
        !(run.state === "failed" && visibleError) ? (
          <RunTerminalStatus state={run.state} commandName={run.commandName} />
        ) : null}
        {showContinue && (
          <ContinueRow onContinue={() => void continueActiveRun(false)} />
        )}
        {showHardLimit && run?.budget ? (
          <HardLimitRow
            budget={run.budget}
            onContinue={() => void continueActiveRun(true)}
          />
        ) : null}
        {visibleError ? (
          <AiErrorCard
            error={visibleError}
            onOpenProviderSettings={() => void openSettingsWindow("models")}
            onDismiss={() => {
              clearError();
              patchAgentMeta({ status: "idle", error: null });
            }}
          />
        ) : null}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}

export function ProviderRetryNotice({
  retry,
}: {
  retry: ProviderRetryState;
}) {
  const provider = retry.error.provider ?? "AI provider";
  const rateLimited = retry.error.kind === "rate_limit";
  return (
    <div className="clack-ai-block flex items-center gap-2 border-[color:var(--clack-warning)]/35 px-2.5 py-1.5 text-[11px]">
      <Spinner className="size-3 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-[var(--clack-text-2)]">
        {rateLimited
          ? `Rate limited by ${provider}. Retrying...`
          : `${provider} is temporarily unavailable. Retrying...`}
      </span>
      <span className="shrink-0 font-mono text-[10px] text-[var(--clack-text-3)]">
        {retry.error.statusCode ? `HTTP ${retry.error.statusCode} | ` : ""}
        retry {retry.retryNumber}/{retry.maxRetries}
        {retry.error.retryAfter ? ` | ${retry.error.retryAfter}` : ""}
      </span>
    </div>
  );
}

function RunTerminalStatus({
  state,
  commandName,
}: {
  state: "failed" | "cancelled" | "interrupted";
  commandName?: string;
}) {
  const label =
    state === "interrupted"
      ? "Interrupted: this run ended when the previous Clack session closed."
      : state === "cancelled"
        ? "Cancelled"
        : "Run failed";
  return (
    <div className="rounded-[var(--clack-radius-button)] border border-[color:var(--clack-border-subtle)] bg-[var(--clack-surface-2)] px-2.5 py-1.5 text-[11px] text-[var(--clack-text-3)]">
      {commandName ? (
        <span className="mr-1 font-mono text-[var(--clack-text-2)]">
          #{commandName}
        </span>
      ) : null}
      {label}
    </div>
  );
}

const CompactionNotice = memo(function CompactionNotice({
  droppedCount,
  onDismiss,
}: {
  droppedCount: number;
  onDismiss: () => void;
}) {
  return (
    <div className="clack-ai-block flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-[var(--clack-text-3)]">
      <span className="size-1.5 shrink-0 rounded-full bg-[var(--clack-warning)]" />
      <span className="flex-1 truncate">
        Context compacted. {droppedCount} older tool result
        {droppedCount === 1 ? "" : "s"} elided to save tokens.
      </span>
      <button
        type="button"
        onClick={onDismiss}
        className="text-[10.5px] underline opacity-70 hover:opacity-100"
      >
        Dismiss
      </button>
    </div>
  );
});

export const ContinueRow = memo(function ContinueRow({
  onContinue,
}: {
  onContinue: () => void;
}) {
  return (
    <div className="clack-ai-block flex items-center gap-2 px-2.5 py-1.5 text-[11px]">
      <span className="flex-1 text-[var(--clack-text-3)]">
        Hit the step limit. Continue to keep going.
      </span>
      <button
        type="button"
        onClick={onContinue}
        className="rounded-[var(--clack-radius-button)] border border-[color:var(--clack-border-subtle)] bg-[var(--clack-surface-2)] px-2 py-0.5 text-[11px] font-medium text-[var(--clack-text-1)] transition-colors hover:bg-[var(--clack-accent-soft)]"
      >
        Continue
      </button>
    </div>
  );
});

export const RenderedMessage = memo(function RenderedMessage({
  message,
  onApproval,
  streaming,
}: {
  message: UIMessage;
  onApproval: (id: string, approved: boolean) => void;
  streaming: boolean;
}) {
  // Index of the trailing text part. Only that one is live mid-stream.
  // Earlier text parts (separated by tool calls) are already finalized.
  let lastTextIdx = -1;
  for (let i = message.parts.length - 1; i >= 0; i -= 1) {
    if (message.parts[i]?.type === "text") {
      lastTextIdx = i;
      break;
    }
  }
  const groups = useMemo(
    () => buildPartGroups(message.parts as AnyPart[]),
    [message.parts],
  );

  if (message.role === "user") {
    const rawText = message.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("\n");

    const cmdMatch = rawText.match(TERAX_CMD_RE);
    const commandName = cmdMatch?.[1] ?? null;
    const withoutCmd = cmdMatch ? rawText.slice(cmdMatch[0].length) : rawText;
    const stripped = stripUserContextBlocks(withoutCmd);

    return (
      <Message from="user">
        <MessageContent>
          {commandName ? <CommandSnippet name={commandName} /> : null}
          {stripped.chips.length > 0 ? (
            <ContextChips chips={stripped.chips} />
          ) : null}
          {stripped.text ? (
            <p className="whitespace-pre-wrap wrap-break-word">
              {stripped.text}
            </p>
          ) : null}
        </MessageContent>
      </Message>
    );
  }

  return (
    <Message from={message.role}>
      <MessageContent>
        <div className="flex flex-col gap-3">
          {groups.map((g) => {
            if (g.kind === "reads") {
              return (
                <PartAppear key={`${message.id}-${g.key}`}>
                  <ReadGroup parts={g.parts} />
                </PartAppear>
              );
            }
            const isReadSingle =
              partType(g.part) === "tool-read_file" &&
              ((g.part as { state?: string }).state ?? "") !==
                "approval-requested" &&
              !toolErrorText(g.part);
            if (isReadSingle) {
              return (
                <PartAppear key={`${message.id}-${g.key}`}>
                  <ReadRow part={g.part} />
                </PartAppear>
              );
            }
            return (
              <PartAppear key={`${message.id}-${g.key}`}>
                <RenderedPart
                  part={g.part}
                  onApproval={onApproval}
                  streaming={streaming && g.idx === lastTextIdx}
                />
              </PartAppear>
            );
          })}
        </div>
      </MessageContent>
    </Message>
  );
});

type Group =
  | { kind: "single"; part: AnyPart; idx: number; key: string }
  | { kind: "reads"; parts: AnyPart[]; key: string };

function partType(p: AnyPart): string {
  return (p as { type?: string }).type ?? "";
}

function isReadFilePart(p: AnyPart): boolean {
  if (partType(p) !== "tool-read_file") return false;
  const state = (p as { state?: string }).state ?? "";
  return state !== "approval-requested" && !toolErrorText(p);
}

function partKey(p: AnyPart, idx: number): string {
  const tc = (p as { toolCallId?: string }).toolCallId;
  if (tc) return tc;
  const id = (p as { approval?: { id?: string } }).approval?.id;
  if (id) return id;
  return `i-${idx}`;
}

function buildPartGroups(parts: AnyPart[]): Group[] {
  const out: Group[] = [];
  let run: { parts: AnyPart[]; startIdx: number } | null = null;
  const flushRun = () => {
    if (!run) return;
    const current = run;
    if (current.parts.length >= 2) {
      out.push({
        kind: "reads",
        parts: current.parts,
        key: `reads-${partKey(current.parts[0], current.startIdx)}`,
      });
    } else {
      current.parts.forEach((p, k) => {
        const idx = current.startIdx + k;
        out.push({ kind: "single", part: p, idx, key: partKey(p, idx) });
      });
    }
    run = null;
  };
  parts.forEach((p, i) => {
    if (isReadFilePart(p)) {
      if (!run) run = { parts: [], startIdx: i };
      run.parts.push(p);
      return;
    }
    flushRun();
    out.push({ kind: "single", part: p, idx: i, key: partKey(p, i) });
  });
  flushRun();
  return out;
}

function readPathFromPart(p: AnyPart): string | null {
  const input = (p as { input?: { path?: unknown } }).input;
  const path = input?.path;
  return typeof path === "string" && path.length > 0 ? path : null;
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

const ReadGroup = memo(function ReadGroup({ parts }: { parts: AnyPart[] }) {
  const paths = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of parts) {
      const path = readPathFromPart(p);
      if (!path) continue;
      if (seen.has(path)) continue;
      seen.add(path);
      out.push(path);
    }
    return out;
  }, [parts]);
  const count = paths.length || parts.length;
  const preview = paths.map(basename).join(", ");

  return (
    <Collapsible className="clack-ai-block group/read overflow-hidden">
      <CollapsibleTrigger
        className={cn(
          "flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px]",
          "transition-colors hover:bg-[rgba(159,177,210,0.07)]",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--clack-focus)]",
        )}
      >
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          size={11}
          strokeWidth={2}
          className={cn(
            "shrink-0 text-[var(--clack-text-3)] transition-transform",
            "group-data-[state=open]/read:rotate-90",
          )}
        />
        <HugeiconsIcon
          icon={File01Icon}
          size={13}
          strokeWidth={1.75}
          className="shrink-0 text-[var(--clack-accent)]"
        />
        <span className="shrink-0 font-medium text-[var(--clack-text-1)]">
          Read
        </span>
        <span className="shrink-0 text-[11px] text-[var(--clack-text-3)]">
          {count} file{count === 1 ? "" : "s"}
        </span>
        {paths.length > 0 ? (
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--clack-text-3)] group-data-[state=open]/read:invisible">
            | {preview}
          </span>
        ) : null}
      </CollapsibleTrigger>
      <CollapsibleContent className="clack-collapsible-content border-t border-[color:var(--clack-border-subtle)]">
        <ul className="flex flex-col gap-0.5 px-2 py-1.5">
          {paths.map((path) => (
            <li
              key={path}
              className="flex items-center gap-1.5 font-mono text-[11px] text-[var(--clack-text-3)]"
            >
              <HugeiconsIcon
                icon={File01Icon}
                size={10}
                strokeWidth={1.75}
                className="shrink-0 opacity-60"
              />
              <span className="truncate text-[var(--clack-text-1)]">
                {basename(path)}
              </span>
              <span className="truncate opacity-60">{path}</span>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
});

const PartAppear = memo(function PartAppear({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-out">
      {children}
    </div>
  );
});

const ReadRow = memo(function ReadRow({ part }: { part: AnyPart }) {
  const path = readPathFromPart(part);
  const state = (part as { state?: string }).state ?? "";
  const isError = state === "output-error";
  return (
    <div className="flex items-center gap-2 rounded-[var(--clack-radius-button)] px-2 py-1.5 text-[12px]">
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          isError
            ? "bg-destructive"
            : "border border-[color:var(--clack-border-subtle)] bg-transparent",
        )}
      />
      <HugeiconsIcon
        icon={File01Icon}
        size={13}
        strokeWidth={1.75}
        className="shrink-0 text-[var(--clack-accent)]"
      />
      <span className="shrink-0 font-medium text-[var(--clack-text-1)]">
        Read
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--clack-text-3)]">
        {path ?? ""}
      </span>
    </div>
  );
});

const RenderedPart = memo(function RenderedPart({
  part,
  onApproval,
  streaming,
}: {
  part: AnyPart;
  onApproval: (id: string, approved: boolean) => void;
  streaming: boolean;
}) {
  if (part.type === "text") {
    return (
      <MessageResponse streaming={streaming}>
        {(part as unknown as { text: string }).text}
      </MessageResponse>
    );
  }

  if (part.type === "reasoning") {
    return (
      <Reasoning>
        <ReasoningTrigger />
        <ReasoningContent>
          {(part as unknown as { text: string }).text}
        </ReasoningContent>
      </Reasoning>
    );
  }

  if (
    part.type === "dynamic-tool" ||
    (typeof part.type === "string" && part.type.startsWith("tool-"))
  ) {
    return (
      <RenderedTool
        part={part as unknown as AnyToolPart}
        onApproval={onApproval}
      />
    );
  }

  return null;
});

const RenderedTool = memo(function RenderedTool({
  part,
  onApproval,
}: {
  part: AnyToolPart;
  onApproval: (id: string, approved: boolean) => void;
}) {
  const toolName =
    part.type === "dynamic-tool"
      ? part.toolName
      : part.type.replace(/^tool-/, "");
  const errorText = toolErrorText(part);
  const visualState = errorText ? "output-error" : part.state;

  if (part.state === "approval-requested") {
    return (
      <AiToolApproval
        part={part as Extract<ToolUIPart, { state: "approval-requested" }>}
        toolName={toolName}
        onRespond={(approved) => onApproval(part.approval.id, approved)}
      />
    );
  }

  return (
    <Tool
      toolName={toolName}
      state={visualState}
      input={part.input}
      output={"output" in part ? part.output : undefined}
      errorText={errorText}
      defaultOpen={toolName === "list_directory" ? true : undefined}
    />
  );
});

export const HardLimitRow = memo(function HardLimitRow({
  budget,
  onContinue,
}: {
  budget: RunBudgetState;
  onContinue: () => void;
}) {
  return (
    <div className="clack-ai-block flex items-start gap-2 border-[color:var(--clack-warning)]/40 px-2.5 py-2 text-[11px]">
      <div className="min-w-0 flex-1">
        <div className="font-medium text-[var(--clack-warning)]">
          Autonomous run limit reached
        </div>
        <div className="mt-0.5 text-[var(--clack-text-3)]">
          {describeRunBudgetStop(budget)}
        </div>
      </div>
      <button
        type="button"
        onClick={onContinue}
        className="shrink-0 rounded-[var(--clack-radius-button)] border border-[color:var(--clack-warning)]/40 bg-[color:var(--clack-warning)]/10 px-2 py-0.5 font-medium text-[var(--clack-warning)] transition-colors hover:bg-[color:var(--clack-warning)]/15"
      >
        Continue anyway
      </button>
    </div>
  );
});

function toolErrorText(part: unknown): string | undefined {
  if (!part || typeof part !== "object") return undefined;
  const candidate = part as { errorText?: unknown; output?: unknown };
  if (typeof candidate.errorText === "string") {
    return sanitizeAiErrorText(candidate.errorText, 1_200) || undefined;
  }
  if (!candidate.output || typeof candidate.output !== "object") {
    return undefined;
  }
  const error = (candidate.output as Record<string, unknown>).error;
  return typeof error === "string"
    ? sanitizeAiErrorText(error, 1_200) || undefined
    : undefined;
}
