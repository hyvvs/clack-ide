export type WorkspaceWriteLease = {
  workspaceId: string;
  ownerSessionId: string;
  ownerAgentId: string;
  acquiredAt: number;
};

export type WorkspaceWriteLeaseResult =
  | { ok: true; lease: WorkspaceWriteLease; waited: boolean }
  | { ok: false; code: "workspace_write_wait_cancelled"; message: string };

type Waiter = {
  sessionId: string;
  agentId: string;
  resolve: (result: WorkspaceWriteLeaseResult) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

const leases = new Map<string, WorkspaceWriteLease>();
const waiters = new Map<string, Waiter[]>();

export function currentWorkspaceWriteLease(
  workspaceId: string,
): WorkspaceWriteLease | null {
  return leases.get(workspaceId) ?? null;
}

export function acquireWorkspaceWriteLease(input: {
  workspaceId: string;
  sessionId: string;
  agentId: string;
  signal?: AbortSignal;
}): Promise<WorkspaceWriteLeaseResult> {
  const current = leases.get(input.workspaceId);
  if (!current || current.ownerSessionId === input.sessionId) {
    const lease =
      current ??
      {
        workspaceId: input.workspaceId,
        ownerSessionId: input.sessionId,
        ownerAgentId: input.agentId,
        acquiredAt: Date.now(),
      };
    leases.set(input.workspaceId, lease);
    return Promise.resolve({ ok: true, lease, waited: false });
  }
  if (input.signal?.aborted) {
    return Promise.resolve(cancelledResult());
  }
  return new Promise((resolve) => {
    const waiter: Waiter = {
      sessionId: input.sessionId,
      agentId: input.agentId,
      resolve,
      signal: input.signal,
    };
    if (input.signal) {
      waiter.onAbort = () => {
        removeWaiter(input.workspaceId, waiter);
        resolve(cancelledResult());
      };
      input.signal.addEventListener("abort", waiter.onAbort, { once: true });
    }
    const queue = waiters.get(input.workspaceId) ?? [];
    queue.push(waiter);
    waiters.set(input.workspaceId, queue);
  });
}

export function releaseWorkspaceWriteLeasesForSession(
  sessionId: string,
): void {
  for (const [workspaceId, lease] of leases) {
    if (lease.ownerSessionId !== sessionId) continue;
    leases.delete(workspaceId);
    grantNext(workspaceId);
  }
  for (const [workspaceId, queue] of waiters) {
    for (const waiter of [...queue]) {
      if (waiter.sessionId !== sessionId) continue;
      removeWaiter(workspaceId, waiter);
      waiter.resolve(cancelledResult());
    }
  }
}

export function clearWorkspaceWriteLeasesForTests(): void {
  for (const queue of waiters.values()) {
    for (const waiter of queue) waiter.resolve(cancelledResult());
  }
  waiters.clear();
  leases.clear();
}

function grantNext(workspaceId: string): void {
  const queue = waiters.get(workspaceId);
  while (queue && queue.length > 0) {
    const waiter = queue.shift();
    if (!waiter) break;
    detachAbort(waiter);
    if (waiter.signal?.aborted) {
      waiter.resolve(cancelledResult());
      continue;
    }
    const lease: WorkspaceWriteLease = {
      workspaceId,
      ownerSessionId: waiter.sessionId,
      ownerAgentId: waiter.agentId,
      acquiredAt: Date.now(),
    };
    leases.set(workspaceId, lease);
    waiter.resolve({ ok: true, lease, waited: true });
    break;
  }
  if (queue?.length === 0) waiters.delete(workspaceId);
}

function removeWaiter(workspaceId: string, waiter: Waiter): void {
  const queue = waiters.get(workspaceId);
  if (!queue) return;
  const index = queue.indexOf(waiter);
  if (index >= 0) queue.splice(index, 1);
  detachAbort(waiter);
  if (queue.length === 0) waiters.delete(workspaceId);
}

function detachAbort(waiter: Waiter): void {
  if (waiter.signal && waiter.onAbort) {
    waiter.signal.removeEventListener("abort", waiter.onAbort);
  }
}

function cancelledResult(): WorkspaceWriteLeaseResult {
  return {
    ok: false,
    code: "workspace_write_wait_cancelled",
    message: "The run stopped while waiting for the workspace write lease.",
  };
}
