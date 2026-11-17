# LM3–LM5 Native Hardware and Live Acceptance — November 17, 2026

## Phase 0 — Immutable baseline and audit of pre-existing implementation

Starting HEAD `da81aa2bb8126dc0fba8d71c04e4682991193f78`; parent
`7e129897ce86bd57a8e0fcb4f1e15d334c857441`, accepted LM2F. Git
confirms 12 LM3–LM5 committed paths. Initial index empty; original 81
protected dirty files match the canonical SHA-256
`339aba89d167b45a0cca1f663293fd3fa6197f63f0b2e4cab7f444b90670c104`.
Original stashes `6a7bc6beef913a323052b277f766ae32be11bae1`
and `b96fc46d783f1635acec2278deed7b43479f5f9a` intact. Approved
imported Qwen, pinned llama.cpp executable and two preserved LM2E reports
all match previously approved hashes. LM2F report and receipt files exist.

Before modification, `hardware_profile.rs` exposed:

| Field | Pre-change provenance | Source/limitations |
| --- | --- | --- |
| OS, architecture | Measured | Native Rust platform constants |
| Total/available RAM | Measured | Windows `GlobalMemoryStatusEx`; Linux `/proc/meminfo`; timestamp fresh for 30 seconds |
| Logical processors | Measured effective parallelism | Rust `available_parallelism` can be affinity-limited; **not guaranteed total logical hardware processors** |
| RAM pressure | Derived | `1 - available / total`, not process usage |
| CPU manufacturer, model | Unknown | No product CPU identity reader |
| CPU physical cores | Unknown | No OS physical-core reader; never inferred from threads |
| CPU ISA | Unknown | No supported ISA probe |
| GPU inventory, device/vendor/model/driver | Unknown | `gpus: []`, `gpuInventoryComplete=false`; does **not** mean absent |
| GPU total/free usable VRAM | Unknown | `Win32_VideoController.AdapterRAM` is unsuitable; no native GPU memory probe |
| GPU hardware backend support | Unknown | Display/GPU name does not certify execution |
| Installed managed llama.cpp CPU | Derived true | Approved pinned b12248 CPU-only manifest |
| Installed managed llama.cpp GPU backends | Derived false | Approved pinned b12248; GPU identity cannot override installed backend |
| Qwen memory weights/runtime/KV | Estimated/Derived | Exact imported GGUF digest and conservative resource assumptions, **not measured resident RAM/throughput** |
| Secondary PC memory/VRAM/backend | Unknown | Registered remote Ollama host has no authorized physical telemetry; never apply local data |

The initial desktop process is the **pre-telemetry executable** (Clack PID
40824) and an approved existing CPU-only `llama-server` PID 35056.
No live Suitability acceptance is established by that old executable.

## Scope and approach

Only safe native CPU/core, Windows display inventory, already-installed
vendor NVIDIA read-only telemetry, and live UI acceptance may be added here.
Never use OS display `AdapterRAM` for inference VRAM, extrapolate a GPU
backend from a product name, run inference/benchmarks, modify configuration,
SSH a remote host, or copy local telemetry to another ComputeHost. Every
returned field keeps source/timestamp and `Measured | Derived | Estimated |
Unknown` semantics in the existing read-only projection. Cross-platform
fallback is Unknown when trustworthy OS facilities are unavailable.

## Implementation, live observations, tests, and close-out verification

### Native telemetry, field authority and boundaries

`hardware_profile.rs` now calls unprivileged stable Windows interfaces
`RegGetValueW` for CPU manufacturer/model, `GetLogicalProcessorInformationEx`
with `RelationProcessorCore` for **physical** cores and
`GetActiveProcessorCount(ALL_PROCESSOR_GROUPS)` for **logical** processors;
neither count is fabricated by dividing or multiplying the other.

GPU inventory uses a bounded local Windows `Win32_VideoController` OS query
that records adapter device ID/vendor/model/driver, **not AdapterRAM**.
An isolated Windows-specific adapter runs the existing System32
`nvidia-smi.exe` with fixed read-only query arguments, a local timeout,
bounded output and no PATH/shell/driver installation. NVIDIA UUID, driver,
compute capability and MiB total/free VRAM are exposed as separately
timestamped `Measured` values. Vendor fields are parsed **independently**:
reliable total VRAM stays Measured if free VRAM is `N/A`, malformed or
greater than total; free is then **Unknown**, never estimated. If total
is unverified, both total and free remain Unknown while valid driver and
CUDA hardware capability can survive. An unavailable driver or capability
remains Unknown even when VRAM total is known. Duplicate vendor models
cannot be paired to a single OS display adapter by name alone.
If NVIDIA vendor telemetry fails,
OS display identities survive but usable VRAM and CUDA hardware detection
stay Unknown. Ambiguous duplicate adapter names are never silently paired.
Other vendors and virtual adapters do not inherit NVIDIA VRAM.

Per-device identity/VRAM, CPU identity/cores and backend evidence are
projected through `hardwareProfile.ts` using the established tagged
`EvidenceValue` contract. Individual observations expire after 30
seconds. Hardware CUDA support is `Derived` only from the vendor's
reported compute capability. **Installed managed b12248 CUDA is still
false; CPU execution is true; GPU layers remain zero.** No runtime
configurations were modified. Remote Ollama never receives local hardware
values, and a missing vendor reading is not treated as zero.

### Native read-only observation on actual Windows developer machine

A test of the real native command implementation returned:

| Field | Native result | Authority |
| --- | --- | --- |
| CPU | AuthenticAMD; AMD Ryzen 9 9900X 12-Core Processor | Measured, Windows CPU registry |
| CPU cores | 12 physical; 24 logical | Measured, Windows OS topology |
| RAM | 66,156,535,808 total bytes; 36,304,326,656 available bytes at snapshot | Measured, GlobalMemoryStatusEx |
| GPU adapters | StarDesk virtual display, NVIDIA RTX 5070 Ti, AMD Radeon integrated | Measured OS display/vendor inventory |
| NVIDIA total VRAM | 17,094,934,528 bytes (16,303 MiB) | Measured vendor memory report |
| NVIDIA free VRAM | 14,124,318,720 bytes in one native snapshot | Measured vendor memory report; momentary |
| NVIDIA driver and capability | 616.92, CUDA compute capability 12.0 | Measured vendor-reported; not installed inference execution |
| AMD/virtual usable VRAM | Unknown | No trustworthy vendor memory telemetry |
| Managed Qwen placement | CPU, 0 GPU layers | Derived exact configured pinned runtime |

### Current-source build and real desktop UI acceptance

The exact current source was built with the original approved b12248 archive
and binary SHA-256 pins in an **ignored isolated Cargo target**, preserving
the running original binary path. The resulting Clack executable SHA-256 is:

`79d0284f3319af65a3f4d196da67c2d672e08e5d5dbf3f8e7b142436e74f667e`

This identifies the **live-exercised executable before the independently
validated free-VRAM parser fix**. The current machine returned valid
total/free readings, so the change does not change that observed path.
The later source-matched rebuild was then separately live-exercised
under the explicit final acceptance authorization, as recorded below.

After the independent-free-VRAM parser correction, the same approved
offline, SHA-pinned native build completed successfully. Fixed-source
`src-tauri/target/lm3-lm5-native-live-20261117/cargo/debug/clack.exe`:

`672587a795a75dce3d6ca10c0c90fd410065942da31c5ad7eedbf2fe15729d02`

This second executable SHA represents the latest Rust source for this
follow-up and the **exact patched executable subsequently launched**
(PID 37592). Runtime pin values were
`bb306bfd390f8782c0acaba490505d12f07392791b48f1dd039387a5bacf1181`
(archive) and
`106ad878b697cccdc601b83a483c9649489c7c7fd3043e08cf7e292039a9cd8a`
(engine binary).

The native executable ran as a real Windows Tauri desktop application
with a separate WebView2 user-data profile and CDP port 9233; the original
app was initially at port 9222. Browser instrumentation attached to the
*new application's actual WebView2*, not a headless fixture, and exercised
the real `ChatSecondaryControls → DeploymentSuitabilityControl` popup.
The UI used exact saved Qwen and Secondary PC sessions. Temporary
AI-pane binding was restored to the original session afterward. No chat
Send, Agent, qualification, benchmark, SSH or provider inference button was
used. Ignored cropped popup screenshots and config hash receipts are under
`src-tauri/target/lm3-lm5-native-live-20261117/`.

**Live managed Qwen popup:** This PC / Clack Managed llama.cpp /
`qwen2.5-0.5b-instruct`; configured 2,048-token context, CPU placement,
measured Ryzen 9 9900X 12/24 core data, current host RAM, 3 GPUs, NVIDIA
VRAM with vendor source and Measured label, missing AMD/virtual VRAM
explicitly Unknown. Hardware CUDA capability detected; installed b12248
CUDA unavailable. Real native GGUF metadata read produced an estimated
~850 MiB CPU memory demand at 2,048 tokens, ~922 MiB at 8,192 and
~1.18 GiB at hypothetical 32,768. Computational memory fit `Good`,
confidence `Medium`, no throughput observation or performance benchmark.
Opening the actual popover returned new native CPU/GPU fields that could
not come from the older executable. LM2F Chat qualification was **stale**,
last recorded instruction adherence **failed**; native tools
`Unsupported / Unavailable` and Automatic Agent `Unavailable`.
Selecting hypothetical 32,768 and Automatic Agent changed only popup
selection/estimates, not the runtime's configured 2,048 context or tool
permission. Optional advice about a future independently verified
GPU-capable runtime remained non-mutating.

**Live Secondary PC popup:** Correct Ollama/Devstral model/host;
CPU, physical/logical cores, RAM, VRAM, compute backend, configured
context all **Unknown**, hardware rating **Unknown**, confidence
explicitly **Low**. Existing saved Ollama artifact `14.14 GiB` was
`Derived` from inventory, resident weights `15.27 GiB` **Estimated**
and not reported as measured or sufficient to load. Native tools and
Agent unqualified/unavailable. Opening the remote Suitability popover
contains no local hardware invoke, remote SSH or fresh provider query in
the component. **Caveat:** the existing app's *startup inventory hook* did
refresh provider metadata and temporarily update saved inventory/profile
timestamps; this was separate from opening Suitability and is not proof
of an inference or physical hardware probe. There was no newly authorized
remote hardware/inference operation.

The native command path was corroborated by newly rendered CPU/GPU
values and registered read-only Tauri commands. An attempted DevTools
wrapper for `window.__TAURI_INTERNALS__.invoke` was not active because
the property is non-writable; a dynamic IPC interception trace is
**not** claimed.

### Final patched-binary live acceptance (explicitly authorized)

The final fixed-source executable SHA
`672587a795a75dce3d6ca10c0c90fd410065942da31c5ad7eedbf2fe15729d02`
was checked **before** launch, including build-after-parser-source
timestamps, and was started as the **only** Clack process (PID 37592).
It reused the ignored isolated WebView2 profile/CDP port 9233 and
existing dev server; there was no second process launch, inference,
benchmark, driver/CUDA configuration, or SSH.

**Native IPC directly from the running final Tauri binary:** the
registered read-only `local_hardware_observation` returned actual
Windows telemetry with independent source/timestamp fields:

| Field | Final live native value | Provenance |
| --- | --- | --- |
| CPU | AuthenticAMD / Ryzen 9 9900X 12-Core Processor | Measured registry identity |
| CPU topology | 12 physical / 24 logical, x86_64 | Measured kernel topology; architecture of executable |
| System RAM | 66,156,535,808 total; 35,727,925,248 free bytes at IPC snapshot | Measured OS RAM |
| Adapter 1 | StarDesk Virtual Display Adapter; OS device ID source | Measured display identity; usable VRAM Unknown |
| Adapter 2 | NVIDIA RTX 5070 Ti, vendor device UUID source | Measured NVIDIA vendor identity |
| NVIDIA VRAM | 17,094,934,528 total bytes (16,303 MiB); 13,877,903,360 currently free at IPC snapshot | Separate Measured vendor fields |
| NVIDIA driver and hardware | Driver 616.92; CUDA compute capability 12.0 | Measured vendor evidence; **not** installed backend |
| Adapter 3 | AMD Radeon(TM) Graphics, OS device ID source | Measured display identity; usable VRAM Unknown |

The **actual final UI Qwen popup** displayed Ryzen 9 9900X,
12 physical/24 logical processors, 61.61 GiB total RAM and 33.30 GiB
available at its separate observation, all Measured; the three GPU
adapters remained distinct. RTX 5070 Ti total VRAM displayed **15.92
GiB Measured**, with **12.92 GiB free Measured** at that instant.
This machine's NVIDIA driver returned valid free VRAM, so a missing
free-VRAM observation was **not physically encountered in live UI**.
The **same final patched source**, covered by the native Rust
`N/A`, malformed and free-greater-than-total tests, retains a valid
Measured total while projecting only the unverified free field as
Unknown. No live hardware fault was fabricated or induced.

Qwen remained pinned to CPU/0 GPU layers and 2,048 configured tokens,
with no CUDA-capable installed runtime; its resource fit was **Good /
Medium confidence**, with 850 MiB **Estimated** RAM demand and
506 MiB **Estimated** weights, not real throughput. LM2F instruction
adherence remained **Qualification Stale / last recorded failed**;
Native Tools and Automatic Agent remained unavailable. A manual-only
GPU-capable-runtime recommendation could not switch the backend.

The **actual final Secondary PC / Ollama / devstral-small-2:24b
popover** correctly gave **Unknown / Low confidence** for unmeasured
remote CPU/RAM/VRAM, backend and configured context, and did not call
local hardware or request new remote suitability telemetry. Its saved
14.14 GiB model artifact remains Derived; 15.27 GiB resident weights
remain Estimated. No Agent or native tool permission was granted.

Current hardware had **three differently named adapters**, so no
same-model ambiguity arose physically. The native duplicate-model Rust
case verifies one display record cannot be paired to multiple NVIDIA
vendor records merely by identical model strings; the separate vendor
UUID observations survive. No bus or other stable identity is fabricated.

Ignored popup screenshots `live-suitability-1794902364784.png` and
`live-suitability-1794902399168.png`, direct native IPC output in
the acceptance command record, and hashed before/after receipts
`configuration-patched-*.json` document these checks. The original
chat selection, model selection and pane binding were restored, and
the temporary AI pane closed.

### Configuration preservation and unexpected process lifecycle outcome

Before and after **each** Qwen and Secondary popup, SHA-256 fingerprints
were compared for persisted hosts, runtimes, artifacts, deployments,
endpoints, model profiles, inventories, qualification receipts, agent
permissions and last-used model. All fingerprints matched for both
inspection windows. The active chat/model and pane binding were restored
to their original identities, and the AI panel was closed. Thus the
**Suitability UI interactions themselves were non-mutating** as to
deployment configuration and LM2F authority.

For the **final patched-binary acceptance**, all **ten** persisted hash
categories matched both before/after Qwen and before/after Secondary
Suitability inspection. From pre-launch to final snapshot the eight
high-authority deployment/runtime/artifact/host/endpoint/qualification/
permission/selected-model fingerprints also matched. Only saved
model-profile/inventory fingerprints changed during app startup,
**before** either Suitability inspection, consistent with the observed
provider inventory freshness update; no popup changed either field.
No context, backend, GPU layers, quantization, concurrency, permission,
or qualification state was automatically altered.

Historical note: the first isolated UI acceptance ended with previously
running app/server processes absent. The subsequent user explicitly
clarified that process liveness **is not** a preservation invariant;
repository/data integrity, not preservation of old process PIDs, is the
authoritative final gate. There is no evidence of LM3–LM5 data loss
from that event and no authorized need to reproduce it.

### Deterministic and regression tests

- Added 15 mandatory hardware/VRAM/backend/provenance/nonmutation cases,
  alongside the accepted 32 deterministic suitability and 3 UI entry
  fixtures. All 50 focused cases passed.
- Six native Hardware Profile Rust tests cover vendor total/free
  independence (missing, malformed or greater-than-total free), missing
  total, absent driver/compute and duplicate vendor model names.
- Full current-source selected TypeScript regression: **53 files,
  986 tests passed** after the VRAM parser fix, excluding archived
  `target` copies.
- Full Rust native library: **735 passed, 2 ignored, 0 failed**.
- Production TypeScript and frontend build passed; pinned native desktop
  build passed with the two executable digests above (earlier live-tested
  binary versus final fixed-source rebuild). Native source formatting
  and `git diff --check` passed.
- **Final patched-binary focused recheck:** six current-source native Rust
  Hardware Profile tests passed, including missing/invalid free VRAM and
  duplicate model identities. Nine focused TS suites covering LM3
  suitability, native provenance, LM2F authority, qualification and
  managed runtime passed **141/141**. `npm run check-types` passed.
  There were no production-source changes after the already verified
  pinned native and production frontend builds.
- No full LM6 performance or qualification workload ran. The original
  81 protected dirty files, original stashes, approved Qwen/engine and
  LM2E/LM2F evidence remain part of the final preservation audit.

Known remaining gaps: CPU ISA instruction list, other OS CPU models/core
topologies, AMD/Intel usable VRAM and compute backend inventory, dynamic
VRAM telemetry when vendor tool absent/stale, exact remote physical
telemetry, verified runtime CUDA backend availability outside the pinned
managed CPU-only engine, and actual inference throughput. These must
remain Unknown rather than being guessed.

## Final scope gate

The Windows/NVIDIA read-only telemetry and already exercised current-machine
Qwen + Secondary Ollama Suitability integration meet their scoped functional
checks **on the exact final fixed-source executable**, with an explicit
native IPC snapshot and both actual UI popovers. The negative-path
free-VRAM regression was executed against the same patched native source;
the live driver returned valid free, not a fabricated failure. Per-popup
configuration hashes all matched. Original 81 protected dirty files,
stashes, pinned artifacts and accepted baseline remain preserved. The
user expressly clarified that earlier exited processes are not themselves
a preservation defect. This authorizes one narrow **local-only, seven-file
commit** under the requested conditional gate. No push or amendment.

```text
NATIVE_CPU_TELEMETRY=PASS
NATIVE_GPU_TELEMETRY=PASS
BACKEND_EVIDENCE_MODEL=PASS
LIVE_SUITABILITY_UI=PASS
SUITABILITY_NON_MUTATING=PASS
HARDWARE_PROFILE=IMPLEMENTED
LM3_LM5=PASS
```

Here GPU PASS means only supported, measured Windows OS display inventory
and NVIDIA vendor telemetry with explicit Unknown fallback; it **does not**
claim universal GPU coverage, inference-usable VRAM for AMD/virtual
displays, or a CUDA-capable installed llama.cpp. UI PASS is for the
SHA-verified **final patched binary**; missing NVIDIA free VRAM was
validated with deterministic native parser tests rather than forcing
a live hardware failure.
