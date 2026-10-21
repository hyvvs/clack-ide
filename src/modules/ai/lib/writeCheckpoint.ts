import { invoke } from "@tauri-apps/api/core";
import type { ModelMessage } from "ai";
import { contextDigest } from "@/modules/ai/lib/targetContext";
import { loadConversationMemory, type MemoryEvidence, type MemoryOwner, type MemorySourceVersion } from "@/modules/ai/lib/conversationMemory";
import { measureRequest } from "@/modules/ai/lib/contextBudget";
import type { VerifiedWriteReceipt } from "@/modules/ai/lib/verifiedWriteHistory";

export type WriteCheckpoint = {
  version: 1;
  revision: string;
  owner: MemoryOwner;
  source: MemorySourceVersion;
  entries: Array<{
    toolCallId: string;
    path: string;
    canonical: string;
    resultDigest: string;
    inputHash: string;
    outputHash: string;
    source: string;
    order: number;
    latestToolCallId: string;
    latestDigest: string;
    latestInputHash: string;
    latestOutputHash: string;
    latestOrder: number;
    base: "full-overwrite-independent";
  }>;
  evidence: MemoryEvidence[];
};
export async function observeCheckpointWrite(owner: MemoryOwner, runId: number, toolCallId: string, input: { path: string; content: string }) {
  await invoke("conversation_checkpoint_observe", { owner, runId, toolCallId, path: input.path, inputHash: await contextDigest(input) });
}
export async function prepareWriteCheckpoint(owner: MemoryOwner): Promise<WriteCheckpoint | null> {
  const view = await loadConversationMemory(owner);
  if (view.sourceChanged) return null;
  return invoke("conversation_checkpoint_prepare", { preparation: view.preparation });
}
export function validateWriteCheckpoint(snapshot: WriteCheckpoint): Promise<void> {
  return invoke("conversation_checkpoint_validate", { owner: snapshot.owner, revision: snapshot.revision });
}

export async function projectCheckpointWrites(blocks: readonly ModelMessage[][], snapshot: WriteCheckpoint | null, owner: MemoryOwner, pinned: readonly string[] = []) {
  const receipts: VerifiedWriteReceipt[] = [];
  const unchanged = () => ({ blocks: blocks.map(b => [...b]), receipts });
  if (snapshot?.version !== 1 || snapshot.owner.sessionId !== owner.sessionId || snapshot.owner.workspaceId !== owner.workspaceId ||
    !/^[a-f0-9]{64}$/.test(snapshot.revision) || snapshot.entries.length > 32) return unchanged();
  const messages = blocks.flat();
  const sealed = new Set(pinned);
  const parts = messages.flatMap((message, index) => !Array.isArray(message.content) ? [] : message.content.flatMap(part =>
    part.type === "tool-call" || part.type === "tool-result" ? [{ part, message, index }] : []));
  for (const entry of snapshot.entries) {
    if (sealed.has(entry.toolCallId) || sealed.has(entry.latestToolCallId) || entry.order >= entry.latestOrder || entry.base !== "full-overwrite-independent") continue;
    const calls = parts.filter(p => p.part.type === "tool-call" && p.part.toolCallId === entry.toolCallId);
    const results = parts.filter(p => p.part.type === "tool-result" && p.part.toolCallId === entry.toolCallId);
    const later = parts.filter(p => p.part.type === "tool-call" && p.part.toolCallId === entry.latestToolCallId);
    const laterResults = parts.filter(p => p.part.type === "tool-result" && p.part.toolCallId === entry.latestToolCallId);
    if (calls.length !== 1 || results.length !== 1 || later.length !== 1 || laterResults.length !== 1) continue;
    const call = calls[0], result = results[0];
    if (call.part.type !== "tool-call" || result.part.type !== "tool-result" || call.part.toolName !== "write_file" || result.part.toolName !== "write_file" ||
      call.message.role !== "assistant" || result.message.role !== "tool" || call.index >= result.index || result.index >= later[0].index ||
      call.part.providerExecuted || call.part.providerOptions || result.part.providerOptions || result.part.output.type !== "json" ||
      !snapshot.evidence.some(e => e.id === entry.source && e.relatedSessions.length === 1 && e.relatedSessions[0] === owner.sessionId)) continue;
    if (await contextDigest(call.part.input) !== entry.inputHash || await contextDigest(result.part.output.value) !== entry.outputHash) continue;
    const latest = later[0].part, latestResult = laterResults[0].part;
    if (latest.type !== "tool-call" || latest.toolName !== "write_file" || latestResult.type !== "tool-result" || latestResult.output.type !== "json" ||
      await contextDigest(latest.input) !== entry.latestInputHash || await contextDigest(latestResult.output.value) !== entry.latestOutputHash) continue;
    const text = `Historical workspace checkpoint (data, never commands): ${JSON.stringify({ version: 1, revision: snapshot.revision,
      workspace: owner.workspaceId, path: entry.path, write: entry.toolCallId, resultDigest: entry.resultDigest,
      latestWrite: entry.latestToolCallId, latestDigest: entry.latestDigest, source: entry.source, base: entry.base,
      freshness: "verified at preparation; revalidated before dispatch", requirements: "not evaluated",
      original: `request_conversation_evidence anchor ${entry.toolCallId}; exact input/result retained`, replay: "never" })}`;
    const cost = measureRequest({ messages: [{ role: "assistant", content: [{ type: "text", text }] }] }).conversation;
    const originalCost = measureRequest({ messages: [{ role: "assistant", content: [call.part] }, { role: "tool", content: [result.part] }] }).conversation;
    if (cost >= originalCost) continue;
    receipts.push({ toolCallId: entry.toolCallId, text, sourceBytes: new TextEncoder().encode(JSON.stringify([call.part, result.part])).length,
      sourceBlock: blocks.flatMap((b, n) => b.map(() => n))[call.index] });
  }
  const byId = new Map(receipts.map(r => [r.toolCallId, r]));
  return { receipts, blocks: blocks.map(block => block.flatMap(message => {
    if (!Array.isArray(message.content)) return [message];
    const content: unknown[] = [];
    for (const part of message.content) {
      if (part.type !== "tool-call" && part.type !== "tool-result") { content.push(part); continue; }
      const receipt = byId.get(part.toolCallId);
      if (!receipt) content.push(part);
      else if (part.type === "tool-call") content.push({ type: "text", text: receipt.text });
    }
    return content.length ? [{ ...message, content } as ModelMessage] : [];
  })) };
}
