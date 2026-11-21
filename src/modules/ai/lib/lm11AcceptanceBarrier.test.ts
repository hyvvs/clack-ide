import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { QualificationOperationDeadline } from "./deploymentQualificationFlight";
import { lm11AcceptanceBarrier } from "./lm11AcceptanceBarrier";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(invoke).mockReset();
});

describe("LM11 acceptance-only native barrier", () => {
  it("does nothing in normal build without invoking any native command", async () => {
    vi.stubEnv("VITE_CLACK_LM11_ACCEPTANCE", "0");
    const operation = new QualificationOperationDeadline(1_000);
    await lm11AcceptanceBarrier("predispatch", operation, "a");
    await lm11AcceptanceBarrier("b03-before-readback", undefined);
    expect(invoke).not.toHaveBeenCalled();
    operation.finish();
  });

  it("uses the exact stage/operation and refuses a released native hold after revoke", async () => {
    vi.stubEnv("VITE_CLACK_LM11_ACCEPTANCE", "1");
    let release!: () => void;
    vi.mocked(invoke).mockImplementation(() => new Promise<void>(resolve => {
      release = resolve;
    }) as never);
    const operation = new QualificationOperationDeadline(5_000);
    const pending = lm11AcceptanceBarrier("after-ai-http-open", operation, "a");
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith(
      "lm11_acceptance_barrier", { stage: "after-ai-http-open", sessionId: "a" },
    ));
    operation.stop("cancelled");
    await expect(pending).rejects.toThrow(/deadline|cancellation/);
    release();
    await Promise.resolve();
    await expect(lm11AcceptanceBarrier("terminal-delivery", operation, "a"))
      .rejects.toThrow();
    expect(invoke).toHaveBeenCalledTimes(1);
    operation.finish();
  });
});
