import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { evaluateAcceptanceApproval } from "./acceptance-approval.mjs";

let directory, root, expected, subject;
const probe = target => `Set-Content -Path '${target}' -Value 'hello' -Encoding utf8; Test-Path '${target}'; Remove-Item '${target}'`;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "clack-approval-"));
  root = path.join(directory, "forgeboard-qwen-none-20261017-04");
  await mkdir(path.join(root, ".git"), { recursive: true });
  expected = { sessionId: "real-mission-a", runId: "real-mission-a:1", workspaceRoot: root };
  subject = { ...expected, cwd: root, id: "approval", toolCallId: "call", toolName: "bash_run", input: { command: probe("test.txt") } };
});
afterEach(async () => {
  expect(path.dirname(path.resolve(directory))).toBe(path.resolve(tmpdir()));
  expect(path.basename(directory).startsWith("clack-approval-")).toBe(true);
  await rm(directory, { recursive: true, force: true });
});

describe("explicit disposable acceptance probe policy", () => {
  it("qualifies only the absent task-related scratch probe, with exact resolved target", async () => {
    expect(await evaluateAcceptanceApproval(subject, expected)).toMatchObject({ approved: true, targets: [path.join(root, "test.txt")] });
  });
  it.each(["../test.txt", ".ssh/test.txt", "packages/test.txt", "*.txt", "test?.txt", "test[1].txt", "C:/Windows/test.txt"])("refuses unreviewed/escaping operand %s", async target => {
    subject.input.command = probe(target);
    expect((await evaluateAcceptanceApproval(subject, expected)).approved).toBe(false);
  });
  it.each(["; Write-Output extra", " -Force", " -Recurse", "\nRemove-Item other"])("does not approve a command class or additional effects: %s", async suffix => {
    subject.input.command += suffix;
    expect((await evaluateAcceptanceApproval(subject, expected)).approved).toBe(false);
  });
  it.each(["sessionId", "runId", "workspaceRoot", "cwd"])("rejects changed %s", async field => {
    subject[field] += "-other";
    expect((await evaluateAcceptanceApproval(subject, expected)).approved).toBe(false);
  });
  it("never overwrites existing data even at the reviewed path", async () => {
    await writeFile(path.join(root, "test.txt"), "existing data");
    expect((await evaluateAcceptanceApproval(subject, expected)).approved).toBe(false);
  });
  it("rejects a root alias/junction", async () => {
    const alias = path.join(directory, "alias", path.basename(root));
    await mkdir(path.dirname(alias));
    await symlink(root, alias, process.platform === "win32" ? "junction" : "dir");
    expected.workspaceRoot = alias;
    subject = { ...subject, ...expected, cwd: alias };
    expect((await evaluateAcceptanceApproval(subject, expected)).approved).toBe(false);
  });
  it("fails closed without the registered live owner", async () => {
    expect((await evaluateAcceptanceApproval(subject, undefined)).approved).toBe(false);
  });
});
