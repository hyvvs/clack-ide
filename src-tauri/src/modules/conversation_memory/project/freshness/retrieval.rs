//! Recipient-scoped evidence only. This module never indexes another chat's messages.
use super::*;

#[cfg(test)]
mod tests;

const MAX_CHUNKS: usize = 12;
const MAX_BYTES: usize = 65536;
const MAX_PASSAGE: usize = 4096;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    session_id: String,
    run_id: String,
    query: String,
    anchor: Option<String>,
    files: Vec<String>,
    max_chunks: usize,
    max_bytes: usize,
    expected: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Retrieved {
    chunks: Vec<Value>,
    issues: Vec<Value>,
    omitted: usize,
    stamp: String,
    reads: usize,
    bytes: usize,
}

fn terms(query: &str) -> Vec<String> {
    query
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric() && !"_.-/".contains(c))
        .filter(|s| {
            s.len() >= 3
                && ![
                    "the", "and", "for", "with", "this", "that", "from", "what", "which", "please",
                    "project", "evidence",
                ]
                .contains(s)
        })
        .take(64)
        .map(String::from)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn score(text: &str, terms: &[String]) -> usize {
    let text = text.to_lowercase();
    terms
        .iter()
        .filter(|term| text.contains(term.as_str()))
        .count()
}

// Keep complete lines, including negation. Long indivisible lines fail explicitly.
fn passage(text: &str, terms: &[String]) -> Result<(usize, usize, String)> {
    if text.len() <= MAX_PASSAGE {
        return Ok((0, text.len(), text.into()));
    }
    let mut offset = 0;
    let mut best = (0, 0, 0);
    for line in text.split_inclusive('\n') {
        let rank = score(line, terms);
        if rank > best.0 {
            best = (rank, offset, line.len());
        }
        offset += line.len();
    }
    if best.0 == 0 || best.2 > MAX_PASSAGE {
        return Err("scoped_evidence_passage_unavailable".into());
    }
    let start = best.1;
    let mut end = start;
    for line in text[start..].split_inclusive('\n') {
        if end + line.len() - start > MAX_PASSAGE {
            break;
        }
        end += line.len();
    }
    Ok((start, end, text[start..end].into()))
}

fn permitted_task<'a>(task: &'a Value, originals: &'a Originals, access: &Access) -> bool {
    task["workspaceId"].as_str() == access.owner.workspace_id.as_deref()
        && ["sourceSessionId", "targetSessionId"].iter().all(|key| {
            task[*key]
                .as_str()
                .is_some_and(|id| originals.session_ids.contains(id))
        })
        && matches!(
            task["status"].as_str(),
            Some("queued" | "waiting" | "running" | "completed")
        )
}

fn tasks_for<'a>(originals: &'a Originals, access: &Access) -> Result<Vec<&'a Value>> {
    if originals.tasks.len() > 256 {
        return Err("scoped_evidence_task_bound".into());
    }
    let active_id = originals.meta["run"]["peerTaskId"].as_str();
    let active = active_id
        .map(|id| {
            originals
                .tasks
                .iter()
                .find(|t| t["id"].as_str() == Some(id))
                .ok_or("scoped_evidence_task_missing")
        })
        .transpose()?;
    if active.is_some_and(|task| {
        !permitted_task(task, originals, access)
            || task["targetSessionId"].as_str() != Some(&access.owner.session_id)
            || task["targetAgentId"].as_str() != Some(&access.agent)
            || task["status"] != "running"
    }) {
        return Err("scoped_evidence_task_inactive".into());
    }
    let dependencies: Vec<&str> = active
        .into_iter()
        .flat_map(|t| t["dependsOn"].as_array().into_iter().flatten())
        .filter_map(Value::as_str)
        .collect();
    if dependencies.len() > 8 {
        return Err("scoped_evidence_dependency_bound".into());
    }
    for id in &dependencies {
        if !originals.tasks.iter().any(|t| {
            t["id"] == *id
                && permitted_task(t, originals, access)
                && t["status"] == "completed"
                && active.is_some_and(|a| {
                    a["rootTaskId"].is_string() && a["rootTaskId"] == t["rootTaskId"]
                })
        }) {
            return Err("scoped_evidence_dependency_unavailable".into());
        }
    }
    let mut tasks = vec![];
    let mut seen = BTreeSet::new();
    for task in &originals.tasks {
        if !permitted_task(task, originals, access) {
            continue;
        }
        let id = task["id"].as_str().ok_or("scoped_evidence_invalid_task")?;
        let related = task["sourceSessionId"].as_str() == Some(&access.owner.session_id)
            || task["targetSessionId"].as_str() == Some(&access.owner.session_id)
            || dependencies.contains(&id);
        if related {
            if !seen.insert(id) {
                return Err("scoped_evidence_duplicate_task".into());
            }
            tasks.push(task);
        }
    }
    Ok(tasks)
}

fn validate_request(request: &Request) -> Result<()> {
    valid_id(&request.session_id)?;
    valid_id(&request.run_id)?;
    if request.query.len() > 4096
        || request.anchor.as_ref().is_some_and(|s| s.len() > 1100)
        || request.files.len() > 8
        || request.files.iter().any(|p| !safe_path(p))
        || request.max_chunks == 0
        || request.max_chunks > MAX_CHUNKS
        || request.max_bytes == 0
        || request.max_bytes > MAX_BYTES
        || request.expected.as_ref().is_some_and(|s| !valid_hash(s))
    {
        return Err("scoped_evidence_invalid_request".into());
    }
    Ok(())
}

fn recipient(originals: &Originals, request: &Request, profiles: &Value) -> Result<String> {
    let profile = &originals.meta["profile"];
    let run = &originals.meta["run"];
    let agent = profile["agentId"]
        .as_str()
        .ok_or("scoped_evidence_missing_agent")?;
    if profiles[agent]["mode"] == "chat-only" {
        return Err("scoped_evidence_permission_denied".into());
    }
    let started = run["startedAt"]
        .as_u64()
        .ok_or("scoped_evidence_stale_run")?;
    if request.run_id != format!("{}:{started}", request.session_id) || run["state"] != "running" {
        return Err("scoped_evidence_stale_run".into());
    }
    hash(&json!([
        profile,
        run["startedAt"],
        run["state"],
        run["peerTaskId"],
        run["checkoutRoot"],
        run["workspaceId"],
        profiles[agent]
    ]))
}

struct Selection<'a> {
    access: &'a Access,
    originals: &'a Originals,
    snapshot: &'a Snapshot,
    content: &'a Path,
    git: &'a str,
    environment: &'a str,
}

fn collect(
    selection: Selection<'_>,
    request: &Request,
    batch: &mut Batch<'_>,
    source_valid: &mut impl FnMut(&Entry) -> bool,
) -> Result<Retrieved> {
    let Selection {
        access,
        originals,
        snapshot,
        content,
        git,
        environment,
    } = selection;
    let terms = terms(&request.query);
    let mut result = Retrieved {
        chunks: vec![],
        issues: vec![],
        omitted: 0,
        stamp: String::new(),
        reads: 0,
        bytes: 0,
    };
    let mut seen = BTreeSet::new();
    let mut add = |mut chunk: Value, result: &mut Retrieved| -> Result<()> {
        let text = chunk["text"]
            .as_str()
            .ok_or("scoped_evidence_invalid_chunk")?;
        if possible_secret(text)
            || chunk["originalEvidence"]
                .as_str()
                .is_some_and(possible_secret)
        {
            return Err("scoped_evidence_secret_denied".into());
        }
        chunk["workspaceId"] = json!(access.owner.workspace_id);
        chunk["workspaceKey"] = json!(access.scope.workspace);
        chunk["checkout"] = json!(access.scope.checkout);
        let key = hash(&json!([
            chunk["source"],
            chunk["contentHash"],
            chunk["start"],
            chunk["end"]
        ]))?;
        if !seen.insert(key.clone()) {
            return Ok(());
        }
        chunk["id"] = json!(key);
        result.chunks.push(chunk);
        Ok(())
    };
    let mut entries: Vec<_> = snapshot
        .entries
        .iter()
        .filter(|e| {
            e.scope == access.scope
                && e.status == Publication::Approved
                && !possible_secret(&e.text)
        })
        .map(|e| {
            (
                e,
                score(&format!("{} {}", e.text, e.section), &terms),
                request.anchor.as_deref() == Some(&format!("project:{}", e.id)),
            )
        })
        .filter(|(_, rank, exact)| *rank > 0 || *exact)
        .collect();
    entries.sort_by(|a, b| b.2.cmp(&a.2).then(b.1.cmp(&a.1)).then(a.0.id.cmp(&b.0.id)));
    result.omitted += entries.len().saturating_sub(8);
    for (entry, _, exact) in entries.into_iter().take(8) {
        let (mut status, mut evidence) =
            compare_closure(snapshot, entry, git, environment, batch, &mut |e| {
                source_valid(e)
                    && e.knowledge.as_ref().is_none_or(|k| {
                        k.dependencies
                            .iter()
                            .all(|d| read_content_from(content, &d.slice_hash).is_ok())
                    })
            });
        for item in &mut evidence {
            if let Some(Ok(observation)) =
                item["path"].as_str().and_then(|path| batch.cache.get(path))
            {
                if let Ok((start, end, text)) = passage(&observation.text, &terms) {
                    item["excerpt"] = json!(text);
                    item["start"] = json!(start);
                    item["end"] = json!(end);
                }
            }
        }
        let source_ok = source_valid(entry);
        if !source_ok {
            status = "source-unavailable".into();
        }
        if entry.knowledge.is_none()
            && source_ok
            && matches!(
                entry.qualification,
                Qualification::UserRequirement | Qualification::UserCorrection
            )
        {
            status = if conflicting(snapshot, entry) {
                "conflicting"
            } else {
                "explicit-user-statement"
            }
            .into();
        }
        let retained = read_content_from(content, &entry.source.slice_digest);
        let original = retained
            .ok()
            .and_then(|bytes| String::from_utf8(bytes).ok());
        if original.is_none() {
            status = "source-missing".into();
        }
        add(
            json!({"kind":"project","source":{"recordId":entry.id,"sessionId":entry.source.owner.session_id,"locator":entry.source.locator,"start":entry.source.start,"end":entry.source.end,"sliceHash":entry.source.slice_digest},
            "revision":snapshot.revision,"qualification":entry.qualification,"freshness":status,"text":entry.text,"originalEvidence":original,
            "contentHash":digest(entry.text.as_bytes()),"start":0,"end":entry.text.len(),"required":exact,"reason":if exact {"exact-project-source"} else {"project-lexical-relevance"},
            "supersedes":entry.supersedes,"conflicts":entry.conflicts,"currentEvidence":evidence}),
            &mut result,
        )?;
    }
    let tasks = tasks_for(originals, access)?;
    let active_id = originals.meta["run"]["peerTaskId"].as_str();
    let active = tasks.iter().find(|t| t["id"].as_str() == active_id);
    let mut candidates = vec![];
    for task in &tasks {
        let id = task["id"].as_str().ok_or("scoped_evidence_invalid_task")?;
        let exact = request.anchor.as_deref() == Some(&format!("task:{id}"));
        let dependency = active.is_some_and(|a| {
            a["dependsOn"]
                .as_array()
                .is_some_and(|d| d.contains(&json!(id)))
        });
        if task["status"] == "completed" {
            let summary = task["result"]["summary"]
                .as_str()
                .ok_or("scoped_evidence_result_missing")?;
            if task["result"]["targetSessionId"] != task["targetSessionId"] {
                return Err("scoped_evidence_invalid_result".into());
            }
            if possible_secret(summary) {
                return Err("scoped_evidence_secret_denied".into());
            }
            let rank = score(summary, &terms);
            if exact || dependency || rank > 0 {
                candidates.push((exact, dependency, rank, *task, None));
            }
        }
        let artifacts: Vec<_> = task["artifactRefs"]
            .as_array()
            .into_iter()
            .flatten()
            .chain(
                task["result"]["artifacts"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter(|_| task["status"] == "completed"),
            )
            .collect();
        if artifacts.len() > 16 {
            return Err("scoped_evidence_artifact_bound".into());
        }
        let mut identities = HashMap::new();
        for artifact in artifacts {
            let artifact_id = artifact["id"]
                .as_str()
                .ok_or("scoped_evidence_invalid_artifact")?;
            let fingerprint = hash(artifact)?;
            if let Some(prior) = identities.insert(artifact_id, fingerprint.clone()) {
                if prior != fingerprint {
                    return Err("scoped_evidence_conflicting_artifact_identity".into());
                }
                continue;
            }
            let exact = request.anchor.as_deref()
                == Some(&format!(
                    "artifact:{id}:{}",
                    artifact["id"].as_str().unwrap_or_default()
                ));
            if !artifact_allowed(task, artifact) {
                if exact {
                    return Err("scoped_evidence_artifact_denied".into());
                }
                continue;
            }
            let rank = score(artifact["displayName"].as_str().unwrap_or_default(), &terms);
            if exact || dependency || rank > 0 || active_id == Some(id) {
                candidates.push((exact, dependency, rank, *task, Some(artifact)));
            }
        }
    }
    candidates.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)).then(b.2.cmp(&a.2)));
    if candidates.iter().skip(MAX_CHUNKS).any(|c| c.0 || c.1) {
        return Err("scoped_evidence_required_no_fit".into());
    }
    result.omitted += candidates.len().saturating_sub(12);
    for (exact, dependency, _, task, artifact) in candidates.into_iter().take(12) {
        let id = task["id"].as_str().ok_or("scoped_evidence_invalid_task")?;
        let evidence = task_evidence(task, artifact, content, &terms);
        match evidence {
            Ok((text, start, end, content_hash)) => {
                add(
                    json!({"kind":if artifact.is_some() {"artifact"} else {"task-result"},"source":{"taskId":id,"artifactId":artifact.map(|a| &a["id"]),"targetSessionId":task["targetSessionId"],"worktree":task["worktree"],"artifactProvenance":artifact.map(|a| &a["worktreeProvenance"])},
                    "revision":hash(task)?,"contentHash":content_hash,"start":start,"end":end,"text":text,"required":exact || dependency,
                    "freshness":"historical-task-evidence-not-current-project-state","qualification":"agent-finding","reason":if dependency {"declared-task-dependency"} else {"authorized-task-relevance"}}),
                    &mut result,
                )?;
            }
            Err(error) => {
                if exact || dependency {
                    return Err(error);
                }
                result
                    .issues
                    .push(json!({"source":format!("task:{id}"),"status":error}));
            }
        }
    }
    for path in request.files.iter().collect::<BTreeSet<_>>() {
        let exact = request.anchor.as_deref() == Some(&format!("file:{path}"));
        match batch
            .read(&DependencyInput {
                path: path.clone(),
                environment: false,
            })
            .and_then(|o| passage(&o.text, &terms).map(|(start, end, text)| (o, start, end, text)))
        {
            Ok((observation, start, end, text)) => add(
                json!({"kind":"file","source":{"path":path,"canonicalPath":observation.dependency.canonical},"revision":git,"contentHash":observation.dependency.content_hash,"text":text,"start":start,"end":end,"freshness":"current-file-observation","qualification":"file-evidence","reason":"explicit-file-reference","required":exact}),
                &mut result,
            )?,
            Err(error) => {
                if exact {
                    return Err(error);
                }
                result
                    .issues
                    .push(json!({"source":format!("file:{path}"),"status":error}));
            }
        }
    }
    result.chunks.sort_by_key(|c| {
        (
            c["required"] != true,
            match c["freshness"].as_str() {
                Some("explicit-user-statement") => 0,
                Some("current" | "current-file-observation") => 1,
                _ => 2,
            },
        )
    });
    let mut selected = Vec::new();
    for chunk in result.chunks.drain(..) {
        let size = serde_json::to_vec(&chunk).map_err(|e| e.to_string())?.len();
        if selected.len() >= request.max_chunks || result.bytes + size > request.max_bytes {
            if chunk["required"] == true {
                return Err("scoped_evidence_required_no_fit".into());
            }
            result.omitted += 1;
        } else {
            result.bytes += size;
            selected.push(chunk);
        }
    }
    result.chunks = selected;
    if let Some(anchor) = &request.anchor {
        if !result.chunks.iter().any(|c| {
            let s = &c["source"];
            [
                format!("project:{}", s["recordId"].as_str().unwrap_or_default()),
                format!("task:{}", s["taskId"].as_str().unwrap_or_default()),
                format!(
                    "artifact:{}:{}",
                    s["taskId"].as_str().unwrap_or_default(),
                    s["artifactId"].as_str().unwrap_or_default()
                ),
                format!("file:{}", s["path"].as_str().unwrap_or_default()),
            ]
            .contains(anchor)
        }) {
            return Err(format!("scoped_evidence_anchor_unavailable: {anchor}"));
        }
    }
    result.reads = batch.reads;
    result.stamp = hash(&json!([
        snapshot.revision,
        git,
        tasks,
        result.chunks,
        result.issues,
        result.omitted
    ]))?;
    Ok(result)
}

fn artifact_allowed(task: &Value, artifact: &Value) -> bool {
    artifact["workspaceId"] == task["workspaceId"]
        && [&task["sourceSessionId"], &task["targetSessionId"]]
            .contains(&&artifact["sourceSessionId"])
        && artifact["accessPolicy"] == "model-input"
        && !super::super::super::retrieval::sensitive(artifact)
        && artifact["id"]
            .as_str()
            .is_some_and(|id| valid_id(id).is_ok())
        && (artifact["worktreeProvenance"].is_null()
            || (artifact["worktreeProvenance"]["taskId"] == task["id"]
                && artifact["worktreeProvenance"]["baseSha"] == task["worktree"]["baseSha"]
                && artifact["worktreeProvenance"]["baseSha"].is_string()))
}

fn task_evidence(
    task: &Value,
    artifact: Option<&Value>,
    content: &Path,
    terms: &[String],
) -> Result<(String, usize, usize, String)> {
    let text = if let Some(artifact) = artifact {
        if !artifact_allowed(task, artifact)
            || !matches!(artifact["contentKind"].as_str(), Some("text" | "selection"))
        {
            return Err("scoped_evidence_artifact_denied".into());
        }
        let reference = &artifact["contentRef"];
        let id = reference["id"]
            .as_str()
            .filter(|id| valid_hash(id))
            .ok_or("scoped_evidence_invalid_content")?;
        if reference["contentHash"] != id
            || reference["byteSize"]
                .as_u64()
                .is_none_or(|n| n > MAX_BYTES as u64)
        {
            return Err("scoped_evidence_artifact_bound".into());
        }
        if fs::metadata(content.join(id))
            .map_err(|_| "scoped_evidence_content_missing")?
            .len()
            > MAX_BYTES as u64
        {
            return Err("scoped_evidence_artifact_bound".into());
        }
        let bytes = read_content_from(content, id)?;
        if reference["byteSize"].as_u64() != Some(bytes.len() as u64) {
            return Err("scoped_evidence_invalid_content_size".into());
        }
        String::from_utf8(bytes).map_err(|_| "scoped_evidence_text_required")?
    } else {
        task["result"]["summary"]
            .as_str()
            .filter(|s| s.len() <= MAX_BYTES)
            .ok_or("scoped_evidence_result_bound")?
            .into()
    };
    if possible_secret(&text) {
        return Err("scoped_evidence_secret_denied".into());
    }
    let (start, end, excerpt) = passage(&text, terms)?;
    Ok((excerpt, start, end, digest(text.as_bytes())))
}

#[tauri::command]
pub async fn scoped_evidence_retrieve(
    app: tauri::AppHandle,
    request: Request,
) -> Result<Retrieved> {
    blocking(move || {
        validate_request(&request)?;
        let started = Instant::now();
        let _collection = CONTENT_COLLECTION.read().map_err(|e| e.to_string())?;
        let profiles = || {
            app.store("terax-settings.json")
                .map_err(|e| e.to_string())
                .map(|s| s.get("agentPermissionProfiles").unwrap_or(json!({})))
        };
        let (captured, originals) = access(&app, &request.session_id)?;
        let recipient_stamp = recipient(&originals, &request, &profiles()?)?;
        let root = root(&app)?;
        let snapshot = load(&root, &captured.scope.workspace)?;
        let (_, content) = paths(&app)?;
        let (cwd, env) = location(&originals)?;
        let git = crate::modules::git::operations::project_evidence_revision(&cwd, &env)?;
        let registry = app.state::<WorkspaceRegistry>();
        let mut batch = Batch::new(&registry, &resolve_path(&cwd, &env))?;
        let mut sources = SourceCache::new();
        let mut result = collect(
            Selection {
                access: &captured,
                originals: &originals,
                snapshot: &snapshot,
                content: &content,
                git: &git,
                environment: &commands::environment(),
            },
            &request,
            &mut batch,
            &mut |e| source_state(&app, &content, e, &mut sources) == "historical-source-verified",
        )?;
        let mut final_batch = Batch::new(&registry, &resolve_path(&cwd, &env))?;
        for (path, observed) in &batch.cache {
            if let Ok(observed) = observed {
                let latest = final_batch.read(&DependencyInput {
                    path: path.clone(),
                    environment: observed.dependency.environment,
                })?;
                if latest.dependency != observed.dependency {
                    return Err("scoped_evidence_file_changed".into());
                }
            }
        }
        result.reads += final_batch.reads;
        let (current, latest) = access(&app, &request.session_id)?;
        if current != captured
            || recipient(&latest, &request, &profiles()?)? != recipient_stamp
            || hash(&json!(tasks_for(&latest, &current)?))?
                != hash(&json!(tasks_for(&originals, &captured)?))?
            || load(&root, &captured.scope.workspace)?.revision != snapshot.revision
            || crate::modules::git::operations::project_evidence_revision(&cwd, &env)? != git
        {
            return Err("scoped_evidence_sources_changed".into());
        }
        if started.elapsed() >= Duration::from_secs(10) {
            return Err("scoped_evidence_timeout".into());
        }
        result.stamp = hash(&json!([recipient_stamp, result.stamp]))?;
        if request
            .expected
            .as_ref()
            .is_some_and(|stamp| stamp != &result.stamp)
        {
            return Err("scoped_evidence_stale_receipt".into());
        }
        Ok(result)
    })
    .await
}
