# TF4 Windows isolated browser and TF3 broker — controlled acceptance addendum (2026-11-22)

Status: **controlled physical isolation and integrated resource-broker baseline PASS; broader TF4 security and interaction acceptance NOT COMPLETE**.

This is an additive record. The original `TF4_WINDOWS_BROWSER_HOST_ISOLATION_ACCEPTANCE_2026-11-22.md` records the historical exit-101 failure and must not be retroactively rewritten. All case evidence listed below is immutable and retained under `src-tauri/target/tf-browser-isolation-acceptance/` in the tested Windows checkout (not part of the Git commit).

## Proven scope

- Starting branch `tf/browser-computer-use`, starting HEAD `184b33c5fe6a24b6c90095b5fc492417b99401e8`, existing draft PR #46. No model-facing interactive WebView2 capability was enabled.
- AppContainer with no network-capability SIDs, no WFP or global firewall rule, per-case profile and isolated unique WebView2 UDF, owned kill-on-close Job Object.
- `qeZNRC` and `8WPypK` independently established actual restricted WebView2 browser and renderer children and JavaScript DOM title marker. The stronger `8WPypK` positive control made 15 TCP connections (13 IPv4, 2 IPv6) and three UDP datagrams; the restricted case delivered zero IPv4 TCP, zero IPv6 TCP and zero UDP to independently owned listeners. Observed children had the expected AppContainer SID, zero capability SIDs and Job Object membership. Process/profile/UDF cleanup was verified.
- Diagnostic case `0DLlFW` exposed real AppContainer UDF create/write/read/delete access failure (Win32 5). Minimal case-scoped ACL correction and removal of a WebView2 UDF environment override permitted later browser and renderer execution. The original undiagnosed exit `0x65` cannot be proven to have this exact sole root cause.
- `NSigC0` is an immutable first integrated-broker FAIL: public-policy token revalidation rejected the exact ephemeral loopback fixture with `nonstandard-port-denied`, returning synthetic HTTP 403 before native origin access. `Pending.policy` is now bound at preparation and verified at consumption; public and fixture tokens cannot be substituted.
- `XDArr0` is a second immutable integrated-broker FAIL: the policy check succeeded, but parent TF3 reported `network-failed` after a single TCP connection without a counted completed HTTP request. No root cause for this transient transport failure has been established. Preserve it as a failure, not a pass.
- **`PDfH29` and `HwpG23`: separate fresh integrated physical PASS cases.** Each reran the unconfined positive control and true restricted zero-direct-egress gate before the broker case; both reported `TF_BROWSER_ISOLATION_AND_BROKER_PASS`.

## Actual integrated broker proof

The `PDfH29/acceptance-verdict.json` native evidence reports nine scoped requests/responses and exact TF3 results:

| Class | Actual result |
| --- | --- |
| Document HTML | 200, 645 bytes, TF3 receipt and native script/title proof |
| CSS / JavaScript | 200, 32 / 123 bytes, synthetic response through WebView2 hook |
| Binary PNG | 200, 67 bytes, exact binary payload and SHA-256 verified |
| Iframe / fetch | 200, 35 / 15 bytes |
| Same-origin redirect | 200 final response, two DNS classification records and redirect chain |
| Redirect to metadata `169.254.169.254` | Synthetic 403, `dns-private-or-reserved-denied`, unsafe target classified not connected |
| Deliberately Public-policy denial | Synthetic 403, `nonstandard-port-denied`, no TF3 dispatch to controlled origin |

The origin listener counted exactly nine HTTP GETs: the seven successful resource requests plus the second allowed-redirect hop and the initial hop of the disallowed redirect. Neither the metadata destination nor the deliberate Public-policy denied path was requested by the parent TF3 transport. The restricted browser itself had no direct network authority. The parent owns the TF3 GET transport; WebView2 COM `WebResourceRequested` interception forwards bounded request descriptors over inherited narrow anonymous pipes, and produces synthetic responses without granting the browser networking capabilities. Session nonce, monotonic request ID, kind, byte hash and native TF3 receipt are included in acceptance evidence. The `PDfH29` job was empty after shutdown, its AppContainer profile was removed, and its unique UDF was cleaned.

## Limitations and gates not satisfied by these controlled cases

- The broker and host currently exist only behind the non-default `tf-browser-isolation-acceptance` Cargo feature and controlled exact-loopback fixture. These results **do not** show general external HTTPS browser browsing, arbitrary-origin credentials, cookies or persistent-session lifecycle acceptance.
- Current page fixture does not independently prove all unsupported URL classes, absent-interceptor paths, hostile crash/timeout, missing native reply, storage attacks or every hidden WebView2 network API under the brokered page. Standalone adversarial isolation fixture covers controlled JS attempts and observed TCP/UDP, but this is a tested-environment result, not a universal Windows platform certification.
- Cross-origin credential handling remains disabled in the acceptance broker. No raw credentials were sent to WebView2 JS. Complete credential-scope and redirect-forwarding negative tests remain required before credentials or production model tool exposure.
- Interactive observe/policy/act/verify operations, screenshots, forms, uploads, downloads, WebSocket and WebRTC networking, model-facing capabilities and user-browser profile sharing are **not** implemented or approved by this addendum.
- `XDArr0` shows an intermittent parent fixture transport failure between the first and two successful broker cases. Failure response remained closed (synthetic 403, no direct browser fallback), but root cause and broader robustness still require investigation.

Security verdicts are bounded to actual tested cases: **DIRECT_BROWSER_NETWORK_ISOLATION=PASS** and **TF3_BROWSER_BROKER=PASS for the controlled integrated GET fixture**, while **general broker/interaction production acceptance remains NOT PASSED**. Safe to expose interactive browser actions to production models: **NO**.
