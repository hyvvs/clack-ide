# TF4 owned public HTTPS acceptance fixture — source, not deployment

This directory contains an independent **server-side** oracle for production
browser acceptance. It does **not** install, launch Clack, issue user consent,
or make source tests equivalent to installed acceptance. The server-side
append-and-fsync event ledger is **separate from any browser receipt** so it
can corroborate (but never itself manufacture) an original-node action.

## Isolated development verification (no public exposure)

`node --test scripts/tf4-public-https-fixture/server.test.mjs`

These tests listen on an ephemeral **127.0.0.1 HTTP** socket solely inside
Node's isolated test process. This socket is **not** admissible for production
TF3 Public, is never exposed publicly, and must not be treated as installed
browser acceptance. The six current isolated integration tests cover oracle
access and redaction; concurrent original form writes/replay denial; upload
size/replay/method limits; accepted-claim persistence across fixture restart;
client cancellation while the independent remote endpoint still observes a
request; and invalid origin/nonce configuration.

## Operator-owned deployment prerequisite

The operator must authorize a **separate, publicly routable and DNS-resolvable
owned FQDN**, ordinary CA-trusted HTTPS certificate/private key, and a public
**TCP port 443** listener. No tunnel, localhost/public DNS alias, insecure TLS,
private IP, 443 port forwarding from the development machine, or arbitrary
third-party effectful destination is acceptable. Provision a dedicated
non-privileged service account and persistent private state volume with
limited quotas/firewall rules; the operator—not this repository—owns DNS, TLS,
server access, costs, secrets and service lifecycle.

**One consolidated operator-facing request (not automatic deployment):**
Authorize two FQDNs the operator owns: primary
tf4-acceptance.<operator-domain> routed publicly on IPv4/IPv6 TCP **443**
with a publicly trusted, correctly named TLS certificate; and a distinct
tf4-negative.<operator-other-controlled-domain> or genuinely separately
owned origin solely to validate cross-origin denials. Both must resolve
outside private, loopback, link-local, metadata and internal-only networks.
No developer-machine tunnel, port-forward, insecure TLS trust flag or policy
exception is allowed. Provide private durable storage for the append-only
event ledger and one-use claims; run Node as a dedicated nonprivileged service
with limited filesystem privileges, restricted TLS key access and restart
without losing claims. Protect the read-only oracle with its separately
rotated bearer token and operator-only firewall/VPN access. The app, browser,
model and screenshots must NEVER see that observer token.

A starting resource budget of **1 vCPU, 1 GiB RAM and 1 GiB persistent disk**
is sufficient for planning this bounded test fixture; confirm with the
operator's hosting environment. Existing owned infrastructure may incur no
incremental charge; renting new compute, DNS, bandwidth, certificate or
storage may have provider-specific costs **not estimated or authorized here**.
Explicit operator approval is needed for DNS, TLS/private keys, external
network exposure, provider charges, service identity and retention policy.

**Operator deployment/teardown:** Authorize and configure both FQDNs and
public TLS443 reachability; create dedicated non-login service identity and
private persistent state directory (POSIX mode 0700 or equivalent Windows
ACL); install only pinned fixture source; supply deployment environment via
operator-controlled secrets; launch the service once; validate DNS/TLS and
read-only oracle separately from an observer machine; privately record
deployed commit, certificate fingerprint and nonce. To tear down, stop/reap
the service, remove inbound firewall allowances and owned test DNS routes,
revoke fixture synthetic credential/oracle secrets, archive or erase the
ledger and one-use claims per the authorized retention plan, release any
charged resources, and independently verify zero remaining listeners or
service-owned resources. No automatic provisioning/deployment is authorized.

On that separately authorized host, supply all environment variables:

```text
TF4_FIXTURE_BIND=<operator-approved-public-interface>
TF4_FIXTURE_PORT=443
TF4_FIXTURE_TLS_CERT=<absolute-path-to-normal-CA-trusted-fullchain.pem>
TF4_FIXTURE_TLS_KEY=<absolute-path-to-owned-private-key.pem>
TF4_FIXTURE_STATE=<absolute-private-persistent-directory>
TF4_FIXTURE_RUN_NONCE=<fresh-lowercase-16-to-64-char-nonce>
TF4_FIXTURE_ORACLE_TOKEN=<fresh-independent-64-character-hex-secret>
TF4_FIXTURE_SYNTHETIC_CREDENTIAL=<fresh-independent-24+-character-test-value>
TF4_FIXTURE_CROSS_ORIGIN=https://<separately-owned-public-negative-host>/
TF4_FIXTURE_PUBLIC_ORIGIN=https://<owned-public-fixture-fqdn>
```

Start once as the dedicated service account with:
`node scripts/tf4-public-https-fixture/server.mjs`. The script rejects
non-443 production port, missing TLS identity, missing secrets and invalid
run nonce. TLS certificate validation remains ordinary: never set
`NODE_TLS_REJECT_UNAUTHORIZED=0`.

**Important:** The oracle token must never be injected into the app,
browser, JavaScript document, model context or TF3 request. Keep it on the
operator's separate observer machine. Read only:
`node scripts/tf4-public-https-fixture/verify.mjs` with the oracle
token, public origin and run nonce present only in that observer process.
The output contains SHA-256 digests, event IDs, methods, paths, counts and
times, not uploaded bytes or credential values. Protect the observer HTTP
endpoint with separate network access controls in addition to its bearer
token, and rotate both per mission.

## Supported native acceptance fixtures

The root `/` has deterministic retained LINK, input, checkbox, select,
scroll region, POST form plus submitter, explicit replace-node button,
download, delayed navigation and redirect-negative links. The fixed
`/case/<nonce>/next` document exposes an independent navigation request.
The exact POST `/case/<nonce>/form` accepts only the byte sequence
`nonce=<nonce>&commit=once` with URL-encoded content type; one operation
per nonce is durably claimed with `create_new + fsync`. The separate binary
upload endpoint accepts at most 64 KiB and also denies replays. Any crash
after a claim but before a terminal response remains an **unknown outcome**:
never auto-retry. Requests and server receipts are logged independently,
without passwords, cookies or raw bodies. Redirects are negatives, not
authorization to follow or issue a second write.
The POSIX host also fsyncs the containing claims directory after creating a
claim. A failed ledger append after claim creation is still an uncertain
external outcome; do not retry to turn an unknown outcome into success.

The verifier deliberately reports
`nativeApprovalOrOriginalNodeCausalityProven: false`. Installed acceptance
requires matching these independent observations to the actual installed
Clack application's source-matched host, genuine consent, central one-use
grant, original DOM witness, native COM dispatch, and single canonical
terminal receipt. The private TF3 write engine has isolated HTTP source
coverage, but original successful-control/body capture and native original
FORM/submitter handoff are still missing, as are TF2 file-transfer and
installed-production acceptance. Never mark a production gate PASS based on
this fixture alone.
