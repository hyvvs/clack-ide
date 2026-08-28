import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashText } from "../lib/readSnapshot";
import { native } from "../lib/native";
import { usePlanStore } from "../store/planStore";
import { buildEditTools } from "./edit";
import { buildFsTools } from "./fs";
import type { ToolContext } from "./context";

function context(): ToolContext {
  return {
    getCwd: () => "/work",
    getWorkspaceRoot: () => "/work",
    getWorkspaceId: () => "local:/work",
    getWorkspaceEnv: () => ({ kind: "local" }),
    getTerminalContext: () => null,
    isActiveTerminalPrivate: () => false,
    injectIntoActivePty: () => false,
    openPreview: () => false,
    spawnAgent: () => null,
    readAgentOutput: () => null,
    readCache: new Map(),
    getSessionId: () => "chat-a",
    getAgentId: () => "builtin:coder",
  };
}

async function executeTool(
  definition: { execute?: unknown },
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const execute = definition.execute as (
    value: Record<string, unknown>,
    options: { toolCallId: string; messages: never[] },
  ) => Promise<Record<string, unknown>>;
  return execute(input, { toolCallId: "test", messages: [] });
}

describe("file mutation snapshot safety", () => {
  beforeEach(() => {
    usePlanStore.setState({ active: false, queue: [] });
    vi.spyOn(native, "canonicalize").mockImplementation(async (path) => path);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    usePlanStore.setState({ active: false, queue: [] });
  });

  it("rejects an edit when another run changed the file after it was read", async () => {
    const ctx = context();
    const original = "const value = 1;\n";
    ctx.readCache.set("/work/file.ts", {
      size: original.length,
      hash: hashText(original),
    });
    vi.spyOn(native, "readFile").mockResolvedValue({
      kind: "text",
      content: "const value = 2;\n",
      size: original.length,
    });
    const write = vi.spyOn(native, "writeFile").mockResolvedValue();

    const result = await executeTool(buildEditTools(ctx).edit, {
      path: "/work/file.ts",
      old_string: "value = 1",
      new_string: "value = 3",
    });

    expect(result).toMatchObject({ code: "stale_file_snapshot" });
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses to overwrite an existing file that this session did not read", async () => {
    const ctx = context();
    vi.spyOn(native, "readFile").mockResolvedValue({
      kind: "text",
      content: "user content",
      size: 12,
    });
    const write = vi.spyOn(native, "writeFile").mockResolvedValue();

    const result = await executeTool(buildFsTools(ctx).write_file, {
      path: "/work/file.ts",
      content: "replacement",
    });

    expect(result).toMatchObject({ code: "read_required_before_write" });
    expect(write).not.toHaveBeenCalled();
  });

  it("creates a genuinely missing file without requiring a snapshot", async () => {
    const ctx = context();
    vi.spyOn(native, "readFile").mockRejectedValue(
      new Error("No such file or directory (os error 2)"),
    );
    const write = vi.spyOn(native, "writeFile").mockResolvedValue();

    const result = await executeTool(buildFsTools(ctx).write_file, {
      path: "/work/new.ts",
      content: "new content",
    });

    expect(result).toMatchObject({ ok: true, path: "/work/new.ts" });
    expect(write).toHaveBeenCalledWith(
      "/work/new.ts",
      "new content",
      { kind: "local" },
    );
  });

  it("does not treat an arbitrary read failure as proof that a file is new", async () => {
    const ctx = context();
    vi.spyOn(native, "readFile").mockRejectedValue(
      new Error("workspace access denied"),
    );
    const write = vi.spyOn(native, "writeFile").mockResolvedValue();

    const result = await executeTool(buildFsTools(ctx).write_file, {
      path: "/work/file.ts",
      content: "replacement",
    });

    expect(result.error).toContain("workspace access denied");
    expect(write).not.toHaveBeenCalled();
  });
});
