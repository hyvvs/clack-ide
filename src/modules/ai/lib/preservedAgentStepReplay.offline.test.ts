/**
 * Read-only, deterministic replay of the frozen 58-step Agent transcript.
 * Never dispatches a model, tool, network request, or application acceptance.
 * The archival path is intentionally optional for clean source checkouts.
 * This current-source test complements native Rust commit/reload tests; its
 * in-memory bridge cannot stand in for a real Tauri IPC transaction.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { UIMessage, ModelMessage } from "ai";
import { conversationCompactionUnits } from "@/modules/ai/lib/conversationCompaction";
import { groupCompactionUnits, planCompaction } from "@/modules/ai/lib/compactionPlan";
import { measureRequest, resolveContextBudget } from "@/modules/ai/lib/contextBudget";
import { compactionFixture, disposeCompactionFixtures } from "@/modules/ai/lib/conversationCompaction.fixture";

const archive = path.resolve("src-tauri/target/real-qwen-product/forgeboardmuse-20261106-01/data/terax-ai-sessions.json");
const limits = { deployed: 49152, outputReserve: 6144, maxOutput: 6144 };
afterEach(disposeCompactionFixtures);

function firstSteps(original: UIMessage[], count: number) {
  const starts = original[1].parts.flatMap((part, index) => part.type === "step-start" ? [index] : []);
  if (starts.length !== 58) throw new Error("Frozen Agent step count changed");
  return [original[0], {
    ...original[1],
    parts: original[1].parts.slice(0, starts[count] ?? original[1].parts.length),
  }] as UIMessage[];
}

function matchingOverhead(): { system: ModelMessage[]; tools: unknown } {
  // Reconstruct the archived aggregate production-estimate overhead, not the
  // original literal system prompt or the actual native tool schemas.
  const system: ModelMessage[] = [{ role: "system", content: "" }];
  const schema = { type: "function", function: { name: "offline-tool", parameters: { type: "object", description: "" } } };
  const tools = [schema];
  const tune = (target: number, set: (size: number) => void, cost: () => number) => {
    let lo = 0, hi = target * 5;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      set(mid);
      if (cost() < target) lo = mid + 1;
      else hi = mid;
    }
    set(lo);
    expect(cost()).toBe(target);
  };
  tune(4814, n => { system[0] = { role: "system", content: "a".repeat(n) }; },
    () => measureRequest({ messages: system }).system);
  tune(2819, n => { schema.function.parameters.description = "b".repeat(n); },
    () => measureRequest({ tools }).tools);
  return { system, tools };
}

describe.skipIf(!fs.existsSync(archive))("archived 58-step Agent native-like replay (offline only)", () => {
  it("passes the production coordinator's bounded extraction, commit, reload and 58-step continuation", async () => {
    const persisted = JSON.parse(fs.readFileSync(archive, "utf8"));
    const source: UIMessage[] = persisted["messages:real-mission-a"];
    expect(source).toHaveLength(2);
    const at42 = firstSteps(source, 42);
    const beforeHash = JSON.stringify(source);
    const { system, tools } = matchingOverhead();
    const legacy = await conversationCompactionUnits(source, source, "chat-a");
    const finer = await conversationCompactionUnits(source, source, "chat-a", false, true);
    expect(groupCompactionUnits(legacy)).toHaveLength(2);
    expect(groupCompactionUnits(finer).filter(g => !g.protected)).toHaveLength(50);
    expect(legacy.flatMap(u => u.messages)).toEqual(finer.flatMap(u => u.messages));
    expect(() => planCompaction({ units: legacy, system, tools, limits })).toThrowError(
      expect.objectContaining({ code: "compaction-protected-budget" }));

    const f = compactionFixture(at42);
    const extractor = f.call.getMockImplementation();
    if (!extractor) throw new Error("Missing offline mock extractor");
    f.call.mockImplementation(async request => {
      // The summary carries provenance and outcomes as *inferences*. A
      // historical tool report never becomes a reverified workspace write.
      const body = JSON.parse(request.messages[1].content as string) as {
        sources: Array<{ id: string; passages: string[] }>;
      };
      return {
        text: JSON.stringify({ claims: body.sources.map(item => {
          const tool = item.passages.flatMap(text => {
            try {
              const parsed = JSON.parse(text) as { type?: string; toolCallId?: string; state?: string; output?: unknown };
              return parsed.toolCallId ? [parsed] : [];
            } catch { return []; }
          })[0];
          const source = tool ? item.passages.find(text => text.includes(tool.toolCallId ?? "")) : item.passages[0];
          const quote = (source ?? "").slice(0, 40);
          const failed = tool?.output && JSON.stringify(tool.output).match(/"error"|"exit_code":(?:[1-9]|-)/);
          return {
            source: item.id,
            section: failed ? "errors" : "project-state",
            text: tool
              ? `${tool.type} ${tool.toolCallId}: ${failed ? "failed" : "result recorded"}; effect unverified`
              : "Assistant observation unverified",
            quote,
            status: failed ? "unresolved" : "inference",
            contradicts: [],
          };
        }) }),
        usage: { inputTokens: 100, outputTokens: 100, cachedInputTokens: 0 },
      };
    });
    const at42Compactor = await f.start({ system, tools, limits: async () => limits });
    const staged = await at42Compactor.prepare();
    const firstCoverage = f.view().revision?.coverage.end;
    const firstClaims = f.view().revision?.claims.length;
    const firstEvidence = f.view().revision?.evidence.length;
    expect(f.view().revision?.coverage.unitMode).toBe("agent-steps-v1");
    expect(f.view().revision?.coverage.end).toBeGreaterThan(2);
    expect(resolveContextBudget(limits, measureRequest({ messages: staged, tools })).fits).toBe(true);
    expect(f.view().revision?.evidence.every(e => e.locator.kind === "agentStep")).toBe(true);
    at42Compactor.dispose();

    f.originals[1].parts = structuredClone(source[1].parts);
    const continued = await f.start({ system, tools, limits: async () => limits });
    const finalContext = await continued.prepare();
    const finalBudget = resolveContextBudget(limits, measureRequest({ messages: finalContext, tools }));
    expect(finalBudget.ceiling).toBe(49152);
    expect(finalBudget.reserve).toBe(6144);
    expect(finalBudget.fits).toBe(true);
    const finalText = JSON.stringify(finalContext);
    expect(finalText).toContain("Build"); // original task, without treating it as extracted evidence
    expect(finalText).toContain("bash_run");
    expect(f.view().revision?.policyVersion).toBe("c1b-extraction-agent-steps-v1");
    expect(JSON.stringify(source)).toBe(beforeHash);
    console.log("ARCHIVED_AGENT_STEP_REPLAY=" + JSON.stringify({
      originalGroups: 2, proposedGroups: 59, compactableGroups: 50,
      afterStep: 42, firstCoverage, firstClaims, firstEvidence,
      firstBudget: resolveContextBudget(limits, measureRequest({ messages: staged, tools })).cost,
      finalBudget: finalBudget.cost, finalFits: finalBudget.fits,
      finalCoverage: f.view().revision?.coverage.end,
      outputReserve: finalBudget.reserve, trustedCeiling: finalBudget.ceiling,
      nativeCommitInThisTest: false,
      separateNativeArchiveCommitTest: "archived_58_step_forgeboard_native_commit_and_continuation_preserve_identity",
    }));
  });
});
