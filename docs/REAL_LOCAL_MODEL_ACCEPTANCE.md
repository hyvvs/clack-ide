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
