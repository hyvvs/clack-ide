import { usePreferencesStore } from "@/modules/settings/preferences";
import type { AgentWorkspacePermission } from "@/modules/settings/store";
import type { ToolContext } from "@/modules/ai/tools/context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyAgentPermissionPolicy,
  clearAllChatPermissionsForTests,
  grantChatPermission,
  isStrictPermissionRequest,
  requiresWorkspaceWriteLease,
  requiresToolApproval,
  resolveAgentPermission,
  workspacePermissionKey,
  type AgentPermissionProfile,
  type AgentPermissionProfiles,
} from "@/modules/ai/lib/permissions";
import {
  acquireWorkspaceWriteLease,
  clearWorkspaceWriteLeasesForTests,
  releaseWorkspaceWriteLeasesForSession,
} from "@/modules/ai/lib/workspaceWriteLease";

function context(
  sessionId = "chat-a",
  root = "/work/a",
  agentId = "builtin:coder",
): ToolContext {
  return {
    getCwd: () => root,
    getWorkspaceRoot: () => root,
    getWorkspaceId: () => `local:${root}`,
    getTerminalContext: () => null,
    isActiveTerminalPrivate: () => false,
    injectIntoActivePty: () => false,
    openPreview: () => false,
    spawnAgent: () => null,
    readAgentOutput: () => null,
    readCache: new Map(),
    getSessionId: () => sessionId,
    getAgentId: () => agentId,
  };
}

function profile(mode: AgentPermissionProfile["mode"]): AgentPermissionProfile {
  return { mode, categories: {} };
}

function decision(
  mode: AgentPermissionProfile["mode"],
  toolName: string,
  toolInput: Record<string, unknown>,
  ctx = context(),
  rules: AgentWorkspacePermission[] = [],
) {
  return resolveAgentPermission({
    agentId: ctx.getAgentId(),
    sessionId: ctx.getSessionId(),
    toolName,
    toolInput,
    context: ctx,
    profile: profile(mode),
    workspaceRules: rules,
  });
}

describe("agent permission resolver", () => {
  beforeEach(() => {
    clearAllChatPermissionsForTests();
    usePreferencesStore.setState({
      agentPermissionProfiles: {},
      agentWorkspacePermissions: [],
    });
  });

  it("blocks all tool invocation in Chat Only", () => {
    expect(decision("chat-only", "read_file", { path: "README.md" })).toMatchObject({
      outcome: "deny",
      source: "chat-only",
    });
    expect(decision("chat-only", "todo_write", { todos: [] }).outcome).toBe(
      "deny",
    );
  });

  it("uses the existing approval policy in Ask mode", () => {
    expect(decision("ask", "read_file", { path: "README.md" }).outcome).toBe(
      "allow",
    );
    expect(decision("ask", "write_file", { path: "src/a.ts" }).outcome).toBe(
      "prompt",
    );
  });

  afterEach(() => {
    clearWorkspaceWriteLeasesForTests();
  });

  it("treats another billed agent run as an explicit permission category", () => {
    const input = { targetSessionId: "chat-b", kind: "review" };
    expect(decision("chat-only", "request_peer_task", input).outcome).toBe(
      "deny",
    );
    expect(decision("ask", "request_peer_task", input).outcome).toBe(
      "prompt",
    );
    expect(
      decision("trusted-workspace", "request_peer_task", input).outcome,
    ).toBe("allow");
    expect(decision("full-access", "request_peer_task", input).outcome).toBe(
      "allow",
    );
  });

  it("treats Allow once as one response without creating a grant", () => {
    expect(
      requiresToolApproval(
        "write_file",
        { path: "/work/a/file.ts" },
        context(),
        [],
      ),
    ).toBe(true);
    expect(
      requiresToolApproval(
        "write_file",
        { path: "/work/a/file.ts" },
        context(),
        [],
      ),
    ).toBe(true);
  });

  it("keeps chat grants in one chat and one agent", () => {
    grantChatPermission("chat-a", "builtin:coder", "write-files");
    const profiles: AgentPermissionProfiles = {
      "builtin:coder": profile("ask"),
      "builtin:reviewer": profile("ask"),
    };
    const input = { path: "/work/a/file.ts" };
    expect(
      requiresToolApproval("write_file", input, context(), [], profiles),
    ).toBe(false);
    expect(
      requiresToolApproval(
        "write_file",
        input,
        context("chat-b"),
        [],
        profiles,
      ),
    ).toBe(true);
    expect(
      requiresToolApproval(
        "write_file",
        input,
        context("chat-a", "/work/a", "builtin:reviewer"),
        [],
        profiles,
      ),
    ).toBe(true);
  });

  it("keeps workspace grants in one workspace and one agent", () => {
    const rules: AgentWorkspacePermission[] = [
      {
        agentId: "builtin:coder",
        workspaceKey: workspacePermissionKey("/work/a"),
        category: "write-files",
        createdAt: 1,
      },
    ];
    expect(
      decision("ask", "write_file", { path: "/work/a/file.ts" }, context(), rules)
        .outcome,
    ).toBe("allow");
    expect(
      decision(
        "ask",
        "write_file",
        { path: "/work/b/file.ts" },
        context("chat-a", "/work/b"),
        rules,
      ).outcome,
    ).toBe("prompt");
    expect(
      decision(
        "ask",
        "write_file",
        { path: "/work/a/file.ts" },
        context("chat-a", "/work/a", "builtin:reviewer"),
        rules,
      ).outcome,
    ).toBe("prompt");
  });

  it("allows grantable workspace actions in Trusted Workspace", () => {
    expect(
      decision("trusted-workspace", "write_file", { path: "src/a.ts" }).outcome,
    ).toBe("allow");
    expect(
      decision("trusted-workspace", "write_file", { path: "/other/a.ts" })
        .outcome,
    ).toBe("prompt");
  });

  it("keeps strict actions on the approval path outside Full Access", () => {
    const input = { command: "git reset --hard HEAD~1" };
    expect(isStrictPermissionRequest("bash_run", input)).toBe(true);
    expect(decision("trusted-workspace", "bash_run", input).outcome).toBe(
      "prompt",
    );
    expect(decision("full-access", "bash_run", input).outcome).toBe("allow");
  });

  it("respects the existing category matrix in Custom mode", () => {
    const ctx = context();
    const custom: AgentPermissionProfile = {
      mode: "custom",
      categories: { "write-files": true, "run-commands": false },
    };
    const resolve = (toolName: string, toolInput: Record<string, unknown>) =>
      resolveAgentPermission({
        agentId: ctx.getAgentId(),
        sessionId: ctx.getSessionId(),
        toolName,
        toolInput,
        context: ctx,
        profile: custom,
        workspaceRules: [],
      }).outcome;
    expect(resolve("write_file", { path: "src/a.ts" })).toBe("allow");
    expect(resolve("bash_run", { command: "npm test" })).toBe("prompt");
  });

  it("uses stable agent identity independently of model selection", () => {
    const profiles: AgentPermissionProfiles = {
      "builtin:coder": profile("full-access"),
      "builtin:reviewer": profile("chat-only"),
    };
    expect(profiles["builtin:coder"].mode).toBe("full-access");
    expect(profiles["builtin:reviewer"].mode).toBe("chat-only");
    expect(Object.keys(profiles)).not.toContain("openrouter-custom");
  });

  it("blocks before execution in Chat Only", async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    usePreferencesStore.setState({
      agentPermissionProfiles: {
        "builtin:coder": profile("chat-only"),
      },
    });
    const tools = applyAgentPermissionPolicy(
      { read_file: { execute } },
      context(),
    );
    await expect(tools.read_file.execute()).resolves.toMatchObject({
      code: "agent_permission_denied",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not hide application capability failures in Full Access", async () => {
    const execute = vi.fn(async () => ({ error: "os permission denied" }));
    usePreferencesStore.setState({
      agentPermissionProfiles: {
        "builtin:coder": profile("full-access"),
      },
    });
    const tools = applyAgentPermissionPolicy(
      { write_file: { execute } },
      context(),
    );
    await expect(tools.write_file.execute()).resolves.toEqual({
      error: "os permission denied",
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("classifies filesystem and shell mutations for shared-checkout leases", () => {
    expect(requiresWorkspaceWriteLease("write_file")).toBe(true);
    expect(requiresWorkspaceWriteLease("edit")).toBe(true);
    expect(requiresWorkspaceWriteLease("multi_edit")).toBe(true);
    expect(requiresWorkspaceWriteLease("create_directory")).toBe(true);
    expect(requiresWorkspaceWriteLease("bash_run")).toBe(true);
    expect(requiresWorkspaceWriteLease("bash_background")).toBe(true);
    expect(requiresWorkspaceWriteLease("read_file")).toBe(false);
    expect(requiresWorkspaceWriteLease("grep_search")).toBe(false);
    expect(requiresWorkspaceWriteLease("request_peer_task")).toBe(false);
  });

  it("serializes mutating tools from different sessions in one workspace", async () => {
    usePreferencesStore.setState({
      agentPermissionProfiles: {
        "builtin:coder": profile("full-access"),
      },
    });
    let finishFirst: (() => void) | undefined;
    const executeFirst = vi.fn(
      (_input: unknown, _options: unknown) =>
        new Promise<{ ok: true }>((resolve) => {
          finishFirst = () => resolve({ ok: true });
        }),
    );
    const executeSecond = vi.fn(async (_input: unknown, _options: unknown) => ({
      ok: true,
    }));
    const firstContext = context("chat-a");
    const secondContext = context("chat-b");
    const onWait = vi.fn();
    const onAcquired = vi.fn();
    secondContext.onWorkspaceWriteWait = onWait;
    secondContext.onWorkspaceWriteAcquired = onAcquired;
    const firstTools = applyAgentPermissionPolicy(
      { write_file: { execute: executeFirst } },
      firstContext,
    );
    const secondTools = applyAgentPermissionPolicy(
      { write_file: { execute: executeSecond } },
      secondContext,
    );

    const first = firstTools.write_file.execute({}, {});
    await vi.waitFor(() => expect(executeFirst).toHaveBeenCalledOnce());
    const second = secondTools.write_file.execute({}, {});
    await Promise.resolve();
    expect(executeSecond).not.toHaveBeenCalled();
    expect(onWait).toHaveBeenCalledWith({
      sessionId: "chat-a",
      agentId: "builtin:coder",
    });

    finishFirst?.();
    await first;
    releaseWorkspaceWriteLeasesForSession("chat-a");
    await expect(second).resolves.toEqual({ ok: true });
    expect(executeSecond).toHaveBeenCalledOnce();
    expect(onAcquired).toHaveBeenCalledWith(true);
  });

  it("allows read-only tools while another session owns the write lease", async () => {
    usePreferencesStore.setState({
      agentPermissionProfiles: {
        "builtin:coder": profile("full-access"),
      },
    });
    await acquireWorkspaceWriteLease({
      workspaceId: "local:/work/a",
      sessionId: "chat-a",
      agentId: "builtin:coder",
    });
    const execute = vi.fn(async (_input: unknown, _options: unknown) => ({
      content: "visible",
    }));
    const tools = applyAgentPermissionPolicy(
      { read_file: { execute } },
      context("chat-b"),
    );

    await expect(tools.read_file.execute({}, {})).resolves.toEqual({
      content: "visible",
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("blocks mutation tools in an explicitly read-only peer run", async () => {
    usePreferencesStore.setState({
      agentPermissionProfiles: {
        "builtin:coder": profile("full-access"),
      },
    });
    const ctx = context("chat-b");
    ctx.getMutationMode = () => "read-only";
    const execute = vi.fn(async (_input: unknown, _options: unknown) => ({
      ok: true,
    }));
    const tools = applyAgentPermissionPolicy(
      { write_file: { execute } },
      ctx,
    );

    await expect(tools.write_file.execute({}, {})).resolves.toMatchObject({
      code: "peer_task_read_only",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("blocks isolated file mutations outside the captured worktree", async () => {
    usePreferencesStore.setState({
      agentPermissionProfiles: {
        "builtin:coder": profile("full-access"),
      },
    });
    const ctx = context("chat-b", "/cache/worktree-a");
    ctx.getMutationMode = () => "isolated-worktree";
    const execute = vi.fn(async (_input: unknown, _options: unknown) => ({
      ok: true,
    }));
    const tools = applyAgentPermissionPolicy(
      { write_file: { execute } },
      ctx,
    );

    await expect(
      tools.write_file.execute({ path: "/work/main/file.ts" }, {}),
    ).resolves.toMatchObject({ code: "isolated_worktree_escape_blocked" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("cancels a mutating tool that is waiting for another session", async () => {
    usePreferencesStore.setState({
      agentPermissionProfiles: {
        "builtin:coder": profile("full-access"),
      },
    });
    await acquireWorkspaceWriteLease({
      workspaceId: "local:/work/a",
      sessionId: "chat-a",
      agentId: "builtin:coder",
    });
    const execute = vi.fn(async (_input: unknown, _options: unknown) => ({
      ok: true,
    }));
    const tools = applyAgentPermissionPolicy(
      { write_file: { execute } },
      context("chat-b"),
    );
    const controller = new AbortController();

    const waiting = tools.write_file.execute(
      {},
      { abortSignal: controller.signal },
    );
    controller.abort();

    await expect(waiting).resolves.toMatchObject({
      code: "workspace_write_wait_cancelled",
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
