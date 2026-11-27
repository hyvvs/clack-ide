import { describe, expect, it } from "vitest";
import {
  boundedNativeReceiptEvidence,
  boundedNativeTestText,
  closedNativePage,
  confinedRootUrl,
  nativeOperatorRoleAllowed,
  nativeOperatorReceiptMatches,
  nativeHumanRetainedObservationFresh,
  nativeSameOriginTransferUrl,
  originalNativeOperatorRequest,
  originalNativeSubmitPair,
  pendingOriginalPopupAttempt,
  preparedNativeOperatorMatches,
  revokePreparedNativeOwner,
  syntheticNativeUploadName,
  verifiedNativeScreenshotEvidence,
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
  it("releases only the prepared token owned by the unmounting session epoch, once", () => {
    const cancelled: string[] = [];
    const owner = { current: { epoch: 7, token: "a".repeat(48) } as { epoch: number; token: string } | null };
    const cancel = (token: string) => { cancelled.push(token); };
    expect(revokePreparedNativeOwner(owner, 6, cancel)).toBe(false);
    expect(cancelled).toEqual([]);
    expect(owner.current?.epoch).toBe(7);
    expect(revokePreparedNativeOwner(owner, 7, cancel)).toBe(true);
    expect(owner.current).toBeNull();
    expect(revokePreparedNativeOwner(owner, 7, cancel)).toBe(false);
    expect(cancelled).toEqual(["a".repeat(48)]);
    // A newly prepared token for a different owning session must be intact.
    owner.current = { epoch: 8, token: "b".repeat(48) };
    expect(revokePreparedNativeOwner(owner, 7, cancel)).toBe(false);
    expect(owner.current?.token).toBe("b".repeat(48));
    expect(revokePreparedNativeOwner(owner, 8, cancel)).toBe(true);
    expect(cancelled).toEqual(["a".repeat(48), "b".repeat(48)]);
  });
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

  it("seals the original native screenshot to the observed page and refuses bare sessions", () => {
    const observed = closedNativePage(page, session);
    expect(originalNativeOperatorRequest("screenshot", scope, observed))
      .toEqual({
        operation: "screenshot", actor: scope.actor,
        sessionId: scope.sessionId, workspaceRoot: scope.workspaceRoot,
        browserSessionId: session, pageId: page.pageId,
        pageGeneration: page.pageGeneration, snapshotId: page.snapshotId,
      });
    expect(originalNativeOperatorRequest("screenshot", scope, null)).toBeNull();
    expect(originalNativeOperatorRequest("screenshot", {
      ...scope, browserId: "9".repeat(48),
    }, observed)).toBeNull();
    expect(originalNativeOperatorRequest("screenshot", scope, observed,
      observed?.elements[0])).toBeNull();
    expect(originalNativeOperatorRequest("screenshot", scope, observed,
      undefined, undefined, "https://example.org/")).toBeNull();
    expect(preparedNativeOperatorMatches({
      token: "4".repeat(48), requestId: "5".repeat(48),
      operation: "screenshot", requiresApproval: true,
      browserSessionId: session, engine: "confined_webview2_read_only_unaccepted",
    }, "screenshot", session)).toBe(true);
    expect(preparedNativeOperatorMatches({
      token: "4".repeat(48), requestId: "5".repeat(48),
      operation: "screenshot", requiresApproval: false,
      browserSessionId: session, engine: "confined_webview2_read_only_unaccepted",
    }, "screenshot", session)).toBe(false);
  });

  it("exports only bounded TF2 screenshot metadata, never PNG bytes, page or paths", () => {
    const receipt = boundedNativeReceiptEvidence({
      requestId: "f".repeat(48), operation: "screenshot",
      terminal: "completed", policyDecision: "allowed",
      effectState: "Observed", retry: "NEVER_REPLAY", autoRetry: false,
      nativeScreenshotEvidence: {
        format: "png", width: 800, height: 600,
        pageId: page.pageId, pageGeneration: page.pageGeneration,
        snapshotId: page.snapshotId, urlSha256: "e".repeat(64),
        contentSha256: "a".repeat(64), bytesVerified: 12991,
        workspaceRelativeFile: `tf4-browser-screenshot-${"1".repeat(24)}.png`,
        effectState: "Observed", retry: "NEVER_REPLAY",
        png: "PNG_SECRET_BYTES",
        privatePath: "C:/Users/secret/unapproved.png",
      },
      requestedUrl: "https://example.org/?secret=SECRET_URL",
    });
    expect(receipt).toContain('"nativeTf2Screenshot": {');
    expect(receipt).toContain('"bytesVerified": 12991');
    expect(receipt).toContain(`"contentSha256": "${"a".repeat(64)}"`);
    expect(receipt).not.toMatch(/PNG_SECRET_BYTES|SECRET_URL|unapproved|privatePath/);
    expect(receipt).toContain(`"pageId": "${page.pageId}"`);
    const bad = boundedNativeReceiptEvidence({
      requestId: "e".repeat(48), operation: "screenshot",
      nativeScreenshotEvidence: {
        format: "bmp", width: -10, height: 999999, bytesVerified: -2,
        contentSha256: "bad", workspaceRelativeFile: "../secret.png",
        effectState: "forged", retry: "SAFE_RETRY",
      },
    });
    expect(bad).toContain('"workspaceRelativeFile": null');
    expect(bad).toContain('"contentSha256": null');
    expect(bad).toContain('"bytesVerified": null');
    expect(bad).not.toContain("../secret.png");
  });

  it("requires exact retained-page identity and canonical 1024x768 / 64 KiB PNG contract", () => {
    const observed = closedNativePage(page, session);
    expect(observed).not.toBeNull();
    const evidence = {
      format: "png", width: 1024, height: 768,
      pageId: page.pageId, snapshotId: page.snapshotId,
      pageGeneration: page.pageGeneration, urlSha256: "e".repeat(64),
      contentSha256: "a".repeat(64), bytesVerified: 65_536,
      workspaceRelativeFile: `tf4-browser-screenshot-${"1".repeat(24)}.png`,
      effectState: "Observed", retry: "NEVER_REPLAY",
    };
    const good = {
      requestId: "f".repeat(48), toolId: "tf.browser_operation.v1",
      actor: scope.actor, sessionId: scope.sessionId,
      operation: "screenshot" as const, browserSessionId: session,
      engine: "confined_webview2_read_only_unaccepted",
      terminal: "completed", policyDecision: "allowed", effectState: "Observed",
      retry: "NEVER_REPLAY", autoRetry: false, reasonCode: "native-screenshot-TF2-file-readback-verified",
      snapshotId: page.snapshotId, contentSha256: "a".repeat(64), bytesReceived: 65_536,
      nativeScreenshotEvidence: evidence,
    };
    expect(verifiedNativeScreenshotEvidence(good, observed)).toBe(true);
    for (const forged of [
      { ...good, browserSessionId: "2".repeat(48) },
      { ...good, retry: "SAFE_RETRY" },
      { ...good, autoRetry: true },
      { ...good, terminal: "unknown" },
      { ...good, bytesReceived: 9 },
      { ...good, contentSha256: "b".repeat(64) },
      { ...good, snapshotId: "c".repeat(48).replace(/c/g, "7") },
      { ...good, nativeScreenshotEvidence: { ...evidence, width: 1025 } },
      { ...good, nativeScreenshotEvidence: { ...evidence, height: 769 } },
      { ...good, nativeScreenshotEvidence: { ...evidence, bytesVerified: 65_537 } },
      { ...good, nativeScreenshotEvidence: { ...evidence, pageId: "f".repeat(48) } },
      { ...good, nativeScreenshotEvidence: { ...evidence, snapshotId: "f".repeat(48) } },
      { ...good, nativeScreenshotEvidence: { ...evidence, pageGeneration: 3 } },
      { ...good, nativeScreenshotEvidence: { ...evidence, urlSha256: "invalid" } },
      { ...good, nativeScreenshotEvidence: { ...evidence, workspaceRelativeFile: "../outside.png" } },
      { ...good, nativeScreenshotEvidence: { ...evidence, effectState: "Unknown" } },
    ]) {
      expect(verifiedNativeScreenshotEvidence(forged, observed)).toBe(false);
    }
    expect(verifiedNativeScreenshotEvidence(good, null)).toBe(false);
    for (const bad of [
      { ...evidence, width: 1025 },
      { ...evidence, height: 769 },
      { ...evidence, bytesVerified: 65_537 },
    ]) {
      const bounded = JSON.parse(boundedNativeReceiptEvidence({
        ...good, nativeScreenshotEvidence: bad,
      }) ?? "null") as { nativeTf2Screenshot: Record<string, unknown> };
      expect(bounded.nativeTf2Screenshot[
        bad.width > 1024 ? "width" : bad.height > 768 ? "height" : "bytesVerified"
      ]).toBeNull();
    }
  });

  it("exposes only centrally governed original-page transfer and opaque credential requests", () => {
    const retained = closedNativePage(page, session);
    const exact = "https://example.org/tf4-synthetic-upload";
    const credentialReference = "e".repeat(48);
    expect(nativeSameOriginTransferUrl(exact, page.origin)).toBe(true);
    expect(nativeSameOriginTransferUrl("https://example.org/", page.origin)).toBe(true);
    for (const unsafe of [
      "http://example.org/", "https://another.example.org/path",
      "https://example.org:444/path", "https://example.org/path?token=SECRET",
      "https://example.org/#secret", "https://user:pass@example.org/",
      "https://example.org/a\\b", "https://example.org/secure\n",
    ]) {
      expect(nativeSameOriginTransferUrl(unsafe, page.origin)).toBe(false);
    }
    for (const unsafe of [
      "file.bin", "../tf4-file.bin", "C:/tf4-file.bin",
      "tf4-synthetic.png", "tf4-test.bin/subpath", "tf4-.bin",
      "tf4-SECRET.bin", "tf4-file.bin\n",
    ]) expect(syntheticNativeUploadName(unsafe)).toBe(false);
    expect(syntheticNativeUploadName("tf4-synthetic-test.bin")).toBe(true);
    const base = {
      operation: "download", actor: scope.actor, sessionId: scope.sessionId,
      workspaceRoot: scope.workspaceRoot, browserSessionId: session,
      pageId: page.pageId, pageGeneration: page.pageGeneration,
      snapshotId: page.snapshotId, url: exact,
    };
    expect(originalNativeOperatorRequest("download", scope, retained, undefined, undefined, exact))
      .toEqual(base);
    expect(originalNativeOperatorRequest("upload", scope, retained, undefined,
      "tf4-synthetic-test.bin", exact)).toEqual({
        ...base, operation: "upload", text: "tf4-synthetic-test.bin",
      });
    expect(originalNativeOperatorRequest("credential_get", scope, retained, undefined,
      credentialReference, exact)).toEqual({
        ...base, operation: "credential_get", text: credentialReference,
      });
    expect(originalNativeOperatorRequest("credential_get", scope, retained, undefined,
      "TOP-SECRET", exact)).toBeNull();
    expect(originalNativeOperatorRequest("upload", scope, retained, undefined,
      "../tf4-synthetic.bin", exact)).toBeNull();
    expect(originalNativeOperatorRequest("download", scope, retained, undefined,
      "arbitrary", exact)).toBeNull();
    expect(originalNativeOperatorRequest("download", scope, null, undefined,
      undefined, exact)).toBeNull();
    expect(originalNativeOperatorRequest("download", {
      ...scope, browserId: "f".repeat(48),
    }, retained, undefined, undefined, exact)).toBeNull();
    expect(originalNativeOperatorRequest("download", scope, retained, undefined,
      undefined, "https://other.example.org/")).toBeNull();
    expect(originalNativeOperatorRequest("download", scope, retained, undefined,
      undefined, exact, { openerId: session } as never)).toBeNull();
    for (const operation of ["download", "upload", "credential_get"] as const) {
      expect(preparedNativeOperatorMatches({
        token: "b".repeat(48), requestId: "c".repeat(48), operation,
        requiresApproval: true, browserSessionId: session,
        engine: "confined_webview2_read_only_unaccepted",
      }, operation, session)).toBe(true);
    }
  });

  it("opens a separately consented child only from an existing exact opener session", () => {
    const childUrl = "https://another.example.org/";
    expect(originalNativeOperatorRequest("open_confined_tab", scope, null,
      undefined, undefined, childUrl)).toEqual({
        operation: "open_confined_tab", actor: scope.actor,
        sessionId: scope.sessionId, workspaceRoot: scope.workspaceRoot,
        browserSessionId: session, url: childUrl,
      });
    expect(originalNativeOperatorRequest("open_confined_tab", {
      ...scope, browserId: null,
    }, null, undefined, undefined, childUrl)).toBeNull();
    const prepared = {
      token: "8".repeat(48), requestId: "7".repeat(48),
      operation: "open_confined_tab" as const, requiresApproval: true,
      browserSessionId: "6".repeat(48), engine: "confined_webview2_read_only_unaccepted",
    };
    expect(preparedNativeOperatorMatches(prepared, "open_confined_tab", session)).toBe(true);
    expect(preparedNativeOperatorMatches({ ...prepared, browserSessionId: session },
      "open_confined_tab", session)).toBe(false);
    expect(preparedNativeOperatorMatches({ ...prepared, requiresApproval: false },
      "open_confined_tab", session)).toBe(false);
    expect(nativeOperatorReceiptMatches({
      toolId: "tf.browser_operation.v1", requestId: prepared.requestId,
      actor: scope.actor, sessionId: scope.sessionId, operation: "open_confined_tab",
      browserSessionId: prepared.browserSessionId, engine: prepared.engine,
      terminal: "pending", policyDecision: "allowed", effectState: "Unknown",
      autoRetry: false, reasonCode: "confined-native-appcontainer-ready-broker-serving",
    }, prepared, "open_confined_tab", scope)).toBe(true);
  });

  it("refuses aging original-node UI requests without changing native identity or auto-retrying", () => {
    const now = 1_800_000_000_000;
    expect(nativeHumanRetainedObservationFresh(now - 1, now)).toBe(true);
    expect(nativeHumanRetainedObservationFresh(now - 25_000, now)).toBe(true);
    expect(nativeHumanRetainedObservationFresh(now - 25_001, now)).toBe(false);
    expect(nativeHumanRetainedObservationFresh(null, now)).toBe(false);
    expect(nativeHumanRetainedObservationFresh(now + 1, now)).toBe(false);
    expect(nativeHumanRetainedObservationFresh(0, now)).toBe(false);
    expect(nativeHumanRetainedObservationFresh(now, NaN)).toBe(false);
    // A new observation must produce an entirely new original retained
    // snapshot. The UI age check never claims that a matching hash/selector
    // makes the previous snapshot's node live again.
    const first = closedNativePage(page, session);
    const second = closedNativePage({
      ...page, snapshotId: "4".repeat(48),
      elements: [{ elementRef: "5".repeat(48), role: "link" }],
    }, session);
    expect(first?.elements[0].elementRef).not.toBe(second?.elements[0].elementRef);
    expect(originalNativeOperatorRequest("click", scope, second, first?.elements[0]))
      .toBeNull();
  });

  it("exports only closed TF3/TF2 transfer and opaque-keyring digest evidence", () => {
    const common = { requestId: "f".repeat(48), browserSessionId: session,
      terminal: "completed", retry: "NEVER_REPLAY", autoRetry: false,
      policyDecision: "allowed", effectState: "Unknown" };
    const secret = "PRIVATE_PAGE_OR_CREDENTIAL_VALUE";
    const credential = boundedNativeReceiptEvidence({
      ...common, operation: "credential_get",
      nativeCredentialTransport: {
        requestMethod: "GET", destinationSha256: "a".repeat(64),
        referenceSha256: "b".repeat(64), tf3RequestId: "c".repeat(48),
        credentialSentToApprovedOrigin: true, statusCode: 200,
        effectState: "Unknown", retry: "NEVER_REPLAY", origin: secret,
      },
    });
    expect(credential).toContain('"credentialSentToApprovedOrigin": true');
    expect(credential).not.toContain(secret);
    const download = boundedNativeReceiptEvidence({
      ...common, operation: "download", effectState: "Observed",
      nativeDownloadEvidence: {
        method: "GET", sourceUrlSha256: "a".repeat(64),
        responseSha256: "b".repeat(64), bytesVerified: 65_536,
        workspaceRelativeFile: `tf4-browser-download-${"d".repeat(24)}.bin`,
        pageId: page.pageId, pageGeneration: page.pageGeneration,
        snapshotId: page.snapshotId, tf3RequestId: "c".repeat(48),
        fileEffectState: "Observed", retry: "NEVER_REPLAY",
        fullPath: secret, bytes: secret,
      },
    });
    expect(download).toContain('"bytesVerified": 65536');
    expect(download).not.toContain(secret);
    const invalid = boundedNativeReceiptEvidence({
      ...common, operation: "download",
      nativeDownloadEvidence: {
        method: "POST", bytesVerified: 65_537,
        workspaceRelativeFile: "../private.bin", responseSha256: "bad",
        pageId: secret,
      },
    });
    expect(invalid).toContain('"bytesVerified": null');
    expect(invalid).toContain('"workspaceRelativeFile": null');
    expect(invalid).not.toContain(secret);
    const upload = boundedNativeReceiptEvidence({
      ...common, operation: "upload",
      nativeUploadTransport: {
        method: "POST", destinationSha256: "a".repeat(64),
        originalFileSha256: "b".repeat(64), bodyBytes: 70000,
        tf3RequestId: "c".repeat(48), remoteEffectState: "Unknown",
        retry: "NEVER_REPLAY", originalBytes: secret,
      },
    });
    expect(upload).toContain('"bodyBytes": null');
    expect(upload).not.toContain(secret);
    const preDispatchDenial = boundedNativeReceiptEvidence({
      ...common, operation: "download", terminal: "denied",
      policyDecision: "denied", effectState: "NoEffect",
      reasonCode: "native-transfer-TF3-public-policy-or-witness-denied",
    });
    expect(preDispatchDenial).toContain('"effectState": "NoEffect"');
    expect(preDispatchDenial).toContain('"policyDecision": "denied"');
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
