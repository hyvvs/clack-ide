//! Private derived projections share C1 ownership, atomic manifests and content roots.
use super::*;
use crate::modules::workspace::WorkspaceRegistry;

const VERSION: u32 = 1;
const MAX_WRITES: usize = 64;
const MAX_ENTRIES: usize = 32;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ObservedWrite {
    tool_call_id: String,
    path: String,
    canonical: String,
    digest: String,
    input_hash: String,
    run_id: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Entry {
    tool_call_id: String,
    path: String,
    canonical: String,
    result_digest: String,
    input_hash: String,
    output_hash: String,
    source: String,
    order: usize,
    latest_tool_call_id: String,
    latest_digest: String,
    latest_input_hash: String,
    latest_output_hash: String,
    latest_order: usize,
    base: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    version: u32,
    revision: String,
    owner: Owner,
    source: SourceVersion,
    entries: Vec<Entry>,
    evidence: Vec<Evidence>,
    message_count: usize,
    prefix_hash: String,
    tail_parts: usize,
    tail_hash: String,
    tail_header: String,
}
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct State {
    version: u32,
    writes: Vec<ObservedWrite>,
    current: Option<Snapshot>,
    previous: Option<Snapshot>,
}
fn state(manifest: &Manifest) -> Result<State> {
    let Some(value) = &manifest.checkpoint_state else {
        return Ok(State {
            version: VERSION,
            ..Default::default()
        });
    };
    let state: State = serde_json::from_value(value.clone()).map_err(|_| "checkpoint_corrupt")?;
    if state.version != VERSION
        || state.writes.len() > MAX_WRITES
        || state.writes.iter().any(|w| {
            !valid_hash(&w.digest)
                || !valid_hash(&w.input_hash)
                || valid_id(&w.tool_call_id).is_err()
                || w.path.is_empty()
                || w.path.len() > 4096
                || w.canonical.is_empty()
                || w.canonical.len() > 4096
                || w.run_id == 0
        })
        || state
            .writes
            .iter()
            .map(|w| &w.tool_call_id)
            .collect::<BTreeSet<_>>()
            .len()
            != state.writes.len()
    {
        return Err("checkpoint_invalid_state".into());
    }
    for snapshot in [&state.current, &state.previous].into_iter().flatten() {
        validate(snapshot)?;
    }
    Ok(state)
}
fn identity(snapshot: &Snapshot) -> Result<String> {
    hash(&json!([
        snapshot.version,
        snapshot.owner,
        snapshot.source,
        snapshot.entries,
        snapshot.evidence,
        snapshot.message_count,
        snapshot.prefix_hash,
        snapshot.tail_parts,
        snapshot.tail_hash,
        snapshot.tail_header
    ]))
}
fn validate(snapshot: &Snapshot) -> Result<()> {
    if snapshot.version != VERSION
        || valid_id(&snapshot.owner.session_id).is_err()
        || snapshot.owner.workspace_id.is_none()
        || !valid_hash(&snapshot.source.transcript_hash)
        || !valid_hash(&snapshot.source.profile_hash)
        || snapshot.entries.is_empty()
        || snapshot.entries.len() > MAX_ENTRIES
        || snapshot.message_count == 0
        || !valid_hash(&snapshot.prefix_hash)
        || !valid_hash(&snapshot.tail_hash)
        || !valid_hash(&snapshot.tail_header)
        || snapshot.evidence.len() > MAX_SOURCES
        || snapshot
            .evidence
            .iter()
            .map(|e| &e.id)
            .collect::<BTreeSet<_>>()
            .len()
            != snapshot.evidence.len()
        || snapshot.evidence.iter().any(|e| {
            !valid_hash(&e.id)
                || !valid_hash(&e.digest)
                || e.source_revision == 0
                || e.related_sessions != [snapshot.owner.session_id.clone()]
                || e.content_ids.iter().any(|id| !valid_hash(id))
                || !matches!(
                    e.locator,
                    SourceLocator::Message { .. } | SourceLocator::Part { .. }
                )
        })
        || snapshot.revision != identity(snapshot)?
        || snapshot
            .entries
            .iter()
            .map(|e| &e.tool_call_id)
            .collect::<BTreeSet<_>>()
            .len()
            != snapshot.entries.len()
        || snapshot.entries.iter().any(|e| {
            valid_id(&e.tool_call_id).is_err()
                || valid_id(&e.latest_tool_call_id).is_err()
                || e.path.is_empty()
                || e.path.len() > 4096
                || e.path.starts_with(['/', '\\'])
                || e.path.contains([':', '\\'])
                || e.path
                    .split('/')
                    .any(|p| p.is_empty() || p == "." || p == "..")
                || e.path.chars().any(char::is_control)
                || e.canonical.is_empty()
                || e.canonical.len() > 4096
                || !valid_hash(&e.result_digest)
                || !valid_hash(&e.latest_digest)
                || !valid_hash(&e.latest_input_hash)
                || !valid_hash(&e.latest_output_hash)
                || !valid_hash(&e.input_hash)
                || !valid_hash(&e.output_hash)
                || e.order >= e.latest_order
                || e.base != "full-overwrite-independent"
                || !snapshot.evidence.iter().any(|s| s.id == e.source)
        })
    {
        return Err("checkpoint_invalid_snapshot".into());
    }
    Ok(())
}
fn publish(root: &Path, manifest: &mut Manifest, value: &State) -> Result<()> {
    manifest.checkpoint_state = Some(serde_json::to_value(value).map_err(|e| e.to_string())?);
    manifest.generation += 1;
    write_manifest(root, manifest)
}

struct Write<'a> {
    part: &'a Value,
    message: usize,
    index: usize,
    ordinal: usize,
}
fn writes(originals: &Originals) -> Result<Vec<Write<'_>>> {
    let mut result = vec![];
    let mut ordinal = 0;
    for (message, value) in originals.messages.iter().enumerate() {
        for (index, part) in value["parts"]
            .as_array()
            .ok_or("checkpoint_invalid_parts")?
            .iter()
            .enumerate()
        {
            ordinal += 1;
            if ordinal > 4096 {
                return Err("checkpoint_scan_bound".into());
            }
            if part["type"] == "tool-write_file" && value["role"] == "assistant" {
                result.push(Write {
                    part,
                    message,
                    index,
                    ordinal,
                });
            }
        }
    }
    Ok(result)
}
fn authentic<'a>(write: &Write<'_>, state: &'a State) -> Result<Option<&'a ObservedWrite>> {
    let p = write.part;
    if p["state"] != "output-available"
        || p.get("approval").is_some()
        || p["providerExecuted"] == true
        || p["output"]["ok"] != true
        || p["output"]["clackWorkspaceWrite"] != true
        || p["input"].as_object().is_none_or(|o| o.len() != 2)
        || p["output"].as_object().is_none_or(|o| o.len() != 4)
    {
        return Ok(None);
    }
    let Some(observation) = state
        .writes
        .iter()
        .find(|w| p["toolCallId"] == w.tool_call_id && p["input"]["path"] == w.path)
    else {
        return Ok(None);
    };
    let Some(text) = p["input"]["content"].as_str() else {
        return Ok(None);
    };
    if text.len() > MAX_RECORD
        || observation.input_hash != hash(&p["input"])?
        || observation.digest != digest(text.as_bytes())
        || p["output"]["path"] != observation.path
        || p["output"]["bytesWritten"].as_u64() != Some(text.encode_utf16().count() as u64)
    {
        return Ok(None);
    }
    Ok(Some(observation))
}

// Unknown consumers stay raw. The first slice closes only pure full-write history
// behind a user boundary, with no later reads, failures, approvals or shell effects.
fn dependencies_closed(originals: &Originals, write: &Write<'_>) -> bool {
    let Some(last_user) = originals.messages.iter().rposition(|m| m["role"] == "user") else {
        return false;
    };
    if write.message >= last_user {
        return false;
    }
    let original = &originals.messages[write.message];
    if original["metadata"]["clackAnswer"]
        .get("state")
        .is_some_and(|s| s != "complete")
    {
        return false;
    }
    for (m, message) in originals.messages.iter().enumerate().skip(write.message) {
        let Some(parts) = message["parts"].as_array() else {
            return false;
        };
        for (i, part) in parts.iter().enumerate() {
            if m == write.message && i < write.index {
                continue;
            }
            let kind = part["type"].as_str().unwrap_or("");
            if kind == "step-start" {
                continue;
            }
            if message["role"] == "user" {
                continue;
            }
            if kind.starts_with("tool-") {
                if !["tool-write_file", "tool-todo_write"].contains(&kind)
                    || part["state"] != "output-available"
                    || part.get("approval").is_some()
                    || part["providerExecuted"] == true
                    || part["output"]["ok"] != true
                {
                    return false;
                }
            } else if m == write.message
                && part["text"].as_str().is_none_or(|s| !s.trim().is_empty())
            {
                return false;
            }
        }
    }
    true
}

fn prepare(
    root: &Path,
    content: &Path,
    originals: &Originals,
    owner: &Owner,
    expected: &Preparation,
    observe: &mut impl FnMut(&str) -> Result<(String, String, String, String)>,
) -> Result<Option<Snapshot>> {
    check_owner(originals, owner)?;
    if owner.workspace_id.is_none() {
        return Ok(None);
    }
    let manifest = synchronize(root, originals)?;
    if preparation(&manifest, owner) != *expected {
        return Err("memory_stale_preparation".into());
    }
    let state = state(&manifest)?;
    let writes = writes(originals)?;
    let ids: Vec<_> = originals
        .messages
        .iter()
        .flat_map(|m| m["parts"].as_array().into_iter().flatten())
        .filter_map(|p| p["toolCallId"].as_str())
        .collect();
    let mut entries = vec![];
    let mut evidence = BTreeSet::new();
    let mut bytes = HashMap::new();
    let mut paths = BTreeSet::new();
    let started = std::time::Instant::now();
    let mut observed_paths = HashMap::new();
    for old in &writes {
        if started.elapsed() > std::time::Duration::from_secs(10) {
            return Err("checkpoint_preparation_timeout".into());
        }
        let id = old.part["toolCallId"]
            .as_str()
            .ok_or("checkpoint_missing_id")?;
        if ids.iter().filter(|&&v| v == id).count() != 1 || !dependencies_closed(originals, old) {
            continue;
        }
        let Some(old_observed) = authentic(old, &state)? else {
            continue;
        };
        let Some(latest) = writes
            .iter()
            .rev()
            .find(|w| w.part["input"]["path"] == old.part["input"]["path"])
        else {
            continue;
        };
        if latest.ordinal <= old.ordinal {
            continue;
        }
        let Some(latest_observed) = authentic(latest, &state)? else {
            continue;
        };
        if ids
            .iter()
            .filter(|&&v| latest.part["toolCallId"].as_str() == Some(v))
            .count()
            != 1
        {
            continue;
        }
        if entries.len() >= MAX_ENTRIES || paths.len() >= 8 && !paths.contains(&old_observed.path) {
            break;
        }
        let observed = match observed_paths
            .entry(latest_observed.path.clone())
            .or_insert_with(|| observe(&latest_observed.path))
        {
            Ok(v) => v.clone(),
            Err(_) => continue,
        };
        if observed.1 != latest_observed.canonical
            || observed.2 != latest_observed.digest
            || observed.3 != latest_observed.input_hash
        {
            continue;
        }
        // Every intervening same-path write must have its own native observation.
        if writes
            .iter()
            .filter(|w| {
                w.ordinal >= old.ordinal
                    && w.ordinal <= latest.ordinal
                    && w.part["input"]["path"] == old.part["input"]["path"]
            })
            .any(|w| authentic(w, &state).ok().flatten().is_none())
        {
            continue;
        }
        let mut source_id = None;
        for w in writes.iter().filter(|w| {
            w.ordinal >= old.ordinal
                && w.ordinal <= latest.ordinal
                && w.part["input"]["path"] == old.part["input"]["path"]
        }) {
            let locator = SourceLocator::Part {
                message_id: originals.messages[w.message]["id"]
                    .as_str()
                    .ok_or("checkpoint_missing_message")?
                    .into(),
                part_index: w.index,
            };
            let (source, value) = evidence_for(root, content, originals, owner, locator)?;
            if w.ordinal == old.ordinal {
                source_id = Some(source.id.clone());
            }
            bytes.insert(source.digest.clone(), value);
            evidence.insert(serde_json::to_string(&source).map_err(|e| e.to_string())?);
        }
        paths.insert(old_observed.path.clone());
        entries.push(Entry {
            tool_call_id: id.into(),
            path: observed.0,
            canonical: observed.1,
            result_digest: old_observed.digest.clone(),
            input_hash: old_observed.input_hash.clone(),
            output_hash: hash(&old.part["output"])?,
            source: source_id.ok_or("checkpoint_missing_source")?,
            order: old.ordinal,
            latest_tool_call_id: latest_observed.tool_call_id.clone(),
            latest_digest: latest_observed.digest.clone(),
            latest_order: latest.ordinal,
            latest_input_hash: latest_observed.input_hash.clone(),
            latest_output_hash: hash(&latest.part["output"])?,
            base: "full-overwrite-independent".into(),
        });
    }
    if entries.is_empty() {
        return Ok(None);
    }
    for user in originals.messages.iter().filter(|m| m["role"] == "user") {
        let (source, value) = evidence_for(
            root,
            content,
            originals,
            owner,
            SourceLocator::Message {
                message_id: user["id"].as_str().ok_or("checkpoint_missing_user")?.into(),
            },
        )?;
        bytes.insert(source.digest.clone(), value);
        evidence.insert(serde_json::to_string(&source).map_err(|e| e.to_string())?);
    }
    if evidence.len() > MAX_SOURCES {
        return Err("checkpoint_source_bound".into());
    }
    let tail = originals.messages.last().ok_or("checkpoint_missing_tail")?;
    let tail_parts = tail["parts"].as_array().ok_or("checkpoint_missing_parts")?;
    let mut snapshot = Snapshot {
        version: VERSION,
        revision: String::new(),
        owner: owner.clone(),
        source: manifest.source,
        entries,
        evidence: evidence
            .into_iter()
            .map(|s| serde_json::from_str(&s).map_err(|e| e.to_string()))
            .collect::<Result<_>>()?,
        message_count: originals.messages.len(),
        prefix_hash: hash(&originals.messages[..originals.messages.len() - 1])?,
        tail_parts: tail_parts.len(),
        tail_hash: hash(tail_parts)?,
        tail_header: hash(&message_header(tail)?)?,
    };
    snapshot.revision = identity(&snapshot)?;
    validate(&snapshot)?;
    for (id, bytes) in bytes {
        if put_content_in(content, &bytes)?.id != id {
            return Err("checkpoint_content_identity".into());
        }
    }
    Ok(Some(snapshot))
}

pub(super) fn retention_roots(manifest: &Manifest) -> Result<Vec<String>> {
    let state = state(manifest)?;
    Ok([state.current, state.previous]
        .into_iter()
        .flatten()
        .flat_map(|s| s.evidence)
        .flat_map(|e| [vec![e.digest], e.content_ids].concat())
        .collect())
}

#[tauri::command]
pub async fn conversation_checkpoint_observe(
    app: tauri::AppHandle,
    state: tauri::State<'_, MemoryState>,
    owner: Owner,
    run_id: u64,
    tool_call_id: String,
    path: String,
    input_hash: String,
) -> Result<()> {
    let state = state.inner().clone();
    blocking(move || {
        valid_id(&tool_call_id)?;
        if path.len() > 4096 || run_id == 0 || owner.workspace_id.is_none() {
            return Err("checkpoint_invalid_input".into());
        }
        if !valid_hash(&input_hash) {
            return Err("checkpoint_invalid_input".into());
        }
        let lock = state.owner(&owner.session_id)?;
        let _guard = lock.lock().map_err(|e| e.to_string())?;
        let originals = originals(&app, &owner.session_id)?;
        authorize(&app, &originals, &owner)?;
        if originals.meta["run"]["state"] != "running"
            || originals.meta["run"]["startedAt"].as_u64() != Some(run_id)
        {
            return Err("checkpoint_stale_run".into());
        }
        let (_, canonical, digest, verified_input) = project::freshness::checkpoint_observation(
            &app.state::<WorkspaceRegistry>(),
            &originals,
            &path,
        )?;
        if verified_input != input_hash {
            return Err("checkpoint_changed_write".into());
        }
        let current = self::originals(&app, &owner.session_id)?;
        if profile(&current.meta) != profile(&originals.meta)
            || provenance(&current.meta) != provenance(&originals.meta)
        {
            return Err("checkpoint_stale_run".into());
        }
        let (root, _) = paths(&app)?;
        let mut manifest = synchronize(&root, &current)?;
        let mut stored = self::state(&manifest)?;
        if let Some(prior) = stored
            .writes
            .iter()
            .find(|w| w.tool_call_id == tool_call_id)
        {
            return if prior.input_hash == input_hash && prior.run_id == run_id {
                Ok(())
            } else {
                Err("checkpoint_duplicate_effect".into())
            };
        }
        stored.writes.push(ObservedWrite {
            tool_call_id,
            path,
            canonical,
            digest,
            input_hash,
            run_id,
        });
        if stored.writes.len() > MAX_WRITES {
            stored.writes.remove(0);
        }
        publish(&root, &mut manifest, &stored)
    })
    .await
}

#[tauri::command]
pub async fn conversation_checkpoint_prepare(
    app: tauri::AppHandle,
    state: tauri::State<'_, MemoryState>,
    preparation: Preparation,
) -> Result<Option<Snapshot>> {
    let state = state.inner().clone();
    blocking(move || {
        let lock = state.owner(&preparation.owner.session_id)?;
        let _guard = lock.lock().map_err(|e| e.to_string())?;
        let _collection = CONTENT_COLLECTION.read().map_err(|e| e.to_string())?;
        let originals = originals(&app, &preparation.owner.session_id)?;
        authorize(&app, &originals, &preparation.owner)?;
        require_durable_source(&session_path(&app)?, &originals)?;
        let (root, content) = paths(&app)?;
        let snapshot = prepare(
            &root,
            &content,
            &originals,
            &preparation.owner,
            &preparation,
            &mut |p| {
                project::freshness::checkpoint_observation(
                    &app.state::<WorkspaceRegistry>(),
                    &originals,
                    p,
                )
            },
        )?;
        let mut manifest = synchronize(
            &root,
            &self::originals(&app, &preparation.owner.session_id)?,
        )?;
        if super::preparation(&manifest, &preparation.owner) != preparation {
            return Err("memory_stale_preparation".into());
        }
        if let Some(ref snapshot) = snapshot {
            let mut stored = self::state(&manifest)?;
            if stored.current.as_ref().map(|s| &s.revision) != Some(&snapshot.revision) {
                stored.previous = stored.current.take();
                stored.current = Some(snapshot.clone());
                publish(&root, &mut manifest, &stored)?;
            }
        }
        Ok(snapshot)
    })
    .await
}

#[tauri::command]
pub async fn conversation_checkpoint_validate(
    app: tauri::AppHandle,
    state: tauri::State<'_, MemoryState>,
    owner: Owner,
    revision: String,
) -> Result<()> {
    let state = state.inner().clone();
    blocking(move || {
        let lock = state.owner(&owner.session_id)?;
        let _guard = lock.lock().map_err(|e| e.to_string())?;
        let originals = originals(&app, &owner.session_id)?;
        authorize(&app, &originals, &owner)?;
        let (root, content) = paths(&app)?;
        let manifest = synchronize(&root, &originals)?;
        let stored = self::state(&manifest)?;
        let snapshot = stored.current.ok_or("checkpoint_missing")?;
        if snapshot.revision != revision
            || !source_current(&snapshot, &originals, &manifest.source)?
            || snapshot.owner != owner
        {
            return Err("checkpoint_stale".into());
        }
        verify_evidence(&root, &content, &snapshot.evidence, &originals)?;
        let mut checked = BTreeSet::new();
        let started = std::time::Instant::now();
        for entry in &snapshot.entries {
            if !checked.insert(&entry.latest_tool_call_id) {
                continue;
            }
            if started.elapsed() > std::time::Duration::from_secs(10) {
                return Err("checkpoint_validation_timeout".into());
            }
            let latest = stored
                .writes
                .iter()
                .find(|w| w.tool_call_id == entry.latest_tool_call_id)
                .ok_or("checkpoint_missing_observation")?;
            let observed = project::freshness::checkpoint_observation(
                &app.state::<WorkspaceRegistry>(),
                &originals,
                &latest.path,
            )?;
            if observed.1 != entry.canonical
                || observed.2 != entry.latest_digest
                || observed.3 != latest.input_hash
            {
                return Err("checkpoint_stale_path".into());
            }
        }
        let final_originals = self::originals(&app, &owner.session_id)?;
        let final_source = synchronize(&root, &final_originals)?;
        if !source_current(&snapshot, &final_originals, &final_source.source)? {
            return Err("checkpoint_stale".into());
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn conversation_checkpoint_restore(
    app: tauri::AppHandle,
    state: tauri::State<'_, MemoryState>,
    owner: Owner,
    revision: String,
    evidence_id: String,
) -> Result<Value> {
    let state = state.inner().clone();
    blocking(move || {
        let lock = state.owner(&owner.session_id)?;
        let _guard = lock.lock().map_err(|e| e.to_string())?;
        let originals = originals(&app, &owner.session_id)?;
        authorize(&app, &originals, &owner)?;
        let (root, content) = paths(&app)?;
        let manifest = read_manifest(&root, &owner.session_id)?.ok_or("checkpoint_missing")?;
        let stored = self::state(&manifest)?;
        let snapshot = [stored.current, stored.previous]
            .into_iter()
            .flatten()
            .find(|s| s.revision == revision && s.owner == owner)
            .ok_or("checkpoint_missing")?;
        let source = snapshot
            .evidence
            .iter()
            .find(|e| e.id == evidence_id)
            .ok_or("checkpoint_missing_evidence")?;
        verify_evidence(&root, &content, std::slice::from_ref(source), &originals)?;
        serde_json::from_slice(&read_content_from(&content, &source.digest)?)
            .map_err(|e| e.to_string())
    })
    .await
}

fn source_current(
    snapshot: &Snapshot,
    originals: &Originals,
    source: &SourceVersion,
) -> Result<bool> {
    if snapshot.source.profile_hash != source.profile_hash
        || snapshot.source.profile_revision != source.profile_revision
        || source.transcript_revision < snapshot.source.transcript_revision
        || originals.messages.len() < snapshot.message_count
    {
        return Ok(false);
    }
    if snapshot.source.transcript_hash == source.transcript_hash {
        return Ok(snapshot.source.transcript_revision == source.transcript_revision);
    }
    let prefix = snapshot.message_count - 1;
    if hash(&originals.messages[..prefix])? != snapshot.prefix_hash {
        return Ok(false);
    }
    let tail = &originals.messages[prefix];
    let Some(parts) = tail["parts"].as_array() else {
        return Ok(false);
    };
    if hash(&message_header(tail)?)? != snapshot.tail_header
        || parts.len() < snapshot.tail_parts
        || hash(&parts[..snapshot.tail_parts])? != snapshot.tail_hash
    {
        return Ok(false);
    }
    let generated_only = |p: &Value| {
        let kind = p["type"].as_str().unwrap_or("");
        ["text", "reasoning"].contains(&kind)
            || ((kind.starts_with("tool-") || kind == "dynamic-tool")
                && p["state"] == "input-streaming"
                && p.get("output").is_none()
                && p.get("approval").is_none())
    };
    if originals.messages.len() == snapshot.message_count && tail["role"] == "assistant" {
        return Ok(parts[snapshot.tail_parts..].iter().all(generated_only));
    }
    if originals.messages.len() == snapshot.message_count + 1 && parts.len() == snapshot.tail_parts
    {
        let next = &originals.messages[snapshot.message_count];
        return Ok(next["role"] == "assistant"
            && next["parts"]
                .as_array()
                .is_some_and(|p| p.iter().all(generated_only)));
    }
    Ok(false)
}

#[cfg(test)]
mod tests;
