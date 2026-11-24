# TF4 production browser integration — Windows physical evidence, 2026-11-23

This is a chronological integration record, **not a production-interactive
browser acceptance certificate**. All work is confined to /clack on
tf/browser-computer-use and the existing Draft PR #46. Starting pushed HEAD
was bf5038619ce1e3313baef8d217064ab25aa88b94; historical original task
baseline was 07b007c83ba12fdd001094b99d9918192d085fa9. Additional
uncommitted production changes already existed at continuation startup;
they were preserved rather than reset.

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
