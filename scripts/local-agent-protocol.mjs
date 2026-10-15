import assert from "node:assert/strict";

// Scripted protocol peer, never a live-model quality evaluator.
export function createLocalAgentProtocol() {
  const states = new Map();
  const metrics = [];
  return { metrics, respond(body, sequence) {
    const text = JSON.stringify(body.messages);
    const match = text.match(/LOCAL_AGENT_MISSION_(8192|16384|32768|131072)/);
    assert(match, "Local mission objective missing from the actual request");
    const size = Number(match[1]);
    assert.equal(body.model, `fixture-${size}`, "Wrong captured model");
    assert(text.includes("ROLE=Coder"), "Captured Coder role missing");
    for (const fact of ["timeoutMs=750", "port=1420", "allowRemote=false", "public-api.ts", "test and document"])
      assert(text.includes(fact), `Critical objective/constraint omitted: ${fact}`);
    const state = states.get(size) ?? { stage: 0, waiting: null, reads: 0, writes: 0, tests: 0, premature: false };
    states.set(size, state);
    const outputs = body.messages.filter(message => message.role === "tool");
    if (state.waiting) {
      let nextStage = state.waiting.nextStage ?? state.stage + 1;
      const result = outputs.find(message => message.tool_call_id === state.waiting.id);
      assert(result, `Actual result missing for ${state.waiting.name}`);
      const value = JSON.parse(result.content);
      assert(!value.error, `Real tool failed: ${JSON.stringify(value)}`);
      if (state.waiting.name === "bash_run") {
        state.tests++;
        if (size === 16384 && !state.failedTests) {
          assert.notEqual(value.exit_code, 0, "Intentional wrong implementation unexpectedly passed");
          assert(value.stderr.includes("750"), "Actual assertion output missing");
          state.failedTests = 1;
          nextStage = 5;
        } else {
          assert.equal(value.exit_code, 0, "Actual focused test failed");
          assert(value.stdout.includes(`PASS-${size}`), "No real test execution evidence");
        }
      }
      if (state.waiting.name === "read_file") state.reads++;
      if (state.waiting.name === "write_file") {
        assert.equal(value.ok, true);
        assert.equal(value.clackWorkspaceWrite, true, "Write was only proposed, not performed");
        state.writes++;
      }
      state.waiting = null;
      state.stage = nextStage;
    }
    const call = (name, args) => {
      assert(body.tools?.some(tool => tool.function.name === name), `Needed tool unavailable: ${name}`);
      const id = `local-${size}-${sequence}`;
      state.waiting = { id, name };
      return { tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } }] };
    };
    const plan = completed => call("todo_write", { todos: [
      { id: "inspect", title: "Inspect source and current constraints", status: state.stage > 1 ? "completed" : "in_progress" },
      { id: "source", title: "Implement timeoutMs=750; preserve port=1420 and public-api.ts", status: completed ? "completed" : "pending" },
      { id: "test", title: "Add and run focused test and document actual result", status: completed ? "completed" : "pending" },
    ] });
    if (size === 32768 && !state.finishHistory) {
      const lastUser = body.messages.filter(message => message.role === "user").at(-1);
      const phase = JSON.stringify(lastUser).match(/LOCAL_PHASE_(\d+)/)?.[1];
      assert(phase !== undefined, "Long mission phase missing");
      const index = Number(phase);
      if (state.lastPhase !== index) {
        const delta = call("read_file", { path: "logs/huge.txt", offset: index * 40, limit: 35 });
        state.lastPhase = index;
        return delta;
      }
      if (!state.phases) state.phases = [];
      if (!state.phases.includes(index)) state.phases.push(index);
      const last = JSON.parse(outputs.at(-1).content);
      assert(last.content, "Long mission did not receive the actual requested file window");
      assert.equal(last.start_line, index * 40, "Scripted peer reused a different phase's file result");
      assert(last.content.includes(`Observation ${index * 40}:`));
      return { content: `Phase ${index} observed original evidence. Pending: implement, test and document.\n${last.content}` };
    }
    if (state.stage === 0) return plan(false);
    if (state.stage === 1) return call("read_file", { path: "config.json", offset: 0, limit: 3 });
    if (state.stage === 2 && !state.premature) {
      state.premature = true;
      return { content: "I have read the configuration. Done." };
    }
    if (state.stage === 2) {
      assert(text.includes("continues the same logical run"), "Known unfinished work did not enter bounded continuation");
      return call("read_file", { path: `src/local-${size}.js`, offset: 0, limit: 5 });
    }
    const stage = state.stage;
    if (stage === 3) return call("write_file", { path: `src/local-${size}.js`, content: `export const timeoutMs = ${size === 16384 ? 800 : 750};\n` });
    if (stage === 4) return call("write_file", { path: `tests/local-${size}.mjs`, content: `import assert from 'node:assert/strict';\nimport { timeoutMs } from '../src/local-${size}.js';\nassert.equal(timeoutMs, 750);\nconsole.log('PASS-${size}');\n` });
    if (stage === 5 && state.failedTests && !state.repairSent) {
      assert(text.includes("AssertionError"), "Unresolved failing test lost from current context");
      state.repairSent = true;
      const delta = call("write_file", { path: `src/local-${size}.js`, content: "export const timeoutMs = 750;\n" });
      state.waiting.nextStage = 5;
      return delta;
    }
    if (stage === 5) return call("bash_run", { command: `node tests/local-${size}.mjs`, timeout_secs: 15 });
    if (stage === 6) return call("write_file", { path: `LOCAL-${size}.md`, content: "# Verified local task\nTimeout is exactly 750 ms. Port remains 1420. Remote access remains disabled. Public API is unchanged.\n" });
    if (stage === 7) return plan(true);
    assert.equal(state.writes, size === 16384 ? 4 : 3);
    assert.equal(state.tests, size === 16384 ? 2 : 1);
    metrics.push({ size, reads: state.reads, writes: state.writes, tests: state.tests, failedTests: state.failedTests ?? 0, prematureAnswers: 1, completed: true });
    return { content: `Verified actual source, test execution PASS-${size}, and documentation. timeoutMs=750, port=1420, allowRemote=false; public-api.ts untouched.` };
  }, finishLongHistory() {
    const state = states.get(32768);
    assert.equal(state?.phases?.length, 24);
    state.stage = 0;
    state.finishHistory = true;
  } };
}
