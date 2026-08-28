import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  AGENT_PERMISSION_MODE_LABELS,
  AGENT_PERMISSION_MODES,
  DEFAULT_AGENT_PERMISSION_PROFILE,
  type AgentPermissionMode,
  type AgentPermissionProfile,
  type AgentPermissionProfiles,
} from "@/modules/ai/lib/permissions";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setAgentPermissionProfiles } from "@/modules/settings/store";
import {
  ArrowDown01Icon,
  SecurityWarningIcon,
  Shield01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

type Props = {
  agentId: string;
  compact?: boolean;
  className?: string;
};

export function withAgentPermissionProfile(
  profiles: AgentPermissionProfiles,
  agentId: string,
  profile: AgentPermissionProfile,
): AgentPermissionProfiles {
  return { ...profiles, [agentId]: profile };
}

export function requiresFullAccessConfirmation(
  current: AgentPermissionMode,
  next: AgentPermissionMode,
): boolean {
  return next === "full-access" && current !== "full-access";
}

export function AgentPermissionControl({
  agentId,
  compact = false,
  className,
}: Props) {
  const profiles = usePreferencesStore((state) => state.agentPermissionProfiles);
  const profile = profiles[agentId] ?? DEFAULT_AGENT_PERMISSION_PROFILE;
  const [confirmFullAccess, setConfirmFullAccess] = useState(false);

  const persistMode = (mode: AgentPermissionMode) => {
    void setAgentPermissionProfiles(
      withAgentPermissionProfile(profiles, agentId, {
        mode,
        categories: profile.categories,
      }),
    );
  };

  const chooseMode = (mode: AgentPermissionMode) => {
    if (requiresFullAccessConfirmation(profile.mode, mode)) {
      setConfirmFullAccess(true);
      return;
    }
    persistMode(mode);
  };

  const fullAccess = profile.mode === "full-access";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex min-w-0 items-center gap-1 rounded-[var(--clack-radius-button)] border px-1.5 py-1 text-[10.5px] transition-colors",
              fullAccess
                ? "border-[color:var(--clack-warning)]/50 bg-[color:var(--clack-warning)]/10 text-[var(--clack-warning)]"
                : "border-[color:var(--clack-border-subtle)] text-[var(--clack-text-3)] hover:bg-[var(--clack-accent-soft)] hover:text-[var(--clack-text-1)]",
              className,
            )}
            aria-label={`Agent permissions: ${AGENT_PERMISSION_MODE_LABELS[profile.mode]}`}
            title={`Agent permissions: ${AGENT_PERMISSION_MODE_LABELS[profile.mode]}`}
          >
            <HugeiconsIcon
              icon={fullAccess ? SecurityWarningIcon : Shield01Icon}
              size={11}
              strokeWidth={1.8}
            />
            <span className="truncate">
              {compact ? "" : "Permissions: "}
              {AGENT_PERMISSION_MODE_LABELS[profile.mode]}
            </span>
            <HugeiconsIcon icon={ArrowDown01Icon} size={9} strokeWidth={2} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-48">
          {AGENT_PERMISSION_MODES.map((mode) => (
            <DropdownMenuItem
              key={mode}
              onSelect={() => chooseMode(mode)}
              className={cn(
                "text-xs",
                mode === "full-access" && "text-[var(--clack-warning)]",
              )}
            >
              {AGENT_PERMISSION_MODE_LABELS[mode]}
              {profile.mode === mode ? (
                <span className="ml-auto text-[10px] text-muted-foreground">
                  Current
                </span>
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmFullAccess} onOpenChange={setConfirmFullAccess}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enable Full Access?</AlertDialogTitle>
            <AlertDialogDescription>
              Clack will stop asking before tools run for this agent. Existing
              operating-system, Tauri, workspace, and secret-path restrictions
              still apply. This does not grant administrator or root access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current mode</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => persistMode("full-access")}
            >
              Enable Full Access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
