import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { HugeiconsIcon } from "@hugeicons/react";
import { Settings01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { loadChatToolSummary } from "@/modules/ai/lib/chatToolSummary";

export function ChatToolsControl({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof loadChatToolSummary>> | null>(null);
  const [error, setError] = useState("");
  const session = useChatStore((s) =>
    s.sessions.find((item) => item.id === sessionId),
  );
  const profiles = usePreferencesStore(s => s.agentPermissionProfiles);
  const grants = usePreferencesStore(s => s.agentWorkspacePermissions);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Native access must refresh when its owner or permission configuration changes.
  useEffect(() => {
    setSummary(null);
    setError("");
    if (!open) return;
    let live = true;
    let sequence = 0;
    const refresh = async () => {
      const ticket = ++sequence;
      try {
        const value = await loadChatToolSummary(sessionId);
        if (live && ticket === sequence) { setSummary(value); setError(""); }
      } catch { if (live && ticket === sequence) { setSummary(null); setError("Tool access unavailable."); } }
    };
    void refresh();
    const pending = [listen("clack:custom-tools-changed", refresh).catch(() => { if (live) setError("Tool updates unavailable; reopen to refresh."); return () => {}; })];
    return () => { live = false; for (const listener of pending) void listener.then(stop => stop()).catch(() => {}); };
  }, [open, sessionId, session?.profile, session?.run?.state, session?.run?.startedAt, profiles, grants]);
  const count = summary ? summary.builtin.filter(item => item.decision !== "deny").length + (summary.custom?.filter(item => item.available).length ?? 0) : null;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button size="sm" variant="ghost" className="h-7 gap-1 px-1.5 text-xs" aria-label="Tools for this chat" title="Tools for this chat"><HugeiconsIcon icon={Settings01Icon} size={13} />Tools{count !== null ? ` (${count})` : ""}</Button></PopoverTrigger>
    <PopoverContent align="start" className="w-80 max-w-[calc(100vw-16px)] max-h-[70dvh] overflow-y-auto space-y-2 text-xs [overflow-wrap:anywhere]">
      <h3 className="font-medium">Tools for this chat</h3>
      <p className="text-muted-foreground">{session?.profile?.workspaceRoot ?? "No workspace bound"}</p>
      {!summary && !error && <p role="status">Loading scoped access...</p>}
      {error && <p role="alert">{error}</p>}
      {summary && <>
        <p>{count} available candidates; request-specific selection.</p>
        <details><summary className="cursor-pointer focus-visible:outline">Built-in tools</summary><ul>{summary.builtin.map(item => <li key={item.name}>{item.name}: {item.decision === "deny" ? "Denied" : item.decision === "prompt" ? "Approval required" : "Available"}</li>)}</ul></details>
        <details><summary className="cursor-pointer focus-visible:outline">Assigned custom tools and MCP</summary>
          {summary.custom === null ? <p>Registry unavailable</p> : summary.custom.length === 0 ? <p>No assigned custom tools</p> : <ul>{summary.custom.map(item => <li key={item.id}>{item.name}: {item.status}{item.available && item.approval ? " - Approval required" : ""} ({item.binding})</li>)}</ul>}
          {summary.connections === null ? <p>MCP status unavailable</p> : summary.connections.filter(item => item.assigned).map(item => <div key={item.id} className="mt-2"><p>{item.current.config.name}: {item.status}</p><p>{item.current.config.endpoint}</p><p>{item.current.config.transport === "local-native" ? "Local native launcher unavailable" : "External destination; native consent and exact execution approval apply"}</p></div>)}
        </details>
      </>}
      <Button variant="outline" size="sm" onClick={() => { setOpen(false); void openSettingsWindow("agents", { sessionId }); }}>Manage tools in Settings</Button>
    </PopoverContent>
  </Popover>;
}
