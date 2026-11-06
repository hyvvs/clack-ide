import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createCorrectionObserver, correctionText } from "./acceptance-correction.mjs";

const scripts = path.dirname(fileURLToPath(import.meta.url));
const rootOfRepo = path.resolve(scripts, "..");

test("one-shot host remains mission-a only; the same-session correction is not a second mission", async () => {
  const host = await readFile(path.join(scripts, "forgeboard-muse-instrumented-one-20261106.mjs"), "utf8");
  const frontend = await readFile(path.join(rootOfRepo, "src/test/forgeboardMuseAgent20261104.tsx"), "utf8");
  assert.match(host, /assert\(phase === "mission-a", "This one-shot host authorizes exactly one ForgeBoard mission"\)/);
  assert.match(frontend, /phase === "mission-a"\s*\? mission/);
  assert.match(frontend, /await run\("real-mission-a", correction/);
  assert.match(frontend, /shouldObserveForgeBoardCorrection\(/);
  assert.doesNotMatch(frontend, /if \(config\.realProduct\?\.singleSpec \|\| alreadyCorrected/);
  assert.equal(correctionText, "Change the task page size requirement from 50 to 25. The new value supersedes 50 everywhere. Continue the same project and do not restart from scratch.");
});

async function setup(t) {
  const root = await mkdtemp(path.join(tmpdir(), "forgeboard-observer-offline-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "src"));
  const observer = createCorrectionObserver(root, path.join(root, "state.json"));
  const writes = [];
  const add = async (name, content) => {
    const target = path.join(root, "src", name);
    await writeFile(target, content, "utf8");
    writes.push({
      type: "tool-write_file", toolCallId: `write-${writes.length + 1}`,
      state: "output-available", input: { path: target, content },
      output: { ok: true, clackWorkspaceWrite: true, bytesWritten: content.length, path: target },
    });
  };
  const observe = plan => observer({ sessionId: "real-mission-a", action: "observe", parts: writes, plan });
  return { observer, add, observe };
}

test("three independently confirmed authored writes AND live page-50 implementation; one dispatch only", async t => {
  const { observer, add, observe } = await setup(t);
  await add("a.ts", "export const a = 1;");
  await add("b.ts", "export const b = 2;");
  assert.equal((await observe([])).writes.length, 2);
  assert.equal((await observe([])).boundary, undefined);
  await add("pagination.ts", "export const pageSize = 50;");
  const state = await observe([]);
  assert.equal(state.writes.length, 3);
  assert.equal(state.boundary.page.kind, "current-authored-code");
  assert.match(state.boundary.page.line, /pageSize = 50/);
  const claim = await observer({ sessionId: "real-mission-a", action: "dispatch" });
  assert.equal(claim.claimed, true);
  const repeated = await observer({ sessionId: "real-mission-a", action: "dispatch" });
  assert.equal(repeated.claimed, false);
  const sent = await observer({ sessionId: "real-mission-a", action: "observe", messageId: "same-session-message" });
  assert.equal(sent.status, "sent");
  assert.equal(sent.messageId, "same-session-message");
  assert.equal((await observer({ sessionId: "real-mission-a", action: "dispatch" })).claimed, false);
  await assert.rejects(() => observer({ sessionId: "real-mission-a", action: "observe", messageId: "duplicated-message" }), /Duplicate correction message/);
});

test("no correction for two authored writes, absent page 50, or unconfirmed write; active plan qualifies", async t => {
  const { observer, add, observe } = await setup(t);
  await add("a.ts", "export const a = 1;");
  await add("b.ts", "export const b = 2;");
  assert.equal((await observe([{ title: "task page size 50", status: "pending" }])).boundary, undefined);
  await add("c.ts", "export const c = 3;");
  assert.equal((await observe([])).boundary, undefined);
  assert.equal((await observer({ sessionId: "real-mission-a", action: "dispatch" })).claimed, false);
  const state = await observe([{ title: "Implement task page size 50", status: "in_progress" }]);
  assert.equal(state.boundary.writes.length, 3);
  assert.equal(state.boundary.page.kind, "current-accepted-plan");
});
