# LM2D — Windows managed CPU runtime and live inference acceptance

Date: 2026-11-16. Scope: native Clack Settings and Chat on This PC, Windows x64,
official release-pinned llama.cpp b12248, Qwen2.5-0.5B-Instruct Q4_K_M,
2,048-token context, CPU (`--n-gpu-layers 0`), no tool/grammar qualification.

## Installation and execution trust

- The runtime and original GGUF had already been installed/imported. This
  acceptance did not reinstall b12248, reimport GGUF, replace the original, or
  modify the installed engine/model. The operator had manually excluded the
  exact `llama-server.exe` in Windhawk and restarted Windhawk beforehand.
- Clack Settings **Start** launched the private b12248 `llama-server.exe`
  child. The inspected command line carried `--ctx-size 2048`,
  `--n-gpu-layers 0`, `--host 127.0.0.1`, `--offline` and `--no-webui`.
- The installed CPU payload consists of exactly **52** files, all matching
  the in-binary manifest sizes and SHA-256 hashes. The actual loaded-module
  set contained **28** files: 10 approved hashed runtime payloads (including
  the EXE), 18 Microsoft-signed Windows System32 dependencies, zero separately
  qualified vendor modules, and zero unexpected/unverified third-party
  modules. `windhawk.dll` was absent. All modules were individually verified,
  not assumed trusted merely because Windhawk was absent.
- The private GGUF is 491,400,032 bytes, SHA-256
  `74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db`.
  The sole managed deployment retained
  `{"version":1,"context":2048,"gpu":0,"tool":false,"grammar":false}`.

## Real Clack Chat request

The actual Settings, picker and Chat UI were exercised, not a synthetic HTTP
request, standalone llama.cpp invocation, browser mock or Ollama call.
The unified picker selected the exact Qwen GGUF. Permissions were explicitly
**Chat Only** and fallback **Disabled**. One harmless prompt asked for eight
short sentences about a blue kite in a sunny park.

| CET time | Chat UI observation |
| --- | --- |
| 05:58:16.737 | Preparing response |
| 05:58:18.917 | Waiting for managed GGUF deployment |
| 05:58:19.601 | Generating |
| 05:58:19.970 | First partial assistant text |
| 05:58:20.337 | Additional text appended |
| 05:58:20.672 | Further incremental text appended |
| 05:58:21.325 | Done; model finish reason `stop` |

At **05:58:19.101**, native Windows TCP evidence showed both ends of a direct
loopback connection:

```text
Clack PID 35588        127.0.0.1:60200 -> 127.0.0.1:58937 Established
llama-server PID 21824 127.0.0.1:58937 -> 127.0.0.1:60200 Established
```

Clack owned the server as its child (parent PID 35588), and the server only
listened on that loopback port. Chat's captured model identity and native
admission route referred to the managed deployment. Direct native endpoint
evidence, the UI's Disabled fallback policy, and the terminal streamed reply
establish managed-runtime routing, not Ollama or secondary-PC inference.
The small model did not follow the requested eight-sentence format precisely;
that does not change the transport/streaming/terminal completion result.

## Lifecycle, invalidation and persistence

- Settings **Stop runtime** terminated PID 21824 and showed
  `Stopped / unverified`. The process epoch rotated from
  `1852d235b74da92c44f415cacfd645aa796034277f8cedd92b96d4fca0ad4fc5`
  to `0ee22ae66f407230533cab5715df6dbc5d3f67b70c11d3d17d8b2bb98f3bea51`,
  invalidating qualification of the stopped process.
- Settings **Start** launched new PID **20680**, parent **35588**, listening
  only on `127.0.0.1:63113`. Its new process epoch
  `da6f99b3655617e714dc79393b842ae211089c1c9c603c76003c378e1e2d2805`
  differed from the preceding Ready and Stopped epochs.
- Installed GGUF SHA-256, registration and CPU/2,048 configuration persisted.
  The full 52-file manifest and all 28 loaded modules passed trust checks
  again after restart, with no Windhawk module.
- Isolated Rust fixtures cover missing/tampered/extra payload DLL rejection,
  missing/modified private GGUF rejection, epoch invalidation and deployment
  identity changes. No negative test damages the actual installation.
- Existing Ollama host registrations remain present: This PC
  (`legacy:ollama`, localhost:11434/v1, revision 1), and Secondary PC
  (`sh-906dc712-b5bb-445a-9a88-ca71865f4d9e`,
  192.168.1.44:11434, revision 2); both remain enabled. Neither was selected
  for fallback. The temporary Chat Only permission mode was restored through
  Clack's UI to the previous **Ask** setting.

## Regression and evidence

- 11 managed, routing, model-switch, Ollama, persistence, Settings and
  frontend Vitest suites: **189/189 passed**.
- Native managed-runtime tests: **6/6 passed**; target-context/native
  conversation-switch tests: **11/11 passed**.
- `npm run check-types`: PASS. `npm run build` (TypeScript and Vite): PASS.
- Unrelated pre-existing dirty files and both original Git stashes were not
  staged, restored or deleted.

Local task-owned captures are retained (but ignored by Git) in
`src-tauri/target/managed-runtime-provenance-b12248/`:

| Evidence file | SHA-256 |
| --- | --- |
| `lm2d-second-live-chat-ui-observation.txt` | `ea4bf7d46855a2bc0bd08e537c7085af6d11cf628df56da7a438022ba1eca24d` |
| `lm2d-second-live-chat-net.txt` | `f64202675f1fab7bd847b347286c8a145eacf7fe72986ac588f9fad22c9871c2` |
| `lm2d-post-chat-restart-loaded-modules.txt` | `a58e5d87024170aa947560b6beb144067ea449993f4cf0ca3c9c5b4865ef7fcf` |

## Final classifications

| Classification | Outcome |
| --- | --- |
| `CLACK_MANAGED_RUNTIME_PROVISIONING` | PASS |
| `CLACK_MANAGED_GGUF_IMPORT` | PASS |
| `CLACK_MANAGED_CPU_EXECUTION` | PASS |
| `CLACK_MANAGED_LIVE_INFERENCE` | PASS |
| `CLACK_MANAGED_RUNTIME_RESTART_TRUST` | PASS |

This is managed **CPU Chat-only** acceptance. It does **not** qualify CUDA,
GPU execution, Agent, or native tool calling.
