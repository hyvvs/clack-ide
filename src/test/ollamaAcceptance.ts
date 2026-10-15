import { invoke } from "@tauri-apps/api/core";
import { generateText, streamText, stepCountIs, tool } from "ai";
import { z } from "zod";
import {
  buildConfiguredLanguageModel,
  runAgentStream,
} from "@/modules/ai/lib/agent";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";
import {
  addSelfHostedEndpoint,
  createSelfHostedEndpoint,
  emptySelfHostedState,
  readSelfHostedState,
  setProfileOverride,
} from "@/modules/ai/lib/selfHostedProfiles";
import {
  saveSelfHostedModel,
  selfHostedSelectionId,
  selfHostedTransportIdentity,
} from "@/modules/ai/lib/selfHostedModels";
import { updateSelfHostedProfiles } from "@/modules/settings/store";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { createSelfHostedProbeClient } from "@/modules/ai/lib/selfHostedProbe";
import { captureEffort } from "@/modules/ai/lib/reasoningEffort";
import { modelBudgetLimits } from "@/modules/ai/lib/requestPreflight";
import { assertRequestBudget } from "@/modules/ai/lib/contextBudget";
import { serverModelDetails } from "@/modules/ai/lib/selfHostedCapabilities";
import type { ToolContext } from "@/modules/ai/tools/context";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
export async function runOllamaAcceptance(config: {
  root: string;
  server: string;
  report: string;
  ollama?: { live: boolean; model: string };
}) {
  assert(config.ollama, "Ollama fixture configuration missing");
  const modelId = config.ollama.model;
  const progress = (stage: string) =>
    fetch(new URL(`/progress?stage=${stage}`, config.report));
  await progress("preferences");
  await usePreferencesStore.getState().init();
  await progress("profiles");
  let state = saveSelfHostedModel(
    addSelfHostedEndpoint(
      emptySelfHostedState(),
      createSelfHostedEndpoint(
        {
          alias: "Isolated Ollama acceptance",
          baseURL: config.server,
          backendHint: "ollama",
          allowPrivateNetwork: true,
        },
        "ollama-acceptance",
      ),
    ),
    "ollama-acceptance",
    modelId,
  );
  const profileId = state.profiles[0].id;
  for (const [field, value] of [
    ["workingContext", 32768],
    ["maxOutput", 512],
    ["outputReserve", 512],
  ] as const)
    state = setProfileOverride(state, profileId, field, value);
  await updateSelfHostedProfiles(() => state);
  await progress("probe");
  const probe = createSelfHostedProbeClient();
  const options = {
    endpointId: state.endpoints[0].id,
    selectedModelId: modelId,
    allowPrivateNetwork: true,
  };
  const initial = await probe.refresh(options);
  assert(initial.connected, "Native metadata probe unavailable");
  assert(
    initial.models.some((m) => m.id === modelId),
    "Exact model missing",
  );
  const read = async () => {
    const entries = await invoke<[string, unknown][]>(
      "self_hosted_profiles_snapshot",
    );
    state = readSelfHostedState(new Map(entries).get("selfHostedInference"));
    usePreferencesStore.setState({ selfHostedInference: state });
  };
  await read();
  const selection = selfHostedSelectionId(state.profiles[0]);
  const capture = () => {
    const identity = selfHostedTransportIdentity(selection, state);
    assert(identity, "Ollama route missing");
    const effort = captureEffort(selection, identity, undefined, state);
    if (effort.capability.levels.includes("none")) effort.choice = "none";
    return {
      capturedModelIdentity: identity,
      reasoning: effort,
      selfHostedInference: state,
      inferenceScope: {
        sessionId: "ollama-native-acceptance",
        runId: crypto.randomUUID(),
        isCurrent: () => true,
      },
    };
  };
  const toolContext: ToolContext = {
    getCwd: () => config.root,
    getWorkspaceRoot: () => config.root,
    getTerminalContext: () => null,
    isActiveTerminalPrivate: () => false,
    injectIntoActivePty: () => false,
    openPreview: () => false,
    spawnAgent: () => null,
    readAgentOutput: () => null,
    readCache: new Map(),
    getSessionId: () => "ollama-native-acceptance",
    getAgentId: () => "builtin:coder",
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 240000);
  try {
    const result = await runAgentStream({
      ...capture(),
      modelId: selection,
      keys: EMPTY_PROVIDER_KEYS,
      toolContext,
      mandatoryTools: [],
      requiredOutput: 256,
      abortSignal: controller.signal,
      uiMessages: [
        {
          id: "user-32k",
          role: "user",
          parts: [
            {
              type: "text",
              text: "Reply with exactly CLACK_OLLAMA_32K_OK. No tools or additional explanation.",
            },
          ],
        },
      ],
    });
    let deltas = 0,
      answer = "";
    for await (const part of result.fullStream) {
      if (part.type === "error") throw part.error;
      if (part.type === "text-delta") {
        deltas++;
        answer += part.text;
      }
    }
    assert(
      deltas > 0 && answer.includes("CLACK_OLLAMA_32K_OK"),
      "Normal Agent streaming answer missing",
    );
    assert(
      (await result.finishReason) === "stop",
      "Normal Agent did not complete",
    );
    const loaded = await probe.read(options);
    assert(loaded, "No shared native probe cache after inference");
    const details = serverModelDetails(state.endpoints[0], modelId, loaded);
    assert(
      details.serverContext === "32,768 tokens (loaded)",
      `Wrong loaded context: ${details.serverContext}`,
    );
    await read();
    const built = await buildConfiguredLanguageModel(
      selection,
      EMPTY_PROVIDER_KEYS,
      capture(),
    );
    const budgets = [];
    for (const step of await result.steps) {
      const body =
        typeof step.request.body === "string"
          ? JSON.parse(step.request.body)
          : step.request.body;
      assert(
        body.options.num_ctx === 32768,
        "Agent wire missing runtime target",
      );
      const budget = assertRequestBudget(await modelBudgetLimits(built), body);
      assert(budget.ceiling === 32768, "Wire and B1 disagree");
      budgets.push({
        context: body.options.num_ctx,
        output: body.options.num_predict,
        ceiling: budget.ceiling,
        think: body.think,
        schemas: body.tools?.length ?? 0,
      });
    }
    let echoed = 0;
    const tools = {
      clack_echo: tool({
        description: "Harmless synthetic echo, no external effects",
        inputSchema: z.object({ value: z.literal("clack-echo-7") }),
        execute: async ({ value }) => {
          echoed++;
          return { echoed: value };
        },
      }),
    };
    const toolRun = streamText({
      model: built,
      abortSignal: controller.signal,
      maxRetries: 0,
      maxOutputTokens: 512,
      prompt:
        "Call clack_echo with value exactly clack-echo-7. After its result, reply briefly confirming the echoed value. Do not describe a hypothetical tool call.",
      tools,
      stopWhen: stepCountIs(2),
    });
    await toolRun.consumeStream({
      onError: (error) => {
        throw error;
      },
    });
    const steps = await toolRun.steps;
    assert(
      echoed === 1 &&
        steps[0].toolCalls[0]?.toolName === "clack_echo" &&
        z
          .object({ value: z.literal("clack-echo-7") })
          .safeParse(steps[0].toolCalls[0].input).success,
      "No exact structured real-model tool call",
    );
    assert(
      steps.length === 2 && (await toolRun.text).length > 0,
      "Tool result roundtrip did not finish",
    );
    for (const step of steps) {
      const body =
        typeof step.request.body === "string"
          ? JSON.parse(step.request.body)
          : step.request.body;
      assert(
        body.options.num_ctx === 32768,
        "Tool step lost captured runtime target",
      );
      budgets.push({
        context: body.options.num_ctx,
        output: body.options.num_predict,
        ceiling: assertRequestBudget(await modelBudgetLimits(built), body)
          .ceiling,
        think: body.think,
        schemas: body.tools?.length ?? 0,
      });
    }
    // A non-streaming structured response exercises the same route used by extraction.
    const json = await generateText({
      model: built,
      abortSignal: controller.signal,
      prompt: 'Return only JSON: {"ok":true}',
      maxOutputTokens: 64,
      maxRetries: 0,
      providerOptions: {},
    });
    assert((await json.text).length > 0, "Non-streaming response missing");
    let mismatch: { loaded: string; blocked: boolean } | undefined;
    if (!config.ollama.live) {
      await fetch(new URL("/mismatch", config.server));
      const changed = await probe.refresh(options);
      await read();
      const next = await buildConfiguredLanguageModel(
        selection,
        EMPTY_PROVIDER_KEYS,
        capture(),
      );
      let blocked = false;
      try {
        await modelBudgetLimits(next);
      } catch (error) {
        assert(
          error instanceof Error &&
            error.message.includes("after Clack requested 32768"),
          "Wrong mismatch failure",
        );
        blocked = true;
      }
      assert(blocked, "Native refreshed 4K mismatch did not block B1");
      mismatch = {
        loaded: serverModelDetails(state.endpoints[0], modelId, changed)
          .serverContext,
        blocked,
      };
    }
    return {
      mismatch,
      normalAgent: { deltas, finish: await result.finishReason },
      model: modelId,
      initialLoaded: serverModelDetails(state.endpoints[0], modelId, initial)
        .loaded,
      advertised: details.advertisedContext,
      loaded: details.serverContext,
      budgets,
      tool: { executed: echoed, steps: steps.length, exactInput: true },
      reasoning: capture().reasoning.choice,
      fallback: "never",
      cloudInference: 0,
      nativeGui: "Not performed",
      outcomes: [{ name: "ollama-native-context", taskIds: [] }],
      tasks: [],
    };
  } finally {
    clearTimeout(timer);
  }
}
