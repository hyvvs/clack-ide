import { expect, it } from "vitest";
import { chatActivityLabel } from "@/modules/ai/lib/chatActivityLabel";
import type { AgentMeta } from "@/modules/ai/store/chatStore";
import type { SessionRun } from "@/modules/ai/lib/sessions";

it.each([
  ["completed", "idle", null, "Done"],
  ["interrupted", "error", null, "Interrupted"],
  ["cancelled", "idle", null, "Stopped"],
  ["running", "retrying", null, "Retrying"],
  ["running", "awaiting-approval", null, "Awaiting approval"],
  ["running", "streaming", null, "Generating response"],
  ["running", "thinking", "read_file", "Reading workspace evidence"],
  ["running", "thinking", "request_peer_task", "Assigning work"],
])("presents %s/%s from actual runtime state", (state, status, step, expected) => {
  expect(
    chatActivityLabel({ state } as SessionRun, { status, step } as AgentMeta),
  ).toBe(expected);
});
