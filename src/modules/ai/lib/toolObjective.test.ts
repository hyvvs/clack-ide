import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonSchema, tool, type ToolSet, type UIMessage } from "ai";
import {
  resolveToolObjective,
  operationCapabilities,
} from "@/modules/ai/lib/toolObjective";
import {
  clearExposureCache,
  identifyTool,
  prepareToolExposure,
  selectToolSchemas,
} from "@/modules/ai/lib/toolExposure";
import { serializedToolSchemas } from "@/modules/ai/lib/requestPreflight";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useTodosStore } from "@/modules/ai/store/todoStore";
import type { ToolContext } from "@/modules/ai/tools/context";
import type { Todo } from "@/modules/ai/lib/todos";
import { resolveCurrentAgentPermission } from "@/modules/ai/lib/permissions";
import captured from "@/modules/ai/lib/toolObjective.fixture.json";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class {} }));
const preferences = usePreferencesStore.getState();
afterEach(() => {
  usePreferencesStore.setState(preferences);
  useTodosStore.setState({ bySession: {} });
  clearExposureCache();
});
const user = (text: string): UIMessage => ({
  id: text.slice(0, 20),
  role: "user",
  parts: [{ type: "text", text }],
});
const call = (
  name: string,
  input: unknown = {},
  state = "output-available",
): UIMessage =>
  ({
    id: name,
    role: "assistant",
    parts: [
      {
        type: `tool-${name}`,
        toolCallId: name,
        state,
        input,
        output: { ok: true },
      },
    ],
  }) as UIMessage;
const plan: Todo[] = [
  {
    id: "1",
    title: "Implement application source and tests",
    description: "Page size 50",
    status: "pending",
  },
];
const correction =
  "Change the task page size requirement from 50 to 25. The new value supersedes 50 everywhere. Continue the same project and do not restart from scratch.";
const coding = [
  user("Build a multi-file application, test and finish it."),
  call("todo_write", { todos: plan }),
  call("write_file"),
  call("bash_run"),
];
const names = [
  "read_file",
  "list_directory",
  "write_file",
  "edit",
  "multi_edit",
  "bash_run",
  "todo_write",
  "request_peer_task",
  "communicate_peer_task",
  "cancel_peer_task",
  "custom_weather",
];
function tools(): ToolSet {
  return Object.fromEntries(
    names.map((name) => [
      name,
      tool({
        description: name.replace(/_/g, " "),
        inputSchema: jsonSchema({ type: "object", properties: {} }),
      }),
    ]),
  );
}
const ctx: ToolContext = {
  getCwd: () => "/work",
  getWorkspaceRoot: () => "/work",
  getWorkspaceId: () => "local:/work",
  getSessionId: () => "objective",
  getAgentId: () => "coder",
  getTerminalContext: () => null,
  isActiveTerminalPrivate: () => false,
  injectIntoActivePty: () => false,
  openPreview: () => false,
  spawnAgent: () => null,
  readAgentOutput: () => null,
  readCache: new Map(),
};
async function select(
  history: UIMessage[],
  candidates = tools(),
  pressure = false,
) {
  return prepareToolExposure(candidates, {
    context: ctx,
    uiMessages: history,
    target: "any-provider",
    messages: [
      { role: "user", content: pressure ? "history ".repeat(8000) : "latest" },
    ],
    limits: { reported: pressure ? 4096 : 32768, outputReserve: 2048 },
  });
}
function coverage(selected: string[]) {
  const capabilities = new Set(
    selected.flatMap((n) => [...operationCapabilities(n)]),
  );
  for (const capability of ["read", "create", "modify", "command"])
    expect(capabilities.has(capability as "read")).toBe(true);
}

describe("objective continuity and capability coverage", () => {
  it("repairs the captured inference-17 correction without changing its accepted plan or source", () => {
    const messages = captured.messages as UIMessage[];
    const source = JSON.stringify(messages);
    const objective = resolveToolObjective(messages);
    const result = selectToolSchemas({
      schemas: captured.schemas as unknown as Awaited<
        ReturnType<typeof serializedToolSchemas>
      >,
      query: correction,
      objective,
      messages: "history ".repeat(8000),
      limits: { deployed: 32768, maxOutput: 2048, outputReserve: 2048 },
    });
    expect(captured.oldNames).toEqual([
      "cancel_peer_task",
      "communicate_peer_task",
      "request_peer_task",
    ]);
    coverage(result.names);
    expect(objective.query).toContain("Build ForgeBoard");
    expect(objective.query).toContain(correction);
    expect(
      resolveToolObjective([
        ...coding,
        user(correction),
        ...Array.from({ length: 24 }, () => user("Continue the same project.")),
      ]).query,
    ).toContain(correction);
    expect(result.names.length).toBeLessThan(captured.schemas.length);
    expect(JSON.stringify(messages)).toBe(source);
  });
  it.each([
    ["baseline", [coding[0]]],
    ["narrow correction", [...coding, user(correction)]],
    [
      "correction and continuation",
      [...coding, user(correction), user("Continue.")],
    ],
    [
      "failed edit",
      [...coding, call("edit", {}, "output-error"), user(correction)],
    ],
    [
      "peer-heavy direct implementation",
      [...coding, call("request_peer_task"), user(correction)],
    ],
  ])("retains coverage for %s", async (_, history) => {
    coverage((await select(history)).names);
  });
  it("retains the original objective and the superseding correction without rewriting the plan", () => {
    const snapshot = JSON.stringify(coding);
    const objective = resolveToolObjective([...coding, user(correction)]);
    expect(objective.kind).toBe("implementation");
    expect(objective.query).toContain("Build a multi-file application");
    expect(objective.query).toContain(correction);
    expect(JSON.stringify(coding)).toBe(snapshot);
  });
  it("uses the durable accepted plan with a compacted request and no original prompt hot", async () => {
    useTodosStore.setState({ bySession: { objective: plan } });
    coverage((await select([user("Continue.")])).names);
  });
  it("keeps original transcript evidence when request history has been compacted", async () => {
    const result = await select([...coding, user(correction)], tools(), true);
    coverage(result.names);
    expect(result.budget.fits).toBe(false);
  });
  it("keeps only one equivalent writer under tight schema pressure", async () => {
    const candidates = tools();
    const result = await select(
      [...coding, user(correction)],
      candidates,
      true,
    );
    coverage(result.names);
    expect(
      result.names.filter((n) =>
        ["write_file", "edit", "multi_edit"].includes(n),
      ),
    ).toEqual(["write_file"]);
    expect(result.names).not.toContain("custom_weather");
  });
  it("supports one writer and reports absent coverage without inventing forbidden tools", async () => {
    const candidates = tools();
    delete candidates.edit;
    delete candidates.multi_edit;
    coverage((await select([...coding, user(correction)], candidates)).names);
    delete candidates.write_file;
    const missing = await select([...coding, user(correction)], candidates);
    expect(missing.names).not.toContain("write_file");
    expect(missing.objective?.required).toContain("create");
  });
  it("selects an eligible native-operation equivalent without trusting external capability claims", async () => {
    const candidates = tools();
    delete candidates.write_file;
    candidates.custom_writer = tool({
      description: "Approved operation",
      inputSchema: jsonSchema({ type: "object", properties: {} }),
    });
    identifyTool(candidates.custom_writer, {
      definition: { binding: { kind: "native", operation: "write_file" } },
    });
    const selected = await select(
      [...coding, user(correction)],
      candidates,
      true,
    );
    expect(selected.names).toContain("custom_writer");
    identifyTool(candidates.custom_writer, {
      definition: { binding: { kind: "mcp" }, permissions: ["write-files"] },
    });
    expect(
      (await select([...coding, user(correction)], candidates, true)).names,
    ).not.toContain("custom_writer");
  });
  it("fully delegated work can remain peer-only without granting primary mutation", async () => {
    const history = [
      user(
        "Delegate the entire application to another agent; wait for its result.",
      ),
      call("todo_write", { todos: plan }),
      call("request_peer_task"),
      user("Continue."),
    ];
    const selected = await select(history);
    expect(selected.objective?.kind).toBe("delegated");
    expect(selected.names).toContain("request_peer_task");
    expect(selected.names).not.toContain("write_file");
    expect(selected.names).not.toContain("bash_run");
  });
  it("a peer call alone does not discharge pending primary implementation", async () => {
    coverage(
      (
        await select([
          coding[0],
          coding[1],
          call("request_peer_task"),
          user(correction),
        ])
      ).names,
    );
  });
  it("a new handoff does not inherit prior direct implementation obligations", () => {
    const handoff = `<peer-handoff>\n${JSON.stringify({ version: 1, taskId: "new", objectiveAndRequirements: "Research architecture only" })}\n</peer-handoff>`;
    expect(resolveToolObjective([...coding, user(handoff)]).kind).toBe(
      "read-only",
    );
  });
  it("completed old plan cannot return after a new objective and continuation", () => {
    const history = [
      ...coding,
      call("todo_write", {
        todos: plan.map((t) => ({ ...t, status: "completed" })),
      }),
      user("Research architecture only"),
      user("Continue."),
    ];
    expect(resolveToolObjective(history).query).not.toContain("multi-file");
    expect(resolveToolObjective(history).kind).toBe("read-only");
  });
  it("malformed or failed plan updates cannot replace accepted obligations", () => {
    const history = [
      ...coding,
      call("todo_write", { todos: [null] }),
      call("todo_write", { todos: [] }, "output-error"),
      user(correction),
    ];
    expect(resolveToolObjective(history).query).toContain(plan[0].title);
    expect(resolveToolObjective(history).kind).toBe("implementation");
  });
  it.each([
    "Research software architecture only",
    "Hello!",
  ])("does not grant coding coverage for %s", async (text) => {
    const selected = await select([user(text)]);
    expect(selected.names).not.toContain("write_file");
    expect(selected.names).not.toContain("bash_run");
  });
  it("unknown intent uses a safe general read core, not peer-only or mutation fallback", async () => {
    const result = await select([user("Zyzzyva")]);
    expect(result.names).toEqual(["list_directory", "read_file"]);
  });
  it("research about building software does not acquire directory creation or background execution", async () => {
    const candidates = tools();
    for (const name of ["create_directory", "bash_background"])
      candidates[name] = tool({
        description: "Build software with shell commands and directories",
        inputSchema: jsonSchema({ type: "object", properties: {} }),
      });
    const result = await select(
      [
        user(
          "Research how to build an application and create directories using shell commands only.",
        ),
      ],
      candidates,
    );
    expect(result.objective?.kind).toBe("read-only");
    for (const name of [
      "write_file",
      "edit",
      "bash_run",
      "create_directory",
      "bash_background",
    ])
      expect(result.names).not.toContain(name);
  });
  it("completed plan followed by a new chat task releases old implementation coverage", async () => {
    const result = await select([
      ...coding,
      call("todo_write", {
        todos: plan.map((t) => ({ ...t, status: "completed" })),
      }),
      user("Hello!"),
    ]);
    expect(result.objective?.kind).not.toBe("implementation");
    expect(result.names).toEqual([]);
  });
  it.each([
    "ask",
    "trusted-workspace",
    "full-access",
    "custom",
    "chat-only",
  ] as const)("obeys %s permission policy", async (mode) => {
    usePreferencesStore.setState({
      agentPermissionProfiles: {
        coder: { mode, categories: { "write-files": false } },
      },
    });
    const selected = await select([...coding, user(correction)]);
    if (mode === "chat-only") expect(selected.names).toEqual([]);
    else coverage(selected.names);
    // Custom false retains existing approval semantics: it is not an execution grant.
    if (mode === "custom") {
      expect(selected.tools.write_file).toBeDefined();
      expect(
        resolveCurrentAgentPermission(
          "write_file",
          { path: "/work/index.ts" },
          ctx,
        ).outcome,
      ).toBe("prompt");
    }
  });
  it("never recreates an executor excluded by assignment or read-only workspace policy", async () => {
    const candidates = tools();
    delete candidates.write_file;
    expect(
      (await select([...coding, user(correction)], candidates)).names,
    ).not.toContain("write_file");
    const result = await prepareToolExposure(tools(), {
      context: { ...ctx, getMutationMode: () => "read-only" },
      uiMessages: [...coding, user(correction)],
      messages: [],
      target: "model",
    });
    expect(result.names).not.toContain("write_file");
    expect(result.names).not.toContain("bash_run");
  });
  it("includes plan state in the cache identity", async () => {
    const history = [user("Continue.")];
    await select(history);
    useTodosStore.setState({ bySession: { objective: plan } });
    const changed = await select(history);
    expect(changed.cacheHit).toBe(false);
    coverage(changed.names);
  });
  it("pure schema selection covers required capabilities independently of schema order", async () => {
    const schemas = await serializedToolSchemas(tools());
    const objective = resolveToolObjective([...coding, user(correction)]);
    const options = {
      query: correction,
      objective,
      messages: "x".repeat(50000),
      limits: { reported: 4096 },
    };
    const result = selectToolSchemas({ ...options, schemas });
    coverage(result.names);
    expect(
      selectToolSchemas({ ...options, schemas: schemas.reverse() }).names,
    ).toEqual(result.names);
  });
  it("promotes only the smallest eligible equivalent rather than every writer", async () => {
    const candidates = tools();
    candidates.custom_writer = tool({
      description: "Small authorized writer",
      inputSchema: jsonSchema({ type: "object", properties: {} }),
    });
    identifyTool(candidates.custom_writer, {
      definition: { binding: { kind: "native", operation: "write_file" } },
    });
    candidates.write_file = tool({
      description: "Large writer ".repeat(200),
      inputSchema: jsonSchema({ type: "object", properties: {} }),
    });
    const result = await select(
      [...coding, user(correction)],
      candidates,
      true,
    );
    expect(result.names).toContain("custom_writer");
    expect(result.names).not.toContain("write_file");
  });
});
