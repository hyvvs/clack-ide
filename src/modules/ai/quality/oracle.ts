import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import type { UIMessage, ModelMessage } from "ai";
import corpus from "@/modules/ai/quality/corpus.json";
import {
  measureRequest,
  resolveContextBudget,
} from "@/modules/ai/lib/contextBudget";
import type { MemoryView } from "@/modules/ai/lib/conversationMemory";

export { corpus };
export const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function assertPrivateAbsent(value: unknown) {
  const wire = JSON.stringify(value);
  for (const canary of corpus.canaries) expect(wire).not.toContain(canary);
}
export function sourceOracle(view: MemoryView, originals: UIMessage[]) {
  const evidence = new Map(view.revision?.evidence.map((e) => [e.id, e]) ?? []);
  let references = 0;
  for (const claim of view.revision?.claims ?? []) {
    expect(claim.sources.length).toBeGreaterThan(0);
    for (const id of claim.sources) {
      references++;
      const source = evidence.get(id);
      expect(source, `Unresolved evidence ${id}`).toBeDefined();
      expect(source?.relatedSessions).toEqual([corpus.conversationId]);
      if (source?.locator.kind !== "message")
        throw new Error("Q1 fixture expects original message evidence");
      const messageId = source.locator.messageId;
      const index = originals.findIndex((message) => message.id === messageId);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(view.revision?.coverage.end ?? 0);
    }
  }
  return references;
}
export function contextScore(
  messages: ModelMessage[],
  critical = corpus.critical,
  workingTarget = 6000,
) {
  const text = JSON.stringify(messages);
  const matched = (value: string) =>
    text.includes(JSON.stringify(value).slice(1, -1));
  return {
    criticalRetained: critical.filter((item) => matched(item.text)).length,
    criticalTotal: critical.length,
    noncriticalRecall: corpus.noncritical.filter((item) => matched(item.text))
      .length,
    noncriticalTotal: corpus.noncritical.length,
    conversationTokens: measureRequest({ messages }).conversation,
    fitsSmall: resolveContextBudget(
      { deployed: 32768, workingTarget },
      measureRequest({ messages }),
    ).fits,
    fitsFull: resolveContextBudget(
      { deployed: 128000 },
      measureRequest({ messages }),
    ).fits,
  };
}
export function recordMetrics(name: string, value: Record<string, unknown>) {
  // Only aggregate synthetic measurements, never source text or intercepted bodies.
  const directory = process.env.CLACK_Q1_METRICS_DIR;
  if (directory)
    writeFileSync(
      join(directory, `${name}.json`),
      JSON.stringify({ fixtureVersion: corpus.version, ...value }, null, 2),
    );
}
