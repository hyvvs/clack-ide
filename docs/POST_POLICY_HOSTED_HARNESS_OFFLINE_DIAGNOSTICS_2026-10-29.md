# Post-policy hosted-control harness: offline diagnostics and request-path correction

**Starting HEAD:** `f5188e0ddc34f94ef70024fa96763cb061008706`.
**Status:** **POST-POLICY HOSTED HARNESS INITIALIZATION UNRESOLVED** for full, isolation-proven WebView startup-to-provider-boundary verification. The specific original TypeError **is reproduced and fixed in the harness**; the post-fix native dry run was **not safe/offline** and cannot qualify for READY.
**Production code / hosted output-budget policy changed:** **NO**.
**Fresh hosted notes control authorized:** **NO**; do not run a live control based on this task.

## Exact original failure reproduced without provider dispatch

A new isolated probe was run once using `node scripts/post-policy-hosted-notes.mjs --offline-dry-run=probe`, under `src-tauri/target/remote-controls/post-policy-harness-offline-probe-20261029-01`. A *test-host-only* native `ai_http_stream` rejection and a synthetic exact-model catalog record were active; the probe emitted no provider request.

The preserved error message and complete two-frame Vite stack were:

```text
TypeError: Cannot assign to read only property 'invoke' of object '#<Object>'
    at installWireCapture (http://127.0.0.1:5173/src/test/postPolicyHostedNotesAgent.tsx:81:19)
    at http://127.0.0.1:5173/src/test/postPolicyHostedNotesAgent.tsx:219:16
```

**Failure point:** `installWireCapture()`, initialization immediately after `react-mounted` and before `wire-capture-installed`. The `window.__TAURI_INTERNALS__.invoke` function is present and callable but exposed as a **read-only property** (rather than null or undefined). The original source assignment was `src/test/postPolicyHostedNotesAgent.tsx:62`; the preserved Vite-transformed stack maps it to `:81:19`. The harness assigned `internals.invoke = (command, args, options) => ...`; JavaScript throws on this mutation.

**Completed milestones before failure:** settings loaded; saved OpenRouter selection and model metadata resolved; production `resolveAgentOutputBudget` computed **8192** from reported context **262144**, provider output maximum **32768**, reasoning default enabled and effort capability **unknown/automatic**; keyring read; keys assigned to the session; scratch workspace authorized; live workspace set; agents/sessions hydrated; session created; peer tasks hydrated; React mounted. No SDK send, tool call, provider dispatch or notes mission was reached.

**Earlier-control comparison:** `src/test/strongHostedNotesAgent.tsx` and the original Nemotron/Laguna one-shot runner have identical core settings/keyring/session/React initialization and do **not** attempt to replace Tauri's injected IPC method. The erroneous mutation was added only by the post-policy harness instrumentation. No generic production initialization defect is established.

## Critical downstream discovery: the first verification attempt was not isolated

An initial post-fix WebView dry run, `--offline-dry-run=verify` under `post-policy-harness-offline-verify-20261029-01`, proceeded beyond `wire-capture-installed`, `offline-request-construction`, and `offline-send-returned`. The native `ai_http_stream` observer saw **zero** requests. At first this looked like a construction failure.

**Subsequent inspection found actual assistant output in that session**, including a reasoning segment, a genuine `list_directory` tool response and a visible final answer. This is evidence that hosted inference **occurred despite the explicit no-inference instruction**. The assistant halted all further WebView/runtime dry runs immediately on discovery. There was **no second model**, no notes mission and no ForgeBoard. This failed isolation check is not represented as a passing offline dry run.

**Exact escape layer:** `src/modules/ai/lib/agent.ts:326-330` creates the hosted provider using `preflightFetch((input, init) => globalThis.fetch(input, init), preflight)` unless a special fallback token is present. OpenRouter uses that `cloudFetch` at `agent.ts:403-417`. `requestPreflight.ts:631-647` executes preflight on the body and then calls the supplied fetcher. Thus the hosted provider uses **browser `globalThis.fetch`**, NOT native Tauri `ai_http_stream`. The native test-host blocker could never have isolated this hosted request. The previously added native wire logger was therefore removed as the wrong layer, keeping only a secondary native dry-run rejection guard. No production logic was changed.

**No actual wire receipt exists for the escaped hosted request**, so its exact serialized output control or provider-reported usage cannot be reconstructed from the saved assistant output. Do **not** claim 8192 was observed on the live provider wire, and do **not** count this as a successful controlled hosted evaluation.

## Harness-only fix

- Remove the mutation of `window.__TAURI_INTERNALS__.invoke`. The harness's request observer now wraps **browser `globalThis.fetch`**, the actual hosted adapter's transport. It intercepts only the exact configured OpenRouter Chat Completions endpoint; all other requests pass through unchanged during normal controls.
- Read the final JSON body `init.body` without modifying it, and capture only bounded model ID, numeric `max_tokens`, presence of completion/reasoning-control fields, tool-schema count and byte count. No Authorization header, prompt, tool input or raw body is persisted.
- Check that the model matches the captured selection and that no unsupported effort control was invented. An audit-collector failure prevents dispatch rather than silently losing mandatory evidence.
- Forward the **original input and init objects** to the original `fetch` with the original global receiver. Do not clone or consume request bodies, alter headers or change/consume response streams. Restore original `fetch` on terminal cleanup.
- In **offline** mode, install the blocking wrapper before settings/catalog resolution. Reject *all* non-loopback HTTP(S), including any alternative provider endpoint. Even the expected OpenRouter endpoint records the fully preflighted SDK body and then **throws before calling original fetch**. The native test-host rejection remains a secondary defense only.
- Extract reusable `diagnoseHostedHarnessFailure` that preserves error name, bounded/sanitized message, full bounded stack and last successful milestone. The one-shot collector's final receipt now includes those details. This prevents a future bare `failureClass: TypeError` report.
- The unchanged original 1081-byte notes acceptance specification is still present; neither it nor the independent frozen evaluator was invoked.

## Strictly mocked offline regression results

No WebView/native dry run was attempted after discovering the isolation escape. Instead, `src/test/hostedFetchCapture.test.ts` mocks **all real network** and runs the production Clack provider adapter + request preflight + AI SDK serializer against a function that always rejects before network. Its tests establish:

| Contract | Mocked offline verification |
|---|---|
| Exact Laguna model, fresh default-on reasoning / unknown effort, 262144 context and 32768 cap | Agent allowance **8192** |
| Nemotron-shaped metadata, unknown Clack effort contract | **8192** |
| Provider output maximum 4096 | **4096** |
| Explicit maxOutput 1024 | **1024**, authoritative |
| Unknown/missing reasoning metadata | Ordinary conservative default **2048** |
| Final after-preflight SDK body | JSON `max_tokens:8192` for Laguna and Nemotron fixtures |
| Unsupported `reasoning_effort`, `reasoning`, `include_reasoning`, `max_completion_tokens` | **Absent** |
| Real network/mock-original fetch invoked in dry-run | **0** |
| Non-provider request forwarding | Preserves receiver, arguments and returned Response |
| Audit failure | Fails closed; no provider call |
| Diagnostic failure | Name, message, stack/source location and last milestone preserved |

All results in this table are **unit/integration fixtures**, not live provider-wire evidence. The SDK-visible `maxOutputTokens` is the test input and final `max_tokens` was captured after Clack's real preflight via the mocked fetch boundary. The production build and focused budget/provider/continuation tests also passed; the user-owned dirty files are excluded from the commit.

Validation recorded: **8 focused Vitest files, 169/169 tests PASS**; `npm.cmd run check-types` **PASS**; `npm.cmd run build` **PASS**. The bundle's ordinary ineffective-dynamic-import/timing warnings are nonfatal. No native acceptance or additional WebView inference attempt was run after the escaped attempt was discovered.

## Decision

**The original initialization TypeError is fixed in a model-neutral, nonproduction harness layer.** The distinct browser-vs-native transport mismatch has also been diagnosed and the harness's observer moved to the actual cloud request path.

Nevertheless **do not classify the WebView harness as READY or authorize a new hosted control** yet: a verification attempt already escaped the incomplete offline barrier and issued unrequested model inference; the corrected browser guard has only been proven using network-mocked tests, not a fresh native WebView test. The last safely executed native probe ended before SDK invocation. No generic Clack production defect has been established.

Next authorization, if any, should first address independent network egress isolation for native WebView tests (outside the model SDK and test-host IPC), then run only a content-neutral, truly offline pre-dispatch integration test. No hosted inference, local Ollama, ForgeBoard, notes acceptance, reset, clean or push is part of the remaining task.
