use super::*;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Pointer {
    schema_version: u32,
    current: String,
    previous: Option<String>,
}

fn directory(root: &Path, workspace: &str) -> PathBuf {
    root.join(digest(workspace.as_bytes()))
}
fn pointer(root: &Path, workspace: &str) -> Result<Option<Pointer>> {
    let path = directory(root, workspace).join("manifest.json");
    if !path.exists() {
        return Ok(None);
    }
    let pointer: Pointer =
        serde_json::from_slice(&bounded_read(&path)?).map_err(|_| "project_corrupt_manifest")?;
    if pointer.schema_version != 1
        || !valid_hash(&pointer.current)
        || pointer.previous.as_ref().is_some_and(|id| !valid_hash(id))
    {
        return Err("project_unsupported_or_invalid_manifest".into());
    }
    Ok(Some(pointer))
}

fn validate(snapshot: &Snapshot) -> Result<()> {
    if !matches!(snapshot.schema_version, 1 | 2) {
        return Err("project_unsupported_schema".into());
    }
    if snapshot.workspace.is_empty() || snapshot.entries.len() > MAX_ENTRIES {
        return Err("project_metadata_bound".into());
    }
    let ids: BTreeSet<_> = snapshot.entries.iter().map(|e| &e.id).collect();
    if ids.len() != snapshot.entries.len() {
        return Err("project_duplicate_identity".into());
    }
    for (index, entry) in snapshot.entries.iter().enumerate() {
        if let Some(knowledge) = &entry.knowledge {
            if snapshot.schema_version < 2 {
                return Err("project_unsupported_schema".into());
            }
            super::freshness::validate(knowledge)?;
            super::freshness::validate_links(knowledge, entry, snapshot)?;
        }
        if !valid_hash(&entry.id)
            || entry.scope.workspace != snapshot.workspace
            || entry.scope.checkout.is_empty()
            || !valid_hash(&entry.source.slice_digest)
            || !valid_hash(&entry.source.source_digest)
            || entry.text.trim().is_empty()
            || entry.text.len() > MAX_SLICE
            || (entry.qualification != Qualification::UserCorrection
                && digest(entry.text.as_bytes()) != entry.source.slice_digest)
            || (entry.qualification == Qualification::UserCorrection
                && (entry.supersedes.is_none()
                    || !entry.consent.iter().any(|c| c.action == "correct")))
            || entry.source.end <= entry.source.start
            || entry.source.end - entry.source.start > MAX_SLICE
            || entry.created_at == 0
            || entry.updated_at < entry.created_at
            || entry.author_agent.is_empty()
            || valid_id(&entry.source.owner.session_id).is_err()
            || entry
                .source
                .owner
                .workspace_id
                .as_ref()
                .is_none_or(|id| id.is_empty())
            || !SECTIONS.contains(&entry.section.as_str())
            || !matches!(
                entry.source.locator,
                SourceLocator::Part { .. }
                    | SourceLocator::TaskResult { .. }
                    | SourceLocator::Artifact { .. }
            )
            || entry.consent.len() > 3
            || entry.conflicts.len() > 8
            || entry
                .conflicts
                .iter()
                .any(|id| id == &entry.id || !ids.contains(id))
            || entry
                .supersedes
                .as_ref()
                .is_some_and(|id| id == &entry.id || !ids.contains(id))
            || (entry.status == Publication::Pending && !entry.consent.is_empty())
            || (entry.status != Publication::Pending && entry.consent.is_empty())
            || entry.consent.iter().any(|c| {
                c.policy != POLICY
                    || c.user_confirmed_at == 0
                    || valid_id(&c.acting_session).is_err()
                    || !["approve", "revoke", "correct"].contains(&c.action.as_str())
            })
            || match entry.status {
                Publication::Pending => false,
                Publication::Approved => !entry
                    .consent
                    .last()
                    .is_some_and(|c| c.action == "approve" || c.action == "correct"),
                Publication::Revoked => entry.consent.last().is_none_or(|c| c.action != "revoke"),
                Publication::Superseded => {
                    entry.consent.last().is_none_or(|c| c.action != "correct")
                }
            }
            || entry.supersedes.as_ref().is_some_and(|id| {
                !snapshot.entries[..index].iter().any(|previous| {
                    &previous.id == id
                        && previous.status == Publication::Superseded
                        && previous.scope == entry.scope
                })
            })
        {
            return Err("project_invalid_record".into());
        }
    }
    // Capacity exhaustion must never prevent the user from revoking shared data.
    let consent_reserve: usize = snapshot
        .entries
        .iter()
        .map(|entry| match entry.status {
            Publication::Pending => 2048,
            Publication::Approved => 1024,
            Publication::Revoked | Publication::Superseded => 0,
        })
        .sum();
    if serde_json::to_vec(snapshot)
        .map_err(|e| e.to_string())?
        .len()
        + consent_reserve
        > MAX_RECORD
    {
        return Err("project_metadata_bound".into());
    }
    Ok(())
}

fn read_snapshot(dir: &Path, id: &str) -> Result<Snapshot> {
    if !valid_hash(id) {
        return Err("project_invalid_revision_id".into());
    }
    let bytes = bounded_read(&dir.join(format!("{id}.json")))?;
    if digest(&bytes) != id {
        return Err(
            "project_integrity_failed: previous revision retained; no automatic consent rollback"
                .into(),
        );
    }
    let snapshot: Snapshot =
        serde_json::from_slice(&bytes).map_err(|_| "project_corrupt_revision")?;
    validate(&snapshot)?;
    Ok(snapshot)
}

pub(super) fn load(root: &Path, workspace: &str) -> Result<Snapshot> {
    let Some(pointer) = pointer(root, workspace)? else {
        return Ok(Snapshot {
            schema_version: 1,
            workspace: workspace.into(),
            revision: 0,
            previous: None,
            entries: vec![],
        });
    };
    let snapshot = read_snapshot(&directory(root, workspace), &pointer.current)?;
    if snapshot.workspace != workspace
        || snapshot.previous != pointer.previous
        || snapshot.revision == 0
    {
        return Err("project_revision_owner_mismatch".into());
    }
    if let Some(previous) = &pointer.previous {
        let prior = read_snapshot(&directory(root, workspace), previous)?;
        if prior.workspace != workspace || prior.revision.checked_add(1) != Some(snapshot.revision)
        {
            return Err("project_invalid_revision_chain".into());
        }
    } else if snapshot.revision != 1 {
        return Err("project_missing_predecessor".into());
    }
    Ok(snapshot)
}

pub(super) fn expect_revision(snapshot: &Snapshot, expected: u64) -> Result<()> {
    if snapshot.revision != expected {
        Err("project_stale_revision".into())
    } else {
        Ok(())
    }
}

pub(super) fn publish(
    root: &Path,
    mut snapshot: Snapshot,
    expected: u64,
    fault: impl Fn(&str) -> Result<()>,
) -> Result<()> {
    if !matches!(snapshot.schema_version, 1 | 2) {
        return Err("project_unsupported_schema".into());
    }
    let current = load(root, &snapshot.workspace)?;
    expect_revision(&current, expected)?;
    let previous = pointer(root, &snapshot.workspace)?.map(|p| p.current);
    snapshot.revision = expected
        .checked_add(1)
        .ok_or("project_revision_exhausted")?;
    snapshot.schema_version = 2;
    snapshot.previous = previous.clone();
    validate(&snapshot)?;
    let bytes = serde_json::to_vec(&snapshot).map_err(|e| e.to_string())?;
    let id = digest(&bytes);
    let dir = directory(root, &snapshot.workspace);
    fault("before-revision")?;
    atomic_write(&dir.join(format!("{id}.json")), &bytes)?;
    fault("before-pointer")?;
    atomic_write(
        &dir.join("manifest.json"),
        &serde_json::to_vec(&Pointer {
            schema_version: 1,
            current: id.clone(),
            previous: previous.clone(),
        })
        .map_err(|e| e.to_string())?,
    )?;
    cleanup(&dir, &id, previous.as_deref());
    Ok(())
}

fn cleanup(dir: &Path, current: &str, previous: Option<&str>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(id) = path.file_stem().and_then(|n| n.to_str()) {
                if path.extension().and_then(|n| n.to_str()) == Some("json")
                    && valid_hash(id)
                    && id != current
                    && Some(id) != previous
                {
                    let _ = fs::remove_file(path);
                }
            }
        }
    }
}

pub(super) fn retention_roots(root: &Path) -> Result<Vec<String>> {
    let mut roots = BTreeSet::new();
    if !root.exists() {
        return Ok(vec![]);
    }
    for dir in fs::read_dir(root).map_err(|e| e.to_string())? {
        let dir = dir.map_err(|e| e.to_string())?.path();
        if !dir.is_dir() {
            continue;
        }
        let path = dir.join("manifest.json");
        if !path.exists() {
            cleanup(&dir, "", None);
            continue;
        }
        let pointer: Pointer = serde_json::from_slice(&bounded_read(&path)?)
            .map_err(|_| "project_corrupt_manifest")?;
        if pointer.schema_version != 1 {
            return Err("project_unsupported_schema".into());
        }
        for id in std::iter::once(&pointer.current).chain(pointer.previous.iter()) {
            let snapshot = read_snapshot(&dir, id)?;
            if directory(root, &snapshot.workspace) != dir {
                return Err("project_owner_mismatch".into());
            }
            for entry in snapshot.entries {
                roots.insert(entry.source.slice_digest);
                if let Some(knowledge) = entry.knowledge {
                    roots.extend(knowledge.dependencies.into_iter().map(|d| d.slice_hash));
                }
            }
        }
        cleanup(&dir, &pointer.current, pointer.previous.as_deref());
    }
    Ok(roots.into_iter().collect())
}
