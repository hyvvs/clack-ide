# R5aq — Laguna XS 2.1 pre-install hardware assessment and execution gate

**Date:** 2026-10-24. **Baseline:** `8e31ade04b3c8bd0555f0ddaafb33284e909cd48`. **Outcome: INSTALLATION EXECUTION BLOCKED BEFORE MODEL PULL**; this is **not HARDWARE BLOCKED**, a model failure, or an established generic Clack defect. **Zero newly installed models, zero new inference, zero notes-API missions.**

## Live remote hardware and provider — read-only

- Machine: Linux x86_64 `labpc`. Original previously approved `127.0.0.1:11435` SSH tunnel and Ollama 0.40.8 remained reachable. The original restored local listener was held by **PID 35272**; no SSH port-forward changes.
- **GPU:** NVIDIA GeForce RTX **4060 Ti, 16 GiB** (nvidia-smi **16,380 MiB total**, **15,878 MiB free**, **132 MiB reported used**); no reported active NVIDIA compute workloads. Driver reported **615.78.08**. No GPU/driver changes.
- **RAM:** `MemTotal: 32,457,108 kB` (approximately **30.95 GiB**), `MemAvailable: 29,331,664 kB` (approximately **27.97 GiB**). **Swap:** `SwapFree: 32,456,604 kB` (approximately **30.95 GiB**); swap is not treated as fast inference capacity.
- **Disk:** existing Ollama systemd environment `HOME=/var/lib/ollama OLLAMA_MODELS=/var/lib/ollama`. Mounted filesystem containing that model directory: **1,592,514,187,264 bytes free** (~**1.45 TiB**); adequate for ~20 GB additional Q4 weights while preserving all existing models. Per-model store-size accounting was not accessible to the unprivileged inspection, but filesystem free bytes were directly measured.
- **Ollama state:** before and after the blocked action, `GET /api/version` returned **0.40.8**, `GET /api/tags` contained exactly **10** pre-existing models and **no `laguna-xs-2.1:q4_K_M`**, `GET /api/ps` returned **zero loaded models**.

## Model fit boundary — no guessing from parameter count

Ollama's published listing identifies **`laguna-xs-2.1:q4_K_M`**, **33.4B total / 3B active** MoE parameters, native tools/thinking, **Q4_K_M ~20 GB download** and **262,144-token advertised maximum**. A full 20 GB Q4 model cannot fit wholly in the measured 16 GiB GPU; it would require **ordinary GPU/CPU offload and context KV memory**. Available **~28 GiB system RAM + ~15.5 GiB free VRAM** provides a plausible conservative mixed-residency envelope for a smaller verified working context, with ample disk and no observed active GPU workload. There is **no evidence that Clack can safely verify 65,536 or 262,144 tokens** here. The correct next test would be production calibration from low contexts, accepting only real allocation/runtime-epoch/context trust, not a forced fixed context or an invented memory guarantee.

**Hardware suitability assessment: CONDITIONAL / REASONABLY SUITABLE FOR A CAUTIOUS MIXED GPU/CPU QUALIFICATION**, subject to real load and context calibration after installation. Hardware insufficiency is **not** established. No download of a substitute or additional model was authorized/performed.

## Installation action blocked before execution

After confirming Laguna was absent and the other ten models untouched, **one** tool request to run the explicitly authorized Ollama pull `laguna-xs-2.1:q4_K_M` over the approved SSH host was **rejected by the execution environment's safety gate before shell command execution**. This was not an Ollama registry, remote host, network, GPU, model, or Clack error. To respect the gate, **no retry or alternative download channel was attempted**. A subsequent independent read-only Ollama inventory verified **Laguna still absent**, **10 original models unchanged**, **no loaded model**, and the original tunnel still listening.

Accordingly, the conditional work was **NOT EXECUTED**: no model digest can be verified locally, no additive Clack production self-hosted profile was created, no fabricated capability proof or overrides, no native context/runtime qualification, no native Agent tools, no notes source generated, no independent app evaluation. There is **no model-quality classification** from this checkpoint. Calling this **HARDWARE BLOCKED**, **MODEL UNSUITABLE**, **CLACK DEFECT**, or **LOCAL AI SMALL-APP ACCEPTED** would be unsupported.

| Requested stage | Result |
| --- | --- |
| Actual hardware/VRAM/RAM/storage/loaded inspection | **PASS** (read-only) |
| Laguna hardware plausibility | **CONDITIONALLY SUITABLE** (GPU/CPU offload required) |
| Install exactly Laguna Q4_K_M | **BLOCKED BEFORE EXECUTION** |
| Verify newly installed digest and metadata | **NOT EXECUTED** |
| Normal new Clack profile | **NOT EXECUTED** |
| Fresh calibration/context trust/epoch/Automatic/native tools | **NOT EXECUTED** |
| Single notes-API coding Agent mission | **NOT EXECUTED** |
| Frozen TypeScript/build/start/CRUD/validation/persistence/automated tests/README/runtime-ignore | **NOT EXECUTED** |

## Preservation and next authorization boundary

The original six pre-existing dirty files must remain byte-identical; both original stashes, `autonomous_tracker/`, all existing saved profiles, the ten installed models, original SSH port forward and historical Qwen/Devstral/North Mini/Muse/Nemotron evidence are out of scope. No reset, clean, Git push, service/driver/OS or remote Ollama configuration changes, alternate model, cloud fallback or new production Clack behavior. R3d packaged acceptance remains **OPEN**; full **P2–P19 roadmap MANDATORY and DEFERRED**.

**Next separate action:** resolve the execution-permission block using the approved operator/installation workflow; after the exact model is successfully installed, independently verify its digest and Clack qualification before authorizing one fresh notes acceptance. **Do not presume the model was installed or queue work in the background. STOP.**
