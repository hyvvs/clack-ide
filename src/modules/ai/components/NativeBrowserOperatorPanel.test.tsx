import { describe, expect, it } from "vitest";
import {
  closedNativePage,
  confinedRootUrl,
} from "./NativeBrowserOperatorPanel";

const session = "a".repeat(48);
const page = {
  browserSessionId: session,
  pageId: "b".repeat(48),
  snapshotId: "c".repeat(48),
  pageGeneration: 2,
  origin: "https://example.org",
  elements: [{ elementRef: "d".repeat(48), role: "link" }],
};

describe("manual native TF4 app approval presentation", () => {
  it("permits only an HTTPS root without URL-path, query, credentials or fragment", () => {
    expect(confinedRootUrl("https://example.org/")).toBe(
      "https://example.org/",
    );
    for (const raw of [
      "http://example.org/",
      "https://example.org/private",
      "https://example.org/?credential=TOP-SECRET",
      "https://example.org/#secret",
      "https://name:pass@example.org/",
      "javascript:alert(1)",
      " https://example.org/",
    ]) {
      expect(confinedRootUrl(raw)).toBeNull();
    }
  });

  it("recognizes only bounded exact-session native snapshot identity", () => {
    expect(closedNativePage(page, session)).toMatchObject({
      pageId: page.pageId,
      pageGeneration: 2,
      elements: [{ elementRef: "d".repeat(48), role: "link" }],
    });
    for (const altered of [
      { ...page, browserSessionId: "e".repeat(48) },
      { ...page, snapshotId: "not-an-opaque-ref" },
      { ...page, pageGeneration: 0 },
      { ...page, pageGeneration: 1.1 },
      { ...page, origin: "https://example.org/private" },
      { ...page, origin: "https://another.example.org/?secret=TOP-SECRET" },
      { ...page, elements: [{ elementRef: "d".repeat(48), role: "script" }] },
      { ...page, elements: [{ elementRef: "unsafe", role: "link" }] },
      { ...page, elements: Array.from({ length: 65 }, () => page.elements[0]) },
    ]) {
      expect(closedNativePage(altered, session)).toBeNull();
    }
    expect(closedNativePage(page, "invalid-session")).toBeNull();
  });
});
