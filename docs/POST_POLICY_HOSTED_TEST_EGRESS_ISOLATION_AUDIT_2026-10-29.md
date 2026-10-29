# Post-policy hosted WebView egress isolation: fail-closed audit

Starting HEAD: 5b361e423bc26d4a18320db10efba8879e243b4a.

**Classification: POST-POLICY HOSTED TEST ISOLATION UNSAFE.**

**No fresh hosted notes control is justified.** No hosted/local inference, notes acceptance, ForgeBoard, WebView launch, external connectivity probe, firewall or proxy change occurred in this task. The previous accidental inference is separate and remains frozen.

## Security requirement

The previously trusted native ai_http_stream-only barrier failed because OpenRouter uses the browser path preflightFetch → globalThis.fetch. A valid independent barrier must deny external traffic for the entire Tauri acceptance-host/WebView2 child-process tree, even if a fetch wrapper fails, any browser networking API is used, the provider route changes, native commands are invoked, or child processes are spawned. Loopback development/IPC traffic must remain available. OS/network restrictions must be process-exclusive, temporary and removable after abnormal termination.

## Read-only Windows 11 Pro build 26200 audit

| Candidate | Observation | Verdict |
|---|---|---|
| WebView2 browser proxy with local deny/capture endpoint | Host-specific WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS is supported, but Microsoft documents that proxy-server affects HTTP/HTTPS only. It does not constrain native host networking, arbitrary child processes or every protocol. | Insufficient alone; not installed or launched |
| Loopback proxy plus proxy bypass list | Could demonstrate loopback access and deny HTTP(S), but does not establish independent OS-level process-tree confinement. Failure or replacement of proxy flags cannot be assumed impossible. | Insufficient alone |
| Windows Firewall application rule | New-NetFirewallRule -Program scopes to a full executable path, not a unique test PID. WebView2 child processes share the installed msedgewebview2 runtime executable with unrelated applications. A persistent rule would be machine-wide. | Rejected; no rule created |
| Unique process-scoped WFP filter/driver | A verified OS-level process-tree network policy could qualify, but no installed test-specific callout or validated programmatic cleanup is available. The current shell is medium-integrity, non-administrator. | Not deployable safely here |
| Windows Sandbox / Hyper-V VM with networking disabled | WindowsSandbox.exe absent from System32; DISM optional-feature queries return Error 740, elevation required. The Windows Tauri host, WebView2, loopback infrastructure and build would have to run within the same isolated guest. | No proven ready guest; not started |
| Experimental CreateProcessInSandbox/AppContainer | processmodel.dll exists. Microsoft's API is experimental; AppContainer can enforce network capabilities, but Tauri/WebView2 child process tokens, loopback access and crash cleanup have not been validated. Loopback exemptions may require persistent system state. | Not proven safe; no profile or exemption created |
| WSL/Linux network namespace | WSL distribution names are visible, but the acceptance executable and WebView2 children run on Windows. Linux network namespaces do not confine those Windows processes. | Not applicable |
| Existing browser fetch capture and native IPC rejection | Useful for diagnostics but implementation-dependent, and failed as an independent barrier previously. | Never sufficient alone |

References: Microsoft [WebView2 browser flags](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags); [Windows firewall program rule](https://learn.microsoft.com/en-us/powershell/module/netsecurity/new-netfirewallrule?view=windowsdefender); [experimental CreateProcessInSandbox](https://learn.microsoft.com/en-us/windows/win32/secauthz/createprocessinsandbox); [AppContainer isolation](https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation); [AppContainer loopback restrictions](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/troubleshooting-uwp-firewall).

## Applied fail-closed mitigation

Only the test runner scripts/post-policy-hosted-notes.mjs was changed: both existing --offline-dry-run=probe and --offline-dry-run=verify modes now fail with:

    POST-POLICY HOSTED TEST ISOLATION UNSAFE: independent process-tree network-egress containment has not been proven

This check occurs **before reading original settings**, creating a scratch workspace, starting Vite, building or launching the test native host, or creating a WebView. There is no unsafe opt-out. Production Agent logic, provider networking, reasoning/output policy, and chat defaults are unchanged. The ordinary one-shot acceptance runner's live path is not re-authorized by this report.

The local-only src/test/hostedEgressIsolationGuard.test.ts invokes both blocked commands in Node subprocesses, supplying an intentionally nonexistent settings path; it verifies the failure reason, absence of host startup and settings creation, unchanged hashes of three prior frozen run receipts, and the guard's ordering before settings/workspace I/O. Tests never spawn a WebView or use the network.

## Evidence not claimed

There is **no new** live WebView milestone trace, OS-enforced loopback proof, external-egress denial proof, proxy log, SDK request capture, actual WebView preflight receipt, abnormal sandbox-cleanup test, or zero-egress network-policy counter. None of those can be safely asserted because no independently enforced sandbox was installed. No cleanup was required because no OS network configuration was created.

Previously verified mocked production-adapter fixtures still produce Laguna computed/preflight/SDK/serialized max_tokens **8192** (trusted context **262144**, output max **32768**, default-on reasoning, unknown effort), with no unsupported effort fields. A provider max of **4096** and manual max of **1024** remain authoritative. These are mock-path results, **not** new WebView evidence.

This task made **zero actual external provider requests**, received **zero model responses**, and consumed **zero provider tokens** because it never launched the provider-capable host. The previous unintended inference remains preserved under its original report and is not retroactively reclassified as an offline test.

Read-only before/after settings checks: WinHTTP proxy was direct; WinINET ProxyEnable was 0, with no PAC/proxy URL; all firewall profiles enabled with outbound default NotConfigured. No firewall, proxy, system/user registry, Windows Sandbox, AppContainer, or other networking configuration was modified.

## Next authorization

**STOP. Do not run a hosted notes control.** A separately authorized, OS-enforced sandbox must prove complete host and WebView2 child-process egress denial, working loopback, and crash-safe cleanup before the native WebView dry run may be enabled. The current fail-closed guard protects against silently repeating the previous unintended inference. No reset, clean, push, or production modification was performed.
