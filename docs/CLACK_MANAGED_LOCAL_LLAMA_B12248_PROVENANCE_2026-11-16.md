# Clack managed llama.cpp b12248: Windows CPU x64 provenance and redistribution

This record supplements [LM2D-LM2F](CLACK_MANAGED_LOCAL_MODELS_LM2D_LM2F.md)
for the first **Windows x64 CPU** llama.cpp bundle. It records an exact
upstream artifact, the bytes verified on 2026-11-16, and notices that must
accompany a Clack distribution. It makes no assertion about Linux, other
architectures, GPU builds or a user-installed model.

## Version and official release identity

| Evidence | Pinned value |
| --- | --- |
| Upstream project | [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp) |
| Release tag | [b12248](https://github.com/ggml-org/llama.cpp/releases/tag/b12248) |
| Release target commit | [`3837bf0bc02ea5d08f8ee3585fc8c7784a81bce8`](https://github.com/ggml-org/llama.cpp/commit/3837bf0bc02ea5d08f8ee3585fc8c7784a81bce8) |
| Release publication | 2026-11-10 16:08:46 UTC |
| Official archive | [`llama-b12248-bin-win-cpu-x64.zip`](https://github.com/ggml-org/llama.cpp/releases/download/b12248/llama-b12248-bin-win-cpu-x64.zip) |
| Archive size | 24,930,550 bytes |
| Archive SHA-256 | `bb306bfd390f8782c0acaba490505d12f07392791b48f1dd039387a5bacf1181` |
| Archive-root executable | `llama-server.exe`, 9,728 bytes |
| Executable SHA-256 | `106ad878b697cccdc601b83a483c9649489c7c7fd3043e08cf7e292039a9cd8a` |
| Archive-root implementation DLL | `llama-server-impl.dll`, 10,158,592 bytes |
| Implementation DLL SHA-256 | `225851099880cf3ece6bb18245386122599d02db9723b29ab59f0a06ea1f9757` |
| Archive-root additional notice | `LICENSE-LLVM-OpenMP`, 19,741 bytes |
| LLVM OpenMP notice SHA-256 | `fdad1758a9e1f9d5a81e18879b3406772115edc92c24bfa36b70c654f325e8e4` |

The official GitHub release API lists the same archive digest, and GitHub's
[SLSA provenance attestation 65886416](https://github.com/ggml-org/llama.cpp/attestations/65886416)
names the exact archive and `sha256:bb306bfd390f8782c0acaba490505d12f07392791b48f1dd039387a5bacf1181`
as a subject. The attestation records the GitHub-hosted
[`release-publish.yml` workflow](https://github.com/ggml-org/llama.cpp/actions/runs/42851042933/attempts/1),
triggered by `workflow_run`, and its workflow/source digest
`e24d0b4c345791ea2c5d6ff28373d8cff829613e`. This workflow
revision differs from the **release target commit** above; the asset
attestation subject proves an archive-digest claim, while the release API
identifies which source commit the `b12248` tag targets. They must not be
conflated.

The exact official archive was retained by the release audit only under
the ignored `src-tauri/target/managed-runtime-provenance-b12248/` folder.
The archived 24,930,550 bytes match the release API and attestation SHA-256.
The release audit generated and checked an exact **52-file** ZIP manifest
and independently verified the GitHub attestation using
`gh attestation verify --owner ggml-org`: **PASS**. The notice audit
additionally fetched the same official archive **in memory** and rehashed
its bytes, root `llama-server.exe`, `llama-server-impl.dll` and
`LICENSE-LLVM-OpenMP` entries, confirming the specific digests above.
These operations inspect the ZIP as data; they do not constitute runtime
installation, execution, model qualification or live acceptance.

## Literal third-party license and notice files

- [`third-party/llama.cpp-b12248-LICENSE.txt`](third-party/llama.cpp-b12248-LICENSE.txt)
  is the **complete literal MIT LICENSE** from
  [llama.cpp at `3837bf0`](https://raw.githubusercontent.com/ggml-org/llama.cpp/3837bf0/LICENSE).
  It includes `Copyright (c) 2023-2026 The ggml authors`, all terms
  and the full disclaimer. The local Git blob SHA
  `e7dca554bcb802f98408383a864404e3aa4eacca` matches GitHub's
  pinned upstream `LICENSE` blob SHA. The release ZIP contains no
  standalone llama.cpp MIT `LICENSE` entry, so Clack packaging must
  add this notice when redistributing that software.
- [`third-party/LLVM-OpenMP-20.1.8-LICENSE.TXT`](third-party/LLVM-OpenMP-20.1.8-LICENSE.TXT)
  is the **complete literal LLVM OpenMP license and additional notices**
  from [LLVM release `llvmorg-20.1.8`](https://raw.githubusercontent.com/llvm/llvm-project/llvmorg-20.1.8/openmp/LICENSE.TXT).
  Its local SHA-256 matches the official b12248
  [`ggml/src/CMakeLists.txt` pin](https://github.com/ggml-org/llama.cpp/blob/3837bf0/ggml/src/CMakeLists.txt)
  as well as the archive's `LICENSE-LLVM-OpenMP` entry.

The upstream Windows LLVM/Clang OpenMP build can ship `libomp.dll`.
Pinned llama.cpp CMake downloads the LLVM **20.1.8** OpenMP component
and copies its exact license to the runtime output as
`LICENSE-LLVM-OpenMP`; the [upstream build instructions](https://github.com/ggml-org/llama.cpp/blob/3837bf0/docs/build.md)
call out this paired DLL and license. LLVM's notice covers its Apache-2.0
terms with the LLVM exception and additional third-party attributions.
Preserve it verbatim alongside any redistributed `libomp.dll`; the
llama.cpp MIT license alone does not account for that dependency.

## Distribution and build boundary

A release containing this exact Windows CPU bundle must carry both
third-party notice files, preserving complete original text and copyright
statements. The read-only reproducibility helper
[`scripts/managed/manifest-llama-b12248-win-cpu.py`](../scripts/managed/manifest-llama-b12248-win-cpu.py)
accepts **only** an archive named `llama-b12248-bin-win-cpu-x64.zip`
with the approved full ZIP SHA-256; it prints JSON with the SHA-256 and
uncompressed byte size of **every file entry** without extracting or
executing content. The controlled Clack release build now embeds the
archive and executable digests through `src-tauri/build.rs`, and the
native source owns the validated exact-file manifest at
`src-tauri/src/modules/managed_llama_cpu_b12248_manifest.rs`. Runtime
verification checks the complete manifest as well as the compiled archive
and executable pins. This identity applies only to this exact
platform-specific ZIP and cannot authorize any other llama.cpp asset.

**Installation status was pending at this provenance checkpoint.**
No runtime or model was launched by the documentation audit, and no model
download or inference was carried out. Later installation and integration
acceptance, if authorized, must be reported separately; this record is
distribution provenance and does not assert live acceptance or native tool
qualification.

## Controlled Clack GUI follow-up, 2026-11-16 — security blocked

This later record **does not change the read-only provenance checkpoint above**.
After the compile-time 52-file manifest, full ZIP attestation and private ACL
checks passed, the controlled Clack Tauri Settings UI installed the official
`llama-b12248-bin-win-cpu-x64.zip`. The installed private
`%LOCALAPPDATA%/app.clack.dev/managed-local-runtime/engine/b12248/` directory
contained exactly 52 files (64,352,541 bytes), with every file name, size and
SHA-256 matching the embedded manifest. The private root, `engine` and
`engine/b12248` directories had protected Windows DACLs granting full access
only to OWNER RIGHTS, SYSTEM and Administrators.

Through the real **Add Local Model** UI, Clack inspected the one approved
Qwen publisher GGUF, displayed GGUF v3 / Qwen2 / reported 32,768 context,
and registered a **2,048-token CPU deployment** (`gpu=0`, `tool=false`,
`grammar=false`). The original file and private content-addressed imported
copy both contained 491,400,032 bytes with SHA-256
`74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db`.
The source was exclusively
`Qwen/Qwen2.5-0.5B-Instruct-GGUF/qwen2.5-0.5b-instruct-q4_k_m.gguf`
(Apache-2.0). Native settings persisted exactly one new managed deployment
using `context=2048` and `gpu=0`.

The real Clack **Start** control launched the pinned private server (observed
PID 2432; Clack parent PID 12596), listening only on `127.0.0.1:64854`.
Clack briefly reported **Ready** with the exact managed model alias, and the
command line showed `--ctx-size 2048`, `--n-gpu-layers 0`, `--offline` and
`--no-webui`. The binary SHA-256 matched the compiled approved digest.

**Execution trust did not pass.** Windows process-module inspection discovered
`C:\Program Files\Windhawk\Engine\1.6.1\64\windhawk.dll` dynamically loaded
inside `llama-server.exe`, outside both the attested managed payload and
Windows system DLL directories. This is an unapproved loaded dependency;
its presence is not a finding of malicious intent. It demonstrates that
private payload hashes and a cleared `PATH` alone do not prevent host-wide
process injection. Following the fail-closed instruction, Clack's actual
**Stop runtime** control was invoked and the managed server process exited.
**No Chat prompt, streamed tokens or terminal completion was attempted.**

Windhawk's upstream [process exclusion documentation](https://github.com/ramensoftware/windhawk/wiki/Injection-targets-and-critical-system-processes)
describes its injection policy and user-managed **Process exclusion list**.
That external system configuration was **not changed** within this task.
A fresh launch after an explicitly user-controlled exclusion must be checked
for *all* loaded executable/DLL modules before any real GGUF Chat inference,
followed by lifecycle/restart trust acceptance. No CUDA, Agent or ForgeBoard
test occurred, and no task commit was made because live acceptance remains
blocked.

```text
CLACK_MANAGED_RUNTIME_PROVISIONING=INSTALLED_PAYLOAD_VERIFIED_EXECUTION_TRUST_BLOCKED
CLACK_MANAGED_GGUF_IMPORT=PASS
CLACK_MANAGED_CPU_EXECUTION=STARTED_READY_BLOCKED_BY_UNAPPROVED_INJECTED_DLL
CLACK_MANAGED_LIVE_INFERENCE=NOT_RUN_SECURITY_BLOCK
CLACK_MANAGED_RUNTIME_RESTART_TRUST=NOT_RUN_SECURITY_BLOCK
```

## Windhawk exclusion, first genuine managed Chat and lifecycle acceptance — 2026-11-16

**This section supersedes the earlier, historically accurate blocked
classification above.** The user manually excluded the exact private
`llama-server.exe` path from Windhawk injection and restarted Windhawk.
Clack's already-installed b12248 CPU payload and imported GGUF were *not*
reinstalled, replaced or reimported. A new launch through Clack's actual
Tauri/WebView Settings UI initially yielded native PID **37868** with Clack
parent **12596**, listening at `127.0.0.1:51202`. Its complete 28 loaded
modules were classified: **10** pinned, SHA-256-verified runtime PE payload
modules; **18** Microsoft-Authenticode-valid Windows System32 dependencies;
**zero** other vendor or untrusted modules. `windhawk.dll` was absent.

The live UI uncovered three narrow integration gaps, corrected without
weakening native routing: the Chat credential-presence test must recognize an
exact registered Clack-owned deployment rather than demanding cloud keys;
the conversation-switch native transaction must allow a bounded, longer
managed selection ID only after independently checking its canonical
registered host/runtime/artifact/configuration identity; and Chat's
immutable run snapshot must preserve that full managed identity instead of
flattening it into a generic compatible-provider identity. Ordinary model
selection limits and cloud/Ollama routing remain unchanged. Clack's native
`managed_local_runtime_route` still checks model and engine hashes,
deployment binding, authenticated Ready, process and epoch for each request.
Clack's Settings UI additionally exposes nonsecret epoch, native PID and
loopback port, supporting real lifecycle inspection.

After rebuilding the exact pinned Clack debug executable and restarting the
actual UI, Clack's Start action launched native PID **21824** under parent
Clack PID **35588**, endpoint `127.0.0.1:58937` and runtime epoch
`1852d235b74da92c44f415cacfd645aa796034277f8cedd92b96d4fca0ad4fc5`.
The actual native command contained `--ctx-size 2048`, `--n-gpu-layers 0`,
`--offline`, `--no-webui`, the exact imported model file and digest-derived
alias. The module audit again found 10 approved PE payloads, 18 signed
System32 DLLs and zero Windhawk/unapproved DLLs, before and after inference.

In the **real Clack WebView Chat** (not an HTTP or mocked acceptance runner),
the Qwen2.5-0.5B-Instruct Q4_K_M selection was visible, and **Chat Only**
permissions with **Fallback: Disabled** were selected. A harmless user prompt
was sent: *Write eight short sentences about a small blue kite flying in a
sunny park.* Clack showed **Generating**, progressively longer actual
assistant text at **05:58:19.970**, **05:58:20.337** and **05:58:20.672**
(Europe/Madrid), then **Agent activity: Done** at **05:58:21.325**. A real
assistant response remained visible in the conversation. During this same
generation, independent native TCP observations recorded an **Established**
loopback connection from Clack **PID 35588**, `127.0.0.1:60200`, directly to
its managed **llama-server PID 21824**, `127.0.0.1:58937` (also reciprocal
server socket observations); no Ollama port or Secondary PC route was
observed in the monitored request, and fallback was explicitly disabled.
The bounded observation files are retained only in the ignored local audit
directory `src-tauri/target/managed-runtime-provenance-b12248/`:
`lm2d-second-live-chat-ui-observation.txt` and
`lm2d-second-live-chat-net.txt`. Neither synthetic Vitest transports nor
direct manual curl count as this live evidence.

The genuine Settings UI **Stop** released the server and rotated its secret
process epoch to
`0ee22ae66f407230533cab5715df6dbc5d3f67b70c11d3d17d8b2bb98f3bea51`.
The subsequent **Start** created a fresh **PID 20680**, parent Clack 35588,
new epoch `da6f99b3655617e714dc79393b842ae211089c1c9c603c76003c378e1e2d2805`
and listener `127.0.0.1:63113`. The new process was Ready, CPU-only and
offline with 10 verified runtime modules, 18 Microsoft-signed System32 DLLs,
no untrusted/injected DLLs, and the original GGUF digest still equal to
`74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db`.
The old epoch is different from the new one; negative route tests exercise
old-epoch, changed PID, address, alias and key rejection. Isolated Rust
`tempfile` fixtures reject changed, unexpected or missing runtime dependency
DLLs, and missing or modified private GGUF files, without touching the
real installed payload or model.

The temporary Chat Only permission override was returned to **Ask** through
the Clack UI. A separate read-only fingerprint of the persisted non-managed
Ollama hosts, endpoints, profiles and configurations remained unchanged:
`1d4d8a69ca07fc3262a270728b37b5d291d0bb1bd19d68ad2eaa9aad39f878ce`.
This acceptance is **CPU Chat only**; it establishes neither CUDA use nor
native Agent-tool suitability, and performed no ForgeBoard campaign.

The completed classification (subject to the final scoped regression and
preservation checks) is:

```text
CLACK_MANAGED_RUNTIME_PROVISIONING=PASS
CLACK_MANAGED_GGUF_IMPORT=PASS
CLACK_MANAGED_CPU_EXECUTION=PASS
CLACK_MANAGED_LIVE_INFERENCE=PASS
CLACK_MANAGED_RUNTIME_RESTART_TRUST=PASS
```
