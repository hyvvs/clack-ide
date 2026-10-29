# Production-grade hosted notes control — prerequisite audit

**Starting HEAD:** `b43691e0156b3eb82fd7b3d2de2bd248dfb99956`.

**Classification:** `PRODUCTION-GRADE HOSTED CONTROL PREREQUISITE MISSING`.

**Control run / provider inference / notes acceptance / ForgeBoard:** **NONE**.
**Production code, harness, configuration or credential changes:** **NONE**.

## Decision and scope

The successful live-policy wire proof and failed frozen Laguna notes acceptance at the starting HEAD remain final. The model used `max_tokens:8192` on all eleven live outgoing requests, with the last response exhausting the allowance on reasoning. The current task does **not** repeat Laguna, rotate to Nemotron, increase the allowance or change the insufficient-progress safeguard. It evaluates whether one *already configured*, materially stronger **paid and production-grade** hosted coding model is available to test the unchanged notes mission.

**No such model is currently configured.** Stop before any inference, Tauri/WebView launch, new one-shot acceptance directory or independent evaluator execution. Merely having an OpenRouter key or a built-in model catalog entry does **not** establish a paid service or an explicitly configured model.

## Existing Clack production integration

Source of truth: `src/modules/ai/config.ts`, `src/modules/ai/lib/agent.ts`, `src/modules/ai/lib/keyring.ts`, and `src-tauri/src/modules/secrets.rs`.

| Hosted provider | Existing runtime adapter |
| --- | --- |
| OpenAI | `@ai-sdk/openai` |
| Anthropic | `@ai-sdk/anthropic` |
| Google | `@ai-sdk/google` |
| xAI | `@ai-sdk/xai` |
| Cerebras | `@ai-sdk/cerebras` |
| Groq | `@ai-sdk/groq` |
| DeepSeek | `@ai-sdk/openai-compatible` |
| Mistral | `@ai-sdk/openai-compatible` |
| OpenRouter | `@ai-sdk/openai-compatible` |
| Custom OpenAI-compatible endpoint | `@ai-sdk/openai-compatible` |

Local `lmstudio`, `mlx`, and `ollama` also exist but are **not** eligible hosted providers and were not invoked.

Clack exposes native workspace-tool schemas through the common Agent path; tool support of a specific external model and actual provider execution must still be verified when legitimately configured. The catalog includes paid coding candidates, including `claude-opus-4-7` under Anthropic and `gpt-5.3-codex` under OpenAI, but catalog presence is **not** evidence of configured access.

## Operator configuration — read-only observations

Read-only parsed metadata from the existing `%APPDATA%/app.clack.dev/terax-settings.json` (original file contents not printed):

| Saved selection | Enabled | Tier | Current saved context/output and native-tool/reasoning evidence |
| --- | --- | --- | --- |
| `openrouter` / `minimax/minimax-m3:free` | Yes | Free | Not established from saved evidence |
| `openrouter` / `z-ai/glm-5.2:free` | Yes | Free | Not established from saved evidence |
| `openrouter` / `poolside/laguna-s-2.1:free` | Yes | Free | Not established from current saved evidence; **historical live control** separately verified context **262,144**, provider cap **32,768**, default-on reasoning, and native tools |
| `openrouter` / `nvidia/nemotron-3-ultra-550b-a55b:free` | Yes | Free | Not established from saved evidence |

All four are ineligible under the user's no-free-model-fallback rule. None has a fresh, trusted context/output/reasoning capacity record in the *saved configuration* suitable for a new paid selection; no limits for an unconfigured model were inferred.

One custom OpenAI-compatible endpoint is configured as **HTTP loopback** with model ID `auto`, rather than a named external paid service. Its custom context setting is **128,000**, but no independently verified actual model/output cap or production-grade external route is identified. It is ineligible.

Windows Credential Manager is the normal underlying Windows keyring backend (`secrets.rs`), with service identities `clack-ai` and legacy `terax-ai` (`keyring.ts`). A read-only `cmdkey /list` **target-metadata-only** check, restricted to both Clack service names and each provider's account name, found:

- A stored credential **entry target** for the normal OpenRouter provider.
- A stored credential **entry target** for the local custom endpoint.
- **No indexed matching entry targets** for direct OpenAI, Anthropic, Google, xAI, Cerebras, Groq, DeepSeek, or Mistral, or the generic OpenAI-compatible provider account.

This is a metadata/index existence check, **not** proof of a readable/valid secret, billing, API entitlement or availability; key material was never requested, returned, printed or persisted. No credential-store writes or legacy migration occurred. The original settings were not edited.

## One recommended future control, once the operator legitimately configures it

**Recommendation: direct Anthropic `claude-opus-4-7`, through Clack's existing production Anthropic integration** (not selected or run here).

The model is already listed in `config.ts` with `reasoning`, `tools`, and `coding` tags, and Clack already constructs it through `createAnthropic` without custom integration. Clack has a model-specific verified Anthropic effort-control mapping in `reasoningEffort.ts`. The vendor's published Claude Opus 4.7 specification lists **1,000,000-token context**, **128,000 maximum output tokens**, adaptive thinking and native tool use on the paid Claude API. Source: https://platform.claude.com/docs/en/models/opus-4-7/overview (model/service availability must be reconfirmed at setup). This makes it materially stronger and more suitable for a reliable coding control than a free-tier OpenRouter endpoint; it does **not** predict a passing notes result.

**Important distinction:** Clack's currently hard-coded `getModelContextLimit` table lists `claude-opus-4-7` as **200,000** for its trusted application-side bound, so the vendor's 1M advertised capacity is **not** automatically the context Clack will select. The provider's actual runtime output allowance also has **not** been measured for this unconfigured candidate. Do not change policy or limits speculatively; verify their existing production resolution and exact serialized provider control if a *future* run is authorized.

Operator must, without sharing the secret with the audit/report:

1. Obtain legitimately billed **Anthropic Claude API** access and verify that the exact `claude-opus-4-7` ID is enabled and appropriate rate/usage limits exist.
2. In normal Clack **Settings → Models**, securely configure the Anthropic provider API key in the application's native credential store, and select the already-supported exact model in the normal model chooser/profile.
3. Verify configured provider/model identity, normal genuine native tool support, model context/output ceilings and reasoning contract, and provider billing/availability without changing a frozen historical run.
4. Obtain a new separate authorization for **exactly one** notes control, with unchanged mission and independent one-shot evaluation. A future harness must support the selected provider's native request serialization and content-safe evidence without treating the prior OpenRouter-specific `max_tokens` observer as universal.

**Repository integration changes required to support this candidate: NO** — provider and catalog entry already exist. A separately authorized *test harness configuration/capture* adaptation could be necessary because the existing one-shot script pins Laguna/OpenRouter and the OpenRouter-only fetch observer. Do not touch production networking, policies, the existing guard or archived evidence to bypass that.

## Evidence limits and preservation

No network or model endpoint was contacted. No inference/request serialization, token usage, tool call, continuation, retries, Agent terminal result or frozen notes evaluation exists **for this task**. Laguna's prior `NOTES_APP_FAIL` is not reused as evidence about Anthropic or Clack's behavior under a stronger paid model. Therefore **no new Agent-orchestration redesign conclusion is supported**: the stronger-hosted-control experiment remains unperformed.

All original six protected dirty tracked files, the two existing Git stashes, `autonomous_tracker`, original settings, historical local-model/Nemotron/Laguna/post-policy evidence and the previous fair failure classification must remain unchanged. **STOP: `PRODUCTION-GRADE HOSTED CONTROL PREREQUISITE MISSING`.**
