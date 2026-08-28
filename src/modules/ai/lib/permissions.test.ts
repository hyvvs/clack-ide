import { usePreferencesStore } from "@/modules/settings/preferences";
import type { AgentWorkspacePermission } from "@/modules/settings/store";
import type { ToolContext } from "@/modules/ai/tools/context";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyAgentPermissionPolicy,
  clearAllChatPermissionsForTests,
  grantChatPermission,
  isStrictPermissionRequest,
  requiresToolApproval,
  resolveAgentPermission,
  workspacePermissionKey,
  type AgentPermissionProfile,
  type AgentPermissionProfiles,
} from "@/modules/ai/lib/permissions";

function context(
  sessionId = "chat-a",
  root = "/work/a",
  agentId = "builtin:coder",
): ToolContext {
  return {
    getCwd: () => root,
    getWorkspaceRoot: () => root,
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
});
