import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    private receiver: (event: unknown) => void = () => {};
    get onmessage() { return this.receiver; }
    set onmessage(fn: (event: unknown) => void) { this.receiver = fn; }
  },
}));

import { Channel } from "@tauri-apps/api/core";
import { installR5pCalibrationChannelAudit } from "./r5pCalibrationBoundaryAudit";

describe("R5p pre-calibration acceptance-only Channel observer", () => {
  it("receives exactly one fixed-stage header/chunk/terminal and preserves consumer delivery", () => {
    const stages: string[] = [];
    const restore = installR5pCalibrationChannelAudit(stage => stages.push(stage));
    try {
      const channel = new Channel<{ requestId: string; kind: string; phase?: string }>();
      const original = vi.fn();
      channel.onmessage = original;
      const head = { requestId: "inference-1", kind: "headers", private: "DO NOT LOG" };
      channel.onmessage(head);
      channel.onmessage({ requestId: "inference-1", kind: "chunk", bytes: [83, 69, 67, 82, 69, 84] } as never);
      channel.onmessage({ requestId: "inference-1", kind: "chunk", bytes: [1] } as never);
      channel.onmessage({ requestId: "inference-1", kind: "settled", phase: "completed" });
      expect(stages).toEqual(["channel-registered", "channel-headers", "channel-first-chunk", "channel-settled-completed"]);
      expect(original).toHaveBeenCalledTimes(4);
      expect(JSON.stringify(stages)).not.toMatch(/SECRET|DO NOT LOG|inference-1/);
    } finally {
      restore();
    }
  });
});
