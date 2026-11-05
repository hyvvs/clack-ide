/** Offline, deterministic redaction of immutable ForgeBoard diagnostic state.
 * No Ollama, Chat Agent, provider access or inference. One new fixture only.
 * Trust records, identities, timestamps and signatures are COPIED, not forged.
 */
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const repo = fileURLToPath(new URL("../", import.meta.url));
const root = path.join(repo, "src-tauri/target/real-qwen-product/forgeboardmuse-20261104-02");
const raw = JSON.parse(await readFile(path.join(root, "data/terax-settings.json"), "utf8"));
const state = raw.selfHostedInference;
const profile = state.profiles.find(p => p.transportModelId === "muse-glimmer:30b");
assert(profile && profile.modelRevision === "de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1");
const endpoint = state.endpoints.find(e => e.id === profile.endpointId);
const inventory = state.inventories.find(i =>
  i.endpointId === endpoint?.id && i.configurationRevision === endpoint?.configurationRevision);
assert(endpoint && inventory && inventory.models.some(m => m.id === profile.transportModelId));
const requests = (await readFile(path.join(root, "mission-a-1.requests.jsonl"), "utf8"))
  .trim().split(/\r?\n/).map(JSON.parse);
const a14 = requests.find(r => r.requestId === "inference-14");
const a15 = requests.find(r => r.requestId === "inference-15");
assert(a14 && a15 && a14.numCtx === 32768 && a15.numCtx === 32768);

// Keep only the exact model's real calibration, proof and scoped evidence.
// Alias/credential/provider keys, other models, operator preferences, prompts
// and the conversation are intentionally absent.
const cleanEndpoint = { ...endpoint, alias: "Preserved local diagnostic" };
cleanEndpoint.credentialRef = null;
const cleanProfile = structuredClone(profile);
delete cleanProfile.saved;
const cleanInventory = { ...inventory,
  models: inventory.models.filter(m => m.id === profile.transportModelId) };
const fixture = {
  source: "forgeboardmuse-20261104-02 preserved data/terax-settings.json and native request log",
  sourceSha256: createHash("sha256").update(await readFile(path.join(root, "data/terax-settings.json"))).digest("hex"),
  contract: "Preserved original model trust records; only non-trust endpoint alias/credentials and unrelated profiles are omitted",
  request14At: a14.at,
  request15At: a15.at,
  model: profile.transportModelId,
  digest: profile.modelRevision,
  provider: "ollama",
  state: { version: state.version, revision: state.revision,
    endpoints: [cleanEndpoint], profiles: [cleanProfile], inventories: [cleanInventory] },
};
const out = path.join(repo, "src/modules/ai/lib/fixtures/forgeboardContextCapacityEvidence20261105.json");
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(fixture, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ path: path.relative(repo, out), sourceSha256: fixture.sourceSha256,
  request14At: a14.at, request15At: a15.at, profileId: profile.id,
  calibrationId: profile.contextCalibration?.id,
  calibrationExpires: profile.contextCalibration?.expiresAt,
  proofIds: [profile.toolVerification?.id, ...(profile.agentToolTierProofs ?? []).map(p => p.id)] }));
