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
import {
  ArrowRight01Icon,
  Attachment01Icon,
  SentIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { BUILTIN_AGENTS, type Agent } from "@/modules/ai/lib/agents";
import {
  buildDelegationRequest,
  collectDelegationArtifactChoices,
  delegationArtifactCannotBeDelivered,
  delegationArtifactPresentation,
  delegationTargetStatus,
  eligibleDelegationTargets,
} from "@/modules/ai/lib/delegationUx";
import { requestPeerTask } from "@/modules/ai/lib/peerTaskCoordinator";
import type {
  PeerTaskExecutionMode,
  PeerTaskKind,
} from "@/modules/ai/lib/peerTasks";
import { resolveModelSelectionInfo } from "@/modules/ai/lib/savedProviderModels";
import type { SessionMeta } from "@/modules/ai/lib/sessions";
import { useAgentsStore } from "@/modules/ai/store/agentsStore";
import { getChat, useChatStore } from "@/modules/ai/store/chatStore";
import { usePeerTaskStore } from "@/modules/ai/store/peerTaskStore";
import { AttachmentStateIcon } from "@/modules/ai/components/AttachmentDetailsPopover";
import "@/modules/ai/components/PeerTaskDialog.css";

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
  const id = useId();
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const sendingRef = useRef(false);
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
  const unavailableAccess =
    executionMode === "isolated-worktree" &&
    !target?.profile?.workspaceId?.startsWith("local:");

  useEffect(() => {
    if (!open) return;
    setPrompt("");
    setError(null);
    setKind("question");
    setExecutionMode("read-only");
    setSelectedContentIds(new Set());
  }, [open]);

  const submit = async () => {
    if (!target || !prompt.trim() || sendingRef.current || unavailableAccess)
      return;
    if (incompatibleSelected.length > 0) {
      setError(
        "Remove context that cannot be delivered to this agent's selected model.",
      );
      return;
    }
    sendingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
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
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onOpenChange(false);
    } catch {
      setError("Could not send the task. Please try again.");
    } finally {
      sendingRef.current = false;
      setSubmitting(false);
    }
  };

  const access = EXECUTION_MODES.find((mode) => mode.id === executionMode);

  const sourceTitle =
    sessions.find((session) => session.id === sourceSessionId)?.title ||
    "New chat";
  const validationMessage = unavailableAccess
    ? "Choose a different access mode. Isolated changes require a local workspace."
    : incompatibleSelected.length > 0
      ? "Remove the selected context that this agent's model cannot receive."
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="clack-delegation-dialog"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          promptRef.current?.focus();
        }}
      >
        <DialogHeader className="clack-delegation-header">
          <DialogTitle>Ask another agent</DialogTitle>
          <DialogDescription
            className="clack-delegation-source"
            title={sourceTitle}
          >
            From {sourceTitle}
          </DialogDescription>
        </DialogHeader>

        <div className="clack-delegation-body">
          <div className="clack-delegation-field">
            <label htmlFor={`${id}-target`} className="clack-delegation-label">
              To
            </label>
            {target && targetDescription ? (
              <Select
                value={effectiveTargetSessionId}
                onValueChange={setTargetSessionId}
                disabled={submitting}
              >
                <SelectTrigger
                  id={`${id}-target`}
                  className="clack-delegation-target"
                >
                  <SelectValue>
                    <TargetLabel
                      session={target}
                      description={targetDescription}
                    />
                  </SelectValue>
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  align="start"
                  collisionPadding={12}
                  className="clack-delegation-target-menu"
                >
                  {targets.map((session) => {
                    const description = describeTarget(
                      session,
                      agents,
                      customEndpoints,
                      savedProviderModels,
                    );
                    return (
                      <SelectItem
                        key={session.id}
                        value={session.id}
                        textValue={`${session.title || "New chat"} ${description.agentName} ${description.modelName}`}
                        className="clack-delegation-target-option"
                      >
                        <TargetLabel
                          session={session}
                          description={description}
                        />
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            ) : (
              <p className="clack-delegation-empty" role="status">
                No other configured chats in this workspace. Create another chat
                to delegate a task.
              </p>
            )}
          </div>

          <fieldset className="clack-delegation-field" disabled={submitting}>
            <legend className="clack-delegation-label">Request type</legend>
            <div className="clack-delegation-segments">
              {KINDS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={kind === item.id}
                  onClick={() => setKind(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="clack-delegation-field">
            <label htmlFor={`${id}-prompt`} className="clack-delegation-label">
              Task
            </label>
            <Textarea
              id={`${id}-prompt`}
              ref={promptRef}
              value={prompt}
              disabled={submitting}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="What should this agent help with?"
              className="clack-delegation-prompt"
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
          </div>

          <div className="clack-delegation-access">
            <div className="clack-delegation-field">
              <label
                htmlFor={`${id}-access`}
                className="clack-delegation-label"
              >
                Workspace access
              </label>
              <Select
                value={executionMode}
                onValueChange={(value) =>
                  setExecutionMode(value as PeerTaskExecutionMode)
                }
                disabled={submitting}
              >
                <SelectTrigger
                  id={`${id}-access`}
                  className="clack-delegation-access-trigger"
                  aria-describedby={`${id}-access-description`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  align="start"
                  collisionPadding={12}
                >
                  {EXECUTION_MODES.map((mode) => (
                    <SelectItem
                      key={mode.id}
                      value={mode.id}
                      disabled={
                        mode.id === "isolated-worktree" &&
                        !target?.profile?.workspaceId?.startsWith("local:")
                      }
                    >
                      {mode.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p
              id={`${id}-access-description`}
              className="clack-delegation-note"
            >
              {access?.description}
            </p>
          </div>

          <Collapsible
            defaultOpen={availableArtifacts.length > 0}
            className="clack-delegation-context"
          >
            <CollapsibleTrigger className="clack-delegation-context-trigger">
              <HugeiconsIcon
                icon={Attachment01Icon}
                size={15}
                strokeWidth={1.8}
              />
              <span>Context</span>
              <span className="clack-delegation-context-count">
                {selectedContentIds.size} selected
              </span>
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                size={13}
                strokeWidth={1.8}
                className="clack-delegation-chevron"
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              {availableArtifacts.length > 0 ? (
                <fieldset className="clack-delegation-artifacts">
                  <legend className="sr-only">Context to send</legend>
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
                        htmlFor={`${id}-artifact-${choice.reference.contentId}`}
                        className={cn(
                          "clack-delegation-artifact",
                          incompatible &&
                            !checked &&
                            "clack-delegation-artifact-unavailable",
                        )}
                        title={`${choice.reference.displayName}\n${presentation?.explanation ?? ""}`}
                      >
                        <Checkbox
                          id={`${id}-artifact-${choice.reference.contentId}`}
                          checked={checked}
                          disabled={submitting || (incompatible && !checked)}
                          onCheckedChange={(value) => {
                            setSelectedContentIds((current) => {
                              const next = new Set(current);
                              if (value === true)
                                next.add(choice.reference.contentId);
                              else next.delete(choice.reference.contentId);
                              return next;
                            });
                          }}
                        />
                        <span className="clack-delegation-artifact-copy">
                          <span className="clack-delegation-filename">
                            {choice.reference.displayName}
                          </span>
                          {presentation ? (
                            <span className="clack-delegation-artifact-state">
                              <AttachmentStateIcon
                                outcome={presentation.outcome}
                              />
                              <span>
                                {presentation.statusLabel} ·{" "}
                                {presentation.summary}
                              </span>
                            </span>
                          ) : null}
                          <span className="clack-delegation-origin">
                            {choice.originLabel}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </fieldset>
              ) : (
                <p className="clack-delegation-note">
                  No transferable files in this chat.
                </p>
              )}
            </CollapsibleContent>
            <p className="clack-delegation-note clack-delegation-delivery">
              {selectedContentIds.size === 0
                ? "No files or attachments will be sent. Conversation history is not copied."
                : `Only ${selectedContentIds.size} selected ${selectedContentIds.size === 1 ? "item will" : "items will"} be sent. Conversation history is not copied.`}
            </p>
          </Collapsible>
        </div>

        <div className="clack-delegation-actions">
          {error || validationMessage ? (
            <p className="clack-delegation-error" role="alert">
              {error || validationMessage}
            </p>
          ) : null}
          <DialogFooter className="clack-delegation-footer">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void submit()}
              disabled={
                !target || !prompt.trim() || submitting || !!validationMessage
              }
            >
              <HugeiconsIcon icon={SentIcon} size={14} strokeWidth={1.8} />
              {submitting
                ? "Sending..."
                : targetDescription?.busy
                  ? "Queue task"
                  : "Send task"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TargetLabel({
  session,
  description,
}: {
  session: SessionMeta;
  description: ReturnType<typeof describeTarget>;
}) {
  return (
    <span
      className="clack-delegation-recipient"
      title={`${session.title || "New chat"}\n${description.agentName} · ${description.modelName}\n${description.status}`}
    >
      <span className="clack-delegation-recipient-copy">
        <span className="clack-delegation-recipient-title">
          {session.title || "New chat"}
        </span>
        <span className="clack-delegation-recipient-detail">
          {description.agentName} · {description.modelName}
        </span>
      </span>
      <span
        className={cn(
          "clack-delegation-recipient-status",
          description.busy && "text-[var(--clack-warning)]",
        )}
      >
        {description.busy ? "Will queue" : "Idle"}
      </span>
    </span>
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
