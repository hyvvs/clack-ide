import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EffortControl } from "@/modules/ai/components/EffortControl";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { createConversationProfile } from "@/modules/ai/lib/sessions";
import { selfHostedSelectionId } from "@/modules/ai/lib/selfHostedModels";
import { captureEffort, effortLabel } from "@/modules/ai/lib/reasoningEffort";
import { MUSE_THINKING_VALUES, ollamaEffortFixture } from "@/modules/ai/lib/reasoningEffort.fixture";
import {sessionEffort} from "@/modules/ai/store/reasoningEffort";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class {} }));
vi.mock("@/components/ui/popover", () => {
  const Pass = ({ children }: { children: ReactNode }) => <>{children}</>;
  return { Popover: Pass, PopoverContent: Pass, PopoverTrigger: Pass };
});
vi.mock("@/modules/ai/store/chatStore", async original => {
  const actual = await original<typeof import("@/modules/ai/store/chatStore")>();
  return { ...actual, useChatStore: Object.assign(
    <T,>(selector: (state: ReturnType<typeof actual.useChatStore.getState>) => T) => selector(actual.useChatStore.getState()),
    actual.useChatStore,
  ) };
});
const chats = useChatStore.getState();
const preferences = usePreferencesStore.getState();
afterEach(() => {
  useChatStore.setState(chats);
  usePreferencesStore.setState(preferences);
});

function render(values: unknown = MUSE_THINKING_VALUES) {
  const fixture = ollamaEffortFixture(values);
  const selection = selfHostedSelectionId(fixture.profile);
  useChatStore.setState({ activeSessionId: "muse", sessions: [{ id: "muse", title: "Fixture", createdAt: 1, updatedAt: 1, profileVersion: 1, profile: createConversationProfile({ agentId: "builtin:coder", modelId: selection, workspaceRoot: null }) }] });
  usePreferencesStore.setState({ selfHostedInference: fixture.state });
  return { fixture, html: renderToStaticMarkup(<EffortControl sessionId="muse" />), captured: captureEffort(selection, fixture.identity, undefined, fixture.state) };
}

describe("existing reasoning selector from normalized Ollama metadata", () => {
  it("shows the saved explicit choice rather than Automatic when its metadata needs revalidation", () => {
    const {fixture} = render([false,true]);
    const session = useChatStore.getState().sessions[0], captured = sessionEffort(session);
    useChatStore.setState({sessions:[{...session,effortPreferences:{version:1,choices:[{key:captured.key,choice:"none",revision:captured.capability.revision}]}}]});
    fixture.profile.evidence.forEach(e=>{e.observedAt=Date.now()-30_001;});
    const html=renderToStaticMarkup(<EffortControl sessionId="muse" />);
    expect(html).toContain("Effort: None");
    expect(html).toContain("requires revalidation; no Automatic substitution");
  });
  it("shows Automatic, None, Low, Medium, High and Maximum without UI changes", () => {
    const { html, captured } = render();
    expect(captured.capability.levels).toEqual(["none", "low", "medium", "high", "max"]);
    let previous = -1;
    for (const level of ["automatic", ...captured.capability.levels]) {
      const at = html.indexOf(`<option value="${level}"`);
      expect(at).toBeGreaterThan(previous);
      expect(html).toContain(`>${effortLabel(level)}</option>`);
      previous = at;
    }
    expect(html).not.toContain("disabled=");
    expect(html).toContain("Provider default; no effort override");
    expect(html).not.toContain("unverified for this model");
  });
  it("does not expose unrecognized names or duplicate options", () => {
    const { html } = render(["low", false, "future_level", "low"]);
    expect(html.split('<option value="low"')).toHaveLength(2);
    expect(html).toContain('<option value="none"');
    expect(html).not.toContain("future_level");
    expect(html).not.toContain('<option value="high"');
  });
  it("labels boolean true as On, not a named effort", () => {
    const { html } = render([true]);
    expect(html).toContain('<option value="on">On</option>');
    expect(html).not.toContain('<option value="high"');
  });
  it("keeps malformed controls unverified and disabled", () => {
    const { html } = render([false, null]);
    expect(html).toContain("unverified for this model");
    expect(html).toContain("disabled=");
    expect(html).not.toContain('<option value="none"');
  });
});
