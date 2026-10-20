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

## Fresh Sustained ForgeBoard Mission A (-05), 2026-10-17

### Baseline, Isolation and Controls

Started from clean `main` at **`3149577`**, **42 ahead / 0 behind** recorded
`origin/main`. No competing Clack application, acceptance host/harness, Vite test
process or Cargo/Rust build was active. Unrelated processes were not disturbed.

Fresh workspace: **`C:\Users\Hayden\Documents\forgeboard-qwen-none-20261017-05`**.
The evaluator created only the directory and empty Git repository on branch
`main`; the directory contained only `.git` before the model started.
Fresh evidence ID: **`forgeboard-none-20261017-05`**, under
`src-tauri/target/real-qwen-product/forgeboard-none-20261017-05/`.
No earlier ForgeBoard workspace was reused or changed.

Before the experiment, the acceptance example's existing debug-only receive trace
was enabled for `mission-a-*` as well as provider-only diagnostics, and the runner
enabled its existing post-run health capture for traced missions. Those were
**harness-only** changes. No production Clack source or runtime policy changed.
The system under test was then frozen: hashes of **936 tracked source/harness/
native/configuration files** compare unchanged after the mission. No source,
harness, configuration or timeout edits occurred during live inference.

Metadata-only preparation made **zero inference calls**. The full original
ForgeBoard specification was sent exactly once, without evaluator instructions,
previous-failure hints, reminders, manual Continue, requirement resend or code
rescue. The durable conversation has **one user message**, with the unchanged
2086-character task inside its 2325-character production envelope.

All **23 native requests**, `inference-1` through `inference-23`, retained:

- Exact model `qwen38-uncensored:latest` and native `/api/chat` route through the
  existing authorized `http://127.0.0.1:11435` SSH tunnel.
- `options:{num_ctx:32768,num_predict:2048}`, `stream:true`, explicit None /
  **`think:false`**, no sampling overrides, and captured configuration revision 1.
- Fallback Never, **zero cloud inference**, normal production tools/permissions,
  and unchanged **60-second meaningful idle / 600-second overall** deadlines.

No Automatic reasoning experiment, tuning ladder, replay, model/quantization
change, permission bypass or extra mission occurred. The normal isolated
trusted-workspace acceptance profile was not broadened or changed globally.

Native host PID **41720**, runner PID **10780**. Both were cleaned up; the
post-run isolation snapshot shows no competing Clack process. Existing SSH PID
**8352** owned the same localhost listener before and after.

### Chronology and Actual Effects

Logical run: `real-mission-a:1792235410754`, workspace-owned Coder conversation
`real-mission-a`. It ran from **11:10:10.754Z to 11:21:04.990Z**, **654.236 s**
(10 min 54.236 s). All times in this section are UTC on 2026-10-17.

| Milestone | Observed result |
| --- | --- |
| First native request capture, `11:10:11.272` | Original task once; exact requested controls |
| First provider completion, `11:10:55.842` IPC | Tool-bearing response, 291 measured output tokens |
| First plan effect, `11:10:56.031` | Structured scaffold/backend/frontend/test plan |
| First shell effect, `11:10:56.780` | PowerShell inspection, Node v22.20.0, npm 10.9.3; correct workspace |
| `11:12:54.785` | Root manifest written after two multiline-command refusals |
| `11:13:46.566` | Backend and frontend manifests written |
| `11:15:14.066-093` | Three TS configurations and `.gitignore` written |
| `11:16:26.715` | `npm install --no-audit --no-fund` succeeded: 375 packages in 18 s |
| `11:16:40.112` onward | Source-directory placeholders and file-writing/quoting probes, not application logic |
| `11:21:04.693` IPC | Request 23 provider final, tool call, measured usage |
| `11:21:04.990` | Protected-context preflight blocked the next step before inference |

**27 finalized tool calls**, all unique and all with a resolved output:
**23 `bash_run`, 2 `create_directory`, 2 `todo_write`**. Of these, **18 succeeded**;
**8** shell inputs were refused for real CR/LF control characters despite the
single-line rule, and **1** executed Node command failed from invalid nested
quoting. These are distinct model input/command errors, not transport failures.
The first shell command used the advertised PowerShell syntax correctly.

There were **10 successful write-bearing shell calls**, affecting **12 distinct
authored paths** through scaffold/configuration/probe writes and rewrites. This
count excludes npm's generated lockfile/dependency tree and Git configuration.
There were **zero `edit`, `multi_edit` or `write_file` calls**. Available edit tools
remained exposed, but Qwen kept attempting shell-based file generation instead.
No commands, source or plan corrections were supplied by the evaluator.

No production approvals were requested, so no evaluator approval/denial was
needed. The existing exact-effect approval mechanism remained installed; no
category-wide approval or permission increase was added.

**First real application source time: not reached.** Before independent
verification there were **13 non-dependency files**: three package manifests,
three TS configs, `.gitignore`, npm lockfile, `server/_copy.js`, `server/_test.txt`,
`server/src/_write.js`, `server/src/copy-out.txt`, `server/src/domain.ts`.
The domain file is only `line1`, `line2`, `line3`; `_write.js` is `hello`/`world`;
`_copy.js` is a generic file-copy probe. These are not a task/project backend or
frontend. `web/src` is empty. No API server, repository/persistence layer,
validation, filters/search, SSE implementation, React application, application
tests, HTML entry, README or working application was produced.

### Terminal Boundary, Compaction and Retrieval

Terminal classification: **`CLACK-BLOCKED / compaction-protected-budget`**.
This identifies the actual stopping owner, not a newly proven implementation bug
or an engine failure. The preceding phase also shows substantial **MODEL**
underperformance: repeated invalid inputs, quoting experiments and no application
implementation despite correct tool feedback and available edit tools.

The last provider response completed normally with another multiline tool input,
which was refused. The subsequent protected-context plan failed closed. No
request 24 was dispatched. Exact terminal budget receipt:

| Estimated budget component | Tokens |
| --- | --- |
| System | 3617 |
| Tool/schema/options | 7250 |
| Conversation | 17816 |
| Input total | **28683** |
| Output reserve | **2048** |
| Reasoning reserve, included in output | **0** |
| Safety margin | **2869** |
| Required total | **33600** |
| Verified effective ceiling | **32768** |
| Excess under current estimator/policy | **832** |

The detailed receipt attributes 17530 to conversation/tool history, 3175 to core
instructions, 442 to agent instructions, 7134 to built-in schemas, 123 to
environment metadata, and 279 to other required structure/options. Derived
memory, retrieved evidence, attachments, project/custom instructions, custom
schemas and MCP schemas are zero. These are **estimates**, not observed provider
usage for an unissued request. The last sent request's estimate still fit:
27181 input + 2048 reserve + 2719 margin = **31948**, with provider prompt usage
**13197** for that earlier request. That is not a tokenizer measurement of the
blocked next context.

The original user (`CeQv5vywKPItosmd`) and active assistant/tool transcript
(`Qa8IMCFduZBsVcDt`) remain intact. The earlier accepted todo call
`r4bnxuWwHbYkGQy0wXeaBLYjzLNR88ub` is **absent** from the last wire history;
the newer `DPTverVC1RxYVTb5Z3nSXmHDlCvScf1S` remains. Thus the saved evidence does
not reproduce the fixed superseded-plan duplication. Formal protected group IDs
and a separate tail-index receipt were not emitted by this harness and are not
fabricated here.

No extraction/summary model request or committed memory revision was produced.
Memory load returns `revisionId:null`, generation **42**, two uncovered messages;
source transcript revision **40**, profile revision **3**, transcript hash
`52f451419e822d23a3febed67d3583b6fe9a400dcd5c248221c2502a2c63ae05` and
profile hash `0b4b1feafac53a62a4da1e47713c1e3c373fce2c09acba9911d11b7f3027db4e`.
There is no resulting extraction/snapshot identity to report. Compaction planning
hit the protected-budget boundary before extraction. The run stopped at **23**
steps, before the normal 24-step automatic continuation boundary; continuation
count **0**. It was not manually resumed or optimized.

One normal optional project/task discovery ran at startup: `files:[]`,
`anchor:null`, no task IDs, 2086-character task query. It completed in **360 ms**
with **0 chunks, 0 reads, 0 bytes, 0 issues, 0 omissions**. No anchor or evidence
existed to revalidate; no retrieval stall, fabricated evidence, same-conversation
historical retrieval or useful project/task evidence injection was observed.

F1 exposed **16 tools on all 23 requests**. There was no reduction or unavailable
required write/edit tool; estimated schema cost **7250**, serialized schema bytes
**14814**. No F1 change was made.

### Transport and Health Evidence

Every request has a native receive snapshot, webview IPC trace, parsed-frame
summary, captured wire body/budget, provider final and usage. Across all 23:
**245 HTTP body chunks / 57593 bytes**, **245 IPC chunks**, **245 parsed frames**;
zero invalid/dropped frames, pending bytes or dropped diagnostic events. Ordered
sequence/byte-length correlation succeeds for every native body and IPC delivery.
Maximum native receive-to-forward interval **634 microseconds**, maximum
body-to-webview wall-clock delta **3 ms**. All **23** streams settled completed;
all **23** provider finals reported `stop`. No stream-idle, first-output or overall
timeout, missing IPC forward, parser loss or missed-progress symptom was observed.
Reported usage totals: **219187 input / 5016 output tokens** across requests,
including repeated/cached prompt work; not unique-context token counts.

Last request 23: native body/forward **11:21:04.692**, webview IPC/parsed/meaningful
frame **11:21:04.693**; provider final usage **13197 input / 371 output**. Its
largest body-to-IPC gap was **2 ms**. The next-step block was local context policy,
not an incomplete inference stream. The historical request-26 stall remains
unchanged and was not rerun.

Post-run `/api/ps`: HTTP **200 in 23 ms** at **11:21:06.024**, exact model loaded
at context **32768**; `/api/version`: HTTP **200 in 113 ms** at **11:21:06.047**,
version **0.40.4**. The SSH listener survived. No extra inference, direct labpc
comparison, service restart, model tuning or network/firewall change was needed.

### Independent Project Verification

The evaluator inspected files/scripts without implementing or repairing them.
`npm.cmd ls --depth=0` exited **0**: dependencies are installed, including Express
4.22.3, React 18.3.1, TypeScript 5.9.3, Vite 6.4.4 and Vitest 2.1.9.
Qwen itself ran **no project tests or production build**.

| Independent command | Actual result |
| --- | --- |
| `npm.cmd test` | Exit 1; root semicolon script routes extra arguments into frontend Vitest; no test files |
| `npm.cmd run build` | Exit 1; malformed root script arguments, then frontend TS18003: no inputs |
| `npm.cmd test --workspace server` | Exit 1; `test/` missing |
| `npm.cmd test --workspace web` | Exit 1; no test files found |
| `npm.cmd run build --workspace server` | Exit 2; TS2304 for placeholder `line1`, `line2`, `line3` |
| `npm.cmd run build --workspace web` | Exit 1; TS18003: no inputs |

These are **six failed commands, zero defined/executed application test cases**,
not six failed test assertions. Before/after hashes show no existing project
source was changed by verification. TypeScript emitted a 35-byte
`server/dist/domain.js` despite errors during the independent backend build;
that compiler output is explicitly **not Qwen's implementation** and is retained.

The project remains on unborn `main`, no commits, with untracked `.gitignore`,
`node_modules/`, lockfile, manifest, `server/` and `web/`. `.gitignore` is one
comma-separated line, not separate patterns. `git check-ignore --no-index`
confirms dependency, build-output and runtime-data examples are **not ignored**.
No backend listener exists on **4317**. Persistence/restart, SSE, combined filters,
validation/not-found responses, task/project CRUD and README commands cannot be
demonstrated because their implementation is absent. They are not marked passed.

The 50 -> 25 correction was **not sent**. No material page-size-50 implementation
or accepted implementation plan meeting the existing boundary was produced, and
the harness observed zero qualifying `write_file`/`edit`/`multi_edit` results.
Shell-created manifests/probes do not satisfy that existing boundary. Initial
page size remains 50 in the original task; there is no claim of a tested 25 change.

### Continuity Scorecard

This scores observable retention/exercise, **not product completion**. Unexercised
requirements are not labeled lost merely because code is missing.

| Item | Score | Evidence and limitation |
| --- | --- | --- |
| Core ForgeBoard objective | PASS | Manifests and plan retain the objective; application not implemented |
| Backend port 4317 | NOT EXERCISED | Appears in original plan intent; no server/listener |
| Current page size | NOT EXERCISED | Original 50 retained in task; correction boundary not reached |
| Title maximum 120 | PASS | Repeated attempted domain definitions retain 120; writes refused, enforcement unimplemented |
| Debounce 750 ms | NOT EXERCISED | No frontend behavior |
| SSE | NOT EXERCISED | Planned, not implemented |
| Persistence | NOT EXERCISED | Planned, not implemented |
| No telemetry/cloud | PASS | Zero cloud inference; no telemetry implementation or observed telemetry call |
| Test/build obligation | NOT EXERCISED | Retained in plan; Qwen never ran either, independent commands fail |
| Unfinished plan | PASS | Scaffold completed; backend/frontend/test/README tasks persisted as failed |
| Recent command failures | NOT EXERCISED | Feedback remained visible but invalid multiline attempts recurred; no proof of memory loss, no successful repair |

No RETRIEVED score is claimed for the empty discovery. No requirement is called
LOST without evidence of actual forgetting/contradiction.

### Verification, Evidence and Scope

**43 focused tracing/approval tests in 3 files passed** before the mission:
`ollamaStreamTrace.test.ts`, `acceptanceApprovalLifecycle.test.ts`,
`scripts/acceptance-approval.test.mjs`. The modified invisible native acceptance
example built successfully with the locked isolated target, and its traces were
verified against all 23 real Windows native IPC streams. Type checking, focused
Biome lint (three acceptance/tracing TypeScript files), Rust formatting,
runner syntax and `git diff --check` passed. Full Clack frontend/Rust suites,
product build and Clippy were not repeated: no production code changed.
No native GUI/Computer Use or Linux/macOS acceptance claim.

Local evidence includes the standard preflight/mission reports, event/wire/
receive JSONL, isolated stores and before-data snapshot, source freeze/check,
`acceptance-summary.json`, `tool-effects.json`, project verification hashes and
logs, runtime/ignore checks, isolation snapshots and `evidence-manifest.json`.
Raw prompts/tool history stay in ignored local evidence, not Git. No hidden
reasoning was collected by the metadata-only receive trace.

Only harness trace/health activation and this additive report changed. No Clack
memory/context/compaction/retrieval/F1/approval/recovery fix, new architecture,
ForgeBoard repair, subsequent mission or checkpoint, unrelated work/stash/
delegation/`autonomous_tracker/` change, or push. Final result is intentionally
incomplete: **CLACK-BLOCKED at protected-context policy, with preceding model
tool-use underperformance; no materially working ForgeBoard.**

## Sustained -05 Capacity Classification and Accounting Correction (2026-10-17)

Baseline: `7d1cf23 test(ai): verify sustained local ForgeBoard run`, clean `main`
before this checkpoint. This is an **offline classification of the existing
`forgeboard-none-20261017-05` evidence**, not another mission. No model request,
cloud inference, ForgeBoard rerun, larger-context test, project repair, native GUI
interaction, or provider/service/network configuration change was performed.
All preceding acceptance records remain historical evidence, including their
then-unresolved classification. This audit now establishes a narrow accounting
defect; it does not retroactively turn the last completed inference into a failure.

### Exact Reconstruction

`scripts/classify-context-capacity.mjs` reads bounded existing artifacts, rebuilds
the recorded active SDK response history with the installed AI SDK's actual
`toResponseMessages`, and invokes the existing pure compaction projection and B1
estimator. It also loads the historical estimator from `7d1cf23` through an
in-memory TypeScript transpilation, so the original result remains reproducible
after the correction. No inference, tools, persistence writes, or memory
extraction are invoked. Its JSON stdout is a metadata/cost receipt, not a copy of
raw command inputs or outputs. Local receipt:
`src-tauri/target/real-qwen-product/forgeboard-none-20261017-05/capacity-classification.json`.

Input SHA-256:

- `mission-a-1.json`: `79d81c1b791101c4184a03139949c00b5ed3892de14fb8d2e4f05d17126fb364`
- `mission-a-1.requests.jsonl`: `9df05301f9e8c03dfe419b9259d9478707189d135396d739ea7d8b2f3c11be4c`

The public UI-history converter alone is insufficient to reproduce the exact
in-memory SDK response shape: optional undefined fields differ. Using the SDK's
response-message builder reproduces **33600 exactly**, including every tool pair,
the superseded-plan projection and section attribution. These remain conservative
estimates, not tokenizer counts or invented usage for an unissued request.

The following rows are disjoint; subcomponents are not added twice:

| Terminal preparation component | Historical estimate | Corrected estimate |
| --- | ---: | ---: |
| Core system instructions/structure | 3175 | 3175 |
| Active agent instructions | 442 | 442 |
| Tool schemas and their structure | 7250 | 7250 |
| Original ForgeBoard objective text | 1044 | 1044 |
| User environment envelope content | 123 | 123 |
| Remaining user-message structure | 29 | 29 |
| Current accepted plan call/result | 337 | 322 |
| Other hot tool call/result parts | 14575 | 14200 |
| Assistant text parts and metadata | 995 | 995 |
| Active-tail message framing | 713 | 713 |
| Project/task evidence | 0 | 0 |
| Retrieved original evidence | 0 | 0 |
| Memory/extraction/objective carry | 0 | 0 |
| **Input** | **28683** | **28293** |
| Output allowance/reserve | 2048 | 2048 |
| Safety margin | 2869 | 2830 |
| **Required total** | **33600** | **33171** |
| Effective ceiling | 32768 | 32768 |
| **Excess** | **832** | **403** |

System total is **3617**, protected conversation total **17816 -> 17426**,
available conversation working budget **16984 -> 17023**. Historical diagnostic
sections remain exactly core 3175, agent 442, history 17530, environment 123,
builtin schemas 7134, other framing/options 279; their sum is 28683. Corrected
history is 17140; other sections are unchanged. Section labels are diagnostic,
not source provenance. No attachment, project/custom instruction, custom/MCP
schema, hidden memory snapshot or extraction contribution was found.

### Ownership, Protection and Every Retained Component

There is **one formal source group**, original user message
`CeQv5vywKPItosmd`, source range `[0,1)`, **1196** tokens including the environment
and message wrapper. It is current, unsuperseded authoritative requirements and
workspace/shell context; no tool effect or pending tool result. Keeping its
authority and source identity is required. It is not three copies of the spec.

The remaining **16620 -> 16230** tokens are the active SDK tail under assistant
`Qa8IMCFduZBsVcDt`. They are not 26 separate C1a source groups. At batch start only
the original user was a compaction unit. The live SDK accumulated the assistant
steps as `extra`, which `planCompaction.assemble()` preserves after the existing
accepted-plan projection. There are **46 projected SDK messages**, **26 hot tool
pairs**, **9 text parts**, and **713** message-frame tokens. No incomplete tool
call/result relationship remains; all calls settled. Operationally unresolved
errors are distinct from unresolved protocol calls.

Every hot pair is enumerated below, largest first. Identity is the assistant ID
above plus the exact tool-call ID. Historical costs include 15 phantom field
tokens per call; corrected pair cost is therefore **each listed cost minus 15**.
Frames are separate rather than arbitrarily assigned to pairs that share a
message. All pairs remain hot under the existing active-tail contract, with calls
and results intact; none is declared a superseded plan or authoritative user
requirement. The retention rule preserves effect/debug provenance and avoids
unsupported effect/history substitution; it is not a claim that every old probe
is semantically necessary for the next coding decision.

| Tool-call identity | Tokens | Effect/evidence and current relevance |
| --- | ---: | --- |
| `yf2BXLHp22TUoCGnvYgBccl92U7aIITD` | 1702 | Shell: server/web package manifests; existing scaffold write evidence |
| `ckhIS2eXV78KC510QtJMtQvVKtrPqrri` | 972 | Shell: root manifest/gitignore scaffold writes; existing effects |
| `4mrHAmtrBrEY7P7O2blXuyKj1m0uEO9l` | 846 | Refused multiline domain write; intended implementation still absent |
| `nB07jpwpkOPNi5Br9nT2qaNB45tGI70C` | 793 | Refused multiline domain here-string; intended implementation still absent |
| `rAwxIn13d5pu5SzyjUNBEhnpkldjGs8T` | 772 | Shell: web configuration writes; existing scaffold effects |
| `VacZqVXOuuOI4AbxlExbACZ2uWbHLAJ4` | 768 | Final refused multiline domain write; unresolved at stop |
| `I9a0kUwUbbh0St9ASCMaxulUQ32q6fta` | 767 | Refused domain write; later placeholders do not implement the intended domain |
| `tePJmQfuLtuxUS04NbOoWy2bND6idHMM` | 757 | Refused multiline configs; later successful scaffold write, no longer an operational blocker |
| `7nYLfcQfIpVHCBij2vFh5Clvc4ugDmAJ` | 754 | Shell: server configuration writes; existing scaffold effects |
| `VJcy05bzWoDOVLzkUDfX5C79HXt4W5D4` | 683 | Node helper quoting failure; later hello/world probe is not a verified repair of that helper |
| `ajNM3cn3nrW5FRNTmZmBm2770JZgWdrT` | 547 | Refused multiline root manifest; later scaffold write, no longer an operational blocker |
| `qYt5bF8eEHLfOjVXw759WAytT2c2fU9x` | 543 | Second refused root manifest; later scaffold write, no longer an operational blocker |
| `v9kXiVa8Q3hNU40xlm1iHVUvPxKQN5l4` | 528 | Shell: overwrote domain.ts with line1/line2/line3; current placeholder effect |
| `rzbgLuzy7F9GSfd3TP4bfqg6bcWrfdRi` | 511 | Shell: generic copy helper probe; current file effect, not application code |
| `cAMVX6KwLPoZmPmcHATIjD7OOmVxQcVF` | 428 | Shell: dependency installation, 375 packages; retained dependency effect/result |
| `nsNLCEAgIZAqUaEraag7pUnmCgWieaV7` | 405 | Shell: line-writing domain probe; content subsequently overwritten, historical effect |
| `mwmwTwcfwuJC5YqzCDgOkDUupHjorpZD` | 403 | Shell: copy-out and text probes; existing file effects |
| `rj1gPQ5EkrbzlcdXerlQ8gfbGOVhwNLt` | 381 | Shell: environment/tool-version inspection; historical observation |
| `PxYjsOYpciTDo0sY7dGVFMViWrJhBa61` | 347 | Shell: read helper probe; historical observation, no new write |
| `DPTverVC1RxYVTb5Z3nSXmHDlCvScf1S` | 337 | Current accepted todo replacement, not another original specification |
| `mhuqJ7HXtpfnwSJ6lV05ZYLHhaKxO3Qi` | 329 | Refused multiline helper; later alternative copy probe does not prove exact helper repair |
| `zbdzhdwwbrWbzoZYksRge8O30KmvViM4` | 325 | Shell: hello/world helper probe; existing file effect |
| `VqIZmzIudDFDikL4vdrPLSPZkIifFnd3` | 314 | Shell: local Git config/init; historical effect |
| `cfF5BncPwxmizjvv4130OfbqhAJDKLf9` | 280 | Shell: temporary test-content domain write; subsequently overwritten, historical effect |
| `NMLG1D0HypefdXZznSF8YCsuJMl8mnjz` | 211 | create_directory: server tree creation; existing effect |
| `accUIncHE6ND6ImofHga1V3nvRAUHjcr` | 209 | create_directory: web tree creation; existing effect |

The nine text-part identities are zero-based projected-tail message indices under
the same assistant ID, sorted by cost: **38:213, 44:145, 30:117, 32:111, 42:93,
20:88, 34:88, 22:77, 8:63**, total **995**. They are historical model narrative,
not authoritative requirements, tool acknowledgements or separate promoted
knowledge. They remain in the active tail; not every statement is a current fact.
Message envelopes/array framing add **713**. This exhausts the conversation total:
**1196 + 14912 + 995 + 713 = 17816**. Corrected:
**1196 + 14522 + 995 + 713 = 17426**.

The largest five independently attributable protected components are: manifests
pair **1702 -> 1687**, original user **1196**, root scaffold pair **972 -> 957**,
domain refusal `4mr...` **846 -> 831**, domain refusal `nB07...` **793 -> 778**.
These are component costs, not five fabricated formal compaction-group records.

### Plans, Failures, Effects and Probes

The old accepted plan `r4bnxuWwHbYkGQy0wXeaBLYjzLNR88ub` remains **durable only,
not hot (0 tokens)**. Its full call/result is excluded. The latest accepted plan
`DPTverVC1RxYVTb5Z3nSXmHDlCvScf1S` remains **337 -> 322** hot tokens. Thus
`97148e9` has not regressed. Current plan: one completed scaffold item, one
in-progress backend item, three pending frontend/test/README items, **zero blocked
items**. The completed detail is one short title, within the existing maximum of
16 items/160 characters per title, not an accumulated journal. Planned tasks are
not evidence that their implementation or tests exist.

Historical non-overlapping tool pair accounting:

- **14912** total: **8624 call/input + 6288 result** tokens, excluding shared frames.
- **8122** successful shell pairs: **3514 call + 4608 result**; the 10
  write-bearing shell pairs are a subset costing **6652**. This includes manifests,
  configuration and overwriting/probe actions, not just final surviving bytes.
- **6033** failed/refused shell pairs: **5350** for eight multiline refusals,
  **683** for the quoting failure. Outputs alone **1361**; refused outputs
  **8 x 108 = 864**, quoting output **497**. Most refusal cost is the attempted
  input, not repeated error prose. Corrected failure pairs total **5898**.
- Successful directories cost **420**, current accepted plan **337**.
- The 10 write-bearing shell pairs split into **4200** for four scaffold/config
  calls and **2452** for six successful placeholder/helper/copy probes. Including
  the helper quoting failure, refused helper and read-back probe brings that
  exploratory subset to **3811** tokens; these are overlapping views of the totals
  above, not additional budget. The probes did not produce application logic.
- Returned-command echo fields contribute **2680**; stdout fields **221**, stderr
  fields **494**. These are marginal field costs including key/structure, not raw
  text-only costs, and are subsets of the result totals above. The command echo
  repeats intent but also records the backend's executed-command receipt. No
  existing safe reference substitution was established; it was not stripped.

The three scaffold refusals identified in the table are no longer immediate
operational blockers. Earlier overwritten placeholders and read probes likewise
do not all guide the next decision. However the current architecture does **not**
declare those active SDK entries safely superseded/retrievable: no committed
memory coverage exists for this batch, and the only precise replacement rule
here is for acknowledged whole-plan snapshots. The six other failures do not have
verified semantic repairs of their intended implementation. No failure is
permanently reclassified as a fact or retrievable summary in this checkpoint.
Dropping active effect/debug history or adding such a retirement mechanism would
be a compaction-policy change, not correction of the proven accounting owner.
The protected set is therefore **policy-retained**, not a proof of the smallest
possible semantic representation. No originals were erased or rewritten.

### Schema Selection and Specification Duplication Audit

**7250 estimated tokens / 14814 serialized bytes / 16 schemas**. Per-schema rows
exclude the shared array's **18** tokens; row sum **7232**. All 23 captured requests
have the same set. Offline replay over the captured candidates selects the same
16 initially; the terminal selection explicitly makes all initially exposed
names mandatory. The full unexposed candidate set and live ranking/cache receipt
were not logged, so this does not fabricate an exact historic score for tools
that never appeared on the wire.

| Schema | Tokens | Uses | Selection reason/current relevance |
| --- | ---: | ---: | --- |
| request_peer_task | 1204 | 0 | Initial broad lexical relevance, then pinned; no current delegated task, delegation prohibited by mission |
| propose_custom_tool | 681 | 0 | Initial broad relevance, then pinned; no custom-tool proposal/current binding |
| todo_write | 611 | 2 | Explicit tool name in objective; current accepted plan, pinned |
| communicate_peer_task | 591 | 0 | Initial broad relevance, then pinned; no current peer conversation |
| grep | 573 | 0 | Coding/search relevance, then pinned; available, not exercised |
| read_file | 470 | 0 | Coding/read relevance and editing dependency, then pinned; available, not exercised |
| bash_run | 400 | 23 | Install/build/test/shell relevance; active command history, pinned |
| cancel_peer_task | 378 | 0 | Initial broad lexical relevance, then pinned; no active peer task |
| multi_edit | 375 | 0 | Coding/file-edit relevance, then pinned; available, not exercised |
| open_preview | 368 | 0 | Server/frontend relevance, then pinned; no running app to preview |
| edit | 343 | 0 | Coding/edit relevance, then pinned; available, not exercised |
| read_agent_output | 309 | 0 | Initial broad relevance, then pinned; no agent output to inspect |
| glob | 293 | 0 | Coding/search relevance, then pinned; available, not exercised |
| bash_list | 289 | 0 | Shell/server relevance, then pinned; no background server started |
| list_directory | 191 | 0 | Coding relevance/directory dependency, then pinned; shell inspection used instead |
| create_directory | 156 | 2 | Coding/directory relevance; existing directory effects, pinned |

These 16 are **contractually justified at terminal preparation by SDK-run
pinning**, not all semantically needed at that instant. F1's implementation ledger
explicitly requires already exposed schemas to remain pinned for the SDK run;
`agent.ts` carries `pinnedTools` into every `prepareStep`. Tests forbid dropping
mandatory schemas simply to fit. The selector's lexical ranking is not a semantic
understanding of negative delegation instructions; making a forbidden action
visible does not authorize using it. No F1 regression or stale cache was proven.
The previous -04 **16 -> 10 / 2831-token saving** occurred at a **new SDK batch**
with narrower optional allowance; -05 stopped after 23 steps, before the 24-step
continuation boundary and fresh selection. These are different lifecycle points.
No tools, assignments, permissions or schema versions were changed to force fit.

The complete ForgeBoard objective occurs **once authoritatively**, in the original
user message, **1044 raw text tokens**. Its envelope is not another specification.
There is no substantive-objective carry, memory summary, extraction result,
retrieval chunk or project evidence repeating it. The five terse plan titles
refer to work areas without reproducing the full requirements. No incorrectly
protected optional retrieval/project memory or second authoritative spec was
found. There is representation overhead in tool history, but no independently
proven safe duplication-removal defect beyond the accounting issue below.

### Classification D: Accounting Defect, Not a Forced 32K Pass

The SDK response-message builder creates optional `providerExecuted` and
`providerOptions` keys with **undefined values** on tool calls. JSON omits those
object fields. `measureRequest` nevertheless charged their names and field
structure even though it charged zero for their absent values:

- 26 `providerExecuted` fields x 8 = **208** phantom input tokens.
- 26 `providerOptions` fields x 7 = **182** phantom input tokens.
- **390** excess input; the unchanged margin formula adds **39** more.

The correction skips **only undefined object properties** in the shared recursive
estimator. It does not mutate messages or serialize away their metadata. Present
false, zero, empty strings and null fields still count; real tools/results,
requirements, source authority, schema pinning and effect safeguards remain.
No tokenizer heuristic, output reserve, 10%/minimum-128 safety rule, context limit,
request continuation, extraction, source coverage, memory, F1 or scheduler policy
was changed. The report's original **33600** is exactly reconciled; it was not
double-counted output, an extra spec, or a repeated accepted plan.

Corrected B1 accounting equals measurement of the same JSON-serializable body:
**28293 input + 2048 output reserve + max(128, ceil(28293 x 0.1)) = 33171**.
It remains **403 over**, and protected preparation still rejects before another
inference or effect. This checkpoint chooses **D**, not A/B/C. The residual
policy-capacity stop is acknowledged, but the conditional Case A hardware test
is **not authorized by this result and was not run**. No 49152/65536 request, new
load/completion, or new VRAM/RAM measurement exists to report.

### Model Quality, Verification and Scope

The pre-limit engineering result remains poor independently of the final
**832-token original / 403-token corrected** excess. In **10m54s**, Qwen received
**23 completed inference responses**, made **27 tool calls** and **10 successful
write-bearing shell calls**, yet produced no real backend, frontend, persistence,
SSE, application tests, production build or materially working ForgeBoard.
It repeatedly attempted refused multiline commands and wrote placeholders/probes,
despite useful error feedback and available edit tools. The terminal event was a
local preflight capacity rejection, not provider/transport failure. Neither fixing
390 phantom tokens nor merely increasing context demonstrates coding competence.
The prior six independent project verification commands still fail; none was
rerun or repaired for this classification.

Deterministic evidence:

- Red reproduction before the fix: original focused context-budget file **52
  passed / 2 failed**, both new undefined-field serialization assertions.
- After correction: **199 focused tests in 6 files passed** (`contextBudget`,
  `compactionPlan`, `protectedPlan`, `toolExposure`, `conversationCompaction`,
  `requestPreflight`). Three new tests cover undefined SDK/schema/nested fields,
  preservation of false/zero/empty/null and original objects, and actual protected
  preparation at the exact fit/one-token-over boundary with paired tool/effect
  evidence intact.
- Offline audit asserts historical **33600**, corrected/JSON-equivalent **33171**,
  the exact 26+26 phantom fields, protected rejection, the 26 retained pairs,
  excluded old plan, current plan, all additive components, and schema costs/pins.
- Final frontend gates: `npm.cmd run check-types` **passed**; `npm.cmd run lint`
  **passed, existing baseline 71 warnings / 2 informational notices**;
  `npm.cmd test` **2794 passed / 200 files, no failures**;
  `npm.cmd run build` **passed** (including final TypeScript compilation), with
  existing ineffective-dynamic-import notices for `customExecution`, `agent`,
  `transport`, `chatRuntime`, and the plugin-timing notice; `git diff --check`
  **passed**. An initial new-test-only `Object.hasOwn` TypeScript compatibility
  error and its lint-incompatible replacement were corrected using `Object.keys`
  before the full tests/build; no project compiler target or lint rule changed.
  No Rust files changed, so Rust gates were not repeated. No native/live-provider
  verification or Linux/macOS run is claimed.

Only the shared estimator, its regression tests, offline audit script and this
additive acceptance report change. No Rust/native code, ForgeBoard source,
delegation work, safety stash, `autonomous_tracker/`, other checkpoint, push, or
live inference is part of this correction.

## Resolved Tool Refusal Retention (2026-10-17)

Starting checkpoint: `ac1c8ed`, clean `main`. Before any retention change, the
existing offline reconstruction passed and reproduced **33171 / 32768** in
`forgeboard-none-20261017-05/retention-before.json`. No inference or effects ran.

### Invariants Recorded Before Implementation

- Original session messages, tool inputs/results, source identities and durable
  source-group boundaries must remain unchanged.
- Uncertain mutations, generic process/runtime errors, permission/approval
  evidence and the latest debugging failure must remain verbatim and hot.
- Successful writes and probes cannot be retired merely from matching paths,
  a zero exit code, elapsed turns or later overwrites.
- The active plan, original requirements, schemas, output reserve, safety margin,
  existing accounting correction and workspace/conversation boundaries stay intact.
- Only independently reproducible builtin pre-execution rejection may be replaced
  by a protected receipt; a later guard-accepted success proves syntax adaptation,
  not completion of the rejected command's intended work.
- Receipt provenance must retain the original tool-call identity and the later
  successful adaptation identity. Originals remain in session history. Requesting
  an exact demoted source must restore its original pair or fail B1 conservatively;
  restoration must never execute or replay the tool.
- The latest/current failure and a genuine uncertain-effect overflow must still
  produce `compaction-protected-budget` when they cannot fit.

### Failure Inventory and Proof Boundary

The preserved terminal has **9 failure/refusal pairs**: **8 confirmed no-effect
multiline refusals**, **1 process-launched quoting failure with conservatively
unknown effects**. The old numbers 5350/683/6652 included the already-fixed
undefined-field charges. All before/after measurements below use the corrected
estimator: multiline **5230**, quoting **668**, successful write pairs **6502**.
No accounting, reserve or margin policy was changed again.

`buildShellTools().bash_run.execute` calls `checkShellCommand` before session
lookup, `shellSessionOpen` or `shellSessionRun`. A CR/LF control-byte refusal returns
exactly `{error: <deterministic reason>}` from that branch. The projection independently
reruns the same validator against the original input, requires that exact reason
and error-only result shape, builtin name, ordered local call/result pair, no
provider execution and no approval evidence in the source boundary. Thus this
proof does not rely on an arbitrary tool's error prose or an invented effect flag.
A test invokes the real builtin and proves neither native shell operation is called.

Source for every row is assistant `Qa8IMCFduZBsVcDt` in conversation
`real-mission-a`; exact inputs/outputs remain in `mission-a-1.json` and
`data/terax-ai-sessions.json` under the existing -05 evidence directory. Command
descriptions below identify the operation; they do not replace those full originals.
All nine were hot under the former full-SDK-tail policy. Costs exclude shared
message frames, and rows are sorted by corrected pair cost.

| Original call ID | Command/input and class | Effect certainty | Later response and unfinished-work dependency | Before -> after |
| --- | --- | --- | --- | ---: |
| `4mrHAmtrBrEY7P7O2blXuyKj1m0uEO9l` | Multiline `node -e` draft of domain.ts; control-byte refusal | Confirmed none; never launched | Later `cfF5...` writes test content using an accepted command shape. Domain implementation remains unverified; receipt does not call it completed | 831 -> 283 |
| `nB07jpwpkOPNi5Br9nT2qaNB45tGI70C` | Multiline PowerShell here-string for domain.ts; same guard | Confirmed none; never launched | Same later syntax adaptation `cfF5...`; intended domain work not established | 778 -> 283 |
| `VacZqVXOuuOI4AbxlExbACZ2uWbHLAJ4` | Final multiline `node -e` domain draft; same guard | Confirmed none; never launched | No later accepted command; current debugging failure stays verbatim, including its exact input/error | 753 -> 753 |
| `I9a0kUwUbbh0St9ASCMaxulUQ32q6fta` | Multiline `Set-Content` domain draft; same guard | Confirmed none; never launched | Later `nsNL...` writes line placeholders. Syntax adaptation, not a semantic repair of the domain | 752 -> 283 |
| `tePJmQfuLtuxUS04NbOoWy2bND6idHMM` | Multiline server configuration writes; same guard | Confirmed none; never launched | Later `7nYL...` writes the scaffold configuration; original refusal prose is not a current blocker | 742 -> 283 |
| `VJcy05bzWoDOVLzkUDfX5C79HXt4W5D4` | Node helper quoting/syntax error after shell launch | Unknown, conservatively retained; no confirmed mutation from this call | A later hello/world probe does not prove all possible effects absent or that the intended helper works. Exact runtime stderr remains hot | 668 -> 668 |
| `ajNM3cn3nrW5FRNTmZmBm2770JZgWdrT` | Multiline root manifest here-string; control-byte refusal | Confirmed none; never launched | Later `ckhI...` writes root scaffold using an accepted shape | 532 -> 283 |
| `qYt5bF8eEHLfOjVXw759WAytT2c2fU9x` | Second multiline root manifest string; same guard | Confirmed none; never launched | Same subsequent `ckhI...` scaffold write | 528 -> 283 |
| `mhuqJ7HXtpfnwSJ6lV05ZYLHhaKxO3Qi` | Multiline generic file-helper draft; same guard | Confirmed none; never launched | Later `rzbg...` writes a different copy helper with single-line syntax; exact original helper completion is not established | 314 -> 283 |

There are **7 later successful guard adaptations**, not seven proven completed
implementation repairs. Three refusals were followed by successful writes to the
same scaffold targets; four domain/helper objectives still lack verified semantic
repairs. Together with the current refusal and uncertain quoting failure, **six
failure records still lack verified semantic resolution**. The receipts explicitly
retain that distinction. They protect the no-effect failure fact and syntax rule
without preserving every old rejected implementation draft verbatim. No inference
of correction is made from a filename, number of turns or token size alone.

### Retention Policy and Replacement Representation

The existing `compactionPlan.ts` history projection now emits deterministic
`ToolHistoryReceipt`s for the narrow class above. Eligibility requires a later,
ordered, same-user/system-boundary builtin shell success with the same executed
command as its input, exit 0, `timed_out:false`, and native stdout/stderr fields.
That proves the model had feedback and subsequently passed this guard; it does
not prove that the refused operation was completed. A fresh/recurrent refusal
without later adaptation stays verbatim. Duplicate IDs, out-of-order pairs,
provider-executed/custom/MCP tools, additional error/result fields, generic shell
errors, timeouts and permission/approval evidence are ineligible. Tiny refusals
are also retained if a receipt would increase their size, after semantic checks.
Lookup uses ordered per-boundary successes rather than a quadratic history scan.

Each replacement is protected historical assistant text, not a fabricated new
tool result or edited tool-call input. It contains:

- Original builtin name and tool-call ID, outcome `refused-before-execution`,
  `effect:none`, and the exact later `adaptedBy` tool-call identity.
- The single-line shell rule and read_file/edit/multi_edit route for multiline
  file content, not an unsupported claim that `bash_run` is Bash.
- `workCompleted:"not established"`, an explicit no-automatic-replay instruction,
  and a session-history / `request_conversation_evidence` source anchor.

Both old protocol parts are replaced together. No dangling tool-call or result
is left. Other parts and messages remain unchanged; empty result envelopes are
removed. Original source-unit indexes and `groupCompactionUnits` boundaries are
computed before projection, so existing failure/coverage groups stay protected.
Active SDK-tail receipts stay in the always-retained tail. The original plan
projection still excludes only acknowledged superseded accepted plans.

This is **smaller protected receipt representation**, not silent deletion of
failure memory, another summary model call, a new memory tier, effect ledger or
vector index. Receipts are recomputed from originals; no session schema or memory
revision is overwritten. Existing session writes are awaited before returning a
receipt-bearing preparation. A write-barrier failure blocks preparation.

### Original Evidence, Bounded Restoration and Effect Safety

All **27 original tool records**, including the old accepted plan and all nine
failures, match the isolated persisted session store's tool IDs, inputs, outputs
and states. Store SHA-256 at this audit:
`b0f8d935a7ac7bdba69c43a9ec4b0c2d0ce88b7b46b72c1072a1eddf3323615a`.
The preceding report/wire hashes still verify. No originals or existing evidence
files were rewritten. Serialized-session tests rebuild the same receipts after
restart and recover the original input without a memory commit or extraction.

The existing compactor evidence-request entry point recognizes exact receipt
tool-call IDs belonging to that coordinator. It pins the original pair from the
same existing source history for the next preparation, never executing it. This
uses the existing shared **2-round / 12-chunk / 65536-byte** allowance and B1; an
oversized restoration blocks rather than truncating the source. Cancellation,
stale/disposed scope and another coordinator cannot access these originals.
The pin contains only IDs/byte counts, not another transcript copy or persistent
index. Other conversation/project/task retrieval remains on its existing path.

Evidence-tool availability is still governed by existing authorization and F1
exposure. No schema was added or forced into the captured 16-tool set. The receipt
therefore says to request source evidence **if available**, with original session
history remaining accessible regardless. The offline experiment demonstrates the
existing API's exact-source pin/restore behavior; it does not claim that every
model already exposes that tool in every phase.

**Successful shell writes, overwritten probes and the quoting failure are not
demoted.** A successful shell exit and later matching path are not sufficient
proof of complete effect identity/current file state or replay safety. No new
authoritative file snapshot was fabricated or read to justify dropping them.
The existing D1/D2 retry, cancellation, uncertain-effect and approval gates are
unchanged. This projection invokes no executor, inference, retry or continuation;
restoring source is history preparation only. New model-chosen actions still use
the existing execution/approval safeguards.

There were **0 read-before-edit calls/refusals in this -05 transcript**: its 27
tools are shell, directory creation and todo calls. Existing read-before-edit
refusals are confirmed pre-write in their actual builtin path, including a new
test that no content read/write runs on an unread edit. Their hot representation is
unchanged here: no authoritative later read/create/write supersession proof was
established for them in this replay. The checkpoint does not generalize shell
receipt eligibility to all error-shaped output.

### Exact Savings and Preparation Replay

The seven demotions and their exact payload savings appear in the inventory
above. Each receipt costs **283**, replacing **4477** corrected call/result tokens
with **1981** receipt tokens: **2496 payload tokens saved**. Message framing drops
**713 -> 623**, another **90**. Total input saving **2586**, plus the unchanged
margin calculation decreases by **259**; total required saving **2845**.

| Corrected-estimator component | Before | After |
| --- | ---: | ---: |
| System | 3617 | 3617 |
| All 16 schemas | 7250 | 7250 |
| Protected conversation | 17426 | 14840 |
| Input | 28293 | 25707 |
| Output reserve | 2048 | 2048 |
| Safety margin, max(128, ceil(input x 0.1)) | 2830 | 2571 |
| **Required** | **33171** | **30326** |
| Ceiling | 32768 | 32768 |
| **Headroom** | **-403** | **2442** |

After-conversation decomposition: original user/envelope **1196**, unchanged
remaining tool pairs **10045**, protected refusal receipts **1981**, unchanged
assistant text **995**, message framing **623** = **14840**.
Multiline evidence is **5230 -> 2734**, including the unchanged latest refusal
**753** plus seven receipts **1981**. Quoting failure **668 -> 668**; ten successful
write pairs **6502 -> 6502**. No successful write/probe payload saving is claimed.

`scripts/classify-context-capacity.mjs` keeps the historic 33600 reconstruction and
corrected pre-retention **33171** reproducible by explicitly pinning all original
tool IDs for that baseline. A separate normal retention pass asserts **30326**,
seven receipt identities, matching retained call/result sets, unchanged sources,
current-refusal/quoting preservation, all schema costs and stable repeated output.
Its additional read-only **production compaction-coordinator** replay produces
the same messages as the planner, with a preflushed saved store, one readiness
barrier, **0 inference, 0 memory IO/write/extraction and 0 tool effects**. Adapters
throw if any inference or memory operation is attempted. Result:
`forgeboard-none-20261017-05/retention-after.json`, `coordinatorReplay`.

**32K now fits this deterministic preparation.** This is not a provider tokenizer
measurement or a fresh native/model acceptance mission. No ForgeBoard inference,
tool execution, correction, coding, larger-context request, model/output setting
change or cloud call was performed.

### Verification and Unchanged Model-Quality Finding

Focused verification: **261 tests in 8 files passed**, covering the builtin shell
guard before native dispatch, unread edit safety, no-effect receipts, unresolved/current
failures, recurrence, unknown effects, superseded successful writes remaining
verbatim, approvals, duplicate/reversed IDs, provider/MCP impersonation, user
boundaries, original source-group integrity, serialization/restart, exact source
restoration, shared retrieval bounds, scope isolation, persistence-barrier failure,
and genuine protected overflow. Existing accounting, accepted-plan projection,
retrieval and F1 tests remain green. **28 new regression cases** were added.

Final gates:

- `npm.cmd run check-types`: passed after correcting a test-fixture-only JSON
  value type; final build also compiles all TypeScript.
- `npm.cmd run lint`: passed, unchanged baseline **71 warnings / 2 informational
  notices**, no new diagnostics.
- `npm.cmd test`: **2822 passed in 201 files**, no failures.
- `npm.cmd run build`: passed, including final TypeScript compilation. Existing
  ineffective-dynamic-import notices for customExecution/agent/transport/
  chatRuntime and the plugin-timing notice remain; no new build failure.
- `git diff --check`: passed; only normal Windows LF/CRLF conversion notices.
- No Rust files changed; Rust gates were not repeated. No native GUI, live
  provider, Linux/macOS host or larger-context verification is claimed.

The live -05 engineering result is unchanged: about **10m54s**, **23 completed
inferences**, **27 tools**, **10 successful write-bearing shell calls**, but no
working backend/frontend, persistence, SSE, application tests or successful
production build. This fixes unnecessary hot representation of proven no-effect
history; it does **not** demonstrate improved Qwen engineering ability or a working
ForgeBoard. No subsequent mission/checkpoint, unrelated work/stash/delegation/
`autonomous_tracker/` change, native GUI interaction, larger-context test or push.

## Post-retention sustained live acceptance

### Isolation and Frozen Controls

2026-10-17, baseline **`c01786e fix(ai): compact resolved tool failures`**,
clean `main`, **45 ahead / 0 behind recorded `origin/main`**, without fetching or
pushing. This is one fresh mission, not a continuation of -05:

- Workspace: `C:\Users\Hayden\Documents\forgeboard-qwen-none-20261017-06`.
- Evidence ID: **`forgeboard-none-20261017-06`**.
- Local preserved evidence:
  `src-tauri/target/real-qwen-product/forgeboard-none-20261017-06/`.
- Only an empty Git repository was initialized; no source was seeded. Metadata
  preflight also confirmed that the project still contained only `.git`.
- Win32 process inventory immediately before the mission found no competing
  Clack acceptance host, Cargo/rustc/rustfmt, Clack/Vitest Node worker or acceptance
  runner. No other Clack editing run was reported by the user. Unrelated processes
  were not terminated. The preflight host had exited before mission startup.
- `frozen-source.json` and `source-freeze-after.json` checked **1,019 tracked
  files**, with **zero changes** during the mission. Production, harness, tests,
  prompts, approvals and timeouts were not edited while Qwen was running.
- The tunnel initially refused connections. After the user's restoration,
  metadata requests and the **prepare-only preflight passed with zero inference**.
  The server reported **Ollama 0.40.5**. This is an observed server version, not a
  Clack tuning change or a claim that the deployment version was held constant
  across earlier experiments.

All **12 native inference requests** preserve the exact model
**`qwen38-uncensored:latest`**, `options.num_ctx=32768`,
`options.num_predict=2048`, **`think:false`**, `stream:true`, and destination
**`http://127.0.0.1:11435/api/chat`**. The saved model digest is
`0e163794a8b9cdd6e234013b1a27d2e58f06f48d20413a0c2e3e370faaef5505`.
Reasoning was explicitly **None**, fallback remained **Never**, cloud inference
was **0**, and the production **60s meaningful-progress idle / 600s overall**
request limits were unchanged. All 16 normally selected tool schemas were
unchanged across the requests; no retrieval tool was forced into the F1 surface.

The full existing ForgeBoard specification equals the fixture's `mission`
constant byte-for-byte in the saved original user message. It was submitted
**exactly once**. Normal later requests carry that same conversation history;
they are not new user submissions. No reminder, manual Continue, requirement
resend, setting change, evaluator-written application code, model download,
Automatic reasoning run or comparison-model experiment occurred.

### Chronology and Approval Stop

Harness wall time: **17:52:10.200 to 17:56:27.400 Europe/Paris**, **257.200s**.
The original production run began at 17:52:14.778; its cancellation was recorded
at 17:56:26.015. The native host remained healthy until the controlled teardown.

| Request | Observed model action / result |
| --- | --- |
| 1 | Answer text at **16.942s** after recorded native request start; tool calls at **30.125s**. Listed processes/workspace and ran `$PSVersionTable.PSVersion; node --version; npm --version`, valid PowerShell, exit 0. |
| 2 | Repeated directory and Node/npm checks. |
| 3 | Accepted a ten-item structured plan: inspection completed, scaffolding active, implementation/testing/build/documentation pending. |
| 4 | Created `shared`, `server/src`, `web/src`, and `data`. |
| 5 | Checked the npm registry; no inference outside the authorized local endpoint. |
| 6-8 | Created `shared/src`, then redundantly ensured that directory twice using successful single-line PowerShell. |
| 9 | Tried a multiline POSIX heredoc despite the advertised PowerShell/single-line contract. The builtin guard refused it before native shell execution. |
| 10 | Adapted to one single-line `Set-Content` and wrote `shared/package.json`. Its result appears in request 11 at 17:55:32.482. This is a manifest, not substantive application source. |
| 11 | Called `npm create vite@latest web -- --template react-ts`; output explicitly said **Operation cancelled**, despite exit 0. No frontend scaffold appeared. |
| 12 | Proposed recursive forced deletion of `web`, followed by writing/reading a probe inside that removed directory. This required approval. The existing acceptance evaluator rejected it and stopped the mission. |

The exact pending tool ID was **`44bIMzXw5gl0d7C63noXzFF1FN75c1yD`**,
approval **`aitxt-AB93jhZCc5dHld6cAqWb9MPw`**. Its proposed command was:

```powershell
Remove-Item -Recurse -Force "C:/Users/Hayden/Documents/forgeboard-qwen-none-20261017-06/web" -ErrorAction SilentlyContinue; Set-Content -Path "C:/Users/Hayden/Documents/forgeboard-qwen-none-20261017-06/web/wf-probe.txt" -Value "probe"; Get-Content "C:/Users/Hayden/Documents/forgeboard-qwen-none-20261017-06/web/wf-probe.txt"
```

Decision: **`Command is outside the explicitly reviewed disposable probe grammar`**.
The policy deliberately accepts only its existing absent-literal-`test.txt`
write/read/delete probe, not arbitrary recursive deletion. This compound command
did not match. **It was not approved or executed**: the saved part has a false
approval response and no output; `web/src` remains, and `wf-probe.txt` does not
exist. No permission mode was changed, policy expanded, correction injected or
attempt resumed. This follows the instructed unsafe/ambiguous approval STOP rule.

Final classification: **`HARNESS-BLOCKED / APPROVAL POLICY / INCONCLUSIVE`**.
`harnessStop.classification` is `HARNESS-BLOCKED`; the production run is
`cancelled`, not a provider/model completion. Report `ok:true` means the harness
successfully preserved its report, **not** that ForgeBoard passed acceptance.
Neither a deadline, native host exit, context overflow nor exhausted run budget
caused this stop. Do not label this safety-limited attempt `MODEL-INCOMPLETE`
under the sustained-budget criterion or claim end-to-end acceptance passed.

Counts: **12 completed inference requests; 18 distinct tool calls**, comprising
9 `bash_run`, 5 `create_directory`, 2 `list_directory`, 1 `bash_list`, and
1 `todo_write`. **17 have outputs**: 7 native shell exits of 0, 1 pre-execution
refusal, 5 successful directory calls, 3 inspection calls and 1 accepted plan.
The eighteenth call is the unexecuted approval stop. There were **8 successful
filesystem-write-capable calls**: 5 directory calls and 3 shell calls (2 redundant
directory ensures plus 1 real file write). These are not eight substantive file
writes. Actual file creation was **1 manifest**. Plan state was an additional
non-filesystem effect. Approval counts: **1 evaluated/rejected, 0 approved**.

### Live Receipt and Context Evidence

**One distinct protected failure receipt occurred naturally**, in requests
**11 and 12**. It was not prompted or artificially requested. Ownership/source:

| Field | Evidence |
| --- | --- |
| Conversation | `real-mission-a` in the fresh -06 workspace |
| Original assistant message | `OqBKF2XOcMBH78UD` |
| Refused original call | `M1HMGEpj6HJRWNWIoy1VdYcRYLEGsZq0` |
| Successful later guard adaptation | `F0TYGV6UHh1iATwaPPw5yh3baCWeFFNF` |
| Receipt classification | `refused-before-execution`, effect `none`, work completed `not established` |
| Original SDK source-pair bytes | **720** |
| Original SDK call/result payload estimate | **350** |
| Protected receipt payload estimate | **283** |
| Payload saving | **67 estimated tokens** |
| Audit-derived receipt SHA256 | `9ac69e469b76683768439e4ee06949d964e021f1313c6623ecc7da4c7aa8ffcb` |

Receipt ownership is the conversation plus original call ID and adaptation ID;
the hash is an audit identity, **not** an invented additional durable record.
The original full heredoc/error and every other tool input/output/approval remain
unchanged in the persisted session. Before the successful adaptation, request 10
retains the unresolved refusal verbatim. Thereafter only its working-context
representation becomes a receipt. Successful directory/write calls, accepted
plan and the cancelled initializer's actual output remain intact. There is no
additional uncertain quoting failure or superseded plan in this attempt, so
their live supersession behavior is **NOT EXERCISED**, not newly proven.
All 18 original tool identities are unique; none was replayed by preparation.

The read-only offline auditor reconstructs each actual step using the installed
SDK's `toResponseMessages`, production `planCompaction`, shared B1 estimator and
native Ollama serializer. Every projected history matches its recorded request,
with JSON key order and parallel tool-result completion order normalized only
for comparison. Original source objects are asserted unchanged. Tool IDs,
arguments/results, message boundaries and historical order outside each parallel
result group are not discarded. It makes **zero inference or tool/effect calls**.

At first live receipt preparation, SDK required estimate **21927 -> 21836**,
saving **91** including framing/margin. At request 12, **22770 -> 22680**, saving
**90** because of margin rounding. Converting the same pinned-original
counterfactual to the exact native wire representation gives **21367 -> 21282**
and **22180 -> 22095**, saving **85** each. These are reproducible conservative
estimates, **not provider tokenization measurements**. The smaller receipt
occurred live; the before values are read-only counterfactuals, not extra sent
requests. The -05 deterministic saving of 2845 is not claimed for this new run.

No compaction-pressure boundary was reached. The following are the captured
native-wire B1 budgets, revalidated by the offline audit. Constant components:
system **3617**, schemas **7250**, reserve **2048**, ceiling **32768**.

| Request | Conversation | Input | Margin | Required | Headroom | Receipts |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1181 | 12048 | 1205 | 15301 | 17467 | 0 |
| 2 | 1984 | 12851 | 1286 | 16185 | 16583 | 0 |
| 3 | 2454 | 13321 | 1333 | 16702 | 16066 | 0 |
| 4 | 3297 | 14164 | 1417 | 17629 | 15139 | 0 |
| 5 | 4136 | 15003 | 1501 | 18552 | 14216 | 0 |
| 6 | 4600 | 15467 | 1547 | 19062 | 13706 | 0 |
| 7 | 4884 | 15751 | 1576 | 19375 | 13393 | 0 |
| 8 | 5293 | 16160 | 1616 | 19824 | 12944 | 0 |
| 9 | 5675 | 16542 | 1655 | 20245 | 12523 | 0 |
| 10 | 6093 | 16960 | 1696 | 20704 | 12064 | 0 |
| 11 | 6618 | 17485 | 1749 | 21282 | 11486 | 1 |
| 12 | 7357 | 18224 | 1823 | 22095 | **10673** | 1 |

Lowest native-wire headroom was **10673**; reconstructed SDK planner headroom
was **10088** (required 22680). Both layers fit, but this run **did not cross the
previous sustained 32K failure point**, demonstrate extraction under pressure,
or exercise a new `compaction-protected-budget` failure. The preserved memory
snapshot has **no committed revision**. Extraction **0**, exact-source restoration
**0**, historical retrieval calls **0**, automatic continuations **0**. Normal
tool-step continuation did execute; the 24-step automatic batch boundary was not
reached. The normal startup scoped evidence search ran with no files/task IDs and
returned **0 reads / 0 bytes / 0 chunks**; that is not a successful retrieval.
No original was observed missing, and no restoration was requested artificially.

All 12 engine frames ended `done:true`, `done_reason:stop`, with actual provider
usage available (**1901 output tokens total**). There were **no stream stalls**,
idle/overall-deadline errors, malformed frames or reasoning-only exhaustion.
Largest observed IPC body gap was **39.171s**, below the 60s policy. Bounded native
HTTP receive and IPC/parsed-frame traces are preserved for all 12 requests.
Final `/api/ps` and `/api/version` both returned 200, with the exact model loaded
at context **32768**. The captured WebView diagnostic
`Failed to unregister class Chrome_WidgetWin_0. Error = 1412` occurred at teardown
after the recorded approval stop/report; it is not evidence of the earlier
unconfirmed host-exit class recurring. The owned native host and runner exited;
post-run Win32 inventory found no Clack/Cargo/test/harness leftovers.

### Project Verification and Continuity

Independent inspection, without changing application source, finds only
**`shared/package.json`** and empty scaffolding directories. The manifest points
to `shared/src/index.ts`, which does not exist, and has no scripts/dependencies.
The external repository remains unborn `main`, with only `shared/` untracked.
There is no root/server/web package, lockfile, installed workspace dependency
tree, application source, test or executable build target. Therefore no install,
test, build or server was launched by the evaluator: there is no appropriate
application command to execute without manufacturing missing work.

| Application milestone | Result |
| --- | --- |
| First substantive backend source/API | **NOT IMPLEMENTED**; no request/timestamp |
| First substantive React frontend | **NOT IMPLEMENTED**; no request/timestamp |
| Persistence and runtime-data ignore rules | **NOT IMPLEMENTED** |
| SSE and live frontend updates | **NOT IMPLEMENTED** |
| Project/task CRUD, search/combined filtering, validation/JSON errors | **NOT IMPLEMENTED** |
| Port 4317, page size, title validation and debounce in working code | **NOT IMPLEMENTED** |
| Application tests written / run | **0 / 0** |
| Production build / README / `.gitignore` | **NOT IMPLEMENTED** |

The conditional **50 -> 25 correction was not sent**. There was only one real
file write, no successful `write_file`/`edit`/`multi_edit`, and page size 50 had
not entered implementation or the accepted plan. Directory/probe calls do not
satisfy the three-file-write rule. The current requirement is therefore **50**.

Continuity scorecard below scores retained requirements/evidence, **not completed
features**. The original full user specification is present in every request;
no reminder or retrieved substitute was used to improve the score.

| Continuity item | Score | Evidence / limit |
| --- | --- | --- |
| Core objective | **PASS** | Original ForgeBoard objective retained; not implemented. |
| Backend port 4317 | **PASS** | Original and accepted backend plan; no listener implemented. |
| Current page size 50 | **PASS** | Original retained; correction eligibility not reached. |
| Title max 120 | **PASS** | Original retained; no validation implemented. |
| Debounce 750 ms | **PASS** | Original retained; no frontend implemented. |
| SSE | **PASS** | Original and accepted plan retained; not implemented. |
| Persistence | **PASS** | Original and accepted plan retained; not implemented. |
| No telemetry/cloud | **PASS** | Requirement retained, zero cloud inference; no product implementation to verify. |
| Tests/build obligation | **PASS** | Original and explicit unfinished plan retained; neither executed. |
| Active unfinished work | **PASS** | One inspection item complete; nine unfinished items persisted, marked cancelled on the safety stop, not falsely completed. |
| Relevant latest failures | **PASS** | Original refusal preserved; adaptation receipt is qualified; initializer cancellation appears in request 12. Final denied approval is persisted, not sent back as a fabricated model continuation. |
| Superseding 25 requirement / natural source restoration | **NOT EXERCISED** | Neither was triggered; no RETRIEVED claim. |

### Assessment, Verification and Decision

**Clack runtime:** task, original requirements, plan, effects and failure evidence
survived; all 12 context preparations and streams fit/completed, and a qualified
no-effect receipt occurred live. Approval enforcement stopped the ambiguous
destructive command as instructed. No confirmed new Clack defect was established.
Actual compaction extraction, exact restoration and continuation across a batch
boundary remain untested by this short run. Do not convert healthy early tool
loops into a claim that sustained end-to-end context acceptance has passed.

**Qwen engineering:** valid initial PowerShell, a useful structured plan and one
guard adaptation were observed, but also repeated empty-workspace probes, a
POSIX multiline mistake after explicit PowerShell guidance, cancelled scaffolding
and an unproductive destructive/probe proposal. There was no substantive
ForgeBoard implementation. The approval stop prevents a fair final-budget model
completion verdict; these observed choices do not become context-runtime defects.

**Further Clack architecture changes are not justified by this evidence.**
The earlier -05 model-quality evidence remains intact; this new attempt neither
repairs ForgeBoard nor proves the stronger sustained `MODEL-INCOMPLETE` threshold.
It must not be silently resumed with broader approval rules. Any later acceptance
or coding-specialized local-model comparison requires a separate authorization
and fresh experiment; none was performed here.

Verification actually performed:

- Pre-run acceptance/tracing/approval tests: **43 passed in 3 files**:
  `src/test/ollamaStreamTrace.test.ts`,
  `src/test/acceptanceApprovalLifecycle.test.ts`,
  `scripts/acceptance-approval.test.mjs`.
- Post-run receipt/compaction verification: **74 passed in 3 files**:
  `compactionPlan.test.ts`, `conversationCompaction.test.ts`,
  `agentCompaction.integration.test.ts`. The first sandbox invocation failed
  before collecting tests because temporary-cache rename returned **EPERM**;
  the same unchanged focused command passed outside the sandbox. This was not
  a product regression or live inference failure. **117 focused tests total**.
- Native acceptance example build with `--locked --target-dir target/codex-test`:
  passed. Windows native IPC/provider/tool-loop evidence was obtained, not native
  GUI interaction or Linux/macOS verification.
- `npm.cmd run check-types`: passed. No Rust or production TypeScript changed;
  full Clack tests/build/lint and Rust suites were not redundantly repeated.
- `node --check scripts/audit-post-retention-run.mjs`: passed. Focused Biome
  lint through its configured `src/` stdin path passed with unchanged text and
  no diagnostics; no broad formatting or baseline-warning churn.
- `scripts/audit-post-retention-run.mjs <absolute -06 evidence directory>`:
  passed. Hash-pinned bounded inputs, exact one-time spec, all 12 native controls,
  all 18 persisted tool/approval records, no replay, live receipt identity/cost,
  every SDK projection/native-wire budget, final file inventory and completed
  native receive traces were checked. Its JSON output is preserved locally as
  `post-retention-audit.json`. Normalized comparison accounts for optional
  undefined JSON diagnostic fields and parallel result arrival order; raw
  evidence is not rewritten.
- `git diff --check`: passed. No production changes before/during/after the
  mission; only this additive report and an offline evidence-audit script changed.
  No unrelated work, stashes, delegation files or `autonomous_tracker/` were touched.

Evidence integrity anchors (full captures remain local under the ID above, not
committed as large transcript artifacts):

| Capture | SHA256 |
| --- | --- |
| `mission-a-1.json` | `1cc951ac9e7e4a34d702b66b5e33512d7eaef1af849f774efe25b8c3e8e3d8de` |
| `mission-a-1.requests.jsonl` | `7b386ee20e03e405887bac4a8ca89ae112608f1562838fac63e9776836e15e5d` |
| `mission-a-1.jsonl` | `8a8d86add819d600f8e013de79654759f81f5994ba6d1d3ee6dbd52d18aeb2d0` |
| `mission-a-1.receive.jsonl` | `282f266d6ce5c14b85afe478c757e2f70f51ed57e86853d8d8f1f413698d56fc` |
| `data/terax-ai-sessions.json` | `d8047ac6e336e99c2b07ea573b9647de8177ffb4fd376dd41a65b83a005a595f` |

Completion scope: evidence/docs/offline audit only,
`test(ai): verify post-retention local agent run`. No subsequent implementation,
Automatic rerun, larger-context test, model comparison or push.

## Canonical Acceptance Approval Evaluation and Fresh -07 Run

### Exact -06 Reconstruction

2026-10-17 checkpoint baseline: **`c1fc6d4 test(ai): verify post-retention local
agent run`**, clean `main`, **46 ahead / 0 behind recorded `origin/main`**.
The preceding -06 record is preserved as the outcome actually observed at that
time: **HARNESS-BLOCKED / APPROVAL POLICY / INCONCLUSIVE**. The following is a
retrospective safety determination, not a resumed run or execution of its command.

- Session: **`real-mission-a`**; run: **`real-mission-a:1792252334778`**.
- Approval: **`aitxt-AB93jhZCc5dHld6cAqWb9MPw`**.
- Tool: **`bash_run`**, call **`44bIMzXw5gl0d7C63noXzFF1FN75c1yD`**.
- Exact cwd: **`C:/Users/Hayden/Documents/forgeboard-qwen-none-20261017-06`**.
- Exact command:

```powershell
Remove-Item -Recurse -Force "C:/Users/Hayden/Documents/forgeboard-qwen-none-20261017-06/web" -ErrorAction SilentlyContinue; Set-Content -Path "C:/Users/Hayden/Documents/forgeboard-qwen-none-20261017-06/web/wf-probe.txt" -Value "probe"; Get-Content "C:/Users/Hayden/Documents/forgeboard-qwen-none-20261017-06/web/wf-probe.txt"
```

| Sequence | Canonical target and effect | State established from preserved evidence and independent inspection |
| --- | --- | --- |
| 1 | Delete `C:\Users\Hayden\Documents\forgeboard-qwen-none-20261017-06\web`, recursively, with `-Force` | Existed; contained only empty `src`. Both were ordinary directories, no junction/reparse/symlink. No preceding operation in this command. |
| 2 | Write literal `probe` to `C:\Users\Hayden\Documents\forgeboard-qwen-none-20261017-06\web\wf-probe.txt` | Did not exist. The preceding deletion removes its parent; there is no recreation step. This is likely to fail, not to access an outside location. |
| 3 | Read that same `...\web\wf-probe.txt` | Did not exist. The same missing-parent issue applies. |

No wildcard, dynamic path, external target, outside-workspace traversal or nested
repository was found. Root/canonical ancestry and the entire existing deletion
subtree were checked. No authored file would have been deleted: Qwen's only
authored file was `shared/package.json`, outside this subtree. The directories
were model-created scaffolding. The repository was unborn `main`; nothing was
committed. Replacing failed frontend scaffolding was plausibly task-related.
Strategic foolishness and likely subsequent file errors do not make the effect
unsafe. No original -06 command was replayed during this investigation.

The old evaluator's rejecting predicate was exactly its failed regex match for
the previously reviewed three-command literal `test.txt` probe, followed by
`if (!match) return deny("Command is outside the explicitly reviewed disposable
probe grammar")`. This happened **before** path resolution, leaving `targets:[]`.
Recursion itself was **not** the reached predicate. General sequencing was not
supported; only the one historical sequence was matched. Its later absent-file
check deliberately blocked existing content at `test.txt`, but that check was
not reached for this command. The proposed effect was not intrinsically unsafe
or unresolved once actually inspected.

**Root-cause classification: TEST_HARNESS / APPROVAL EVALUATOR TOO NARROW.**
Production Clack correctly required approval. The evaluator failed to simulate
an informed user decision for a safely confined destructive effect. Offline
evidence: `forgeboard-none-20261017-06/approval-safety-reconstruction.json`.
That record qualifies the scope only; its original live approval remains denied.

### Harness Policy and Bounds

Only harness/tests/docs changed. **No production AI, permission, context,
retention, transport, shell, session or native Rust source changed.** In
particular, ac1c8ed, 97148e9 and c01786e remain unchanged, including reserve,
margin, schema policy, current/uncertain effects and no-replay protection.

`scripts/acceptance-approval.mjs` now makes an explicit per-approval effect
decision using `scripts/acceptance-powershell-effects.ps1`:

- Uses PowerShell's **AST parser**, not a `Remove-Item` regex, and never executes
  the proposed command to evaluate it. It binds literal parameters to recognized
  `Remove-Item`, `Set-Content`, `Add-Content`, `New-Item` (ordinary File/Directory),
  `Get-Content`, `Test-Path`, and `Out-File` operations.
- Accepts sequential recognized operations and, in the final tested version,
  bounded **literal string/string-array -> file writer** pipelines. Command-fed
  pipelines, expression evaluation, substitutions, functions, using/requirement
  directives, redirections, aliases, unknown operations/parameters and dynamic
  paths fail closed. This is deliberately not a general shell interpreter.
- Requires the current session/run/workspace and an **exact registered pending
  production approval ID, tool-call ID and input**. The runner records pending
  approvals from the live fixture, rejects duplicate evaluations, and clears
  registrations when ownership changes. The existing observer rechecks ownership,
  cwd, responder readiness and unchanged input immediately before submission.
- Resolves **every** effect, including operations after a deletion. Checks the
  exact disposable root's canonical identity and own ordinary `.git`, lexical and
  canonical containment, existing ancestry, and the complete deletion subtree,
  even when the command omitted `-Recurse`. Missing write targets remain tied to
  verified ancestry; supported operations cannot introduce links.
- Rejects scratch-root deletion, parent/drive-relative/provider/UNC/device/stream
  ambiguities, wildcard targets, secret/model-data paths, links/reparse points,
  hard-linked effect files and nested repositories. Native FileAttributes checks
  cover reparse points before descending. Recursive inspection remains complete
  if an earlier read/test operation already visited the same directory.
- Bounds: **16384 command characters**, **16 operations**, **512 literal pipeline
  strings**, **8192 inspected entries**, **1 MiB helper output**, **5 seconds per
  parser/filesystem helper**, and the existing **64 approvals / 30s lifecycle**
  bounds. No model/context/inference timeout setting changed.
- Reports exact sequential effects, canonical targets, pre-approval existence,
  recursion/force, inspected count, decision and reason. Approved execution still
  goes through production **`respondToApproval`**. No direct evaluator execution,
  permission override, global Full Access, chat message or Continue is used.

These are **point-in-time safety decisions for an isolated paused scratch run**,
not a new OS sandbox or proof against arbitrary concurrent hostile filesystem
mutation. Production permission enforcement remains responsible for execution.
The helper uses the existing Windows PowerShell installation; it does not add a
production runtime dependency. Off-Windows native parser tests require available
`pwsh`, otherwise they are explicitly skipped; unavailability fails approval
closed. Only Windows native execution was verified here.

### One Fresh -07 Mission

Fresh workspace: **`C:\Users\Hayden\Documents\forgeboard-qwen-none-20261017-07`**.
Evidence ID: **`forgeboard-none-20261017-07`**, preserved under
`src-tauri/target/real-qwen-product/forgeboard-none-20261017-07/`.
Only an empty Git repository was initialized. Before startup, process inventory
found no competing Clack acceptance/editing/test/build/Cargo process. Tests and
the metadata-only preflight had ended; preflight sent **zero inference**. No
unrelated process was terminated. The live freeze checked **1021 tracked/new
harness files**, excluding the unrelated autonomous_tracker tree, with **zero
changes during the mission**. No source, test, harness, prompt or control was
edited until the native host and runner had fully exited.

Every one of **20 recorded native requests** retained:

```text
model: qwen38-uncensored:latest
route: http://127.0.0.1:11435/api/chat
num_ctx: 32768
num_predict: 2048
think: false
fallback: Never
cloud inference: 0
meaningful-progress idle: 60s
overall deadline: 600s
```

The same 16 normally selected schemas were preserved. Ollama reported 0.40.5;
the final exact model digest remained
`0e163794a8b9cdd6e234013b1a27d2e58f06f48d20413a0c2e3e370faaef5505`.
The unchanged full ForgeBoard specification was submitted **once**, as the only
original user message. No reminders, manual Continue, evaluator implementation,
settings change, Automatic run, second mission or model download occurred.

Wall time: **18:56:43.177 to 19:03:30.211 Europe/Paris**, **407.034s**.
First answer text arrived **13.133s** after the recorded native request start;
first tool call at **19.916s**. The first shell command,
`node --version; npm --version`, used correct PowerShell syntax and exited 0.

Qwen made a seven-item plan retaining port 4317, page size 50, title limit 120,
debounce 750ms, persistence, SSE, tests/build and README. It created directories,
wrote a root manifest, `.gitignore` and `tsconfig.base.json`, then repeatedly
failed to write the server manifest: multiline guard refusals, a missing-file
read and a malformed quoted PowerShell command. A successful helper-function
declaration did not create application files.

At request **20**, approval **`aitxt-jaYkQ14o2groDEQKZyzQdvHe`**, tool call
**`B9ezYiYAf0ICXUeDArGCs1bq0z0qKZBU`**, proposed:

```powershell
Remove-Item -Force server/package.json -ErrorAction SilentlyContinue; '{' | Out-File -Encoding utf8 -FilePath server/package.json
```

Both targets resolve to
**`C:\Users\Hayden\Documents\forgeboard-qwen-none-20261017-07\server\package.json`**,
which did not exist. The version frozen for this mission rejected the second
statement's pipeline AST before target resolution:
**`Only sequential literal cmdlets are supported`**. There was **one approval
evaluated, zero granted, zero submitted/executed**, and the original production
run was cancelled safely. The new -06 recursive-delete rule was not exercised
naturally in this fresh mission. The native host stayed healthy; the evaluator,
not Clack, Ollama, a context failure or a deadline, ended the run.

After teardown and successful freeze verification, the **static literal file
output** AST form described above was added and tested. It now qualifies this
exact command in a **no-execution offline** check, preserving both effects and
their common scoped target. It would merely write an invalid one-character JSON
file, which is bad engineering, not an outside-workspace effect. Proof:
`post-run-literal-pipeline-safety.json`. **The command was not executed, the run
was not resumed, and no replacement experiment was performed.** The final parser
extension has automated/native-test evidence, not a fresh live approval success.

### Receipts, Budgets and Project Outcome

Counts: **20 inference requests**, **20 distinct tool calls**, **19 outputs**;
11 shell calls (6 exits of 0, 3 guard refusals, 1 parser error, 1 denied pending
call), 5 directory calls, 2 file reads (one missing), 1 directory listing and
1 plan update. There were **8 successful filesystem-write-capable effects**:
5 directory calls and **3 actual authored scaffolding files**. The function
declaration and plan are separate non-file state effects, not application writes.

**Three distinct no-effect failure receipts occurred live.** Source conversation
`real-mission-a`, original assistant message **`R1O7mN9xT5h3cl3h`**:

| Original call | Adaptation | Original SDK pair | Receipt | Payload saving |
| --- | --- | ---: | ---: | ---: |
| `dcaW2JZhig5CX9HvXBk8urnmDUXeBnO9` | `thNXSA3X2FKoltxoDoBsh0R4qkqKrJq7` | 665 | 283 | 382 |
| `yXRrZbEauhJC2dQxPWbIJva57eSUPWB5` | `lumHH5ITqPipZJkRs91H8pzx7cCYsmJh` | 586 | 283 | 303 |
| `r8S4C9UcZuEb7klZZGvDPPdVsYTgaDkz` | `lumHH5ITqPipZJkRs91H8pzx7cCYsmJh` | 586 | 283 | 303 |

The first receipt occurs in requests **12-20**, the other two in request **20**.
Total payload estimate **1837 -> 849**, saving **988**. At the final routine
preparation, SDK required **27726 -> 26589**, saving **1137**, while exact native
wire representation gives **27692 -> 26572**, saving **1120**, including framing
and margin. These before values are offline counterfactuals, not additional
requests or provider token counts. A successful function definition proves a
single-line guard adaptation only, **not** completed server code; the receipts
retain effect `none` and work completed `not established`.

All original call/result/approval records remain unchanged in the persisted
session; there is no replay or missing original. The read-only audit matched
all 20 SDK projections through the production serializer to their actual native
requests and shared B1 costs. Current failures remained full until guard
adaptation, and the quoting failure/successful writes remained full. Detailed
per-request budgets, original evidence hashes, receipt IDs/costs, source checks,
usage and plans are in local **`approval-run-audit.json`**.

Minimum native-wire headroom **5951** at request 19; reconstructed SDK minimum
**5982**. Constant system **3617**, schemas **7250**, reserve **2048**. Request 19
wire conversation **11650**, input **22517**, margin **2252**, required **26817**;
request 20 conversation **11427**, input **22294**, margin **2230**, required
**26572**. All fit **32768**. No compaction pressure/previous 32K failure boundary
was reached. Extraction **0**, historical retrieval/source restoration **0**,
batch auto-continuation **0** (20 < 24 steps), memory revision **none**. Normal
tool loops ran; the empty startup scoped evidence search retrieved no source.

All 20 native streams completed with provider final `done_reason:stop`; actual
provider output total **3173**. No stall, timeout, malformed frame or hidden
reasoning was observed. Maximum IPC raw gap **39.560s**. Native HTTP-body, IPC and
parsed-frame traces were preserved. Final metadata endpoints returned 200 and
reported the exact model loaded at 32768. Post-run process inventory found no
abandoned Clack/Cargo/test/harness process.

Independent project inspection found only **`package.json`**, **`.gitignore`**
and **`tsconfig.base.json`**, plus empty directories. The manifest is valid JSON
with scripts referring to missing server/web workspace packages. The TypeScript
config is **invalid JSON**, starting with `[compilerOptions]` and ending with
`include: []`. No dependencies were installed by the evaluator, and no source
was repaired. Actual evaluator commands, unchanged:

- `npm.cmd test`: **exit 1**, `No workspaces found: --workspace=server`.
- `npm.cmd run build`: **exit 1**, the same missing-workspace error.

Their npm logs were copied as `independent-test.log` and `independent-build.log`.
Qwen itself wrote/run **zero application tests** and ran **no application build**.
Backend/frontend, project/task CRUD, persistence, SSE, validation, search/filter,
working port/page/title/debounce behavior and README are **NOT IMPLEMENTED**.
There is no first substantive source request/timestamp to report. Git remains
unborn `main`, with the three scaffolding files untracked.

**Correction limitation, not a model continuity result:** the existing unchanged
fixture did **not** send 50 -> 25. It counts only `write_file`/`edit`/`multi_edit`
outputs and looks for 50 in those write inputs, ignoring successful shell writes
and the accepted plan's page-size reference. The broader requested condition
(three authored files plus page size 50 in the plan) was present, but that
counter did not recognize it. This separate harness limitation is recorded, not
silently fixed during the run or disguised as unmet model-memory behavior. The
current actual user requirement remained **50**. No correction/restore continuity
score is claimed; the requirements, active unfinished plan and failure evidence
were retained, with all seven unfinished plan items cancelled rather than
falsely completed after the stop.

### Classification and Verification

**-06 root cause:** safe, fully resolved scratch effects rejected by a literal
probe allowlist: **TEST_HARNESS / APPROVAL EVALUATOR TOO NARROW**. Corrected.

**-07 terminal classification:** **HARNESS-BLOCKED / UNSUPPORTED STATIC
FILE-OUTPUT PIPELINE / INCONCLUSIVE**. The post-run parser extension is tested,
but the preserved original outcome does not become a live approval success.
The additional correction-fixture limitation also prevents a supersession-memory
acceptance claim. No extra mission was run to force an approval or correction.

**Clack runtime:** healthy for the observed 20-request run, source/effect
retention and budgets verified, no new confirmed production Clack blocker.
Destructive operations still require production approval; they were never
bypassed. Sustained extraction and end-to-end acceptance are not proven.

**Qwen engineering:** **MODEL-INCOMPLETE as observed delivery**: after 20 normal
inference/tool cycles and nearly seven minutes, only manifests/config/probes and
repeated shell-format mistakes, no substantive application. This is explicitly
**not** a final-budget model failure verdict: an evaluator limitation stopped
the run before its normal completion/budget boundary. Poor early decisions and
incomplete engineering are real observations; the terminal cause remains the
harness. **Further Clack architecture changes are not justified by this evidence.**

Final verification:

- **115 tests passed in 4 files**: **56** approval evaluator cases,
  **13** acceptance lifecycle cases, **35** production security cases, **11**
  stream-tracing cases. Covers safe recursive deletion, delete/recreate/write,
  exact -06 and -07 commands, literal pipelines vs executable pipelines, all
  operands, escapes/root/absolute/wildcard paths, native junctions/reparse
  traversal, UTF-8/Unicode path identity, hard links, nested repos, foreign IDs/owner/input, bounded decisions,
  one actual native scratch delete/recreate through the production responder,
  exactly one execution, zero added user messages, stale decisions and unchanged
  restart/no-revival behavior. No tests skipped on this Windows host.
- `npm.cmd run check-types`: passed. All subsequent changes were harness
  JavaScript/PowerShell/tests/docs, no production or compiled TypeScript changes.
- Focused Biome lint through its configured source stdin path: all three changed
  JS files passed, **no diagnostics or text changes**. JS `node --check` and
  native PowerShell `Parser.ParseFile` syntax checks passed.
- The existing locked isolated native acceptance example build and both native
  host phases passed. Rust/example source was untouched; no full Clack/Rust suite
  was redundantly rerun. Windows native IPC/tool evidence and native test effects
  are distinct from GUI interactions: **no Computer Use/native GUI verification**,
  Linux/macOS native verification or alternate-model test was performed.
- Frozen-source validation: **1021 files unchanged during the mission**.
  Final static-pipeline support was added only after teardown. Raw live evidence
  and prior -06 hashes were preserved. `git diff --check`: passed.
- Unrelated work, safety stashes, delegation files and `autonomous_tracker/`
  were not modified, staged or committed. No production setting or permission
  semantics changed. No push.

Live evidence hashes:

| Capture | SHA256 |
| --- | --- |
| `mission-a-1.json` | `f7c1002484055c12d2e4d16123156c6034cab325921067158ca97e33060d5243` |
| `mission-a-1.requests.jsonl` | `a37e3281b4039a46182db1dec72798596f3bdd1220d4176de7d8d737c4bc1fb4` |
| `mission-a-1.jsonl` | `60fe1f39c4be3d9c9c7f56b6b1f451ffe902594094ba62f30779398f8fb99549` |
| `mission-a-1.receive.jsonl` | `07e62baeb855f30c1fc929a8cd41b6547b63d173fb9701f5ddbc5e8c576dc71e` |
| `data/terax-ai-sessions.json` | `bfa6670ee0e54b647c9244d21639dc0577e8911ed89cdcd82059fd49a82c993c` |

Commit scope: **`test(ai): generalize safe live approvals`**, harness/tests/docs
only. Exactly one fresh mission, no resume, no further checkpoint and no push.

## 2026-10-17: Corrected Write/Plan Canary and Fresh -08 Terminal Run

### Scope and Detector

Baseline: clean **main at `47aab89600ec2cc03d294cfc7c5d8bc80cfb61a2`**, recorded
origin/main **47 ahead / 0 behind**, without fetch or push. Native process
inventories before preparation, before inference and after teardown found no
competing/abandoned Clack acceptance host, Cargo/Rust build, Vite test or Clack
harness. No unrelated process was terminated. Safety stashes, delegation work
and `autonomous_tracker/` were not touched.

The old correction fixture counted only completed `write_file`/`edit`/`multi_edit`
parts and searched those inputs for 50. It ignored shell writes and the current
accepted plan. The replacement is **acceptance-only**:

- Preserve historical **three successful write EVENTS**, not three distinct
  paths. One completed tool call counts once even if it writes multiple files;
  three confirmed calls writing the same path count three times. Real probes,
  placeholders and malformed authored content have no subjective quality filter.
- Native file/edit results require the production `ok`, `clackWorkspaceWrite`
  and `bytesWritten` confirmation, plus scoped ordinary-file evidence. Queued
  plan-review proposals and directory creation do not count.
- Shell results require the completed production command, exit 0, explicit
  non-timeout/non-truncation, captured stdout/stderr and no stderr, with a known
  root cwd. Read-only reuse of the existing bounded PowerShell AST parser
  identifies literal Set-Content/Add-Content/Out-File/New-Item File effects;
  ordinary workspace content must match the literal write/append, including
  encoding/newline normalization. File identity, SHA256 and tool-call identity
  are recorded. Command text alone, failed/refused/pending/uncertain operations,
  dry runs, missing evidence and silently suppressed write errors cannot count.
  A changed, newly confirmed result can be observed later. Unknown effect forms
  are not guessed or executed; this is not a general shell interpreter.
- Current accepted todo title/description or actual authored project code/config
  can establish page-size 50. Only the current plan is examined, not historical
  snapshots. Original user text, evaluator text, arbitrary 50, cancelled plans,
  unexecuted inputs and superseded current values do not establish this half.
  Missing/changed files are not substituted with historical write input.
- A bounded, run-local `correction-state.json` is atomically replaced. Completed
  tool identities deduplicate observations. The boundary includes the third
  confirmed event and current page evidence. A serialized compare-and-claim
  persists dispatch intent **before** sending. A second observer/continuation
  cannot claim again. Observed user-message ID/time are persisted and emitted
  as `correction-sent`. An uncertain dispatch is never automatically replayed;
  corrupt state fails closed. Original session messages also guard against
  resending. This is harness state, not another product memory store.
- The exact authorized correction remains unchanged. No other evaluator message
  was added; no production Agent, context, memory, retrieval, adapter, execution,
  permission, approval or scheduling behavior was changed.

Before inference, **132 tests in five files passed**, along with types, focused
lint and syntax checks. A read-only replay of preserved -07 recognized its three
actual shell-write events and accepted page-size-50 plan, with third event
`SLX9KmmvhFBUqCx7WFLsjZIZJKbk8DOE` (`tsconfig.base.json`). Nothing was sent to or
executed in that old conversation.

**Post-teardown hardening, not mid-run repair:** -08's plan used the synonymous
`pagination (50/page)` form, which the frozen detector did not recognize. Added
deterministic coverage for that form, `50 per page`, `pagination: 50`, `pageSize:
50` and `page size of 50` after teardown. Also tightened incomplete/suppressed
shell-result handling and literal array NoNewline confirmation. No second live
run was performed. These changes cannot turn -08 into a positive canary result;
they did not alter its terminal interpretation because **no file write occurred**
and the first required half remained false throughout.

### Fresh Run and Controls

- Workspace: `C:\Users\Hayden\Documents\forgeboard-qwen-none-20261017-08`.
- Evidence ID: **`forgeboard-none-20261017-08`**, under
  `src-tauri/target/real-qwen-product/forgeboard-none-20261017-08/` (ignored local
  raw captures). No prior workspace/evidence directory was reused.
- Metadata-only preflight completed with **zero inference** and built the locked
  native acceptance example using the existing isolated target directory.
- Mission: **2026-10-17 17:38:04.630-17:44:33.374 UTC**, **388.744 seconds**.
  Native host PID **36508**, owned runner **35400**. **1023 source fingerprints
  remained unchanged during the entire mission**; verified before any later edit.
- All **25** captured native requests used exact `qwen38-uncensored:latest`,
  `http://127.0.0.1:11435/api/chat`, `num_ctx:32768`, `num_predict:2048`,
  `think:false`, streaming, fallback Never and **zero cloud inference**.
  Production idle **60s** / overall **600s** limits were unchanged. Automatic
  reasoning was **not** run. Ollama metadata version **0.40.5**, model digest
  `0e163794a8b9cdd6e234013b1a27d2e58f06f48d20413a0c2e3e370faaef5505`,
  final native loaded context **32768**.
- The unchanged full specification was submitted **once**, message
  **`JkSey58FLAADOTSX`**. It is the only user message. No reminders, manual
  Continue, correction, requirements resend, tuning or evaluator implementation.
  Normal production selection exposed 16 tools initially, 13 during natural
  continuation; no test-only execution tool was added.

Chronology:

| Requests | Observed Work |
| --- | --- |
| 1 | Empty workspace inspected; accepted 11-step plan, including pagination (50/page), port 4317, title 120, persistence/SSE, 750ms debounce and tests/build/README. First answer output after **13.247s**; first tool batch after **69.797s**, measured from the first captured request. |
| 2 | First shell command `node --version; npm --version; npm config get registry`, valid native PowerShell, exit 0. Node 22.20.0, npm 10.9.3. |
| 3-4 | `npm ping 2>&1 \| head -5` failed because PowerShell has no `head`; Qwen independently retried `npm ping`, which succeeded. |
| 5-9 | Sixteen directory creations, no file content. |
| 10-11 | Edit of nonexistent, unread `package.json` refused by read-before-edit; subsequent read reported missing file. |
| 12-13 | Two multiline shell inputs refused before execution. The second attempted base64 generation but still contained literal newlines. No file write. |
| 14-15 | Repeated reads of still-missing `package.json`. PowerShell exit 0 with explicit Get-Content errors in stderr: **not** successful file-write evidence. |
| 16 | Prose proposing a helper, but no helper/tool effect. Included a model-generated receipt-shaped string with an invented source identity. |
| 17-25 | Nine production auto-continuations received empty provider responses, each final `done_reason:stop`, `eval_count:1`. No new tools or effects. Production continuation budget stopped further requests. |

Terminal budget is **`phase:hard-limit`, `stopReason:continuations`, totalSteps:25,
continuationCount:9/maxAutoContinuations:9`**. Captured run metadata retains
`state:running`, but its stopped budget phase and inactive inference are explicit;
this is a paused, unfinished task, not successful completion or a live abandoned
request. All 11 todos remain unfinished, not falsely completed. There was no
evaluator stop, timeout increase, manual resume or tool-effect replay.

Totals: **27 tool calls, all 27 with output**: 16 create_directory, 7 bash_run,
1 list_directory, 1 todo_write, 1 edit, 1 read_file. **Zero successful file-write
events. Zero approvals encountered/granted/rejected.** The -07 literal file-output
pipeline did **not** occur, so no live approval success for it is claimed.
The existing approval parser/lifecycle regression tests still pass unchanged.

**Correction:** no boundary and no correction message ID/timestamp: the
three-write threshold was never reached. This is a valid negative boundary
observation, **not** proof of live 50 -> 25 continuity. Current requirement
remained 50; later 25 retention is **not exercised**. Positive boundary and
exactly-once dispatch have deterministic evidence, not live acceptance evidence.

### Retention, Streaming and Independent Delivery Audit

Two **genuine production** resolved-refusal receipts occur in requests **15-25**:

| Original Call | Adaptation | Pair Cost | Receipt Cost | Payload Saving |
| --- | --- | ---: | ---: | ---: |
| `u5nOKiCAL8RQpV4Zxar0DZDywv5nTuXc` | `wCb9cpmXLgOI5yRZB3Tvavw1hAcaisZ8` | 611 | 283 | 328 |
| `Evtn9FGt4su73HB8J1kIW1l557A1BqIX` | `wCb9cpmXLgOI5yRZB3Tvavw1hAcaisZ8` | 577 | 283 | 294 |

Total marginal payload **1188 -> 566**, saving **622 estimated tokens**. Offline
SDK transcript reconstruction through `convertToModelMessages` and production
`compactResolvedToolFailures` gives conversation cost **10914 -> 10262**,
saving **652 including message framing**. These are shared-estimator costs, not
additional inference or provider usage. Guard adaptation proves only that the
later command was single-line, not successful Get-Content or implementation;
receipts explicitly retain effect `none`, work completed `not established`.

Qwen's request-16 text copied receipt syntax with invented ID
`X37v40z8b6X937nG1zQwX9Qx9w7Q9Xq`. It has no matching original tool call and is
**unverified model-authored text**, not a third durable/generated receipt, source
proof or completed work. The original tool calls/results remain in session
history. Raw assistant text is preserved rather than rewritten by the evaluator.

Minimum exact native-wire headroom **8498** at request **16**: system **3617**,
tools **7250**, conversation **9334**, input **20201**, margin **2021**, reserve
**2048**, required **24270 / 32768**. All 25 budgets fit. No memory revision,
rolling compaction, extraction, historical source restoration or context-pressure
boundary occurred. Empty startup scoped retrieval was not a retrieval failure.

All **25 native streams** received provider final `stop` and completed HTTP-body
delivery, IPC forwarding and parsed-frame traces. **Zero invalid frames**, no
stream stall/idle/overall timeout. Maximum observed IPC chunk gap **54.501s**
(first request), below the unchanged idle limit; first request total approximately
69.8s. Actual provider-reported total output **2901 tokens**, including nine
one-token empty responses. No inferred token count or hidden reasoning claim.
Final `/api/version` and `/api/ps` returned 200. Host teardown left no competing
or abandoned acceptance process.

Independent inspection, without repair, found **zero project files outside .git**,
only the 16 empty directories. Git is unborn **master**, no tracked/untracked
project files or commits. Package manifests, backend/frontend source, project/task
CRUD, real persistence, SSE, filters/search, actual port 4317 behavior, title 120
validation, page-size behavior, 750ms debounce, README and .gitignore are all
**NOT IMPLEMENTED**. No first substantive backend/frontend/test timestamp exists.
Qwen wrote/ran **zero application tests and zero builds**. Evaluator test/build
commands were **not run**, because no package, tests or build scripts exist; no
dependencies were installed or source authored by the evaluator.

Detailed immutable-run evidence, budgets, shell results, hashes, receipt costs,
unverified-ID distinction and chronology are in local `continuity-run-audit.json`,
`frozen-source.json`, `source-freeze-after.json` and the original captures.

### Classification and Final Verification

- **HARNESS:** healthy for the observed negative boundary and ordinary production
  tool progression; no evaluator block or added message. Positive live correction
  and live destructive approval remain **unexercised**, not passed. The post-run
  page-plan spelling hardening is explicitly separate from the frozen live code.
- **CLACK:** healthy for this observed run, no confirmed new production defect,
  context/transport/memory blocker or stream interruption. Existing guard and
  bounded continuation policy remained enforced.
- **MODEL:** **MODEL-INCOMPLETE / CONTINUATION LIMIT**. After 25 successful
  inference requests and 27 tool calls, no file and no meaningful application.
  This is not a host-interrupted, transport-deadline or context-window failure.
  **Further Clack architecture changes are not justified by this model's observed
  engineering behavior.** No further Qwen ForgeBoard attempt was started.

Recommend a **separate controlled comparison** with already-installed
**`qwen3-coder:30b`**, confirmed by metadata-only `/api/tags` (digest
`06c1097efce0431c2045fe7b2e5108366e43bee1b4603a7aded8f21689e90bca`).
Use the same Clack controls with serialized capability verification. That model
was **not run**, and nothing was downloaded in this checkpoint.

Final focused verification, no skips on this Windows host:

- **139 tests passed / 5 files:** **24** correction-boundary cases, **56** approval
  evaluator cases, **13** acceptance lifecycle cases, **35** production security
  cases and **11** stream-tracing cases. Covers three confirmed shell-write events,
  failed/refused/pending/uncertain/directory/dry-run exclusion, later confirmation,
  native edit/write evidence, current accepted plan/code, prompt/old-plan/unrelated
  50 exclusion, synonymous pagination forms, atomic state/restart, concurrent
  exactly-once dispatch claim, duplicate-message rejection and corrupt state.
- `npm.cmd run check-types`: passed on final TypeScript. Focused Biome lint for
  all five changed code/test files: **zero diagnostics**, no rewritten output.
  All four JS files pass `node --check`; unchanged PowerShell helper AST syntax
  check passed. `git diff --check`: passed.
- Locked native acceptance example build and native preflight/mission passed.
  Rust/example and production source unchanged; no full product/Rust suites were
  redundantly rerun. No Computer Use/native GUI verification, Linux/macOS native
  verification, Automatic run, comparison run or new checkpoint was performed.
- Only acceptance harness/tests and this additive report are committed. Raw
  evidence remains local/ignored; no push, permissions or production controls
  were changed.

| Original -08 Capture | SHA256 |
| --- | --- |
| `mission-a-1.json` | `4b20c6203b209f2450b4daab0387f69d995033680b8d9b2c494769e3fa1abc79` |
| `mission-a-1.requests.jsonl` | `ab5b45ca59fdf7b7da62281eff671a29e4160839b3027a13bc3e92deba9ade47` |
| `mission-a-1.jsonl` | `3f0a0ffff8d2607197e9dadf4d9a6edc49931016798f432aa19abc160aa76dca` |
| `mission-a-1.receive.jsonl` | `8b168bf9973db3ab87a95f8d1689d657e3158f0f3f810675b352fa49c87bc0f3` |
| `data/terax-ai-sessions.json` | `3f93893e30adb73e6cbe6237c9dd298e9fe4c8e1874791ce9857da73bbfd820f` |

Commit scope: **`test(ai): exercise corrected local agent continuity`**.
Exactly one fresh mission. No resume, additional Qwen run, architecture checkpoint
or push. Correction implementation complete; live positive continuity is not
claimed for a model that never reached the write boundary.

## 2026-10-18: qwen3-coder controlled ForgeBoard comparison

### Baseline, Scope and Model Metadata

Started from clean **main at `14f88bd7b3b1cf65e4a43fc8ed17363be4deee3a`**,
**48 ahead / 0 behind** recorded origin/main. No fetch or push. Native process
inventories before setup, before the mission and after teardown found no
competing/abandoned Clack acceptance host, Cargo/Rust build or Clack test/harness.
No unrelated process, safety stash, delegation work or `autonomous_tracker/`
was modified or terminated.

The -08 baseline remains unchanged: **25 completed requests, 27 tool calls,
zero successful file writes, 16 empty directories, no application, no stall or
context/approval/retrieval/compaction blocker, minimum wire headroom 8498,
zero cloud calls, nine empty continuations**, terminal **MODEL-INCOMPLETE /
CONTINUATION LIMIT**. Its conclusion remains:
**Further Clack architecture changes are not justified by this model's observed
engineering behavior.** This comparison did not establish a shared Clack defect.

Read-only `/api/tags`, `/api/show`, `/api/ps` and `/api/version` confirmed:

- Exact installed model **`qwen3-coder:30b`**, digest
  **`06c1097efce0431c2045fe7b2e5108366e43bee1b4603a7aded8f21689e90bca`**.
- Installed file size **18,556,700,761 bytes**; **30.5B**, qwen3moe, Q4_K_M,
  Qwen3-Coder Instruct. Advertised context **262144**, not the requested runtime.
- Initial loaded state **unloaded**, `/api/ps.models:[]`. After inference,
  `/api/ps` reported the exact model loaded at **context_length:32768**,
  loaded size **15,449,152,550**, VRAM **15,223,163,452 bytes**.
- Ollama **0.40.5**, capabilities **completion/tools**. Importantly, full show
  metadata also explicitly declares **`thinking:{values:[false],default:false}`**.
  Absence of a general thinking capability did not mean off-control was
  unsupported: existing Clack probing resolved **supported levels `[none]`**.
  Both valid preflight and mission selected **None**, serialized **`think:false`**.
  No Automatic reasoning or synthetic capability override was used.
- Existing model sampling defaults were merely recorded: temperature 0.7,
  top_k 20, top_p 0.8, repeat_penalty 1.05. No sampling fields were added to the
  requests and no model/global Ollama settings, Modelfile or template were edited.
  No pull, update, download or other model inference occurred.

Fresh workspace, deliberately retaining the user-requested date in its name:
**`C:\Users\Hayden\Documents\forgeboard-qwen3coder-20261017-01`**.
Evidence ID **`forgeboard-qwen3coder-20261017-01`**, under local ignored
`src-tauri/target/real-qwen-product/forgeboard-qwen3coder-20261017-01/`.
It did not exist before setup. Only directory and Git metadata were initialized;
the evaluator authored no project implementation.

### Setup Incompatibilities and Preflight Accounting

Only setup/compatibility harness changes were made before the mission:

- An explicit selector accepts only the old model or this installed coder model,
  retaining the old default. The native example verifies the selected exact
  model, destination and 32768 context instead of asserting the old model only.
- The approval evaluator recognizes the new explicitly disposable workspace
  name, with **identical** registered-owner, AST, containment, link, repository,
  scope and effect checks. No general approval policy/parser extension.
- The existing system preflight captures normal session reasoning, includes one
  schema with **no execute function**, uses the same production Ollama adapter
  and records its response/finish/usage. The unchanged mission/correction text
  is locked by a test; mission SHA256
  **`f97ec34eefa136ac5be5847187f768b64bf5587d36140d9fcc53b695fa3e4801`**.

Accounting is explicit, not compressed into a claim of exactly one setup attempt:

| Phase | Native Inference | Actual Result |
| --- | ---: | --- |
| `preflight-1` | 0 | Metadata-only preparation and isolated locked native example build passed. |
| `system-preflight-1` | 0 | Test host exited 101 before inference: its receive-trace phase guard omitted system-preflight. Failure log preserved. Added only that test phase to the allowlist before proceeding. |
| `system-preflight-2` | 1 | `READY`, exact model/32768/2048/think:false and schema accepted, zero tool executions. Audit showed **stream:false** because the old fixture used generateText. This is supplementary non-streaming evidence, **not** the requested streaming pass. |
| `system-preflight-3` | 1 | Corrected fixture uses streamText. **stream:true**, exact model/32768/2048/**think:false**, one schema accepted, `READY`, provider final **done/stop**, zero returned/executed tool calls, zero cloud. Required streaming preflight passed. |

Thus **two compatibility inference requests**, one valid streaming preflight,
plus **one** subsequent mission request: **three total inference requests in this
checkpoint**, not three ForgeBoard attempts. Each preflight reported 303 input /
2 output provider tokens. No ForgeBoard specification was sent in preparation.
The streaming preflight proves schema acceptance and streaming, **not** successful
generation of a structured tool call. This distinction matters to the result.
All setup corrections occurred before the mission/source freeze.

### Mission Controls and Chronology

Exactly one fresh mission: **2026-10-18 15:15:46.049-15:15:59.652 UTC**,
**13.603s wall time**, native host **33388**, owned runner **32660**.
The evaluator did not stop it early based on the older model's duration.
Production returned a natural terminal response after one step.
All **1024 source fingerprints were unchanged during the mission**, verified
after teardown. No mid-run harness/product fix, resend or resume.

The unchanged full ForgeBoard specification was submitted once, user-message
**`PWNkXGmRawtv5DF7`**. The captured native user content contains the normal
workspace/shell environment followed by that exact specification; no hints about
other models, special file tools, architecture or prior outcomes were added.
PowerShell/pwsh and non-POSIX syntax were advertised normally.

The single mission request used:

- Exact **`qwen3-coder:30b`**, native **`http://127.0.0.1:11435/api/chat`**.
- **num_ctx 32768, num_predict 2048, think:false, stream:true**.
- Fallback Never, **cloud 0**, normal trusted-workspace permissions and production
  tool selection, idle **60s** and overall **600s** unchanged.
- The **same 16 tool names** as the -08 first request, same parameter schemas/selection
  policy and system instructions. A read-only body comparison after normalizing
  model/workspace IDs found only the normal request_peer_task description's
  fresh conversation ID and selected-model label differed. This accounts for
  the small schema-cost difference; no special model/tool advice was inserted.
- Same compaction, retrieval, memory, continuation, approval and corrected
  50 -> 25 fixture. No evaluator message beyond the one specification was sent.

First public text arrived after **6.486s** from native request capture.
There was **no actual first tool, first successful file write, first package
manifest, substantive backend/frontend, persistence/SSE implementation or test**.
The response said it would inspect the workspace, then emitted:

```text
<function=list_directory>
<parameter=path>
C:/Users/Hayden/Documents/forgeboard-qwen3coder-20261017-01
</parameter>
</function>
</tool_call>
```

This was **text content**, not a structured native `message.tool_calls` frame.
The independent raw-IPC frame observer recorded **69 valid frames**: 68 text,
one final, **zero tool-call frames**, zero invalid/dropped frames. Native HTTP
body delivery/IPC forwarding completed, provider **done_reason:stop**, actual
provider usage **5640 input / 72 output** tokens. Maximum IPC gap **112ms**.
No stream stall, timeout, malformed JSON frame or output exhaustion occurred.

Clack preserved the text and did not reinterpret it as an authorized action.
That is distinct from losing a structured call in the adapter. The captured
budget has **totalSteps:1, phase:complete, continuationCount:0** and the run is
marked completed because the nonempty provider answer stopped with no open
plan/tools. This is **run termination, not ForgeBoard acceptance/completion**.
There were zero empty responses or automatic/manual continuations. No model
output was executed by the evaluator to make the comparison look productive.

**Terminal classification: ENGINE-BLOCKED / NATIVE TOOL-PROTOCOL BOUNDARY.**
This names the observed boundary, **not a proven Ollama implementation bug**:
whether the weights' malformed output, installed template, backend parser or
their interaction caused the unstructured markup remains **unconfirmed**.
No model/template/parser repair, alternate endpoint test, forced-tool request,
prompt intervention or second mission was attempted. A final answer containing
tool intent is not a completed call and is not scored as coding work.

### Context, Effects and Independent Audit

The single native wire budget fits: system **3617**, schemas **7247** (16),
conversation **1179**, input **12043**, reserve **2048**, margin **1205**,
required **15296 / 32768**, headroom **17472**. Per-request estimates and
original bodies are preserved. No context blocker, pressure compaction,
extraction, restoration, memory revision or failed retrieval was observed.
The empty startup scoped evidence lookup is not a retrieval failure.

**Actual tool calls/executions: 0. Successful writes: 0. Failed/refused tools: 0.**
The one textual list_directory intent does not count as any of those.
No shell command, shell syntax failure or unread-target edit occurred.
Approvals encountered/granted/rejected **0/0/0**. Refusal receipts **0**, savings
**0**; no failures were manufactured. No correction boundary, correction message
or subsequent page-size-25 retention: three writes and authored plan/code never
existed. These positive live checks are **unexercised**, not passed.

Independent read-only project inspection found **only .git**, no application
files or empty project directories. Git is unborn **master**, clean. There is
no package manifest, backend/frontend, tests/build scripts, README, .gitignore
or runtime data. Port 4317 behavior, page-size behavior, title 120 validation,
750ms debounce, CRUD/status/priority fields, JSON errors, filtering/search,
persistence and SSE are all **not implemented or tested**. Backend restart and
SSE-client mutation tests were not applicable because no backend exists.
Application tests/build were **not run** because none exist, not reported as
passing. No dependencies installed or generated project files repaired.

### Direct Comparison and Decision

| Metric | qwen38-uncensored (-08) | qwen3-coder:30b |
| --- | ---: | ---: |
| Completed mission inference requests | 25 | 1 |
| Actual tool calls | 27 | 0 |
| Successful file-write events | 0 | 0 |
| Empty project directories only | 16 | 0 |
| Substantive backend | No | No |
| Substantive frontend | No | No |
| Persistence | No | No |
| SSE | No | No |
| Application tests | No | No |
| Application build | No | No |
| Empty-response continuations | 9 | 0 |
| Stream stalls | 0 | 0 |
| Context blocker | No | No |
| Minimum wire headroom | 8498 | 17472 |
| Mission cloud inference | 0 | 0 |
| Final classification | MODEL-INCOMPLETE / CONTINUATION LIMIT | ENGINE-BLOCKED / NATIVE TOOL-PROTOCOL BOUNDARY |

**No coder-model win or preferred-model recommendation is established.** The
coder model never crossed the structured-tool boundary, so this is not a valid
comparison of sustained engineering productivity. It neither proves that model
selection explains the prior poor outcome nor establishes a shared Clack
context/memory defect. The observed failures differ: repeated real tools and
empty continuations in -08, versus textual tool markup/no execution here.

Clack transport, authorization, context and source preservation behaved normally
in the captured request, with no confirmed new production defect. End-to-end
coder-agent infrastructure is **not** declared functional from a READY preflight.
A **separate, narrow native tool-protocol/template compatibility investigation**
is justified before another coding comparison. It was **not started here**.
Do not promote qwen3-coder to preferred local coder on this evidence, do not
download other models, and stop further Qwen3.8 ForgeBoard attempts. The older
engineering-quality conclusion remains preserved; no memory redesign is proposed.

### Verification and Preservation

- Final focused **141 tests passed / 7 files**, no skips on this Windows host:
  acceptanceComparison, acceptance-correction, acceptance-approval,
  acceptanceApprovalLifecycle, reasoningEffortHosted, ollamaModel,
  ollamaStreamTrace. Includes unchanged mission hash, explicit model/phase
  guards, same confined policy for the comparison root, exactly-once correction,
  lifecycle/security, reasoning and native adapter behavior.
- `npm.cmd run check-types`: passed on the final source. Focused Biome lint for
  five changed JS/TS files: zero diagnostics/rewrites. All three changed JS
  files passed `node --check`. `git diff --check`: passed.
- Locked isolated native acceptance-example builds passed, including the final
  streaming preflight and mission. Only Rust **example harness** changed; no
  production Rust/TS or architecture changed and no full Clack/Rust suite was
  redundantly rerun. No Computer Use, native GUI, Linux/macOS native, real app
  persistence/SSE or successful coding-model acceptance is claimed.
- Only pre-mission harness setup/tests and this additive report are committed.
  The 14f88bd correction detector/approval-effect parser and all old acceptance
  figures are preserved. No source edits during mission, no push, model download,
  Automatic experiment, additional mission or next investigation.
- Local raw records include `model-metadata.json`, all preflight attempts,
  `mission-a-1.*`, `comparison-run-audit.json`, `control-comparison.json`,
  `frozen-source.json` and `source-freeze-after.json`. Raw evidence stays ignored;
  no credentials or model bytes were committed.

| Original Coder Capture | SHA256 |
| --- | --- |
| `mission-a-1.json` | `621a4725dc40507b806d16a375bfb94e4fa4fe97c6bf15d9e5b56ace8c1b7651` |
| `mission-a-1.requests.jsonl` | `40ee9106fc676a847eb83a701a67c9787ffb76bbc4f2674afc396c95b7e47eb8` |
| `mission-a-1.jsonl` | `47d9ea6c090c669580f5d53d1c3f65e770f00fb801eb5106d17148150bdb0d49` |
| `mission-a-1.receive.jsonl` | `24d2984c1d545310d87e0ff7a3d06b15bf87e7b25110bf21ae4eb330f6add991` |
| `data/terax-ai-sessions.json` | `f9f2400eb4aa3d62218bc86fdb9f160148d33e0aa8fe95cb513c40f0ec9225fd` |
| `model-metadata.json` | `9fea7e91ab0f06245623cba435610c5742fc678cf32b1c1f0af7a9b50dbbe983` |

Commit scope: **`test(ai): compare local coding model`**. One fresh ForgeBoard
mission, natural terminal state, comparison limitations documented. No push.

## qwen3-coder native tool protocol investigation

### Scope and Isolation (2026-10-18)

Started from **`1407d4e660baf2779026c679638a80747e6064db`**, clean `main`,
**49 ahead / 0 behind** the recorded `origin/main`, without fetching/pushing.
An elevated process inventory found no competing Clack acceptance host, Clack
Node/Vite/Vitest run, Cargo or rustc process. Existing SSH forwarding was reused;
no unrelated process was terminated. No ForgeBoard specification was sent and
no ForgeBoard experiment was run in this checkpoint.

Exactly **three harmless inference requests** were sent, sequentially: Qwen3.8
through Clack, coder through Clack, then one direct coder native request. Two
metadata-only preparation phases made **zero inference requests**. Both native
hosts exited normally. No returned tool was executed, no tool follow-up was
sent, and both diagnostic workspaces still contain **only .git**, with clean
unborn Git state. Cloud inference **0**, fallback **Never** throughout.

Local ignored evidence is under `src-tauri/target/real-qwen-product/`:

- `tool-protocol-control-20261018-01/`: Qwen3.8 metadata preparation, single
  `system-preflight-1.*`, reconstructed raw `.response.ndjson` and
  `tool-protocol-summary.json`; workspace `workspace/`.
- `tool-protocol-coder-20261018-01/`: corresponding coder records/workspace.
- `tool-protocol-20261018/`: `coder-metadata.json`, `control-metadata.json`,
  exact relevant `*-template-excerpts.txt`, direct request/response/result at
  `direct-coder-stream.*`, and bounded existing Ollama journal captures.

No production TS/Rust, model, Modelfile, parser, global configuration, network
binding or service was changed. No logging was enabled and Ollama was not
restarted. Only non-executing acceptance instrumentation/tests and this additive
report changed. Prior acceptance results above remain historical evidence.

### Installed Model and Template Evidence

Read-only `/api/version`, `/api/tags` and `/api/show` report **Ollama 0.40.5**.
Existing service logs independently identify its selected rendering paths.

| Property | qwen3-coder:30b | qwen38-uncensored:latest |
| --- | --- | --- |
| Digest | `06c1097efce0431c2045fe7b2e5108366e43bee1b4603a7aded8f21689e90bca` | `0e163794a8b9cdd6e234013b1a27d2e58f06f48d20413a0c2e3e370faaef5505` |
| Architecture | qwen3moe, 30.5B, Q4_K_M | qwen35, 27.3B, Q4_K_M |
| Advertised context | 262144 | 262144 |
| Capabilities | completion, tools | tools, thinking, completion |
| Selected template route in journal | renderer_parser, renderer=qwen3-coder, parser=qwen3-coder | gguf_chat_template |
| Visible `/api/show.template` | `{{ .Prompt }}` | 170-line Jinja template |
| Exposed parent name | Empty | Empty |

Coder's Modelfile explicitly declares **RENDERER qwen3-coder / PARSER
qwen3-coder**. The placeholder template is therefore **not evidence of missing
tool support**. No system prompt is exposed. Installed defaults: repeat_penalty
**1.05**, temperature **0.7**, top_k **20**, top_p **0.8**; stop strings
`<|im_start|>`, `<|im_end|>`, `<|endoftext|>`. FROM exposes a local content blob,
not a named parent; its bytes were not inspected. Coder thinking metadata is
`values:[false], default:false`.

Qwen3.8's installed Jinja tool section (lines 57-68) serializes JSON tool
definitions inside `<tools>`, then requires an outer `<tool_call>` around the
inner `<function=...>` / `<parameter=...>` blocks. Tool history (lines 121-143)
uses that same wrapper. It also handles `<think>` and chat boundary tokens.
It does **not** instruct a fundamentally different JSON-only call syntax.

The official version-matched coder renderer likewise inserts tool definitions
inside `<tools>`, but renders their definitions as function/parameter tags rather
than Qwen3.8's JSON definitions. It requires the same outer call wrapper, permits
prose before a call, and renders wrapped call history. This is an existing
official implementation for this exact renderer, not a proposed replacement.
[Ollama v0.40.5 coder renderer](https://github.com/ollama/ollama/blob/v0.40.5/model/renderers/qwen3coder.go).
Installed selection plus successful probes do not support a claim that the
model is packaged incorrectly or lacks a compatible template.

### Exact Serialized Request

The normal Clack configured native model/AI SDK path sent this captured JSON.
For the Qwen3.8 control, **only model differs**; an exact object comparison of
the captured native bodies established that messages, schema and controls match.
The direct coder control reused the coder body without changing any field.

```json
{
  "messages": [
    { "content": "You are a tool-using assistant. Follow the user's tool request.", "role": "system" },
    { "content": "Call get_test_value exactly once with value \"protocol-check\". Do not answer in prose.", "role": "user" }
  ],
  "model": "qwen3-coder:30b",
  "options": { "num_ctx": 32768, "num_predict": 2048 },
  "stream": true,
  "think": false,
  "tools": [{
    "function": {
      "description": "Harmless diagnostic value lookup; no filesystem, shell or external effects.",
      "name": "get_test_value",
      "parameters": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "additionalProperties": false,
        "properties": { "value": { "type": "string" } },
        "required": ["value"],
        "type": "object"
      }
    },
    "type": "function"
  }]
}
```

Destination **`http://127.0.0.1:11435/api/chat`**, existing localhost tunnel to
native Ollama. Reasoning **None / think:false**, context **32768**, output
**2048**, stream **true**; no forced tool choice, alternate API, seed, sampling
override or prompt hints. Normal native idle **60s** / overall **600s** bounds
were preserved; direct observation used those same bounds. `/api/ps` verified
loaded **32768** context for both models. No conversation content or credentials
were included, only the diagnostic prompt/schema.

### Native Results and Adapter Comparison

| Probe | Native valid frames | Native calls | Assistant text | Provider input/output tokens | Provider total duration |
| --- | ---: | ---: | --- | --- | --- |
| Qwen3.8 through Clack | 1 | 1 | Empty | 311 / 27 | 19.006664836s, including 15.296485865s load |
| Coder through Clack | 2 | 1 | Empty | 298 / 23 | 9.822699028s, including 8.820028158s load |
| Coder direct native | 2 | 1 | Empty | 298 / 23 | 0.392327295s, warm; 297 cached input tokens |

Every native call is **get_test_value({value:"protocol-check"})**. All final
frames have **done:true / done_reason:stop** with actual provider usage, no
stall, malformed/dropped frame, reasoning output or textual markup. Clack
preserved each observed call's name, arguments and native ID and correctly
reported SDK **finishReason:tool-calls**. Native `stop` versus SDK `tool-calls`
is expected adapter normalization, not a lost call. Tool executions **0**.

The direct POST finished in **525ms** observed client wall time, HTTP **200**;
the raw response contains the structured call, independently of Clack's parser.
No structured provider field was lost by Clack. These are protocol checks,
not comparative performance or engineering-quality measurements; load/cache
state differs. The test tool has **no execute implementation**, and there is
no agent tool loop in this diagnostic phase.

Non-streaming and OpenAI-compatible controls were **not performed**: native
streaming succeeded through both routes, resolving the primary question without
additional inference. This checkpoint establishes no streaming/non-streaming
difference and does not propose switching production to OpenAI compatibility.

| Evidence | SHA256 |
| --- | --- |
| Captured coder body / direct POST JSON serialization | `376b4590b8e16e94c4660c696287d33ccaf6262ddf636962d7d886ea1503e148` |
| Qwen3.8 reconstructed raw native response | `e492c6d7e929ace5c0f3d8bb5c2b8154ade3a773272674d23fa87140f4caa603` |
| Coder through Clack reconstructed raw native response | `a70731ab49f092765ac0fc1e47c8fc38b4cb3b564c5cff5a9ff1371341b707a9` |
| Direct coder raw native response | `ea3378df7911bb942b8d5fdae6458b2f0740dd43c94bde52e327f8c006fa876e` |

### Earlier Markup, Parser Contract and Ownership

The prior mission remains **ENGINE-BLOCKED / NATIVE TOOL-PROTOCOL BOUNDARY**,
with zero executed tools or coding work. Its text has a `<function=list_directory>`
and `<parameter=path>` block, followed by `</function></tool_call>`, **without
the opening `<tool_call>`**. That exact structural defect is preserved above.
It is not JSON, a structured native call, or the complete expected wrapper.

The official version-matched parser enters call parsing only after the literal
opening wrapper. Without it, the function-looking fragment follows its ordinary
content path; a dangling closing tag does not establish a call. Invalid content
inside a recognized call can generate a warning, but the no-opening-tag content
path need not. This explains the observed native text without requiring a
Clack response defect.
[Ollama v0.40.5 coder parser](https://github.com/ollama/ollama/blob/v0.40.5/model/parsers/qwen3coder.go).

Existing read-only journal evidence contains successful HTTP 200 completions,
32768-token slots and the expected template routes. No tool-parser warning,
template error or generation error appears in the inspected original-mission
window (62 lines) or probe-window capture (bounded to 500 lines, including all
three completions). This absence is consistent with ordinary-content fallback;
it does not prove every internal parser step. Server timestamps are about two
hours ahead of local capture timestamps even after timezone normalization.
Original raw timestamps were preserved; request duration, token counts and
request order provide the correlation. No clock was changed.

**Outcome: native qwen3-coder structured tool calls WORK through Clack and
direct Ollama.** The earlier failure is narrowed to **ENGINE / MODEL-TEMPLATE
TOOL-FORMAT DEVIATION (missing required opening wrapper)** at/before Ollama's
native tool-interpretation boundary, not the Clack request or response parser.
This is a classification of the observed mission output, **not a claim that
all coder calls are incompatible**. No valid wrapped call rejected by Ollama
was observed, so an Ollama parser/template implementation defect is not proven.
Pre-parser token output was not logged; whether model generation or another
internal engine step omitted the opener cannot be further separated here.

The two identical coder minimal bodies both succeeded. The earlier mission is
a different payload, so **identical-request intermittent behavior is not
established**. No general model reliability or sustained coding success is
inferred from a trivial success. It is sufficient to unblock a separately
authorized future coding comparison, which was **not started**.

Executing XML/prose as a Clack fallback is **not justified**. Ordinary assistant
content is untrusted data, and promoting it into an action would bypass the
structured-tool/approval boundary. No text parser, XML recovery, model/template
repair or provider switch was added. Memory, retrieval, scheduler, PeerTasks,
context budgeting, reasoning, continuation and effect safeguards are unchanged.

### Verification and Completion

- Focused **42 tests passed / 4 files**, no skips: `ollamaToolProtocol` (3),
  `ollamaModel`, `ollamaStreamTrace`, `acceptanceComparison`. New cases retain
  malformed text as text, preserve structured calls for both exact models,
  capture serialized native controls/schema, and prove no executor/follow-up.
- `npm.cmd run check-types`: passed after the harness tools map was explicitly
  typed as the SDK ToolSet. Initial harness-only type error was corrected
  before any diagnostic inference; no production fix was needed.
- Focused Biome lint on the changed runner, acceptance fixture and protocol
  test: zero diagnostics/rewrites. Runner `node --check` and `git diff --check`:
  passed. Native acceptance-example builds/preparation and both single-inference
  native probes passed on this Windows host; one direct native probe passed
  against the existing Linux Ollama service. No native GUI interaction or
  macOS/Linux Clack-native verification is claimed.
- No Rust files changed, no full frontend/build/Rust suites were redundantly
  rerun under this evidence-only checkpoint's focused verification policy.
  No installed model changes, extra model downloads, cloud inference, ForgeBoard
  rerun, tool execution, subsequent checkpoint or push.
- Commit scope: **`test(ai): classify qwen coder tool protocol`**. Raw captures
  remain local/ignored; no credentials, model blobs or unrelated work staged.

## Sustained qwen3-coder ForgeBoard comparison

### Isolation, Workspace and Controls (2026-10-18)

Started at **`1198becb26aa05699ce0fa1516c538bfbb7a235a`**, clean `main`,
**50 ahead / 0 behind** recorded `origin/main`. No fetch or push. Initial
process inspection found an unrelated Talus Cargo/rustc build, which was not
disturbed; the final pre-mission inventory found no Clack host, harness,
Node/Vite/Vitest, Cargo or rustc process. No competing Clack run was observed.

Fresh workspace: **`C:\Users\Hayden\Documents\forgeboard-qwen3coder-20261018-02`**.
Fresh evidence ID: **`forgeboard-qwen3coder-20261018-02`**, under
`src-tauri/target/real-qwen-product/` in Clack. Only the directory and fresh Git
repository were initialized; the project contained **only .git** before the
mission. The prior coder workspace and all protocol evidence remain untouched.

Read-only metadata confirmed:

- Exact **`qwen3-coder:30b`**, digest
  **`06c1097efce0431c2045fe7b2e5108366e43bee1b4603a7aded8f21689e90bca`**.
- Ollama **0.40.5**, advertised context **262144**, completion/tools,
  thinking `values:[false], default:false`; installed template unchanged.
- Native **`http://127.0.0.1:11435/api/chat`**, existing authorized tunnel.
- Every captured request: **num_ctx 32768 / num_predict 2048 / think:false /
  stream:true**. Explicit reasoning **None**, not Automatic. Fallback **Never**,
  cloud inference **0**. `/api/ps` verified loaded context **32768** at outcome.
- Production meaningful-progress idle **60s**, overall request **600s**,
  context/compaction/retrieval/memory/tool-selection/approval/continuation policy
  unchanged. Schemas exposed normally increased from **16 to 17**, including
  write_file as the conversation progressed; no evaluator selection override.

One metadata-only preparation phase configured the isolated native profile and
sent **zero inference requests**. No READY, compatibility, protocol, direct
native, alternate API or other-model probe was repeated. The mission received
the exact original full task **once**, SHA256
`f97ec34eefa136ac5be5847187f768b64bf5587d36140d9fcc53b695fa3e4801`.
Its one user message contains the original 4317/50/120/750ms/no-cloud constraints.
No model/protocol/evaluation hints, reminders, manual Continue, requirement
resend, settings change or model-specific prompt tuning was supplied.

All **878 tracked source/harness/config files** in the pre-run freeze matched
after the mission; Git remained clean before this report edit. No production,
harness, model, template, timeout, permission-mode or architecture edit occurred
during the run. The evaluator did not implement or repair ForgeBoard.

### Productivity and Native Tool Reliability

Times below are observed from the first native request capture at
**2026-10-18T16:04:01.806Z**. Tool-effect times come from persisted activity
receipts, not an assumption that generating tool input changed a file.

| Milestone | Elapsed | Evidence |
| --- | ---: | --- |
| First public text | 10.146s | Native text frame / assistant text |
| First structured tool call | 11.531s | list_directory in native tool field |
| First successful file write | 22.775s | backend/package.json, request 4 |
| Third successful file write | 41.158s | backend/tsconfig.json, request 6 |
| Backend bootstrap | 53.745s | backend/src/index.ts; not counted as substantive backend |
| First substantive backend/persistence source | 80.476s | backend/src/datastore.ts, request 10 |
| API and partial SSE source | 110.412s | backend/src/api.ts, request 11 |
| Frontend bootstrap | 115.004s | frontend/src/main.tsx; not counted as substantive frontend |
| First substantive frontend | 132.680s | frontend/src/App.tsx, request 14 |
| Last successful write | 161.126s | frontend/src/components/ProjectList.tsx, request 17 |
| Runtime terminal error | 161.156s | compaction-protected-budget before request 18 |

**17 mission inference requests, 17 provider-native structured calls.** Every
response contains one structured call; 11 also contain ordinary explanatory
text and six are tool-only. All 17 have native **done_reason:stop**; none ended
on output length. **Malformed textual tool intents 0**, empty responses **0**,
automatic continuations **0**, manual continuations **0**. There was no tool
format deviation to recover from, and no XML/text fallback was added or used.
Clack's adapter preserved the structured calls normally.

Actual effects: **16 successful tool executions**, **1 failed**, **0 refused**.
Successes comprise one directory listing, **5 directory creations** and **10
file writes**. Request 15 attempted ProjectList.tsx before its parent directory
existed and returned native filesystem error 3. Without evaluator assistance,
request 16 created that directory and request 17 wrote the component successfully.
This is a recovered filesystem/tool-use mistake, not a protocol failure.

There were **no model shell commands**, dependency installs, test commands,
build commands, commits or todo_write calls. Shell syntax correctness was thus
**unexercised**, despite normal native shell identity being supplied. No
application-test or successful-build milestone was reached by the agent.

The generalized safe approval evaluator/responder was available, but the normal
trusted-workspace path generated **0 pending approval cards**, **0 evaluator
approval decisions** and **0 approval refusals**. No permission escalation or
approval chat message was used. All model effects stayed inside the fresh root.

### Terminal Context Boundary

**Final classification: CLACK_CONTEXT / PROTECTED-BUDGET PREFLIGHT / INCOMPLETE.**

The native host remained alive through reporting and the harness runner exited
**0** after preserving the terminal state. Harness `ok:true` means evidence
collection completed, **not that ForgeBoard was completed**. The session's
actual run state is **failed**, error **compaction-protected-budget**, terminal
and non-retryable. Budget totalSteps **17**, continuationCount **0**. No
eighteenth inference request was dispatched and no manual resume was attempted.

The blocking diagnostic records estimated protected request cost:

| Component | Estimated Tokens |
| --- | ---: |
| System | 3617 |
| Schemas/options | 7502 |
| Conversation | 17837 |
| Input total | 28956 |
| Output reserve | 2048 |
| Reasoning reserve, included in output | 0 |
| Safety margin | 2896 |
| Required total | **33900** |
| Effective ceiling | **32768** |
| Deficit | **1132** |

Core/agent instructions are 3175/442; history/tool state 17598; environment 121;
other structure/options 239; built-in schemas 7381. Derived memory, retrieved
evidence, attachments, custom schemas and MCP schemas are **0** in this
diagnostic. The last sent request had estimated input **26722**, reserve
**2048**, margin **2673**, required **31443**, headroom **1325**, the minimum
across all sent requests. First-request headroom was **17472**. Exact bodies
and per-request wire budgets are preserved.

These are **Clack estimates**, not provider-measured occupancy. Ollama's last
completed request reported **12853 input / 586 output** tokens. There was no
provider context rejection or proof that its actual 32768-token window filled.
The immediate stop owner is Clack's protected-budget/context-preparation gate,
not a model refusal, malformed-tool response, harness exit or transport deadline.
Whether this estimate/protected projection represents a new defect requires a
separate investigation; it was **not diagnosed, patched or bypassed here**.

The original transcript is two UI messages: the complete user task and the
growing assistant/tool turn. The active structured plan remained **empty**.
The failed component write is retained in the source, followed by the successful
directory creation and same-path write; no uncertain effect was hidden or
declared safely elidable just from error prose. Refusal receipts **0**, original
pair/receipt cost comparison not applicable, observed savings **0**. No failures
were manufactured to exercise receipt handling.

Durable memory has **no committed revision**; preparation/source metadata is
preserved. No successful rolling compaction, extraction inference, historical
retrieval tool call or restored evidence was observed. All 17 inference requests
are the ordinary tool-producing mission responses. The terminal guard ran before
another model request; no summarization was forced or context enlarged. Empty
or zero-source preparation is not reported as retrieval success or failure.

Native HTTP-body/IPC tracing completed for all requests, **0 stream stalls,
0 timeout terminations, 0 invalid/dropped frames**. Maximum measured inter-chunk
gap was **28.728s**, below the unchanged 60s idle bound. Provider usage/final
reasons exist for all 17 completed requests. No missing usage was inferred.

### Correction Continuity

The unchanged 14f88bd observer recorded **10 successful file-write events**.
However, page size **50 never materially appeared in current code or an
accepted plan**; pagination was not implemented and no structured plan existed.
The original prompt's 50 alone does not satisfy that trigger.

Therefore the full two-part correction boundary was **not reached**. The
correction was sent **0 times**, not once; no dispatch was claimed, and
correction-state remains pending. No 25 requirement was delivered. Retention of
25 is **unexercised**, not passed or a demonstrated memory failure. There was
no additional chat message, cancellation/resume at a correction boundary or
post-stop reminder.

### Independent Project Audit, Without Repairs

At terminal outcome the project contained **10 model-authored files**: four
package/config files, three backend TS files and three frontend TSX files.
The backend has substantive JSON-file persistence and project/task API code.
The frontend has substantive App/ProjectList code, but **TaskBoard, CSS and
index.html are missing**, making it unusable as a complete frontend. README,
.gitignore, authored application tests, pagination and 750ms debounce are
**NOT IMPLEMENTED**. No useful finished application or final completion claim
was produced before the runtime error.

Independent verification ran only **after** that terminal outcome:

| Check | Result |
| --- | --- |
| Backend dependency install | Exit 0, 395 packages |
| Frontend dependency install | Exit 0, 65 packages |
| Backend npm test -- --runInBand | Exit 1, no tests found, 0 authored tests |
| Frontend npm test -- --runInBand | Exit 1, missing test script |
| Backend npm run build | Exit 2: unused req, incomplete return paths, missing cors declaration |
| Frontend npm run build | Exit 2: JSX compiler option absent, TaskBoard missing; Vite stage not reached |

Installs used **--ignore-scripts --package-lock=false --no-audit --no-fund**;
no manifest, source, test or config was repaired, no missing declaration or
component was added. Backend dependencies emitted deprecation warnings for
inflight/rimraf/glob/uuid. Registry downloads are not inference. No application
tests or build success is credited to the model from these evaluator commands.

Backend tsc emitted JavaScript **despite** its failing exit status. Running the
unchanged generated **node dist/index.js** allowed a separate bounded runtime
audit, without transpile-only flags or a source fix: **22 independent checks,
17 passed / 5 failed**. This is partial runtime evidence, **not a successful
TypeScript production build** and not model-authored tests.

Passed: port **4317**; project create/list/edit/delete; task create/edit/delete
and timestamps; combined project/status/priority/tag/description search;
title **120 accepted / 121 rejected**; missing-title JSON 400; known task-update
JSON 404; initial SSE response; project/task persistence across an actual
backend stop/restart; project deletion removing its tasks.

Failed: individual task-view route (404); invalid status/priority accepted (201);
tasks accepted under a nonexistent project (201); malformed JSON returning an
HTML/stack-bearing response instead of deterministic JSON; mutation SSE delivery.
The SSE connection delivered initial data but no event during a successful
mutation and a **1.8s** subsequent observation. Code inspection confirms only
initial data and a periodic ping, with **no mutation broadcasting**. Thus
required realtime project/task synchronization is **NOT IMPLEMENTED**, although
an SSE transport scaffold exists. There was no polling substitute.

Runtime data was created **only through the application/API**, never manually
edited. Both evaluator-owned backend processes (40936, 38956) were stopped.
Real Git inspection reports an unborn repository with untracked backend/ and
frontend/ trees and no tracked files; **backend/data/*.json is not ignored**.
No app commit was manufactured. Dependencies, compiler outputs and API-created
data are explicitly evaluator-generated additions, not model productivity.
All **10 original files remain byte-identical** to the terminal snapshot.

Frontend loading/error/empty elements and basic buttons exist in source, but
UI runtime/accessibility and full project/task workflows are **unverified**
because the frontend does not build. No GUI success is claimed.

### Direct Qwen3.8 Comparison and Decision

| Metric | qwen38-uncensored (-08) | qwen3-coder:30b (-02) |
| --- | ---: | ---: |
| Mission requests | 25 | 17 |
| Structured tool calls | 27 | 17 |
| Malformed textual tool intents | Not the primary historical metric | 0 |
| Successful file writes | 0 | 10 |
| Substantive backend | No | Partial; API/storage code |
| Substantive frontend | No | Partial; missing TaskBoard/assets |
| Persistence | No | Implemented; independent restart checks passed |
| Required mutation SSE | No | No; initial/ping scaffold only |
| Application tests authored/run by model | No | No |
| Successful production build | No | No; both independent builds failed |
| Empty-response continuations | 9 | 0 |
| Stream stalls | 0 | 0 |
| Context blocker | No | Yes, protected-budget preflight |
| Minimum sent-wire headroom | 8498 | 1325 |
| Cloud inference | 0 | 0 |
| Final classification | MODEL-INCOMPLETE / CONTINUATION LIMIT | CLACK_CONTEXT / PROTECTED-BUDGET PREFLIGHT / INCOMPLETE |

Coder **materially outperformed that Qwen3.8 run in implementation output**:
real code and functional partial persistence instead of only directories.
Its native structured-tool formatting was reliable for these **17/17** observed
responses, with natural recovery from one filesystem mistake. The earlier
malformed first coder mission remains a separate valid ENGINE-BLOCKED result;
it is not erased or reclassified as success by this run.

However, **ForgeBoard is not finished**. The limiting terminal boundary now
implicates Clack's context preparation, so this run cannot establish that all
long-running local-agent infrastructure is functioning or assign incompletion
solely to model quality. No general formatting reliability or end-to-end
preferred-model recommendation follows from one partial run and the earlier
contrary format event. **Do not promote coder to preferred local coding model
yet. Qwen3.8 ForgeBoard testing remains stopped.** No additional model, tuning
ladder, protocol rerun, architecture redesign or subsequent checkpoint was
started. Any investigation of this specific context gate requires separate
authorization; no production repair was attempted in this acceptance.

### Verification and Preserved Evidence

- Focused **144 tests passed / 8 files**, **0 skips**: acceptanceComparison,
  acceptance-correction, acceptance-approval, acceptanceApprovalLifecycle,
  reasoningEffortHosted, ollamaModel, ollamaStreamTrace, ollamaToolProtocol.
  Initial sandbox cache-rename EPERM blocked all suites before any test ran;
  the identical focused command passed when rerun with approved native access.
- **npm.cmd run check-types passed**. Focused Biome lint of the existing runner,
  acceptance fixture and protocol test produced zero diagnostics/rewrites;
  runner/approval/correction scripts passed **node --check**. **git diff --check
  passed**. No full Clack/build/Rust suites were redundantly rerun under the
  evidence-only policy. No Rust/TS/JS production or harness source changed.
- The locked isolated native example build and metadata-only preparation
  passed. Native acceptance ran on this Windows host against the existing Linux
  Ollama service. No Computer Use, native GUI interaction, Linux/macOS Clack GUI
  or complete application acceptance is claimed.
- Local ignored records: setup/model metadata, frozen-source/source-freeze-after,
  preflight-1.*, mission-a-1.* including actual native requests and receive trace,
  correction-state, sustained-run-audit (per-response classes/effects/times),
  project-before-independent-verification, project-git-audit,
  project-source-preservation, independent install/test/build/runtime reports and
  checkpoint-verification. No transcript or large artifact was copied into Git.

| Preserved Capture | SHA256 |
| --- | --- |
| mission-a-1.json | `c31bb518cdc2927046ec9e385921824a97625ffbafda919db6fada2936a7f8cb` |
| mission-a-1.requests.jsonl | `e520380729932b6980891b9b666dbf173cdcfd8c24ef5415b83a06a5a20582ac` |
| mission-a-1.jsonl | `cb420323fc1ecb9e033d969c4ebe989ba7dec80e902b96ee4d96672932d5b3bd` |
| mission-a-1.receive.jsonl | `0d8fbdb4e6d224cdc41f456f0e76827046c75a96979838201c54ae99f6e69c92` |
| data/terax-ai-sessions.json | `cb72a3400ccaa9b4f05f57bf1e3546421d742e3caeb54125e7d8b765e5a7b80d` |
| independent-runtime.json | `b13783af08a9803a2ffc638f76c1b089b0c4e010ea2f4653d074e277451edd47` |

- Only this additive acceptance record is committed, as
  **test(ai): run sustained qwen coder comparison**. Existing reports, safety
  stashes, delegation work and autonomous_tracker/ were not modified. No push.

## qwen3-coder protected-budget investigation

### Successful-Effect Representation Invariants

Written before production implementation in this checkpoint. The offline
baseline exactly reproduces protected request 18 at **33900 / 32768**. There
is one original protected user group and no extractable older assistant group;
the current SDK turn is mandatory extra material. Successful write pairs cost
**12927** estimated tokens, including **10541** of embedded source text.

The existing write_file host result confirms completed execution, but not that
the file remains unchanged now. Existing native conversation source persistence
and source inspection provide ownership, revision and digest validation. A
receipt must preserve historical effect evidence, not assert current disk state.

- Only settled host-executed write_file pairs with unique original IDs, exact
  literal absolute input/result path equality, complete content-length result,
  ok:true and clackWorkspaceWrite:true may qualify. No shell/edit/custom/provider
  execution, partial/error result or unknown output shape is generalized.
- Production must first persist the original UI source and inspect its existing
  native owner/revision-bound part locator/digest. The SDK pair must equal that
  source. Missing, stale, mismatched or inaccessible evidence is not proof.
- Only pressure-triggered projection is allowed. A later confirmed file write
  must exist; the latest successful file write remains verbatim. All repeated
  target paths remain verbatim because filename equality cannot establish
  authoritative revision supersession in this result format.
- Current failures, unresolved pairs, provider-executed effects, duplicate IDs,
  approval-bearing boundaries and explicitly restored originals stay verbatim.
- The receipt retains original call/tool identity, exact historical result,
  canonical target, execution order, source message/part/digest, effect certainty,
  explicit no-replay language and the fact that current state/supersession are
  not established. No approval identity is dropped: such boundaries do not qualify.
- Original call/result remain durable and unchanged. Existing same-conversation
  source restoration pins and returns the original pair without executing it;
  B1 and the shared retrieval allowance still bound that restoration.
- Receipts activate only when smaller than the original pair. No context/output,
  margin, timeout, tool-selection or continuation safety is relaxed. Irreducible
  protected overflow must still throw compaction-protected-budget.
- No model, tool execution, ForgeBoard continuation or larger-context experiment
  is permitted during diagnosis, implementation or offline verification.

### Evidence and Primary Classification

Starting point: **db0f836**, clean main, 51 ahead / 0 behind the recorded
origin/main. This is an offline investigation of the preserved
**forgeboard-qwen3coder-20261018-02** run, not another model acceptance run.
Primary classification: **B - CLACK_CONTEXT / SUCCESSFUL EFFECT HISTORY**.
The old policy preserved large, settled write inputs as mandatory current-turn
history even when trusted historical results plus exact durable source anchors
could represent them safely in less space. The retention question is B: replay
safety does not require every old full file body in every hot request, but this
successful-write case lacked a narrowly validated receipt. Existing persistence,
source inspection and original-pair restoration can support that representation.

Diagnostic owner: scripts/check-coder-protected-context.mjs. It imports the
production SDK conversion, planner, estimator and native serializer; global fetch
throws on any attempted request. It reads the preserved transcript, captured
requests and finish frames, checks the original session-store SHA256 and exact
UI-message equality, and reads/hashes the ten authored files without changing
them. Native source verification is replayed offline against that validated
snapshot using the existing part-digest semantics; this is **not live native IPC
verification**. No model, agent tool, shell command in ForgeBoard, continuation
or new context-size experiment occurred. Read-only Git status is diagnostic.

Local ignored output directory:
src-tauri/target/protected-context-20261018/. Final records are analysis-5.json,
analysis-5-request-18.native.json and analysis-5-request-18.optimized.json.
Earlier diagnostic iterations are preserved, not overwritten. Full source bodies
and transcripts remain local, not copied into Git.

| Final Offline Record | SHA256 |
| --- | --- |
| analysis-5.json | `4a724f97f2c10dfedc2c2eae9060efad35cf3dfd77e333ee0f54fc08aaad914f` |
| analysis-5-request-18.native.json | `33881f48414e57c20a69f0044b2dd7fce4b009a850dddb2cc16f49b5152c6b70` |
| analysis-5-request-18.optimized.json | `e07cf60bea145ba869c6ce2e103c80ab01042e74b4a77c7fc2f2efaf23ddeda8` |

### Exact Request Budgets and Delta

These are conservative estimates, not provider token counts. Two stages must
be kept separate: the SDK messages measured by compaction before the adapter,
and the native Ollama body measured at final transport preflight. Request 17's
minimum sent headroom of 1325 belongs to the latter, not the former.

| Component | SDK Preparation 17 | Blocked SDK Preparation 18 | Delta |
| --- | ---: | ---: | ---: |
| Core instructions | 3175 | 3175 | 0 |
| Captured agent instructions | 442 | 442 | 0 |
| System total | 3617 | 3617 | 0 |
| Exposed tool schemas/options | 7502 | 7502 | 0 |
| Original user envelope, specification and environment | 1194 | 1194 | 0 |
| Current SDK turn, including tool history | 15236 | 16643 | 1407 |
| Conversation total | 16430 | 17837 | 1407 |
| Estimated input total | **27549** | **28956** | **1407** |
| Output reserve | 2048 | 2048 | 0 |
| Safety margin, unchanged 10% formula | 2755 | 2896 | 141 |
| Required total | **32352** | **33900** | **1548** |
| Headroom against 32768 | 416 | **-1132** | -1548 |

The entire transition is the final ProjectList.tsx successful write pair
**call_bu6zmxr3**: call 1266 + result 141 = 1407, plus 141 additional margin.
No new original-message CompactionGroup appeared. That pair joined the
mandatory SDK current-turn extra. No schema, plan, memory or environment growth
caused this transition.

| Component | Captured Native 17 | Hypothetical Native 18 | Delta |
| --- | ---: | ---: | ---: |
| System | 3617 | 3617 | 0 |
| Tools/options | 7502 | 7502 | 0 |
| Conversation | 15603 | 16996 | 1393 |
| Estimated input | **26722** | **28115** | **1393** |
| Margin | 2673 | 2812 | 139 |
| Output reserve | 2048 | 2048 | 0 |
| Required | **31443** | **32975** | **1532** |
| Headroom | **1325** | **-207** | -1532 |
| Compact serialized JSON bytes | **54066** | **57170** | **3104** |
| Actual Ollama input/output | **12853 / 586** | **Not sent; unknown** | Not comparable |

The preserved UI snapshot and production conversion reproduce request 17
semantically. Rust persistence sorts tool-result object keys, changing only the
order inside reserialized JSON result strings; the regenerated full request is
not claimed byte-identical to the original capture. The original captured native
17 body supplies the exact prefix for hypothetical native 18, with the final
tool result in production field order. Its bytes and estimates are measured
offline, never transmitted. SDK envelope/providerOptions overhead is 827 input
tokens at 17 and 841 at 18. Even removing this stage difference would leave
native 18 over the conservative ceiling by 207; it is not a sole-cause estimator
fix.

### Non-Overlapping Request-18 Accounting

- Original specification text: **1044**. It occurs once as the original user
  requirement. Environment/workspace payload: **121**. Remaining user envelope,
  separator and framing cost: **29**. Together: **1194**.
- Assistant prose text: **445**; its SDK text-part/provider metadata and array
  contribution add **572**, for **1017**. These are narration, not an accepted
  structured plan or additional copies of the specification.
- All 17 structured call messages including their allocated message framing:
  **13418**. All 17 result messages including framing: **2208**. Sum: **15626**.
  Together with prose/metadata: **16643** current-turn extra. Add the user 1194
  for **17837** conversation. Framing allocated to tool pairs is **527** of
  that sum, not an extra addition.
- System 3617 + schemas/options 7502 + conversation 17837 = **28956 input**;
  add 2048 reserve + 2896 margin = **33900**, exactly the reported failure.
- Current accepted plan, completed/in-progress/pending plan items and superseded
  plan cost: **0**. No todo_write occurred. The currentPlanSteps projection from
  97148e9 remains unchanged and its superseded-plan regressions pass.
- Memory, retrieval, objective carry, compaction claims, refusal receipts and
  attachments: **0** in this preparation. No successful extraction or memory
  revision existed. No duplicate specification arrived through plan, memory,
  retrieval, objective carry or environment; environment contains runtime/shell
  information, not another ForgeBoard requirement document.

### Actual Groups and Current-Turn Evidence

CompactionUnit is a complete original UI message, not an arbitrary token span.
There is exactly **one** original CompactionGroup, start 0/end 1/protected true:
user **724tGhF1204jMRWs**, 1194 preparation tokens including its environment
envelope. Requirements remain verbatim. There are no additional original
assistant groups. All generated material is in assistant UI message
**GklScwTbXyRHSHpf**, converted into SDK step messages and supplied as mandatory
extra by agent.prepareStep. It is incorrect to invent five protected groups.

The following are every tool pair inside that extra, sorted by estimated cost.
Paths are relative to C:/Users/Hayden/Documents/forgeboard-qwen3coder-20261018-02/.
They are **not** separate CompactionGroups. All were ineligible for old normal
extraction because they belong to the active turn, not older original groups.

| Tool-Call ID | Tool and Target | Call | Result | Pair | Embedded Source | Historical Effect |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| call_zcd6iix0 | write_file backend/src/api.ts | 3001 | 133 | **3134** | 2898 | Completed host write |
| call_5rg3ruih | write_file backend/src/datastore.ts | 2860 | 135 | **2995** | 2755 | Completed host write |
| call_kcxinqq5 | write_file frontend/src/App.tsx | 1802 | 133 | **1935** | 1699 | Completed host write |
| call_h3969g7k | write_file frontend/src/components/ProjectList.tsx | 1266 | 150 | **1416** | 1155 | Failed; no confirmed mutation |
| call_bu6zmxr3 | write_file frontend/src/components/ProjectList.tsx | 1266 | 141 | **1407** | 1155 | Completed latest host write |
| call_segqto08 | write_file frontend/tsconfig.json | 551 | 133 | 684 | 447 | Completed host write |
| call_8077mxw0 | write_file backend/package.json | 548 | 133 | 681 | 444 | Completed host write |
| call_6po7q1rs | write_file backend/tsconfig.json | 530 | 133 | 663 | 426 | Completed host write |
| call_uphgdgw7 | write_file frontend/package.json | 450 | 133 | 583 | 346 | Completed host write |
| call_rvew5viy | write_file backend/src/index.ts | 349 | 133 | 482 | 245 | Completed host write |
| call_1u3ok8eb | write_file frontend/src/main.tsx | 230 | 133 | 363 | 126 | Completed host write |
| call_4jlttt9k | create_directory frontend/src/components | 100 | 127 | 227 | 0 | Confirmed directory result |
| call_t601zf8x | create_directory backend/src | 95 | 122 | 217 | 0 | Confirmed directory result |
| call_m72y3fwd | create_directory frontend/src | 95 | 122 | 217 | 0 | Confirmed directory result |
| call_68wv00w5 | create_directory backend | 93 | 120 | 213 | 0 | Confirmed directory result |
| call_wpda75bd | create_directory frontend | 93 | 120 | 213 | 0 | Confirmed directory result |
| call_zq48y5qg | list_directory workspace root | 89 | 107 | 196 | 0 | Read-only listing, no mutation |

The first five rows are the five largest **mandatory extra pairs**, not five
invented groups. Assistant calls and tool results remain paired with exact IDs.
Every successful write has the host's ok:true/clackWorkspaceWrite:true result,
matching literal path and complete content-length count. Historical completion
is confirmed; no approval occurred. No path or current hash by itself proves
which command caused the file. No current disk observation establishes an
authoritative revision superseding a historical body. All directory/listing,
failure and latest-write material stays unchanged by this checkpoint.

### Successful Writes, Failure and Current State

Ten successful write pairs total **12927**: call cost **11587**, result cost
**1340**. Non-overlapping decomposition: embedded source **10541**, call
identity/path/structure beyond source and framing **896**, result payload
**1180**, message framing **310** (150 call + 160 result). stdout/stderr **0**.
The host results contain status/path/count, not another full source body.
Bodies also exist on disk, but disk contents were not automatically injected as
a second hot copy. This is an unnecessarily large historical command payload,
not a double-counted file-read bug.

All ten writes target different files. There is no pair of confirmed writes A
then B to the same authoritative target. The failed ProjectList attempt followed
by the successful attempt is not confirmed-write supersession. Consequently C
is not established; repeated-target histories are deliberately left verbatim.

Current file observations below are diagnostic only, not used as production
receipt proof. Each hash matches both the intended historical UTF-8 content and
the preserved pre-independent-verification capture. Git reports each exact path
as **untracked (??)**. The contributing call ID is in the table above; all ten
entire intended writes completed according to their host result. No mtime is
used. No file was changed by this investigation.

| Relative Path | Current Bytes | Current SHA256 |
| --- | ---: | --- |
| backend/package.json | 696 | `d75d3b581de723158d4e041e1bdca0a3a2a7d24dd1efac9c188f326d4ece6ad9` |
| frontend/package.json | 565 | `fa15ba0b429a15ce6d30430922bdcdf1574ad9c13025e4b8934af00c775874d0` |
| backend/tsconfig.json | 821 | `3ab50fcdda9434ac4e91d2feacb6b39e5a2533987ff37dca3c75c8dbf96ca567` |
| frontend/tsconfig.json | 874 | `93d86475a5fa1b77acb570a90a5908469c2ffa53dfd73e1f61d8e01d5d1741e8` |
| backend/src/index.ts | 435 | `a2943a7d808e1a500f91cd2ab80ca34f6cf919542ced7d83f3ec59aa94b85274` |
| backend/src/datastore.ts | 5136 | `ab54b25acd93d0b4bdd886689f5534e8463ed4c5dba27ca149a2feb6458950a8` |
| backend/src/api.ts | 5530 | `311abe6f97412a27d7be70e7a9ec2d62dc9b0b722a67dfb1d8c9b974424ca603` |
| frontend/src/main.tsx | 236 | `cb2147cc8c40b34cacc965fc061f5e8bb856cffd12cd024587bf20a201835d5c` |
| frontend/src/App.tsx | 3386 | `492d0bff6e1ae16ebc8f1a687f188460a34974c011ade7f37bfe11eeb44a1202` |
| frontend/src/components/ProjectList.tsx | 2487 | `47ceecc3426360f3f4a730b4300415bb448c879d2d9cc2ee053a777d26700256` |

The filesystem failure is **1416** hot tokens: 1266 call + 150 result, including
1155 embedded source and 31 framing. Native OS error 3 says the parent path was
not found; there is no successful-effect proof for that attempt. The model then
created the components directory and completed the same intended write. The
failure is corrected in observed ordering, not the latest current error, but it
does **not** meet the existing no-effect receipt contract: that contract requires
an exact multiline bash_run guard rejection and a later accepted command.
A native write_file error cannot inherit that certainty from error prose.
The complete failed pair remains hot; this policy was not expanded.

### Schemas, Plan and Extraction Control Flow

Seventeen exposed tools cost **7502**, with **15314 serialized schema bytes**;
7381 tokens are attributed to builtin payload and 121 to surrounding schema
structure. Names: read_file, list_directory, write_file, create_directory, edit,
multi_edit, grep, glob, bash_run, bash_list, open_preview, todo_write,
read_agent_output, communicate_peer_task, request_peer_task, cancel_peer_task,
propose_custom_tool. Existing F1 conservatively pins previously selected names
for the logical run; the write_file expansion produces the final 17. No later
shrink occurred. The exact next step did not demonstrably require every peer or
proposal schema, but that alone does not prove a relevance-policy violation.
This checkpoint does not force a schema reduction to gain 1132 tokens and does
not claim every schema was semantically necessary. E is not the primary owner.

Exact owners: agent.ts prepareStep supplies stepMessages.slice(finalMessages.length)
to conversationCompaction.ts prepare; compactionPlan.ts planCompaction owns the
currentPlanSteps/failure projections, group/tail selection, assemble and
protected-budget check. In the original state:

1. Planning **did run**. The pressure branch was entered. It did not return
   needed:true: it threw before a plan with that field could return.
2. coveredEnd **0**, tailStart **0**. The original user group was protected;
   all current-turn extra was mandatory. Eligible older unprotected history:
   **0**. Compressible/unprotected request cost: **0**.
3. Protected-only conversation was **17837**. Including system, tools, reserve
   and margin, protected-only required **33900 / 32768**. Omitting all optional
   history changes nothing.
4. planCompaction threw before conversationCompaction could call load,
   extractionRoute, summarize or extract. No alternate gate blocked a legal
   extraction. Extracting current-turn bodies as if they were older original
   groups would violate the architecture. Normal extraction could not legally
   solve this exact state under the old representation; this ordering was
   expected, not a compaction-control-flow defect F.

### Same-Request Provider Calibration

| Sent Request | Native Estimated Input | Native JSON Bytes | Ollama Actual Input | Estimate / Actual |
| --- | ---: | ---: | ---: | ---: |
| 1 | 12043 | 24179 | 5639 | 2.135662 |
| 9 | 15952 | 32219 | 7734 | 2.062581 |
| 17 | 26722 | 54066 | 12853 | 2.079048 |

All seventeen same-request rows are retained in analysis-5.json. Ratios range
2.062581 to 2.136341, stable rather than wildly divergent. Generic punctuation,
schema and JSON estimates are intentionally conservative compared with the
model tokenizer/template. The schema share decreases as source history grows;
it is not the cause of an increasing schema cost. SDK structures add measured
overhead above native serialization, but do not explain the roughly 2x native
estimate/provider ratio. Evidence does not isolate a tokenizer component as the
dominant source of that ratio, nor prove an unserializable-field counting defect
like ac1c8ed. **No estimator change (D)** is justified by this investigation.
The blocked request's actual token count is unknown. Provider usage remains
diagnostic, never substituted for preflight on an unsent request.

### Narrow Production Change and Offline Replay

verifiedWriteHistory.ts implements a bounded, pure current-turn projection and
the source-confirmation boundary. It accepts only the exact host write_file
input/result shapes described in the invariants, at most 32 candidates, content
up to 256 KiB characters and literal absolute paths up to 4096 characters.
Approval-bearing boundaries, provider-executed tools, malformed/duplicate IDs,
repeated targets, latest writes, failures and uncertain effects do not qualify.
Windows drive paths are compared case-insensitively for repeated targets.
Unsupported/ambiguous paths fail closed. A receipt is emitted only if smaller.

chatRuntime.ts captures the conversation/run/model/agent/workspace and checks
them around persistence and native inspection. It persists the exact original
UI transcript using persistCompactionSource/awaitSessionWrites, then uses
loadConversationMemory/inspectMemorySources under the captured owner and
revision. Each part digest must match the captured UI source and resolve only
to that session. Missing/corrupt/stale proof cannot activate a receipt. Proofs
are revalidated on each pressured preparation, not trusted across requests.
The existing native workspace/secret-path and source-access controls remain
authoritative. No new database, durable memory schema or filesystem reread is
introduced; original call/result data stays in the existing session store.

conversationCompaction.ts attempts this confirmation only after the original
planner throws compaction-protected-budget. It replans with validated receipts,
retains the same projection and restoration pins during normal extraction's
pre-publication check, and uses the existing bounded exact-pair restoration
mechanism. No hidden summarization or new model call is introduced for receipts.
The mixed-history integration test initially reproduced an inconsistent
pre-publication check; carrying the verified source list/pins into that check
fixes the concrete regression without changing extraction policy.

agent.ts permits confirmation only while request_conversation_evidence remains
in the permitted SDK tool set and current agent permission is allow, checked
before and after source confirmation. F1's existing advertised-schema policy is
unchanged. A deterministic SDK test proves that the permitted restoration tool
can execute even when F1 has not advertised it, restore the exact historical
call/result on the next preparation, and never execute the historical write.
The receipt explicitly names that tool and its original call-ID anchor.

Receipts preserve exact tool/call identity, completed historical result, target,
ordering/following-write identity, source session/message/part/SHA256 and
explicit no-replay/current-state-unknown/supersession-unknown statements.
Restoration uses the original in-memory SDK pair backed by the durable source,
subject to B1 and the unchanged shared retrieval byte/chunk/round allowances.
Oversized restoration still fails closed with session history available; a
receipt is not permission to fabricate or replay missing evidence. Cancellation
and stale captured-run checks remain authoritative. Private conversation
ownership, memory/context architecture, PeerTasks and scheduler are unchanged.

Eight old write inputs become receipts in the preserved request: package.json
and tsconfig.json for both subprojects, backend index/datastore/api, frontend
App. The small frontend main write is not worth replacing; ProjectList is the
latest write and its target also appears in the failed attempt, so remains
verbatim. All other material is preserved. **No supersession is asserted.**

| Offline Request 18 | Before | After Verified Receipts | Reduction |
| --- | ---: | ---: | ---: |
| System | 3617 | 3617 | 0 |
| Tools/options | 7502 | 7502 | 0 |
| Conversation | 17837 | **10282** | **7555** |
| Input | 28956 | **21401** | **7555** |
| Margin, same formula | 2896 | **2141** | 755 |
| Output reserve | 2048 | 2048 | 0 |
| Required | 33900 | **25590 / 32768** | **8310** |
| Headroom | -1132 | **7178** | +8310 |

The same state now prepares safely, with no extraction (needed:false,
tailStart:0). The optimized hypothetical native body is **42372 bytes**, input
**20557**, margin **2056**, reserve **2048**, required **24661**, headroom
**8107**. Exact original-pair restoration is asserted offline. These are
preparation results, **not** evidence that ForgeBoard subsequently finished.
Genuine irreducible >32K user requirements and large uncertain mutation history
still throw compaction-protected-budget. B1 remains a hard gate.

### Verification, Limitations and Stop

- Final focused **164 tests passed / 6 files**, zero skips: verifiedWriteHistory
  **16**, plus compactionPlan, toolFailureRetention, conversationCompaction,
  contextBudget and agentCompaction.integration. Coverage includes large
  settled payloads, durable proof, exact restoration/no replay, latest/repeated
  targets, provider/failed/uncertain/approval cases, mismatched/duplicate/missing
  proof, workspace/session isolation, stale run, persistence failure,
  pressure-only activation, revalidation, irreducible overflow and mixed normal
  extraction/publication. Existing superseded-plan/failure-receipt tests pass.
- Final **npm.cmd run check-types passed**. **npm.cmd run lint** passed at the
  established **71 warnings / 2 informational notices**, no added warning.
  **npm.cmd test: 2905 passed / 205 files**, zero skips. **npm.cmd run build
  passed**; four existing INEFFECTIVE_DYNAMIC_IMPORT warnings and the plugin
  timing advisory remain. Full gates were repeated only after concrete final
  safety/publication corrections, not after unchanged evidence inspection.
- Diagnostic **node --check** and focused Biome lint pass. Offline analysis-5
  reproduces 33900, verifies all current file hashes and exact source
  restoration, and reports zero inference requests / zero executed agent tools.
  **git diff --check passed**. This checkpoint changed no Rust source; Rust
  gates were not run.
  No native GUI or live provider acceptance is claimed in this checkpoint.
- Production changes are limited to the new verified-write helper and the
  existing agent/planner/compactor/chat runtime integration, with deterministic
  tests, the offline diagnostic and this additive report. Existing historical
  reports, safety stashes, delegation files and autonomous_tracker/ are untouched.
  No source template/XML parsing, model, context, output reserve, margin formula,
  timeout, continuation limit, F1 policy or memory architecture was changed.
- Historical command, confirmed effect and current disk state remain distinct.
  No generic successful-shell/edit/custom-tool receipt, approval compression,
  repeated-write supersession, automatic replay, or new source-retrieval protocol
  is implemented. Native source APIs are reused, not reimplemented or claimed
  newly platform-verified.
- The observed qwen3-coder run **materially outperformed qwen38-uncensored**:
  17 completed requests/structured tool calls, zero malformed intents/empty
  responses/stalls/cloud calls, 16 successful tools, ten source writes, recovered
  filesystem failure, substantive partial backend/frontend and independently
  verified persistence/API behavior. ForgeBoard remains incomplete; the Clack
  context stop is separate from model quality. Qwen3.8 ForgeBoard testing stays
  retired. This evidence alone does not promote coder to a universally reliable
  or preferred model.
- Commit scope: **fix(ai): compact verified tool effects**. No ForgeBoard resume,
  Qwen invocation, larger-context test, subsequent checkpoint or push. Stop after
  committing this fix; any new live mission requires a separate checkpoint.
- Final status inspection found five concurrent, unrelated modifications not
  present at the initial clean-state check: scripts/acceptance-approval.mjs,
  scripts/check-real-local-product.mjs, src-tauri/examples/coworking_acceptance.rs,
  src/test/acceptanceComparison.test.ts and src/test/realLocalProductAcceptance.tsx.
  They are preserved untouched and excluded from staging/commit. Verification
  results above are the actual completed runs for this checkpoint, not a claim
  that later concurrent edits or the unrelated Rust example were verified.

## Post-315b568 qwen3-coder Sustained Validation: 2026-10-18

### Scope, Isolation and Controls

This is Stage 1 of the requested multi-stage local-model validation. Starting
HEAD was **315b568**, main, 52 ahead / 0 behind recorded origin/main. Six
pre-existing tracked modifications were preserved: this report's separate
Qwen3.8 IQ4_XS section and the five acceptance-harness files listed above. They
were used as found, not reverted, edited or included in this checkpoint's commit.
No Computer Use or native GUI interaction was performed.

Fresh evidence ID: **forgeboard-qwen3coder-post315b568-01**.
Fresh workspace: **C:/Users/Hayden/Documents/forgeboard-qwen3coder-20261018-03**.
The requested evidence ID was retained; a dated workspace name was necessary
for the existing disposable-workspace approval guard. Initialization created
only .git, with no seed implementation or commit. Metadata-only preparation
sent **zero inference requests**. Process inspection found no other Clack,
acceptance host, Cargo/Rust build or Vite/test runner before the mission.

The existing SSH tunnel was reachable, localhost-only on port 11435. Ollama
remained **0.40.5**. Exact model **qwen3-coder:30b**, digest
**06c1097efce0431c2045fe7b2e5108366e43bee1b4603a7aded8f21689e90bca**,
Q4_K_M / 30.5B / qwen3moe, advertised maximum 262144, completion/tools
capabilities and no advertised thinking capability. It was initially unloaded;
the terminal loaded-runtime report confirmed **context_length=32768**.
Loaded size was 15449152550 bytes, size_vram 15223163452 bytes. These are
observed allocation values, not proof that larger contexts are hardware-safe.

All **27** actual native requests used /api/chat through the existing tunnel,
num_ctx **32768**, num_predict **2048**, reasoning **None**, think:false,
fallback **Never**, and zero cloud inference. No sampling, timeout, template,
model, installed tag, service, firewall, permissions architecture or global
configuration changed. The normal production 60-second stream-idle and
600-second request deadlines, tool selection, trusted-workspace acceptance
profile, approval responder, memory/retrieval and continuation behavior remained.
No approval was requested; no evaluator approval or user-message injection was
needed. The first shell command used the advertised PowerShell (pwsh.exe)
environment and succeeded: cd to this workspace followed by && npm install.

The identical complete ForgeBoard specification was sent **once**, SHA256
**f97ec34eefa136ac5be5847187f768b64bf5587d36140d9fcc53b695fa3e4801**.
No benchmark/context-fix hints, reminder, manual Continue, requirement resend,
model-specific prompt, evaluator implementation or mid-run setting/source edit
occurred. Source-freeze checks cover **1265 tracked files**, all unchanged
through the live mission. Isolated native/Vite processes exited after the final
report; no abandoned acceptance process was found.

### Outcome and Chronology

**Primary: CLACK_CONTEXT / PROTECTED-BUDGET AFTER AUTOMATIC CONTINUATION /
INCOMPLETE.** The native host stayed healthy and produced the final report;
this is not TEST_HARNESS/host interruption or a provider/model deadline failure.
The fixture's ok:true means it recorded the terminal state, not that ForgeBoard
passed. The captured product run state is failed.

| Measurement | Observed Result |
| --- | --- |
| First response text | 17.055 seconds after first native request |
| First structured tool call | 18.429 seconds |
| First file write observed | 28.351 seconds |
| Persistence-source write observed | 85.610 seconds; not yet runtime-verified |
| First App.tsx observed | 171.351 seconds; placeholder UI, not a working task board |
| Total runner elapsed | 230.735 seconds |
| Completed native requests / structured calls | **27 / 27** |
| Successful / failed tool executions | **27 / 0** |
| File writes | **18**, all completed with native result identity |
| Other tools | 7 create_directory, 1 list_directory, 1 bash_run |
| Malformed textual tool intents / empty responses | **0 / 0** observed |
| Stream failures / stalls / provider deadline terminations | **0 / 0 / 0** |
| Normal same-agent automatic continuations | **1**, after step 24 |
| Approvals / delegation / cloud inference | **0 / 0 / 0** |
| Provider final responses | 27 done_reason=stop; **7654** reported output tokens total |
| Model-executed tests / builds | **0 / 0** |

The run passed the prior request-18 ordinal, completed ten more requests than
the old 17-request run, and naturally exercised verified-write projection at
requests 23 and 24. It then failed **before request 28**. The new request was
never sent; its provider usage is unknown. Minimum headroom among requests
actually sent was **1348** at request 22. Last sent request 27 required
**30355**, headroom **2413**. These are native-wire estimates, distinct from
the SDK preparation that blocked the next request.

### Live Successful-Effect Receipts and Savings

Both pressured requests carried the same **ten** distinct historical-write
receipts. The offline audit checks every actual receipt's session, message,
part index, completed tool result and SHA256 against the unchanged durable
transcript. Each original native pair is also recovered from earlier captured
requests. Restoring those pairs for measurement does not execute them.

| Pressure Boundary | SDK Required Before | SDK Required After | SDK Input Saved | Native Required Before / After | Native Input / Required Saved |
| --- | ---: | ---: | ---: | --- | --- |
| Request 23 | **32979** | **25469** | **6828** | **31803 / 24288** | **6832 / 7515** |
| Request 24 | **34104** | **26593** | **6828** | **32855 / 25340** | **6832 / 7515** |

These are alternative representations of the **same request**, with the same
schemas, context, output reserve and margin formula. The SDK and native layers
have different envelope/serialization costs. Request 23's native representation
without receipts would fit, but its SDK preparation would not. Savings must not
be summed across the two requests as if twenty distinct effects were retired.

Actual native pressure-boundary components:

| Boundary | System | Schemas | Conversation | Output Reserve | Margin | Required | Headroom | Receipts |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 23 | 3617 | 7502 | 9099 | 2048 | 2022 | **24288** | **8480** | 10 |
| 24 | 3617 | 7502 | 10055 | 2048 | 2118 | **25340** | **7428** | 10 |

No current failure, uncertain effect, pending approval or repeated-target write
existed at either pressure boundary. The latest write remained verbatim:
call_oqrvck6l (frontend main) at 23; call_eoqcijgl (App) at 24. No effect was
replayed or superseded. All 18 final authored-file hashes match their original
write inputs and remain unchanged after independent verification.

Thus **315b568's pressure-only current-turn path works in a real mission**.
This does not establish that its representations survive every continuation
ownership boundary or that compaction as a whole is sufficient end to end.

### New Continuation Boundary

Requests 25-27 contain **zero** write receipts. Normal continuation starts a new
agent preparation with the previous assistant UI turn in originals; that turn
contains the first 24 tool steps. The original user message stays protected.
The previous assistant turn is not intrinsically protected, but is the latest
intact tool group and is retained as the mandatory recent tail. Its old write
bodies return to hot context. The current implementation projects verified
writes only inside extra, not inside that original-message tail.

Exact offline production-planner reconstruction of the blocked preparation:

| Mandatory Material | Estimated Tokens |
| --- | ---: |
| Core / agent system | 3260 / 442 = **3702** |
| Schemas/options, 8 exposed | **2803**, 5668 schema bytes |
| Original user/environment envelope | **1194** |
| Previous assistant original unit, first 24 steps | **17633** |
| Current extra, steps 25-27 | **2677** |
| Conversation total | **21504** |
| Input total | **28009** |
| Output reserve | **2048** |
| Safety margin | **2801** |
| Required / ceiling | **32858 / 32768**, excess **90** |

Original groups are [0,1) user/protected and [1,2) assistant/not intrinsically
protected. Covered end is 0; reconstructed tailStart is **1**, tail target
4282. The intact assistant group alone is 17633, but the existing rule always
retains the latest intact group. All 21504 conversation tokens consequently
remain mandatory. No older eligible assistant group exists outside that tail.
The planner throws compaction-protected-budget before extraction can run.
No memory revision, successful memory extraction or retrieved evidence exists
in this run. The ten receipt-bearing pairs remain durable and digest-valid;
no evidence corruption or model/context identity change caused the stop.

Owners: chatRuntime.ts makeChat captures originals for the next transport;
agent.ts prepareStep separates original finalMessages from stepMessages extra;
conversationCompaction.ts creates original units and confirms candidate sources
from extra after protected pressure; compactionPlan.ts projects verified writes
only from projected.blocks[originals.length] and retains the intact recent tail.
This is a specific unresolved continuation/history-representation boundary,
not proof of provider context exhaustion or a reason to redesign memory.
**No repair, context increase, relaxed B1 margin, continuation bypass or rerun
was attempted.** This checkpoint stops at the user's new-blocker gate.

### Correction Trigger Limitation

The fixed correction observer was enabled, not single-spec suppression mode.
It recorded **16** qualifying write events, but never detected page size 50.
The authored tasks route materially contains multiline req.query destructuring
with a standalone **limit = 50** line. Offline replay of the unchanged
currentPage50 detector returns no match for that form; there was no accepted
todo plan to supply a match. This is a **secondary TEST_HARNESS / CORRECTION
DETECTION false negative**. The two small model-definition files sit in a models
directory excluded by the observer's existing evidence-path guard; the remaining
16 writes already exceed the three-write threshold, so that exclusion did not
cause this missed page-size trigger.

The correction was sent **zero** times. Durable history contains exactly one
user specification, and current code still says 50. **Retention of 25 is
untested, not failed.** This is not a completed corrected comparison. No reminder,
manual correction or detector repair was injected to salvage the same attempt.

### Independent Project Verification

Verification used a byte/hash-identical copy under the isolated evidence
directory, not repairs to the original workspace. Only declared npm dependencies
were installed; no missing dependency was added to a manifest. All 18 authored
files in both original and copy still match their pre-verification hashes.

| Surface | Factual Result |
| --- | --- |
| Backend source | Port 4317, project/task CRUD, filters/search and JSON persistence source exist; partial, not an accepted working backend |
| Backend tests | One model-authored file with two cases; independent Jest run failed to load undeclared supertest, **0 tests executed** |
| Backend build/start | tsc fails on missing supertest/socket.io and implicit socket type; start fails on MODULE_NOT_FOUND socket.io |
| API CRUD/filter/search runtime | Not verified: unchanged entry point cannot start; no substitute evaluator server implemented |
| Persistence across restart | Source exists; **not verified** because backend cannot start |
| SSE | **Not implemented**: socket.io is not SSE, no text/event-stream endpoint or mutation event wiring observed |
| Frontend | Mock Project Alpha/Beta cards, loading/error skeleton; no working project/task workflow |
| Frontend tests/build | No test files; Vitest exits 1. Vite production build fails because index.html is missing; App also imports missing App.css |
| Model test/build execution | None; the only model shell effect was successful root npm install |
| Canary state | Port 4317 and title check >120 in source; page size remains 50; no 750ms debounce implementation found |
| README | Present with setup/dev/test/build/architecture text, but claims more than the unfinished implementation delivers |
| Runtime data/source control | .gitignore absent; runtime JSON data not ignored; repository remains unborn, no project commit |

Independent commands: root npm ci and backend/frontend npm install succeeded;
backend npm test -- --runInBand --forceExit exited 1; frontend npm test -- --run
exited 1; root npm run build exited 1; backend npm run start exited 1.
These are unfinished-project failures, not Clack repository gate failures or
proof the interrupted model could not subsequently debug them. Missing
socket.io/supertest, HTML/CSS, tests, realtime and actual frontend behavior were
not repaired. No API mutation/restart/SSE pass is claimed.

The first read-only Git ignore/history probes were sandbox-denied; the separately
preserved independent-git-verification.json rerun with approved access confirms
check-ignore exit 1 and commit count 0. It supersedes only the denied Git fields
in independent-project-verification.json, not the successful file-hash checks
or actual command logs.

### Write-File Guidance Fix

**Deferred at the Stage-1 stop gate; no production change or guidance tests in
this checkpoint.** The inconsistency remains observable in the fresh request 1:
the system recommends write_file for new files and a parent listing before it,
while the 16 advertised tool schemas omit write_file. A later native model call
to the permitted SDK tool did succeed and expanded selection; this distinction
does not make the initial advertised guidance contract accurate. No Qwen-specific
prompt patch or permissive tool-selection workaround was introduced.

### Installed-Model Comparison and Preferred Model

**Stage 3 not started.** Metadata listed all requested installed candidates:
qwen3-coder:30b, Qwen3.6 35B-A3B Q4_K_M, Gemma4 26B-A4B Q4_K_M and Qwen3.6
27B IQ3_M, plus the two pre-existing Qwen3.8 tags. Exact tag names, digests,
sizes and discovered capabilities are preserved in model-metadata-before.json.
No new model was downloaded, imported, modified or overwritten. No other model
received a smoke test or ForgeBoard mission in this checkpoint.

| Candidate | New Structured-Tool Evidence | New ForgeBoard Result | Ranking Status |
| --- | --- | --- | --- |
| qwen3-coder:30b | 27/27 native structured calls during Stage 1; no separate smoke inference | 27 requests, 18 writes, then Clack continuation-context block | Strongest observed coding candidate; preferred/default designation deferred |
| Qwen3.6 35B-A3B Q4_K_M | Not run | Not run | Deferred |
| Gemma4 26B-A4B Q4_K_M | Not run | Not run | Deferred |
| Qwen3.6 27B IQ3_M | Not run | Not run | Deferred |

No winner of an unperformed shootout is declared. qwen3-coder's earlier
material advantage over qwen38-uncensored remains valid and this mission adds
reliable sustained tool use; the Clack stop must not be reassigned as a model
exhaustion failure. It is **not yet promoted to preferred/default local coder**
on a healthy completed baseline. Qwen3.8 ForgeBoard testing remains retired.

### Larger Context and Normal-User UX

Stages 4-6 are **deferred**, not passed. The prompt's nominated new-download
candidate devstral-small-2:24b remains a candidate only; this checkpoint adds no
download recommendation, measurement or disk/VRAM safety claim. Downloads: **0**.
The prompt's possible next **49152** context test was **not run**: no preferred
model was established on a healthy 32K baseline. No 48K/64K or larger-context
recommendation is inferred from the 262144 advertisement or current allocation.

Normal-user Local AI settings, ease of context adjustment, per-model persistence,
Automatic default readiness, capability labels and output/context separation
were **not audited in this gated checkpoint**. No UX change or native interaction
was attempted. These remain pending assessment, not newly verified deficiencies
or completed controls. The acceptance harness remains developer infrastructure.

### Readiness, Verification and Handoff

Final classification: **LOCAL AI BLOCKED**, specifically for the requested
sustained autonomous completion claim. Native tools/streaming, zero-cloud
operation, initial verified receipts and automatic continuation all made real
progress, but the unresolved continuation-context boundary still stops this
mission. The correction detector also needs a bounded future repair before a
valid corrected model comparison. Do not benchmark other models on this blocked
baseline or call this end-to-end healthy merely because request 18 was passed.

- Focused **179 tests passed / 8 files**, zero skips: verifiedWriteHistory,
  compactionPlan, toolFailureRetention, conversationCompaction, contextBudget,
  agentCompaction.integration, acceptanceComparison and acceptanceApprovalLifecycle.
- **npm.cmd run check-types passed**; new offline diagnostic **node --check**
  and focused Biome lint passed with zero diagnostics/rewrites. **git diff --check
  passed**. No production TS/Rust source changed; full frontend/build/lint/Rust
  gates were not rerun under the evidence-only policy. The unchanged baseline
  remains 2905 frontend tests and lint 71 warnings / 2 infos from 315b568, not a
  new full-suite result. The isolated native acceptance-example build passed.
- New script scripts/check-post-effect-coder-run.mjs performs offline assertions,
  receipt/source validation, exact blocked-budget reconstruction and source-copy
  verification, with network disabled. It neither executes agent tools nor
  performs inference. Local ignored evidence includes setup/model metadata,
  source freezes, preflight, actual native request/receive/stream captures,
  durable session data, correction state, post-effect-run-audit-2.json,
  independent command/verification/Git reports and evidence manifests.
- Exact next work is the **continuation original-tail/verified-receipt boundary**
  and the **multiline page-size correction detector**, in a separately authorized
  bounded fix. Stage-2 guidance alignment, installed-model comparison, preferred
  model decision, context feasibility and normal-user UX remain unstarted.
- Evidence-only commit: **test(ai): verify post-effect-compaction coder run**.
  Only this additive record and the new offline audit are staged. Pre-existing
  report edits, five harness-file modifications, safety stashes, delegation work
  and autonomous_tracker/ remain untouched/uncommitted. No push. No resumed
  mission, second inference attempt, later stage or production repair followed
  the observed new-blocker gate.

| Primary Preserved Record | SHA256 |
| --- | --- |
| mission-a-1.json | `ecd474d4bf8926cb230c92ca673113f8c742abd0b015cd1702411f1eb27473c7` |
| mission-a-1.requests.jsonl | `2e8440948ad04a1ac58c9fb1f1619950bcf07e73aa244c2c96f16ba9a2deb4ce` |
| mission-a-1.jsonl | `3a089b86c8d77670c0e063e5151c69834f191a7b8ce96e81c8755903135068be` |
| mission-a-1.receive.jsonl | `54178f6d767cf582b6729b57a1a5153f9d132e664aff33b2deabdef95f98e9f2` |
| data/terax-ai-sessions.json | `7ffc5c1a8baaee9791670e229ac87f0b1a6d61b3a364c930c073407545088c00` |
| post-effect-run-audit-2.json | `d160b5b897bf7d2efb985b25597512299b529d653abfa11d1fbeb874d123971a` |

## Verified write receipts across continuation history

### Pre-Implementation Proof and Invariants

Written before production changes in this checkpoint, starting at 73cc96c.
The preserved post315b568-01 evidence reproduces SDK request 27 at **31821**
and blocked request 28 at **32858 / 32768**. Both already contain **zero**
successful-write receipts. The actual location/representation transition is
request 24 to the automatic continuation at 25, not 27 to 28. The latter adds
542 conversation tokens, 401 schema tokens and 94 margin tokens, total 1037.
The original user unit costs 1194 and the prior assistant unit costs 17633;
current extra grows from 2135 to 2677.

Ten actual request-24 receipt anchors resolve to the same completed write
records in assistant message 8cVix5KkOF1ljZav, conversation real-mission-a.
The original session snapshot SHA256 remains
7ffc5c1a8baaee9791670e229ac87f0b1a6d61b3a364c930c073407545088c00.
Source part digests, call IDs, targets, host results, owner and durable source
identity have not changed. Moving the immutable SDK turn into original units
does not invalidate that proof. Existing native persistence/source inspection
already accepts these owned part locators; no new storage architecture is
required. Extra-only candidate discovery and extra-only projection are an
implementation scope gap, not a separate prohibition on source-verified
original-history representation. Original group closure protects protocol/source
integrity and uncertainty; it does not make every settled write payload
intrinsically mandatory verbatim.

- Reuse exactly the existing conservative write_file eligibility predicate:
  settled host result, exact path/content-length identity, unique call/result,
  sequential later confirmed write in the same semantic user boundary, bounded
  candidates and validated durable source. Do not generalize shell/custom/edit
  effects or infer authority from current disk contents.
- Evaluate original units plus extra in source order, preserving semantic
  user/system boundaries. This must not hide a repeated target, duplicate ID,
  approval or latest write merely because it lies in a different block.
- Keep original UI messages, source metadata, group ranges, pair closure and
  session persistence unchanged. Only the outgoing SDK representation may
  replace a complete eligible protocol pair with a receipt.
- Keep failures, uncertain/provider-executed effects, approvals, repeated
  targets, newest writes and explicitly restored originals verbatim under the
  existing rules. No supersession or current-file-state claim is introduced.
- Reconfirm sources under the existing owner/run/workspace/digest/permission
  checks on each pressured preparation. A historical receipt string or earlier
  successful callback is not fresh proof. Missing or stale proof fails closed.
- Activate only through the existing protected-pressure fallback. Do not add
  automatic background confirmation or a new extraction/model call.
- Preserve historical execution result, exact source anchor, order and explicit
  no-replay language. Restoration never executes a tool. Keep the existing
  retrieval byte/chunk/round bounds and B1 checks.
- A requested original pair must pin its intact original group in the prepared
  view, including when ordinary memory coverage would otherwise omit that
  group. This is explicit evidence restoration, not mutation of stored groups
  or memory coverage. Other eligible pairs may retain their verified receipts.
- No compaction trigger/target, extraction policy, memory claim, context maximum,
  output reserve, safety-margin formula, timeout or continuation limit changes.
  Genuine mandatory overflow must still block.
- No inference, ForgeBoard tool execution/resume, larger-context experiment,
  correction-detector change, write_file guidance cleanup or model shootout.

### Exact Request Accounting

Offline reconstruction uses the preserved immutable mission and session records,
the production SDK conversion, compaction planner and B1 estimator. These are
conservative request-preparation estimates, not provider-generated token totals.
All columns below use ceiling **32768**, reserve **2048** and the unchanged
10-percent input-margin formula. System is core **3260** plus agent **442**.

| Component | Request 27 SDK | Blocked 28 SDK | Delta | Fixed 28 SDK |
| --- | ---: | ---: | ---: | ---: |
| System | 3702 | 3702 | 0 | 3702 |
| Exposed schemas | 2402 | 2803 | +401 | 2803 |
| Original user unit | 1194 | 1194 | 0 | unchanged |
| Prior assistant unit, before projection | 17633 | 17633 | 0 | projected |
| Current extra, before projection | 2135 | 2677 | +542 | projected |
| Conversation total | 20962 | 21504 | +542 | 13901 |
| Input total | 27066 | 28009 | +943 | 20406 |
| Output reserve | 2048 | 2048 | 0 | 2048 |
| Safety margin | 2707 | 2801 | +94 | 2041 |
| Required total | 31821 | 32858 | +1037 | 24495 |
| Headroom | 947 | -90 | -1037 | 8273 |
| Verified-write receipts | 0 | 0 | 0 | 12 |

The additional exchange is root npm-install call **call_dxcqqmbu**: isolated
call cost **99**, result **359**, assistant narration/provider metadata **84**,
total **542**. F1 selected the additional bash_run schema for the fresh request:
seven schemas / 4877 bytes become eight / 5668 bytes, adding **401** estimated
tokens. No write changes representation between 27 and 28.

Actual captured native request 27 has conversation **19629**, input **25733**,
margin **2574**, reserve **2048**, required **30355**, headroom **2413**; system
and schemas match its SDK preparation. Hypothetically serializing the blocked
28 exchange gives conversation **20128**, input **26633**, margin **2664**,
required **31345**, headroom **1423**. That request was **never sent**. Native
wire and SDK framing estimates differ; this checkpoint changes neither estimator
nor the authoritative preflight boundary.

Original groups are user **[0,1)** (protected) and assistant **[1,2)** (not
intrinsically protected). At the old boundary the intact assistant unit was the
mandatory recent tail, tailStart **1**, coverage **0**. No older unprotected
assistant group was available for legal extraction. After verified projection,
the same state fits without extraction, tailStart **0**, needed **false**; no
memory revision is created and no older history is removed to maximize savings.

### Exact Sources and Representation Transition

All ten rows below belong to conversation **real-mission-a**, assistant message
**8cVix5KkOF1ljZav**, under workspace
**C:/Users/Hayden/Documents/forgeboard-qwen3coder-20261018-03**. Paths are relative
to that root. Every effect has its original exact path, bytesWritten value,
ok:true and clackWorkspaceWrite:true result, paired to its unique write_file
call and matching persisted input. Digest verification covers the whole original
UI tool part, not a current filesystem reread. There is no fabricated effect ID:
the owned message/part locator, original call ID and digest identify the effect.

Each was a receipt in request **24**, then verbatim from continuation request
**25**, including both **27** and **28**. None changed semantic effect status.
Costs are isolated SDK assistant receipt versus full assistant-call/tool-result
pair; verbatim cost is identical at 27 and 28. Whole-request savings also include
message framing and are measured separately, not inferred by adding this table.

| Call ID | Target | Part | bytesWritten | Receipt 24 | Verbatim 27 / 28 |
| --- | --- | ---: | ---: | ---: | ---: |
| call_ydbibdom | package.json | 10 | 730 | 446 | 648 |
| call_slvfa31c | backend/package.json | 13 | 660 | 450 | 663 |
| call_cm15viwe | frontend/package.json | 16 | 535 | 450 | 567 |
| call_c3vgz3bh | backend/tsconfig.json | 19 | 453 | 450 | 491 |
| call_zseryf5v | frontend/tsconfig.json | 21 | 535 | 450 | 530 |
| call_sq0ukki6 | backend/src/index.ts | 26 | 1038 | 451 | 808 |
| call_dfwd89w1 | backend/src/persistence.ts | 36 | 2080 | 453 | 1362 |
| call_3hn2kmo6 | backend/src/routes/projects.ts | 41 | 3699 | 455 | 2152 |
| call_o43xw2wg | backend/src/routes/tasks.ts | 44 | 6392 | 454 | 3492 |
| call_1m3ub6t5 | backend/src/__tests__/projects.test.ts | 52 | 705 | 461 | 635 |

| Call ID | Unchanged Original Part Digest |
| --- | --- |
| call_ydbibdom | `8926199242378863ded0d636b86acf55ba977e199da62713227d2a1ec9065507` |
| call_slvfa31c | `f9cb209dff5eed4ec40a0bbff1828f550235d93e462e583715a8af67e7111471` |
| call_cm15viwe | `a720ace431d4f250a0ce107e4f29ab06650783763a7d0d6c64167c9bc5224401` |
| call_c3vgz3bh | `67e61c49dbeaec343b5b0853596d95572642e4fd125d1d1a40bab6801267d234` |
| call_zseryf5v | `2df352e4b8d62677e0fa8c39019b3ac12c9d6c077ea5ba5ed412ad3d7f31fe03` |
| call_sq0ukki6 | `45a1d55642d836cb5e1c97c141ba03ff4030a87023b53bcf0f35056313cc2ff2` |
| call_dfwd89w1 | `cc080b6c29d2f5655abbe6033b75e52446dfa1da8b736c5490756ab42cb0ac3c` |
| call_3hn2kmo6 | `ad54548423b9b714b1df4775b186a2c251fd6d428fbfd159c7a13982ec5c0445` |
| call_o43xw2wg | `996663ea1c831d69d6a2ee14eb8f9487761ddb457c0243c49c35105bd3c77fb8` |
| call_1m3ub6t5 | `316fb1ea8114db677f74ef091986f57f319df5630dfa0b11eb6954dcfe935ead` |

Request 28 also has two later eligible writes, using the same unchanged rule:
call_eoqcijgl, frontend/src/App.tsx, part **60**, bytesWritten **1344**, digest
`e5e1aac80ac74af41c111397061a70be8b745eda51caa5ec9f5c94c8c0e64212`;
call_megs9kps, frontend/src/index.css, part **63**, bytesWritten **913**, digest
`353d3f8ed425d062542c58cde63fa0be9a8c6459de21830d4e182d5fe503cb10`.
Both precede subsequent settled writes. The latest README write
**call_8dnx9gku** stays verbatim. Small model-definition/main/Vite writes that
do not save space stay verbatim. Shell install history is not a write receipt.

### Production Ownership and Safety

- **conversationCompaction.ts** previously discovered candidate writes only in
  current extra. It now discovers them in original units plus extra, in order,
  only in the existing protected-budget-pressure fallback. Confirmation still
  persists the unchanged original snapshot and validates owned part locators
  through the existing native memory/authorization path, with stale-run checks.
- **compactionPlan.ts** previously passed only projected.blocks[originals.length]
  to compactVerifiedWrites. It now projects verified writes across all blocks
  and maps each block back to the same unit identity. Original group closure,
  tail construction and extraction selection are not recomputed from receipts.
- **verifiedWriteHistory.ts** adds compactVerifiedWriteBlocks, preserving the
  prior single-list wrapper. The existing candidate/proof predicate and receipt
  format are unchanged. Global ordered scanning prevents a block split from
  hiding repeated targets, duplicate IDs, approvals or semantic user boundaries.
  Pair projection is atomic, even for a pair spanning blocks. With no proofs,
  the new helper avoids flattening/scanning and retains the no-disk fast path.
- Explicit source restoration pins the intact owning group in the prepared
  view even after memory coverage advances. Otherwise a successful old write
  could be restored from its receipt but then omitted as already-covered
  history. This retains evidence only: it changes no stored message, group
  range, memory revision or coverage and never executes the original tool.
- Latest writes, repeated-target ambiguity (including Windows path casing),
  failed/uncertain effects, approvals and provider-executed effects retain the
  conservative policy. No proof means no successful-write receipt. Previously
  approved/stale receipt text alone never authorizes a new projection.
- No source persistence schema, memory architecture, tool execution, agent
  scheduler, PeerTask, context/output limits, trigger/target percentages,
  safety-margin formula, timeouts or continuation behavior changed.

### Offline Result and Framing

The same terminal state goes from **32858 / 32768**, headroom **-90**, zero
receipts, to **24495 / 32768**, headroom **8273**, **12** receipts. Input and
conversation savings are **7603**; unchanged margin arithmetic contributes
another **760**, total required-budget savings **8363**. No inference or tool
execution occurs. The exact same source sequence prepares identically whether
the former assistant turn is all in extra or is an intact original-history unit
followed by current extra.

Restricting proof to only the ten actual request-24 receipt anchors already
solves the block: conversation **14676**, input **21181**, reserve **2048**,
margin **2119**, required **25348**, headroom **7420**. Those ten recover **6828**
input / **7510** required-budget tokens at request 28. The earlier live
requests 23-24 saved **6828** SDK input / approximately **7515** native required
tokens per request; these are distinct request states/accounting layers, not
interchangeable measurements. The extra two receipts follow normal eligibility,
not broadened history removal.

Measured SDK empty assistant framing is **16**, tool **15**, pair **31**, receipt
assistant **16**. Unit/block boundaries add no model-message framing. The helper
uses the same text-in-assistant receipt format as current-extra successful-write
receipts and existing failed-command receipts, and removes the matching result
atomically. It creates no dangling protocol pair. Restoration is bounded by the
existing shared byte/chunk/round allowance and B1, including when exact original
evidence causes real protected overflow.

The new offline audit is **scripts/check-continuation-effect-context.mjs**.
Local ignored evidence is under
**src-tauri/target/continuation-effect-context-20261019-01/**: worktree-before.json,
before.json, after.json and request-28.optimized.json. Baseline before.json was
captured before production edits; after.json validates the preserved report and
session SHA256 values, part digests/results, raw blocked budget, proof-backed
budget and representation equivalence. Source inspection uses offline native
digest semantics against the immutable session snapshot, not a live IPC claim.
Network fetch is disabled. The optimized native payload is evidence only and
was never sent; outputs use exclusive creation so the captured baseline cannot
be silently overwritten.

### Regression and Verification

- Focused verification: **175 tests / 6 files passed** across verified-write
  history, compaction plan, conversation compaction, failure retention, B1
  context budget and agent-compaction integration. Verified-write tests increased
  from **16** to **27**. New cases cover cross-block pair closure, repeated
  targets across blocks, semantic user boundaries and cross-block approvals.
- The continuation lifecycle disposes the current-turn compactor and constructs
  a fresh compactor with the immutable prior turn as original history. Prepared
  messages stay identical, persisted originals stay identical, fresh proof is
  required, exact original call/result is restored, retrieval is charged/bounded
  and B1 still rejects genuine overflow. Covered-history restoration pins the
  original group without rewriting its memory revision. The actual SDK-tool
  restoration test runs with both extra and original-history placement and
  asserts **zero write_file executions**, including F1-hidden retrieval schemas.
- Missing proofs fail closed; large failed and uncertain original writes still
  block as protected overflow. Normal eligible older-history extraction and
  publication still run alongside original-tail write receipts; no thresholds,
  memory claims or coverage policy were modified to force or skip extraction.
- **npm.cmd run check-types passed**. The first invocation exposed only two
  new-test compatibility issues (SDK union flattening and ES target support for
  Array.at); those tests were corrected and the failed gate rerun successfully.
- **npm.cmd run lint passed** at the unchanged **71 warnings / 2 infos** baseline.
  Focused lint on all four changed TypeScript files has zero diagnostics. New
  offline script syntax and stdin Biome lint passed without rewrites.
- **npm.cmd test** ran once: **2916 tests passed / 205 Clack files**. Overall exit
  was **1** because default Vitest discovery also collected two pre-existing
  ignored ForgeBoard evidence suites (backend/src and backend/dist projects
  tests). Both failed at import/collection on missing **supertest**, matching
  the preserved generated-project limitation. No Clack test failed. The copied
  project and test discovery configuration were left untouched, no dependency
  was installed and no ForgeBoard tool/test body was executed. No full-suite
  rerun was used to hide this gate limitation.
- **npm.cmd run build passed**, with four existing INEFFECTIVE_DYNAMIC_IMPORT
  warnings and the plugin-timing advisory. **git diff --check passed**. No Rust
  production/test source changed in this checkpoint, so Rust gates were not
  rerun merely because an unrelated pre-existing native-example edit exists.
- No live model, native GUI, ForgeBoard resume/tool execution, larger context,
  new model comparison, correction message or provider token claim. This is an
  offline production regression fix, not a fresh product acceptance result.

### Preserved Conclusions and Stop Boundary

qwen3-coder remains the strongest observed local coding model: the prior live
run completed **27** requests/tools, **18** successful file writes, meaningful
backend code/tests, frontend source and README, with **0** malformed calls,
empty responses, tool errors, stalls or cloud inference and **1** automatic
continuation. It passed the older request-18 boundary and exercised ten receipts
in requests 23-24. That remains useful model evidence, not model success.

ForgeBoard remains incomplete/broken: missing socket.io and supertest, frontend
mock-data skeleton, missing SSE, failed production build, missing index.html and
App.css, and runtime data not ignored. Those generated-project defects are
separate from Clack's request-28 preparation stop. The multiline limit = 50
correction detector remains a separate unchanged harness limitation; no
correction was sent and retention of 25 remains untested. The write_file
guidance/toolset mismatch is unchanged. Qwen3.8 remains retired from this local
coding acceptance track.

Commit scope: the three production TypeScript helpers, verified-write regression
tests, new offline audit and only this additive report section. The six
pre-existing worktree edits (including the separate report insertion), safety
stashes, delegation work and autonomous_tracker/ are preserved and excluded.
Commit title: **fix(ai): preserve verified effects across continuation**.
No push. STOP after this fix; any fresh sustained model run, correction-harness
repair or write_file guidance cleanup requires a separate checkpoint.

## Live validation of continuation-stable verified effects

### Scope, Detector and Isolation

Starting HEAD: **e56bbe5 fix(ai): preserve verified effects across continuation**.
One fresh mission was authorized and performed on **2026-10-19**. No Clack
production source, context architecture, memory policy, limits, output reserve,
margin, thresholds, deadlines, tool guidance or model template was changed.
In particular, the known write_file guidance/toolset mismatch remains untouched.

The acceptance-only detector formerly checked each source line separately and
required a pagination/task word on the same line as limit = 50. It missed the
prior run's ordinary multiline req.query destructuring. It now parses bounded
JS/TS/JSON authored content with the existing TypeScript parser: explicit page
size properties/constants, multiline page/limit defaults and pagination-linked
query fallbacks qualify. Comments, string documentation, arbitrary 50, timeouts,
unrelated limits and larger numbers do not. Pending/in-progress/blocked accepted plan
items may qualify; completed, cancelled, interrupted, failed or superseded items
do not. Original specifications and historical plan snapshots are not inspected
as current work.

Current file bytes must match the latest successfully observed write's SHA256.
The existing native/shell effect identity, exact literal-content verification,
path/link/secret checks, three-write-event threshold and durable serialized
pending/dispatching/sent protocol are preserved. A command string alone never
proves a write; shell output must have reached disk. No production prompt or
tool changed. Test/fixture paths were also explicitly excluded after three
additional negative tests exposed that false-positive boundary during final
audit. That final acceptance-only refinement happened after the mission, not
during it, and does not change its untriggered correction result.

Phase-1 correction tests passed **46/46** before inference, with the existing
approval/comparison tests also passing **59/59**. No competing Clack host,
Cargo/Rust build, Vite/test process or acceptance runner was present in the
immediately preceding process inspection. Unrelated Codex processes were left
alone. The tunnel initially refused connections; the user restored it before
metadata preflight. The exact installed qwen3-coder digest was verified:
`06c1097efce0431c2045fe7b2e5108366e43bee1b4603a7aded8f21689e90bca`.

Fresh workspace: **C:/Users/Hayden/Documents/forgeboard-qwen3coder-20261019-01**.
This date-stamped name preserves the existing safe-approval disposable-root
allowlist; the preferred checkpoint-named workspace would not satisfy it.
Evidence ID: **forgeboard-qwen3coder-poste56bbe5-01** under
**src-tauri/target/real-qwen-product/**. Only an empty Git repository was seeded:
no source, dependency scaffold or commit. The native metadata-only preflight
sent **zero inference**. All **1267** tracked files were frozen for the mission;
the post-mission comparison found **zero changes**, including no production
edits and no changes to the six unrelated pre-existing modifications.

### Fresh Mission Chronology and Controls

- Native runner interval: **15:55:22.913 to 15:58:26.454 Europe/Paris**, elapsed
  **183.541 seconds**, including host/setup/report overhead. The same exact
  ForgeBoard specification was sent **once**, SHA256
  `f97ec34eefa136ac5be5847187f768b64bf5587d36140d9fcc53b695fa3e4801`.
  The original stored conversation contains one user message and no correction,
  reminder, manual Continue, requirement resend or evaluator implementation.
- All **23** captured requests used native **/api/chat**, exact model
  **qwen3-coder:30b**, **num_ctx=32768**, **num_predict=2048**, **think:false**,
  reasoning **None**, fallback **Never**, cloud inference **0**. Production's
  **60-second meaningful-progress** and **600-second overall** deadlines were
  unchanged. No Automatic reasoning, other-model probe, model download or
  context increase occurred.
- First completed useful tool: approximately **20.136 seconds** after request 1
  dispatch. First confirmed file write: **30.510 seconds** after session start.
  First substantive backend entry point: **73.008 seconds** after session start.
  No substantive frontend, persistence implementation, SSE implementation,
  successfully authored test, test execution or successful build followed.
- Observed **22 structured calls**, **21 successful tools**, **1 failed tool**,
  **12 successful file writes**, **0 shell calls**, **0 approval requests**,
  **0 empty responses**, **0 stream stalls**, **0 automatic continuations**,
  **0 extraction calls**, **0 retrieval calls**, **0 memory revisions** and
  **0 model-created Git commits**. Successful effects were one directory listing,
  eight directory creations and twelve file writes. The correction observer
  recorded ten eligible write events; its unchanged excluded-path protections
  do not certify files under models/. That still exceeded the three-event gate.
- Request 22 attempted backend/src/__tests__/index.test.ts without first creating
  its directory. Actual write **call_2x1j43nu** failed with Windows os error 3;
  no test file reached disk. Request 23 received that failure verbatim alongside
  eleven proven receipts. The latest successful write, **call_rguc1qi3**, also
  remained verbatim. No repeated-target, uncertain-effect or approval history
  was hidden to make it fit.
- The final native response was **text only**, **done_reason=stop**, provider
  **eval_count=280**, with normal completed IPC/native transport. It said
  "Let me create the tests directory first" and then imitated Clack's historical
  receipt format for create_directory, claiming **call_004h7d5j**, followed by
  **call_71v5g5x8**. Neither is an actual tool call in the immutable transcript.
  Its claimed original part/digest is not execution evidence. The model-authored
  text was stored as text, not converted into an effect, approval or trusted
  source. No textual markup was executed. This is recorded separately from
  malformed tool-call syntax: native structured calls were parseable, while the
  final response fabricated an effect receipt instead of making the next call.
- Production ended naturally at **23 steps**, below the normal **24-step** soft
  boundary. There was no length stop, timeout, watchdog, harness cancellation or
  context failure. No second mission or manual continuation was attempted.

### Pressure and Continuation Evidence

Budgets below are conservative **SDK preparation estimates**, not provider token
usage. All use ceiling **32768**, reserve **2048**, unchanged margin arithmetic.
The audit records every request's SDK/native budget, IDs and receipt provenance.

| Request | System | Schemas | Conversation | Input | Reserve | Margin | Required | Headroom | Receipts |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 20 | 3617 | 7502 | 14899 | 26018 | 2048 | 2602 | 30668 | 2100 | 0 |
| 21 | 3617 | 7502 | 15448 | 26567 | 2048 | 2657 | 31272 | 1496 | 0 |
| 22 | 3617 | 7502 | 16041 | 27160 | 2048 | 2716 | 31924 | 844 | 0 |
| 23, raw before receipt projection | 3617 | 7502 | 17282 | 28401 | 2048 | 2841 | 33290 | -522 | 0 |
| 23, prepared and sent | 3617 | 7502 | 10941 | 22060 | 2048 | 2206 | 26314 | 6454 | 11 |

At request 23, normal pressure-only verified-effect projection saved **6341 SDK
input / 6976 required-budget tokens**. The captured native wire estimate was
input **21088**, reserve **2048**, margin **2109**, required **25245**, headroom
**7523**. Reconstructing its verbatim native pairs measures **6344 input / 6979
required-budget savings**. Minimum actual prepared headroom was **844 SDK** /
**1835 native**, both at request 22. Raw protected-pressure detection at 23 was
resolved normally before inference; it was not a terminal product block.

The eleven actual receipt anchors were call_1vymn22q, call_jagxkqii,
call_8wnfg2tn, call_ec1wf6o0, call_dvtrehq7, call_qo9yo1iy, call_wk90dww0,
call_3x68nb95, call_iu2icrcy, call_krnw0u5s and call_n7snhddp. Each resolves
to the same persisted conversation **real-mission-a**, assistant
**Va3SX8y7b3g707Ow**, exact original part, matching digest and host-completed
result. All identities/digests/paths and before/after costs are in the audit.
The final model-authored imitation is not included in that proof list.

**There are zero continuation transitions.** Pre/post-transition receipt IDs,
costs and survival are **not exercised**, not zero-equals-zero success. The
request-28 history-relocation defect did not recur as an observed failure, but
the model stopped before that class of transition could be live-verified.
The offline continuation regression from e56bbe5 remains valid; this mission
does not replace it with a claimed live pass. No compaction extraction was
forced and no memory revision was published to manufacture coverage.

### Correction and Independent Application Audit

The three-write-event condition was reached. The page-size-50 condition was
**not**: neither an accepted plan nor current authored implementation contained
pagination. The unchanged specification alone did not qualify. The exact
50-to-25 correction was therefore sent **zero times**; subsequent retention of
25 is **untested**, not a failed or passed memory claim. Final detector tests
also validate the original multiline form against actual successful file bytes.
Read-only detector-regression.json independently confirms that the original
post315b568-01 tasks.ts, SHA256
`b1401b3626b68c27900f98d0e1bd4a6a77d12dcfd1f16d37a3ad9541b6626cc4`,
now yields the exact **limit = 50** match. No old project was resumed.

All twelve generated files were preserved byte-for-byte, and an independent copy
was used for all verification. Codex did not implement, repair, complete or
reseed ForgeBoard. There were **zero package/model downloads**. Dependency
preparation used **npm install --offline --ignore-scripts** with audit/funding
disabled: frontend dependencies were available locally; backend preparation
failed **ENOTCACHED** for the declared helmet package. This is an independent
audit environment limitation, not evidence that the declared package is bad.

- **Backend:** seven source files provide a partial Express CRUD/controller/model
  skeleton, port **4317** and a **120-character title** check. Models contain
  sample in-memory arrays; filePath is unused and no disk persistence exists.
  Combined filter/search logic exists statically, but functional API behavior
  was not verified. There is no pagination, SSE or persistence implementation.
- **Frontend:** package.json and tsconfig.json only; no src, index.html, UI,
  loading/error/empty/a11y states or **750 ms** debounce implementation.
- **Tests:** the attempted backend test write failed. No backend/frontend test
  file was authored successfully and the model ran no tests. Independent root
  test/build commands fail on undeclared **concurrently**. Backend build reports
  missing Jest type definitions; its Jest test executable is unavailable after
  the offline dependency-preparation failure. Those dependency-bound outcomes
  are not presented as complete source-level test results.
- **Build:** independently cached frontend Vite **4.5.14** fails on the genuinely
  missing index.html. Frontend test invocation also encounters ancestor Clack
  Vite-config discovery/ESM loading, an audit-isolation limitation; there are no
  authored frontend tests to pass regardless. No production build succeeded.
- **Runtime:** the emitted unmodified backend was attempted only in the audit
  copy after confirming port 4317 was free. Its owned child exited on missing
  helmet; no unrelated process was terminated. CRUD, deterministic error
  responses and restart persistence could not be exercised. SSE was absent,
  so no mutation-event-without-polling test was possible. Static in-memory
  storage is evidence of missing persistence, not a claimed restart test.
- **README/runtime ignore:** neither README nor .gitignore exists. No generated
  source was modified by the audit; both original and copied source inventories
  match their twelve captured SHA256 values. The original repository remains
  uncommitted and unseeded except for model-created source.

### Verification, Classification and Stop Boundary

- Final combined focused group: **293 tests / 10 files passed**, covering
  correction, native approval policy, acceptance lifecycle/comparison, verified
  writes, compaction planning/runtime, failure retention, B1 and agent context
  preparation. After adding the three fixture-path negatives and preserving
  blocked-current-plan behavior, only the affected correction group was rerun:
  **50/50 passed**. This verifies **297 distinct
  focused cases**; it is not a new full-suite count or one combined invocation.
- **npm.cmd run check-types passed**. Syntax and focused stdin Biome lint passed
  for both changed correction files and the new offline audit, with zero
  diagnostics/rewrites. **git diff --check passed**. The native acceptance host
  built in its isolated target and completed both preflight and mission.
- No full Clack suite/build/lint or Rust gates were rerun: changes are acceptance
  harness/tests/docs only. No production source changed before, during or after
  the mission. Windows native IPC was exercised; no manual GUI or Linux/macOS
  native verification is claimed.
- **Clack classification:** no new confirmed product/runtime/context blocker.
  Native transport, real tool execution and current-extra verified-write
  receipts worked. **Continuation/history-relocation live acceptance remains
  INCONCLUSIVE / UNEXERCISED.** Sustained 32K autonomous coding is not established.
- **Model classification:** **MODEL / PREMATURE PROSE STOP / INCOMPLETE**. A normal
  provider stop followed a real tool failure; the response fabricated a receipt
  rather than continuing structured tool work. No transport termination is
  being mislabeled as model failure. qwen3-coder remains the strongest previously
  observed local coding model, but this attempt neither completed ForgeBoard
  nor demonstrated the requested sustained continuation behavior.
- Do not reopen context architecture based on this run: it establishes no new
  defect. Equally, do not mark the architecture's sustained live acceptance as
  complete. write_file guidance cleanup remains outstanding. The conditional
  gate for starting the installed-model shootout/larger-context/UX sequence was
  not satisfied here; no such work began. Any further run requires a separate
  checkpoint; no reminder, retry, model switch or second mission followed.

New offline audit: **scripts/check-continuation-live-run.mjs**. Ignored evidence
includes setup/source freezes, native metadata preflight, launch record, full
request/receive/session data, correction checkpoint, continuation-live-audit.json,
independent install/command/runtime results and evidence-manifest.json.

| Primary Preserved Record | SHA256 |
| --- | --- |
| mission-a-1.json | `f3d19ac07c2dd9bd5eb4e85b3d2d3d211338bf3e3fcc3929e6a1b75fb1728f4c` |
| mission-a-1.requests.jsonl | `7a4e6fc09270c41a8907578accc6913bc3f1ae1c29281067d4b087c8691002c4` |
| data/terax-ai-sessions.json | `4ee7c95cfcb12b3fa85e37909301ad32f4e0f35bc12a4ffcec18dd4473e4e722` |
| continuation-live-audit.json | `617720ff81bbb7497ba5873a47991ef279da2635a1de9e38e7343307c78713bd` |

Commit scope is acceptance-correction.mjs, its tests, the new offline audit and
only this additive report section. Six pre-existing unrelated edits, including
the separate report insertion, remain excluded and preserved; safety stashes,
delegation work and autonomous_tracker/ are untouched. The commit records an
acceptance attempt, not a falsely claimed continuation pass. No push. STOP.

## Truthful file-creation guidance

Stage 1 of the installed-model comparison checkpoint, starting at **b933887**.
The prior system/default/lite/plan prompts named a static superset of tools.
In particular, default file-creation advice recommended write_file even when
permissions, agent assignment, model capabilities or F1's active schema selection
did not expose it. Some schema descriptions also recommended other absent tools.

The fix makes built-in system and plan-mode guidance capability-neutral. The
current request's selected schemas are explicitly authoritative; a historical
tool name or prior successful call never grants current availability. Concrete
creation/editing instructions now live in the actual tool capability metadata
already filtered by permissions and F1 on every request:

- The exposed file writer supports brand-new files and previously read tiny-file
  replacement, not blind targeted replacement. It does not advertise absent edit
  tools. Existing parent-directory and approval requirements remain.
- Exposed exact-string editors explicitly require a prior successful file read
  and cannot create unread/nonexistent files. Uniqueness, atomicity, stale-read
  validation and mutation implementations are unchanged.
- The exposed foreground shell describes authorized noninteractive workspace
  file creation, following the actual env shell/shell_syntax. It does not imply
  Bash from the historical name or hard-code Windows/PowerShell. If no shell
  schema is exposed, this creation route is not sent. Related background/log/
  preview descriptions no longer recommend unavailable named tools.
- Read-only/edit-only/no-tool requests receive no executable writer/shell
  recommendation. Plan mode still prohibits command execution and queues exposed
  file mutations for review. Trusted agent/user instructions are not rewritten;
  core authorization and current-schema authority continue to constrain them.

This uses the existing selected-schema/SDK activeTools path, not a duplicate
capability registry or per-model prompt table. No new tool, permission grant,
textual-tool execution fallback, context preparation, compaction, retrieval,
memory, scheduler, model/agent routing or timeout change was introduced.

Verification:

- **100 focused tests / 5 files passed**, including **26 new guidance cases**
  spanning writer present/absent, shell present/absent, edit-only, atomic-edit,
  read-only, no tools, background handles and three provider/model identities.
  Actual F1 selection plus SDK serialization proves a reduced shell-only file
  creation route does not advertise an omitted writer. Hierarchy, preflight and
  real mutation-safety regressions remain covered. Two old wording/order
  expectations were corrected without weakening behavior assertions.
- **npm.cmd run check-types passed**. **npm.cmd run lint passed**, unchanged
  **71 warnings / 2 infos**. **npm.cmd run build passed**, with the four existing
  INEFFECTIVE_DYNAMIC_IMPORT advisories and plugin-timing notice.
- The single **npm.cmd test** invocation passed **2970 tests / 207 files**.
  Overall exit was **1** solely because default discovery collected the two
  preserved post315b568-01 ForgeBoard src/dist backend test suites, both missing
  supertest. No Clack test failed, no acceptance project was repaired, and no
  test-discovery setting was changed to hide these failures.
- **git diff --check passed**. No checkpoint-owned Rust change, so no Rust gate
  rerun. No native GUI/live-provider testing or model inference is claimed for
  Stage 1. The six pre-existing unrelated edits and safety stashes are preserved;
  only this new report section is staged, not the prior report insertion.

Separate production commit: **fix(ai): align file guidance with available tools**.
No push. Stage 2 starts only after this commit, using installed-model inventory
and one bounded native structured-tool probe per non-retired comparison model.
qwen3-coder's existing baseline is retained without another ForgeBoard run;
Qwen3.8 remains historical-only. The latest baseline's eleven receipts and
healthy request 23 do not turn unexercised live continuation into a failed test.

## Installed local coding model comparison

Stage 2, **2026-10-19**, after **5e269ac fix(ai): align file guidance with available tools**.
Exactly three non-executing native tool probes and three qualified, fresh,
one-shot ForgeBoard missions were performed. No additional qwen3-coder mission,
Qwen3.8 inference, model download, larger-context test, service/global Ollama
configuration change, architecture change or push occurred.

### Isolation and installed inventory

Read-only Windows process inspection found no concurrent Clack host, acceptance
runner, Cargo/rustc or Vite/Vitest run before comparison. The sequential runner
also checks isolation. All **1272** tracked/checkpoint source-file hashes remained
unchanged throughout each mission. No source was edited during inference.
All owned runners/native hosts exited after comparison; unrelated processes were
not terminated. These are native Windows IPC acceptance fixtures, not native GUI
interaction or Linux/macOS verification.

Metadata-only GET /api/version, /api/tags, /api/ps and exact-model POST /api/show
used the existing authorized **http://127.0.0.1:11435** SSH tunnel. Reported Ollama
version: **0.40.5**. Every installed model was **unloaded** at inventory time;
every model advertised context **262144** and **tools**. This is advertised
capacity, not the working context: every inference below remained **32768**.

Exact installed names:

- Coder: **qwen3-coder:30b**.
- 35B-A3B: **hf.co/HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:Q4_K_M**.
- Gemma: **hf.co/HauhauCS/Gemma4-26B-A4B-QAT-Uncensored-HauhauCS-Balanced-MTP:Q4_K_M**.
- 27B: **hf.co/HauhauCS/Qwen3.6-27B-Uncensored-HauhauCS-Aggressive:IQ3_M**.
- Retired historical variants: **qwen38-uncensored:latest**, **qwen38-iq4xs:latest**.

| Installed tag label | Exact digest | Bytes | Architecture / reported size / quantization | Thinking advertised |
|---|---|---:|---|---|
| Coder | 06c1097efce0431c2045fe7b2e5108366e43bee1b4603a7aded8f21689e90bca | 18556700761 | qwen3moe / 30.5B / Q4_K_M | No |
| 35B-A3B | 5bc355c7f631b3e94fe6434a750da9deda8b3fd0345c004dd954558df6a43926 | 22066041578 | qwen35moe / 34.7B / Q4_K_M | Yes |
| Gemma | c8d2e9add7d6b5a9b1d32d35ae02d1d1a9292a51622209f46c23fa83a1a95670 | 17990844136 | gemma4 / 25.2B / Q4_K_M | No |
| 27B | 12ffb1ffc35b5fe7c283f7c5184999faf4376965df2afab26358d4db4e17ce5c | 13508481153 | qwen35 / 26.9B / IQ3_M | Yes |
| qwen38-uncensored | 0e163794a8b9cdd6e234013b1a27d2e58f06f48d20413a0c2e3e370faaef5505 | 16810714650 | qwen35 / 27.3B / Q4_K_M | Yes |
| qwen38-iq4xs | daabf3aac7f641eb4d89fd39b53cbb2ce25fc7cd27256369a3797ff0e6b239dc | 15705861206 | qwen35 / 27.3B / IQ4_XS | Yes |

The newly observed 27B size is **26.9B**, not the previously assumed 27.3B.
Inventory is preserved at
src-tauri/target/installed-local-models-20261019-01/inventory.json; no model alias,
base-family inference or inferred digest was substituted.

### Controls and evidence ownership

Acceptance-only allowlists were extended to those three exact installed IDs in
the Node runner, native example and browser fixture. No production adapter,
memory/context, scheduler, authorization, continuation or timeout code changed
in Stage 2. Unsupported reasoning is explicitly recorded rather than requesting
an unsupported setting or silently relabeling Automatic as None.

All requests used the production native Ollama adapter, num_ctx=32768,
num_predict=2048, stream=true, fallback Never, no provider retries and cloud=0.
The two Qwen3.6 models serialized **think:false**. Gemma's exact metadata has no
thinking control: the recorded effective value is **unsupported-no-control**,
and every outgoing request **omitted think**. Gemma nevertheless emitted
reasoning in its mission; absence of a supported control does not prove absence
of generated reasoning. No reasoning override was fabricated.

Each probe sent the same harmless get_test_value(value="protocol-check") request
once, with no executor or tool effects. All three returned exactly one valid
provider-native structured call with the exact argument. **3 PASS / 0 FAIL**;
all three therefore qualified for one mission. Probe output usage was 27, 134,
27 tokens respectively, including any provider-counted reasoning. No textual
XML/JSON/tool-looking output was executed.

Each mission started in an empty Git repository containing only .git. Full
ForgeBoard specification SHA-256:
**f97ec34eefa136ac5be5847187f768b64bf5587d36140d9fcc53b695fa3e4801**.
The specification was sent **exactly once per mission**, without benchmark/prior
failure references or evaluator implementation. Production tools, permissions,
normal automatic continuation and the existing approval/correction evaluators
were retained. The native **600-second overall inference deadline** was not
changed. No mission was retried, repaired, resumed or manually Continued.

All workspace paths below start **C:/Users/Hayden/Documents/**. The historical
qwen-none folder prefix satisfies the existing disposable-workspace safety
allowlist; it is not a model alias. Exact model identity comes from every
captured request and profile.

| Candidate | Fresh workspace basename | Fresh evidence run ID |
|---|---|---|
| 35B-A3B | forgeboard-qwen-none-20261019-41 | installed-qwen36moe-20261019-01 |
| Gemma | forgeboard-qwen-none-20261019-42 | installed-gemma4-20261019-01 |
| 27B | forgeboard-qwen-none-20261019-43 | installed-qwen36dense-20261019-01 |

Per-run evidence is retained under src-tauri/target/real-qwen-product/<run-id>/:
preflight-1.json, system-preflight-1.json, native requests/receive traces,
mission-a-1.json or .failure.json, event log, isolated session data, correction
state, source-freeze-after.json and installed-model-audit.json. Independent
audits sent **zero inference** and preserved all original project bytes.

Per-run installed-model-audit.json hashes, in table order:

- **9feb7046dfe84245d6f4dfa0936d2397feb4b9cdbd218b5593fd9222035a2a3f**.
- **4a0190314dc0c153b121f20b795f916971fb9f49261d2df416f5bf1462acebc5**.
- **496fbb3a433791b16275868ca4c348fbd93de628a9cc6226630aedf6ada303fd**.

### 35B-A3B outcome

**ENGINE-BLOCKED / provider error / interrupted / incomplete**, not a normal
premature model stop and not a context failure. There were **18 requests**,
**17 structured calls**, **17 successful tools**, **0 failed tools**, **9
successful writer calls**, four directory calls, two todo updates and two shell
calls. npm install genuinely succeeded. The first command,
**node --version && npx --version**, succeeded under the advertised **PowerShell
(pwsh.exe)**, not Bash. Neither a test nor a build was run by the model.

Only nine configuration/HTML files plus package-lock.json existed: no backend
source, frontend application source, tests, README or root .gitignore. Port 4317
appeared only as a Vite proxy target, not a working backend server.

Request 18 emitted a short partial text, then a provider-error frame after a
roughly 32-second output gap. No required engine final/usage total followed.
Native receive/IPC evidence and the SDK error missing-final-event agree at that
boundary. The normalized native trace settled as cancelled after interruption;
that label is not proof of user cancellation or a 600-second timeout. The exact
provider error payload/root cause is not retained by the bounded category trace
and is **unconfirmed**. No total token count is inferred for that request.

### Gemma outcome

**CLACK-BLOCKED / compaction-protected-budget / incomplete**, with substantial
model-side recovery/creation mistakes preceding the safe budget stop. There were
**32 requests/calls**, **23 successful tool invocations**, **9 failed tools**
(nonzero shell exit or tool error), **0 writer/edit successes**, and **1 normal
automatic continuation** after the first 24 steps. Zero explicit approvals were
needed under the retained trusted-workspace policy. Exit-zero scaffolder
cancellation is counted as a completed invocation, not successful application
delivery.

The first shell command **npm init -y** succeeded. Later the model corrected
nonexistent npm dependencies and invalid Vite subcommands, but also mixed POSIX
and PowerShell syntax, attempted editing an unread/nonexistent file, and
repeatedly sent forbidden literal multiline commands. The shell/tool refusals
were preserved, not bypassed. A persistent cd frontend caused later relative
backend writes to land at **frontend/backend/src/types/index.ts**. Two successful
single-line echo calls wrote the same one-line, 33-byte type file. npm/scaffolder
effects produced 23 retained nondependency files in total, including an unchanged
Vite counter/demo frontend, not a ForgeBoard interface. These are shell effects,
not nine or more successful application writer calls. The correction observer
accepted zero bounded current source-write events for this mission.

There was no backend implementation, CRUD, persistence, SSE, validation, filtering,
tests or ForgeBoard README. The frontend README/.gitignore were stock scaffold
files; root .gitignore was absent. Neither a model test nor build ran. No
functional port 4317, title-120 rule, debounce-750 rule or page-size implementation
existed. **13345 reasoning characters** were preserved despite the absence of an
advertised thinking switch; the comparison cannot claim true no-reasoning parity.

Before request 33, protected input estimated **28798**, output reserve **2048**,
safety margin **2880**, required **33726 > 32768**, including **20515** history/
tool-state tokens and no derived memory. Clack correctly did not send that
oversized request. The budget stop is real; no erroneous estimate, receipt loss
or new context-architecture correctness defect was demonstrated. Shell-only tiny
writes did not create the verified writer receipts used in the Coder baseline.

### 27B outcome

**HARNESS-BLOCKED / native-to-WebView delivery lost / inconclusive**. Its probe
passed normally, then one fresh mission request was dispatched with think:false.
Native evidence recorded one **568-byte** body, provider-done, IPC-forwarded and
completed/eof after approximately **9.23 seconds**. No corresponding SDK
first-byte/finish, answer, structured call, todo or filesystem effect reached the
acceptance transcript. The workspace remained empty apart from .git.

Read-only process inspection found host **25344** and runners alive/responding,
but no WebView2 process for this isolated run; the host's direct child list
contained only conhost. No matching crash diagnostic established why its WebView
disappeared. This is not evidence that the model spent 600 seconds reasoning,
returned no native output or failed the task. The native response payload/usage
was not preserved in the receive summary, so mission token/tool contents are
unknown rather than inferred from its byte count.

After approximately **226.6 seconds** from dispatch with no SDK progress, the
evaluator stopped **only the owned native host**. The recorded child exit **1**
is this deliberate cleanup, not a spontaneous host exit or production timeout.
The runner captured .failure.json and source hashes, and exited normally after
classifying the attempt. mission-stop-observation.json distinguishes observation
from cleanup. No replay, retry, restart interaction or repair was performed.

### Comparison and product audit

Coder is the existing **b933887** audited baseline from
forgeboard-qwen3coder-poste56bbe5-01, before the Stage 1 guidance change. It was
**not rerun**. Earlier sustained Coder work, not this latest baseline, contained
some persistence implementation and 18 writes; those results are not conflated
with the latest twelve-write run. Times below start at first native dispatch;
Coder's elapsed figure is its existing whole-run audit duration.

| Metric | qwen3-coder reference | Qwen3.6 35B-A3B | Gemma4 26B-A4B | Qwen3.6 27B |
|---|---|---|---|---|
| Tool smoke | Existing PASS | PASS | PASS | PASS |
| ForgeBoard run | Existing only | One fresh | One fresh | One fresh, inconclusive |
| Mission inferences | 23 | 18 | 32 | 1 |
| Structured calls | 22 | 17 | 32 | 0 observed by SDK |
| Successful / failed tools | 21 / 1 | 17 / 0 | 23 / 9 | 0 / 0 observed |
| Successful writer calls | 12 | 9 | 0; two tiny shell rewrites plus scaffold | 0 |
| First response / structured tool | 18.879s / 20.136s | 7.740s / 14.136s | 4.619s reasoning / 28.163s | Native 9.23s; SDK unobserved |
| First confirmed write | 30.040s | 27.040s | None accepted by observer; shell/scaffold effects exist | None |
| First substantive backend / frontend | Backend 72.538s; frontend absent | Neither | Neither; generic Vite scaffold only | Neither |
| Elapsed | 183.541s | 125.865s | 174.442s | 226.635s, evaluator cleanup |
| Backend / frontend | Partial backend / config only | Config / config only | None / scaffold | None / none |
| Persistence | Earlier run only; latest in-memory | None | None | Not exercised |
| SSE | No | No | No | Not exercised |
| Model test / build commands | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| Tests / build audited | Prior partial/failed | Audit dependency-blocked; no source/tests | Root test fails; build script absent | No package/source to run |
| Automatic continuations | 0 latest; 1 older | 0 | 1 | 0 observed |
| Empty completed responses | 0 | 0 | 0 | Unknown; no SDK completion |
| Premature normal prose stop | Yes latest | No; engine interruption | No; budget stop | Not assessable |
| Explicit approvals / cloud | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 observed |
| Transport idle/deadline stalls | 0 | 0; provider error instead | 0 | Native completed; WebView delivery stall |
| Minimum native estimated headroom | 1835 | 9616 | 1023 on sent requests | Not captured |
| Minimum SDK headroom | 844 | Not captured | Next preparation over by 958 | Not captured |
| Verified receipts / saving | 11 / 6976 required tokens at request 23 | 0 / 0 | 0 / 0 | 0 observed |
| Memory revisions / extraction / evidence retrieval | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | Not exercised |
| Correction sent / 25 retained | No / untested | No / untested | No / untested | No / untested |
| Context blocker | None latest | None | Protected-budget before request 33 | Not established |
| Final class | MODEL-INCOMPLETE | ENGINE-BLOCKED | CLACK-BLOCKED | HARNESS-BLOCKED |

The syntax-aware 50-to-25 observer was retained unchanged, but none of the new
missions reached current page-size-50 code/accepted plan after three confirmed
source writes. No correction was therefore sent, and no 25-retention success or
failure is claimed. No malformed textual tool intent was executed. Coder's prior
fabricated-looking prose receipt remains a model stop, not an executable call.
Gemma's real continuation had **no verified write receipts**; it does not verify
live receipt relocation. Coder live continuation-receipt survival remains **NOT
EXERCISED**, not failed. **e56bbe5** deterministic coverage remains authoritative.

Independent, source-identical copies were created outside Clack at
C:/Users/Hayden/Documents/forgeboard-audit-20261019-41 and -42. No original project
was repaired. For 35B-A3B, offline npm ci --ignore-scripts failed ENOTCACHED for
ws-8.22.0; subsequent test/build commands failed because vitest/tsc were absent.
This is an **audit dependency limitation**, not evidence of failed authored tests.
There were no application or test source files regardless. Gemma's root npm test
was the generated "no test specified" exit 1, and npm run build had no script;
the Vite demo is not a ForgeBoard acceptance pass. No package existed for 27B.
CRUD, task/project behavior, filters/search, deterministic validation/errors,
persistence, SSE, required frontend workflows, runtime-data ignores, port 4317,
title max 120, debounce 750 and page-size behavior were **not delivered** by any
new candidate. No fabricated functional checks or UI acceptance are claimed.

### Decision, limits and next candidate

**No preferred local coding model yet.** Coder remains the strongest observed
implementation reference, with meaningful earlier backend/persistence progress,
reliable sustained native calls and now healthy latest context preparation.
Its latest premature prose stop and incomplete unverified product still rule out
declaring a reliable daily autonomous default.

35B-A3B showed clean structured tooling and fast configuration progress, but an
engine-blocked run cannot prove delivery or superior failure recovery. Gemma
recovered from some dependency/scaffolding mistakes but repeatedly failed file
creation and exhausted protected context before an application existed. 27B's
native probe passed, but harness loss makes its coding ability **unranked**.
Delivery ranking: **Coder first; no defensible complete-product ranking among
the three new candidates**. By observed useful progress only, 35B-A3B's clean
configuration work is more promising than Gemma's scaffold/recovery loop; this is
not a latency/parameter-size victory or a model-quality conclusion about 27B.
Confidence is high that no preferred/default choice was earned here, low for
comparative generalization from one bounded mission each. No installed candidate
has demonstrated sufficient reliability for daily unsupervised coding-agent work.

Keep broad context-architecture debugging **stopped**. These runs add specific
engine-stream, Gemma protected-budget pressure and isolated WebView-delivery
limitations, not evidence to discard the existing C1/G1/M1/M2/PeerTask/context
design. The WebView-loss cause and exact engine error need bounded investigation
in separately authorized work; no hidden repair or new mission was started here.

Next external candidate recommendation, **not downloaded or tested**:
**devstral-small-2:24b**. Its exact tag is currently listed by the primary
[Ollama model page](https://ollama.com/library/devstral-small-2:24b), checked
2026-10-19: tool-capable, Q4_K_M, approximately 15GB, requiring Ollama 0.13.3 or
later. This availability check is not a claim that it will work better on this
host. Any download and same-32K evaluation require a separate checkpoint.

### Verification and repository safety

- Stage 1's production gates remain as recorded above: **100 focused**, **2970
  full-suite tests / 207 passing files**, with only two preserved ForgeBoard
  collection failures for missing supertest; types/lint/build passed, unchanged
  71 warnings / 2 infos and four build dynamic-import advisories.
- Stage 2: **19 focused tests / 3 files** (four new installed-model guard cases,
  preserved comparison and approval-lifecycle coverage), plus **107 approval/
  correction tests / 2 files**, all passed under Vitest. An initial sandbox cache
  rename denial ran no tests; an incorrect Node-test-runner invocation was
  corrected to the suites' existing Vitest runner. Neither changed product code.
- Affected **TypeScript passed**, **cargo fmt --check passed**, and strict
  **cargo clippy --all-targets --locked -- -D warnings passed**, using isolated
  target/codex-test. The full Rust gate failed in the library suite at **605
  passed / 1 failed / 606 total**, before later test targets could run:
  unchanged d1_cancellation_timeout_and_revocation_prevent_or_interrupt_work
  expected tool-revoked but got timed-out, line 758. Its isolated rerun also
  failed. That test's bytes are unchanged from checkpoint entry. Its broader
  timing/root cause was not investigated; this is not a green Rust gate or a
  checkpoint-owned production change, and no unrelated fix was attempted.
- All three native probe/control audits passed, and every mission's source-freeze
  audit passed. Offline evidence/source-identity audits passed. One offline
  audit assertion about continuation adding a user message was corrected:
  production automatic continuation does not resend the original user message.
  The completed first audit was reused, not its inference replayed.
- The Stage 2 lint recheck also passed at **71 warnings / 2 infos**. Full frontend
  test/build gates were not redundantly rerun after the acceptance-only extension.
  No native GUI/manual browser, Linux/macOS or live cloud test is
  claimed. Diff checks passed. Local generated evidence and disposable projects
  are preserved; no model/persistent application setting was globally changed.
- Only checkpoint-owned hunks/new scripts/tests and this appended section belong
  in the evidence commit. The original six unrelated edits, including IQ4_XS
  additions and the separate earlier report insertion, remain unstaged and
  preserved. Safety stashes, delegation work and autonomous_tracker/ are untouched.

Separate evidence commit: **test(ai): compare installed local coding models**.
Total new native inference requests: **54 = 3 probes + 51 mission requests**;
cloud inference **0**. No model download, context increase, additional Coder or
Qwen3.8 mission, automatic tuning ladder, architecture rewrite or push. STOP.

## Devstral Small 2 24B Local Comparison: 2026-10-19

This checkpoint evaluates the next candidate named above with the same bounded
local product acceptance rather than changing the benchmark or tuning the model.
The exact Ollama tag is **devstral-small-2:24b**. The pull completed successfully
on the existing Ollama 0.40.5 host. `ollama show` reports **Mistral3, 24.0B,
Q4_K_M, 393216 advertised context** and tool capability. The installed digest is
**24277f07f62db8f9cb68e9dfc679ea1818a7fbac47a50eff0a701d3f645b63c8**;
the model layer is approximately 15 GB.

Acceptance-only authorization was extended for that exact tag and for disposable
`forgeboard-devstral-YYYYMMDD-NN` workspaces. No production inference adapter,
context budgeting, scheduler, tool policy, continuation, retry or timeout behavior
changed. Node syntax checks passed, the focused comparison Vitest remained **2/2
passing**, and `cargo fmt --check` passed before inference.

The fresh workspace was
**C:/Users/Hayden/Documents/forgeboard-devstral-20261019-01** with evidence run
ID **devstral-small2-20261019-01**. Metadata preparation used **zero inference**.
The non-executing protocol probe then sent exactly one local request with
`num_ctx=32768`, `num_predict=2048`, streaming enabled and one harmless
`get_test_value` schema. Devstral returned the exact native structured call
`get_test_value({"value":"protocol-check"})`; tool execution count was **0**.
The loaded runtime reported **32768** context and llama.cpp. Cloud inference was
**0**.

`reasoningChoice=none` was requested for parity, but exact model metadata advertises
no native thinking control. Clack therefore recorded **unsupported-no-control**
and omitted `think` on the wire instead of inventing a supported setting. The
mission used the unchanged ForgeBoard specification once, one persistent Coder,
no delegation, no evaluator-authored implementation, no correction, no manual
Continue and no retry.

### ForgeBoard outcome

**ENGINE/PRODUCTION-TIMEOUT / incomplete.** The mission issued **11 native
inference requests**. Requests 1-10 all received normal provider final events with
`done_reason=stop`; their provider-reported output total was **2060 tokens**.
Request 11 was dispatched normally but delivered **zero response-body chunks and
zero bytes for approximately 119.97 seconds**. The browser/SDK provider-recovery
wrapper has a fixed **120000 ms** total stream budget and surfaced
`overall-deadline`; cancellation then reached the native request. The Rust
self-hosted transport separately has a **120-second first-output guard** and a
**600-second absolute ceiling**, so this boundary is a real production-contract
timeout rather than an evaluator stop. The local Ollama service remained healthy
and the model remained loaded at 32768 context after the run. The evidence does
not localize whether the long no-byte interval was model computation or another
provider-side stall, so no narrower root cause is claimed.

This was **not a context-budget failure**. Every captured request used the exact
model, 32768 context and 2048 output reserve, with `think` omitted and cloud 0.
The minimum recorded request headroom was **1226 tokens**. The final run state was
failed with error code `overall-deadline`, totalSteps **10**, continuationCount
**0**, peerTaskCount **0**, and last finish reason `tool-calls`. Whole mission
elapsed time was approximately **418.4 seconds**.

The model made useful early progress before the timeout. It executed **19 tool
invocations: 18 successful / 1 failed**. Breakdown: todo_write **2/2**,
bash_run **3/3**, create_directory **9/9**, write_file **2/3**, read_file **1/1**,
edit **1/1**. It successfully ran `npm init -y`, installed TypeScript/@types/node,
then installed its declared dependencies, created the project/source directory
layout, wrote tsconfig.json, edited package.json, and wrote
`src/shared/types.ts`. Its one tool failure was a protected write to the existing
package.json before reading it; the model immediately corrected that by reading
the file and applying an edit. This is materially cleaner tool recovery than a
repeated identical-call loop.

The final nondependency project content was only **package.json,
package-lock.json, tsconfig.json and src/shared/types.ts**, plus empty source
directories. There was **no backend implementation, frontend implementation,
API, CRUD, persistence, SSE, validation, combined filtering/search, tests,
README, root .gitignore, production build, or functional port 4317**. No title-120,
debounce-750 or task-page-size-50 behavior existed in runnable application code.
The model itself never reached a test or build command. A post-run evaluator audit
sent **no inference** and made no repairs: `npm test -- --runInBand` reported
**No tests found**; `npm run build -- --noEmit` passed only the small TypeScript
surface that existed and is not a production-build acceptance pass.

### Decision

Devstral Small 2 passes the local native tool-protocol gate and showed competent
early project setup, dependency installation, protected-write recovery and real
writer use. It still **did not demonstrate autonomous ForgeBoard delivery under
the production Clack contract**. The request-11 no-first-byte stall is sufficient
to fail this checkpoint without a retry, context increase, timeout relaxation,
reasoning substitution or prompt babysitting. It is therefore **not promoted to a
preferred/default local coding model** from this run.

Relative to prior incomplete candidates, this run provides stronger evidence of
clean early execution than the Qwen3.8 repeated-tool-failure attempt and the Gemma
file-creation loop, but substantially less delivered application functionality
than the strongest historical qwen3-coder progress. That observation is limited
to these acceptance runs and is not a general benchmark claim.

### Devstral Small 2 installed-model comparison: adopted-run audit

This audit continues from **2677375**, containing **5e269ac**, on main. At
attachment, index was empty, stored origin/main was 0 behind / 57 ahead, both
safety stashes were unchanged, and the six existing modified paths remained.
An already-running Devstral mission was discovered. The user explicitly chose
**Audit the existing run; do not start another**. No new inference, smoke,
ForgeBoard mission, retry, download or model/service/network configuration change
was initiated by this audit. The existing run's report above is preserved.

This supplement supersedes ambiguous deadline/headroom/build wording above, not
the original transcript or historical model findings. The model download was
completed by the user before this evaluation; no model was downloaded here.

#### Artifact and hardware

Exact installed artifact: **devstral-small-2:24b**, digest
**24277f07f62db8f9cb68e9dfc679ea1818a7fbac47a50eff0a701d3f645b63c8**,
**15177374099 bytes** on disk. Exact show metadata reports **mistral3**,
**24011361280 parameters**, **24.0B**, **Q4_K_M**, advertised context **393216**,
capabilities **completion, vision, tools**, and no advertised thinking control.
Stored model temperature 0.15 was not tuned or overridden. Ollama reports 0.40.5.

Saved metadata-only preflight and smoke initial /api/ps snapshots show Devstral
was **unloaded** before that smoke. During the adopted mission, read-only SSH
inspection measured an **NVIDIA GeForce RTX 4060 Ti**, VRAM **16380 MiB total /
14696 MiB used / 1313 MiB free**. RAM was **33236643840 bytes total**, approximately
4.997 GB used and 28.239 GB available. zram swap: **33235660800 bytes total**,
approximately 1.461 GB used. These hardware measurements are **during-run**, not
a fabricated pre-load VRAM baseline; historical pre-load VRAM usage is unavailable.
No unrelated workload was stopped. /api/ps reported runtime size **16133233048**,
size_vram **14060701613**, and context **32768**. Full-GPU residency is not claimed;
reported VRAM residency is smaller than total runtime size.

#### Protocol and controls

The saved smoke contains exactly **one** /api/chat request, one deterministic
get_test_value schema, and one valid native structured call with value
protocol-check. No answer prose, tool executor, approval or follow-up inference:
**PASS**. Native trace categorized a tool frame and a normal provider final;
SDK finish was tool-calls. Provider usage: 93 input / 13 output tokens.

All 12 captured requests, one smoke plus eleven mission requests, used the exact
installed model, **32768 context / 2048 output**, streaming, and the existing
localhost tunnel. Fallback remained Never; every captured inference destination
was http://127.0.0.1:11435/api/chat; cloud count **0**. No sampling field was added.
The harness requested None, explicitly reported **unsupported-no-control**, and
omitted think in **every native body**. The persisted production session choice
remained its internal **automatic/default** value because None was unsupported;
this is not represented as a successful None setting or a hidden think:false.
No reasoning output was observed.

Existing workspace:
**C:/Users/Hayden/Documents/forgeboard-devstral-20261019-01**.
Existing evidence ID: **devstral-small2-20261019-01** under
src-tauri/target/real-qwen-product/. No second workspace/mission was created.
The saved transcript has exactly one user specification, SHA-256
**f97ec34eefa136ac5be5847187f768b64bf5587d36140d9fcc53b695fa3e4801**,
matching prior ForgeBoard comparisons. No delegation, reminder, correction,
manual Continue or evaluator implementation occurred.

Protocol limitation: the adopted launcher had **SINGLE_SPEC=1**, disabling the
syntax-aware correction branch. This was discovered and disclosed before audit;
the user chose no new run. It was not changed mid-run. Independently inspected
files and the final plan never materially contained page size 50, so the full
correction trigger was not reached anyway. **50-to-25 was not sent; retention is
UNTESTED**, not passed, forgotten, or a model failure. The run is not claimed as
full correction-protocol parity with an enabled comparison harness.

#### Chronology and stop boundary

First native dispatch was **2026-10-19 16:28:08.197 UTC**. First useful response
and native structured tool arrived after **40.920 seconds**. Ten completed
responses all contained provider-native tools: **19 calls total**, zero normal
answer-prose responses, malformed textual intents or empty completed responses.
Request 3 contained ten calls, explaining why calls exceed completed responses.
The eleventh response is classified **NO RESPONSE / ABORTED**, not empty/model stop.

Successful calls: **18**. Failed calls: **1**, the read-before-write refusal on
existing package.json. The model read it and used an exact edit, then continued
installing dependencies and writing types. No repeated refusal loop, fabricated
receipt, premature prose stop or manual recovery occurred. Breakdown:
todo_write 2, bash_run 3, create_directory 9, read_file 1, write_file 3 attempts
(2 successful), edit 1 successful. First shell command **npm init -y** succeeded
under the actually advertised **Windows PowerShell (powershell.exe)**, not Bash.

Three successful file mutation calls were observed: tsconfig.json write,
package.json edit, src/shared/types.ts write. Time to the first confirmed writer
effect is bounded between response completion and the next dispatch:
**109.101-109.197 seconds**. Other mutation bounds are 238.547-239.100 and
297.765-298.022 seconds. npm-generated manifests/lockfiles are separate shell
effects, not additional application source writer calls. No substantive backend
or frontend implementation was reached. Model test/build commands: **0 / 0**.
Explicit approvals **0**, automatic continuations **0**, model Git commits **0**.

Final request dispatch: **16:33:06.219 UTC**. Session failure:
**16:35:06.205 UTC**, approximately **119.986 seconds** later. Native dispatch to
cancellation observation was **119.971 seconds**, with **no headers, body bytes,
IPC data or provider final/usage**. Prior ten responses reported 2060 output
tokens total; no usage is inferred for request 11. Whole native-dispatch-to-report
duration was **419.351 seconds**, approximately 418.4 seconds to session failure.

Winning boundary: the shared **withProviderRetryTracking** wrapper in agent.ts
uses providerRetry.ts's **120000 ms pre-first-meaningful-output recovery ceiling**.
Its timer aborts with **overall-deadline**; native then observes cancellation.
This is **not a 600-second native overall timeout**, evaluator termination,
WebView disappearance or confirmed model exhaustion. The wrapper clears that
timer at first meaningful output: the earlier description "total stream budget"
must not be interpreted as a 120-second cap on an already-progressing stream.
Native policy separately retains 120-second first-output, 60-second meaningful
idle and 600-second absolute guards. The wrapper won this race. Why Ollama had
not returned headers/body remains **UNCONFIRMED**; partial CPU/GPU residency alone
does not establish causation. No timeout, retry policy or production source was
changed to rescue the attempt.

This identifies an enforced runtime limit, not proof that the timer malfunctioned:
the native first-output guard would also expire near 120 seconds without progress.
Relaxing the outer wrapper alone is not demonstrated to solve the underlying stall.

Classification: **CLACK-BLOCKED / PRE-OUTPUT RECOVERY DEADLINE / INCOMPLETE**,
with underlying provider no-response cause unknown. This locates the observed
product boundary rather than blaming model engineering ability or claiming a
new context defect. No additional run was authorized or attempted.

#### Context and independent project audit

Every native request fit B1. Minimum remaining headroom was **10043 native-wire
estimated tokens** and **10026 SDK estimated tokens**, including output reserve
and safety margin. Formula: ceiling minus system/tools/conversation costs,
reserve and margin. The preceding section's **1226** was request 1's **safety
margin**, not remaining headroom. Final native input was 18797, reserve 2048,
margin 1880, ceiling 32768: remaining 10043. Schema counts/costs are retained per
request in the audit JSON; final exposure was 16 schemas / 15012 bytes.

Offline SDK reconstruction matched **all eleven captured native requests** after
restoring semantically verified result JSON key ordering and parallel completion
order from captured wire evidence. No source reference was fabricated. The
existing shared planCompaction/measureRequest/resolveContextBudget/ollamaBody
implementations were used unchanged, without inference. Verified receipts **0**,
savings **0**, compaction/extraction/retrieval **0**, durable memory revision
**none**. No protected-budget stop. Live continuation-receipt survival remains
**NOT EXERCISED**; e56bbe5 deterministic coverage is unaffected.

Exactly four nondependency project files remained: package.json, package-lock.json,
tsconfig.json, src/shared/types.ts. Shared type aliases/enums are not counted as
substantive application implementation. Tests, backend/frontend application,
project/task CRUD, filters/search, deterministic validation/errors, missing-parent
handling, persistence, SSE, functional port 4317, title limit 120, debounce 750,
page-size behavior, loading/error/empty views, keyboard navigation, ForgeBoard
README and runtime-data ignore rules are **NOT IMPLEMENTED**.

A separate source-identical copy at
**C:/Users/Hayden/Documents/forgeboard-devstral-audit-20261019-01** used the
acceptance host's isolated retained npm cache (per-command only):

- npm ci --offline --ignore-scripts --no-audit --no-fund: **PASS**, 391 packages,
  no network installation or project repairs.
- npm test -- --runInBand: **EXIT 1, No tests found**. Zero authored tests passed.
- npm run build: **EXIT 0**, tsc compiled only shared types. This is not a working
  frontend/server production-build acceptance pass.
- npm start: **EXIT 1, MODULE_NOT_FOUND**, dist/backend/index.js absent.

No backend could start, so persistence restart and live SSE mutation checks could
not be performed. No frontend existed for browser/keyboard checks. Original
source hashes remained unchanged by independent commands; no repair was made.

#### Direct decision

| Metric | qwen3-coder latest reference | Devstral adopted run |
|---|---|---|
| Native smoke | Existing PASS | PASS, one non-executing request |
| Mission requests / structured calls | 23 / 22 | 11 / 19 |
| Successful / failed tools | 21 / 1 | 18 / 1 |
| Successful file mutations | 12 writer calls | 2 writer calls + 1 edit |
| Substantive backend / frontend | Partial backend; frontend config only | Neither; shared types only |
| Persistence | Demonstrated in earlier run, latest in-memory | NOT IMPLEMENTED |
| SSE | Not completed | NOT IMPLEMENTED |
| Tests / production application build | Earlier partial/incomplete/failed | No tests; type-only tsc pass; startup fails |
| Recoverable failure | Latest stopped in prose | Read/edit recovery succeeded |
| Premature prose stop | Yes latest | No; product timeout |
| Continuations | 0 latest, 1 earlier | 0 |
| Stream idle stalls | 0 | 0; one pre-output deadline |
| Minimum SDK / native headroom | 844 / 1835 | 10026 / 10043 |
| Receipts / required-token savings | 11 / 6976 on latest request 23 | 0 / 0 |
| Latest context blocker / cloud | None / 0 | None / 0 |
| Final class | MODEL-INCOMPLETE | CLACK-BLOCKED, provider cause unknown |

**NO PREFERRED MODEL YET.** Coder remains the strongest observed implementation
reference across earlier substantive backend/persistence/frontend work, but its
latest premature stop and incomplete delivery do not earn a reliable default.
Devstral showed clean native tooling and recovery, not enough delivered software
to surpass Coder or judge ultimate model capability from a runtime-limited run.
Confidence is high that neither earned promotion here, low for a general quality
ranking. Daily autonomous coding without babysitting: **PROMISING BUT NOT YET**,
not a daily-use recommendation or a completed ForgeBoard claim.

Keep context-architecture debugging **stopped**. Exactly one recommended next
direction: **a bounded investigation of Devstral's pre-output no-response boundary
and shared recovery/native deadline interaction**, correlating Ollama-side timing
with Clack dispatch/cancellation before proposing any policy change. Do not raise
context or blindly extend deadlines; no further model run or fix was started here.

#### Verification and preservation

Focused Clack verification: **208 tests / 8 files passed**, covering acceptance,
native tool protocol (including two new Devstral structured/textual cases),
approval/correction, guidance and recovery deadlines. TypeScript passed. Focused
lint passed on four harness/test files with no diagnostics. Script syntax,
cargo fmt --check and strict Clippy for the native coworking_acceptance example
passed. Full Clack frontend/Rust suites and production build were intentionally
not rerun for an evidence-only checkpoint; earlier unrelated suite limitations
are not represented as repaired.

Audit baseline and read-only hardware/model evidence are retained under
src-tauri/target/devstral-audit-20261019-01/, with audit.json and an independent
source-hash inventory. Pre-start isolation/empty-workspace/source freeze were not
independently observed by this adopting audit; saved preflight supports initially
unloaded model and the original spec/transcript are verified. From attachment to
mission completion, tracked hashes were observed unchanged. Subsequent changes
were confined to audit tests/report, not production modules. Another task appended
the initial report after terminal outcome; it is preserved and qualified above.
Unrelated IQ4_XS/report edits, stashes and autonomous_tracker/ must remain untouched.

Evidence-only commit requested: **test(ai): compare devstral local coding model**.
No push, no model download, no additional inference by this audit, no larger
context, no other candidate run, no production architecture or service change.

## Devstral pre-output recovery deadline investigation

### Scope and primary result (2026-10-19)

Resumed from `5e80321`. This is an evidence-only investigation, not another
ForgeBoard acceptance mission. The historical mission remains
**CLACK-BLOCKED / PRE-OUTPUT RECOVERY DEADLINE / INCOMPLETE**. Its final
provider cause was unknown at that checkpoint; the newly correlated existing
Ollama logs now establish that the runner was generating, not silently idle.

Primary investigation classification: **A - INTERMITTENT ENGINE / PRE-OUTPUT
LATENCY - NOT REPRODUCED**. Exactly one non-executing same-JSON-payload replay
completed before 120 seconds, with a valid native tool call and normal final
event. This does not establish that the historical generation would have
completed before 600 seconds, or that its undisclosed partial tool arguments
were valid. It does not establish a Clack deadline-policy/control-flow defect.
No production source, timeout, model setting, context architecture or service
configuration was changed. No subsequent sustained mission was started.

### Historical request identity and controls

- Evidence: `src-tauri/target/real-qwen-product/devstral-small2-20261019-01/`.
- Native request ID: `inference-11`; conversation `real-mission-a`, logical run
  `real-mission-a:1792427287763`.
- Exact model: `devstral-small-2:24b`; digest
  `24277f07f62db8f9cb68e9dfc679ea1818a7fbac47a50eff0a701d3f645b63c8`.
- Destination: existing `http://127.0.0.1:11435/api/chat` SSH tunnel. Ollama
  `0.40.5`, working context 32768, output 2048, `stream:true`, `think` omitted,
  no sampling override. Unsupported None remains model/default/Automatic
  equivalent, not a transmitted no-thinking control. Fallback Never, cloud 0.
- Captured JSON: 29 messages, 16 schemas, **38,032 UTF-8 bytes** when minified
  for replay. Original raw serialized key order was not retained by the native
  recorder, which parsed the request into a JSON value. Replay preserves exact
  JSON content, messages, schemas and native fields, not a claimed original
  byte-order hash. Re-serialized payload SHA-256:
  `adabedc3153d4ee3e560b610d27eb8dfa14b27f5dd6d21e08e1ded2d8c4d3888`.
- Native B1 input estimate: **18,797** (system 3755, tools 7317, conversation
  7725); reserve 2048, margin 1880, ceiling 32768, remaining headroom **10,043**.
  Schema bytes 15,012. These are estimates, not provider usage. The runner log
  independently reports an 8200-token prompt; request 11 has no final usage.
- Request 11 was the **original first attempt of the next normal agent step**
  after request 10's successful edit. No preceding transient-error trigger,
  retry, recovery restart or continuation is recorded. Ten prior provider
  completions and zero continuations are preserved; no completed tool was replayed.

### Request-11 timeline

UTC wall times below are recorded local timestamps. Monotonic deltas use the
native trace's `elapsedUs` minus its dispatch stamp, not cross-host wall-clock
subtraction. Zero trace events were dropped. Its trace clock began before
`execute_traced`; that baseline is not itself a logged HTTP send timestamp.

| Stage | Recorded time / native dispatch-relative interval |
|---|---|
| Clack preparation start | NOT RECORDED |
| Clack preparation end | NOT RECORDED |
| SDK recovery timer start / callback firing | NOT RECORDED; code owner established below |
| Native IPC invocation observed | `2026-10-19T16:33:06.219Z` |
| Admission entered / admitted | `16:33:06.233Z` / same timestamp; zero recorded queue wait |
| Native attempt marked started | `16:33:06.240Z` |
| reqwest request construction | NOT RECORDED; occurs before dispatch in code |
| Native dispatch immediately before `req.send()` | **`16:33:06.241Z`**, trace `elapsedUs=7968` |
| Physical TCP/HTTP send start / completion | NOT RECORDED |
| Response headers | None observed before cancellation |
| First HTTP body byte at reqwest delivery | None observed; 0 chunks / 0 bytes |
| First IPC chunk | None observed |
| First parsed frame | None observed; 0 frames |
| First meaningful model output to Clack | None observed |
| Native cancellation observed / admitted operation settled | **`16:35:06.204Z`**, trace `elapsedUs=119971011` |
| Session terminal error recorded | `16:35:06.205Z` |
| Native settled event delivered to browser observer | `16:35:06.207Z`, `cancelled` |
| Kernel/socket abort completion | NOT RECORDED; trace finishes after guarded HTTP future returns |

Native dispatch to observed cancellation is **119.963043 seconds**. IPC
invocation observation to session error is 119.986 seconds. The trace's absolute
`119971011us` is 119.971011 seconds from trace creation, **not** the
dispatch-relative interval. This qualifies earlier rounded 119.97-second wording.

Terminal SDK error is `InferenceTransportError("overall-deadline")`, normalized
as `timeout`, title `Inference timed out`, message
`The inference request exceeded its overall deadline.` Native reports
`cancelled`, not its own `overall-deadline` or `first-output-timeout`. The SDK
120-second timer won; the native 600-second guard did not fire first.

### Timer ownership and intended semantics

| Clock | Owner / start / stop |
|---|---|
| Shared 120s pre-output ceiling | `src/modules/ai/lib/providerRetry.ts`, `withProviderRetryTracking`, `PROVIDER_RECOVERY_LIMITS.totalMs=120_000`. Starts in `wrapStream` before `open()` calls underlying `doStream`, even on the original attempt. Shared across original attempt, retries, backoff, proxy preflight/admission and model loading. No reset per retry. Cleared at first non-structural SDK part or cleanup/cancel. |
| Native first-output 120s | `src-tauri/src/modules/net/inference/mod.rs`, `Timeouts::for_policy(Policy::SelfHosted)`, then `execute_traced`. Starts at its `Instant::now()` after admission and native preflight; includes resolve/client construction, header wait and body wait. Meaningful parsed protocol progress changes it to the 60s idle guard. |
| Native overall 600s | Same `Timeouts::for_policy`, `Deadline.overall = start + limits.overall` in `execute_traced`. Same post-admission start. Never extended/reset by headers, body, progress, retries outside this attempt or idle resets; request teardown stops it. |

Call path: normal `createAgent` setup in `agent.ts` wraps every v3 base model
with `withProviderRetryTracking` (no provider-specific total-time override),
then answer continuation; AI SDK agent steps call that model's `doStream`;
Ollama `send` in `ollamaModel.ts` serializes the body and invokes the captured
`createProxyFetch` transport; `proxyFetchImpl` performs preflight/open/IPC;
`ai_http_stream -> execute_admitted -> execute -> execute_traced` owns native HTTP.

The name "recovery" does **not** mean a timer only starts after an error. It
also bounds the initial attempt while automatic pre-output recovery is possible.
Structural `stream-start`, `response-metadata`, `text-start`, `reasoning-start`
and `raw` parts do not clear it. Headers alone, raw first body bytes and empty
heartbeats do not clear it. A text/reasoning delta, tool boundary, finish or
other non-structural SDK part does. Neither clock distinguishes cold from warm
models; load time counts. No unrelated agent preparation before `wrapStream`
is included, but proxy-layer preparation after it is included.

This is deliberate D3 behavior, introduced in `1ff4a69`, not evidence of F
(recovery-only timer mistakenly applied to a normal step). The D3 implementation
record explicitly includes preparation/admission/delay, and
`streamRecovery.test.ts` asserts that an original attempt whose headers never
arrive fails once at the existing recovery ceiling. It also covers bounded
retries, Retry-After, cancellation, stale work, and no replay after output/effects.
The historical zero queue wait and approximately 22ms IPC-to-dispatch gap do
not support E (120 seconds consumed by unrelated preparation). Cloud requests
also use the SDK ceiling; native legacy policy has no first/idle guard but
retains its overall 600s bound. No policy was changed for either provider class.

### Existing Ollama logs and tunnel correlation

Read-only SSH retrieval preserved 799 lines from the existing system service
journal for `16:26:00Z` through `16:37:00Z`. No debug logging was enabled, service
restarted or model setting altered. Correlation is by consecutive requests,
single runner/slot, model blob, 32768 context, 8200 prompt tokens and timestamps;
Ollama does **not** log Clack's `inference-11` ID. Host clocks are not identical:
a current bounded check put remote UTC approximately 1.0-1.25s ahead of local;
that is not a historical calibration. Cross-host times are not used to fabricate
sub-millisecond network or prompt-start latency.

- Runner startup was logged at remote `16:27:22.515508Z`, listening at
  `16:27:28.680895Z`, during the earlier smoke. Initial memory fitting offloaded
  **29/41 layers** to the GPU; this was not an all-GPU model.
- Request 10 released slot 0/task 1790 at `16:33:06.932289Z`, marking all slots
  idle. Its final `load_duration` was 1.507460ms. No intervening unload/reload,
  new runner or scheduler wait is logged. Devstral was already warm for request 11.
- The next runner operation, task **2095**, began at `16:33:07.357881Z` with
  8200 prompt tokens, cached prefix 8146; sampler initialization completed at
  `16:33:07.359149Z`. Exact prompt-evaluation/generation start is NOT RECORDED.
- The runner logged **100 generated tokens at `16:33:22.393652Z`**, then steady
  generation, reaching **786 at `16:35:06.731638Z`**, approximately 6.6 tokens/s.
  These are logged internal progress counts, **not final provider usage**.
  Generation, not a cold-load/queue/idle-engine stall, occupied this interval.
- The route logged HTTP 500 at `16:35:07.281462Z`, after local cancellation;
  `cancel task, id_task=2095` followed at `16:35:07.347691Z`, release at
  `16:35:07.501718Z`. No provider error was received by Clack. Do not reinterpret
  this post-cancellation server status as an independently preceding engine fault.
- No service warning/error, reload/offload adjustment or explicit memory-pressure
  event is logged for request 11. Graph-reallocation messages also occur during
  ordinary generation. Per-instant RAM/VRAM changes were not sampled throughout
  this request; the prior audit's during-run hardware observation remains valid.
- `/api/ps` succeeded at remote `16:33:07.140224Z`, `/api/version` at
  `16:33:07.955335Z`, and `/api/ps` at `16:33:08.122398Z`. The prior audit captured
  Devstral loaded at local `16:33:06.837Z`, after dispatch, not an invented
  immediately-before-dispatch `/api/ps` response.
- After cancellation, `/api/ps` and `/api/version` both returned 200 at remote
  `16:35:08.325396Z` / `16:35:08.510023Z`; later metadata remained responsive.
  The original SSH tunnel process (PID 21936, created before this mission) was
  still present during this audit. Contemporary model traffic and successful
  metadata support a live tunnel before/during/after the event, not a demonstrated
  tunnel outage or Clack HTTP send failure.

Internal runner generation without response delivery is consistent with
server-side buffering of structured tool output. The exact Ollama/parser buffer
stage and the cancelled partial content were not instrumented, so that narrower
mechanism is an inference, not a proven parser defect. Successful replay also
withheld its first frame until late generation. No trustworthy request-specific
protocol progress signal was available to Clack before its first headers/body.
`/api/ps` proves residency/health, not useful per-request generation. SSH runner
logs are diagnostic evidence, not a production progress signal; none was invented.

### Prior-request latency distribution

Seconds from native dispatch. Headers/body/total use native monotonic intervals;
structured-call timing uses the browser observer's millisecond wall timestamp
relative to native dispatch, not physical socket receive. The earlier reported
40.920s first useful call and 109.1s first write were mission-relative and do not
substitute for these first-byte intervals.

| Devstral request | Headers | First body | First structured call | Native total |
|---|---:|---:|---:|---:|
| 1 | 40.902 | 40.902 | 40.906 | 41.050 |
| 2 | 1.940 | 1.940 | 1.942 | 2.074 |
| 3 | 1.584 | 1.584 | 1.586 | 40.442 |
| 4 | 3.665 | 3.665 | 3.667 | 3.807 |
| 5 | 17.493 | 17.493 | 17.495 | 17.637 |
| 6 | 51.460 | 51.460 | 51.462 | 51.607 |
| 7 | 1.907 | 1.907 | 1.909 | 2.036 |
| 8 | 75.247 | 75.247 | 75.250 | 75.400 |
| 9 | 2.557 | 2.557 | 2.559 | 2.713 |
| 10 | 44.876 | 44.876 | 44.878 | 45.035 |

Devstral requests 1-10 were warm (the smoke loaded it). First-body range
**1.584071-75.247403s**, completed duration **2.035888-75.400232s**.
The existing cold smoke reported 7.325153s load, 8.978854s first body,
8.982s first tool and 9.104930s native completion on its much smaller prompt.

Existing-only Coder comparison:
`forgeboard-qwen3coder-poste56bbe5-01`, 23 requests, same 32768/2048, native
`think:false`, no new Coder inference. First-body range
**0.457890-23.057221s**, first structured-call range **1.383-23.065s**,
native total range **1.419689-23.075427s**. Its first cold mission request
reported 12.243572s load, 18.852741s first body, 20.116s first tool and
20.116267s native completion; later loads were approximately 0.9-14.8ms.
Different prompts/architectures/cache state limit causal comparisons. These
observed completed samples do not demonstrate a general need to raise 120s.

### Single diagnostic replay

Fresh evidence ID: **`devstral-latency-20261019-01`**, under
`src-tauri/target/`. Before dispatch, process inspection found no Clack acceptance
host, Cargo/rustc build or Clack test harness; remote read-only inspection found
only `ollama serve`, no runner, no recent inference logs, GPU idle, and `/api/ps`
empty. No unrelated process was terminated. The original tunnel, exact model
digest and Ollama version were verified without inference.

One disposable, non-production Node HTTP diagnostic sent the captured JSON
through that same tunnel. It has **no tool executor**, no Clack session/harness,
no cloud destination, no retry and no permanent production timeout bypass.
The one-shot evidence lock prevents accidental replay. It uses a diagnostic-only
600s absolute bound and bounded response/frame storage, without the product
120s guards or Node Fetch's implicit header deadline. Only the offline
reconstruction helper/tests are committed; the one-shot client remains in ignored
evidence. This is direct HTTP evidence, not a claimed native IPC replay.

The model had unloaded in the intervening idle period. Unlike historical request
11, the replay was **cold with zero cached prompt tokens**. It used no warmup,
load-only inference, setting change or altered keep-alive to hide that difference.

| Replay event | UTC / monotonic seconds after dispatch |
|---|---|
| Dispatch | `2026-10-19T17:17:07.517Z` / 0 |
| Local TCP connected / request written to Node transport | `17:17:07.520Z`; not a claimed remote receipt timestamp |
| Headers, HTTP 200 NDJSON | `17:18:21.712Z` / **74.194727s** |
| First body | `17:18:21.713Z` / **74.195507s** |
| First parsed frame / structured tool | `17:18:21.713Z` / **74.195664s** |
| Provider final frame | `17:18:21.858Z` / **74.340206s** |
| HTTP end | `17:18:21.878Z` / **74.361007s** |

Two valid frames, 1786 body bytes, zero malformed frames, `done_reason=stop`.
Provider-reported total duration **74.287229s**, load **3.686989s**, prompt
evaluation **12.743709s** / 8200 input tokens / 0 cached, generation
**57.816179s** / 386 output tokens. Ollama logs independently show runner task 0
on the same model/32768 context and those evaluation timings. No token total is
fabricated for the earlier cancelled request.

The returned call was `write_file` for `src/backend/data/data.ts` with structured
path/content arguments. **It was not executed**: zero executed tool calls/effects, no
ForgeBoard mutation/test/build/continuation/acceptance progress. Source hashes
of the original ForgeBoard files were identical before and after. `/api/ps`
responded during the replay at 30s and after completion; `/api/version` returned
200 after completion. No 120s or 600s diagnostic cancellation was required.

### Decision, verification and preservation

**No confirmed Clack defect; no semantic fix or timeout change.** This was a
normal original attempt intentionally subject to a documented pre-output guard.
The historical runner was active, while Clack had no usable protocol progress;
the sole replay completed well within 120s even with cold load/full prefill.
That does not prove the original could not have completed later, nor justify a
policy change from one unreproduced cancellation. It is not C (stuck engine),
D (demonstrated tunnel failure), E (unrelated pre-dispatch delay), or F
(unintended recovery-only control flow). B is not established by this replay.
Native overall 600s and native first/idle 120s/60s remain unchanged.

Daily usability remains **PROMISING BUT NOT YET**; **NO PREFERRED MODEL YET**.
Coder remains the strongest observed implementation reference, not a newly
promoted default. No ForgeBoard mission rerun, context increase, model download,
comparison ladder, Ollama/network configuration change or push occurred.

Verification: **104 focused tests passed**: 12 new offline diagnostic tests and
92 existing tests across `streamRecovery`, `providerRetry`, `proxyFetch`,
`ollamaStreamTrace` and `ollamaToolProtocol`. TypeScript passed. Both committed
scripts passed Node syntax and focused Biome lint via unchanged stdin projection
under the repository rules (scripts are outside normal Biome include paths).
The initial sandbox Vite run failed temp-cache rename before executing tests;
the identical focused suite passed outside the sandbox. No production source
changed, so full suites/build/Rust gates were not rerun under the requested
evidence-only policy. `git diff --check` passed (only existing CRLF notices).

Evidence retains the original native/IPC traces, reconstructed monotonic table,
historical and replay journals, controls/hash, bounded current clock observation,
raw replay NDJSON, result, Coder comparison and before/after project hashes.
Unrecorded preparation/timer/socket instants remain explicitly NOT RECORDED.
The original six unrelated dirty changes, IQ4_XS report insertion, delegation work,
safety stashes and autonomous_tracker/ remain untouched by this checkpoint.
Only this appended report section plus offline audit helper/tests are staged.

Evidence-only commit: **test(ai): classify devstral pre-output latency**.
No new mission or timeout-policy implementation is authorized by this result.

## Fresh Devstral acceptance after latency classification

### Baseline, scope and setup (2026-10-19)

Resumed from `1ef8fbe`, `main`, 59 ahead / 0 behind the recorded `origin/main`,
empty index. Six unrelated dirty paths and both safety stashes were preserved.
The prior investigation remains **A - INTERMITTENT ENGINE PRE-OUTPUT LATENCY /
NOT REPRODUCED** for its single diagnostic replay; its 74.361007s completion
is not rewritten as a timeout or as acceptance progress. Its earlier historical
mission remains CLACK-BLOCKED / PRE-OUTPUT RECOVERY DEADLINE / INCOMPLETE.

Exactly **one fresh inference mission** was authorized here. The user explicitly
selected the existing safe-approval-compatible workspace name
`C:/Users/Hayden/Documents/forgeboard-devstral-20261019-02` instead of the
initially requested `forgeboard-devstral-small2-...` prefix. This avoided editing
the dirty approval harness. Evidence ID remains
**`forgeboard-devstral-small2-20261019-02`**, under
`src-tauri/target/real-qwen-product/`. The fresh Git repository contained only
`.git`, with no seeded implementation or commits, before the task was sent.

Process inspection found no competing Clack acceptance host, Cargo/rustc build,
Clack test or harness. Read-only SSH inspection found only Ollama serve, no runner
or recent inference, and idle GPU. Metadata verified the existing tunnel and
installed model without inference. No model was pulled, updated or recreated.

One **pre-task harness setup failure** is retained, not hidden as a model failure:
`mission-a-1` was launched before configuring its isolated endpoint/profile.
The fixture initializes those records only in its configuration phase; the host
reported `[object Object]` with empty endpoint/profile arrays and exited normally.
It sent **zero inference, zero ForgeBoard messages and zero effects**. This was
an evaluator invocation/setup omission, not a confirmed production Clack defect.
The generated error string itself does not establish any more specific exception.

The existing `preflight` fixture was then invoked with **PREPARE_ONLY=1** solely
to initialize isolated endpoint/profile/permission metadata. Its saved report
proves **zero inference** and the workspace still contained only `.git` afterward.
This was not another structured-tool compatibility probe or smoke generation.
`mission-a-2` is the sole actual task/inference mission. No production code or
harness source was repaired to recover from the setup omission.

### Exact controls and single task

- Model: **`devstral-small-2:24b`**, digest
  `24277f07f62db8f9cb68e9dfc679ea1818a7fbac47a50eff0a701d3f645b63c8`.
  Mistral3 24.0B Q4_K_M; installed size 15,177,374,099 bytes; advertised context
  393216. Same already-installed artifact/template and default sampling settings.
- Existing native Ollama endpoint: `http://127.0.0.1:11435/api/chat`, through
  the unchanged localhost SSH tunnel; Ollama **0.40.5**. No service, listener,
  networking, firewall, template, keep-alive or global setting change.
- All 11 native payloads preserve **num_ctx=32768, num_predict=2048,
  stream=true**, no sampling override and **no `think` field**. Session reasoning
  is explicitly Automatic/model default; exact-model capability is unsupported.
  This is not described as equivalent to Coder's transmitted `think:false`.
- Fallback Never/effectively disabled: no fallback policy or destination is
  configured, so the production fallback owner returns no alternate request.
  Cloud inference **0**. All captured inference destinations
  are the authorized local endpoint, all captured models are exact Devstral.
- Shared SDK pre-output **120s**, native first-output **120s**, idle **60s**,
  overall **600s**, normal F1 selection, B1, receipts, compaction, retrieval,
  continuation and production approval responder remain unchanged. All requests
  exposed 16 production schemas (15,012 serialized schema bytes).
- The unchanged authoritative ForgeBoard specification was sent **exactly
  once**. Durable transcript contains one user message, SHA-256
  `f97ec34eefa136ac5be5847187f768b64bf5587d36140d9fcc53b695fa3e4801`.
  Normal production environment/shell context was prepended on the wire.
  No prior-run hints, reminder, manual Continue, correction help, task resend,
  delegation, evaluator implementation or mid-run setting change was supplied.

### Per-request latency and recurring terminal boundary

UTC dispatch below is the native trace immediately before reqwest send.
Headers, body, meaningful protocol progress and completion use native monotonic
deltas from that dispatch. IPC/parsed timestamps are browser-observed wall-clock
milliseconds relative to native dispatch, not socket timestamps. Their first
observations were equal for every completed request. No native/IPC trace events
or parsed frames were dropped and no malformed frames were recorded.

| Request | Dispatch UTC | Headers s | First body s | First IPC / parsed s | First meaningful s | Native duration s |
|---|---|---:|---:|---:|---:|---:|
| 1 | 17:40:44.580 | 59.130824 | 59.130989 | 59.141 | 59.140755 | 59.271120 |
| 2 | 17:41:44.397 | 2.064547 | 2.064651 | 2.067 | 2.064697 | 2.205189 |
| 3 | 17:41:52.854 | 1.597419 | 1.597525 | 1.599 | 1.597572 | 51.738360 |
| 4 | 17:42:45.021 | 44.768975 | 44.769098 | 44.771 | 44.769178 | 44.915717 |
| 5 | 17:43:30.153 | 31.286723 | 31.286836 | 31.289 | 31.286908 | 31.416660 |
| 6 | 17:44:01.799 | 2.070731 | 2.070844 | 2.073 | 2.070890 | 2.220537 |
| 7 | 17:44:04.090 | 48.576673 | 48.576776 | 48.578 | 48.576856 | 48.725503 |
| 8 | 17:44:52.989 | 48.891060 | 48.891175 | 48.893 | 48.891273 | 49.056922 |
| 9 | 17:45:42.620 | 52.323255 | 52.323366 | 52.325 | 52.323450 | 52.488443 |
| 10 | 17:46:35.303 | 35.088404 | 35.088548 | 35.090 | 35.088615 | 35.257520 |
| 11 | 17:47:10.820 | NONE | NONE | NONE | NONE | 119.978589, cancelled |

All dates are **2026-10-19**. First useful structured output was 59.154s after
the first recorded native IPC invocation. Request 3 demonstrates why total
duration is not interchangeable with first-byte/tool latency: its early directory
calls arrived before its later buffered file-write call.

Requests 1-10 completed with provider `done_reason=stop`; total provider-reported
output usage for those ten only is **2681 tokens**. Request 11 received **no
headers, body bytes, IPC chunks, parsed frames, finish event or final usage**.
Maximum successful pre-output/header latency was **59.130824s**; the final
no-output wait reached the production 120s ceiling instead of receiving output.

Request-11 native cancellation was observed at **17:49:10.798Z**, with session
error recorded at **17:49:10.800Z**: SDK `overall-deadline`, native `cancelled`.
Native monotonic dispatch-to-cancellation is **119.978589s**; exact SDK timer
callback time was not recorded. Runtime ownership is still
`providerRetry.ts::withProviderRetryTracking`,
`PROVIDER_RECOVERY_LIMITS.totalMs=120_000`, not the native 600s guard. This was
the original next-step request after a successful shared-types write, not a
retry or continuation. Elapsed first request to terminal error: **506.233s**.

The event therefore **recurred in a second fresh mission**, with a different
request payload, not an exact replay of the historical failed body. This does
not negate the earlier replay's before-120s result or estimate a population
failure rate from a small, non-random sample. No new diagnostic replay was sent.

### Engine/tunnel evidence at the recurrence

Passive snapshots retained model residency and responsive `/api/ps` and
`/api/version` during the wait (including approximately 93s into request 11)
and after cancellation. Saved native/IPC traces independently show zero response
delivery. No competing Clack source edit occurred during the live run.

Read-only Ollama journal correlation identifies warm runner slot 0/task **2706**:
8394 prompt tokens, 8292 cached prefix, 32768 context, sampler initialized at
remote **17:47:12.002799Z**. The runner logged steady generation around
6.5 tokens/s, reaching **760 generated tokens at 17:49:09.276284Z** before
cancellation. These are internal progress counters, not fabricated final usage.
No request-11 cold load, scheduler wait, reload, idle-engine stall or preceding
engine error is demonstrated. Initial run loading used 29/41 GPU-offloaded
layers; Devstral was warm by request 11.

Remote logs then show `/api/chat` 500 at **17:49:11.813577Z**, cancel task 2706
at **17:49:11.951469Z**, release at **17:49:12.109227Z**, followed by successful
`/api/ps` and `/api/version`. This post-client-cancellation 500 was not a provider
error received by Clack. Host clock skew and lack of shared request IDs prohibit
inventing precise cross-host network latency. Correlation uses consecutive
single-runner activity, model/context/prompt and time as in the prior audit.

Primary fresh-run classification: **ENGINE / DEVSTRAL PRE-OUTPUT RELIABILITY /
INCOMPLETE under unchanged production controls**. The runtime stop remains
Clack's documented pre-output guard. Repeated inability to deliver a first
protocol response within that guard is operational reliability evidence for this
engine/model/hardware combination, not proof of inability to implement the task,
an idle/stuck engine, a malformed hidden call or an unbounded model failure.
Internal structured-output buffering remains plausible, not a newly proven
parser bug. No new Clack defect or justification to change timeout was established.

### Tool behavior, writes and correction

| Tool | Calls | Success | Failure |
|---|---:|---:|---:|
| todo_write | 2 | 2 | 0 |
| bash_run | 1 | 1 | 0 |
| create_directory | 4 | 4 | 0 |
| write_file | 5 | 4 | 1 |
| read_file | 1 | 1 | 0 |
| edit | 1 | 1 | 0 |
| **Total** | **14** | **13** | **1** |

The only shell command was `npm init -y`, valid under the advertised native
PowerShell contract, exit 0. There was no model dependency install, test, build
or Git commit. Five confirmed file mutations comprise four successful write_file
calls and one edit; npm init additionally created the original root manifest.
The only failure was a read-before-write refusal for that manifest; Devstral
recovered with read_file then edit and continued without evaluator help.

No malformed textual tool intents, assistant prose, visible reasoning, empty
completed responses, premature prose stop, explicit approval requests/submissions,
continuations, delegation or effect replay occurred. The longest recorded gap
between received chunks was **46.304s**; no 60s stream-idle guard fired. There
was one terminal pre-output timeout, not a post-output stream stall.

Correction monitoring was **enabled** (`singleSpec=false`), unlike the adopted
first mission. It confirmed five writes, with the third at observer timestamp
**17:44:53.382Z**. Current authored code/current accepted plan never materially
contained page size 50: the shared pageSize type is not a numeric value, and
the original task specification alone is not implementation/accepted-plan evidence.
The full two-part correction boundary was **not reached**. The 50-to-25 message
was sent **zero times**, correctly; 25 retention is **UNTESTED**, not a pass.
No extra message was injected merely to exercise correction.

### Delivered files and independent verification

Final repository is unborn `master`, five untracked files, **3845 bytes total**:
root package.json (687), backend package.json (696), frontend package.json (770),
backend index.ts (1056), shared types.ts (636). Four directories were created.

The first confirmed tool file write completed between **119.995-120.440s**
after first IPC invocation. Backend index.ts arrived between
**350.522-350.717s**, shared types between **385.975-386.234s**. These are
provider-final/next-invocation bounds, not invented exact filesystem timestamps.
The backend file contains an Express listener at port 4317, in-memory arrays,
unused title-length helpers and an unregistered error handler. It has **no API
routes** and imports missing `./types` instead of the authored shared file.
This is backend scaffolding, not a substantive functional CRUD milestone.
There is no frontend source/component/entry HTML, only its manifest. Neither
substantive backend nor frontend acceptance was achieved.

Independent verification used a separate untouched copy at
`C:/Users/Hayden/Documents/forgeboard-devstral-audit-20261019-02`. No code,
dependency manifest, configuration or original workspace was repaired; no
dependencies were downloaded/installed by the evaluator. Original project
hashes remained identical after verification.

| Generated command, run on copy | Result |
|---|---|
| npm.cmd test | Exit 1: backend Jest not installed; no test source exists |
| npm.cmd run build:backend | Exit 1: tsc not installed; no tsconfig exists |
| npm.cmd run build:frontend | Exit 1: react-scripts not installed; no frontend entry/source exists |
| npm.cmd run start:backend | Exit 1: ts-node not installed; no server/API started |

These are as-delivered failures, not successful compilation/runtime tests after
an evaluator repair. Dependencies being absent does not prove the compiler
would reject every future implementation; missing routes/source/config are
separate inspected evidence of incompleteness. No app test or production build
was executed by the model and no independent functional test passed.

**NOT IMPLEMENTED:** project CRUD/open; task CRUD/view; combined filters/search;
API-enforced status/priority/tag/title validation and deterministic missing/error
responses; restart persistence; SSE mutation events; frontend behavior/loading/
error/empty/keyboard states; numeric page size 50 or 25; debounce 750ms; README;
runtime-data ignore rules. Status/priority unions and a 120-character helper are
present only as unused source, not verified API behavior. Port 4317 is present
in source only, not a successfully running endpoint. No browser/native manual
GUI or Linux/macOS Clack GUI acceptance is claimed. Windows native inference
host with remote Linux Ollama was exercised.

### Context integrity

All 11 requests passed native B1 with 16 normal F1-selected schemas. An offline,
network-disabled audit reconstructed every SDK request through the existing
planCompaction/ollamaBody path and asserted equality with its captured native
JSON. Only verified persisted/wire tool-result key order and parallel completion
order were restored; source content was not invented. Minimum estimated SDK
headroom: **10,257**. Minimum native headroom: **10,297**. Neither figure is a
safety margin or a provider token-usage measurement.

Verified-effect/history receipts: **0**, savings **0**. Automatic compaction,
extraction, retrieval and memory commits: **0**; durable memory revision remains
null, originals intact. No protected-budget/context stop occurred. There is no
evidence here requiring context-architecture debugging, larger context, receipt
changes or memory redesign. Those workstreams remain stopped.

### Existing Coder comparison and decision

Coder was **not invoked**. Latest saved reference is
`forgeboard-qwen3coder-poste56bbe5-01`; older substantive persistence/frontend
evidence remains qualified as recorded, not attributed to the latest run.

| Metric | qwen3-coder existing evidence | Fresh Devstral |
|---|---|---|
| Native tool protocol | Existing PASS | Prior PASS, no new smoke |
| Latest requests / calls / successful / failed | 23 / 22 / 21 / 1 | 11 / 14 / 13 / 1 |
| Successful file mutations | 12 latest; 18 in earlier sustained reference | 5 (four writes, one edit) |
| Backend / frontend | Earlier partial substantive implementation | Backend scaffold / frontend manifest only |
| Persistence | Demonstrated in earlier run; latest in-memory | NOT IMPLEMENTED |
| SSE | Incomplete | NOT IMPLEMENTED |
| Application tests / build | Incomplete / failed | No tests, as-delivered build commands fail |
| Premature prose stop | Observed in latest reference | None, runtime cancellation |
| Pre-output over 120s | Not observed in saved reference; first body max 23.057221s | Recurs at 119.978589s cancellation with no output |
| Latest context blocker / cloud inference | None / 0 | None / 0 |

**QWEN3-CODER PREFERRED, PROVISIONALLY**, for local coding on this tested hardware
at the existing 32768/2048 controls. This is a recommendation, **not a changed
Clack default/profile or proof of autonomous completion**. Coder remains clearly
the stronger observed implementation reference; Devstral now has repeated
pre-output reliability interruptions in its two fresh mission samples and has
not delivered stronger engineering. Confidence is **moderate for this relative
operational choice, low for general model superiority or complete delivery**.

Daily autonomous coding without babysitting: **PROMISING BUT NOT YET**. Coder's
own incomplete tests/build and premature stop remain disqualifying for a reliable
daily-autonomous claim. Exactly one recommended next step: **provisionally use
qwen3-coder for local coding at the unchanged current controls**. No further
model run, timeout tuning, larger-context trial or architecture checkpoint was
started in this pass.

### Verification and repository preservation

**200 focused tests passed**: 188 Vitest tests across acceptanceComparison,
acceptanceApprovalLifecycle, ollamaToolProtocol, ollamaStreamTrace, streamRecovery,
acceptance-approval and acceptance-correction; plus 12 Node latency-diagnostic
tests. An initial invocation mistakenly included the Vitest approval/correction
files under Node's test runner; the proper configured Vitest run passed, as did
the separate Node-only diagnostic run. No product test regression was repaired.
TypeScript, focused Biome lint on five harness/test files (zero diagnostics),
three harness script syntax checks and offline audit syntax passed.
`git diff --check` passed, apart from existing line-ending conversion notices.
No production source changed, so full frontend/build/Rust gates were not repeated
under the requested evidence-only policy. The existing native example was built
by the launcher; that is not a new Rust implementation or cross-platform gate.

All **1276 previously tracked files**, including the six dirty paths, stayed
byte-identical through the mission and offline project audit. Afterwards only
this explicitly requested report section was appended. Its original bytes and
unrelated IQ4_XS insertion remain preserved; the five other dirty files remain
byte-for-byte unchanged and unstaged. Both original safety stash identities
and autonomous_tracker/ remain untouched. Final process inspection found no
remaining acceptance host, launcher, Cargo/rustc build or Clack test run.

Evidence retains baseline/source hashes, process/remote metadata, failed pre-task
setup, zero-inference configuration, sole mission transcript, request/receive/IPC
traces, correction checkpoint, passive runner journals, offline SDK/native budgets,
file hashes, generated-command outputs and launcher exit records. All raw evidence
and the disposable audit scripts remain under ignored target storage.

Expected evidence-only commit: **test(ai): rerun devstral after latency audit**.
Only this report addition is staged. No push, production edit, deadline change,
model setting/template change, larger context, other model inference, download,
repeat/replay mission or subsequent checkpoint.

## 2026-10-19: broader local-agent comparison stopped at Muse control metadata

Base: **ed034cd test(ai): rerun devstral after latency audit**. Requested order:
Muse Glimmer, North Mini Code, then Nemotron 3.5 Lightning. The explicit
stop-on-new-Clack-defect rule fired at the first candidate. **The broader model
comparison is incomplete; no model-quality verdict was obtained for Muse.**

Classification: **PRODUCT / MIXED OLLAMA REASONING CONTROL METADATA /
PRE-INFERENCE BLOCKED**. This is neither ENGINE VERSION INCOMPATIBLE nor
ENGINE-BLOCKED / TOOL PROTOCOL: the engine accepts the artifact, but Clack rejects
its advertised controls before any native inference request can be dispatched.
Production code was deliberately not repaired during this benchmark checkpoint.

### Official artifact and installed engine

Only **muse-glimmer:30b** was downloaded, using the existing remote Ollama service
through the existing authorized infrastructure. Exact manifest / installed digest:
**de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1**.
Total installed size: **18,157,010,252 bytes** (18.157 GB decimal, approximately
16.91 GiB). The standard Linux GGUF artifact was chosen, not MLX or DFlash.

- Language weights: architecture **muse-glimmer**, **27.9B**, **Q4_K_M**;
  16,756,681,056 bytes, blob
  71b5c9c9abbc2a9e7c13550b6f9fe1f062650117a24490b15a310cbd7de03f8b.
- Vision projector: **clip**, advertised **1.92B**, **Q4_K_M**;
  1,400,328,928 bytes, blob
  f48b452316f9b213758e8659444029b961a24a07f99a1abb2a9f88b06f7c00c6.
- Native /api/show advertises **131072 context**, completion, tools, thinking,
  and vision. These are reported capabilities, not successful inference evidence.
- The official registry configuration requires **Ollama 0.32.8**. The installed
  client and service both report **0.40.5**, so no update was required or made.
- Hardware verified read-only: RTX 4060 Ti, 16380 MiB VRAM; 33,236,643,840 bytes
  RAM, 33,235,660,800 bytes swap. Before pull, available filesystem space was
  1,672,869,265,408 bytes. Partial GPU residency remained acceptable; no residency
  or performance result was measured because inference never began.

Primary artifact sources checked at execution time:
[official exact tag](https://ollama.com/library/muse-glimmer:30b),
[official language-weight metadata](https://ollama.com/library/muse-glimmer:30b/blobs/71b5c9c9abbc),
[official manifest](https://registry.ollama.ai/v2/library/muse-glimmer/manifests/30b),
[official configuration](https://registry.ollama.ai/v2/library/muse-glimmer/blobs/sha256:57b82200bf7c0d7d7051c1349e584f193db42799c74529a96c83addd0fa80147).
The model card's recommended latest engine and reasoning labels are not a
substitute for the exact installed runtime contract below.

### Isolation, preparation and chronology

Fresh workspace: **C:/Users/Hayden/Documents/forgeboard-muse-glimmer-20261019-01**.
Fresh evidence ID: **forgeboard-muse-glimmer-20261019-01**, under
src-tauri/target/real-qwen-product/. Shared audit evidence ID:
**current-model-shootout-20261019** in the same ignored parent.

No other Clack host, Cargo/rustc, Vite test or acceptance launcher was active at
the isolation checks. Unrelated Codex/other application processes and the existing
SSH tunnel were left alone. Each live phase additionally hashed all tracked
source files before/after and found **zero changes during the phase**.

Chronology, UTC:

1. **18:08:46**: saved HEAD, the six pre-existing dirty files, their full bytes,
   diff and both safety-stash identities; began the single Muse download after
   verifying official compatibility. All seven existing model tags/digests were
   preserved in the before inventory.
2. A metadata-only preparation was inadvertently attempted before the pull
   completed. It failed closed: "Refresh this Ollama model's metadata before
   requesting a runtime context. No inference was sent." This is a preparation
   sequencing error, not a model failure or ForgeBoard attempt. Its evidence was
   preserved, not overwritten.
3. **18:13:17**: Ollama completed its verified pull and wrote the new manifest.
   **18:13:20**: /api/show and installed inventory confirmed exact artifact bytes,
   digest, capabilities and actual thinking values.
4. **18:13:36-18:13:42**: metadata-only preflight attempt 2 passed. Normal Clack
   configuration reported working context **32768**, output/reserve **2048**,
   zero inference destinations, no messages, no todos and no memory revision.
5. **18:13:52-18:13:57**: the sole harmless native tool-smoke setup requested
   **None**, which the exact engine advertises as boolean false. It stopped
   before dispatch. Native host 43020 exited code 0; the launcher failed its
   assertion that one request should have been captured because it captured zero.
6. Offline diagnosis using the unchanged production resolver and session-setting
   API reproduced the exact mixed-control rejection. The entire comparison was
   stopped. No direct provider bypass, second smoke, mission or later download.

The configured fallback was Never, with no cloud destination. No outgoing
num_ctx/num_predict/think payload exists: configuration evidence must not be
presented as serialized inference evidence. All production deadlines remained
unchanged, including the 120s pre-output guard and 600s overall native deadline.

### Concrete Clack defect and evidence limits

The installed engine's exact /api/show response is:

```json
{"thinking":{"values":[false,"low","medium","high","max"],"default":"high"}}
```

The native metadata probe correctly preserves this array as scoped, reported
**probe.thinkingControls** evidence. However,
**src/modules/ai/lib/reasoningEffort.ts**, effortCapability's Ollama branch,
accepts either an all-boolean list or an all-string list and returns unknown for
the valid mixed list. It therefore produces **status: unknown, levels: []**.
The normal **setSessionEffort** API in
**src/modules/ai/store/reasoningEffort.ts** rejects both None and Low with:
"This effort is not supported by the selected model and API."

The offline diagnostic used the exact persisted native profile, model, endpoint,
configuration revision and evidence timestamps. Its clock was pinned to one
millisecond after observation, inside the normal 30-second freshness window,
with fetch disabled and zero network attempts. Three resolver repetitions gave
the same result. The actual production session-setting function rejected both
choices. In-memory diagnostic controls containing only [false] or only the named
levels were supported, isolating mixed-type handling rather than evidence age,
transport identity or generic lack of Muse support. These diagnostic variants
were never persisted or sent to Ollama.

Evidence: **muse-after.json**, **muse-final.json**, **muse-control-defect.json**,
**reproduce-muse-controls.mjs**, isolated native settings and source-freeze records.
The smoke launcher's assertion ran before it saved the native failure report,
so **system-preflight-1.failure.json** retains the outer 0 != 1 assertion, not
the inner session error. The latter is independently reproduced offline; it is
not claimed to have been captured from a live inference response. No request or
receive JSONL was created. The preflight's harmless WebView cleanup warning also
appeared on its successful zero-inference phase and is not the diagnosed cause.

### Candidate outcomes and comparison

| Metric | qwen3-coder:30b, saved reference | Muse Glimmer | North Mini Code | Nemotron 3.5 Lightning |
|---|---|---|---|---|
| Download this checkpoint | No rerun/download | muse-glimmer:30b, 18,157,010,252 bytes | Not downloaded | Not downloaded |
| Engine compatibility | Previously exercised | 0.40.5 exceeds artifact minimum 0.32.8 | Not evaluated | Not evaluated |
| Native tool smoke | PASS, prior evidence | BLOCKED before inference, not a protocol verdict | Not run | Not run |
| Mission requests / structured calls | 23 / 22, latest reference | 0 / 0 | Not run | Not run |
| Successful mutations / failed tools | 12 / 1 | 0 / 0 | Not run | Not run |
| Recovery quality | Partial, prior failures recovered | Unmeasured | Unmeasured | Unmeasured |
| Backend / frontend | Partial substantive implementation | Not attempted | Not attempted | Not attempted |
| Persistence | Demonstrated earlier; latest in-memory | Not attempted | Not attempted | Not attempted |
| SSE | Incomplete | Not attempted | Not attempted | Not attempted |
| Application tests / build | Incomplete / failed | None executed, no application files | Not attempted | Not attempted |
| Premature prose stop | Observed | Unmeasured | Unmeasured | Unmeasured |
| Engine stall | Not observed above 120s in saved reference | No inference, unmeasured | Unmeasured | Unmeasured |
| Context blocker | None in latest reference | No context block after metadata preparation; reasoning-control block | Unmeasured | Unmeasured |
| Final class | MODEL-INCOMPLETE | PRODUCT / METADATA / PRE-INFERENCE BLOCKED | NOT RUN: mandatory stop | NOT RUN: mandatory stop |

For Muse, first response/tool/write/backend/frontend times are **N/A**, not zero
latency. Tool successes/failures, file mutations, malformed intents, model prose
stops, empty model responses, continuations, approvals and correction sends are
all **0 because no inference occurred**. The workspace remains exactly **.git**.
The ForgeBoard specification was sent **zero times**; no evaluator implementation
or repair was made. Page-size correction, tests/build, persistence, SSE, CRUD,
search/filters, accessibility, README, ignore behavior and all numeric canaries
cannot be assessed without an application. No independent application copy was
needed or created for this empty workspace.

No measured request headroom, receipts/savings, compaction, extraction or retrieval
exists for this candidate; these are **N/A**, not evidence of context efficiency.
No production memory/context mechanism, F1 reduction, continuation, receipt,
approval policy, tool template or deadline was changed or bypassed.

North's and Nemotron's official catalog pages were inspected only. They were not
pulled, assigned an evaluated artifact digest, smoke-tested or ranked. Their
minimum-engine compatibility remains unverified. No all-three download occurred.
**qwen3-coder-next was not downloaded**; the approximately 52 GB Q4_K_M class is
excluded by the requested hardware/storage comparison policy. No prior candidate
was rerun. Devstral's two observed pre-output interruptions remain separate saved
evidence, not new trials in this comparison.

**Ranking:** qwen3-coder remains the strongest previously tested implementation
reference; Devstral is retired from active comparison for now. Muse, North and
Nemotron are **unranked**, not inferior, because no valid new mission exists.
**No new preferred model can be selected from this incomplete broader comparison.**
The previous provisional qwen3-coder preference is not upgraded to daily
autonomous readiness: **PROMISING BUT NOT YET** still applies.

Next recommendation: separately fix and verify the exact mixed boolean/named
reasoning-control compatibility defect, preserving native false semantics,
freshness and authorization, then resume the sequential smoke/mission comparison
with explicit authorization. Do not substitute Automatic to hide this failure.
Whether qwen-specific continuation work is warranted remains **deferred until
the broader comparison is valid**. Context calibration is **not next**; no
48K/64K experiment or timeout adjustment was made.

### Verification and preservation

- Final focused verification: **149 tests passed / 7 files**: acceptanceComparison,
  installedModelComparison, acceptanceApprovalLifecycle, ollamaToolProtocol,
  reasoningEffort, acceptance-approval and acceptance-correction. These include
  exact Muse fixture authorization, unchanged path/secret approval denials, native
  structured-call serialization, non-execution and rejection of textual markup.
  Unit fixture success is not claimed as a live Muse native-tool PASS.
- TypeScript passed. Full lint passed at **71 warnings / 2 informational notices**;
  focused lint on the three touched TS/TSX test files had zero diagnostics.
- Production build passed with existing dynamic-import/plugin-timing warnings.
  Rust formatting and strict all-targets locked Clippy passed, using the existing
  isolated target/codex-test directory. The native example built and launched.
- The single full frontend gate was **not green**: **2979 passed / 2 failed**,
  with **206 passed / 5 failed test files**. One failure was a literal fixture
  assertion affected by a temporary, unused harness-only Low option. That option
  was removed; its affected test passes in the final focused run. Remaining
  failures are discovery of an old saved acceptanceComparison source under
  ignored target storage, two old generated ForgeBoard tests missing supertest,
  and a Node-only latency test incorrectly collected by Vitest as an empty suite.
  Those evidence files/test discovery were not changed or deleted. No second
  full frontend run is claimed after the focused correction.
- Full Rust gate: **605 passed / 1 failed**. Unmodified
  d1_cancellation_timeout_and_revocation_prevent_or_interrupt_work expected
  tool-revoked but received timed-out at tests.rs:758. Its single-test rerun also
  failed (0 passed / 1 failed / 605 filtered out). No production/test assertion
  was changed to suppress it, and no clean full-Rust claim is made.
- Initial sandbox Vitest launch failed before executing tests on a Vite temporary
  file rename; the authorized unsandboxed focused runs passed. An initial offline
  diagnostic expected the wrong fail-closed error wording; only that disposable
  diagnostic expectation was corrected. Neither was a model trial or product fix.
- Final diff check passed apart from existing CRLF conversion notices. No Computer
  Use, native GUI interaction, Linux/macOS GUI or real model inference verification
  is claimed. Read-only Ollama health/inventory remained available; no acceptance,
  build, test or launcher process remained after checks.

All seven original installed tags and digests are unchanged; only Muse was added.
No model deletion/overwrite/re-import, engine update, service/network/firewall
change or cloud inference occurred. Existing unrelated processes were preserved.
Production source changes: **0**. Test-only changes authorize the exact Muse tag
and disposable root and add serialization/approval tests; no production policy
or architecture changed. The six original dirty-file edits, including IQ4_XS
additions, remain preserved and excluded from the candidate commit. Both safety
stashes and autonomous_tracker/ remain untouched. Only this report addition and
the narrowly related acceptance-fixture/test changes are included.

Evidence commit: **test(ai): evaluate muse glimmer local agent**. The candidate is
documented as blocked, not completed acceptance. **No push. No North/Nemotron
evaluation, qwen-specific fix, context calibration or subsequent checkpoint.**

## Mixed reasoning-control compatibility fix

Base: **5400956 test(ai): evaluate muse glimmer local agent**. This is an offline
production compatibility checkpoint, not a resumed model evaluation. The prior
Muse acceptance result remains **pre-inference blocked at that committed base**;
the fix below has not yet been exercised against the live model.

### Reproduction and owner chain

Existing captured native /api/show metadata for **muse-glimmer:30b**, digest
**de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1**, contains:

```json
{"thinking":{"values":[false,"low","medium","high","max"],"default":"high"}}
```

The capture was read locally from the previous checkpoint's evidence. Neither
metadata nor inference was requested from Ollama in this checkpoint. A saved-model
fixture reproduced the original **unknown** capability and normal session
validation's rejection of None and Low before the production change. Automatic
was already accepted without an override; it was not the compatibility defect.

| Ownership | Exact file and function/type |
|---|---|
| Native metadata parsing | src-tauri/src/modules/inference_probe/metadata.rs: **ollama_show** preserves scoped probe.thinkingControls evidence as JSON, including mixed primitive types. Its production parser is unchanged. |
| Capability normalization | src/modules/ai/lib/reasoningEffort.ts: **effortCapability**, specifically the Ollama backend branch. This was the root rejection owner. |
| Internal representation and captured identity | Same file: **EffortCapability**, **EffortCapture**, **captureEffort**, **sameEffortContract**; existing version-1 session effort preferences remain the persistence format. |
| Session selection/validation | src/modules/ai/store/reasoningEffort.ts: **sessionEffort**, **setSessionEffort**; existing locks, supported-choice checks and persistence flow are unchanged. |
| Native persistence boundary | src-tauri/src/modules/conversation_memory/reasoning_effort.rs: **updated**, **conversation_effort_set**; existing authorization, idle/CAS checks, atomic writes and revision ownership remain unchanged. |
| UI option derivation | src/modules/ai/components/EffortControl.tsx: **SessionEffortControl** maps capability.levels through the existing **effortLabel**. No UI production code or styling changed. |
| Request validation and native serialization | src/modules/ai/lib/requestPreflight.ts: **createRequestPreflight** retains admission/refresh checks; src/modules/ai/lib/reasoningEffort.ts: **effortProviderOptions** supplies controls; src/modules/ai/lib/ollamaModel.ts: **ollamaBody** retains exact think value/omission. Preflight and adapter production code are unchanged. |

Previously the Ollama branch required the complete array to be either all
booleans or all strings, rejecting a valid heterogeneous array. It also rejected
duplicate entries. The fix is in the **Ollama-specific adaptation**, not a relaxed
generic/provider schema or a Muse-name special case.

### Normalization and exact semantics

Each structurally valid entry is considered independently against existing
representable Clack efforts. Recognition is exact and case-sensitive; there is
no lowercasing, trimming, model-name inference or aliasing of unknown names.

- **false -> none / None -> native false**. Disabled reasoning never becomes
  Automatic and is not discarded because other values are strings.
- **true -> on / On -> native true**. Generic enabled reasoning is not Low,
  Medium or High. On already had frontend identity/label and boolean serialization,
  but was missing from native persistence's finite choice allowlist. This checkpoint
  adds that single existing choice there and tests its persistence.
- **low, medium, high** retain their existing product identities and exact native
  strings. Existing representable minimal/xhigh values are also metadata-driven.
- **max** is already first-class: product identity max, label **Maximum**, native
  persistence accepts max. It is exposed and serialized literally as **"max"**,
  never silently mapped to high.
- **Automatic** remains independent of the advertised array: no saved explicit
  preference and **no outgoing think field**. No default reasoning level is forced.
- Unknown bounded future names are not selectable or serialized. Their original
  reported source metadata stays intact. For **[false,"low","future_level"]**,
  None and Low remain supported. Adding only an unknown name does not change the
  effective recognized revision or invalidate an in-flight supported control.
- Duplicate entries normalize to one option in stable product order, independent
  of provider ordering. Boolean aliases take deterministic precedence when both
  false and "none", or true and "on", are advertised. A legacy string-only
  "none"/"on" contract still sends strings, not invented booleans.
- Existing metadata bounds remain: 1-16 entries, boolean or nonempty strings up to
  32 characters. Control characters, nested arrays, objects, numbers, null entries,
  malformed top-level structures and invalid JSON fail closed to unknown. An
  all-unrecognized list remains unknown, not a fabricated no-thinking contract.
  Conflicting evidence records still fail closed; duplicate entries inside one
  valid list are distinct from conflicting source records.

All-boolean and all-named effective contracts keep their existing mappings.
Heterogeneous effective contracts use the additive **ollama-mixed** mapping with
a bounded **ollamaControls** record retaining the exact wire value for each
normalized choice. The canonical wire map participates in revision identity and
same-contract validation. Scope, freshness and the 30-second metadata TTL are
unchanged. Changed boolean/string wire meaning is rejected at admission even
when visible level names are identical. Missing/tampered mixed mappings fail
closed instead of guessing a boolean or default.

Exact normalized Muse capability, omitting only its existing revision/timestamp
and evidence-description fields:

```json
{
  "status": "supported",
  "levels": ["none", "low", "medium", "high", "max"],
  "mapping": "ollama-mixed",
  "ollamaControls": {
    "none": false,
    "low": "low",
    "medium": "medium",
    "high": "high",
    "max": "max"
  }
}
```

### Offline session-to-request verification

| User option | Normalized session choice | Native Ollama field |
|---|---|---|
| Automatic | automatic | think omitted |
| None | none | think: false |
| Low | low | think: "low" |
| Medium | medium | think: "medium" |
| High | high | think: "high" |
| Maximum | max | think: "max" |
| On, only when true is advertised | on | think: true |

None, Low, Medium, High, Maximum and Automatic are accepted through the normal
session setter with mocked native persistence; restored session choices serialize
through the unchanged native body builder. On is not offered for this Muse
capture because it does not advertise true. Explicit future_level, LOW and
unadvertised On are rejected before native persistence. The native adapter and
production admission path are independently exercised with intercepted IPC and
network fetch forbidden. No live provider response is simulated as real evidence.

The unchanged UI component was rendered statically with its popover content
exposed by a test wrapper: Automatic, None, Low, Medium, High and Maximum appear
in order, known choices remain enabled, duplicates/future names are absent,
boolean-only true is labeled On, and malformed metadata remains disabled and
unverified. This is automated component evidence, not native GUI interaction.

### Tests and final gates

Focused frontend: **242 passed across 8 files**:
reasoningEffortOllama, reasoningEffort, reasoningEffortHosted,
reasoningEffortRequests, store/reasoningEffort, ollamaRouting, ollamaModel and
EffortControl. The matrix covers homogeneous/heterogeneous controls, false/true,
Max, future names, deterministic order/duplicates, malformed structures/JSON,
normal session acceptance/rejection, Automatic, native serialization, TTL/scope,
changed-wire admission rejection, unchanged-wire future-name admission, old
Ollama formats, and unchanged compatible/cloud provider contracts.

Focused Windows Rust: **7 effort-persistence tests passed**, plus **8 Ollama
metadata tests passed**. The new parser fixtures prove mixed/future values retain
their original native evidence and malformed entries are rejected without changing
the native production parser. The additional native effort test proves generic
On persistence without inventing a named effort.

The final suite gates were run once after stabilization; diff checks were also
repeated for the documentation and staging review:

| Gate | Actual result |
|---|---|
| npm.cmd run check-types | PASS |
| npm.cmd run lint | PASS, unchanged 71 warnings / 2 informational notices; focused touched-file lint had zero diagnostics |
| npm.cmd test | **3036 passed / 1 failed**, 209 passed / 4 failed test files; only the preserved failures described below |
| npm.cmd run build | PASS, existing dynamic-import/plugin-timing warnings |
| git diff --check | PASS, existing CRLF conversion notices only |
| cargo fmt --check | PASS |
| cargo clippy --all-targets --locked --target-dir target/codex-test -- -D warnings | PASS |
| cargo test --locked --target-dir target/codex-test | **608 passed / 1 failed** in the library suite; subsequent integration binaries were not reached by this full command |

Known preserved failures, not new checkpoint regressions:

- Vitest collects the old saved **before-src--test--acceptanceComparison.test.ts**
  under ignored target/installed-local-models-20261019-01; its literal old model
  allowlist assertion differs from the preserved working harness.
- Two source/dist test collections from an old generated ForgeBoard project lack
  **supertest**. Its source, dependencies and retained evidence were not repaired.
- The existing Node-only **audit-devstral-latency.test.mjs** is incorrectly
  collected by Vitest as an empty suite. No test-discovery change was made here.
- The same previously recorded, unchanged Rust
  **d1_cancellation_timeout_and_revocation_prevent_or_interrupt_work** still
  expects tool-revoked but receives timed-out at custom_tools/execution/tests.rs:758.
  Neither that implementation nor its assertion was touched. No all-green global
  frontend or Rust claim is made, and no repeated full-suite gate was run.

Detailed gate logs and the pre-edit preservation baseline are retained under
**src-tauri/target/real-qwen-product/mixed-reasoning-controls-20261019/**.

### Scope and handoff

Production files changed: **src/modules/ai/lib/reasoningEffort.ts** and
**src-tauri/src/modules/conversation_memory/reasoning_effort.rs** only. Other
changes are focused tests/fixtures and this report appendix. No second reasoning
resolver, provider-wide schema relaxation, new UI control, model-specific branch,
database, session-store migration or context mechanism was introduced.

**Muse was NOT invoked.** No structured-tool smoke, /api/chat probe, ForgeBoard
run, Qwen run, North/Nemotron download/run, or other real AI inference occurred.
Ollama was not contacted or altered. No model prompt, context size/architecture,
timeout, fallback, tool authorization, memory, retrieval or scheduler behavior
was changed. No Computer Use/native GUI acceptance was performed. Automated
Rust execution was Windows-only; Linux/macOS native verification is not claimed.

The six original unrelated dirty paths and edits remain preserved and unstaged;
both safety stashes and autonomous_tracker/ remain untouched. Only checkpoint
implementation, tests and this appendix are included in the scoped commit.

Commit: **fix(ai): support mixed reasoning controls**. **No push. STOP here.**
The next checkpoint may perform the separately authorized live Muse smoke and,
only if it passes, its fresh ForgeBoard acceptance. None of that work was started.

## Muse Glimmer live evaluation after reasoning compatibility fix

### Scope, isolation and controls

Evaluation date: **2026-10-19**, from **4d1c70b**, main, initially 62 ahead / 0
behind cached origin/main, empty index. The six existing dirty paths were saved
byte-for-byte before work. Both safety stashes and autonomous_tracker/ were left
alone. Process inspection found no competing Clack acceptance host, Cargo/rustc,
Clack Vite/test runner or model evaluation. The existing localhost tunnel was
reachable; /api/ps was initially empty. No other model was invoked.

The installed artifact matched **muse-glimmer:30b**, digest
**de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1**,
Q4_K_M, **18,157,010,252 bytes**, Ollama **0.40.5**. Native metadata advertised
**[false, "low", "medium", "high", "max"]**. No model download, Ollama service
change, template change, tuning ladder, context calibration or timeout change
occurred. Ordinary npm dependencies were installed only in an independent audit
copy after the mission ended, not as evaluator implementation assistance.

Fresh workspace: **C:/Users/Hayden/Documents/forgeboard-muse-glimmer-20261019-02**.
Evidence/run ID: **forgeboard-muse-glimmer-20261019-02**, under
**src-tauri/target/real-qwen-product/**. Suffix 01 belonged to the earlier blocked,
zero-inference attempt and was not reused. The new workspace began with only an
empty Git repository. No application implementation was seeded.

All **16 inference requests** (one smoke plus 15 mission requests) used the normal
production native Ollama /api/chat adapter, exact model, **num_ctx=32768**,
**num_predict=2048**, **think:"low"**, fallback Never, **zero cloud inference**.
The mission initially exposed the normal 16 production tools, including native
shell tools, with the existing F1, permission, effect and context mechanisms.
Its normal trusted-workspace test profile was preserved; no approval bypass was
added. No approval-requested/submitted event arose in this mission, so live
approval recovery was not exercised. Existing automated approval coverage passed.

Production source was frozen. Before/after tracked-file hashes for preparation,
smoke and mission all matched. Only test-harness support for Low was added: the
existing reasoning selector flows through production resolution, a native-host
test guard records and rejects an unexpected think/output value before dispatch,
and the runner preserves its native report before terminal assertions. There is
no Muse-specific production branch. The original six dirty-file changes are
excluded from this checkpoint commit.

### Structured smoke

Exactly one harmless smoke request was dispatched at **20:50:42.591Z** with
get_test_value(value: string). Muse returned the provider-native structured call
**get_test_value({"value":"protocol-check"})**, SDK finish **tool-calls**, native
done_reason **stop**, no answer prose. **PASS**. The tool was **not executed**
(execution count zero); textual tool intent was never interpreted as a call.
Provider usage: **408 input / 94 output tokens**. Engine total duration was
**32.115694 s**, including **21.831022 s** load. No reasoning-validation failure.
Preparation before this smoke was metadata-only and sent zero inference.

### Fresh mission chronology and tool behavior

The complete unchanged ForgeBoard specification was sent **once**, with SHA-256
**f97ec34eefa136ac5be5847187f768b64bf5587d36140d9fcc53b695fa3e4801**.
The persisted transcript contains one user message. No reminder, manual Continue,
requirement resend, recovery retry or evaluator implementation was supplied.

First native request capture: **20:52:06.194Z**; native dispatch **20:52:06.210Z**.
First parsed response was **20:52:14.838Z**. First native structured-tool frame
arrived **59.201 s** after native dispatch; SDK tool availability was **59.444 s**
after capture. Muse created a nine-step plan, inspected the empty workspace,
created backend/frontend directories and then backend src/data directories.

| Confirmed file write | Provider finish / next request bound (UTC) | Elapsed since first capture |
|---|---|---:|
| backend/package.json | 20:54:57.870 / 20:54:58.028 | 171.676-171.834 s |
| backend/tsconfig.json | 20:55:16.862 / 20:55:16.963 | 190.668-190.769 s |
| backend/data/store.json | 20:55:44.814 / 20:55:44.902 | 218.620-218.708 s |
| backend/src/types.ts | 20:56:12.586 / 20:56:12.756 | 246.392-246.562 s |
| backend/src/store.ts | 20:56:43.065 / 20:56:43.197 | 276.871-277.003 s |
| backend/src/validation.ts | 20:57:37.277 / 20:57:37.425 | 331.083-331.231 s |
| backend/src/sse.ts | 20:58:08.233 / 20:58:08.374 | 362.039-362.180 s |

The first file-write success receipt was at **20:54:57.973Z**, **171.779 s** after
first capture. Directory creation succeeded earlier but is not counted as a file
mutation or substantive application implementation. types.ts is a data model;
store.ts is a partial persistence helper, validation.ts contains real schemas,
and sse.ts is a partial broadcaster. There was **no substantive API/server or
frontend**, model-authored test, successful model test or model production build.

Totals: **15 mission requests**, **14 completed engine responses**, **14 native
structured calls**, **14 successful tools / 0 failed**, **7 verified file writes**,
**4 directory creates**, **2 todo_write**, **1 list_directory**. There were zero
shell calls, malformed textual intents, completed empty responses, premature
answer-prose stops, automatic continuations or pre-output timeouts. No first shell
command exists, so advertised PowerShell syntax compliance was **not exercised**.
Natural tool-failure diagnosis/recovery was **not exercised**, not a pass or fail.
All completed responses produced structured tools, not claimed completion.
The retained assistant reasoning totals **1,361 characters**; the last partial
reasoning is **Now services**. Final plan failures are runtime terminalization,
not model-authored assertions that those implementation steps were completed.

### Terminal stream boundary and latency

Request 15 dispatched at **20:58:08.396Z**, received HTTP 200 plus its first body
at **20:58:09.689Z**, and delivered two reasoning frames (304 bytes total). Its
last reqwest body delivery was **20:58:09.793Z**. No subsequent body bytes arrived.
At **20:59:09.796Z**, **60.003 s** after the last native body delivery, the existing
60-second idle guard fired; session failure was recorded at **20:59:09.804Z**.
Total mission capture-to-failure: **423.610 s**. The native host remained alive
to persist the report and exited cleanly with code 0. No 90-minute harness bound,
120-second first-output guard or 600-second request deadline was reached.

Classification: **UPSTREAM STREAM STALL / NATIVE STREAM-IDLE DEADLINE / INCOMPLETE**.
The reqwest delivery and IPC traces agree: the two received frames were forwarded
promptly, with no dropped events, then input stopped. No confirmed Clack reasoning,
context, approval, guidance or transport defect was established. This is an
observed upstream-delivery stall under unchanged production controls, **not proof
of an internal Muse engine crash**. Model, Ollama, remote-host and tunnel ownership
of the silence remain unconfirmed. No server-side logs were invented. No final
engine finish/usage arrived for request 15; its generated-token count is unknown.
The **3,294 output tokens** returned across requests 1-14 are completed-only usage,
not an inferred total for the interrupted request or whole mission.

All times below are milliseconds from each native dispatch. Parsed frame times
and absolute dispatch timestamps are retained in audit.json. Completion is native
EOF for requests 1-14; request 15 has no engine finish or EOF.

| Request | Headers | First body | First structured frame | Completion |
|---|---:|---:|---:|---:|
| 1 | 8625.282 | 8625.482 | 59201 | 59220.312 |
| 2 | 1278.353 | 1278.505 | 8355 | 8355.495 |
| 3 | 977.679 | 977.799 | 19407 | 19406.736 |
| 4 | 7202.560 | 7202.684 | 7205 | 7227.065 |
| 5 | 935.460 | 935.661 | 46609 | 46609.389 |
| 6 | 2341.266 | 2341.375 | 30058 | 30077.706 |
| 7 | 845.961 | 846.092 | 18800 | 18819.555 |
| 8 | 1168.071 | 1168.224 | 8593 | 8595.973 |
| 9 | 879.041 | 879.147 | 8362 | 8363.003 |
| 10 | 901.655 | 901.763 | 10520 | 10518.738 |
| 11 | 974.272 | 974.385 | 27637 | 27664.005 |
| 12 | 905.574 | 905.690 | 30290 | 30290.694 |
| 13 | 987.269 | 987.381 | 54060 | 54060.496 |
| 14 | 1048.682 | 1048.797 | 30789 | 30789.026 |
| 15 | 1293.791 | 1293.904 | none | idle timeout at 61400.271 |

IPC frame wall-clock measurements and native monotonic EOF measurements can
differ by a few milliseconds; the table preserves their actual observation
boundaries rather than asserting ordering at sub-millisecond precision.

### Correction, context and memory

Seven confirmed successful file writes exceeded the correction's three-write
threshold. However, page size **50 never materially entered current code or the
accepted structured plan**, so the second required condition was false. The
syntax-aware detector correctly remained **pending**. The original user spec was
not mistaken for an accepted plan; max(500) was not mistaken for page size 50.
**No correction was sent; retention of 25 was not exercised.**

Every captured request retained **think:"low"**, context 32768 and output 2048.
The stored Low preference and supported contract remained unchanged. The old
expiry timestamp in the immutable active-run capture is not itself stale-request
evidence: the production request preflight revalidates that same native contract.
No reasoning rejection or unexpected omission/change occurred.

Exact SDK history reconstruction, including tool-result JSON order, normal
environment text and production preparation, reproduced **all 15 captured native
bodies**. Minimum measured headroom: **SDK 8,996 / native 9,916 estimated tokens**.
No protected-budget failure. **Zero verified-effect receipt compactions / zero
receipt token savings**, zero rolling compaction, extraction, retrieval or durable
memory revisions. The original transcript remains source-linked and intact; the
final memory revision/revisionId are null. F1/context policy was not changed to
make this fit. This short run did not exercise long-conversation memory pressure.

### Independent application audit

All seven generated files were inventoried and hashed, then copied without source
repairs to **C:/Users/Hayden/Documents/forgeboard-muse-audit-20261019-02**, outside
Clack's ancestor dependency tree. Both copies' original source hashes still match.
After inspecting the manifest, the evaluator installed its declared dependencies
with lifecycle scripts disabled and no lockfile rewrite. Actual results:

| Command in independent backend copy | Result |
|---|---|
| npm.cmd install --ignore-scripts --package-lock=false --audit=false --fund=false | PASS; 132 npm packages, no model download |
| npm.cmd test | FAIL, exit 1: no test files found |
| npm.cmd run build | PASS, exit 0: tsc compiled four helpers only |
| npm.cmd start | FAIL, exit 1: dist/server.js does not exist |
| Evaluator compiled-schema probe | PASS: title 120 accepted, 121 rejected, empty task update rejected |

The schema probe is **not** a model-authored test or API verification. A successful
helper compilation is **not** a completed production application build.

| Requirement | Independent outcome |
|---|---|
| Project/task CRUD, open/view, combined filters/search, deterministic HTTP errors, port 4317 | **NOT IMPLEMENTED**: no server or routes |
| Task fields/status/priority/tags/timestamps | Interfaces and schemas present; no functional task API/UI |
| Backend validation | Partial schemas including title max 120; not wired to HTTP |
| Restart persistence | Partial JSON store helper and empty JSON file; no runnable backend to exercise restart persistence |
| SSE without polling | Partial broadcaster only; no SSE route, mutation integration or frontend subscriber |
| SSE correctness | Static defect: close callback deletes a newly allocated object from Set, not the registered client; no repair made |
| React frontend/project/task/search/filter UI | **NOT IMPLEMENTED**: frontend directory is empty |
| Loading/error/empty states, keyboard accessibility, debounce 750 | **NOT IMPLEMENTED**; plan text alone does not count |
| Page size 50 or corrected 25 | **NOT IMPLEMENTED**; correction was not eligible |
| API/validation/persistence/filter/frontend tests | **NOT IMPLEMENTED**; zero model test commands |
| Production application build | **NOT IMPLEMENTED**; partial backend helper compilation only |
| README and runtime-data ignore | **NOT IMPLEMENTED**; no README or .gitignore, runtime JSON is not ignored |
| Git commits | Zero |

No backend was available for real CRUD, restart or mutation-to-SSE verification;
no frontend existed for browser acceptance. These checks are missing, not passed.
No native GUI/Computer Use was performed. The native acceptance adapter did run
on Windows; Linux/macOS GUI or runtime acceptance is not claimed.

### Direct comparison and decision

Qwen figures are the existing sustained reference, not a new invocation. Prior-run
persistence evidence is explicitly separate from the latest comparison mission.

| Metric | qwen3-coder | Muse Glimmer |
|---|---|---|
| Tool smoke | PASS | PASS |
| Reasoning | None / false reference | Low / "low", all requests |
| Mission requests | 23 | 15 |
| Structured calls | 22 | 14 |
| Successful / failed tools | 21 / 1 | 14 / 0 |
| Successful file mutations | 12 | 7 |
| Failure recovery | Latest missing-directory failure was followed by prose/fabricated receipt, not a real recovery call | Not exercised; no tool failure |
| Backend | Substantive partial API | Types/validation/storage/SSE helpers only, no server |
| Frontend | Earlier-run partial implementation; latest reference none | None |
| Persistence | Demonstrated in earlier run | Helper only; backend restart unavailable |
| SSE | Incomplete | Unwired broadcaster, cleanup defect |
| Tests / application build | Incomplete/failed | No tests; helper compile passes, application cannot start |
| Correction retained | Latest reference had one user message and no correction; older correction-specific evidence is separate | Not exercised, second condition never met |
| Premature prose stop | Observed | No; native idle timeout |
| Engine/transport stall | No recurring 120-second pre-output stall | One 60-second post-output delivery silence |
| Latest context blocker | None | None |
| Minimum SDK / native headroom | 844 / 1835 | 8996 / 9916 |
| Latest-request receipts / savings | 11 / 6976 estimated tokens | 0 / 0 |
| Final classification | MODEL-INCOMPLETE | UPSTREAM STREAM STALL / NATIVE STREAM-IDLE DEADLINE / INCOMPLETE |

Decision: **QWEN3-CODER REMAINS PROVISIONAL LEADER**. It demonstrated materially
more real application work under the existing controls: its latest first write
was 30.510 s after session start and backend entry point 73.008 s, versus Muse's
171.779 s after first capture and no server. These timing origins differ slightly;
they are not claimed as synchronized benchmarks. Confidence is **moderate
for observed productivity**, limited for intrinsic model ranking: this is one
Muse mission, and server-side ownership of its delivery silence is unknown.
Neither model completed the required software product autonomously.

Muse daily-autonomous status: **NO, on current demonstrated evidence**. Current
best-tested qwen3-coder: **PROMISING BUT NOT YET**. **North Mini Code should be
tested next: YES**, in a separately authorized checkpoint, absent a newly proven
Clack defect. No North/Nemotron download or inference was performed here.
Context calibration now: **NO**. Qwen-specific production tuning now: **NO**.

### Verification and preservation

Focused frontend/harness tests: **214 passed / 8 files**, covering reasoning
compatibility, native Ollama serialization/routing, comparison harness, installed
models, approval lifecycle, structured tool protocol and syntax-aware correction.
After the final assertion-only lint cleanup, the installed-model group was run
again: **6 passed**. These are overlapping, not 220 distinct tests.
**npm.cmd run check-types**, focused Biome lint (three files, zero diagnostics),
**node --check scripts/check-real-local-product.mjs**, and **cargo fmt --check**
passed. The native test host compiled and ran the zero-inference preparation,
single smoke and single mission. All three phase source-freeze checks passed.
The offline reconstruction/audit passed and made zero network/inference calls.
Independent generated-project failures above are product-acceptance outcomes,
not hidden Clack test successes. No unnecessary full suites were rerun under the
evidence-only test policy; prior checkpoint full-suite limitations remain recorded
in their original section. Final diff checks passed; Git emitted only existing
LF-to-CRLF working-copy conversion notices.

Retained evidence includes baseline.json, preflight-1.json,
system-preflight-1.json/.requests.jsonl/.receive.jsonl, mission-a-1.json,
mission-a-1.native-report.json, mission-a-1.jsonl, mission-a-1.requests.jsonl,
mission-a-1.receive.jsonl, correction-state.json, each phase's source-freeze
before/result, audit.json and independent-audit.json. Raw evidence and generated
projects stay outside the commit. The native report and durable transcript match.
All owned child processes exited; no relaunch, replay, second smoke or second
mission was attempted.

Commit scope: this appendix, Low acceptance-harness support/guard and its focused
test only. Production source **unchanged**. Original six dirty-file changes,
stashes and autonomous_tracker/ **preserved**. Expected branch state after the
scoped commit: main, **63 ahead / 0 behind cached origin/main**, original six
paths still dirty and unstaged. **test(ai): evaluate muse after reasoning fix**.
**No push. STOP. No subsequent candidate or checkpoint started.**

## North Mini Code 1.0 local-agent evaluation

### Baseline and official artifact

Date: **2026-10-19**. Base **1cc39cc test(ai): evaluate muse after reasoning fix**,
main, initially **63 ahead / 0 behind cached origin/main**, empty index. The six
original dirty files were preserved in a fresh byte-for-byte baseline. Both safety
stashes and autonomous_tracker/ were untouched. Read-only process inspection found
no competing Clack acceptance host, Cargo/rustc, Clack Vite/test or model run.
The existing authorized tunnel at **http://127.0.0.1:11435** was reachable, with
Ollama **0.40.5**, eight installed models and initially no loaded model.

The exact official [Ollama tag](https://ollama.com/library/north-mini-code-1.0:q4_K_M)
and [registry manifest](https://registry.ollama.ai/v2/library/north-mini-code-1.0/manifests/q4_K_M)
were inspected before pulling. Native installed metadata was then retained in
full; advertised values were not used as a substitute for native capabilities.

| Field | Actual evidence |
|---|---|
| Exact installed tag | **north-mini-code-1.0:q4_K_M** |
| Full manifest/installed digest | **d8b269ad5c7c7144ce104b83ce93bc3efb85e0f74e01be6be5f5d6f7ca90b60f** |
| Model-weight layer digest | **2e6b0d32b7ff9d61f77d6808307db4791f487a72b22da0b28f5d4293b5729282** |
| Config digest | **d7d22779fb87ed760b8b256143d423ccbbf760020d5277b9949759f67afbab12** |
| Exact installed artifact size (/api/tags) | **18,593,967,008 bytes**, including config/layers |
| Weight layer size (registry manifest) | **18,593,955,136 bytes** |
| Architecture | **cohere2moe**, GGUF, sparse MoE; 128 experts / 8 used, 49 blocks |
| Parameters | **30,484,303,872** native total, displayed **30.5B**; official model description says approximately 3B active, not independently measured |
| Quantization | **Q4_K_M** |
| Native advertised context | **500,000 tokens** from cohere2moe.context_length |
| Official page discrepancy | Artifact metadata reports 500,000 (about 488 Ki tokens), while tag README describes 256K; evaluation stays at 32,768 |
| Native capabilities | **completion, tools, thinking** |
| Input modalities | Text completion/chat; no vision/audio capability advertised in native metadata; no multimodal inference attempted |
| Native reasoning metadata | **{"values":[false,true],"default":true}** |
| Minimum engine | **requires: 0.30.10**, from registry config and installed /api/show |
| Installed engine | **0.40.5**, compatible; no update performed |
| Native renderer/parser | **cohere / cohere**; retained unchanged |
| Artifact defaults | temperature 1, top_p 0.95; no sampling override or tuning |

Only the requested exact tag was pulled. It completed successfully in **286.167 s**,
including SHA-256 verification. Registry manifest bytes and config bytes were
hashed; the installed full digest matched. All **eight previous model records
remained unchanged**; the ninth record is North. No other model was downloaded,
replaced or removed, including no separate latest, Q8, BF16, MLX, Nemotron or
qwen3-coder-next. No Ollama service/global settings, model template or engine
version changed. North was initially unloaded after installation; /api/ps after
the mission showed only North loaded with runtime context **32768**. Its loaded
runtime memory size is not confused with the installed artifact's on-disk size.

### Reasoning, workspace and harness boundaries

The user-required preference order selected **None**, since native metadata
explicitly supports boolean false. Production normalization returned supported
levels **none/on**, mapping **ollama-boolean**. No Low/effort equivalence was
invented. Default true was deliberately overridden by the supported **think:false**
for the authorized None comparison, not silently changed mid-run. This single
run does not establish how North would behave with thinking enabled.

Workspace: **C:/Users/Hayden/Documents/forgeboard-north-mini-code-20261019-01**.
Evidence/run ID: **forgeboard-north-mini-code-20261019-01**, under
**src-tauri/target/real-qwen-product/**. The directory was fresh and initialized
with only an empty Git repository. No evaluator implementation was seeded.

Only test harness files changed before inference: exact tag registration at the
three existing allowlist boundaries, the disposable North workspace prefix in
the existing owner/path-bound approval evaluator, focused tests, and an opt-in
native None wire guard. The guard records the actual outgoing body and rejects
unexpected thinking/output controls before dispatch. It does not change the
production adapter or silently rewrite controls. Existing Low and unsupported
reasoning paths remain intact. Unknown/unsafe effects remain denied; owner,
workspace, secret-path and current pending-approval checks were not relaxed.

Zero-inference preparation passed, then exactly one smoke and exactly one mission
ran through the production native Clack /api/chat path. Every one of the **three
actual requests** used the exact North tag, **num_ctx=32768**, **num_predict=2048**,
**think:false**, fallback **Never**, cloud **0**. Session selection, normalized
capability revision and native controls stayed consistent. The active run ended
before its initial 30-second capability expiry; no stale-evidence rejection arose.
The native 60-second idle / 600-second overall deadlines and shared 120-second
pre-output guard were unchanged, as was the harness's 90-minute safety bound.

All tracked-source hashes matched before/after each live phase. No production
Clack files changed, no model-specific production prompt was added, and no source
editing occurred while inference was running. Existing normal tools, F1,
trusted-workspace test permission profile, approvals, verified-effect receipts,
continuation and context/memory policies were used without architectural changes.

### Single structured-tool smoke

Smoke request capture **21:20:57.133Z**: a harmless deterministic get_test_value
schema, with the same normal native tool serialization. North returned exactly
one provider-native structured call:
**get_test_value({"value":"protocol-check"})**, call ID **call_pokxh9zw**.
SDK finish **tool-calls**, provider done_reason **stop**, no prose, **zero tool
executions**. **PASS**. Nothing textual was parsed into a tool or executed.

Returned provider usage: **117 input / 33 output tokens**. Provider total
**9.975920 s**, including **9.018999 s** load, **0.463627 s** prompt evaluation
and **0.490294 s** generation. Host and source-freeze checks passed. No reasoning
validation failure occurred. The workspace still contained only .git before the
mission; there was no second smoke or compatibility retry.

### One fresh ForgeBoard mission

The complete unchanged **2,086-character** ForgeBoard specification was sent
**exactly once**, SHA-256
**f97ec34eefa136ac5be5847187f768b64bf5587d36140d9fcc53b695fa3e4801**.
It did not mention candidate names, benchmarks, prior failures or Clack internals.
There was one persisted user message, no correction/reminder/manual Continue,
no resubmission, no setting change and no evaluator implementation assistance.

Native mission host PID **47636**, launcher **39836**. First request capture
**21:21:27.538Z**; session terminal time **21:21:46.491Z**, **18.953 s** later.

| Request | Native dispatch UTC | Headers ms | First body ms | First parsed frame UTC | Native EOF ms |
|---|---|---:|---:|---|---:|
| 1 | 21:21:27.558 | 5661.100 | 5661.294 | 21:21:33.222 | 5684.067 |
| 2 | 21:21:33.330 | 13133.012 | 13133.124 | 21:21:46.465 | 13152.786 |

Milliseconds are relative to each native dispatch; wall/monotonic boundaries
are retained separately in audit.json. First useful native structured-tool frame
was **5.664 s** after dispatch; SDK tool availability **5.712 s** after capture.
Request 1 called **list_directory**, call ID **call_6p9h0efu**, against the fresh
workspace, and successfully received **entries:[]**. Both requests exposed the
normal **16 production tools**. No tool subset was stripped to force a result.

Request 2 returned a **single 349-byte native body / single parsed final frame**,
done **true**, done_reason **stop**, normal EOF, and provider usage **5192 input /
716 output tokens**. The native trace recorded **no content, thinking or tool-call
category**, and the persisted assistant contains no answer/reasoning part after
its second step-start. There were zero invalid/dropped frames/events or pending
partial bytes. The final frame was promptly forwarded by reqwest/IPC. It did not
time out, hit a length limit or request continuation. Provider total duration was
**12.927491 s**, generation **12.408541 s**; 716 is actual reported usage, **not**
a claim that Clack received 716 tokens of answer text. Total mission output usage
reported across both requests was **765 tokens** (49 + 716).

Classification: **ENGINE / EMPTY TERMINAL RESPONSE / INCOMPLETE**. The native
service exposed a completed empty response despite reporting generation. Whether
model generation or the engine's Cohere renderer/parser caused the empty payload
is **unconfirmed**; no hidden token content or server-side diagnostics were
invented. The evidence does not establish a Clack transport-loss defect: the raw
native trace and persisted SDK result agree that no answer/tool payload arrived.
There is **no confirmed Clack defect**, and nothing was patched to rescue North.

Clack's run state **completed**, the harness **ok:true**, and normal process exit
mean that the request lifecycle completed, **not** that ForgeBoard was delivered.
The provider stopped at **two steps**, below the existing 24-step soft boundary;
no automatic continuation was scheduled for this normal stop. No forced Continue,
alternate reasoning run, replay or post-outcome tuning was attempted.

Totals: **2 mission requests**, **2 completed responses**, **1 structured tool
call**, **1 successful tool**, **0 failures**, **0 file mutations/directories**,
**1 completed empty response**, **0 malformed textual intents**, **0 prose stops**,
**0 approvals**, **0 continuations**, **0 pre-output stalls**, **0 stream-idle
stalls**, **0 shell commands**. Failure recovery and native PowerShell syntax use
were **not exercised**. There was no structured todo plan, first mutation,
substantive backend/frontend, persistence/SSE implementation, authored test,
successful model test or production build; those productivity timings are **not
reached**, not zero-second achievements.

### Correction, context and independent application audit

The syntax-aware correction observer stayed **pending**, with **zero eligible
writes** and no authored implementation/current accepted plan containing page
size 50. Neither correction condition was reached. **50-to-25 was not sent**;
25 retention is **not exercised**. No original user-spec text was mistaken for
accepted implementation evidence.

Offline reconstruction using production preparation and original source/tool
result ordering reproduced **both captured native requests exactly**. Minimum
measured estimated-token headroom: **SDK 16,985 / native 17,021**. No protected
budget block. **Zero verified-effect receipts / zero receipt savings**, zero
compaction, extraction or retrieval calls and zero durable memory revisions.
The final conversation revisionId/revision remain null; source transcript and
native/durable history agree. No memory or context architecture was redesigned.

Independent filesystem and Git inspection after the terminal outcome found only
**.git**, no generated source/manifests/README/ignore files, a clean scratch Git
status and **zero commits**. There was nothing to copy, install, repair or launch.
No evaluator code was added to the workspace.

| Requirement | Independent outcome |
|---|---|
| React/TypeScript frontend, Node/TypeScript backend/npm setup | **NOT IMPLEMENTED** |
| Project create/list/edit/delete/open | **NOT IMPLEMENTED** |
| Task CRUD/view, required fields/statuses/priorities/tags/timestamps | **NOT IMPLEMENTED** |
| Combined project/status/priority/tags/search filtering | **NOT IMPLEMENTED** |
| Input validation/title max 120/deterministic errors/statuses/API 4317 | **NOT IMPLEMENTED** |
| Local restart persistence and runtime-data ignore | **NOT IMPLEMENTED**; no backend exists for restart testing |
| SSE mutations without polling | **NOT IMPLEMENTED**; no endpoint or frontend subscriber |
| Loading/error/empty UI, debounce 750, page size, keyboard accessibility | **NOT IMPLEMENTED** |
| Model-authored API/validation/persistence/filter/frontend tests | **NOT IMPLEMENTED** |
| Test execution / production build | **NOT IMPLEMENTED**; not run independently because no manifest or command exists |
| README | **NOT IMPLEMENTED** |

These are missing capabilities, not passed acceptance checks or fabricated failed
test invocations. No frontend existed for browser verification. The real native
acceptance adapter ran on Windows; no Computer Use/native Clack GUI interaction
or Linux/macOS runtime/GUI verification was performed or claimed.

### Three-model comparison and decision

No qwen3-coder, Muse, Devstral or Nemotron inference was sent. Reference results
are preserved from their original evidence. In particular, earlier Qwen frontend
and persistence evidence is not incorrectly attributed to its latest mission.

| Metric | qwen3-coder | Muse Glimmer | North Mini Code |
|---|---|---|---|
| Native tool smoke | PASS | PASS | PASS |
| Reasoning | None / false reference | Low / "low" | None / false |
| Latest mission requests | 23 | 15 | 2 |
| Structured calls | 22 | 14 | 1 |
| Successful / failed tools | 21 / 1 | 14 / 0 | 1 / 0 |
| Successful file mutations | 12 | 7 | 0 |
| Failure recovery | Latest missing-directory failure followed by prose/fabricated receipt, not actual recovery | Not exercised | Not exercised |
| Backend | Substantive partial API | Unwired helpers | None |
| Frontend | Earlier-run partial; latest none | None | None |
| Persistence | Demonstrated in earlier run | Helper only | None |
| SSE | Incomplete | Unwired helper with cleanup defect | None |
| Tests / application build | Incomplete/failed | No tests; helper compilation only, app cannot start | No implementation, tests or build |
| Premature prose stop | Yes | No | No; empty terminal response instead |
| Empty terminal response | None in latest reference | None | 1 |
| Engine/stream stall | No recurring stall in reference | One 60-second post-output silence | None |
| Latest context blocker | None | None | None |
| Minimum SDK / native headroom | 844 / 1835 | 8996 / 9916 | 16985 / 17021 |
| Final class | MODEL-INCOMPLETE | UPSTREAM STALL / INCOMPLETE | ENGINE / EMPTY TERMINAL RESPONSE / INCOMPLETE |

**QWEN REMAINS LEADER. Provisional operational ordering: qwen3-coder > Muse
Glimmer > North Mini Code**, based on application work actually delivered, not
parameter count or advertised benchmarks. North's first native tool was faster
than Muse's, but no mutation or application followed, so latency does not reverse
the engineering-productivity ranking. This is **one run per selected setting**,
not proof about all North reasoning modes. Confidence is **moderate for these
observed outcomes, limited for broader intrinsic model ranking**.

North daily-autonomous status: **NO on this evidence**. Best-tested qwen3-coder:
**PROMISING BUT NOT YET**, not production-ready autonomous delivery. Muse's prior
status remains NO. **Should Nemotron 3.5 Lightning be tested next? YES**, in a
separately authorized checkpoint; no confirmed Clack defect currently blocks
that next sample. Nemotron was **not** downloaded or tested here. Context
calibration now **NO**; qwen-specific tuning now **NO**. No 48K/49,152/64K run.

### Verification, evidence and commit scope

Focused reasoning/Ollama serialization/protocol/harness/approval/correction suite:
**216 passed / 8 files**. After adding the opt-in None native guard, its affected
installed-model group passed **8 tests**, seven overlapping and one new: **217
distinct tests exercised**, not 224 distinct tests. Final type checking passed;
focused Biome lint (two TS test files, zero diagnostics), script syntax checks,
**cargo fmt --check**, native test-host compilation, all three phase source-freeze
checks and exact offline SDK reconstruction passed. Final working/staged diff
checks passed, with only existing Git LF-to-CRLF conversion notices. Production
source remained unchanged, so no unnecessary full frontend/Rust suite was rerun.
Existing broader-suite limitations stay recorded in the preceding checkpoints.

Evidence directory contains baseline.json (original dirty files, all tracked
hashes, stashes, initial server metadata, hashed registry manifest/config),
pull.jsonl, installed.json, workspace-initial.json, preflight-1.json,
system-preflight-1.json/.native-report.json/.requests.jsonl/.receive.jsonl,
mission-a-1.json/.native-report.json/.jsonl/.requests.jsonl/.receive.jsonl,
correction-state.json, per-phase source-freeze files and audit.json. Raw evidence
and scratch Git metadata are not committed. All owned native/launcher processes
exited; the remote Ollama model's normal loaded state was not forcibly changed.

Commit scope: **test(ai): evaluate north mini local agent**, this appendix plus
the narrowly bounded test-harness registration/guard/tests only. Production
architecture, prompts, context, timeouts, permissions and memory remain unchanged.
The six original dirty paths/edits, both safety stashes and autonomous_tracker/
remain preserved and unstaged. Expected final branch state: main, **64 ahead /
0 behind cached origin/main**, empty index and the same six dirty paths. **No
push. STOP. No subsequent candidate or checkpoint started.**

## Nemotron 3.5 Lightning local-agent evaluation

### Scope and artifact

Date **2026-10-20 Europe/Paris**. Base **0adc1ed**, including **a968b5c**;
main initially **65 ahead / 0 behind cached origin/main**, empty index, the same
six original dirty paths. Their bytes, all tracked hashes and both safety stash
identities were saved. No competing Clack host/build/test/model run was detected.
autonomous_tracker/ was not touched. The initially refused development tunnel was
restored by the user before download; that preparatory refusal is not model failure.

Current official [tags](https://ollama.com/library/nemotron-3.5-lightning/tags),
[exact tag](https://ollama.com/library/nemotron-3.5-lightning:30b-a3b-q4_K_M)
and registry manifest/config were inspected before pulling. The Linux/llamacpp
default alias resolved to the same Q4_K_M weight/config payload as the explicit
tag. The advertised 19-25GB range spans backends; it is not a promise of a 19GB
Linux GGUF. The explicit quantized GGUF avoids MLX, BF16, Q8 and ambiguous aliases.
Its 25.43GB weights require offload beyond 16GB VRAM; practical 32K performance on
the supplied hardware was a measurement target, not assumed from advertised size.

| Field | Verified evidence |
|---|---|
| Exact installed tag | **nemotron-3.5-lightning:30b-a3b-q4_K_M** |
| Full manifest/installed digest | **e7a64ff15fb174c42b4f463e5c888c4f2c7b9cabf9e8d65a1c0874405426c1b2** |
| Weight digest | **5c19f6282f4fc51cb114cb6c876d70ca2fc3b9cf0fbd0a018d9908f4fe1f63b3** |
| Exact installed size | **25,430,749,387 bytes** |
| Weight layer size | **25,430,738,944 bytes** |
| Architecture / quantization | **nemotron_h_moe / GGUF / Q4_K_M**, 53 blocks |
| Native total parameters | **32,913,266,240**, displayed 32.9B |
| Active parameters | Official family says approximately 3B; native metadata reports 128 experts, 6 used and 1 shared, not an exact active-parameter total |
| Advertised maximum context | **1,048,576** native tokens |
| Native capabilities | **completion, tools, thinking** |
| Modalities / structured output | Text; no vision/audio or separate structured-output capability advertised in the captured native metadata; those were not probed |
| Native thinking metadata | **{"values":[false,true,"medium"],"default":true}** |
| Renderer/parser | **nemotron-3.5-nano**, unchanged |
| Engine requirement / installed | **0.32.9 / 0.40.5**, compatible |

Exactly **one artifact** was pulled, successfully, with digest verification in
**375.358 seconds**. All nine prior model records remained unchanged. No other
model/alias was downloaded, deleted or replaced; no qwen3-coder-next. No Ollama
update, service/global setting, template, firewall or network-exposure change.
The existing localhost SSH tunnel was used. North, Muse, Qwen and Devstral were
not invoked. Registry/config metadata reads were not inference.

Workspace and evidence ID: **forgeboard-nemotron35-lightning-20261019-01**,
using the requested label despite the local execution date being October 20.
Workspace **C:/Users/Hayden/Documents/forgeboard-nemotron35-lightning-20261019-01**
started with only .git. Evidence is under **src-tauri/target/real-qwen-product/**.
Nothing was seeded. Only bounded test-harness registration/guards/evidence capture
were changed; no production source, model-specific prompt or architecture changed.

### Discovery and bounded reasoning checks

Normal production discovery correctly normalized **None -> false**, **On -> true**,
**Medium -> "medium"**, mapping **ollama-mixed**. Metadata-only preparation
captured these choices and the scoped capability revision with **zero inference**.
No valid metadata was rejected. No arbitrary None/Low substitution was made.

| Phase | Choice / native field | Native structured result | Reported input/output tokens |
|---|---|---|---:|
| Compatibility check 1 | Automatic / think omitted, provider default true | get_test_value({"value":"protocol-check"}), PASS | 308 / 41 |
| Compatibility check 2 | None / think:false | Same native call, PASS | 308 / 26 |
| Final canonical smoke | Automatic / think omitted | Same native call, PASS | 308 / 112 |

Each used one harmless prompt/schema, 32768 context, 2048 output, fallback Never,
cloud zero and **zero tool execution**. Text was only newline whitespace, not
tool-looking markup interpreted by the evaluator. Medium was recognized but not
tested because both materially distinct bounded checks already disambiguated
compatibility. No exhaustive reasoning ladder. First cold probe provider total
was **15.014003 s**, load **12.897934 s**; warm None **0.455887 s**, canonical
Automatic **1.942729 s**. These are probe observations, not quality rankings.

**Automatic/provider default was selected for the mission**, since it produced
valid native tools and is what a normal Automatic user receives. No observed
reasoning auto-selection gap. The test-only native guard rejected unexpected
think overrides/output values rather than silently rewriting requests.

### Mission chronology and stop

The unchanged **2,086-character** ForgeBoard specification was sent **once**;
SHA-256 **f97ec34eefa136ac5be5847187f768b64bf5587d36140d9fcc53b695fa3e4801**.
No candidate/benchmark names, reminders, manual Continue, evaluator implementation
or requirement resend. Only the authorized conditional correction added a user
message. All **19 mission requests** used the exact installed model/tag, **32768 /
2048**, **think omitted**, fallback Never, zero cloud. Installed and final loaded
digest evidence, session/provider/profile configuration revision and native bodies
are retained. No claim is made that the model digest is itself an Ollama wire field.

First request capture **22:28:37.353Z**, native dispatch **22:28:37.373Z**. First
body **12.733764 s** after dispatch; first parsed output **22:28:50.110Z**; first
native structured tool **19.227 s** after dispatch. It inspected the empty repo,
created a 12-step plan, ran npm init/install and generated tsconfig. The advertised
shell was **PowerShell (pwsh.exe)**, not Bash. First shell command was
**cd C:/Users/Hayden/Documents/forgeboard-nemotron35-lightning-20261019-01 && npm init -y**,
exit 0. Its syntax worked on the advertised native shell.

First successful shell-generated manifest effect: **46.138 s** after capture.
First direct verified file write: **76.133 s**, tsconfig.json. Three direct writes
were tsconfig.json, package.json and src/types.ts; npm also created/updated lockfile
and dependency state. Indirect shell effects are not conflated with the three
direct verified-write receipts used by the correction threshold.

Before correction, two natural tool failures were followed by successful recovery:
an old_string edit mismatch by a full write, and npm peer-dependency resolution
failure by --legacy-peer-deps. No evaluator advice. This is useful pre-blocker
recovery evidence, not a completed application. No substantive server/frontend,
persistence/SSE implementation, test or production build was reached.

At **22:30:57.160Z**, the third direct write and current accepted plan's **page
size 50** satisfied both correction conditions. The exact authorized message was
dispatched at **22:30:57.216Z**, once. Request 16 was intentionally cancelled at
that boundary, not an engine stall. The same conversation continued. Its later
accepted plan and unexecuted text mention 25; **working pagination retention is
not verified**, since no application implementing it reached disk.

### Confirmed Clack defect: F1 objective/tool continuity

**Primary classification: CLACK-BLOCKED / F1 OBJECTIVE-CONTINUITY AND TOOL-EXPOSURE
DEFECT / INCONCLUSIVE.** Stop model sampling; no production repair or rerun here.

The live native bodies establish the regression:

- Requests 1-16 exposed the normal 16 coding/collaboration tools.
- Immediately after the bounded correction, request 17 exposed **only
  communicate_peer_task, request_peer_task, cancel_peer_task**. The original task
  explicitly forbade delegation. File read/write/edit, shell and todo tools vanished
  from the ongoing coding task without a permission/model/workspace change.
- Its unexposed todo_write failed; request 18 then exposed todo_write plus the
  same three peer tools. Request 19 still lacked write_file and shell capability.
- This is a **generic runtime/tool-selection continuity defect**, not evidence
  that Nemotron intrinsically cannot implement software.

Read-only production call-path inspection and **reproduce-exposure.mjs** reproduce
the captured selection using the actual schemas and correction. agent.ts selects
uiExposureQuery/exposureQuery, then prepareToolExposure. toolExposure.ts's
continuedExposureQuery recognizes only whole-message continuations starting with
Continue/Resume/etc.; this message begins **Change**, although it explicitly says
Continue the same project. Selection therefore retains only the correction as
its lexical query, losing the original coding objective. requiredUiToolNames also
ceases requiring completed tools before the latest user turn. The resulting
ranking exposes only peer tools.

The offline reproduction matches request 17's three tool names. With history
pressure removed, the same latest-only query still drops coding tools, whereas
the original objective plus correction restores all 16. A second comparison using
the **captured serialized native history** restores some coding tools but not every
write/shell tool. That comparison is not an exact reconstruction of the original
SDK history or its selection budget; this boundary is recorded in
f1-repro-boundaries.json. **A prefix-regex change is not proposed as a verified
sufficient fix**. The separate repair must independently verify objective continuity
and budget-aware preservation/recovery of required authorized task capabilities.
No source changes were made to toolExposure.ts, agent.ts, permissions or B1.

The final native response, request 19, returned **done_reason:length / 2048 output
tokens**, with a truncated **<tool_call><function=write_file>** block exposed as
text, not a provider-native call. **It was not executed or written to disk.**
The subsequent continuation was rejected before dispatch with
**answer-continuation-budget**: estimated input **31846**, reserve **2048**, margin
**3185**, ceiling **32768**, required **37079**, deficit **4311**. No continuation
request was sent. This is a distinct observed terminal budget boundary, not proof
of a second accounting bug; native token usage and conservative SDK estimates are
different measurements. F1's earlier confirmed defect already invalidates a fair
post-correction model-quality verdict. No rescue, timeout/context increase or
automatic mode change was attempted.

### Counts, context and evidence limits

**19 mission attempts / 18 engine finishes / 1 intentional correction cancellation**;
**17 structured calls, 14 successful / 3 failed**, **3 direct writes**, **1 malformed
textual intent**, **0 completed empty responses**, **0 normal premature prose
stops**, **0 dispatched automatic continuations**, **0 approval events**, **0
pre-output/stream-idle timeout stalls**. The third failure is the post-defect
unexposed todo_write with stringified arguments; a subsequent native todo call
with structured arguments succeeded. Do not attribute that transition solely to
intrinsic model quality. The later todo plan falsely marked missing API/SSE work
complete; filesystem verification does not accept those plan claims as effects.

Reported output tokens from the 18 finished requests total **7770**; cancelled
request 16's final usage is unknown, not inferred. Across all phases there were
**22 inference requests**, only this candidate, zero cloud. All production
120-second pre-output, 60-second idle, 600-second overall deadlines were unchanged.
The host remained healthy and exited normally; no harness timeout or crash.

Minimum captured **native headroom: 2016 estimated tokens**. **SDK minimum across
the correction/cancelled-history boundary was not independently reconstructed**;
no native estimate is substituted or invented as an SDK minimum. The blocked
continuation's SDK budget/deficit is retained above. Zero observed historical
verified-effect compaction receipts/token savings, extraction/retrieval calls or
durable memory revisions. Direct write-verification results still exist; these
are distinct from compact historical receipts.

Per-request dispatch, headers, body, parsed-frame and completion/cancellation
timestamps are in audit.json plus native receive traces. Body arrival ranged
**0.736653-23.703339 s** after dispatch. The bounded IPC diagnostic event ring
dropped older **diagnostic entries** for requests 1/2 (464/190); aggregate counters
and first/last timestamps remain. This is not asserted to be payload loss or a
complete raw-frame archive. Original message IDs/roles/parts match durable history.
Recovery-only answer lifecycle metadata differs for the correction-cancelled
segment; it was preserved, not falsely asserted byte-identical or replayed.

### Independent application audit

Inventory excluding .git/node_modules found only **package.json, package-lock.json,
tsconfig.json, src/types.ts**. No src/index.ts exists. A source-hashed copy at
**C:/Users/Hayden/Documents/forgeboard-nemotron-audit-20261020-01** was inspected
without repairs, separately from Clack's dependencies. Actual commands:

| Command | Result |
|---|---|
| npm ci --ignore-scripts --legacy-peer-deps --audit=false --fund=false | PASS, 385 packages; deprecation warnings for inflight/glob |
| npm test | FAIL exit 2 in pretest tsc: TS5108, moduleResolution=node10 removed |
| npm run build | FAIL exit 2, same TS5108 |
| npm start | FAIL exit 1, missing dist/index.js |

The generated test script uses --passWithNoTests; even had it run, an empty suite
would not count as meaningful authored tests. No model test/build execution
occurred; tsc --init generated configuration, not a production build. Original
workspace and copied source hashes remain unchanged. No evaluator implementation
or config/dependency repair. npm warnings are retained, not silently fixed.

Project/task CRUD/open/view, combined search/filtering, API validation/errors,
4317 listener, restart persistence, SSE, React UI/loading/error/empty/accessibility,
750ms debounce, implemented page size/title maximum, README and runtime-data
ignore are all **NOT IMPLEMENTED**. Types and unexecuted answer text do not satisfy
those requirements. No server/frontend existed for endpoint, restart, SSE or
browser checks. Native acceptance ran on Windows; no Computer Use or native
Clack GUI, Linux/macOS Clack runtime/GUI acceptance is claimed.

### Four-way comparison and auto-configuration findings

| Metric | qwen3-coder | Muse | North | Nemotron |
|---|---|---|---|---|
| Recommended config automatic? | None chosen for reference, not established | Low manually chosen | None manually chosen, provider default true | Normal Automatic/default preserved and probe-validated |
| Native smoke | PASS | PASS | PASS | Both compatibility modes and canonical PASS |
| Reasoning tested | None/false | Low/"low" | **None/false; default=true; broader config unmeasured** | Automatic/omitted and None/false probes; mission Automatic |
| Mission requests / structured calls | 23 / 22 | 15 / 14 | 2 / 1 | 19 / 17 |
| Successful / failed tools | 21 / 1 | 14 / 0 | 1 / 0 | 14 / 3, post-defect qualification |
| Direct writes | 12 | 7 | 0 | 3, setup/types only |
| Backend / frontend | Partial API; earlier partial frontend | Helpers / none | None / none | No server / none |
| Persistence / SSE | Earlier persistence proof / incomplete | Helpers only | None | None |
| Tests / application build | Incomplete/failed | None/app cannot start | None | None/fails; no authored tests |
| Failure recovery | Latest missing-directory failure followed by prose/fabricated receipt | Not exercised | Not exercised | Two pre-defect failures recovered |
| Prose stop / empty output | Yes / no | No / no | No / yes | No / no; truncated textual tool intent at length |
| Stream stall | No recurring | Yes | No | No |
| Context blocker latest | No | No | No | Continuation estimate exceeded 32K after length |
| Final class | MODEL-INCOMPLETE | UPSTREAM STALL/INCOMPLETE | ENGINE/EMPTY RESPONSE at None | **CLACK F1 BLOCKED / INCONCLUSIVE** |

**Observed operational ranking under tested configurations:** the prior provisional
qwen3-coder > Muse > North remains an evidence reference; **Nemotron is unranked
because Clack's confirmed runtime defect prevents a fair post-correction comparison**.
No new intrinsic model ranking/winner. Qwen remains the provisional delivery leader,
**PROMISING BUT NOT YET** daily-autonomous. Confidence is high in the reproduced
runtime failure, limited in comparative model quality. Nemotron readiness is not
established, not blanket model failure. North may deserve a future default-mode
test; Nemotron a fair rerun after the generic repair; Muse a reliability-qualified
rerun if separately authorized. None was started here.

Clack successfully discovered native tools, mixed legal reasoning controls and
wire mappings, model metadata/context and stable profile identity. Automatic's
provider-default behavior worked without a family-specific production branch.
The evaluator still chose the artifact based on hardware/backend, checked engine
compatibility, configured **32K/2048**, orchestrated bounded probes and judged
practical reliability. Recommended practical context/output were **not calibrated
automatically**; advertised 1M is not verified practical context. Persistent,
revision-aware onboarding recommendations and secure second-PC setup remain
subjects for the later dedicated audit, not implemented features claimed here.

### Verification and handoff

Focused capability/serialization/protocol/harness/approval/correction tests:
**220 passed / 8 files**, then **11 passed** in the affected discovery-capture
group (ten overlap, one new; **221 distinct tests exercised**). Final types, focused
Biome lint (two files, zero diagnostics), script syntax, cargo fmt --check, native
test-host compilation and five source-freeze checks passed. The offline F1
reproduction passed and sent zero inference. The evidence audit preserved the
documented SDK/recovery/diagnostic limitations; no complete SDK reconstruction
claim. Final working/staged diff checks passed, with existing CRLF conversion
notices only. No unnecessary full frontend/Rust suites were rerun. No production
Clack code changed or defect fixed. All owned native/launcher/audit processes ended.

Evidence: baseline.json, endpoint-ready.json, pull.jsonl, installed.json,
workspace-initial.json, preflight-1.json, system-preflight-1/2/3.json and their
native/request/receive traces, mission-a-1.json/.native-report.json/.jsonl/
.requests.jsonl/.receive.jsonl, correction-state.json, per-phase freezes,
f1-objective-repro.json, f1-repro-boundaries.json and audit.json. Raw evidence/generated files stay outside
the commit. The six original dirty edits, both stashes and autonomous_tracker/
are preserved and unstaged. Commit **test(ai): evaluate nemotron local agent**;
expected main **66 ahead / 0 behind cached origin/main**, empty index afterwards.

**STOP model sampling. Next checkpoint: separate generic F1 objective/tool-capability
continuity repair**, preserving permissions/B1 and the original task through a
bounded correction. No proposed sufficient patch or repair is implemented here.
Then the required **Local Provider Auto-Configuration and Model Onboarding UX Audit**,
subject to resolution of this production blocker. No broad audit/UI work, another
model, qwen-next, context calibration or qwen-specific tuning was started. **No push.**

## F1 objective-continuity and required-capability repair

2026-10-20, from `32e952a`. Classification of the preserved mission remains
**CLACK-BLOCKED / F1 OBJECTIVE-CONTINUITY AND TOOL-EXPOSURE DEFECT**, not a
Nemotron quality verdict. This checkpoint repairs production selection offline.
**No Nemotron rerun, other model run, inference, download, provider probe or model
tool execution occurred.** No onboarding UX or subsequent checkpoint started.

### Exact failure transition and ownership

Source evidence is `forgeboard-nemotron35-lightning-20261019-01`, conversation
`real-mission-a`, user objective `qSH5wXlvWSy2UYld`: implement and verify the full
ForgeBoard application, as one persistent Coder without delegation. The original
specification SHA-256 remains
`f97ec34eefa136ac5be5847187f768b64bf5587d36140d9fcc53b695fa3e4801`.

- Immediately before correction, `inference-16` had the same 16 schemas as
  requests 1-15: `read_file`, `list_directory`, `write_file`, `create_directory`,
  `edit`, `multi_edit`, `grep`, `glob`, `bash_run`, `bash_list`, `open_preview`,
  `todo_write`, `communicate_peer_task`, `request_peer_task`, `cancel_peer_task`,
  `propose_custom_tool`. Three direct writes were verified: `tsconfig.json`,
  `package.json`, `src/types.ts`; two earlier tool failures had recovered.
- At `1792449057160` (2026-10-19 22:30:57.160 UTC), the third write
  `call_njee40qq` reached the correction boundary. The latest successful plan
  `call_52hig39a` had item 1 completed, item 2 in progress and items 3-12 pending.
  Item 4 still specified page size 50. Plan digest:
  `907d6eafe3191bbb84e5473c4b61112738de2c4be0cbeb8d685b7df4a3b5a367`.
- Request 16 was intentionally cancelled. Correction `1Ugb5fHaH1lRlJAq` was sent
  once at `1792449057246`: "Change the task page size requirement from 50 to 25.
  The new value supersedes 50 everywhere. Continue the same project and do not
  restart from scratch." The conversation, workspace, agent and model did not
  change. This was a requirement mutation, not a replacement objective.
- `continuedExposureQuery` in `toolExposure.ts` recognized only a whole-message
  continuation starting at its beginning. This message started with "Change".
  The query therefore became exactly that correction, losing the broader build
  objective for ranking. `requiredToolNames` reset resolved tail calls at the new
  user message; `requiredUiToolNames` excluded resolved pre-correction calls.
  A new run also reset live todos via `chatStore.prepareRun`, although successful
  accepted plan calls remained in the original persisted UI transcript.
- `inference-17`, captured at `1792449057762`, exposed only
  `cancel_peer_task`, `communicate_peer_task`, `request_peer_task` (sorted order).
  Task/requirement words matched peer schemas, while coding received no minimum
  capability protection. The old policy did not have a durable task classifier
  or consult accepted plan state. This was implicit lexical specialization,
  not an explicit legitimate delegation-only decision.
- The unexposed `todo_write` call `call_pzwbmlvr` also had invalid string-valued
  todos. Request 18 recovered with `call_7sc93k0x`: items 1-3 reported completed,
  item 4 in progress with page size 25, items 5-12 pending. Those completion
  claims are not proof of implemented API/SSE effects. Requests 18-19 exposed
  only the three peer tools plus `todo_write`; creation and commands remained
  unavailable.
- Request 19 ended with native `done_reason=length`, `eval_count=2048` and
  truncated textual `write_file` intent, not an executed native tool call. The
  same-answer continuation was not dispatched: `answer-continuation-budget`,
  input estimate 31846 + output reserve 2048 + margin 3185 - ceiling 32768 =
  **4311 tokens over budget**. No server, frontend, tests or build were completed.

The exact owners remain: `tools/customExecution.ts` builds assigned/executable
versions; `permissions.ts` owns permission and write-lane enforcement;
`toolExposure.ts` owns ranking, schema reduction, lifecycle pinning and cache;
`agent.ts` wires selection into initial request, recovery validation and every SDK
`prepareStep`; `streamText.activeTools` and the existing native adapter construct
outgoing schemas. `todos.ts`/`todoStore.ts` and successful `todo_write` transcript
parts own accepted plan state. `answerContinuation.ts` owns length continuation
and its B1 check. PeerTask coordination, provenance and scheduling did not change.

### Implemented invariant and boundaries

**F1 may compress redundant/irrelevant schemas, but cannot discard the eligible
minimum capabilities of the current unresolved objective to make a request fit.**

`toolObjective.ts` is a pure derived view, not another durable store. It reads the
existing original UI transcript, successful validated full plan replacements,
current session todos and structured attempted tool operations. Unfinished plans
anchor the broader objective across correction runs, including after the live
todo reset. Corrections remain bounded alongside that objective through repeated
continuations; failed/malformed plan calls cannot replace accepted obligations.
Completed/cancelled plans release old obligations for new objectives, and a new
task-scoped handoff resets prior direct-work evidence. No original message, plan,
memory revision or outgoing conversation text is rewritten by this view.

The ranking query is bounded to 8192 characters. Direct structured creation/edit
attempts establish primary implementation needs, including recovery after a
failed edit. Initial tasks or a plan restored without hot source text use bounded
generic action/domain matching because existing plan records have no task-kind
or assignee field. A peer call alone cannot erase direct implementation needs;
fully delegated classification requires explicit whole-objective delegation and
peer evidence without direct mutation evidence. This is not automatic semantic
task understanding, ownership reassignment or a new plan architecture.

Capabilities distinguish source reading, creation, modification, commands and
peer work. They come from known callable builtin operations or existing trusted
native-operation binding identity, never model names, tool descriptions, MCP
annotations or requested permissions. `write_file` supplies creation AND editing;
exact-string editors supply editing only. Equivalent eligible operations can
substitute. F1 deterministically promotes the lowest-schema-cost eligible provider
of each uncovered required capability before optional ranking, suppresses redundant
alternatives, and retains existing explicit/lifecycle requirements and dependency
closure. Under hard pressure the minimum set can still fail B1 or payload bounds;
it is not silently dropped. Policy `f1-exposure-v5` includes objective/capability
state in the bounded existing cache identity. Original selection messages remain
available even when the actual model request has been compacted.

All permission checks, executor approval guards, assignment restrictions,
read-only write lanes, secret paths and workspace authorization remain
authoritative. Chat Only exposes no tools. Ask, Trusted Workspace, Full Access
and Custom retain existing semantics. Specifically, a false Custom category
means **ask for approval**, not a blanket denial in the existing resolver; this
repair does not turn it into an execution grant. An unassigned/denied writer is
never recreated to satisfy coverage. Research-only/ordinary chat do not acquire
implementation coverage. Unknown/no-match intent uses a safe read core instead
of an arbitrary peer-only or all-mutating fallback. Ambiguous positive matches
and unresolved exact tool lifecycles retain the existing conservative behavior.
Externally supplied MCP/HTTP/WASI claims are not treated as proven equivalent
filesystem or shell operations.

### Offline replay and context cost

Fresh repair evidence:
`src-tauri/target/real-qwen-product/f1-objective-repair-20261020-01/`.
`before-toolExposure.ts` preserves the base selector; `replay.mjs` blocks fetch,
reconstructs all 27 permitted compaction-enabled builtin schemas (captured dynamic
schemas plus unchanged-source static definitions), converts original UI messages
through the SDK, prunes with the production reasoning policy, and invokes the
existing compaction planner without extraction or effects. Re-serialization through
`ollamaBody` matches requests 17 and 19 semantically, allowing JSON object key
order differences. The exact selected schemas and costs are in `replay.json`.
The committed `toolObjective.fixture.json` retains real tool-state/plan evidence
and all candidate schemas; its test projection excludes prose/reasoning. The
full SDK reconstruction uses the preserved original raw evidence separately.

| Request-17 selection | Before | Repaired |
| --- | ---: | ---: |
| Permitted candidates | 27 | 27 |
| Selected schemas | 3 | 7 |
| Serialized schema bytes | 4607 | 7422 |
| Estimated F1 schema tokens | 2189 | 3634 |
| System estimate | 3758 | 3758 |
| Conversation estimate | 16196 | 16196 |
| Output reserve | 2048 | 2048 |
| Safety margin | 2215 | 2359 |
| Projected total | 26406 | 27995 |
| Remaining headroom | 6362 | 4773 |

Before (sorted): `cancel_peer_task`, `communicate_peer_task`, `request_peer_task`.
After (sorted): `bash_run`, `list_directory`, `open_preview`, `read_file`,
`request_peer_task`, `todo_write`, `write_file`.
The selected cost increases **1445 estimated tokens / 2815 bytes**, while staying
well below the full candidate cost of 11231 estimated tokens / 23021 bytes.
The accepted objective and correction remain unchanged; classification becomes
implementation with read/create/modify/command coverage, not peer-only.

For the later continuation, replay must restore the SDK's actual validation
error for `call_pzwbmlvr` from the captured native tool-result text. The durable UI
has the presentation-normalized "Primary inference failed." instead; using it
alone understates conversation cost by 1718 tokens. Restoring that evidence gives
an exact match for all historical B1 totals, including the **4311** deficit.
Holding that captured history and answer fixed and replacing only its tool set
with the repaired pinned selection yields:

- SDK-schema/options estimate **2773 -> 3585** (+812); SDK schema representation
  differs from F1's function-envelope representation in the preceding table.
- System **3888**, conversation **25185**, reserve **2048**, ceiling **32768**
  remain fixed. Input **31846 -> 32658**, margin **3185 -> 3266**.
- Projected total **37079 -> 37972**, deficit **4311 -> 5204** (+893).

Thus a correct tool inventory does **not** solve that separate context block.
This is a same-captured-state counterfactual, not a prediction of a repaired
model's future output or provider token usage. B1, C1/G1/M1/M2, compaction,
continuation/effect safeguards, reasoning, 32K context, output allowance, deadlines
and provider settings were not changed. No model-specific production code added.

### Verification, repository safety and stop

Final focused group: **172 passed / 8 files**. This includes **31 new objective
tests** and the existing F1, guidance, B1 integration, permission, collaboration,
custom execution and G3 fallback integration cases. Coverage includes baseline
coding, exact captured correction, repeated continuation, failed edit/recovery,
compacted request plus durable plan, peer-heavy direct work, explicit fully
delegated work, research/chat, all five permission modes, disabled assignment and
read-only lanes, missing/single/equivalent writers, tight schema pressure, safe
unknown fallback, invalid plans, handoff/new-objective reset, cache invalidation,
and schema-order determinism. The fallback fixture now carries trusted native-read
identity rather than relying on the removed unsafe unknown-tool fallback.

Required full gates were attempted once. The full frontend run reported
**3073 passed / 2 failed tests; 209 passed / 5 failed files**. One failure was that
affected synthetic G3 read fixture, now fixed and passed in the final focused
group. The remaining preserved historical failures are the old saved
`before-src--test--acceptanceComparison.test.ts` model allowlist assertion, two
generated ForgeBoard `projects.test` suites without `supertest`, and the Node-only
`audit-devstral-latency.test.mjs` collected as an empty Vitest suite. No historical
evidence, test-discovery policy or generated project was altered to hide them.
The full suite was not repeated; no claim of an all-green full suite.

The initial type/build gates exposed two test-only compatibility errors (ES2021
`replaceAll` and imported JSON-schema typing). Both were fixed; final
`npm.cmd run check-types` and `npm.cmd run build` passed. Full lint passed at the
existing **71 warnings / 2 informational notices**, with zero diagnostics in
changed code on focused lint. Production build emitted the existing ineffective
dynamic-import warnings for customExecution/agent/transport/chatRuntime and plugin
timing notice. Diff whitespace checks passed with CRLF conversion notices only.
No checkpoint Rust changes, so no redundant Rust gates; native GUI/provider
verification was not performed or claimed.

Only the two production owners plus the new pure objective helper, scoped tests,
captured fixture and this appendix are committed. All six original dirty paths
remain preserved as unstaged work (including the original unrelated report
hunks), both safety stashes are unchanged, and `autonomous_tracker/` is untouched.
Expected post-commit state: main 67 ahead / 0 behind cached origin/main, empty
index, no additional untracked files. **No push. STOP.**

Recommended next step, requiring separate authorization: **one fresh Nemotron
ForgeBoard rerun under the same 32K Automatic/provider-default controls to verify
the generic F1 repair live.** That rerun and the broader onboarding UX audit were
not started here. `CLACK.md` compatibility principles remain unchanged.

## Live F1 objective-tool continuity verification

Date: 2026-10-20. Starting HEAD: `d81445469a1212eaf83fc12bf8ccaf0aa4ca387c`.
Exactly one fresh Nemotron mission was performed. **Classification: PRODUCT
RUNTIME / PROTECTED CONTEXT BUDGET / INCOMPLETE. Post-correction F1 live acceptance:
NOT EXERCISED.** No new Clack production defect was confirmed. This is not a
completed ForgeBoard result, a model-quality failure, or a live pass for the
post-correction repair.

### Isolation, controls and evidence

- Fresh empty Git workspace:
  `C:/Users/Hayden/Documents/forgeboard-nemotron35-lightning-20261020-02`.
  No seeded implementation or initial commit.
- Fresh evidence ID: `forgeboard-nemotron35-lightning-20261020-02`, under
  `src-tauri/target/real-qwen-product/`. Evidence includes `baseline.json`,
  `endpoint-ready.json`, `freeze-before.json`, `freeze-after.json`,
  `mission-a-1.json`, native report, request/receive/event JSONL,
  `correction-state.json`, durable session data and `audit.json`. Raw evidence is
  local/ignored, not newly committed transcript content.
- Process inspection found no competing Clack acceptance host, Cargo/Rust build,
  Vite test or harness. Existing SSH tunnel process PID 7568 was left unchanged.
  Metadata-only preflight completed with zero inference and zero specifications.
  Mission runner PID 41372 and native host PID 33224 subsequently exited.
- Ollama `0.40.5` through existing `http://127.0.0.1:11435`; exact installed model
  `nemotron-3.5-lightning:30b-a3b-q4_K_M`, digest
  `e7a64ff15fb174c42b4f463e5c888c4f2c7b9cabf9e8d65a1c0874405426c1b2`.
  Artifact 25,430,749,387 bytes, `nemotron_h_moe`, 32.9B, Q4_K_M. Native metadata
  advertised tools/thinking and controls `[false, true, "medium"]`, default true.
- Every one of the 15 native `/api/chat` requests preserved `num_ctx:32768`,
  `num_predict:2048`, Automatic with **no `think` override**, exact model identity,
  Never fallback and unchanged production deadlines. Final loaded-model evidence
  reported context 32768 and the same digest. No model download or cloud inference.
- Full authoritative ForgeBoard specification sent **once**, SHA-256
  `f97ec34eefa136ac5be5847187f768b64bf5587d36140d9fcc53b695fa3e4801`.
  No reminders, requirement resend, manual Continue, tuning, evaluator coding or
  source edits during the mission. All 1044 baseline tracked-file hashes and both
  safety stashes were unchanged at the before/after source-freeze boundaries.

### Chronology, tools and correction boundary

| Observation | Actual result |
| --- | --- |
| Native requests / completed engine responses | 15 / 15 |
| Structured calls / successful tools / failed tools | 15 / 13 / 2 |
| Successful direct source writes | 5 events, 4 distinct paths |
| Confirmed writes counted by correction detector | 4 |
| Material page-size 50 in code or accepted structured plan | Not reached |
| Correction sent / full specifications sent | 0 / 1 |
| Structured todo plans / automatic continuations | 0 / 0 |
| Model-run tests / builds | 0 / 0 |
| First native body / first structured useful tool | 16.593 s / 21.702 s |
| Overall harness observation | Approximately 167.188 s |
| Provider-reported completed output usage, summed | 7323 tokens |

The first shell command was valid for the advertised PowerShell 7 environment:
`cd C:/Users/Hayden/Documents/forgeboard-nemotron35-lightning-20261020-02 && npm init -y`.
The model later used POSIX-style `mkdir -p` with multiple positional paths, which
PowerShell rejected (`call_0y4qptkz`, exit 1). It recovered with separate native
directory commands. `call_e31fq0qr` attempted a validator write before its parent
directory existed (OS error 3); the model created the directory and rewrote it
successfully. Neither failure required evaluator help.

The five successful write events were `src/models/task.ts` (359 bytes),
`src/storage/index.ts` (3802, then 4910 bytes),
`src/validators/taskValidator.ts` (4081 bytes) and `src/app.ts` (2482 bytes).
The conservative correction observer excludes the `models` path, so it counted
four of those events; its other confirmed writes already exceeded three. The
required material page-size 50 was absent, so the correction correctly remained
pending. Prose planning was not treated as an accepted structured plan. No
correction was forced, and there is no immediately-after-correction request.

All 15 requests retained the same 14 tool schemas:
`read_file`, `list_directory`, `write_file`, `create_directory`, `edit`, `grep`,
`glob`, `bash_run`, `bash_list`, `open_preview`, `todo_write`, `request_peer_task`,
`cancel_peer_task`, `propose_custom_tool`. Direct read/create/modify/command paths
remained available. Applying the committed objective resolver to the terminal
durable state still yields **implementation**, the full original ForgeBoard
objective, and required families **read/create/modify/command**. Post-correction
and post-continuation tool sets are **not applicable**, not passing observations.
No live F1 regression was observed; its intended correction-boundary acceptance
remains open.

### Exact terminal boundary and limitations

After request 15 completed and its successful storage write was recorded, Clack
blocked the next request before inference with `compaction-protected-budget`.
The captured production error is authoritative:

| Context component | Estimated tokens |
| --- | ---: |
| System | 3755 |
| Schema/options | 6320 |
| Conversation | 20685 |
| Input total | 30760 |
| Output reserve | 2048 |
| Safety margin | 3076 |
| Required total / ceiling | 35884 / 32768 |
| Deficit | 3116 |

Fourteen schemas occupied 12902 wire bytes. No request 16 was sent. Minimum
estimated headroom among actual native requests was 2055 tokens, not a claim
about exact provider tokenization. All engine responses finished; the last
reported `done_reason:stop`, 1333 output tokens and a tool call. No length finish,
engine stall, request deadline, harness interruption or premature completion claim
caused the terminal state. This new **3116** deficit is separate from the earlier
captured continuation's **4311**, or its repaired counterfactual **5204**.

Offline reconstruction from the full terminal UI transcript also reaches the
protected-budget boundary, but does **not** reproduce the exact SDK cost:
conversation 21808 versus captured 20685, total 37120 versus 35884. It lacks an
exact match of the production projection at that boundary; no accounting defect
is inferred from that mismatch. No memory extraction/retrieval or committed
memory revision was recorded. Effect-receipt summaries were not independently
instrumented, so absence of such summaries is not asserted. Existing B1/C1/G1/M1/
M2, PeerTask, approvals, verified effects, compaction and continuation code was
not changed. The valid hard guard is not itself a newly confirmed Clack defect;
the conditional read-only Part 2 audit therefore proceeded, without a repair or
another mission.

### Independent generated-project audit, without repair

Seven final files exist: `package.json`, `package-lock.json`, `tsconfig.json`, and
the four TypeScript paths above. An independent source-only snapshot was created
at `C:/Users/Hayden/Documents/forgeboard-nemotron35-lightning-audit-20261020-02`.
No implementation was added or repaired. Source hashes in both trees were
unchanged after inspection and verification attempts.

| Requirement | Evidence at terminal state |
| --- | --- |
| Project CRUD/open | Partial create/list/delete code; edit/open absent; not runtime-verified |
| Task CRUD/view | Partial create/list/update/delete code; individual view absent; not runtime-verified |
| Status/priority/tags/timestamps | Types and validation present; not runtime-verified |
| Combined filters and title/description search | Storage implementation present; not runtime-verified |
| Local persistence across restart | JSON storage code for `data/forgeboard.json`; no restart verification |
| Validation/title max 120 | Validator code present; no passing tests |
| Deterministic HTTP errors | Middleware precedes routes; correctness not verified |
| SSE | No actual SSE HTTP route or working delivery |
| React frontend/loading/error/empty/accessibility | Absent |
| Tests/build/README/runtime ignore | Absent apart from npm's failing placeholder test |
| Port 4317 / debounce 750 / material page size 50 or 25 | Absent; correction never sent |

The model ran setup commands (`npm init`, dependency installation and
`tsc --init`), **not** tests or a production build. Independent `npm.cmd test`
failed with "no test specified"; `npm.cmd run build` and `npm.cmd start` failed
for missing scripts. Read-only `tsc --noEmit -p tsconfig.json` using the generated
project's installed compiler failed with **TS5069** (`declarationMap` requires
`declaration` or `composite`). The source also calls a private storage constructor.
No runnable API/frontend or meaningful working ForgeBoard is claimed. These
incomplete artifacts do not convert the runtime context stop into a model-quality
verdict.

## Self-hosted Ollama discovery and model-picker audit

Date: 2026-10-20. Read-only production audit following the preceding mission;
no provider/picker UX implementation or architecture change.
**Classification: SELF-HOSTED DISCOVERY PARTIAL.** Discovery and saved-model
routing exist, but endpoint-once automatic publication of installed models into
the normal picker is not complete.

### Current flow and exact code owners

| Boundary | Production owner and current behavior |
| --- | --- |
| Settings entry | `src/settings/SettingsApp.tsx`; `src/settings/sections/ModelsSection.tsx` Connections & models, Add self-hosted server |
| Server editor | `src/settings/components/SelfHostedServers.tsx:50` and `ServerEditor:137`; connect around 234, selected-model save around 297 |
| Connection save | `src/modules/ai/lib/selfHostedSetup.ts:26` `saveServerConfiguration`; endpoint/profile identity in `selfHostedProfiles.ts` |
| Persistence | `src/modules/settings/selfHostedPersistence.ts`, preferences `updateSelfHostedProfiles`; native `src-tauri/src/modules/self_hosted_profiles.rs` |
| Probe bridge | `src/modules/ai/lib/selfHostedProbe.ts:64` `createSelfHostedProbeClient`; native `src-tauri/src/modules/inference_probe/mod.rs` |
| Discovery/parsing/cache | Native `inference_probe/discovery.rs`, `metadata.rs`, `cache.rs`, `transport.rs`; optional UI `src/settings/components/ServerDiscovery.tsx` |
| Saved picker registry | `src/modules/ai/lib/selfHostedModels.ts:86` `savedSelfHostedModelInfos`; only saved/legacy profiles, not every inventory row |
| Normal chat picker | `src/modules/ai/components/AiStatusBarControls.tsx:240` `ModelDropdown`; same list combines cloud and saved self-hosted entries |
| Chat binding/destination | Existing session profile `modelId`, `useModelSwitch`, full-ID recents/favorites, `connectionPresentation.ts` |
| Inference route | `selfHostedModels.ts:120` `selfHostedTransportIdentity`, `savedProviderModels.ts` `resolveModelTransportIdentity`, native Ollama model adapter |
| Health/context/fallback | `selfHostedHealth.ts`, `useSelfHostedSnapshot.ts`, `contextBudgetProfile.ts`, `store/inferenceFallback.ts` |

The user enters a name, address, server type (default **Not specified**), optional
credential, and private-network opt-in. Connect saves the connection and invokes
bounded metadata refresh. Health and inventory are then probed; this is not an
automatic network scan. Selecting **Ollama** uses its native inventory routes.
Listed model checkboxes plus Save create multiple saved profiles under the same
server. Manual model-ID entry is an alternative, **not required** for discovered
rows. One endpoint can supply N saved picker entries without N server records,
but each desired discovered row still requires selection/save. Inventory alone,
including an unsaved native-detail profile, does not publish it to the picker.

Provider auto-detection is limited. The optional collapsed Discover servers flow
accepts 1-8 explicit candidate addresses and separate private-network consent.
It tries compatible `/v1/models` first; a successful compatible response yields
a generic candidate without an Ollama backend hint. Ollama identification can
occur on its native fallback route when the compatible route is unsupported.
Normal Connect uses the server-type hint rather than promoting an unknown type
automatically. Since the current tunnel answers **both** inventories, a generic
candidate is possible instead of automatic Ollama selection. This is code plus
live API evidence, not a claimed native UI interaction. Choosing Ollama remains
important for native per-request controls and metadata.

### Inventory, metadata, identity and revision boundaries

- Native Ollama uses `GET /api/tags` for installed inventory, selected-model
  `POST /api/show`, and `GET /api/ps` for loaded/runtime context. General Connect
  without a selected model does not walk `/api/show` across the inventory.
- Native probe bounds: six requests, five seconds per route, twenty seconds
  overall, 2 MiB response bodies, 5000 inventory rows and 8 MiB normalized metadata.
  Cache: eight endpoints / 32 MiB, single-flight and stale-generation rejection;
  inventory TTL 300000 ms, runtime-instance TTL 30000 ms. Endpoint configuration
  and private-network consent participate in validity. These are not inference.
- Tags parsing currently drops digest, artifact size and tag-level capabilities.
  Selected `/api/show` normalizes advertised context, vision, trained-for-tools,
  thinking and native reasoning controls. Automatic omits `think`, preserving
  provider defaults; the normalized profile does not retain the raw provider
  default as a separate field. Trained-for-tools metadata is not proof of an
  operational deployed parser: positive tool evidence correctly remains unknown
  until verified, negative evidence can reject support. Structured-output and
  full deployed-engine compatibility are not established by inventory.
- Stable profile identity is `[endpointId, modelId, deploymentId]`, encoded in a
  `self-hosted:` selection ID. Equal tags on different servers remain distinct
  picker destinations and native routes. Aliases are presentation, not identity.
  Session bindings, selected models, recents and favorites preserve full IDs;
  an existing chat is not rebound to a different server by tag alone.
- Evidence is endpoint-configuration/model/deployment scoped, **not digest-aware**.
  A changed digest behind the same tag is not an explicit revision invalidation
  boundary. TTL and reasoning-control revalidation do not substitute for digest
  ownership. Revision-aware capability/recommendation/calibration profiles remain
  an onboarding gap; no redesign was made here.
- Endpoint/profiles and their saved evidence persist. The full native inventory
  cache is in-memory, not a durable all-model registry restored on restart.

### Refresh, disappearance, offline behavior and defaults

Manual Connect/Refresh and selected-model Details are implemented. A refresh can
discover a newly installed model without re-adding the server, but the user must
still select/save it before it appears in the normal picker. Picker opening does
not probe inventory; startup hydrates saved profiles rather than auto-discovering
all servers. Editor mounting reads cache. The client supports stale inspection
refresh and request preflight performs bounded refresh when evidence is missing,
stale/offline or runtime evidence expires; neither path automatically publishes
all new models. No global idle polling is present.

A removed remote model disappears from fresh inventory but its saved picker row
and historical chat identity remain. Current health can still report **Ready**
from a freshly connected endpoint despite the selected tag being absent. The
picker does not yet mark that row unavailable. Original routing is preserved,
not silently substituted: subsequent inference may be blocked by unknown-context
policy or report the original server/model error if sent. Removal was verified
with deterministic fixtures/source inspection, not by deleting a live model.

On connection failure, same-configuration old inventory can remain display-only
and stale; fresh capability authority is invalidated. Health reports **Offline**,
or **Unverified** after cached evidence expires without a new result. Saved rows
can remain visible, without unified per-row unavailable presentation. Reconnect
and refresh exist. There is no guarantee every unavailable tag is rejected
before HTTP, but there is no implicit replacement route. Offline behavior was
covered by fixtures; the live tunnel was not disrupted for this audit.

Advertised context, configured working context, native `num_ctx` allocation and
loaded `/api/ps` evidence are distinct. Automatic does not select an advertised
1M ceiling as a working default; unverified capacity has the conservative 4096
policy. The mission's manual 32K target is not an automatic hardware recommendation.
Passive calibration exists for concurrency/prefill/idle timing only, not a verified
practical-context search. No practical hardware context auto-calibration exists.
Server type, optional credentials/private consent, selected-model saving and
advanced reasoning/context choices still require user decisions. Ready, Unverified,
Offline and other health/error data exist, but a unified per-model capability/
availability picker presentation is incomplete.

### Security and no-cloud boundary

HTTP(S) endpoints are normalized; embedded credentials, query strings and fragments
are rejected. Credentials use keychain references, not plaintext profile JSON.
Configuration changes invalidate evidence, while alias changes do not reset
identity. Private-network consent, metadata/link-local deny rules, guarded DNS,
redirect rejection and bounded native requests remain in force. HTTP warnings,
TLS and authenticated remote endpoint primitives already exist. Native SSH-backed
connection setup/provisioning UX does not; the existing localhost tunnel works
as an HTTP endpoint. The connection-ID abstraction can support future secure
remote adapters without global string-only model routing, but such an adapter
was not implemented or tested. No Ollama restart/rebind, firewall or SSH change
was made; unauthenticated `0.0.0.0` exposure is not recommended.

Missing fallback policy and explicit Never return no fallback. Missing endpoint
identity fails rather than routing by a global model tag. G3 Ask/trusted fallback
is separate explicit policy with destination/data/agent/workspace consent; it is
not an offline/removal/timeout shortcut to OpenRouter. Existing focused fallback
tests cover those guards. The mission made **zero cloud inference**. This is not
a claim that explicitly authorized fallback features do not exist.

### One bounded live read-only connection check

`discovery-live.json` records one five-call integration check through the existing
tunnel: `/api/version`, `/v1/models`, `/api/tags`, `/api/ps` and selected Nemotron
`/api/show`, all HTTP 200, approximately half a second overall. Per-call five-second,
overall twenty-second and 2 MiB response bounds were applied. Both inventory
routes listed **10 installed models**:

```text
nemotron-3.5-lightning:30b-a3b-q4_K_M
north-mini-code-1.0:q4_K_M
muse-glimmer:30b
devstral-small-2:24b
qwen38-iq4xs:latest
qwen38-uncensored:latest
hf.co/HauhauCS/Qwen3.6-27B-Uncensored-HauhauCS-Aggressive:IQ3_M
hf.co/HauhauCS/Gemma4-26B-A4B-QAT-Uncensored-HauhauCS-Balanced-MTP:Q4_K_M
hf.co/HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:Q4_K_M
qwen3-coder:30b
```

Only Nemotron received a metadata-detail query. Later `/api/ps` was empty after
normal unloading, not proof of an offline endpoint. No inference, model pull,
deletion or server mutation was performed by this discovery check. Reading other
installed model IDs is not testing those models.

### Zero-knowledge verdict and focused verification

| Intended criterion | Verdict | Current boundary |
| --- | --- | --- |
| Enter one Ollama endpoint; automatically detect and populate normal picker | PARTIAL | Native discovery works with hint; explicit select/save and limited auto-detection remain |
| One server exposes many models without typing each ID or adding N servers | PASS for selected/saved rows; PARTIAL for automatic publication | Inventory checkboxes feed real normal picker; unsaved rows do not |
| Install another model, refresh, see it in picker without re-adding server | PARTIAL | Inventory refresh works; new row still needs save |
| Ordinary user need not understand routes/wire/context internals | PARTIAL | Native internals hidden, but provider selection/default/practical-context onboarding incomplete |
| Duplicate tags preserve destination, selected chat and recents identity | PASS in focused fixtures | Stable endpoint/model/deployment references |
| Removed/offline model marked unavailable in normal picker | PARTIAL | Health/stale authority exists; removed-model/per-row presentation incomplete |

New `src/modules/ai/components/SelfHostedDiscoveryAudit.test.tsx` adds **7 tests**
using the real picker renderer, saved-model selectors, chat bindings, health,
probe client and transport resolver. Only the closed Radix portal/store-hook
render boundary is replaced; these are deterministic integration fixtures, not
native GUI acceptance. Tests characterize both working behavior and gaps:
inventory/unsaved profiles not published; one-server multiple saved rows plus
cloud; duplicate tags on two destinations; refresh needing save; removed model
still selectable/Ready; offline display versus capability/fallback authority;
expired evidence plus recents/favorites/route identity.

Verification performed in this checkpoint:

- Mission preparation/F1/approval/correction group: **193 passed / 4 files**
  (`toolObjective`, `toolExposure`, acceptance-correction and acceptance-approval).
- Final discovery/picker/routing/reasoning/fallback group: **227 passed / 11 files**,
  including all seven new tests. The two groups are disjoint: **420 distinct
  frontend/script tests / 15 files**. A sandbox temporary-file rename restriction
  initially prevented collection; the authorized focused rerun passed. An earlier
  wrong Node-only invocation was replaced by the configured Vitest runner.
- Native Windows `cargo test --locked --lib --target-dir target/codex-test
  inference_probe::`: **67 passed / 542 filtered**, covering parsing, identity,
  bounded transport/discovery/cache and native controls. No Linux/macOS native
  run or native GUI interaction is claimed.
- `npm.cmd run check-types`: passed. Focused Biome lint: zero diagnostics after
  making the test-only menuitem fixture focusable. Diff whitespace check passed.
  No production changes: full frontend/build/Clippy suites were intentionally not
  repeated, as requested. Historical full-suite failures recorded in the preceding
  checkpoint are not relabeled as passing.

Only this new appendix pair and the new test file belong to this commit. The six
pre-existing dirty paths, including the original unrelated report hunks, remain
preserved as unstaged work; both stashes and `autonomous_tracker/` are untouched.
Production source and `CLACK.md` are unchanged. All owned host/test processes
finished. Expected repository state: main **68 ahead / 0 behind** cached
origin/main, empty index and no additional untracked files. No downloads, no
inference outside the single authorized Nemotron mission, **cloud 0, no push**.

**Single recommended next checkpoint: Implement Self-Hosted Provider
Auto-Discovery and Picker Integration.** It has not been started. This priority
does not close the still-unexercised post-correction F1 live acceptance condition;
no further mission is authorized or performed in this checkpoint. STOP.

## Self-hosted provider auto-discovery and picker integration

Date: 2026-10-20. Starting HEAD: `346fc35`.
**SELF-HOSTED DISCOVERY READY for the Ollama inventory-to-normal-picker goal.**
**Zero-knowledge endpoint-once criterion: PASS** in production native discovery
plus deterministic normal-picker integration. This is not a claim of verified
model inference, practical hardware context, or complete automatic model tuning.
No ForgeBoard mission, model inference, cloud inference or model download occurred.

### Old flow, new flow and owners

Previously: add connection, usually select provider type, Connect, inspect
inventory, select each desired row, Save models, then choose a saved picker row.
Refreshing discovered new rows did not publish them; removed models could remain
Ready. Inventory normalization discarded Ollama revision/size metadata.

Now: Settings -> Connections & models -> Add self-hosted server -> enter name,
address and required credential/private-network consent -> Connect. Automatic
provider detection uses bounded native signatures; successful inventory commits
immediately publish its models to the existing per-chat picker. No model-ID typing
or individual model save is required. Details remains on-demand. An explicit
manual model field remains for providers that cannot enumerate models, not as the
basic Ollama path. Existing manual labels/settings remain supported.

| Ownership boundary | Production owners |
| --- | --- |
| Settings/connection editor | `src/settings/components/SelfHostedServers.tsx`, entered through `ModelsSection.tsx` |
| Durable schema, connection/profile identity | `src/modules/ai/lib/selfHostedProfiles.ts` |
| Existing persistence/CAS and cross-window events | `selfHostedPersistence.ts`, settings `store.ts`, native `self_hosted_profiles.rs` |
| Native detection/inventory/revision merge | `src-tauri/src/modules/inference_probe/{mod,metadata,cache,transport}.rs` |
| Refresh coordination | `selfHostedInventory.ts`, `hooks/useSelfHostedInventory.ts`, App startup and normal picker opening |
| Shared registry/status/destination routing | `selfHostedModels.ts`, `AiStatusBarControls.tsx`; existing session model binding and saved-provider route resolver |
| Favorites/recents | `modelPrefs.ts` plus connection-qualified picker filtering |
| Capability/context integration | Existing `reasoningEffort.ts`, `selfHostedCapabilities.ts`, `contextBudgetProfile.ts`, `requestPreflight.ts`; detected-backend reads and revision/availability guards only |

### Connection, inventory, profiles and binding

The existing version-1 `selfHostedInference` envelope is extended additively, not
replaced by another store. Existing chats and version-1 settings without inventory
remain readable. Repeated loading is idempotent; invalid inventory is isolated on
read and rejected on write rather than silently becoming capability authority.

- **Connection:** durable user configuration, including optional manual
  `backendHint`, observed `detectedBackend`, security/credential reference and
  existing configuration revision. A meaningful configuration edit clears
  detection/inventory authority; alias edits retain identity.
- **Inventory:** optional `inventories[]`, one record per connection/configuration
  revision, containing `observedAt`, `connected`, normalized `backend`, bounded
  error code and model rows. Rows retain exact `id`, optional display name,
  supported/unsupported/unknown chat status and optional `digest`, `size`,
  `modifiedAt`. No conversation, attachments or raw provider response are stored.
- **Profile/evidence:** existing unsaved capability profiles are reconciled by
  stable endpoint/model/deployment ownership. They are not marked `saved`, and
  do not imply manual settings or verified capability. Native inventory and
  profile updates commit together under the existing settings lock/save rollback,
  revision counter, stale-generation check and cross-window event mechanism.
  User labels, overrides and profile identity are retained.
- **Revision:** profiles retain optional `modelRevision` and observed `backend`;
  evidence scopes may retain `modelRevision`. New/different or lost digest, and
  a changed known backend, invalidate old evidence, recommendations and passive
  calibration. Explicit user overrides/labels are retained as user configuration,
  not relabeled as verified capability. Same-digest detail evidence may survive
  only under normal existing TTL/scope rules. Native cache adopts the committed
  detected backend without an unnecessary second probe.
- **Picker/chat reference:** newly observed profiles use
  `self-hosted:[endpointId,transportModelId,deploymentId,modelRevision|null,backend]`.
  Their stable profile ID remains the existing three-part owner tuple. Previously
  used three-part/legacy selections and four-part revision references remain
  resolvable. Exact known old revisions/providers do not follow replacements.
  A historical binding remains unchanged and unavailable until the user explicitly
  switches; missing identity never falls back to a global matching model tag.
- **Route:** resolver returns explicit adapter provider, exact transport model,
  endpoint URL, profile/connection ID, configuration revision, private consent and
  credential reference. Equal tags on two servers remain distinct routes. Recents
  and favorites reconcile unversioned legacy aliases without duplicate rows, but
  never migrate a known old digest to a newer one. Cloud IDs are unchanged.

Inventory models and manually saved rows reconcile to one picker candidate per
profile owner. Custom labels win over provider display names. Old manually saved
rows remain available if discovery is unsupported; after authoritative inventory
removal they cannot remain newly selectable Ready entries. Server deletion hides
only that server's candidates, preserves historical records and prevents reroute.

### Detection, refresh, availability and security

Automatic Connect verifies the Ollama `/api/version` signature and native
`/api/tags` inventory before selecting Ollama. Ports, aliases and model names are
not detection evidence. Native LM Studio schemas are also recognized; ambiguous
or unsupported signatures fall back to compatible `/v1/models` without inventing
vLLM/MLX identity. Explicit provider selection still works and generic compatible
servers remain usable. Automatic mode rechecks native signatures on refresh rather
than treating an old detected family as a permanent manual override.

Ollama inventory retains digest/size/modification metadata cheaply; `/api/ps`
provides loaded-state evidence. `/api/show` remains selected-model/on-demand,
not an all-model walk. Removed inventory entries cannot be recreated as available
merely by a selected-model detail probe. Listing does not certify a deployed tool
parser or all model capabilities. Advertised, configured and runtime context
remain separate. Detected Ollama uses existing native reasoning mappings, including
Automatic omission of `think`; no recommendation or reasoning default was changed.

| Trigger/state | Behavior |
| --- | --- |
| Connect/manual Refresh | Explicit bounded refresh and atomic publication, no model save step |
| Startup/settings hydration | Nonblocking stale refresh of configured live connections |
| Opening normal picker | Refreshes stale inventory without blocking the picker |
| Fresh inventory | Five-minute TTL avoids unnecessary refresh |
| Offline/failure | Display identities retained; thirty-second automatic retry backoff; explicit Refresh remains available |
| Concurrent views | Frontend single-flight plus native cross-window cache/generation coordination; two refresh workers |
| Newly installed model | Next successful refresh publishes it automatically, no server re-add |
| Removed model | Unsaved live candidate disappears; retained manual/history reference is unavailable, never falsely Ready |
| Offline server | Cached candidates are disabled/Offline or Authentication required; historical identity is retained |
| Server online again | Fresh inventory restores candidates under the same identity when revision is unchanged |
| Unsupported enumeration | Manual configured models remain unverified, not falsely offline solely because listing is unsupported |
| Expired capability/inventory | Unverified, not certified Ready; deeper metadata remains on-demand |

Model construction and preflight fail closed for known offline, removed,
incompatible or changed-revision selections. No primary inference is sent by the
new preflight regression cases. Missing policy/Never still permit no fallback;
explicit G3 fallback policy remains separate. Existing B1 budgeting, working
context, timeouts, C1/G1/M1/M2, PeerTask scheduling, approvals and continuation/
effect safeguards were not redesigned or weakened.

Existing metadata limits remain: six requests/handshake, five seconds/route,
twenty seconds overall, 2 MiB responses, 5000 inventory rows and existing native
cache bounds. Persistence remains limited to 256 connections, 2048 total profiles
and a 2 MiB envelope; oversized updates fail without replacing previous valid
state. These limits are not a guarantee all maxima fit simultaneously. History
profiles are retained under existing ownership rather than indiscriminately
deleted when a server goes offline or a tag disappears.

Native URL/DNS/redirect/metadata-IP protections, private-network consent and
keychain references remain authoritative. Refresh never sends browser credentials
as free-form metadata arguments and never broadens network permission. HTTP(S),
TLS and authenticated endpoints remain supported. No SSH onboarding, tunnel,
firewall, Ollama bind/service or remote configuration change was made. No advice
to expose unauthenticated Ollama on `0.0.0.0` was added.

### Read-only live acceptance

At **2026-10-20T01:47:22.850Z**, the explicitly enabled native test used the existing
`http://127.0.0.1:11435` tunnel, a fresh isolated connection record with no manual
provider hint, and production `handshake`/normalization/merge/validation functions.
Result: **connected, detected Ollama, zero errors, 10 installed models**. Only
version, tags and loaded-model metadata routes were used; no selected-model show
walk, model inference, pull, delete or server mutation.

Local ignored evidence: `src-tauri/target/discovery-integration/live.json` and
`live-picker.json`. Native output contains one connection, one inventory and ten
unsaved profiles, with full digest, size and modified metadata. The frontend
integration then hydrated that exact native output and rendered the real normal
`ModelDropdown`: **10 automatic self-hosted candidates plus cloud models, zero
per-model saves**, with each exact selection resolving to the same localhost
Ollama connection. The selected model was not inferred or run. Installed model
IDs matched the preceding ten-model audit; their presence is not model testing.

This is bounded native production-data-flow plus real picker-renderer evidence,
not Computer Use or native GUI clicking. User settings/keychain were not mutated
by the isolated test host. No Linux/macOS native GUI or live inference claim.

### Tests, gates and baseline failures

- Focused frontend group: **360 passed / 1 live-only skipped / 17 files**.
  Covers automatic one/many candidates, two-server duplicate tags/four routes,
  new/removed models, offline/online, digest and provider identity, historical
  bindings, labels/pins/manual compatibility, favorites/recents, stale refresh,
  deduplication, no-inference IPC, consent/credentials, persistence, B1/model
  switching, native reasoning and explicit fallback regressions.
  The post-review picker/favorites subset additionally passed **35 / 1 skipped /
  3 files**, including one new legacy current-selection marker regression. These
  groups overlap and are not added together as independent test counts.
- Native probe group: **77 passed / 1 live-only ignored**, including ten new
  non-live inventory/detection/revision/cache cases and the existing native
  security/transport/cache suite. Explicit live native test: **1 passed**.
  Picker integration using the real captured native data: **8 passed** (seven
  regular audit cases plus the enabled live-data case).
- `npm.cmd run check-types`: passed. `npm.cmd run lint`: passed at the existing
  **71 warnings / 2 informational notices**. `npm.cmd run build`: passed, with
  existing ineffective dynamic-import and plugin-timing notices. `git diff
  --check`: passed. `cargo fmt --check` and strict all-targets locked Clippy passed
  using the isolated `target/codex-test` directory.
- Final full frontend suite: **3107 passed / 1 failed / 1 skipped;
  213 passed / 4 failed files**. All failure files are the known archived/evidence
  issues: Node-only `audit-devstral-latency.test.mjs` collected as an empty Vitest
  suite, generated ForgeBoard source/dist project suites missing `supertest`, and
  archived `before-src--test--acceptanceComparison.test.ts` asserting the old
  model allowlist. No checkpoint-owned frontend test failed; no historical test
  or test-discovery policy was changed to hide failures.
- Full locked Rust suite: **618 passed / 1 failed / 1 ignored**. The unchanged
  `d1_cancellation_timeout_and_revocation_prevent_or_interrupt_work` expected
  `tool-revoked` but received `timed-out`. The failure reproduced alone and on an
  independently archived **committed HEAD `346fc35`** (608 other tests filtered).
  The existing test passes a 10 ms deadline to a biased timer/revocation monitor;
  exact OS timing cause is not claimed. Baseline/current logs are preserved in
  `baseline-d1.log` and `final-rust-tests.log`. No tool execution/memory code,
  timer, safeguard or test was altered. Therefore full Rust is **not all green**;
  the confirmed pre-existing gate failure is documented, not relabeled a pass.
  Temporary extracted baseline sources were removed after preserving the archive
  and log, to avoid duplicating future frontend test discovery.

Final review additionally fixed duplicate carry-forward of the existing
`probe.requestedContext` receipt during inventory-only refreshes; a 100-refresh
native regression keeps exactly one receipt. The former checkbox-label row styles
were retargeted to the replacement wrapper so long IDs retain their flex/wrapping
constraints. The final legacy-selection marker correction preserves the stored
chat ID while showing its canonical current row, with `aria-current` and truthful
status tooltips. Affected gates were repeated after these concrete review fixes;
the live network check was not repeated. Earlier frontend (3106 passed) and Rust
(617 passed before the added regression) logs remain in `initial-tests.log` and
`initial-rust-tests.log`. No unrelated failure was repaired or suppressed.

Only checkpoint-owned implementation, tests and this appended record are staged.
All six pre-existing dirty paths, including the original unrelated report hunks,
remain preserved as unstaged work. Both safety stashes, `autonomous_tracker/` and
`CLACK.md` remain untouched. No user process was terminated. No models downloaded,
no ForgeBoard run, **model inference 0, cloud inference 0, no push**.

Remaining onboarding gaps are intentionally deferred: practical hardware-context
calibration, Automatic reasoning/output recommendations, deeper capability/
engine verification, richer Ready/Unverified/Incompatible explanations and secure
remote/SSH setup. Legacy bindings with no historically recorded digest cannot be
retroactively assigned a verified historical revision. Post-correction F1 live
acceptance remains unexercised; it was not rerun here.

**Next checkpoint: Local Provider Auto-Configuration and Model Onboarding UX.**
It has not been started. STOP.
