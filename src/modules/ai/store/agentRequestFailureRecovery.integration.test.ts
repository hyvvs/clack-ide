import type { RunAgentOptions } from "@/modules/ai/lib/agent";
import {
  readAnswer,
  withAnswerContinuation,
} from "@/modules/ai/lib/answerContinuation";
import { canonicalJson } from "@/modules/ai/lib/canonicalJson";
import { InferenceTransportError } from "@/modules/ai/lib/inferenceErrors";
import { gateInferenceTools } from "@/modules/ai/lib/inferenceToolGate";
import { createRunBudget } from "@/modules/ai/lib/runBudget";
import { ollamaEffortFixture } from "@/modules/ai/lib/reasoningEffort.fixture";
import { runContextCalibration } from "@/modules/ai/lib/contextCalibration";
import { rememberContextRuntime, forgetContextRuntime } from "@/modules/ai/lib/contextCalibrationTrust";
import { profileEvidence, readSelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import { automaticAgentRecommendation, applyAgentRecommendation } from "@/modules/ai/lib/agentConfiguration";
import { runToolVerification } from "@/modules/ai/lib/toolVerification";
import { selfHostedSelectionId } from "@/modules/ai/lib/selfHostedModels";
import { profileSnapshot } from "@/modules/ai/lib/modelOnboarding";
import type {
  LanguageModelV3,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import {
  convertToModelMessages,
  pruneMessages,
  stepCountIs,
  streamText,
  tool,
} from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const { disk, invoke, history, runAgentStream, files, directories, mutations } =
  vi.hoisted(() => ({
    disk: new Map<string, unknown>(),
    invoke: vi.fn(),
    history: vi.fn(),
    runAgentStream: vi.fn(),
    files: new Map<string, string>(),
    directories: new Set<string>(),
    mutations: [] as string[],
  }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@/modules/ai/lib/agent", () => ({ runAgentStream }));
// The fixture has already passed real, deterministic context calibration;
// transport must not trigger native qualification traffic during this test.
vi.mock("@/modules/ai/lib/contextCalibrationRuntime", async (original) => ({
  ...(await original<typeof import("@/modules/ai/lib/contextCalibrationRuntime")>()),
  ensureSelectedContext: vi.fn(async (state) => state),
}));
vi.mock("@/modules/ai/lib/customToolExecution", () => ({
  executionHistory: history,
}));
vi.mock("@/modules/ai/lib/writeCheckpoint", () => ({
  prepareWriteCheckpoint: vi.fn(async () => null),
  validateWriteCheckpoint: vi.fn(async () => {}),
}));
vi.mock("@/modules/settings/store", async (original) => ({
  ...(await original<typeof import("@/modules/settings/store")>()),
  setLastUsedAiSelection: vi.fn(),
  setRecentModelIds: vi.fn(),
}));
vi.mock("@/modules/ai/lib/todos", async (original) => ({
  ...(await original<typeof import("@/modules/ai/lib/todos")>()),
  loadTodos: vi.fn(async () => []),
  saveTodos: vi.fn(async () => {}),
  deleteTodos: vi.fn(async () => {}),
}));

import { agentPermissionAuthoritySnapshot } from "@/modules/ai/lib/permissions";
import {
  awaitSessionWrites,
  loadMessages,
  recoverInterruptedSessions,
} from "@/modules/ai/lib/sessions";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { getOrCreateChat, shouldAutomaticallySendSession } from "./chatRuntime";
import { chats, seedMessages, useChatStore } from "./chatStore";
import { usePlanStore } from "./planStore";
import { useTodosStore } from "./todoStore";

type FixtureRequest =
  | { kind: "write"; id: string; path: string; content: string }
  | { kind: "mkdir"; id: string; path: string }
  | { kind: "list"; id: string }
  | { kind: "todo"; id: string }
  | { kind: "partial-tool"; id: string }
  | { kind: "finish" }
  | { kind: "fail"; code: string };
const sessionId = "agent-failure-checkpoint";
const root = "/workspace";
let requests: FixtureRequest[] = [];
let requestCount = 0;
let nativeSettlements: Array<{ phase: string; errorCode?: string }> = [];
let unavailableRegistry = false;
let unavailableFingerprint = false;
let unregisteredFingerprint = false;
let changePermissionsAtTimeout = false;

const finish = (reason: "tool-calls" | "stop"): LanguageModelV3StreamPart => ({
  type: "finish",
  finishReason: { unified: reason, raw: reason },
  usage: {
    inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 8, text: 8, reasoning: 0 },
  },
});
function streamParts(request: FixtureRequest): LanguageModelV3StreamPart[] {
  if (request.kind === "list") return [
    { type: "tool-call", toolCallId: request.id, toolName: "list_directory", input: JSON.stringify({ path: root }) },
    finish("tool-calls"),
  ];
  if (request.kind === "write" || request.kind === "mkdir") {
    const input =
      request.kind === "write"
        ? { path: request.path, content: request.content }
        : { path: request.path };
    return [
      {
        type: "tool-call",
        toolCallId: request.id,
        toolName: request.kind === "write" ? "write_file" : "create_directory",
        input: JSON.stringify(input),
      },
      finish("tool-calls"),
    ];
  }
  if (request.kind === "todo")
    return [
      {
        type: "tool-call",
        toolCallId: request.id,
        toolName: "todo_write",
        input: JSON.stringify({ done: true }),
      },
      finish("tool-calls"),
    ];
  if (request.kind === "partial-tool") {
    nativeSettlements.push({
      phase: "timed-out",
      errorCode: "stream-idle-timeout",
    });
    return [
      { type: "tool-input-start", id: request.id, toolName: "write_file" },
      {
        type: "tool-input-delta",
        id: request.id,
        delta: '{"path":"/workspace/half.ts","content":',
      },
      {
        type: "error",
        error: new InferenceTransportError("stream-idle-timeout"),
      },
    ];
  }
  if (request.kind === "fail") {
    if (changePermissionsAtTimeout && request.code === "stream-idle-timeout") {
      const prefs = usePreferencesStore.getState();
      usePreferencesStore.setState({
        agentPermissionProfiles: {
          ...prefs.agentPermissionProfiles,
          "builtin:coder": { mode: "full-access", categories: {} },
        },
      });
    }
    nativeSettlements.push({
      phase: request.code === "stream-idle-timeout" ? "timed-out" : "failed",
      errorCode: request.code,
    });
    return [
      { type: "reasoning-start", id: "incomplete" },
      {
        type: "reasoning-delta",
        id: "incomplete",
        delta: "partial, not a final answer",
      },
      {
        type: "error",
        error: new InferenceTransportError(
          request.code as "stream-idle-timeout",
        ),
      },
    ];
  }
  return [
    { type: "text-start", id: "answer" },
    {
      type: "text-delta",
      id: "answer",
      delta: "All unfinished work implemented and verified.",
    },
    { type: "text-end", id: "answer" },
    finish("stop"),
  ];
}

function run() {
  const result = useChatStore
    .getState()
    .sessions.find((s) => s.id === sessionId)?.run;
  if (!result) throw new Error("Expected logical Agent run");
  return result;
}
async function settle(predicate: () => boolean) {
  for (let i = 0; i < 180; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `Deterministic recovery did not settle: requests=${requestCount}, state=${run().state}, phase=${run().agentRequestRecovery?.phase}`,
  );
}
function seed() {
  useChatStore.setState({
    activeSessionId: sessionId,
    runtimeBySession: {},
    pendingApprovalsBySession: {},
    sessions: [
      {
        id: sessionId,
        title: "Mission",
        createdAt: 1,
        updatedAt: 1,
        modelRevision: 5,
        profile: {
          agentId: "builtin:coder",
          modelId: "gpt-5.4-mini",
          workspaceId: "local:/workspace",
          workspaceRoot: root,
        },
        run: {
          state: "running",
          startedAt: 1,
          agentId: "builtin:coder",
          modelId: "gpt-5.4-mini",
          providerId: "openai",
          transportModelId: "gpt-5.4-mini",
          workspaceId: "local:/workspace",
          workspaceRoot: root,
          agentPermissionAuthority: agentPermissionAuthoritySnapshot(
            sessionId,
            "builtin:coder",
          ),
          budget: createRunBudget("ask"),
        },
      },
    ],
  });
}
beforeEach(() => {
  disk.clear();
  files.clear();
  directories.clear();
  mutations.length = 0;
  chats.clear();
  seedMessages.clear();
  requestCount = 0;
  nativeSettlements = [];
  requests = [];
  unavailableRegistry = false;
  unavailableFingerprint = false;
  unregisteredFingerprint = false;
  changePermissionsAtTimeout = false;
  history.mockReset().mockResolvedValue([]);
  invoke.mockReset().mockImplementation(async (command, args) => {
    if (command === "shell_identity")
      return { name: "/bin/sh", syntax: "POSIX sh" };
    if (command === "agent_workspace_fingerprint" && unregisteredFingerprint)
      throw new Error("Command agent_workspace_fingerprint not found");
    if (command === "agent_workspace_fingerprint" && unavailableFingerprint)
      return {
        revision: null,
        qualification: "unavailable",
        reason: "source tree exceeds bound",
      };
    if (command === "agent_workspace_fingerprint")
      return {
        revision: JSON.stringify([
          [...files.entries()].sort(),
          [...directories].sort(),
        ]),
        qualification: "bounded-local-source-tree-excluding-git-metadata",
        reason: null,
      };
    if (command === "custom_tools_load" && unavailableRegistry)
      throw new Error("Registry unavailable");
    if (command === "custom_tools_load")
      return { schemaVersion: 1, revision: 0, entries: [] };
    if (command === "conversation_source_set") {
      disk.set(args.key, structuredClone(args.value));
      return;
    }
    if (command === "conversation_session_get")
      return structuredClone(disk.get(args.key) ?? null);
    if (command === "fs_read_file") {
      const content = files.get(args.path);
      if (content === undefined) throw new Error("No such file or directory");
      return { kind: "text", content, size: content.length };
    }
    if (command === "fs_stat")
      return {
        kind: directories.has(args.path) ? "dir" : "file",
        size: 0,
        mtime: 1,
      };
    throw new Error(`Unexpected IPC ${command}`);
  });
  runAgentStream
    .mockReset()
    .mockImplementation(async (opts: RunAgentOptions) => {
      if (!opts.inferenceScope || !opts.modelId)
        throw new Error("Captured Agent identity missing");
      const model: LanguageModelV3 = {
        specificationVersion: "v3",
        provider: "fixture",
        modelId: "recovery",
        supportedUrls: {},
        doGenerate: vi.fn(),
        doStream: async () => {
          requestCount++;
          const current = requests.shift() ?? { kind: "finish" };
          return {
            stream: new ReadableStream<LanguageModelV3StreamPart>({
              start(controller) {
                for (const part of streamParts(current))
                  controller.enqueue(part);
                controller.close();
              },
            }),
          };
        },
      };
      const definitions = {
        list_directory: tool({
          inputSchema: z.object({ path: z.string() }),
          execute: async () => ({ entries: [] }),
        }),
        write_file: tool({
          inputSchema: z.object({ path: z.string(), content: z.string() }),
          execute: async ({ path, content }) => {
            mutations.push(`write:${path}`);
            files.set(path, content);
            return {
              ok: true,
              path,
              bytesWritten: content.length,
              clackWorkspaceWrite: true,
            };
          },
        }),
        create_directory: tool({
          inputSchema: z.object({ path: z.string() }),
          execute: async ({ path }) => {
            mutations.push(`mkdir:${path}`);
            directories.add(path);
            return { ok: true, path, clackWorkspaceWrite: true };
          },
        }),
        todo_write: tool({
          inputSchema: z.object({ done: z.boolean() }),
          execute: async ({ done }) => {
            if (done)
              useTodosStore.getState().setTodos(sessionId, [
                {
                  id: "todo-1",
                  title: "Build and verify",
                  status: "completed",
                },
              ] as never);
            return { ok: done };
          },
        }),
      };
      const previous = opts.uiMessages.flatMap((m) =>
        m.parts.flatMap((p) =>
          p.type.startsWith("tool-") &&
          "toolCallId" in p &&
          typeof p.toolCallId === "string"
            ? [
                {
                  id: p.toolCallId,
                  name: p.type.slice(5),
                  input: "input" in p ? p.input : undefined,
                  state: "state" in p ? p.state : undefined,
                },
              ]
            : [],
        ),
      );
      const guarded = gateInferenceTools(
        definitions,
        opts.inferenceScope,
        opts.abortSignal,
        opts.preventCompletedToolReplay
          ? {
              ids: new Set(previous.map((p) => p.id)),
              operations: new Set(
                previous
                  .filter((p) => p.state === "output-available")
                  .map((p) => `${p.name}:${canonicalJson(p.input)}`),
              ),
            }
          : undefined,
      );
      let finishedSteps = 0;
      // Exercise the SDK's real tool-result and incomplete-reasoning conversion,
      // rather than silently substituting an unrelated prompt on recovery.
      const history = pruneMessages({
        messages: await convertToModelMessages(opts.uiMessages),
        reasoning: "before-last-message",
        emptyMessages: "remove",
      });
      return streamText({
        model: withAnswerContinuation(model, {
          provider: "fixture",
          modelId: opts.modelId,
          runId: opts.inferenceScope.runId,
          isCurrent: opts.inferenceScope.isCurrent,
          signal: opts.abortSignal,
          limits: async () => ({ asserted: 32768 }),
          previous:
            readAnswer(opts.uiMessages[opts.uiMessages.length - 1]) ??
            undefined,
          recovery: opts.recovery && !opts.agentRequestFailureRecovery,
          onState: opts.onAnswerState,
        }),
        messages: [
          {
            role: "system",
            content:
              "Continue the original mission with verified existing tool results.",
          },
          ...history,
        ],
        maxRetries: 0,
        tools: guarded,
        stopWhen: stepCountIs(24),
        onStepFinish: () => {
          finishedSteps++;
          opts.onStepFinished?.();
        },
        onFinish: (r) =>
          opts.onFinishMeta?.({
            steps: finishedSteps,
            hitStepCap: false,
            finishReason: r.finishReason,
          }),
      });
    });
  usePlanStore.setState({ active: false, queue: [] });
  useTodosStore.setState({ bySession: {}, hydrated: new Set() });
  seed();
  useTodosStore
    .getState()
    .setTodos(sessionId, [
      { id: "todo-1", title: "Build and verify", status: "in_progress" },
    ] as never);
});
afterEach(async () => {
  await awaitSessionWrites(sessionId);
  chats.clear();
  seedMessages.clear();
  useChatStore.setState({
    sessions: [],
    activeSessionId: null,
    runtimeBySession: {},
  });
  forgetContextRuntime("server");
});

describe("Track R same-logical-Agent request-failure recovery (real Chat and transport)", () => {
  it("campaign04: real verified Automatic proof survives 12 effects, timeout, checkpoint and one resumed provider segment", async () => {
    const f = ollamaEffortFixture([false, "low", "medium", "high", "max"]);
    const digest = "de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1";
    let state = f.state;
    state.profiles[0].modelRevision = digest;
    const controller = new AbortController();
    let loaded = 0;
    let requested = 0;
    const inspect = async () => rememberContextRuntime(f.endpoint.id, {
      epoch: "campaign04-native-process", version: "0.40.11",
      configurationRevision: f.endpoint.configurationRevision, at: Date.now(),
    });
    const refresh = async () => {
      const profile = state.profiles[0];
      profile.evidence = Object.entries({
        thinking: true, thinkingControls: '[false,"low","medium","high","max"]',
        thinkingDefault: "high", trainedForTools: true,
        runtimeContext: "per-request", advertisedContext: 262144,
        loaded: loaded > 0, ...(requested ? { requestedContext: requested } : {}),
        ...(loaded ? { loadedContext: loaded, runtimeAllocation: JSON.stringify([digest, loaded]) } : {}),
      }).map(([metric, value]) => profileEvidence(state, profile.id, `probe.${metric}`,
        value, metric === "requestedContext" ? "measured" : "backend-reported",
        Date.now(), metric === "requestedContext" ? "observed" : "reported"));
      state.inventories = [{ endpointId: f.endpoint.id,
        configurationRevision: f.endpoint.configurationRevision, observedAt: Date.now(),
        connected: true, backend: "ollama", models: [{ id: profile.transportModelId,
          chat: "supported", name: null, digest }] }];
      const snapshot = profileSnapshot(state, profile);
      if (!snapshot) throw new Error("Expected calibrated native fixture snapshot");
      return { state, snapshot };
    };
    const commit = async (change: (value: typeof state) => typeof state) => {
      state = readSelfHostedState(structuredClone(change(state)));
      return state;
    };
    await runContextCalibration({ state, profileId: f.profile.id, signal: controller.signal, ceiling: 32768 }, {
      refresh, inspectRuntime: inspect, clock: Date.now, commit,
      request: async (context) => {
        requested = loaded = context;
        return { finish: "stop" };
      },
    });
    expect(state.profiles[0].contextCalibration?.highest).toBe(32768);
    expect(state.profiles[0].toolVerification).toBeUndefined();
    const initialCaptured = structuredClone(state);
    const id = selfHostedSelectionId(state.profiles[0]);
    usePreferencesStore.setState({ selfHostedInference: initialCaptured });
    useChatStore.setState(current => ({
      sessions: current.sessions.map(session => session.id !== sessionId ? session : {
        ...session, profile: { ...session.profile!, modelId: id },
        run: { ...session.run!, modelId: id, providerId: "ollama",
          transportModelId: f.profile.transportModelId, endpointBaseURL: f.endpoint.baseURL,
          selfHosted: f.identity.selfHosted, reasoning: { choice: "automatic" } as NonNullable<typeof session.run>["reasoning"] },
      }),
    }));
    const previous = runAgentStream.getMockImplementation();
    if (!previous) throw new Error("Native test Agent mock unavailable");
    let admissibleCount = 0;
    runAgentStream.mockImplementation(async (options: RunAgentOptions) => {
      if (!options.agentRequestFailureRecovery) {
        expect(options.selfHostedInference?.profiles[0].toolVerification).toBeUndefined();
        await runToolVerification({ profileId: f.profile.id, signal: controller.signal }, {
          refresh: async () => state, inspect, commit, context: () => 32768,
          request: async () => ({
            calls: [{ name: "get_probe_value", input: { key: "clack-probe-v1", count: 1 } }],
            text: "", finish: "tool-calls", firstBodyAt: Date.now(), callAt: Date.now(),
          }),
        });
      }
      // Initial production verifier publishes newly verified native state at
      // the Agent guard. The recovery must receive that exact same proof, not
      // the pre-verification captured transport configuration.
      const source = options.agentRequestFailureRecovery ? options.selfHostedInference! : state;
      const selected = automaticAgentRecommendation(source, source.profiles[0], 32768);
      expect(selected?.record.status).toBe("verified");
      expect(applyAgentRecommendation(source, source.profiles[0], 32768).choice).toBe("automatic");
      if (options.agentRequestFailureRecovery) {
        expect(options.logicalContinuation).toBe(true);
        expect(options.retainedAutomaticRecordId).toBe(selected?.record.id);
        expect(options.requiredAgentToolSetDigest).toBe("campaign04-schema-revision");
        expect(options.preventCompletedToolReplay).toBe(true);
      }
      admissibleCount++;
      options.onSelfHostedPrepared?.(state, selected?.record.id,
        JSON.stringify(selected?.configuration ?? null));
      if (!options.agentRequestFailureRecovery)
        options.onAgentToolSetPrepared?.("campaign04-schema-revision");
      return previous(options);
    });
    requests = [
      { kind: "list", id: "list-c04" },
      { kind: "todo", id: "todo-c04-a" },
      ...Array.from({ length: 4 }, (_, i) => ({
        kind: "mkdir" as const, id: `mkdir-c04-${i}`, path: `${root}/c04-${i}`,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        kind: "write" as const, id: `write-c04-${i}`,
        path: `${root}/c04-0/source-${i}.ts`, content: `export const v = ${i};`,
      })),
      { kind: "todo", id: "todo-c04-b" },
      { kind: "fail", code: "stream-idle-timeout" },
      { kind: "write", id: "write-post-c04", path: `${root}/c04-0/post.ts`, content: "export const repaired = true;" },
      { kind: "finish" },
    ];
    const chat = getOrCreateChat(sessionId);
    await chat.sendMessage({ text: "Complete one ForgeBoard-shaped Agent mission" });
    await settle(() => chat.status === "ready" && requestCount === 15);
    expect(admissibleCount).toBe(2);
    expect(run().agentRequestRecovery?.attempts).toBe(1);
    expect(run().agentRequestRecovery?.phase).toBe("finished");
    expect(run().agentRequestRecovery?.checkpoint?.toolReceipts).toHaveLength(12);
    expect(run().budget?.continuationCount).toBe(0);
    expect(run().budget?.totalSteps).toBeGreaterThanOrEqual(12);
    expect(mutations).toHaveLength(10);
    expect(new Set(mutations).size).toBe(mutations.length);
    expect(state.profiles[0].toolVerification?.id).toBeTruthy();
    expect(initialCaptured.profiles[0].toolVerification).toBeUndefined();
    useChatStore.getState().finishRun(sessionId, "completed");
    expect(run().state).toBe("completed");
  });

  it("reproduces the production 12th-request timeout after 11 native tools, then safely resumes the same mission", async () => {
    const previous: Array<Extract<FixtureRequest, { id: string }>> = [
      { kind: "list", id: "list-1" },
      { kind: "todo", id: "todo-1" },
      ...Array.from({ length: 4 }, (_, i) => ({
        kind: "mkdir" as const, id: `mkdir-${i + 1}`, path: `${root}/dir-${i + 1}`,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        kind: "write" as const, id: `write-${i + 1}`,
        path: `${root}/dir-1/file-${i + 1}.ts`, content: `export const n = ${i + 1};`,
      })),
    ];
    expect(previous).toHaveLength(11);
    requests = [
      ...previous,
      { kind: "fail", code: "stream-idle-timeout" },
      { kind: "write", id: "write-after-timeout", path: `${root}/dir-1/done.ts`, content: "verified" },
      { kind: "todo", id: "todo-after-timeout" },
      { kind: "finish" },
    ];
    let releaseHistory: (records: never[]) => void = () => {};
    history.mockImplementationOnce(() => new Promise((resolve) => { releaseHistory = resolve; }));
    const authority = agentPermissionAuthoritySnapshot(sessionId, "builtin:coder");
    const chat = getOrCreateChat(sessionId);
    await chat.sendMessage({ text: "Implement and test within one persistent Agent mission" });
    await settle(() => run().agentRequestRecovery?.phase === "preparing" && history.mock.calls.length === 1);
    expect(requestCount).toBe(12);
    expect(run().state).toBe("running");
    expect(run().startedAt).toBe(1);
    expect(run().agentRequestRecovery?.attempts).toBe(1);
    expect(run().agentRequestRecovery?.failures).toMatchObject([
      { kind: "timeout", errorCode: "stream-idle-timeout" },
    ]);
    expect(run().agentRequestRecovery?.checkpoint).toBeUndefined();
    expect(run().budget?.totalSteps).toBeGreaterThanOrEqual(11);
    expect(run().budget?.continuationCount).toBe(0);
    expect(run().agentPermissionAuthority).toBe(authority);
    releaseHistory([]);
    await settle(() => requestCount === 15 && chat.status === "ready");
    expect(run().agentRequestRecovery?.attempts).toBe(1);
    expect(run().agentRequestRecovery?.phase).toBe("finished");
    expect(nativeSettlements).toEqual([{ phase: "timed-out", errorCode: "stream-idle-timeout" }]);
    expect(runAgentStream).toHaveBeenCalledTimes(2);
    const checkpoint = run().agentRequestRecovery?.checkpoint;
    expect(checkpoint?.runId).toBe(`${sessionId}:1`);
    expect(checkpoint?.toolReceipts.map(receipt => receipt.id)).toEqual(previous.map(tool => tool.id));
    expect(checkpoint?.workspaceReceipts).toHaveLength(9);
    expect(checkpoint?.workspaceRevision).toBeTruthy();
    const resumed = runAgentStream.mock.calls[1][0] as RunAgentOptions;
    expect(resumed.agentRequestFailureRecovery).toBe(true);
    expect(resumed.preventCompletedToolReplay).toBe(true);
    expect(resumed.uiMessages.flatMap(message => message.parts).filter(part =>
      part.type.startsWith("tool-") && "state" in part && part.state === "output-available",
    )).toHaveLength(11);
    expect(mutations).toEqual([
      ...Array.from({ length: 4 }, (_, i) => `mkdir:${root}/dir-${i + 1}`),
      ...Array.from({ length: 5 }, (_, i) => `write:${root}/dir-1/file-${i + 1}.ts`),
      `write:${root}/dir-1/done.ts`,
    ]);
    expect(new Set(mutations).size).toBe(mutations.length);
    expect(run().budget?.totalSteps).toBeGreaterThanOrEqual(12);
    expect(run().budget?.hardStepLimit).toBe(240);
    expect(run().budget?.continuationCount).toBe(0);
    expect(run().agentPermissionAuthority).toBe(authority);
    expect(useTodosStore.getState().bySession[sessionId][0].status).toBe("completed");
    expect(chat.messages.flatMap(message => message.parts).some(part =>
      part.type === "reasoning" && part.text.includes("partial, not a final answer"),
    )).toBe(true);
    await awaitSessionWrites(sessionId);
    expect(await loadMessages(sessionId)).toEqual(chat.messages);
    expect(run().budget?.phase).toBe("complete");
    useChatStore.getState().finishRun(sessionId, "completed");
    expect(run().state).toBe("completed");
  });

  it("reproduces the sealed acceptance-host missing command and fails closed after a real timeout admission", async () => {
    unregisteredFingerprint = true;
    requests = [
      { kind: "write", id: "written-before-timeout", path: `${root}/written.ts`, content: "on disk" },
      { kind: "fail", code: "stream-idle-timeout" },
    ];
    const chat = getOrCreateChat(sessionId);
    await chat.sendMessage({ text: "Create file and continue" });
    await settle(() => run().state === "failed");
    expect(requestCount).toBe(2);
    expect(run().agentRequestRecovery?.attempts).toBe(1);
    expect(run().agentRequestRecovery?.phase).toBe("preparing");
    expect(run().agentRequestRecovery?.checkpoint).toBeUndefined();
    expect(run().agentRequestRecovery?.failures[0]).toMatchObject({
      errorCode: "stream-idle-timeout", kind: "timeout",
    });
    expect(run().error?.message).toContain("Command agent_workspace_fingerprint not found");
    expect(mutations).toEqual([`write:${root}/written.ts`]);
  });

  it("times out after completed file effects, commits transcript checkpoint, executes ONE new segment and genuinely completes", async () => {
    requests = [
      {
        kind: "write",
        id: "write-a",
        path: `${root}/a.ts`,
        content: "export const a = 1;",
      },
      {
        kind: "write",
        id: "write-b",
        path: `${root}/b.ts`,
        content: "export const b = 2;",
      },
      { kind: "mkdir", id: "mkdir-c", path: `${root}/next` },
      { kind: "fail", code: "stream-idle-timeout" },
      {
        kind: "write",
        id: "write-d",
        path: `${root}/done.ts`,
        content: "export const verified = true;",
      },
      { kind: "todo", id: "todo-final" },
      { kind: "finish" },
    ];
    const chat = getOrCreateChat(sessionId);
    await chat.sendMessage({ text: "Implement and verify the mission" });
    await settle(() => requestCount === 7 && chat.status === "ready");
    const checkpoint = run().agentRequestRecovery?.checkpoint;
    expect(checkpoint).toBeDefined();
    expect(checkpoint?.toolReceipts.map((r) => r.id)).toEqual([
      "write-a",
      "write-b",
      "mkdir-c",
    ]);
    expect(checkpoint?.workspaceRevision).toBeTruthy();
    expect(checkpoint?.transcriptDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(run().startedAt).toBe(1);
    expect(run().agentRequestRecovery?.attempts).toBe(1);
    expect(run().agentRequestRecovery?.failures).toMatchObject([
      { kind: "timeout", errorCode: "stream-idle-timeout" },
    ]);
    expect(nativeSettlements).toEqual([
      { phase: "timed-out", errorCode: "stream-idle-timeout" },
    ]);
    expect(mutations).toEqual([
      `write:${root}/a.ts`,
      `write:${root}/b.ts`,
      `mkdir:${root}/next`,
      `write:${root}/done.ts`,
    ]);
    expect(run().budget?.totalSteps).toBeGreaterThanOrEqual(4);
    expect(run().budget?.continuationCount).toBe(0);
    expect(run().budget?.hardStepLimit).toBe(240);
    expect(useTodosStore.getState().bySession[sessionId][0].status).toBe(
      "completed",
    );
    const resumed = runAgentStream.mock.calls[1][0] as RunAgentOptions;
    expect(resumed.agentRequestFailureRecovery).toBe(true);
    expect(resumed.preventCompletedToolReplay).toBe(true);
    expect(
      resumed.uiMessages
        .flatMap((m) => m.parts)
        .filter(
          (p) =>
            p.type.startsWith("tool-") &&
            "state" in p &&
            p.state === "output-available",
        ),
    ).toHaveLength(3);
    expect(
      chat.messages
        .flatMap((m) => m.parts)
        .some(
          (p) =>
            p.type === "reasoning" &&
            p.text.includes("partial, not a final answer"),
        ),
    ).toBe(true);
    expect(
      chat.messages
        .flatMap((m) => m.parts)
        .some(
          (p) => p.type === "text" && p.text.includes("All unfinished work"),
        ),
    ).toBe(true);
    await awaitSessionWrites(sessionId);
    const durable = await loadMessages(sessionId);
    expect(durable).toEqual(chat.messages);
    expect(run().budget?.phase).toBe("complete");
    // The production AgentRunBridge owns this transition on Chat.ready. Here
    // it is applied after the real SDK's final answer and budget completion.
    useChatStore.getState().finishRun(sessionId, "completed");
    expect(run().state).toBe("completed");
    expect(shouldAutomaticallySendSession(sessionId, chat.messages)).toBe(
      false,
    );
  });

  it("recovers a timeout before any tool side effect without manufacturing one", async () => {
    requests = [
      { kind: "fail", code: "stream-idle-timeout" },
      { kind: "finish" },
    ];
    const chat = getOrCreateChat(sessionId);
    await chat.sendMessage({ text: "Finish a read-only task" });
    await settle(() => chat.status === "ready" && requestCount === 2);
    expect(run().agentRequestRecovery?.checkpoint?.toolReceipts).toEqual([]);
    expect(run().agentRequestRecovery?.attempts).toBe(1);
    expect(mutations).toEqual([]);
  });

  it.each([
    { id: "write-original", label: "identical completed call ID" },
    {
      id: "write-again",
      label: "new call ID with identical completed write input",
    },
  ])("refuses provider replay of $label while preserving the original receipt", async ({
    id,
  }) => {
    requests = [
      {
        kind: "write",
        id: "write-original",
        path: `${root}/original.ts`,
        content: "original immutable content",
      },
      { kind: "fail", code: "stream-idle-timeout" },
      {
        kind: "write",
        id,
        path: `${root}/original.ts`,
        content: "original immutable content",
      },
    ];
    const chat = getOrCreateChat(sessionId);
    await chat.sendMessage({ text: "Write once then finish" });
    await settle(
      () =>
        run().state === "failed" ||
        (requestCount >= 3 && chat.status === "ready"),
    );
    expect(requestCount).toBeGreaterThanOrEqual(3);
    expect(run().agentRequestRecovery?.attempts).toBe(1);
    expect(mutations).toEqual([`write:${root}/original.ts`]);
    expect(files.get(`${root}/original.ts`)).toBe("original immutable content");
    const originals = chat.messages
      .flatMap((m) => m.parts)
      .filter(
        (p) =>
          p.type === "tool-write_file" &&
          "toolCallId" in p &&
          p.toolCallId === "write-original",
      );
    expect(originals).toHaveLength(1);
    expect(originals[0]).toMatchObject({
      state: "output-available",
      output: {
        ok: true,
        path: `${root}/original.ts`,
        bytesWritten: 26,
      },
    });
  });

  it("second stream-idle timeout terminates, retaining both failures without another provider request", async () => {
    requests = [
      { kind: "fail", code: "stream-idle-timeout" },
      { kind: "fail", code: "stream-idle-timeout" },
    ];
    const chat = getOrCreateChat(sessionId);
    await chat.sendMessage({ text: "Task" });
    await settle(() => run().state === "failed");
    expect(requestCount).toBe(2);
    expect(nativeSettlements.map((s) => s.phase)).toEqual([
      "timed-out",
      "timed-out",
    ]);
    expect(run().agentRequestRecovery?.attempts).toBe(1);
    expect(run().agentRequestRecovery?.failures).toHaveLength(2);
  });

  it("unknown native tool effects deny a new provider segment", async () => {
    history.mockResolvedValue([
      { runId: 1, state: "interrupted", effect: "unknown", toolName: "custom" },
    ]);
    requests = [{ kind: "fail", code: "stream-idle-timeout" }];
    const chat = getOrCreateChat(sessionId);
    await chat.sendMessage({ text: "Task" });
    await settle(() => run().state === "failed");
    expect(requestCount).toBe(1);
    expect(run().error?.message).toContain("reconciliation");
  });

  it("unavailable custom-tool registry fails closed before a new request", async () => {
    unavailableRegistry = true;
    requests = [{ kind: "fail", code: "stream-idle-timeout" }];
    const chat = getOrCreateChat(sessionId);
    await chat.sendMessage({ text: "Task" });
    await settle(() => run().state === "failed");
    expect(requestCount).toBe(1);
    expect(run().agentRequestRecovery).toBeUndefined();
  });

  it("unknown incomplete tool JSON at timeout never executes and never recovers", async () => {
    requests = [{ kind: "partial-tool", id: "unknown-half-write" }];
    const chat = getOrCreateChat(sessionId);
    await chat.sendMessage({ text: "Task" });
    await settle(() => run().state === "failed");
    expect(requestCount).toBe(1);
    expect(mutations).toEqual([]);
    expect(run().agentRequestRecovery?.attempts).toBe(1);
  });

  it.each([
    "unsafe-endpoint",
    "invalid-request",
    "malformed-stream",
    "context-preflight-rejected",
    "cancelled",
  ])("non-recoverable provider or policy error %s is terminal", async (code) => {
    requests = [{ kind: "fail", code }];
    const chat = getOrCreateChat(sessionId);
    await chat.sendMessage({ text: "Task" });
    await settle(() => run().state !== "running");
    expect(requestCount).toBe(1);
    expect(run().agentRequestRecovery).toBeUndefined();
  });

  it("stale workspace content after completed write blocks recovery", async () => {
    requests = [
      { kind: "write", id: "w", path: `${root}/a.ts`, content: "good" },
      { kind: "fail", code: "stream-idle-timeout" },
    ];
    history.mockImplementation(async () => {
      files.set(`${root}/a.ts`, "externally changed");
      return [];
    });
    const chat = getOrCreateChat(sessionId);
    await chat.sendMessage({ text: "Task" });
    await settle(() => run().state === "failed");
    expect(requestCount).toBe(2);
    expect(mutations).toEqual([`write:${root}/a.ts`]);
    expect(run().error?.message).toContain("Workspace revision");
  });

  it("unrelated workspace mutation changes the whole-tree witness and denies dispatch", async () => {
    requests = [{ kind: "fail", code: "stream-idle-timeout" }];
    history.mockImplementation(async () => {
      files.set(`${root}/unrelated.ts`, "external edit");
      return [];
    });
    const chat = getOrCreateChat(sessionId);
    await chat.sendMessage({ text: "Task" });
    await settle(() => run().state === "failed");
    expect(requestCount).toBe(1);
    expect(run().error?.message).toContain("Workspace tree revision");
  });

  it("unavailable native complete workspace witness refuses automatic recovery", async () => {
    unavailableFingerprint = true;
    requests = [{ kind: "fail", code: "stream-idle-timeout" }];
    const chat = getOrCreateChat(sessionId);
    await chat.sendMessage({ text: "Task" });
    await settle(() => run().state === "failed");
    expect(requestCount).toBe(1);
    expect(run().error?.message).toContain("workspace revision witness");
  });

  it.each([
    "agent",
    "run",
    "workspace",
    "model-revision",
  ])("changed %s owner during reconciliation blocks the new segment", async (change) => {
    requests = [{ kind: "fail", code: "stream-idle-timeout" }];
    history.mockImplementation(async () => {
      useChatStore.setState((s) => ({
        sessions: s.sessions.map((item) => {
          if (!item.profile || !item.run) return item;
          if (change === "agent")
            return {
              ...item,
              profile: { ...item.profile, agentId: "builtin:reviewer" },
            };
          if (change === "run")
            return { ...item, run: { ...item.run, startedAt: 999 } };
          if (change === "workspace")
            return {
              ...item,
              profile: { ...item.profile, workspaceId: "local:/other" },
            };
          return { ...item, modelRevision: 6 };
        }),
      }));
      return [];
    });
    const chat = getOrCreateChat(sessionId);
    await chat.sendMessage({ text: "Task" });
    await settle(() => run().state === "failed" || run().startedAt !== 1);
    expect(requestCount).toBe(1);
  });

  it("a cancelled mission cannot restart from a pending recovery ledger", async () => {
    let release: (records: never[]) => void = () => {};
    history.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    requests = [{ kind: "fail", code: "stream-idle-timeout" }];
    const chat = getOrCreateChat(sessionId);
    await chat.sendMessage({ text: "Task" });
    await settle(() => run().agentRequestRecovery?.phase === "preparing");
    useChatStore.getState().finishRun(sessionId, "cancelled");
    release([]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(run().state).toBe("cancelled");
    expect(requestCount).toBe(1);
  });

  it("restart persists a recoverable checkpoint but never auto-resumes without captured authority", async () => {
    requests = [
      { kind: "fail", code: "stream-idle-timeout" },
      { kind: "finish" },
    ];
    const chat = getOrCreateChat(sessionId);
    await chat.sendMessage({ text: "Task" });
    await settle(() => requestCount === 2 && chat.status === "ready");
    await awaitSessionWrites(sessionId);
    const saved = structuredClone(useChatStore.getState().sessions);
    const messages = await loadMessages(sessionId);
    expect(saved[0].run?.agentRequestRecovery?.checkpoint).toBeDefined();
    const interrupted = recoverInterruptedSessions(saved).sessions;
    expect(interrupted[0].run?.state).toBe("interrupted");
    chats.clear();
    seedMessages.set(sessionId, messages ?? []);
    useChatStore.setState({ sessions: interrupted });
    expect(shouldAutomaticallySendSession(sessionId, messages ?? [])).toBe(
      false,
    );
    expect(requestCount).toBe(2);
  });

  it("permission changes and pending approvals fail closed", async () => {
    requests = [{ kind: "fail", code: "stream-idle-timeout" }];
    const original = usePreferencesStore.getState().agentPermissionProfiles;
    history.mockImplementation(async () => {
      usePreferencesStore.setState({
        agentPermissionProfiles: {
          ...original,
          "builtin:coder": { mode: "chat-only", categories: {} },
        },
      });
      return [];
    });
    try {
      const chat = getOrCreateChat(sessionId);
      await chat.sendMessage({ text: "Task" });
      await settle(() => run().state === "failed");
      expect(requestCount).toBe(1);
    } finally {
      usePreferencesStore.setState({ agentPermissionProfiles: original });
    }
  });

  it("a pending approval appearing during recovery prevents dispatch without resetting the permission mode", async () => {
    requests = [{ kind: "fail", code: "stream-idle-timeout" }];
    history.mockImplementation(async () => {
      useChatStore.setState((s) => ({
        pendingApprovalsBySession: {
          ...s.pendingApprovalsBySession,
          [sessionId]: [
            {
              id: "approval-in-flight",
              sessionId,
              toolName: "bash_run",
              input: { command: "echo no" },
            },
          ],
        },
      }));
      return [];
    });
    const chat = getOrCreateChat(sessionId);
    await chat.sendMessage({ text: "Task" });
    await settle(() => run().state === "failed");
    expect(requestCount).toBe(1);
    expect(run().error?.message).toContain("approval");
  });

  it("does not gain newly broadened permission authority while the failing provider request is in flight", async () => {
    const before = usePreferencesStore.getState().agentPermissionProfiles;
    changePermissionsAtTimeout = true;
    try {
      requests = [{ kind: "fail", code: "stream-idle-timeout" }];
      const chat = getOrCreateChat(sessionId);
      await chat.sendMessage({ text: "Task" });
      await settle(() => run().state === "failed");
      expect(requestCount).toBe(1);
      expect(run().agentRequestRecovery).toBeUndefined();
    } finally {
      usePreferencesStore.setState({ agentPermissionProfiles: before });
    }
  });

  it("cannot forge the Agent recovery transport flag without a claimed durable checkpoint", async () => {
    requests = [{ kind: "finish" }];
    const chat = getOrCreateChat(sessionId);
    await chat.sendMessage({ text: "Task" });
    expect(chat.status).toBe("ready");
    await chat.sendMessage(undefined, {
      body: { clackAgentRequestRecovery: true },
    });
    expect(requestCount).toBe(1);
    expect(run().agentRequestRecovery).toBeUndefined();
    expect(run().state).toBe("failed");
    expect(run().error?.message).toContain("no committed same-run checkpoint");
  });
});
