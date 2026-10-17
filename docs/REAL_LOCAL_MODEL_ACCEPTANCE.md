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

## Fresh Single-Specification Run: 2026-10-16

This is a new experiment requested after `680acef`, not a regrading of either
earlier mission. The user requested one completely empty Git repository, one
substantial specification exactly once, and no memory babysitting.

- Scratch repository: `C:/Users/Hayden/Documents/forgeboard-qwen-20261016-01`.
  Initial tree: `.git/` only; unborn `main`, no source or initial commit.
- Independent app data/evidence:
  `src-tauri/target/real-qwen-product/forgeboard-20261016-01/`.
  Previous transcripts and reports are untouched.
- Exact model and endpoint remain `qwen38-uncensored:latest` and
  `http://127.0.0.1:11435/api/chat`. The model digest matches the earlier pass:
  `0e163794a8b9cdd6e234013b1a27d2e58f06f48d20413a0c2e3e370faaef5505`.
- Total working context is 32768. The output allowance and reserve were set to
  8192 before the mission, explicitly disclosed because the previous 2048-token
  setting repeatedly exhausted on reasoning. This is not an in-flight tuning
  change. Reasoning stays Automatic; no sampling overrides or cloud fallback.
- Initial readiness check failed ECONNREFUSED; no prompt was sent. The user
  restored the tunnel. Native preflight then succeeded: B1 ceiling 32768,
  outgoing `num_ctx=32768`, `num_predict=8192`, `/api/ps` loaded context 32768.
- Single-spec mode disables the old 50-to-25 correction and forbids the manual
  resume / peer-mission CLI phases. The single static product request retains
  page size 50, port 4317, title limit 120 and debounce 750 ms, together with the
  full project/task CRUD, validation, persistence, SSE, combined search/filter,
  accessibility, automated tests, production build and README requirements.
- The full mission request was sent once to one persistent Coder. No source
  was seeded, and Codex will not repair or finish ForgeBoard for Qwen. Only
  Clack's existing automatic continuations may proceed without user messages.

### Observed Result: Interrupted, Not Graded

The native acceptance host exited before reporting the first response's
completion: `Native host exited before report: 4294967295`. The attempt ran
from 12:09:05 to 12:18:25 Europe/Paris (560.351 seconds), well below its
90-minute harness bound. A later concurrent startup report attributes the exit
to stopping PID 5040 to clear a linker lock before recognizing it as this live
Mission A host. This is an attributed operator-interruption account, not a
process-termination record independently verified in the present audit. The
retained original failure JSON has no child PID, and no matching Windows crash
event was found. The precise exit cause therefore remains unconfirmed here.
Classification remains **TEST_HARNESS / INTERRUPTED / INCONCLUSIVE**, never a
model, engine, or Clack transport failure. The preserved request remains useful
for wire-configuration evidence; the response cannot be graded.

- The native request audit contains exactly one mission inference request,
  with one user message, the exact model, 16 tools, `num_ctx=32768`, and
  `num_predict=8192`. There is no outgoing `think` override. Cloud requests: 0.
- First response byte was observed at 12:09:19. No engine finish, usage total,
  completed assistant message, tool call/result, structured todo, memory
  revision, or automatic continuation was recorded before the host exited.
  Do not infer generated-token counts or a reasoning-exhaustion failure from
  this incomplete evidence.
- Independent read-only inspection confirms that the project remains `.git/`
  only, with zero commits and no source, tests, build, or README. ForgeBoard
  tests/build and functional acceptance cannot run because no app exists.
- The original specification remains persisted once. It was not resent, no
  manual Continue or correction was sent, and Codex made no project-source
  changes. Restarting this inference would be a separate experiment, not a
  transparent continuation of this recorded attempt.
- Legitimate concurrent Clack implementation/test edits appeared during the
  run. They were not reverted, staged, committed, or hot-reloaded into this
  run. The captured first wire request predates the new shell-context text.
  A separate acceptance host started after this attempt exited; it was not
  stopped or attributed to this experiment.

Classification: **TEST_HARNESS / INTERRUPTED / INCONCLUSIVE**. This is neither
a ForgeBoard success nor evidence that Qwen
intrinsically cannot implement it. The failure JSON, original request audit,
event log, preflight report, isolated session data, and empty scratch repository
are preserved at the paths above. No native GUI / Computer Use verification
was performed.

Before concurrent edits appeared, the harness configuration passed TypeScript,
Node syntax, focused fixture lint, and 110 focused tests in four files
(`contextBudgetProfile`, `ollamaModel`, `ollamaRouting`, `toolExposure`). The
single-spec manual-resume guard rejected a resume phase before inference, as
intended. These checks validate the harness changes, not ForgeBoard completion
or subsequent edits made by another actor. No full Clack suite rerun, commit,
or push is claimed for this experiment.

## Historical Pre-Pass Startup Usability Follow-up

This pre-existing concurrent report is preserved as historical evidence, not
as Experiment A executed by the current audit. These attempts preceded the
current pass and do not satisfy its one-fresh-experiment stability condition.
Its operator-stop attribution is not independently confirmed here. The current
audit's focused/full verification and no-inference stability result follow in
the separate checkpoint section below.

This follow-up starts from `680acef` and addresses only the two evidence-backed
startup problems above: reasoning-only output exhaustion and ambiguous native
shell identity. It does not redesign compaction, retrieval, memory, PeerTask,
scheduling, routing, or fallback. The historical Automatic/2048 Mission A
result remains **MODEL-INCOMPLETE** and is not overwritten by this section.

### Product Changes

Clack now recognizes a narrowly defined reasoning-only output exhaustion case
before D2 attempts an answer continuation. Classification requires all of the
following: provider finish `length`, reported output usage at least equal to the
captured request output allowance, actual reasoning output, no answer text, no
tool call in that segment, no prior assistant/tool progress after the latest
user message, and the first answer segment. Ordinary textual truncation,
post-tool summaries, effectful turns, later continuation segments, sub-limit
usage and missing usage evidence are not classified this way.

The user-facing terminal diagnosis is `Reasoning used the output allowance` and
states that the model spent the allowance before producing an answer/tool call.
It suggests an explicit retry with lower/no reasoning when supported or a
larger output allowance for that model profile. Clack does not automatically
retry, silently toggle reasoning, call this a context-size problem, or weaken
the existing continuation/replay/effect safeguards.

The native shell contract now comes from the same launcher used by shell tools.
On this Windows host it serializes as `Windows PowerShell (powershell.exe)` with
`PowerShell; not POSIX Bash`. WSL and local Unix fixtures expose POSIX `sh`.
The stable historical `bash_run` / `bash_background` tool IDs remain, but their
descriptions and the core environment contract explicitly say those IDs do not
imply Bash. The shell identity is injected into `<env>` before the first model
tool call.

### Controlled Experiment A — None / 2048

Experiment A kept the exact target model, local endpoint, 32768 runtime context,
2048 output allowance, fallback Never and zero cloud inference. Its only model
behavior change from the failed baseline was explicit reasoning `None`, which
serialized as native `think:false`. Single-spec mode prevented the old
correction and manual resume paths; no requirement reminder was sent.

The first two usable A attempts immediately crossed the original startup stall:

- `startup-a-none-2048-v3` produced useful answer text, inspected the empty
  workspace, and issued real tools instead of consuming 2048 reasoning tokens.
  Its first foreground command was `node -v; npm -v; git --version`, valid
  PowerShell syntax, and succeeded. A later `npm ping` command also succeeded.
  Both audited requests used `num_ctx=32768`, `num_predict=2048`, `think:false`;
  cloud inference count was zero.
- `startup-a-none-2048-v4` returned a 396-token first response with the explicit
  text that it would inspect the workspace and set up a plan, then performed a
  directory listing and created a structured nine-item todo covering scaffold,
  backend/SSE/persistence/validation, backend tests, React frontend, frontend
  tests, full tests, production build and README. Its first and pending second
  requests again audited 32768 / 2048 / `think:false`; cloud inference was zero.

The pre-pass report observed useful startup with None where its earlier
Automatic/2048 attempts exhausted on reasoning. This suggests a deployment-
specific reasoning/output-allocation problem, but interrupted attempts and
intervening Clack fixes are not a completed controlled causal comparison. This
does **not** establish that 2048 output is sufficient for a long coding session
or that reasoning should be disabled globally for other models.

Experiment A did not reach its first source write. The runs exposed two separate
Clack reasoning-evidence lifetime defects after useful startup had already
occurred. First, an explicit self-hosted reasoning capability used its 30-second
discovery expiry as an effective Agent lifetime; a later tool-loop request
failed with `Reasoning effort evidence changed or expired`. Second, after a
successful long response refreshed the same backend capability, admission
compared timestamped evidence records and rejected semantically identical fresh
evidence as `context-settings-changed`.

The narrow fix keeps the initial queue-time freshness check but renews an
explicit Ollama reasoning lease only after a successful response. Admission now
compares the current semantic reasoning contract (supported status, revision,
mapping and selected level) rather than evidence timestamps. Revoked, expired,
changed-configuration and changed-contract cases still fail closed. A regression
simulates a first successful explicit-None request at +20 seconds and a second
tool-loop request at +45 seconds; both preserve `think:false`, while the existing
first-request expiry/revocation/configuration tests continue to reject.

The final fresh `startup-a-none-2048-v5` retry did not provide a product result:
the invisible acceptance host disappeared after recording the first streamed
byte, before an engine finish or final report. No ForgeBoard file was written.
That attempt is classified **TEST_HARNESS/process-lifetime**, and no additional
live retries were used to manufacture a pass. Consequently the final semantic
reasoning-lifetime patch is covered by focused regression tests but is not
claimed as a completed live multi-step coding run in this checkpoint.

### Automatic / 8192 and Interpretation

The separate concurrent Automatic/8192 single-spec attempt above did send the
intended wire configuration (`num_ctx=32768`, `num_predict=8192`, no `think`
override). The concurrent report attributes its host exit to an evaluator
stopping it; the current audit cannot independently confirm that attribution.
It remains **TEST_HARNESS / INCONCLUSIVE**: do not claim that Automatic/
8192 either fixes or fails the startup problem. No 4096/6144/16384 tuning ladder
or sampling/context change was run.

The proposed guidance is model-profile-specific: when Automatic reasoning
repeatedly consumes a small
output allowance before any answer/tool call, surface the new diagnosis and
offer an explicit retry with None/lower reasoning first; alternatively let the
user increase that profile's output allowance. Do not globally disable reasoning
and do not globally raise output limits. Whether Automatic/8192 is preferable
for sustained work remains unknown.

No memory/context-loss defect appeared in these A attempts: the full original
ForgeBoard specification was present in the serialized request, no compaction
occurred, runtime context remained exactly 32768 in every completed audit, and
the failures occurred at reasoning-evidence or harness boundaries. No page-size
50-to-25 correction was sent, no requirement was re-sent, and Codex/evaluator
code wrote no ForgeBoard source. The scratch acceptance repository remains
`.git/` only. The remote Ollama observed during this follow-up reported version
0.40.4; its listener, service, firewall and model definitions were not changed.

## Local-Agent Startup Guidance Checkpoint: 2026-10-16

Continued the existing uncommitted changes on `680acef`. No memory, retrieval,
project knowledge, PeerTask, scheduler, context-budget, or effect/replay
architecture was replaced.

### Guidance and Native Shell Contract

- A confirmed length finish with reported output usage consuming the configured
  allowance, observed reasoning, and no answer/tool progress now produces
  terminal `reasoning-output-exhausted` guidance. It recommends an explicit
  retry with lower/no reasoning when supported, or increasing the profile's
  output allowance. It does not diagnose a context-window problem, retry,
  change settings, or relax continuation/effect guards.
- The audit tightened the existing draft's false-positive boundaries: even a
  short visible answer is not reasoning-only exhaustion; earlier answer
  segments, current-turn assistant text, and tool calls/results exclude the
  startup diagnosis. Missing usage and usage below the allowance are not proof
  of exhaustion. SDK stream-error normalization retains the terminal guidance.
- `shell_identity` reports the launcher-selected Windows PowerShell/PowerShell
  or cmd executable, local Unix `/bin/sh`, or WSL `/bin/sh`, plus syntax. The
  captured session's workspace environment determines the native identity;
  the outgoing `<env>` includes it before tool use. Core/lite prompts and
  shell-tool descriptions explicitly say the historical `bash_run` ID does
  not imply Bash. No shell implementation or workspace authorization changed.
- Preserved the existing explicit-reasoning lifetime correction: a successful
  Ollama response can renew the captured control deadline for the same tool
  loop. Fresh compatible capability evidence is compared semantically, not by
  observation timestamps. Expired admission and changed/unsupported controls
  still refuse to send; B1 still checks the actual outgoing request. No
  Automatic-to-None substitution occurs.

### Native Host Investigation

The original Automatic/8192 attempt remains **TEST_HARNESS / INTERRUPTED /
INCONCLUSIVE**. Its specification was not replayed or resent.

- The direct Node runner has a 90-minute report deadline. Its five-minute
  Cargo-build deadline ends before the native host starts. This live path does
  not run through Vitest, its test timeout, or Playwright. The native example's
  explicit exit command uses status 0, not the observed 4294967295. Cleanup
  targets only its owned child PID and occurs after the report/error decision.
  None of these establishes the cause of the earlier exit.
- Added a separate `stability` phase: eleven minutes of native IPC heartbeats
  every 30 seconds, with no model prompt/inference. The runner now records host
  PID, runner PID, deadline, and unexpected exit code/signal/time. This is test
  instrumentation, not a model retry or product runtime change.
- Evidence: `src-tauri/target/real-qwen-product/startup-harness-20261016-01/`.
  The host started at 12:39:36 Europe/Paris and exited at 12:40:53, after
  78.718 seconds of runner time. Three IPC heartbeats succeeded (0, 30, 60
  seconds); exit code 4294967295, signal null. No inference audit file was
  produced and native logs were empty. A narrowly filtered Windows Application
  Error / Windows Error Reporting lookup again found zero matching events.
- A separate `startup-a-none-2048-v5/preflight-1.failure.json` records a linker
  lock on the same shared native example during this heartbeat check. Its next
  preflight starts shortly after this host exits. This establishes concurrent
  use of the shared build target, not who or what terminated this child. No
  process was killed by the present audit to clear a build lock.
- The abrupt native-host exit is reproducible without Ollama inference or
  ForgeBoard work, and is not tied to a nine-minute timeout. Its underlying
  OS/process/lifecycle cause is still **unconfirmed**. No claim of an OOM,
  external kill, native crash, or fixed root cause is supported by this evidence.
- The harness did not pass its stability gate. **Experiment A was not run in
  this pass.** No fresh ForgeBoard specification, reminder, manual Continue,
  correction, model tuning, Automatic/8192 rerun, or cloud inference was sent.
  Existing earlier `startup-a-none-2048*` evidence directories were not replayed
  or counted as this pass's experiment. Ollama/tunnel bindings, firewall, and
  secondary-host configuration were not changed.

Historical scope: the preceding "no Automatic/8192 rerun" statement describes
only the guidance-checkpoint pass. It is not the latest acceptance state. The
subsequent isolated Automatic/8192 run documented below passed stability and
reached the production overall deadline; it supersedes the harness-blocked
state for that configuration. The earlier interrupted attempts remain separate.

### Verification

Focused frontend: **150 tests passed in five files** (`answerContinuation`,
`errors`, `contextPreflight.integration`, `ollamaRouting`, `reasoningEffort`).
This includes positive exhaustion, short/ordinary/prior answer negatives,
tool/effect-progress negative, usage-evidence negatives, terminal SDK errors,
Windows/Unix/WSL shell serialization/contracts, explicit `think:false`, renewed
tool-loop control, expired admission, and changed-control denial. Native:
**two Windows-host tests passed** (actual local launcher identity/JSON and WSL
identity/JSON). These are not a WSL command-execution or Linux/macOS native run.

The initial sandboxed focused test launch failed on Vitest cache rename EPERM
before running any tests; the permitted focused run passed. Nine additional
`streamRecovery.integration` tests passed after adding the new native identity
command to their strict IPC fixture; recovery/no-replay assertions are unchanged.
Combined focused frontend coverage: **159 passing tests in six files**.

Final gates:

- `npm.cmd run check-types`: passed. The initial pass exposed two test-only
  uses of newer JavaScript APIs; they were corrected to the existing target.
- `npm.cmd run lint`: passed at the existing baseline, **71 warnings, two
  informational notices, zero errors**. New instrumentation lint diagnostics
  were corrected; no unrelated warning cleanup was performed.
- `npm.cmd test`: **2706 passed in 196 files**. The first full run exposed the
  nine strict recovery-fixture IPC failures above. Only that fixture was
  corrected, its focused tests passed, and the failed full gate was rerun.
- `npm.cmd run build`: passed, including TypeScript. The four existing
  ineffective dynamic-import warnings and plugin-time advisory remain.
- `cargo fmt --check`: passed.
- `cargo clippy --all-targets --locked --target-dir target/codex-test -- -D warnings`:
  passed.
- `cargo test --locked --target-dir target/codex-test`: **654 passed** (601
  library, 25 filesystem, 25 Git, three real-world integration tests).
- `node --check scripts/check-real-local-product.mjs` and `git diff --check`:
  passed.

Native GUI / Computer Use and Linux/macOS native verification were not
performed. The Windows invisible-host stability check failed as documented;
it is not a GUI or model acceptance pass. Production guidance implementation
and automated gates are complete; live ForgeBoard acceptance remains deferred
until the native-host interruption is understood or an adequate stability gate
passes. No ForgeBoard implementation, checkpoint beyond this scope, or push.

## Fresh Isolated Automatic / 8192 Acceptance: 2026-10-16

This follow-up used the committed, clean `main` state at `9e8f7ae` and was run
only after process inspection found no active Clack acceptance host, Cargo/Rust
build, Vite test run, or other Clack harness. No source edit or test suite ran
concurrently with the experiment.

### Stability gate passed

- A new Git-only scratch workspace was created at
  `C:/Users/Hayden/Documents/forgeboard-qwen-20261016-02`. It remained unborn
  and contained only `.git/` throughout the stability phase.
- Evidence is preserved under
  `src-tauri/target/real-qwen-product/startup-harness-20261016-02/`.
- `stability-1` completed all 23 native IPC heartbeats at 30-second intervals,
  spanning 660.182 seconds, with exit code 0 and zero inference destinations.
  This passed well beyond the earlier approximately 79-second host exit and
  satisfied the documented no-inference stability gate.

### Automatic / 8192 preflight

- Fresh run evidence is preserved under
  `src-tauri/target/real-qwen-product/forgeboard-20261016-02/`.
- Native preflight completed successfully against the same
  `qwen38-uncensored:latest` digest
  `0e163794a8b9cdd6e234013b1a27d2e58f06f48d20413a0c2e3e370faaef5505`.
- The audited preflight request used `num_ctx=32768`, `num_predict=8192`, an
  8192 output reserve, and no outgoing `think` field, preserving Automatic
  reasoning. `/api/ps` reported loaded context 32768. There was one local
  Ollama inference destination and zero cloud inference.

### Single-specification result: product deadline, incomplete

The full ForgeBoard specification was then sent exactly once in single-spec
mode. No correction, manual Continue, requirement reminder, peer mission, or
in-flight setting change was sent.

- The audited mission contains exactly one inference request, one user message,
  `num_ctx=32768`, `num_predict=8192`, 16 exposed tools, and no outgoing
  `think` field. Cloud inference count is zero.
- The native host remained alive and produced a normal final acceptance report.
  First response output arrived about 9.4 seconds after the request began, so
  this result is not the earlier native-host/process-lifetime failure.
- The only assistant content was a streaming reasoning part. It accumulated
  19,202 characters of preserved reasoning text describing requirements and a
  prospective implementation plan, but no answer text, tool call, structured
  todo, file write, test execution, commit, or automatic continuation occurred.
- At 600.662 seconds of mission-run time, the native inference transport ended
  the request with `overall-deadline`: `The inference request exceeded its
  overall deadline.` The native self-hosted transport has a fixed 600-second
  overall request deadline. No engine-finish event or provider token-usage
  total was received, so generated-token count and intrinsic model finish cause
  must not be inferred from the partial stream.
- The scratch repository remained `.git/` only and unborn after the run. There
  is no ForgeBoard implementation to test or build.

Classification: **PRODUCT RUNTIME / OVERALL DEADLINE / INCOMPLETE**. The fresh
stability evidence removes the prior harness-interruption blocker for this run,
but Automatic/8192 still did not reach a usable coding action under the current
production 600-second request deadline. This does not prove that the model could
never finish with a different reasoning choice, output allocation, or request
deadline. None of those controls was changed here, because doing so would be a
separate experiment rather than a continuation of this controlled run.

## Controlled Experiment A: None / 2048, 2026-10-16

### Isolation and Ownership

Continued from `9e8f7ae` on `main`. At the start only this acceptance document
was modified, including the valid isolated Automatic/8192 report above. That
report and its primary JSON were inspected before this experiment. Automatic/
8192 was **not** rerun in this pass.

- Process inspections at 14:04:39 and immediately before mission launch at
  14:06:58 Europe/Paris found zero Clack acceptance hosts, Clack processes,
  Cargo/rustc/rustdoc processes, or matching Clack/Vite/Vitest/acceptance Node
  processes. No other editing, test suite, or build was started during the run;
  only the owned harness's normal native-example preparation ran.
- Fresh empty repository:
  `C:/Users/Hayden/Documents/forgeboard-qwen-none-20261016-01`.
  Created once as unborn `main`, with `.git/` only and no seeded source.
- Fresh run ID: `forgeboard-none-20261016-01`. Evidence directory:
  `src-tauri/target/real-qwen-product/forgeboard-none-20261016-01/`.
  Primary files: `preflight-1.json`, `mission-a-1.json`,
  `mission-a-1.requests.jsonl`, `mission-a-1.jsonl`, and isolated `data/`.
- The existing separate READY-only preflight initialized the fresh profile and
  confirmed readiness. It did not contain ForgeBoard. The full 2086-character
  ForgeBoard specification was then submitted exactly once to `real-mission-a`.
  Its serialized specification matches the valid Automatic run byte for byte
  after the workspace environment block; the durable transcript has one user
  message. Later tool-loop wire history naturally retains that same message;
  it was not resubmitted as another user instruction.
- No reminder, manual Continue, correction, requirement resend, peer mission,
  runtime setting change, or evaluator implementation occurred.

### Serialized Controls

Both actual mission requests use exactly:

```json
{
  "model": "qwen38-uncensored:latest",
  "options": { "num_ctx": 32768, "num_predict": 2048 },
  "think": false
}
```

Destination: `http://127.0.0.1:11435/api/chat`, through the existing tunnel.
Initial/final loaded model digest remained
`0e163794a8b9cdd6e234013b1a27d2e58f06f48d20413a0c2e3e370faaef5505`;
final loaded context was 32768. Captured reasoning choice was `none`, with
supported `ollama-boolean` mapping; it was not an automatic fallback. The
output allowance/reserve were 2048, B1 ceiling 32768, and both serialized
requests fit B1. The production 600-second overall request deadline was
unchanged. Fallback remained effectively Never (no fallback authorization or
destination configured); all two mission destinations were the local Ollama
endpoint, and cloud inference was zero.

The normal production selector exposed the same 16 tools as the valid Automatic
first request: `read_file`, `list_directory`, `create_directory`, `edit`,
`multi_edit`, `grep`, `glob`, `bash_run`, `bash_list`, `open_preview`,
`todo_write`, `read_agent_output`, `communicate_peer_task`, `request_peer_task`,
`cancel_peer_task`, `propose_custom_tool`. No evaluator-added tool or tool bypass
was used. The captured native shell was `PowerShell (pwsh.exe)`, syntax
`PowerShell; not POSIX Bash`. The earlier valid Automatic run advertised
`Windows PowerShell (powershell.exe)`, with the same PowerShell syntax. This
environment detail is retained explicitly; neither shell selection was changed
mid-run, and this attempt never reached a shell command.

### Chronology and Complete Effects

Times below use the evaluator's local event timestamps, Europe/Paris, not the
remote engine's `created_at` clock. Relative time starts at the mission's
14:07:10.489 run start.

| Time / Elapsed | Observed Evidence |
| --- | --- |
| 14:07:10.896 / +0.407s | First serialized native request, with the controls above. |
| 14:07:20.678 / +10.189s | First response bytes observed. This is a stream timing marker, not a token-count estimate. |
| 14:07:27.327 / +16.838s | First engine response completed normally: `done_reason=stop`, `eval_count=63`. Public answer: "I'll start by inspecting the workspace and planning the build." No reasoning part was recorded. |
| By 14:07:27.681 / +17.192s | Successful `list_directory` result was included in request two: exact fresh workspace path, `entries: []`. Thus useful public answer and completed tool work are independently confirmed by 17.2 seconds; the exact first streamed public-character timestamp was not separately instrumented. |
| 14:08:24.743 / +74.254s | Second response completed normally: `done_reason=stop`, `eval_count=522`. It called `todo_write` with nine structured items. |
| 14:08:25.323 / +74.834s | Clack ended the run with a terminal reasoning-evidence error before a third native request. |
| 14:08:27.702 | Harness persisted its final report and exited successfully. Its `ok:true` means reporting succeeded, not that ForgeBoard was completed. |

Exactly two tools executed:

1. `list_directory`: read the fresh repository; returned an empty visible tree.
2. `todo_write`: persisted a nine-item plan, returned `ok:true`, count 9. It
   covered scaffold, backend/validation/SSE/JSON persistence/filtering/search,
   backend tests/debugging, frontend/debounce, frontend tests/debugging,
   production build, and README. Initially scaffold was in progress and eight
   items pending. Clack's terminal failure handling subsequently marked all
   nine failed; no item was completed. Exact inputs/results and stable tool IDs
   remain in the final transcript and request audit.

No shell command was issued, so first-command syntax correctness is **not
tested**, not passed. No source file/directory was written, test/install/build
command executed, server launched, or Git commit made by Qwen. Independent Git
and disk inspection after the run confirms `.git/` only, zero commits, and no
app to test or build. The plan is a Clack state effect, not implemented software.
Production run-budget and answer continuations were both zero. There was no
compaction/memory revision, missing-evidence recovery, or requirement reminder.

### Final Boundary and Classification

Clack's exact terminal message was:

```text
The AI run failed for an unexpected reason. Reasoning effort evidence changed or expired. Start a new request.
```

The retained run is `failed`, terminal/non-retryable, two completed steps, last
finish `tool-calls`. Both native requests settled `completed` with real engine
finish/usage, and neither reached the 600-second deadline or output limit. The
recorded reasoning capability deadline was 14:07:40.264, while request two took
56.671 seconds and finished at 14:08:24.743. The saved endpoint evidence still
reports thinking support for the same exact model/configuration.

This exposes a remaining Clack explicit-reasoning evidence/lease-lifetime
defect after successful startup: a later tool-loop step is refused by the
reasoning-evidence guard. `effortProviderOptions` enforces the expiry;
`observeOllamaRuntime` attempts renewal only after identity validation and
swallows optional observation failures. These are follow-up inspection points,
not a repaired or fully traced renewal race in this pass. No third inference
was sent and no production source, expiry policy, or deadline was changed to
continue. The acceptance run was left stopped, without replay or retry.

Classification: **PRODUCT RUNTIME / REASONING-EVIDENCE EXPIRY / INCOMPLETE**.
Startup is useful; end-to-end product acceptance is blocked by Clack's later
policy/runtime error. This is not MODEL failure, reasoning-only output
exhaustion, a context-window block, an overall transport deadline, or a native
host interruption. ForgeBoard did not reach a materially working implementation.

### Comparison and Repository State

Against the valid isolated Automatic/8192 result (19,202 preserved reasoning
characters, no useful answer/tool work before the 600.662-second overall
deadline), None/2048 produced a public answer and successful tools by 17.2
seconds. **Reasoning mode is the dominant observed startup bottleneck for this
model under the current production controls.** This does not prove the model
can complete ForgeBoard: the separate later reasoning-evidence runtime defect
prevented the coding phase. The Automatic run still has no final provider usage
total; no generated-token count is inferred for it. The None run's 63 and 522
output counts are actual engine-reported values, not estimates.

Content and timestamp fingerprints of all 930 tracked source/configuration
files matched before/after the experiment. Source content aggregate SHA-256:
`C72702245B61AD0FCD40D6671A1263083D86A3B0A9D8F741E5F173005FC00DDA`.
No Clack source or configuration file changed. A 14:11:17 post-run process
inspection found zero matching acceptance/build/test/Clack processes left.
Only this report changed, preserving its pre-existing Automatic/8192 section.
HEAD remains `9e8f7ae`; no commit or push was performed. No full Clack suite was
rerun for this documentation-only pass, and no native GUI/Computer Use or
Linux/macOS verification was claimed.

## Reasoning Evidence Lifecycle Fix and One Fresh Rerun, 2026-10-16

This checkpoint began at `9e8f7ae` on `main`, 33 commits ahead of the locally
recorded `origin/main`, with only this report modified. Its existing changes
were preserved. All historical grades above remain unchanged, including
Automatic/2048 **MODEL-INCOMPLETE**, the original interrupted Automatic/8192
**TEST_HARNESS / INTERRUPTED / INCONCLUSIVE**, the later isolated Automatic/8192
**PRODUCT RUNTIME / OVERALL DEADLINE / INCOMPLETE**, and the first None/2048
**PRODUCT RUNTIME / REASONING-EVIDENCE EXPIRY / INCOMPLETE**. The valid isolated
Automatic/8192 result, not the earlier harness interruption, remains the
comparison baseline. No Automatic/8192 experiment was repeated here.

### Proven Owner and Correction

`effortCapability` accepts only exact, revision/deployment-scoped backend
evidence younger than 30 seconds. `effortProviderOptions` also rejects an
expired captured capability. Previously `requestPreflight` serialized that
capture before refreshing metadata. Its optional post-response
`observeOllamaRuntime` called `checkIdentity` before renewing the local deadline;
that identity check also required fresh capability evidence. Once evidence
aged out, the check failed, optional observation swallowed the error, and the
next step could not renew. Merely extending a local deadline after a successful
response was neither reliable nor fresh proof of the reasoning contract.
The first None run's 56.671-second response crossed the captured expiry before
its later tool-loop step, without a model/configuration change.

The shared `requestPreflight` owner now distinguishes material identity from
freshness. It clones the captured reasoning choice, checks current native
endpoint/profile identity, and reads the existing native evidence. Stale,
unknown, or nearly expiring explicit controls use the existing bounded
`self_hosted_probe` metadata refresh for the same endpoint and exact model
(`force:true`, `restart:false`). Only the same supported contract, revision,
mapping and complete choice set can rebind fresh evidence for serialization.
The original run capture is not mutated or silently recaptured. None remains
`think:false` for the Boolean Ollama contract.

The new reasoning validation wait is bounded to 3000 ms, within native
admission's five-second acknowledgement budget. It also runs after queue
waiting, immediately before approval. Existing native five-second route and
20-second handshake limits, native cache/single-flight ownership, and 30-second
evidence TTL remain unchanged. Failed refresh attempts retain the existing
30-second retry throttle; no late completion authorizes inference. Cached-only
paths do not force metadata HTTP. No inference, warm-up, hidden reasoning
prompt, automatic retry, or token spend is added by capability revalidation.

Changed material settings still stop before the next inference. Changed
reasoning contracts stop with `reasoning-evidence-changed`; unavailable fresh
proof stops with `reasoning-evidence-unavailable`. Both are terminal,
non-retrying **Reasoning controls** errors, not a context-window diagnosis.
Static/cloud mappings retain their existing behavior. Compatible, LM Studio,
vLLM and MLX controls use the shared contract lifecycle without Ollama fields.
D2's single-leading-system serialization, captured selection, no-replay/effect
guards and B1 checks are preserved. No Rust, memory, retrieval, project memory,
PeerTask, scheduler, shell-identity, tool-selection or deadline code changed.

### Fresh Run Isolation and Controls

- Fresh empty Git repository:
  `C:/Users/Hayden/Documents/forgeboard-qwen-none-20261016-02`.
  It began as unborn `main`, `.git/` only; no evaluator source was seeded.
- Fresh run/evidence ID: `forgeboard-none-20261016-02`.
  Evidence directory:
  `src-tauri/target/real-qwen-product/forgeboard-none-20261016-02/`.
  `preflight-1.json` is the separate existing READY-only readiness check;
  `mission-a-1.json`, `mission-a-1.requests.jsonl`, `mission-a-1.jsonl` and
  isolated `data/` contain the mission, actual native wire audit, timeline,
  persisted transcript, plan and settings.
- Pre-launch process inspection found no competing Clack acceptance host,
  Clack process, Cargo/Rust build, or matching Clack/Vite/Vitest/acceptance
  Node process. No source edits, builds or tests ran during the mission.
  The owned runner/native host exited normally; the post-run process check
  found no matching Clack/acceptance/build/test process left.
- All 13 actual mission requests used `qwen38-uncensored:latest`,
  `options.num_ctx=32768`, `options.num_predict=2048`, `think:false`, the same
  16 normal production-selected tools, and
  `http://127.0.0.1:11435/api/chat`. All serialized bodies fit B1.
  Fallback remained effectively Never; cloud inference was **0**.
- The captured native shell was `PowerShell (pwsh.exe)`, syntax
  `PowerShell; not POSIX Bash`. Model digest remained
  `0e163794a8b9cdd6e234013b1a27d2e58f06f48d20413a0c2e3e370faaef5505`;
  initial/final loaded context was 32768. The 600-second overall request
  deadline and existing 60-second self-hosted stream-idle timeout were not
  changed. No temperature/model/output/context tuning occurred.
- The full 2086-character ForgeBoard specification was submitted exactly once,
  matching the preceding None attempt after its workspace environment block.
  There is one durable user message, retained as history in subsequent requests.
  No reminder, correction, requirement resend, manual Continue, delegation,
  mid-run setting change or evaluator implementation occurred.

The pre/post-run fingerprints of all 930 tracked source/configuration files
matched in both content and timestamps. Content aggregate SHA-256:
`5F55EE276811E99D8C0C7DDC83B33945471A86C89FF69410A5B464A9D339E354`.
Timestamp aggregate:
`1A92380CF084D98F828AD3AC40D68FCAE940300CA5A04C7BC5FE40EEBD71D196`.
This covers the tested production fix; only a test fixture was subsequently
updated in response to final-suite assertions, not production source.

### Chronology and Every Tool Effect

Times are relative to the persisted mission start, 15:37:43.069 Europe/Paris.
Tool times below are persisted input/output receipts, not guessed token timing.
First native request was at +0.403s; first response bytes at +10.290s. Public
text was confirmed by the first normal engine finish at +21.141s. Its text-start
receipt is at +10.292s; exact first nonempty-character time was not separately
instrumented. There were 296 public answer characters and no reasoning part.

| Call | Completed At | Tool / Actual Result |
| --- | --- | --- |
| 1 | +21.230s | `list_directory` root: empty visible tree. |
| 2 | +22.157s | `bash_run`: `node -v; npm -v; git --version`, exit 0; Node 22.20.0, npm 10.9.3, Git 2.53.0.windows.2. Started at +21.227s; valid advertised PowerShell syntax. |
| 3 | +61.344s | `todo_write`: nine-item plan, `ok:true`, all pending. |
| 4 | +98.023s | `todo_write`: scaffold in progress, eight pending, `ok:true`. This is beyond the previous approximately 75-second blocker. |
| 5 | +103.378s | `bash_run`: `npm config get registry`, exit 0, npm registry URL returned. No install was attempted. |
| 6 | +110.021s | `read_file` on root directory: OS access-denied error, no content read. |
| 7 | +116.591s | `list_directory` root: still empty. |
| 8 | +123.690s | `read_file server/src/db.ts`: missing path. |
| 9 | +131.537s | `bash_run`: `Test-Path` on the exact workspace, exit 0, `True`. |
| 10 | +161.860s | `edit` on root directory with imagined package content: refused by read-before-edit invariant. |
| 11 | +161.862s | `edit .gitignore`: refused by read-before-edit invariant. |
| 12 | +169.932s | `bash_run`: PowerShell `mkdir` comma-array of server/client directories, exit 0; ten directories actually created. |
| 13 | +221.212s | `edit package.json` with imagined old content: refused by read-before-edit invariant. |
| 14 | +221.212s | `edit .gitignore`: refused by read-before-edit invariant. |
| 15 | +235.103s | `read_file package.json`: missing file. |
| 16 | +235.103s | `read_file .gitignore`: missing file. |

The successful directory command was:

```powershell
mkdir server, server/src, server/src/routes, server/src/lib, server/test, client, client/src, client/src/components, client/src/lib, client/test
```

No POSIX-only shell syntax was attempted. Four shell calls returned exit 0.
Four reads and four edits returned explicit errors; none produced a file.
The two list calls and two plan updates succeeded. Independent disk/Git
inspection confirms ten empty directories, **zero source/root files**, unborn
`main`, zero commits. No install, test, production build, server launch or
materially working ForgeBoard implementation occurred. No first source-write
timestamp exists. The native shell guidance is verified for these commands,
not for a full coding workflow. Tool names, IDs, inputs, outputs and errors are
preserved in the transcript and subsequent native request bodies.

### Final Boundary and Interpretation

The mission lasted 297.735 seconds. Requests 1 through 12 each completed with
actual engine `done_reason=stop`, then their tool steps executed. Actual output
counts were 102, 345, 323, 30, 49, 49, 53, 55, 259, 58, 379, 103: 1805 reported
tokens across those completed responses, not a final whole-run usage estimate.
Request 13 was sent at +235.462s and produced first bytes at +236.622s, but
no engine finish/usage total. At +297.730s it settled `timed-out` with
`stream-idle-timeout`; at +297.735s the run became failed, terminal/non-retrying:

```text
Inference timed out
Timed out waiting for generation progress.
```

Native policy selected its existing stream-idle deadline, not the 600-second
overall deadline, output exhaustion, evidence expiry or host termination.
Why the final response stopped providing recognized generation progress cannot
be established from these client-side artifacts. This is a distinct observed
runtime boundary, not proof of an Ollama/model crash or a newly diagnosed Clack
implementation defect. No timeout was changed, repair attempted, request
replayed or new experiment started. Budget and answer continuations were both
zero; all nine unfinished todos became failed under existing terminal cleanup.
The harness reported successfully (`ok:true`, runner exit 0), not product success.

Classification: **PRODUCT RUNTIME / STREAM IDLE TIMEOUT / INCOMPLETE**.
Separately, the model repeatedly chose invalid read/edit targets and imagined
existing files; those are observed **MODEL / TOOL USAGE** errors, correctly
refused by the tools, not a reason to weaken editing safeguards. This attempt
does not establish whether the model would eventually recover and finish.

The reasoning-evidence blocker is fixed and live steps continued past its
previous boundary through 13 admissions and 16 tools. Persisted native settings
retain fresh exact `probe.thinking=true` evidence at +221.198s while the original
captured expiry remains +29.954s, demonstrating revalidation without mutating
the capture. The run reached shell/directory scaffolding and attempted coding,
**not a successful source implementation**. Useful None startup remains in
sharp contrast with the valid Automatic/8192 reasoning-only 600.662-second
overall-deadline result. The deployment-specific startup conclusion stands;
ForgeBoard completion, memory reliability under a long completed project, and
all-model conclusions do not follow from this attempt.

### Verification and Scope

- Focused lifecycle/adapter/D2/error/preferences group: **214 passed, 7 files**.
  Final updated admission-fixture group: **8 passed, 1 additional file**.
  Total distinct focused cases: **222**. Tests include slow responses plus
  40-second tools, unchanged/changed/unsupported contracts, model/deployment/
  configuration changes, offline/missing/hung metadata, late completion,
  post-queue/near-expiry refresh, capture reuse, no replay, same None controls,
  compatible/LM Studio/vLLM/MLX serialization, and D2 single-system continuation.
- `npm.cmd run check-types`: passed. `npm.cmd run lint`: passed at the existing
  **71 warnings, 2 informational notices, zero errors** baseline. The later
  modified admission fixture also passed a focused lint check.
- `npm.cmd test`: **2725 passed, 196 files**. The first sandbox invocation could
  not import any tests because Windows denied temporary-cache renames (`EPERM`);
  it was rerun outside that sandbox. That run exposed two older TTL-immediate-
  failure expectations. Their native metadata fixtures/assertions were updated
  to the required bounded-revalidation semantics, keeping changed/unavailable
  proof denied; the focused eight and final full suite then passed. No
  production fix or threshold weakening was required after the live run.
- `npm.cmd run build`: passed, including TypeScript on the final test sources.
  Existing ineffective-dynamic-import and plugin-timing notices remain.
  `git diff --check`: passed.
- No Rust source changed; Rust gates were not rerun. The Windows native IPC
  host/production adapter was exercised; native GUI/Computer Use and Linux/macOS
  live verification were not performed. Previous evidence directories remain
  intact. No Ollama/network/firewall configuration changed, no cloud inference
  occurred, and no Automatic experiment or tuning ladder was run.
- Only the reasoning lifecycle, its regression tests and this report are in
  scope. No subsequent checkpoint, unrelated delegation/autonomous-tracker work,
  stash operation or push was performed.

## Request 13 Stream-Idle Forensics, 2026-10-16

Continued from clean `main` at `0ea839a`, 34 ahead / 0 behind the recorded
remote. This investigation does not supersede any historical acceptance grade.
In particular, `forgeboard-none-20261016-02` remains **PRODUCT RUNTIME / STREAM
IDLE TIMEOUT / INCOMPLETE**. No Automatic experiment or ForgeBoard mission was
rerun. No production source, timeout, reasoning TTL, model setting, memory or
context architecture was changed.

### Preserved Request and Missing Observations

The complete native body, persisted transcript/settings/todos, event log and
native-host log were inspected. Request `inference-13` went to
`http://127.0.0.1:11435/api/chat`, exact model `qwen38-uncensored:latest`,
`num_ctx=32768`, `num_predict=2048`, `think:false`. Its 30 messages were one
system message, the one original user specification, 12 assistant messages and
16 tool results. All 16 normal production tool schemas remained available.
The system required hands-on implementation, truthful PowerShell syntax and
read-before-edit, not a special reasoning-only response.

The most recent results said `package.json` and `.gitignore` did not exist,
following refused blind edits. Qwen was expected to continue after those tool
results, with text or a valid tool call; explicit None still applied. The active
plan had scaffold in progress and eight items pending, including implementation,
tests, builds and README. No user correction was added. Last prior tools were
the two failed reads, completed at 15:41:38.172 Europe/Paris. No tool/approval or
effect was pending when request 13 timed out.

| Historical Observation | Recorded Value, Europe/Paris |
| --- | --- |
| Serialized request audit | 15:41:38.531 (`1792158098531`) |
| Queue entered / admitted | 15:41:38.544 / same timestamp, capacity 1 |
| Native HTTP attempt started | 15:41:38.828 |
| Connecting / waiting-first-output delivery | 15:41:38.829 / 15:41:38.830 |
| Native `generating` phase delivered | 15:41:39.690; proves Rust recognized at least one meaningful frame |
| First native chunk delivered to JS | 15:41:39.691; **not** the final raw byte timestamp |
| SDK text-start receipt | 15:41:39.691, transcript part 32 |
| Final raw socket byte / final native chunk timestamp | **not recorded** |
| Final parsed NDJSON frame / text delta / reasoning delta timestamp | **not recorded** |
| Every idle timer reset / exact last reset timestamp | **not recorded** |
| Native attempt settlement | 15:42:40.798 |
| Native terminal event delivered | 15:42:40.799, `timed-out`, `stream-idle-timeout` |
| Session failed | 15:42:40.804, terminal/non-retrying |
| Provider final `done` / `done_reason` / usage | No final event or usage received; values **not recorded**, not zero |
| HTTP/socket open status and subsequent read activity | **not recorded** at socket level; native code was waiting for stream progress when its timer won |
| Engine log / engine cancellation acknowledgement / GPU activity | **not recorded**; the remote engine's logs were not available in these artifacts |

The incomplete assistant part is preserved: "Now I'll start building out the
server implementation." followed by two newlines. Its answer segment has no
pending calls and finish `interrupted`. Stored zero token placeholders are not
provider usage. The native-host log contains no Ollama error, only inference
destinations and a post-report WebView class-unregister diagnostic. Final
`/api/ps` still reported the exact digest loaded with context 32768. Loaded
status does not prove active generation or network progress.

The passive calibration sample records SDK first-output 863 ms, observed
first-to-last SDK output span 1229 ms, and largest observed SDK output gap
129 ms. These aggregates omit the trailing no-output wait and do not record
raw receive/NDJSON timestamps. They cannot establish that no bytes arrived
afterward, nor supply a missing last-byte timestamp by subtraction.

### Timeout and Progress Ownership

`src-tauri/src/modules/net/inference/mod.rs` owns the host-side timeout. For
`self-hosted`, defaults are connect 10 seconds, first output 120 seconds,
stream idle **60 seconds**, overall **600 seconds**. Queue waiting and the
separate five-second admission acknowledgement precede `execute`; they do not
spend its transport budget. First-output includes connection, header wait,
model load and prefill; there is no separate enforced model-load stopwatch.
After meaningful provider progress, idle replaces first-output and the earlier
of idle/overall wins. No deadline was raised or disabled.

`progress.rs` examines bounded 256 KiB NDJSON/SSE frames independently of the
SDK, without changing delivered bytes. Complete native `message.content` or
`message.thinking` strings containing non-whitespace, and nonempty
`message.tool_calls`, reset idle. Reasoning is not omitted. Raw network bytes,
incomplete JSON fragments, whitespace-only text, empty message frames,
`done:false` alone, metadata/usage-only frames and SSE keepalives do not reset
it. Native `done:true` marks completion; it is not by itself meaningful output.
NDJSON EOF is handled by native completion and the adapter, while SSE `[DONE]`
also ends native reading. No authenticated Ollama generation heartbeat contract
was present in the retained evidence, so empty frames were not promoted to
fake progress.

Native chunks are delivered to `proxyFetch`, then `verifiedProviderFetch`
validates final framing, and `ollamaModel` emits SDK text/reasoning/tool/final
parts. Both wrappers preserve body bytes. They do not own a second stream-idle
timer. F2 checks pathological text/reasoning/whitespace/tool loops, not this
60-second stopwatch. D2 only continues eligible actual length finishes; request
13 had none. D3 preserves partial output and requires explicit safe recovery;
it did not replay the request or effects. D1 native timeout drops the request
future/client/stream before capacity release. Cancellation/socket-drop behavior
is covered by native tests; a wire-level cancellation acknowledgement for this
historical request is **not recorded**.

### Exact Profile Guidance Versus Enforcement

The before-run profile had no timeout overrides or recommendations.
`loadTimeoutMs` remained unspecified, Automatic, without a recommendation.
At 15:39:33.593 E2 published `prefillTimeoutMs=108000` and
`idleTimeoutMs=54000`, Automatic observed recommendations from five successful
mission samples, with seven-day expiry. No manual timeout pin existed.
Those were the effective inspectable profile guidance values by request 13.
They did **not** become native deadlines. The E2 ledger explicitly says timeout
fields are guidance-only and do not change D1 deadlines. Actual enforcement was
therefore the expected generic 120000 ms first-output / 60000 ms idle policy,
not an E2 recommendation bug. No settings were mutated during inspection.

Representative successful requests, using actual engine metrics and separately
labelled SDK calibration, are below. All had `done:true`, `done_reason=stop`.
Longest raw inter-frame gaps and precise first tool-chunk gaps are **not
recorded** for these requests; SDK gaps are not substituted for those metrics.

| Request | Native Attempt to First Chunk, ms | Engine Total, ms | Largest Observed SDK Output Gap, ms | Provider Output Tokens |
| --- | --- | --- | --- | --- |
| 1 | 9601 | 20307.324 | 9244 | 102 |
| 2 | 952 | 37962.807 | 34907 | 345 |
| 3 | 35906 | 35856.276 | 0 | 323 |
| 9 | 687 | 29537.598 | 26467 | 259 |
| 11 | 50550 | 50479.810 | 0 | 379 |
| 12 | 13201 | 13150.502 | 0 | 103 |

A zero SDK gap means no pair of separated SDK output observations, not proof of
instant engine generation. Some tool responses reached JS only after tens of
seconds. This makes buffering or a long silent generation plausible, but does
not prove what happened in request 13. That request's approximately 61.971-second
native lifetime and partial text are consistent with an idle interval; missing
byte/frame evidence prevents a definitive engine-versus-parser attribution.

### One Controlled Diagnostic, Not a Mission Restart

Reusable, acceptance-only tracing was added in `src/test/ollamaStreamTrace.ts`
and the existing fixture/runner. It records native IPC chunk delivery separately
from parsed text, whitespace, reasoning, tools, empty/metadata and final frames,
plus SDK event categories. It retains counts, last timestamps, maximum gaps,
256 recent events and a bounded 256 KiB frame buffer. Content, tool arguments,
credentials and arbitrary server strings are excluded; final numeric metrics
are allowlisted. Timestamps are explicitly **IPC delivery, not socket receive**.
There is no permanent telemetry service or production instrumentation.

The opt-in runner phase is `stream-diagnostic`, requiring a fresh
`CLACK_PRODUCT_RUN_ID`, Git-only `CLACK_PRODUCT_WORKSPACE`, and absolute
`CLACK_STREAM_REQUESTS` pointing to the preserved audit. An explicit attempt
number preserves earlier evidence. An observed EOF can flush a final line
without a newline; it never fabricates a later raw-byte receive timestamp.

- Fresh diagnostic evidence ID: `ollama-stream-20261016-01`, under
  `src-tauri/target/real-qwen-product/ollama-stream-20261016-01/`.
  Fresh Git-only scratch directory: that directory's `workspace/` child.
  Original ForgeBoard files/evidence were not reused as writable app state.
- `stream-diagnostic-1` is a preserved **TEST_HARNESS / SETUP REFUSAL**: the first
  diagnostic fixture omitted required capacity admission. Native self-hosted
  validation returns `invalid-capacity` before HTTP, surfaced by the wrapper
  as `native-transport`. One IPC invocation was audited, but zero provider HTTP,
  raw chunks, SDK output or model load occurred. This is not an Ollama result.
  Only the test fixture was corrected; no production guard was weakened.
- `stream-diagnostic-2` is the **one actual provider reproduction**. Process
  checks found no competing Clack/Cargo/Rust/Vite/Vitest/harness run. Type checks
  completed before launch. No source changes occurred while it ran.
- The production `createOllamaModel` / `verifiedProviderFetch` / `createProxyFetch`
  and native self-hosted transport handled the request, with capacity 1, exact
  captured request-13 prompt/tool schemas and unchanged controls. Serialization
  was checked before inference and the actual native body was compared afterward
  for deep equality. B1 verified the body. No Agent loop/tool executors were
  attached: this cannot execute a proposed effect, create ForgeBoard, or resume
  the previous mission. No READY, warm-up or other inference was sent.
- A separate 180000 ms evaluator cancellation bound was armed but did not fire.
  Production 60/120/600-second timeouts stayed unchanged. No settings, sampling,
  reasoning, context, output or fallback changes were made. Cloud inference: 0.
- Diagnostic started at 16:05:23.187. Native attempt started at 16:05:23.216.
  HTTP 200 arrived at 16:05:51.095. Exactly **one chunk, 535 bytes, one complete
  frame** arrived at **16:05:51.097** (`1792159551097`), containing a tool call
  and final `done:true`, `done_reason=stop`. Raw delivery and parsed-final
  timestamps coincide. No text/reasoning/empty/invalid frames were observed.
- SDK tool events followed at 16:05:51.098; native settlement was completed at
  16:05:51.114; SDK finish at 16:05:51.115. Elapsed diagnostic time: 27933 ms.
  Actual provider usage: 10518 input, 49 output tokens. Engine metrics report
  27792.318 ms total, 4794.761 ms load, 17011.745 ms prefill, 5935.287 ms eval.
  No tool was executed, and no continuation/retry or deadline fired.
- Initial `/api/ps` had no loaded model; final `/api/ps` had the same exact
  digest/context as the historical run. Cold versus warm state differs from
  the historical request and is an explicit comparison limitation, not a model
  setting change. The model/server remained unmodified.

Diagnostic classification: **COMPLETED / STALL NOT REPRODUCED**. Native and SDK
parsing agreed on the observed tool/final frame. This does not recover the
original last raw-byte timestamp or prove that its engine stopped computing.
No concrete production progress-detection/read-loop defect was demonstrated.
The correct historical result remains unresolved at the underlying stream
boundary, not retroactively **ENGINE / GENERATION STALL** or model failure.
No second provider reproduction or timeout-tuning experiment was run.

### Shell, Edit Safety and Verification

All four historical shell commands matched the advertised `pwsh.exe` PowerShell
contract and exited 0 without evaluator correction. This positively exercises
`9e8f7ae`; `bash_run` did not falsely imply Bash. The four edits targeted the
root directory or nonexistent/unread `.gitignore`/`package.json`, with invented
old content and no successful read-cache entry. The described read-before-edit
guard correctly refused them. Directory/missing-file reads returned accurate OS
errors. These are model tool-use errors, not permission/schema/tooling defects;
no edit guard or shell code was changed. ForgeBoard still has ten empty
directories, zero source/root files, tests, builds or commits. Scratch Git is
also unborn and empty.

Focused frontend: **221 passed in 6 files** (trace, Ollama adapter, proxy,
continuation, recovery, output watchdog). After metadata-redaction and EOF
coverage additions, the diagnostic file passed **9 tests**; seven overlap the
earlier group, for **223 distinct focused cases**. Focused native inference/parser/timeout/
cancellation tests: **34 passed**, using `target/codex-test`. Type checking,
focused lint (four test/fixture files), runner syntax and `git diff --check`
passed. Full frontend/build/Clippy/Rust suites were intentionally not rerun:
only acceptance scripts/tests and this report changed, with no production or
Rust source edits. Windows native IPC was exercised, not native GUI/Computer
Use or Linux/macOS live testing.

The three original primary evidence hashes matched before/after investigation:
`mission-a-1.json` =
`038410C36D2D6303DEEFFFC0E7637E96B6161C03B7E89004121405E85A29F2FC`,
`mission-a-1.jsonl` =
`52DFB8022D48258DFD2294DB0B38F447655C919B8AD8C38A2148C34B5534120D`,
`mission-a-1.requests.jsonl` =
`E7F4A9A787CB59AECABCCCC016D1075640E83E31AD6D5939CDD27C9674F66DC3`.
Post-run process inspection found no acceptance/build/test host left. All prior
grades/artifacts, stashes and unrelated work were preserved. No push or next
checkpoint was started.

## Fresh Traced ForgeBoard Acceptance, 2026-10-17

Outcome: **CLACK-BLOCKED / PROJECT-TASK EVIDENCE RETRIEVAL TIMEOUT**.
The model made partial scaffolding progress and several independently observed
tool-use errors, but the terminal boundary was Clack preflight, not model
completion, output exhaustion, engine failure or a stream watchdog. No repair,
retry, manual Continue, or replacement experiment followed this stop.
All earlier acceptance sections and grades remain unchanged.

### Isolation and Frozen Baseline

- Started from `efb9f34`, clean `main`, 35 ahead / 0 behind recorded remote.
  Process inspections before preparation and mission launch found no competing
  Clack host, editing/test/harness process, Vite test runner, or Cargo/Rust build.
  Only the owned runner's native-example preparation was allowed.
- Fresh workspace:
  `C:/Users/Hayden/Documents/forgeboard-qwen-none-20261017-01`.
  It began as unborn `main`, with `.git/` only. No evaluator application files,
  manifests or implementation were seeded.
- Evidence ID: `forgeboard-none-20261017-01`; directory:
  `src-tauri/target/real-qwen-product/forgeboard-none-20261017-01/`.
  Primary evidence is `preflight-1.json`, `mission-a-1.json`,
  `mission-a-1.requests.jsonl`, `mission-a-1.jsonl` and isolated `data/`.
- The tunnel initially refused connections. No inference/specification was sent
  then. After the user restored it, the exact `/api/tags` digest and Q4_K_M
  quantization matched the established model. Metadata-only native preparation
  completed with **zero inference destinations**; no Automatic/READY/warm-up
  call was made. The loaded-model list was initially empty.
- Before launch, only five acceptance harness/test files were modified to enable
  the existing bounded trace on each mission request, retain first-frame and
  category endpoint timestamps, and allow metadata-only preparation. No product
  module, Rust source, model/tool ranking, permission, correction boundary,
  timeout or runtime behavior was changed.
- All 932 tracked source/configuration files matched before/after the run in
  both content and timestamps. Content aggregate SHA-256:
  `F18414C187A3133736B7DCBAF895258A4A1CD6CB3324744836F5DB0A0CFCAE91`.
  Timestamp aggregate:
  `275232D0ED0F9BC5FA0EA359100650E598AF61D0CA1E0D02431E702D6D620D1B`.
  No source, test or harness edit occurred while the experiment was running.

### Exact Controls and Input

All **16 actual native requests** used exactly:

```json
{
  "model": "qwen38-uncensored:latest",
  "options": { "num_ctx": 32768, "num_predict": 2048 },
  "think": false
}
```

All destinations were `http://127.0.0.1:11435/api/chat` through the authorized
tunnel. Fallback was effectively Never, with no fallback authorization/cloud
destination and **zero cloud inference**. All serialized requests fit B1.
The same 16 normal production-selected tools were exposed, including `edit`,
`create_directory` and `bash_run`, without evaluator-added tools. No temperature,
top-p, top-k, model, quantization, context, output or timeout tuning occurred.
Native idle remained **60 seconds**, first-output 120 seconds and overall
**600 seconds per request**. The separate existing 90-minute harness bound
was not reached. Initial/final exact model digest:
`0e163794a8b9cdd6e234013b1a27d2e58f06f48d20413a0c2e3e370faaef5505`;
final `/api/ps` reported loaded context 32768.

The full original 2086-character specification was submitted exactly once,
byte-identical after the environment block to the preceding valid None run.
Specification SHA-256:
`f97ec34eefa136ac5be5847187f768b64bf5587d36140d9fcc53b695fa3e4801`.
It retained port 4317, page size 50, maximum title 120, 750 ms debounce,
React/TypeScript, Node/TypeScript, SSE, local persistence, no cloud/telemetry,
tests, production build and README. One durable user message remains. The model
received no prior-failure history, tracing notice, evaluator classification,
tool advice, correction reminder or other rescue instruction.

### Chronology and All Tool Calls

Times below are relative to the mission start at **07:31:21.787 Europe/Paris**,
using local event/receipt timestamps. First request audit: +0.392s. First raw
chunk and first parsed public-text frame: **+17.630s / 07:31:39.417**; SDK
text-start receipt: +17.632s. No reasoning frames were observed. The first
provider tool-call frame arrived at +27.904s; the first completed useful tool
was the directory listing at +27.989s. Initial public output described inspecting
the workspace and planning the build, not an implementation-complete claim.

| Call | Completed, Seconds | Tool / Actual Result |
| --- | --- | --- |
| 1 | 27.989 | `list_directory` root: empty visible tree. |
| 2 | 28.902 | `bash_run`: `node --version; npm --version`, exit 0, Node 22.20.0 / npm 10.9.3. First shell command matched advertised `PowerShell (pwsh.exe)` / `PowerShell; not POSIX Bash`. |
| 3 | 71.018 | `todo_write`: six-item plan, scaffold in progress, backend/tests/frontend/build/README pending. |
| 4 | 84.883 | `bash_run`: `npm init -y`, exit 0; initial root `package.json` created. First confirmed file creation, not application implementation. |
| 5 | 79.954 | `bash_run`: `npm config get registry`, exit 0. Calls 4/5 completed out of order; table retains transcript order. No install occurred. |
| 6 | 105.241 | `create_directory server`: success, workspace-write receipt. |
| 7 | 105.242 | `create_directory client`: success, workspace-write receipt. |
| 8 | 105.242 | `create_directory data`: success, workspace-write receipt. |
| 9 | 149.807 | `edit package.json`: refused because it had not been read in the session; no write. |
| 10 | 156.824 | `read_file package.json`: succeeded, returned actual npm-generated content. |
| 11 | 200.869 | `edit package.json`: succeeded after read, replaced exact actual content with root workspaces/scripts; workspace-write receipt. |
| 12 | 213.374 | `bash_run`: POSIX `cat ... << 'EOF'` heredoc for `.gitignore`; refused before execution because commands must be single-line. Also contrary to advertised PowerShell syntax. |
| 13 | 227.209 | `bash_run`: single-line PowerShell `Set-Content` / `Add-Content`; exit 0, `.gitignore` created without evaluator correction. |
| 14 | 267.258 | `bash_run`: multiline PowerShell here-string for server manifest; refused by the single-line guard, not a native PowerShell parser failure. |
| 15 | 279.346 | `bash_run`: `Set-Content _scaffold.ps1 ...`, exit 0; helper file created, not invoked. |
| 16 | 293.512 | `bash_run`: Node read of `server/package.json`, exit 1 because that manifest still did not exist. |
| 17 | 349.585 | `bash_run`: single-line Node `JSON.stringify` / `writeFileSync`, exit 0; valid `server/package.json` and `client/package.json` created. |
| 18 | 397.239 | `bash_run`: Node command for server tsconfig, exit 1, invalid string escape; no tsconfig/source directory created. |
| 19 | 397.219 | `bash_run`: Node command for client tsconfig, exit 1, quoting/syntax error; no tsconfig/source directory created. |
| 20 | 410.468 | `bash_run`: Node writes `_w.js`, exit 0; another unused scaffolding helper. |
| 21 | 441.068 | `edit server/tsconfig.json`: refused because target was unread and nonexistent; no write. |

All 21 stable tool-call IDs, full inputs, outputs and errors remain in the
transcript and subsequent request bodies. The three directory effects and root
edit carry `clackWorkspaceWrite:true`; shell effects are evidenced separately by
their commands/results and actual disk files, not fabricated per-file native
effect IDs. Totals: 12 shell calls (**7 exit 0, 3 exit 1, 2 refused before
execution**), 3 directory creates, 3 edits (**1 success, 2 unread-target
refusals**), 1 read, 1 listing and 1 todo write. Refusals were correct safety
behavior, not permission denials or tool-schema failures.

Qwen did recover from the first edit refusal by reading then editing, and from
the POSIX heredoc by using PowerShell. It nevertheless later repeated an unread
new-file edit and failed multiple Node quoting attempts. This demonstrates
partial recovery, not reliable mastery. The initial shell command was correct;
later POSIX/multiline/quoting mistakes are model tool-use evidence. No shell
guidance or safety rule was repaired during the run.

The 50-to-25 correction was **not sent**. Page size 50 never entered application
implementation or the structured plan, and the existing monitor saw only one
successful write/edit tool result rather than three plus a qualifying page-size
write. Shell-created files are reported separately; they are not silently
counted as native edit receipts. Neither correction condition was met under the
unchanged acceptance boundary. No early correction, resend or manual Continue
occurred. Production budget and answer continuations were both zero.

### Complete Stream Evidence and Final Boundary

Each request has an independent `native-stream-trace` with observer/start and
settlement times, first/last raw chunk and parsed frame timestamps, text/
reasoning/tool/final category timings, counts, maximum gaps and reported usage.
These are **native IPC chunk-delivery timestamps, not socket-receive timestamps**.
The existing 256-event/256 KiB bounds were retained. In this run no events or
frames were dropped; there were zero invalid frames or pending bytes. All
frame/category timestamps fit within the retained event rings. No prompt,
tool-argument, credential or hidden reasoning content was added to the trace.

All 16 HTTP requests settled **completed**, with actual provider `done:true`
and `done_reason=stop`; all were normal tool-loop steps, not project completion.
There were **331 parsed frames, 61,792 delivered bytes**, and **3387 provider-
reported output tokens** across completed requests. No token total was inferred.
Reasoning-frame count was zero. The largest observed raw/frame gap was
**51.001 seconds** in request 13, below idle enforcement. Neither stream-idle,
overall-deadline nor first-output timeout occurred.

Final request `inference-16`:

| Observation | Europe/Paris / Recorded Value |
| --- | --- |
| Native attempt start | 07:38:12.983 |
| First raw chunk / first parsed frame | 07:38:13.695 |
| Last non-whitespace text frame | 07:38:16.641 |
| Last whitespace-text frame | 07:38:16.764 |
| Last raw chunk / last parsed frame / tool-call frame | **07:38:42.790**, epoch `1792215522790` |
| Provider final | Same frame, `done:true`, `done_reason=stop` |
| Reported usage | **11,673 input / 230 output tokens** |
| Trace totals | 26 chunks, 26 frames, 4605 bytes; no reasoning, invalid or dropped frames |
| Longest raw/frame gap | 26.026 seconds; not an expired idle interval |
| Native settlement / observed EOF | 07:38:42.800, completed |
| Last tool result | 07:38:42.855, refused unread/nonexistent tsconfig edit |
| Session terminal error | **07:38:42.939**, `retrieval-timeout` before a seventeenth native request |

The exact terminal Clack message was:

```text
Context preflight
Project/task evidence lookup timed out. Original conversation and memory are unchanged.
```

The persisted run is failed, terminal/non-retryable, 16 steps, last finish
`tool-calls`. The bounded scoped-evidence preflight owner in `scopedEvidence.ts`
emits this timeout while preparing the next working context. The lookup's
underlying cause/remaining allowance was not instrumented in this attempt;
neither memory corruption nor a specific timeout-bookkeeping defect is proved.
No context-capacity failure was recorded: all actual bodies fit B1. No native
stream was pending when this new preflight error occurred. No compaction/memory
revision was committed, and no manual evidence request or recovery was sent.
Original transcript, tool results and model work were preserved. The six
unfinished todos were marked failed by normal terminal cleanup.

This is a new **Clack-side acceptance blocker**, with earlier **MODEL / TOOL
USAGE** errors retained as separate phase evidence. The normal stream finals
rule out a stream-idle/overall-deadline termination for this run. It does not
retroactively explain the previous request-13 timeout. The run was left stopped;
no retrieval/memory/context/timeout fix or follow-on experiment was started.

### Independent Project Inspection

Read-only disk/Git inspection and strict Node JSON parsing confirmed these six
files, all created/modified by the model, not the evaluator:

- `package.json` (623 bytes): valid root workspaces and dev/test/build scripts;
  created by npm and later revised by the successful edit.
- `.gitignore` (58 bytes): ignores `node_modules/`, `dist/`, `data/`, logs,
  coverage and `.DS_Store`.
- `server/package.json` (503 bytes): valid Express/CORS/TypeScript manifest;
  scripts refer to missing `src/index.ts` and missing tsconfig.
- `client/package.json` (650 bytes): valid React/TypeScript/Vite manifest;
  no frontend source was created.
- `_scaffold.ps1` (73 bytes) and `_w.js` (52 bytes): unused model-generated
  scaffolding helpers, not ForgeBoard application implementation.

There are no `server/src` or `client/src` trees, tsconfigs, tests, dependency
installation, lockfile, backend listener, SSE implementation, persistence
implementation, filters/search, title validation, debounce behavior or README.
Port 4317 and page size 50/25 therefore have no effective application behavior
to test. No npm install/test/build was executed by the model. No independent
install/test/build was attempted on this manifest-only scaffold: that would not
establish missing application behavior and could alter preserved evidence.
Git remains unborn `main`, no commits; six untracked files under root/server/
client and three created directories (`data/` is empty and ignored).
**No materially working implementation was produced.**

### Comparison, Verification and Scope

Explicit None again produced useful public/tool activity promptly, unlike the
already-valid Automatic/8192 reasoning-only 600.662-second overall-deadline run.
Compared with the first None run's approximately 75-second evidence-expiry stop,
and the second None run's approximately 298-second idle stop, this run lasted
**441.152 seconds**, made manifests/helpers and recovered from some tool errors.
It still did not reach application implementation/tests, and stopped at a
different Clack preflight boundary. No broader model-capability or memory-
reliability conclusion follows. None remains the better observed startup
configuration for this deployment; no Automatic comparison was repeated.

Focused tracing tests: **10 passed in 1 file**, including per-request isolation,
first/last category timestamps after ring eviction, redaction, UTF-8/frame
boundaries, EOF, no fabricated progress and exact replay serialization. Type
checking, focused lint on four test/fixture files, runner syntax, and
`git diff --check` passed. The actual metadata-only preparation and all 16
request traces independently exercised the harness integration. Full Clack
frontend/build/Rust suites were intentionally not rerun because production
source did not change. Windows native IPC was used; no Computer Use/native GUI
or Linux/macOS live testing was performed.

Post-run process checks found no acceptance/build/test host left. Previous
workspaces, evidence, grades, safety stashes and unrelated user work remain
untouched. Only acceptance harness/tests and this appended report are committed
for this checkpoint. No production fix, model tuning, push or subsequent
checkpoint was started.

## Long-Running Empty Evidence Lookup Fix, 2026-10-17

### Scope and Historical Diagnosis

Baseline: clean `main` at `d9cecf5`, **36 ahead / 0 behind** recorded
`origin/main`. Process inspection found no competing Clack host, acceptance
runner, Vite/test runner or Cargo/Rust build. Unrelated Codex processes were
left alone. This checkpoint changes only the empty scoped-evidence reuse path,
its tests, native acceptance timing instrumentation and this report. All earlier
grades remain unchanged, including `forgeboard-none-20261017-01` as
**CLACK-BLOCKED / project-task evidence preflight / INCOMPLETE**, not model failure.

The exact error owner is `createScopedRetriever().prepare()` in
`src/modules/ai/lib/scopedEvidence.ts`. Its `Promise.race` timer creates
`RetrievalError("timeout", "Project/task evidence lookup timed out.")`;
`RetrievalError` appends the originals/memory guarantee. Production call chain:
`runAgentStream.prepareStep` -> `createConversationCompactor.prepare` ->
`scoped.validate(true)` after confirmed writes and/or `scoped.prepare` at final
assembly. Transport preflight also calls `InferenceScope.validateEvidence` ->
`compactor.validateEvidence` -> `scoped.validate` -> the same `prepare`.
The SDK propagates the exception; `normalizeAiError` presents the
`retrieval-timeout` as terminal Context preflight. No request 17 was sent in the
old run. This was not the native inference idle/overall timeout owner.

The automatic query was the latest user objective: the original **2,086-character
ForgeBoard specification**, with `anchor=null` and **no relative file hints**.
Neither Qwen nor a user requested additional evidence. The recipient was
`real-mission-a`, Coder, in the original `...20261017-01` workspace. The task ledger
was empty; no PeerTask/dependency, explicit source anchor, conflicting claim or
promoted project fact was required. The preserved native data has no
`ai-project-memory` store and an empty PeerTask ledger. Both first and final
preserved request bodies contain **no scoped evidence envelope**. The successful initial native selection
therefore supplied no facts, issues or omission report. The fresh instrumented
run below confirms the same query's empty selection. No durable memory revision
existed in the old run; its one user and one growing assistant message retained
the original task, six-item plan, paired tool results and live scaffold state.
After request 16 the latest edit was correctly refused for an unread/nonexistent
`server/tsconfig.json`. That tool failure did not request historical evidence.

**Root cause: unnecessary repeated validation of a successful empty discovery.**
An empty result was cached like delivered evidence. Every reuse, confirmed-write
refresh and transport validation re-ran the native composite lookup even though
there was no fact to revalidate or inject. `runRetrievalAllowance` preserves one
allowance across SDK steps/batches. Its policy is **10,000 ms cumulative local
work per logical run**, shared by conversation and scoped lanes, not ten seconds
per inference or 441 seconds of wall time. Every redundant validation charged
`allowance.elapsed`; the next timer received only `10000 - elapsed` milliseconds.
The round and byte allowances did not stop read-only validation.

Historical per-IPC timings were not recorded, so the exact remaining milliseconds
and slowest historical sub-operation cannot be reconstructed. The old last tool
receipt and terminal error were only **84 ms apart**. There is no evidence of one
ten-second filesystem hang, lock deadlock or inference timeout. Deterministic
production-coordinator reproduction below establishes the cumulative failure
mechanism rather than attributing an unobserved duration to one native read.

Native command: `scoped_evidence_retrieve`, using `spawn_blocking`, authorized
session/project loading, recipient/PeerTask checks, bounded M2/file reads and two
`project_evidence_revision` checks. In an unborn repo each revision check launches
four bounded Git commands, eight per lookup. There is no recursive repository
scan. It holds the existing **shared** content-collection read guard, not an
exclusive conversation/project lock. Git runs noninteractively with optional
locks disabled and two-second per-command kill/wait bounds. Native ten-second
elapsed checking is cooperative and occurs before publication. Frontend timeout
or cancellation rejects/discards late results but does not preempt the native
blocking function. Whether the final old native call continued after its caller
timed out is **unrecorded**; it could finish until the owned host exited. No
persisting host/Git orphan or held lock was observed. This checkpoint does not
claim a new native cancellation guarantee. The corrected empty-reuse path starts
no native work, so it cannot abandon another validation operation.

### Narrow Fix and Deterministic Evidence

After normal permission, active-run, cancellation and overlap checks, a cached
lookup with **no pending request, null anchor, zero chunks, zero issues, zero
omissions and an explicitly empty native task-source set** returns the current
messages unchanged. It retains its charged discovery round and counters across
internal batches. It does not assert that a file/fact is absent or current,
inject cached facts, rerank a project or create a durable receipt/revision.
There is no evidence to refresh just because a workspace write occurred.

Explicit follow-up queries still use the remaining bounded discovery round.
Any delivered chunk, task source, missing-source issue, omission, exact anchor,
conflict or stale qualification remains on the original native validation path.
Unknown/failed initial lookups still block: a timeout is not proof that required
evidence is absent. Required/dependency failures are not relabelled optional.
This is **Case C (unnecessary trigger)**, not a universal best-effort timeout
fallback. Existing optional capacity-omission receipts remain unchanged; no
omission receipt is needed for a genuinely empty successful selection. Selected
evidence that fails validation is never silently reused or stripped after body
serialization. Mixed project/task lookup and required-priority semantics are
unchanged.

The new deterministic test uses the production conversation compactor and scoped
retriever, a persistent conversation/current plan, repeated confirmed writes,
two transport checks per step, and a native-read fixture taking 158 ms. Sixteen
steps perform 63 redundant validations on the old implementation: **9,954 ms**
of charged local work. The next lookup receives only **46 ms**, reproducing the
exact `Project/task evidence lookup timed out` before a 17th response. The test
was run red before the production fix. Afterward, 17 steps plus simulated model
latency pass with **one read / 158 ms / one discovery round**, no extraction or
memory commit, unchanged original messages and unchanged memory view.

Additional regressions cover empty reuse across SDK batches even after shared
allowance exhaustion, explicit anchored follow-up after empty discovery,
permission revocation, run replacement/Stop, and refusal to exempt selected,
missing, omitted, task, conflicting or stale evidence. Anchored timeout still
fails with the exact error and no prepared/partial receipt; late results cannot
populate the cache. The existing write-freshness fixture now supplies an actual
file chunk instead of an empty response, so it continues testing real evidence
refresh before extraction/admission. Existing native tests cover mandatory task
priority over optional project sources and missing dependency/anchor denial.

### One Fresh Native Re-Acceptance

- Workspace: `C:\Users\Hayden\Documents\forgeboard-qwen-none-20261017-02`,
  freshly initialized unborn `main`, only `.git` before the experiment.
- Evidence ID: `forgeboard-none-20261017-02`; preserved under
  `src-tauri/target/real-qwen-product/forgeboard-none-20261017-02/`.
- Evidence: `preflight-1.json` / `.failure.json` (observer setup failure,
  zero inference/specifications); corrected metadata-only `preflight-2.json`
  (zero inference); `mission-a-1.json`, `.jsonl`, `.requests.jsonl` and isolated
  `data/`. The rejected JavaScript observer attempted to assign Tauri's frozen
  invoke property. It was removed before inference. The native example now wraps
  the same production command solely to log request shape, duration and result
  counts, without altering routing, returned data or security behavior.
- Fresh process check immediately before inference found no competing Clack
  host/test/build/harness. The owned host PID was **37780**, runner **16896**.
- Exact model `qwen38-uncensored:latest`, native
  `http://127.0.0.1:11435/api/chat`, **32768 / 2048 / `think:false`**, fallback
  Never, empty provider keys, **zero cloud inference**. All **18** captured bodies
  retain those controls and the same normal **16 production tools**. The 60-second
  idle and 600-second overall inference deadlines were not changed or reached.
- Full original specification sent **once**, one user message; no resend,
  reminder, manual Continue, setting change or evaluator implementation. The
  existing conditional correction boundary remained enabled but was not reached:
  no successful native edit/write trio with a qualifying page-size-50 write.
  No correction, answer continuation, automatic run continuation or delegation.
- Source frozen during inference: **932 tracked source/config files**, content
  fingerprint `88C7F4C78BD3394C75E07E7D824E6901142788D972F7D1E316EB25D5456C92EC`,
  timestamp/length fingerprint
  `8F97BEE3E983C99E5DDD037740C53EF6EA3E2CE359ED5EEA1B7A8CD8BE2CBFC9`,
  identical before/after. Later native observer edits were formatting only and
  occurred after the host exited.

Run start: `1792216609637` (07:56:49.637 Europe/Paris).
First native public text **13.914 s**, SDK text-start **13.916 s**; first native
tool frame **20.695 s**, completed directory listing **21.013 s**. Eight-item
structured plan **61.052 s**. First shell `node --version; npm --version`
completed successfully under PowerShell at **66.292 s**. First actual file
creation (`New-Item package.json`) **157.407 s**.

The only scoped lookup started at `1792216609755` and completed in **315 ms**:
query 2086 characters, null anchor, no file hints; **0 chunks, 0 issues,
0 omissions, 0 file reads, 0 bytes, taskIds=[]**. There was no later scoped IPC
operation or stale evidence injection, including after directory/file writes.
Request 17 was captured at native transport at **395.139 s**; request 18 at
**424.668 s** and completed
normally at **480.629 s**. Its final shell write completed at **481.124 s**.
Thus the old request-17 evidence blocker did not recur, and useful effects
continued past 441.152 s. A successful *post-441-second inference preflight*
cannot be claimed: the next preparation encountered the distinct budget boundary
below before request 19. No further experiment was run to hide that limitation.

All **19 tool calls** are retained in the transcript and captured request history:

| Completion (s) | Tool/effect | Actual result |
| --- | --- | --- |
| 21.013 | list_directory | Empty workspace |
| 61.052 | todo_write | Eight-item current plan |
| 66.292 | bash_run: Node/npm versions | Exit 0, correct PowerShell syntax |
| 109.295 | todo_write | Environment completed, scaffold active |
| 121.491 | create_directory x2 | server/src and client/src created |
| 134.147 | bash_run: registry inspection | Exit 0 but `head` missing in stderr |
| 142.252 | bash_run with timeout_secs=30000 | Schema rejected; no execution |
| 149.463 | bash_run: npm view express | Exit 0 with timeout_secs=25 |
| 157.407 | bash_run: New-Item package.json | Empty file created, exit 0 |
| 163.823 | read_file | Actual empty root manifest read |
| 192.537 | bash_run: multiline here-string | Refused before execution |
| 222.940 | bash_run: malformed Set-Content | Exit 1, quoting/argument error |
| 259.514 | bash_run: single-line redirections | Root manifest written, exit 0 |
| 310.658 | bash_run: redirections | Server manifest written, exit 0 |
| 370.432 | bash_run: redirections | Client manifest written, exit 0 |
| 395.067 | bash_run: redirections | Base tsconfig written, exit 0 |
| 424.598 | bash_run: redirections | Server tsconfig written, exit 0 |
| 481.124 | bash_run: redirections | Server manifest updated, exit 0 |

Thirteen shell calls: **10 exit 0**, **1 exit 1**, **1 multiline refusal**,
**1 invalid-argument nonexecution**. Exit 0 does not erase the missing-`head`
stderr. No tools were retried/replayed by the evaluator; Qwen's corrective
commands are distinct captured calls. No read-before-edit protection changed.

### Distinct Stop and Preserved Product State

**CLACK-BLOCKED / PROTECTED CONTEXT BUDGET / INCOMPLETE**, at **481.159 s**.
All 18 provider requests returned normal final frames and usage; no request 19
was sent. Exact terminal code: **`compaction-protected-budget`**. The next context
estimate was **28,290 input + 2,048 output + 2,829 safety = 33,167**, exceeding
32,768 by 399. Breakdown: system 3,617; schemas/options 7,250; conversation
17,423; retrieved evidence **0**, derived memory **0**. The original user message
and one growing, paired assistant/tool group remained protected; memory
`revisionId=null`, no extraction/compaction revision. This is Clack's conservative
preflight boundary, **not a provider-reported exhausted window or model finish**.
It was not repaired, bypassed or resumed in this checkpoint.

Actual files: root `package.json` **573 bytes**, `tsconfig.base.json` **245**,
`server/package.json` **605**, `server/tsconfig.json` **338**,
`client/package.json` **748**. Two source directories exist but are empty.
No application `.ts`/`.tsx`, backend/frontend implementation, tests, README,
lockfile, installed dependencies, SSE/persistence/server or production build.
No npm install/test/build was executed, and the evaluator did not run one on the
incomplete scaffold. Git remains unborn with no commits. Qwen created additional
configuration types compared with the earlier attempt, **not more application
source or a materially working ForgeBoard**. One plan item completed; seven
unfinished items were marked failed by normal terminal cleanup.

This fixes the proven redundant empty-evidence path, not long-task completion
overall. None still starts useful work, unlike the already-valid Automatic/8192
reasoning-only deadline result; **Automatic was not rerun**. No inference replay,
cloud fallback, source rewrite or stale evidence was observed. Original
conversation/project memory and historical attempts remain preserved.

### Verification and Boundaries

Focused frontend evidence/compaction/real-SDK/preflight/plan group:
**179 tests / 6 files passed** with two workers. Initial focused execution had
one unchanged model-switch integration timeout under concurrency; rerunning the
group with two workers passed without raising thresholds. The updated real-file
freshness fixture and reproduced-empty-discovery test both pass. Native scoped
retrieval **21 passed**, unborn/non-Git/corrupt-branch regressions **3 passed**.
Windows native IPC and actual local inference were exercised. Computer Use,
native GUI acceptance, Linux/macOS and WSL live runs were **not performed**.

Final gates on Windows:

- `npm.cmd run check-types`: passed; final build also reruns TypeScript.
- `npm.cmd run lint`: passed, **71 existing warnings / 2 infos / 0 errors**.
- `npm.cmd test -- --maxWorkers=2`: **2,746 tests / 197 files passed**, 62.41 s,
  no skipped tests or raised thresholds.
- `npm.cmd run build`: passed, 1,252 modules; existing ineffective dynamic-import
  and plugin-timing warnings remain.
- `cargo fmt --check`: passed after formatting only the new native observer.
- `cargo clippy --all-targets --locked --target-dir target/codex-test -- -D warnings`:
  passed.
- `cargo test --locked --target-dir target/codex-test`: **654 passed**
  (601 library + 25 filesystem + 25 Git + 3 real-world integration); no failures
  or ignored tests. Main/shell-background/doc test targets have zero tests here.
- `git diff --check`: passed; existing Git LF/CRLF notices remain.

No model settings, reasoning revalidation, B1, C1/G1/M1/M2 architecture,
PeerTask/scheduler, native
stream deadline or tool protection changed. No safety stash, unrelated delegation
file, `autonomous_tracker/`, previous workspace or evidence was touched. Post-run
process inspection found no owned acceptance/build/test process left. No push.

## Protected Context Reconstruction and Plan Supersession, 2026-10-17

### Baseline and Classification

Started from clean `main` at `3bceda0`, **37 ahead / 0 behind** recorded
`origin/main`. No competing Clack acceptance, editing, test or build process was
found before editing. Previous workspaces/evidence and all historical grades
remain intact. This checkpoint is **CASE C: superseded material remained
protected**, specifically older acknowledged full `todo_write` snapshots inside
the current SDK step batch. It does not establish an inherent model/task
requirement for more than 32K. No context increase, model tuning, timeout change,
Automatic rerun, B1 margin reduction or new memory architecture was used.

### Recorded Request-19 Budget

The authoritative `forgeboard-none-20261017-02/mission-a-1.json` records the
following terminal **estimates**, not tokenizer/provider measurements:

| Component | Recorded tokens |
| --- | ---: |
| Context ceiling | 32768 |
| Output reserve / output maximum | 2048 |
| Reasoning reserve | 0 |
| Input estimate | 28290 |
| Safety margin: ceil(input * 0.1) | 2829 |
| Maximum input with that recorded margin | 27891 |
| Total input + output + margin | 33167 |
| Excess | 399 |
| System frame | 3617 |
| Core system attribution | 3175 |
| Active Coder attribution | 442 |
| Schemas/options | 7250 |
| Built-in schema attribution | 7134 |
| Conversation/tool state total | 17423 |
| Available working conversation with recorded frame/margin | 17024 |
| History attribution | 17154 |
| Environment attribution | 123 |
| Other structure/options attribution, across request | 262 |

System text was **6753 characters**, with one stable core/persona/default-behavior
frame, not repeated concatenated system fragments. Tools were the same **16**
normal F1 schemas, **14814 UTF-8 bytes / 14798 characters**. They are material:
approximately 22% of the ceiling before output/margin. Initial relevance selection
and same-batch pinning explain the stable set. No F1 regression or expanded
catalog was demonstrated; no tool was removed to improve the result.

The original specification is **2086 characters**, present once as an authoritative
user request. Its materialized message is **2325 characters** with the single
native workspace/shell environment block. There was no correction: page size
remained **50**. Logical run/answer continuations, substantive objective carry,
project instructions, project memory, derived conversation memory, extraction
summary, retrieval/project/task evidence and attachment contributions were **0**.
There was no PeerTask dependency or active retrieval anchor. Memory revision was
null and coverage had not advanced. All history was still uncompacted original
task/tool material. No summarization model call was attempted.

### Exact Owner and Protected Classes

`planCompaction()` in `src/modules/ai/lib/compactionPlan.ts` emits
`CompactionError("protected-budget", ...)`, whose constructor produces the exact
code `compaction-protected-budget`. Chain:
`runAgentStream.prepareStep` -> `createConversationCompactor.prepare` ->
`planCompaction` -> `groupCompactionUnits`, protected/tail assembly ->
`measureRequest` -> `resolveContextBudget` -> failure before extraction/HTTP.
The safety test is reached before `createBoundedExtractor`; "compaction attempted"
here means deterministic planning, not a failed hidden summarization request.

There were two source classes in that preparation:

1. Captured original user unit **`9MAiUOIZH9J1PZh5`**, role user. Requirements
   are protected verbatim. Reconstructed materialized cost **1196 tokens**,
   including environment and message framing. All port/page/title/debounce,
   SSE/persistence/testing/no-cloud requirements remain authoritative.
2. Current in-flight assistant/tool steps, persisted under assistant message
   **`7abdd7e7-9b7e-4241-91b1-5b77331b1858`**. The captured compactor source units
   came from the initial user message; these generated steps arrive separately
   as `extra`, outside its existing original-message coverage. All **36 model
   messages / 19 calls / 19 results** were appended verbatim and unconditionally
   retained. This was not 19 separately selected required historical sources.
   The planner cannot claim that a live effect has been archived merely because
   its UI transcript is already persisted. Broadly summarizing/dropping this tail
   would require a separately proven source-coverage change and was not done.

Within the live tail, the following are individual call/result identities.
Costs are **offline reconstructed estimates**, with per-pair framing, not
additive exact historical sub-budgets. All were retained because they were in
`extra`, irrespective of their semantic requirement status:

| Tool call ID | Content / protection significance | Chars | Tokens |
| --- | --- | ---: | ---: |
| jOh87rnbpTHgKGQXzBOB4UpNQVVcccHF | Empty directory observation | 452 | 223 |
| TJVUhKdvotCsLnsbkJdsKqjJRXp6MixD | Older full accepted plan, superseded | 1672 | 803 |
| RlGYs3841W9Fy8bKQlU4DzN8Wd3ybzhS | Successful Node/npm environment check | 540 | 267 |
| RkURqL1syopgNmqp3F5QkuaxDlZVNT86 | Latest accepted plan, must retain | 1701 | 823 |
| 4UxZ8UQx2jSXmZkOE8zm8a5nnuXHcgi6 | Acknowledged server directory effect | 502 | 242 |
| QBThdJObHP5n21nwBfrkfviJOJT2z8UQ | Acknowledged client directory effect | 502 | 242 |
| hqAaEhsnbiyaJEjQFoHOveMVixGoXExZ | Registry inspection; missing-head stderr despite exit 0 | 1109 | 574 |
| HFzpUHR3rrS4NIRRCoki89Qz3AbIRGw0 | Invalid timeout argument; no execution | 741 | 372 |
| BOipl01jl2jvx4l0guiqukbXDJuhbacs | Corrected registry command succeeds | 758 | 384 |
| TDG9d8UTZt3eVfkOFwfjye6pSMdiChtI | Empty root manifest created | 592 | 294 |
| YE4jjBkzKpOQeDqd9gckH3LFoNBLbwYC | Actual empty manifest read | 493 | 246 |
| vG0KOcAEP6EnBRjUKEfc6LeGAcqT1HOj | Multiline-command refusal | 1127 | 560 |
| RZepbnuF7grj2QMeW3iWpd5Y267zIDdS | PowerShell Set-Content exit 1 | 2089 | 1147 |
| CihGwbKqj68pygwV0uPsZQ5bI4DqyWSG | Successful root manifest, corrects earlier quoting attempt | 3047 | 1652 |
| QFAhHBbkKOQRiNFpL0fRO5gfikNcB7G0 | Successful server manifest | 3000 | 1728 |
| sjkhDEfAjmVvBXhdaEVU1Mgzz2TbGK6l | Successful client manifest | 3580 | 2072 |
| vyVF7JgqqfPIpzJAJVpTwky9DaKhBXeq | Successful base tsconfig | 1520 | 808 |
| Qr7Lotg02eF5IcfE41eGYaU76TIwp6rI | Successful server tsconfig | 1946 | 1054 |
| CQ6WufxamAvLeoeGrnvTSBca9CUnkhfh | Most recent successful server-manifest update | 3120 | 1802 |

The largest groups are shell writes, whose requested command, returned command
and sometimes stdout repeat source text. Those are distinct call/observation
fields actually present on the wire, not a B1 double-add of a source group.
They were not stripped. Reconstructed narrative-only messages cost **789**,
call-bearing messages **7575**, result messages **7687**, with shared framing
that prevents simply summing independently measured slices.

### Duplication, Supersession and Accounting Findings

Both accepted plans contain eight bounded items. The older input is **1286
characters**; the current one **1279**. The newer accepted full replacement marks
environment inspection completed, scaffolding active and six later phases
pending. This is explicit tool-contract supersession, not fuzzy text matching.
`buildTodoTools().todo_write` replaces the entire list, never applies a delta.
The current plan was retained exactly. Older plans in ordinary captured history
were already eligible to leave the protected set; generated SDK steps lacked the
equivalent qualification. No five-copy original-specification problem was found:
plan items refer to requirements, but there is no second full objective carry,
extracted summary, project-memory or retrieval copy of the specification.

The timeout-argument error was corrected by a valid timeout, and the malformed
Set-Content attempt by a successful root write. The multiline restriction still
matters operationally. Missing `head` is not reported as a nonzero exit by the
native shell. None of these failure groups was removed or declared resolved by
the fix; neither successful effects nor uncertain effects are inferred merely
from a model's plan status. Optional retrieval was not elevated: there was none.

The offline tool `scripts/diagnose-protected-context.mjs` reads the preserved
bounded artifacts and replays 18 responses through the installed SDK using
**stubbed observed tool results, zero native effects and zero inference**. It
stops before a 19th mock generation. It reconstructs 36 messages and the exact
recorded call/result identities. The pre-fix replay also emitted
`compaction-protected-budget`, but measured conversation **17071**, not the
recorded **17423**. The original in-memory SDK frame was **not recorded**;
the remaining **352-token representation difference is not recorded** and must
not be invented. Recorded totals above remain authoritative. The replay's
raw input 27938 plus 2048 output and 2794 margin exceeds 32768 by 12.

The same replay after the fix measures conversation **16284**, input **27151**,
margin **2716**, output **2048**, total **31915**, fitting with 853 headroom.
Retiring the obsolete pair removes **787 net estimated tokens**, without altering
the current plan, specification, failure evidence or any mutation. This is more
than the recorded frame's 399-token excess, even retaining its unexplained
352-token difference. This is a counterfactual/replay, not a captured request 19.

B1 is conservative, not a matching tokenizer. SDK optional own-properties set to
undefined still have estimator overhead; JSON serialization discards them. The
replay's JSON-only conversation estimate is **16709**. This diagnostic is not a
wire request and does not prove real provider capacity. No estimator adjustment,
metadata stripping, tokenizer guess or reduced safety policy was used to fit.
No source group was charged twice by the planner. Its selection of a superseded
plan, rather than the original user authority, is the corrected ownership defect.

### Fix and Deterministic Reproduction

Only the existing `planCompaction` working projection changes. It retires a prior
`todo_write` call/result only when both it and a later replacement have unique,
paired, non-provider-executed calls and successful JSON acknowledgments with
`count` matching the bounded full todo list. The old result must precede the new
call, in the same user/system boundary. Parallel calls, duplicate IDs, malformed
or failed replacements, unresolved calls and approval-linked calls are retained.
Both parts of a retired pair leave hot context together; accompanying text and
every other tool/effect stay untouched. No UI message, transcript, project memory,
coverage pointer or durable revision is rewritten. It is not summarization and
does not claim completed workspace work from a completed todo.

The new deterministic production-planner fixture reproduces **exactly the
recorded component totals**: system 3617, schemas 7250, protected conversation
17423, reserve 2048, margin 2829 and ceiling 32768. It has a protected user task,
two eight-item plans, failed shell evidence, a successful effect, uncertain-effect
evidence and a recent intact tool group. Filler is explicitly test data used to
match size, not purported missing live evidence. Before the fix it failed with
the exact protected-budget code. Afterward it fits while preserving every
required constraint, current plan, failure, completed/uncertain effect and original
input object. No historical 8K test or threshold was weakened.

Additional tests cover narrative preservation; unsuccessful/unresolved/wrong-count
replacements; provider-executed, duplicate, concurrent and approval-linked calls;
new user boundaries; genuine overflow at **8K and 32K**; and production compactor
integration with no extraction, memory commit or original mutation.

### One Fresh Live Retest and Its Limit

Fresh workspace:
`C:\Users\Hayden\Documents\forgeboard-qwen-none-20261017-03`.
Evidence ID **`forgeboard-none-20261017-03`**, in the existing native evidence
directory. Metadata-only `preflight-1` made **zero inference requests**. The
original full specification was sent **once** in `mission-a-1`, with no reminders,
resends, manual Continue, correction, tuning or evaluator implementation.

No competing Clack process was active. An unrelated Talus Cargo/Rust test/build
was observed under `Desktop/talus/talusbackend/talus_sfu`; it was not Clack and
was left untouched. Source was frozen during inference: **934 source/config
files**, including the two new files, with identical before/after content hash
`201F2EA492BED260CF9DC2943285E7397BEEE9213C195BAACC56474A786ECD39`
and timestamp/length hash
`FC639902213E88E6B3EAE39C0AA973192939781F87126714E5CB27B309F08FAC`.
Owned host PID **42248**, runner **20356**; no owned host remained afterward.

All **14** actual native requests used exact model `qwen38-uncensored:latest`,
`num_ctx=32768`, `num_predict=2048`, explicit None / `think:false`, fallback Never,
the same 16 production tools and original 60-second idle / 600-second overall
deadlines. **Cloud inference 0; Automatic reruns 0.** Every request received a
normal final provider frame. One scoped lookup took **267 ms**, returning no
evidence; no old evidence timeout occurred.

Run start `1792218441049` (08:27:21.049 Europe/Paris). First useful native tool
frame **47.208 s**, first completed tool (nine-item plan) **47.325 s**. The first
shell `node --version; npm --version` succeeded at **57.796 s** under PowerShell.
The model made **15 tool calls**: three full nine-item plan updates, a directory
listing, a native directory creation, eight shell calls (seven executed exit 0,
one pending approval), an unread-target edit refusal and a missing-file read.
It created empty `packages/` and `packages/shared/` directories but no tracked or
untracked files. No tests, dependency install, build or application implementation.
The evaluator did not rescue its scaffold or reinterpret exit 0 as app completion.

The preserved original assistant contains **all three** plan snapshots. Later
native requests contain **only the latest** complete plan and its paired result.
The exact original specification remains present once, including port **4317**,
page size **50**, title maximum **120**, debounce **750 ms**, SSE, persistence,
no telemetry/cloud and verification requirements. The current unfinished plan
and subsequent edit/read failures remain in the final request. No requirement,
failure or tool effect was discarded to reach a favorable size. No actual memory
compaction/extraction occurred, so post-compaction model intelligence is not tested.

At **232.708 s**, the model requested:

`Set-Content -Path 'test.txt' -Value 'hello' -Encoding utf8; Test-Path 'test.txt'; Remove-Item 'test.txt'`

Tool call **`qKZ3HxykzTI2l19mvDilIVCnWDIpLNao`** entered
**`approval-requested`**, approval **`aitxt-INbPvoWhtpe1KIqkLcGyeX1W`**.
The command was **not executed**, including its write portion. Existing
`isStrictPermissionRequest` requires approval for `Remove-Item` even in Trusted
Workspace; persistence cannot bypass that gate. The harness intentionally ends
its observation when a pending approval requires user action. It retained run
state `running`, budget phase `complete`, 14 steps and no terminal error, then
closed its owned host. No approval was granted and the attempt was not resumed.

Classification: **PRODUCT POLICY / AWAITING DESTRUCTIVE-COMMAND APPROVAL /
INCOMPLETE**. Protected-budget live acceptance is **INCONCLUSIVE**: this fresh
trajectory never reached request 19. Final actual request 14 fit B1 with input
**16280**, output **2048**, margin **1628**; it did not stop on protected capacity.
The planned projection is exercised in actual requests, but passage of the prior
request-19 boundary is established only by deterministic fixture/replay, **not
by this live retest**. No second attempt or silent policy repair was performed.

### Verification and Scope

Focused planner/compactor/installed-SDK/retrieval/B1/F1: **210 tests / 7 files
passed**. Full frontend: **2758 tests / 198 files passed**, two workers, 64.42 s,
no raised timeouts or skipped tests. Type checking passed after correcting two
new test-fixture types. Full lint passed at **71 existing warnings / 2 infos**.
Runner syntax and the offline SDK replay passed. `npm.cmd run build` passed
(TypeScript and 1252 Vite modules, existing dynamic-import/plugin-timing warnings).
`git diff --check` passed with existing LF/CRLF notices. No Rust source changed;
full Rust gates were not redundantly rerun. The cached native test host compiled
and ran through production IPC. No Computer Use, native GUI, Linux/macOS or WSL
acceptance was performed. No unrelated files, stashes, `autonomous_tracker/` or
prior evidence were touched. No push or subsequent checkpoint.

## Persisted Approval Audit and Resumption Boundary, 2026-10-17

This is an evidence-only follow-up to `97148e9`, not another ForgeBoard mission.
Baseline: clean `main`, **38 ahead / 0 behind** recorded `origin/main`.
Process inspection found no active Clack acceptance host, Clack application,
Cargo/Rust build, Vite test/build or competing Clack harness. No process was
terminated. The original evidence and scratch repository still exist.

### Exact Effect and Safety Audit

- Evidence ID: `forgeboard-none-20261017-03`.
- Evidence directory:
  `C:\Users\Hayden\Documents\clack\src-tauri\target\real-qwen-product\forgeboard-none-20261017-03`.
- Session: `real-mission-a`; run: `real-mission-a:1792218441049`.
- Tool call: `qKZ3HxykzTI2l19mvDilIVCnWDIpLNao` (`bash_run`).
- Approval: `aitxt-INbPvoWhtpe1KIqkLcGyeX1W`, still `approval-requested`.
- Exact command:

```powershell
Set-Content -Path 'test.txt' -Value 'hello' -Encoding utf8; Test-Path 'test.txt'; Remove-Item 'test.txt'
```

The authoritative persisted profile and run both bind the workspace to
`C:\Users\Hayden\Documents\forgeboard-qwen-none-20261017-03`.
The preceding completed native shell results report that same `cwd_after`;
there is no intervening command changing directory. All three literal operands
resolve to the single target
`C:\Users\Hayden\Documents\forgeboard-qwen-none-20261017-03\test.txt`.
The native host is no longer alive, so this is the last evidenced cwd, not a
claim that its former persistent shell can still be queried.

The target does not exist. The workspace and inspected parents through Hayden's
home are not reparse points or links. No wildcard, recursion or force flag is
present. The command does not target Clack, another project, home data outside
the scratch repository, credentials, models or system data. Its write/read/delete
sequence is a disposable shell-write probe following a failed unread-target edit
and missing root manifest; that purpose is inferred from the adjacent transcript,
not a fabricated model explanation. It would create `hello` and remove the same
new file, not erase user/evaluator source. No tracked file would be removed;
the probe is recreatable but not Git-recoverable because it is untracked.

**The exact effect passes the requested safety policy.** Production
`isStrictPermissionRequest` classifies its `Remove-Item` segment as strict;
`canPersistPermission` rejects a lasting grant. Coder remains Trusted Workspace
with no category overrides. No configuration, permission mode or grant changed.
However, **no approval response was sent**, for the lifecycle reason below.
The write portion and deletion both remain unexecuted.

### Confirmed Harness Resumption Blocker

The previous report's `running` metadata is not a surviving process or executable
continuation. The harness observation loop in
`src/test/realLocalProductAcceptance.tsx` returns when a pending approval appears.
After recording the report, `scripts/check-real-local-product.mjs` closes its
owned native host in `finally`. The previous host **42248** and runner **20356**
are absent. The shell and SDK approval responder belonged to that exited host.

Normal `hydrateSessions()` calls `recoverInterruptedSessions()`: every persisted
`running` run becomes `interrupted`, retaining its original identity. It clears
the runtime approval maps. `AgentRunBridge.pendingApprovalsForRun()` returns no
actionable approvals for an interrupted run, and its effect removes the approval
responder unless the run is `running`. `respondToApproval()` delegates only to a
registered live responder. These are existing deliberate no-replay protections,
not evidence that the model failed or the safety classifier was wrong.

A read-only execution of the production recovery helper against the actual saved
session confirmed `running -> interrupted`, unchanged run start/identity,
idempotent repeated recovery and no mutation of the original JSON. This was an
in-memory diagnostic, **not a native restart** and not a persisted state change.
The existing bridge regression test confirms interrupted approvals are not
revived. Restarting this host cannot provide the requested same-running-approval
continuation through the current production path.

The existing `resume-a` harness phase is also unsuitable: it explicitly sends
`Continue the original ForgeBoard project from the existing state.` through
`sendMessageToSession()`. It was **not invoked**. No approval was forced into
saved JSON, no run state changed to running, no stale SDK response injected and
no replay protection bypassed. No harness or production repair was attempted.
The acceptance stopped at this concrete resumption limitation as instructed.

Follow-up classification: **TEST_HARNESS / APPROVAL HOST TEARDOWN /
SAME-RUN RESUMPTION UNAVAILABLE**. The original attempt's **PRODUCT POLICY /
AWAITING DESTRUCTIVE-COMMAND APPROVAL / INCOMPLETE** classification above remains
historically correct. Neither result is a model failure. Live passage of the
request-19 protected-budget boundary remains **INCONCLUSIVE**, not verified fixed
by this follow-up. This does not invalidate the earlier deterministic/replay fix.

### Request, Context and Project Evidence

There were **zero new inference requests**, effects, approvals or messages.
Request 14's effect remains pending; requests 15-18 and request 19 preparation
and sending did not occur. No new compaction, summary extraction, retrieval or
project-evidence preparation ran. A post-resumption protected budget therefore
does not exist and must not be substituted with the offline replay budget.

The last actual request, still request 14, measured system **3617**, schemas
**7250**, conversation **5413**, input **16280**, output **2048**, margin **1628**,
total **19956**, ceiling **32768**. This is the recorded wire-budget estimate,
not a request-19 protected estimate. Memory revision remains null. All three
original accepted plan pairs remain in the durable transcript. Reinspection of
the actual request-14 body found only the latest plan call
`keS1NwWeWHrOhwj2yMUeIcklPHbeJcSe`; older calls
`r2ExLMWHZE9XWD948NSy8KS0lAvSEyZz` and
`fFwQpUOj7SVgh5Gh1zfBMKhMNk4BWLS8` are absent from that hot request.

The one original user specification in request 14 retains ForgeBoard, port
**4317**, page size **50**, title max **120**, debounce **750 ms**, SSE,
persistence and no telemetry/cloud. The current plan and edit/read failures
remain as previously recorded. **No post-compaction context or model continuity
was observed** in this follow-up. The 50-to-25 correction condition was not met:
zero successful file writes/edits and no page-size implementation. No correction,
Continue, reminder, requirement resend or evaluator implementation was supplied.

Read-only project inspection found only `.git/`, empty `packages/` and empty
`packages/shared/`; `test.txt` and root `package.json` are absent. Git reports
`No commits yet on main`, no tracked/untracked project files. No manifests,
application source, dependencies, README, test or build artifacts exist. Qwen
ran no additional commands, tests, installs or build. No additional approval
appeared; the blocker is the lost live approval lifecycle, not a new budget error.

All 14 preserved native request bodies were revalidated: exact
`qwen38-uncensored:latest`, `num_ctx=32768`, `num_predict=2048`, `think:false`,
16 production tools. Fallback remains the original Never policy; no settings
were changed. Original native idle **60 s** and overall **600 s** deadlines were
not changed or newly exercised. Cloud inference remains **0**. No Automatic run,
fresh repository, fresh mission or native GUI interaction occurred.

### Validation and Preservation

Focused existing tests: **103 passed / 5 files**, covering bridge approval
ownership/no-revival, restart recovery, run lifecycle, strict permissions and
chat runtime. Command:

```text
npm.cmd test -- src/modules/ai/components/AgentRunBridge.test.ts src/modules/ai/lib/restartRecovery.test.ts src/modules/ai/lib/runLifecycle.test.ts src/modules/ai/lib/permissions.test.ts src/modules/ai/store/chatRuntime.test.ts --maxWorkers=2
```

The first sandboxed Vitest attempt executed no tests because its temporary-cache
rename failed with EPERM; the same command passed outside that restriction.
An initial ad-hoc SSR diagnostic importing the React bridge hit Vite's CSS-loader
initialization error, not native application execution. The narrowed read-only
production recovery/permission audit passed; bridge behavior was verified using
the existing Vitest fixture instead. These tooling attempts made no inference or
workspace effects. Full gates were intentionally not rerun for a docs-only update.
`git diff --check` passed with an LF/CRLF notice. An append-only report check
confirmed every byte of prior report text remains unchanged after normalizing
line endings, and the report is the only tracked modification.

Preserved SHA-256 evidence fingerprints:

| Artifact | SHA-256 |
| --- | --- |
| `data/terax-ai-sessions.json` | `E06C8CC5B6774D418AC6856908FCC40369C3C9F703B99E059CE3BF3D64B4FFFF` |
| `mission-a-1.json` | `DF42D2F8400CFBA907BC93B36DD2FF47EC263D773B38E420C7D9C5F46EAC7B0B` |
| `mission-a-1.jsonl` | `C61999C4D64D7B6E75ED3C2AA891A8CA9D06974610DEC080ED486DFF569DDAD0` |
| `mission-a-1.requests.jsonl` | `600689C7C90957598D23089B22D686F6111C382357EBB70C79205B51E255B105` |

Only this report changes. Production source, harness source, original evidence,
session/settings data, scratch project, unrelated user work, stashes and
`autonomous_tracker/` remain untouched. No push. No later checkpoint started.

## Live Approval Harness and Fresh -04 Acceptance, 2026-10-17

Checkpoint baseline: `83de782`, clean `main`, **39 ahead / 0 behind** recorded
`origin/main`. No competing Clack application, acceptance, editing, Cargo/Rust,
Vite test/build or harness process was found before preparation or immediately
before the mission. Unrelated processes were not stopped. The dead `-03` run was
neither resumed nor overwritten; its session and request-audit SHA-256 hashes
still match the preceding section. That **TEST_HARNESS** result remains intact.

### Lifecycle Correction

The root cause was the observation loop in
`src/test/realLocalProductAcceptance.tsx`: a pending approval caused it to return,
which finalized the report. The browser entry then called `coworking_exit`;
the Node runner also tears down its owned native child in `finally`. A valid
permission pause consequently destroyed the responder needed to resolve it.

The fixture now awaits `observeAcceptanceRun()` in
`src/test/acceptanceApprovalLifecycle.ts`. Pending approval is nonterminal,
including the React interval before the responder/pending store has settled.
The mounted AgentRunBridge, PeerTask bridge, Wry host, Vite server and evidence
stream remain owned by the unfinished phase. Terminal run states still return.
Every approval emits pending, evaluation, submission and observed effect evidence.
There is no report/child teardown merely because an approval exists.

The Node runner's acceptance-only `/approval` route invokes
`scripts/acceptance-approval.mjs` and records its decision and live host PID.
Its expected owner comes from ordered production session/run state observations
for `real-mission-a`, bound to the configured scratch root. Terminal state clears
that owner; a normal authorized correction can establish its new live run owner.
The browser rechecks run, workspace, cwd, exact input and responder immediately
before calling the existing production
`respondToApproval(id, true, sessionId)`. AgentRunBridge remains the owner of
`addToolApprovalResponse`. No persisted approval/session state is manufactured.

The evaluator is deliberately **not** a general PowerShell parser, destructive
command allow rule or sandbox. It qualifies only this complete reviewed probe:

```powershell
Set-Content -Path 'test.txt' -Value 'hello' -Encoding utf8; Test-Path 'test.txt'; Remove-Item 'test.txt'
```

All three operands must be the literal `test.txt` in the exact live disposable
ForgeBoard repository root. The root must resolve without a link/alias and have
its own `.git` directory; the target must be absent, including no existing link.
Unknown commands, additional effects/flags, other filenames, nested/escaping or
absolute operands, wildcards, existing files, changed cwd and foreign ownership
fail closed. This is task-related disposable write/read/delete diagnosis, not
permission to delete application files or other data. No permission profile,
Full Access setting or persistent grant changes. The old `-03` command remains
safe but unexecuted; its destroyed responder is not recreated.

Each approval has a **30-second acceptance-only lifecycle bound**, including
responder availability, evaluator response and observed tool resolution. A stalled
evaluation is aborted. A bound failure or refused/ambiguous effect records
**HARNESS-BLOCKED**, flushes evidence and calls normal `cancelRun` before report
completion, denying pending effects through production cancellation. No retry.
The overall existing 90-minute harness bound remains; production **60-second idle
and 600-second per-request overall** deadlines are unchanged.

Decisions are per effect, with at most 64 tracked approval identities. A submitted
ID is never submitted twice. Changed inputs/owners and reusing one tool call
under another approval ID are rejected. Inputs are captured independently of
mutable SDK objects. The original correction predicate and wording are unchanged;
a harness refusal cannot accidentally trigger a subsequent correction run.

### Deterministic and Native Verification

**135 tests / 7 files passed**, including **32 new tests**: 13 lifecycle/SDK
tests and 19 filesystem-policy cases. The actual installed SDK Chat fixture
requests approval through `needsApproval`, remains paused without execution,
then resumes through Clack's production store responder into SDK approval
resolution. Its tool executes **exactly once**, the same chat/run ownership is
retained, and its original user message remains the only user message. Additional
cases cover an unresolved evaluator keeping the phase logically active, unsafe
paths with zero execution, foreign session/run/workspace, stale/in-place input
changes, duplicate/reused IDs, delayed bridge settlement, bounded missing
responder/evaluator and unchanged restart no-revival. Filesystem tests reject
wildcards, extra commands, force/recursive flags, existing data and root junctions.

The 103 existing bridge/recovery/lifecycle/permission/runtime tests remain passing.
Native Windows `cargo test --locked --lib modules::shell:: --target-dir
target/codex-test` passed **11 tests**, including Windows/WSL identity serialization
and sentinel isolation. WSL execution itself was not tested. Type checking passed
after correcting only new fixture usage types and the harness sleep return type.
Focused Biome lint passed with no diagnostics; all three changed/new `.mjs` files
passed `node --check`; `git diff --check` passed with LF/CRLF notices. No full
production suite/build/Clippy rerun was needed for harness/tests/docs-only scope.
No Rust source, approval/recovery semantics, compaction logic, memory architecture,
model profile or production runtime setting was changed.

### One Fresh Native Mission

Workspace: `C:\Users\Hayden\Documents\forgeboard-qwen-none-20261017-04`.
Evidence ID: **`forgeboard-none-20261017-04`** under
`C:\Users\Hayden\Documents\clack\src-tauri\target\real-qwen-product`.
It was verified unused and initialized as an empty Git repository. Metadata-only
`preflight-1` made zero inference requests. `mission-a-1` sent the unchanged
**2086-character** original specification exactly once. Persisted user-message
count is **1**; no Continue, reminder, correction, requirement resend, tuning or
evaluator implementation was supplied. No Automatic rerun or second fresh mission.

Owned native host **10680**, runner **20432**. Session `real-mission-a`, run
**`real-mission-a:1792221985087`**. The source was frozen during inference: **938
source/config files**, identical before/after content hash
`1A543644782B8055699AB749236A79CC7DE84CF351E89161E3033A914D39861A`
and timestamp/length hash
`D27A829F97920C07FD9BF5FA91A75D5F7DD839253BD06824265773DA12347E16`.
Final-review harness-only stale-input/replay guards and their tests were added
after this mission ended; the mission was not repaired, resumed or repeated.

All **26** native bodies retain exact `qwen38-uncensored:latest`,
`num_ctx=32768`, `num_predict=2048`, explicit None / `think:false` and the
authorized localhost tunnel. Fallback remains Never; **cloud inference 0**.
**Control deviation:** requests 1-24 expose 16 tools, but the existing production
tool selection exposes **10** on automatic continuation requests 25-26. This was
identified in the final wire audit, not prevented or silently corrected. Therefore
the complete trajectory cannot be claimed to preserve the requested 16-tool
control. This checkpoint did not change or repair production tool selection.

First completed useful tool (directory inspection): **24.222 seconds** after run
start. The first shell command `node --version; npm --version` completed under
the advertised PowerShell syntax. Qwen made **29 tool calls**: directory inspection,
10 shell calls, one seven-item plan, one multi-edit, seven edits, six reads and
three directory creations. Unread/missing-target and empty-old-string refusals
were preserved. Four edits succeeded after the model created/read placeholders.
One normal production automatic continuation followed the 24-step batch without
a new user message. **No pending approval appeared**, so no live approval ID,
decision, approved effect or native post-approval resumption was observed. Native
approval acceptance remains unexercised in this model trajectory; the explicit
approval path is supported by deterministic/SDK tests, not claimed native evidence.

### Request 19, Budget and Continuity

Request **19 was prepared, sent and completed**, native send timestamp
`1792222328231`, engine finish `1792222362639`. Its seven-item accepted plan
`Sj17jhnIdBpfg6jGBtYbRT7JZ5jDF9If` remains present with unresolved obligations,
along with the original task, failures and successful effects. Actual outgoing
requests 19, 25 and 26 retain port **4317**, page size **50**, title max **120**,
debounce **750 ms**, SSE, persistence and no telemetry/cloud requirements.

| Request | System | Schemas | Conversation | Input | Output | Margin | Total | Ceiling |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 19 | 3617 | 7250 | 9902 | 20769 | 2048 | 2077 | 24894 | 32768 |
| 24 | 3617 | 7250 | 12214 | 23081 | 2048 | 2309 | 27438 | 32768 |
| 25 | 3702 | 4419 | 12465 | 20586 | 2048 | 2059 | 24693 | 32768 |
| 26 | 3702 | 4419 | 13385 | 21506 | 2048 | 2151 | 25705 | 32768 |

These are actual captured wire-budget **estimates**, not provider token counts or
post-compaction protected estimates. Unlike the old failing trajectory, this
mission did not reach comparable context pressure. There was only **one** accepted
plan, so superseded-plan exclusion was not exercised. No summary extraction or
memory commit occurred; memory revision remains null. Extraction cost **0**;
the initial scoped lookup took **356 ms**, returning zero chunks/reads/bytes.
No retrieved/project evidence was injected. No protected-budget error occurred.
Passing request number 19 alone is **not** live verification of `97148e9`.

### Exact Stop and Actual Project

Requests 1-25 have normal final provider frames. Request 26 delivered HTTP 200,
then **43 native IPC frames / 6189 bytes**: 42 non-whitespace text frames and one
whitespace frame. It produced **no tool call or final provider frame**. Last
meaningful frame: `1792222527073`; last raw frame: `1792222527196`; native timeout:
`1792222587075`, exactly **60002 ms** after meaningful progress. The runtime
recorded `stream-idle-timeout`, retained partial text, finalized the run as failed
and preserved evidence. The idle cause upstream of observed IPC delivery remains
unconfirmed; final generated-token usage for request 26 is unavailable and is not
inferred from frames/bytes/text. Total mission time **608.163 seconds** is not a
per-request 600-second overall timeout: request 26 lasted about **65.739 seconds**.

Classification: **PRODUCT RUNTIME / STREAM-IDLE-TIMEOUT / INCOMPLETE**.
Harness report `ok:true` means report execution completed, not ForgeBoard success.
No harness approval timeout/teardown failure occurred. The native host stayed
alive until reporting and exited; no owned host/runner/Vite process remained.
Compaction-pressure live acceptance remains **INCONCLUSIVE**. The 16-to-10 tool
control deviation and stream stall are separate follow-up findings, not repaired
or retried in this mission. This is not an established model-only failure.

Actual files: root `package.json` (721 bytes), `packages/backend/package.json`
(546), `packages/backend/tsconfig.json` (583), `packages/backend/src/domain.ts`
(1259). Empty backend test/frontend source directories exist. The source defines
task types and a title-limit constant, but no API/server, persistence, SSE runtime,
frontend app, installed dependencies, tests, build output or README exists.
Project Git remains unborn `main`, with untracked `package.json` and `packages/`.
Four edits succeeded but no page-size-50 implementation met the unchanged
correction predicate; **50-to-25 correction count 0**. No project tests/build,
dependency install or Git commit was performed by Qwen or the evaluator.

Fresh evidence SHA-256:

| Artifact | SHA-256 |
| --- | --- |
| `mission-a-1.json` | `0051AC5153FBC6793F7DFD6314F0E3F6D080A4FE7440FB487B93620707863CAD` |
| `mission-a-1.jsonl` | `5F10D27DE8E4A2E9F18E4B5F414563E26658097C21CB7CE8956CAC7140BC2F65` |
| `mission-a-1.requests.jsonl` | `2C01ABEBC104D0794CBD538000CC6BDF1768F22595772F69FDDDC5F3AD18711F` |

Only acceptance harness/tests and this report changed. No Computer Use, native
GUI interaction or Linux/macOS native verification. Unrelated work, stashes,
delegation files, `autonomous_tracker/` and previous attempts remain untouched.
No push, no subsequent checkpoint and no production repair.

## Request-26 Forensics and Tool Selection, 2026-10-17

Baseline: `f812806`, clean `main`, **40 ahead / 0 behind** recorded `origin/main`.
Process inspection found no competing Clack acceptance, editing, test/build,
Cargo/Rust or native harness process. This checkpoint used preserved `-04`
evidence only. No ForgeBoard mission, request-26 inference replay, model tuning,
Automatic run, requirement resend, correction or Continue was performed. No
production source, 60-second idle policy or 600-second overall deadline changed.
All prior historical grades remain intact; this section refines their diagnosis.

### Exact Timeline and Recording Layer

Request **`inference-26`** belongs to `real-mission-a:1792221985087`.
The preserved native dispatch audit reconstructs the complete structural JSON
body: model, messages, 10 tool schemas, stream flag and controls. Its JSON
reserialization SHA-256 is
`417A318B04952FC800BC391AAA70220394881FDC0C7C3E23AC89B813F9B3515F`;
this fingerprints captured structured JSON, not physical network packet bytes.
The original evidence files retain the hashes in the preceding section.

**Instrumentation layer: native IPC chunk delivery to the webview, not socket
receive or Ollama's generation clock.** The existing acceptance observer inspects
each native channel chunk without changing bytes, and timestamps completed NDJSON
frames. No additional tracing was needed to classify delivered progress.

All times below are UTC, with Unix epoch milliseconds. Europe/Paris was UTC+02.

| Event | UTC, 2026-10-17 | Epoch ms |
| --- | --- | ---: |
| Channel observer created | 07:35:21.320 | 1792222521320 |
| Native request dispatch captured | 07:35:21.336 | 1792222521336 |
| Native admitted attempt start | 07:35:21.361 | 1792222521361 |
| HTTP 200 headers delivered | 07:35:22.041 | 1792222522041 |
| First raw IPC chunk / first parsed frame | 07:35:22.042 | 1792222522042 |
| Separate first-byte receipt | 07:35:22.043 | 1792222522043 |
| Last meaningful text delta | 07:35:27.073 | 1792222527073 |
| Last raw IPC chunk / last parsed frame | 07:35:27.196 | 1792222527196 |
| Native admission capacity settled | 07:36:27.074 | 1792222587074 |
| Timed-out transport event delivered | 07:36:27.075 | 1792222587075 |
| Partial-answer segment finalized interrupted | 07:36:27.076 | 1792222587076 |
| Logical run finalized failed | 07:36:27.079 | 1792222587079 |

Final reasoning delta: **not recorded**, with zero reasoning-category frames.
Final tool-call-related frame: **not recorded**, with zero tool-category frames.
Final empty/provider-metadata NDJSON frame: **not recorded**, with zero such
category frames. The last frame was whitespace **text**, not provider metadata.
Exact native monotonic idle-watchdog start/reset timestamps: **not recorded**.
Explicit cancellation timestamp: **not recorded**. Physical socket close timestamp:
**not recorded**. No stream EOF was recorded; terminal IPC settlement is not a
socket-close measurement. Per-SDK-part timestamps were not instrumented in this
live mode (`sdk: {}`); persisted answer/activity metadata supplies the distinct
segment-finalization timestamps above.

### Raw, Parsed and Meaningful Activity

The bounded trace has **43 chunks, 6189 bytes, 43 valid NDJSON frames**, zero
invalid/oversized/dropped frames, zero pending bytes, and zero evicted trace
events. There are **42 non-whitespace text frames** and one **2-character
whitespace-text frame**. No reasoning, tool call, provider error or final category
appears. Internal maximum received-chunk/frame gap was 130 ms; that statistic
does not include the later silent interval and must not be presented as evidence
of continuous delivery through timeout.

The final-60-second window starts at `1792222527075`. It contains exactly one
raw-delivery event and its one parsed whitespace frame, at `1792222527196`:
**123 ms after the last meaningful text**, **121 ms inside** that window.
There was no later delivered chunk or parsed frame for **59879 ms**. There was
no meaningful delivered progress for **60002 ms**. Therefore a literal statement
that absolutely no raw activity occurred in the entire final 60 seconds would
be wrong. The distinction does not indicate a missed valid progress delta.

Native/socket receive times, TCP/SSH tunnel activity and server-side generation
timestamps are **not recorded**. No claim is made that IPC timing proves exactly
when Ollama or the socket stopped producing bytes. What is directly established
is the absence of further native-IPC-delivered progress, without trace eviction,
unfinished parser bytes or an observed unparsed frame.

### Timeout Owner and Classification

The existing native owner is `src-tauri/src/modules/net/inference/mod.rs`:
`execute()` feeds each received byte chunk into `progress::Progress`, resets the
idle deadline only when `Progress::feed()` returns meaningful progress, then emits
the unchanged chunk. `guarded()` races work against cancellation and the earlier
progress/overall deadline. The parser in `progress.rs` recognizes non-whitespace
Ollama text/thinking and nonempty tool calls; whitespace does **not** reset idle.
Its source does not require the webview observer to acknowledge a reset.

The observed 60002-ms interval is consistent with that owner correctly timing
out absent meaningful generation progress. The final whitespace frame is not a
valid reason to reset the watchdog. No evidence supports Case B (raw activity
discarded by parsing), Case C (valid progress ignored), or Case D (delivered final
frame lost). This is the meaningful-progress form of a provider-stream stall,
not the stricter Case-A assertion that every raw byte was absent for >=60 seconds.

Refined classification: **PROVIDER-STREAM / DELIVERED MEANINGFUL-PROGRESS STALL /
STREAM-IDLE-TIMEOUT / INCOMPLETE**. **No Clack transport/progress-accounting defect
is demonstrated; the watchdog behaved consistently with its intended policy.**
Whether the upstream cause was engine generation, server, tunnel/network or a
pre-IPC delivery issue remains **unconfirmed**. An engine-internal hang is not
proven by this trace. That limitation does not require replay to answer whether
the recorded Clack stream missed real progress. No new reproduction was run.

No `done:true` or final usage frame was **observed**. `done_reason` and final
request-26 token usage are **not recorded**. This does not prove the server never
emitted a frame outside the recorded delivery path. The interrupted answer
segment's provisional input/output zeros lack `usageReported`; they are not
provider measurements and must not be reported as zero generated tokens.
The timeout was idle, not overall: request dispatch to settlement was **65739 ms**.

### Request Structure and Preserved Work

The request continued the original ForgeBoard implementation objective: local
React/TypeScript + Node/TypeScript, npm, backend port 4317, page size 50, title max
120, 750-ms debounce, SSE, restart-safe local persistence, validation/tests/build
and no telemetry/cloud. The last and only user message remains the original
2086-character specification, with the same production shell/workspace envelope
on the wire. No 50-to-25 correction occurred. The system contains the normal
logical-batch continuation instruction, not a new user request.

The sole accepted seven-item plan had scaffolding `in_progress`; backend core,
backend tests, frontend core/tests, verification and README were `pending`.
After the terminal error Clack finalized unfinished todo statuses as `failed`;
that does not mean Qwen declared all work failed or completed it.

Recent results show the empty-`old_string` edit refusal, then a successful
PowerShell placeholder write, a read of its 30-byte prefix, then successful
`edit` **`UMbEuB2NMEKxnsk6bKcoYztnqe3qXV9a`** writing **1259 bytes** to
`packages/backend/src/domain.ts`. Request 26 was an implementation continuation
after those file-creation difficulties, not a request for a final prose answer.
It began **168 characters of partial answer text** about its workflow but made
no tool call. No private reasoning text is reproduced here.

The assistant part remained `streaming`; durable answer metadata says `incomplete`
with the last segment `interrupted`. All **29 distinct** earlier tool calls have
one durable output part each. No tool/approval/effect was pending at termination;
the last successful write remains intact. No project files were changed by this
audit, and no inference/effect was replayed.

### Why 16 Became 10

Request 24 schemas:

```text
read_file, list_directory, create_directory, edit, multi_edit, grep, glob,
bash_run, bash_list, open_preview, todo_write, read_agent_output,
communicate_peer_task, request_peer_task, cancel_peer_task, propose_custom_tool
```

Requests 25 and 26 schemas, identical to each other:

```text
read_file, list_directory, create_directory, edit, multi_edit, bash_run,
bash_list, open_preview, todo_write, request_peer_task
```

The six omitted schemas were **`grep`, `glob`, `read_agent_output`,
`communicate_peer_task`, `cancel_peer_task`, `propose_custom_tool`**.
The owner is F1 `prepareToolExposure()` / `selectToolSchemas()` in
`src/modules/ai/lib/toolExposure.ts`, called by `runAgentStream()` in `agent.ts`.
The initial selection stays pinned within an SDK batch. When the 24-step batch
ends in tool calls, the existing budget owner schedules one authorized automatic
continuation. A new agent batch recomputes selection using the same objective and
the accumulated SDK/UI history, rather than permanently pinning all first-batch
optional schemas. Seven previously used tool types are mandatory and retained:
`bash_run`, `create_directory`, `edit`, `list_directory`, `multi_edit`, `read_file`,
`todo_write`. Optional schemas are ranked deterministically, with stable name
tie-breaking, dependencies and a history-sensitive bounded schema allowance.
This is not permission loss, model switching, stale approval state or a B1 block.

The read-only diagnostic `scripts/diagnose-ollama-stall.mjs` reconstructs the
pre-request-25 UI prefix through the installed SDK, including typed JSON tool
results, and runs the production selector against the **16 captured schemas**.
It reproduces **exactly the observed ten names**, including after candidate-order
reversal and repeated evaluation. Using only the original user history admits
all 16; the accumulated history changes optional-schema headroom. The actual
full candidate pool, historical cache key/hit and exact in-memory selection frame
were not logged, so this reconstruction is explicitly limited to recorded schemas
and SDK-derived history; it does not fabricate those missing runtime observations.

Schema estimates fall **7250 -> 4419**, saving **2831** estimated tokens, with
serialized schema bytes **14814 -> 9016**. This is successful context-efficiency
behavior for the observed implementation step. None of the omitted tools was
previously called, pending or explicitly required for request 26. Direct
read/edit/directory/shell tools remained available; the task prohibited delegation,
and no custom-tool proposal was needed. `write_file` was already absent from
request 24, so its absence is not caused by this reduction. Search tools might
be relevant later, but no observed requirement at this boundary was lost.
There is **no evidence** that the reduction caused the provider-stream stall;
this audit does not claim to prove a counterfactual causal effect. No tools were
restored merely to keep a fixed count. The earlier control-deviation observation
remains historically accurate, now explained as intentional production selection.

### Continuation and Engine State

At `1792222448025`, run budget state became `auto-continue-pending` at 24 steps;
at `1792222448027`, continuation count became 1 with the same run start
`1792221985087`. No user message was injected. Requests 24-26 each contain exactly
one unchanged user envelope/specification; historical tool calls/results are
paired once per ID: **27/27**, **28/28**, **29/29**, respectively. Those repeated
historical observations are not repeated execution. Request 25 executed only its
new edit; request 26 executed no tool. There is no observed inference replay.

All native bodies retain exact `qwen38-uncensored:latest`, context **32768**,
output **2048**, explicit None / `think:false`, original profile identity and
configuration revision 1, fallback Never and cloud inference **0**. Agent
permission profiles before/after the mission compare equal. The only count change
is the explained F1 exposure decision; objective/model/reasoning stayed correct.
No D2/D3 or context/compaction change is needed by this evidence.

The already-recorded post-timeout `/api/ps` fetch completed and returned the exact
model loaded with `context_length: 32768` and runner `llamacpp`. That establishes
metadata/control-plane responsiveness, **not successful generation recovery**.
Exact metadata-fetch timestamp/status and server-side request status are
**not recorded**. There was no captured Ollama provider-error frame or native
inference error other than `stream-idle-timeout`. The later Chrome window-class
unregistration message belongs to host teardown, not an Ollama error. No GPU
utilization claim is used, and no new metadata or inference call was made here.

### Verification and Scope

**138 focused frontend tests / 5 files passed**: acceptance stream tracing,
F1 selection, logical-run budget/runtime and interrupted/no-replay recovery.
The added trace regression specifically distinguishes 123-ms whitespace delivery,
59879-ms raw silence and 60002-ms meaningful silence without inventing EOF/usage.
**34 native Windows transport/parser tests passed** using the isolated Cargo
target, including true idle, whitespace/metadata, thinking/tools, slow progress,
overall deadline, cancellation, completion and cleanup. These use deterministic
local test fixtures, not Ollama or a live ForgeBoard mission.

Type checking, focused Biome lint, diagnostic script syntax, the read-only actual
evidence/selector audit, and `git diff --check` passed. Full suites/build/Clippy
were intentionally not repeated: no production source or Rust source changed.
The diagnostic bounds every input file below 4 MiB, emits structural/timestamp
metadata without private reasoning, closes its temporary module loader and makes
zero inference calls or native tool effects. Preserved evidence hashes match.
No native GUI/Computer Use or Linux/macOS native verification. Unrelated work,
stashes, delegation files, `autonomous_tracker/` and ForgeBoard remain untouched.
No push, timeout adjustment, live replay, or subsequent checkpoint.

## Native Receive-Boundary Diagnostic, 2026-10-17

### Scope and Preserved Baseline

Resumed clean `main` at `669dc25`, **41 ahead / 0 behind** recorded `origin/main`.
This is one provider-only transport replay, not a resumed/fresh ForgeBoard mission
or a D3 effects replay. No Computer Use, new user message, Continue, correction,
delegation, Automatic experiment, tuning ladder or implementation by the evaluator.

The request-26 historical classification and timestamps above remain unchanged.
Its three original artifacts still match their recorded SHA-256 values:

| Original `forgeboard-none-20261017-04` artifact | SHA-256 |
| --- | --- |
| `mission-a-1.json` | `0051ac5153fbc6793f7dfd6314f0e3f6d080a4fe7440fb487b93620707863cad` |
| `mission-a-1.jsonl` | `5f10d27de8e4a2e9f18e4b5f414563e26658097c21cb7ce8956cac7140bc2f65` |
| `mission-a-1.requests.jsonl` | `2c01abebc104d0794cbd538000cc6bdf1768f22595772f69fdddc5f3ad18711f` |

Fresh evidence ID: **`request26-receive-20261017-01`**, directory
`src-tauri/target/real-qwen-product/request26-receive-20261017-01/`.
Artifacts: `stream-diagnostic-1.json`, `.jsonl`, `.requests.jsonl`,
`.receive.jsonl`, `isolation-before.json`, `isolation-after.json`,
`correlation.json`, `labpc-clock.json`, and the two bounded
`labpc-{historical,replay}.journal.log` excerpts. These local evidence files stay
outside Git; no prompts, original transcript, tool arguments or private reasoning
are added to this document or the new receive trace.

### Instrumentation and Boundaries

The lowest new timestamp is immediately after
`reqwest::Response::bytes_stream().next()` yields bytes in the production native
inference owner, **before** `Progress::feed` and channel forwarding. This is
**HTTP body delivery to Clack**, not a physical TCP/socket read or packet timestamp.
It cannot observe bytes buffered inside the OS, SSH, hyper or reqwest. Header
receipt establishes that an HTTP response exists; a separate TCP establishment
instant is not observable here and is not invented.

The debug-only `AcceptanceDiagnostics` state is installed only by the invisible
acceptance example, with an explicit flag restricted to `stream-diagnostic-*`.
There is no IPC enable command or normal application registration. Release builds
use a zero-sized no-op trace; ordinary debug requests have no recorder, timestamp
reads, event allocation or sink invocation. There is no new dependency.

Per request the recorder retains at most **8192 metadata stamps**, aggregate byte
and chunk counts, independent last-body/last-forwarded stamps, and a dropped-event
count. A stamp contains only an allowlisted enum category, epoch milliseconds,
monotonic elapsed microseconds, chunk sequence and byte length. No response data,
headers, URLs, credentials, prompts or reasoning enter this API. The completed
bounded snapshot is written once to the owned acceptance file; it is volatile
until settlement/drop and is not claimed to survive forcible process termination.

Categories distinguish dispatch, headers, each body chunk, meaningful progress,
IPC attempt/success/rejection, provider-final recognition, actual HTTP EOF, outcome
(completion, transport error, observed cancellation/deadline, other failure), and
future drop. Cancellation/deadline timestamps are native observations of the
guarded outcome, not an invented timestamp of an external Stop command. Final
body identity is retained independently in `lastBody`; EOF is not fabricated on
timeout or on the SSE `[DONE]` early-stop path.

Native sequence numbers correlate body receipt to channel enqueue/return. The
existing acceptance observer timestamps actual webview channel delivery separately;
ordered per-request chunk lengths/counts join these observations. A successful
native channel send is **not** mislabeled as confirmed webview delivery.

The diagnostic chain now distinguishes:

1. No delivered HTTP body bytes: upstream of this body reader, potentially
   Ollama/model, server, SSH/network or buffering below the hook; not proof of
   which upstream component is responsible.
2. Body delivered but not forwarded/delivered over IPC: native forwarding/IPC
   boundary; retain attempt, success/rejection and webview observations separately.
3. IPC delivered but valid frames not parsed: adapter/parser boundary.
4. Parsed meaningful frames without native progress recognition and correct idle
   behavior: progress-accounting boundary.

Raw bytes, whitespace and metadata still do **not** reset meaningful progress.
Production connect/first-output/idle/overall limits remain **10/120/60/600 seconds**.
Only the provider-only evaluator's former 180-second outer bound becomes 630
seconds, leaving production's 600-second deadline authoritative with teardown
slack. No recovery, retry, F1, context, memory, compaction or approval policy changed.

### One Replay and Timeline

Before launch there were no Clack acceptance hosts, Clack test/Vite runners,
Cargo/rustc/rustfmt builds or Clack application processes. Unrelated processes
were left alone. The existing SSH tunnel PID **8352**, started at
`2026-10-17T05:29:32.257Z`, owned `127.0.0.1:11435` before and after the replay.
Native host PID **40388**, harness PID **9576**. Both owned processes were absent
after cleanup; no competing Clack process was found afterward.

The runner used the Clack checkout only as a working directory, with app/store/
webview data isolated under the fresh evidence directory. Its diagnostic branch
returns before session/workspace initialization and has no tool executors or agent
loop. No ForgeBoard directory, task/session, source file, test or build was changed
or executed by a returned tool.

Exactly **one** native inference, fresh ID `inference-1`, replayed preserved
`inference-26`. Native captured JSON compares structurally equal, including all
messages, tool-result relationships and the exact ten schemas. Its serde JSON
reserialization SHA-256 is unchanged:
`417a318b04952fc800bc391aaa70220394881fdc0c7c3e23ac89b813f9b3515f`.
This is not a physical-packet hash.

Controls: `qwen38-uncensored:latest`, existing endpoint
`http://127.0.0.1:11435/api/chat`, `stream:true`,
`options:{num_ctx:32768,num_predict:2048}`, explicit `think:false`, no sampling
overrides, no trusted fallback, **zero cloud inference**. B1 still accepts the
unchanged request and the 10-tool F1 selection is not modified.

All following times are UTC, 2026-10-17:

| Event | Time |
| --- | --- |
| Provider-only fixture start | `10:36:22.124` |
| Native admitted attempt | `10:36:22.162` |
| Native HTTP dispatch | `10:36:22.163` |
| Native response headers | `10:36:45.419` |
| First native body / meaningful text | `10:36:45.420` |
| First webview IPC delivery / parsed text | `10:36:45.421` |
| Last native body / meaningful tool / provider final | `10:36:52.086` |
| Last native successful channel forward | `10:36:52.086` |
| Last webview IPC delivery / parsed frame | `10:36:52.087` |
| SDK tool-call part, not execution | `10:36:52.088` |
| Native HTTP EOF / completed outcome | `10:36:52.109` |
| SDK finish / consumed stream end | `10:36:52.112` |

First useful text arrived **23.297 seconds after fixture start**. The provider-only
fixture completed in **29.994 seconds**. All body-to-IPC correlations were checked:

| Sequence | Bytes | Native body | Native forward | Webview delivery |
| --- | --- | --- | --- | --- |
| 1 | 144 | `10:36:45.420` | `10:36:45.420` | `10:36:45.421` |
| 2 | 141 | `10:36:45.547` | `10:36:45.548` | `10:36:45.548` |
| 3 | 144 | `10:36:45.675` | `10:36:45.675` | `10:36:45.675` |
| 4 | 144 | `10:36:45.803` | `10:36:45.803` | `10:36:45.803` |
| 5 | 145 | `10:36:45.916` | `10:36:45.917` | `10:36:45.917` |
| 6 | 146 | `10:36:46.043` | `10:36:46.044` | `10:36:46.044` |
| 7 | 141 | `10:36:46.167` | `10:36:46.167` | `10:36:46.167` |
| 8 | 143 | `10:36:46.290` | `10:36:46.290` | `10:36:46.290` |
| 9 | 556 | `10:36:52.086` | `10:36:52.086` | `10:36:52.087` |

**9 chunks / 1704 bytes** at native body and webview IPC boundaries, nine parsed
frames, zero invalid/dropped frames, zero pending bytes and zero dropped trace
events at either layer. Maximum body-to-forward duration **219 microseconds**;
maximum body-to-webview wall-clock delta **1 ms**. No unforwarded body chunks or
valid unparsed frames. Native recognized eight meaningful chunks, matching seven
text frames plus the tool frame; the whitespace-only eighth chunk did not reset
progress. No watchdog fired or missed-reset symptom was observed. Deterministic
tests, not this short replay, verify the 60-second policy's shortened-fixture idle
and cancellation behavior.

One tool call reached the SDK; **zero tool calls executed**. No second inference
followed. The provider returned `done:true`, `done_reason:stop`, measured prompt
usage **10868**, output usage **55**, cached prompt count **0**. Native-reported
durations: total **29.827208195 s**, load **5.413725394 s**, prompt evaluation
**17.690315 s**, generation **6.665044 s**. These are received provider metrics,
not inferred token totals for the old interrupted request.

### Tunnel, Existing Logs and Classification

After the request, `/api/ps` returned HTTP **200 in 7 ms** at
`10:36:52.119`, with the exact model loaded at context **32768** and runner
`llamacpp`; `/api/version` returned HTTP **200 in 141 ms** at `10:36:52.126`,
version **0.40.4**. The pre-run version check was also HTTP 200. These are
post-request/control-plane observations, not aggressive generation polling.

Read-only SSH journal inspection required no service/config/model/logging change.
The existing labpc journal at `10:36:52Z` records the replay's `/api/chat` HTTP
200 after **29.827267775 s**, normal slot release, 10868 prompt and 55 generation
tokens, agreeing with the provider final metrics. No error/panic/disconnect was
shown in that bounded excerpt; CUDA allocation messages alone are not errors.
A separate clock check bounded remote UTC `10:37:35.232615730` between local
`10:37:34.966` and `10:37:35.245`; it is not a historical clock-sync proof.

The historical `07:35-07:37Z` excerpt contains generation timings and multiple
`/api/chat` completions, but no Clack request IDs or payload fingerprint. Those
entries cannot safely be attributed to original request 26. They establish no
specific historical engine, tunnel, forwarding or parser cause. Its lack of a
provider final frame and 59.879-second IPC silence remain the preserved facts.

**Classification: `INTERMITTENT UPSTREAM STALL - NOT REPRODUCED`.**
This is the requested non-reproduction category, **not a claim that the old stall
was fixed or conclusively localized upstream**. This replay establishes a healthy
body -> forwarding -> delivery -> parser -> progress chain. The historical
Ollama/model versus SSH/network versus below-IPC cause remains unconfirmed.
The conditions for a direct-on-labpc comparison were not met, so **none was run**.
No additional provider replay or Automatic request was made.

### Focused Verification and Completion

- **54 native Windows tests passed** in `modules::net::inference::` (552 filtered
  out), including five new diagnostic tests and the existing transport, parser,
  admission, whitespace, idle, overall, cancellation, shutdown and cleanup tests.
  New cases cover bounded/content-free metadata, disabled recording, real
  body/IPC sequence/length correlation, whitespace not extending idle, channel
  rejection/cancellation, provider final versus actual EOF, and SSE early stop.
  One initial new-test assertion incorrectly equated an Ollama final frame with
  early body stop; it was corrected to test existing semantics, not change them.
- **60 frontend tests / 3 files passed**: `ollamaStreamTrace.test.ts`,
  `proxyFetch.test.ts`, `ollamaModel.test.ts`. An initial sandbox EPERM
  during temporary transform-file rename ran zero tests; rerun with access passed.
- `npm.cmd run check-types`, focused Biome lint, runner `node --check`, native
  acceptance example build and `git diff --check` passed. Formatting checked.
- Full frontend/Rust suites, product build and full Clippy were deliberately not
  rerun for this diagnostic-only checkpoint. Native source has opt-in diagnostic
  hooks, but no production behavior fix was established or made. No Linux/macOS
  native run or native GUI/Computer Use verification is claimed.

Only receive diagnostics, their native fixture coverage, acceptance replay/health
capture and this report changed. Existing context/memory/retrieval/PeerTask/F1/
approval and D3 no-blind-replay behavior remain untouched. No ForgeBoard effects,
unrelated work, stashes, delegation changes or `autonomous_tracker/` changes.
No push or subsequent checkpoint.
