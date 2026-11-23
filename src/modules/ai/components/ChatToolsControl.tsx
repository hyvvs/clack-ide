import { useEffect, useState } from "react";
import type { UIMessage } from "ai";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { HugeiconsIcon } from "@hugeicons/react";
import { Settings01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  cancelRun,
  capturedProviderModelEvidence,
  getChat,
  seedMessages,
  useChatStore,
} from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { loadChatToolSummary } from "@/modules/ai/lib/chatToolSummary";
import { chatConnectionSummary } from "@/modules/ai/lib/chatConnectionSummary";
import { capabilityGroups } from "@/modules/ai/lib/toolCapabilities";
import { refreshTfWebSearchProviderStatus, type WebSearchProviderStatus } from "@/modules/ai/lib/webSearchAdapters";
import { refreshTfBrowserRuntimeStatus, type BrowserRuntimeStatus } from "@/modules/ai/lib/browserRuntimeStatus";

function compactBrowserUrl(raw:string|null):string {
  if(!raw)return "No page loaded";
  try {
    const value=new URL(raw);
    if(!["https:","http:"].includes(value.protocol) || value.username || value.password)
      return "Unverified page URL";
    // Paths, not just query values, can carry arbitrary secret-bearing
    // reset tokens/IDs. Never project raw page-supplied path segments into
    // browser status/action history while we lack an authoritative native
    // nonsecret URL classification.
    return `${value.origin}${value.pathname!=="/"?"/…":""}${value.search?"?…":""}`;
  }
  catch { return "Unverified page URL"; }
}

function browserOrigin(raw:string|null):string {
  if(!raw)return "Not observed";
  try {
    const url=new URL(raw);
    return ["http:","https:"].includes(url.protocol) && !url.username && !url.password
      ?url.origin:"Unverified";
  }catch{return "Unverified";}
}

const BROWSER_OPERATIONS = {
  tf_browser_open:"open",tf_browser_navigate:"navigate",
  tf_browser_inspect:"snapshot",tf_browser_click:"click_link",
  tf_browser_back:"back",tf_browser_close:"close",
} as const;
const BROWSER_TOOL_NAMES=new Set<string>(Object.keys(BROWSER_OPERATIONS));
type BrowserToolName = keyof typeof BROWSER_OPERATIONS;
type BrowserAction = {
  id:string; operation:string; state:string; terminal:string|null;
  effectState:string|null; reason:string|null; page:string|null;
  pending:boolean; approvalDenied:boolean;
  toolResult:"denied"|"unknown"|null;
};
const object=(value:unknown):Record<string,unknown>|null=>
  value!==null && typeof value==="object" && !Array.isArray(value)
    ? value as Record<string,unknown>:null;
const safeText=(value:unknown,max=80):string|null=>
  typeof value==="string" && value.length>0 ? value.slice(0,max):null;

export function browserEngineStatus(browser:BrowserRuntimeStatus|null):string {
  if(!browser)return "Loading · checking native browser status";
  if(browser.reason==="no-actor-scope")return "Unavailable · Agent or workspace scope missing";
  if(!browser.available)return "Error · native browser status unavailable";
  return "Ready · inert native text engine checked (scoped approval still required)";
}

/** Project only the owning chat's tool states and native-confirmed receipt metadata.
 * This is chat history, not an invented native session event log. */
export function projectBrowserActionHistory(messages:readonly UIMessage[],sessionId:string):BrowserAction[] {
  const result:BrowserAction[]=[];
  const seen=new Set<string>();
  for(let m=messages.length-1;m>=0 && result.length<6;m--){
    const message=messages[m];
    if(message.role!=="assistant")continue;
    for(let i=message.parts.length-1;i>=0 && result.length<6;i--){
      const part=object(message.parts[i]);
      const name=typeof part?.type==="string" && part.type.startsWith("tool-")
        ?part.type.slice(5):"";
      if(!BROWSER_TOOL_NAMES.has(name))continue;
      const toolName=name as BrowserToolName;
      const id=safeText(part?.toolCallId,200)??`${message.id}:${i}`;
      if(seen.has(id))continue;
      seen.add(id);
      const output=object(part?.output);
      const receipt=object(output?.effectReceipt);
      const approval=object(part?.approval);
      const state=safeText(part?.state,40)??"unknown";
      const confirmed=(state==="output-available" || state==="output-error") &&
        receipt?.toolId==="tf.browser_operation.v1" &&
        receipt.sessionId===sessionId && receipt.operation===BROWSER_OPERATIONS[toolName] &&
        receipt.engine==="inert_native_text";
      const terminal=confirmed?safeText(receipt?.terminal,40):null;
      const approvalDenied=approval?.approved===false;
      const pending=state==="input-streaming" || state==="input-available" ||
        state==="approval-requested" ||
        (state==="approval-responded" && !approvalDenied);
      const reason=output?.ok===false && typeof output.code==="string" &&
        /^tf_browser_[a-z0-9_]{1,90}$/.test(output.code)?output.code:null;
      const toolResult=!confirmed && reason && output?.terminal==="denied" &&
        output.effectState==="NoEffect"?"denied":
        !confirmed && reason && output?.terminal==="unknown" &&
        output.effectState==="Unknown"?"unknown":null;
      result.push({
        id,operation:BROWSER_OPERATIONS[toolName],state,terminal,
        effectState:confirmed?safeText(receipt?.effectState,40):null,
        reason:confirmed?safeText(receipt?.reasonCode,100):reason,
        page:confirmed && typeof receipt?.finalUrl==="string"
          ?compactBrowserUrl(receipt.finalUrl):null,
        pending,approvalDenied,toolResult,
      });
    }
  }
  return result;
}

export function browserActionStatus(action:BrowserAction):string {
  if(action.terminal)return `${action.terminal}${action.effectState?` · ${action.effectState}`:""}`;
  if(action.toolResult==="denied")return "Tool request denied · NoEffect (no native receipt)";
  if(action.toolResult==="unknown")return "Tool result unknown · native completion unverified";
  if(action.approvalDenied)return "Chat approval denied · no native receipt";
  if(action.state==="output-denied")return "Tool request denied · no native receipt";
  if(action.state==="output-error")return "Tool error · native terminal unverified";
  if(action.state==="output-available")return "Tool returned · native terminal unverified";
  if(action.pending)return action.state==="approval-requested"
    ?"Approval requested in transcript · current approval unverified":
      "Request observed · terminal pending or unverified";
  return "No verified native terminal";
}

export function ChatToolsControl({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<Awaited<
    ReturnType<typeof loadChatToolSummary>
  > | null>(null);
  const [error, setError] = useState("");
  const [webProvider, setWebProvider] = useState<WebSearchProviderStatus|null>(null);
  const [browser, setBrowser] = useState<BrowserRuntimeStatus|null>(null);
  const [browserMessage,setBrowserMessage] = useState("");
  const [browserActions,setBrowserActions] = useState<BrowserAction[]>([]);
  const [closingBrowserSessionId,setClosingBrowserSessionId] = useState<string|null>(null);
  const [stoppingBrowserRun,setStoppingBrowserRun] = useState(false);
  const session = useChatStore((s) =>
    s.sessions.find((item) => item.id === sessionId),
  );
  const profiles = usePreferencesStore((s) => s.agentPermissionProfiles);
  const grants = usePreferencesStore((s) => s.agentWorkspacePermissions);
  const preferences = usePreferencesStore();
  const pendingApprovals=useChatStore(s=>s.pendingApprovalsBySession[sessionId]);
  const browserApprovals=pendingApprovals?.filter(approval=>
    approval.sessionId===sessionId &&
    BROWSER_TOOL_NAMES.has(approval.toolName))??[];
  const browserActor=session?.run?.agentId ?? session?.profile?.agentId ?? null;
  const browserRoot=session?.run?.checkoutRoot ?? session?.run?.workspaceRoot ??
    session?.profile?.workspaceRoot ?? null;
  async function refreshBrowser():Promise<void> {
    const status=await refreshTfBrowserRuntimeStatus(browserActor,sessionId,browserRoot);
    setBrowser(status);
  }
  async function closeBrowser(browserSessionId:string):Promise<void> {
    if(!browserActor || !browserRoot || closingBrowserSessionId)return;
    setClosingBrowserSessionId(browserSessionId);
    setBrowserMessage("Closing isolated browser session…");
    try {
      const prepared=await invoke<{token:string;requestId:string;operation:string;
        browserSessionId:string|null;workspaceRoot:string;requiresApproval:boolean;
        engine:string}>("tf_browser_prepare",{
        request:{operation:"close",actor:browserActor,sessionId,
          workspaceRoot:browserRoot,browserSessionId},
      });
      if(prepared.operation!=="close" || typeof prepared.token!=="string" ||
        prepared.token.length===0 || prepared.token.length>512 ||
        typeof prepared.requestId!=="string" || prepared.requestId.length===0 ||
        prepared.requestId.length>256 || prepared.browserSessionId!==browserSessionId ||
        prepared.engine!=="inert_native_text" || prepared.requiresApproval!==false)
        throw Error("unexpected-browser-token");
      const receipt=await invoke<{toolId:string;requestId:string;actor:string;
        sessionId:string;browserSessionId:string|null;operation:string;
        terminal:string;effectState:string;policyDecision:string;reasonCode:string}>("tf_browser_execute",{
        token:prepared.token,
      });
      if(receipt.toolId!=="tf.browser_operation.v1" ||
        receipt.requestId!==prepared.requestId || receipt.actor!==browserActor ||
        receipt.sessionId!==sessionId || receipt.browserSessionId!==browserSessionId ||
        receipt.operation!=="close")throw Error("browser-close-receipt-mismatch");
      setBrowserMessage(receipt.terminal==="completed" &&
        receipt.effectState==="Observed" && receipt.policyDecision==="allowed"
        ?"Native session close confirmed."
        :`Close ${safeText(receipt.terminal,32)??"unknown"} · ${safeText(receipt.reasonCode,80)??"reason unavailable"} · effect ${safeText(receipt.effectState,32)??"unknown"}`);
    }catch { setBrowserMessage("Close result unverified; native authority denied or unavailable. Check session status before retrying."); }
    finally {
      setClosingBrowserSessionId(null);
      await refreshBrowser();
    }
  }
  const support = chatConnectionSummary(
    session,
    preferences,
    capturedProviderModelEvidence.get(sessionId),
  ).capabilities?.tools;
  // biome-ignore lint/correctness/useExhaustiveDependencies: Native access must refresh when its owner or permission configuration changes.
  useEffect(() => {
    setSummary(null);
    setError("");
    setWebProvider(null);
    setBrowser(null);
    setBrowserMessage("");
    setBrowserActions([]);
    setClosingBrowserSessionId(null);
    setStoppingBrowserRun(false);
    if (!open) return;
    let live = true;
    let sequence = 0;
    const refresh = async () => {
      const ticket = ++sequence;
      try {
        const value = await loadChatToolSummary(sessionId);
        if (live && ticket === sequence) {
          setSummary(value);
          setError("");
        }
      } catch {
        if (live && ticket === sequence) {
          setSummary(null);
          setError("Tool access unavailable.");
        }
      }
    };
    void refresh();
    const pending = [
      listen("clack:custom-tools-changed", refresh).catch(() => {
        if (live) setError("Tool updates unavailable; reopen to refresh.");
        return () => {};
      }),
    ];
    void refreshTfWebSearchProviderStatus().then(status=>{
      if(live)setWebProvider(status);
    }).catch(()=>{
      if(live)setWebProvider(null);
    });
    let browserTicket=0;
    const refreshBrowserPanel=()=>{
      const ticket=++browserTicket;
      setBrowserActions(projectBrowserActionHistory(
        getChat(sessionId)?.messages??seedMessages.get(sessionId)??[],sessionId));
      void refreshTfBrowserRuntimeStatus(browserActor,sessionId,browserRoot).then(status=>{
        if(live && ticket===browserTicket)setBrowser(status);
      });
    };
    refreshBrowserPanel();
    const poll=window.setInterval(refreshBrowserPanel,3000);
    return () => {
      live = false;
      window.clearInterval(poll);
      for (const listener of pending)
        void listener.then((stop) => stop()).catch(() => {});
    };
  }, [
    open,
    sessionId,
    session?.profile,
    session?.run?.state,
    session?.run?.startedAt,
    profiles,
    grants,
    browserActor,
    browserRoot,
  ]);
  const count = summary
    ? summary.builtin.filter((item) => item.decision !== "deny").length +
      (summary.custom?.filter((item) => item.available).length ?? 0)
    : null;
  const runActive=session?.run?.state==="running";
  const latestBrowserAction=browserActions[0];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-1.5 text-xs"
          aria-label="Tools for this chat"
          title="What can this Agent do?"
        >
          <HugeiconsIcon icon={Settings01Icon} size={13} />
          Tools
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 max-w-[calc(100vw-16px)] max-h-[min(70dvh,var(--radix-popover-content-available-height))] gap-2 overflow-hidden text-xs [overflow-wrap:anywhere]"
      >
        <h3 className="font-medium">What can this Agent do?</h3>
        <p className="max-h-12 shrink-0 overflow-auto text-muted-foreground">
          {session?.profile?.workspaceRoot ?? "No workspace bound"}
        </p>
        <div className="min-h-0 space-y-2 overflow-y-auto">
          {!summary && !error && <p role="status">Loading scoped access...</p>}
          {error && <p role="alert">{error}</p>}
          {summary && (
            <>
              <p className="text-muted-foreground">
                Built-in capabilities. Access depends on this Agent's
                permissions, workspace and model.
              </p>
              <p className="text-muted-foreground">
                Web research includes bounded public HTTP/HTTPS retrieval,
                with native DNS, redirect and source evidence. Credentialed
                Brave Search requires separate configuration and exact approval.
                Private-network access is denied by normal web policy.
              </p>
              <p className="text-[11px] text-muted-foreground" role="status">
                Search provider: {webProvider?.available
                  ? "Brave Web Search configured and natively available"
                  : webProvider?.reason
                    ? `Unavailable (${webProvider.reason}) — configure a Brave key using the existing secure credential store`
                    : "Checking native provider availability"}
              </p>
              <section aria-label="Browser sessions" className="space-y-1.5 border-t pt-2">
                <div className="flex items-baseline justify-between gap-2">
                  <h4 className="font-semibold">Browser sessions</h4>
                  <span className="text-[10px] text-muted-foreground">
                    {browser?.available ? `${browser.sessions.length} active` : browser ? "Unavailable" : "Checking…"}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground" role="status">
                  Browser: {browserEngineStatus(browser)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Bounded public-page text and snapshot-scoped links only.
                  Model DOM interaction, JavaScript and screenshots: <strong>Not enabled</strong>.
                </p>
                <p className="text-[11px] text-muted-foreground">
                  File transfers · downloads: <strong>Not enabled</strong> · uploads: <strong>Not enabled</strong>.
                </p>
                {runActive && browserApprovals.length>0 ? (
                  <p className="text-[11px] font-medium" role="status">
                    Current pending chat approval{browserApprovals.length===1?"":"s"} ({browserApprovals.length}): {browserApprovals.slice(0,2).map(approval=>
                      BROWSER_OPERATIONS[approval.toolName as BrowserToolName].replace(/_/g," ")).join(", ")}{browserApprovals.length>2?", …":""} · review in chat.
                  </p>
                ):null}
                {latestBrowserAction ? (
                  <div className="rounded border px-2 py-1.5 space-y-1 text-[11px]">
                    <p className="font-medium">
                      Latest observed Agent browser action: {latestBrowserAction.operation.replace(/_/g," ")}
                    </p>
                    <p className="text-muted-foreground">
                      {browserActionStatus(latestBrowserAction)}
                      {latestBrowserAction.reason ? ` · Reason: ${latestBrowserAction.reason}` : ""}
                    </p>
                    {latestBrowserAction.page ? (
                      <p className="text-muted-foreground">Receipt page: {latestBrowserAction.page}</p>
                    ):null}
                  </div>
                ):null}
                {runActive ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" className="h-6 text-[11px]"
                      disabled={stoppingBrowserRun}
                      onClick={()=>{
                        setStoppingBrowserRun(true);
                        void cancelRun(sessionId,{source:"explicit-user",reason:"user-stop"})
                          .catch(()=>setBrowserMessage("Agent run cancellation could not be verified."))
                          .finally(()=>setStoppingBrowserRun(false));
                      }}>
                      {stoppingBrowserRun ? "Stopping Agent run…" : "Stop Agent run"}
                    </Button>
                    <p className="text-[10px] text-muted-foreground">Stops the entire Agent run; browser cancellation depends on native execution state.</p>
                  </div>
                ):null}
                {browser?.available && browser.sessions.length===0 ? (
                  <p className="text-[11px] text-muted-foreground">No active inert text browser sessions reported for this chat.</p>
                ):null}
                {browser?.sessions.map(page=>(
                  <div key={page.browserSessionId} className="rounded border px-2 py-1.5 space-y-1">
                    <p className="font-medium">Current page: {compactBrowserUrl(page.currentUrl)}</p>
                    <p className="text-[11px] text-muted-foreground">Origin: {browserOrigin(page.currentUrl)}</p>
                    <p className="text-[11px] text-muted-foreground">Page: {page.currentUrl && page.snapshotId ? "Snapshot observed" : "No verified snapshot"}</p>
                    <p className="text-[11px] text-muted-foreground">
                      Active session {page.browserSessionId.slice(0,12)} · idle expiry in {page.expiresInSecs}s
                    </p>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-muted-foreground">Engine: inert native text</span>
                      <Button size="sm" variant="outline" className="h-6 text-[11px]"
                        disabled={closingBrowserSessionId!==null}
                        onClick={()=>{void closeBrowser(page.browserSessionId);}}>
                        {closingBrowserSessionId===page.browserSessionId ? "Closing…" : "Close session"}
                      </Button>
                    </div>
                    <details className="text-[10px] text-muted-foreground">
                      <summary className="cursor-pointer">Session diagnostics</summary>
                      <p>Snapshot: {page.snapshotId??"none"}</p>
                      <p>History entries: {page.historyLength} · Engine: {page.engine}</p>
                      <p>Isolation: {page.isolation}</p>
                    </details>
                  </div>
                ))}
                {browserMessage?<p role="status" className="text-[11px]">{browserMessage}</p>:null}
                <details className="text-[11px] text-muted-foreground">
                  <summary className="cursor-pointer">Recent Agent browser actions ({browserActions.length})</summary>
                  {browserActions.length ? (
                    <ol className="max-h-40 space-y-1 overflow-y-auto pt-1">
                      {browserActions.map(action=>(
                        <li key={action.id} className="rounded border px-2 py-1">
                          <span className="font-medium">{action.operation.replace(/_/g," ")}</span>
                          {" · "}{browserActionStatus(action)}
                          {action.reason?` · Reason: ${action.reason}`:""}
                        </li>
                      ))}
                    </ol>
                  ):<p className="pt-1">No browser tool actions observed in this chat.</p>}
                </details>
              </section>
              {capabilityGroups(summary.builtin, support, summary.readOnly).map(
                (group) => (
                  <section
                    key={group.category}
                    aria-label={group.category}
                    className="space-y-1 border-t pt-2"
                  >
                    <h4 className="font-semibold">{group.category}</h4>
                    <ul className="space-y-2">
                      {group.entries.map((item) => (
                        <li key={item.name} className="min-w-0">
                          <p>{item.label}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {item.state}
                            {item.state === "Model support unverified" &&
                            item.name &&
                            summary.builtin.find(
                              (tool) => tool.name === item.name,
                            )?.decision === "prompt"
                              ? " - Ask before use"
                              : ""}
                          </p>
                          {item.name === "bounded_command" && (
                            <p className="text-[10.5px] text-muted-foreground">
                              Native-only Git command · writes require Allow once · Windows filesystem/network isolation unsupported
                            </p>
                          )}
                          {item.name.startsWith("tf_fs_") || item.name.startsWith("tf_repo_") || item.name === "tf_build_run" ? (
                            <p className="text-[10.5px] text-muted-foreground">
                              Structured native Tool Fabric operation · scoped paths and effect receipts
                              {item.name === "tf_fs_write" || item.name === "tf_fs_delete" || item.name === "tf_repo_write" || item.name === "tf_build_run"
                                ? " · exact Allow once and native confirmation for effects"
                                : " · read policy applies"}
                              {" · "}filesystem/network OS isolation unsupported
                            </p>
                          ) : null}
                          {["tf_http_fetch","tf_http_head","tf_web_search"].includes(item.name) ? (
                            <p className="text-[10.5px] text-muted-foreground">
                              Native bounded web research · per-target policy, DNS/redirect
                              checks and one-use approval
                              {item.name==="tf_web_search" ? " · Brave key from existing secret store and native confirmation required" : " · untrusted HTTP source evidence"}
                              {" · "}OS-level network isolation unsupported
                            </p>
                          ) : null}
                          {item.name.startsWith("tf_browser_") ? (
                            <p className="text-[10.5px] text-muted-foreground">
                              Native Clack-owned ephemeral page session · public URL/redirect DNS checks · source/element snapshot receipts · one-use approval. No remote WebView, scripts, forms or screenshots in this engine.
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                ),
              )}
              <section
                aria-label="External tools"
                className="space-y-2 border-t pt-2"
              >
                <h4 className="font-semibold">External tools</h4>
                <p className="text-muted-foreground">
                  Optional API, MCP and reviewed WASI integrations.
                </p>
                {summary.custom === null ? (
                  <p>Custom tool access unavailable</p>
                ) : summary.custom.length === 0 ? (
                  <p>Custom integrations: Not configured for this Agent</p>
                ) : (
                  summary.custom.map((item) => (
                    <div key={item.id}>
                      <p>{item.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {!item.available
                          ? /unavailable|unsupported|native process|launcher/i.test(
                              item.status,
                            )
                            ? "Unsupported or unavailable for this Agent/runtime"
                            : "Not allowed / not assigned"
                          : support === "unsupported"
                            ? "Unsupported by this model"
                            : support !== "supported"
                              ? "Model support unverified"
                              : item.approval
                                ? "Ask before use"
                                : "Available"}
                      </p>
                    </div>
                  ))
                )}
                {summary.connections === null ? (
                  <p>MCP status unavailable</p>
                ) : !summary.connections.some((item) => item.assigned) ? (
                  <p>MCP connections: Not configured for this Agent</p>
                ) : (
                  summary.connections
                    .filter((item) => item.assigned)
                    .map((item) => (
                      <div key={item.id}>
                        <p>
                          {item.current.config.name}: {item.status}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {item.current.config.transport === "local-native"
                            ? "Unsupported: Local native launcher unavailable"
                            : "External destination; native consent and execution approval required"}
                        </p>
                      </div>
                    ))
                )}
              </section>
              <details>
                <summary className="cursor-pointer focus-visible:outline">
                  Technical details
                </summary>
                <p>
                  {count} permission-eligible candidates; runtime and request
                  checks still apply.
                </p>
                <p className="text-muted-foreground">
                  TF policy decisions shown here are pre-exposure assessments,
                  not execution grants. Native launchers independently recheck
                  workspace, process, approval and resource authority.
                </p>
                <ul>
                  {summary.builtin.map((item) => (
                    <li key={item.name}>
                      {item.name}:{" "}
                      {item.decision === "deny"
                        ? "Denied"
                        : item.decision === "prompt"
                          ? "Approval required"
                          : "Permission allows"}{" "}
                      ({item.semanticCapability}; {item.permissionClass}; effect {item.effectClass};
                      {" "}TF {item.policyDecision} / {item.policyReason};
                      {" "}{item.effects.join(", ")}; {item.provenance})
                    </li>
                  ))}
                </ul>
              </details>
              <details>
                <summary className="cursor-pointer focus-visible:outline">
                  Assigned custom tools and MCP
                </summary>
                {summary.custom === null ? (
                  <p>Registry unavailable</p>
                ) : summary.custom.length === 0 ? (
                  <p>No assigned custom tools</p>
                ) : (
                  <ul>
                    {summary.custom.map((item) => (
                      <li key={item.id}>
                        {item.name}: {item.status}
                        {item.available && item.approval
                          ? " - Approval required"
                          : ""}{" "}
                        ({item.binding})
                      </li>
                    ))}
                  </ul>
                )}
                {summary.connections === null ? (
                  <p>MCP status unavailable</p>
                ) : (
                  summary.connections
                    .filter((item) => item.assigned)
                    .map((item) => (
                      <div key={item.id} className="mt-2">
                        <p>
                          {item.current.config.name}: {item.status}
                        </p>
                        <p>{item.current.config.endpoint}</p>
                        <p>
                          {item.current.config.transport === "local-native"
                            ? "Local native launcher unavailable"
                            : "External destination; native consent and exact execution approval apply"}
                        </p>
                      </div>
                    ))
                )}
              </details>
            </>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => {
            setOpen(false);
            void openSettingsWindow("agents", { sessionId });
          }}
        >
          Manage Agent tools
        </Button>
      </PopoverContent>
    </Popover>
  );
}
