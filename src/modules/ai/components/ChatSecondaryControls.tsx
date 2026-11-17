import type { ReactNode } from "react";
import { ChatToolsControl } from "@/modules/ai/components/ChatToolsControl";
import { ChatConnectionControl } from "@/modules/ai/components/ChatConnectionControl";
import {
  ChatFallbackControl,
  fallbackPolicyLabel,
} from "@/modules/ai/components/ChatFallbackControl";
import { EffortControl } from "@/modules/ai/components/EffortControl";
import { AgentPermissionControl } from "@/modules/ai/components/AgentPermissionControl";
import { DeploymentQualificationControl } from "@/modules/ai/components/DeploymentQualificationControl";
import { DeploymentSuitabilityControl } from "@/modules/ai/components/DeploymentSuitabilityControl";
import { DeploymentMeasurementControl } from "@/modules/ai/components/DeploymentMeasurementControl";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  AGENT_PERMISSION_MODE_LABELS,
  DEFAULT_AGENT_PERMISSION_PROFILE,
} from "@/modules/ai/lib/permissions";

export function ChatSecondaryControls({
  sessionId,
  agentId,
  capacity,
}: {
  sessionId: string;
  agentId: string;
  capacity?: ReactNode;
}) {
  const profile = usePreferencesStore(
    (s) =>
      s.agentPermissionProfiles[agentId] ?? DEFAULT_AGENT_PERMISSION_PROFILE,
  );
  const fallback = useChatStore(
    (s) => s.sessions.find((item) => item.id === sessionId)?.fallback?.mode,
  );
  return (
    <details className="w-full min-w-0 text-[11px]">
      <summary className="cursor-pointer py-1 text-muted-foreground [overflow-wrap:anywhere] focus-visible:outline focus-visible:outline-1">
        Controls{" "}
        <span className="ml-1">
          Permissions: {AGENT_PERMISSION_MODE_LABELS[profile.mode]} (agent-wide)
          · Fallback: {fallbackPolicyLabel(fallback)}
        </span>
      </summary>
      <fieldset
        className="flex min-w-0 flex-wrap items-center gap-1.5 border-t pt-1"
        aria-label="Conversation controls"
      >
        <EffortControl sessionId={sessionId} />
        <AgentPermissionControl agentId={agentId} />
        <ChatToolsControl sessionId={sessionId} />
        <ChatConnectionControl sessionId={sessionId} />
        <DeploymentQualificationControl sessionId={sessionId} />
        <DeploymentSuitabilityControl sessionId={sessionId} />
        <DeploymentMeasurementControl sessionId={sessionId} />
        <ChatFallbackControl sessionId={sessionId} showLabel />
        {capacity}
      </fieldset>
    </details>
  );
}
