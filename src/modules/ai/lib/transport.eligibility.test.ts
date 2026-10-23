import { expect, it, vi } from "vitest";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";
import { emptySelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import type { ToolContext } from "@/modules/ai/tools/tools";

const { runAgentStream } = vi.hoisted(() => ({ runAgentStream: vi.fn() }));
vi.mock("@/modules/ai/lib/agent", () => ({ runAgentStream }));
import { createContextAwareTransport } from "@/modules/ai/lib/transport";

it("R5m: logical batches retain only same-run proof accepted by the Agent boundary", async () => {
  const original = emptySelfHostedState();
  const accepted = { ...original, revision: original.revision + 1 };
  let runId = "run-A";
  let logical = false;
  const seen: unknown[] = [];
  runAgentStream.mockImplementation(async (opts) => {
    seen.push(opts.selfHostedInference);
    if (!logical) opts.onSelfHostedPrepared?.(accepted);
    return { toUIMessageStream: () => new ReadableStream() };
  });
  const transport = createContextAwareTransport({
    getInferenceScope: () => ({ sessionId: "session", runId, isCurrent: () => true }),
    getSelfHostedInference: () => original,
    onBatchStart: () => ({ isLogicalContinuation: logical }),
    getKeys: () => ({ ...EMPTY_PROVIDER_KEYS }),
    toolContext: {} as ToolContext,
    getModelId: () => "gpt-5.4-mini",
    getCustomInstructions: () => "",
    getAgentPersona: () => null,
    getLive: () => ({ cwd: null, terminalPrivate: false, workspaceRoot: null, activeFile: null }),
  });
  await transport.sendMessages({ messages: [] });
  logical = true;
  await transport.sendMessages({ messages: [] });
  expect(seen[0]).toEqual(original);
  expect(seen[1]).toEqual(accepted);
  runId = "run-B";
  await transport.sendMessages({ messages: [] });
  expect(seen[2]).toEqual(original); // no proof from another run
  expect(runAgentStream).toHaveBeenCalledTimes(3);
});
