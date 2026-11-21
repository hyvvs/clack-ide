/**
 * LM11 T15: authoritative attributable-state comparator.
 *
 * The existing read-only BEFORE/AFTER inventories and the unchanged V3
 * credential fingerprints are consumed without ever emitting secret bytes,
 * target names, usernames, or unrelated Windows credential identities.
 * Historical global WinCred counts are retained as diagnostics only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const owner = fs.realpathSync.native(path.join(repo, 'src-tauri', 'target',
  'lm11-b01-b03-authenticated-webview-20261119', 'cases'));
const input = process.argv[2];
if (!input || process.argv.length !== 3)
  throw new Error('Expected only the existing exact T15 audit case directory');
const dir = fs.realpathSync.native(input);
if (path.dirname(dir).toLowerCase() !== owner.toLowerCase() ||
    !/^fidelity-audit-\d{17}-[a-f0-9]{12}$/.test(path.basename(dir)) ||
    fs.lstatSync(dir).isSymbolicLink())
  throw new Error('Refusing noncanonical T15 comparison directory');
const sha = data => createHash('sha256').update(data).digest('hex');
const artifacts = [];
function load(leaf) {
  if (!/^[a-z0-9-]+\.json$/.test(leaf)) throw new Error('Invalid T15 leaf');
  const filename = path.join(dir, leaf);
  const st = fs.lstatSync(filename);
  if (!st.isFile() || st.isSymbolicLink() ||
      fs.realpathSync.native(filename).toLowerCase() !== filename.toLowerCase())
    throw new Error('Redirected T15 evidence leaf');
  const bytes = fs.readFileSync(filename);
  artifacts.push({ file: leaf, sha256: sha(bytes), bytes: bytes.length });
  return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
}
const objects = load('production-comparison.json');
const metaBefore = load('credential-manager-before.json');
const metaAfter = load('credential-manager-after.json');
const previousMeta = load('credential-manager-comparison.json');
const v3Before = load('credential-secret-v3-before.json');
const v3After = load('credential-secret-v3-after.json');
const previousV3 = load('credential-secret-v3-comparison.json');
const entries = (rows, fields) => rows.map(row => fields
  .map(field => row[field]).join(':')).sort().join('|');
const scopedMetadataUnchanged = metaBefore.scopedTargetCount === 5 &&
  metaAfter.scopedTargetCount === 5 &&
  entries(metaBefore.entries, ['targetHash', 'metadataHash']) ===
  entries(metaAfter.entries, ['targetHash', 'metadataHash']);
const scopedV3SecretsUnchanged = v3Before.scopedCredentialCount === 5 &&
  v3After.scopedCredentialCount === 5 &&
  entries(v3Before.entries, ['targetHash', 'metadataHash', 'secretBlobHash']) ===
  entries(v3After.entries, ['targetHash', 'metadataHash', 'secretBlobHash']) &&
  previousV3.scopedCredentialBlobsUnchanged === true;
const productionObjectsUnchanged = objects.noninterferenceProven === true &&
  objects.beforeEntries === 9541 && objects.afterEntries === 9541 &&
  objects.changedCount === 0 && objects.beforeErrors === 0 &&
  objects.afterErrors === 0;
const report = {
  schema: 1, auditCaseId: path.basename(dir),
  question: 'Did LM11 acceptance mutate any Clack/Terax-owned production state or credential?',
  scopePolicy: 'Clack/Terax attributable production AppData, legacy AppData, registry, self-hosted settings, fabric registrations, model/runtime/deployment artifacts, exact scoped credential metadata and V3 secrets',
  productionObjectsUnchanged, beforeObjects:objects.beforeEntries,
  afterObjects:objects.afterEntries, scopeReadErrors:
    objects.beforeErrors + objects.afterErrors, changedScopedObjects:objects.changedCount,
  scopedCredentialMetadataUnchanged:scopedMetadataUnchanged,
  scopedCredentialsBefore:metaBefore.scopedTargetCount,
  scopedCredentialsAfter:metaAfter.scopedTargetCount,
  scopedV3SecretsUnchanged, scopedV3CountBefore:v3Before.scopedCredentialCount,
  scopedV3CountAfter:v3After.scopedCredentialCount,
  globalWincredBefore:metaBefore.allTargetCount,
  globalWincredAfter:metaAfter.allTargetCount,
  historicalMetadataComparatorResult:previousMeta.metadataUnchanged,
  globalWincredCountsDiagnosticOnly:true,
  historical46To44ForeignTargetIdentitiesAndAttribution:'unknown, never retained',
  noRawSecretOrUnscopedTargetSerialized:true,
  authoritativeT15Pass: productionObjectsUnchanged && scopedMetadataUnchanged &&
    scopedV3SecretsUnchanged,
  sources:artifacts,
};
const output = path.join(dir, 'scoped-t15-final-comparison.json');
const bytes = Buffer.from(JSON.stringify(report, null, 2) + '\n');
const fd = fs.openSync(output, 'wx', 0o600);
try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
console.log(JSON.stringify({
  caseId:report.auditCaseId,pass:report.authoritativeT15Pass,
  unchangedObjects:report.changedScopedObjects===0,secretCount:report.scopedV3CountAfter,
  globalCount:report.globalWincredAfter,sha256:sha(bytes),
},null,2));
if (!report.authoritativeT15Pass) process.exitCode=3;
