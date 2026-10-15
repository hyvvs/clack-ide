# Real Local Model Product Acceptance

## Scope and Baseline

This acceptance starts at `b1263fe fix(ai): control Ollama runtime context`
on `main` (clean, 31 ahead / zero behind `origin/main`). It measures a real
`qwen38-uncensored:latest` run, not the earlier scripted-peer corpora.
No Computer Use, cloud inference, secondary-PC configuration changes, model
downloads, sampling changes, or push are authorized by this pass.

The inference destination is exactly `http://127.0.0.1:11435/api/chat` through
the existing SSH tunnel. The isolated saved Ollama profile requests 32768
tokens and one concurrent generation. Reasoning stays Automatic (no `think`
override), with the production default output limit of 2048. Fallback stays
Never. App data is separate from the user's Clack data.

## Reproduction and Evidence

`node scripts/check-real-local-product.mjs <phase> [attempt]` uses the existing
invisible native Wry host, persistent sessions, AgentRunBridge, production tools,
permissions, native HTTP, B1, compaction/retrieval and PeerTask ownership.
Phases are explicit: `preflight`, `mission-a`, `restart`, `resume-a`, `mission-b`, `offline`.
`system-preflight` verifies the discovered multiple-system transport boundary.
Existing phase results cannot be silently overwritten. An explicit numbered
attempt preserves previous evidence. The runner owns and stops only its child.

Scratch project: `C:/Users/Hayden/Documents/clack-qwen-live-acceptance`.
Initial listing contained only `.git`; `master` was unborn with no commits.
Codex created the directory and initialized Git, but seeded no source files.
Codex must not implement or repair ForgeBoard.

Ignored evidence directory: `src-tauri/target/real-qwen-product/`.
It retains isolated app data, native serialized request audits, timestamped
state/plan/capacity/response metrics, full phase reports and failure reports.
Request audits omit headers and credentials. Engine metrics omit the private
reasoning message. Original persisted conversation evidence remains available.

Mission A receives the full ForgeBoard objective once. A single correction is
sent after at least three successful file writes and a written page-size value
of 50 are observed. The normal cancellation path establishes that user-message
boundary; no implementation hints or repeated requirement reminders are sent.

## Preflight Findings

1. **TEST_HARNESS:** the initial observer attempted to wrap Tauri's read-only
   invocation function. It failed before preferences, inference or project
   changes. Request auditing now lives in the test-only native host; response
   channels are observed passively. The failed report is retained.
2. **CLACK_CONTEXT:** the fresh Git workspace was rejected by project evidence
   preparation because `rev-parse --verify HEAD` fails before the first commit.
   No model call or project write occurred. The narrow fix gives a verified
   missing symbolic branch reference an explicit `unborn` revision identity.
   Branch rename, first commit and detached HEAD still change identity; corrupt
   refs still fail closed. Three real-Git regression tests pass. The first
   sandboxed test attempt could not write temporary Git metadata; the same tests
   passed with the necessary filesystem permission.
3. After correction, production native preflight succeeded. The audited exact
   model request sent `options.num_ctx=32768`, `num_predict=2048`, no `think`
   override. B1 resolves `runtimeTarget=32768`, advertised maximum 262144.
   `/api/ps` confirmed context_length 32768, Q4_K_M, 27.3B, 15,083,199,528 VRAM
   bytes. One native inference destination, zero cloud destinations.
4. Engine-reported preflight timings: load 4.153 seconds, prompt evaluation
   5.885 seconds / 3254 tokens, generation 4.110 seconds / 40 tokens, total
   14.168 seconds. These are observations, not benchmark guarantees.

## Mission A

Initial preserved result: **MODEL-INCOMPLETE**, not complete. One inference
request took 233.594 seconds (prompt 5376 tokens / 9.358 seconds; generation
2048 tokens / 224.120 seconds). It ended with `done_reason=length`, only a
reasoning part (8422 characters), no answer and no tool call. D2's existing
minimum-answer-progress guard truthfully stopped with `Answer continuation
made insufficient progress`; there was no fabricated completion or effect.
The error presentation is generic and is a usability limitation. There is no
evidence that context loss, tool execution, compaction or transport caused this
stop: the complete initial task was in the exact native request.

Independent inspection: only `.git`, no commits on `master`, clean Git status.
Both `npm.cmd test` and `npm.cmd run build` actually failed ENOENT because
`package.json` does not exist. No product feature, persistence, SSE, frontend or
test/build success can be claimed. The 50-to-25 correction was NOT sent: the
required meaningful implementation boundary had not been reached.

The native host was restarted. Both original conversation histories and their
Agent/model/workspace profiles restored byte-equivalently after serialization.
Restart performed zero inference calls and zero tool-effect replay. No plan or
compaction had yet been produced, so those restore paths are NOT EXERCISED.
One ordinary same-conversation continuation is now being measured after restart,
without re-sending any requirement, code, correction or tuning change. Its
result will be preserved separately from the initial result above.

The first continuation attempt was **HARNESS-BLOCKED**, not evidence of model
forgetting: direct test sending skipped `prepareSessionChat`, the existing lazy
loader used before normal production chat sends. Its first serialized request
contained only the continuation, not the original objective. Seven completed
engine responses and repeated unsuccessful evidence/output lookups were
observed before the owned fixture was stopped. No project effects occurred.
That invalid run's reports, request logs and app data were preserved. Only the
test conversation was restored from its exact frozen Mission A snapshot using
the existing session persistence owner, then prepared through the production
loader. The corrected continuation request demonstrably contains the original
objective and constraints (four messages, exact model, 32K). No requirement was
invented or manually re-summarized for Qwen. This is a harness fix, not a new
memory design or a production context-loss claim.

The temporary exact-snapshot restoration hook was removed after that one
repair. The committed harness always resumes the current persisted transcript,
rejects a second initial mission in an existing conversation, and never sends
the deliberate correction again after it already appears in that transcript.

During the valid continuation, Qwen independently corrected its initial Unix
shell syntax after native PowerShell error output. This is model debugging
evidence, not evaluator assistance. The shell command's final exit status was
zero because its final `npm --version` succeeded; the earlier failures remained
visible in stderr.

Final Mission A result after that one valid continuation is still
**MODEL-INCOMPLETE under the unchanged production output allocation**. The
continuation completed four real requests and four tool calls (directory list,
background-process list, two foreground commands). Its last request again used
all 2048 output tokens on reasoning and stopped with the same minimum-progress
guard. No source write, plan, test, build, compaction or implementation occurred.
The model was not given another reminder or a larger budget to manufacture a
pass. This result does not establish what Qwen could do with different output
or thinking settings; those experiments are outside this checkpoint.

The corrected continuation received the original task and corrected shell
errors itself, but no implemented requirement can be graded PASS. Scorecard:
core objective, port 4317, page size, supersession, title max 120, debounce 750,
SSE, persistence, no-cloud product behavior, test/build obligation, unfinished
plan and failed-test continuity are all **NOT EXERCISED** as implementation
continuity. Input availability is proven, not achievement. The 50-to-25
correction remains NOT EXERCISED because the required progress never happened.
There is no evidence of premature success claims.

## Mission B

Initial result: **CLACK-BLOCKED**, with the missing Mission A foundation also
preventing feature acceptance. Mission A was graded and preserved before this
run. The real Architect PeerTask inspected the same workspace using directory
listing, four glob patterns, grep and one authorized evidence request. It
truthfully reported no package, source, frontend, tests or README, then produced
a contingent design rather than inventing existing code.

Four engine responses completed. The fourth produced substantial answer text,
hit the length cap and triggered actual D2 continuation. The fifth native HTTP
request failed with Ollama HTTP 500 / Jinja exception: `System message must be
at the beginning.` The captured wire has TWO leading system messages, not just
one: core instructions at index zero and the continuation instruction at index
one. The template permits only a single system message. This is
**CLACK_TRANSPORT**, not an OOM, engine outage or model coding failure.

The native adapter now combines all system inputs, in their original relative
order, into one leading system message. Non-system messages, tool call/result
identities, images, thinking, output/context limits and original persisted
transcripts remain unchanged. Five new tests cover both request modes,
transcript/tool identity, no invented system message, SDK generation, and the
actual D2 streaming continuation against a strict template. The focused native
Ollama / routing / continuation group passes 147 tests in four files.

The affected wire-format boundary was also verified against the REAL model:
`system-preflight-1.json` supplied two system inputs through the production
configured model, native transport and B1. The exact model returned `READY`;
the wire contains one leading system message and the loaded context remains
32768. This is real transport evidence, not proof that Mission B completed.
The original failed task/history were not overwritten or regraded. The team
feature run was not restarted to rebuild the absent ForgeBoard foundation.

Only the Architect worker actually ran. Researcher, Coder, Reviewer,
dependency-result transfer, review/correction, activity persistence and undo
remain **NOT EXERCISED**. The failed task is durable and distinguishable from
completion; no queued/running/waiting tasks remain. There is no reviewer finding
or immutable feature patch to claim.

The real recipient-sized handoff has a stable task/recipient identity and
digest, with zero project evidence sources (the project is absent). Initial
user/handoff content is 2009 characters. A parent-private canary is present in
the separate owner conversation and absent from ALL five worker requests.
There is no automatic copy of Mission A's private history or global search.
Capacity was one, with zero observed admission queue delay. Meaningful queued
worker retention is NOT EXERCISED; concurrent generations were not forced.

## Measurements

These are recorded observations, not hardware benchmarks. Duration includes
native startup/report overhead; noncontiguous phases must not be represented as
one uninterrupted mission. Invalid harness inference is excluded from product
grading, not hidden.

| Phase | Native attempts | Successful engine responses | Reported prompt/output tokens | Wall duration |
| --- | ---: | ---: | --- | ---: |
| Mission A initial | 1 | 1 | 5376 / 2048 | 240.60 s |
| Mission A valid continuation | 4 | 4 | 22973 / 2312 | 274.29 s |
| Mission B initial | 5 | 4, then HTTP 500 | 21898 / 3226 | 376.03 s |

The valid continuation reports 21638 cached prompt tokens and 258.849 seconds
of generation across four requests. Mission B reports 15083 cached prompt
tokens and 353.574 seconds of generation. Initial Mission A had no useful
answer/tool output. The first useful resumed workspace inspection arrived
about ten seconds after the valid continuation began. Exact per-tool execution
latency was not instrumented and is not claimed. Representative VRAM from
existing `/api/ps` metadata was 15,083,199,528 bytes; this is not a measured peak.

Representative actual-wire B1 receipts:

| Request | Core / Agent estimate | Schema estimate/count/bytes | History estimate | Ceiling / output reserve / margin |
| --- | --- | --- | --- | --- |
| Valid resumed Coder, first | 3001 / 442 | 7206 / 16 / 14724 | 5714 | 32768 / 2048 / 1645 |
| Architect, first | 3001 / 466 | 6409 / 12 / 13117 | 957 | 32768 / 2048 / 1092 |

All receipts fit; these are conservative B1 estimates, not Ollama token usage.
Core instruction text was not duplicated. No working-context ceiling increase,
sampling adjustment, thinking toggle or GPU/KV change was used to rescue a run.
No compaction/extraction occurred. The Architect's single scoped retrieval
explicitly reported missing project sources rather than fabricating evidence.

Across all phases there are 21 audited native inference attempts: 20 actual
HTTP requests (including seven invalid-harness requests and the template 500)
plus one native client-only rejected attempt. Every audited destination/model/
context matches the exact local endpoint/model/32768 contract. Cloud count: 0.
The original two failed preflights sent no inference. All observed `/api/ps`
loaded-context observations after successful load were 32768; there was no
continuous external allocation monitor, so stronger sampling precision is not
claimed.

## Independent Product Verification

Final ForgeBoard tree: `.git/` only. Branch `master`, unborn HEAD, clean status,
no committed source, no package scripts, runtime data, application or tests.
Independent `npm.cmd test` and `npm.cmd run build` failed ENOENT before Mission B
and again after it. Dependency installation, API validation, persistence across
backend restart, SSE, combined filtering, keyboard behavior, exact continuity
values, activity/undo, README and runtime ignore rules are NOT EXERCISED. Codex
did not add or fix project source to change this result.

Valid Mission A tool totals: four calls, two foreground commands, zero file
reads/writes and zero test commands. The first compound shell command contained
two PowerShell syntax/command errors in stderr even though its final command
succeeded. Qwen corrected the shell syntax independently. Mission B had seven
read/evidence calls, zero writes and zero verification commands. There were no
malformed or denied tool calls in these valid mission traces. Large file/output
handling, repeated unchanged file reads and completed-effect replay were not
meaningfully exercised. No structured todo plan was created in either mission.

## Recovery and Failure Simulation

The owned test-only native host rejected one inference invocation to simulate
connection unavailability. This was NOT a real engine shutdown, shared tunnel
interruption or mid-stream network test. Clack surfaced terminal
`native-transport` with its request identity; zero engine requests, cloud
fallback or file effects occurred in this phase. A subsequent ordinary native
preflight returned `READY`, proving reconnection without changing Ollama.

Two real native process restarts sent zero inference. The final restart
restored five test conversations with equal serialized histories and equal
Agent/model/workspace profiles, the unchanged failed PeerTask, and no orphan
workers. Plans were empty and compaction revisions absent, so nonempty plan /
compaction / completed-write replay recovery is NOT EXERCISED. The original
Mission A and Architect evidence survived the client failure and restart.

## Final Clack Verification

- Final frontend: **2688 tests passed, 196 files**, including five new native
  system-message regressions. Earlier 2683 baseline tests also passed before
  the later transport defect was discovered; the final rerun was necessary
  because production TypeScript changed.
- Focused frontend Ollama/D2: **147 passed, four files**.
- Focused Rust: **3 new real-Git tests**, plus **43 existing freshness/retrieval
  tests**. These overlap the full suite and are not extra full-suite tests.
- Full Rust: **652 passed** (599 library + 25 filesystem + 25 Git + 3 real-world).
- Final `npm.cmd run check-types`, lint, build, `cargo fmt --check`, strict
  all-target locked Clippy, locked Rust tests and `git diff --check` passed.
- Lint stays **71 warnings, two informational notices, zero errors**. Build
  retains four existing ineffective dynamic-import warnings and a plugin-time
  advisory. Sandbox-only Git/cache permission failures occurred before the
  corresponding successful appropriately permitted test runs.
- Windows invisible native/backend and real Ollama transport were exercised.
  Native GUI / Computer Use and Linux/macOS native verification were NOT
  performed. No claim about native window interaction follows from this pass.
- The final initial-mission replay guard was exercised with explicit attempt
  two: it correctly exited nonzero with `Mission A cannot be silently replayed`,
  zero inference and no source changes. This is an expected safety result, not
  another model mission. Final process inspection found no owned acceptance
  host or runner left alive.

## Remaining Evidence-Backed Usability Issues

1. Automatic reasoning plus the unchanged 2048-token output allocation failed
   twice before Coder implementation. This configuration is not a usable
   hands-off ForgeBoard coding result. It does not prove intrinsic model
   inability under other settings, and this pass intentionally did not tune it.
2. The known reasoning-only length stop appears as an unexpected generic AI
   failure. A specific explanation of exhausted output with no answer progress
   would be more actionable. Do not weaken continuation/replay safeguards.
3. `bash_run` executes native PowerShell on this host, but Qwen initially used
   Unix shell syntax. Making captured shell identity explicit is a concrete
   usability follow-up supported by the observed failed command.

The two confirmed production blockers found here (unborn Git identity and
multiple native system messages) are fixed and tested. No new memory store,
scheduler, cloud fallback, model router or intelligence checkpoint was started.
Protected delegation work, safety stashes and `autonomous_tracker/` were not
touched. No secondary-PC files/services/configuration were modified: only normal
Ollama metadata/inference/runtime loading occurred. No push was performed.
