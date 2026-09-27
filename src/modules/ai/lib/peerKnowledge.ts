import { projectMemoryClient } from "@/modules/ai/lib/projectMemory";
import { useChatStore } from "@/modules/ai/store/chatStore";
import {
  flushPeerTasks,
  usePeerTaskStore,
} from "@/modules/ai/store/peerTaskStore";
import { validatePeerReview } from "@/modules/ai/lib/peerReview";
import { peerEndpoint } from "@/modules/ai/lib/peerCommunicationCoordinator";

export async function promotePeerFinding(
  sessionId: string,
  taskId: string,
  excerpt: string,
  files: string[],
) {
  const task = usePeerTaskStore
    .getState()
    .tasks.find((item) => item.id === taskId);
  const session = useChatStore
    .getState()
    .sessions.find((item) => item.id === sessionId);
  if (
    !task?.result ||
    task.status !== "completed" ||
    ![task.sourceSessionId, task.targetSessionId].includes(sessionId) ||
    task.workspaceId !== session?.profile?.workspaceId ||
    !files.length ||
    files.length > 8 ||
    !excerpt ||
    excerpt.length > 2000
  )
    throw new Error("peer_finding_promotion_denied");
  const endpoint = await peerEndpoint(sessionId, task.workspaceId);
  const check = async () => {
    if (
      task !==
        usePeerTaskStore.getState().tasks.find((item) => item.id === taskId) ||
      JSON.stringify(await peerEndpoint(sessionId, task.workspaceId)) !==
        JSON.stringify(endpoint)
    )
      throw new Error("peer_finding_promotion_stale");
    await validatePeerReview(task);
  };
  await flushPeerTasks();
  await check();
  const client = projectMemoryClient(sessionId);
  let view = await client.load();
  let entry = view.entries.find(
    (item) =>
      item.sourceSessionId === sessionId &&
      item.locator.kind === "taskResult" &&
      item.locator.taskId === taskId &&
      item.text === excerpt &&
      ["pending", "approved"].includes(item.status),
  );
  if (!entry) {
    await client.propose(
      view,
      {
        key: `task:${taskId}`,
        label: "Peer finding",
        text: task.result.summary,
        locator: { kind: "taskResult", taskId },
      },
      excerpt,
      "findings",
    );
    view = await client.load();
    entry = view.entries.find(
      (item) =>
        item.sourceSessionId === sessionId &&
        item.locator.kind === "taskResult" &&
        item.locator.taskId === taskId &&
        item.text === excerpt &&
        item.status === "pending",
    );
  }
  if (!entry) throw new Error("peer_finding_proposal_unavailable");
  await check();
  if (entry.status === "pending") {
    await client.decide(view, entry.id, { kind: "approve" });
    view = await client.load();
  }
  await check();
  await client.verify(view, entry.id, files.join("\n"), "", []);
  return { recordId: entry.id, status: "user-validated", taskId };
}
