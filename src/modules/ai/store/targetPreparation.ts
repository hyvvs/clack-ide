import type { ModelMessage, UIMessage } from "ai";
import { generateText } from "ai";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  buildConfiguredLanguageModel,
  type LocalProviderConfig,
} from "@/modules/ai/lib/agent";
import {
  modelBudgetLimits,
  serializedToolSchemas,
} from "@/modules/ai/lib/requestPreflight";
import { createConversationCompactor } from "@/modules/ai/lib/conversationCompaction";
import { materializeAttachmentMessages } from "@/modules/ai/lib/attachmentMessages";
import { retrieveConversationEvidence } from "@/modules/ai/lib/conversationRetrieval";
import { retrieveScopedEvidence } from "@/modules/ai/lib/scopedEvidence";
import { resolveCurrentAgentPermission } from "@/modules/ai/lib/permissions";
import {
  measureRequest,
  resolveContextBudget,
} from "@/modules/ai/lib/contextBudget";
import type { ModelInputCapabilities } from "@/modules/ai/lib/modelCapabilities";
import { resolveModelInputCapabilities } from "@/modules/ai/lib/modelCapabilities";
import { readSelfHostedSnapshot } from "@/modules/ai/lib/selfHostedCapabilities";
import type { InferenceScope } from "@/modules/ai/lib/inferenceLifecycle";
import { buildTools } from "@/modules/ai/tools/tools";
import {
  beginTargetContext,
  commitTargetContext,
  createTargetDraft,
  targetContextKey,
  contextDigest,
  loadTargetContext,
  cancelTargetContext,
  SwitchConsentRequired,
} from "@/modules/ai/lib/targetContext";
import {
  awaitSessionWrites,
  type SessionMeta,
} from "@/modules/ai/lib/sessions";
import { useChatStore, hasKeyForModel } from "@/modules/ai/store/chatStore";
import { sessionToolContext } from "@/modules/ai/store/chatRuntime";

export async function prepareTarget(options: {
  session: SessionMeta;
  modelId: string;
  originals: UIMessage[];
  system: ModelMessage[];
  environment: string;
  capabilities: ModelInputCapabilities;
  scope: InferenceScope;
  signal: AbortSignal;
  allowInference: boolean;
  check: () => void;
}) {
  const { session, check } = options;
  const preferences = usePreferencesStore.getState();
  const state = useChatStore.getState();
  const owner = {
    sessionId: session.id,
    workspaceId: session.profile?.workspaceId ?? null,
  };
  await awaitSessionWrites(session.id);
  check();
  const source = await beginTargetContext(owner);
  const cancel = () => {
    void cancelTargetContext(session.id, source.token).catch(() => undefined);
  };
  if (options.signal.aborted) cancel();
  options.signal.addEventListener("abort", cancel, { once: true });
  let compactor:
    | Awaited<ReturnType<typeof createConversationCompactor>>
    | undefined;
  try {
    check();
    if (
      (await contextDigest(source.session.profile)) !==
        (await contextDigest(session.profile)) ||
      (await contextDigest(options.originals)) !==
        source.view.preparation.source.transcriptHash ||
      (source.session.modelRevision ?? 0) !== (session.modelRevision ?? 0)
    )
      throw new Error(
        "The saved conversation selection changed. Choose the model again.",
      );
    check();
    options.scope.runId = source.token;
    const configuration: LocalProviderConfig = {
      ...preferences,
      customEndpointKeys: state.customEndpointKeys,
      inferenceScope: options.scope,
    };
    const model = await buildConfiguredLanguageModel(
      options.modelId,
      state.apiKeys,
      configuration,
    );
    check();
    const context = sessionToolContext(session.id).toolContext;
    // An idle conversation's previous run is historical, not the next run's agent.
    const toolContext = {
      ...context,
      getAgentId: () => session.profile?.agentId ?? context.getAgentId(),
      getWorkspaceId: () => owner.workspaceId,
      getWorkspaceRoot: () => session.profile?.workspaceRoot ?? null,
    };
    const tools = await serializedToolSchemas(
      buildTools({
        ...toolContext,
        requestConversationEvidence: () => ({
          status: "preparing",
          message: "Preparing context.",
        }),
      }),
    );
    check();
    const limits = await modelBudgetLimits(model);
    check();
    const key = await targetContextKey({
      modelId: options.modelId,
      configuration,
      system: options.system,
      tools,
      limits,
      capabilities: options.capabilities,
      permissions: [
        preferences.agentPermissionProfiles,
        preferences.agentWorkspacePermissions,
      ],
      workspace: [owner.workspaceId, session.profile?.agentId],
      credentials: [state.apiKeys, state.customEndpointKeys],
    });
    check();
    const materialized = await materializeAttachmentMessages(
      options.originals,
      options.capabilities,
    );
    check();
    if (session.targetContext && session.profile?.modelId === options.modelId) {
      const cached = await loadTargetContext(owner, key);
      check();
      if (cached)
        source.view = { ...source.view, revision: cached, revisionId: null };
    }
    const draft = createTargetDraft(source);
    let calls = 0;
    let omittedClaims = 0;
    let conversationSources: string[] = [];
    let conversationOmitted = 0;
    let scopedSources: string[] = [];
    let scopedOmitted = 0;
    let scopedIssues = 0;
    compactor = await createConversationCompactor({
      alwaysLoad: true,
      context: {
        owner,
        originals: options.originals,
        ready: async () => check(),
        remainingCalls: () => 8 - calls,
        chargeCall: async () => {
          check();
          calls++;
        },
      },
      materialized,
      system: [
        ...options.system,
        ...(options.environment
          ? [{ role: "system" as const, content: options.environment }]
          : []),
      ],
      tools,
      model,
      scope: options.scope,
      signal: options.signal,
      limits: () => modelBudgetLimits(model),
      memory: draft.memory,
      extractionRoute: async () => {
        check();
        if (!options.allowInference)
          throw new SwitchConsentRequired(
            "Optimize and switch will use this conversation's current model for bounded evidence preparation before changing models. Normal provider charges apply; no unrelated summarizer is used.",
          );
        const sourceModel = session.profile?.modelId;
        if (!sourceModel || !hasKeyForModel(sourceModel))
          throw new Error(
            "The current model's authorized preparation route is unavailable.",
          );
        const extractionModel = await buildConfiguredLanguageModel(
          sourceModel,
          state.apiKeys,
          configuration,
        );
        check();
        return {
          model: extractionModel,
          limits: () => modelBudgetLimits(extractionModel),
        };
      },
      retrieve: retrieveConversationEvidence,
      onOptimized: (notice) => {
        omittedClaims = notice.omittedCompletedClaims;
      },
      onRetrieved: (notice) => {
        conversationSources = notice.sources.map((item) => item.messageId);
        conversationOmitted = notice.omitted;
      },
      scopedEvidence: owner.workspaceId
        ? {
            read: retrieveScopedEvidence,
            onPrepared: (sources, omitted, issues) => {
              scopedSources = sources;
              scopedOmitted = omitted;
              scopedIssues = issues;
            },
            allowed: () =>
              resolveCurrentAgentPermission("read_file", {}, toolContext)
                .outcome === "allow",
          }
        : undefined,
      call: async (request) => {
        check();
        const result = await generateText({ ...request, maxRetries: 0 });
        check();
        return {
          text: result.text,
          usage: {
            inputTokens: result.usage.inputTokens ?? 0,
            outputTokens: result.usage.outputTokens ?? 0,
            cachedInputTokens:
              result.usage.inputTokenDetails?.cacheReadTokens ?? 0,
          },
        };
      },
    });
    const preparedCompactor = compactor;
    const messages = await compactor.prepare();
    check();
    const budget = resolveContextBudget(
      limits,
      measureRequest({ messages, tools }),
    );
    if (!budget.fits)
      throw new Error(
        budget.reason ?? "Prepared context cannot fit the target model.",
      );
    return {
      budget,
      messages,
      details: [
        `${options.originals.filter((message) => message.role === "user").length} original user messages retained verbatim; system instructions, recent turns and required tool pairs protected.`,
        `Memory coverage: ${draft.view().revision ? `messages 1-${draft.view().revision?.coverage.end}` : "none"}; ${omittedClaims} optional completed claims omitted.`,
        `Retrieved conversation sources: ${conversationSources.join(", ") || "none"}; ${conversationOmitted} omitted.`,
        `Retrieved project/task sources: ${scopedSources.join(", ") || "none"}; ${scopedOmitted} omitted; ${scopedIssues} qualified source issues.`,
        `Output reserve: ${budget.reserve.toLocaleString()} tokens. ${calls} preparation inference calls; ${calls ? "monetary cost unavailable" : "no preparation inference cost"}.`,
        "Provider caches and hidden reasoning do not transfer. Project/task evidence is revalidated before use.",
      ],
      dispose: () => {
        preparedCompactor.dispose();
        options.signal.removeEventListener("abort", cancel);
        cancel();
      },
      commit: async () => {
        await preparedCompactor.validateEvidence();
        check();
        const latestProbe = await readSelfHostedSnapshot(
          preferences.selfHostedInference,
          options.modelId,
        );
        check();
        const latestCapabilities = resolveModelInputCapabilities(
          options.modelId,
          preferences.selfHostedInference,
          latestProbe,
        );
        if (
          (await contextDigest(latestCapabilities)) !==
          (await contextDigest(options.capabilities))
        )
          throw new Error("Target capabilities changed during preparation.");
        check();
        const currentLimits = await modelBudgetLimits(model);
        check();
        if (JSON.stringify(currentLimits) !== JSON.stringify(limits))
          throw new Error("Target context limits changed during preparation.");
        // This IPC is the commit point. Native CAS publishes both fields or neither.
        return commitTargetContext({
          token: source.token,
          settingsHash: source.settingsHash,
          expectedSession: source.session,
          preparation: source.view.preparation,
          modelId: options.modelId,
          key,
          candidate: draft.candidate(),
        });
      },
    };
  } catch (error) {
    compactor?.dispose();
    options.signal.removeEventListener("abort", cancel);
    cancel();
    throw error;
  }
}
