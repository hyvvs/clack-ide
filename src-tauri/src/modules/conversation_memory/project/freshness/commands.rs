use super::*;

fn environment() -> String {
    format!("{}:{}", std::env::consts::OS, std::env::consts::ARCH)
}

#[tauri::command]
pub async fn project_memory_verify(
    app: tauri::AppHandle,
    session_id: String,
    expected_revision: u64,
    id: String,
    dependencies: Vec<DependencyInput>,
    depends_on: Vec<String>,
) -> Result<()> {
    blocking(move || {
        if dependencies.is_empty() || dependencies.len() > MAX_DEPENDENCIES
            || dependencies.iter().map(|d| &d.path).collect::<BTreeSet<_>>().len() != dependencies.len()
        { return Err("project_dependency_bound".into()); }
        let (captured, originals) = access(&app, &session_id)?;
        let root = root(&app)?;
        let snapshot = load(&root, &captured.scope.workspace)?;
        expect_revision(&snapshot, expected_revision)?;
        let entry = snapshot.entries.iter().find(|e| e.id == id && visible(e, &captured) && e.status == Publication::Approved).ok_or("project_record_unavailable")?;
        if depends_on.len() > MAX_DEPENDENCIES || depends_on.iter().collect::<BTreeSet<_>>().len() != depends_on.len()
            || depends_on.iter().any(|source| source == &id || !snapshot.entries.iter().any(|e| &e.id == source && e.scope == captured.scope && e.status == Publication::Approved))
        { return Err("project_invalid_dependency_record".into()); }
        let (cwd, env) = location(&originals)?;
        let registry = app.state::<WorkspaceRegistry>();
        let mut batch = Batch::new(&registry, &resolve_path(&cwd, &env))?;
        let observations = dependencies.iter().map(|d| batch.read(d)).collect::<Result<Vec<_>>>()?;
        let git = crate::modules::git::operations::project_evidence_revision(&cwd, &env).map_err(|_| "project_git_unavailable")?;
        let details = observations.iter().map(|o| format!("{}\n{}\n{}", o.dependency.path, o.dependency.content_hash, o.excerpt)).collect::<Vec<_>>().join("\n\n");
        let confirmed = app.dialog().message(format!("Validate this project statement against the selected evidence?\n{}\n\n{}\n\n{}\n\nConfirm the statement is supported, the dependency set includes relevant code and test-environment inputs, and these excerpts contain no private data. Hashes prove evidence identity, not semantic truth. This creates a new user-validated revision; it does not run tests.", captured.scope.checkout, entry.text, details))
            .title("Clack project evidence review").buttons(MessageDialogButtons::OkCancel).blocking_show();
        if !confirmed { return Err("project_user_consent_required".into()); }
        let (current, _) = access(&app, &session_id)?;
        if current != captured { return Err("project_authorization_changed".into()); }
        let mut recheck = Batch::new(&registry, &resolve_path(&cwd, &env))?;
        for (input, original) in dependencies.iter().zip(&observations) {
            if recheck.read(input)?.dependency != original.dependency { return Err("project_source_changed_before_consent".into()); }
        }
        if crate::modules::git::operations::project_evidence_revision(&cwd, &env).map_err(|_| "project_git_unavailable")? != git { return Err("project_checkout_changed".into()); }
        let _collection = CONTENT_COLLECTION.read().map_err(|e| e.to_string())?;
        let state = app.state::<MemoryState>();
        let lock = state.owner(&format!("project:{}", digest(current.scope.workspace.as_bytes())))?;
        let _owner = lock.lock().map_err(|e| e.to_string())?;
        let mut latest = load(&root, &current.scope.workspace)?;
        expect_revision(&latest, expected_revision)?;
        let (_, content) = paths(&app)?;
        if source_state(&app, &content, entry, &mut SourceCache::new()) != "historical-source-verified" { return Err("project_source_unavailable".into()); }
        for observation in &observations { put_content_in(&content, observation.excerpt.as_bytes())?; }
        let knowledge = Knowledge { schema_version: 1, dependencies: observations.into_iter().map(|o| o.dependency).collect(), git_revision: git, environment: environment(), verified_by: session_id.clone(), verified_at: now(), revision: expected_revision + 1, policy: "m2-user-evidence-v1".into(), records: depends_on };
        install(&mut latest, &current, &id, knowledge, true)?;
        if access(&app, &session_id)?.0 != captured { return Err("project_authorization_changed".into()); }
        publish(&root, latest, expected_revision, |_| Ok(()))?;
        let _ = app.emit("clack:project-memory-changed", &current.scope.workspace);
        Ok(())
    }).await
}

#[tauri::command]
pub async fn project_memory_revalidate(
    app: tauri::AppHandle,
    session_id: String,
    expected_revision: u64,
    ids: Vec<String>,
) -> Result<Value> {
    blocking(move || {
        if ids.is_empty() || ids.len() > MAX_RECORDS || ids.iter().collect::<BTreeSet<_>>().len() != ids.len() { return Err("project_revalidation_bound".into()); }
        let (captured, originals) = access(&app, &session_id)?;
        let root = root(&app)?;
        let snapshot = load(&root, &captured.scope.workspace)?;
        expect_revision(&snapshot, expected_revision)?;
        let entries = ids.iter().map(|id| snapshot.entries.iter().find(|e| &e.id == id && visible(e, &captured)).ok_or("project_record_unavailable".into())).collect::<Result<Vec<_>>>()?;
        let state = app.state::<FreshnessState>();
        state.index(&snapshot)?;
        let tickets = entries.iter().map(|e| state.begin(e)).collect::<Result<Vec<_>>>()?;
        let (cwd, env) = location(&originals)?;
        let registry = app.state::<WorkspaceRegistry>();
        let mut batch = Batch::new(&registry, &resolve_path(&cwd, &env))?;
        let git = crate::modules::git::operations::project_evidence_revision(&cwd, &env).map_err(|_| "project_git_unavailable")?;
        let (_, content) = paths(&app)?;
        let mut sources = SourceCache::new();
        let mut results = vec![];
        for entry in &entries {
            let (mut status, evidence) = compare_closure(&snapshot, entry, &git, &environment(), &mut batch, &mut |source| {
                source_state(&app, &content, source, &mut sources) == "historical-source-verified"
                    && source.knowledge.as_ref().is_none_or(|k| k.dependencies.iter().all(|d| read_content_from(&content, &d.slice_hash).is_ok()))
            });
            let provenance = source_state(&app, &content, entry, &mut sources);
            if provenance != "historical-source-verified" { status = "needs-revalidation".into(); }
            if let Some(knowledge) = &entry.knowledge {
                if knowledge.dependencies.iter().any(|d| read_content_from(&content, &d.slice_hash).is_err()) { status = "source-missing".into(); }
            }
            results.push(json!({"id":entry.id,"freshness":status,"sourceState":provenance,"evidence":evidence}));
        }
        if access(&app, &session_id)?.0 != captured { return Err("project_authorization_changed".into()); }
        if crate::modules::git::operations::project_evidence_revision(&cwd, &env).map_err(|_| "project_git_unavailable")? != git { return Err("project_checkout_changed".into()); }
        let memory = app.state::<MemoryState>();
        let lock = memory.owner(&format!("project:{}", digest(captured.scope.workspace.as_bytes())))?;
        let _owner = lock.lock().map_err(|e| e.to_string())?;
        expect_revision(&load(&root, &captured.scope.workspace)?, expected_revision)?;
        for ((entry, ticket), result) in entries.iter().zip(tickets).zip(&results) {
            if entry.knowledge.is_some() { state.finish(entry, ticket, result["freshness"].as_str().ok_or("project_invalid_state")?)?; }
        }
        Ok(json!({"revision":expected_revision,"entries":results,"reads":batch.reads,"bytes":batch.bytes}))
    }).await
}
