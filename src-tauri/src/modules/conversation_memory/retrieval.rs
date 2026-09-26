use super::*;
use std::time::{Duration, Instant};

const MAX_BYTES: usize = 64 * 1024;
const MAX_CHUNKS: usize = 12;

struct Bounds {
    bytes: usize,
    chunks: usize,
    attachments: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Chunk {
    evidence: Evidence,
    message_id: String,
    message_index: usize,
    content_id: Option<String>,
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    message_id: String,
    status: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Retrieved {
    chunks: Vec<Chunk>,
    issues: Vec<Issue>,
}

fn sensitive(value: &Value) -> bool {
    match value {
        Value::Object(object) => object.iter().any(|(key, value)| {
            (matches!(
                key.as_str(),
                "path" | "filePath" | "canonicalPath" | "displayName" | "entryPath"
            ) && value.as_str().is_some_and(|path| {
                super::super::archive::is_sensitive_archive_path(&path.replace('\\', "/"))
            })) || sensitive(value)
        }),
        Value::Array(values) => values.iter().any(sensitive),
        _ => false,
    }
}

fn attachment_texts(
    message: &Value,
    content: &Path,
    max_bytes: usize,
    max_chunks: usize,
    started: Instant,
) -> Result<Vec<(String, String)>> {
    let mut texts = Vec::new();
    let mut decoded = 0;
    for part in message["parts"].as_array().into_iter().flatten() {
        if started.elapsed() >= Duration::from_secs(10) {
            return Err("retrieval_timeout".into());
        }
        if part["type"] != "data-clack-attachment" {
            continue;
        }
        let data = &part["data"];
        let reference = match data["contentKind"].as_str() {
            Some("text" | "selection") => data,
            Some("document") => &data["documentRepresentation"]["textContentRef"],
            Some("archive") => &data["archiveRepresentation"]["manifestContentRef"],
            _ => continue,
        };
        let id = reference["contentId"]
            .as_str()
            .or_else(|| reference["id"].as_str())
            .ok_or("retrieval_unsupported_attachment")?;
        if reference["contentHash"].as_str() != Some(id) {
            return Err("retrieval_invalid_content_ref".into());
        }
        let size = reference["byteSize"]
            .as_u64()
            .ok_or("retrieval_invalid_content_size")?;
        if size > max_bytes.saturating_sub(decoded) as u64 || texts.len() >= max_chunks {
            return Err("retrieval_attachment_oversized".into());
        }
        let bytes = read_content_from(content, id)?;
        if reference["byteSize"].as_u64() != Some(bytes.len() as u64) {
            return Err("retrieval_invalid_content_size".into());
        }
        let text = String::from_utf8(bytes).map_err(|_| "retrieval_unsupported_encoding")?;
        decoded += text.len();
        texts.push((id.into(), text));
    }
    Ok(texts)
}

fn retrieve(
    root: &Path,
    content: &Path,
    originals: &Originals,
    expected: &Preparation,
    message_ids: &[String],
    bounds: Bounds,
    started: Instant,
) -> Result<Retrieved> {
    let Bounds {
        bytes: max_bytes,
        chunks: max_chunks,
        attachments,
    } = bounds;
    if message_ids.is_empty()
        || message_ids.len() > MAX_CHUNKS
        || max_bytes > MAX_BYTES
        || max_bytes == 0
        || max_chunks == 0
        || max_chunks > MAX_CHUNKS
    {
        return Err("retrieval_invalid_bounds".into());
    }
    check_owner(originals, &expected.owner)?;
    let manifest = synchronize(root, originals)?;
    if preparation(&manifest, &expected.owner) != *expected {
        return Err("memory_stale_preparation".into());
    }
    let mut result = Retrieved {
        chunks: vec![],
        issues: vec![],
    };
    let mut bytes = 0;
    let mut seen = BTreeSet::new();
    for id in message_ids {
        if !seen.insert(id) {
            continue;
        }
        if started.elapsed() >= Duration::from_secs(10) {
            return Err("retrieval_timeout".into());
        }
        let Some((index, message)) = originals
            .messages
            .iter()
            .enumerate()
            .find(|(_, m)| m["id"].as_str() == Some(id))
        else {
            result.issues.push(Issue {
                message_id: id.clone(),
                status: "missing",
            });
            continue;
        };
        if sensitive(message) {
            result.issues.push(Issue {
                message_id: id.clone(),
                status: "denied",
            });
            continue;
        }
        if !matches!(
            message["role"].as_str(),
            Some("user" | "assistant" | "system")
        ) || !message["parts"].is_array()
        {
            result.issues.push(Issue {
                message_id: id.clone(),
                status: "malformed",
            });
            continue;
        }
        let mut references = BTreeSet::new();
        if content_refs(message, &mut references).is_err() {
            result.issues.push(Issue {
                message_id: id.clone(),
                status: "malformed",
            });
            continue;
        }
        if references.len() > MAX_CHUNKS
            || serde_json::to_vec(message)
                .map_err(|e| e.to_string())?
                .len()
                > max_bytes.saturating_sub(bytes)
        {
            result.issues.push(Issue {
                message_id: id.clone(),
                status: "oversized",
            });
            continue;
        }
        let source = evidence_for(
            root,
            content,
            originals,
            &expected.owner,
            SourceLocator::Message {
                message_id: id.clone(),
            },
        );
        let (evidence, raw) = match source {
            Ok(source) => source,
            Err(error) => {
                result.issues.push(Issue {
                    message_id: id.clone(),
                    status: if error == "memory_evidence_quota" {
                        "oversized"
                    } else {
                        "unavailable-or-corrupt"
                    },
                });
                continue;
            }
        };
        let text = String::from_utf8(raw).map_err(|_| "retrieval_invalid_message")?;
        if text.len() + bytes > max_bytes || result.chunks.len() >= max_chunks {
            result.issues.push(Issue {
                message_id: id.clone(),
                status: "oversized",
            });
            continue;
        }
        bytes += text.len();
        result.chunks.push(Chunk {
            evidence: evidence.clone(),
            message_id: id.clone(),
            message_index: index,
            content_id: None,
            text,
        });
        if attachments {
            match attachment_texts(
                message,
                content,
                max_bytes - bytes,
                max_chunks - result.chunks.len(),
                started,
            ) {
                Ok(texts) => {
                    for (content_id, text) in texts {
                        if bytes + text.len() > max_bytes || result.chunks.len() >= max_chunks {
                            result.issues.push(Issue {
                                message_id: id.clone(),
                                status: "attachment-oversized",
                            });
                            continue;
                        }
                        bytes += text.len();
                        result.chunks.push(Chunk {
                            evidence: evidence.clone(),
                            message_id: id.clone(),
                            message_index: index,
                            content_id: Some(content_id),
                            text,
                        });
                    }
                }
                Err(error) => result.issues.push(Issue {
                    message_id: id.clone(),
                    status: if error == "retrieval_attachment_oversized" {
                        "attachment-oversized"
                    } else {
                        "attachment-unavailable"
                    },
                }),
            }
        }
    }
    if started.elapsed() >= Duration::from_secs(10) {
        return Err("retrieval_timeout".into());
    }
    result.chunks.sort_by_key(|chunk| chunk.message_index);
    Ok(result)
}

#[tauri::command]
pub async fn conversation_memory_retrieve(
    app: tauri::AppHandle,
    state: tauri::State<'_, MemoryState>,
    preparation: Preparation,
    message_ids: Vec<String>,
    max_bytes: usize,
    max_chunks: usize,
    attachments: bool,
) -> Result<Retrieved> {
    let state = state.inner().clone();
    let started = Instant::now();
    blocking(move || {
        let lock = state.owner(&preparation.owner.session_id)?;
        let _owner = lock.lock().map_err(|e| e.to_string())?;
        let originals = originals(&app, &preparation.owner.session_id)?;
        authorize(&app, &originals, &preparation.owner)?;
        let (root, content) = paths(&app)?;
        let result = retrieve(
            &root,
            &content,
            &originals,
            &preparation,
            &message_ids,
            Bounds {
                bytes: max_bytes,
                chunks: max_chunks,
                attachments,
            },
            started,
        )?;
        let current = super::originals(&app, &preparation.owner.session_id)?;
        authorize(&app, &current, &preparation.owner)?;
        if super::preparation(&synchronize(&root, &current)?, &preparation.owner) != preparation {
            return Err("memory_stale_preparation".into());
        }
        Ok(result)
    })
    .await
}

#[cfg(test)]
mod tests;
