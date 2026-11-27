import type { BrowserRuntimeStatus } from "@/modules/ai/lib/browserRuntimeStatus";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StandaloneNativeAcceptance } from "./StandaloneNativeAcceptance";

const mock = vi.hoisted(() => ({
  activeSessionId: "s-owned-human-acceptance",
  sessions: [
    {
      id: "s-owned-human-acceptance",
      profile: {
        agentId: "builtin:coder",
        workspaceRoot: "C:/tf4-disposable-owned-workspace",
      },
    },
  ],
  index: 0,
  slots: [] as unknown[],
  effects: [] as (() => void)[],
  onOpenChange: null as ((open: boolean) => void) | null,
  onChanged: null as (() => void) | null,
  refresh: vi.fn(),
}));

// Deterministic SSR hook harness, matching the repository's DOM-free tests.
// Render and commit are separate so the first render after a scope change
// can be inspected before passive effect cleanup/setup.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const sameDeps = (a: readonly unknown[], b: readonly unknown[]) =>
    a.length === b.length &&
    a.every((value, index) => Object.is(value, b[index]));
  const memo = <T,>(factory: () => T, deps: readonly unknown[]) => {
    const index = mock.index++;
    const previous = mock.slots[index] as
      | { deps: readonly unknown[]; value: T }
      | undefined;
    if (previous && sameDeps(previous.deps, deps)) return previous.value;
    const value = factory();
    mock.slots[index] = { deps, value };
    return value;
  };
  return {
    ...actual,
    useState: <T,>(initial: T) => {
      const index = mock.index++;
      if (!(index in mock.slots)) mock.slots[index] = initial;
      return [
        mock.slots[index] as T,
        (next: T) => {
          mock.slots[index] = next;
        },
      ] as const;
    },
    useMemo: memo,
    useCallback: <T,>(fn: T, deps: readonly unknown[]) => memo(() => fn, deps),
    useEffect: (
      effect: Parameters<typeof actual.useEffect>[0],
      deps: readonly unknown[],
    ) => {
      const index = mock.index++;
      const previous = mock.slots[index] as
        | { deps: readonly unknown[]; cleanup?: () => void }
        | undefined;
      if (previous && sameDeps(previous.deps, deps)) return;
      mock.effects.push(() => {
        previous?.cleanup?.();
        const cleanup = effect();
        mock.slots[index] = { deps, cleanup };
      });
    },
  };
});

vi.mock("@/components/ui/popover", () => {
  const Pass = ({ children }: { children: ReactNode }) => <>{children}</>;
  return {
    Popover: ({
      children,
      onOpenChange,
    }: {
      children: ReactNode;
      onOpenChange: (open: boolean) => void;
    }) => {
      mock.onOpenChange = onOpenChange;
      return <>{children}</>;
    },
    PopoverTrigger: Pass,
    PopoverContent: Pass,
  };
});

vi.mock("@/modules/ai/store/chatStore", () => ({
  useChatStore: (select: (state: typeof mock) => unknown) => select(mock),
}));

vi.mock("@/modules/ai/lib/browserRuntimeStatus", () => ({
  refreshTfBrowserRuntimeStatus: mock.refresh,
}));

vi.mock("./NativeBrowserOperatorPanel", () => ({
  NativeBrowserOperatorPanel: ({
    sessions,
    onChanged,
  }: {
    sessions: BrowserRuntimeStatus["sessions"];
    onChanged: () => void;
  }) => {
    mock.onChanged = onChanged;
    return (
      <div>{sessions.map((session) => session.browserSessionId).join(",")}</div>
    );
  },
}));

const originalSessions = mock.sessions;
function render(commit = true) {
  mock.index = 0;
  mock.onChanged = null;
  const html = renderToStaticMarkup(<StandaloneNativeAcceptance />);
  if (commit) {
    for (const effect of mock.effects.splice(0)) effect();
  }
  return html;
}

function changeOpen(open: boolean) {
  if (!mock.onOpenChange) throw Error("missing popover callback");
  mock.onOpenChange(open);
}

function refreshCallback() {
  if (!mock.onChanged) throw Error("missing current operator refresh callback");
  return mock.onChanged;
}

function deferredStatus() {
  let resolve!: (status: BrowserRuntimeStatus) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<BrowserRuntimeStatus>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  mock.refresh.mockReturnValueOnce(promise);
  return { resolve, reject };
}

function status(id: string): BrowserRuntimeStatus {
  return {
    available: true,
    engine: "inert_native_text",
    reason: "native-checked",
    sessions: [
      {
        browserSessionId: id,
        currentUrl: null,
        snapshotId: null,
        historyLength: 0,
        expiresInSecs: 60,
        engine: "confined_webview2_read_only_unaccepted",
        isolation: "fixture",
      },
    ],
  };
}

async function openWithStatus() {
  const request = deferredStatus();
  render();
  changeOpen(true);
  render();
  request.resolve(status("old-session"));
  await Promise.resolve();
  expect(render()).toContain("old-session");
}

beforeEach(() => {
  mock.index = 0;
  mock.slots = [];
  mock.effects = [];
  mock.onOpenChange = null;
  mock.onChanged = null;
  mock.refresh.mockReset();
  mock.sessions = originalSessions;
  mock.activeSessionId = originalSessions[0].id;
});

describe("standalone TF4 human-only acceptance without model", () => {
  it("offers only a real saved chat-scoped tools entry without configuring an AI model", () => {
    const html = renderToStaticMarkup(<StandaloneNativeAcceptance />);
    expect(html).toContain("Tools for this chat");
    expect(html).toContain("No AI model configured");
    expect(html).toContain("Native browser testing is human-operated");
    expect(html).not.toContain("Approve once");
  });

  it("denies operator entry without a real owning workspace profile", () => {
    mock.sessions = [];
    try {
      expect(renderToStaticMarkup(<StandaloneNativeAcceptance />)).toBe("");
    } finally {
      mock.sessions = [
        {
          id: "s-owned-human-acceptance",
          profile: {
            agentId: "builtin:coder",
            workspaceRoot: "C:/tf4-disposable-owned-workspace",
          },
        },
      ];
    }
  });

  it.each([
    "actor",
    "chat",
    "workspace",
  ] as const)("never renders the previous scope's sessions on a %s transition, even before effects", async (dimension) => {
    await openWithStatus();
    const previous = originalSessions[0];
    const next = {
      id: dimension === "chat" ? "new-chat" : previous.id,
      profile: {
        agentId: dimension === "actor" ? "new-actor" : previous.profile.agentId,
        workspaceRoot:
          dimension === "workspace"
            ? "C:/new-root"
            : previous.profile.workspaceRoot,
      },
    };
    const oldRefresh = refreshCallback();
    const oldRequest = deferredStatus();
    oldRefresh();
    mock.sessions = [next];
    mock.activeSessionId = next.id;
    const newRequest = deferredStatus();
    expect(render(false)).not.toContain("old-session");
    for (const effect of mock.effects.splice(0)) effect();
    newRequest.resolve(status("new-session"));
    await Promise.resolve();
    expect(render()).toContain("new-session");
    oldRequest.resolve(status("late-old-session"));
    await Promise.resolve();
    expect(render()).toContain("new-session");
    expect(render()).not.toContain("late-old-session");
    const calls = mock.refresh.mock.calls.length;
    oldRefresh();
    expect(mock.refresh).toHaveBeenCalledTimes(calls);
  });

  it("ignores an older refresh failure after a newer response succeeds", async () => {
    await openWithStatus();
    const older = deferredStatus();
    const newer = deferredStatus();
    refreshCallback()();
    refreshCallback()();
    newer.resolve(status("newest-session"));
    await Promise.resolve();
    expect(render()).toContain("newest-session");
    older.reject(new Error("late failure"));
    await Promise.resolve();
    await Promise.resolve();
    expect(render()).toContain("newest-session");
  });

  it("ignores an older successful response after a newer response succeeds", async () => {
    await openWithStatus();
    const older = deferredStatus();
    const newer = deferredStatus();
    refreshCallback()();
    refreshCallback()();
    newer.resolve(status("newest-session"));
    await Promise.resolve();
    older.resolve(status("obsolete-session"));
    await Promise.resolve();
    expect(render()).toContain("newest-session");
    expect(render()).not.toContain("obsolete-session");
  });

  it("does not resurrect the prior open generation on close and reopen", async () => {
    await openWithStatus();
    const oldRefresh = refreshCallback();
    const oldRequest = deferredStatus();
    oldRefresh();
    changeOpen(false);
    expect(render()).not.toContain("old-session");
    const newRequest = deferredStatus();
    changeOpen(true);
    expect(render()).not.toContain("old-session");
    newRequest.resolve(status("reopened-session"));
    await Promise.resolve();
    oldRequest.resolve(status("closed-session"));
    await Promise.resolve();
    expect(render()).toContain("reopened-session");
    expect(render()).not.toContain("closed-session");
  });

  it("ignores a late initial request across a scope round trip", async () => {
    const firstRequest = deferredStatus();
    render();
    changeOpen(true);
    render();
    const secondRequest = deferredStatus();
    mock.sessions = [{ ...originalSessions[0], id: "intermediate-chat" }];
    mock.activeSessionId = "intermediate-chat";
    render();
    const thirdRequest = deferredStatus();
    mock.sessions = originalSessions;
    mock.activeSessionId = originalSessions[0].id;
    render();
    thirdRequest.resolve(status("current-session"));
    await Promise.resolve();
    secondRequest.resolve(status("intermediate-session"));
    firstRequest.resolve(status("first-session"));
    await Promise.resolve();
    expect(render()).toContain("current-session");
    expect(render()).not.toContain("first-session");
    expect(render()).not.toContain("intermediate-session");
  });
});
