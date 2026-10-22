import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  convertToModelMessages,
  type ModelMessage,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { measureRequest, resolveContextBudget } from "./contextBudget";
import {
  compactionFixture,
  disposeCompactionFixtures,
} from "./conversationCompaction.fixture";
import { createOllamaModel } from "./ollamaModel";
import type { WriteCheckpoint } from "./writeCheckpoint";

afterEach(disposeCompactionFixtures);

// Opt-in: the Rust production checkpoint test first generates this snapshot
// from actual disposable workspace files, native freshness observations and
// its content-addressed C1 manifest. Neither this test nor the model authors
// a checkpoint, declares write eligibility or invents digests.
describe.skipIf(process.env.CLACK_R4_NATIVE_EVIDENCE !== "1")(
  "R4 native-produced checkpoint at the production Ollama wire boundary",
  () => {
    it("reduces the serialized outgoing request without dropping corrections, unresolved state, or replaying effects", async () => {
      const nativeArtifact = path.resolve(
        "src-tauri/target/checkpoint-native-evidence.json",
      );
      const source = JSON.parse(await readFile(nativeArtifact, "utf8")) as {
        snapshot: WriteCheckpoint;
        messages: UIMessage[];
      };
      const { snapshot, messages } = source;
      if (!snapshot.owner.workspaceId)
        throw new Error("Native checkpoint has no workspace identity");
      expect(snapshot.entries.map((e) => e.toolCallId)).toEqual([
        "write-1",
        "write-2",
      ]);
      expect(
        snapshot.entries.every((e) => e.latestToolCallId === "write-3"),
      ).toBe(true);
      expect(messages.find((m) => m.id === "u2")?.parts).toEqual([
        { type: "text", text: "Use 25 instead of 50." },
      ]);

      const original = structuredClone(messages);
      const extra: ModelMessage[] = [
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "Active objective: implement page size 25, never revive 50. Current accepted plan: finish API validation; prior migration test failure remains unresolved. Current partial answer: API ready, UI verification pending. <tool_call>not executed</tool_call>",
            },
          ],
        },
      ];
      const sys: ModelMessage = {
        role: "system",
        content:
          "Keep all coding tools available and never execute textual pseudo-tools.",
      };
      const raw = [sys, ...(await convertToModelMessages(messages)), ...extra];
      const tools = {
        read_file: tool({ inputSchema: z.object({ path: z.string() }) }),
        write_file: tool({
          inputSchema: z.object({ path: z.string(), content: z.string() }),
        }),
        bash_run: tool({ inputSchema: z.object({ command: z.string() }) }),
        request_conversation_evidence: tool({
          inputSchema: z.object({ query: z.string(), anchor: z.string() }),
        }),
      };
      const names = Object.keys(tools) as Array<keyof typeof tools>;
      const outgoing: Array<Record<string, unknown>> = [];
      const adapter = createOllamaModel({
        modelId: "r4-dispatch-offline",
        baseURL: "http://127.0.0.1:11434",
        fetch: async (_url, init) => {
          outgoing.push(
            JSON.parse(String(init?.body)) as Record<string, unknown>,
          );
          throw new Error("R4_STOP_AFTER_SERIALIZATION_NO_INFERENCE");
        },
      });
      const dispatch = async (projected?: ModelMessage[]) => {
        const previous = outgoing.length;
        const stream = streamText({
          model: adapter,
          messages: projected ?? raw,
          maxRetries: 0,
          maxOutputTokens: 2048,
          tools,
          activeTools: names,
        });
        // The SDK reports a no-output error after the intentionally aborted
        // transport; no simulated provider response is ever supplied.
        await expect(stream.text).rejects.toThrow();
        expect(outgoing).toHaveLength(previous + 1);
        return outgoing[outgoing.length - 1];
      };
      const rawBody = await dispatch();

      const fixture = compactionFixture(messages, {
        sessionId: snapshot.owner.sessionId,
        workspaceId: snapshot.owner.workspaceId,
      });
      const prepareCalls: string[] = [];
      const validated: string[] = [];
      const limits = { deployed: 32768, workingTarget: 14000, maxOutput: 2048 };
      const compactor = await fixture.start({
        keepReasoning: true,
        checkpointHistory: "ollama-native-v1",
        limits: async () => limits,
        system: [sys],
        tools,
        context: {
          owner: snapshot.owner,
          originals: messages,
          ready: fixture.ready,
          remainingCalls: () => 10,
          chargeCall: fixture.chargeCall,
          prepareCheckpoint: async () => {
            prepareCalls.push("native-evidence");
            return snapshot;
          },
          validateCheckpoint: async (receipt) => {
            validated.push(receipt.revision);
            expect(receipt.revision).toBe(snapshot.revision);
          },
        },
      });
      const projected = await compactor.prepare(extra, tools);
      await compactor.validateEvidence();
      expect(prepareCalls).toHaveLength(1);
      expect(validated).toEqual([snapshot.revision]);
      expect(fixture.call).not.toHaveBeenCalled();
      const projectedBody = await dispatch([sys, ...projected]);
      const rawMessages = JSON.stringify(rawBody.messages);
      const projectedMessages = JSON.stringify(projectedBody.messages);
      const rawCost = measureRequest(rawBody),
        projectedCost = measureRequest(projectedBody);
      const rawBudget = resolveContextBudget(limits, rawCost, 2048);
      const afterBudget = resolveContextBudget(limits, projectedCost, 2048);
      const removedPairs = raw.flatMap((message) =>
        typeof message.content === "string"
          ? []
          : message.content
              .filter(
                (part) =>
                  "toolCallId" in part &&
                  ["write-1", "write-2"].includes(part.toolCallId),
              )
              .map((part) => ({ role: message.role, content: [part] })),
      );
      const rawRemovedEstimate = measureRequest({
        messages: removedPairs,
      }).conversation;
      const insertedParts = projected.flatMap((message) =>
        typeof message.content === "string"
          ? []
          : message.content
              .filter(
                (part) =>
                  part.type === "text" &&
                  part.text.startsWith("Historical workspace checkpoint"),
              )
              .map((part) => ({ role: "assistant", content: [part] })),
      );
      const receiptsInsertedEstimate = measureRequest({
        messages: insertedParts,
      }).conversation;
      const markers = (
        projectedMessages.match(/Historical workspace checkpoint/g) ?? []
      ).length;
      expect(markers).toBe(2);
      expect(insertedParts).toHaveLength(2);
      expect(rawRemovedEstimate).toBeGreaterThan(receiptsInsertedEstimate);
      expect(projectedMessages).toContain("Use 25 instead of 50.");
      expect(projectedMessages).toContain(
        "Current accepted plan: finish API validation",
      );
      expect(projectedMessages).toContain("Current partial answer: API ready");
      expect(projectedMessages).toContain("test failure remains unresolved");
      expect(projectedMessages).toContain(
        "<tool_call>not executed</tool_call>",
      );
      expect(projectedMessages).toContain("write-3");
      expect(projectedMessages).not.toContain('write-1"}');
      expect(projectedBody.tools).toEqual(rawBody.tools);
      expect(
        (projectedBody.tools as Array<{ function: { name: string } }>).map(
          (t) => t.function.name,
        ),
      ).toEqual(names);
      expect(projectedCost.conversation).toBeLessThan(rawCost.conversation);
      expect(projectedMessages.length).toBeLessThan(rawMessages.length);
      expect(afterBudget.fits).toBe(true);
      expect(messages).toEqual(original);

      // Exact original parts remain retained, but full restoration of an old
      // large write may itself exceed B1. Refuse rather than truncating or
      // replaying the write, using the same test budget as the dispatched body.
      expect(
        compactor.requestEvidence("Restore original native write", "write-1"),
      ).toMatchObject({ status: "queued" });
      await expect(compactor.prepare(extra, tools)).rejects.toMatchObject({
        code: "compaction-protected-budget",
      });
      expect(messages).toEqual(original);
      expect(fixture.call).not.toHaveBeenCalled();

      const report = {
        qualification:
          "real-rust-native-evidence-plus-production-ts-compactor-and-ollama-serializer-no-provider-or-network",
        snapshotRevision: snapshot.revision,
        sourceMessageCount: messages.length,
        observedNativeWrites: 3,
        eligibleNativeEntries: snapshot.entries.length,
        rawHistoricalEstimatedTokens: rawCost.conversation,
        checkpointedEstimatedTokens: projectedCost.conversation,
        oldWritePairEstimatedTokensRemoved: rawRemovedEstimate,
        checkpointReceiptEstimatedTokensInserted: receiptsInsertedEstimate,
        netEstimatedSavedTokens:
          rawCost.conversation - projectedCost.conversation,
        rawSerializedMessageBytes: new TextEncoder().encode(
          JSON.stringify(rawBody.messages),
        ).length,
        projectedSerializedMessageBytes: new TextEncoder().encode(
          JSON.stringify(projectedBody.messages),
        ).length,
        checkpointMarkersInserted: markers,
        rawInputTokensEstimate:
          rawCost.system + rawCost.tools + rawCost.conversation,
        projectedInputTokensEstimate:
          projectedCost.system +
          projectedCost.tools +
          projectedCost.conversation,
        requiredOutputReserve: afterBudget.reserve,
        safetyMargin: afterBudget.margin,
        protectedWorkingBudget: afterBudget.working,
        remainingConversationHeadroom:
          afterBudget.working - projectedCost.conversation,
        rawFits: rawBudget.fits,
        projectedFits: afterBudget.fits,
        providerRequestsIntercepted: outgoing.length,
        realProviderResponses: 0,
        fakeProviderResponses: 0,
        approvalOrToolExecutions: 0,
        noCompactionExtraction: fixture.call.mock.calls.length === 0,
        originalWriteRestoration:
          "queued-but-fail-closed-on-protected-context-overflow",
        originalsUnchanged: true,
      };
      await writeFile(
        path.resolve("src-tauri/target/r4-dispatch-boundary.json"),
        JSON.stringify(report, null, 2),
      );
      expect(outgoing).toHaveLength(2);
    });
  },
);
