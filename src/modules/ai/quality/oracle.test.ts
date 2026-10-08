import { expect, it } from "vitest";
import {
  assertPrivateAbsent,
  contextScore,
  corpus,
  sourceOracle,
} from "@/modules/ai/quality/oracle";
import type { MemoryView } from "@/modules/ai/lib/conversationMemory";

it("Q1 oracle detects every unrelated canary, not just a matching summary", () => {
  for (const canary of corpus.canaries)
    expect(() => assertPrivateAbsent([{ payload: canary }])).toThrow();
});
it("Q1 oracle counts numeric/negated/non-English critical requirements literally", () => {
  expect(
    contextScore([
      { role: "user", content: corpus.critical.map((c) => c.text).join("\n") },
    ]).criticalRetained,
  ).toBe(4);
  expect(
    contextScore([
      {
        role: "user",
        content: "Deploy freely; use port 8080 and 20 concurrent requests",
      },
    ]).criticalRetained,
  ).toBe(0);
});
it("Q1 oracle refuses fabricated and cross-conversation evidence", () => {
  const view = {
    revision: {
      claims: [{ sources: ["fake"] }],
      evidence: [],
      coverage: { end: 1 },
    },
  } as unknown as MemoryView;
  expect(() => sourceOracle(view, [])).toThrow();
  if (!view.revision) throw new Error("Missing fixture revision");
  view.revision.evidence = [
    {
      id: "fake",
      digest: "a".repeat(64),
      sourceRevision: 1,
      contentIds: [],
      relatedSessions: ["unrelated"],
      locator: { kind: "message", messageId: "foreign" },
    },
  ];
  expect(() =>
    sourceOracle(view, [{ id: "foreign", role: "user", parts: [] }]),
  ).toThrow();
});
