/** LM11 T15 independent immutable BEFORE/AFTER comparison. No state writes. */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cases = fs.realpathSync.native(path.join(repo, 'src-tauri', 'target',
  'lm11-b01-b03-authenticated-webview-20261119', 'cases'));
const supplied = process.argv[2];
if (!supplied || process.argv.length !== 3)
  throw new Error('Expected exactly one canonical LM11 fidelity-audit case directory');
const caseDir = fs.realpathSync.native(supplied);
if (path.dirname(caseDir).toLowerCase() !== cases.toLowerCase() ||
    !/^fidelity-audit-[0-9]{17}-[a-f0-9]{12}$/.test(path.basename(caseDir)) ||
    fs.lstatSync(caseDir).isSymbolicLink())
  throw new Error('Comparison must remain under exact canonical owned audit case');

function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function read(leaf, phase) {
  const filename = path.join(caseDir, leaf);
  if (!fs.lstatSync(filename).isFile() || fs.lstatSync(filename).isSymbolicLink())
    throw new Error('Inventory is not a regular file');
  const bytes = fs.readFileSync(filename);
  const json = JSON.parse(bytes.toString('utf8'));
  if (json.phase !== phase || json.caseId !== path.basename(caseDir) ||
      json.appId !== 'app.clack.dev' || !Array.isArray(json.fileOrRegistryEntries) ||
      !Array.isArray(json.errors))
    throw new Error('Invalid independent production inventory');
  return { json, hash: sha(bytes) };
}
const before = read('production-before.json', 'Before');
const after = read('production-after.json', 'After');
if (JSON.stringify(before.json.rootIds) !== JSON.stringify(after.json.rootIds) ||
    JSON.stringify(before.json.registryRoots) !== JSON.stringify(after.json.registryRoots))
  throw new Error('Inventory coverage changed between BEFORE and AFTER');

function index(snapshot) {
  const map = new Map();
  for (const e of snapshot.fileOrRegistryEntries) {
    if (typeof e.key !== 'string' || typeof e.kind !== 'string' ||
        typeof e.sha256 !== 'string' || !Number.isSafeInteger(e.size) ||
        map.has(e.key)) throw new Error('Invalid or duplicate inventory entry');
    map.set(e.key, e);
  }
  return map;
}
const oldEntries = index(before.json);
const newEntries = index(after.json);
const differences = [];
let added = 0; let removed = 0; let modified = 0;
for (const key of new Set([...oldEntries.keys(), ...newEntries.keys()])) {
  const a = oldEntries.get(key), b = newEntries.get(key);
  if (a && b && a.sha256 === b.sha256 && a.size === b.size && a.kind === b.kind)
    continue;
  if (!a) added++; else if (!b) removed++; else modified++;
  differences.push({ pathSha256: sha(key), change: !a ? 'added' : !b ? 'removed' : 'modified' });
}
differences.sort((a, b) => a.pathSha256.localeCompare(b.pathSha256));
const report = {
  caseId: path.basename(caseDir),
  comparator: 'independent-native-node-inventory-digest-comparator-v1',
  beforeInventorySha256: before.hash, afterInventorySha256: after.hash,
  beforeEntries: oldEntries.size, afterEntries: newEntries.size,
  beforeErrors: before.json.errors.length, afterErrors: after.json.errors.length,
  added, removed, modified, changedCount: differences.length, changedPathHashes: differences,
  noninterferenceProven: differences.length === 0 &&
    before.json.errors.length === 0 && after.json.errors.length === 0,
  scopeLimit: 'Enumerated configured app-scoped AppData and HKCU keys; not a full system-wide filesystem or registry snapshot',
};
const out = path.join(caseDir, 'production-comparison.json');
const fd = fs.openSync(out, 'wx', 0o600);
try { fs.writeFileSync(fd, JSON.stringify(report, null, 2) + '\n'); fs.fsyncSync(fd); }
finally { fs.closeSync(fd); }
console.log(JSON.stringify({ caseId: report.caseId, beforeEntries: report.beforeEntries,
  afterEntries: report.afterEntries, changedCount: report.changedCount,
  beforeErrors: report.beforeErrors, afterErrors: report.afterErrors,
  noninterferenceProven: report.noninterferenceProven }));
if (!report.noninterferenceProven) process.exitCode = 3;
