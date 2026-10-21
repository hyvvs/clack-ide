# CLACK.md

Clack is a Tauri 2 + React 19 + Rust IDE/agent app forked from Terax.

## Project Rules

- Product name: Clack.
- Package manager: npm. Use `npm install`, `npm run check-types`, `npm run lint`, `npm test`, `npm run tauri -- dev`, and `npm run tauri -- build`.
- Tauri build hooks must stay on `npm run dev` and `npm run build`.
- On Linux NVIDIA Wayland, if normal Tauri dev launch has Wayland, GDK, or GBM failures or severe WebKitGTK lag, use `npm run tauri:dev:linux:nvidia`. It sets `__NV_DISABLE_EXPLICIT_SYNC=1` for that dev process only. `WEBKIT_DISABLE_COMPOSITING_MODE=1` is a last resort because it can be very laggy, and `WEBKIT_DISABLE_DMABUF_RENDERER=1` may still be laggy.
- Native Arch packaging uses `/usr/bin/clack` as a compiled launcher for `/usr/lib/clack/clack-bin`. The launcher conditionally applies the NVIDIA Wayland workaround to the Clack process only, preserves existing values, and supports `CLACK_DISABLE_NVIDIA_WAYLAND_WORKAROUND=1`.
- Standard AppImage, deb, and rpm bundles do not automatically use the native Arch launcher. Do not claim that the workaround is active in those artifacts without equivalent package-specific launchers and manual verification.
- Keep the Linux launcher and Arch package isolated from Windows NSIS and macOS packaging. Do not add Linux graphics variables to Tauri configuration or desktop entries.
- The central workspace is for editor, preview, markdown, AI diff, git diff, and git history tabs.
- Terminals are real PTY-backed sessions rendered in the bottom dock, not center editor tabs.
- Do not replace xterm.js, PTY streaming, shell cwd tracking, WSL behavior, terminal tabs, or terminal splits with mock UI.
- Keep explorer, editor, source control, preview, AI chat, approvals, provider settings, and workspace switching functional.
- No fake visible controls. Incomplete features should be hidden or wired to real behavior.
- The authoritative implementation plan for multiple models per provider, conversation-owned agent/model/workspace identity, and inter-agent collaboration is `docs/AI_MULTI_AGENT_BUILD_PLAN.md`. Follow its phases in order, update its status ledger as work lands, and do not revive provider connection IDs or live model discovery unless the user explicitly changes the scope.

## Local Provider Compatibility Principles

- Automatic may choose a directly verified supported provider configuration for Agent tools; it does not necessarily mean no wire override. Preserve provider defaults as metadata, keep recommendations capability-scoped, and never replace an explicit user choice.
- The product goal is excellent compatibility across many capable local/self-hosted models, not selecting one winner and optimizing Clack around its family. An ordinary user should be able to connect a provider, choose a discovered model and use evidence-based recommended settings without understanding engine internals.
- Separate genuine model limitations, provider/engine limitations, valid capabilities Clack fails to understand, Clack runtime/tool/context/state defects, discoverable configuration gaps, and benchmark/harness limitations. Preserve uncertainty; another model working does not exonerate Clack. A valid capability or protocol Clack cannot consume is a compatibility gap, not evidence of a bad model.
- Prefer provider metadata -> normalized capabilities -> validation -> truthful UI choices -> runtime serialization. Avoid production model-name branches. A model-specific compatibility entry requires evidence of a genuine nonstandard defect that cannot be represented generically.
- Preserve the mixed-reasoning normalization pattern: boolean controls, named levels and mixed forms retain their actual legal wire semantics. Do not force heterogeneous metadata into one brittle representation or fabricate supported options.
- Evolve the existing persistent profile infrastructure toward provider + endpoint + model identity + model revision/digest ownership. Relevant evidence includes context limits, tools, structured output, exact reasoning controls/disable support, vision/attachments, output limits, route/protocol, engine compatibility and verification status. Invalidate/revalidate evidence when the identity or revision changes; do not create a competing architecture during a benchmark.
- Keep advertised maximum, configured working context, provider-loaded context and last verified practical context on the inference hardware distinct. Automatic is evidence-based, never a guess or an automatic choice of the advertised maximum. Recommendations may use current revision metadata, bounded verification and previously verified practical settings.
- Provider onboarding should ultimately health-check the endpoint, discover installed models, read native metadata, normalize capabilities and persist scoped evidence. Where metadata is insufficient, bounded non-mutating probes may verify capabilities; clearly label advertised versus verified results. Never infer capability from model family/name or add unrequested live probes to an unrelated checkpoint.
- Normal settings should expose supported normalized choices, recommendations and truthful Ready/Unverified/Incompatible/Needs-attention status. Native routes, context wire fields, reasoning serialization, templates, tool reduction and compaction accounting belong behind the compatibility layer or in advanced settings. Do not add speculative UI during benchmark work.
- A provider on a second machine is a first-class self-hosted scenario. Future connection UX must prioritize authentication, safe setup, discovery, health and clear status without requiring unsafe network exposure or weakening security. The existing development SSH tunnel remains valid test infrastructure.
- Managed remote transport must never weaken provider exposure or change SSH/service/firewall configuration. Forward only to the explicitly configured remote loopback service; direct HTTPS remains first-class.
- Persist logical connection/model identity independently of resolved tunnel ports. SSH host identity changes fail closed, withdraw availability and preserve profile/chat history rather than silently transferring trust.
- Restore managed SSH only on demand. Consumers share one native connection attempt and independently releasable leases; cancellation must not close another consumer's active transport. Windows Job Objects and a parent-pipe guardian on POSIX own tunnel cleanup without saved-PID or port-based process kills.
- Never silently fall back from local/self-hosted inference to cloud. Fallback requires explicit user policy; local acceptance evidence must record cloud inference count.
- Benchmarks identify both model quality and compatibility gaps. Keep operational rankings provisional and setting-specific. A generically repaired compatibility gap warrants a fair, separately authorized rerun; do not hide the gap with a model-specific workaround or repair-and-resume the same attempt.
- Respect each checkpoint's boundaries and stop rules. A confirmed new Clack defect must be preserved and handled separately, not patched to finish a benchmark. These principles do not authorize extra model runs, downloads, broad UI work, context calibration, timeout changes or model-specific tuning.
- After North and Nemotron sampling is complete, the next dedicated audit is **Local Provider Auto-Configuration and Model Onboarding UX**. Map existing capabilities and gaps in discovery, calibration, per-model persistence, remote-provider UX, Automatic/advanced settings and failure states before implementing broad UI changes. Do not start that audit prematurely.

## Long-Horizon Context Principles

- Prefer deterministic, reversible representations of verified history over lossy freeform summaries. Keep exact originals source-linked and recoverable; never replay an effect to recover evidence.
- User intent and corrections remain authoritative independently of workspace contents. Historical tool success does not prove current file state, passing validation or requirement completion.
- A compact representation's byte-level reversibility is necessary, not sufficient: enforce source ownership, dependency retention, provider continuation semantics and freshness before production use. Preserve current partial answers and unresolved evidence; fail closed when safe context cannot fit.

## Verification

Run the relevant subset before claiming done:

- `npm install`
- `npm run check-types`
- `npm run lint`
- `npm test`
- `npm run tauri -- dev`
- `npm run tauri:dev:linux:nvidia` for NVIDIA Wayland dev launch issues on Linux
- `npm run tauri -- build`
- `cargo test --manifest-path packaging/linux-launcher/Cargo.toml --locked`
- `cargo clippy --manifest-path packaging/linux-launcher/Cargo.toml --all-targets --locked -- -D warnings`
- `cd src-tauri && cargo fmt --check`
- `cd src-tauri && cargo clippy --all-targets --locked -- -D warnings`
- `cd src-tauri && cargo test --locked`
