import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/ai/store/chatStore", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/ai/store/chatStore")>();
  return {
    ...actual,
    // Static rendering reads Zustand's startup snapshot; use the test's current state.
    useChatStore: Object.assign(
      <T,>(
        selector: (state: ReturnType<typeof actual.useChatStore.getState>) => T,
      ) => selector(actual.useChatStore.getState()),
      actual.useChatStore,
    ),
  };
});

import {
  ContextIndicator,
  invokeHeaderStop,
  PeerAction,
  shouldShowHeaderStop,
} from "./AiMiniWindow";
import { canAddAiPane } from "../store/aiPaneStore";
import { useChatStore } from "../store/chatStore";

const originalChatState = useChatStore.getState();

afterEach(() => {
  useChatStore.setState(originalChatState);
  vi.restoreAllMocks();
});

describe("AI pane model indicator", () => {
  function renderIndicator(
    runState: "running" | "completed" | "cancelled" | "failed" | "interrupted",
  ) {
    useChatStore.setState({
      selectedModelId: "gpt-5.4-nano",
      sessions: [
        {
          id: "chat-a",
          title: "Existing conversation",
          createdAt: 1,
          updatedAt: 2,
          profile: {
            agentId: "builtin:coder",
            modelId: "gpt-5.5",
            workspaceRoot: null,
            workspaceId: null,
          },
          run: {
            state: runState,
            startedAt: 1,
            modelId: "gpt-5.4-mini",
          },
        },
      ],
    });
    return renderToStaticMarkup(
      <ContextIndicator sessionId="chat-a" messages={[]} />,
    );
  }

  it.each([
    "completed",
    "cancelled",
    "failed",
    "interrupted",
  ] as const)("shows the chat's newly selected model after a %s run", (state) => {
    const html = renderIndicator(state);
    expect(html).toContain('title="Model: GPT-5.5"');
    expect(html).not.toContain("GPT-5.4 mini");
    expect(html).not.toContain("GPT-5.4 nano");
  });

  it("shows the captured model while its run is still active", () => {
    const html = renderIndicator("running");
    expect(html).toContain('title="Model: GPT-5.4 mini"');
    expect(html).not.toContain("GPT-5.5");
  });
});

describe("AI header Stop", () => {
  it("appears only for an active run", () => {
    expect(shouldShowHeaderStop("running")).toBe(true);
    expect(shouldShowHeaderStop("cancelled")).toBe(false);
    expect(shouldShowHeaderStop("interrupted")).toBe(false);
    expect(shouldShowHeaderStop("completed")).toBe(false);
    expect(shouldShowHeaderStop("failed")).toBe(false);
    expect(shouldShowHeaderStop(undefined)).toBe(false);
  });

  it("uses one cancellation callback", async () => {
    const cancel = vi.fn(async () => {});
    await invokeHeaderStop(cancel);
    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe("AI pane capacity", () => {
  it("requires usable pane widths and respects the four-pane cap", () => {
    expect(canAddAiPane(640, 1)).toBe(false);
    expect(canAddAiPane(900, 1)).toBe(true);
    expect(canAddAiPane(1440, 3)).toBe(true);
    expect(canAddAiPane(2560, 4)).toBe(false);
  });

  it("checks vertical splits against height instead of width", () => {
    expect(canAddAiPane(500, 1, "row", 900)).toBe(false);
    expect(canAddAiPane(500, 1, "col", 900)).toBe(true);
    expect(canAddAiPane(1400, 1, "col", 400)).toBe(false);
  });
});

describe("AI pane delegation", () => {
  it("keeps Ask another agent discoverable before another chat exists", () => {
    const html = renderToStaticMarkup(<PeerAction sessionId="chat-a" />);

    expect(html).toContain("Ask another agent");
    expect(html).toContain('aria-label="Ask another agent"');
  });
});
