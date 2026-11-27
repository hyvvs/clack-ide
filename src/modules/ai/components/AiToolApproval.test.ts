import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAllChatPermissionsForTests,
  consumeTfApprovedToolCall,
} from "@/modules/ai/lib/permissions";
import { AiToolApproval, respondToApprovalChoice } from "./AiToolApproval";

const buttonCapture = vi.hoisted(() => ({
  handlers: [] as Array<{ children?: ReactNode; onClick?: () => void }>,
}));
vi.mock("@/components/ui/button", async () => {
  const { createElement } = await import("react");
  return {
    Button: (props: { children?: ReactNode; onClick?: () => void }) => {
      buttonCapture.handlers.push(props);
      return createElement("button", { type: "button" }, props.children);
    },
  };
});

const uiState = vi.hoisted(() => ({
  sessions: [{
    id: "chat-a",
    profile: { agentId: "builtin:coder", workspaceRoot: "/work/a" },
  }],
  live: {
    getWorkspaceRoot: () => "/work/a",
    getCwd: () => "/work/a",
  },
}));
vi.mock("@/modules/ai/store/chatStore", () => ({
  useChatStore: Object.assign(
    (selector: (state: typeof uiState) => unknown) => selector(uiState),
    { getState: () => uiState },
  ),
}));
vi.mock("@/modules/ai/store/agentsStore", () => ({
  useAgentsStore: Object.assign(
    (selector: (state: { customAgents: unknown[] }) => unknown) =>
      selector({ customAgents: [] }),
    { getState: () => ({ activeId: "builtin:coder" }) },
  ),
}));

function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  if (!isValidElement(node)) return "";
  return textOf((node.props as { children?: unknown }).children);
}

function approvalButton(
  toolName: string, input: Record<string, unknown>, toolCallId: string,
  label: "Allow once" | "Deny", onRespond: (approved: boolean) => void,
) {
  // Server-render the genuine component and capture its Button callback.
  // Unlike invoking the function directly, this exercises React's useRef
  // guard and the actual rendered JSX event binding without a DOM shim.
  buttonCapture.handlers.length = 0;
  const tree = createElement(AiToolApproval, {
    part: { state: "approval-requested", input, toolCallId,
      approval: { id: toolCallId } } as never,
    toolName, sessionId: "chat-a", onRespond,
  });
  renderToStaticMarkup(tree);
  const handler = buttonCapture.handlers.find(
    (button) => textOf(button.children).includes(label),
  )?.onClick;
  expect(handler).toBeTypeOf("function");
  if (!handler) throw new Error(`Missing approval UI button: ${label}`);
  return handler;
}

describe("approval choices", () => {
  beforeEach(() => clearAllChatPermissionsForTests());

  it("denies without executing and allows one invocation only", () => {
    const respond = vi.fn();
    respondToApprovalChoice("deny", respond);
    respondToApprovalChoice("once", respond);
    expect(respond.mock.calls).toEqual([[false], [true]]);
  });

  it("real browser Allow once UI handler creates an exact scoped, consumed-only-once proof", () => {
    const input = { browserSessionId: "a".repeat(48), snapshotId: "b".repeat(48),
      elementId: "c".repeat(48) };
    const respond = vi.fn();
    const allow = approvalButton("tf_browser_click", input, "ui-browser-click", "Allow once", respond);
    allow();
    allow();
    expect(respond).toHaveBeenCalledExactlyOnceWith(true);
    const scope = { toolCallId: "ui-browser-click", sessionId: "chat-a",
      agentId: "builtin:coder", workspaceRoot: "/work/a", cwd: "/work/a",
      toolName: "tf_browser_click" };
    expect(consumeTfApprovedToolCall({ ...scope, parameters: input })).toBe(true);
    expect(consumeTfApprovedToolCall({ ...scope, parameters: input })).toBe(false);
  });

  it("redacts untrusted URL paths and query tokens in the browser approval preview", () => {
    const url = "https://docs.example.org/reset/secret-path-id?token=another-secret";
    const html = renderToStaticMarkup(createElement(AiToolApproval, {
      part: { state: "approval-requested", input: { url }, toolCallId: "browser-secret",
        approval: { id: "browser-secret" } } as never,
      toolName: "tf_browser_open", sessionId: "chat-a", onRespond: vi.fn(),
    }));
    expect(html).toContain("https://docs.example.org/…");
    expect(html).not.toContain("secret-path-id");
    expect(html).not.toContain("another-secret");
  });

  it("browser UI denial mints nothing and changed exact element burns the allowed proof", () => {
    const input = { browserSessionId: "a".repeat(48), snapshotId: "b".repeat(48),
      elementId: "c".repeat(48) };
    const scope = { toolCallId: "ui-browser-deny", sessionId: "chat-a",
      agentId: "builtin:coder", workspaceRoot: "/work/a", cwd: "/work/a",
      toolName: "tf_browser_click" };
    const denied = vi.fn();
    approvalButton("tf_browser_click", input, scope.toolCallId, "Deny", denied)();
    expect(denied).toHaveBeenCalledExactlyOnceWith(false);
    expect(consumeTfApprovedToolCall({ ...scope, parameters: input })).toBe(false);
    const allowed = vi.fn();
    const changedScope = { ...scope, toolCallId: "ui-browser-mutated" };
    approvalButton("tf_browser_click", input, changedScope.toolCallId, "Allow once", allowed)();
    expect(allowed).toHaveBeenCalledExactlyOnceWith(true);
    expect(consumeTfApprovedToolCall({ ...changedScope,
      parameters: { ...input, elementId: "d".repeat(48) } })).toBe(false);
    expect(consumeTfApprovedToolCall({ ...changedScope, parameters: input })).toBe(false);
  });
});
