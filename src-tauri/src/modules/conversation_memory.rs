//! Session-owned derived records. Original messages remain in the existing store.
use super::attachments::{put_content_in, read_content_from, CONTENT_COLLECTION};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex, Weak};
use tauri::{Emitter, Manager};
use tauri_plugin_store::StoreExt;

const SCHEMA: u32 = 1;
const MAX_RECORD: usize = 256 * 1024;
const MAX_REVISIONS: usize = 32;
const MAX_SOURCES: usize = 128;
const SESSION_STORE: &str = "terax-ai-sessions.json";
static MEMORY_EPOCH: LazyLock<String> =
    LazyLock::new(|| format!("{}:{}", std::process::id(), now()));
mod session_file;

type Result<T> = std::result::Result<T, String>;

#[derive(Default, Clone)]
pub struct MemoryState {
    owners: Arc<Mutex<HashMap<String, Weak<Mutex<()>>>>>,
    metadata: Arc<Mutex<()>>,
    sessions: Arc<session_file::SessionFile>,
}

impl MemoryState {
    fn owner(&self, id: &str) -> Result<Arc<Mutex<()>>> {
        valid_id(id)?;
        let mut owners = self.owners.lock().map_err(|e| e.to_string())?;
        owners.retain(|_, value| value.strong_count() > 0);
        if let Some(owner) = owners.get(id).and_then(Weak::upgrade) {
            return Ok(owner);
        }
        let owner = Arc::new(Mutex::new(()));
        owners.insert(id.into(), Arc::downgrade(&owner));
        Ok(owner)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Owner {
    session_id: String,
    workspace_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceVersion {
    transcript_revision: u64,
    profile_revision: u64,
    transcript_hash: String,
    profile_hash: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SelectionEvent {
    sequence: u64,
    observed_at: u64,
    profile: Value,
    run: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    schema_version: u32,
    session_id: String,
    source: SourceVersion,
    generation: u64,
    #[serde(default)]
    revision: u64,
    events: Vec<SelectionEvent>,
    revisions: Vec<String>,
    deleted: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Preparation {
    runtime_id: String,
    owner: Owner,
    source: SourceVersion,
    generation: u64,
    previous: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum SourceLocator {
    Message {
        message_id: String,
    },
    Part {
        message_id: String,
        part_index: usize,
    },
    TaskResult {
        task_id: String,
    },
    Artifact {
        task_id: String,
        artifact_id: String,
    },
    Retained {
        revision_id: String,
        evidence_id: String,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Evidence {
    id: String,
    source_revision: u64,
    locator: SourceLocator,
    digest: String,
    content_ids: Vec<String>,
    related_sessions: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Claim {
    id: String,
    section: Section,
    status: ClaimStatus,
    text: String,
    sources: Vec<String>,
    observed_at: u64,
    contradicts: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
enum Section {
    Objective,
    Requirements,
    Constraints,
    Decisions,
    CompletedWork,
    ActiveTasks,
    FilesAndArtifacts,
    UnresolvedIssues,
    Errors,
    AgentFindings,
    ProjectState,
    Uncertainty,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
enum ClaimStatus {
    UserRequirement,
    VerifiedObservation,
    Inference,
    Unresolved,
    Superseded,
    Stale,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Coverage {
    start: usize,
    end: usize,
    digest: String,
    latest_message_id: String,
    source_message_count: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Revision {
    schema_version: u32,
    preparation: Preparation,
    revision: u64,
    created_at: u64,
    policy_version: String,
    producer: Value,
    coverage: Coverage,
    evidence: Vec<Evidence>,
    claims: Vec<Claim>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Candidate {
    preparation: Preparation,
    policy_version: String,
    start: usize,
    end: usize,
    sources: Vec<SourceLocator>,
    claims: Vec<Claim>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryView {
    preparation: Preparation,
    revision_id: Option<String>,
    revision: Option<Revision>,
    uncovered_messages: usize,
    source_changed: bool,
}

struct Originals {
    meta: Value,
    messages: Vec<Value>,
    tasks: Vec<Value>,
    session_ids: BTreeSet<String>,
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn hash(value: &(impl Serialize + ?Sized)) -> Result<String> {
    serde_json::to_vec(value)
        .map(|bytes| digest(&bytes))
        .map_err(|e| e.to_string())
}
fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn valid_id(value: &str) -> Result<()> {
    if value.is_empty() || value.len() > 256 || value.chars().any(char::is_control) {
        return Err("memory_invalid_identity".into());
    }
    Ok(())
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().ok_or("memory_invalid_path")?;
    fs::create_dir_all(parent).map_err(|e| format!("memory_storage_unavailable: {e}"))?;
    let mut staging = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    staging
        .write_all(bytes)
        .and_then(|_| staging.as_file().sync_all())
        .map_err(|e| format!("memory_write_failed: {e}"))?;
    staging
        .persist(path)
        .map_err(|e| format!("memory_commit_failed: {}", e.error))?;
    #[cfg(unix)]
    fs::File::open(parent)
        .and_then(|file| file.sync_all())
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn bounded_read(path: &Path) -> Result<Vec<u8>> {
    if fs::metadata(path)
        .map_err(|e| format!("memory_missing: {e}"))?
        .len()
        > MAX_RECORD as u64
    {
        return Err("memory_oversized".into());
    }
    fs::read(path).map_err(|e| format!("memory_unavailable: {e}"))
}

fn manifest_path(root: &Path, id: &str) -> PathBuf {
    root.join(digest(id.as_bytes())).join("manifest.json")
}

fn decode_manifest(path: &Path) -> Result<Manifest> {
    let bytes = bounded_read(path)?;
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|e| format!("memory_corrupt: {e}"))?;
    // Early source-only manifests predate the memory revision counter. Never
    // infer a counter for committed or interrupted immutable revision history.
    if value.get("revision").is_none() {
        if value["schemaVersion"].as_u64() != Some(SCHEMA.into()) {
            return Err("memory_unsupported_schema".into());
        }
        let empty = value["revisions"].as_array().is_some_and(Vec::is_empty);
        let parent = path.parent().ok_or("memory_invalid_path")?;
        let mut has_revision_files = false;
        for entry in fs::read_dir(parent).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry
                .file_name()
                .to_string_lossy()
                .strip_suffix(".json")
                .is_some_and(valid_hash)
            {
                has_revision_files = true;
                break;
            }
        }
        if !empty || has_revision_files {
            return Err("memory_corrupt: missing revision counter with revision history".into());
        }
    }
    serde_json::from_slice(&bytes).map_err(|e| format!("memory_corrupt: {e}"))
}

fn read_manifest(root: &Path, id: &str) -> Result<Option<Manifest>> {
    let path = manifest_path(root, id);
    if !path.try_exists().map_err(|e| e.to_string())? {
        return Ok(None);
    }
    let manifest = decode_manifest(&path)?;
    if manifest.schema_version != SCHEMA {
        return Err("memory_unsupported_schema".into());
    }
    if manifest.session_id != id
        || manifest.events.len() > 128
        || manifest.revisions.len() > MAX_REVISIONS
        || manifest.revisions.iter().any(|id| !valid_hash(id))
        || manifest.revisions.iter().collect::<BTreeSet<_>>().len() != manifest.revisions.len()
        || !valid_hash(&manifest.source.transcript_hash)
        || !valid_hash(&manifest.source.profile_hash)
        || manifest.generation > 9_007_199_254_740_000
        || manifest.revision > 9_007_199_254_740_000
        || manifest.source.transcript_revision > 9_007_199_254_740_000
        || manifest.source.profile_revision > 9_007_199_254_740_000
    {
        return Err("memory_corrupt_manifest".into());
    }
    Ok(Some(manifest))
}

fn write_manifest(root: &Path, manifest: &Manifest) -> Result<()> {
    let bytes = serde_json::to_vec(manifest).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_RECORD {
        return Err("memory_metadata_quota".into());
    }
    atomic_write(&manifest_path(root, &manifest.session_id), &bytes)
}

fn provenance(meta: &Value) -> Value {
    let mut result = serde_json::Map::new();
    for key in [
        "state",
        "agentId",
        "modelId",
        "workspaceId",
        "workspaceRoot",
        "checkoutId",
        "checkoutRoot",
        "providerId",
        "transportModelId",
        "customEndpointId",
        "peerTaskId",
        "startedAt",
        "endedAt",
    ] {
        if let Some(value) = meta["run"].get(key) {
            result.insert(key.into(), value.clone());
        }
    }
    if let Some(hosted) = meta["run"].get("selfHosted") {
        let mut route = serde_json::Map::new();
        for key in ["endpointId", "profileId", "configurationRevision"] {
            if let Some(value) = hosted.get(key) {
                route.insert(key.into(), value.clone());
            }
        }
        result.insert("selfHosted".into(), Value::Object(route));
    }
    Value::Object(result)
}

fn profile(meta: &Value) -> Value {
    let mut result = serde_json::Map::new();
    for key in ["agentId", "modelId", "workspaceId", "workspaceRoot"] {
        result.insert(key.into(), meta["profile"][key].clone());
    }
    Value::Object(result)
}

fn synchronize(root: &Path, originals: &Originals) -> Result<Manifest> {
    let id = originals.meta["id"]
        .as_str()
        .ok_or("memory_missing_session")?;
    valid_id(id)?;
    let transcript_hash = hash(&originals.messages)?;
    let profile_hash = hash(&json!([
        profile(&originals.meta),
        provenance(&originals.meta)
    ]))?;
    let previous = read_manifest(root, id)?;
    let mut manifest = previous.clone().unwrap_or_else(|| Manifest {
        schema_version: SCHEMA,
        session_id: id.into(),
        generation: 0,
        revision: 0,
        deleted: false,
        source: SourceVersion {
            transcript_revision: 0,
            profile_revision: 0,
            transcript_hash: String::new(),
            profile_hash: String::new(),
        },
        events: vec![],
        revisions: vec![],
    });
    if manifest.deleted {
        return Err("memory_session_deleted".into());
    }
    let changed = transcript_hash != manifest.source.transcript_hash
        || profile_hash != manifest.source.profile_hash;
    if transcript_hash != manifest.source.transcript_hash {
        manifest.source.transcript_revision += 1;
        manifest.source.transcript_hash = transcript_hash;
    }
    if profile_hash != manifest.source.profile_hash {
        manifest.source.profile_revision += 1;
        manifest.source.profile_hash = profile_hash;
        manifest.events.push(SelectionEvent {
            sequence: manifest.source.profile_revision,
            observed_at: now(),
            profile: profile(&originals.meta),
            run: provenance(&originals.meta),
        });
        if manifest.events.len() > 128 {
            manifest.events.remove(0);
        }
    }
    if changed {
        manifest.generation += 1;
        write_manifest(root, &manifest)?;
    }
    Ok(manifest)
}

fn preparation(manifest: &Manifest, owner: &Owner) -> Preparation {
    Preparation {
        runtime_id: MEMORY_EPOCH.clone(),
        owner: owner.clone(),
        source: manifest.source.clone(),
        generation: manifest.generation,
        previous: manifest.revisions.last().cloned(),
    }
}

fn check_owner(originals: &Originals, owner: &Owner) -> Result<()> {
    if originals.meta["id"].as_str() != Some(&owner.session_id)
        || originals.meta["profile"]["workspaceId"].as_str() != owner.workspace_id.as_deref()
    {
        return Err("memory_owner_mismatch".into());
    }
    let mut ids = BTreeSet::new();
    for message in &originals.messages {
        let id = message["id"]
            .as_str()
            .ok_or("memory_missing_message_identity")?;
        valid_id(id)?;
        if !ids.insert(id) {
            return Err("memory_duplicate_message_identity".into());
        }
    }
    Ok(())
}

fn source_value(
    originals: &Originals,
    owner: &Owner,
    locator: &SourceLocator,
) -> Result<(Value, Vec<String>)> {
    match locator {
        SourceLocator::Message { message_id } | SourceLocator::Part { message_id, .. } => {
            let message = originals
                .messages
                .iter()
                .find(|m| m["id"].as_str() == Some(message_id))
                .ok_or("memory_missing_message")?;
            let value = match locator {
                SourceLocator::Part { part_index, .. } => message["parts"]
                    .as_array()
                    .and_then(|parts| parts.get(*part_index))
                    .ok_or("memory_missing_part")?,
                _ => message,
            };
            Ok((value.clone(), vec![owner.session_id.clone()]))
        }
        SourceLocator::TaskResult { task_id } | SourceLocator::Artifact { task_id, .. } => {
            let task = originals
                .tasks
                .iter()
                .find(|task| task["id"].as_str() == Some(task_id))
                .ok_or("memory_missing_task")?;
            let source = task["sourceSessionId"]
                .as_str()
                .ok_or("memory_invalid_task")?;
            let target = task["targetSessionId"]
                .as_str()
                .ok_or("memory_invalid_task")?;
            if (source != owner.session_id && target != owner.session_id)
                || task["workspaceId"].as_str() != owner.workspace_id.as_deref()
                || !originals.session_ids.contains(source)
                || !originals.session_ids.contains(target)
            {
                return Err("memory_unauthorized_task".into());
            }
            let value = match locator {
                SourceLocator::TaskResult { .. } => task
                    .get("result")
                    .filter(|v| v.is_object())
                    .ok_or("memory_missing_result")?,
                SourceLocator::Artifact { artifact_id, .. } => task["artifactRefs"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .chain(task["result"]["artifacts"].as_array().into_iter().flatten())
                    .find(|artifact| artifact["id"].as_str() == Some(artifact_id))
                    .ok_or("memory_missing_artifact")?,
                _ => unreachable!(),
            };
            let artifacts = match locator {
                SourceLocator::Artifact { .. } => vec![value],
                _ => {
                    if value["targetSessionId"].as_str() != Some(target) {
                        return Err("memory_invalid_task_result".into());
                    }
                    value["artifacts"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .collect()
                }
            };
            for artifact in artifacts {
                if artifact["workspaceId"].as_str() != owner.workspace_id.as_deref()
                    || !matches!(artifact["sourceSessionId"].as_str(), Some(id) if id == source || id == target)
                {
                    return Err("memory_unauthorized_artifact".into());
                }
            }
            Ok((value.clone(), vec![source.into(), target.into()]))
        }
        SourceLocator::Retained { .. } => Err("memory_retained_source_requires_revision".into()),
    }
}

fn content_refs(value: &Value, refs: &mut BTreeSet<String>) -> Result<()> {
    match value {
        Value::Object(object) => {
            if let Some(hash) = object.get("contentHash") {
                let hash = hash
                    .as_str()
                    .filter(|v| valid_hash(v))
                    .ok_or("memory_invalid_content_ref")?;
                let id = object
                    .get("contentId")
                    .or_else(|| object.get("id"))
                    .and_then(Value::as_str);
                if id != Some(hash) {
                    return Err("memory_content_identity_mismatch".into());
                }
                refs.insert(hash.into());
            }
            for (key, value) in object {
                if matches!(key.as_str(), "archiveContentId" | "originalContentId") {
                    let id = value
                        .as_str()
                        .filter(|v| valid_hash(v))
                        .ok_or("memory_invalid_content_ref")?;
                    let hash_key = if key == "archiveContentId" {
                        "archiveContentHash"
                    } else {
                        "originalContentHash"
                    };
                    if object.get(hash_key).and_then(Value::as_str) != Some(id) {
                        return Err("memory_content_identity_mismatch".into());
                    }
                    refs.insert(id.into());
                }
                content_refs(value, refs)?;
            }
        }
        Value::Array(values) => {
            for value in values {
                content_refs(value, refs)?;
            }
        }
        Value::String(text) if text.starts_with("data:") && text.contains(";base64,") => {
            return Err("memory_inline_binary_not_allowed".into())
        }
        _ => {}
    }
    Ok(())
}

fn validate_content_sizes(value: &Value, content: &Path) -> Result<()> {
    match value {
        Value::Object(object) => {
            if let Some(hash) = object.get("contentHash").and_then(Value::as_str) {
                let size = object
                    .get("byteSize")
                    .and_then(Value::as_u64)
                    .ok_or("memory_invalid_content_size")?;
                if read_content_from(content, hash)?.len() as u64 != size {
                    return Err("memory_content_size_mismatch".into());
                }
            }
            for value in object.values() {
                validate_content_sizes(value, content)?;
            }
        }
        Value::Array(values) => {
            for value in values {
                validate_content_sizes(value, content)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn validate_claims(claims: &[Claim], evidence: &[Evidence]) -> Result<()> {
    if claims.len() > 64 || evidence.is_empty() || evidence.len() > MAX_SOURCES {
        return Err("memory_metadata_quota".into());
    }
    let mut ids = BTreeSet::new();
    for claim in claims {
        valid_id(&claim.id)?;
        if !ids.insert(&claim.id)
            || claim.text.trim().is_empty()
            || claim.text.len() > 8192
            || claim.sources.is_empty()
            || claim.sources.len() > 32
            || claim.contradicts.len() > 32
            || claim
                .sources
                .iter()
                .any(|id| !evidence.iter().any(|source| &source.id == id))
        {
            return Err("memory_invalid_claim".into());
        }
    }
    for claim in claims {
        if claim
            .contradicts
            .iter()
            .any(|id| id == &claim.id || !ids.contains(id))
        {
            return Err("memory_invalid_contradiction".into());
        }
    }
    Ok(())
}

fn read_revision(root: &Path, session_id: &str, id: &str) -> Result<Revision> {
    if !valid_hash(id) {
        return Err("memory_invalid_revision_id".into());
    }
    let bytes =
        bounded_read(&manifest_path(root, session_id).with_file_name(format!("{id}.json")))?;
    if digest(&bytes) != id {
        return Err("memory_integrity_failed".into());
    }
    let revision: Revision =
        serde_json::from_slice(&bytes).map_err(|e| format!("memory_corrupt: {e}"))?;
    if revision.schema_version != SCHEMA {
        return Err("memory_unsupported_schema".into());
    }
    if revision.preparation.owner.session_id != session_id
        || revision.revision == 0
        || revision.created_at == 0
        || revision.policy_version.is_empty()
        || revision.policy_version.len() > 128
        || !valid_hash(&revision.coverage.digest)
        || !valid_hash(&revision.preparation.source.transcript_hash)
        || !valid_hash(&revision.preparation.source.profile_hash)
        || revision.coverage.start >= revision.coverage.end
        || revision.coverage.end > revision.coverage.source_message_count
        || revision.evidence.iter().any(|evidence| {
            evidence.source_revision == 0
                || !valid_hash(&evidence.id)
                || !valid_hash(&evidence.digest)
                || evidence.related_sessions.is_empty()
                || evidence.related_sessions.len() > 16
                || evidence.content_ids.iter().any(|id| !valid_hash(id))
        })
    {
        return Err("memory_invalid_revision".into());
    }
    validate_claims(&revision.claims, &revision.evidence)?;
    Ok(revision)
}

fn verify_evidence(
    root: &Path,
    content: &Path,
    evidence: &[Evidence],
    originals: &Originals,
) -> Result<()> {
    let mut locators = BTreeSet::new();
    for source in evidence {
        if !locators.insert((&source.locator, &source.digest))
            || source
                .related_sessions
                .iter()
                .any(|id| !originals.session_ids.contains(id))
        {
            return Err("memory_source_revoked".into());
        }
        for id in &source.related_sessions {
            if read_manifest(root, id)?.is_some_and(|manifest| manifest.deleted) {
                return Err("memory_source_revoked".into());
            }
        }
        let bytes = read_content_from(content, &source.digest)?;
        if source.id
            != hash(&json!([
                originals.meta["id"],
                source.locator,
                source.digest
            ]))?
        {
            return Err("memory_invalid_source_identity".into());
        }
        let value: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        validate_content_sizes(&value, content)?;
        let mut refs = BTreeSet::new();
        content_refs(&value, &mut refs)?;
        if refs.into_iter().collect::<Vec<_>>() != source.content_ids {
            return Err("memory_invalid_retention_roots".into());
        }
        for id in &source.content_ids {
            read_content_from(content, id)?;
        }
    }
    Ok(())
}

fn evidence_for(
    root: &Path,
    content: &Path,
    originals: &Originals,
    owner: &Owner,
    locator: SourceLocator,
) -> Result<(Evidence, Vec<u8>)> {
    if let SourceLocator::Retained {
        revision_id,
        evidence_id,
    } = &locator
    {
        let manifest = read_manifest(root, &owner.session_id)?.ok_or("memory_missing_manifest")?;
        if !manifest.revisions.contains(revision_id) {
            return Err("memory_uncommitted_source".into());
        }
        let revision = read_revision(root, &owner.session_id, revision_id)?;
        if revision.preparation.owner != *owner {
            return Err("memory_owner_mismatch".into());
        }
        let source = revision
            .evidence
            .into_iter()
            .find(|e| e.id == *evidence_id)
            .ok_or("memory_missing_evidence")?;
        verify_evidence(root, content, std::slice::from_ref(&source), originals)?;
        let bytes = read_content_from(content, &source.digest)?;
        return Ok((source, bytes));
    }
    let (value, related_sessions) = source_value(originals, owner, &locator)?;
    for id in &related_sessions {
        if read_manifest(root, id)?.is_some_and(|manifest| manifest.deleted) {
            return Err("memory_source_revoked".into());
        }
    }
    validate_content_sizes(&value, content)?;
    let mut refs = BTreeSet::new();
    content_refs(&value, &mut refs)?;
    for id in &refs {
        read_content_from(content, id)?;
    }
    let bytes = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_RECORD {
        return Err("memory_evidence_quota".into());
    }
    let digest = digest(&bytes);
    let id = hash(&json!([owner.session_id, locator, digest]))?;
    Ok((
        Evidence {
            id,
            source_revision: read_manifest(root, &owner.session_id)?
                .ok_or("memory_missing_manifest")?
                .source
                .transcript_revision,
            locator,
            digest,
            content_ids: refs.into_iter().collect(),
            related_sessions,
        },
        bytes,
    ))
}

fn commit(
    root: &Path,
    content: &Path,
    originals: &Originals,
    candidate: Candidate,
    fault: impl Fn(&str) -> Result<()>,
) -> Result<String> {
    if serde_json::to_vec(&candidate)
        .map_err(|e| e.to_string())?
        .len()
        > MAX_RECORD
    {
        return Err("memory_metadata_quota".into());
    }
    check_owner(originals, &candidate.preparation.owner)?;
    let mut manifest = synchronize(root, originals)?;
    if preparation(&manifest, &candidate.preparation.owner) != candidate.preparation {
        return Err("memory_stale_preparation".into());
    }
    if let Some(previous) = manifest.revisions.last() {
        read_revision(root, &manifest.session_id, previous)?;
    }
    if candidate.start >= candidate.end
        || candidate.end > originals.messages.len()
        || candidate.policy_version.is_empty()
        || candidate.policy_version.len() > 128
        || candidate.sources.is_empty()
        || candidate.sources.len() > MAX_SOURCES
    {
        return Err("memory_invalid_candidate".into());
    }
    let mut evidence = vec![];
    let sources: BTreeSet<_> = candidate.sources.into_iter().collect();
    for locator in sources {
        let (source, bytes) = evidence_for(
            root,
            content,
            originals,
            &candidate.preparation.owner,
            locator,
        )?;
        if evidence.iter().any(|e: &Evidence| e.id == source.id) {
            continue;
        }
        fault("before-evidence")?;
        put_content_in(content, &bytes)?;
        fault("after-evidence")?;
        evidence.push(source);
    }
    validate_claims(&candidate.claims, &evidence)?;
    let revision = Revision {
        schema_version: SCHEMA,
        revision: manifest.revision + 1,
        created_at: now(),
        producer: json!({"selection":profile(&originals.meta),"run":provenance(&originals.meta)}),
        policy_version: candidate.policy_version,
        coverage: Coverage {
            start: candidate.start,
            end: candidate.end,
            digest: hash(&originals.messages[candidate.start..candidate.end])?,
            latest_message_id: originals.messages[candidate.end - 1]["id"]
                .as_str()
                .ok_or("memory_missing_message_identity")?
                .into(),
            source_message_count: originals.messages.len(),
        },
        preparation: candidate.preparation,
        evidence,
        claims: candidate.claims,
    };
    let bytes = serde_json::to_vec(&revision).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_RECORD {
        return Err("memory_metadata_quota".into());
    }
    let id = digest(&bytes);
    fault("before-revision")?;
    atomic_write(
        &manifest_path(root, &manifest.session_id).with_file_name(format!("{id}.json")),
        &bytes,
    )?;
    fault("after-revision")?;
    manifest.revisions.push(id.clone());
    manifest.revision += 1;
    if manifest.revisions.len() > MAX_REVISIONS {
        manifest.revisions.remove(0);
    }
    manifest.generation += 1;
    fault("before-manifest")?;
    write_manifest(root, &manifest)?;
    fault("after-manifest")?;
    Ok(id)
}

fn load(root: &Path, content: &Path, originals: &Originals, owner: &Owner) -> Result<MemoryView> {
    check_owner(originals, owner)?;
    let manifest = synchronize(root, originals)?;
    let revision_id = manifest.revisions.last().cloned();
    let revision = revision_id
        .as_ref()
        .map(|id| read_revision(root, &owner.session_id, id))
        .transpose()?;
    let mut uncovered_messages = originals.messages.len();
    let mut source_changed = false;
    if let Some(revision) = &revision {
        if revision.preparation.owner != *owner
            || revision.revision != manifest.revision
            || revision.preparation.previous != manifest.revisions.iter().rev().nth(1).cloned()
        {
            return Err("memory_invalid_lineage".into());
        }
        verify_evidence(root, content, &revision.evidence, originals)?;
        let coverage = &revision.coverage;
        source_changed = coverage.end > originals.messages.len()
            || hash(&originals.messages[coverage.start..coverage.end])? != coverage.digest;
        if !source_changed {
            uncovered_messages -= coverage.end - coverage.start;
        }
    }
    Ok(MemoryView {
        preparation: preparation(&manifest, owner),
        revision_id,
        revision,
        uncovered_messages,
        source_changed,
    })
}

fn paths(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf)> {
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok((
        root.join("ai-conversation-memory"),
        root.join("ai-attachments"),
    ))
}

fn originals(app: &tauri::AppHandle, id: &str) -> Result<Originals> {
    let state = app.state::<MemoryState>();
    let path = session_path(app)?;
    let sessions = state.sessions.get(&path, "sessions")?.unwrap_or(json!([]));
    let sessions = sessions.as_array().ok_or("memory_invalid_sessions")?;
    if sessions
        .iter()
        .filter(|meta| meta["id"].as_str() == Some(id))
        .count()
        != 1
    {
        return Err("memory_missing_or_duplicate_session".into());
    }
    let meta = sessions
        .iter()
        .find(|meta| meta["id"].as_str() == Some(id))
        .ok_or("memory_missing_session")?
        .clone();
    let messages = state
        .sessions
        .get(&path, &format!("messages:{id}"))?
        .unwrap_or(json!([]));
    let messages = messages
        .as_array()
        .ok_or("memory_invalid_messages")?
        .clone();
    Ok(Originals {
        meta,
        messages,
        tasks: vec![],
        session_ids: sessions
            .iter()
            .filter_map(|meta| meta["id"].as_str().map(String::from))
            .collect(),
    })
}

fn load_tasks(app: &tauri::AppHandle, originals: &mut Originals) -> Result<()> {
    let peers = app
        .store("clack-ai-peer-tasks.json")
        .map_err(|e| e.to_string())?;
    let tasks = peers.get("tasks").unwrap_or(json!([]));
    originals.tasks = tasks.as_array().ok_or("memory_invalid_tasks")?.clone();
    Ok(())
}

fn authorize(app: &tauri::AppHandle, originals: &Originals, owner: &Owner) -> Result<()> {
    check_owner(originals, owner)?;
    if let Some(workspace_id) = &owner.workspace_id {
        let root = originals.meta["profile"]["workspaceRoot"]
            .as_str()
            .ok_or("memory_missing_workspace")?;
        let environment = if workspace_id.starts_with("local:") {
            super::workspace::WorkspaceEnv::Local
        } else if let Some(rest) = workspace_id.strip_prefix("wsl:") {
            let (distro, _) = rest.split_once(':').ok_or("memory_invalid_workspace")?;
            super::workspace::WorkspaceEnv::Wsl {
                distro: distro.into(),
            }
        } else {
            return Err("memory_invalid_workspace".into());
        };
        super::workspace::authorize_spawn_cwd(
            &app.state::<super::workspace::WorkspaceRegistry>(),
            Some(root),
            &environment,
        )?;
    }
    Ok(())
}

fn require_durable_source(path: &Path, originals: &Originals) -> Result<()> {
    let disk: Value = serde_json::from_slice(
        &fs::read(path).map_err(|e| format!("memory_source_not_durable: {e}"))?,
    )
    .map_err(|e| format!("memory_source_not_durable: {e}"))?;
    let id = originals.meta["id"]
        .as_str()
        .ok_or("memory_missing_session")?;
    let meta = disk["sessions"]
        .as_array()
        .and_then(|sessions| sessions.iter().find(|meta| meta["id"].as_str() == Some(id)))
        .ok_or("memory_source_not_durable")?;
    if meta["profile"] != originals.meta["profile"]
        || provenance(meta) != provenance(&originals.meta)
        || disk[format!("messages:{id}")] != Value::Array(originals.messages.clone())
    {
        return Err("memory_source_not_durable".into());
    }
    Ok(())
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}

fn session_path(app: &tauri::AppHandle) -> Result<PathBuf> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(SESSION_STORE))
}

#[tauri::command]
pub async fn conversation_session_entries(app: tauri::AppHandle) -> Result<Vec<(String, Value)>> {
    blocking(move || {
        app.state::<MemoryState>()
            .sessions
            .entries(&session_path(&app)?)
    })
    .await
}

#[tauri::command]
pub async fn conversation_session_get(app: tauri::AppHandle, key: String) -> Result<Option<Value>> {
    blocking(move || {
        app.state::<MemoryState>()
            .sessions
            .get(&session_path(&app)?, &key)
    })
    .await
}

#[tauri::command]
pub async fn conversation_session_active(app: tauri::AppHandle, id: Option<String>) -> Result<()> {
    blocking(move || {
        if let Some(id) = &id {
            valid_id(id)?;
        }
        app.state::<MemoryState>()
            .sessions
            .set(&session_path(&app)?, "activeId", Some(json!(id)))
    })
    .await
}

#[tauri::command]
pub async fn conversation_memory_sources(
    app: tauri::AppHandle,
    state: tauri::State<'_, MemoryState>,
    preparation: Preparation,
    sources: Vec<SourceLocator>,
) -> Result<Vec<Evidence>> {
    let state = state.inner().clone();
    blocking(move || {
        if sources.len() > MAX_SOURCES {
            return Err("memory_metadata_quota".into());
        }
        let lock = state.owner(&preparation.owner.session_id)?;
        let _owner = lock.lock().map_err(|e| e.to_string())?;
        let mut originals = originals(&app, &preparation.owner.session_id)?;
        load_tasks(&app, &mut originals)?;
        authorize(&app, &originals, &preparation.owner)?;
        let (root, content) = paths(&app)?;
        let manifest = synchronize(&root, &originals)?;
        if preparation.runtime_id != *MEMORY_EPOCH
            || manifest.source != preparation.source
            || manifest.generation != preparation.generation
        {
            return Err("memory_stale_preparation".into());
        }
        sources
            .into_iter()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .map(|locator| {
                evidence_for(&root, &content, &originals, &preparation.owner, locator)
                    .map(|(evidence, _)| evidence)
            })
            .collect()
    })
    .await
}

#[tauri::command]
pub async fn conversation_memory_evidence(
    app: tauri::AppHandle,
    state: tauri::State<'_, MemoryState>,
    owner: Owner,
    revision_id: String,
    evidence_id: String,
) -> Result<Value> {
    let state = state.inner().clone();
    blocking(move || {
        let lock = state.owner(&owner.session_id)?;
        let _owner = lock.lock().map_err(|e| e.to_string())?;
        let originals = originals(&app, &owner.session_id)?;
        authorize(&app, &originals, &owner)?;
        let (root, content) = paths(&app)?;
        let (_, bytes) = evidence_for(
            &root,
            &content,
            &originals,
            &owner,
            SourceLocator::Retained {
                revision_id,
                evidence_id,
            },
        )?;
        serde_json::from_slice(&bytes).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn conversation_memory_load(
    app: tauri::AppHandle,
    state: tauri::State<'_, MemoryState>,
    owner: Owner,
) -> Result<MemoryView> {
    let state = state.inner().clone();
    blocking(move || {
        let lock = state.owner(&owner.session_id)?;
        let _owner = lock.lock().map_err(|e| e.to_string())?;
        let originals = originals(&app, &owner.session_id)?;
        authorize(&app, &originals, &owner)?;
        let (root, content) = paths(&app)?;
        load(&root, &content, &originals, &owner)
    })
    .await
}

#[tauri::command]
pub async fn conversation_memory_commit(
    app: tauri::AppHandle,
    state: tauri::State<'_, MemoryState>,
    candidate: Candidate,
) -> Result<String> {
    let state = state.inner().clone();
    blocking(move || {
        let lock = state.owner(&candidate.preparation.owner.session_id)?;
        let _owner = lock.lock().map_err(|e| e.to_string())?;
        let _collection = CONTENT_COLLECTION.read().map_err(|e| e.to_string())?;
        let mut originals = originals(&app, &candidate.preparation.owner.session_id)?;
        load_tasks(&app, &mut originals)?;
        authorize(&app, &originals, &candidate.preparation.owner)?;
        require_durable_source(
            &app.path()
                .app_data_dir()
                .map_err(|e| e.to_string())?
                .join(SESSION_STORE),
            &originals,
        )?;
        let (root, content) = paths(&app)?;
        let id = commit(&root, &content, &originals, candidate, |_| Ok(()))?;
        let _ = app.emit("clack:conversation-memory", &originals.meta["id"]);
        Ok(id)
    })
    .await
}

#[tauri::command]
pub async fn conversation_memory_cancel(
    app: tauri::AppHandle,
    state: tauri::State<'_, MemoryState>,
    preparation: Preparation,
) -> Result<()> {
    let state = state.inner().clone();
    blocking(move || {
        let owner = &preparation.owner;
        let lock = state.owner(&owner.session_id)?;
        let _owner = lock.lock().map_err(|e| e.to_string())?;
        let originals = originals(&app, &owner.session_id)?;
        authorize(&app, &originals, owner)?;
        let (root, _) = paths(&app)?;
        let mut manifest = synchronize(&root, &originals)?;
        if preparation.runtime_id != *MEMORY_EPOCH || manifest.generation != preparation.generation
        {
            return Ok(());
        }
        manifest.generation += 1;
        write_manifest(&root, &manifest)?;
        let _ = app.emit("clack:conversation-memory", &owner.session_id);
        Ok(())
    })
    .await
}

// Session writes share owner locks with memory publication. No memory command
// writes the original transcript; legacy readers keep their existing layout.
#[tauri::command]
pub async fn conversation_source_set(
    app: tauri::AppHandle,
    state: tauri::State<'_, MemoryState>,
    key: String,
    value: Value,
) -> Result<()> {
    let state = state.inner().clone();
    blocking(move || {
        let _metadata = if key == "sessions" {
            Some(state.metadata.lock().map_err(|e| e.to_string())?)
        } else {
            None
        };
        let path = session_path(&app)?;
        let ids: BTreeSet<String> = if key == "sessions" {
            let old = state.sessions.get(&path, "sessions")?.unwrap_or(json!([]));
            let old = old.as_array().ok_or("memory_invalid_sessions")?;
            let next = value.as_array().ok_or("memory_invalid_sessions")?;
            old.iter()
                .chain(next)
                .filter(|meta| !old.contains(meta) || !next.contains(meta))
                .map(|meta| {
                    meta["id"]
                        .as_str()
                        .map(String::from)
                        .ok_or("memory_invalid_session")
                })
                .collect::<std::result::Result<_, _>>()?
        } else if let Some(id) = key.strip_prefix("messages:") {
            BTreeSet::from([id.into()])
        } else {
            return Err("memory_invalid_session_key".into());
        };
        let locks = ids
            .iter()
            .map(|id| state.owner(id))
            .collect::<Result<Vec<_>>>()?;
        let _guards = locks
            .iter()
            .map(|lock| lock.lock().map_err(|e| e.to_string()))
            .collect::<Result<Vec<_>>>()?;
        let _collection = CONTENT_COLLECTION.read().map_err(|e| e.to_string())?;
        let (root, _) = paths(&app)?;
        for id in &ids {
            if read_manifest(&root, id)
                .ok()
                .flatten()
                .is_some_and(|manifest| manifest.deleted)
                && (key != "sessions"
                    || value.as_array().is_some_and(|sessions| {
                        sessions.iter().any(|meta| meta["id"].as_str() == Some(id))
                    }))
            {
                return Err("memory_session_deleted".into());
            }
        }
        state.sessions.set(&path, &key, Some(value))?;
        for id in ids {
            if let Ok(originals) = originals(&app, &id) {
                // A damaged derived store must not block saving the original chat.
                if let Err(error) = synchronize(&root, &originals) {
                    log::warn!("Conversation memory unavailable: {error}");
                }
                let _ = app.emit("clack:conversation-memory", &id);
            }
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn conversation_source_delete(
    app: tauri::AppHandle,
    state: tauri::State<'_, MemoryState>,
    session_id: String,
) -> Result<()> {
    let state = state.inner().clone();
    blocking(move || {
        let lock = state.owner(&session_id)?;
        let _owner = lock.lock().map_err(|e| e.to_string())?;
        let _collection = CONTENT_COLLECTION.write().map_err(|e| e.to_string())?;
        let (root, _) = paths(&app)?;
        tombstone(&root, &session_id)?;
        state.sessions.set(
            &session_path(&app)?,
            &format!("messages:{session_id}"),
            None,
        )?;
        let _ = app.emit("clack:conversation-memory", &session_id);
        Ok(())
    })
    .await
}

fn tombstone(root: &Path, session_id: &str) -> Result<()> {
    write_manifest(
        root,
        &Manifest {
            schema_version: SCHEMA,
            session_id: session_id.into(),
            deleted: true,
            source: SourceVersion {
                transcript_revision: 0,
                profile_revision: 0,
                transcript_hash: digest(b""),
                profile_hash: digest(b""),
            },
            generation: 0,
            revision: 0,
            events: vec![],
            revisions: vec![],
        },
    )
}

fn collect_roots(root: &Path, live_sessions: &BTreeSet<String>) -> Result<Vec<String>> {
    if !root.exists() {
        return Ok(vec![]);
    }
    let mut ids = BTreeSet::new();
    for directory in fs::read_dir(root).map_err(|e| e.to_string())? {
        let directory = directory.map_err(|e| e.to_string())?;
        if !directory.file_type().map_err(|e| e.to_string())?.is_dir() {
            continue;
        }
        let path = directory.path().join("manifest.json");
        if !path.exists() {
            continue;
        }
        let raw = decode_manifest(&path)?;
        let manifest = read_manifest(root, &raw.session_id)?.ok_or("memory_gc_missing_manifest")?;
        if directory.file_name().to_string_lossy() != digest(manifest.session_id.as_bytes()) {
            return Err("memory_gc_invalid_owner".into());
        }
        let mut committed = BTreeSet::new();
        for revision_id in &manifest.revisions {
            committed.insert(format!("{revision_id}.json"));
            let revision = read_revision(root, &manifest.session_id, revision_id)?;
            if manifest.deleted
                || !live_sessions.contains(&manifest.session_id)
                || revision
                    .evidence
                    .iter()
                    .flat_map(|e| &e.related_sessions)
                    .any(|id| !live_sessions.contains(id))
            {
                continue;
            }
            for evidence in revision.evidence {
                ids.insert(evidence.digest);
                ids.extend(evidence.content_ids);
            }
        }
        // Only immutable revision files are collected here. Manifest staging
        // files may belong to an unrelated ongoing source update.
        for file in fs::read_dir(directory.path()).map_err(|e| e.to_string())? {
            let file = file.map_err(|e| e.to_string())?;
            let name = file.file_name().to_string_lossy().to_string();
            if name.strip_suffix(".json").is_some_and(valid_hash) && !committed.contains(&name) {
                fs::remove_file(file.path()).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(ids.into_iter().collect())
}

pub(crate) fn retention_roots(app: &tauri::AppHandle) -> Result<Vec<String>> {
    let (root, _) = paths(app)?;
    let sessions = app
        .state::<MemoryState>()
        .sessions
        .get(&session_path(app)?, "sessions")?
        .unwrap_or(json!([]));
    let mut live_sessions: BTreeSet<String> = sessions
        .as_array()
        .ok_or("memory_invalid_sessions")?
        .iter()
        .filter_map(|meta| meta["id"].as_str().map(String::from))
        .collect();
    let mut deleted = vec![];
    for id in &live_sessions {
        if read_manifest(&root, id)?.is_some_and(|manifest| manifest.deleted) {
            deleted.push(id.clone());
        }
    }
    for id in deleted {
        live_sessions.remove(&id);
    }
    let mut retained: BTreeSet<String> =
        collect_roots(&root, &live_sessions)?.into_iter().collect();
    // A caller's frontend snapshot may predate another window's completed save.
    for (key, value) in app
        .state::<MemoryState>()
        .sessions
        .entries(&session_path(app)?)?
    {
        if key.starts_with("messages:") {
            persisted_content_refs(&value, &mut retained);
        }
    }
    let peers = app
        .store("clack-ai-peer-tasks.json")
        .map_err(|e| e.to_string())?;
    if let Some(tasks) = peers.get("tasks") {
        persisted_content_refs(&tasks, &mut retained);
    }
    Ok(retained.into_iter().collect())
}

fn persisted_content_refs(value: &Value, retained: &mut BTreeSet<String>) {
    match value {
        Value::Object(object) => {
            for (key, value) in object {
                if matches!(
                    key.as_str(),
                    "contentId" | "contentHash" | "archiveContentId" | "originalContentId"
                ) {
                    if let Some(id) = value.as_str().filter(|id| valid_hash(id)) {
                        retained.insert(id.into());
                    }
                }
                persisted_content_refs(value, retained);
            }
        }
        Value::Array(values) => {
            for value in values {
                persisted_content_refs(value, retained);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests;
