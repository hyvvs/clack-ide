import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { fmtShortcut, MOD_KEY } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { invoke } from "@tauri-apps/api/core";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import {
  Add01Icon,
  AiBookIcon,
  AppleIcon,
  ArrowDown01Icon,
  ArrowUpIcon,
  BrainIcon,
  Cancel01Icon,
  ChatGptIcon,
  ClaudeIcon,
  Clock01Icon,
  CoinsDollarIcon,
  ComputerIcon,
  CpuIcon,
  DeepseekIcon,
  FavouriteIcon,
  FlashIcon,
  GlobeIcon,
  GoogleGeminiIcon,
  Grok02Icon,
  MistralIcon,
  Message01Icon,
  Mic01Icon,
  PlugIcon,
  ServerStack01Icon,
  Search01Icon,
  Settings01Icon,
  StarIcon,
  StopCircleIcon,
  SquareLock01Icon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useModelSelectionLock } from "@/modules/ai/hooks/useModelSelectionLock";
import { useModelSwitch } from "@/modules/ai/hooks/useModelSwitch";
import { EffortControl } from "@/modules/ai/components/EffortControl";
import { ModelSwitchNotice } from "./ModelSwitchNotice";
import {
  compatModelIdForEndpoint,
  getCompatModelInfo,
  isCompatModelId,
  MODELS,
  providerNeedsKey,
  PROVIDERS,
  STT_PROVIDER_LABELS,
  type ModelCapabilities,
  type ModelInfo,
  type ProviderId,
} from "../config";
import { ACCEPTED_FILES, useComposer } from "../lib/composer";
import { toggleFavoriteModel } from "../lib/modelPrefs";
import { partitionProvidersByConfiguration } from "../lib/providerOrdering";
import {
  getEnabledSavedProviderModelInfos,
  modelSelectionMatchesQuery,
  resolveModelSelectionInfo,
} from "../lib/savedProviderModels";
import { useChatStore } from "../store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { AI_CHAT_TOOLTIP, AiChatButton } from "./AiChatButton";
import { savedSelfHostedModelInfos, selfHostedPickerStatus, canonicalSelfHostedSelectionId, managedReconnectAvailable, selfHostedSelectionId } from "@/modules/ai/lib/selfHostedModels";
import { endpointBackend, profileIdentity, resolveSelfHostedSelection, type SelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import { useSelfHostedInventory } from "@/modules/ai/hooks/useSelfHostedInventory";
import { hasKeyForModel } from "@/modules/ai/store/chatStore";
import { modelConnectionLabel } from "@/modules/ai/lib/connectionPresentation";
import { chatConnectionSummary } from "@/modules/ai/lib/chatConnectionSummary";
import { reconcileLocalComputeFabric, type ModelArtifact, type ModelDeployment } from "@/modules/ai/lib/localComputeFabric";
import {
  isManagedLocalSelectionId,
  resolveManagedLocalSelection,
  savedManagedLocalModelInfos,
} from "@/modules/ai/lib/managedLocalModels";

const PROVIDER_ICON = {
  openai: ChatGptIcon,
  anthropic: ClaudeIcon,
  google: GoogleGeminiIcon,
  xai: Grok02Icon,
  cerebras: CpuIcon,
  groq: FlashIcon,
  deepseek: DeepseekIcon,
  mistral: MistralIcon,
  openrouter: GlobeIcon,
  "openai-compatible": PlugIcon,
  lmstudio: ComputerIcon,
  mlx: AppleIcon,
  ollama: ServerStack01Icon,
} as const satisfies Record<ProviderId, typeof ChatGptIcon>;

export function AiOpenButton({
  open,
  onOpen,
}: {
  open: boolean;
  onOpen: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          onClick={onOpen}
          size="xs"
          variant={open ? "secondary" : "outline"}
          className="animate-in gap-1.5 slide-in-from-top-2 duration-200 ease-out"
          aria-label={AI_CHAT_TOOLTIP}
          aria-pressed={open}
          data-state={open ? "open" : "closed"}
        >
          <HugeiconsIcon icon={Message01Icon} size={13} strokeWidth={1.75} />
          <span>AI Chat</span>
          <Kbd className="h-4 min-w-4 px-1">{fmtShortcut(MOD_KEY, "I")}</Kbd>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{AI_CHAT_TOOLTIP}</TooltipContent>
    </Tooltip>
  );
}

export function AiStatusBarControls() {
  const c = useComposer();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const openExperience = useChatStore((s) => s.openExperience);
  const miniOpen = useChatStore((s) => s.mini.open);
  const closePanel = useChatStore((s) => s.closePanel);

  return (
    <div className="flex items-center gap-0.5">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPTED_FILES}
        className="hidden"
        onChange={(e) => {
          void c.addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <IconBtn
        title="Attach file or image"
        onClick={() => fileInputRef.current?.click()}
        disabled={c.isBusy}
      >
        <HugeiconsIcon icon={Add01Icon} size={13} strokeWidth={2} />
      </IconBtn>

      {c.voice.supported && (
        <IconBtn
          title={
            !c.voice.hasKey
              ? `Voice needs a ${STT_PROVIDER_LABELS[c.voice.sttProvider]} key`
              : c.voice.recording
                ? "Stop & transcribe"
                : c.voice.transcribing
                  ? "Transcribing…"
                  : "Voice input"
          }
          onClick={() =>
            c.voice.recording ? c.voice.stop() : void c.voice.start()
          }
          disabled={c.isBusy || c.voice.transcribing || !c.voice.hasKey}
          className={cn(
            c.voice.recording &&
              "bg-destructive/10 text-destructive hover:bg-destructive/15",
          )}
        >
          {c.voice.recording ? (
            <span className="size-2 animate-pulse rounded-full bg-destructive" />
          ) : c.voice.transcribing ? (
            <Spinner className="size-3" />
          ) : (
            <HugeiconsIcon icon={Mic01Icon} size={13} strokeWidth={1.75} />
          )}
        </IconBtn>
      )}

      <ModelDropdown />
      <EffortControl />

      <span className="mx-1 h-8 w-px bg-border" aria-hidden />
      <Button
        onClick={closePanel}
        title="Hide compact AI composer"
        size="icon-xs"
        variant="ghost"
        aria-label="Hide compact AI composer"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
      </Button>
      <Tooltip>
        <TooltipTrigger asChild>
          <AiChatButton open={miniOpen} onOpen={openExperience} />
        </TooltipTrigger>
        <TooltipContent side="top">{AI_CHAT_TOOLTIP}</TooltipContent>
      </Tooltip>

      {c.isBusy ? (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={c.stop}
          className="size-6"
          aria-label="Stop"
          title="Stop"
        >
          <HugeiconsIcon icon={StopCircleIcon} size={13} strokeWidth={1.75} />
        </Button>
      ) : (
        <Button
          type="button"
          size="icon"
          onClick={c.submit}
          disabled={!c.canSend}
          className="h-5.5 w-7.5 ml-1"
          aria-label="Send"
          title="Send (Enter)"
        >
          <HugeiconsIcon icon={ArrowUpIcon} size={13} strokeWidth={1.75} />
        </Button>
      )}
    </div>
  );
}

type Tab = "all" | "favorites" | "recent";

/** Read-only native observation. The persisted fabric has no authority to assert Ready. */
export type ManagedPickerRuntimeStatus = {
  installed: boolean;
  state: string;
  epoch?: string | null;
  deploymentId?: string | null;
  modelDigest?: string | null;
};

function readManagedPickerRuntimeStatus(value: unknown): ManagedPickerRuntimeStatus | null {
  if (typeof value !== "object" || value === null) return null;
  const status = value as Record<string, unknown>;
  if (typeof status.installed !== "boolean" || typeof status.state !== "string") return null;
  for (const field of ["epoch", "deploymentId", "modelDigest"]) {
    if (status[field] !== undefined && status[field] !== null && typeof status[field] !== "string") return null;
  }
  return status as ManagedPickerRuntimeStatus;
}

async function queryManagedPickerRuntimeStatus(
  deploymentId: string, deploymentIdentity: string,
): Promise<ManagedPickerRuntimeStatus | null> {
  try {
    return readManagedPickerRuntimeStatus(await invoke<unknown>("managed_local_runtime_status", {
      deploymentId, deploymentIdentity,
    }));
  } catch {
    // A missing native adapter is a normal not-installed case, never evidence of readiness.
    return null;
  }
}

async function queryManagedModelFilePresence(digest: string): Promise<boolean> {
  try {
    return await invoke<boolean>("managed_local_runtime_model_present", { digest }) === true;
  } catch {
    return false;
  }
}

/** Picker presentation; the provider's routing and admission checks remain authoritative. */
export function modelPickerHostAvailability(
  selectionId: string,
  state: SelfHostedState,
  observed?: ManagedPickerRuntimeStatus | null,
  filePresence?: Record<string, boolean>,
) {
  if (isManagedLocalSelectionId(selectionId)) {
    const managed = resolveManagedLocalSelection(state, selectionId);
    if (managed.status !== "available" && managed.status !== "unavailable")
      return { label: "Unavailable (registration changed)", disabled: true };
    if (!managed.host.enabled || !managed.runtime.enabled)
      return { label: "Registered · runtime disabled", disabled: true };
    if (filePresence?.[managed.artifact.digest!] === false)
      return { label: "Registered · model file missing", disabled: true };
    if (!observed) return { label: "Registered · runtime status unknown", disabled: true };
    if (!observed.installed) return { label: "Registered · not installed", disabled: true };
    const phase = observed.state.toLowerCase();
    if (phase === "ready") {
      if (observed.deploymentId === managed.deployment.id &&
          observed.modelDigest === managed.artifact.digest &&
          typeof observed.epoch === "string" && observed.epoch.length > 0)
        return { label: "Ready · Chat only", disabled: false };
      return { label: "Registered · different deployment loaded", disabled: true };
    }
    const description: Record<string, string> = {
      stopped: "stopped", starting: "starting", loading: "loading",
      failed: "failed", offline: "offline",
    };
    return { label: `Registered · ${description[phase] ?? "runtime unavailable"}`, disabled: true };
  }
  const target = resolveSelfHostedSelection(state, selectionId);
  if (target.status === "available" && target.endpoint.enabled === false)
    return { label: "Disabled in Settings", disabled: true };
  if (target.status === "missing" && state.endpoints.some((endpoint) =>
    endpoint.id === target.endpointId && endpoint.deletedAt === undefined && endpoint.enabled === false))
    return { label: "Disabled in Settings", disabled: true };
  return managedReconnectAvailable(selectionId, state)
    ? { label: "Offline / reconnect", disabled: false }
    : selfHostedPickerStatus(selectionId, state);
}

/** A managed picker click must either advance to the existing per-chat switch
 * admission or yield a visible rejection. This is only a fresh native UX
 * preflight; the model-switch owner still verifies the exact route and epoch. */
export async function recheckManagedPickerSelection(
  selectionId: string,
  state: SelfHostedState,
  readStatus: typeof queryManagedPickerRuntimeStatus = queryManagedPickerRuntimeStatus,
  readPresence: typeof queryManagedModelFilePresence = queryManagedModelFilePresence,
): Promise<
  | { ok: true; observed: ManagedPickerRuntimeStatus; digest: string }
  | { ok: false; reason: string }
> {
  const selected = resolveManagedLocalSelection(state, selectionId);
  if (selected.status !== "available" && selected.status !== "unavailable")
    return { ok: false, reason: "The exact managed deployment identity changed or is missing." };
  const digest = selected.artifact.digest!;
  try {
    const [observed, present] = await Promise.all([
      readStatus(selected.deployment.id, selected.identity),
      readPresence(digest),
    ]);
    // Missing/changed/native-stopped observations may never be promoted to a
    // runnable selection from a persisted label or another runtime's Ready.
    const availability = modelPickerHostAvailability(selectionId, state, observed, { [digest]: present });
    if (!observed || availability?.disabled !== false)
      return { ok: false, reason: `Cannot select this managed deployment: ${availability?.label ?? "native readiness unavailable"}.` };
    return { ok: true, observed, digest };
  } catch {
    return { ok: false, reason: "Cannot verify the exact managed runtime and GGUF. Nothing was switched." };
  }
}

type PickerDeployment = { deployment: ModelDeployment; model: ModelInfo };
type PickerArtifact = { artifact: ModelArtifact; deployments: PickerDeployment[] };
type PickerRuntime = {
  runtimeId: string;
  label: string;
  address: string;
  artifacts: PickerArtifact[];
};
type PickerHost = {
  hostId: string;
  alias: string;
  location: "local" | "remote" | "unknown";
  runtimes: PickerRuntime[];
};

/** Metadata is descriptive, not evidence of current residency, context or tool readiness. */
export function pickerArtifactMetadata(artifact: ModelArtifact): string[] {
  const source = artifact.provenance === "runtime-inventory" ? "Runtime-reported"
    : artifact.provenance === "user-supplied" ? "Registered" : "Recorded";
  const values: string[] = [];
  const formats: Partial<Record<ModelArtifact["format"], string>> = {
    "ollama-manifest": "Ollama manifest", gguf: "GGUF",
    safetensors: "SafeTensors", "mlx-package": "MLX package",
  };
  const format = formats[artifact.format];
  if (format) values.push(`${source} format · ${format}`);
  if (artifact.quantization?.trim())
    values.push(`${source} quantization · ${artifact.quantization}`);
  if (artifact.size !== undefined && artifact.size >= 1024 * 1024) {
    const gib = artifact.size / (1024 ** 3);
    values.push(`${source} size · ${gib >= 1 ? `${gib.toFixed(1)} GiB` : `${(artifact.size / (1024 ** 2)).toFixed(1)} MiB`}`);
  }
  if (artifact.declaredContext !== undefined)
    values.push(`Declared context · ${artifact.declaredContext.toLocaleString("en-US")} tokens`);
  return values;
}

/** Disambiguate same-name deployments without changing exact selection IDs. */
export function pickerDeploymentAccessibleLabel(
  model: ModelInfo,
  destination: string,
  host: PickerHost,
  runtime: PickerRuntime,
  artifact: ModelArtifact,
  deployment: ModelDeployment,
  ordinal: number,
  count: number,
): string {
  return [
    model.label,
    `Host ${host.alias} (${host.location})`,
    `Runtime ${runtime.label}`,
    `Artifact ${artifact.displayName}`,
    ...(artifact.digest ? [`Digest ${artifact.digest}`] : []),
    `Deployment ${ordinal} of ${count}: ${deployment.runtimeModelName}`,
    ...(deployment.variantId ? [`Variant ${deployment.variantId}`] : []),
    destination,
  ].join(". ");
}

/** Skip disabled Radix items when moving from the model search field into the menu. */
export function firstEnabledPickerMenuItem(menu: ParentNode | null): HTMLElement | null {
  return menu?.querySelector<HTMLElement>(
    '[role="menuitem"]:not([data-disabled]):not([aria-disabled="true"])',
  ) ?? null;
}

/** Present exact registered deployments under the Fabric host/runtime/artifact hierarchy. */
export function groupFabricPickerModels(models: readonly ModelInfo[], state: SelfHostedState) {
  const otherModels: ModelInfo[] = [];
  const hostGroups: PickerHost[] = [];
  const fabric = reconcileLocalComputeFabric(state);
  const byHostId = new Map<string, PickerHost>();
  for (const model of models) {
    const managedSelection = isManagedLocalSelectionId(model.id)
      ? resolveManagedLocalSelection(state, model.id) : null;
    const conceptual = managedSelection?.status === "available" || managedSelection?.status === "unavailable"
      ? managedSelection : undefined;
    const target = conceptual ? undefined : resolveSelfHostedSelection(state, model.id);
    // A disabled endpoint is not selectable, but a saved exact profile remains
    // displayable. Never recover deleted endpoints or a stale/ambiguous route.
    const disabledMatches = !conceptual && target?.status === "missing"
      ? state.profiles.flatMap(profile => {
          const endpoint = state.endpoints.find(row => row.id === profile.endpointId &&
            row.deletedAt === undefined && row.enabled === false);
          const inventoried = state.inventories?.some(inventory =>
            inventory.endpointId === profile.endpointId &&
            inventory.configurationRevision === endpoint?.configurationRevision &&
            inventory.models.some(entry => entry.id === profile.transportModelId &&
              (!profile.modelRevision || entry.digest === profile.modelRevision)));
          if (!endpoint || profile.id !== profileIdentity(profile.endpointId, profile.transportModelId, profile.deploymentId) ||
              (profile.backend && profile.backend !== endpointBackend(endpoint)) ||
              (!profile.saved && endpoint.legacy?.profileId !== profile.id && !inventoried)) return [];
          const id = endpoint.legacy?.profileId === profile.id && !profile.modelRevision
            ? endpoint.legacy.selectionId : selfHostedSelectionId(profile);
          return id === model.id ? [{ endpoint, profile }] : [];
        }) : [];
    const owner = target?.status === "available" ? target
      : disabledMatches.length === 1 ? disabledMatches[0] : undefined;
    if (!conceptual && !owner) {
      otherModels.push(model);
      continue;
    }
    // A legacy selection remains profile-owned. Conceptual GGUF selections
    // must match the exact deployment identity and are display-only.
    const deployment = conceptual?.deployment ?? fabric.deployments.find(row =>
      owner && row.profileId === owner.profile.id && row.id === owner.profile.id);
    const runtime = fabric.runtimes.find(row => row.id === deployment?.runtimeId &&
      row.hostId === deployment?.hostId);
    const host = fabric.hosts.find(row => row.id === deployment?.hostId);
    const artifact = fabric.artifacts.find(row => row.id === deployment?.artifactId);
    if (!deployment || !runtime || !host || !artifact ||
        (conceptual && (conceptual.artifact.id !== artifact.id ||
          conceptual.host.id !== host.id || conceptual.runtime.id !== runtime.id)) ||
        (!conceptual && (!owner ||
          runtime.legacyEndpointId !== owner.endpoint.id ||
          deployment.runtimeModelName !== owner.profile.transportModelId ||
          deployment.configurationRevision !== owner.endpoint.configurationRevision ||
          runtime.configurationRevision !== owner.endpoint.configurationRevision))) {
      otherModels.push(model);
      continue;
    }
    let hostGroup = byHostId.get(host.id);
    if (!hostGroup) {
      hostGroup = {
        hostId: host.id,
        alias: host.displayName,
        location: host.location,
        runtimes: [],
      };
      hostGroups.push(hostGroup);
      byHostId.set(host.id, hostGroup);
    }
    let runtimeGroup = hostGroup.runtimes.find(row => row.runtimeId === runtime.id);
    if (!runtimeGroup) {
      runtimeGroup = {
        runtimeId: runtime.id,
        label: conceptual ? "Clack Managed" : runtime.displayName,
        // An SSH endpoint's synthetic URL is never a user-facing host address.
        address: conceptual ? "Registered local runtime"
          : owner?.endpoint.ssh
            ? "Managed SSH connection"
            : owner?.endpoint.baseURL ?? "",
        artifacts: [],
      };
      hostGroup.runtimes.push(runtimeGroup);
    }
    let artifactGroup = runtimeGroup.artifacts.find(row => row.artifact.id === artifact.id);
    if (!artifactGroup) {
      artifactGroup = { artifact, deployments: [] };
      runtimeGroup.artifacts.push(artifactGroup);
    }
    artifactGroup.deployments.push({ deployment, model });
  }
  return { otherModels, hostGroups };
}

export function ModelDropdown({
  sessionId,
  compact = false,
}: {
  sessionId?: string;
  compact?: boolean;
}) {
  const targetId = useChatStore((s) => sessionId ?? s.activeSessionId);
  const locked = useModelSelectionLock(sessionId);
  const modelSwitch = useModelSwitch(targetId, sessionId === undefined);
  const resetSwitch = modelSwitch.reset;
  const [open, setOpen] = useState(false);
  const managedPickerPending = useRef(false);
  const [checkingManagedPicker, setCheckingManagedPicker] = useState(false);
  const [managedPickerError, setManagedPickerError] = useState<string | null>(null);
  useSelfHostedInventory(open);
  const selfHosted = usePreferencesStore((s) => s.selfHostedInference);
  const managedModels = useMemo(() => savedManagedLocalModelInfos(selfHosted), [selfHosted]);
  // One observation per exact Fabric deployment. A status for managed A must
  // never make B unavailable or visually Ready under the wrong PID/epoch.
  const [managedRuntimeStatuses, setManagedRuntimeStatuses] =
    useState<Record<string, ManagedPickerRuntimeStatus | null>>({});
  const [managedFilePresence, setManagedFilePresence] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!open || managedModels.length === 0) {
      setManagedRuntimeStatuses({});
      return;
    }
    let active = true;
    const refresh = async () => {
      const observations = await Promise.all(managedModels.map(async model => {
        const exact = resolveManagedLocalSelection(selfHosted, model.id);
        if (exact.status !== "available" && exact.status !== "unavailable")
          return [model.id, null] as const;
        return [model.id, await queryManagedPickerRuntimeStatus(
          exact.deployment.id, exact.identity)] as const;
      }));
      if (active) setManagedRuntimeStatuses(Object.fromEntries(observations));
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 2500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [open, managedModels, selfHosted]);
  useEffect(() => {
    if (!open || managedModels.length === 0) {
      setManagedFilePresence({});
      return;
    }
    let active = true;
    const refresh = async () => {
      const statuses = await Promise.all(managedModels.map(async model => {
        const found = resolveManagedLocalSelection(selfHosted, model.id);
        if (found.status !== "available" && found.status !== "unavailable") return null;
        const digest = found.artifact.digest!;
        return [digest, await queryManagedModelFilePresence(digest)] as const;
      }));
      if (active) setManagedFilePresence(Object.fromEntries(statuses.filter(
        (entry): entry is readonly [string, boolean] => entry !== null,
      )));
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 8_000);
    return () => { active = false; clearInterval(timer); };
  }, [open, managedModels, selfHosted]);
  const previousTargetId = useRef(targetId);
  useEffect(() => {
    if (
      (locked && !modelSwitch.checking) ||
      previousTargetId.current !== targetId
    ) {
      managedPickerPending.current = false;
      setCheckingManagedPicker(false);
      setManagedPickerError(null);
      setOpen(false);
      resetSwitch();
    }
    previousTargetId.current = targetId;
  }, [locked, targetId, resetSwitch, modelSwitch.checking]);
  const selected = useChatStore((s) =>
    sessionId
      ? (s.sessions.find((session) => session.id === sessionId)?.profile
          ?.modelId ?? s.selectedModelId)
      : s.selectedModelId,
  );
  const apiKeys = useChatStore((s) => s.apiKeys);
  useChatStore((s) => s.customEndpointKeys);
  const setSelected = async (modelId: string): Promise<boolean> => {
    if (locked) return false;
    const accepted =
      modelId === selected ||
      (await modelSwitch.request(
        modelId,
        allModels.find((model) => model.id === modelId)?.label,
      ));
    if (accepted) setOpen(false);
    return accepted;
  };
  const rejectManagedPicker = (reason: string) => {
    setManagedPickerError(reason);
    setOpen(true);
    toast.warning(reason);
  };
  const favoriteIds = usePreferencesStore((s) => s.favoriteModelIds);
  const recentIds = usePreferencesStore((s) => s.recentModelIds);
  const customEndpoints = usePreferencesStore((s) => s.customEndpoints);
  const selectedHostDisabled = modelPickerHostAvailability(selected, selfHosted,
    managedRuntimeStatuses[selected])?.label === "Disabled in Settings";
  const pickerFavorites = useMemo(() => favoriteIds.map(id => canonicalSelfHostedSelectionId(id, selfHosted)), [favoriteIds, selfHosted]);
  const pickerRecents = useMemo(() => recentIds.map(id => canonicalSelfHostedSelectionId(id, selfHosted)), [recentIds, selfHosted]);
  const pickerSelection = canonicalSelfHostedSelectionId(selected, selfHosted);
  const savedProviderModels = usePreferencesStore((s) => s.savedProviderModels);
  const lmstudioBaseURL = usePreferencesStore((s) => s.lmstudioBaseURL);
  const lmstudioModelId = usePreferencesStore((s) => s.lmstudioModelId);
  const mlxBaseURL = usePreferencesStore((s) => s.mlxBaseURL);
  const mlxModelId = usePreferencesStore((s) => s.mlxModelId);
  const ollamaBaseURL = usePreferencesStore((s) => s.ollamaBaseURL);
  const ollamaModelId = usePreferencesStore((s) => s.ollamaModelId);
  const openaiCompatibleBaseURL = usePreferencesStore((s) => s.openaiCompatibleBaseURL);
  const openaiCompatibleModelId = usePreferencesStore((s) => s.openaiCompatibleModelId);
  const openrouterModelId = usePreferencesStore((s) => s.openrouterModelId);
  const connectionSettings = { customEndpoints, savedProviderModels, selfHostedInference: selfHosted, lmstudioBaseURL, lmstudioModelId, mlxBaseURL, mlxModelId, ollamaBaseURL, ollamaModelId, openaiCompatibleBaseURL, openaiCompatibleModelId, openrouterModelId };
  const destinationFor = (modelId: string) => {
    const managed = resolveManagedLocalSelection(selfHosted, modelId);
    if (managed.status === "available" || managed.status === "unavailable") {
      // Same-name registrations expose their full digest and exact configuration
      // in row labels/tooltips, without implying an HTTP inference endpoint.
      return `GGUF ${managed.artifact.digest} · ${managed.deployment.configurationIdentity}`;
    }
    const target = resolveSelfHostedSelection(selfHosted, modelId);
    if (target.status === "available" && target.endpoint.ssh) {
      const ssh = target.endpoint.ssh;
      return `SSH ${ssh.host}:${ssh.port} → ${ssh.remoteHost}:${ssh.remotePort}`;
    }
    return modelConnectionLabel(modelId, connectionSettings);
  };
  const owner = useChatStore(s => s.sessions.find(item => item.id === sessionId));
  const ownerConnection = owner ? chatConnectionSummary(owner, connectionSettings) : null;
  // During a running request, display its captured route. For idle chats the
  // selected connection's SSH details are more meaningful than its virtual URL.
  const destination = ownerConnection?.running ? ownerConnection.destination : destinationFor(selected);
  const currentState = useMemo(() => {
    try {
      return {
        valid: true,
        info: resolveModelSelectionInfo(
          selected,
          customEndpoints,
          savedProviderModels,
          selfHosted,
        ),
      };
    } catch {
      return {
        valid: false,
        info: {
          id: selected,
          provider: "openai-compatible" as const,
          label: "Model unavailable",
          hint: "Unavailable",
          description: "Server or saved model unavailable",
          capabilities: { intelligence: 0, speed: 0, cost: 0 },
        },
      };
    }
  }, [customEndpoints, savedProviderModels, selected, selfHosted]);
  const current = currentState.info;
  const [search, setSearch] = useState("");
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const inputRef = useRef<HTMLInputElement>(null);
  const { checking, review, failure } = modelSwitch;
  useEffect(() => {
    if (open && !checking && !review && !failure) inputRef.current?.focus();
  }, [open, checking, review, failure]);
  const currentProviderHasKey =
    currentState.valid &&
    (selected.startsWith("self-hosted:")
      ? hasKeyForModel(selected)
      : isCompatModelId(selected)
        ? true
        : providerNeedsKey(current.provider)
          ? !!apiKeys[current.provider]
          : true);

  const hasKeyFor = (id: ProviderId) =>
    providerNeedsKey(id) ? !!apiKeys[id] : true;

  const epModelInfos = useMemo(() => {
    return customEndpoints.map((ep) =>
      getCompatModelInfo(compatModelIdForEndpoint(ep.id), customEndpoints),
    );
  }, [customEndpoints]);

  const savedModelInfos = useMemo(
    () => getEnabledSavedProviderModelInfos(savedProviderModels),
    [savedProviderModels],
  );

  const sortedProviders = useMemo(
    () => partitionProvidersByConfiguration(PROVIDERS, apiKeys),
    [apiKeys],
  );

  const allModels = useMemo(() => {
    const hosted = savedSelfHostedModelInfos(selfHosted);
    const managed = new Set(
      selfHosted.endpoints.flatMap((e) =>
        e.legacy ? [e.legacy.selectionId] : [],
      ),
    );
    return [
      ...MODELS.filter((model) => model.id !== "openrouter-custom"),
      ...savedModelInfos,
      ...epModelInfos,
    ]
      .filter((m) => !managed.has(m.id))
      .concat(hosted, managedModels);
  }, [epModelInfos, savedModelInfos, selfHosted, managedModels]);

  const COMPAT_PROVIDER_ID = "__compat__";
  const MANAGED_PROVIDER_ID = "__managed__";

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let pool: readonly ModelInfo[] = allModels;
    if (tab === "favorites") {
      pool = pool.filter((m) => pickerFavorites.includes(m.id));
    } else if (tab === "recent") {
      const order = new Map(pickerRecents.map((id, i) => [id, i]));
      pool = pool
        .filter((m) => order.has(m.id))
        .slice()
        .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    }
    if (activeProvider === COMPAT_PROVIDER_ID) {
      pool = pool.filter(
        (m) => isCompatModelId(m.id) || m.id.startsWith("self-hosted:"),
      );
    } else if (activeProvider === MANAGED_PROVIDER_ID) {
      pool = pool.filter(m => isManagedLocalSelectionId(m.id));
    } else if (activeProvider !== null) {
      pool = pool.filter((m) => m.provider === activeProvider);
    }
    if (q) {
      pool = pool.filter((model) => modelSelectionMatchesQuery(model, q));
    }
    return pool;
  }, [activeProvider, allModels, pickerFavorites, pickerRecents, search, tab]);

  const duplicateLabels = useMemo(() => {
    const counts = new Map<string, number>();
    for (const model of filtered) {
      const label = model.label.trim().toLocaleLowerCase();
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return new Set([...counts].filter(([, count]) => count > 1).map(([label]) => label));
  }, [filtered]);
  const groups = useMemo(() => groupFabricPickerModels(filtered, selfHosted), [filtered, selfHosted]);
  const renderModel = (m: ModelInfo, accessibleLabel?: string, deploymentName?: string) => (
    <ModelRow
      key={m.id}
      model={m}
      destination={destinationFor(m.id)}
      accessibleLabel={accessibleLabel}
      deploymentName={deploymentName}
      selected={m.id === pickerSelection}
      disabled={locked}
      status={modelPickerHostAvailability(m.id, selfHosted, managedRuntimeStatuses[m.id], managedFilePresence)}
      hasKey={isManagedLocalSelectionId(m.id) || (m.id.startsWith("self-hosted:")
        ? hasKeyForModel(m.id)
        : isCompatModelId(m.id) || hasKeyFor(m.provider))}
      favorite={pickerFavorites.includes(m.id)}
      showProviderIcon={activeProvider === null}
      onPick={() => {
        if (isManagedLocalSelectionId(m.id)) {
          // A visible Ready status can turn stale before the click. Recheck
          // native state before entering the ordinary model-switch admission.
          if (managedPickerPending.current) return;
          managedPickerPending.current = true;
          setCheckingManagedPicker(true);
          setManagedPickerError(null);
          void recheckManagedPickerSelection(m.id, selfHosted)
            .then(async (result) => {
              if (!result.ok) {
                rejectManagedPicker(result.reason);
                return;
              }
              setManagedRuntimeStatuses(current => ({ ...current, [m.id]: result.observed }));
              setManagedFilePresence(current => ({ ...current, [result.digest]: true }));
              // The original conversation-scoped model-switch admission still
              // owns the mutation, persistence, route and failure/consent UI.
              await setSelected(m.id);
            })
            .catch(() => rejectManagedPicker("Could not verify or select the exact managed deployment. Nothing was switched."))
            .finally(() => {
              managedPickerPending.current = false;
              setCheckingManagedPicker(false);
            });
          return;
        }
        if (m.id.startsWith("self-hosted:")
          ? !hasKeyForModel(m.id)
          : !isCompatModelId(m.id) && !hasKeyFor(m.provider)) {
          void openSettingsWindow("models");
          return;
        }
        void setSelected(m.id);
      }}
      onToggleFavorite={() => void toggleFavoriteModel(m.id)}
    />
  );

  return (
    <DropdownMenu
      open={open && (!locked || modelSwitch.checking)}
      onOpenChange={(next) => {
        // Radix can deliver a dismissal while native status/route admission is
        // pending. Aborting here used to discard the click without a verdict.
        if (!next && managedPickerPending.current) return;
        if (!next) resetSwitch();
        if (next) setManagedPickerError(null);
        setOpen(next && (!locked || modelSwitch.checking));
      }}
    >
      <span
        className="inline-flex min-w-0"
        title={
          locked
            ? "Model locked until this run finishes or stops completely."
            : undefined
        }
      >
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            disabled={locked}
            aria-label={
              locked
                ? `Model: ${current.label}. Locked until this run finishes or stops completely.`
                : `Change model: ${current.label}. ${targetId ? "This chat" : "New chats"}. ${destination}${selectedHostDisabled ? ". Disabled in Settings" : ""}`
            }
            variant="ghost"
            size="sm"
            className={cn(
              "h-auto min-h-6 min-w-0 max-w-full gap-1 rounded-md px-1.5 my-1 text-xs hover:bg-accent hover:text-foreground",
              compact && "max-w-52",
              currentProviderHasKey
                ? "text-muted-foreground"
                : "text-amber-600 dark:text-amber-400",
            )}
            title={
              locked
                ? "Model locked until this run finishes or stops completely."
                : selectedHostDisabled
                  ? `${current.hint}: ${current.label} — Disabled in Settings`
                  : currentProviderHasKey
                  ? `${current.hint}: ${current.label}`
                  : `${current.hint}: ${current.label} — no key configured`
            }
          >
            <HugeiconsIcon
              icon={PROVIDER_ICON[current.provider]}
              size={12}
              strokeWidth={1.6}
            />
            <span className="min-w-0 text-left">
              <span className="block truncate">Model: {current.label}</span>
              <span className="block truncate text-[10px]" title={destination}>{destination}</span>
            </span>
            <HugeiconsIcon
              icon={locked ? SquareLock01Icon : ArrowDown01Icon}
              size={11}
              strokeWidth={2}
              className="opacity-70"
            />
          </Button>
        </DropdownMenuTrigger>
      </span>

      <DropdownMenuContent
        align="end"
        className="w-[28rem] max-w-[calc(100vw-1rem)] p-0 overflow-hidden rounded-xl border border-border/70 shadow-xl"
      >
        {modelSwitch.checking ? (
          <div
            role="status"
            className="space-y-3 p-4 text-xs text-muted-foreground break-words"
          >
            <p>
              Preparing this conversation for {modelSwitch.preparingLabel}...
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                resetSwitch();
                setOpen(false);
              }}
            >
              Cancel
            </Button>
          </div>
        ) : checkingManagedPicker ? (
          <p role="status" className="p-4 text-xs text-muted-foreground">
            Verifying the selected Clack-managed deployment and native Ready identity…
          </p>
        ) : managedPickerError ? (
          <div role="alert" className="space-y-2 p-4 text-xs">
            <p>Cannot switch managed deployment: {managedPickerError}</p>
            <Button size="sm" variant="outline" onClick={() => setManagedPickerError(null)}>
              Choose another model
            </Button>
          </div>
        ) : modelSwitch.review || modelSwitch.failure ? (
          <ModelSwitchNotice
            targetLabel={modelSwitch.review?.targetLabel ?? "Model change"}
            assessment={
              modelSwitch.review?.assessment ?? {
                status: "blocked",
                reasons: [modelSwitch.failure ?? "Choose the model again."],
                estimatedTokens: 0,
                contextLimit: null,
              }
            }
            onBack={resetSwitch}
            onConfirm={async () => {
              if (await modelSwitch.confirm()) {
                resetSwitch();
                setOpen(false);
              }
            }}
          />
        ) : (
          <>
            <div className="border-b px-3 py-2 text-xs">
              {targetId ? "Model for this chat" : "Model for new chats"}
              {targetId && <p className="mt-1 text-[10.5px] text-muted-foreground">Other existing chats keep their model. New chats inherit the active chat's model.</p>}
            </div>
            {/* Search */}
            <div className="flex items-center gap-2.5 border-b border-border/70 px-3 py-2.5">
              <HugeiconsIcon
                icon={Search01Icon}
                size={16}
                strokeWidth={1.75}
                className="shrink-0 text-muted-foreground/70"
              />
              <input
                ref={inputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    firstEnabledPickerMenuItem(e.currentTarget.closest('[role="menu"]'))?.focus();
                  }
                  if (e.key !== "Escape" && e.key !== "Tab")
                    e.stopPropagation();
                }}
                placeholder="Search models, providers, capabilities…"
                aria-label="Search models"
                className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
              />
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-0.5 border-b border-border/70 px-2 py-1.5">
              <TabButton
                label="All"
                icon={AiBookIcon}
                active={tab === "all"}
                onClick={() => setTab("all")}
              />
              <TabButton
                label="Favorites"
                icon={FavouriteIcon}
                active={tab === "favorites"}
                onClick={() => setTab("favorites")}
                count={favoriteIds.length || undefined}
              />
              <TabButton
                label="Recent"
                icon={Clock01Icon}
                active={tab === "recent"}
                onClick={() => setTab("recent")}
                count={recentIds.length || undefined}
              />
            </div>

            <div className="flex max-h-104 min-h-0">
              {/* Provider sidebar — configured first, unconfigured muted, no dividers. */}
              <div className="flex w-11 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border/70 bg-muted/20 py-1.5">
                <ProviderPill
                  icon={AiBookIcon}
                  title="All providers"
                  active={activeProvider === null}
                  onClick={() => setActiveProvider(null)}
                />
                {[
                  ...sortedProviders.configured,
                  ...sortedProviders.unconfigured,
                ].map((p) => (
                  <ProviderPill
                    key={p.id}
                    icon={PROVIDER_ICON[p.id]}
                    title={
                      hasKeyFor(p.id) ? p.label : `${p.label} — not configured`
                    }
                    active={activeProvider === p.id}
                    muted={!hasKeyFor(p.id)}
                    onClick={() => setActiveProvider(p.id)}
                  />
                ))}
                {(customEndpoints.length > 0 ||
                  selfHosted.endpoints.some(
                    (e) => e.deletedAt === undefined,
                  )) && (
                  <ProviderPill
                    icon={PlugIcon}
                    title="OpenAI Compatible"
                    active={activeProvider === COMPAT_PROVIDER_ID}
                    onClick={() => setActiveProvider(COMPAT_PROVIDER_ID)}
                  />
                )}
                {managedModels.length > 0 && (
                  <ProviderPill
                    icon={CpuIcon}
                    title="Clack Managed"
                    active={activeProvider === MANAGED_PROVIDER_ID}
                    onClick={() => setActiveProvider(MANAGED_PROVIDER_ID)}
                  />
                )}
              </div>

              {/* Models list */}
              <div className="min-h-0 min-w-0 flex-1 overflow-y-auto py-1">
                {activeProvider === COMPAT_PROVIDER_ID && (
                  <div className="flex items-center gap-1.5 px-3 pt-1 pb-1.5 text-[11px] font-medium tracking-tight text-muted-foreground/90">
                    <HugeiconsIcon
                      icon={PlugIcon}
                      size={13}
                      strokeWidth={1.75}
                    />
                    <span>OpenAI Compatible</span>
                  </div>
                )}
                {activeProvider === MANAGED_PROVIDER_ID && (
                  <div className="px-3 pt-1 pb-1.5 text-[11px] font-medium text-muted-foreground">
                    Clack Managed · local GGUF
                  </div>
                )}
                {activeProvider !== null &&
                activeProvider !== COMPAT_PROVIDER_ID &&
                activeProvider !== MANAGED_PROVIDER_ID ? (
                  <ProviderHeader providerId={activeProvider as ProviderId} />
                ) : null}
                {activeProvider !== null &&
                activeProvider !== COMPAT_PROVIDER_ID &&
                activeProvider !== MANAGED_PROVIDER_ID &&
                !hasKeyFor(activeProvider as ProviderId) ? (
                  <ProviderConfigureCTA
                    providerId={activeProvider as ProviderId}
                  />
                ) : null}
                {filtered.length === 0 ? (
                  <div className="flex items-center justify-center px-4 py-10 text-xs text-muted-foreground/70">
                    {tab === "favorites"
                      ? "No favorites yet — star a model to pin it here."
                      : tab === "recent"
                        ? "No recently-used models."
                        : "No models match."}
                  </div>
                ) : (
                  <>
                    {groups.otherModels.map(m => renderModel(m))}
                    {groups.hostGroups.map((host) => (
                      <div
                        key={host.hostId}
                        role="group"
                        aria-label={`Host ${host.alias} (${host.location})`}
                      >
                        <div className="flex min-w-0 items-center justify-between gap-2 border-t border-border/60 px-3 pb-1 pt-2 text-[11px] text-muted-foreground">
                          <span className="min-w-0 truncate font-semibold text-foreground/85">Host · {host.alias}</span>
                          {host.location !== "unknown" && (
                            <span className="shrink-0 text-[10px]">{host.location === "local" ? "This PC" : "Remote"}</span>
                          )}
                        </div>
                        {host.runtimes.map(runtime => (
                          <div key={runtime.runtimeId} role="group" aria-label={`Runtime ${runtime.label} on ${host.alias}`}>
                            <div className="flex min-w-0 flex-col gap-0.5 px-4 pb-1 pt-1 text-[11px] text-muted-foreground">
                              <span className="font-medium text-foreground/80">Runtime · {runtime.label}</span>
                              <span className="truncate font-mono text-[10px]" title={runtime.address}>{runtime.address}</span>
                            </div>
                            {runtime.artifacts.map(({ artifact, deployments }) => {
                              const metadata = pickerArtifactMetadata(artifact);
                              return (
                                <div
                                  key={artifact.id}
                                  role="group"
                                  aria-label={`Artifact ${artifact.displayName}${artifact.digest ? `, digest ${artifact.digest}` : ""} in ${runtime.label}`}
                                  className="ml-3 border-l border-border/50"
                                >
                                  <div className="space-y-1 px-3 py-1.5 text-[10px] text-muted-foreground">
                                    <span className="block min-w-0 truncate font-medium text-foreground/75" title={artifact.displayName}>
                                      Artifact · {artifact.displayName}
                                    </span>
                                    {artifact.digest ? (
                                      <span className="block truncate font-mono" title={artifact.digest}>
                                        Digest · {artifact.digest.length > 30 ? `${artifact.digest.slice(0, 27)}…` : artifact.digest}
                                      </span>
                                    ) : null}
                                    {metadata.length ? (
                                      <span className="block leading-relaxed" title={metadata.join(" · ")}>
                                        {metadata.join(" · ")}
                                      </span>
                                    ) : null}
                                  </div>
                                  <div role="group" aria-label={`Deployments of ${artifact.displayName} on ${runtime.label}`}>
                                    {deployments.map(({ deployment, model }, i) => renderModel(
                                      model,
                                      duplicateLabels.has(model.label.trim().toLocaleLowerCase())
                                        ? pickerDeploymentAccessibleLabel(
                                        model, destinationFor(model.id), host, runtime, artifact,
                                        deployment, i + 1, deployments.length,
                                        ) : undefined,
                                      deployment.runtimeModelName,
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TabButton({
  label,
  icon,
  active,
  count,
  onClick,
}: {
  label: string;
  icon: typeof AiBookIcon;
  active: boolean;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-colors",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
      )}
    >
      <HugeiconsIcon icon={icon} size={12} strokeWidth={1.75} />
      {label}
      {count != null ? (
        <span className="rounded-full bg-muted/60 px-1.5 text-[9.5px] tabular-nums text-muted-foreground">
          {count}
        </span>
      ) : null}
    </button>
  );
}

function ProviderPill({
  icon,
  title,
  active,
  muted,
  onClick,
}: {
  icon: typeof AiBookIcon;
  title: string;
  active: boolean;
  muted?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "relative mx-auto flex size-8 items-center justify-center rounded-md transition-colors",
        active
          ? "bg-accent text-foreground after:absolute after:right-0 after:top-1.5 after:bottom-1.5 after:w-[2px] after:rounded-full after:bg-primary after:content-['']"
          : muted
            ? "text-muted-foreground/50 hover:bg-accent/40 hover:text-foreground"
            : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
      )}
    >
      <HugeiconsIcon icon={icon} size={16} strokeWidth={1.5} />
    </button>
  );
}

function ProviderHeader({ providerId }: { providerId: ProviderId }) {
  const p = PROVIDERS.find((x) => x.id === providerId);
  if (!p) return null;
  return (
    <div className="flex items-center gap-1.5 px-3 pt-1 pb-1.5 text-[11px] font-medium tracking-tight text-muted-foreground/90">
      <HugeiconsIcon icon={PROVIDER_ICON[p.id]} size={13} strokeWidth={1.75} />
      <span>{p.label}</span>
    </div>
  );
}

function ProviderConfigureCTA({ providerId }: { providerId: ProviderId }) {
  const p = PROVIDERS.find((x) => x.id === providerId);
  if (!p) return null;
  return (
    <button
      type="button"
      onClick={() => void openSettingsWindow("models")}
      className="group mx-2 mb-1 flex w-[calc(100%-1rem)] items-center gap-2 rounded-md border border-dashed border-border/70 bg-muted/20 px-3 py-2 text-left text-[11px] text-muted-foreground transition-colors hover:border-border hover:bg-accent/40 hover:text-foreground"
    >
      <HugeiconsIcon icon={Settings01Icon} size={13} strokeWidth={1.75} />
      <span className="flex-1 truncate">
        Configure {p.label} to use these models.
      </span>
      <span className="shrink-0 text-[10px] underline-offset-2 group-hover:underline">
        Open
      </span>
    </button>
  );
}

function ModelRow({
  model,
  destination,
  accessibleLabel,
  deploymentName,
  selected,
  disabled,
  hasKey,
  favorite,
  showProviderIcon,
  onPick,
  onToggleFavorite,
  status,
}: {
  model: ModelInfo;
  destination: string;
  accessibleLabel?: string;
  deploymentName?: string;
  selected: boolean;
  disabled: boolean;
  hasKey: boolean;
  favorite: boolean;
  showProviderIcon: boolean;
  onPick: () => void;
  onToggleFavorite: () => void;
  status?: { label: string; disabled: boolean };
}) {
  return (
    <DropdownMenuItem
      aria-label={accessibleLabel ?? `${model.label}. ${destination}`}
      disabled={disabled || status?.disabled}
      aria-description={status?.label}
      aria-current={selected ? "true" : undefined}
      onSelect={(e) => {
        e.preventDefault();
        onPick();
      }}
      className={cn(
        "group mx-1 my-0.5 flex cursor-pointer flex-wrap items-center gap-2 rounded-md px-2 py-1.5",
        selected ? "bg-accent/60 text-foreground" : "text-foreground/85",
        !hasKey && "opacity-60",
      )}
    >
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggleFavorite();
        }}
        title={favorite ? "Unfavorite" : "Favorite"}
        aria-label={`${favorite ? "Unfavorite" : "Favorite"} ${model.label}`}
        onKeyDown={(e) => {
          // The nested favorite action is independent of Radix row selection.
          if (e.key === "Enter" || e.key === " ") e.stopPropagation();
        }}
        className={cn(
          "shrink-0 rounded p-0.5 transition-colors",
          favorite
            ? "text-amber-500"
            : "text-muted-foreground/40 hover:text-amber-500",
        )}
      >
        <HugeiconsIcon
          icon={StarIcon}
          size={12}
          strokeWidth={favorite ? 2 : 1.75}
          className={favorite ? "fill-amber-500" : ""}
        />
      </button>

      {showProviderIcon ? (
        <HugeiconsIcon
          icon={PROVIDER_ICON[model.provider]}
          size={13}
          strokeWidth={1.5}
          className="shrink-0 text-muted-foreground/70"
        />
      ) : null}

      <div className="flex min-w-0 flex-1 basis-28 flex-col gap-1">
        <span
          className="min-w-0 truncate text-[12px] font-medium leading-none"
          title={model.label}
        >
          {model.label}
        </span>
        {deploymentName ? (
          <span className="max-w-full truncate text-[10px] text-muted-foreground/90" title={deploymentName}>
            Deployment · {deploymentName}
          </span>
        ) : null}
        <span className="max-w-full truncate text-[10.5px] leading-none text-muted-foreground" title={destination}>
          {destination}
        </span>
      </div>

      {model.id.startsWith("self-hosted:") ||
      Object.values(model.capabilities).every((v) => v === 0) ? (
        <span
          className="max-w-28 truncate text-[11px] text-muted-foreground"
          title={status ? `${model.hint} / ${status.label}` : model.hint}
        >
          {status ? `${model.hint} / ${status.label}` : model.hint}
        </span>
      ) : (
        <CapabilityBars caps={model.capabilities} />
      )}

      {selected ? (
        <HugeiconsIcon
          icon={Tick01Icon}
          size={13}
          strokeWidth={2}
          className="shrink-0 text-foreground"
        />
      ) : null}
    </DropdownMenuItem>
  );
}

function CapabilityBars({ caps }: { caps: ModelCapabilities }) {
  return (
    <div className="ml-auto flex items-center gap-1.5">
      <CapBar icon={BrainIcon} value={caps.intelligence} label="Intelligence" />
      <CapBar icon={FlashIcon} value={caps.speed} label="Speed" />
      <CapBar icon={CoinsDollarIcon} value={caps.cost} label="Affordability" />
    </div>
  );
}

function CapBar({
  icon,
  value,
  label,
}: {
  icon: typeof AiBookIcon;
  value: number;
  label: string;
}) {
  return (
    <span className="flex items-center gap-0.5" title={`${label}: ${value}/5`}>
      <HugeiconsIcon
        icon={icon}
        size={10}
        strokeWidth={1.75}
        className="text-muted-foreground/60"
      />
      <span className="flex items-center gap-px">
        {[1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className={cn(
              "h-2 w-[2px] rounded-full",
              i <= value ? "bg-foreground/70" : "bg-foreground/15",
            )}
          />
        ))}
      </span>
    </span>
  );
}

function IconBtn({
  title,
  onClick,
  disabled,
  className,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "size-6 rounded-md text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {children}
    </Button>
  );
}
