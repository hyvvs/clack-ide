import { describe, expect, it } from "vitest";
import {
  SESSION_PROFILE_SCHEMA_VERSION,
  createConversationProfile,
  migrateSessionProfiles,
  validateConversationProfileForRun,
  type SessionMeta,
} from "./sessions";

function legacySession(id = "legacy"): SessionMeta {
  return {
    id,
    title: "Existing conversation",
    createdAt: 1,
    updatedAt: 2,
  } as SessionMeta;
}

describe("conversation session profiles", () => {
  it("keeps same-named workspaces distinct by normalized root", () => {
    const first = createConversationProfile({
      agentId: "builtin:coder",
      modelId: "model-a",
      workspaceRoot: "C:\\Work\\one\\Clack\\",
      workspaceEnvironment: "local",
    });
    const second = createConversationProfile({
      agentId: "builtin:coder",
      modelId: "model-a",
      workspaceRoot: "C:\\Work\\two\\Clack",
      workspaceEnvironment: "local",
    });
    expect(first.workspaceId).not.toBe(second.workspaceId);
  });

  it("keeps Local and WSL workspace identities distinct", () => {
    const local = createConversationProfile({
      agentId: "builtin:coder",
      modelId: "model-a",
      workspaceRoot: "/work/clack",
      workspaceEnvironment: "local",
    });
    const wsl = createConversationProfile({
      agentId: "builtin:coder",
      modelId: "model-a",
      workspaceRoot: "/work/clack",
      workspaceEnvironment: "wsl:Arch",
    });
    expect(local.workspaceId).not.toBe(wsl.workspaceId);
  });

  it("migrates legacy chats without guessing a workspace", () => {
    const migrated = migrateSessionProfiles([legacySession()], {
      agentId: "builtin:reviewer",
      modelId: "saved-provider:model-a",
    });
    expect(migrated.changed).toBe(true);
    expect(migrated.sessions[0]).toMatchObject({
      profileVersion: SESSION_PROFILE_SCHEMA_VERSION,
      profile: {
        agentId: "builtin:reviewer",
        modelId: "saved-provider:model-a",
        workspaceId: null,
        workspaceRoot: null,
      },
    });
  });

  it("is idempotent and preserves an existing profile", () => {
    const profile = createConversationProfile({
      agentId: "builtin:coder",
      modelId: "model-a",
      workspaceRoot: "C:\\Work\\Clack",
      workspaceEnvironment: "local",
    });
    const session: SessionMeta = {
      ...legacySession("current"),
      profileVersion: SESSION_PROFILE_SCHEMA_VERSION,
      profile,
    };
    const migrated = migrateSessionProfiles([session], {
      agentId: "builtin:reviewer",
      modelId: "model-b",
    });
    expect(migrated.changed).toBe(false);
    expect(migrated.sessions).toEqual([session]);
  });

  it("requires an explicit workspace binding and rejects another root", () => {
    const unbound = createConversationProfile({
      agentId: "builtin:coder",
      modelId: "model-a",
      workspaceRoot: null,
    });
    expect(
      validateConversationProfileForRun(unbound, "C:\\Work\\Clack", "local"),
    ).toMatchObject({ ok: false });

    const bound = createConversationProfile({
      agentId: "builtin:coder",
      modelId: "model-a",
      workspaceRoot: "C:\\Work\\Clack",
      workspaceEnvironment: "local",
    });
    expect(
      validateConversationProfileForRun(bound, "c:\\work\\clack\\", "local"),
    ).toEqual({ ok: true });
    expect(
      validateConversationProfileForRun(bound, "C:\\Work\\Other", "local"),
    ).toMatchObject({ ok: false });
  });
});
