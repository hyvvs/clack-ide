# LM2D–LM2F: Clack-managed local GGUF deployments

This document covers the first directly owned inference runtime, the exact
local deployment picker, and cross-runtime qualification. It does **not**
advance Roadmap TF. The accepted TF foundation at
`acd4583ce67df8bec6510930dab5e2b0d22bd1c8` remains intact.

## Decision record: one first runtime

The selected engine is **ggml-org/llama.cpp `llama-server`**, serving GGUF.
The first version contract is **b12248**, an upstream release dated 2026-11-10
(source commit `3837bf0`). The first enabled inference configuration is
**single GGUF, CPU, text Chat**, with bounded context and an OpenAI-compatible
`/v1/chat/completions` transport. This does not equate grammar or JSON Schema
support with native-tool qualification.

| Technical / operational factor | llama.cpp / llama-server | vLLM (alternative considered) |
| --- | --- | --- |
| License | MIT; preserve license notices if distributed | Apache-2.0 |
| Windows + Linux | First-class prebuilt x64 CPU on both; broader architectures exist | Linux requirement; native Windows unsupported, WSL alternative |
| CUDA | Official CUDA builds on Windows and Linux | Powerful CUDA support on Linux |
| CPU fallback | First-class GGUF CPU runtime | CPU support depends on specialized installation/architecture |
| Streaming and cancellation | OpenAI-compatible Chat SSE; client abort + native proxy cancellation | Streaming and client cancellation available; larger server stack |
| Context control | `--ctx-size` | Runtime model/configuration options |
| JSON Schema / grammar | Server constrained JSON/grammar parameters, model-specific validation needed | Structured generation available with its own constraints |
| Tool strategy | Server may format tool calls; not treated as native-tool verified without **deployment-specific** proof | Native tool integrations are model/template-dependent |
| Process lifecycle | Standalone executable can be native child with bounded log, health and shutdown | Python/PyTorch process and runtime environment increase management burden |
| Binary provisioning | Explicit release binaries; pin archive + executable digest before install | Python packages and framework-specific dependencies |
| Maintenance burden | Maintain GGUF header compatibility and a small, audited CLI/API contract | Larger Python/CUDA/environment/version integration surface |

References:

- <https://github.com/ggml-org/llama.cpp/blob/master/LICENSE>
- <https://github.com/ggml-org/llama.cpp/releases/tag/b12248>
- <https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md>
- <https://github.com/vllm-project/vllm/blob/main/LICENSE>
- <https://docs.vllm.ai/en/stable/getting_started/installation/gpu/>

**Intentional CPU-first limitation:** llama.cpp supports CUDA and other GPU
backends upstream. This first Clack-managed deployment does not yet select GPU
libraries or allow nonzero `n-gpu-layers`; that configuration is explicitly
rejected rather than pretending CUDA is qualified. A future GPU deployment
requires an independently pinned bundle and a material configuration identity.

## Secure provisioning contract

The native code does **not** inspect PATH for a runnable `llama-server`.
It does not silently download engines or model files. The Settings button
**Install approved runtime ZIP** is user-initiated, and verifies two
compile-time release-approval values:

- `CLACK_MANAGED_LLAMA_BUNDLE_SHA256`: lowercase SHA-256 of the exact approved
  release ZIP; built from the official b12248 upstream release, for the
  target OS/architecture/CPU profile, including its runtime dependencies.
- `CLACK_MANAGED_LLAMA_BINARY_SHA256`: lowercase SHA-256 of the
  `llama-server.exe` (Windows) or `llama-server` (Linux) file at the ZIP root.

Both values must be embedded by a controlled Clack release build **after
upstream asset provenance and digests have been independently verified**.
They are intentionally **not populated** in this source tree; no unverified
release digest is an acceptable default. Thus ordinary development builds
correctly report **Not Installed** even if an executable of that name is on
PATH. Never replace this contract with a user-entered hash.

The archive is bounded (256 entries, 4 GiB extracted), rejects traversal and
symlinks, verifies the executable against the compiled digest, extracts into
a staged temporary directory under Clack private app-local data, and renames
atomically. A corrupted existing installation is not silently overwritten.
Each launch re-hashes the installed binary. The packager must also carry
the upstream MIT license, notices and third-party redistribution notices.

The first integration accepts an approved **ZIP** of the appropriate platform
binary and dependencies. It does not implement automatic release fetching,
patching, cross-platform TAR provisioning or in-app upgrades. A package with a
different archive layout is **Unavailable**, not silently executed. Release
packaging must supply the matching ZIP layout and pins for each platform.

## Local import, artifact evidence and deployment identity

`Add Local Model → select GGUF → inspect → explicitly Import & register →
Start exact deployment`.

Inspection reads a bounded GGUF header (v2/v3), then streams SHA-256 through
the entire file. Reported family, name and context are accepted **only** when
read from parseable metadata. Quantization or parameter count without reliable
metadata stays **unknown**. In particular, a `Q4_*` filename is not proof
of quantization. A file whose magic/header cannot be parsed is rejected.

The user explicitly chooses **copy**, not reference-in-place: source bytes
are never modified. Import verifies the digest again while copying to a
temporary private file, then atomically installs under
`<Clack app-local-data>/managed-local-runtime/models/<sha256>.gguf`.
Duplicate content is deduplicated by SHA-256. A removed/moved *original* file
does not break the imported model; a missing or tampered *private import* is
detected before process launch. No source file path is persisted as a model
identity.

One authority remains `SelfHostedState.fabric` through the existing native
compare-and-swap. No competing model/provider persistence registry was added.

```text
ComputeHost:       clack-this-pc
  LocalRuntime:    clack-managed-llama.cpp
    ModelArtifact: ["digest","sha256:..."] (format=gguf)
      ModelDeployment: ["managed-gguf", digest, canonicalMaterial]
        Qualification: deployment + observed engine/process/version/epoch/digest
```

Exact saved selection: `managed-local:` plus JSON tuple of
`[deployment.id, deploymentIdentity(deployment)]`. This binds host, runtime,
artifact, model alias, runtime configuration revision, variant and material
configuration. No selection is resolved by a display name or model filename.

The material configuration JSON has the canonical order
`{"version":1,"context":4096,"gpu":0,"tool":false,"grammar":false}`.
`LocalRuntime.version` is fixed to approved engine version `b12248`; the
native binder refuses missing, downgraded or changed engine version identity
even for an otherwise identical exact saved deployment selection.
`context` (512..131072), GPU offload, grammar/tool mode, model digest, engine
version and major inference behavior are material. Host/runtime/process/epoch
belong to execution and qualification scope. Harmless UI label/favorites,
timestamps, last health response and current picker filter are **not**
material.

## Native lifecycle and exact routing

Rust owns binary identity, process spawning, process ID, local port,
authenticated model probe, model state, secret, bounded diagnostic log,
crash detection, runtime epoch and shutdown. Windows child is attached to
a kill-on-close Job Object; Linux uses parent-death signal. No React/WebView
spawn and no arbitrary external manager. Only one exact deployment may load
at a time in this foundation.

The process environment is cleared rather than inheriting provider keys,
proxy settings or user-defined llama options. Its random API key is written
to a private, temporary credential file (owner-only mode on Linux), not
placed in the child command line. The server is forced into offline,
no-WebUI, loopback-only mode. The native owner removes that credential file
on stop/crash. Releasing the child process also invalidates its authentication
key and runtime epoch.

The returned native state is one of **Not Installed**, **Stopped**,
**Starting**, **Loading**, **Ready**, **Stopping**, **Failed**.
Start and load remain distinct. A 503 health response means Loading.
Ready requires the owned child, successful authenticated `/v1/models`
response with the model alias, and matching process epoch. Crash, timeout,
lost authenticated health, explicit stop or process replacement rolls the
epoch and invalidates readiness; registered GGUF and mission history remain.
Status and route are guarded independently, not inferred from persisted fabric
health. Output logs are bounded to 16 KiB and are not stored as model evidence.

The normal Chat route captures the exact `ModelDeployment` through the
existing model-selection / provider identity path and the dedicated
`ManagedLlamaRuntimeAdapter`, not through the legacy Ollama adapter. The native
`managed_local_runtime_route` re-reads the current native CAS entry,
validates the material configuration and imported artifact identity, rechecks
current authenticated health, and hands back only the live loopback
`127.0.0.1` route, secret, process ID and epoch. The TypeScript SDK builds
an OpenAI-compatible Chat adapter with a guard on **every request** that
revalidates the route/epoch/secret/process. A stopped, crashed, replaced,
missing or differently configured deployment fails closed **without fallback
to Ollama**, even if another host has the same label/digest.

Native executable files and imported GGUF bytes stay behind the native
boundary; only observed status and identity move to the frontend.
Provider recovery, compaction and continuation must use their captured
`ModelTransportIdentity` and the same guarded builder, never a fabricated
persisted URL. Automatic Agent is unavailable for managed GGUF while native
tools are unverified; normal text Chat can run when the native engine is
actually Ready.

In this first foundation, a new automatic recovery or logical continuation
**cannot prove the previous native epoch after a process restart**, so it is
rejected instead of silently rebinding to a new process. The chat transcript
and user configuration remain intact, and the user can start a new request.
Unavailable managed deployments also never trigger implicit cross-provider
fallback. This is a deliberate fail-closed continuity limitation.

## Model capabilities and cross-runtime trust

LM2F qualification is a separate bounded, versioned receipt contract, never
a shared artifact-digest privilege. It requires one enabled online host and
runtime, an unambiguous deployment, fresh runtime observation, engine and
runtime config identity, process, version, epoch, exact artifact digest/format,
material deployment identity, capability and unexpired evidence. Same digest
across Ollama and managed runtimes, same artifact on another PC, changed
binary/version, model bytes, context tier, tool/grammar mode or process epoch
never transfers proof. Audit evidence can survive restart, but cannot
authorize an incompatible new epoch. Legacy Ollama receives only the old
one-to-one migration bridge; managed never inherits it.

The first engine **advertises Chat/streaming/cancellation** at adapter level.
JSON Schema and grammar are available as upstream server protocols, but
must not count as deployment-qualified native tools or enable Automatic
Agent. Tool Fabric only reads normalized capability information; no
JSON/grammar tool execution fallback, new protocol or broader TF work is
implemented here.

## Validation and live proof status

Deterministic tests cover native GGUF/digest/corruption, approved-binary
contract, model/deployment identity, source and runtime missing cases,
cross-runtime negative qualification, exact picker selection, unavailable
and Ready-only statuses, managed Chat route guards and existing Ollama
regressions. Frontend typecheck/build, native Rust tests and preservation
checks are reported separately with actual results.

**Live acceptance is distinct:** no approved local b12248 runtime bundle
and compatible GGUF have been verified in the development environment.
Do not download a large model or claim a live streaming/cancellation PASS
merely to satisfy a checklist. Provisioning and one bounded harmless
real Chat request remain explicit installation/integration acceptance work
for a release build with approved digests and actual model bytes.
