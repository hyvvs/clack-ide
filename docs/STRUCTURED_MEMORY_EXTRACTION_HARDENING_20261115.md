# Structured conversation-memory extraction hardening — 2026-11-15

Engineering checkpoint: `STRUCTURED_MEMORY_EXTRACTION_HARDENED` (offline production-source validation, subject to the final checks below). Baseline committed HEAD: `8329b0361effee1eec018648c44661caf27aeef3`. This checkpoint does **not** rerun ForgeBoard, invoke the independent evaluator, or infer from the production Ollama model. Production fixes remain uncommitted pending separate authorization.

## Historical campaign 08: exactly what the evidence proves

Source: frozen `src-tauri/target/real-qwen-product/forgeboard-prod-muse-20261115-08/` journal, native request metadata, saved Agent session and terminal receipt. Campaign 08 completed 25 native requests, but its logical Agent finished `failed` with `compaction-invalid-output` (not the previous `compaction-protected-budget`).

| Field | Attempt 1 | Attempt 2 |
| --- | --- | --- |
| Native request | `inference-24` | `inference-25` |
| Reason | `initial` | `validation-retry` (exactly once) |
| Source groups offered to extractor | 8 | 8 |
| Protected groups | 3 | 3 |
| Estimated *conversation* input | 6,435 tokens | 6,435 tokens |
| Output allowance | 1,024 tokens | 1,024 tokens |
| Context allocation | 32,768 tokens | 32,768 tokens |
| Reasoning wire field | omitted (Automatic/provider default) | omitted |
| Native wire summary | nonstreaming; no tools | same |
| HTTP/SDK settlement | HTTP 200; native settled; SDK response parsed | HTTP 200; native settled; SDK response parsed |
| Semantic/shape validator | invalid, historical reason `schema` | invalid, historical reason `schema` |
| Deadline | within individual 120-second allowance | within individual 120-second allowance |
| Durable memory publication | none | none |

The 6,435 tokens are the preserved `budget.cost.conversation` estimate, **not** the complete model input including schema/system/margin/reserve. Raw provider-request bodies, generated memory text, JSON `format` and fine-grained JSON/Zod failures were intentionally not persisted. The model may have returned malformed JSON, a wrong object shape, invalid field values, or an empty answer; the historical evidence cannot distinguish these. Native HTTP frame byte counts are not model-output text lengths. Historical source `generateText` used no `Output.object`, response schema or native tool for extraction. Both attempts used the original prompt unchanged, and the second received no validation-category feedback. No original conversation history or protected evidence was discarded or replaced.

## Contract audit and deterministic field ownership

The strict publication schema is a top-level object with required `claims` array (max 64); each item is a nested object with **six required properties** and no extras. Required semantic fields remain `section` (11 allowed values), `text` (1–2,048 chars), `quote` (1–2,048 chars), `status` (`inference` / `unresolved`), `contradicts` (up to 32 existing claim identifiers, each 1–256 chars). The original required sixth field `source` was a model-produced 64-character hexadecimal evidence ID. The new required sixth field `sourceIndex` is an integer 0–127, indexing only the provided nonprotected source array. Nesting depth, claim-count bound and all semantic constraints remain unchanged. No model-output property is optional.

**A — model-authored semantic evidence:** `sourceIndex` identifying the supplied source (authoritative ID is resolved by Clack), section, bounded interpretation text, exact contiguous source quote, inference/unresolved status and contradiction identifiers that must already be in `existingClaims`. These fields are still independently validated, including exact source-quote containment and coverage of *every* supplied nonempty model source. User/system instructions are **not** exposed as model sources; deterministic exact user claims remain separately protected.

**B — runtime-authored authority and bookkeeping:** authoritative SHA source evidence ID and digest, source revision, source locator, prior source hashes, related sessions, content IDs, generated claim ID, claim source-ID list, observation timestamp, memory revision ID and creation time, transcript/profile revisions, checkpoint/CAS generation, preparation owner, workspace identity, coverage boundaries, native proof and effect reconciliation. These come from validated runtime state, not model output. Attempts to supply extra fields, fake evidence indexes, stale runtime revisions or contradictory unknown IDs are rejected; no model-generated metadata can override them. Prior claim IDs are exposed *only* as an allowlist for semantic contradiction references.

Source quote equality alone does **not** prove natural-language interpretation or section choice. The validator can enforce exact quotes and coverage, preserve unresolved user obligations and completed-effect authority, and reject invented references, but cannot prove all implicit semantic claims from unstructured prose. No unsupported claim of universal semantic completeness is made. Where semantic source coverage remains ambiguous, original protected history and independent runtime obligations stay authoritative until a fully validated memory commit.

## Production changes

1. The model-facing source envelope now contains `sourceIndex`, role and source passages only; it omits redundant 64-hex source IDs and digests. Original native evidence/identities are retained and mapped back after validation. The shorter prompt makes untrusted-source/data and runtime-metadata boundaries explicit.
2. On a **native Ollama model only**, the installed AI SDK's `Output.object({schema})` sends an actual JSON Schema `responseFormat` mapped by Clack's existing Ollama adapter to native `/api/chat` `format`. Non-Ollama paths retain their existing text behavior. This uses no new provider, no separate tools or trust assertion. A native tool-call surrogate was not chosen: tool calling does not force a valid memory result and is not a replacement for independent semantic validation.
3. The generated native schema is charged by the production budget estimator (`format` contribution) **both** during source selection and each extraction/repair attempt; the existing context, margin and output limits remain unchanged. SDK schema parsing does not bypass Clack's exact source, coverage, contradiction or runtime-authority validator. A structured SDK failure containing original text is reclassified in memory under the same strict validator; its raw text is never logged or used as retry guidance. Absent mandatory SDK usage accounting fails closed.
4. Future invalid-output telemetry distinguishes bounded, content-free reasons: JSON syntax, missing/wrong/extra fields, enums, size limits, unsupported source index, wrong quote, prohibited protected source, nonexistent contradiction and missing coverage. The historical `schema` category is **not** retroactively refined.
5. Exactly **one** permitted validation retry remains. It adds a *fixed* category-specific instruction, no untrusted response text, parser error string or source echo. It re-runs source/authority/preflight and provider request guards. A second invalid result remains terminal `compaction-invalid-output`, and no incomplete memory revision is published.

## Measured source/contract footprint (offline estimate, not a live Muse wire sample)

The baseline schema below is the old Zod schema reconstructed from committed source; old extraction did **not** transmit it as a provider format. New schema is the actual source-generated schema; the SDK uses a semantically identical Draft-07 variant on the Ollama request (Zod's exported schema defaults to Draft 2020-12).

| Measurement | Before | After |
| --- | ---: | ---: |
| Model system prompt UTF-8 bytes | 1,000 | 1,018 |
| Prompt conservative token estimate | 490 | 499 |
| Zod JSON schema UTF-8 bytes | 869 (not transmitted) | 879 (now transmitted) |
| JSON schema token estimate | 505 (not transmitted) | 505 |
| Required model claim fields | 6 | 6 |
| Model-generated source authority | 64-hex ID | bounded source index |
| Eight-source example user-envelope bytes | 13,833 | 12,777 |
| Eight-source conservative conversation estimate | 6,777 | 6,377 |
| Eight-source total model-input estimate, including newly billed native format | 7,280 | 7,270 |
| Native format billed in the new estimate | no | 381 tokens |
| Same eight-source retry model-input estimate | not corrective | 7,312 tokens |
| New example and retry within 32,768 tier with 1,024-token reserve and existing margin | — | yes |

These figures use the deterministic Clack estimator, synthetic equivalent eight-source passages and committed baseline source. They are not a 1:1 reconstruction of the exact campaign 08 message body, which was not preserved. The primary improvement is **constrained syntax and trusted field ownership**, not a large reduction in total tokens or relaxed semantic checks.

## Regressions and retained authority

The campaign-08-shaped offline test uses eight model sources, three protected groups, approximately 6.4K extraction conversation tokens and the original 32,768/1,024 request limits. It tests a fenced/invalid first JSON result, categorical bounded retry, valid extraction of all indexed sources, exact quote grounding, deterministic source-ID and timestamp attachment, native-style memory CAS publication, original user obligation preservation and subsequent continuation. Negative cases reject two invalid JSON responses, missing-source/unresolved coverage, invented indexes, extra forged revision metadata, changed native source revision, cancellation and partial results. Existing tests exercise stale source reads, native CAS revisions, failed effects, rebase, provider recovery, calibration, authority, combined retry budgets, permission and workspace reconciliation.

The fake-HTTP provider regression uses **real SDK `generateText` and production `createOllamaModel`** with intercepted `fetch`: it proves the native request carries `format` JSON Schema, `num_ctx=32768`, `num_predict=1024`, no `tools`, `stream=false` and `think` omitted. It proves the same schema remains on the one corrective retry and the semantic validator still runs. **This is offline provider-contract proof, not a claim that a new real Muse generation complied with the schema.** No ForgeBoard campaign or actual inference was run during this checkpoint.

Validation results and preservation audit are recorded in the final task report. No Rust code changed; Rust tests are not required.
