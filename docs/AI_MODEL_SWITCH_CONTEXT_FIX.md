# Model Switch Context Resolution Fix

Scope: target context resolution and switch error presentation only. No roadmap
checkpoint, picker redesign, prompt reduction, or new conversation architecture.

The sections through Verification record the initial fix at `e5a099f`. The exact
OpenRouter variant follow-up is recorded separately at the end of this document.

## Root Cause

At base `aab2374`, both normal inference and C2 target preparation ultimately used
the same installed provider/model capacity table. That table did not cover all
OpenRouter catalog models, including the Laguna family. Saved selections retained
provider and transport identity, but had no capacity metadata themselves. No live
provider context metadata was resolved. These catalog-only routes therefore used
B1's unverified 4,096-token policy in both paths.

This was not literally every supported target: installed provider models, exact
installed gateway IDs, verified self-hosted deployments, and manual endpoint pins
already had better evidence. A successful historical response is not evidence
that normal inference had verified capacity. Its exact historical budget cannot
be recovered from the supplied partial model ID and error excerpt. The old resolver
classifies the reported Laguna family as unknown; a minimal request can fit the
unknown policy while a subsequent protected preparation request does not.

Switch eligibility additionally assembled its own preliminary limits from saved
models, installed metadata, manual endpoint pins, and a cached self-hosted probe.
It now obtains limits from the actual configured target model instead. That same
model object is reused by target preparation, rather than rebuilding another route.

## Shared Resolution and Identity

`requestPreflight.ts` owns runtime limits for normal send, switching, retries,
continuation, compaction, and the serialized request's final B1 gate.

`providerContext.ts` adds context-only lookup for previously unknown OpenRouter
routes. It consumes exact IDs from the public provider catalog. It does not infer
context from names, strip variants, enumerate picker options, add model-specific
capacity tables, or send chat content or credentials to metadata endpoints.

Bounds: one fixed HTTPS destination, no redirects, cookies or referrer; three-second
deadline including body reading; four MiB response limit; 4,096 records; positive
whole capacities; conservative top-provider bound; validated output cap; duplicate
identities rejected. Successful metadata lasts fifteen minutes in memory; failures
back off for thirty seconds. Concurrent lookups share one request. Installed models
need no discovery. Other providers/endpoints never consult the gateway catalog.
Fallback routes retain cached-metadata-only behavior. Expired capacity is not
retained as proof, and the final send gate rechecks cached evidence before HTTP.

Provider/transport identity is captured before eligibility and model construction.
Self-hosted endpoint/profile/configuration revision and custom endpoint ownership
remain captured by existing routing. Public catalog identity is provider/model
scoped, not a saved display name. Renaming a saved selection preserves capacity.
Capability checks are unchanged: catalog capacity does not certify tool, vision,
audio, document, or reasoning support.

B1 hierarchy is unchanged: deployed evidence first; manual pins keep their
existing precedence, validation against stronger evidence and model bounds;
reported provider metadata otherwise; genuinely unknown capacity uses 4,096.
Public catalog evidence and installed registry evidence are distinguished in
diagnostics. No budget arithmetic, safety margin, output fallback or mandatory
instruction was reduced.

## Representative Automated Results

| Target | Ceiling | Evidence |
| --- | ---: | --- |
| Laguna free variant | 262144 | Exact provider catalog fixture |
| Saved provider variant | 65536 | Exact provider catalog fixture |
| Other catalog model | 32768 | Exact provider catalog fixture |
| Installed OpenRouter route | 1000000 | Installed gateway metadata |
| Native Anthropic registry model | 200000 | Provider registry metadata |
| Deployed self-hosted model | 32768 | Fresh deployed probe fixture |
| Manually pinned self-hosted model | 16000 | Explicit profile configuration |
| Verified small deployment | 4096 | Fresh deployed probe; oversized context blocked |
| Unknown hosted/compatible/absent exact variant | 4096 | Unknown policy; oversized context blocked |

Known sufficient targets switch the same Hello/short-answer conversation without
inference preparation, transcript mutation or changes to another chat. The real
Chat/transport/adapter test sends Hello through Laguna and then reselects it using
the same catalog capacity and unchanged history. Existing cancellation, stale
confirmation, active-run lock, attachment and tool-history regressions pass.

A credential-free public catalog check on 2026-10-09 returned HTTP 200, 469 entries
and 782,083 bytes. It listed Laguna variants at 262,144 or 1,048,576 tokens and
`z-ai/glm-5.2` at 1,048,576. It did **not** list `z-ai/glm-5.2:free`. The absent exact
variant remains unknown; the base ID is not capacity proof for a free variant.
Source: [OpenRouter model catalog](https://openrouter.ai/api/v1/models).

## Input Audit and Presentation

Minimal production wire: core system 2,631, agent 221, recent user content and
structure 15, total 2,867. No project instructions, memory, retrieval, attachment
or exposed schema content in this fixture. The existing real `CLACK.md` fixture
has core 2,631, project 1,545, agent 39, custom instructions 62, environment 51,
history 16, total 4,344. Its full required instructions occur once.

The exact reported 3,337 is not reconstructible without its saved agent/workspace
instructions and transcript. These independent audits demonstrate legitimate
mandatory overhead, not a proven duplication. Nothing was shaved to fit 4K.

Context failure copy now names unknown capacity or genuine insufficient capacity.
Arithmetic, ceiling provenance, target identity and section estimates appear in
closed Technical details. No incorrect instruction to reduce the new request.
Unknown picker entries are not disabled as though proven incompatible.

## Verification

- Consolidated focused regression run: 16 files, 314 tests passed.
- New catalog, capacity-matrix and dialog coverage: 32 tests passed.
- Full frontend suite: 180 files, 2,269 tests passed.
- TypeScript: passed after correcting numeric-union validation and fixture typing.
- Lint: passed, unchanged 71 warnings and 2 informational notices.
- Production build: passed; existing four ineffective dynamic import warnings
  and plugin timing notice remain.
- `git diff --check`: passed (Git's existing LF-to-CRLF notices are not diff errors).
- Rust unchanged; Rust gates not rerun.
- No Computer Use, native GUI interaction or real-provider inference performed.
  The public metadata check is not an inference or native model-switch acceptance test.

No push and no subsequent checkpoint is part of this fix.

## Exact Variant Follow-Up (2026-10-09)

### Gap and Lookup

The broad catalog returned the base `z-ai/glm-5.2`, but not its exact `:free`
variant. The previous resolver had no second lookup after that exact catalog miss.
Selectability and a base-model entry do not establish a variant's capacity.

Unknown OpenRouter routes now use the existing shared resolver with this order:
exact broad-catalog entry, bounded exact-model lookup, then unknown policy. The
documented endpoint is singular `GET /api/v1/model/{author}/{slug}`. Author and
slug are independently encoded, preserving the selected suffix; for this variant
the path is `/api/v1/model/z-ai/glm-5.2%3Afree`. The returned `data.id` must exactly
match the selected ID. Base IDs, aliases resolving to a different ID, malformed
responses and errors do not supply variant evidence.

Source: [OpenRouter exact-model API](https://openrouter.ai/docs/api/api-reference/models/get-a-model-by-its-slug).

### Evidence and Cache

The same parser validates catalog and exact-model context, the conservative
top-provider bound, completion limit, input/output modalities and supported
parameters. Capability arrays are normalized, deduplicated and bounded to 32
items of at most 64 characters. Descriptions and other untrusted model text are
not retained. Missing capabilities stay unknown; an explicitly empty list means
unsupported. Returned capability evidence is copied so callers cannot mutate
cached records. No base capacity, completion limit or capability is inherited.

Normal transport attachment checks, switch eligibility and target commit checks
consume provider/model-matched evidence. Tools, image/audio and structured-output
support retain variant distinctions. Native PDF delivery and reasoning support
are not certified by this metadata change. Current target-context fingerprints
and commit-time limit/capability comparisons retain stale-preparation protection.
B1's arithmetic, unknown 4,096-token policy, safety margin, output reserve and
final request enforcement are unchanged. No instructions or history were reduced.

Successful metadata uses the existing fifteen-minute TTL; misses/failures use
thirty-second backoff. Exact lookups deduplicate per selected ID, with at most
128 cached records and eight outstanding exact requests. Each HTTP request has
a three-second deadline including body reading; an uncached catalog miss can
therefore take up to six seconds across the two bounded requests. Exact responses
are capped at 64 KiB; catalog bounds remain four MiB and 4,096 entries. Expired
cached-only evidence stays unknown. Installed routes remain offline. Other
providers never consult OpenRouter. There is no picker enumeration or request-time
retry loop. All requests are credential-free GETs with no conversation content,
cookies, referrer or redirects. Readers and deadlines are released, and the fetch
is aborted even when headers/status reject a response before a reader opens.

### Live Result and Automated Verification

Credential-free public metadata checks on 2026-10-09 returned:

- Exact `z-ai/glm-5.2:free`: HTTP 404, `Model not found`. Both raw-colon and
  encoded-colon paths returned that result. It correctly remains unverified.
- Exact base `z-ai/glm-5.2`: HTTP 200 with context 1,048,576 and completion
  limit 943,718. This is not evidence for the free variant.
- Exact `poolside/laguna-s-2.1:free`: HTTP 200 with the exact variant ID,
  context 262,144 and completion limit 32,768.

The GLM success tests are explicitly synthetic provider responses, not live
capacity claims. Unit fixtures give the base and variant different context,
completion, tools, structured-output and modality metadata. The real frontend
Chat/transport/adapter integration fixture sends the exact variant with its
1,024-token completion cap and switches with its own 32,768-token context.
HTTP/native operations and settings/session/todo persistence are stubbed, while
the frontend Chat/transport/adapter path is real. Transcript and other-chat
isolation remain intact, and switching performs no inference call.

- Added coverage: 23 exact-variant unit cases and one chat/switch integration case.
- Consolidated focused regression group: 20 files, 374 tests passed.
- Final full frontend suite: 181 files, 2,293 tests passed.
- `npm.cmd run check-types`: passed after fixture/captured-model typing fixes.
- `npm.cmd run lint`: passed at existing 71 warnings and two informational notices.
- `npm.cmd run build`: passed with the existing four ineffective dynamic import
  warnings and plugin timing notice.
- `git diff --check`: passed. Rust is unchanged; Rust gates were not needed.
- Initial sandbox test launch failed before running tests due to a Vitest cache
  rename EPERM. Tests passed with normal host cache access. Final checks were
  repeated only when a concrete typing/lint or metadata cleanup correction required it.
- No Computer Use, native GUI interaction or real-provider inference performed.

Remaining limitation: an exact endpoint failure cannot verify a selectable variant.
No model-specific table, suffix stripping, provider credential discovery, UI
redesign, roadmap checkpoint or push is part of this follow-up.

## Follow-Up: Preserve Provider Capability Evidence

Implemented from `7cccc5d` on 2026-10-09. This is an evidence-retention fix,
not another roadmap checkpoint or provider-discovery redesign.

### Actual Loss Points

The existing OpenRouter settings flow accepted manually entered exact IDs. It
did not fetch a catalog for the picker. `ModelDropdown` enumerated saved model
records, which contained identity and display fields only. Selectability was
not authoritative capacity evidence. Saved-record normalization would discard
extra metadata, and captured transport identities contained only routing fields.
The switch resolver therefore had an ID and a webview-local metadata cache, not
a durable selection-owned capability record. A different window or restart had
to rediscover the selected ID. Active-run reconstruction also dropped evidence
when rebuilding a route from `SessionRun`. The catalog parser retained modalities
and supported parameters but omitted the provider's structured reasoning record.

The broad parser did not strip `:free`, filter free entries, or substitute base
IDs. `canonical_slug` is not used as selected identity; it can name a base or
dated model even when `id` names an exact free variant.

### Shared Representation and Ownership

`providerModelEvidence.ts` owns the shared version-1 normalized record:
`providerId`, exact `modelId`, `origin`, `lookup`, `observedAt`, conservative
`context`, optional `output`, and bounded `capabilities`. Capabilities retain
input/output modalities, supported parameters, and reasoning mandatory/default
flags, supported efforts and default effort. Tools and structured outputs use
the existing capability projection from supported parameters. Reasoning metadata
is retained as evidence, not treated as proof of an R2 adapter/wire contract.

Adding/editing an OpenRouter model obtains evidence using the existing shared
resolver, not a second catalog client. Only the normalized exact record is saved
as optional `SavedProviderModel.providerEvidence` in the existing preferences
store. Saved-model schema version 1 remains additive and idempotent; evidence
has its own explicit version. Legacy records without evidence remain valid and
use existing bounded lookup on demand. An ID edit discards mismatched evidence.
Picker entries, saved/captured routes, normal inference, attachment checks,
switch preparation, target commit checks and B1 consume this same representation.

Settings writes and preference-change events preserve and validate the record
across windows. Slow add/edit lookups recheck current preferences before saving.
An active run captures a defensive copy in an ephemeral session-owned map; it
is released on run completion/cancellation or session deletion and is not copied
into the durable transcript or per-chat run JSON. Restart does not replay it.
No full catalog, description, pricing, attachment, credential or transcript is
added to a saved model. Conversation/model identity and existing locks are unchanged.

### Resolution and Freshness

Fresh, exact selected evidence seeds the existing bounded model cache. Catalog
and cached positive evidence are compared by observation time; newer valid
evidence wins. A failed or stale in-flight exact lookup cannot erase a newer
valid record. A catalog miss/404 in another window cannot erase supplied fresh
catalog evidence. Returned records are copied so callers cannot mutate cache data.

The existing fifteen-minute success TTL, thirty-second failure backoff, 128-model
cache bound, eight pending exact-lookups bound, three-second HTTP deadlines,
four-MiB/4,096-entry catalog bound and 64-KiB exact-response bound remain.
Persisted timestamps do not restart the TTL. Future timestamps, unsupported
versions, invalid numeric limits, malformed capabilities and wrong provider/model
identities fail closed. Expired evidence requires bounded refresh; failed refresh
returns unknown. The singular exact-slug API remains the fallback after a genuine
catalog/cache miss. No suffix stripping, base inheritance, hardcoded model limits,
HTML scraping, credentials or conversation content are used for metadata lookup.
B1 hierarchy, reserves, safety margins, unknown 4,096-token policy and final
request enforcement are unchanged.

### Live Metadata and Fixtures

Credential-free public API checks returned HTTP 200 from `/api/v1/models`, with
469 records and 782,082 response bytes. The catalog included the exact
`poolside/laguna-s-2.1:free` record and the base `minimax/minimax-m3`, but did not
include `minimax/minimax-m3:free`. The existing exact endpoint for that free
variant returned HTTP 404, `Model not found`. Exact Laguna lookup returned 200.
These checks cannot establish the missing MiniMax variant's live capacity.

Sources: [OpenRouter catalog API](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties)
and [exact-model API](https://openrouter.ai/docs/api/api-reference/models/get-a-model-by-its-slug).

Fixtures retain the real API record shape, including canonical slug, architecture,
pricing, top-provider limits, nullable fields, links and reasoning metadata. The
positive MiniMax free record is explicitly a reproduction fixture modeled on that
shape and the user's stated exact capacity, not a captured positive live response.
Its own 1,048,576-token context survives settings serialization, picker rendering,
cold-cache normal send, another-model switch and reselection. Its base record has
its own smaller top-provider bound and different completion/reasoning metadata.
Other variant fixtures cover equal and different capabilities, broad hits, exact
fallback hits, and unknown misses. No production model constants were introduced.

### Final Verification

- Added 27 cases: 20 evidence cases, four settings persistence/event integration
  cases, two cold-send/captured-run cases and one actual picker static-render case.
- Consolidated focused regressions: 30 files, 584 tests passed, including B1,
  F1, C2, R2, attachment capabilities, G3 fallback and normal inference routing.
- Final full frontend suite: 183 files, 2,320 tests passed.
- Typecheck passed. Two test-only `.at()` calls were replaced to match the
  repository's existing JavaScript target; no compiler target was changed.
- Lint passed at the existing 71 warnings and two informational notices.
- Production build passed with the existing four ineffective dynamic import
  warnings and plugin timing notice. `git diff --check` passed.
- Initial sandbox test launch hit Vitest cache-rename EPERM before any tests ran;
  test/build commands passed with normal host cache access.
- Rust unchanged; Rust gates were not required. No Computer Use, native GUI
  interaction, interactive browser verification or real-provider inference was
  performed. The picker check is an automated React static-render fixture.

Known limitation: manually configured IDs are still selectable without provider
evidence. Where both supported metadata APIs lack an exact variant and no fresh
saved evidence exists, its capacity remains unknown; this fix does not fabricate
it. Unknown-capacity warnings and oversized mandatory-context blocks, including
the known-small deployment block, retain their existing behavior. No subsequent
feature checkpoint or push is included.
