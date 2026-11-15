# Tool, Research & MCP Fabric — foundation and acceptance boundary

Status: incremental TF foundation on top of the LM2B/LM2C compute fabric.
This document is a current implementation map, **not** TF0–TF25 sign-off.

## Authority and execution path

`ModelDeployment → buildRuntimeTools → permission policy → F1 exposure → AI SDK tool call → original executor → result / receipt → existing conversation and Agent continuity`

- The existing `capabilityIndex.ts` is the only unified capability catalog. It
  normalizes stable source-qualified names, callable revision, semantic operation,
  side-effect and permission classes, authentication/latency/cost and availability.
  Its metadata is **not** a permission grant.
- Built-in filesystem, repository and terminal tools retain their native
  execution and workspace boundaries. Custom/MCP/WASI tools retain T1's
  per-workspace revisions and T2's native captured-version execution ledger.
  Discovery cannot substitute an executor.
- `discover_capabilities` searches only the authorized, captured, currently
  executable toolset. It does not grant access, connect an MCP server, expose
  arbitrary input schemas or bypass the next inference's F1 selection.
- F1 maintains mandatory dependencies and keeps ambiguous optional schemas
  bounded rather than dumping all registered tools into small contexts.
- `deploymentToolEncoding` distinguishes a proven native Ollama tool deployment
  from an unqualified declaration. No fake JSON or grammar tool encoder exists.

## Read-only web research

- `fetch_web_page` and `compare_web_sources` call the native
  `research_fetch_page` route, not browser `fetch` or arbitrary model HTTP.
- Native transport allows **public HTTPS GET** documents only: pinned DNS,
  rejects private/loopback/cloud metadata addresses, nonstandard ports and
  credential-bearing URL parameters, no redirects, proxy, cookie store, custom
  authorization, HTTP mutation or automatic retry.
- Native payload is bounded to 64 KiB and a 15-second deadline; parsed text is
  further bounded to 12,000 characters and untrusted HTML is stripped.
- Each successful retrieval yields URL, source title, millisecond retrieval
  timestamp, excerpt SHA-256, truncation, `unverified` confidence, scoped owner
  and a content-derived evidence ID. The evidence is data, not instructions,
  proof of source truth or an automatic AR durable-memory promotion.
- Both tools share four page attempts per session/user turn across same-process
  inference rebuilds and provider recoveries; failures consume attempts.
  Budget capacity is fail-closed. The budget counter is currently in memory and
  is **not** restart-durable.
- Web fetching uses the new `research-network` permission category; Ask and
  Trusted Workspace require a fresh action approval. Chat Only denies.
  Permission grants cannot persist for future arbitrary destinations.

## MCP

The already-shipped native MCP 2025-06-18 Streamable HTTP client remains the
single MCP implementation. Connection creation, assignment, authentication,
consent, schema hash, revision, revocation, tool-call approval, execution
ledger and error handling remain native-owned. Local-process MCP launchers
remain unsupported. An MCP server describing its own tool as read-only does
**not** cause Clack to treat its possible external effects as trusted.

## Continuity and actual receipts

T2 custom-tool execution records retain captured tool version, exact argument
hash, permission/approval, lifecycle transitions, result and effect state.
Existing Agent/provider recovery checks these native records and rejects
uncertain effects instead of replaying them. This TF slice also ensures a
revoked tool is checked before racing a short execution timeout.

Research evidence currently appears in the original tool result transcript.
It is **not** automatically copied into a new permanent AR evidence ledger;
the mission's durable claim-to-source/decision linkage is future work.
Similarly, built-in commands and filesystem effects have their existing
native/Agent receipts, but TF13's single unified authoritative effect ledger
for **every** implementation source is not yet implemented.

## Explicitly incomplete

1. First-class **query-based web search**, rankings and independent search
   provider operation: no general search engine/backend was installed or
   fabricated. Already-authorized MCP servers may supply search.
2. Full bounded autonomous research orchestration, domain-authority ranking
   and per-claim source verification beyond the separate retrieved receipts.
3. Browser/computer interaction and local-process MCP runtime.
4. JSON Schema/grammar tool-call execution adapters; declared support is not
   accepted as verified tool encoding.
5. Restart-durable research budgets, all-source authoritative TF13 effect
   receipts and validated AR claim/decision promotion.
6. Live production internet/MCP acceptance, third-party account activation,
   empirical tool torture across multiple real models and measured small-model
   improvement versus unbounded schema dumps.

Do not claim complete Roadmap TF exit from offline tests or the presence of a
capability contract alone. All new research results are untrusted until
source/claim validation; all mutations remain governed by Clack's original
authorization and effect-reconciliation mechanisms.
