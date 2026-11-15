import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ServerDiscovery, visibleDiscoveryCandidates } from "./ServerDiscovery";
import type { ServerCandidate } from "@/modules/ai/lib/serverDiscovery";

const candidates: ServerCandidate[] = [
  {
    baseURL: "http://127.0.0.1:11434/",
    backendHint: "ollama",
    source: "user-address/ollama-inventory",
  },
  {
    baseURL: "https://example.invalid/v1",
    backendHint: null,
    source: "user-address/compatible-inventory",
  },
];

describe("Ollama host discovery presentation", () => {
  it("shows only Ollama-shaped candidates without promoting metadata to verification", () => {
    expect(visibleDiscoveryCandidates(candidates, "ollama")).toEqual([candidates[0]]);
    expect(visibleDiscoveryCandidates(candidates)).toEqual(candidates);
    expect(candidates).toHaveLength(2);
  });

  it("remains a bounded opt-in UI without making any discovery call at render", () => {
    const onSelect = vi.fn();
    const html = renderToStaticMarkup(
      <ServerDiscovery endpoints={[]} onSelect={onSelect} backendFilter="ollama" />,
    );
    expect(html).toContain("Find Ollama hosts");
    expect(html).toContain("Only Ollama-shaped inventories are shown");
    expect(html).toContain("Up to 8 addresses, 2 metadata GETs each");
    expect(html).not.toContain("Another computer (SSH)");
    expect(onSelect).not.toHaveBeenCalled();
  });
});
