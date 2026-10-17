export type AcceptanceApproval = {
  id: string;
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
};

export type AcceptanceOwner = {
  sessionId: string;
  runId: string;
  workspaceRoot: string;
};

export type AcceptanceSnapshot = AcceptanceOwner & {
  state: string;
  cwd: string | null;
  active: boolean;
  responderReady: boolean;
  approvals: AcceptanceApproval[];
  effects: { toolCallId: string; state: string; output?: unknown }[];
};

export class AcceptanceApprovalBlocked extends Error {
  readonly classification = "HARNESS-BLOCKED";
}

const identity = (value: unknown) => JSON.stringify(value);
const sameOwner = (a: AcceptanceOwner, b: AcceptanceOwner) =>
  a.sessionId === b.sessionId &&
  a.runId === b.runId &&
  a.workspaceRoot === b.workspaceRoot;

export async function observeAcceptanceRun(options: {
  expected: AcceptanceOwner;
  read: () => AcceptanceSnapshot;
  evaluate: (
    subject: AcceptanceOwner & AcceptanceApproval & { cwd: string | null },
    signal: AbortSignal,
  ) => Promise<{ approved: boolean; reason: string; targets: string[] }>;
  respond: (id: string, sessionId: string) => void;
  emit: (event: Record<string, unknown>) => void;
  sleep: () => Promise<void>;
  timeoutMs?: number;
}) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const seen = new Map<
    string,
    {
      approval: AcceptanceApproval;
      firstAt: number;
      sent: boolean;
      completed: boolean;
    }
  >();
  for (;;) {
    const snapshot = options.read();
    if (!sameOwner(snapshot, options.expected))
      throw new AcceptanceApprovalBlocked(
        "Acceptance session/run/workspace changed",
      );
    if (
      new Set(snapshot.approvals.map((a) => a.id)).size !==
        snapshot.approvals.length ||
      new Set(snapshot.approvals.map((a) => a.toolCallId)).size !==
        snapshot.approvals.length
    )
      throw new AcceptanceApprovalBlocked("Conflicting approval identities");
    for (const approval of snapshot.approvals) {
      const previous = seen.get(approval.id);
      if (previous && identity(previous.approval) !== identity(approval))
        throw new AcceptanceApprovalBlocked("Approval identity/input changed");
      if (previous?.completed)
        throw new AcceptanceApprovalBlocked(
          "Resolved approval reappeared; refusing replay",
        );
      if (!previous) {
        if (
          [...seen.values()].some(
            (r) => r.approval.toolCallId === approval.toolCallId,
          )
        )
          throw new AcceptanceApprovalBlocked(
            "Tool call reused under another approval identity",
          );
        if (seen.size >= 64)
          throw new AcceptanceApprovalBlocked(
            "Acceptance approval count exceeded bound",
          );
        seen.set(approval.id, {
          approval: structuredClone(approval),
          firstAt: Date.now(),
          sent: false,
          completed: false,
        });
        options.emit({
          kind: "approval-pending",
          at: Date.now(),
          ...options.expected,
          approval,
          cwd: snapshot.cwd,
        });
      }
    }
    for (const record of seen.values()) {
      if (record.completed) continue;
      const effect = snapshot.effects.find(
        (p) => p.toolCallId === record.approval.toolCallId,
      );
      if (
        record.sent &&
        effect &&
        ["output-available", "output-error", "output-denied"].includes(
          effect.state,
        )
      ) {
        record.completed = true;
        options.emit({
          kind: "approval-effect",
          at: Date.now(),
          ...options.expected,
          approvalId: record.approval.id,
          effect,
        });
        continue;
      }
      if (snapshot.state !== "running") continue;
      const remaining = timeoutMs - (Date.now() - record.firstAt);
      if (remaining <= 0)
        throw new AcceptanceApprovalBlocked(
          "Acceptance approval lifecycle timed out",
        );
      if (record.sent || !snapshot.responderReady) continue;
      if (!snapshot.approvals.some((a) => a.id === record.approval.id))
        throw new AcceptanceApprovalBlocked(
          "Approval disappeared before decision",
        );
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(
            new AcceptanceApprovalBlocked(
              "Acceptance approval evaluation timed out",
            ),
          );
        }, remaining);
      });
      let decision: Awaited<ReturnType<typeof options.evaluate>>;
      try {
        decision = await Promise.race([
          options.evaluate(
            { ...options.expected, ...record.approval, cwd: snapshot.cwd },
            controller.signal,
          ),
          expired,
        ]);
      } catch (error) {
        throw error instanceof AcceptanceApprovalBlocked
          ? error
          : new AcceptanceApprovalBlocked(
              `Approval evaluation failed: ${String(error)}`,
            );
      } finally {
        clearTimeout(timer);
      }
      options.emit({
        kind: "approval-evaluation",
        at: Date.now(),
        ...options.expected,
        approvalId: record.approval.id,
        ...decision,
      });
      if (!decision.approved)
        throw new AcceptanceApprovalBlocked(decision.reason);
      const latest = options.read();
      if (
        !sameOwner(latest, options.expected) ||
        latest.state !== "running" ||
        latest.cwd !== snapshot.cwd ||
        !latest.responderReady ||
        Date.now() - record.firstAt >= timeoutMs ||
        !latest.approvals.some((a) => identity(a) === identity(record.approval))
      )
        throw new AcceptanceApprovalBlocked(
          "Live approval changed during safety evaluation",
        );
      // Mark before invoking the production owner: a synchronous update cannot replay it.
      record.sent = true;
      options.respond(record.approval.id, options.expected.sessionId);
      options.emit({
        kind: "approval-submitted",
        at: Date.now(),
        ...options.expected,
        approvalId: record.approval.id,
        injectedMessages: 0,
      });
    }
    const awaiting =
      snapshot.approvals.length > 0 ||
      [...seen.values()].some((r) => !r.completed);
    if (snapshot.state !== "running") return;
    if (!awaiting && !snapshot.active) return;
    await options.sleep();
  }
}
