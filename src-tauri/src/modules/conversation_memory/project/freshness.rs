//! File evidence is explicit; freshness never upgrades an agent assertion into a fact.
use super::*;
use crate::modules::{
    fs::to_canon,
    workspace::{resolve_path, WorkspaceEnv, WorkspaceRegistry},
};
use std::io::Read;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

mod commands;
pub use commands::*;
pub mod retrieval;
#[cfg(test)]
mod tests;

const MAX_DEPENDENCIES: usize = 8;
const MAX_FILE: usize = 256 * 1024;
const MAX_BATCH: usize = 4 * 1024 * 1024;
const MAX_RECORDS: usize = 8;
const MAX_EXCERPT: usize = 256;
const MAX_CACHE: usize = 128;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Dependency {
    path: String,
    canonical: String,
    content_hash: String,
    pub(super) slice_hash: String,
    end: usize,
    environment: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Knowledge {
    schema_version: u32,
    pub(super) dependencies: Vec<Dependency>,
    git_revision: String,
    environment: String,
    verified_by: String,
    verified_at: u64,
    revision: u64,
    policy: String,
    records: Vec<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DependencyInput {
    path: String,
    #[serde(default)]
    environment: bool,
}

#[derive(Clone)]
struct Observation {
    dependency: Dependency,
    excerpt: String,
    text: String,
}

#[derive(Default)]
pub struct FreshnessState {
    inner: Mutex<HashMap<String, Cached>>,
    sequence: AtomicU64,
}
struct Cached {
    fingerprint: String,
    graph: String,
    paths: Vec<String>,
    status: String,
    generation: u64,
}

fn key(workspace: &str, id: &str) -> String {
    format!("{}:{id}", digest(workspace.as_bytes()))
}

impl FreshnessState {
    fn next(&self) -> u64 {
        self.sequence.fetch_add(1, Ordering::Relaxed) + 1
    }
    fn index(&self, snapshot: &Snapshot) -> Result<()> {
        for entry in snapshot.entries.iter().filter(|e| e.knowledge.is_some()) {
            self.register(entry)?;
            let mut paths = BTreeSet::new();
            let mut graph = vec![];
            let mut visited = BTreeSet::new();
            let mut pending = vec![entry];
            while let Some(source) = pending.pop() {
                if visited.len() >= 16 || !visited.insert(&source.id) {
                    continue;
                }
                graph.push(json!([source.id, source.status, source.knowledge]));
                if let Some(knowledge) = &source.knowledge {
                    paths.extend(knowledge.dependencies.iter().map(|d| d.canonical.clone()));
                    for id in &knowledge.records {
                        if let Some(source) = snapshot
                            .entries
                            .iter()
                            .find(|e| &e.id == id && e.scope == entry.scope)
                        {
                            pending.push(source);
                        }
                    }
                }
            }
            if let Some(cache) = self
                .inner
                .lock()
                .map_err(|e| e.to_string())?
                .get_mut(&key(&entry.scope.workspace, &entry.id))
            {
                cache.paths = paths.into_iter().collect();
                let graph = hash(&json!(graph))?;
                if cache.graph != graph {
                    cache.graph = graph;
                    cache.generation = self.next();
                    cache.status = "needs-revalidation".into();
                }
            }
        }
        Ok(())
    }
    fn register(&self, entry: &Entry) -> Result<u64> {
        let Some(knowledge) = &entry.knowledge else {
            return Ok(0);
        };
        let fingerprint = hash(&serde_json::to_value(knowledge).map_err(|e| e.to_string())?)?;
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        let key = key(&entry.scope.workspace, &entry.id);
        if !inner.contains_key(&key) && inner.len() >= MAX_CACHE {
            inner.clear();
        }
        let cached = inner.entry(key).or_insert(Cached {
            fingerprint: String::new(),
            graph: String::new(),
            paths: vec![],
            status: "needs-revalidation".into(),
            generation: 0,
        });
        if cached.fingerprint != fingerprint {
            cached.fingerprint = fingerprint;
            cached.paths = knowledge
                .dependencies
                .iter()
                .map(|d| d.canonical.clone())
                .collect();
            cached.status = "needs-revalidation".into();
            cached.generation = self.next();
        }
        Ok(cached.generation)
    }

    fn finish(&self, entry: &Entry, generation: u64, status: &str) -> Result<()> {
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        let cache = inner
            .get_mut(&key(&entry.scope.workspace, &entry.id))
            .ok_or("project_freshness_superseded")?;
        if cache.generation != generation {
            return Err("project_freshness_superseded".into());
        }
        cache.status = status.into();
        Ok(())
    }

    fn begin(&self, entry: &Entry) -> Result<u64> {
        self.register(entry)?;
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        let Some(cache) = inner.get_mut(&key(&entry.scope.workspace, &entry.id)) else {
            return Ok(0);
        };
        cache.generation = self.next();
        cache.status = "needs-revalidation".into();
        Ok(cache.generation)
    }

    fn status(&self, entry: &Entry) -> Result<String> {
        self.register(entry)?;
        Ok(self
            .inner
            .lock()
            .map_err(|e| e.to_string())?
            .get(&key(&entry.scope.workspace, &entry.id))
            .map_or("needs-revalidation", |c| c.status.as_str())
            .into())
    }

    pub(crate) fn invalidate(&self, paths: &[String]) -> bool {
        let Ok(mut inner) = self.inner.lock() else {
            return false;
        };
        let mut changed = false;
        for cache in inner.values_mut() {
            if paths.is_empty()
                || cache.paths.iter().any(|dependency| {
                    paths.iter().any(|path| {
                        let path = path.replace('\\', "/");
                        let dependency = dependency.replace('\\', "/");
                        #[cfg(windows)]
                        let (path, dependency) = (path.to_lowercase(), dependency.to_lowercase());
                        dependency == path || dependency.starts_with(&format!("{path}/"))
                    })
                })
            {
                cache.generation = self.next();
                cache.status = "potentially-stale".into();
                changed = true;
            }
        }
        changed
    }
}

pub(crate) fn changed(app: &tauri::AppHandle, paths: &[String]) {
    if app.state::<FreshnessState>().invalidate(paths) {
        let _ = app.emit("clack:project-memory-changed", "freshness");
    }
}

fn safe_path(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 1024
        && !path.starts_with(['/', '\\'])
        && !path.contains(':')
        && !path.chars().any(char::is_control)
        && !path
            .replace('\\', "/")
            .split('/')
            .any(|p| matches!(p, ".." | "." | ""))
        && !crate::modules::archive::is_sensitive_archive_path(&path.replace('\\', "/"))
}

pub(super) fn validate(knowledge: &Knowledge) -> Result<()> {
    let paths: BTreeSet<_> = knowledge.dependencies.iter().map(|d| &d.path).collect();
    if knowledge.schema_version != 1
        || knowledge.dependencies.is_empty()
        || knowledge.dependencies.len() > MAX_DEPENDENCIES
        || knowledge.records.len() > MAX_DEPENDENCIES
        || knowledge.records.iter().any(|id| !valid_hash(id))
        || knowledge.records.iter().collect::<BTreeSet<_>>().len() != knowledge.records.len()
        || paths.len() != knowledge.dependencies.len()
        || knowledge.policy != "m2-user-evidence-v1"
        || knowledge.verified_at == 0
        || knowledge.revision == 0
        || valid_id(&knowledge.verified_by).is_err()
        || knowledge.git_revision.is_empty()
        || knowledge.git_revision.len() > 4096
        || knowledge.environment.len() > 128
        || knowledge.dependencies.iter().any(|d| {
            !safe_path(&d.path)
                || d.canonical.is_empty()
                || d.canonical.len() > 4096
                || !valid_hash(&d.content_hash)
                || !valid_hash(&d.slice_hash)
                || d.end == 0
                || d.end > MAX_EXCERPT
        })
    {
        return Err("project_invalid_knowledge".into());
    }
    Ok(())
}

pub(super) fn validate_links(
    knowledge: &Knowledge,
    entry: &Entry,
    snapshot: &Snapshot,
) -> Result<()> {
    if knowledge.revision > snapshot.revision
        || knowledge.records.iter().any(|id| {
            id == &entry.id
                || !snapshot
                    .entries
                    .iter()
                    .any(|e| &e.id == id && e.scope == entry.scope)
        })
    {
        return Err("project_invalid_dependency_record".into());
    }
    Ok(())
}

fn location(originals: &Originals) -> Result<(String, WorkspaceEnv)> {
    let profile = &originals.meta["profile"];
    let id = profile["workspaceId"]
        .as_str()
        .ok_or("project_unbound_session")?;
    let env = if id.starts_with("local:") {
        WorkspaceEnv::Local
    } else {
        WorkspaceEnv::Wsl {
            distro: id
                .strip_prefix("wsl:")
                .and_then(|s| s.split_once(':'))
                .ok_or("project_invalid_workspace")?
                .0
                .into(),
        }
    };
    let run = &originals.meta["run"];
    let root = if run["workspaceId"] == profile["workspaceId"] {
        run["checkoutRoot"].as_str()
    } else {
        None
    }
    .or_else(|| profile["workspaceRoot"].as_str())
    .ok_or("project_unbound_session")?;
    Ok((root.into(), env))
}

struct Batch<'a> {
    registry: &'a WorkspaceRegistry,
    root: PathBuf,
    cache: HashMap<String, Result<Observation>>,
    bytes: usize,
    reads: usize,
    started: Instant,
    statuses: HashMap<String, String>,
    active: BTreeSet<String>,
}

impl<'a> Batch<'a> {
    fn new(registry: &'a WorkspaceRegistry, root: &Path) -> Result<Self> {
        let root = fs::canonicalize(root).map_err(|_| "project_source_missing")?;
        if !registry.is_authorized(&root) {
            return Err("project_source_denied".into());
        }
        Ok(Self {
            registry,
            root,
            cache: HashMap::new(),
            bytes: 0,
            reads: 0,
            started: Instant::now(),
            statuses: HashMap::new(),
            active: BTreeSet::new(),
        })
    }
    fn read(&mut self, input: &DependencyInput) -> Result<Observation> {
        if !safe_path(&input.path) {
            return Err("project_secret_or_invalid_path".into());
        }
        if let Some(cached) = self.cache.get(&input.path) {
            let mut observation = cached.clone()?;
            observation.dependency.environment = input.environment;
            return Ok(observation);
        }
        let result = self.read_uncached(input);
        self.cache.insert(input.path.clone(), result.clone());
        result
    }
    fn read_uncached(&mut self, input: &DependencyInput) -> Result<Observation> {
        self.read_observation(input, &mut |_| {})
    }
    fn read_observation(
        &mut self,
        input: &DependencyInput,
        after_read: &mut impl FnMut(usize),
    ) -> Result<Observation> {
        if self.started.elapsed() > Duration::from_secs(10) {
            return Err("project_freshness_budget".into());
        }
        let path = self.root.join(input.path.replace('\\', "/"));
        let canonical = fs::canonicalize(&path).map_err(|_| "project_source_missing")?;
        let name = to_canon(&canonical);
        if !canonical.starts_with(&self.root)
            || !self.registry.is_authorized(&canonical)
            || crate::modules::archive::is_sensitive_archive_path(&name)
        {
            return Err("project_source_denied".into());
        }
        let mut previous = None;
        for _ in 0..2 {
            let file = fs::File::open(&canonical).map_err(|_| "project_source_missing")?;
            let meta = file.metadata().map_err(|_| "project_source_missing")?;
            if !meta.is_file()
                || meta.len() > MAX_FILE as u64
                || self.bytes + MAX_FILE + 1 > MAX_BATCH
            {
                return Err("project_freshness_budget".into());
            }
            let mut bytes = vec![];
            file.take((MAX_FILE + 1) as u64)
                .read_to_end(&mut bytes)
                .map_err(|_| "project_source_missing")?;
            self.reads += 1;
            after_read(self.reads);
            self.bytes += bytes.len();
            if bytes.len() > MAX_FILE {
                return Err("project_freshness_budget".into());
            }
            if let Some(ref previous) = previous {
                if previous != &bytes {
                    return Err("project_source_mutating".into());
                }
            }
            previous = Some(bytes);
        }
        if fs::canonicalize(&path).ok().as_ref() != Some(&canonical) {
            return Err("project_source_mutating".into());
        }
        let bytes = previous.ok_or("project_source_missing")?;
        let text = std::str::from_utf8(&bytes).map_err(|_| "project_text_evidence_required")?;
        if text.contains('\0') || possible_secret(text) {
            return Err("project_possible_secret_denied".into());
        }
        let mut end = text.len().min(MAX_EXCERPT);
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        if end == 0 {
            return Err("project_empty_evidence".into());
        }
        Ok(Observation {
            dependency: Dependency {
                path: input.path.clone(),
                canonical: name,
                content_hash: digest(&bytes),
                slice_hash: digest(&bytes[..end]),
                end,
                environment: input.environment,
            },
            excerpt: text[..end].into(),
            text: text.into(),
        })
    }
}

fn same_checkout(baseline: &str, current: &str) -> bool {
    if baseline == current {
        return true;
    }
    let (Ok((old_root, _, old_branch)), Ok((new_root, _, new_branch))) = (
        serde_json::from_str::<(String, String, String)>(baseline),
        serde_json::from_str::<(String, String, String)>(current),
    ) else {
        return false;
    };
    old_root == new_root && old_branch == new_branch && !old_branch.is_empty()
}

fn compare(
    entry: &Entry,
    git: &str,
    environment: &str,
    batch: &mut Batch<'_>,
) -> (String, Vec<Value>) {
    if entry.status == Publication::Superseded {
        return ("superseded".into(), vec![]);
    }
    if entry.status != Publication::Approved {
        return ("invalidated".into(), vec![]);
    }
    let Some(knowledge) = &entry.knowledge else {
        return ("needs-revalidation".into(), vec![]);
    };
    let mut status = if entry.conflicts.is_empty() {
        "current"
    } else {
        "conflicting"
    };
    if !same_checkout(&knowledge.git_revision, git) || knowledge.environment != environment {
        status = "invalidated";
    }
    if entry.section == "verification" && !knowledge.dependencies.iter().any(|d| d.environment) {
        status = "needs-revalidation";
    }
    let mut evidence = vec![];
    for dependency in &knowledge.dependencies {
        match batch.read(&DependencyInput {
            path: dependency.path.clone(),
            environment: dependency.environment,
        }) {
            Ok(observation) => {
                if observation.dependency != *dependency {
                    status = "invalidated";
                }
                evidence.push(json!({"path":dependency.path,"contentHash":observation.dependency.content_hash,"excerpt":observation.excerpt,"changed":observation.dependency != *dependency}));
            }
            Err(error) => {
                status = if error == "project_source_missing" {
                    "source-missing"
                } else {
                    "needs-revalidation"
                };
                evidence.push(json!({"path":dependency.path,"error":error}));
            }
        }
    }
    (status.into(), evidence)
}

fn conflicting(snapshot: &Snapshot, entry: &Entry) -> bool {
    snapshot.entries.iter().any(|other| {
        other.scope == entry.scope
            && other.status == Publication::Approved
            && (other.conflicts.contains(&entry.id) || entry.conflicts.contains(&other.id))
    })
}

fn install(
    snapshot: &mut Snapshot,
    access: &Access,
    id: &str,
    knowledge: Knowledge,
    confirmed: bool,
) -> Result<()> {
    validate(&knowledge)?;
    if knowledge.verified_by != access.owner.session_id
        || knowledge.revision
            != snapshot
                .revision
                .checked_add(1)
                .ok_or("project_revision_exhausted")?
    {
        return Err("project_stale_knowledge".into());
    }
    let text = snapshot
        .entries
        .iter()
        .find(|e| e.id == id && visible(e, access) && e.status == Publication::Approved)
        .ok_or("project_record_unavailable")?
        .text
        .clone();
    decide(snapshot, access, id, &Decision::Correct { text }, confirmed)?;
    snapshot
        .entries
        .last_mut()
        .ok_or("project_record_unavailable")?
        .knowledge = Some(knowledge);
    Ok(())
}

fn compare_closure(
    snapshot: &Snapshot,
    entry: &Entry,
    git: &str,
    environment: &str,
    batch: &mut Batch<'_>,
    evidence_valid: &mut impl FnMut(&Entry) -> bool,
) -> (String, Vec<Value>) {
    if let Some(status) = batch.statuses.get(&entry.id) {
        return (status.clone(), vec![]);
    }
    if batch.statuses.len() + batch.active.len() >= 16 || !batch.active.insert(entry.id.clone()) {
        return ("needs-revalidation".into(), vec![]);
    }
    let (mut status, evidence) = compare(entry, git, environment, batch);
    if let Some(knowledge) = &entry.knowledge {
        for id in &knowledge.records {
            let current = snapshot.entries.iter().find(|e| {
                &e.id == id && e.scope == entry.scope && e.status == Publication::Approved
            });
            match current {
                None => status = "invalidated".into(),
                Some(source) if source.knowledge.is_some() => {
                    if compare_closure(snapshot, source, git, environment, batch, evidence_valid).0
                        != "current"
                    {
                        status = "invalidated".into();
                    }
                }
                Some(source) => {
                    if !evidence_valid(source)
                        || (source.qualification != Qualification::UserRequirement
                            && source.qualification != Qualification::UserCorrection)
                    {
                        status = "needs-revalidation".into();
                    }
                }
            }
        }
    }
    if conflicting(snapshot, entry) {
        status = "conflicting".into();
    }
    if !evidence_valid(entry) {
        status = "needs-revalidation".into();
    }
    batch.active.remove(&entry.id);
    batch.statuses.insert(entry.id.clone(), status.clone());
    (status, evidence)
}

pub(super) fn decorate(
    app: &tauri::AppHandle,
    snapshot: &Snapshot,
    value: &mut Value,
) -> Result<()> {
    let state = app.state::<FreshnessState>();
    state.index(snapshot)?;
    for item in value["entries"]
        .as_array_mut()
        .ok_or("project_invalid_view")?
    {
        let entry = snapshot
            .entries
            .iter()
            .find(|e| item["id"].as_str() == Some(&e.id))
            .ok_or("project_record_unavailable")?;
        item["knowledge"] = serde_json::to_value(&entry.knowledge).map_err(|e| e.to_string())?;
        let mut status = state.status(entry)?;
        if entry.status == Publication::Superseded {
            status = "superseded".into();
        } else if entry.status != Publication::Approved {
            status = "invalidated".into();
        } else if conflicting(snapshot, entry) {
            status = "conflicting".into();
        } else if entry.knowledge.as_ref().is_some_and(|k| {
            k.records.iter().any(|id| {
                !snapshot.entries.iter().any(|e| {
                    &e.id == id && e.scope == entry.scope && e.status == Publication::Approved
                })
            })
        }) {
            status = "invalidated".into();
        } else if item["sourceState"] != "historical-source-verified" {
            status = "needs-revalidation".into();
        }
        item["freshness"] = json!(status);
    }
    Ok(())
}
