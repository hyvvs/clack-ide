import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink, link, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { Chat } from "@ai-sdk/react";
import { convertToModelMessages, streamText, tool, lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import { observeAcceptanceRun } from "@/test/acceptanceApprovalLifecycle";
import { pendingApprovalsForRun } from "@/modules/ai/components/AgentRunBridge";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { evaluateAcceptanceApproval } from "./acceptance-approval.mjs";

let directory, root, expected, subject;
const probe = target => `Set-Content -Path '${target}' -Value 'hello' -Encoding utf8; Test-Path '${target}'; Remove-Item '${target}'`;
const register = () => { expected.approvals = [structuredClone({ id: subject.id, toolCallId: subject.toolCallId, toolName: subject.toolName, input: subject.input })]; };
const decide = async command => { if (command) subject.input.command = command; register(); return evaluateAcceptanceApproval(subject, expected); };
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "clack-approval-"));
  root = path.join(directory, "forgeboard-qwen-none-20261017-07");
  await mkdir(path.join(root, ".git"), { recursive: true });
  expected = { sessionId: "real-mission-a", runId: "real-mission-a:1", workspaceRoot: root };
  subject = { ...expected, cwd: root, id: "approval", toolCallId: "call", toolName: "bash_run", input: { command: probe("test.txt") } };
  register();
});
afterEach(async () => {
  useChatStore.setState({ approvalRespondersBySession: {}, pendingApprovalsBySession: {} });
  expect(path.dirname(path.resolve(directory))).toBe(path.resolve(tmpdir()));
  expect(path.basename(directory).startsWith("clack-approval-")).toBe(true);
  await rm(directory, { recursive: true, force: true });
});

const nativeParserAvailable = process.platform === "win32" || spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", "exit 0"], { timeout: 5000, windowsHide: true }).status === 0;
describe.skipIf(!nativeParserAvailable)("native per-approval literal workspace effect policy", () => {
  describe.each(["north-mini-code", "nemotron35-lightning"])("keeps the same owner and path checks for the %s disposable root", candidate => {
    beforeEach(async () => {
      root = path.join(directory, `forgeboard-${candidate}-20261019-01`);
      await mkdir(path.join(root, ".git"), { recursive: true });
      Object.assign(expected, { workspaceRoot: root });
      Object.assign(subject, { workspaceRoot: root, cwd: root });
    });
    // These are independent point-in-time approval decisions, not executed
    // commands. Preserve every real native-parser assertion with its own
    // existing 5s clock rather than combining four subprocess startups into
    // one overloaded clock on a Linux CI runner.
    it("accepts the ordinary registered workspace write", async () => {
      expect((await decide("Set-Content probe.txt -Value 'probe'")).approved).toBe(true);
    });
    it("rejects a parent-directory traversal", async () => {
      expect((await decide("Set-Content ../outside -Value 'no'")).approved).toBe(false);
    });
    it("rejects a workspace secret path", async () => {
      expect((await decide("Set-Content .env -Value 'no'")).approved).toBe(false);
    });
    it("revokes a previously valid proposal for a foreign run", async () => {
      expect((await decide("Set-Content probe.txt -Value 'probe'")).approved).toBe(true);
      subject.runId = "unrelated-run";
      expect((await decide("Set-Content probe.txt -Value 'probe'")).approved).toBe(false);
    });
  });
  it("applies unchanged approval and path protections to the Muse disposable workspace", async () => {
    root = path.join(directory, "forgeboard-muse-glimmer-20261019-01");
    await mkdir(path.join(root, ".git"), { recursive: true });
    Object.assign(expected, { workspaceRoot: root });
    Object.assign(subject, { workspaceRoot: root, cwd: root });
    expect((await decide("Set-Content probe.txt -Value 'probe'")).approved).toBe(true);
    expect((await decide("Set-Content ../outside -Value 'no'")).approved).toBe(false);
    expect((await decide("Set-Content .env -Value 'no'")).approved).toBe(false);
  });
  it("uses the same confined effect policy for the explicitly authorized coder comparison root", async () => {
    root = path.join(directory, "forgeboard-qwen3coder-20261017-01");
    await mkdir(path.join(root, ".git"), { recursive: true });
    expected.workspaceRoot = root;
    subject.workspaceRoot = root;
    subject.cwd = root;
    const result = await decide("Set-Content probe.txt -Value 'probe'");
    expect(result).toMatchObject({ approved: true, targets: [path.join(root, "probe.txt")] });
    expect((await decide("Set-Content ../outside -Value 'no'")).approved).toBe(false);
  });
  it("keeps the earlier disposable probe and resolves every sequential operation", async () => {
    const decision = await decide();
    expect(decision).toMatchObject({ approved: true, targets: Array(3).fill(path.join(root, "test.txt")) });
    expect(decision.effects.map(e => e.operation)).toEqual(["write", "test", "delete"]);
  });
  it("qualifies recursive forced deletion of existing model-authored files without executing it", async () => {
    await mkdir(path.join(root, "web/src"), { recursive: true });
    await writeFile(path.join(root, "web/src/App.tsx"), "generated");
    const decision = await decide(`Remove-Item -Recurse -Force -LiteralPath '${path.join(root, "web")}'`);
    expect(decision).toMatchObject({ approved: true, effects: [{ operation: "delete", recursive: true, force: true, existedBeforeApproval: true }] });
    expect(await readFile(path.join(root, "web/src/App.tsx"), "utf8")).toBe("generated");
  });
  it("assesses all delete/recreate/write/read effects in order", async () => {
    await mkdir(path.join(root, "web"));
    const result = await decide("Remove-Item web -Recurse -Force; New-Item web -ItemType Directory; Set-Content web/probe.txt -Value 'probe'; Get-Content web/probe.txt");
    expect(result.approved).toBe(true);
    expect(result.effects.map(e => e.operation)).toEqual(["delete", "create", "write", "read"]);
  });
  it("qualifies the exact -06 sequence even though deleting the write parent is foolish", async () => {
    await mkdir(path.join(root, "web/src"), { recursive: true });
    const web = path.join(root, "web");
    const result = await decide(`Remove-Item -Recurse -Force "${web}" -ErrorAction SilentlyContinue; Set-Content -Path "${web}/wf-probe.txt" -Value "probe"; Get-Content "${web}/wf-probe.txt"`);
    expect(result.approved).toBe(true);
    expect(result.effects.map(e => e.operation)).toEqual(["delete", "write", "read"]);
  });
  it("allows literal semicolons inside content without interpreting them as effects", async () => {
    expect((await decide("Set-Content README.md -Value 'example; Remove-Item C:/Windows'" )).approved).toBe(true);
  });
  it("qualifies the -07 static literal Out-File pipeline without executing it or resuming the run", async () => {
    await mkdir(path.join(root, "server"));
    const result = await decide("Remove-Item -Force server/package.json -ErrorAction SilentlyContinue; '{' | Out-File -Encoding utf8 -FilePath server/package.json");
    expect(result).toMatchObject({ approved: true, effects: [{ operation: "delete" }, { operation: "write", contentBytes: 1 }] });
    await expect(readFile(path.join(root, "server/package.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("allows a bounded literal string array piped to a scoped file writer", async () => {
    const result = await decide("'line 1', 'line 2' | Set-Content -Path README.md -Encoding utf8");
    expect(result).toMatchObject({ approved: true, effects: [{ operation: "write", contentBytes: 13 }] });
  });
  it("permits overwriting existing ordinary workspace data, not only an absent test.txt", async () => {
    await writeFile(path.join(root, "test.txt"), "existing");
    expect((await decide()).approved).toBe(true);
    expect(await readFile(path.join(root, "test.txt"), "utf8")).toBe("existing");
  });
  it.each(["../other-project", ".ssh/key", ".env.local", ".git/config", "*.txt", "test?.txt", "test[1].txt", "C:/Windows", "C:relative", "~", ".", "web/../test.txt", "test.txt:stream", "NUL", "web."])("rejects unsafe/ambiguous target %s", async target => {
    expect((await decide(`Remove-Item '${target}' -Recurse -Force`)).approved).toBe(false);
  });
  it.each([
    "Remove-Item web -Recurse; Set-Content '../outside' -Value 'bad'",
    "Remove-Item web; Invoke-Expression 'anything'",
    "Remove-Item $env:HOME -Recurse",
    "Remove-Item (Join-Path .. outside)",
    "Remove-Item web | Remove-Item other",
    "Remove-Item web > ../outside",
    "& Remove-Item web",
    "rm web -Recurse",
    "Remove-Item web -Exclude '*.ts'",
    "Set-Content web/file -Value \"$(Get-Content ../secret)\"",
    "Remove-Item web -Path other",
    "Remove-Item web -Force:$false",
    "Get-Content ../outside | Out-File -FilePath file.txt",
    "'safe' | Out-File -FilePath ../outside",
    "'outside' | Remove-Item -Recurse",
    "'safe' | Set-Content file -Value other",
    "(Get-Content ../secret) | Out-File file.txt",
    "using namespace System.IO; Remove-Item web",
  ])("rejects the whole command on unsupported or additional unsafe effect: %s", async command => {
    expect((await decide(command)).approved).toBe(false);
  });
  it.each(["sessionId", "runId", "workspaceRoot", "cwd", "id", "toolCallId"])("rejects a foreign/stale %s", async field => {
    subject[field] += "-other";
    expect((await evaluateAcceptanceApproval(subject, expected)).approved).toBe(false);
  });
  it("rejects input replaced after registration", async () => {
    subject.input.command = "Remove-Item web -Recurse";
    expect((await evaluateAcceptanceApproval(subject, expected)).approved).toBe(false);
  });
  it("rejects a root alias/junction", async () => {
    const alias = path.join(directory, "alias", path.basename(root));
    await mkdir(path.dirname(alias));
    await symlink(root, alias, process.platform === "win32" ? "junction" : "dir");
    expected.workspaceRoot = alias;
    subject = { ...subject, ...expected, cwd: alias };
    expect((await decide()).approved).toBe(false);
  });
  it("rejects an escaping junction anywhere in a recursive subtree", async () => {
    await mkdir(path.join(root, "web"));
    const outside = path.join(directory, "other-project");
    await mkdir(outside);
    await symlink(outside, path.join(root, "web/escape"), process.platform === "win32" ? "junction" : "dir");
    expect((await decide("Remove-Item web -Recurse -Force")).approved).toBe(false);
    expect((await decide("Test-Path web; Remove-Item web -Recurse -Force")).approved).toBe(false);
  });
  it("rejects a junction in a missing target's ancestry", async () => {
    await symlink(directory, path.join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
    expect((await decide("Set-Content escape/new.txt -Value 'bad'")).approved).toBe(false);
  });
  it("retains Unicode target identity and rejects its junction traversal", async () => {
    const name = "caf\u00e9";
    const result = await decide(`Set-Content '${name}.txt' -Value 'literal'`);
    expect(result).toMatchObject({ approved: true, targets: [path.join(root, `${name}.txt`)] });
    await symlink(directory, path.join(root, name), process.platform === "win32" ? "junction" : "dir");
    expect((await decide(`Set-Content '${name}/outside.txt' -Value 'bad'`)).approved).toBe(false);
  });
  it("rejects a nested repository before recursive deletion", async () => {
    await mkdir(path.join(root, "web/other/.git"), { recursive: true });
    expect((await decide("Remove-Item web -Recurse -Force")).approved).toBe(false);
  });
  it("rejects hard-linked files within a recursive deletion/write scope", async () => {
    const outside = path.join(directory, "outside.txt");
    await writeFile(outside, "original");
    await mkdir(path.join(root, "web"));
    await link(outside, path.join(root, "web/link.txt"));
    expect((await decide("Remove-Item web -Recurse -Force")).approved).toBe(false);
    expect((await decide("Set-Content web/link.txt -Value 'bad'")).approved).toBe(false);
  });
  it("fails closed without the registered live owner", async () => {
    expect((await evaluateAcceptanceApproval(subject, undefined)).approved).toBe(false);
  });
  it("executes a safe recursive delete/recreate once through the production responder without another user message", async () => {
    const web = path.join(root, "web");
    expect(path.dirname(web)).toBe(root);
    await mkdir(web);
    await writeFile(path.join(web, "old.txt"), "model-authored");
    const command = `Remove-Item -LiteralPath '${web}' -Recurse -Force; New-Item -Path '${web}' -ItemType Directory; Set-Content -Path '${web}/new.txt' -Value 'new'`;
    let modelCalls = 0, executions = 0, responses = 0;
    const emitted = [];
    const model = new MockLanguageModelV3({ doStream: async () => ({ stream: new ReadableStream({ start(controller) {
      modelCalls++;
      if (modelCalls === 1) controller.enqueue({ type: "tool-call", toolCallId: "safe-recursive", toolName: "bash_run", input: JSON.stringify({ command }) });
      else {
        controller.enqueue({ type: "text-start", id: "text" });
        controller.enqueue({ type: "text-delta", id: "text", delta: "Finished" });
        controller.enqueue({ type: "text-end", id: "text" });
      }
      controller.enqueue({ type: "finish", finishReason: { unified: modelCalls === 1 ? "tool-calls" : "stop", raw: "stop" },
        usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } } });
      controller.close();
    } }) }) });
    const tools = { bash_run: tool({ inputSchema: z.object({ command: z.string() }), needsApproval: true, execute: async input => {
      expect(input.command).toBe(command);
      executions++;
      const executable = process.platform === "win32" ? path.join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe") : "pwsh";
      execFileSync(executable, ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, timeout: 5000 });
      return { ok: true };
    } }) };
    const chat = new Chat({ id: expected.sessionId, sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
      transport: { sendMessages: async ({ messages }) => streamText({ model, tools, messages: await convertToModelMessages(messages) }).toUIMessageStream({ originalMessages: messages }), reconnectToStream: async () => null } });
    await chat.sendMessage({ text: "Original specification exactly once" });
    const originalUser = structuredClone(chat.messages.filter(m => m.role === "user"));
    expect(executions).toBe(0);
    useChatStore.getState().setApprovalResponder(expected.sessionId, (id, approved) => { void chat.addToolApprovalResponse({ id, approved }); });
    await observeAcceptanceRun({ expected, emit: event => emitted.push(event), sleep: () => new Promise(resolve => setTimeout(resolve, 1)),
      respond: (id, sessionId) => { responses++; useChatStore.getState().respondToApproval(id, true, sessionId); },
      evaluate: async proposal => {
        const pending = read().approvals;
        return evaluateAcceptanceApproval(proposal, { ...expected, approvals: pending });
      }, read });
    function read() {
      const pending = pendingApprovalsForRun(chat.messages, expected.sessionId, "running");
      useChatStore.getState().setPendingApprovals(expected.sessionId, pending);
      const parts = chat.messages.flatMap(m => m.parts);
      return { ...expected, cwd: root, state: "running", active: ["submitted", "streaming"].includes(chat.status), responderReady: true,
        approvals: pending.map(p => ({ id: p.id, toolName: p.toolName, input: p.input, toolCallId: parts.find(part => part.approval?.id === p.id)?.toolCallId ?? "" })),
        effects: parts.filter(p => p.toolCallId).map(p => ({ toolCallId: p.toolCallId, state: p.state, output: p.output })) };
    }
    expect(responses).toBe(1);
    expect(executions).toBe(1);
    expect(modelCalls).toBe(2);
    expect(chat.messages.filter(m => m.role === "user")).toEqual(originalUser);
    expect(emitted.filter(e => e.kind === "approval-submitted")).toMatchObject([{ injectedMessages: 0 }]);
    expect((await readFile(path.join(web, "new.txt"), "utf8")).trim()).toBe("new");
    await expect(readFile(path.join(web, "old.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
