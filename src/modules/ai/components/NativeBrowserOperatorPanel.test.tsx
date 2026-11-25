import { describe, expect, it } from "vitest";
import {
  boundedNativeReceiptEvidence,
  boundedNativeTestText,
  closedNativePage,
  confinedRootUrl,
  nativeOperatorRoleAllowed,
  nativeOperatorReceiptMatches,
  originalNativeOperatorRequest,
  originalNativeSubmitPair,
  pendingOriginalPopupAttempt,
  preparedNativeOperatorMatches,
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
const formRef = "1".repeat(48);
const submitterRef = "2".repeat(48);
const scope = {
  actor: "owned-human", sessionId: "owned-chat", workspaceRoot: "C:/owned-workspace", browserId: session,
};
const formPage = {
  ...page, pageGeneration: 1,
  elements: [
    { elementRef: formRef, role: "form" },
    { elementRef: submitterRef, role: "button", fieldType: "submit" },
    { elementRef: "3".repeat(48), role: "button", fieldType: "button" },
  ],
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
    expect(
      closedNativePage(
        {
          ...page,
          elements: [
            { elementRef: "d".repeat(48), role: "form" },
            { elementRef: "e".repeat(48), role: "button" },
          ],
        },
        session,
      ),
    ).toMatchObject({
      elements: [
        { elementRef: "d".repeat(48), role: "form" },
        { elementRef: "e".repeat(48), role: "button" },
      ],
    });
    expect(nativeOperatorRoleAllowed("click", "form")).toBe(false);
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

  it("accepts only an original retained FORM and actual native submit fieldType candidate", () => {
    const observed = closedNativePage(formPage, session);
    expect(observed?.elements).toEqual([
      { elementRef: formRef, role: "form" },
      { elementRef: submitterRef, role: "button", fieldType: "submit" },
      { elementRef: "3".repeat(48), role: "button" },
    ]);
    expect(originalNativeSubmitPair(observed, formRef, submitterRef)).toBe(true);
    expect(originalNativeSubmitPair(observed, formRef, "3".repeat(48))).toBe(false);
    expect(originalNativeSubmitPair(observed, submitterRef, formRef)).toBe(false);
    expect(originalNativeSubmitPair(observed, formRef, formRef)).toBe(false);
    expect(originalNativeSubmitPair(observed, "f".repeat(48), submitterRef)).toBe(false);
    expect(originalNativeOperatorRequest("submit", scope, observed, observed?.elements[1], formRef))
      .toEqual({
        operation: "submit", actor: scope.actor, sessionId: scope.sessionId,
        workspaceRoot: scope.workspaceRoot, browserSessionId: session,
        pageId: page.pageId, pageGeneration: 1, snapshotId: page.snapshotId,
        elementId: submitterRef, text: formRef,
      });
    expect(originalNativeOperatorRequest("submit", scope, observed, observed?.elements[2], formRef))
      .toBeNull();
    expect(originalNativeOperatorRequest("submit", scope, observed, observed?.elements[1],
      "https://example.org/?secret=never")) .toBeNull();
    expect(originalNativeOperatorRequest("submit", { ...scope, browserId: "4".repeat(48) },
      observed, observed?.elements[1], formRef)).toBeNull();
  });

  it("separates exact original-page popup trigger from separately approved native child", () => {
    const original = closedNativePage({ ...page, pageGeneration: 1 }, session);
    expect(original).not.toBeNull();
    const link = original?.elements[0];
    const root = "https://popup.example.org/";
    expect(nativeOperatorRoleAllowed("trigger_page_popup", "link")).toBe(true);
    expect(nativeOperatorRoleAllowed("trigger_page_popup", "button")).toBe(false);
    const request = originalNativeOperatorRequest("trigger_page_popup", scope,
      original, link, undefined, root);
    expect(request).toEqual({
      operation: "trigger_page_popup", actor: scope.actor, sessionId: scope.sessionId,
      workspaceRoot: scope.workspaceRoot, browserSessionId: session,
      pageId: page.pageId, pageGeneration: 1, snapshotId: page.snapshotId,
      elementId: page.elements[0].elementRef,
    });
    expect(JSON.stringify(request)).not.toContain(root);
    expect(originalNativeOperatorRequest("trigger_page_popup", scope, original,
      link, undefined, "https://popup.example.org/path")).toBeNull();
    expect(originalNativeOperatorRequest("trigger_page_popup", scope,
      closedNativePage(page, session), link, undefined, root)).toBeNull();

    const triggerReceipt = {
      toolId: "tf.browser_operation.v1", requestId: "8".repeat(48),
      actor: scope.actor, sessionId: scope.sessionId, browserSessionId: session,
      operation: "trigger_page_popup" as const,
      engine: "confined_webview2_read_only_unaccepted",
      terminal: "unknown", nativeTerminal: "DISPATCHED",
      canonicalTerminal: "UNKNOWN", policyDecision: "allowed",
      effectState: "Unknown", reasonCode: "native-action-dispatched",
      retry: "NEVER_REPLAY", autoRetry: false,
    };
    const attempt = pendingOriginalPopupAttempt(original, link ?? null, root, triggerReceipt);
    expect(attempt).toMatchObject({
      openerId: session, sourcePageId: page.pageId, sourceSnapshotId: page.snapshotId,
      sourceGeneration: 1, triggerLinkRef: page.elements[0].elementRef,
      expectedDestination: root,
    });
    expect(originalNativeOperatorRequest("open_requested_popup", scope, null,
      undefined, undefined, undefined, attempt)).toEqual({
        operation: "open_requested_popup", actor: scope.actor, sessionId: scope.sessionId,
        workspaceRoot: scope.workspaceRoot, browserSessionId: session, url: root,
      });
    expect(originalNativeOperatorRequest("open_requested_popup", { ...scope, browserId: "5".repeat(48) },
      null, undefined, undefined, undefined, attempt)).toBeNull();
    expect(originalNativeOperatorRequest("open_requested_popup", scope, null)).toBeNull();
    for (const changed of [
      { ...triggerReceipt, nativeTerminal: "UNKNOWN" },
      { ...triggerReceipt, policyDecision: "denied" },
      { ...triggerReceipt, effectState: "Observed" },
      { ...triggerReceipt, autoRetry: true },
      { ...triggerReceipt, browserSessionId: "9".repeat(48) },
      { ...triggerReceipt, engine: "inert_native_text" },
      { ...triggerReceipt, toolId: "forged" },
    ]) {
      expect(pendingOriginalPopupAttempt(original, link ?? null, root, changed)).toBeNull();
    }
  });

  it("exports closed popup child and FORM POST transport digests without private URL or body", () => {
    const raw = boundedNativeReceiptEvidence({
      requestId: "9".repeat(48), operation: "submit", browserSessionId: session,
      terminal: "unknown", effectState: "Unknown", policyDecision: "allowed",
      retry: "NEVER_REPLAY", autoRetry: false,
      nativeFormTransport: {
        method: "POST", destinationSha256: "b".repeat(64),
        bodySha256: "c".repeat(64), bodyBytes: 72,
        body: "private-form-secret", destination: "https://example.org/unsafe?secret=never",
      },
    });
    expect(raw).toContain('"method": "POST"');
    expect(raw).toContain('"bodyBytes": 72');
    expect(raw).toContain(`"browserSessionId": "${session}"`);
    expect(raw).not.toMatch(/private-form-secret|unsafe\?|secret=never|"body":/);
    expect(boundedNativeReceiptEvidence({
      requestId: "9".repeat(48), operation: "open_requested_popup",
      browserSessionId: "7".repeat(48), requestedUrl: "https://popup.example.org/?secret=NO",
    })).not.toContain("secret=NO");
  });

  it("requires a new popup child token, genuine OS approval and matching one-use receipt scope", () => {
    const prepared = {
      token: "6".repeat(48), requestId: "7".repeat(48),
      operation: "open_requested_popup" as const, requiresApproval: true,
      browserSessionId: "8".repeat(48), engine: "confined_webview2_read_only_unaccepted",
    };
    const receipt = {
      toolId: "tf.browser_operation.v1", requestId: prepared.requestId,
      actor: scope.actor, sessionId: scope.sessionId, operation: "open_requested_popup" as const,
      browserSessionId: prepared.browserSessionId, engine: prepared.engine,
      terminal: "pending", effectState: "Unknown", policyDecision: "allowed",
      reasonCode: "confined-native-appcontainer-ready-broker-serving", autoRetry: false,
    };
    expect(preparedNativeOperatorMatches(prepared, "open_requested_popup", session)).toBe(true);
    expect(nativeOperatorReceiptMatches(receipt, prepared, "open_requested_popup", scope)).toBe(true);
    for (const forged of [
      { ...prepared, browserSessionId: session },
      { ...prepared, engine: "inert_native_text" },
      { ...prepared, requiresApproval: false },
      { ...prepared, operation: "open_confined" as const },
      { ...prepared, requestId: "bad" },
    ]) expect(preparedNativeOperatorMatches(forged, "open_requested_popup", session)).toBe(false);
    for (const forged of [
      { ...receipt, browserSessionId: session },
      { ...receipt, requestId: "9".repeat(48) },
      { ...receipt, sessionId: "other-chat" },
      { ...receipt, actor: "different-owner" },
      { ...receipt, autoRetry: true },
      { ...receipt, engine: "inert_native_text" },
    ]) expect(nativeOperatorReceiptMatches(forged, prepared, "open_requested_popup", scope)).toBe(false);
    expect(preparedNativeOperatorMatches({ ...prepared, operation: "submit", browserSessionId: session },
      "submit", session)).toBe(true);
    expect(preparedNativeOperatorMatches({ ...prepared, operation: "trigger_page_popup", browserSessionId: session },
      "trigger_page_popup", session)).toBe(true);
    expect(preparedNativeOperatorMatches({ ...prepared, operation: "trigger_page_popup",
      browserSessionId: session, engine: "inert_native_text" }, "trigger_page_popup", session)).toBe(false);
  });
});
