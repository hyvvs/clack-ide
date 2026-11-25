# TF4 production JavaScript budget — measured optimization and unresolved decision

Date: 2026-11-25. Branch: `tf/browser-computer-use`, Draft PR #46.
Baseline source: `c3c3496d4fd60f19c62c0e4ca114c8d44d9908fa`.

## Governing measurement

No size-limit configuration or measurement implementation was changed. The
existing `@size-limit/file` check gzips each emitted `dist/assets/*.js` file
at level 9 and sums decimal bytes. Startup is the unchanged named subset in
`.size-limit.json`; it is not a substitute for total output.

| Production output | Baseline | React/Radix consolidation | Limit | Result |
| --- | ---: | ---: | ---: | --- |
| Startup JavaScript (gzip9 bytes) | 354,564 | 353,817 | 540,000 | PASS |
| All JavaScript (gzip9 bytes) | 1,885,314 | 1,883,704 | 1,500,000 | **FAIL, +383,704** |
| Emitted JavaScript chunks | 224 | 223 | — | — |

The retained source change in `vite.config.ts` maps Radix dependencies to
the React chunk. The previous **emitted** React chunk imported Radix
statically already, so this does not force new modules across a lazy-loading
boundary. It saves 1,610 total gzip bytes and 747 startup gzip bytes. The
exact official `npm run size` check still exits nonzero for total JavaScript.

The full 223-file ranked current-source inventory is retained in the
operator-owned, untracked `outputs/tf4-radix-chunk-rank.csv`. Its top ten are:

| Rank | Emitted family | Actual gzip9 bytes |
| ---: | --- | ---: |
| 1 | Streamdown | 134,717 |
| 2 | xterm | 134,365 |
| 3 | CSS language chunk **including shared CodeMirror/Lezer core** | 120,769 |
| 4 | AiMiniWindow application/UI | 116,351 |
| 5 | Merged React/Radix | 112,151 |
| 6 | Main application | 105,274 |
| 7 | Agent/tool runtime | 84,397 |
| 8 | File icon resolver and Catppuccin icon data | 71,945 |
| 9 | CodeMirror editor and Vim/merge features | 67,190 |
| 10 | Settings application | 66,117 |

Do not infer independent gzip contributions from the visualizer's summed
`nodeParts.gzipLength` attributions. The core CodeMirror library is part of
the large `cm-lang-css` chunk; that is not removable CSS-language overhead.

## Controlled production bundle experiments

All numbers below are independently calculated gzip9 sums of **emitted** JS
after a real Vite production build, not raw source/transformed sizes. A/B
configuration files and outputs are retained in untracked `outputs/`. The
baseline and retained builds used lockfile-pinned dependencies; the temporary
Terser installation was isolated and lockfile dependencies restored via
`npm ci` before the final official build.

| Experiment | Total gzip9 bytes | Finding |
| --- | ---: | --- |
| Baseline manual chunk layout | 1,885,314 | Fails budget |
| Remove manual chunk assignments | 1,893,700 | +8,386; discard |
| Attempt shared Lezer syntax chunk | 1,885,349 | +35; no useful consolidation, discard |
| Attempt shared Zod validation ownership | 1,885,349 | +35; no useful consolidation, discard |
| Merge React/Radix/xterm | 1,884,008 | -1,306, **reject** because xterm JS is reachable through a lazy terminal path |
| **Merge React/Radix only (retained)** | **1,883,704** | **-1,610**, no new eager dependency |
| Terser, two compression passes, retained React/Radix layout | 1,885,304 | +1,600 vs retained Oxc build; discard |

The earlier diagnostic recompression of all baseline JS as **one hypothetical
gzip stream** was 1,827,867 bytes. That is 57,447 bytes below the actual
baseline sum, but still 327,867 bytes over the ceiling. It is **not** a
proposal to flatten the application and is not a mathematical bound on all
possible equivalent code transformations.

## Actual blocker and safe next decision

The remaining **383,704-byte / 20.37%** reduction is not supplied by any
validated local chunking or minifier change. An emitted-code audit did not
find an entire duplicated provider transport, Lezer grammar set, React/Radix
runtime or icon dictionary that could be deduplicated for savings of that
order. Streamdown's streaming Markdown plus raw-HTML sanitization/hardening,
CodeMirror's languages/modes/Vim, xterm, and supported AI providers are
legitimate functional dependencies. Replacing or removing them without
security, rendering, accessibility and language parity is not acceptable.

This is a **technical and product-scope decision**, not a passed performance
gate. Completing the existing ceiling will require a substantially larger
sequence of validated, cross-dependency implementation changes (for example
equivalent smaller renderer/parser/editor/transport internals, with broad
cross-platform regressions and runtime performance comparison), not another
chunk-name adjustment. Approval for that substantial additional engineering
scope is needed before promising the budget can be closed. Do **not** change
either size limit, conceal bytes, disable React Compiler solely to obtain a
smaller report, discard supported functionality, or pass the gate by assertion.

## Installation, CI and release boundaries

The pre-existing human-only install request `ur_dx142s5vlq4m` was checked
once in this optimization batch and remained OPEN; the source-specific
`58e4b811` acceptance package and prior operator evidence remain preserved.
No source-matched installed application/host identities or genuine installed
central approvals, popup child creation, remote effects, physical lifecycle
cases 10–11, or seventeen-step integrated E2E were newly proven. No public
two-origin fixture was deployed without operator authorization.

At last inspection of old exact-head CI run `45555088123`, Linux Rust,
Windows Rust, all three WASI jobs and coverage had succeeded; frontend had
failed the total-JS size check despite passing functional tests; macOS Rust
remained in progress. These are prior-head results, **not** fresh CI evidence
for the optimization source. Do not cancel that useful running macOS job merely
to replace a status report.

Keep PR #46 **OPEN/DRAFT**, protected main unchanged, model-facing unaccepted
capabilities non-callable, canonical production gates **0 PASS / 5 PARTIAL /
8 BLOCKED**, lifecycle **9/11**, and the mandatory Product-wide UI/UX Polish
& Acceptance release blocker intact. Do not make a final-source Windows
acceptance package or a duplicate human install request until executable and
budget work genuinely reaches its required stage.

## Historical ceiling and independently reproduced source baselines

The exact `540 KB` startup and `1500 KB` total-output thresholds first appear
in the repository's **initial commit** `3d6a95e82d29ce764d57d78566a260a8751e4654`
on 2026-06-17 and remain byte-for-byte unchanged. The initial documentation
does **not** supply a separate empirical basis or original performance-study
justification for the 1,500,000-byte value. It was an early-project budget,
not a limit added to govern TF4 specifically.

These measurements are from **separately frozen `npm ci` installations** and
real `npm run build` (TypeScript + Vite) in isolated, detached source worktrees;
each build was checked with the unchanged official `npm run size`. Exact bytes
below were independently summed using Node gzip level 9 over each emitted
`dist/assets/*.js`, matching the official result. The source machine was
Windows 11 Pro build 26200, AMD Ryzen 9 9900X (12 cores/24 logical), 61.6 GiB
RAM, Node 22.20.0. The protected-main and current TF4 lockfiles are identical.
The initial lockfile differs from main **only** by addition of the Tauri
dialog-plugin dependency. All four builds use the same pinned Vite **8.0.16**,
React **19.2.7**, AI SDK **6.0.207**, and Streamdown **2.5.0** versions; the
June-November growth is therefore predominantly new merged application/feature
code, not a broad framework or provider dependency upgrade.

| Source / checkpoint | JS files | Startup bytes | Total JS bytes | Total against 1.5 MB |
| --- | ---: | ---: | ---: | --- |
| Initial `3d6a95e` (2026-06-17) | 135 | 344,616 | 1,422,193 | **PASS, 77,807 under** |
| Protected main `dddab1b9` (pre-TF4) | 223 | 354,541 | 1,891,004 | **FAIL, 391,004 over** |
| Functional TF4 `58e4b811` | 224 | 354,563 | 1,904,557 | **FAIL, 404,557 over** |
| Current optimized local `89c5e40` | 223 | 353,817 | 1,883,704 | **FAIL, 383,704 over** |

The **pre-TF4 inherited** June-to-November growth was **468,811 total gzip9
bytes** (+9,925 startup), versus only 77,807 bytes of initial total headroom.
The substantive TF4 functional commit added **13,553 total bytes** versus
protected main (+22 startup); all subsequent functional/CI and pricing/chunk
optimizations reduced the branch by **20,853 total bytes** from that point.
Net current TF4 versus protected main is therefore **-7,300 total bytes** and
**-724 startup bytes**. Do not label the current 383,704-byte deficit
"TF4-generated bundle growth"; protected main already failed that gate.

As a separate *emitted chunk-name-family* diagnostic (not a per-module gzip
decomposition), initial to protected-main editor chunks stayed at 387,075
bytes; xterm at 134,365; named AI providers/shared chunks changed by only
+105 bytes (185,611 to 185,716). Named main/settings/AiMiniWindow/tools
chunks grew from 189,424 to 375,520 (+186,096), while all other chunks outside
those and the named editor/terminal/Markdown/provider/React/icon groups rose
from 177,337 to 451,332 (+273,995). This strongly locates the increase in
accumulated application and feature chunks, rather than a new 385-kB TF4
editor or provider dependency. Chunk ownership and compression are not
module-additive; the groups are a *diagnostic classification*, not exact
per-feature causal attribution. The full source history includes hundreds of
merged product files and a changed initial dependency lockfile; exact
single-feature deltas would require separate per-commit builds.

Full independent evidence, including all emitted asset names, SHA-256, gzip9
bytes, source commit and lockfile digest for all four builds, is retained in
the operator-owned untracked `outputs/tf4-history-gzip9-20261125.json`.
The four worktrees were read-only as source checkouts; the comparison builds
only created their own ignored `node_modules` and `dist` output. Existing
stashes, protected main, human installation archives, original evidence and
unrelated untracked paths were not deleted or reset.

## Runtime and shipped-asset evidence — distinguish what was measured

The **current production Vite output**, excluding `logo.png`, totals 6,663,589
raw asset bytes: 6,270,225 JS, 202,924 CSS, 120,744 WOFF2 and 69,696 WOFF.
Their *separately gzipped* sum is 2,107,578 bytes, of which **only 1,883,704
JS bytes** count against the existing total-JS rule. Protected-main emitted
assets are 6,827,185 raw bytes / 2,114,878 separately gzipped, including
1,891,004 JS bytes. Current output also contains `logo.png` at 518,087 raw
bytes outside `dist/assets`. These are static build-artifact measurements,
**not cold-start times, renderer memory or user-response latency**.

The preserved, **older** `58e4b811` source-specific acceptance archive was
independently SHA-256-checked again: NSIS installer 12,331,176 bytes
(`c14879f5f22ac1a7b4fe6fe9f45b28961dae64709c7b641024ff89edc322df7c`),
NSIS-patched app 20,389,376 bytes
(`a89c5256d096dabacf9882d759c946cdde99ee5c3f27b2517f1584e720599a1c`),
**pinned bundled native host** 3,930,112 bytes
(`81cf3a67aeda153b7b1733aaf812f5f1a95f118196b5aa7276465490f5448b89`).
The distinct post-build release host in the archive is **not** the bundled
native host; consult `bundle-provenance.json`. No installer was launched.

The existing human installation request for that archive was checked once in
this historical study and remained **OPEN**. The older installed binaries are
source-mismatched. Therefore comparable **installed** cold/warm startup,
initial renderer RSS/commit, Chat, Editor, Terminal, Browser Operator Panel,
Settings activation, and interaction response latency have **not been
measured**: source-matched installed runtime plus operator permission and a
common measurement harness are absent. Do not invent, extrapolate, or
benchmark a generic Chromium/Vite page as a real Clack desktop session.
The low named startup *byte count* is encouraging but does not demonstrate
that all dormant chunks are absent from the real startup dependency graph,
nor does it prove startup latency or memory behavior.

## Bounded optimization result and explicit budget-decision alternatives

The requested bounded source/emitted dependency inspection, including a
second read-only application/SDK and Markdown/editor audit, found **no
additional safe >=5 kB production gzip saving** with tested feature/security
equivalence. The SDK's telemetry path is a possible future specialization only
with proof that no supported telemetry integration is callable; browser-panel
controls and diagnostics are actual product functionality. Streamdown is
single-instance, and raw-HTML image rewrite, sanitize, harden and URL transform
are distinct required defenses. CodeMirror grammars and chat highlighting are
already shared or independently required. No further source removal was made
merely to change a budget report.

**Decision A — retain 1.5 MB (strictest).** Require another **383,704-byte**
real gzip9 reduction before the frontend job can be green. This is a further
20.37% of current output, not a small cleanup, and likely requires separately
designed renderer/editor/provider changes with extensive security, language,
performance and platform parity review. Estimated schedule/cost is **unknown**;
do not assume feasibility or ship a weaker implementation. Release remains
blocked until an actual passing build.

**Decision B — separately authorize a major architecture-level performance
project.** First review a concrete design with a dependency-level before/after
size model, preserved API/format/streaming/HTML-safety behavior, startup
runtime profile, Windows WebView2/macOS WKWebView/Linux WebKitGTK compatibility,
and negative security tests; then approve implementation in stages. Do not
undertake a wholesale CodeMirror/xterm/Streamdown/provider SDK replacement
inside this bounded TF4 batch.

**Decision C — separately approve a calibrated desktop-product total budget.**
After the product/runtime review, a proposed **2,000,000-byte total gzip9**
ceiling would give current TF4 116,296 bytes of headroom (6.17% of its
measured output) and protected main 108,996 bytes (5.76%). **This is a
proposal, not an authorized or implemented change.** Keep the **540,000-byte
startup** ceiling unchanged; retain the exact `@size-limit/file` total
measurement over all emitted JS; introduce a separately reviewed per-PR
compressed-output growth trigger (suggested **+25,000 bytes** over an approved
artifact baseline), a locked dependency upgrade diff review, and a dashboard
for source-matched cold/warm startup, renderer memory and Chat/Editor/Terminal/
Browser Panel/Settings activation. Every change must preserve all supported
features, security gates and accessibility. Require source-identical Windows
packages, independent asset SHA-256s and at least 10 cold plus 10 warm runs
per candidate/baseline on the **same hardware and OS** before accepting any
claimed runtime parity; compare median and 95th percentile, and investigate
any >10% regression. Do not use an unmeasured performance claim to justify
changing CI.

**Recommended next decision:** review C **only once** source-matched installed
runtime benchmarks and owner approval exist; until then continue using the
original red 1.5-MB gate and Draft status. If preserving the initial absolute
ceiling is a non-negotiable product requirement, explicitly choose A/B and
fund the required larger optimization effort instead. A revised budget would
be a separate, auditable governance commit with prior/current artifacts, CI
growth controls and release sign-off — never a silent TF4 workaround.

None of A/B/C alone provides production browser acceptance: source-matched
installation, central human approvals, independent two-origin effects, positive
popup child creation, physical lifecycle cases 10–11, seventeen-step E2E and
final Product-wide UI/UX Polish & Acceptance remain mandatory blockers.
