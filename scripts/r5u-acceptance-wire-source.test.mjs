import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { productionBuiltinToolNames } from "./r5u-acceptance-wire-source.mjs";

const repository = fileURLToPath(new URL("../", import.meta.url));
test("extracts the actual production built-in Agent tool registry without UI initialization", async () => {
  const tools = await productionBuiltinToolNames(repository);
  assert(tools.length >= 14);
  assert.deepEqual([...tools].sort(), tools);
  assert.equal(new Set(tools).size, tools.length);
  for (const required of ["read_file","list_directory","bash_run","todo_write","write_file","edit"])
    assert(tools.includes(required), required);
  assert(!tools.includes("get_probe_value"), "Tool-verification schema cannot masquerade as an Agent tool");
  assert(!tools.includes("fake_or_unauthorized"));
});
test("missing native production registry fails closed", async () => {
  await assert.rejects(productionBuiltinToolNames("/does-not-exist"), { code: "ENOENT" });
});
