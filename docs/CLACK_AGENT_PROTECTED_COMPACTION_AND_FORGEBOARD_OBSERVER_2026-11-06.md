# Offline audit: protected Agent compaction and ForgeBoard correction observer

**Starting HEAD:** `a07300e7e77cf8cd2aa4775d3dd080e6f7c9cc1e`.
**Scope:** preserved `forgeboardmuse-20261106-01` and current production source. No model, ForgeBoard, Ollama request or external inference. No generated-application edits, timeout changes, archive mutation or second frozen evaluation.

## A. Terminal identity, measured evidence and decision

The only selected model was `muse-glimmer:30b`, SHA-256 digest `de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1`, via local Ollama 0.40.11. The final recorded runtime epoch was `38668:1793932002228212500`. The Agent's current native context tier was **49,152**, with native proof ID `f40c6f9e-7383-48dd-97f9-9f1bcbebc323` at 49,152, status `verified`, expiry `1794019263588`, bound to the same digest and runtime epoch. Other 32,768 and 73,728 native proofs also existed, but were **not** silently substituted for the selected tier. No generic unverified 4K fallback occurred.

Active calibration record: `b4658204-543e-4a01-b509-6b8cdfcae562`, status `verified`, highest 49,152, updated `1793933941701`, expiry `1793934841701`, same runtime epoch. At the final trust observation `1793934435039`, measured `probe.requestedContext` was 49,152 observed `1793934433462`, and `probe.loadedContext` and matching runtime-allocation evidence were observed `1793934434073`. Both long-session renewals had succeeded normally. The persisted Agent had **58 steps across four logical continuations**. Its final successful native inference was `inference-70`, with actual `num_ctx=49152`, `num_predict=6144`, seven native tools and no explicit `think` field; Clack failed **before** any inference-71 dispatch. The continuation number at the terminal boundary is the fourth logical continuation (one initial batch plus four continuations), not a fifth continuation.

The persisted terminal error's `details` is diagnostic **estimated input** rather than an actual tokenizer receipt. It records:

| Exact field | Estimated tokens |
| --- | ---: |
| System total, including core and Agent instructions | 4,814 |
| Schema/options total, including exposed tool schemas | 2,819 |
| Conversation total, including original requirements and Agent/tool history | 32,005 |
| **Total input** | **39,638** |
| **Protected Agent output reserve** | **6,144** |
| **Safety margin: ceil(0.10 × 39,638)** | **3,964** |
| **Total capacity required** | **49,746** |
| **Verified selected ceiling** | **49,152** |
| **Remaining headroom** | **−594** |

The sum `39,638 + 6,144 = 45,782` leaves **3,370** tokens before margin, not after margin. `resolveContextBudget` additionally reserves the **3,964** token uncertainty margin. The resulting maximum conversation allowance is `49,152 − 6,144 − 4,814 − 2,819 − 3,964 = 31,411`, versus 32,005 required: **594 too many**. This reproduces exactly with the real production `resolveContextBudget` in `lateCompactionBudgetRegression.test.ts`. There is **no second measurement snapshot needed to explain the discrepancy**. The diagnostic breakdown also mentions core 3,398, Agent 1,416, built-in schemas 2,776, environment 338 and other structure 495; those are *categories within/overlapping* the three top-level totals and must **not** be added a second time. The exact original pinned-tool outputs and conversation token allocation to individual steps were not emitted in the stored terminal budget, so a finer subdivision of 32,005 is **not available**.

`src/modules/ai/lib/contextBudget.ts:169–205` calculates `margin=max(128,ceil(input×0.1))`, `available=min(ceiling−reserve,inputCap)−system−tools−margin`, `working=max(0,min(workingTarget,available))`, and `fits = !uncertainMedia && available>=0 && conversation<=working`. `src/modules/ai/lib/compactionPlan.ts:421–428` applies **exactly**:

```ts
const protectedMessages = assemble(tailStart);
const protectedBudget = budgetFor(protectedMessages);
if (!protectedBudget.fits)
  throw new CompactionError("protected-budget", /* original preserved error */,
    protectedBudget);
```

The `CompactionError` prefix turns this into `compaction-protected-budget`. This is a **correct fail-closed predicate**: do not remove user requirements, unverified effects, latest plan, pinned evidence, reserved output or safety margin to make an unsafe dispatch fit.

## Compaction lifecycle and trigger arithmetic

The Agent `prepareStep` at `agent.ts:1356–1420` first performs any due calibration renewal, independently selects currently authorized tool schemas and their identity, then calls `preparedContext.prepare(stepMessages.slice(finalMessages.length), selection.schemas)`. Inside `conversationCompaction.ts:359–449`, Clack reads current limits, identifies confirmed writes, optionally requests/validates a genuine Ollama write checkpoint, builds a plan and may seek separately corroborated write sources. `compactionPlan.ts:299–459` groups complete original UI messages and paired tools, retains original user instructions and protected/unresolved effects, computes the conservative budget, and determines whether a bounded history extraction is necessary.

The compaction policy is **trigger 0.70**, **target 0.55**, **tail fraction 0.20**, max **4 extraction chunks**, max **4,096 generated extraction tokens** and extraction response allowance **at most 1,024 tokens per call**. For the observed final budget's 31,411 working conversation tokens, indicative occupancy thresholds are **21,987.7** (trigger), **17,276.05** (target), and **6,282** (20% tail target). These are capacity policy thresholds, **not** independent evidence of a successful extraction at the terminal event. The selected Agent tier remains 49,152, with full 6,144 output reserved and 3,964 margin at the observed terminal estimate.

If the plan is eligible and its **protected** projection fits, Clack loads the source-preserving memory, extracts bounded evidence via `createBoundedExtractor` (its own system/prompt and output budget), commits verified claims only after `planCompaction` checks, reloads and revalidates the memory revision, and composes the next request. Any separately staged *target-context* snapshot has a full identity-bound hash (model, digest, runtime configuration, output-budget contract, tools, permissions, workspace, credentials) and must be revalidated; that model-switch staging flow **did not occur in this run**. The live Agent's final protected-budget failure happened **before** source extraction inference, new memory commit, target-context staging/key comparison, or subsequent pre-dispatch validation. Therefore this incident does **not** establish a target-key mismatch, stale digest, runtime-epoch mismatch, expired calibration/native proof, or a 4K trust fallback. The earlier target-key fix remains intact.

## Earliest-safe-boundary investigation (private preserved-session replay)

Original UI history comprised **two persisted messages**: one user requirements message and **one assistant UI message containing all 58 Agent steps**. Each safe logical continuation appended steps into that same assistant message. `conversationCompactionUnits` builds one unit per UI message; `groupCompactionUnits` protects user/system units, unmatched/failed tool results, approvals, and the most recent valid `todo_write` plan. The assistant message contained successful plans as early as step 2, as well as failed commands at later steps. **Consequently every historical step in that one assistant UI message was covered by one protected compaction unit.** The planner cannot summarize only earlier steps within that unit.

The private offline replay `src-tauri/target/real-qwen-product/late-compaction-audit-20261106-01/replay.test.ts` executed the actual `conversationCompactionUnits`, `groupCompactionUnits`, `planCompaction`, `measureRequest` and `resolveContextBudget` functions on original persisted UI parts truncated at steps **12, 23, 24, 27, 28, 29, 30, 36, 42, 52, 53, 56, 57 and 58**. Each reconstructed grouping yielded exactly the two protected UI units: indices `[0,1)` and `[1,2)`. At earlier steps some protected requests fit; later ones do not. **No earlier compressible complete assistant UI group existed** under the current actual grouping rule. A smaller context or one-generation-earlier invocation does not make an otherwise protected original eligible for extraction. This is not a made-up live inference: all tests operated offline on frozen evidence.

**Precise previous-generation headroom and first trigger instant are unavailable.** The previous inference-70 was dispatched with correct 49,152 and 6,144 settings, which proves its final pre-dispatch admission passed, but its exact pre-dispatch `system/tools/conversation` cost, protected subset, extra transient messages, per-step summarization state and schema serialization were not persisted as B1 budget receipts. The replay's simplified system/tool schemas therefore produce **different numeric costs** and must **not** be reported as historical request headroom. What is established is the structural grouping: the latest-plan protection made a scheduling-only threshold shift incapable of compacting the original one-assistant-unit history. Production does not intentionally wait for zero headroom; it checks against 70% of working tokens, but no eligible whole-unit summary existed. Whether a **larger generic redesign** (provenance-safe step-level grouping, separately verifiable tool-effect retirement or anchored partial-memory extraction) could have compacted earlier is **unresolved**; there is no basis for introducing such a change within this bounded task without evidence of safety and successful continuation.

### Offline controls and limitations

| Requested scenario | Evidence and result |
| --- | --- |
| Exact preserved terminal state | **PASS:** production budget function reproduces 594 deficit; exact SDK unit grouping tested against private preserved session; full exact system/tool message reproduction unavailable |
| Slightly smaller earlier context | **PASS for fit only:** some earlier protected requests fit, but eligible summary remains absent |
| One generation earlier | **PASS for grouping:** earlier 57-step history remains a single protected assistant group; its exact live headroom is unavailable |
| Selected 49,152 tier maintained | **PASS:** verified real native proof and replay ceiling |
| Changed digest blocks | **PASS in existing current-source target-key/native trust tests; not live-replayed here** |
| Changed runtime epoch blocks | **PASS in current-source trust/pre-dispatch suites; not live-replayed here** |
| Calibration expiry requalifies/blocks | **PASS in current-source calibration-renewal regression suite** |
| Output reserve preserved | **PASS:** 6,144 never silently shrunk in budget controls |
| System/tools/pinned requirements retained | **PASS:** real `groupCompactionUnits` and latest-plan controls |
| Compaction never exceeds trusted tier | **PASS:** context-budget/current-proof/compaction controls, no implicit higher tier |
| Successful compaction permits continuation | **PASS for generic *eligible* multi-message case in existing integration suites; impossible to assert from this original two-group session** |
| No repeated compaction loop | **PASS for eligible multi-message covered-memory test; original protected session cannot safely compact** |

**Classification: `COMPACTION PROTECTED-BUDGET FAILURE UNRESOLVED`.** The failure was correctly fail-closed, but there is not enough evidence to prove that a *safe* earlier compaction was available with Clack's existing whole-UI-message provenance contract, nor to certify that no alternative generic orchestration design could solve this recurrent situation. In particular, no `GENERIC CLACK LATE-COMPACTION BUDGET DEFECT PROVEN` claim is warranted and no speculative production Agent change was made. The user should not be given a further live-run recommendation until this issue is demonstrably resolved with faithful end-to-end offline continuation evidence.

## B. Exactly-one-mission ForgeBoard correction observer

The `forgeboard-muse-instrumented-one-20261106.mjs` launcher is **already one-shot**: it asserts `phase === "mission-a"`, exact run owner, exclusive workspace and an unchanged model/mission. The frontend `src/test/forgeboardMuseAgent20261104.tsx:609–669` creates the original conditional `/correction` observer and same-session correction dispatch. The previous `if (config.realProduct?.singleSpec || alreadyCorrected || correcting || harnessStop) return;` conflated a historical “single-spec” acceptance mode with **suppression of observation**. The last accepted run supplied `CLACK_PRODUCT_SINGLE_SPEC=1`, so **zero correction-observation checkpoints** occurred even while the Agent authored source files. There was no confirmed eligibility decision in that run and no correction sent. The problem is **harness coupling**, not an intentional invariant of the production Agent or the accepted correction criteria.

The minimal acceptance-only fix introduces `src/test/forgeboardCorrectionMode.ts` and changes only the observer gate to ignore `singleSpec`, while still stopping monitoring for `alreadyCorrected`, a correction already being dispatched, or an existing harness stop. The original ForgeBoard mission and correction strings are unchanged. The actual `scripts/acceptance-correction.mjs` observer is untouched: it continues to require **at least three independently confirmed authored writes** plus **a current actual page-size-50 source implementation OR qualifying active plan**, then atomically claims dispatch, records exactly one new user correction in **the same session**, and rejects duplicate messages. This is not a second ForgeBoard mission; the actual launcher still prohibits separate phases/mission replay.

Offline controls: `node --test scripts/forgeboard-correction-observer.test.mjs` **3/3 PASS**, using the real observer and bounded temporary genuine file effects; `src/test/forgeboardCorrectionMode.test.ts` **2/2 PASS**. Tests cover one-shot restrictions, active observer with `singleSpec=true`, no premature correction, three confirmed writes plus 50, active plan eligibility, no page-50 refusal, one dispatch claim, duplicate rejection, and suppression after correction or harness stop. No network request or Agent inference used.

## C. Verification and recommendation

- Reconstructed preserved-session private offline test **1/1 PASS**, with only source fixture data read from the frozen archive and output under a new ignored audit root.
- Generic safety controls `src/modules/ai/lib/lateCompactionBudgetRegression.test.ts` **6/6 PASS**: exact formula, protected failed tool and live plan, real fail-closed, successful eligible history coverage/no repeat loop, original 49K capacity and 6K output reserve.
- Relevant current-source Agent compaction/context budget/native proof/context preflight/target key/calibration/model-switch suites: **36 current-source test files, 664 PASS, 2 SKIPPED** with `--exclude=**/src-tauri/target/**`. Historical archived snapshot tests are not current-source regressions. An earlier unfiltered discovery also included old archive failures and a current test timeout under duplicate parallel load; this was not used for the current-source verdict and no timeout was increased.
- `npm run check-types`: **PASS**. `npm run build` (`tsc && vite build`): **PASS**, only ordinary bundler dynamic-import warnings.
- No Ollama, service, model, inference, host, generated app, original frozen evidence, runtime timeout or hidden context capacity modified. No reset/clean/push.

**`ONE FURTHER FORGEBOARD RETRY JUSTIFIED: NO`** — the correction-observer blocker is fixed, but the Agent's long-running protected-context continuation problem is **not yet safely resolved**. Do not launch it without a further separately authorized, proven generic remediation.
