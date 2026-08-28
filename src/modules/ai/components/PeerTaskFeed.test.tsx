import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { PEER_TASK_SCHEMA_VERSION, type PeerTask } from "../lib/peerTasks";
import { useChatStore } from "../store/chatStore";
import { usePeerTaskStore } from "../store/peerTaskStore";
import { buildPeerTaskLineage, PeerTaskCard } from "./PeerTaskFeed";

afterEach(() => {
  usePeerTaskStore.setState({ tasks: [], hydrated: false });
  useChatStore.setState({ sessions: [], activeSessionId: null });
});

describe("PeerTaskFeed", () => {
  it("renders the same linked result with target provenance in the source chat", () => {
    useChatStore.setState({
      sessions: [session("source", "Planning"), session("target", "Reviewer")],
      activeSessionId: "source",
    });
    usePeerTaskStore.setState({ tasks: [task()] });

    const html = renderToStaticMarkup(
      <PeerTaskCard task={task()} viewingSessionId="source" />,
    );

    expect(html).toContain("Review the parser");
    expect(html).toContain("Looks safe after the bounds check.");
    expect(html).toContain("agent-reviewer");
    expect(html).toContain("model-reviewer");
  });

  it("shows queued work as cancellable without inventing a result", () => {
    useChatStore.setState({
      sessions: [session("source", "Planning"), session("target", "Reviewer")],
      activeSessionId: "source",
    });
    usePeerTaskStore.setState({
      tasks: [task({ status: "queued", result: undefined })],
    });

    const html = renderToStaticMarkup(
      <PeerTaskCard
        task={task({ status: "queued", result: undefined })}
        viewingSessionId="source"
      />,
    );

    expect(html).toContain("queued");
    expect(html).toContain("Cancel");
    expect(html).not.toContain("Looks safe");
  });

  it("exposes an isolated change set for review without auto-applying it", () => {
    const isolated = task({
      executionMode: "isolated-worktree",
      changeSet: {
        baseSha: "0123456789abcdef0123456789abcdef01234567",
        patch: "diff --git a/src/parser.ts b/src/parser.ts\n",
        changedPaths: ["src/parser.ts"],
      },
    });

    const html = renderToStaticMarkup(
      <PeerTaskCard task={isolated} viewingSessionId="source" />,
    );

    expect(html).toContain("isolated worktree");
    expect(html).toContain("src/parser.ts");
    expect(html).toContain("Review patch");
    expect(html).toContain("Apply patch");
    expect(html).not.toContain("Applied to workspace");
  });

  it("renders a compact, ordered lineage for follow-up work", () => {
    const root = task();
    const child = task({
      id: "peer-2",
      kind: "question",
      parentTaskId: root.id,
      rootTaskId: root.id,
      hopCount: 1,
    });
    usePeerTaskStore.setState({ tasks: [child, root], hydrated: true });

    expect(buildPeerTaskLineage(child, [child, root]).map((item) => item.id)).toEqual([
      "peer-1",
      "peer-2",
    ]);

    const html = renderToStaticMarkup(
      <PeerTaskCard
        task={child}
        viewingSessionId="source"
        allTasks={[child, root]}
      />,
    );
    expect(html).toContain("Task lineage");
    expect(html).toContain("review");
    expect(html).toContain("question");
  });

  it("stops malformed lineage cycles without looping", () => {
    const first = task({ id: "peer-1", parentTaskId: "peer-2" });
    const second = task({ id: "peer-2", parentTaskId: "peer-1" });

    expect(buildPeerTaskLineage(first, [first, second]).map((item) => item.id)).toEqual([
      "peer-2",
      "peer-1",
    ]);
  });
});

function session(id: string, title: string) {
  return { id, title, createdAt: 1, updatedAt: 1 };
}

function task(overrides: Partial<PeerTask> = {}): PeerTask {
  return {
    schemaVersion: PEER_TASK_SCHEMA_VERSION,
    id: "peer-1",
    sourceSessionId: "source",
    targetSessionId: "target",
    sourceAgentId: "agent-source",
    sourceModelId: "model-source",
    targetAgentId: "agent-reviewer",
    targetModelId: "model-reviewer",
    workspaceId: "local:c:/workspace",
    workspaceRoot: "C:/workspace",
    workspaceEnvironment: { kind: "local" },
    kind: "review",
    executionMode: "read-only",
    prompt: "Review the parser",
    artifactRefs: [{ kind: "file", path: "src/parser.ts" }],
    parentTaskId: null,
    rootTaskId: "peer-1",
    hopCount: 0,
    status: "completed",
    createdAt: 1,
    updatedAt: 2,
    result: {
      summary: "Looks safe after the bounds check.",
      targetSessionId: "target",
      targetAgentId: "agent-reviewer",
      targetModelId: "model-reviewer",
      completedAt: 2,
    },
    ...overrides,
  };
}
