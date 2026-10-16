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
