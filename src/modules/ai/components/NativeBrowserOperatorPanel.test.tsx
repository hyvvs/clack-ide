import { describe, expect, it } from "vitest";
import {
  boundedNativeReceiptEvidence,
  boundedNativeTestText,
  closedNativePage,
  confinedRootUrl,
  nativeOperatorRoleAllowed,
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

  it("bounds human-only non-secret input and exact semantic control roles", () => {
    expect(boundedNativeTestText("fixture-message-42")).toBe(true);
    expect(boundedNativeTestText("")).toBe(false);
    expect(boundedNativeTestText("X".repeat(257))).toBe(false);
    for (const forbidden of ["line\nbreak", "control\u0000", "bidi\u202e", "hidden\u200b"])
      expect(boundedNativeTestText(forbidden)).toBe(false);
    for (const [operation, role] of [
      ["click", "link"],
      ["type", "textbox"],
      ["clear", "textbox"],
      ["select", "combobox"],
      ["check", "checkbox"],
      ["uncheck", "checkbox"],
      ["scroll", "main"],
    ] as const) {
      expect(nativeOperatorRoleAllowed(operation, role)).toBe(true);
      expect(nativeOperatorRoleAllowed(operation, "link" === role ? "button" : "link")).toBe(false);
    }
    expect(nativeOperatorRoleAllowed("type", "password")).toBe(false);
    expect(nativeOperatorRoleAllowed("uncheck", "radio")).toBe(false);
  });

  it("exports only closed native terminal states and opaque evidence, never page secrets", () => {
    const value = boundedNativeReceiptEvidence({
      requestId: "f".repeat(48),
      operation: "click",
      terminal: "success",
      nativeTerminal: "CONFIRMED",
      canonicalTerminal: "SUCCESS",
      policyDecision: "allowed",
      effectState: "Observed",
      retry: "NEVER_REPLAY",
      autoRetry: false,
      reasonCode: "native-effect-independently-confirmed",
      requestedUrl: "https://fixture.example/?password=never-echo",
      nativePage: { elements: [{ accessibleName: "hidden-password" }] },
      nativeEffectEvidence: {
        brokerRequestId: 17,
        sourcePageGeneration: 1,
        observedPageGeneration: 2,
        nativeComCompleted: true,
        resultingUrlSha256: "a".repeat(64),
        responseSha256: "b".repeat(64),
        futureSecret: "TOP-SECRET",
      },
    });
    expect(value).toContain('"canonicalTerminal": "SUCCESS"');
    expect(value).toContain('"brokerRequestId": 17');
    expect(value).not.toMatch(/TOP-SECRET|hidden-password|never-echo|requestedUrl/);
    expect(boundedNativeReceiptEvidence({ requestId: "bad", operation: "click" })).toBeNull();
    expect(boundedNativeReceiptEvidence({ requestId: "f".repeat(48), operation: "eval" })).toBeNull();
    const failedClosed = boundedNativeReceiptEvidence({
      requestId: "f".repeat(48), operation: "type", reasonCode: "password=not-safe",
      nativeTerminal: "password=not-safe", nativeEffectEvidence: { responseSha256: "INVALID" },
    });
    expect(failedClosed).toContain('"reasonCode": "native-authorization-or-transport-unverified"');
    expect(failedClosed).toContain('"responseSha256": null');
  });
});
