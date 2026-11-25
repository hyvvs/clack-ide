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
