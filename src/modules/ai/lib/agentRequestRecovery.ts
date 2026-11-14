import type { UIMessage } from "ai";
import { readAnswer } from "./answerContinuation";
import type { ExecutionRecord } from "./customToolExecution";
import type { NormalizedAiError } from "./errors";
import type { SessionMeta, SessionRun } from "./sessions";
import { contextDigest } from "./targetContext";
import type { WriteCheckpoint } from "./writeCheckpoint";

/** A reference to existing durable transcript/results, not a second tool ledger. */
export type AgentRequestCheckpoint = {
  version: 1;
  runId: string;
  agentId: string;
  modelId: string;
  modelRevision: number | null;
  providerId: string;
  transportModelId: string;
  workspaceId: string | null;
  workspaceRoot: string | null;
  checkoutId: string | null;
  checkoutRoot: string | null;
  /** Existing native bounded complete source-tree fingerprint, never inferred from Git HEAD alone. */
  workspaceRevision: string;
  transcriptDigest: string;
  transcriptBoundary: { count: number; lastId: string };
  permissionsDigest: string;
  todoDigest: string;
  planDigest: string;
  budgetDigest: string;
  toolReceipts: Array<{
    id: string;
    name: string;
    inputDigest: string;
    outputDigest: string;
  }>;
  workspaceReceipts: Array<{
    path: string;
    kind: "file" | "dir";
    digest?: string;
  }>;
  nativeWriteRevision: string | null;
};

export type AgentRequestFailureRecovery = {
  attempts: number;
  phase: "preparing" | "checkpointed" | "dispatched" | "finished";
  /** The sole provider-failure recovery allowance is shared by both timeout
   * classes. This safe code remains fixed even if the fresh segment fails. */
  consumedBy?: "first-output-timeout" | "stream-idle-timeout";
  failures: NormalizedAiError[];
  checkpoint?: AgentRequestCheckpoint;
};

export function eligibleAgentRequestFailure(
  run: SessionRun | undefined,
  error: NormalizedAiError,
): boolean {
  return (
    !!run &&
    run.state === "running" &&
    error.kind === "timeout" &&
    // A pre-first-output failure cannot have delivered an executable tool call.
    // A post-output idle failure may have partial content, so both MUST pass
    // the identical durable transcript/effect checkpoint before one new segment.
    (error.errorCode === "stream-idle-timeout" ||
      error.errorCode === "first-output-timeout") &&
    (run.agentRequestRecovery?.attempts ?? 0) === 0 &&
    !run.peerTaskId &&
    run.customTools?.unavailable === false &&
    !!run.agentId &&
    !!run.modelId &&
    !!run.providerId &&
    !!run.transportModelId &&
    !!run.budget &&
    run.budget.phase === "running" &&
    run.budget.totalSteps + 1 < run.budget.hardStepLimit &&
    run.budget.continuationCount < run.budget.maxAutoContinuations &&
    run.stop?.source !== "explicit-user" &&
    run.stop?.source !== "host-shutdown" &&
    run.stop?.source !== "agent-watchdog"
  );
}

export type AgentCheckpointEvidence = {
  permissions: unknown;
  todos: unknown;
  plan: unknown;
  records: ExecutionRecord[];
  writeCheckpoint: WriteCheckpoint | null;
  workspaceRevision: string;
  readFile: (path: string) => Promise<string>;
  isDirectory: (path: string) => Promise<boolean>;
};

const harmlessTools = new Set([
  "read_file",
  "list_directory",
  "grep",
  "glob",
  "bash_logs",
  "bash_list",
  "suggest_command",
  "request_conversation_evidence",
]);

function withinWorkspace(path: string, root: string | null): boolean {
  if (!root || !path) return false;
  const norm = (s: string) =>
    s.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const p = norm(path),
    r = norm(root);
  if (!p.startsWith(`${r}/`)) return false;
  // The transcript is evidence, not authority to resolve an arbitrary path.
  // Reject lexical traversal before touching native file APIs.
  return !p
    .slice(r.length + 1)
    .split("/")
    .some((part) => part === "." || part === ".." || !part);
}

/** Reject every unpaired/unknown operation; a tool result does not license replay. */
export async function captureAgentRequestCheckpoint(
  session: SessionMeta,
  messages: UIMessage[],
  evidence: AgentCheckpointEvidence,
): Promise<AgentRequestCheckpoint> {
  const run = session.run;
  if (
    run?.state !== "running" ||
    !run.budget ||
    !evidence.workspaceRevision ||
    !run.agentId ||
    !run.modelId ||
    !run.providerId ||
    !run.transportModelId
  )
    throw new Error("No current Agent run to checkpoint.");
  if (
    !Array.isArray(evidence.records) ||
    evidence.records.some(
      (record) => record.runId === run.startedAt || record.runId == null,
    )
  )
    throw new Error(
      "Native custom tool effects require reconciliation; nothing was replayed.",
    );
  if (!messages.some((message) => message.role === "user"))
    throw new Error("The mission transcript has no user objective.");

  const seen = new Set<string>();
  const toolReceipts: AgentRequestCheckpoint["toolReceipts"] = [];
  const writes = new Map<
    string,
    { path: string; kind: "file" | "dir"; digest?: string; content?: string }
  >();
  let lastUser = -1;
  for (let i = 0; i < messages.length; i++)
    if (messages[i].role === "user") lastUser = i;
  for (const message of messages.slice(lastUser + 1)) {
    if (message.role !== "assistant")
      throw new Error("Unexpected transcript role during Agent recovery.");
    const answer = readAnswer(message);
    if (
      answer &&
      (answer.runId !== `${session.id}:${run.startedAt}` ||
        answer.segments.some((segment) => segment.pending.length > 0))
    )
      throw new Error(
        "An incomplete or foreign tool operation requires reconciliation.",
      );
    for (const part of message.parts) {
      if (!(part.type === "dynamic-tool" || part.type.startsWith("tool-")))
        continue;
      const tool = part as typeof part & {
        toolCallId?: string;
        toolName?: string;
        state?: string;
        input?: unknown;
        output?: unknown;
        errorText?: string;
      };
      const id = tool.toolCallId;
      const name =
        part.type === "dynamic-tool" ? tool.toolName : part.type.slice(5);
      if (
        !id ||
        !name ||
        seen.has(id) ||
        tool.state !== "output-available" ||
        tool.errorText ||
        tool.output === undefined
      )
        throw new Error(
          "An unresolved, duplicated or failed tool call requires reconciliation.",
        );
      seen.add(id);
      const output = tool.output as Record<string, unknown> | null;
      if (
        output &&
        typeof output === "object" &&
        (output.ok === false || output.error != null)
      )
        throw new Error("A failed tool effect requires reconciliation.");
      if (name === "write_file" || name === "create_directory") {
        const path =
          output && typeof output.path === "string" ? output.path : "";
        if (
          !withinWorkspace(
            path,
            run.checkoutRoot ?? run.workspaceRoot ?? null,
          ) ||
          output?.ok !== true ||
          output?.clackWorkspaceWrite !== true
        )
          throw new Error(
            "A file mutation lacks an authoritative completed workspace receipt.",
          );
        if (name === "write_file") {
          const input = tool.input as { content?: unknown } | null;
          if (
            typeof input?.content !== "string" ||
            output.bytesWritten !== input.content.length
          )
            throw new Error(
              "A completed write has inconsistent input and result receipts.",
            );
          writes.set(path, { path, kind: "file", content: input.content });
        } else writes.set(path, { path, kind: "dir" });
      } else if (name !== "todo_write" && !harmlessTools.has(name)) {
        throw new Error(
          `Tool ${name} has no proven replay-safe effect reconciliation.`,
        );
      }
      toolReceipts.push({
        id,
        name,
        inputDigest: await contextDigest(tool.input),
        outputDigest: await contextDigest(tool.output),
      });
    }
  }

  const workspaceReceipts: AgentRequestCheckpoint["workspaceReceipts"] = [];
  for (const write of writes.values()) {
    if (write.kind === "file") {
      const actual = await evidence.readFile(write.path);
      if (actual !== write.content)
        throw new Error("Workspace revision changed after completed write.");
      workspaceReceipts.push({
        path: write.path,
        kind: "file",
        digest: await contextDigest(actual),
      });
    } else {
      if (!(await evidence.isDirectory(write.path)))
        throw new Error(
          "Completed directory effect no longer matches the workspace.",
        );
      workspaceReceipts.push({ path: write.path, kind: "dir" });
    }
  }
  const transcriptDigest = await contextDigest(messages);
  return {
    version: 1,
    runId: `${session.id}:${run.startedAt}`,
    agentId: run.agentId,
    modelId: run.modelId,
    modelRevision: session.modelRevision ?? null,
    providerId: run.providerId,
    transportModelId: run.transportModelId,
    workspaceId: run.workspaceId ?? null,
    workspaceRoot: run.workspaceRoot ?? null,
    checkoutId: run.checkoutId ?? null,
    checkoutRoot: run.checkoutRoot ?? null,
    workspaceRevision: evidence.workspaceRevision,
    transcriptDigest,
    transcriptBoundary: {
      count: messages.length,
      lastId: messages[messages.length - 1].id,
    },
    permissionsDigest: await contextDigest(evidence.permissions),
    todoDigest: await contextDigest(evidence.todos),
    planDigest: await contextDigest(evidence.plan),
    budgetDigest: await contextDigest(run.budget),
    toolReceipts,
    workspaceReceipts,
    nativeWriteRevision: evidence.writeCheckpoint?.revision ?? null,
  };
}

export function sameAgentRequestOwner(
  checkpoint: AgentRequestCheckpoint,
  session: SessionMeta | undefined,
): boolean {
  const run = session?.run;
  return (
    !!run &&
    run.state === "running" &&
    `${session.id}:${run.startedAt}` === checkpoint.runId &&
    run.agentId === checkpoint.agentId &&
    run.modelId === checkpoint.modelId &&
    (session.modelRevision ?? null) === checkpoint.modelRevision &&
    run.providerId === checkpoint.providerId &&
    run.transportModelId === checkpoint.transportModelId &&
    (run.workspaceId ?? null) === checkpoint.workspaceId &&
    (run.workspaceRoot ?? null) === checkpoint.workspaceRoot &&
    (run.checkoutId ?? null) === checkpoint.checkoutId &&
    (run.checkoutRoot ?? null) === checkpoint.checkoutRoot
  );
}
