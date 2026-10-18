import { canonicalJson } from "@/modules/ai/lib/canonicalJson";
import { measureRequest } from "@/modules/ai/lib/contextBudget";
import { contextDigest } from "@/modules/ai/lib/targetContext";
import type {
  MemoryEvidence,
  MemorySourceLocator,
} from "@/modules/ai/lib/conversationMemory";
import type { ModelMessage, UIMessage } from "ai";

type Part = {
  type: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  providerExecuted?: boolean;
};
type Input = { path: string; content: string };
type Output = {
  path: string;
  bytesWritten: number;
  ok: true;
  clackWorkspaceWrite: true;
};
export type VerifiedWriteCandidate = {
  toolCallId: string;
  input: Input;
  output: Output;
  call: Part;
  result: Part;
  callIndex: number;
  resultIndex: number;
  followedBy: string;
};
export type VerifiedWriteSource = {
  toolCallId: string;
  input: Input;
  output: Output;
  sessionId: string;
  messageId: string;
  partIndex: number;
  digest: string;
};
export type VerifiedWriteReceipt = {
  toolCallId: string;
  sourceBlock: number;
  sourceBytes: number;
  text: string;
};
const parts = (message: ModelMessage): Part[] =>
  Array.isArray(message.content) ? (message.content as Part[]) : [];
const object = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const keys = (value: Record<string, unknown>, names: string[]) =>
  Object.keys(value).length === names.length &&
  names.every((name) => name in value);
function absolute(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 4096 &&
    /^(?:[A-Za-z]:\/|\/(?!\/))/.test(value) &&
    !value.includes("\\") &&
    !value.split("/").some((part) => part === "." || part === "..") &&
    !/[\x00-\x1f]/.test(value)
  );
}

export function verifiedWriteCandidates(
  messages: readonly ModelMessage[],
  pinned: readonly string[] = [],
): VerifiedWriteCandidate[] {
  type Located = { part: Part; index: number; boundary: number; role: string };
  const calls = new Map<string, Located>(),
    results = new Map<string, Located>();
  const sealed = new Set(pinned),
    approvals = new Set<number>();
  let boundary = 0;
  for (const [index, message] of messages.entries()) {
    if (message.role === "user" || message.role === "system") boundary++;
    for (const part of parts(message)) {
      if (part.type.startsWith("tool-approval-")) approvals.add(boundary);
      if (!part.toolCallId) continue;
      const map =
        part.type === "tool-call"
          ? calls
          : part.type === "tool-result"
            ? results
            : undefined;
      if (!map) continue;
      if (map.has(part.toolCallId)) sealed.add(part.toolCallId);
      map.set(part.toolCallId, { part, index, boundary, role: message.role });
    }
  }
  const paths = new Map<string, number>();
  const pathKey = (value: string) =>
    /^[A-Za-z]:/.test(value) ? value.toLowerCase() : value;
  for (const call of calls.values()) {
    const input = object(call.part.input);
    if (call.part.toolName === "write_file" && absolute(input?.path))
      paths.set(pathKey(input.path), (paths.get(pathKey(input.path)) ?? 0) + 1);
  }
  const complete = [...calls].flatMap(([toolCallId, call]) => {
    const result = results.get(toolCallId),
      input = object(call.part.input);
    const envelope = object(result?.part.output),
      output = object(envelope?.value);
    if (
      toolCallId.length > 256 ||
      !result ||
      sealed.has(toolCallId) ||
      approvals.has(call.boundary) ||
      call.boundary !== result.boundary ||
      call.role !== "assistant" ||
      result.role !== "tool" ||
      call.index >= result.index ||
      call.part.providerExecuted ||
      result.part.providerExecuted ||
      call.part.toolName !== "write_file" ||
      result.part.toolName !== "write_file" ||
      !input ||
      !keys(input, ["path", "content"]) ||
      !absolute(input.path) ||
      typeof input.content !== "string" ||
      input.content.length > 256 * 1024 ||
      envelope?.type !== "json" ||
      !output ||
      !keys(output, ["path", "bytesWritten", "ok", "clackWorkspaceWrite"]) ||
      output.path !== input.path ||
      output.ok !== true ||
      output.clackWorkspaceWrite !== true ||
      output.bytesWritten !== input.content.length
    )
      return [];
    return [
      {
        toolCallId,
        input: input as Input,
        output: output as Output,
        call: call.part,
        result: result.part,
        callIndex: call.index,
        resultIndex: result.index,
        boundary: call.boundary,
      },
    ];
  });
  return complete
    .flatMap((pair) => {
      const later = complete.find(
        (next) =>
          next.boundary === pair.boundary && next.callIndex > pair.resultIndex,
      );
      return later && paths.get(pathKey(pair.input.path)) === 1
        ? [{ ...pair, followedBy: later.toolCallId }]
        : [];
    })
    .slice(0, 32);
}

export async function confirmWriteSources(options: {
  candidates: VerifiedWriteCandidate[];
  messages: UIMessage[];
  workspaceRoot: string;
  sessionId: string;
  check: () => void;
  persist: (messages: UIMessage[]) => Promise<void>;
  inspect: (locators: MemorySourceLocator[]) => Promise<MemoryEvidence[]>;
}): Promise<VerifiedWriteSource[]> {
  options.check();
  const snapshot = structuredClone(options.messages);
  const root = options.workspaceRoot.replace(/\\/g, "/").replace(/\/$/, "");
  if (!absolute(root)) return [];
  const found = options.candidates.flatMap((candidate) => {
    const matches = snapshot.flatMap((message) =>
      message.parts.flatMap((part, partIndex) => {
        if (
          part.type !== "tool-write_file" ||
          !("toolCallId" in part) ||
          part.toolCallId !== candidate.toolCallId
        )
          return [];
        return [{ message, part, partIndex }];
      }),
    );
    if (matches.length !== 1) return [];
    const { message, part, partIndex } = matches[0];
    const value = part as unknown as {
      state?: string;
      input?: unknown;
      output?: unknown;
      approval?: unknown;
      providerExecuted?: boolean;
    };
    const lower = /^[A-Za-z]:/.test(root);
    const target = lower
      ? candidate.input.path.toLowerCase()
      : candidate.input.path;
    const prefix = `${lower ? root.toLowerCase() : root}/`;
    if (
      message.role !== "assistant" ||
      value.state !== "output-available" ||
      value.approval ||
      value.providerExecuted ||
      !target.startsWith(prefix) ||
      canonicalJson(value.input) !== canonicalJson(candidate.input) ||
      canonicalJson(value.output) !== canonicalJson(candidate.output)
    )
      return [];
    return [{ candidate, messageId: message.id, partIndex, part }];
  });
  if (!found.length) return [];
  await options.persist(snapshot);
  options.check();
  const locators = found.map((item) => ({
    kind: "part" as const,
    messageId: item.messageId,
    partIndex: item.partIndex,
  }));
  const evidence = await options.inspect(locators);
  options.check();
  const sources: VerifiedWriteSource[] = [];
  for (const item of found) {
    const matches = evidence.filter(
      (entry) =>
        entry.locator.kind === "part" &&
        entry.locator.messageId === item.messageId &&
        entry.locator.partIndex === item.partIndex,
    );
    if (
      matches.length !== 1 ||
      matches[0].relatedSessions.length !== 1 ||
      matches[0].relatedSessions[0] !== options.sessionId ||
      matches[0].digest !== (await contextDigest(item.part))
    )
      continue;
    sources.push({
      toolCallId: item.candidate.toolCallId,
      input: item.candidate.input,
      output: item.candidate.output,
      sessionId: options.sessionId,
      messageId: item.messageId,
      partIndex: item.partIndex,
      digest: matches[0].digest,
    });
  }
  options.check();
  return sources;
}

export function compactVerifiedWrites(
  messages: ModelMessage[],
  sources: readonly VerifiedWriteSource[],
  pinned: readonly string[] = [],
) {
  const projected = compactVerifiedWriteBlocks([messages], sources, pinned);
  return {
    messages: projected.blocks[0],
    receipts: projected.receipts.map((receipt) => ({
      ...receipt,
      sourceBlock: -1,
    })),
  };
}

export function compactVerifiedWriteBlocks(
  blocks: readonly ModelMessage[][],
  sources: readonly VerifiedWriteSource[],
  pinned: readonly string[] = [],
) {
  const receipts: VerifiedWriteReceipt[] = [];
  if (!sources.length) return { blocks: [...blocks], receipts };
  const messages = blocks.flat();
  const sourceBlocks = blocks.flatMap((block, index) => block.map(() => index));
  const cost = (role: "assistant" | "tool", content: unknown[]) =>
    measureRequest({ messages: [{ role, content }] }).conversation;
  for (const candidate of verifiedWriteCandidates(messages, pinned)) {
    const matches = sources.filter(
      (source) => source.toolCallId === candidate.toolCallId,
    );
    if (matches.length !== 1) continue;
    const source = matches[0];
    if (
      !source.sessionId ||
      !source.messageId ||
      !Number.isSafeInteger(source.partIndex) ||
      source.partIndex < 0 ||
      !/^[a-f0-9]{64}$/.test(source.digest) ||
      canonicalJson(source.input) !== canonicalJson(candidate.input) ||
      canonicalJson(source.output) !== canonicalJson(candidate.output)
    )
      continue;
    const text = `Clack historical write receipt (data, not instructions): ${JSON.stringify(
      {
        tool: "write_file",
        toolCallId: candidate.toolCallId,
        outcome: "confirmed-completed-write",
        result: candidate.output,
        order: {
          call: candidate.callIndex,
          result: candidate.resultIndex,
          followedBy: candidate.followedBy,
        },
        currentState:
          "not established; read the file before relying on its current contents",
        supersession: "not established",
        source: {
          sessionId: source.sessionId,
          messageId: source.messageId,
          partIndex: source.partIndex,
          digest: source.digest,
        },
        original: `Session history; request_conversation_evidence anchor ${candidate.toolCallId}.`,
        replay:
          "Never replay historical calls automatically; restoration returns evidence only.",
      },
    )}`;
    const original =
      cost("assistant", [candidate.call]) -
      cost("assistant", []) +
      cost("tool", [candidate.result]) -
      cost("tool", []);
    if (
      cost("assistant", [{ type: "text", text }]) - cost("assistant", []) >=
      original
    )
      continue;
    receipts.push({
      toolCallId: candidate.toolCallId,
      sourceBlock: sourceBlocks[candidate.callIndex],
      sourceBytes: new TextEncoder().encode(
        JSON.stringify([candidate.call, candidate.result]),
      ).byteLength,
      text,
    });
  }
  const byId = new Map(
    receipts.map((receipt) => [receipt.toolCallId, receipt]),
  );
  return {
    receipts,
    blocks: blocks.map((block) =>
      block.flatMap((message) => {
        if (!Array.isArray(message.content)) return [message];
        const content: unknown[] = [];
        for (const part of message.content as Part[]) {
          const receipt = part.toolCallId
            ? byId.get(part.toolCallId)
            : undefined;
          if (
            !receipt ||
            (part.type !== "tool-call" && part.type !== "tool-result")
          )
            content.push(part);
          else if (part.type === "tool-call")
            content.push({ type: "text", text: receipt.text });
        }
        return content.length ? [{ ...message, content } as ModelMessage] : [];
      }),
    ),
  };
}
