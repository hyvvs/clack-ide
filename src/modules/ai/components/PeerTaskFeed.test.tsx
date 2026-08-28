import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { PEER_TASK_SCHEMA_VERSION, type PeerTask } from "../lib/peerTasks";
import { useChatStore } from "../store/chatStore";
import { usePeerTaskStore } from "../store/peerTaskStore";
import { PeerTaskCard } from "./PeerTaskFeed";

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
    kind: "review",
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
