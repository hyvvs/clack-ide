# R5af — model-neutral native-tool request clarification and one coding smoke

Starting commit: `a706406be6138445867f850e6d6a5c686875e8e6`. All work used the existing `qwen3-coder:30b` digest `06c1097efce0431c2045fe7b2e5108366e43bee1b4603a7aded8f21689e90bca`, saved **Automatic** profile `overrides={}`, original tunnel `127.0.0.1:11435`, Ollama `0.40.7`. No model downloads, cloud, remote changes, manual proof/permissions override, synthetic tools, extra ForgeBoard, or retries after negative evidence.

## Evidence and strictly scoped production change

Frozen R5ad Qwen default: one real tool call `native-call/verified` with omitted `think`, 65536/512, one schema. Frozen R5ae Qwen: same native request shape default `text-only`; naturally selected `think:false` emitted one genuine call, but mandatory confirmation was `text-only`, so **no eligibility**. R5x Nemotron default succeeded in a different runtime epoch; R5ab default returned text only, and its alternative was stopped by the acceptance host until R5ac fixed that host. Identical wire shape is **not** the same as identical model response. Historic redacted receipts do not contain full prompt/schema bytes, so byte-level historical equality is not asserted.

Production `TOOL_PROBE_PROMPT` in `src/modules/ai/lib/toolVerificationSchema.ts` already asked for a tool and prohibited prose, but phrased the requirement as a general instruction. The sole production change states that the **next response must be exactly one native function call** with the existing literal arguments and explicitly prohibits textual representations. This is a plausible *model-neutral instruction ambiguity* contributor, **not a proven root cause**. The canonical `get_probe_value` strict Zod schema, normal `streamText` + native Ollama serializer, actual `tool-call` SDK events and argument validation remain unchanged. Nothing forces tool choice or controls temperature, top-p, reasoning, output budget or tool execution. All original proof/negative/confirmation/backoff/runtime epoch/permissions/F1/continuation rules remain.

Offline: `npm run check-types` **PASS**, four focused Vitest suites **143/143 PASS** (Ollama adapter, production-derived request serialization, native tool verification, Automatic Agent confirmation). New tests assert the actual canonical native tool set, wire prompt, omitted Automatic `think`, unchanged no-temperature serialization and identical `think:false` request on confirmation, and reproduce/persist the R5ae `text-only -> native-call -> text-only` **fail-closed** case without fake eligibility.

## Three bounded *real* Qwen qualification sequences

Fresh independent native acceptance-host runtimes, each copied from the prior **actual saved state**, starting from R5ae's failed records. No negative evidence reset, no `force`, no replaced proof, no override; previous accepted proof only permits preparing the next new runtime, where production re-establishes its own context/epoch and proof. Each completed all six ordinary calibration contexts (4096 through **65536**, loaded and trusted), and used the unchanged production five-request verification budget.

| Run | Verification requests after 6 calibration requests | Real native verification calls | Text-only responses | Final |
| --- | --- | ---: | ---: | --- |
| `qwen-native-r5af-20261024-01` | Default Automatic 65536/512; `think` omitted | 1 | 0 | **PASS: default verified** |
| `qwen-native-r5af-20261024-02` | Default Automatic 65536/512; `think` omitted | 1 | 0 | **PASS: default verified** |
| `qwen-native-r5af-20261024-03` | Default `text-only`; authorized `think:false` native call **and second confirmed native call**, exact 65536/512 and same schema | 2 | 1 | **PASS: alternative confirmed and eligible**, default negative retained |
| **Total** | **18 calibration + 5 real native verification requests = 23**; all native receive receipts completed | **4** | **1** | **3/3 complete sequences qualified; 0 transport failures** |

Proof scopes are different host runtime epochs, and previous R5ae alternative failure was preserved. **Do not interpret 3/3 as statistical proof or claim the prompt change caused the difference.** The third run still shows default inconsistency. No textual pseudo-calls were accepted.

Ignored native evidence: `src-tauri/target/real-qwen-product/qwen-native-r5af-20261024-0{1,2,3}/`, each with `qualification-N.requests.jsonl`, `qualification-N.receive.jsonl`, actual isolated `data/terax-settings.json`, calibration gate, native report and evidence journal. New workspace roots are Git-only, never ForgeBoard.

## One authorized small Agent coding smoke

Single separate `qwen-smoke-r5af-20261024-01` Mission A used Clack's existing real Coder `AgentRunBridge`/native workspace tools/approval harness, preserved original full ForgeBoard mission source (unmodified), with a **different, deliberately small** Node/TypeScript local notes API prompt. It inherited trial 3 settings **unchanged**, then obtained a fresh 65536 context calibration and a fresh default `native-call/verified` under its **own new runtime epoch**, without importing or asserting an old proof. Native requests **17 total: 6 calibration, 1 default tool verification, 10 genuine Agent-generation requests**, each Agent wire with **18 native tool schemas**, 65536/2048 and Automatic omitted `think`; native host completed normally. Agent session persisted `state=completed`, `totalSteps=10`, `continuationCount=0`, `lastFinishReason=stop`, 0 outstanding Todos, no R5aa logical continuation (not exercised). Actual Agent/native tools wrote `package.json`, `package-lock.json`, `tsconfig.json`, `src/index.ts`; an npm-installed `node_modules` folder also exists. Exact *number* of SDK Agent tool calls is not retained by this privacy-redacted report; claim only **confirmed real file effects**, not an invented exact call count.

Frozen source snapshot: `src-tauri/target/real-qwen-product/qwen-smoke-r5af-20261024-01/frozen-source-manifest.json` (four files + SHA-256 hashes, excluding `.git` and dependencies; snapshot SHA-256 `cc36ddae2e3865491f49ee605c7ac8e580f68b8798fb9b5ef7fad42ea4f87236`). Independent evaluator: `independent-smoke-check.json`, which reconfirmed **all four source hashes unchanged** after testing. No app code was repaired.

| Independently executed acceptance | Verdict | Grounded result |
| --- | --- | --- |
| Real Agent invocation/native writes | **PASS** | 10 real Agent generations; original workspace now has a `src/index.ts` API source and npm files |
| `npm test` | **FAIL** | Exits 1 with default `Error: no test specified`; no authored test suite |
| `npm run build` | **FAIL** | Missing `build` script |
| `node_modules/.bin/tsc --noEmit` | **FAIL** | `TS5108`: `moduleResolution=node10` removed by installed TypeScript 7 |
| `node --experimental-strip-types src/index.ts` | **FAIL** | Named type export `Application` unavailable at runtime from CommonJS `express` |
| Notes API CRUD, validation and restart persistence | **BLOCKED** | Backend did not start; no independent API acceptance possible |
| README | **FAIL** | Not generated |
| Source integrity | **PASS** | Frozen four author files byte-identical after evaluator; no manual fix |

**Observed conclusion:** the prompt clarification is compatible with real verified native calls and yields **3/3 scoped qualification successes**, but default call adherence is still not universal and causality cannot be isolated. Clack correctly allowed the small Agent run to proceed. This demonstrated real native Agent generations and app file writes, **but NOT working software**: the Agent terminated `completed/stop` without implementing executable tests, build script, or runnable startup. This is now the first visible delivery blocker. It may reflect coding/model behavior or Clack's completion/plan workflow; the frozen evidence does not establish a Clack defect.

**Single next step (requires new authorization):** focused offline investigation of the frozen smoke Agent finalization/completion path to determine why an Agent can end `completed` with zero Todos and no requested tests/build; make an evidence-based, model-neutral completion improvement, then separately validate one small real app before full ForgeBoard. No ForgeBoard now. R3d packaged desktop **OPEN**; the full security/integration/E2E/real-Agent/Windows/Linux/macOS P2–P19 roadmap remains **MANDATORY / DEFERRED**. **STOP.**
