import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage: (event: unknown) => void = () => {};
  },
}));

import { invoke } from "@tauri-apps/api/core";
import { createProxyFetch } from "./proxyFetch";
import {
  QualificationOperationDeadline,
  armDeploymentQualification,
  disarmDeploymentQualification,
  qualificationDispatchAuthority,
} from "./deploymentQualificationFlight";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

type OriginalChannel = {
  onmessage: (value: unknown) => void;
};
let operation: QualificationOperationDeadline;
let heldOutput: ReturnType<typeof deferred<void>>;

beforeEach(() => {
  vi.stubEnv("VITE_CLACK_LM11_ACCEPTANCE", "1");
  heldOutput = deferred<void>();
  operation = new QualificationOperationDeadline(120_000);
  armDeploymentQualification("s-lm11-channel-deadline",
    "managed-synthetic", "builtin:coder", { operation });
  vi.mocked(invoke).mockReset();
});

afterEach(() => {
  heldOutput.resolve();
  operation.stop("cancelled");
  operation.finish();
  disarmDeploymentQualification("s-lm11-channel-deadline");
  vi.unstubAllEnvs();
});

describe("LM11 original queued Channel delivery and native command ACK ordering", () => {
  it("does not report a missing terminal after five seconds when the already-arrived original terminal is queued behind a held first output", async () => {
    let nativeChannel: OriginalChannel | null = null;
    const authority = qualificationDispatchAuthority("s-lm11-channel-deadline")!;
    vi.mocked(invoke).mockImplementation((command, args) => {
      if (command === "ai_http_open") return Promise.resolve("inference-2") as never;
      if (command === "lm11_acceptance_barrier") {
        const stage = (args as { stage: string }).stage;
        return (stage === "first-output" ? heldOutput.promise : Promise.resolve()) as never;
      }
      if (command === "ai_http_stream") {
        nativeChannel = (args as { onEvent: OriginalChannel }).onEvent;
        return Promise.resolve() as never;
      }
      if (command === "ai_http_cancel") return Promise.resolve() as never;
      throw new Error("Unexpected native command: "+command);
    });
    const response = createProxyFetch({
      selfHosted: true, allowPrivateNetwork: true,
      scope: {
        sessionId: "s-lm11-channel-deadline",
        runId: "original-qualification",
        isCurrent: authority,
      },
    })("http://localhost/v1/chat/completions", {
      method: "POST", body: "{}",
    });
    await vi.waitFor(() => expect(nativeChannel).not.toBeNull());
    const channel = nativeChannel!;
    channel.onmessage({
      kind: "headers", requestId: "inference-2",
      status: 200, headers: { "content-type": "text/event-stream" },
    });
    channel.onmessage({
      kind: "chunk", requestId: "inference-2", bytes: [65],
    });
    channel.onmessage({
      kind: "settled", requestId: "inference-2", phase: "completed",
    });
    const text= response.then(r => r.text()).catch(error => error);
    let settled = false;
    void text.then(() => { settled = true; });

    // The original terminal was queued before native command acknowledgement.
    // A 5s local missing-terminal timer is not allowed to beat the unchanged
    // 120s operation timer solely because the acceptance hook holds delivery.
    await new Promise(resolve => setTimeout(resolve, 5_250));
    const stillHeld = !settled && operation.isOpen();
    heldOutput.resolve();
    const output = await text;
    expect(stillHeld).toBe(true);
    expect(output).toBe("A");
  }, 10_000);
});
