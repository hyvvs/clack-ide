import { describe, expect, it, vi } from "vitest";
import { respondToApprovalChoice } from "./AiToolApproval";

describe("approval choices", () => {
  it("denies without executing and allows one invocation only", () => {
    const respond = vi.fn();
    respondToApprovalChoice("deny", respond);
    respondToApprovalChoice("once", respond);
    expect(respond.mock.calls).toEqual([[false], [true]]);
  });
});
