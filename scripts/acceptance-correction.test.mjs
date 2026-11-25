import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { confirmedWrite, createCorrectionObserver, currentPage50 } from "./acceptance-correction.mjs";

let directory, root, checkpoint, observe;
const plan = [{ id: "page", title: "Implement API", description: "Task pagination page size 50 with combined filters", status: "in_progress" }];
const request = (parts = [], currentPlan = plan) => ({ sessionId: "real-mission-a", action: "observe", parts, plan: currentPlan });
const shell = (id, command, overrides = {}) => ({ type: "tool-bash_run", toolCallId: id, state: "output-available", input: { command }, output: { command, cwd_after: root, exit_code: 0, timed_out: false, truncated: false, stdout: "", stderr: "", ...overrides } });
async function native(id, file = "probe.txt", content = "probe") {
  const target = path.join(root, file);
  await writeFile(target, content);
  return { type: "tool-write_file", toolCallId: id, state: "output-available", input: { path: target, content }, output: { path: target, ok: true, clackWorkspaceWrite: true, bytesWritten: content.length } };
}
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "clack-correction-"));
  root = path.join(directory, "forgeboard-qwen-none-20261017-08");
  await mkdir(path.join(root, ".git"), { recursive: true });
  checkpoint = path.join(directory, "correction.json");
  observe = createCorrectionObserver(root, checkpoint);
});
afterEach(async () => {
  expect(path.dirname(directory)).toBe(path.resolve(tmpdir()));
  expect(path.basename(directory).startsWith("clack-correction-")).toBe(true);
  await rm(directory, { recursive: true, force: true });
});
const parser = process.platform === "win32" || spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", "exit 0"], { timeout: 5000, windowsHide: true }).status === 0;
describe.skipIf(!parser)("confirmed shell effects", () => {
  it("counts three successful shell write EVENTS to the same file, including probes", async () => {
    await writeFile(path.join(root, "probe.txt"), "probe\r\n");
    const parts = [1, 2, 3].map(id => shell(String(id), "Set-Content probe.txt -Value 'probe'"));
    const result = await observe(request(parts));
    expect(result.writes).toHaveLength(3);
    expect(result.boundary.thresholdEvent.toolCallId).toBe("3");
    expect(result.boundary.page.kind).toBe("current-accepted-plan");
  }, 30_000); // Three real PowerShell AST parser processes; retain every effect assertion under contended Linux CI.
  it.each([{ error: "refused multiline" }, { exit_code: 1 }, { timed_out: true }, { truncated: true }, { stderr: "write error" }, { exit_code: null }])("does not count failed/refused/uncertain result %j", async output => {
    await writeFile(path.join(root, "probe.txt"), "probe\n");
    expect(await confirmedWrite(root, shell("s", "Set-Content probe.txt -Value 'probe'", output))).toBeUndefined();
  });
  it("does not count pending/proposed or command text without a matching actual file", async () => {
    const part = shell("s", "Set-Content probe.txt -Value 'probe'");
    await expect(confirmedWrite(root, part)).rejects.toMatchObject({ code: "ENOENT" });
    await writeFile(path.join(root, "probe.txt"), "different\n");
    expect(await confirmedWrite(root, part)).toBeUndefined();
    part.state = "approval-requested";
    expect(await confirmedWrite(root, part)).toBeUndefined();
  });
  it("counts an uncertain effect only after a confirmed production result arrives", async () => {
    await writeFile(path.join(root, "probe.txt"), "probe\n");
    const part = shell("s", "Set-Content probe.txt -Value 'probe'", { timed_out: true });
    expect((await observe(request([part]))).writes).toHaveLength(0);
    part.output.timed_out = false;
    expect((await observe(request([part]))).writes).toHaveLength(1);
  });
  it("counts a successful literal output pipeline with filesystem evidence", async () => {
    await writeFile(path.join(root, "package.json"), "{\r\n");
    expect(await confirmedWrite(root, shell("p", "'{' | Out-File -Encoding utf8 -FilePath package.json"))).toMatchObject({ toolCallId: "p", files: [{ bytes: 3 }] });
  });
  it("checks append content and does not mistake directory creation or dry run for writes", async () => {
    await writeFile(path.join(root, "probe.txt"), "first\nsecond\n");
    expect(await confirmedWrite(root, shell("a", "Add-Content probe.txt -Value 'second'"))).toBeDefined();
    await mkdir(path.join(root, "server"));
    expect(await confirmedWrite(root, shell("d", "New-Item server -ItemType Directory"))).toBeUndefined();
    await expect(confirmedWrite(root, shell("w", "Set-Content probe.txt -Value 'second' -WhatIf"))).rejects.toThrow();
  });
  it("cannot certify a silently suppressed write from matching preexisting content", async () => {
    await writeFile(path.join(root, "probe.txt"), "probe\n");
    expect(await confirmedWrite(root, shell("s", "Set-Content probe.txt -Value 'probe' -ErrorAction SilentlyContinue"))).toBeUndefined();
    expect(await confirmedWrite(root, shell("m", "Set-Content probe.txt -Value 'probe'", { stderr: undefined }))).toBeUndefined();
  });
  it("confirms literal array NoNewline output without inventing separators", async () => {
    await writeFile(path.join(root, "probe.txt"), "firstsecond");
    expect(await confirmedWrite(root, shell("s", "'first', 'second' | Set-Content probe.txt -NoNewline"))).toBeDefined();
  });
});
describe("current work boundary and durable exactly-once dispatch", () => {
  it.each([
    ["multiline query defaults", "const {\n status,\n page = 1,\n limit = 50\n} = req.query;"],
    ["pageSize property", "const pagination = { pageSize: 50 };"],
    ["constant assignment", "export const PAGE_SIZE = 50;"],
    ["default query limit", "const page = Number(req.query.page) || 1; const limit = Number(req.query.limit) || 50; const tasks = all.slice((page - 1) * limit, page * limit);"],
    ["nullish query limit", "const page = req.query.page ?? 1; const limit = req.query.limit ?? 50; tasks.slice((page - 1) * limit, page * limit);"],
    ["aliased query binding", "const { page = 1, limit: perRequest = 50 } = req.query;"],
  ])("recognizes confirmed current authored %s", async (_name, content) => {
    const code = await native("code", "tasks.ts", content);
    const result = await observe(request([code, await native("2"), await native("3")], []));
    expect(result.writes).toHaveLength(3);
    expect(result.boundary.page).toMatchObject({ kind: "current-authored-code", path: code.output.path });
    expect(result.boundary.page.line).toContain("50");
  });
  it.each([
    "const width = 50;",
    "const timeout = 50;",
    "const fixture = { count: 50, limit: 50 };",
    "// Task pagination pageSize: 50\nconst timeout = 50;",
    'const documentation = "Task pagination pageSize: 50";',
    "const PAGE_SIZE = 500;",
    "const PAGE_SIZE = 25; // supersedes 50",
  ])("does not infer pagination from unrelated or superseded authored content: %s", async content => {
    const code = await native("code", "api.ts", content);
    expect((await observe(request([code, await native("2"), await native("3")], []))).boundary).toBeUndefined();
  });
  it.each(["pagination.test.ts", "pagination.spec.ts", "fixtures/pagination.ts"])("does not treat a page-size test fixture as implementation: %s", async file => {
    await mkdir(path.join(root, "fixtures"), { recursive: true });
    const fixture = await native("fixture", file, "export const PAGE_SIZE = 50;");
    expect((await observe(request([fixture, await native("2"), await native("3")], []))).boundary).toBeUndefined();
  });
  it("requires three writes even when multiline pagination has already reached disk", async () => {
    const code = await native("code", "tasks.ts", "const {\n page = 1,\n limit = 50\n} = req.query;");
    const two = [code, await native("2")];
    expect((await observe(request(two, []))).boundary).toBeUndefined();
    expect((await observe(request([...two, await native("3")], []))).boundary.page.kind).toBe("current-authored-code");
  });
  it("does not promote rejected or unconfirmed page-size input into authored evidence", async () => {
    const code = await native("code", "tasks.ts", "export const PAGE_SIZE = 50;");
    const rejected = { ...code, state: "output-error", output: { error: "rejected" } };
    expect((await observe(request([rejected, await native("1"), await native("2"), await native("3")], []))).boundary).toBeUndefined();
  });
  it("requires the latest successful file hash, not an unobserved later disk edit", async () => {
    const old = await native("old", "tasks.ts", "const PAGE_SIZE = 50;");
    const oldProof = await confirmedWrite(root, old);
    const updated = await native("updated", "tasks.ts", "const PAGE_SIZE = 25;");
    const newProof = await confirmedWrite(root, updated);
    expect(await currentPage50(root, [oldProof, newProof], [])).toBeUndefined();
    await writeFile(updated.output.path, "const PAGE_SIZE = 50;");
    expect(await currentPage50(root, [oldProof, newProof], [])).toBeUndefined();
  });
  it.each(["completed", "cancelled", "interrupted", "failed", "superseded"])("does not use a %s plan as current accepted work", async status => {
    const parts = [await native("1"), await native("2"), await native("3")];
    expect((await observe(request(parts, [{ ...plan[0], status }]))).boundary).toBeUndefined();
  });
  it("preserves a blocked but still current accepted plan", async () => {
    expect(await currentPage50(root, [], [{ ...plan[0], status: "blocked" }])).toMatchObject({ kind: "current-accepted-plan" });
  });
  it.skipIf(!parser)("detects shell-authored pagination only after matching literal content reaches disk", async () => {
    const content = "const {\n page = 1,\n limit = 50\n} = req.query;";
    const target = path.join(root, "tasks.ts");
    await writeFile(target, `${content}\n`);
    const write = shell("shell-code", "'const {', ' page = 1,', ' limit = 50', '} = req.query;' | Set-Content tasks.ts");
    const result = await observe(request([write, await native("2"), await native("3")], []));
    expect(result.boundary.page).toMatchObject({ kind: "current-authored-code", path: target });
    expect(result.writes[0].files[0].sha256).toBe(result.boundary.page.sha256);
  });
  it.each(["pagination (50/page)", "50 per page", "pagination: 50", "pageSize: 50", "page size of 50"])("recognizes an explicit current plan spelling: %s", async description => {
    expect(await currentPage50(root, [], [{ ...plan[0], description }])).toMatchObject({ kind: "current-accepted-plan" });
  });
  it("counts native writes/edits, not plan-review proposals or directories", async () => {
    const part = await native("n");
    expect(await confirmedWrite(root, part)).toBeDefined();
    expect(await confirmedWrite(root, { ...part, type: "tool-edit" })).toBeDefined();
    expect(await confirmedWrite(root, { ...part, type: "tool-multi_edit" })).toBeDefined();
    expect(await confirmedWrite(root, { ...part, output: { ...part.output, queued_for_plan_review: true } })).toBeUndefined();
    expect(await confirmedWrite(root, { ...part, type: "tool-create_directory" })).toBeUndefined();
  });
  it("requires both halves; only the latest supplied accepted plan qualifies", async () => {
    const parts = [await native("1"), await native("2"), await native("3")];
    expect((await observe(request([], plan))).boundary).toBeUndefined();
    expect((await observe(request(parts, []))).boundary).toBeUndefined();
    expect((await observe(request(parts, [{ ...plan[0], description: "Page size 25 supersedes 50" }]))).boundary).toBeUndefined();
    expect((await observe(request(parts, plan))).boundary.page.kind).toBe("current-accepted-plan");
  });
  it("excludes original user specification, old snapshots, unrelated 50, and cancelled plans", async () => {
    const parts = [await native("1"), await native("2"), await native("3")];
    const req = { ...request(parts, [{ ...plan[0], description: "Generate 50 demo tasks" }]), originalPrompt: "Initial task page size 50", planSnapshots: [plan] };
    expect((await observe(req)).boundary).toBeUndefined();
    expect((await observe(request(parts, [{ ...plan[0], status: "cancelled" }]))).boundary).toBeUndefined();
  });
  it("recognizes actual authored page-size code, not unexecuted input or docs", async () => {
    const file = await native("code", "api.ts", "export const PAGE_SIZE = 50;");
    const parts = [file, await native("2"), await native("3")];
    expect((await observe(request(parts, []))).boundary.page).toMatchObject({ kind: "current-authored-code", path: file.output.path });
    await writeFile(file.output.path, "export const PAGE_SIZE = 25;");
    expect(await currentPage50(root, [{ files: [{ path: file.output.path }] }], [])).toBeUndefined();
    const doc = await native("doc", "README.md", "Page size 50");
    expect(await currentPage50(root, [{ files: [{ path: doc.output.path }] }], [])).toBeUndefined();
  });
  it("deduplicates tool events across repeated observation, compaction and observer restart", async () => {
    const parts = [await native("1"), await native("2"), await native("3")];
    const first = await observe(request(parts));
    expect(first.writes).toHaveLength(3);
    expect((await observe(request(parts))).writes).toHaveLength(3);
    observe = createCorrectionObserver(root, checkpoint);
    expect((await observe(request([]))).writes).toHaveLength(3);
    const dispatch = { sessionId: "real-mission-a", action: "dispatch" };
    const claims = await Promise.all([observe(dispatch), observe(dispatch)]);
    expect(claims.map(c => c.claimed)).toEqual([true, false]);
    observe = createCorrectionObserver(root, checkpoint);
    expect((await observe(dispatch)).claimed).toBe(false);
    await observe({ ...request(), messageId: "correction-message" });
    expect((await observe(request(parts))).status).toBe("sent");
    expect(JSON.parse(await readFile(checkpoint, "utf8"))).toMatchObject({ status: "sent", messageId: "correction-message" });
    await expect(observe({ ...request(), messageId: "other-message" })).rejects.toThrow("Duplicate");
  });
  it("requires three confirmed writes plus current page-size-50 evidence and dispatches once regardless of inference stream mode", async () => {
    const parts = [await native("stream-independent-1"), await native("stream-independent-2"), await native("stream-independent-3")];
    const result = await observe({ ...request(parts), nativeRequest: { stream: false } });
    expect(result.writes).toHaveLength(3);
    expect(result.boundary).toMatchObject({ page: { kind: "current-accepted-plan" } });
    expect(result.status).toBe("pending");
    const dispatch = { sessionId: "real-mission-a", action: "dispatch", nativeRequest: { stream: false } };
    const claims = await Promise.all([observe(dispatch), observe(dispatch)]);
    expect(claims.map(value => value.claimed)).toEqual([true, false]);
    observe = createCorrectionObserver(root, checkpoint);
    expect((await observe(dispatch)).claimed).toBe(false);
    await observe({ ...request(), messageId: "single-correction-message", nativeRequest: { stream: false } });
    expect((await observe(request())).status).toBe("sent");
  });
  it("isolates owners and refuses corrupt persistence rather than replaying", async () => {
    await observe(request());
    await expect(observe({ ...request(), sessionId: "other" })).rejects.toThrow("owner");
    await writeFile(checkpoint, "broken");
    await expect(createCorrectionObserver(root, checkpoint)(request())).rejects.toThrow();
  });
});
