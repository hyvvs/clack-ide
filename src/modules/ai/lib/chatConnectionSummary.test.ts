import { expect, it } from "vitest";
import { chatConnectionSummary } from "@/modules/ai/lib/chatConnectionSummary";
import {
  createSavedProviderModel,
  savedProviderModelSelectionId,
} from "@/modules/ai/lib/savedProviderModels";
import type { SessionMeta } from "@/modules/ai/lib/sessions";

const evidence = {
  version: 1 as const,
  providerId: "openrouter" as const,
  modelId: "test/exact:free",
  origin: "provider-metadata" as const,
  lookup: "exact-model" as const,
  observedAt: Date.now(),
  context: 12345,
  capabilities: {
    supportedParameters: ["structured_outputs"],
    inputModalities: ["text"],
    outputModalities: ["text"],
  },
};
const model = createSavedProviderModel(
  {
    providerId: "openrouter",
    transportModelId: evidence.modelId,
    providerEvidence: evidence,
  },
  "exact",
);
const session: SessionMeta = {
  id: "a",
  title: "Renamed",
  createdAt: 1,
  updatedAt: 1,
  profile: {
    agentId: "custom:captain",
    modelId: savedProviderModelSelectionId(model.id),
    workspaceId: "local:/a",
    workspaceRoot: "/a",
  },
};
it("shows exact variant metadata without another lookup or family inference", () => {
  expect(
    chatConnectionSummary(session, { savedProviderModels: [model] }),
  ).toMatchObject({
    identity: { transportModelId: evidence.modelId },
    destination: "Cloud connection",
    capabilities: { tools: "unsupported", structuredOutputs: "supported" },
    evidence: { context: 12345 },
    connectionId: "openrouter",
  });
});
it("shows captured run route instead of a newly edited connection", () => {
  const running = {
    ...session,
    run: {
      state: "running" as const,
      startedAt: 1,
      agentId: "custom:captain",
      modelId: "compat-connection",
      providerId: "openai-compatible" as const,
      transportModelId: "captured-exact",
      endpointBaseURL: "http://127.0.0.1:1234/v1",
      customEndpointId: "connection",
    },
  };
  const summary = chatConnectionSummary(running, { customEndpoints: [] });
  expect(summary.identity?.transportModelId).toBe("captured-exact");
  expect(summary.destination).toContain("Same-PC address");
  expect(summary.destination).toContain("127.0.0.1:1234");
  expect(summary.connectionId).toBe("connection");
});
it("keeps missing configuration and uncaptured running routes unknown", () => {
  expect(chatConnectionSummary(session, {}).identity).toBeNull();
  expect(chatConnectionSummary(session, {}).destination).toBe(
    "Destination unknown",
  );
  expect(
    chatConnectionSummary(
      {
        ...session,
        run: {
          state: "running",
          startedAt: 1,
          agentId: "a",
          modelId: "missing",
        },
      },
      {},
    ).destination,
  ).toBe("Destination unknown");
});
