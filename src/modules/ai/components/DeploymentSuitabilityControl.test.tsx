import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/modules/ai/store/chatStore", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/ai/store/chatStore")>();
  return {
    ...actual,
    useChatStore: Object.assign(
      <T,>(
        select: (state: ReturnType<typeof actual.useChatStore.getState>) => T,
      ) => select(actual.useChatStore.getState()),
      actual.useChatStore,
    ),
  };
});
vi.mock("@/modules/settings/preferences", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/settings/preferences")>();
  return {
    ...actual,
    usePreferencesStore: Object.assign(
      <T,>(
        select: (
          state: ReturnType<typeof actual.usePreferencesStore.getState>,
        ) => T,
      ) => select(actual.usePreferencesStore.getState()),
      actual.usePreferencesStore,
    ),
  };
});

import {
  attachManagedLocalGguf,
  managedLocalSelectionId,
} from "@/modules/ai/lib/managedLocalModels";
import {
  saveSelfHostedModel,
  selfHostedSelectionId,
} from "@/modules/ai/lib/selfHostedModels";
import {
  createSelfHostedEndpoint,
  emptySelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { invoke } from "@tauri-apps/api/core";
import type { ExecutionSelection } from "@/modules/ai/lib/executionBackendSelection";
import { DeploymentExecutionDecision, DeploymentSuitabilityControl } from "./DeploymentSuitabilityControl";

const initialChat = useChatStore.getState();
const initialPrefs = usePreferencesStore.getState();
const invokeMock = vi.mocked(invoke);

function setSelected(modelId: string) {
  const session = {
    id: "suitability-session",
    profile: { modelId },
  } as (typeof initialChat.sessions)[number];
  useChatStore.setState({ sessions: [session] });
}

beforeEach(() => {
  invokeMock.mockReset();
  useChatStore.setState(initialChat, true);
  usePreferencesStore.setState(initialPrefs, true);
});
afterEach(() => {
  useChatStore.setState(initialChat, true);
  usePreferencesStore.setState(initialPrefs, true);
});

describe("LM3-LM5 advanced suitability entry point", () => {
  it("shows managed deployment details entry without probing, loading, or qualifying during render", () => {
    const saved = attachManagedLocalGguf(emptySelfHostedState(), {
      digest: `sha256:${"a".repeat(64)}`,
      displayName: "Fixture GGUF",
      size: 491_400_032,
      material: {
        version: 1,
        context: 2048,
        gpu: 0,
        tool: false,
        grammar: false,
      },
    });
    usePreferencesStore.setState({ selfHostedInference: saved.state });
    setSelected(managedLocalSelectionId(saved.state.fabric!.deployments[0]));
    const html = renderToStaticMarkup(
      <DeploymentSuitabilityControl sessionId="suitability-session" />,
    );
    expect(html).toContain("Deployment hardware suitability details");
    expect(html).toContain("Suitability");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("does not make any local native call merely to list a remote Ollama selection", () => {
    const endpoint = createSelfHostedEndpoint(
      {
        alias: "Secondary PC",
        baseURL: "http://127.0.0.1:11434/",
        backendHint: "ollama",
      },
      "secondary-fixture",
      1,
    );
    const state = saveSelfHostedModel(
      {
        ...emptySelfHostedState(),
        endpoints: [endpoint],
      },
      endpoint.id,
      "devstral:latest",
      "Devstral",
    );
    usePreferencesStore.setState({ selfHostedInference: state });
    setSelected(selfHostedSelectionId(state.profiles[0]));
    const html = renderToStaticMarkup(
      <DeploymentSuitabilityControl sessionId="suitability-session" />,
    );
    expect(html).toContain("Suitability");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("does not attach a suitability widget to an unrelated cloud model", () => {
    setSelected("gpt-5.4-mini");
    expect(
      renderToStaticMarkup(
        <DeploymentSuitabilityControl sessionId="suitability-session" />,
      ),
    ).not.toContain("Deployment hardware suitability details");
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("managed backend decision disclosure", () => {
  const cudaRequest = {
    backend:"cuda" as const,deviceIds:["clack-this-pc:accelerator:GPU-expected"],
    gpuLayers:40,fallback:{policy:"allow-compatible" as const},
  };
  const fallbackPlan: ExecutionSelection = {
    state:"fallback",requested:cudaRequest,
    policy:"prefer-cuda-then-cpu",
    selected:{backend:"cpu",deviceIds:["cpu-0"],gpuLayers:0,runtimeVariantId:"b12248/cpu"},
    fallbackUsed:true,fallbackAuthorized:true,
    reasons:["cuda: insufficient available device memory", "cuda → cpu authorized by allow-compatible"],
    candidates:[
      {backend:"cuda",role:"requested",state:"rejected",selected:null,
        inspectedVariantIds:["b12248/cuda"],reasons:["cuda: insufficient available device memory"]},
      {backend:"cpu",role:"fallback",state:"eligible",
        selected:{backend:"cpu",deviceIds:["cpu-0"],gpuLayers:0,runtimeVariantId:"b12248/cpu"},
        inspectedVariantIds:["b12248/cpu"],reasons:[]},
    ],
    actual:null,
  };

  it("keeps requested, admitted selection and native actual distinct with expandable candidate reasons", () => {
    const html = renderToStaticMarkup(<DeploymentExecutionDecision
      requested={cudaRequest} selection={fallbackPlan} native={null} nativeReady={false} preview={false}
    />);
    expect(html).toContain("Requested:");
    expect(html).toContain("CUDA · 40 layers");
    expect(html).toContain("Selected (plan):");
    expect(html).toContain("CPU · 0 layers · b12248/cpu");
    expect(html).toContain("Actual (native):");
    expect(html).toContain("Not verified");
    expect(html).toContain("Readiness: Unknown · no fresh native observation");
    expect(html).toContain("<details");
    expect(html).toContain("Candidate rejection and recovery details");
    expect(html).toContain("2 candidates");
    expect(html).toContain("Requested CUDA:");
    expect(html).toContain("Fallback CPU:");
    expect(html).toContain("Variants: b12248/cuda");
    expect(html).toContain("cuda: insufficient available device memory");
    expect(html).toContain("Admission fallback: Authorized");
    expect(html).not.toContain("Ready · verified native placement");
  });

  it("does not promote a native Ready claim without fresh verified actual execution", () => {
    const html = renderToStaticMarkup(<DeploymentExecutionDecision
      requested={cudaRequest} selection={fallbackPlan} preview={false} nativeReady
      native={{installed:true,state:"Ready",version:"b12248",epoch:"observed-epoch",
        fallbackUsed:true,fallbackAuthorized:true,requestedBackend:"cuda",selectedBackend:"cpu",
        fallbackReason:"CUDA allocation denied"}}
    />);
    expect(html).toContain("Native Ready · execution proof unavailable");
    expect(html).toContain("Native fallback: Authorized");
    expect(html).toContain("CUDA allocation denied");
    expect(html).toContain("Actual (native):");
    expect(html).toContain("Not verified");
  });

  it("labels a CUDA preview as read-only and surfaces native failure recovery", () => {
    const html = renderToStaticMarkup(<DeploymentExecutionDecision
      requested={cudaRequest} selection={{...fallbackPlan,state:"rejected",selected:null,
        fallbackUsed:false,fallbackAuthorized:false,actual:null}}
      preview nativeReady={false}
      native={{installed:true,state:"Failed",version:"b12248",epoch:"",error:"CUDA init failed"}}
    />);
    expect(html).toContain("admission preview only");
    expect(html).toContain("Selected (plan):</strong> None");
    expect(html).toContain("Failed · inspect native error before manually retrying");
    expect(html).toContain("Native error: CUDA init failed");
    expect(html).toContain("retry Start for this deployment from Settings");
    expect(html).toContain("actual native execution belongs to the saved deployment");
  });

  it("reports active native recovery without promoting the candidate plan to runtime Ready", () => {
    const html = renderToStaticMarkup(<DeploymentExecutionDecision
      requested={cudaRequest} selection={fallbackPlan} nativeReady={false} preview={false}
      native={{installed:true,state:"Recovering",version:"b12248",epoch:"recovery-epoch",
        recoveryState:"pending-cpu-recovery",failureKind:"child-exited-before-ready",
        inferenceRouteIssued:false}}
    />);
    expect(html).toContain("Recovering · waiting for native CPU fallback result");
    expect(html).toContain("pending-cpu-recovery");
    expect(html).toContain("child-exited-before-ready");
    expect(html).not.toContain("native execution belongs");
    expect(html).toContain("Native startup CPU recovery is in progress");
    expect(html).not.toContain("Ready · verified native placement");
  });
});
