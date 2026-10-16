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
