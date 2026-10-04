import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { ToolEditor } from "@/modules/ai/components/CustomToolsManager";
import { CustomToolTest } from "@/modules/ai/components/CustomToolExecution";
import { executeCustomTool } from "@/modules/ai/lib/customToolExecution";
import {
  newToolDefinition,
  type ToolEntry,
} from "@/modules/ai/lib/customTools";
import type { SessionMeta } from "@/modules/ai/lib/sessions";

const actions = vi.hoisted(
  () =>
    new Map<
      string,
      { disabled?: boolean; onClick?: () => void | Promise<void> }
    >(),
);
vi.mock("@/components/ui/dialog", () => {
  const Pass = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Pass,
    DialogContent: Pass,
    DialogHeader: Pass,
    DialogTitle: Pass,
    DialogDescription: Pass,
  };
});
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled }: ComponentProps<"button">) => {
    const text = Array.isArray(children)
      ? children.filter((c) => typeof c === "string").join("")
      : String(children);
    actions.set(text, { disabled, onClick: onClick as () => void });
    return (
      <button type="button" disabled={disabled}>
        {children}
      </button>
    );
  },
}));
vi.mock("@/modules/ai/lib/customToolExecution", () => ({
  executeCustomTool: vi.fn(),
  executionHistory: vi.fn(),
}));

afterEach(() => {
  actions.clear();
  vi.resetAllMocks();
});
const session: SessionMeta = {
  id: "chat",
  title: "Chat",
  createdAt: 1,
  updatedAt: 1,
  profile: {
    agentId: "builtin:coder",
    modelId: "model",
    workspaceId: "local:/work",
    workspaceRoot: "/work",
  },
};
function definition() {
  const d = newToolDefinition("builtin:coder", "chat");
  d.binding = {
    kind: "wasi",
    schemaVersion: 1,
    hash: "a".repeat(64),
    abi: "wasi-preview1-json-v1",
    export: "_start",
    runtime: "clack-wasi-1",
  };
  d.permissions = ["run-commands"];
  d.outputBytes = 16384;
  return d;
}
function entry(executable = true): ToolEntry {
  return {
    id: "tool",
    workspaceId: "local:/work",
    current: {
      version: 3,
      hash: "b".repeat(64),
      definition: definition(),
      status: "authorized",
      enabled: true,
      source: "native-user",
      sessionId: "chat",
      agentId: "builtin:coder",
      runId: null,
      createdAt: 1,
    },
    versions: [],
    eligible: true,
    executable,
    runtime: "Guarded WASI execution",
  };
}
it("WASI editor exposes immutable module identity and import without credential or capability expansion", async () => {
  const onImport = vi.fn(async () => {});
  const d = definition();
  const html = renderToStaticMarkup(
    <ToolEditor
      session={session}
      initial={d}
      busy={false}
      error=""
      onClose={() => {}}
      onSave={vi.fn()}
      onAuthorize={vi.fn()}
      onImport={onImport}
    />,
  );
  expect(html).toContain("Module SHA-256:");
  expect(html).toContain("a".repeat(64));
  expect(html).toContain('max="16384"');
  expect(html).not.toContain("Credential reference");
  expect(html).not.toContain("write-files");
  await actions.get("Replace module and save draft")?.onClick?.();
  expect(onImport).toHaveBeenCalledExactlyOnceWith(d);
});
it("an unimported WASI draft cannot be saved as executable code", () => {
  const d = definition();
  if (d.binding.kind === "wasi") d.binding.hash = "";
  renderToStaticMarkup(
    <ToolEditor
      session={session}
      initial={d}
      busy={false}
      error=""
      onClose={() => {}}
      onSave={vi.fn()}
      onAuthorize={vi.fn()}
      onImport={vi.fn()}
    />,
  );
  expect(actions.get("Save draft")?.disabled).toBe(true);
  expect(actions.get("Import module and save draft")?.disabled).toBe(false);
});
it("the management test submits the exact WASI version through the shared execution client", async () => {
  const tool = entry();
  vi.mocked(executeCustomTool).mockResolvedValue({
    state: "succeeded",
  } as Awaited<ReturnType<typeof executeCustomTool>>);
  renderToStaticMarkup(
    <CustomToolTest sessionId="chat" entry={tool} onClose={() => {}} />,
  );
  await actions.get("Request test")?.onClick?.();
  expect(executeCustomTool).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionId: "chat",
      tool: { id: "tool", version: 3, hash: "b".repeat(64) },
      test: true,
      arguments: {},
      signal: expect.any(AbortSignal),
    }),
  );
});
it("an unavailable runtime cannot request a management test", () => {
  renderToStaticMarkup(
    <CustomToolTest sessionId="chat" entry={entry(false)} onClose={() => {}} />,
  );
  expect(actions.get("Request test")?.disabled).toBe(true);
  expect(executeCustomTool).not.toHaveBeenCalled();
});
