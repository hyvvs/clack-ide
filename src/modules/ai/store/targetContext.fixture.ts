import {
  chats,
  seedMessages,
  useChatStore,
} from "@/modules/ai/store/chatStore";
import { contextDigest } from "@/modules/ai/lib/targetContext";
import type { MemoryOwner } from "@/modules/ai/lib/conversationMemory";
import type { SessionMeta } from "@/modules/ai/lib/sessions";

export async function targetContextFixture(
  command: string,
  args: unknown,
): Promise<unknown> {
  const input = args as {
    owner: MemoryOwner;
    request: { expectedSession: SessionMeta; modelId: string; key: string };
  };
  if (command === "target_context_begin") {
    const session = useChatStore
      .getState()
      .sessions.find((item) => item.id === input.owner.sessionId);
    const messages =
      chats.get(input.owner.sessionId)?.messages ??
      seedMessages.get(input.owner.sessionId) ??
      [];
    return {
      token: `switch:${"a".repeat(64)}`,
      session: structuredClone(session),
      view: {
        preparation: {
          runtimeId: "fixture",
          owner: input.owner,
          source: {
            transcriptHash: await contextDigest(messages),
            profileHash: "b".repeat(64),
            transcriptRevision: 1,
            profileRevision: 1,
          },
          generation: 0,
          previous: null,
        },
        revision: null,
        revisionId: null,
        uncoveredMessages: messages.length,
        sourceChanged: false,
      },
    };
  }
  if (command === "target_context_commit") {
    const { expectedSession: session, modelId, key } = input.request;
    return {
      ...session,
      modelRevision: (session.modelRevision ?? 0) + 1,
      profile: { ...session.profile, modelId },
      targetContext: { key },
    };
  }
  if (command === "target_context_load") return null;
  if (command === "scoped_evidence_retrieve")
    return {
      chunks: [],
      issues: [],
      omitted: 0,
      stamp: "a".repeat(64),
      reads: 0,
      bytes: 0,
    };
  return undefined;
}
