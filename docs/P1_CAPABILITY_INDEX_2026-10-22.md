# P1 — Capability Contract and Scalable Tool Index

Status: bounded production checkpoint, 2026-10-22. P0 and R1 evidence remain unchanged. Verification is deterministic TypeScript and local Rust; **no live model, remote service, or GUI acceptance**.

## Implementation and ownership

- `src/modules/ai/lib/capabilityIndex.ts` defines a source-qualified metadata contract and deterministic in-memory index (up to **4,096** entries, **64** results per discovery page). The stable ID is an unambiguous JSON tuple `[source, workspace, owner, originalNativeName]`; the callable alias, original upstream name and version/hash revision are separate. Each record captures source/installation ownership, description, available/enabled state, scopes, permissions, non-authoritative effect hints, execution route and output metadata. Original custom-tool input/output JSON schemas are retained; built-in schemas are materialized on demand with the existing AI SDK adapter. Source/owner/workspace/enabled search filters and stable ordering do not depend on F1 candidate size. Duplicate upstream tool names across servers have unique IDs; ambiguous callable aliases cannot resolve.
- `capabilityIndexFromRegistry` describes native registry entries including disabled/removed entries without granting them execution. `capabilityIndexFromTools` describes currently built Agent/custom/MCP/WASI tools. Future local MCP and integrations have reserved source kinds but **no new execution host**. The contract is descriptive; the native registry remains authoritative.
- `providerCapabilityCandidates` builds the index before existing `prepareToolExposure`. Up to 192 candidates retain the original ToolSet. Larger catalogs keep built-in routes and historical/explicitly required names, retrieve bounded metadata matches plus fallback, then submit only chosen **full** schemas to unmodified F1 selection. The v5 192-candidate, 16-optional, context/byte, objective and permission rules are intact.
- Custom tool wrappers retain their original `reference` and now identify the owning workspace. They still call `executeCustomTool` -> existing Tauri `custom_tool_prepare`/`custom_tool_execute` -> native registry, version, workspace/chat, Agent permission, approval and effect ledger. Built-ins retain their existing dispatch. `resolveCallable` rechecks the current ToolSet and revision; neither the index nor its cache can authorize Rust execution.
- Remote MCP discovery now supports **32** tools per connection rather than 16; model exposure still uses F1's 16 optional schemas. Four cursor pages, response wire limits (64 KiB), tool declaration (16 KiB), JSON-schema size (8,192 bytes) and depth, native registry limit (128 entries / 8 MiB) and registry CAS/atomicity remain. Permission/transport/credential/discovery/tool hashes are revalidated in existing native code. MCP results remain text-only (16 content entries / 16 KiB); images, resources and richer MCP results are **not shipped**.

## Deterministic synthetic scale

The catalog fixtures use six coding built-ins plus 48/256/512 custom tools. These figures are Clack's `measureRequest` token estimates, **not** a provider tokenizer. Compact discovery is a single bounded 64-result page, **not** a proposed model prompt payload. Each row held for context policies 16,384, 32,768 and 65,536; no context/output settings were changed.

| Indexed total | Full schema tokens | One compact page tokens | F1 candidates | Schemas exposed | Exposed schema tokens | Mandatory coding routes |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 54 | 6,404 | 5,401 | 54 | 6 | 644 | retained |
| 262 | 31,364 | 5,401 | 67 | 6 | 644 | retained |
| 518 | 62,084 | 5,401 | 67 | 6 | 644 | retained |

The protected coding routes are `read_file`, `write_file`, and `bash_run`, with `list_directory` retained in provider candidates. Search metadata is never promoted to permission authority. P2 may reduce even the compact discovery-page cost using adaptive lookup and activation.

## Verification and boundaries

- Pre-change: 113/113 focused TS tests (five suites) and 106/106 Rust custom-tool tests passed.
- P1-focused: 76/76 TS tests (three suites) and 109/109 Rust custom-tool tests. New Rust fixtures cover two-page **32-tool** discovery; atomic **24-tool** native registration with >32 fail-closed; source-qualified indexed identity mapped to the existing native registry and a **real local file read**; revoked/stale and foreign workspace, conversation and Agent rejections. This is native source/fixture evidence, not a full UI/IPC end-to-end proof.
- Final frontend checks: `npm.cmd run check-types` passed; `npm.cmd run lint` passed with warnings elsewhere in the repository; focused lint of four P1 TypeScript files reported no diagnostics. The Clack-owned Vitest run with explicit exclusions for ignored `src-tauri/target/**` and a legacy no-suite audit script passed: **235 test files, 3,507 tests passed, 11 skipped**. An initial unrestricted `npm test` inadvertently discovered unrelated tests in the ignored P0 CoS checkout and model-generated fixtures and was cancelled; its upstream errors are **not** Clack test results. A prior filtered run also matched one unrelated model-output test and the no-suite audit script; the exact excluded run passed.
- Rust `cargo fmt --check` and `cargo clippy --all-targets --locked -- -D warnings` passed after formatting the P1-owned test files and avoiding a new comparison lint. Full `cargo test --locked` produced **683 passed / one failure / two ignored** in an **existing** 10-ms timeout/revocation race test, both with concurrent frontend work and without it; a serial full run produced the same failure. That test passes in isolation, and all **109/109** relevant custom-tool tests pass. **The full Rust gate remains red**; this P1 checkpoint does not modify unrelated executor timing behavior. No causality from the P1 code to this existing timing test was established.
- Existing native executor tests validate failure/result/effect provenance and MCP hash/authorization integrity. P1 neither changes that ledger nor claims rich resource/image execution. A textual pseudo-tool draft may match a search query; it is never interpreted as a tool-call frame or dispatched.

## Deferred

**Only P2 is the recommended next checkpoint:** adaptive/on-demand discovery, provider-schema activation and measured local-model effectiveness. There is no plugin installer/marketplace, local MCP host, OAuth redesign, generic shell execution, browser/desktop adapter, scheduler, knowledge graph, additional executor, live model rerun, Nemotron tweak or changed F1/continuation/context/output/fallback policy in P1.
