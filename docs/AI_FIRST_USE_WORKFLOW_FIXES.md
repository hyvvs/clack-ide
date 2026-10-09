# First-use AI workflow corrections

Base: `528fe09 fix(ai): preserve provider model capability metadata`.

Scope: the four concrete human-test findings and the destination-consent wording clarification. No new intelligence checkpoint, task dashboard, provider routing architecture, native lifecycle change or push.

## Unknown capacity

Model-switch preparation now preserves whether a context rejection used authoritative/configured capacity or the conservative unknown-capacity policy. `ModelSwitchAssessment.contextCapacity` carries that distinction from the existing B1 budget source to the notice.

- Known insufficient: "This model can't fit the required context for this conversation."
- Unknown: "Clack can't verify this model's context capacity."
- Unknown explains that no request was sent because fit could not safely be verified.
- Arithmetic and provenance remain inside closed Technical details.
- Unknown picker entries remain selectable, not disabled as proven incompatible. The final preflight still blocks unsafe requests; no variant inference, capacity table or budget bypass was added.

## Agent instruction delivery

Tests intercept real serialized OpenRouter requests from the production Chat, transport, agent builder and provider adapter. A custom agent uses the requested `POOPER:` prefix and two-sentence instruction. Assertions inspect the wire system message, not the generated answer.

Verified: bound agent name/instructions, absence of the Coder instruction block for a custom agent, model-switch retention, agent replacement, independent chats, provider retries, explicit step continuation, D2 length continuation and serialized-session restart recovery.

Initial delivery was correct. The concrete defect was that later batches could reread edited agent instructions from the live registry despite retaining the run's agent ID. Run start now captures the name/instructions with session ID, agent ID and start timestamp in an ephemeral map. Only a matching active run consumes this capture; completion/cancellation/failure/deletion releases it. D3 continues to use the transport's existing captured request configuration. Restart retains the persisted conversation agent binding, not an old running inference or instruction snapshot.

Prompt precedence is explicit: Clack core safety, permissions, tools and runtime requirements outrank the active agent. Compatible agent role and response style replace default engineering/style guidance. Global user custom instructions and conversation requests do not override those higher requirements. Runtime authorization remains independently enforced.

Delivery is verified. Reliable obedience by any particular model is not established or promised.

## Step continuation

The actual defect was `consumeAutoContinuation`: the SDK's ordinary post-answer automatic-send check reached this function, which changed any running Ask-mode budget to `soft-limit` before checking whether an automatic continuation was pending. Even a normal completed answer could acquire the banner.

The permission-downgrade branch now runs only for `auto-continue-pending`. Budget recording also requires the unfinished `tool-calls` finish semantics before treating a reported cap as a step continuation. The UI requires a nonbusy, still-running soft-limit batch with that finish reason; completed, cancelled, interrupted and failed runs cannot display the step gate. D2 length and F2 watchdog metadata do not use this affordance. The hard-limit notice likewise requires a live logical run.

Tests cover completion on the final allowed step, normal completion below it, genuinely capped tool work, permission downgrade, explicit continuation, D2 length, D3 failure/interruption/cancellation and F2 watchdog regressions. No tool, approval or effect replay was introduced.

## Assigned tasks and Dispatcher

The existing workspace Dispatcher is the bottom composer target menu. Its retained chat list remains the dispatch target owner; the existing PeerTask store remains the task owner.

Conversation task cards now expose "View task in Dispatcher". A validated ephemeral navigation request opens that existing menu and keyboard-focuses the exact task row. It does not switch the originating conversation merely to show the menu. The Dispatcher lists retained tasks from the requested/current conversation workspace, including completed tasks, alongside its existing chat targets. Rows show the captured recipient agent, understandable status, parent chat and prompt. Selecting a task awaits chat preparation, then opens its authorized parent conversation (or surviving recipient conversation), focusing an already-bound pane or binding the active pane through the existing pane store. Other pane bindings remain unchanged. The existing result, provenance, peer-chat links and review controls remain available. The trigger shows an active-task count. Pane-local feeds remain source/recipient scoped; Chat A's assignment is not displayed as belonging to unrelated Chat B.

No new dashboard, task persistence, scheduler, sharing policy or retention rule was created. Missing/deleted owner conversations remain explicit; navigating does not authorize any new file or artifact access.

## Fallback consent

The checkbox acknowledges destination-specific data transmission, not the Ask routing mode itself. Ask-mode copy now says "I understand that approving fallback allows transmission" followed by the exact-destination qualifier and unchanged data categories. Trusted-mode copy still explicitly authorizes automatic transmission. Destination preview, checkbox gating, configuration-identity validation, revocation and per-attempt Ask approval are unchanged.

## Verification

- Focused group: 13 files, 191 tests passed. Covers notices, actual agent/provider serialization, runtime budgets, Dispatcher navigation, task feeds, collaboration copy, B1, agent compaction/D2, D3 recovery, F2 and G3 fallback. Final navigation review added one pane-isolation test; the resulting 10-test navigation file passed separately, for 192 distinct focused tests in total.
- Final full frontend suite after the pane correction: 184 files, 2,346 tests passed.
- Headless Chromium: `scripts/check-first-use-ai-workflows.mjs`, four cases at 320px/1280px in light/dark themes. Passed fixture assignment, chat isolation, exact task keyboard focus, Enter-to-parent navigation, retained completed result and page-overflow checks. Uses production UI/state/navigation with isolated native/generation boundaries; fixture assignment is not a native task execution claim.
- `npm.cmd run check-types`: passed after correcting unsupported dropdown props and ES-target helper compatibility.
- `npm.cmd run lint`: passed; unchanged baseline of 71 warnings and 2 informational notices.
- `npm.cmd test`: passed.
- `npm.cmd run build`: passed after the same type corrections. Existing four ineffective-dynamic-import warnings and plugin-timing notice remain.
- `git diff --check`: passed.
- Rust unchanged; no Rust gates required for this frontend-only fix.
- Native Tauri interaction, Computer Use and live-provider obedience testing: not performed.

Remaining human-only questions: whether the selected real model follows compatible custom instructions consistently, and whether users find the new visible task path natural in the native app. Automated wire delivery and browser navigation do not answer those questions.
