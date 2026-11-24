import { Button } from "@/components/ui/button";
import type { BrowserSessionSummary } from "@/modules/ai/lib/browserRuntimeStatus";
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";

/** Explicit human-operated native acceptance surface. This is NOT a model
 * tool or a second approval system: every request uses the existing TF4
 * prepare -> genuine Tauri OS dialog -> execute authority and single-use token. */
type NativeOperation =
  | "open_confined"
  | "observe_confined"
  | "click"
  | "type"
  | "clear"
  | "select"
  | "check"
  | "uncheck"
  | "scroll"
  | "close_confined";
type Prepared = {
  token: string;
  requestId: string;
  operation: NativeOperation;
  requiresApproval: boolean;
  browserSessionId: string | null;
  engine: string;
};
type NativeElement = { elementRef: string; role: string };
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
  nativePage?: unknown;
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
  ["click", "type", "clear", "select", "check", "uncheck", "scroll"].includes(
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
      "open_confined", "observe_confined", "click", "type", "clear",
      "select", "check", "uncheck", "scroll", "close_confined",
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
  const safe = {
    requestId: receipt.requestId,
    operation: receipt.operation,
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
  const [testText, setTestText] = useState("");
  const [lastEvidence, setLastEvidence] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("Native browser has not been launched.");
  const nativeSessions = sessions.filter(
    (item) => item.engine === NATIVE_ENGINE,
  );

  async function executeOnce(
    operation: NativeOperation,
    element?: NativeElement,
    parameters?: string,
  ): Promise<void> {
    if (
      busy ||
      !actor ||
      !sessionId ||
      !workspaceRoot ||
      (operation !== "open_confined" && !exactHandle(browserId))
    )
      return;
    const url =
      operation === "open_confined" ? confinedRootUrl(initialUrl) : null;
    if (operation === "open_confined" && !url) {
      setResult(
        "Enter a HTTPS origin root, with no path, query or credentials.",
      );
      return;
    }
    if (
      nativeMutation(operation) &&
      (!page ||
        !element ||
        !nativeOperatorRoleAllowed(operation, element.role) ||
        !page.elements.some((item) => item.elementRef === element.elementRef))
    )
      return;
    if (
      (operation === "type" && !boundedNativeTestText(parameters ?? "")) ||
      (operation === "select" &&
        (!exactHandle(parameters) ||
          parameters === element?.elementRef ||
          !page?.elements.some(
            (item) => item.elementRef === parameters && item.role === "option",
          ))) ||
      (operation === "scroll" &&
        parameters !== "up" &&
        parameters !== "down") ||
      (["click", "clear", "check", "uncheck"].includes(operation) &&
        parameters !== undefined)
    ) {
      setResult("Native exact action parameters denied before preparation.");
      return;
    }
    setBusy(true);
    setLastEvidence(null);
    if (operation === "type") setTestText("");
    setResult(
      `Native ${operation.replace(/_/g, " ")} awaiting application authorization…`,
    );
    let preparedToken: string | null = null;
    try {
      const prepared = await invoke<Prepared>("tf_browser_prepare", {
        request: {
          operation,
          actor,
          sessionId,
          workspaceRoot,
          ...(url ? { url } : {}),
          ...(operation !== "open_confined"
            ? { browserSessionId: browserId }
            : {}),
          ...(nativeMutation(operation) && page && element
            ? {
                pageId: page.pageId,
                pageGeneration: page.pageGeneration,
                snapshotId: page.snapshotId,
                elementId: element.elementRef,
                ...(parameters !== undefined ? { text: parameters } : {}),
              }
            : {}),
        },
      });
      if (
        !exactHandle(prepared.token) ||
        !exactHandle(prepared.requestId) ||
        prepared.operation !== operation ||
        prepared.engine !== NATIVE_ENGINE ||
        prepared.requiresApproval !== (operation !== "close_confined") ||
        (operation !== "open_confined" &&
          prepared.browserSessionId !== browserId)
      ) {
        throw Error("native-prepared-scope-mismatch");
      }
      preparedToken = prepared.token;
      if (prepared.requiresApproval) {
        // Actual user decision occurs only inside the existing Tauri OS dialog.
        await invoke<void>("tf_browser_approve", { token: preparedToken });
      }
      if (nativeMutation(operation)) setPage(null); // No old refs after attempted effect.
      const receipt = await invoke<NativeReceipt>("tf_browser_execute", {
        token: preparedToken,
      });
      preparedToken = null; // The existing pending token has been burned.
      if (
        receipt.toolId !== "tf.browser_operation.v1" ||
        receipt.requestId !== prepared.requestId ||
        receipt.actor !== actor ||
        receipt.sessionId !== sessionId ||
        receipt.operation !== operation ||
        receipt.engine !== NATIVE_ENGINE ||
        (operation !== "open_confined" &&
          receipt.browserSessionId !== browserId)
      ) {
        throw Error("native-effect-receipt-scope-mismatch");
      }
      setLastEvidence(boundedNativeReceiptEvidence(receipt));
      if (operation === "open_confined") {
        if (
          !exactHandle(receipt.browserSessionId) ||
          receipt.terminal !== "pending" ||
          receipt.policyDecision !== "allowed"
        )
          throw Error("native-open-unverified");
        setBrowserId(receipt.browserSessionId);
        setPage(null);
        setResult(
          "Confined session launched. Observe after the HTTPS document loads; no page action is approved yet.",
        );
      } else if (operation === "observe_confined") {
        const found = closedNativePage(receipt.nativePage, browserId as string);
        if (receipt.terminal !== "completed" || !found)
          throw Error("native-snapshot-unverified");
        setPage(found);
        setResult(
          `Authenticated native snapshot ${found.snapshotId.slice(0, 10)} · ${found.elements.length} bounded elements · ${found.origin}`,
        );
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
      {page ? (
        <div className="space-y-1">
          <p className="text-muted-foreground">
            Exact snapshot generation {page.pageGeneration}. Page labels,
            destinations and values are withheld. Use only your controlled
            test fixture and synthetic, non-secret text. Every action needs
            its own genuine OS approval; UNKNOWN must never be retried.
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
