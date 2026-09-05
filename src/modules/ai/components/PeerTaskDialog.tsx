import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useState } from "react";
import { BUILTIN_AGENTS, type Agent } from "../lib/agents";
import {
  buildDelegationRequest,
  collectDelegationArtifactChoices,
  delegationArtifactCannotBeDelivered,
  delegationArtifactPresentation,
  delegationTargetStatus,
  eligibleDelegationTargets,
} from "../lib/delegationUx";
import { requestPeerTask } from "../lib/peerTaskCoordinator";
import type { PeerTaskExecutionMode, PeerTaskKind } from "../lib/peerTasks";
import { resolveModelSelectionInfo } from "../lib/savedProviderModels";
import type { SessionMeta } from "../lib/sessions";
import { useAgentsStore } from "../store/agentsStore";
import { getChat, useChatStore } from "../store/chatStore";
import { usePeerTaskStore } from "../store/peerTaskStore";
import { AttachmentStateIcon } from "./AttachmentDetailsPopover";

const KINDS: Array<{ id: PeerTaskKind; label: string }> = [
  { id: "question", label: "Question" },
  { id: "review", label: "Review" },
  { id: "delegate", label: "Task" },
];

const EXECUTION_MODES: Array<{
  id: PeerTaskExecutionMode;
  label: string;
  description: string;
}> = [
  {
    id: "read-only",
    label: "Read only",
    description: "Can inspect and review, but cannot change workspace files.",
  },
  {
    id: "shared-write",
    label: "Edit workspace",
    description:
      "Can edit this workspace when its permission profile allows it.",
  },
  {
    id: "isolated-worktree",
    label: "Isolated changes",
    description:
      "Works in an isolated Git checkout and returns changes to review.",
  },
];

export function PeerTaskDialog({
  sourceSessionId,
  open,
  onOpenChange,
}: {
  sourceSessionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const sessions = useChatStore((state) => state.sessions);
  const tasks = usePeerTaskStore((state) => state.tasks);
  const customAgents = useAgentsStore((state) => state.customAgents);
  const customEndpoints = usePreferencesStore((state) => state.customEndpoints);
  const savedProviderModels = usePreferencesStore(
    (state) => state.savedProviderModels,
  );
  const agents = useMemo(
    () => [...BUILTIN_AGENTS, ...customAgents],
    [customAgents],
  );
  const targets = useMemo(
    () => eligibleDelegationTargets(sessions, sourceSessionId),
    [sessions, sourceSessionId],
  );
  const [targetSessionId, setTargetSessionId] = useState("");
  const [kind, setKind] = useState<PeerTaskKind>("question");
  const [executionMode, setExecutionMode] =
    useState<PeerTaskExecutionMode>("read-only");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedContentIds, setSelectedContentIds] = useState<Set<string>>(
    () => new Set(),
  );
  const availableArtifacts = useMemo(
    () =>
      open
        ? collectDelegationArtifactChoices(
            getChat(sourceSessionId)?.messages ?? [],
            tasks,
            sourceSessionId,
          )
        : [],
    [open, sourceSessionId, tasks],
  );
  const effectiveTargetSessionId = targets.some(
    (session) => session.id === targetSessionId,
  )
    ? targetSessionId
    : (targets[0]?.id ?? "");
  const target =
    targets.find((session) => session.id === effectiveTargetSessionId) ?? null;
  const targetDescription = target
    ? describeTarget(target, agents, customEndpoints, savedProviderModels)
    : null;
  const artifactPresentations = useMemo(
    () =>
      new Map(
        availableArtifacts.map((choice) => [
          choice.reference.contentId,
          delegationArtifactPresentation(
            choice.reference,
            target?.profile?.modelId ?? "",
            targetDescription?.modelName,
          ),
        ]),
      ),
    [
      availableArtifacts,
      target?.profile?.modelId,
      targetDescription?.modelName,
    ],
  );
  const incompatibleSelected = [...selectedContentIds].filter((contentId) => {
    const state = artifactPresentations.get(contentId);
    return state ? delegationArtifactCannotBeDelivered(state) : true;
  });

  useEffect(() => {
    if (!open) return;
    setPrompt("");
    setError(null);
    setKind("question");
    setExecutionMode("read-only");
    setSelectedContentIds(new Set());
  }, [open]);

  const submit = async () => {
    if (!target || !prompt.trim() || submitting) return;
    if (incompatibleSelected.length > 0) {
      setError(
        "Remove context that cannot be delivered to this agent's selected model.",
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await requestPeerTask(
      buildDelegationRequest({
        sourceSessionId,
        targetSessionId: target.id,
        kind,
        executionMode,
        prompt,
        choices: availableArtifacts,
        selectedContentIds,
      }),
    );
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onOpenChange(false);
  };

  const access = EXECUTION_MODES.find((mode) => mode.id === executionMode);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ask another agent</DialogTitle>
          <DialogDescription>
            Send a focused task to another chat in this workspace.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="space-y-1.5">
            <label
              htmlFor="delegation-target"
              className="text-[10px] font-medium uppercase text-muted-foreground"
            >
              Agent
            </label>
            {targets.length > 0 ? (
              <>
                <Select
                  value={effectiveTargetSessionId}
                  onValueChange={setTargetSessionId}
                >
                  <SelectTrigger id="delegation-target" className="w-full">
                    <SelectValue placeholder="Choose another agent" />
                  </SelectTrigger>
                  <SelectContent position="popper" className="max-w-sm">
                    {targets.map((session) => {
                      const description = describeTarget(
                        session,
                        agents,
                        customEndpoints,
                        savedProviderModels,
                      );
                      return (
                        <SelectItem key={session.id} value={session.id}>
                          {description.agentName} | {description.modelName} |{" "}
                          {session.title || "New chat"} | {description.status}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                {targetDescription ? (
                  <div className="flex min-w-0 items-center gap-1.5 px-0.5 text-[10.5px] text-[var(--clack-text-3)]">
                    <span className="font-medium text-[var(--clack-text-2)]">
                      {targetDescription.agentName}
                    </span>
                    <span aria-hidden>|</span>
                    <span className="min-w-0 truncate">
                      {targetDescription.modelName}
                    </span>
                    <span aria-hidden>|</span>
                    <span
                      className={cn(
                        "shrink-0",
                        targetDescription.busy && "text-[var(--clack-warning)]",
                      )}
                    >
                      {targetDescription.busy
                        ? "Running, task will be queued"
                        : "Idle"}
                    </span>
                  </div>
                ) : null}
                <p className="px-0.5 text-[9.5px] text-[var(--clack-text-3)]">
                  Only other configured chats in this workspace are listed.
                </p>
              </>
            ) : (
              <div className="rounded-[var(--clack-radius-button)] border border-[color:var(--clack-border-subtle)] bg-[var(--clack-surface-2)] px-3 py-2 text-[11px] text-[var(--clack-text-3)]">
                Open or create another chat in this workspace first. This chat
                cannot send a task to itself.
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="delegation-task"
              className="text-[10px] font-medium uppercase text-muted-foreground"
            >
              Task
            </label>
            <Textarea
              id="delegation-task"
              autoFocus
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="What should this agent help with?"
              className="min-h-24 resize-y"
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
          </div>

          <Collapsible defaultOpen className="group/options">
            <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-[var(--clack-radius-button)] px-1 py-1 text-left text-[11px] text-[var(--clack-text-2)] hover:text-[var(--clack-text-1)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--clack-focus)]">
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                size={11}
                strokeWidth={1.8}
                className="transition-transform group-data-[state=open]/options:rotate-90"
              />
              <span>Context and access</span>
              <span className="ml-auto text-[10px] text-[var(--clack-text-3)]">
                {selectedContentIds.size > 0
                  ? `${selectedContentIds.size} selected`
                  : "No files or attachments"}
                {` | ${access?.label ?? "Read only"}`}
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent className="clack-collapsible-content mt-1 space-y-3 rounded-[var(--clack-radius-button)] bg-[var(--clack-surface-2)] p-2.5">
              <div className="space-y-1.5">
                <div className="text-[10px] font-medium uppercase text-muted-foreground">
                  Context to send
                </div>
                {availableArtifacts.length > 0 ? (
                  <div className="max-h-28 space-y-1 overflow-auto">
                    {availableArtifacts.map((choice) => {
                      const checked = selectedContentIds.has(
                        choice.reference.contentId,
                      );
                      const presentation = artifactPresentations.get(
                        choice.reference.contentId,
                      );
                      const incompatible = presentation
                        ? delegationArtifactCannotBeDelivered(presentation)
                        : true;
                      return (
                        <label
                          key={choice.reference.contentId}
                          htmlFor={`delegation-artifact-${choice.reference.contentId}`}
                          className={cn(
                            "flex items-center gap-2 rounded-[var(--clack-radius-button)] px-1 py-1 text-[10.5px]",
                            incompatible && !checked
                              ? "cursor-not-allowed opacity-65"
                              : "cursor-pointer hover:bg-[var(--clack-surface-hover)]",
                          )}
                          title={presentation?.explanation}
                        >
                          <Checkbox
                            id={`delegation-artifact-${choice.reference.contentId}`}
                            checked={selectedContentIds.has(
                              choice.reference.contentId,
                            )}
                            disabled={incompatible && !checked}
                            onCheckedChange={(checked) => {
                              setSelectedContentIds((current) => {
                                const next = new Set(current);
                                if (checked) {
                                  next.add(choice.reference.contentId);
                                } else {
                                  next.delete(choice.reference.contentId);
                                }
                                return next;
                              });
                            }}
                          />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate">
                              {choice.reference.displayName}
                            </span>
                            {presentation ? (
                              <span className="flex min-w-0 items-center gap-1 truncate text-[9.5px] text-[var(--clack-text-3)]">
                                <AttachmentStateIcon
                                  outcome={presentation.outcome}
                                />
                                <span className="shrink-0 font-medium">
                                  {presentation.statusLabel}
                                </span>
                                <span aria-hidden>·</span>
                                <span className="truncate">
                                  {presentation.summary}
                                </span>
                              </span>
                            ) : null}
                          </span>
                          <span className="shrink-0 text-[9.5px] text-[var(--clack-text-3)]">
                            {choice.originLabel}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[10.5px] text-[var(--clack-text-3)]">
                    No transferable files are available in this chat.
                  </p>
                )}
                <p className="text-[9.5px] text-[var(--clack-text-3)]">
                  {selectedContentIds.size === 0
                    ? "No files or attachments will be sent. Conversation history is not copied."
                    : `Only the ${selectedContentIds.size} checked ${selectedContentIds.size === 1 ? "item is" : "items are"} sent. Conversation history is not copied.`}
                </p>
              </div>

              <div className="space-y-1.5">
                <div className="text-[10px] font-medium uppercase text-muted-foreground">
                  Request type
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {KINDS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setKind(item.id)}
                      className={cn(
                        "h-7 rounded-[var(--clack-radius-button)] text-[10.5px] transition-colors",
                        kind === item.id
                          ? "bg-[var(--clack-surface-1)] text-[var(--clack-text-1)] shadow-sm"
                          : "text-[var(--clack-text-3)] hover:text-[var(--clack-text-1)]",
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="text-[10px] font-medium uppercase text-muted-foreground">
                  Workspace access
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {EXECUTION_MODES.map((mode) => {
                    const unavailable =
                      mode.id === "isolated-worktree" &&
                      !target?.profile?.workspaceId?.startsWith("local:");
                    return (
                      <button
                        key={mode.id}
                        type="button"
                        disabled={unavailable}
                        onClick={() => setExecutionMode(mode.id)}
                        title={
                          unavailable
                            ? "Isolated changes are unavailable for WSL workspaces."
                            : mode.description
                        }
                        className={cn(
                          "h-7 rounded-[var(--clack-radius-button)] px-1 text-[10px] transition-colors disabled:opacity-40",
                          executionMode === mode.id
                            ? "bg-[var(--clack-surface-1)] text-[var(--clack-text-1)] shadow-sm"
                            : "text-[var(--clack-text-3)] hover:text-[var(--clack-text-1)]",
                        )}
                      >
                        {mode.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[9.5px] text-muted-foreground">
                  {access?.description}
                </p>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {error ? (
            <p className="text-[11px] text-destructive">{error}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={
              !target ||
              !prompt.trim() ||
              submitting ||
              incompatibleSelected.length > 0
            }
            aria-disabled={incompatibleSelected.length > 0}
          >
            {submitting
              ? "Sending..."
              : target?.run?.state === "running"
                ? "Queue task"
                : "Send task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function describeTarget(
  session: SessionMeta,
  agents: readonly Agent[],
  customEndpoints: ReturnType<
    typeof usePreferencesStore.getState
  >["customEndpoints"],
  savedProviderModels: ReturnType<
    typeof usePreferencesStore.getState
  >["savedProviderModels"],
) {
  const agentId = session.profile?.agentId;
  const agentName =
    agents.find((agent) => agent.id === agentId)?.name ?? agentId ?? "Agent";
  const modelId = session.profile?.modelId ?? "";
  let modelName = modelId || "No model";
  try {
    modelName = resolveModelSelectionInfo(
      modelId,
      customEndpoints,
      savedProviderModels,
    ).label;
  } catch {
    modelName = modelId || "No model";
  }
  const busy = session.run?.state === "running";
  return {
    agentName,
    modelName,
    busy,
    status: delegationTargetStatus(session),
  };
}
