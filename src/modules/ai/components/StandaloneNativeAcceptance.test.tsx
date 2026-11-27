import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StandaloneNativeAcceptance } from "./StandaloneNativeAcceptance";

const mock = vi.hoisted(() => ({
  activeSessionId: "s-owned-human-acceptance",
  sessions: [
    {
      id: "s-owned-human-acceptance",
      profile: {
        agentId: "builtin:coder",
        workspaceRoot: "C:/tf4-disposable-owned-workspace",
      },
    },
  ],
}));

vi.mock("@/modules/ai/store/chatStore", () => ({
  useChatStore: (select: (state: typeof mock) => unknown) => select(mock),
}));

vi.mock("@/modules/ai/lib/browserRuntimeStatus", () => ({
  refreshTfBrowserRuntimeStatus: vi.fn(),
}));

vi.mock("./NativeBrowserOperatorPanel", () => ({
  NativeBrowserOperatorPanel: () => null,
}));

describe("standalone TF4 human-only acceptance without model", () => {
  it("offers only a real saved chat-scoped tools entry without configuring an AI model", () => {
    const html = renderToStaticMarkup(<StandaloneNativeAcceptance />);
    expect(html).toContain("Tools for this chat");
    expect(html).toContain("No AI model configured");
    expect(html).toContain("Native browser testing is human-operated");
    expect(html).not.toContain("Approve once");
  });

  it("denies operator entry without a real owning workspace profile", () => {
    mock.sessions = [];
    try {
      expect(renderToStaticMarkup(<StandaloneNativeAcceptance />)).toBe("");
    } finally {
      mock.sessions = [
        {
          id: "s-owned-human-acceptance",
          profile: {
            agentId: "builtin:coder",
            workspaceRoot: "C:/tf4-disposable-owned-workspace",
          },
        },
      ];
    }
  });
});
