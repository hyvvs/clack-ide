import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";
import type { ToolContext } from "@/modules/ai/tools/tools";

const { runAgentStream } = vi.hoisted(() => ({ runAgentStream: vi.fn() }));

vi.mock("@/modules/ai/lib/agent", () => ({ runAgentStream }));

import { createContextAwareTransport } from "@/modules/ai/lib/transport";

describe("AI transport error preservation", () => {
  beforeEach(() => {
    runAgentStream.mockReset();
  });

  it("passes the original stream error to Clack's error handler", async () => {
    let streamOptions: { onError?: (error: unknown) => string } | undefined;
    runAgentStream.mockResolvedValue({
      toUIMessageStream: vi.fn((options) => {
        streamOptions = options;
        return new ReadableStream();
      }),
    });
    const onError = vi.fn(() => "Safe provider failure");
    const transport = createContextAwareTransport({
      getKeys: () => ({ ...EMPTY_PROVIDER_KEYS }),
      toolContext: {} as ToolContext,
      getModelId: () => "test-model",
      getCustomInstructions: () => "",
      getAgentPersona: () => null,
      getLive: () => ({
        cwd: null,
        terminalPrivate: false,
        workspaceRoot: null,
        activeFile: null,
      }),
      onError,
    });
    const original = {
      name: "AI_APICallError",
      statusCode: 503,
      responseBody: '{"error":{"message":"maintenance"}}',
    };

    await transport.sendMessages({ messages: [] });
    const safeText = streamOptions?.onError?.(original);

    expect(onError).toHaveBeenCalledWith(original);
    expect(safeText).toBe("Safe provider failure");
  });
});
