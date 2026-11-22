# TF4 Windows browser-host network isolation — physical acceptance (NOT PASSED)

Date: 2026-11-22
Branch: `tf/browser-computer-use` · PR #46 **Draft; do not merge**
This is an **acceptance-only prototype**. Nothing in it enables model-owned
remote browser execution or changes the existing inert TF3-backed browser.

## Decision

**NETWORK ISOLATION GATE: NOT PASSED.**

The ordinary-token positive control created a genuine rendered Tauri/Wry/
WebView2 page and sent independently observed fixture traffic. The
zero-capability AppContainer host was confirmed by its **actual OS token**
and job membership, but the helper exited before it created a WebView2
browser/renderer process. Zero listener connections in this situation
**are not evidence of isolated WebView2 egress denial.**

Do not promote PR #46 to Ready for review, merge it, launch untrusted remote
WebViews or start TF5.

## Prototype boundaries

- New native executable `clack-browser-host.exe`, built **only** with
  `--features tf-browser-isolation-acceptance`. The normal Clack binary
  does not register or launch this host and no new model tool is exposed.
- Fresh, independently named temporary WebView2 user-data directory
  (UDF) per attempt; never the main Clack profile. Unique UDF
  existence was observed in the ordinary-token browser process report;
  exclusive UDF-access COM settings are not yet enforced or claimed.
- Narrow acceptance IPC: fixed CLI arguments, a bounded content-free JSON
  status file in the case root and machine-readable output. The host does
  not own Tool Fabric policy, credentials, file permissions or receipts.
  This is **not yet** a connected production browser broker.
- The immutable native HTML/JavaScript fixture runs in an actual WebView2
  controller, uses exact native document-title events as an independent
  renderer execution signal, and attempts *only owned loopback* destinations.
  Supported fixture probes include document-related images, CSS/styles,
  scripts, iframe, fetch/XHR, EventSource, WebSocket, workers and WebRTC
  local STUN. It does not contact public or unowned private hosts.
- The separate acceptance runner creates an AppContainer profile with
  **zero granted network or other capabilities**, checks the actual helper
  token (AppContainer flag, SID, capability count) and job membership, and
  refuses a security PASS unless it can also inspect genuine browser and
  renderer child tokens. Browser lifetime is tied to a kill-on-close job.
  It uses independent destination-side TCP and UDP listeners, not merely
  JavaScript exception results.

## Controlled physical observations

### Positive control — same host binary, not AppContainer

- Real WebView2 host and browser renderer observed; six WebView2 descendants
  in the standalone host acceptance.
- Renderer JavaScript executed, established with exact native
  document-title marker (`rendererDomProof: true`). Tauri's separate
  `about:blank` page-load callback did not fire and is not falsely
  advertised as a positive event.
- The independent integrated acceptance listener accepted **14 TCP
  connections**, including **13 HTTP requests** and **one WebSocket
  upgrade**, and received **three UDP/STUN datagrams**.
- Positive HTTP paths included iframe, stylesheet/CSS import, script,
  image, fetch, XHR, worker, EventSource, localhost and alternate
  loopback IP spelling. This validates that the listeners detect real
  browser traffic when unconfined.

### AppContainer negative case — not an accepted browser run

- OS verification: helper token `TokenIsAppContainer = true`, SID
  matches the case-created profile, `TokenCapabilities` count **0**,
  and `IsProcessInJob = true`.
- Actual outcome: helper terminated with Windows-observed exit status
  **0x00000065 (decimal 101)** before generating a valid host report or
  spawning a WebView2 browser/renderer child. A bounded follow-up reproduced
  this outcome. The specific early-startup failure remains **unverified**;
  status 101 suggests a Rust panic but is not a proven root cause.
- Independent destination listener received **0 TCP**, **0 HTTP**,
  **0 WebSocket** and **0 UDP/STUN** attempts, but these counts cannot
  prove enforcement without a running renderer that actually attempted
  those mechanisms.
- Owned job accounting reached **0 active processes**. The fresh
  AppContainer profile was successfully deleted and the unique case/UDF
  directory was removed. An uncertain process or failed cleanup must
  fail this acceptance, never be silently reused.

No actual child-process token inheritance by a WebView2 renderer was
demonstrated under the restricted token. The original TF4 architectural
blocker therefore remains open.

## WFP fallback gate

The current Windows development session is **not elevated**. A narrowly
scoped WFP/ALE deny policy would require a separately reviewed
privileged authority, an **exclusive browser execution identity** and
physical proof that every WebView2 browser/network-service process is
covered. A rule targeting `msedgewebview2.exe` by filename would block
unrelated browser instances and is expressly prohibited.

No WFP rule, host-wide firewall change, persistent browser identity,
kernel callout, network adapter mutation or elevation attempt was made.
Do **not** report a WFP isolation success or treat one as installed.

## Required conditions to convert this to PASS

1. Actually start an AppContainer-confined **WebView2 browser and renderer**
   with verified same case identity and no network-enabling capabilities,
   or physically prove equivalent narrowly scoped default-deny WFP coverage
   for every relevant browser and network-service process.
2. Show the **same fixed malicious page** truly renders and attempts its
   background requests in that isolated environment, with an
   independent native DOM/execution signal.
3. Calibrate independent listener acceptance using a real unconfined
   positive control, then obtain **zero unsafe direct TCP/UDP/IPv4/IPv6
   connections** from the running isolated page across supported probe
   classes, including omitted/unintercepted requests.
4. Record genuine child PID/SID/privileges/job, UDF ownership and
   closed process-group accounting for normal close, crash and cancellation.
   On uncertain cleanup, set terminal status `UNKNOWN`.
5. Only **after** this gate, expand the existing TF3 network authority into
   a bounded binary HTTP(S) GET response broker and synthesize WebView2
   responses. There is currently no remote GET/CSS/image broker in this
   feature. Unsupported protocols must remain OS-denied without fallback.

## Preserved compatibility and acceptance scope

The existing inert browser path and exact Tool Fabric approvals remain the
only production browser API. Full DOM/click/type/forms/screenshots/credentials/
downloads/uploads, persistent cookies, unrestricted popup handling and
desktop Computer Use are **not implemented** in this isolation prototype.
All existing TF1–TF4 regression requirements remain separate from and
cannot substitute for a physical egress-isolation PASS.

The native acceptance source is frozen with a failed gate. No additional
browser-startup attempts or speculative privilege changes are authorized
by this record. A future continuation must establish the actual startup
failure and then obtain the missing live restricted-renderer evidence.
