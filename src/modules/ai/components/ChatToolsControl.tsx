import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { HugeiconsIcon } from "@hugeicons/react";
import { Settings01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  capturedProviderModelEvidence,
  useChatStore,
} from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { loadChatToolSummary } from "@/modules/ai/lib/chatToolSummary";
import { chatConnectionSummary } from "@/modules/ai/lib/chatConnectionSummary";
import { capabilityGroups } from "@/modules/ai/lib/toolCapabilities";
import { refreshTfWebSearchProviderStatus, type WebSearchProviderStatus } from "@/modules/ai/lib/webSearchAdapters";

export function ChatToolsControl({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<Awaited<
    ReturnType<typeof loadChatToolSummary>
  > | null>(null);
  const [error, setError] = useState("");
  const [webProvider, setWebProvider] = useState<WebSearchProviderStatus|null>(null);
  const session = useChatStore((s) =>
    s.sessions.find((item) => item.id === sessionId),
  );
  const profiles = usePreferencesStore((s) => s.agentPermissionProfiles);
  const grants = usePreferencesStore((s) => s.agentWorkspacePermissions);
  const preferences = usePreferencesStore();
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
    return () => {
      live = false;
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
  ]);
  const count = summary
    ? summary.builtin.filter((item) => item.decision !== "deny").length +
      (summary.custom?.filter((item) => item.available).length ?? 0)
    : null;
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
