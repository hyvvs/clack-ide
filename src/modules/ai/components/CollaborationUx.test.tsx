import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextSources } from "./ContextSources";
import { ChatToolsControl } from "./ChatToolsControl";
import { PeerTaskCard } from "./PeerTaskFeed";
import {
  communicationStateLabel,
  PeerCommunicationFeed,
} from "./PeerCommunicationFeed";
import { AiToolApproval } from "./AiToolApproval";
import { ModelSwitchNotice } from "./ModelSwitchNotice";
import { FallbackConsentCopy } from "@/modules/ai/components/ChatFallbackControl";
import { shouldCloseAiMiniOnEscape } from "./AiMiniWindow";
import { useChatStore } from "../store/chatStore";
import type { PeerTask } from "../lib/peerTasks";
import type { PeerCommunicationEvent } from "../lib/peerCommunication";
import type { UIMessage, ToolUIPart } from "ai";

vi.mock("../store/chatStore", async (original) => {
  const actual = await original<typeof import("../store/chatStore")>();
  return {
    ...actual,
    useChatStore: Object.assign(
      (
        selector: (
          s: ReturnType<typeof actual.useChatStore.getState>,
        ) => unknown,
      ) => selector(actual.useChatStore.getState()),
      actual.useChatStore,
    ),
  };
});

afterEach(() =>
  useChatStore.setState({
    sessions: [],
    activeSessionId: null,
    runtimeBySession: {},
  }),
);
const profile = {
  agentId: "builtin:coder",
  modelId: "compat-u1",
  workspaceId: "local:/u1",
  workspaceRoot: "/u1",
};
const session = (id: string) => ({
  id,
  title: id,
  createdAt: 1,
  updatedAt: 1,
  profile,
});
const task = (extra: Partial<PeerTask> = {}): PeerTask => ({
  schemaVersion: 7,
  id: "task",
  sourceSessionId: "source",
  targetSessionId: "target",
  sourceAgentId: "builtin:architect",
  sourceModelId: "source-model",
  targetAgentId: "builtin:reviewer",
  targetModelId: "captured-review-model",
  workspaceId: "local:/u1",
  workspaceRoot: "/u1",
  workspaceEnvironment: { kind: "local" },
  kind: "review",
  executionMode: "read-only",
  prompt: "Review bounds",
  artifactRefs: [],
  parentTaskId: null,
  rootTaskId: "task",
  hopCount: 0,
  dependsOn: [],
  status: "completed",
  createdAt: 1,
  updatedAt: 2,
  ...extra,
});
const event = (
  state: PeerCommunicationEvent["state"],
  kind: PeerCommunicationEvent["kind"] = "clarification-request",
) => ({ state, kind });

describe("U1 collaboration presentation", () => {
  it("distinguishes destination data consent from Ask routing without authorizing automatic transmission", () => {
    const ask = renderToStaticMarkup(<FallbackConsentCopy mode="ask" />);
    const trusted = renderToStaticMarkup(<FallbackConsentCopy mode="trusted" />);
    expect(ask).toContain("approving fallback allows transmission");
    expect(ask).toContain("this exact destination");
    expect(ask).toContain("conversation, source files, attachments, memory, artifacts, tool results");
    expect(ask).not.toContain("automatic transmission");
    expect(trusted).toContain("I authorize automatic transmission");
  });
  it("Escape dismisses overlays before closing the AI window", () => {
    expect(
      shouldCloseAiMiniOnEscape(
        { key: "Escape", defaultPrevented: false },
        "BUTTON",
        true,
      ),
    ).toBe(false);
    expect(
      shouldCloseAiMiniOnEscape(
        { key: "Escape", defaultPrevented: true },
        "BUTTON",
        false,
      ),
    ).toBe(false);
    expect(
      shouldCloseAiMiniOnEscape(
        { key: "Escape", defaultPrevented: false },
        "TEXTAREA",
        false,
      ),
    ).toBe(false);
    expect(
      shouldCloseAiMiniOnEscape(
        { key: "Escape", defaultPrevented: false },
        "BUTTON",
        false,
      ),
    ).toBe(true);
  });
  it("keeps context inspection collapsed and private evidence absent until requested", () => {
    useChatStore.setState({ sessions: [session("source")] });
    const html = renderToStaticMarkup(
      <ContextSources
        sessionId="source"
        messages={[
          {
            id: "private",
            role: "user",
            parts: [{ type: "text", text: "PRIVATE_CANARY" }],
          },
        ]}
      />,
    );
    expect(html).toContain("Sources &amp; context");
    expect(html).not.toContain("PRIVATE_CANARY");
    expect(html).not.toContain("Loading saved context");
  });
  it("names pane tools without opening a second manager eagerly", () => {
    useChatStore.setState({ sessions: [session("source")] });
    const html = renderToStaticMarkup(<ChatToolsControl sessionId="source" />);
    expect(html).toContain('aria-label="Manage tools for this chat"');
    expect(html).not.toContain("Workspace conversation");
  });
  it("shows captured task actors and model after both chat profiles change", () => {
    useChatStore.setState({ sessions: [session("source"), session("target")] });
    const html = renderToStaticMarkup(
      <PeerTaskCard task={task()} viewingSessionId="source" />,
    );
    expect(html).toContain("From Architect: source");
    expect(html).toContain("To Code Reviewer: target");
    expect(html).toContain("captured-review-model");
    expect(html).not.toContain("From Coder:");
  });
  it("shows recipient-sized handoff and omissions without copying private chats", () => {
    const html = renderToStaticMarkup(
      <PeerTaskCard
        viewingSessionId="source"
        task={task({
          handoff: {
            version: 1,
            key: "a".repeat(64),
            digest: "b".repeat(64),
            recipientSessionId: "target",
            createdAt: 2,
            sources: ["artifact:one"],
            omitted: 3,
          },
        })}
      />,
    );
    expect(html).toContain(
      "Recipient-sized handoff: 1 evidence sources; 3 omitted.",
    );
    expect(html).toContain("Conversation history was not copied");
  });
  it("keeps stale-review failure and exact captured targets inspectable", () => {
    const html = renderToStaticMarkup(
      <PeerTaskCard
        viewingSessionId="source"
        task={task({
          status: "failed",
          error: {
            code: "stale-review",
            message: "Reviewed content changed; review again.",
          },
          review: {
            version: 1,
            files: [{ path: "source.ts", hash: "a".repeat(64) }],
            patches: [],
            results: [],
          },
        })}
      />,
    );
    expect(html).toContain("Reviewed content changed; review again.");
    expect(html).toContain("Review target: 1 captured files");
    expect(html).toContain("source.ts / ");
    expect(html).not.toContain("Applied to workspace");
  });
  it("does not claim blocked dependencies started", () => {
    const html = renderToStaticMarkup(
      <PeerTaskCard
        viewingSessionId="source"
        task={task({
          status: "blocked",
          dependsOn: ["missing"],
          blockedByTaskId: "missing",
          blockedByStatus: "missing",
        })}
      />,
    );
    expect(html).toContain("This task did not start");
    expect(html).toContain("Required task unavailable");
    expect(html).not.toContain("Cancel task");
  });
  it.each([
    ["queued", "Waiting for recipient"],
    ["delivered", "Waiting for answer"],
    ["answered", "Answered"],
    ["acknowledged", "Consumed at task boundary"],
    ["blocked", "Blocked"],
    ["cancelled", "Cancelled; not replayed"],
  ] as const)("clarification %s is truthful", (state, label) => {
    expect(communicationStateLabel(event(state))).toBe(label);
  });
  it("answers queued for a busy recipient do not claim resumed execution", () => {
    expect(
      communicationStateLabel(event("queued", "clarification-response")),
    ).toBe("Queued for recipient");
    expect(
      communicationStateLabel(event("delivered", "clarification-response")),
    ).toBe("Delivered; awaiting task boundary");
  });
  it("communication has readable actors with raw IDs behind provenance", () => {
    const communication: PeerCommunicationEvent = {
      ...event("answered"),
      id: "event",
      sender: { agentId: "a", sessionId: "source", modelId: "source-model", policyRevision: "a".repeat(64) },
      recipient: { agentId: "b", sessionId: "target", modelId: "target-model", policyRevision: "b".repeat(64) },
      evidence: [],
      text: "Use bounded reads",
      taskId: "task",
      recipientTaskId: "target-task",
      rootTaskId: "task",
      parentTaskId: null,
      policyVersion: 1,
      runStartedAt: 0,
      toolCallId: "tool-call",
      createdAt: 1,
      deadline: 600001,
      digest: "c".repeat(64),
      sequence: 1,
      workspaceId: "local:/u1",
    };
    const html = renderToStaticMarkup(
      <PeerCommunicationFeed
        events={[communication]}
        agentName={(id) => (id === "a" ? "Reviewer" : "Coder")}
      />,
    );
    expect(html).toContain("Reviewer to Coder");
    expect(html).toContain("Answered");
    expect(html).toContain("Provenance");
  });
  it("approval presentation follows its captured run rather than active chat", () => {
    useChatStore.setState({
      sessions: [
        {
          ...session("source"),
          run: {
            state: "running",
            startedAt: 1,
            agentId: "builtin:architect",
            workspaceRoot: "/captured",
          },
        },
        session("other"),
      ],
      activeSessionId: "other",
    });
    const part = {
      type: "tool-write_file",
      toolCallId: "call",
      state: "approval-requested",
      input: { path: "output.txt", content: "bounds" },
      approval: { id: "approval" },
    } as Extract<ToolUIPart, { state: "approval-requested" }>;
    const html = renderToStaticMarkup(
      <AiToolApproval
        sessionId="source"
        toolName="write_file"
        part={part}
        onRespond={() => {}}
      />,
    );
    expect(html).toContain('data-approval-session="source"');
    expect(html).toContain("Requested by Architect in source");
    expect(html).toContain("<p>/captured</p>");
    expect(html).toContain("Target: output.txt");
    expect(html).toContain("Allow once approves only this action");
    expect(html).toContain("flex-wrap");
    expect(html).toContain("Allow once");
  });
  it("model preparation separates blocking reason from advanced budget", () => {
    const html = renderToStaticMarkup(
      <ModelSwitchNotice
        targetLabel="Small target"
        assessment={{
          status: "blocked",
          reasons: ["Required context cannot fit"],
          contextLimit: 2048,
          estimatedTokens: 3000,
          workingBudget: 1024,
        }}
        onBack={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(html).toContain("Cannot switch model");
    expect(html).toContain("Required context cannot fit");
    expect(html).toContain("Technical details");
    expect(html).not.toContain("Optimize and switch");
  });
  it("transcript source targets can receive keyboard focus without entering the tab order", async () => {
    const { RenderedMessage } = await import("./AiChat");
    const message: UIMessage = {
      id: "evidence",
      role: "user",
      parts: [{ type: "text", text: "Original evidence" }],
    };
    const html = renderToStaticMarkup(
      <RenderedMessage
        sessionId="source"
        message={message}
        streaming={false}
        onApproval={() => {}}
      />,
    );
    expect(html).toContain('data-evidence-message="evidence"');
    expect(html).toContain('tabindex="-1"');
  });
});
