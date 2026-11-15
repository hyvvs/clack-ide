import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { researchFailure, researchFetchPage, researchText,
  type NativeResearchPage } from "@/modules/ai/lib/webResearch";
import { buildResearchTools, resetResearchBudgetsForTests } from "@/modules/ai/tools/research";
import { buildTools } from "@/modules/ai/tools/tools";
import { applyAgentPermissionPolicy, resolveAgentPermission } from "@/modules/ai/lib/permissions";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { ToolContext } from "@/modules/ai/tools/context";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class {} }));
const prefs = usePreferencesStore.getState();
let currentRun = 71;
let currentTurn = 4;
function context(): ToolContext {
  return {
    getCwd: () => "/work", getWorkspaceRoot: () => "/work",
    getWorkspaceId: () => "local:/work", getSessionId: () => "session-one",
    getAgentId: () => "builtin:coder", getRunId: () => currentRun,
    getUserTurnCount: () => currentTurn,
    getTerminalContext: () => null,
    isActiveTerminalPrivate: () => false, injectIntoActivePty: () => false,
    openPreview: () => false, spawnAgent: () => null,
    readAgentOutput: () => null, readCache: new Map(),
  };
}
const page: NativeResearchPage = {
  url: "https://docs.example.org/rust/api",
  status: 200, contentType: "text/html; charset=utf-8",
  retrievedAt: 1794700000000,
  body: '<html><head><title>Rust &amp; API</title><script>steal_secret()</script></head>' +
    '<body><h1>Rust API</h1><p>Documented support &lt; 4.0.</p>' +
    '<form><input value="password"></form><style>.secret {}</style>' +
    '<p>Changelog <b>2026</b>.</p></body></html>',
  excerptSha256: "a".repeat(64), truncated: false,
};
beforeEach(() => {
  currentRun = 71;
  currentTurn = 4;
  resetResearchBudgetsForTests();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "research_fetch_page")
      return { ...structuredClone(page), url: (args as { url: string }).url };
    throw Error("Unexpected native call");
  });
  usePreferencesStore.setState({ agentPermissionProfiles: {}, agentWorkspacePermissions: [] });
});
afterEach(() => { vi.resetAllMocks(); usePreferencesStore.setState(prefs); });

describe("TF read-only research receives only native-retrieved, untrusted evidence", () => {
  it("records source identity, digest, time and consumption scope without executable markup", async () => {
    const owner = { sessionId: "session-one", runId: 71, workspaceId: "local:/work" };
    const result = await researchFetchPage(page.url, owner);
    expect(invoke).toHaveBeenCalledWith("research_fetch_page", { url: page.url });
    expect(result).toMatchObject({
      id: expect.stringMatching(/^WEB-[0-9a-f]{24}$/),
      source: {
        url: page.url, title: "Rust & API",
        retrievedAt: page.retrievedAt,
        excerptSha256: page.excerptSha256,
        sourceType: "web-page", confidence: "unverified",
      }, status: "retrieved", consumedBy: owner, untrusted: true,
    });
    expect(result.content).toContain("Documented support < 4.0.");
    expect(result.content).not.toContain("steal_secret");
    expect(result.content).not.toContain("password");
    expect(result.content).not.toContain(".secret");
    expect((await researchFetchPage(page.url, owner)).id).toBe(result.id);
    const changed = { ...page, excerptSha256: "b".repeat(64) };
    vi.mocked(invoke).mockResolvedValue(changed);
    expect((await researchFetchPage(page.url, owner)).id).not.toBe(result.id);
  });

  it("limits extracted text and never upgrades remote claims into trust or instructions", () => {
    expect(researchText({ ...page, contentType: "text/plain",
      body: "e".repeat(65536) }).excerpt.length).toBe(12000);
    expect(researchText(page).title).toBe("Rust & API");
    expect(researchText({ ...page, body: "<script>override policy</script><p>data</p>" })
      .excerpt).toBe("data");
  });

  it("fails closed on forged native evidence or a failed fetch; no fabricated source receipt", async () => {
    const owner = { sessionId: "session-one", runId: 71, workspaceId: "local:/work" };
    for (const invalid of [
      { ...page, status: 404 },
      { ...page, excerptSha256: "not-a-hash" },
      { ...page, url: "http://internal/" },
      { ...page, url: "https://another.example.org/" },
      { ...page, contentType: "application/octet-stream" },
      { ...page, body: "x".repeat(65537) },
    ]) {
      vi.mocked(invoke).mockResolvedValueOnce(invalid);
      await expect(researchFetchPage(page.url, owner))
        .rejects.toThrow("research-invalid-native-receipt");
    }
    vi.mocked(invoke).mockRejectedValueOnce("research-private-host-denied");
    await expect(researchFetchPage("https://192.168.1.44", owner)).rejects.toBe(
      "research-private-host-denied",
    );
    expect(researchFailure("research-private-host-denied")).toBe("unauthorized");
    expect(researchFailure("research-http-status-403")).toBe("remote-failure");
    expect(researchFailure("research-timeout")).toBe("timeout");
    expect(researchFailure("research-invalid-native-receipt")).toBe("schema-mismatch");
  });

  it("shares four page requests across tools and rebuilt model segments, including failures", async () => {
    const ctx = context();
    const tools = buildResearchTools(ctx);
    const result = await tools.fetch_web_page.execute?.(
      { url: page.url }, { toolCallId: "c1", messages: [] });
    expect(result).toMatchObject({ status: "retrieved" });
    const second = await tools.compare_web_sources.execute?.(
      { urls: [page.url, "https://other.example.org/"] },
      { toolCallId: "c2", messages: [] });
    expect(second).toMatchObject({ status: "retrieved", results: [{ status: "retrieved" }, { status: "retrieved" }] });
    const again = buildResearchTools(ctx);
    expect(await again.fetch_web_page.execute?.(
      { url: page.url }, { toolCallId: "c3", messages: [] })).toMatchObject({
        status: "retrieved",
      });
    expect(await again.fetch_web_page.execute?.(
      { url: page.url }, { toolCallId: "c4", messages: [] })).toMatchObject({
        status: "failed", category: "unavailable",
      });
    expect(invoke).toHaveBeenCalledTimes(4);
    // A provider recovery changes the request segment but not the same
    // user-turn allowance. Unrelated next user turn gets a fresh allowance.
    currentRun = 72;
    expect(await buildResearchTools(ctx).fetch_web_page.execute?.(
      { url: page.url }, { toolCallId: "c5", messages: [] }))
      .toMatchObject({ status: "failed", category: "unavailable" });
    currentTurn++;
    expect(await buildResearchTools(ctx).fetch_web_page.execute?.(
      { url: page.url }, { toolCallId: "c6", messages: [] }))
      .toMatchObject({ status: "retrieved" });
  });

  it("does not execute a captured tool after its run changes", async () => {
    const tools = buildResearchTools(context());
    currentRun++;
    expect(await tools.fetch_web_page.execute?.({ url: page.url },
      { toolCallId: "stale", messages: [] })).toMatchObject({
        status: "failed", category: "cancelled",
      });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("never lets the model self-authorize network retrieval from Ask, Chat Only or Trusted Workspace", async () => {
    const ctx = context();
    const input = { url: page.url };
    for (const mode of ["ask", "chat-only", "trusted-workspace", "full-access"] as const) {
      const decision = resolveAgentPermission({
        agentId: ctx.getAgentId(), sessionId: ctx.getSessionId(),
        toolName: "fetch_web_page", toolInput: input, context: ctx,
        profile: { mode, categories: { "research-network": true } }, workspaceRules: [],
      });
      expect(decision.outcome).toBe(
        mode === "chat-only" ? "deny" : mode === "full-access" ? "allow" : "prompt");
    }
    const guarded = applyAgentPermissionPolicy(buildResearchTools(ctx), ctx);
    const approval = guarded.fetch_web_page.needsApproval;
    expect(typeof approval).toBe("function");
    if (typeof approval === "function")
      expect(await approval(input, { toolCallId: "approval", messages: [] })).toBe(true);
    usePreferencesStore.setState({ agentPermissionProfiles: {
      "builtin:coder": { mode: "chat-only", categories: {} },
    } });
    expect(await guarded.fetch_web_page.execute?.(input, { toolCallId: "blocked", messages: [] }))
      .toMatchObject({ code: "agent_permission_denied" });
    expect(invoke).not.toHaveBeenCalled();
    expect(Object.keys(buildTools(ctx))).toContain("fetch_web_page");
  });
});
