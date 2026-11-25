import { Button } from "@/components/ui/button";
import type { BrowserSessionSummary } from "@/modules/ai/lib/browserRuntimeStatus";
import { invoke } from "@tauri-apps/api/core";
import { useRef, useState } from "react";

/** Explicit human-operated native acceptance surface. This is NOT a model
 * tool or a second approval system: every request uses the existing TF4
 * prepare -> genuine Tauri OS dialog -> execute authority and single-use token. */
type NativeOperation =
  | "open_confined"
  | "observe_confined"
  | "click"
  | "trigger_page_popup"
  | "open_requested_popup"
  | "type"
  | "clear"
  | "select"
  | "check"
  | "uncheck"
  | "scroll"
  | "submit"
  | "screenshot"
  | "close_confined";
type Prepared = {
  token: string;
  requestId: string;
  operation: NativeOperation;
  requiresApproval: boolean;
  browserSessionId: string | null;
  engine: string;
};
type NativeElement = { elementRef: string; role: string; fieldType?: "submit" };
export type NativePage = {
  browserSessionId: string;
  pageId: string;
  pageGeneration: number;
  snapshotId: string;
  origin: string;
  elements: NativeElement[];
};
type NativeReceipt = {
  toolId: string;
  requestId: string;
  actor: string;
  sessionId: string;
  operation: NativeOperation;
  browserSessionId: string | null;
  engine: string;
  terminal: string;
  nativeTerminal?: string;
  canonicalTerminal?: string;
  reasonCode: string;
  policyDecision: string;
  effectState: string;
  retry?: string;
  autoRetry?: boolean;
  nativeFormTransport?: {
    method: string;
    destinationSha256: string;
    bodySha256: string;
    bodyBytes: number;
  };
  nativePage?: unknown;
  nativeScreenshotEvidence?: {
    format?: string;
    width?: number;
    height?: number;
    contentSha256?: string;
    bytesVerified?: number;
    workspaceRelativeFile?: string;
    effectState?: string;
    retry?: string;
  };
  nativeEffectEvidence?: {
    brokerRequestId: number;
    sourcePageGeneration: number;
    observedPageGeneration: number;
    origin: string;
    resultingUrlSha256: string;
    responseSha256: string;
    nativeComCompleted: boolean;
  };
};
const NATIVE_ENGINE = "confined_webview2_read_only_unaccepted";
const exactHandle = (raw: unknown): raw is string =>
  typeof raw === "string" && /^[a-f\d]{48}$/i.test(raw);
const nativeMutation = (operation: NativeOperation): boolean =>
  ["click", "trigger_page_popup", "type", "clear", "select", "check", "uncheck", "scroll", "submit"].includes(
    operation,
  );

/** A human-only acceptance input is deliberately stricter than the native
 * backend. Its bytes must never become a URL, selector or page-exposed log. */
export function boundedNativeTestText(raw: string): boolean {
  return (
    raw.length > 0 &&
    new TextEncoder().encode(raw).length <= 256 &&
    !/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ud800-\udfff\ufeff]/u.test(raw)
  );
}

export function nativeOperatorRoleAllowed(
  operation: NativeOperation,
  role: string,
): boolean {
  switch (operation) {
    case "click":
    case "trigger_page_popup":
      return role === "link";
    case "type":
    case "clear":
      return role === "textbox";
    case "select":
      return role === "combobox";
    case "check":
    case "uncheck":
      return role === "checkbox";
    case "scroll":
      return role === "main" || role === "other";
    default:
      return false;
  }
}

export function confinedRootUrl(raw: string): string | null {
  if (raw.length > 2048 || raw.trim() !== raw) return null;
  try {
    const parsed = new URL(raw);
    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      (parsed.port && parsed.port !== "443") ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== "/"
    ) {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

/** An untrusted renderer-projected snapshot is never an action authority. The
 * native prepare independently looks up the original held Node and scope. */
export function closedNativePage(
  value: unknown,
  expectedSession: string,
): NativePage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const page = value as Record<string, unknown>;
  if (
    page.browserSessionId !== expectedSession ||
    !exactHandle(expectedSession) ||
    !exactHandle(page.pageId) ||
    !exactHandle(page.snapshotId) ||
    !Number.isSafeInteger(page.pageGeneration) ||
    Number(page.pageGeneration) < 1 ||
    typeof page.origin !== "string" ||
    page.origin.length > 512 ||
    !Array.isArray(page.elements) ||
    page.elements.length > 64
  )
    return null;
  try {
    const url = new URL(page.origin);
    if (url.protocol !== "https:" || url.origin !== page.origin) return null;
  } catch {
    return null;
  }
  const elements: NativeElement[] = [];
  for (const item of page.elements) {
    if (
      !item ||
      typeof item !== "object" ||
      !exactHandle(item.elementRef) ||
      typeof item.role !== "string" ||
      ![
        "link",
        "button",
        "checkbox",
        "radio",
        "textbox",
        "combobox",
        "option",
        "form",
        "heading",
        "main",
        "paragraph",
        "image",
        "label",
        "other",
      ].includes(item.role)
    )
      return null;
    elements.push({ elementRef: item.elementRef, role: item.role });
    if (item.role === "button" && item.fieldType === "submit") {
      elements[elements.length - 1].fieldType = "submit";
    }
  }
  return {
    browserSessionId: expectedSession,
    pageId: page.pageId as string,
    pageGeneration: page.pageGeneration as number,
    snapshotId: page.snapshotId as string,
    origin: page.origin,
    elements,
  };
}

/** The projection carries original opaque FORM/submitter references but does
 * not assert their DOM relationship. Native CaptureForm rechecks the actual
 * original DOM nodes and exposes the POST scope in the genuine OS dialog. */
export function originalNativeSubmitPair(
  page: NativePage | null,
  formRef: string,
  submitterRef: string,
): boolean {
  return !!page && exactHandle(page.pageId) && exactHandle(page.snapshotId) &&
    Number.isSafeInteger(page.pageGeneration) && page.pageGeneration >= 1 &&
    exactHandle(formRef) && exactHandle(submitterRef) && formRef !== submitterRef &&
    page.elements.some((element) => element.elementRef === formRef && element.role === "form") &&
    page.elements.some((element) => element.elementRef === submitterRef &&
      element.role === "button" && element.fieldType === "submit");
}

export type NativePopupAttempt = {
  openerId: string;
  sourcePageId: string;
  sourceSnapshotId: string;
  sourceGeneration: number;
  sourceOrigin: string;
  triggerLinkRef: string;
  expectedDestination: string;
};

/** This is an observed *attempt*, NOT a native popup intent ID. Native must
 * capture and match the already-vetoed original intent after fresh consent. */
export function pendingOriginalPopupAttempt(
  page: NativePage | null,
  link: NativeElement | null,
  expectedDestination: string,
  receipt: NativeReceipt,
): NativePopupAttempt | null {
  if (page?.pageGeneration !== 1 || !link || link.role !== "link" ||
      !page.elements.some((item) => item.elementRef === link.elementRef && item.role === "link") ||
      !exactHandle(page.browserSessionId) || !exactHandle(page.pageId) ||
      !exactHandle(page.snapshotId) || !exactHandle(link.elementRef) ||
      confinedRootUrl(expectedDestination) !== expectedDestination ||
      receipt.operation !== "trigger_page_popup" ||
      receipt.toolId !== "tf.browser_operation.v1" ||
      receipt.engine !== NATIVE_ENGINE ||
      receipt.browserSessionId !== page.browserSessionId ||
      receipt.policyDecision !== "allowed" ||
      receipt.nativeTerminal !== "DISPATCHED" ||
      receipt.canonicalTerminal !== "UNKNOWN" ||
      receipt.effectState !== "Unknown" ||
      receipt.retry !== "NEVER_REPLAY" || receipt.autoRetry !== false) return null;
  return {
    openerId: page.browserSessionId, sourcePageId: page.pageId,
    sourceSnapshotId: page.snapshotId, sourceGeneration: page.pageGeneration,
    sourceOrigin: page.origin, triggerLinkRef: link.elementRef,
    expectedDestination,
  };
}

/** Prepare accepts the *opener* and expected destination, not a fabricated
 * popup-intent token or the page's DOM references. Native owns that binding. */
export function originalNativeOperatorRequest(
  operation: NativeOperation,
  scope: { actor: string; sessionId: string; workspaceRoot: string; browserId: string | null },
  page: NativePage | null,
  element?: NativeElement,
  parameters?: string,
  url?: string,
  popup?: NativePopupAttempt | null,
): Record<string, unknown> | null {
  if (!scope.actor || !scope.sessionId || !scope.workspaceRoot) return null;
  const base = {
    operation, actor: scope.actor, sessionId: scope.sessionId,
    workspaceRoot: scope.workspaceRoot,
  };
  if (operation === "open_confined") {
    const root = confinedRootUrl(url ?? "");
    return root ? { ...base, url: root } : null;
  }
  if (!exactHandle(scope.browserId)) return null;
  if (operation === "open_requested_popup") {
    return popup && popup.openerId === scope.browserId &&
      popup.sourceGeneration === 1 && exactHandle(popup.sourcePageId) &&
      exactHandle(popup.sourceSnapshotId) && exactHandle(popup.triggerLinkRef) &&
      confinedRootUrl(popup.expectedDestination) === popup.expectedDestination
      ? { ...base, browserSessionId: scope.browserId, url: popup.expectedDestination }
      : null;
  }
  if (operation === "screenshot") {
    // A screenshot is never authorized by the session ID alone. The backend
    // rechecks this exact retained native page/snapshot before showing the
    // genuine OS privacy+TF2 destination approval and again when consuming it.
    if (!page || page.browserSessionId !== scope.browserId ||
        !exactHandle(page.pageId) || !exactHandle(page.snapshotId) ||
        !Number.isSafeInteger(page.pageGeneration) || page.pageGeneration < 1 ||
        element !== undefined || parameters !== undefined || url !== undefined)
      return null;
    return {
      ...base, browserSessionId: scope.browserId,
      pageId: page.pageId, pageGeneration: page.pageGeneration,
      snapshotId: page.snapshotId,
    };
  }
  if (!nativeMutation(operation)) {
    return { ...base, browserSessionId: scope.browserId };
  }
  if (!page || page.browserSessionId !== scope.browserId ||
      !element || !exactHandle(element.elementRef) ||
      !page.elements.some((item) => item.elementRef === element.elementRef && item.role === element.role) ||
      !exactHandle(page.pageId) || !exactHandle(page.snapshotId) ||
      !Number.isSafeInteger(page.pageGeneration) || page.pageGeneration < 1) return null;
  if (operation === "submit") {
    if (!originalNativeSubmitPair(page, parameters ?? "", element.elementRef)) return null;
  } else if (!nativeOperatorRoleAllowed(operation, element.role)) return null;
  if (operation === "trigger_page_popup" &&
      (page.pageGeneration !== 1 || confinedRootUrl(url ?? "") !== url)) return null;
  if ((operation === "type" && !boundedNativeTestText(parameters ?? "")) ||
      (operation === "select" && (!exactHandle(parameters) ||
        parameters === element.elementRef || !page.elements.some(
          (item) => item.elementRef === parameters && item.role === "option"))) ||
      (operation === "scroll" && parameters !== "up" && parameters !== "down") ||
      (["click", "trigger_page_popup", "clear", "check", "uncheck"].includes(operation) &&
        parameters !== undefined)) return null;
  return {
    ...base, browserSessionId: scope.browserId, pageId: page.pageId,
    pageGeneration: page.pageGeneration, snapshotId: page.snapshotId,
    elementId: element.elementRef,
    ...(parameters !== undefined ? { text: parameters } : {}),
  };
}

/** The native opener is input to a popup request, but the returned prepared
 * browserSessionId is a newly reserved child. Do not compare the two as tabs. */
export function preparedNativeOperatorMatches(
  prepared: Prepared,
  operation: NativeOperation,
  originalBrowserId: string | null,
): boolean {
  const opensSession = operation === "open_confined" || operation === "open_requested_popup";
  return exactHandle(prepared.token) && exactHandle(prepared.requestId) &&
    prepared.operation === operation && prepared.engine === NATIVE_ENGINE &&
    prepared.requiresApproval === (operation !== "close_confined") &&
    (opensSession
      ? exactHandle(prepared.browserSessionId) &&
        (operation !== "open_requested_popup" || prepared.browserSessionId !== originalBrowserId)
      : prepared.browserSessionId === originalBrowserId && exactHandle(originalBrowserId));
}

export function nativeOperatorReceiptMatches(
  receipt: NativeReceipt,
  prepared: Prepared,
  operation: NativeOperation,
  scope: { actor: string; sessionId: string; browserId: string | null },
): boolean {
  const opensSession = operation === "open_confined" || operation === "open_requested_popup";
  return receipt.toolId === "tf.browser_operation.v1" &&
    receipt.requestId === prepared.requestId && receipt.actor === scope.actor &&
    receipt.sessionId === scope.sessionId && receipt.operation === operation &&
    receipt.engine === NATIVE_ENGINE && receipt.autoRetry === false &&
    (opensSession
      ? exactHandle(prepared.browserSessionId) &&
        receipt.browserSessionId === prepared.browserSessionId &&
        (operation !== "open_requested_popup" || receipt.browserSessionId !== scope.browserId)
      : receipt.browserSessionId === scope.browserId && exactHandle(scope.browserId));
}

function safeReason(error: unknown): string {
  const reason = typeof error === "string" ? error : "";
  // Never reflect page-derived paths, request bodies, credentials or stacks.
  return /^[a-z][a-z\d-]{1,100}$/.test(reason)
    ? reason
    : "native-authorization-or-transport-unverified";
}

/** Explicit human-readable receipt export for physical acceptance. Only
 * closed authority states, opaque IDs and evidence digests may leave this
 * component. Never stringify the full native receipt: it can carry URLs,
 * snapshot content or future fields with secrets. */
export function boundedNativeReceiptEvidence(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const receipt = value as Record<string, unknown>;
  if (
    !exactHandle(receipt.requestId) ||
    typeof receipt.operation !== "string" ||
    ![
      "open_confined", "observe_confined", "click", "trigger_page_popup",
      "open_requested_popup", "type", "clear", "select", "check", "uncheck",
      "scroll", "submit", "screenshot", "close_confined",
    ].includes(receipt.operation)
  ) return null;
  const closed = (item: unknown, allowed: readonly string[]): string =>
    typeof item === "string" && allowed.includes(item) ? item : "UNVERIFIED";
  const hash = (item: unknown): string | null =>
    typeof item === "string" && /^[0-9a-f]{64}$/.test(item) ? item : null;
  const rawEvidence = receipt.nativeEffectEvidence;
  const evidence =
    rawEvidence && typeof rawEvidence === "object" && !Array.isArray(rawEvidence)
      ? (rawEvidence as Record<string, unknown>)
      : null;
  const rawTransport = receipt.nativeFormTransport;
  const formTransport =
    receipt.operation === "submit" && rawTransport &&
    typeof rawTransport === "object" && !Array.isArray(rawTransport)
      ? (rawTransport as Record<string, unknown>) : null;
  const rawScreenshot = receipt.nativeScreenshotEvidence;
  const screenshot = receipt.operation === "screenshot" && rawScreenshot &&
    typeof rawScreenshot === "object" && !Array.isArray(rawScreenshot)
      ? (rawScreenshot as Record<string, unknown>) : null;
  const screenshotFile =
    typeof screenshot?.workspaceRelativeFile === "string" &&
    /^tf4-browser-screenshot-[a-f0-9]{24}\.png$/.test(screenshot.workspaceRelativeFile)
      ? screenshot.workspaceRelativeFile : null;
  const safe = {
    requestId: receipt.requestId,
    operation: receipt.operation,
    browserSessionId: exactHandle(receipt.browserSessionId) ? receipt.browserSessionId : null,
    terminal: closed(receipt.terminal, ["success", "completed", "pending", "failed", "denied", "unknown", "cancelled"]),
    nativeTerminal: closed(receipt.nativeTerminal, ["DENIED", "STALE", "CANCELLED_BEFORE_DISPATCH", "FAILED_BEFORE_DISPATCH", "DISPATCHED", "CONFIRMED", "UNKNOWN"]),
    canonicalTerminal: closed(receipt.canonicalTerminal, ["SUCCESS", "FAILED", "CANCELLED", "UNKNOWN"]),
    policyDecision: closed(receipt.policyDecision, ["allowed", "denied"]),
    effectState: closed(receipt.effectState, ["Observed", "Unknown", "NotAttempted"]),
    retry: closed(receipt.retry, ["NEVER_REPLAY", "SAFE_REPREPARE", "NOT_ATTEMPTED", "SAFE_RETRY"]),
    autoRetry: receipt.autoRetry === true,
    reasonCode: safeReason(receipt.reasonCode),
    nativeComCompleted: evidence?.nativeComCompleted === true,
    brokerRequestId:
      Number.isSafeInteger(evidence?.brokerRequestId) && Number(evidence?.brokerRequestId) >= 1
        ? evidence?.brokerRequestId : null,
    sourcePageGeneration:
      Number.isSafeInteger(evidence?.sourcePageGeneration) && Number(evidence?.sourcePageGeneration) >= 1
        ? evidence?.sourcePageGeneration : null,
    observedPageGeneration:
      Number.isSafeInteger(evidence?.observedPageGeneration) && Number(evidence?.observedPageGeneration) >= 1
        ? evidence?.observedPageGeneration : null,
    resultingUrlSha256: hash(evidence?.resultingUrlSha256),
    responseSha256: hash(evidence?.responseSha256),
    originalFormTransport: formTransport ? {
      method: closed(formTransport.method, ["POST"]),
      destinationSha256: hash(formTransport.destinationSha256),
      bodySha256: hash(formTransport.bodySha256),
      bodyBytes: Number.isSafeInteger(formTransport.bodyBytes) &&
        Number(formTransport.bodyBytes) >= 0 && Number(formTransport.bodyBytes) <= 65_536
        ? formTransport.bodyBytes : null,
    } : null,
    nativeTf2Screenshot: screenshot ? {
      format: closed(screenshot.format, ["png"]),
      width: Number.isSafeInteger(screenshot.width) &&
        Number(screenshot.width) >= 1 && Number(screenshot.width) <= 16_384
        ? screenshot.width : null,
      height: Number.isSafeInteger(screenshot.height) &&
        Number(screenshot.height) >= 1 && Number(screenshot.height) <= 16_384
        ? screenshot.height : null,
      contentSha256: hash(screenshot.contentSha256),
      bytesVerified: Number.isSafeInteger(screenshot.bytesVerified) &&
        Number(screenshot.bytesVerified) >= 1 && Number(screenshot.bytesVerified) <= 16 * 1024 * 1024
        ? screenshot.bytesVerified : null,
      workspaceRelativeFile: screenshotFile,
      effectState: closed(screenshot.effectState, ["Observed", "Unknown", "NotAttempted"]),
      retry: closed(screenshot.retry, ["NEVER_REPLAY"]),
    } : null,
  };
  return JSON.stringify(safe, null, 2);
}

export function NativeBrowserOperatorPanel({
  actor,
  sessionId,
  workspaceRoot,
  sessions,
  onChanged,
}: {
  actor: string;
  sessionId: string;
  workspaceRoot: string;
  sessions: BrowserSessionSummary[];
  onChanged: () => void;
}) {
  const [initialUrl, setInitialUrl] = useState("");
  const [browserId, setBrowserId] = useState<string | null>(null);
  const [page, setPage] = useState<NativePage | null>(null);
  const [expectedPopupUrl, setExpectedPopupUrl] = useState("");
  const [popupAttempt, setPopupAttempt] = useState<NativePopupAttempt | null>(null);
  const [formRef, setFormRef] = useState("");
  const [submitterRef, setSubmitterRef] = useState("");
  const [testText, setTestText] = useState("");
  const [lastEvidence, setLastEvidence] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Disable the same UI transaction synchronously, before React paints busy.
  // The native token is still the one-use effect authority.
  const transactionActive = useRef(false);
  const [result, setResult] = useState("Native browser has not been launched.");
  const nativeSessions = sessions.filter(
    (item) => item.engine === NATIVE_ENGINE,
  );

  async function executeOnce(
    operation: NativeOperation,
    element?: NativeElement,
    parameters?: string,
  ): Promise<void> {
    if (busy || transactionActive.current) return;
    const activePage = page;
    const activeBrowserId = browserId;
    const request = originalNativeOperatorRequest(
      operation, { actor, sessionId, workspaceRoot, browserId: activeBrowserId },
      activePage, element, parameters,
      operation === "open_confined" ? initialUrl :
        operation === "trigger_page_popup" ? expectedPopupUrl : undefined,
      popupAttempt,
    );
    if (!request) {
      setResult("Native exact action parameters denied before preparation.");
      return;
    }
    transactionActive.current = true;
    const triggeredPopupUrl = operation === "trigger_page_popup" ? expectedPopupUrl : null;
    // Beginning another operation changes the original opener/snapshot scope.
    // Never reuse an old trigger attempt, even on denial or transport UNKNOWN.
    setPopupAttempt(null);
    setBusy(true);
    setLastEvidence(null);
    if (operation === "type") setTestText("");
    if (nativeMutation(operation) || operation === "screenshot") {
      setFormRef("");
      setSubmitterRef("");
    }
    setResult(
      `Native ${operation.replace(/_/g, " ")} awaiting application authorization…`,
    );
    let preparedToken: string | null = null;
    try {
      const prepared = await invoke<Prepared>("tf_browser_prepare", {
        request,
      });
      const isOpen = operation === "open_confined" || operation === "open_requested_popup";
      if (!preparedNativeOperatorMatches(prepared, operation, activeBrowserId)) {
        throw Error("native-prepared-scope-mismatch");
      }
      preparedToken = prepared.token;
      if (prepared.requiresApproval) {
        // Actual user decision occurs only inside the existing Tauri OS dialog.
        await invoke<void>("tf_browser_approve", { token: preparedToken });
      }
      if (nativeMutation(operation) || operation === "screenshot")
        setPage(null); // Screenshot can advance the session revision; no stale refs.
      const receipt = await invoke<NativeReceipt>("tf_browser_execute", {
        token: preparedToken,
      });
      preparedToken = null; // The existing pending token has been burned.
      if (!nativeOperatorReceiptMatches(receipt, prepared, operation,
        { actor, sessionId, browserId: activeBrowserId })) {
        throw Error("native-effect-receipt-scope-mismatch");
      }
      setLastEvidence(boundedNativeReceiptEvidence(receipt));
      if (isOpen) {
        if (
          !exactHandle(receipt.browserSessionId) ||
          receipt.terminal !== "pending" ||
          receipt.policyDecision !== "allowed" ||
          receipt.effectState !== "Unknown" ||
          receipt.autoRetry !== false
        )
          throw Error("native-open-unverified");
        setBrowserId(receipt.browserSessionId);
        setPage(null);
        setResult(
          operation === "open_requested_popup"
            ? `Separately consented page-requested popup child ${receipt.browserSessionId.slice(0, 10)} launched under the original opener. Independently isolated; document outcome still pending. Observe child before further actions.`
            : "Confined session launched. Observe after the HTTPS document loads; no page action is approved yet.",
        );
      } else if (operation === "observe_confined") {
        const found = closedNativePage(receipt.nativePage, activeBrowserId as string);
        if (receipt.terminal !== "completed" || !found)
          throw Error("native-snapshot-unverified");
        setPage(found);
        setFormRef("");
        setSubmitterRef("");
        setResult(
          `Authenticated native snapshot ${found.snapshotId.slice(0, 10)} · ${found.elements.length} bounded elements · ${found.origin}`,
        );
      } else if (operation === "trigger_page_popup") {
        const attempted = pendingOriginalPopupAttempt(
          activePage, element ?? null, triggeredPopupUrl ?? "", receipt,
        );
        setPopupAttempt(attempted);
        setResult(attempted
          ? "Original-page target=_blank trigger DISPATCHED, effect UNKNOWN. No popup intent ID or child launch is proven. The expected HTTPS root is locked to this attempt; a separate native capture and OS consent must match its original vetoed event. Never replay the trigger."
          : `Original-page popup trigger not established · ${safeReason(receipt.reasonCode)}. Do not replay an uncertain gesture.`);
      } else if (operation === "submit") {
        const transport = receipt.nativeFormTransport;
        const sent = receipt.nativeTerminal === "DISPATCHED" &&
          receipt.canonicalTerminal === "UNKNOWN" &&
          receipt.effectState === "Unknown" &&
          transport?.method === "POST" &&
          /^[a-f0-9]{64}$/.test(transport.bodySha256) &&
          /^[a-f0-9]{64}$/.test(transport.destinationSha256);
        setResult(sent
          ? "Original FORM+submitter native POST: TF3 transport receipt observed. Server-side effect UNKNOWN; NEVER REPLAY. Only closed SHA-256 and byte evidence exported."
          : `Original FORM submission unverified/UNKNOWN · ${safeReason(receipt.reasonCode)}. Never replay a possible write.`);
      } else if (operation === "screenshot") {
        const evidence = receipt.nativeScreenshotEvidence;
        const verified = receipt.terminal === "completed" &&
          receipt.policyDecision === "allowed" &&
          receipt.effectState === "Observed" &&
          evidence?.format === "png" &&
          /^[a-f0-9]{64}$/.test(evidence.contentSha256 ?? "") &&
          /^tf4-browser-screenshot-[a-f0-9]{24}\.png$/.test(evidence.workspaceRelativeFile ?? "") &&
          Number.isSafeInteger(evidence.bytesVerified) && (evidence.bytesVerified ?? 0) > 0;
        setResult(verified
          ? "Native screenshot: genuine per-call OS privacy consent and TF2 workspace PNG commit/readback reported. Independently verify the fixed evidence path and SHA-256. Re-observe before further page actions."
          : `Native screenshot outcome UNKNOWN or unverified · ${safeReason(receipt.reasonCode)}. NEVER REPLAY.`);
      } else if (operation === "click") {
        const success =
          receipt.terminal === "success" &&
          receipt.nativeTerminal === "CONFIRMED" &&
          receipt.canonicalTerminal === "SUCCESS" &&
          receipt.effectState === "Observed" &&
          !!receipt.nativeEffectEvidence?.nativeComCompleted;
        setResult(
          success
            ? `Confirmed via independent TF3 document #${receipt.nativeEffectEvidence?.brokerRequestId}; response hash ${receipt.nativeEffectEvidence?.responseSha256.slice(0, 12)}…`
            : `Click ${receipt.canonicalTerminal === "UNKNOWN" ? "UNKNOWN — do not retry" : "not confirmed"} · ${safeReason(receipt.reasonCode)}`,
        );
      } else if (nativeMutation(operation)) {
        // A boolean DOM dispatch ACK is not an independently verified field,
        // scroll, handler or network effect. The receipt owner must remain
        // conservative. Never restore the consumed action or retry it.
        setResult(
          `${operation.toUpperCase()} ${receipt.canonicalTerminal === "UNKNOWN" ? "UNKNOWN — do not retry" : "not independently confirmed"} · ${safeReason(receipt.reasonCode)}`,
        );
      } else {
        setPage(null);
        setBrowserId(null);
        setFormRef("");
        setSubmitterRef("");
        setResult(
          receipt.terminal === "completed" && receipt.effectState === "Observed"
            ? "Native Job, profile and UDF closure reported complete."
            : `Native close unverified · ${safeReason(receipt.reasonCode)}`,
        );
      }
      onChanged();
    } catch (error) {
      // This is a per-call revoke, not a second action/approval or retry.
      if (preparedToken) {
        try {
          await invoke("tf_browser_cancel", { token: preparedToken });
        } catch {
          /* already consumed */
        }
      }
      setResult(
        `Native transaction unverified or denied · ${safeReason(error)}`,
      );
      onChanged();
    } finally {
      transactionActive.current = false;
      setBusy(false);
    }
  }

  return (
    <details className="space-y-1 border-t pt-2 text-[11px]">
      <summary className="cursor-pointer font-medium">
        Experimental native acceptance (human-operated)
      </summary>
      <p className="text-muted-foreground">
        No native model tools are enabled. The OS asks for genuine per-call
        consent. This is not a general Internet browser; TF3 can deny an origin.
      </p>
      {nativeSessions.map((session) => (
        <Button
          key={session.browserSessionId}
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setBrowserId(session.browserSessionId);
            setPage(null);
            setPopupAttempt(null);
            setExpectedPopupUrl("");
            setFormRef("");
            setSubmitterRef("");
            setResult(
              "Bound to scoped native session. Observe to obtain fresh exact nodes.",
            );
          }}
        >
          Attach native {session.browserSessionId.slice(0, 8)}
        </Button>
      ))}
      <label className="block text-muted-foreground" htmlFor="tf4-owned-origin">
        Explicit HTTPS origin root
      </label>
      <input
        id="tf4-owned-origin"
        type="url"
        value={initialUrl}
        disabled={busy || !!browserId}
        onChange={(event) => setInitialUrl(event.currentTarget.value)}
        className="w-full rounded border bg-background px-2 py-1"
      />
      <div className="flex flex-wrap gap-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || !!browserId || !confinedRootUrl(initialUrl)}
          onClick={() => {
            void executeOnce("open_confined");
          }}
        >
          Open + approve
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || !browserId}
          onClick={() => {
            void executeOnce("observe_confined");
          }}
        >
          Observe + approve
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || !browserId}
          onClick={() => {
            void executeOnce("close_confined");
          }}
        >
          Close owned session
        </Button>
      </div>
      {popupAttempt && browserId === popupAttempt.openerId ? (
        <section aria-label="Original page popup follow-up" className="space-y-1 rounded border p-2">
          <p className="font-medium">Stage 2 · original page-requested popup (not an app tab)</p>
          <p className="text-muted-foreground">
            Original opener {popupAttempt.openerId.slice(0, 10)} · page {popupAttempt.sourcePageId.slice(0, 10)} · snapshot {popupAttempt.sourceSnapshotId.slice(0, 10)} · generation {popupAttempt.sourceGeneration} · origin {popupAttempt.sourceOrigin}.
          </p>
          <p className="text-muted-foreground">
            Original link {popupAttempt.triggerLinkRef.slice(0, 10)} was dispatched, but the host-vetoed native intent has not been verified in this UI. Expected destination: {popupAttempt.expectedDestination}. Native must capture a fresh matching one-use vetoed intent from this live original opener and display a separate OS approval before launching an isolated child. If the destination or original owner changed, it must deny. No automatic retry.
          </p>
          <Button type="button" size="sm" variant="outline" disabled={busy}
            onClick={() => { void executeOnce("open_requested_popup"); }}>
            Capture original popup + approve separate child
          </Button>
        </section>
      ) : null}
      {page ? (
        <div className="space-y-1">
          <p className="text-muted-foreground">
            Exact snapshot generation {page.pageGeneration}. Page labels,
            destinations and values are withheld. Use only your controlled
            test fixture and synthetic, non-secret text. Every action needs
            its own genuine OS approval; UNKNOWN must never be retried.
          </p>
          <p className="text-muted-foreground">
            Original browser {page.browserSessionId.slice(0, 10)} · page {page.pageId.slice(0, 10)} · snapshot {page.snapshotId.slice(0, 10)} · origin {page.origin}.
          </p>
          <Button type="button" size="sm" variant="outline" disabled={busy}
            onClick={() => { void executeOnce("screenshot"); }}>
            Capture original page screenshot into TF2 workspace + OS privacy approval
          </Button>
          <p className="text-muted-foreground">
            This captures potentially sensitive on-screen content. The genuine
            OS dialog identifies the exact workspace-relative PNG destination;
            approve only for a trusted workspace. No screenshot bytes are shown
            to the model or copied into the native receipt.
          </p>
          {page.elements
            .filter((element) => element.role === "link")
            .slice(0, 8)
            .map((element, i) => (
              <Button
                key={element.elementRef}
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  void executeOnce("click", element);
                }}
              >
                Approve exact link {i + 1} · {element.elementRef.slice(0, 8)}
              </Button>
            ))}
          {page.pageGeneration === 1 && page.elements.some((item) => item.role === "link") ? (
            <section aria-label="Original page popup trigger" className="space-y-1 rounded border p-2">
              <p className="font-medium">Stage 1 · original target=_blank page gesture</p>
              <label className="block text-muted-foreground" htmlFor="tf4-native-popup-destination">
                Independently known exact expected HTTPS popup origin root (required before triggering)
              </label>
              <input id="tf4-native-popup-destination" type="url" value={expectedPopupUrl}
                autoComplete="off" spellCheck={false} maxLength={2048}
                disabled={busy} onChange={(event) => setExpectedPopupUrl(event.currentTarget.value)}
                className="w-full rounded border bg-background px-2 py-1" />
              <p className="text-muted-foreground">
                These are opaque original links, not verified target=_blank candidates. Native rejects other roles/targets. The first approval only tries the original gesture and does not authorize a popup. No URL, scripting or fabricated intent is sent with that trigger.
              </p>
              {page.elements.filter((item) => item.role === "link").slice(0, 8).map((item, i) => (
                <Button key={item.elementRef} type="button" size="sm" variant="outline"
                  disabled={busy || confinedRootUrl(expectedPopupUrl) !== expectedPopupUrl}
                  onClick={() => { void executeOnce("trigger_page_popup", item); }}>
                  Trigger original link {i + 1} · {item.elementRef.slice(0, 8)} + approve
                </Button>
              ))}
            </section>
          ) : null}
          {page.elements.some((item) => item.role === "form") &&
            page.elements.some((item) => item.role === "button" && item.fieldType === "submit") ? (
            <section aria-label="Original native form submit" className="space-y-1 rounded border p-2">
              <p className="font-medium">Original FORM + submitter · native POST</p>
              <p className="text-muted-foreground">
                Choose both independently retained original nodes. This snapshot cannot prove which submitter belongs to which FORM: native will reject a mismatch, re-capture original successful controls and show the exact destination and body digest in its OS dialog before any POST. Remote effect stays UNKNOWN; NEVER REPLAY.
              </p>
              <label className="block text-muted-foreground" htmlFor="tf4-original-form">Original FORM node</label>
              <select id="tf4-original-form" className="w-full rounded border bg-background px-2 py-1"
                value={formRef} disabled={busy} onChange={(event) => setFormRef(event.currentTarget.value)}>
                <option value="">Select original FORM</option>
                {page.elements.filter((item) => item.role === "form").slice(0, 8).map((item, i) => (
                  <option key={item.elementRef} value={item.elementRef}>FORM {i + 1} · {item.elementRef.slice(0, 10)}</option>
                ))}
              </select>
              <label className="block text-muted-foreground" htmlFor="tf4-original-submitter">Original submit button node</label>
              <select id="tf4-original-submitter" className="w-full rounded border bg-background px-2 py-1"
                value={submitterRef} disabled={busy} onChange={(event) => setSubmitterRef(event.currentTarget.value)}>
                <option value="">Select original submitter</option>
                {page.elements.filter((item) => item.role === "button" && item.fieldType === "submit")
                  .slice(0, 8).map((item, i) => (
                    <option key={item.elementRef} value={item.elementRef}>Submitter {i + 1} · {item.elementRef.slice(0, 10)}</option>
                  ))}
              </select>
              <Button type="button" size="sm" variant="outline"
                disabled={busy || !originalNativeSubmitPair(page, formRef, submitterRef)}
                onClick={() => {
                  const submitter = page.elements.find((item) => item.elementRef === submitterRef);
                  if (submitter) void executeOnce("submit", submitter, formRef);
                }}>
                Submit exact original FORM + submitter + OS approval
              </Button>
            </section>
          ) : (
            <p className="text-muted-foreground">Original FORM submit unavailable: snapshot lacks an exact retained FORM and a button whose native fieldType is submit. No synthetic submitter or payload will be created.</p>
          )}
          {page.elements.some((element) => element.role === "textbox") ? (
            <>
              <label className="block text-muted-foreground" htmlFor="tf4-native-test-text">
                Synthetic non-secret text (up to 256 UTF-8 bytes)
              </label>
              <input
                id="tf4-native-test-text"
                type="text"
                autoComplete="off"
                spellCheck={false}
                maxLength={256}
                value={testText}
                disabled={busy}
                onChange={(event) => setTestText(event.currentTarget.value)}
                className="w-full rounded border bg-background px-2 py-1"
              />
            </>
          ) : null}
          {page.elements
            .filter((element) => element.role === "textbox")
            .slice(0, 6)
            .map((element, i) => (
              <div key={element.elementRef} className="flex flex-wrap items-center gap-1">
                <span className="text-muted-foreground">Text control {i + 1} · {element.elementRef.slice(0, 8)}</span>
                <Button type="button" size="sm" variant="outline"
                  disabled={busy || !boundedNativeTestText(testText)}
                  onClick={() => { void executeOnce("type", element, testText); }}>
                  Type + approve
                </Button>
                <Button type="button" size="sm" variant="outline" disabled={busy}
                  onClick={() => { void executeOnce("clear", element); }}>
                  Clear + approve
                </Button>
              </div>
            ))}
          {page.elements
            .filter((element) => element.role === "checkbox")
            .slice(0, 6)
            .map((element, i) => (
              <div key={element.elementRef} className="flex flex-wrap items-center gap-1">
                <span className="text-muted-foreground">Checkbox {i + 1} · {element.elementRef.slice(0, 8)}</span>
                <Button type="button" size="sm" variant="outline" disabled={busy}
                  onClick={() => { void executeOnce("check", element); }}>
                  Check + approve
                </Button>
                <Button type="button" size="sm" variant="outline" disabled={busy}
                  onClick={() => { void executeOnce("uncheck", element); }}>
                  Uncheck + approve
                </Button>
              </div>
            ))}
          {page.elements
            .filter((element) => element.role === "combobox")
            .slice(0, 3)
            .map((element, i) => (
              <div key={element.elementRef} className="space-y-1">
                <span className="text-muted-foreground">Select control {i + 1} · {element.elementRef.slice(0, 8)}</span>
                <div className="flex flex-wrap gap-1">
                  {page.elements
                    .filter((option) => option.role === "option" && option.elementRef !== element.elementRef)
                    .slice(0, 6)
                    .map((option, optionIndex) => (
                      <Button key={option.elementRef} type="button" size="sm" variant="outline"
                        disabled={busy}
                        onClick={() => { void executeOnce("select", element, option.elementRef); }}>
                        Option {optionIndex + 1} · {option.elementRef.slice(0, 8)} + approve
                      </Button>
                    ))}
                </div>
              </div>
            ))}
          {page.elements
            .filter((element) => nativeOperatorRoleAllowed("scroll", element.role))
            .slice(0, 2)
            .map((element, i) => (
              <div key={element.elementRef} className="flex flex-wrap items-center gap-1">
                <span className="text-muted-foreground">Scroll target {i + 1} · {element.elementRef.slice(0, 8)}</span>
                <Button type="button" size="sm" variant="outline" disabled={busy}
                  onClick={() => { void executeOnce("scroll", element, "up"); }}>
                  Up 120 + approve
                </Button>
                <Button type="button" size="sm" variant="outline" disabled={busy}
                  onClick={() => { void executeOnce("scroll", element, "down"); }}>
                  Down 120 + approve
                </Button>
              </div>
            ))}
        </div>
      ) : null}
      <p role="status" className="text-muted-foreground">
        {result}
      </p>
      {lastEvidence ? (
        <div className="space-y-1">
          <label className="block text-muted-foreground" htmlFor="tf4-native-closed-receipt">
            Last bounded native receipt (copy for acceptance review; no URLs, text or secrets)
          </label>
          <textarea
            id="tf4-native-closed-receipt"
            readOnly
            value={lastEvidence}
            rows={9}
            className="w-full resize-y rounded border bg-background p-2 font-mono text-[10px]"
          />
        </div>
      ) : null}
    </details>
  );
}
