import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const endpoint = "http://127.0.0.1:11435";
const root = path.resolve("src-tauri/target/installed-local-models-20261019-01");
async function metadata(route, body) {
  const response = await fetch(`${endpoint}${route}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  assert(response.ok, `Metadata ${route}: ${response.status}`);
  return response.json();
}
const version = await metadata("/api/version");
const tags = await metadata("/api/tags");
const loaded = await metadata("/api/ps");
const models = [];
for (const tag of tags.models) {
  const show = await metadata("/api/show", { model: tag.name, verbose: false });
  models.push({ ...tag, loaded: loaded.models.some(item => item.digest === tag.digest),
    capabilities: show.capabilities, architecture: show.model_info?.["general.architecture"],
    context: Object.fromEntries(Object.entries(show.model_info ?? {}).filter(([key]) => key.endsWith(".context_length"))),
    details: show.details, parameters: show.parameters, modelInfo: show.model_info });
}
await mkdir(root, { recursive: true });
await writeFile(path.join(root, "inventory.json"), JSON.stringify({ at: new Date().toISOString(), endpoint, version, loaded, models, inferenceCount: 0 }, null, 2), { flag: "wx" });
console.log(JSON.stringify({ version, models: models.map(({ name, digest, size, loaded, architecture, context, capabilities, details }) => ({ name, digest, size, loaded, architecture, context, capabilities, details })) }, null, 2));
