# TF Slice 4 — interactive WebView network-security gate (BLOCKED)

- **Date:** 2026-11-22
- **PR:** #46, `tf/browser-computer-use` (keep **Draft**, do not merge)
- **Starting commit:** `565ad91a192170c07a585901e6a93b815cba43b0`
**Starting protected main:** `dddab1b9c4f035362c754c5111a39e3c209178a4`

## Decision: STOP before enabling remote rendered-page execution

There is **no proven, authoritative all-network-path intercept/deny** in the
currently integrated Tauri/Wry/WebView2 browser environment. A page can
initiate traffic independently of top-level navigation or the model's requested
action. Simply validating the initial URL or attaching a permissive
`WebResourceRequested` observer does **not** enforce TF3 destination
classification, DNS/IP pinning, redirect policy or external-write approval for
every socket the renderer can initiate. An intercepted request must never
fall through to WebView2's independent network stack.

**Consequently, the secure interactive-engine gate is NOT accepted, no remote
WebView is instantiated, and the existing `inert_native_text` TF3-backed
browser remains the only enabled browser implementation.** No browser
execution features are enabled merely because Tauri exposes DOM, JavaScript
evaluation, navigation or screenshot APIs. No secrets are injected into pages.
The checked version retains the current six supported native-text operations;
the remaining browser/computer-use capabilities are UNSUPPORTED.

This is a release-blocking **architecture gap**, not a failed TypeScript
schema test, a cosmetic UI issue or a reason to weaken protected main.

## Installed code/API evidence

1. `src-tauri/Cargo.toml` uses Tauri 2 with WebView2 via Wry on Windows.
   The resolved locked dependency tree contains Tauri **2.11.2**,
   `tauri-runtime-wry` **2.11.2**, Wry **0.55.1** and
   `webview2-com` **0.38.2**. The app currently builds application
   WebViews in `src-tauri/src/lib.rs`, while
   `src-tauri/src/modules/net/tf_browser.rs` explicitly does **not**
   instantiate remote Wry/WebView2 content.
2. Tauri 2.11.2's
   `tauri/src/webview/mod.rs::WebviewBuilder::on_web_resource_request`
   documents: **“Currently only implemented for the `tauri` URI
   protocol”** and says external URLs (including development servers)
   do not invoke the callback. This API cannot guard arbitrary websites,
   subframes or `fetch` calls. `on_navigation`, `on_new_window` and
   `on_download` are separate callbacks for their specific events, not
   an all-resource network firewall.
3. Wry 0.55.1
   `wry/src/webview2/mod.rs::attach_custom_protocol_handler`
   registers `AddWebResourceRequestedFilterWithRequestSourceKinds`
   (or the legacy filter) **only for custom-protocol workaround URL
   prefixes**. Its handler dispatches to registered custom protocols,
   not all HTTP/HTTPS traffic. In-process COM extension through
   `Webview::with_webview` is possible, but is **not integrated into
   the current TF3 transport/authority** and does not by itself solve
   protocols unobserved by the request event.
4. Microsoft's WebView2 documentation describes `WebResourceRequested`
   as a per-filter WebView2 HTTP-resource hook, and explains that if a
   handler does **not** set a response, the browser proceeds with its
   normal network request. Filters require careful source-kind handling
   for frames/service workers. A native *deny or TF3-delivered replacement
   response* is required for each request — observing/rewriting a header
   or merely checking a hostname is not enough.
5. A Microsoft WebView2Feedback issue documents that WebSocket connections
   did not fire `WebResourceRequested` and that ordinary CDP Fetch /
   request-paused handlers did not cover them in the reported scenario.
   This is not a verified test of every latest WebView2 runtime; it is
   decisive evidence that **WebSocket interception cannot be assumed**.
   There is also no installed, tested WebRTC/WebTransport/UDP egress
   confinement or scheme-denial policy in Clack.
   A second **open, Microsoft-tracked October 17, 2026 issue (#5765)**
   documents **nested cross-origin iframe subresources** proceeding without
   `WebResourceRequested` even after registering the **new**
   `ICoreWebView2_22::AddWebResourceRequestedFilterWithRequestSourceKinds`
   using `*`, all contexts and all request-source kinds **before the first
   navigation**. The missing scripts appeared in the network HAR. The
   reported stable WebView2 runtime was 155.0.4283.60. This is a reported
   reproducible failure, not independent Clack native acceptance; it
   invalidates an assumption that simply adding a native COM hook solves
   every browser subresource escape.
6. TF3's `tf_web` is a native bounded public HTTP(S) GET/HEAD/search
   implementation with strict URL/DNS/IP/redirect checks; it is **not**
   a transparent bidirectional WebView2 proxy for browser cookies, live
   WebSockets, streams, form POSTs, subresource types or arbitrary
   background networking. The TF4 text-only fallback intentionally
   uses only the already-enforced TF3 path.

### Reference sources inspected

- Tauri/Wry installed source in local Cargo registry at versions above.
- [Tauri/Wry HTTP-interception capability discussion](https://github.com/tauri-apps/wry/issues/1087)
- [WebView2: custom management of network requests](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/webresourcerequested)
- [WebView2: frame request source-kind filters](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/frames)
- [WebView2: WebSocket request event gap report](https://github.com/MicrosoftEdge/WebView2Feedback/issues/4303)
- [WebView2: nested cross-origin iframe requests bypass even all-context/all-source-kind filters (open, tracked, October 2026)](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5765)
- [WebView2 Local Network Access behavior/rollout caveats](https://github.com/MicrosoftEdge/WebView2Announcements/issues/126)
- [WebView2 browser process model and data-directory sharing](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-model)
- [Windows Filtering Platform ALE layers](https://learn.microsoft.com/en-us/windows/win32/fwp/ale-layers)

## Request-class security matrix

| Browser-originated traffic | Available hook or concept | TF3-grade proof in Clack |
| --- | --- | --- |
| Top-level navigation/history | Tauri navigation callback; native TF3 GET in inert fallback | **Only inert fallback verified** |
| HTTP(S) frames, scripts, images, CSS, `fetch`/XHR | Windows COM `WebResourceRequested` with broad filters could be added | **Not wired, tested or default-denied** |
| Redirect chains, DNS rebinding, private/metadata addresses | TF3 native per-hop validation/pinning | **Not enforced for arbitrary WebView2 sockets** |
| Service/shared workers and their requests | WebView2 source-kind-specific filters | **Not wired or tested** |
| WebSocket / WebTransport / WebRTC and direct socket classes | WebSocket interception gap; requires independent egress enforcement or proven disablement | **Unproven / unavailable** |
| POST/form submit, login and credentials | Browser resource callback plus effect policy/approval and secret handling | **Unimplemented** |
| Popups/tabs, downloads, file inputs | Tauri callback APIs; TF2 filesystem policy | **No safe interactive path or acceptance** |
| Cookies, storage partitions and renderer crashes | WebView data directories/engine lifecycle | **Not implemented or accepted** |

“Available hook” means an API exists, **not** a security claim or
positive malicious-page test.

## Required architecture before unblocking

1. Create an **isolated, dedicated Clack-controlled renderer/network boundary**
   with **default-deny egress** for all browser-owned processes and request
   classes, independent of DOM content. This may be a proven OS-level
   confinement plus policy-enforcing broker, or another independently
   demonstrated no-direct-egress architecture. The existing unisolated Wry
   browser process is not that boundary. For Windows, WFP's outbound ALE
   connect authorization layers are a potential *investigation path*, not
   an installed policy, an accepted design or a permission to manipulate
   host-wide firewall rules. WebView2 browser/network-service processes
   can be shared by views with the same user-data folder; merely filtering
   a single PID or executable name would not demonstrate per-task scope.
2. Route every supported remote request **exclusively through a TF3-backed
   broker**, including redirect rechecks, exact destination/IP pinning,
   byte/time budgets and response replacement. **Never** let unrecognized
   schemes, blocked targets, unsupported request kinds or failed callbacks
   fall through to WebView2's network stack. Disable unsupported protocols
   with an enforceable non-bypassable boundary, not page-script shims.
   A WebView2 request callback does not report the actual connected socket
   peer IP; performing only preflight URL/DNS checks and then allowing
   WebView2 itself to connect would not reproduce TF3 DNS-to-peer pinning.
3. Confirm iframe/service-worker/shared-worker coverage and enforce
   WebSocket/WebTransport/WebRTC policy or hard-disable those classes with
   native/OS enforcement. An injected CSP may be defense-in-depth but is
   **not** proof of exhaustive egress confinement.
4. Prove process-specific ephemeral storage and no cross-agent/workspace
   cookie/cache/service-worker leakage. Define crash/teardown behavior and
   prevent a window or popup from outliving the controlling policy session.
5. Only then implement bounded live DOM/accessibility snapshots, stale
   per-generation refs, fixed privileged inspection/act/verify contracts,
   classified form effects, secret reference injection and TF2 file I/O.
   Continue reusing TF1 authorization and the existing TF receipt/trace
   authority — no parallel database, approval store or model-facing eval.

## Mandatory native security acceptance

Run one **real** Windows WebView2 instance against a controlled malicious
interactive fixture, capture independent server-side/network-side counters,
and verify **zero outgoing unsafe connections**, not merely redacted model
output or an intercepted JavaScript API. Include localhost, link-local,
RFC1918, metadata, alternate IP notation, DNS rebinding, redirect, iframe,
image, script, stylesheet, XHR/fetch, service/shared worker, WebSocket,
WebRTC/other available transports, blob/data/navigation, popup and download
probes. Test both allowed and denied traffic plus expiry, cancellation,
crash and uncertain external POST **without replay**. Validate credentials
and file confinement with controlled test accounts/files only.

The above **has not been executed or passed**, because there is no
policy-enforced interactive engine to test. The existing inert-headless
acceptance is valuable but is **not** a substitute. Do not mark PR #46
Ready for review or TF4 complete until the full native acceptance passes.
Do **not** begin TF Slice 5 or merge PR #46 while this gate is blocked.

## Scope of this continuation

Investigation and blocker documentation only. No new executable browser
subsystem, exposed model action, external website navigation or credential
transfer. Both existing Git stashes and the unrelated
`scripts/__pycache__/` are intentionally left untouched.
