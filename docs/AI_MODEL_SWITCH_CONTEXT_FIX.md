# Model Switch Context Resolution Fix

Scope: target context resolution and switch error presentation only. No roadmap
checkpoint, picker redesign, prompt reduction, or new conversation architecture.

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
