import { native } from "@/modules/ai/lib/native";
import {
  createConversationProfile,
  saveSessionsList,
  awaitSessionWrites,
  loadMessages,
  type SessionMeta,
} from "@/modules/ai/lib/sessions";
import { loadConversationMemory } from "@/modules/ai/lib/conversationMemory";
import {
  chats,
  seedMessages,
  useChatStore,
  persistCompactionSource,
} from "@/modules/ai/store/chatStore";
import { sendMessageToSession } from "@/modules/ai/store/chatRuntime";
import { getTodos, flushTodoPersistence } from "@/modules/ai/store/todoStore";
import { loadTodos } from "@/modules/ai/lib/todos";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
export async function localAgentRestart() {
  const sessions = useChatStore
    .getState()
    .sessions.filter((s) => s.id.startsWith("local-mission-"));
  assert(
    sessions.length === 4,
    "Local mission sessions missing after native restart",
  );
  const conversations = [];
  for (const session of sessions) {
    const messages = await loadMessages(session.id);
    assert(messages?.length, "Original local mission history missing");
    conversations.push({ id: session.id, messages });
    if (session.run?.state === "completed") {
      const todos = await loadTodos(session.id);
      assert(
        todos.length === 3 && todos.every((t) => t.status === "completed"),
        "Reported completed plan lost on restart",
      );
    }
  }
  const long = sessions.find((s) => s.id === "local-mission-32768");
  assert(long, "Long mission session missing after restart");
  const memory = await loadConversationMemory({
    sessionId: long.id,
    workspaceId: long.profile?.workspaceId ?? null,
  });
  assert(
    memory.revision && !memory.sourceChanged,
    "Long mission memory did not restore coherently",
  );
  return {
    outcomes: [{ name: "local-native-restart-no-replay", taskIds: [] }],
    tasks: [],
    sessions,
    conversations,
    memoryRevision: memory.revision.revision,
  };
}

export async function runLocalAgentAcceptance(
  root: string,
  selection: (size: number) => string,
  report: string,
) {
  const outcomes: { name: string; taskIds: string[] }[] = [];
  const missions = [];
  const originals = useChatStore.getState().sessions;
  const sessions: SessionMeta[] = [8192, 16384, 32768, 131072].map((size) => ({
    id: `local-mission-${size}`,
    title: `Local ${size}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    profileVersion: 1,
    profile: createConversationProfile({
      agentId: "acceptance:Coder",
      modelId: selection(size),
      workspaceRoot: root,
      workspaceEnvironment: "local",
    }),
  }));
  useChatStore.setState({ sessions: [...sessions, ...originals] });
  await saveSessionsList(useChatStore.getState().sessions);
  for (const [index, session] of sessions.entries()) {
    const size = [8192, 16384, 32768, 131072][index];
    const objective = `LOCAL_AGENT_MISSION_${size}: Inspect, implement, test and document the timeout feature. Use read_file, write_file, bash_run and todo_write. Current correction: timeoutMs=750, NOT 900. Preserve port=1420, allowRemote=false and src/public-api.ts. Add a focused executable test, run it, update documentation. Never claim a write or test without a successful tool result.`;
    const send = async (text: string) => {
      await sendMessageToSession(session.id, { text });
      const chat = chats.get(session.id);
      assert(chat, "Session SDK missing");
      if (chat.error) throw chat.error;
      await persistCompactionSource(session.id, chat.messages);
      await awaitSessionWrites(session.id);
    };
    try {
      if (size === 32768) {
        for (let phase = 0; phase < 24; phase++)
          await send(
            phase === 0
              ? `${objective} First investigate log evidence. LOCAL_PHASE_0`
              : `Continue the same investigation. LOCAL_PHASE_${phase}`,
          );
        await fetch(new URL("/finish-local-history", report), {
          method: "POST",
        });
        await send(
          "Finish the original implementation, test and documentation objective using the retained constraints and source evidence.",
        );
      } else await send(objective);
      const source = await native.readFile(`${root}/src/local-${size}.js`);
      const test = await native.readFile(`${root}/tests/local-${size}.mjs`);
      const doc = await native.readFile(`${root}/LOCAL-${size}.md`);
      assert(
        source.kind === "text" &&
          source.content === "export const timeoutMs = 750;\n",
        "Actual source result wrong",
      );
      assert(
        test.kind === "text" &&
          doc.kind === "text" &&
          doc.content.includes("750"),
        "Test/documentation missing on disk",
      );
      const todos = getTodos(session.id);
      assert(
        todos.length === 3 && todos.every((t) => t.status === "completed"),
        "Explicit unfinished obligations silently accepted",
      );
      const run = useChatStore
        .getState()
        .sessions.find((s) => s.id === session.id)?.run;
      assert(
        run?.budget?.phase === "complete" && run.budget.continuationCount >= 1,
        "Premature answer was not continued in the existing budget",
      );
      const memory = await loadConversationMemory({
        sessionId: session.id,
        workspaceId: session.profile?.workspaceId ?? null,
      });
      if (size === 32768)
        assert(
          memory.revision,
          "Long mission did not exercise real durable compaction",
        );
      missions.push({
        size,
        status: "completed",
        obligations: 5,
        completedObligations: 5,
        continuations: run.budget.continuationCount,
        memoryRevision: memory.revision?.revision ?? 0,
        plan: todos,
      });
    } catch (error) {
      const failure = useChatStore
        .getState()
        .sessions.find((s) => s.id === session.id)?.run?.error;
      if (
        size !== 8192 ||
        !["compaction-protected-budget", "context-overflow"].includes(
          failure?.errorCode ?? "",
        )
      )
        throw error;
      missions.push({
        size,
        status: "capacity-blocked",
        error: String(error),
        details: failure?.details,
        obligations: 5,
        plan: getTodos(session.id),
      });
    }
    outcomes.push({ name: `native-local-single-agent-${size}`, taskIds: [] });
  }
  const publicAPI = await native.readFile(`${root}/src/public-api.ts`);
  assert(
    publicAPI.kind === "text" &&
      publicAPI.content === "export const port = 1420;\n",
    "Forbidden public API changed",
  );
  for (const session of sessions) {
    const messages = chats.get(session.id)?.messages;
    if (messages) seedMessages.set(session.id, messages);
    await awaitSessionWrites(session.id);
  }
  await flushTodoPersistence();
  return {
    outcomes,
    missions,
    tasks: [],
    sessions: useChatStore
      .getState()
      .sessions.filter((s) => s.id.startsWith("local-mission-")),
    conversations: sessions.map((s) => ({
      id: s.id,
      messages: chats.get(s.id)?.messages,
    })),
  };
}
