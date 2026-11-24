# TF4 production browser integration — Windows physical evidence, 2026-11-23

This is a chronological integration record, **not a production-interactive
browser acceptance certificate**. All work is confined to /clack on
tf/browser-computer-use and the existing Draft PR #46. Starting pushed HEAD
was bf5038619ce1e3313baef8d217064ab25aa88b94; historical original task
baseline was 07b007c83ba12fdd001094b99d9918192d085fa9. Additional
uncommitted production changes already existed at continuation startup;
they were preserved rather than reset.

## 2026-11-24: native TF2-governed file downloads and uploads — connected source and isolated integration, NOT installed physical acceptance

**Chronology and separate outcome:** After pushing the approved-form,
screenshot, origin-credential and second-COM local causality batch as
`7b553b40ecaa6a9bab4e6583245f57e489498052`, this follow-on
batch adds actual source-connected one-use TF4/TF3/TF2 browser file movement.
It does **not** retroactively add these operations to the optimized
`ce6eea8` installer or any existing installed Clack, turn Draft PR #46
Ready, enable model-native tools, or prove positive externally installed
actions. These changes run only in the original isolated native browser
session and central human-approved application path.

**Download vertical:** A bounded internal `TfBrowserOperation::Download`
requires the current original WebView2 page/session/generation/snapshot,
exact same-origin no-query/no-fragment public HTTPS URL and genuine one-use
TF4 application consent naming the resource and derived workspace file.
After the existing TF4 atomic consent consumption, the **existing TF3**
Public-policy one-use token/budget/DNS/IP/TLS/no-redirect client fetches
only up to 64KiB of `application/octet-stream` from that exact destination.
`BrowserBoundDownload` cannot be deserialized or prepared as an arbitrary
public/model TfWebRequest. The original consumed TF4 witness is retained by
the parent so only the **existing TF2** workspace authority can choose its
non-model filename (`tf4-browser-download-<approval-id-digest>.bin`),
canonicalize root, deny traversal/symlinks/reparse changes, lock/lease
write parents, perform a same-directory atomic no-clobber write, and
independently reopen/read/hash the final file. A `200` transport alone
cannot confirm the file effect: the sanitized receipt `Observed` applies
**only** to independently committed TF2 local bytes. A failed/uncertain file
commit or possible remote GET effect is never auto-retried.

**Upload vertical:** A native-only `TfBrowserOperation::Upload` binds
an exact original TF2 workspace-relative regular file (1..65536 bytes)
**before** the genuine human dialog: the existing TF2 root/target/reparse,
no-write/delete-sharing handle and parent lease capture exact file identity,
size and SHA-256. Human approval names the original source, digest,
original native page, one method `POST` and one same-origin public HTTPS
destination. Immediately **after** consuming TF4 consent but **before**
any network attempt the parent uses the same TF2 authority to reopen the
same file and refuses changed path, bytes, size, hash or denial. The
re-read immutable bytes become the one `BrowserBoundUpload` private TF3
one-use token (max 64KiB request, 4096-byte response, 5s/zero redirect),
`application/octet-stream` body and exact destination SHA, no browser
renderer file picker/secret/read access, generic arbitrary POST or
new permission owner. Even a `201` response stays independent **remote
business-effect Unknown**, `NEVER_REPLAY`, until the operator-owned
public HTTPS server oracle proves exact nonce/method/destination/digest,
accepted one write and replay denial. Cancellation before TF3 dispatch
burns its single token; after possible dispatch no retry-to-PASS.

**Security/result classifications:** TF3 private executor now has distinct
`PublicRead`, `FormPost`, `OriginCredentialGet`, `BoundDownload`,
`BoundUpload` kinds, atomically verifies exact prepared internal variant
after one-use token consumption, and publishes actual native wire method
and conservative effects. Both transfer operations are
`#[serde(skip_deserializing)]` for public TF3 requests. The
**test-only** loopback HTTP fixture verifies exact binary GET bytes,
content SHA, redirect not followed, no replay, and exact binary POST
body/content-type/201/Unknown/no replay with no raw body in receipts.
TF2 source tests verify traversal and alternate path denial,
original file mutation detection, wrong destination/digest rejection,
real workspace atomic no-clobber binary file effect and independent
disk readback; all are SOURCE/ISOLATED integration, not production
installed native evidence. A real installed one-use native app
download/upload with external owned Public HTTPS443 acceptance fixture,
server-side exactly-once upload receipt, all required cancellation and
symlink/race negative cases is still missing.

**Mandatory remains:** The thirteen canonical production gates remain
**0 PASS / 5 PARTIAL / 8 BLOCKED**. User install request
`ur_c636qc4lsf8l`, originally created for earlier `ce6eea8` package,
cannot certify the later `7b553b4` or this new transfer source.
The owned public HTTPS fixture is committed with six isolated Node tests
and a separate operator hosting request; it was not deployed.
The original host WebResourceRequested callback still does not provide an
authenticated action-to-network causal ID, so link success remains Unknown
without platform-verifiable action attribution. Nine of eleven grouped
physical host lifecycle cases remain historically selected-pass and two
are missing; complete integrated seventeen-step installed E2E, per-operation
independent physical checks, model CapabilityIndex acceptance and final
Product-wide UI/UX Polish & Acceptance are NOT complete.

## 2026-11-24: connected FORM, screenshots, native credential and second-COM local causality — source checkpoint, NOT installed acceptance

**New versus previous ce6eea8 implementation:** These changes are a genuine
functional continuation of the existing TF4/TF3/TF2 authorities. The previous
optimized NSIS at ce6eea8 (staged host SHA-256
942dc89c3ac8cf5e01240e1e196f40eff0de57d8da8ed1be6b799f41afa94a87;
release app 8a367807ad8d6d5223bfb3184797a9f84b43f32c0176130c8ea83d4900c8c1fd;
setup f10e6a8027206361e560150789f348146ef9a736201d1dba40443547f02954f5)
**predates this source**, is not an install/physical proof for it, and must
not be used for positive acceptance. The human install request
ur_c636qc4lsf8l was still OPEN when checked. New CI of ce6eea8
(45487246358) COMPLETED FAILED: Ubuntu WASI PASS, six failed job
categories and coverage skipped, not CI green.

**Connected original FORM vertical:** A new fixed native host
DOM_EXACT_FORM_CAPTURE_JS accepts only the **original retained** FORM
and submitter from the existing NativeDomIdentity, never selector fallback or
page-supplied JS. It validates POST + urlencoded encoding, same original
public HTTPS/default-443 source and destination, a single unnamed submitter,
no alternate action/target/encoding and at most eight non-disabled ordinary
hidden successful controls with bounded names/values. It deterministically
serializes control bytes using URLSearchParams, rejecting text/password,
checkbox, select, file, external form owners, changed/unsupported semantics.
The sealed parent control turn captures method/destination/encoding/original
visit indexes, body bytes and SHA-256 **before the genuine OS application
consent dialog**, and the exact private facts are retained by the already
existing TF4 Pending authority. The human approves method/destination,
original nodes, body byte count and SHA. After central token consumption,
the native parent captures the **same original FORM and submitter again**
over the sealed turn, comparing all identities, destination and byte-for-byte
body to the pre-consent intent, not just a self-consistent digest. Only then
does it move the typed consumed native TF4 approval into the private TF3
one-use body-bound POST executor; existing TF3 DNS/IP/TLS, quota, cancellation,
expiry, zero-redirect and NeverReplay semantics remain the one network
authority. There is no public/model POST operation or renderer send.
DOM_EXACT_SUBMIT_JS remains deny-only. The transport-only sanitized POST
receipt remains Unknown, never independent owned-server business effect
proof. Public installed HTTPS positive form/replay and complete general
successful-controls coverage are still **BLOCKED**.

**Stable control local postconditions and link causality:** Original exact
type/clear/select/check/uncheck/scroll still require genuine TF4 consent,
original retained node/option, sealed action parameter SHA and single-use
dispatch. The fixed native host now issues a **second separate authenticated
WebView2 COM Runtime.callFunctionOn callback**, following its initial bounded
mutation ACK, to check the same retained Node's value, selected original
option, checked state or scroll-direction result without exporting the value,
DOM HTML, selector, page text or secret. Missing/false/late COM callback,
stale page or changed original node stay UNKNOWN, never retry. This is
local DOM causality, NOT evidence that a server business side effect happened.
Original retained link navigation still intentionally requires an
authenticated action-to-request causal edge absent from WebResourceRequested;
the broker's production causal ID remains None to avoid false-positive
same-URL navigation attribution.

**Actual native screenshot/evidence path:** The existing exclusive sealed
parent/host v2 turn now invokes WebView2 Page.captureScreenshot for a bounded
viewport PNG only after original page/observation matching and an explicit
one-use genuine TF4 application consent naming its selected TF2 workspace
evidence destination. Host and parent independently check original session,
page ID, snapshot, page generation, source URL, bounded capture time, 1024x768
dimensions, at most 64 KiB, PNG IHDR/chunks/CRC and full SHA-256. Host denies
screenshots after omitted/truncated sensitive structural observation.
Screenshot bytes cross only the authenticated host->parent pipe and are never
returned via model, semantic snapshot or Tauri receipt. The **existing TF2
filesystem authority** performs canonical workspace/path/reparse validation,
write parent leases, same-directory atomic no-clobber commit and independent
final file hash/readback; only sanitized metadata is returned. A real TF2
atomic workspace file effect and replay denial passed a source integration
test. Pixel privacy and actual installed WebView2-to-TF2 screenshot provenance
remain **unaccepted**; this does not prove screenshots never contain sensitive
visible content.

**Origin-scoped credential delivery:** A private native-only CredentialGet
operation requires the same genuine TF4 one-use app dialog and an exact
original native observed page/snapshot/generation, a same-origin public
HTTPS/no-query/default-port destination and opaque 48-hex reference. It uses
the existing OS credential owner (fixed Clack TF4 service; account derived
from the original approved origin hash and opaque ref), reading a strictly
closed JSON token/expiration envelope **immediately before dispatch**,
denying revoked/expired, malformed, unsafe, stale or foreign credentials.
No page DOM/model/renderer receives raw token or a generic secret-store
handle. The existing TF3 Public policy sends one parent-held Bearer
Authorization header only to the exact approved origin and resource; no
redirects, implicit cookie transfer, response body disclosure or retry.
The resulting parent receipt contains origin, destination/ref SHA,
HTTP status and delivery boolean, never the raw secret. An isolated
test-only loopback HTTP server independently observed the exact synthetic
Authorization header, method and one-use replay, with no cookie or leaked
receipt data; wrong origin was denied before DNS/socket. The loopback test
exception permits ephemeral HTTP test ports ONLY under the compile/test
FixtureLoopback policy; production Public still denies cleartext/private
targets and explicit ports. No deployed owned public HTTPS credentials or
installed external effect has been accepted.

**Current verification classification:** Source/isolated suites on this
working tree: TF3 network test collection including isolated exact POST,
credential header/one-use and negative scope tests; TF4 native owner tests
including genuine-form intent binding, screenshot TF2 no-clobber commit and
origin-ref/expiry; runtime sealed-form/screenshot contract and native host
fixed-program tests, the latter with 62/62 active tests PASS. Eleven opt-in
physical native tests remain ignored in normal Cargo runs. The fixture's
six independent Node tests remain isolated localhost HTTP and cannot prove
real installed browser action. The finished NSIS build is for earlier ce6eea8.
This code does NOT yet implement TF2-governed browser download/upload or
complete all eleven grouped lifecycle races; no model-native browser tool
is enabled. Public TLS443 independently owned fixture, real installed
consent, server-side positive effect/replay, complete seventeen-step E2E
and final Product-wide UI/UX Polish & Acceptance are all unverified.
The existing thirteen governing exit gates remain exactly
**0 PASS / 5 PARTIAL / 8 BLOCKED**; no changed source-test count promotes
a gate to installed production PASS.

**One consolidated operator-owned hosting prerequisite:** The existing
scripts/tf4-public-https-fixture/README.md now specifies two separate
operator-owned public FQDNs, CA-trusted TLS443, private persistent one-use
ledger, nonprivileged service identity, separately protected read-only
oracle, approximate capacity, operator-dependent possible costs, and explicit
deployment and teardown controls. No public DNS/tunnel/private service
exposure or hosting cost was authorized or performed.

## 2026-11-24: accelerated source-functional continuation — NOT installed production acceptance

**Implementation, distinct from acceptance:** On `tf/browser-computer-use`,
the native TF3 `tf_web` authority now contains a **private one-use bound POST
transport**. This does not add POST to the publicly deserializable/model
`TfWebRequest`/`TfWebOperation` schema. The internal envelope fixes exact
normalized destination, public HTTPS origin, URL-encoded or bounded octet body,
SHA-256, page generation, retained FORM and submitter indexes, and the existing
consumed TF4 native approval identity. The production entrypoint requires
**ownership of the moved, typed centrally consumed native FORM+submitter
witness**; a model-provided 48-hex string alone cannot invoke it. The existing
TF3 token/pending/quota/DNS/IP/TLS/expiry/cancel machinery performs the only
network attempt, with a bounded request, redirect denial, no credentials,
no response-body disclosure, and no automatic replay. An HTTP 201 receipt is
**transport evidence only**: the effect is `Unknown`, retry
`NEVER_REPLAY`. Raw payload bytes and any credentials are not serialized
in canonical receipts.

**Important missing handoff:** The production host's
`DOM_EXACT_SUBMIT_JS` remains **validation-only, deny actual submit**. The
native parent has not yet captured/revalidated successful form controls and
exact body **before consent** or transferred a verified original-node body to
this private TF3 transport. The browser's WebResourceRequested path remains
GET-only, and no page-generated POST is admitted merely because the origin
matches. No installed form submit or independent real business effect is
accepted. A form grant must be bound to the *original* nodes/data at prepare,
revalidated before dispatch and correlated to the owned-server oracle; this
cannot be substituted by `form.submit()`, `requestSubmit()`, an arbitrary
page fetch or a generic POST tool.

**Action causal-correlation correction:** The broker request floor is captured
**before** COM dispatch, not after the host acknowledgement, to avoid losing
requests initiated during a real native action. More importantly, a newer
broker request matching an approved URL and generation is *not* sufficient
to confirm the click: the central native owner now additionally requires a
verified `causal_native_action_id` matching the consumed approval identity.
The current production WebView2 resource callback has no independent
authenticated dispatch-to-request causal edge and explicitly returns
`None`; thus a matching ordinary page GET stays **UNKNOWN**, never a
fabricated confirmed action. A source-only synthetic positive test checks the
strict predicate; missing/wrong causal edges are negative tests, not
production proof. This is a **fail-closed repair**, not completed native
positive causal attribution.

**Stable retained controls:** The fixed host CDP function now checks a
post-dispatch *boolean* against the same retained original node: typed/cleared
input value, selected original option, checked state or scroll direction.
No value, option text, selector, DOM HTML or page credential crosses the
closed response. If a dispatch may have happened but readback cannot prove
the local state, the host reports uncertainty rather than a stale/safe-retry
success. These inline DOM checks do **not** replace independent installed
native postcondition observation for gate 2.

**Owned HTTPS acceptance fixture — source only:** New source is at
`scripts/tf4-public-https-fixture/` with `server.mjs` (explicit
operator-configured TLS443 only), `server.test.mjs`, `verify.mjs`
(read-only independent server-oracle summary) and `README.md`. It defines
nonce-scoped static navigation, original FORM/submitter/replaced node, bounded
download/upload and delayed/cancelled request cases, synthetic credential
accept/deny, same-/cross-origin redirect negatives, durable one-use
form/upload claims with SHA-256/method/timestamp receipts, and read-only
bearer-protected server oracle. The claim files are fsynced and POSIX claim
directory metadata fsynced. The read-only verifier deliberately returns
`nativeApprovalOrOriginalNodeCausalityProven:false`. Six Node isolated
ephemeral **loopback HTTP tests PASS 6/6**, including concurrent one-write/
replay, restart persistence, client-abort remote observation, malformed
cross-origin configuration. No public DNS, ordinary CA-trusted TLS443,
deployed service, installed Clack, human OS consent or independent browser
effect has been exercised. No deployment is authorized by these source
changes. The older owned 127.0.0.1 TLS acceptance harness is not promoted
to Public-policy proof.

**Scoped verification in this continuation:** Native TF3 scoped Rust tests
**25/25 PASS**, including the new single isolated raw HTTP POST with exact
method/destination/body/digest, consumed replay denial and
`Unknown`/`NEVER_REPLAY` despite HTTP 201. The native host's closed-contract
suite **60/60 PASS** after boolean postconditions; the targeted native link
correlation test **1/1 PASS**. The native FORM-witness matching test and
broader regression are evaluated separately in the working tree, not
misreported as an installed physical result. All tests here are local source
or isolated integration, never independent installed production proof.

**CI classification:** `45473556032` on `f66ac1c` is **COMPLETED**:
Ubuntu WASI PASS; Rust/Clippy FAILED (100 lib and 50 test lint errors under
`-D warnings` across broader legacy source); Windows/macOS Nextest,
Windows/macOS WASI, and frontend FAILED; coverage SKIPPED. The latest
Nextest/WASI classes include preexisting workspace confinement/staging
`WorkspaceChanged` on Windows and the macOS real-file bound/traversal
case; frontend has compaction schema/recovery failures. Protected-main run
`44994093010` and prior branch `45355106767` were also red. No blanket
lint suppression, test removal, fabricated fixture or CI-green claim.

**Operator/exit boundaries:** The still-open human installer request
`ur_kfrzln9j637l` references older source `e1735b6` and is
**OBSOLETE**; do not install it as current-source proof. A single new
source-matched host/app/NSIS build and genuine operator installation must
follow consolidated functional implementation. An operator-owned publicly
routable hostname with ordinary CA-trusted TLS on **443**, dedicated separate
read-only oracle credentials and separately owned negative origin requires
explicit authorization before deployment. Installed real-app consent,
original-node causal effect, one-use replay denial, all eleven grouped races,
TF2 file transfers, screenshots, credentials, seventeen-step integrated E2E,
and final mandatory Product-wide UI/UX Polish & Acceptance remain unverified.
The governing thirteen-gate names/predicates in the existing canonical
engineering tracker remain **0 PASS / 5 PARTIAL / 8 BLOCKED**. PR #46 remains
DRAFT; no merge, TF5/MCP or P15 native desktop scope change.

## Accepted foundation deliberately not rerun

The controlled real-Windows AppContainer/WebView2/Job/zero-capability/SID
and effective-UDF fixture, TF3 native broker, independently observed zero
owned-target TCPv4/TCPv6/UDPv4 restriction, original broker negatives 8/8,
and original Phase-A 9/9 (last case GaraiY) remain accepted. Those immutable
cases were not repeated for reassurance. This is not global-network or
production-interactive certification.

## New implementation and scoped results

### 2026-11-23: first exact retained-node live programmatic activation (separate opt-in test)

Following the earlier read-only held-node `ACCEPTED`/`STALE` and same-index
replacement proofs, the **production native host** now supports a narrowly
bounded internal `act-element` / `click` command over its existing authenticated
sealed parent/host v2 pipe. The frame binds session nonce, monotonically
consumed sequence, latest authenticated observation, page generation, TF3
source digest, original native visit index and serialized ordinal. An opaque
48-character approval identifier is required in the frame, but its issuer is
**not yet wired to central Tool Fabric application approval**. In particular,
host validation of that field's syntax does not constitute consent.

The fixed host-authored `Runtime.callFunctionOn` function uses the retained
exact DOM Node in one renderer invocation: it rejects detached/changed,
disabled/invisible/non-link/non-button nodes, latches the observation consumed,
and calls `node.click()` at most once. This is **programmatic DOM activation**,
not a trusted hardware pointer gesture. There is no caller-provided script,
CSS-selector fallback, replacement-by-index, unbounded field data, or action
retry. Native dispatch replies are closed `DISPATCHED`, `STALE`,
`DENIED_TARGET`, `UNKNOWN`; a COM callback/IPC ACK alone cannot claim an
external effect `CONFIRMED`. New Rust effect receipt types preserve
`NotAttempted` versus `Unknown` versus independently `Observed`, and prohibit
automatic replay after ambiguous or dispatched effects.

**Separate opt-in physical probe, PASS 1/1:**

- Owned fixture run `684cc1d917fd4720b6016ef8e75c58dd` used new
  `-MinimalClickDocument`, serving precisely two static HTTPS pages with no
  page-authored scripts and a fixed `<a href="/clicked">` link.
- The actual isolated Windows AppContainer/WebView2 COM host activated the
  exact retained link Node through the fixed native function. Its closed
  dispatch receipt remained `Unknown` effect / `NEVER_REPLAY`.
- Independently the actual TF3 broker observed a second completed controlled
  HTTPS `GET https://127.0.0.1/clicked` with 200 response after the original
  document GET, proving a resulting navigation in this *specific fixture*.
- Old opaque action reference was consumed. Browser owned Job reached 0
  active processes; host exited; UDF and private profile were removed. The
  owned TLS listener was explicitly stopped; certificate, active run marker
  and port-443 listener absence verified.
- Two focused native-host action tests (2/2), the native parent reply test
  (1/1), feature-enabled native host `cargo check` and debug native host
  `cargo build` passed. The new opt-in physical test passed (1/1).

**Not accepted:** this action was initiated only by a narrowly guarded
`#[cfg(test)]` parent sender requiring `CLACK_TF4_OWNED_NATIVE_CLICK=1`
and the exact owned loopback origin. It was **not** authorized by the installed
application's central Tool Fabric approval dialog, was not model-facing, and
does not prove trusted mouse input, text/type/select/scroll/submit, credential
handling, screenshots, TF2 file transfer, popup/storage, public Internet HTTPS,
the 11 independent races or the 17-step production E2E. The existing
`tf_browser.rs` native non-Close operation gate stays intentionally CLOSED.
The application background browser owner still lacks a centrally authorized
command channel and a complete action/effect receipt integration. **Draft PR
#46 must remain Draft.**

- The non-default tf-browser-native-runtime builds the same native host in a
  separate production mode. The internal TF4 native one-use approval and
  existing TF3 public DNS/IP/SSRF/redirect network authority are reused.
  Ordinary model-visible browser tools remain inert_native_text. Neither
  the acceptance fixture nor interactive WebView2 becomes a model tool.
- Native production startup owns Windows AppContainer zero generic network
  capability SID, Job, original retained host/browser/renderer process handles,
  effective UDF and sealed parent-child pipes. Parent independently attests
  original native process identity, SID/capabilities/Job and actual COM UDF
  before the child can navigate. No broad private/loopback fixture policy
  is promoted into production.
- Production HTTPS resource requests carry exact session/request ID/page
  generation; the parent sends bounded synthetic responses using TF3.
  Parent receipts are terminal only after receiving and authenticating a
  separate native UI-apartment SetResponse + Deferral.Complete acknowledgment.
  A missing or incorrect COM completion is UNKNOWN/failed, never success and
  never automatically replayed. The outer broker budget is 15 seconds.
- An internal authenticated observation command and response over the existing
  sealed pipe are generation/source-hash/nonce/observation-ID bound, with
  bounded closed structural roles, index, depth, heading level and truncation.
  The native fixed script never returns page text, arbitrary accessible names,
  URLs, cookies, field values, secrets, HTML or unrestricted DOM attributes.
  This is **not yet** the full accessible semantic snapshot or exact DOM-bound
  action bridge. No arbitrary model JavaScript tool was introduced.
- An opt-in Tauri resource-overlay and a Windows bundle build script stage the
  exact optimized host and embed its measured SHA-256 in the app compile. The
  regular app build remains inert without a pinned native host. The new script
  and JSON syntax passed, but the full bundle was not executed, installed or
  deployed and does not establish final signing/TOCTOU assurance.

### New separate real-production physical checks

1. Production zero-cap AppContainer WebView2 COM effective UDF readiness,
   retained original browser/renderer process/job roles, close/profile cleanup:
   PASS.
2. Production actual HTTPS resource interception of controlled
   https://127.0.0.1/, public TF3 private-destination denial, exact COM
   completion acknowledgment, cleanup: PASS. Independently owned TCPv4
   positive listener connection count 1; restricted browser connection count
   0. No direct fallback observed at that owned listener. This is not
   global or UDPv6 isolation proof.
3. Separate native bounded structural observation after controlled TF3
   HTTPS denial: PASS for the protocol's fail-closed DENIED result only;
   visited=0, elements=0. It is not proof of successful DOM extraction.
4. A separate production owned-RFC1918 interface test physically bound its
   listener to the Windows Ethernet interface's own 192.168.x.x address at
   port 443, after verifying the exact address was assigned to the machine.
   Positive control was one real parent TCPv4 connection; the restricted
   AppContainer browser made zero owned-listener connections. The actual
   HTTPS WebView2 request received a TF3 denial followed by valid native COM
   terminal acknowledgment; Job/UDF/profile teardown passed. **PASS for
   this one owned TCPv4 RFC1918 target**, not a network-wide or IPv6 UDP
   certification. The test does not contact arbitrary LAN hosts.

### Independent grouped Phase-A race extension

The new --grouped-only runner mode selects only the nine *new* grouped
cases, with fresh immutable case root, nonce, AppContainer profile/SID,
Job, UDF, positive/negative owned TCP+UDP listeners and verified teardown.
--grouped-only <exact-label> selects one; --list-grouped inventories without
launch. The original accepted 8+9 never run in this mode.

Immutable first grouped-only physical result: B7gLXE, FAILED, 5/9 verified,
5 own teardown checks passed. Four failing cases: navigation-stale,
snapshot-stale, element-stale, broker-process-kill. Actual owned AppContainer
host rejected these four unknown --broker-fault labels *before WebView2
startup* (unsupported acceptance broker fault). This is incomplete native
implementation, not a real renderer crash or passing fault proof. All
case roots and their failed evidence are preserved.

Path:
src-tauri/target/tf-browser-isolation-acceptance/clack-tf-browser-grouped-only-B7gLXE/grouped-only-verdict.json

Subsequent immutable **new grouped-only** chronology:

- MbY0IX: FAILED, **8/9 verified**. Native navigation-stale,
  snapshot-stale and element-stale now passed their real generation,
  original COM deferral and successor MutationObserver assertions.
  Independent broker-process-kill failed before native terminal due to
  single immediate Job ActiveProcesses read returning 1 after original
  helper process HANDLE signaled exit 91; a later cleanup proved Job empty.
  That later cleanup did not retroactively make the test pass.
- FWkNvg: FAILED, **0/1 selected** independent broker-process-kill.
  New kernel completion-port barrier proved the separately owned helper
  Job emitted actual ACTIVE_PROCESS_ZERO, retained helper HANDLE was killed
  with exact code 91, and native WebView2 completed one synthetic COM 502
  after actual pipe EOF. The runner still rejected the case because host's
  independent parent-request acknowledgment timeline event was not observed
  before the helper death; this failure remains immutable.
- 3fF8ZX: **PASS, 1/1 selected** broker-process-kill. A strict native
  trace acknowledgment barrier now requires the monitor to actually observe
  the parent's original-HANDLE browser/renderer proof before helper kill.
  The previously missing timeline event, exact OS helper exit, Job zero,
  native EOF/COM terminal, no replay/watchdog and cleanup were all verified.
- vrw28o: **PASS_SELECTED_GROUPED_ONLY, 9/9 implemented new variants**,
  each with physical original-HANDLE/AppContainer process/renderer,
  COM/pending lifecycle and owned listener isolation/teardown.
  The independent original 8+9 were **NOT_RERUN_NOT_REVERIFIED**.
  The required **11/11 distinct production/lifecycle variants remain
  NOT_PROVEN**; this is not release acceptance.

The helper Job quiescence now uses a real Windows IO completion port on the
exact owned Job, verifies ACTIVE_PROCESS_ZERO and rereads Job accounting.
There is no blind sleep/retry or weakened zero-process requirement. The
parent-to-host acknowledgment barrier is likewise a genuine event-order
constraint, not an arbitrary timeout increase.

Relevant immutable case verdicts are retained under:
src-tauri/target/tf-browser-isolation-acceptance/clack-tf-browser-grouped-only-<case>/grouped-only-verdict.json

### Compact functional UI

The existing ChatToolsControl browser section now shows the actual scoped
native browser status, session URL/origin/expiry, recent owning-Agent-chat
browser tool receipts, real pending chat tool approvals, explicit stop/close
controls, and collapsible diagnostics. It deliberately labels unavailable
interactive DOM/JS, screenshots, downloads and uploads as NOT ENABLED, does
not fabricate an internal native action history, and adds no model registry
capability. Its three new focused UI tests passed along with 22 existing
related tests (25/25), and TypeScript checking passed. Product-wide UI
polish remains a separate future gate.

### Relevant verification

- Production runtime focused unit tests: 4/4 PASS, plus the three separate
  opt-in production physical checks above (the third returned DENIED).
- Native host new production frame/security tests: 6/6 PASS.
- Grouped Phase-A offline runner tests: 7/7 PASS.
- Existing browser/TF3 TypeScript tests: 24/24 PASS.
- npm run check-types and npm run build: PASS (pre-existing Vite dynamic
  import and plugin timing warnings only).
- New feature-enabled Windows debug native host build: PASS.
- Scoped rustfmt and git diff --check: PASS (Git CRLF warning only).
- An earlier build received Win32 disk-full error 112. Only the checked,
  regenerable src-tauri/target/debug/incremental Cargo cache was cleared
  while no compiler was active; historical evidence, protected stashes and
  unrelated scripts/__pycache__ were untouched. Subsequent native build,
  host tests and physical tests passed.
- The five canonical TF1-TF3/browser focused Rust suites also passed 59/59
  (TF3 web 19, inert browser 14, contract 6, TF1 command 13, TF2 filesystem
  7); this does not substitute for interactive native E2E.

## Unaccepted production requirements

Real positive public/controlled HTTPS document and dependent content,
complete confidential accessible names/semantic snapshots, true stable
element actions, click/type/clear/select/check/scroll/focus, form submissions
and effect approval, origin-bound credentials, screenshots, TF2 downloads
and uploads, popups and tabs, isolated storage modes, full action/effect
receipts/activity, native 17-step interactive E2E, remaining independent
broker/renderer/page race cases, UDPv6/global/RFC1918/link-local and other
extended owned-target network isolation are NOT_PROVEN or incomplete.
Public TF3 currently authorizes only bounded same-origin GET for this
production bridge; unsupported write/effectful paths remain denied. General
desktop computer use is unimplemented. CI has not been certified green.

Scope-labeled status:

- DIRECT_BROWSER_NETWORK_ISOLATION = PASS, accepted controlled fixture;
  plus narrow production owned TCPv4 private-target denial. No global claim.
- TF3_BROWSER_BROKER = PASS, accepted controlled fixture; plus production
  private-HTTPS denial and exact COM receipt. Public HTTPS success unproven.
- INTERACTIVE_BROWSER_RUNTIME = FAIL (production incomplete).
- BROWSER_COMPUTER_USE = PARTIAL.
- GENERAL_DESKTOP_COMPUTER_USE = UNIMPLEMENTED.
- PR #46 Ready for Review = NO; leave Draft, never merge or start TF5.

Only after full TF4 acceptance and subsequent review/merge may the separate
TF5 engineering / canonical TF7 MCP client/server provider lifecycle begin.

## Final subsequent validation addendum (supersedes earlier counts)

After this record's initial checks, the last accepted-source focused native
host unit suite **32/32 PASS**, runner offline unit suite **13/13 PASS**,
and the same new grouped-only native physical suite **9/9 PASS** in `vrw28o`.
Four narrow opt-in production physical probes PASS: AppContainer/WebView2
readiness, private HTTPS TF3/COM terminal with owned TCPv4 loopback denial,
native DOM-control DENIED with no elements (not positive semantics), and
owned RFC1918 listener denial with one ordinary positive control and zero
restricted-browser TCPv4 connections. The 59 focused TF1–TF3/browser Rust
tests PASS. The combined browser/TF3/functional UI frontend suite **49/49**
PASS; after final UI path redaction its three tests PASS again, typecheck PASS,
and Vite build PASS. The default optimized native Windows release Rust build
(`cargo build --manifest-path src-tauri/Cargo.toml --locked --release`)
**PASS**. No opt-in native host bundled installer or deployment was made.

Remote PR #46 CI on older pushed bf503861 is not green: frontend/rust,
macOS and Windows Rust tests, and macOS/Windows WASI adversarial failed;
Ubuntu WASI adversarial passed. Samples found unrelated Biome lint errors
in `src/test/strongHostedNotesAgent.tsx` and Linux example
`lm11_b03_native_restart_acceptance.rs` missing `main`. These samples do not
prove every failure is baseline-related. No unrelated CI repair was attempted.
New remote CI on the updated PR remains necessary. All final production
interactive/E2E blockers and Draft/NO readiness boundary above still apply.

## Continuation 2 — positive HTTPS qualification attempt and scoped bridge changes

Starting source HEAD `0792c3ddbe46efa7c595b9a1f2bdbdb01949dd87`.
The first explicitly opted-in real production AppContainer/WebView2 HTTPS
document test used only the IANA documentation URL `https://example.com/`
and the digest-matched production host. It physically reached the native
WebResourceRequested/TF3/COM path, but the public HTTPS response did **not**
complete. The test intentionally **FAILED** and reported:

```text
PRODUCTION_POSITIVE_HTTPS_RESOURCE terminal=denied reason=network-failed
bytes=0 native_com=true tf3_terminal=denied tf3_reason=network-failed
tls=unknown dns_hops=1
```

The owned Job/profile/UDF cleanup assertion passed before this failed
document assertion. One parent-only diagnostic `curl.exe --noproxy '*'
--connect-timeout 4 --max-time 8 -I https://example.com/` failed with
`curl: (35) Recv failure: Connection was reset`. No proxy environment names
were present. This supports a restriction or transport failure on **that**
public endpoint from this Windows host; it does not prove all external HTTPS
is unavailable, nor establish a production document-load PASS.

Code now uses the existing TF3 public HTTPS executor with an additional
trusted parent-approved origin restriction on **each** redirect hop before
DNS resolution/connection, still retaining TF3 per-hop DNS/IP/SSRF/TLS,
bounded bytes, cancellation and token receipts. The native host and parent
MIME allowlists additionally agree on common WebP/AVIF, JavaScript and font
types. No production AppContainer network capability, second HTTP executor,
new trust store, or model-facing WebView2 operation was introduced.

A separate **Rust-test-only** exact `https://127.0.0.1:443/` owned-certificate
mode is being prepared for a controlled TLS/document/dependent-resource
physical check while external HTTPS is blocked. It uses the original real
production WebView2/AppContainer/COM transport and TF3 implementation, but
the isolated owned-loopback policy and ephemeral public trust certificate
are unavailable in the release binary or Tauri IPC. It must be labeled
**production-host controlled HTTPS**, not public HTTPS certification.
At this checkpoint that new controlled physical case is **NOT_PROVEN**.

Focused tests after the origin and test-transport implementation: TF3
**22/22 PASS**, production owner active non-physical **5/5 PASS** (six
physical probes ignored by default); host **33/33 PASS** after updated
resource MIME support. Scoped rustfmt and `git diff --check` PASS; feature
enabled `cargo check` PASS before the last test-only restriction assertion.
These do not count as a positive native production E2E. PR #46 remains
Draft; the full semantic/action/form/credential/file/popup/race and security
acceptance matrix is still incomplete.

### Continuation 2 controlled production-host TLS physical chronology

The first real owned-HTTPS run used the Windows production AppContainer and
WebView2 host (no fixture host executable), an exact scoped
`https://127.0.0.1:443/` TLS fixture with ephemeral public DER, and the
same TF3 bounded binary GET executor through a **test-only** immutable
loopback token. It physically completed 4/4 native COM/TF3 GETs: main HTML
(551 bytes), CSS (317), PNG (68), and WOFF2 MIME resource (48). The original
test mistakenly expected a fifth JavaScript GET and timed out. This original
test run is **FAILED**, not a PASS. Source inspection proved the production
host intentionally calls `SetIsScriptEnabled(false)` until action/effect
policy is implemented; therefore untrusted scripts must **not** run. The
missing fifth request is consistent with this deliberate restriction, not a
reason to weaken the browser security settings. Test-only fake WOFF2 bytes
prove transport/MIME, not actual font decode or visual rendering.

The subsequent strictly owned TLS physical test used the same real
production host, plus the optional one-hop same-origin CSS 302 from
`/page.css` to `/style.css`. The correctly scoped read-only run **PASS 1/1**:

```text
id=1 HTML 551B tf3=completed tls=https_transport_observed COM=true dns_hops=1
id=2 CSS  317B tf3=completed tls=https_transport_observed COM=true dns_hops=2
id=3 PNG   68B tf3=completed tls=https_transport_observed COM=true dns_hops=1
id=4 WOFF2 48B tf3=completed tls=https_transport_observed COM=true dns_hops=1
PRODUCTION_OWNED_HTTPS_DOM=PASS visited=5 elements=4 generation=1
PRODUCTION_OWNED_HTTPS_READ_ONLY=PASS
UNTRUSTED_JAVASCRIPT=DISABLED
```

Each of the four responses was separately authenticated to the pipe/session,
served through TF3 and acknowledged only after actual native COM deferral
completion. The second CSS DNS hop demonstrates TF3 redirect reclassification
within the approved HTTPS origin. The parent independently retained original
host/browser/renderer identities in the owned zero-capability AppContainer
and verified Job/process, effective UDF and profile cleanup. The TLS fixture
stopped cleanly after 5 owned localhost connections (4 browser resource
responses and the single CSS redirect hop), zero rejected connections; the
run-scoped `server.cer`/`active.run` were deleted and port 443 was no longer
listening. No global TLS trust, generic network permission, or system browser
profile was created. The fixture server's explicit local TLS smoke checks
had independently verified certificate IP SAN, non-exportable CNG key and
cleanup. No external/public HTTPS success or JS execution is claimed.

**Important limits:** This is a **positive controlled production-host
read-only HTTPS document/render/resource bridge**, not full production
interactive acceptance. Native structure elements are closed roles only,
not semantic names, live target references, or action authority. Public
`https://example.com/` failed independently, and no other public endpoint
was certified. Real JavaScript resources/handlers, governed interactions,
form effects, credentials, screenshots, files, popups/storage, complete
11-case production races and 17-step production E2E remain **NOT_PROVEN**.
The new Rust test now also requires the exact CSS redirect chain and two
DNS hops. The strengthened variant was subsequently run again against a new
ephemeral TLS certificate and new owned listener and **PASS 1/1**, physically
confirming the same four completed COM/TF3 resources, exact `/page.css` →
`/style.css` redirect chain, 2 DNS classifications for CSS and one for each
other resource, `PRODUCTION_OWNED_HTTPS_DOM=PASS visited=5 elements=4
generation=1`, and verified Job/UDF/profile cleanup. The bounded owned TLS
server stopped with `connections=5 denied=0`; its public DER and active
marker were absent and port 443 had no listener after stop. Distinct earlier
FAILED evidence is retained. User-visible interactive browser execution
still remains disabled and **PR #46 Draft**.

### Continuation 2 — native closed-control observation and real snapshot references

The owned TLS fixture now also includes an explicitly controlled, non-
submitting form with a text input, password, hidden input, checked checkbox,
selected option, textarea, select and disabled button. No write to the fixture
is triggered. The **unchanged production AppContainer/COM host** now returns
only closed structural roles, allowlisted control type and strictly typed
`visible`, `enabled`, `checked`, `selected`, `expanded` state, and a bounded
`omittedFields` count. It does not read or emit the contents of fields, user-
provided accessible names/labels, HTML, arbitrary attributes, href, cookies,
page scripts or URL query strings. Password/hidden/file and unsupported types
are dropped; labels associated with excluded inputs and editable subtrees are
also omitted. Fixed COM script evaluation remains permitted for observation;
**untrusted page JavaScript remains disabled**.

New real Windows controlled-HTTPS test PASS (fresh temporary certificate),
with physical TF3 and native COM evidence, including revalidated CSS redirect:

```text
id=1 HTML 1254B completed COM=true TLS=observed DNS=1
id=2 CSS   317B completed COM=true TLS=observed DNS=2 (same-origin 302)
id=3 PNG    68B completed COM=true TLS=observed DNS=1
id=4 WOFF2  48B completed COM=true TLS=observed DNS=1
PRODUCTION_OWNED_HTTPS_DOM=PASS visited=15 elements=12 generation=1 omitted_sensitive_fields=2 controls=closed-states-only
PRODUCTION_OWNED_HTTPS_SNAPSHOT_REF=PASS page_generation=1 elements=12 stale_previous=STALE_ELEMENT fresh_reference=accepted_without_execution private_values=withheld
```

The production owner now feeds that actual nonce/source/page-bound COM result
into the **existing** `BrowserPageContract` (no new evidence or policy store),
which allocates random opaque element references and a unique snapshot ID.
The test independently observed the same page twice; the first reference
was rejected as `STALE_ELEMENT` even though the page generation was unchanged;
a fresh reference was accepted for identity validation **without action
execution**. Existing `BrowserPageContract` references now additionally
expire after 30 monotonic seconds and are revoked on failed new observation,
page invalidation and clean close. The last physical run tested reference
invalidity again after its owned native session shutdown. No model-facing
live-action endpoint was introduced.

The closed-control snapshot deliberately has **empty accessible names and
visible text** and lacks full accessibility relationships. It is not yet the
required full production semantic/action acceptance. The pseudo-WOFF2 bytes
prove bounded font transport, not usable font rendering. The controlled
script is present in markup, but the production host does not execute it.
Full real-browser semantic names, exact DOM action binding, approvals,
form execution and remaining production E2E gates stay **NOT_PROVEN**.

### Continuation 3 — required-field constraint bit in native closed observation

On the existing Draft branch after commit `7fbb9a7`, the native fixed-role
walker was extended with exactly one nullable, closed boolean: `required`
for allowlisted input/select/textarea controls only. Neither raw attribute
strings nor validation messages, labels, field names or field values are read
or returned. Both the native host and parent reject a `required` bit on
unrelated elements; the parent maps the bit into the *existing* TF4
`ObservedElement.required` and held `SemanticElement.required`. No action
authority was added. Host-only 36/36 and runtime active 7/7 tests PASS.

The exact controlled HTTPS fixture's text field now has a `required` DOM
constraint. Its fresh production AppContainer/WebView2 physical case **PASS
1/1** with HTML 1263B, CSS 317B (same-origin redirect, 2 DNS hops), PNG
68B, synthetic WOFF2 48B, all four real TF3 TLS/COM responses terminal
completed. Native DOM observation still visited 15 nodes, emitted 12 safe
elements, omitted 2 sensitive fields and confirmed the required control.
Stale re-observation/close reference tests still PASS without executing
interactions. The TLS fixture stopped normally (`connections=5 denied=0`);
the temporary public DER and active marker were removed and no port-443
listener remained. This is **not** approval/submit/form action acceptance.

The existing page-contract effect classifier was further hardened: `Scroll`
is now `UNKNOWN`/approval-required instead of unconditionally read-only,
because script-enabled pages may attach scroll/intersection handlers with
external effects. `Inspect` remains inert and can validate the opaque
reference of a disabled control, while click/typing still reject disabled
or invisible controls. Allowlisted `textarea` is recognized as a text-entry
field, but typing remains `UNKNOWN` and no native typing channel is enabled.
These changes are contract safeguards, **not** physical action acceptance.

The production owner now retains the native walker's bounded structural
`depth` (0–16) and exact `headingLevel` (1–6 for headings only) in the
existing opaque TF4 element snapshots. These are non-secret numeric
metadata; no inferred parent reference, element selector or DOM text is
created, because omitted/intervening DOM nodes make adjacency unreliable
as a parent relationship. Invalid depths or role/heading combinations fail
closed in the existing page contract. Focused contract and runtime unit
tests PASS; the fresh production owned-HTTPS/COM replay also verified
heading level 1 and exact depth/level correspondence with the native
snapshot for every observed element.

The action contract now reserves distinct `Check`, `Uncheck`, and `Select`
intent classifications: check permits only checkbox/radio, uncheck only
checkbox (not radio without another exact group choice), and select only
combobox. All three remain `UNKNOWN` effect / central-approval-required.
This is deliberately a classification and exact-role check only: no native
gesture, submission or model action was enabled.

### Continuation 4 — native-retained exact DOM nodes (read-only identity foundation)

The production AppContainer/WebView2 host now derives its native-only
identity capture from the **same** bounded fixed structural DOM walker,
retaining exact DOM Node objects in a CDP Runtime object group on the
WebView2 UI apartment. Neither the CDP object ID nor nodes, selectors,
page strings, arbitrary scripts or credentials cross the sealed parent
pipe. Its internal `NativeDomIdentity` registry binds the latest
authenticated observation sequence and page generation to the retained
node slots and revokes previous slots on reobservation. A fixed native
read-only recheck function refuses queued DOM mutations and detached/
foreign-document nodes, but this recheck has **not yet been dispatched
by a real production action**. Native action authority remains disabled.

Native host unit tests **39/39 PASS** after three new identity/parser/
probe cases. A fresh real production AppContainer HTTPS rerun with the
correct `-CssRedirect` controlled fixture also **PASS 1/1**, delivering
HTML/CSS/PNG/synthetic WOFF2 via four independently completed TF3+COM
responses; the exact same 15 visited/12 reported/2 omitted secret fields
and random opaque snapshot stale checks still pass. These native checks
prove the internal CDP bridge did not regress read-only observations,
**not** that a same-index replacement is physically rejected by a live
action. The first fixture attempt lacked `-CssRedirect` and failed its
explicit CSS expectation before the DOM test; a fresh corrected run
passed. Temporary certificate, active marker and listener were cleaned
after the runs; no historical evidence was deleted.

### Continuation 5 — exact sealed-pipe identity recheck and cancellation gate

The existing native host now accepts only a new bounded, authenticated
`recheck-element` control frame on the *same* already-owned parent pipe:
session nonce, strictly increasing check sequence, last native observation,
page generation, source digest, original observed visit index and its
authoritative snapshot ordinal. The host resolves only its retained Node
object; its fixed internal COM recheck rejects pending MutationObserver
records, disconnected/foreign-document Node objects, stale navigation and
unattested state. The reply exposes only a closed `ACCEPTED` or `STALE`
state with echoed identity, never a node handle, selector or text. Invalid
or replayed control frames terminate the channel. Native host unit tests
**43/43 PASS**. The parent has a `#[cfg(test)]` method that derives
index/ordinal from the *existing* prepared `Inspect` target and verified
native observation; there is no production/model-facing action or IPC.
The standalone exact-element COM recheck physical test is **PASS 1/1**
on a fresh minimal one-document owned HTTPS fixture with real
AppContainer/WebView2+TF3/COM: the exact retained node was ACCEPTED
twice, the previous opaque reference was STALE after native reobservation,
and both references were STALE after shutdown; Job/UDF/profile cleanup
passed. The accepted historical fixture 8+9 was not rerun. This is only a
point-in-time read, **not** permission to click: an effectful gesture must
combine identity validation and one execution atomically on the same
native UI apartment after central approval, to prevent a check/use race.

An **independent** one-case production pending-document cancellation test
physically **PASS 1/1** with the actual zero-network AppContainer/WebView2
document deferral, controlled HTTPS TF3 transport and a delayed single GET.
While the TLS server withheld the first document, the parent dropped its
pending flight, terminated the existing Job and independently checked
host exited, original Job active processes zero, AppContainer profile
deleted and private UDF/root absent. After the fixture delay window its
GET count remained exactly one and the closed session rejected replay.
The test specifically does **not** claim `deferral.Complete()` on the
cancelled/killed flight. Its own ephemeral certificate/active marker,
signal and port-443 listener were cleaned on exact RunId Stop. This is
one of the required independent lifecycle cases, **not** all eleven.

Separately, the opt-in real production `physical_production_owned_rfc1918_denial_no_tcp_fallback`
case physically **PASS 1/1** with an exact assigned Windows WSL vEthernet
interface `172.28.208.1:443`: ordinary parent TCP positive control=1,
restricted AppContainer/WebView2 direct TCP connections=0; TF3 denied
the HTTPS resource and native ownership shut down. This is a bounded
**owned RFC1918 IPv4 listener negative only**, not global IPv4/IPv6,
Fetch/XHR, WebSocket, iframe, Worker, EventSource or Beacon coverage.

The separate opt-in real production
`physical_production_owned_ipv6_loopback_denial_no_tcp_fallback` also
physically **PASS 1/1** with the owned `[::1]:443` listener: ordinary
parent TCP positive control=1, confined browser direct connections=0,
TF3 resource denied, real native COM denial completed and original owned
Job/UDF cleanup passed. This proves **only local IPv6 loopback**; it does
not establish IPv6 external interfaces, dual-stack DNS fallback or other
WebView2 APIs (WebSocket, Fetch/XHR, Worker, Beacon, etc.).

### Continuation 6 — physical same-index DOM node replacement acceptance

An additional deliberate opt-in `CLACK_TF4_EXACT_DOM_MUTATION=1` variant of
the separately owned **one-document** production HTTPS identity test
physically **PASS 1/1**. The real zero-network AppContainer/WebView2 host
rendered the minimal HTTPS document via existing TF3 TLS and native COM,
observed an exact H1 in its bounded structural snapshot and rechecked its
retained Node as `ACCEPTED`. An explicitly debug-build-only, authenticated
one-shot fixed COM function then replaced that specific H1 with a *new H1
in the same parent position*, without reading names, values or arbitrary
attributes, or enabling untrusted page scripts. The old retained Node
rechecked `STALE`, never resolved the successor by the same index; fresh
native COM observation generated a new opaque snapshot/reference and its
exact node rechecked `ACCEPTED`. Close invalidated both references and
confirmed Job active processes zero, removed UDF/profile and clean
shutdown. Native host tests **44/44 PASS** after the new strict debug
mutation/source/closed-response test. This is actual physical same-index
replacement evidence, not an inferred snapshot generation change.

The mutation hook is compiled only with `debug_assertions`, accepts only
the already-authenticated parent v2 recheck frame and the exact
`https://127.0.0.1/` origin, consumes its one-shot budget before the
fixed COM attempt, and is **absent from optimized release compilation**.
It accepts no scripts, selectors, arbitrary target tags, credentials or
model/installed-UI calls. The replacement test used RunId
`f9d71020f72e4f70aad6729c4d8f7dd3`; exact RunId Stop completed with
one connection and zero denied, certificate/active marker absent and no
443 listener. It does **not** prove atomic effectful action admission,
central approval consumption, form submission or complete TF4 E2E.

### Continuation 7 — central native click bridge and cancellation source verification (not physical approval acceptance)

On the existing `tf/browser-computer-use` branch after committed HEAD
`74398fe408b441b668f95919d9bb09071dcef6cc`, the TF4 native owner,
WebView2 host and runtime now include an authenticated, serialized exclusive
control-turn protocol and a move-only consumed native approval witness.
The existing TF4 pending token and genuine application approval dialog remain
the intended authority; a host-issued control turn is **scheduling only**.
The original retained DOM Node must still pass the host's exact recheck.

The native owner now tracks a queued click in the existing active-call map,
including after consumption of its pending token. A per-call atomic phase
linearizes cancellation against irreversible dispatch commitment. A cancelled
queued call cannot win the dispatch transition, whereas a cancellation after
dispatch commitment is **not** represented as guaranteed cancellation.
The actor burns pending authority and clears its exact busy lease on stale,
denied, cancelled, expired, closed-reply or completed command paths. Known
pre-dispatch rejections retain FAILED/CANCELLED native terminals; after possible
transport/COM dispatch, uncertainty remains UNKNOWN with no automatic replay.
The outer click receipt exposes both the fine native terminal and canonical
terminal, including on uncertain command delivery. This is source-level
hardening, not a claim of an independently observed effect.

Verification of this combined native source on Windows, with
`CARGO_INCREMENTAL=0` and the `tf-browser-native-runtime` feature:

- `cargo check --locked --features tf-browser-native-runtime --tests --lib --bin clack-browser-host`: **PASS**, exit 0.
- Browser owner (`modules::net::tf_browser::tests::`): **19/19 PASS**.
- Native action/effect contract (`modules::net::tf_browser_contract::tests::`): **13/13 PASS**.
- Native runtime: **12/12 active PASS, 11 physical tests ignored**, not run.
- Native host (`--bin clack-browser-host`): **50/50 PASS**, including the
  real two-pipe control-turn ordering unit tests.

Two individually validated regenerable Rust incremental cache directories
were removed only after confirming the intended target parent, no reparse
point and no active compiler processes. Protected untracked `outputs/` and
`scripts/__pycache__/` and earlier physical fixture records were untouched.

**Not accepted:** no central `tf_browser_prepare` -> genuine OS dialog
`tf_browser_approve` -> `tf_browser_execute` -> real exact-node click has yet
been physically performed; no independent post-action effect has been bound
to such approval, so `SUCCESS` has not been demonstrated. This continuation
does not satisfy form submission, screenshot, credentials, transfers,
popup/storage, 13-case lifecycle matrix, extended network-class isolation,
17-step production E2E, optimized current release/package/install acceptance,
or model-facing native capability admission. PR #46 must remain **Draft**;
do not merge or start TF5.

### Continuation 8 — November 24: strict native click effect attribution and controlled form oracle

These are additive, **not a completed installed-human-consent acceptance**.

- Source `7b00be6` corrected the Windows-feature-only native session field
  access for non-Windows Rust compilation, and required verified TF3 TLS,
  no redirect and no credential authority before independent navigation can
  contribute to `SUCCESS`. The focused native receipt test, default and
  feature Cargo checks and formatting passed.
- Source `219b439` adds a separate opt-in HTTPS form document with bounded
  real HTTP/1.1 `POST /submitted`, a one-accepted-submission oracle and 409
  duplicate denial. Actual Windows ephemeral pinned-certificate TLS run
  `03e3803d327a44a5989a3767e27710bc`: `GET /` 200, first POST 200,
  replay POST 409, `FORM_POST_ATTEMPTS=2`, `FORM_POST_ACCEPTED=1`,
  `FORM_POST_REPLAY_DENIED=1`. Exact-run stop succeeded and the certificate,
  active marker, stop signal and port-443 listener were independently absent.
  Earlier `92e2a1896da44ea8a461f9d9135ff7e7` encountered stop-marker
  cleanup failure despite the correct 200/200/409 statuses; its failed
  outcome remains immutable. **Neither run exercised WebView2, TF3 POST,
  central approval or installed Clack form submission.**
- Source `01cd237` moves the pinned native host into the separate
  `tf4-native-host/clack-browser-host.exe` bundled resource to prevent the
  root executable basename collision. The optimized Windows app + NSIS
  package build completed exit 0: staged host SHA-256
  `7805865fc9bc534862e21d0f6af5bb95872a932bdbdce8a9208db223a92ec803`;
  installer `Clack_0.8.0_x64-setup.exe` SHA-256
  `498b8a05aff0a9867e19870f8c03dd7eca8a16c14ec827e24eb57cdd8f6fe897`.
  **Installed namespaced resource attestation remains unverified** pending
  fresh human-operated Windows installation; the older installed root host
  did not match the pinned staged host. Compilation is not installed proof.
- Source `25823ec` added `pageId: None` and `pageGeneration: None` in Rust
  acceptance-example request construction after GitHub CI `45305413674`
  exposed Rust `E0063`. The example's scoped Cargo check passed. Other CI
  failure classifications remain separate; Mac LM11 `E0601` is not a TF4
  production browser effect verification result.
- Subsequent host/runtime/owner hardening now binds the exact
  retained **link** Node's normalized HTTPS destination digest at native
  dispatch; the authenticated child action reply carries only the 64-hex
  SHA-256, not a raw page URL. The parent can promote dispatch to a canonical
  observed `SUCCESS` only if a later independently completed same-origin
  TF3 HTML navigation matches that digest, source generation, TLS and COM
  completion. A different same-origin URL, missing digest, non-link target,
  invalid/malicious destination, redirect, changed node or unknown response
  stays non-successful and is never retried. Native host fixed script accepts
  only retained visible/enabled anchor nodes in this initial click slice;
  buttons/forms are reserved for separately approved action classes. This
  is a correlation constraint, **not an assertion that the gesture or effect
  has been physically observed through genuine OS consent**.
  Feature-enabled `cargo check --tests --lib --bin clack-browser-host` PASS;
  focused native receipt PASS 1/1; native owner PASS 20/20; native runtime
  PASS 12/12 active (11 physical ignored); native host PASS 50/50;
  scoped rustfmt and `git diff --check` PASS. These results validate current
  source, not a rebuilt/installed optimized package containing this later
  hardening.

**Unaccepted critical boundary:** Real installed Clack OS approval, one
consumed native effect proof with independent observed matching destination,
cross-origin and pre-dispatch cancellation race physical cases, real
WebView2-mediated POST/form state, screenshot, credentials, TF2 upload/download,
popup/storage, the complete 13-case lifecycle matrix and 17-step integrated
production E2E. TF3 Public correctly denies the ephemeral 127.0.0.1 test
fixture. The production-positive controlled public HTTPS origin and genuine
human action consent have not yet been established. Do not equate a test-only
loopback fixture, a binary build, or an SDK test with production acceptance.
Model-native action registration remains disabled. PR #46 stays Draft, with
TF4 Slice 4 distinct from canonical TF14 and later P15 desktop computer
control. Product-wide UI/UX Polish & Acceptance remains the mandatory final
product release gate.

## 2026-11-24 continuation — feature-matched physical renderer Fetch cancellation

The inherited acceptance-only Cargo build session `60874` terminated with
`GROUPED_ACCEPTANCE_HOST_FEATURE_BUILD_EXIT=0`; its warning output does not
change the exit status. The exact feature set was
`tf-browser-isolation-acceptance` for both `clack-browser-host` and the
`tf_browser_isolation_acceptance` example, not the production-feature host.
The existing failed `clack-tf-browser-grouped-only-kyK4zZ` run was preserved.

One **fresh** isolated physical case ran from source HEAD
`439c9e6da519caffbb9555bb43d7ed28e7c1c454`, with command
`cargo run --manifest-path src-tauri/Cargo.toml --locked --features
tf-browser-isolation-acceptance --example tf_browser_isolation_acceptance --
--grouped-only renderer-fetch-cancel`. It exited 0 and saved immutable evidence
to `src-tauri/target/tf-browser-isolation-acceptance/
clack-tf-browser-grouped-only-3CxR6e/grouped-only-verdict.json`, SHA-256
`9ac4dd25e0ed757934a988a93535f0c6a1f5eefd5a373279e8aabd6bdc77f7da`.
The independent aggregate reads `PASS_SELECTED_GROUPED_ONLY`, exactly **one
selected case verified** of nine implemented grouped cases, with **eleven
required**. The nested host `caseResult.status=FAILED` and
`acceptance-only broker fault triggered` are the **intentional native injected
cancellation outcome**, not a successful application action; the grouped
verifier separately records no case failure, owned Job cleanup verified and
owned UDF cleanup. The physical log records original WebView2 renderer COM
dependent request pending, independently acknowledged parent request, native
renderer abort and synthetic COM 503. This specifically repairs the earlier
host-feature mismatch; it does **not** prove every grouped cancellation or
shutdown race, the full eleven-case matrix, TF3 global egress, or genuine
installed Clack approval/effect/replay.

Working branch and remote both remained at `439c9e6` when recorded. Only
preexisting untracked `outputs/` and `scripts/__pycache__/` were present;
neither was removed. PR #46 remains Draft and unmerged. Existing pinned
optimized installer and installed host hashes are recorded in the canonical
engineering tracker; neither this acceptance-only debug build nor the
intentional host fault changes the installed production identity.

### Nine new case-local grouped Phase-A physical checks

Using the same previously built acceptance-feature host and example (no
competing Cargo rebuild), each additional grouped case was launched once as
`target/debug/examples/tf_browser_isolation_acceptance.exe --grouped-only
<case>`. All nine individual immutable `grouped-only-verdict.json` files read
`PASS_SELECTED_GROUPED_ONLY`, `verifiedCaseCount=1`, null case failure, true
independent owned Job cleanup and true owned UDF cleanup. Evidence directory
suffix, case and exact verdict SHA-256:

| Run | Selected scenario | SHA-256 |
| --- | --- | --- |
| `3CxR6e` | `renderer-fetch-cancel` | `9ac4dd25e0ed757934a988a93535f0c6a1f5eefd5a373279e8aabd6bdc77f7da` |
| `K1Oufg` | `renderer-xhr-cancel` | `5107b8b59f035051815d97b0f2bdbddcbe0936561350d2950f70397c648ff441` |
| `uLiyvM` | `page-close-pending` | `2eaea3ece80a914d1eaf8919125eaef9f7e7ddfb2d9e782a9568b10bc2210ddc` |
| `16IweB` | `session-close-pending` | `24e5bcdc804e2eabfc78e80283c9a749d819a9c40bc148c1ae958049fc600d37` |
| `NP3qBc` | `navigation-stale` | `0bee127ff7dd86232701129e0d3b3daea08cb118236a663ce7a4df990b9d78c3` |
| `7v6CBk` | `snapshot-stale` | `12366f55abb39959e7917f21f732065d19dcd802802c70337e729962e5002941` |
| `Mu6w3i` | `element-stale` | `527d7fa820fa8e881f85c4f94cdd38acfe0e797f42349dc820410f0bb390221f` |
| `rG6ka7` | `broker-process-kill` | `1b5108fc7304d2cfcbde550be3722bc2699959520a457375f1e33ef602ec0f6d` |
| `zOfjVG` | `multi-pending-shutdown` | `ee2ff3296fc95dfa21c0e1a31da3fcebb8c331d1c81689a3df43a16fb3aaccc6` |

These are **nine separate scoped runs** from one source/build state, not the
single full grouped execution and not eleven distinct scenario gates. Two
required cases remain absent from the implemented grouped inventory. The
original eight negative and nine historical Phase-A cases were not rerun.
No result is promoted to installed application's real consent/effect proof.

### 2026-11-24 source continuation: six bounded original-node controls

On top of original native exact retained-link CLICK, the existing sealed v2
parent/host control turn now contains narrowly scoped TYPE, CLEAR, SELECT,
CHECK, UNCHECK and SCROLL. These are **implemented source paths, not accepted
installed production capabilities**. The original TF4 prepare/OS consent/
single-use token/exclusive native owner/retained COM observation/cancellation
and canonical receipt authority is reused, not duplicated. An exact approved
request binds actor, chat session, canonical workspace, page ID/generation,
snapshot, opaque node, original origin/revision, action parameters and effect.
TYPE allows at most 256 printable UTF-8 bytes with control/bidi exclusions;
the OS approval display shows only text byte length and SHA-256, never the
literal value. SELECT requires a second retained opaque original OPTION from
the same observation; its original index and ordinal are rechecked with its
SELECT parent at native dispatch. SCROLL accepts only a fixed ±120 CSS-pixel
vertical step. All six native requests carry an independently recalculated
SHA-256 digest of the action's closed parameter encoding; CLICK retains its
original production wire. The host consumes each exact approval ID once,
invalidates the original observation and denies stale/changed/replaced,
disabled and unsupported nodes without selector/coordinate/JS fallback.
One fixed host-authored renderer function performs at most one action; the
native reply never exposes control values or the selection text.

**Critical effect distinction:** new field/scroll actions can trigger page
handlers or network writes. COM `DISPATCHED` does **not** independently prove
the observed field, server or scroll effect; absent separately correlated
postconditions, canonical terminal remains `UNKNOWN` with `NEVER_REPLAY`.
The existing direct CLICK link destination-digest correlation is preserved.
No native actions have been enabled in model-facing CapabilityIndex/Tool
Fabric, and no arbitrary secret or credential injection has been added.

**Validation on these uncommitted changes:** optimized native runtime source
has not yet been rebuilt/installed. Windows default and
`tf-browser-native-runtime` Cargo checks (lib/host/tests) PASS; all native
host broker contract tests **54/54 PASS**, TF4 owner **21/21 PASS**, TF4
runtime **14 active PASS** with **11 physical opt-in ignored**, TF4 contract
**13/13 PASS**, TF1 **13/13**, TF2 **7/7**, and focused React/Vitest **12/12**.
Two initial TF4 owner attempts failed because the expansion changed the
established CLICK malformed-target error string; the exact legacy denial
was restored and the final full owner suite passed. TF3 first parallel
test suite returned **20/22** with two transient localhost fixture
failure classifications; an unchanged-source serial rerun gave **22/22
PASS**. Both results are retained and this does not establish the cause of
parallel failure. Rustfmt and Git whitespace checks PASS. At this point,
new source is not represented in the previously installed optimized NSIS
package. The original genuine user diagnostic is only marked done, without
any app-generated canonical approval/effect receipt; there is still no owned
publicly reachable production-policy-compliant HTTPS action oracle.

**Boundaries still open:** physical one-use OS consent/effect/replay denial,
pre/post dispatch cancellation acceptance, independent native TYPE/CLEAR/
SELECT/CHECK/UNCHECK/SCROLL postconditions, approved form POST, origin-bound
credential references, screenshots, TF2 governed transfers, popups/storage,
the two unspecified and unimplemented required grouped races (nine of eleven
individually verified), extended isolation and complete 17-step installed
E2E. The exact *canonical identifiers and predicates* of those two missing
grouped cases are not defined in the available repo material. Relabelling
historically accepted renderer/host-crash cases as new grouped acceptance
would be false evidence, so no runner change was made. CI run
`45310119301` on original `439c9e6` head remains **FAILED**; this later
source requires fresh CI after push. PR #46 must remain Draft and unmerged.
TF4 is distinct from canonical TF14 and later P15 desktop control; product-
wide UI/UX Polish & Acceptance remains mandatory before final release.

### 2026-11-24 genuine operator-surface continuation and intermediate package

The human-only `NativeBrowserOperatorPanel` now offers the newly implemented
original-node TYPE/CLEAR/SELECT/CHECK/UNCHECK/SCROLL, in addition to CLICK,
without changing the model CapabilityIndex. Each button passes exact original
page/snapshot/element and approved bounded parameters through the existing
`tf_browser_prepare` → OS-native `tf_browser_approve` → `tf_browser_execute`
commands. The UI never supplies selectors, arbitrary JS, unrestricted scroll
values or a new authorization mechanism. TYPE input is restricted to bounded
synthetic non-secret text, cleared from its editing field when dispatched;
SELECT choices are opaque original retained OPTION references and the native
host independently checks the SELECT parent. Any mutation immediately revokes
the frontend's old page references and never automatically retries `UNKNOWN`.

For human acceptance diagnostics, the panel exports a **closed, bounded and
copyable** canonical receipt projection: opaque request ID, operation, vetted
terminal/effect/retry codes, and independently bound numeric/digest fields.
It expressly does **not** stringify the full receipt or expose raw URL,
element text, input value, credentials, page snapshot or future untrusted
fields. Focused native-panel/Vitest suites now **14/14 PASS**, including
forbidden control/bidi text, role restrictions and secret-leak negative tests;
TypeScript `tsc --noEmit` PASS, Git whitespace checks PASS. These are UI
regressions, **not** real OS consent or native effect acceptance.

An earlier source-only Windows optimized NSIS build from the newly pushed
native source `d9bfd953f5f26aa3b1dbe9e214739d680abf2699` completed with
`TF4_CURRENT_SOURCE_BUNDLE_EXIT=0`, but its frontend build ran **before**
the new human operator-panel source changes; this artifact is **intermediate,
not the final human-control acceptance package**. Exact staged native host
SHA-256 `1eb83287128e2e1405f79c8c56ae1a409ca62174e9d3cb952e0e5b8d88b10bf9`,
app binary `62df1c2ee186fb597eb7f6e8a7138ddb0542c09be634e2bc375e7c28563e067f`,
NSIS installer `f48962e6a11b684f179e2fb202d360c4ec71ee059a9c9b7390e6cdad5178bde2`.
The package was **not installed**. This identity is historical and must not
be confused with a subsequent package that actually contains the UI controls.

### 2026-11-24 exact-source panel-inclusive NSIS build and security triage

The follow-on **optimized Windows NSIS build from committed/pushed source
`a44490729e09c9aefa07a5667a3d1920d8bd674c`**, including the human-only
six-control operator panel and sanitized receipt projection, completed
`TF4_A444907_BUNDLE_EXIT=0`, with Vite/TypeScript frontend and native release
compilations succeeding. Pinned build artifacts are:

| Artifact | SHA-256 |
| --- | --- |
| `src-tauri/target/tf4-native-stage/clack-browser-host.exe` | `1325e537200d6eb2caab6ee50b57d3be23f3708a8a4830d53f117779720c30fa` |
| `src-tauri/target/release/clack.exe` | `be3aa781de0c3c31f1e96637a9e82f8f6c8a7c02abe0e834de455bf518b70541` |
| `src-tauri/target/release/bundle/nsis/Clack_0.8.0_x64-setup.exe` | `d447fdb8e9bed23fc4732fed3e6c5d847f307be326337cf24dfc4b573e901aba` |

This is **built, not installed, not physically approved, and not released**.
The installed application remains the earlier separately pinned `9a02304`
package. Fresh CI `45316528178` at `a444907` also completed **FAILED**
with non-TF4 LM11 entrypoint, WASI confinement and frontend test failures;
the PR is still open Draft and no claim of green CI is made.

Read-only security examination on exactly this production source disclosed
additional necessary *pre-install* fail-closed work, so **the built artifact
is intermediate and must NOT be used for positive native-click acceptance**:

- The fixed native original-node link `click()` is called before the host
  verifies the destination href's scheme/origin/query/fragment and disallowed
  popup/download/ping attributes. The later `UNKNOWN` classification cannot
  undo a possible dispatched side effect. Validate on the original DOM Node
  **before** calling it, with no alternate selector/node/coordinate fallback.
- Popup, download and permission handlers return without a veto on missing
  WebView2 callback args; veto HRESULT errors do not establish denial. Fatal
  host/owned Job termination is required on that failure path, rather than
  a silent `Ok(())` or trusting a later receipt.
- Same-origin unapproved GETs (including potential API-mutation GET), window
  navigation and brokered redirect chains require narrower native authority.
  Current parent permits up to three redirects and synthesizes a resource
  response under the original requested WebView2 URI. The pending safe change
  is zero redirects and rejection of any non-empty redirect chain; per-resource
  authorization beyond mere origin must also be evaluated before broad
  browser interaction acceptance.

These are **source-grounded audit findings, not physically reproduced exploit
results**. No TF3 Public policy exception is authorized or introduced. The
repo still lacks an owned, publicly reachable, ordinary-trusted HTTPS 443
production action oracle; the controlled loopback/pinned-certificate fixture
remains test-only. The nine individually accepted grouped cancellation cases
and the missing two required cases retain their exact separate status. The
thirteen *formal* TF4 exit-gate IDs/predicates are **not enumerated** in the
available canonical source/docs; do not invent them or confuse 13 contract
unit tests with thirteen named exit gates. The separately documented 17-step
installed production E2E remains unverified. Mandatory final Product-wide
UI/UX Polish & Acceptance also remains open.

### 2026-11-24 pre-dispatch and TF3 browser-resource source hardening

The high-priority findings above now have **source-level fail-closed repairs**
in the **existing** retained-node production host and central TF3-backed
browser runtime. These repairs are **not** an installed physical acceptance
claim. The native original-node click function now requires the retained
anchor's exact normalized HTTPS destination to be the current origin at
default TLS port, without userinfo, query, fragment, self-target, download,
ping, unexpected target or implicit `BASE target` **before** setting the
mutation latch and calling `node.click()`. The host never resolves a selector
or alternate DOM node. The subsequent independent COM-response validator also
rejects non-HTTPS, non-default port and query/fragment destinations.

The popup, download and permission WebView2 handlers now synchronously
terminate the confined browser host when native callback arguments are absent
or the native veto HRESULT fails. Production navigation also fails closed for
missing native event arguments/URI/cancellation failures and enforces same
original HTTPS origin, default 443, no query/fragment. **Host termination by
itself is not proof that all WebView2 children have exited**; parent-owned Job
closure and zero-process verification remain mandatory terminal evidence.

The parent browser-resource TF3 request sets `max_redirects=0` (without
changing TF3's public policy for other callers) and independently rejects
any nonempty TF3 redirect chain before installing a synthesized response for
the original intercepted WebView2 URI. A 302 no longer authorizes a second
same-origin GET or causes a redirected body to masquerade as the original
resource. Two previously ignored opt-in owned-HTTPS redirect tests had their
expected denial predicates updated; they **remain ignored**, not PASS.

Fresh post-repair focused Windows validation from this source state:

| Scope | Result |
| --- | --- |
| Default and `tf-browser-native-runtime` Rust checks | PASS (warnings, no errors) |
| Native browser-host contract | **57/57 PASS** |
| TF4 owner | **21/21 PASS** |
| TF4 runtime | **15 active PASS; 11 physical opt-in ignored** |
| TF4 action/effect contract | **13/13 PASS** |
| TF3 network policy | **22/22 PASS serially** |
| TF1/TF2 regressions | **13/13 and 7/7 PASS** |
| Rustfmt and `git diff --check` | PASS |

**Still blocked:** the browser broker admits arbitrary same-origin HTTPS GET
paths under one root-origin grant; an HTTP GET endpoint can be effectful even
without a redirect. Proving trusted exact per-resource/route admission needs
further extension of the existing parent TF3 authority, not page-provided
allowlists or a second policy engine. This general semantic GET-write risk is
**not** closed by the redirect fix, and a complete native approved-action
effect/once/replay receipt still has not been physically obtained from the
installed application. Missing popup/download veto failure *physical*
injections, old source build provenance, current full grouped 11-case and
network/API class matrix, and a publicly reachable owned HTTPS oracle remain
open. The earlier optimized NSIS hashes above represent the **pre-repair**
source, not these fixes. Do not install/promote that intermediate artifact as
evidence for these repairs or enable model-native browser actions.

### 2026-11-24 pinned security-source continuation and new physical cancellation regression

The four-file pre-dispatch/TF3-resource security repair above was committed as
`4770ccd1fb77db53e9e42b2457b0033f768009d2` on the existing
`tf/browser-computer-use` branch and pushed (local/remote SHAs matched). The
preserved safety stashes and unrelated `outputs/` and `scripts/__pycache__/`
were not modified. With the production feature, `production_exact_click` host
tests passed **2/2**, the host broker-contract suite passed **57/57**, and the
runtime suite passed **15 active / 11 ignored physical**. Warnings were
non-fatal. This is not an installed production action result.

One **fresh** feature-matched `tf-browser-isolation-acceptance` native host
and example build completed with exit 0. A new `--grouped-only
renderer-fetch-cancel` Windows AppContainer/WebView2 run exited 0 and reported
`PASS_SELECTED_GROUPED_ONLY` for the one selected negative-path case. The
induced host fault's *nested* `caseResult.status` is explicitly `FAILED`:
this is the injected/expected fault, not a positive browser operation or
proof of generally successful browsing. Evidence records an original parent
document request, held renderer fetch request, native cancellation, COM 503,
zero-network-capability AppContainer, owned Job cleanup and UDF removal.
The grouped runner's own summary expressly says `fullElevenGroupedRequirement:
NOT_PROVEN` and only **1/9 implemented cases selected**, not 11/11 acceptance.

- Fresh immutable run: `src-tauri/target/tf-browser-isolation-acceptance/clack-tf-browser-grouped-only-lUd6Qg/`
- `grouped-only-verdict.json` SHA-256: `21950E1CEAF72102F3F6AF7F188B297F81C32DDFA6CC8BBDE0A37D6EE6188662`
- `phase-a-renderer-fetch-cancel/phase-a-acceptance-receipt.json` SHA-256: `96065FEEF3B04BA87A79AD67689E8DC0E8535342995076842B44A1DE5E56F38E`
- Acceptance-feature debug host SHA-256: `7761C80544E952B0C6662FF407CD421CA1CC84726019AB7D612F2898381C88CF`
- Acceptance-feature example SHA-256: `604FE6B711F225789207E0A0161F8723FA1543843121BF038CA435719CF9F111`

This new run does not supply the missing owned public HTTPS oracle, installed
optimized app approval/effect/replay evidence, same-origin GET write authority,
the other two grouped cases, the original 17-step E2E, or release readiness.
Production model-browser tools remain non-callable and PR #46 remains Draft.

### 2026-11-24 retained FORM/submitter identity (validation-only, not submission)

The existing central `tf_browser_prepare` / genuine application approve /
consume-once native control flow now carries an opt-in `Submit` action whose
parameter is a **second original opaque FORM reference**, bound to the same
session/page/generation/semantic observation as the primary exact retained
submitter. The native runtime binds both retained indices/ordinals and
SHA-256 of canonical `submit:<formIndex>:<formOrdinal>` into the existing
action reply/approval verification. The contract distinguishes a real
`FORM` from generic `Other` and rejects non-submit controls, replaced forms,
forged references, stale snapshots and role mismatches. No selector, new
permission engine, or parallel receipt store is introduced.

**Deliberately no form effect is dispatched.** The production host validates
the exact original submit button/input and form association with a fixed
validation-only script, then returns `DENIED_TARGET`; even empty queryless
GET submissions remain denied because GET may mutate server state. Forged
positive CDP replies cannot elevate a submit to `DISPATCHED` or `CONFIRMED`.
The existing TF3 broker has not yet been extended with an authorized POST
body/network-write and independent server-side form effect oracle. Enabling
`requestSubmit`, adding a frontend model tool, or reporting submission success
at this stage would be unsafe and is **not done**.

Focused validation after correcting a real adversarial test failure:
native host broker-contract suite **60/60 PASS**; TF4 owner **21/21 PASS**;
runtime **15 active PASS, 11 ignored**; browser action contract **14/14 PASS**;
Windows feature-enabled Cargo check PASS. A first host run was **59/60** due
to an invalid submit primary index accepted as structurally stale; the
host-only parser was repaired to require both exact retained primary and FORM
witnesses *before COM*, and the unchanged failing case plus additional
digest-correct forgery negatives passed in the second run. Retain this failure
history; neither result establishes a real approved production submission.

### 2026-11-24 source-matched optimized NSIS bundle (not yet installed)

The current functional source at `6c0478150aa0f971f45d7815afa7c27a297ae28a`
was built through `scripts/Build-Tf4NativeBundle.ps1 -Bundles nsis` with
fresh optimized native host and application, successful TypeScript/Vite
production bundling and successful NSIS `makensis`. The package script exited
**0** and printed `TF4_NATIVE_BUNDLE_BUILD=PASS` and explicitly
`TF4_INTERACTIVE_ACCEPTANCE=NOT_PROVEN; NO_INSTALL_OR_DEPLOYMENT_PERFORMED`.
No production acceptance is implied by this build.

| Current source-matched artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `src-tauri/target/tf4-native-stage/clack-browser-host.exe` | 3,849,216 | `F750F45DF9DD1FBD9C500DEE254BECB1B55DCD0E051D7B1304B2045E92B48AD3` |
| `src-tauri/target/release/clack.exe` | 20,184,576 | `C6B9805EF23C651E3BEDBEF1E6720A880499CFABACB61FBB1E90B7EB927614C3` |
| `src-tauri/target/release/bundle/nsis/Clack_0.8.0_x64-setup.exe` | 12,221,820 | `5754162AA4992F18D3EA3765354DFAF9DE3D6100F250A6B47BBC435733473640` |

The installation was still older at post-build inspection: installed
namespaced host SHA-256 `4D92180F8FDE4A04C25D446EE0E8FE19F471883315D3F680473F6029F44477D9`,
installed application SHA-256
`351F7E9157CC1C4223D0C06E2F48133885EDFE6AE6E75A02868074E6574E77DA`.
The new installer requires an actual human Windows interaction, recorded as
`ur_kfrzln9j637l`, OPEN at first status check. Do not infer installation
from a generated setup file or mark a human step DONE without inspecting the
installed namespaced host and expected Tauri NSIS marker patch.

Current exact branch CI run `45351209677` on `6c04781` is **FAILED**.
Among its failing jobs are Rust tests, frontend and cross-platform WASI
adversarial/staging tests; the Windows WASI logs include multiple
`WorkspaceChanged` failures. These failures are not evidence that the TF4
focused tests failed, nor are they automatically proven to be unrelated
baseline errors. Release CI remains red pending specific causal triage.

Further scoped CI diagnosis: the `rust` cargo-check job stops with E0601
(`main` missing) in `examples/lm11_b03_native_restart_acceptance.rs`, rather
than a TF4 source compiler error. The `frontend` job reports 23 FAILED,
4735 PASSED, and 13 SKIPPED tests, including absent historical LM11,
real-Qwen and remote-control acceptance artifacts and compaction/schema
failures. This establishes concrete non-TF4 failing sites, not blanket
baseline exemption or a green result. The TF4 focused frontend suite after
adding `form` to the closed semantic snapshot allowlist passed **14/14**;
the form role was needed for native form observation but does **not** expose
a Submit action or relax human consent. This frontend compatibility patch
postdates the source `6c04781` package, which therefore cannot be labeled
source-identical to the next commit until the optimized bundle is rebuilt.

### 2026-11-24 source-matched frontend compatibility rebuild

The `form` role allowlist correction and focused regression test were committed
and pushed as source `e1735b6081644619e56b809a8b0f40668c7d2167`.
The existing `scripts/Build-Tf4NativeBundle.ps1 -Bundles nsis` ran against
that source with adequate disk space and without a competing Cargo build.
Optimized native host, production TypeScript/Vite, optimized application,
and NSIS packaging all completed, final exit **0**. The build emitted its
explicit `TF4_INTERACTIVE_ACCEPTANCE=NOT_PROVEN; NO_INSTALL_OR_DEPLOYMENT_PERFORMED`.

| Source `e1735b6` staged artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `src-tauri/target/tf4-native-stage/clack-browser-host.exe` | 3,849,216 | `C5211AF75F6BD544F8C702208BEE2BD2083A373F584E0DBD47ED435C5755940A` |
| `src-tauri/target/release/clack.exe` | 20,184,576 | `27BF9E1B957F315B148D10A9A5291F6EBC9A1C322790F655858F7445D89F2D53` |
| `src-tauri/target/release/bundle/nsis/Clack_0.8.0_x64-setup.exe` | 12,220,530 | `8DE17E487B73A4A77A2B38B830515ED6842DFFB4759D00A1BFF26925496C92FC` |

At this post-build check the installed namespaced host and installed app
continued to match **older** `4D92180F...` and `351F7E...` binaries,
respectively. Human-run installer task `ur_kfrzln9j637l` remained **OPEN**;
its expected installer path now refers to the newly generated `e1735b6`
package. Do not imply installed acceptance; compare actual installed host
and Tauri NSIS-patched application bytes after the person completes it.

### 2026-11-24 thirteen authoritative TF4 exit gates — explicit governing contract

The user supplied the previously missing **authoritative thirteen gate names**.
The [existing engineering-state tracker](AGENT_ENGINEERING_STATE.md#canonical-tf4-thirteen-gate-release-tracker-authoritative-names-24-november-2026)
now persists all thirteen numbered predicates, present honest states and
evidence boundaries. This is a correction to the earlier statement that their
names were source-undefined; it does **not** retroactively promote focused tests
to passing release gates.

| # | Gate | State | Evidence actually in hand / missing production predicate |
| --- | --- | --- | --- |
| 1 | Genuine approval/action E2E | **BLOCKED** | Central one-use actor source tests; actual installed OS approval → controlled server effect → replay receipt missing. |
| 2 | Stable actions | **PARTIAL** | Six host action implementations and focused tests; physical independent DOM/effect and stale/replay matrix missing. |
| 3 | Form submission | **BLOCKED** | Original FORM/submitter binding and deny-only host validation; TF3 one-write grant/physical POST missing. |
| 4 | Credential authority | **BLOCKED** | Origin-scoped references, revocation and physical no-leak proof missing. |
| 5 | Screenshots | **BLOCKED** | Bounded page-bound screenshot evidence/persistence missing. |
| 6 | Downloads | **BLOCKED** | TF3 network plus TF2 verified file-commit and adversarial run missing. |
| 7 | Uploads | **BLOCKED** | TF2 original file reference plus TF3 authorized single upload and effect proof missing. |
| 8 | Popups/tabs/storage | **PARTIAL** | Host callback veto source; full tab/storage/browser-lifecycle physical isolation missing. |
| 9 | Lifecycle/race matrix | **PARTIAL** | Nine implemented physical grouped tests; two mandatory cases and full gesture cancellation/restart matrix missing. |
| 10 | Extended network isolation | **PARTIAL** | TF3 GET/redirect protection; ungoverned same-origin GET side effects and write classes unresolved. |
| 11 | Model-facing exposure | **BLOCKED** | Correctly disabled until per-operation production acceptance; CapabilityIndex gating not accepted. |
| 12 | Production E2E | **BLOCKED** | Integrated seventeen-step-style installed real-app run and receipts missing. |
| 13 | Release/package validation | **PARTIAL** | Source-matched NSIS build PASS; installed identity, CI, package acceptance and product-wide UX gate missing. |

**Infrastructure requirement for gates 1/3/7/10/12:** an operator-authorized,
publicly DNS-resolvable, publicly routable **owned HTTPS origin on TCP 443**
with normal trusted TLS (no private, loopback, tunnel or policy exception), a
deterministic nonce-scoped GET navigation/effect oracle, exactly-one POST/write
counter and replay-denying endpoint, and operator-side read-only receipts that
independently bind request ID, method, target, body digest, server result and
time. The fixture must permit deliberate cancellation, stale original-node,
redirect, cross-origin, DNS/IP and credential-denial cases without making the
AppContainer a general network client. No such production fixture or human
deployment authorization is recorded. Never reuse arbitrary third-party
httpbin outcomes or opt-in localhost test certificates as acceptance.

**Fresh installer reconciliation (24 November):** Human step
`ur_kfrzln9j637l` reported `OPEN`. The exact staged NSIS SHA-256 remained
`8DE17E487B73A4A77A2B38B830515ED6842DFFB4759D00A1BFF26925496C92FC`;
installed host/app remained older by executable size. No new installed app
was launched or attributed to source `e1735b6`, and no physical positive
approval/effect/replay was performed. Current PR stays Draft; CI remains red.

### 2026-11-24 resumed source hardening, verification and CI boundary

The pending Windows `cargo check --all-targets --locked --features
tf-browser-native-runtime` completed **PASS** after explicit opt-in
`required-features` Cargo entries for the two Windows-only LM11 examples.
This preserves the example executables and their existing Windows feature
gates while eliminating the Linux/macOS `E0601` empty-crate entrypoints.
The current patch also tightens native link-effect reconciliation: a completed
TF3 HTML document request must have an authenticated broker request ID
**strictly greater than** the host resource sequence sampled after native
dispatch. A previously completed same-URL receipt cannot confirm another
one-use original-node click. This is only an anti-recycled-receipt property,
not an independent proof of a server-side business effect.

TF3's *existing* browser resource executor now treats all brokered browser
GETs as potentially effectful: after a network attempt, transport completion
or failure leaves `effect_state=Unknown`, `retry=NEVER_REPLAY` and
`auto_retry=false`. This applies without changing ordinary TF3 standalone
GET/HEAD or introducing another network owner; a page-generated GET can
still cause an unauthorized remote effect, so gate 10 remains **PARTIAL**.
The original FORM/submitter host `Submit` action remains **deny-only**.
No body/method-bound TF3 POST permit, public HTTPS:443 controlled service,
owned-server independent effect oracle, installation, or real app approval
was created. Gates 1, 3 and 12 remain **BLOCKED**.

New focused Windows tests after scoped `rustfmt --check`:
`browser_binary_get_reuses_tf3_token_scope_and_never_promotes_truncation`
**1/1 PASS**, asserting browser transport `Unknown`/`NEVER_REPLAY` on
observed 2xx and truncated failures; and
`native_click_confirmation_requires_independent_next_document_receipt`
**1/1 PASS**, including equal/stale broker sequence rejection. These
are source tests, not installed production acceptance. Global
`cargo fmt --all -- --check` failed solely because it would reformat
unrelated historical example files; it made no changes.

Comparison of protected-main workflow `44994093010` at `dddab1b9` and
Draft PR branch workflow `45355106767` at `9fd07d9`: both report
seven failed CI categories with coverage skipped. Main Ubuntu WASI failed
`wasi_infinite_guest_times_out_and_revocation_interrupts_without_result`
(109 passed/1 failed); PR Ubuntu WASI failed
`pure_loop_is_fuel_bounded_and_wall_clock_cancellable`
(28 passed/1 failed), so **the category is inherited, not the identical
test failure**. Main `rust` had `E0601` at LM11 B03; branch `rust`
at LM11 authenticated WebView, both addressed by the scoped manifest
target requirements but not proven fixed in a fresh remote CI run.
Other frontend, Windows/macOS Rust and WASI root causes remain subject to
per-job CI triage; a category-level main failure is not proof of identical
branch causality.

Installation request `ur_kfrzln9j637l` is still **OPEN**. The previously
built optimized installer identity remains pinned to source `e1735b6`,
not these newer Rust sources. Do not attribute the older installed executable,
an installer build, or a GET 2xx receipt to source-matched installed browser
approval/effect/replay acceptance; no release gate has been promoted.

**Additional owner-scoped network fix and validation:** The TF3 browser-resource
executor now rejects **every browser-resource 3xx** before following even an
otherwise same-origin redirect, regardless of a prepared token's requested
redirect budget. Ordinary standalone TF3 GET redirects remain governed by
their existing public per-hop checks. A deterministic owned loopback source
test requested one allowed redirect to `/potential-write` and proved it was
stopped after the first 302 (one DNS receipt, no redirect chain, no second
request, `Unknown` effect and `NEVER_REPLAY`). This fixture is a
source/transport negative test, **not** positive installed browser network-write
authorization.

Serial Windows native validation on the changed sources: TF3 network policy
**23/23 PASS**, TF4 owner **21/21 PASS**, native runtime **15/15 active PASS**
with **11 separate opt-in physical tests ignored**, native host broker
contract **60/60 PASS**, and focused frontend
`NativeBrowserOperatorPanel`/`browserRuntimeStatus`/
`ChatToolsControl.browser` **14/14 PASS** across three files. Scoped
`rustfmt --check` and `git diff --check` passed. These outcomes do not
promote any production release gate.

Seven-job protected-main versus PR-head CI classification for runs
`44994093010`/`45355106767`:

| Failing check | Protected main versus PR head | Classification at this patch |
| --- | --- | --- |
| `rust` | Main LM11 B03 `E0601`; branch LM11 authenticated `E0601` | Inherited Windows-only example target gating; both now opt-in and local all-targets check passed; new remote CI unverified |
| `rust-test (macos-latest)` | Main LM11 authenticated `E0601`; branch LM11 B03 `E0601` | Same inherited example-gating cause in opposite build order; new CI unverified |
| `rust-test (windows-latest)` | Both `E0425` calls to LM11 feature-gated acceptance helpers `acceptance_is_owned_webview_root`, `acceptance_bind_synthetic_child` and related symbols | Inherited default compilation of opt-in LM11 examples; Cargo target gate preserves explicit Windows acceptance and prevents default inclusion |
| `T3a WASI adversarial (ubuntu-22.04)` | Main `wasi_infinite_guest_times_out_and_revocation_interrupts_without_result` failed (109 pass/1 fail); branch `pure_loop_is_fuel_bounded_and_wall_clock_cancellable` failed (28 pass/1 fail) | Both red, **different failing cases**, cause unresolved |
| `T3a WASI adversarial (windows-latest)` | Both repeated `WorkspaceChanged` (7 pass / 21 fail) | Inherited failing class; environment/concurrency versus source cause not resolved |
| `T3a WASI adversarial (macos-latest)` | Both 101 pass / 9 fail in custom-tools/WASI | Inherited category, full per-test root-cause equivalence unproven |
| `frontend` | Both red; branch has compaction schema failures, missing historical acceptance artifacts and T01/T15 inventory | Inherited red category; exact per-test inventory across both commits not fully matched, and failed fixtures remain failed |

`coverage` was skipped on both because its upstream `rust` dependency
failed; it is not an eighth independently failed suite. None of these
baseline diagnoses excuses release CI. A fresh branch run after push is
required before claiming that the manifest gates fixed any remote job.
