use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;

pub const MAX_RECORDS: usize = 5_000;
pub const MAX_NAME: usize = 1024;
pub const MAX_METADATA_BYTES: usize = 8 * 1024 * 1024;
pub const INVENTORY_TTL_MS: u64 = 300_000;
pub const INSTANCE_TTL_MS: u64 = 30_000;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Backend {
    Ollama,
    Lmstudio,
    Vllm,
    Mlx,
    OpenaiCompatible,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum CredentialRef {
    Provider {
        #[serde(rename = "providerId")]
        provider_id: String,
    },
    CustomEndpoint {
        #[serde(rename = "endpointId")]
        endpoint_id: String,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Endpoint {
    pub id: String,
    #[serde(rename = "baseURL")]
    pub base_url: String,
    pub backend_hint: Option<Backend>,
    pub credential_ref: Option<CredentialRef>,
    pub configuration_revision: u64,
    pub deleted_at: Option<u64>,
}

impl Endpoint {
    pub fn account(&self) -> Result<Option<String>, ProbeError> {
        match &self.credential_ref {
            None => Ok(None),
            Some(CredentialRef::Provider { provider_id }) if provider_id == "openai-compatible" => {
                Ok(Some("openai-compatible-api-key".into()))
            }
            Some(CredentialRef::CustomEndpoint { endpoint_id })
                if !endpoint_id.is_empty() && endpoint_id.len() <= 2048 =>
            {
                Ok(Some(format!("compat-{endpoint_id}-api-key")))
            }
            _ => Err(ProbeError::new(ErrorCode::InvalidConfiguration)),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ErrorCode {
    Unreachable,
    DnsFailure,
    Timeout,
    TlsFailure,
    AuthenticationFailed,
    InvalidServerResponse,
    UnsupportedProbeRoute,
    ResponseTooLarge,
    MalformedMetadata,
    Cancelled,
    UnsafeEndpoint,
    InvalidConfiguration,
    RequestLimit,
    Busy,
    PersistenceFailed,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProbeError {
    pub code: ErrorCode,
    pub status_code: Option<u16>,
    pub reachable: bool,
}
impl ProbeError {
    pub fn new(code: ErrorCode) -> Self {
        Self {
            code,
            status_code: None,
            reachable: false,
        }
    }
    pub fn http(code: ErrorCode, status: u16) -> Self {
        Self {
            code,
            status_code: Some(status),
            reachable: true,
        }
    }
    pub fn metadata() -> Self {
        Self::http(ErrorCode::MalformedMetadata, 200)
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Support {
    Supported,
    Unsupported,
    Unknown,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scope {
    pub endpoint_id: String,
    pub transport_model_id: String,
    pub deployment_id: Option<String>,
    pub configuration_revision: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    pub metric: String,
    pub value: Value,
    pub source: String,
    pub observed_at: u64,
    pub confidence: String,
    pub scope: Scope,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    pub id: String,
    pub name: Option<String>,
    pub chat: Support,
    pub evidence: Vec<Evidence>,
}
impl Model {
    fn new(id: String) -> Self {
        Self {
            id,
            name: None,
            chat: Support::Unknown,
            evidence: vec![],
        }
    }
    fn add(
        &mut self,
        endpoint: &Endpoint,
        at: u64,
        instance: Option<&str>,
        metric: &str,
        value: Value,
        advertised: bool,
    ) {
        self.evidence.push(Evidence {
            metric: format!("probe.{metric}"),
            value,
            source: if advertised {
                "advertised"
            } else {
                "backend-reported"
            }
            .into(),
            observed_at: at,
            confidence: "reported".into(),
            scope: Scope {
                endpoint_id: endpoint.id.clone(),
                transport_model_id: self.id.clone(),
                deployment_id: instance.map(str::to_owned),
                configuration_revision: endpoint.configuration_revision,
            },
        });
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Route {
    OllamaTags,
    OllamaShow,
    OllamaPs,
    LmV1,
    LmV0,
    CompatibleModels,
}
impl Route {
    pub fn suffix(self) -> &'static str {
        match self {
            Self::OllamaTags => "api/tags",
            Self::OllamaShow => "api/show",
            Self::OllamaPs => "api/ps",
            Self::LmV1 => "api/v1/models",
            Self::LmV0 => "api/v0/models",
            Self::CompatibleModels => "models",
        }
    }
}

pub fn name(value: &Value) -> Result<String, ProbeError> {
    let text = value.as_str().ok_or_else(ProbeError::metadata)?;
    if text.trim().is_empty() || text.len() > MAX_NAME || text.chars().any(char::is_control) {
        return Err(ProbeError::metadata());
    }
    Ok(text.into())
}
fn records<'a>(value: &'a Value, key: &str) -> Result<&'a [Value], ProbeError> {
    let list = value
        .get(key)
        .and_then(Value::as_array)
        .ok_or_else(ProbeError::metadata)?;
    if list.len() > MAX_RECORDS {
        return Err(ProbeError::metadata());
    }
    Ok(list)
}
fn number(value: &Value) -> Result<Option<Value>, ProbeError> {
    if value.is_null() {
        return Ok(None);
    }
    let n = value
        .as_u64()
        .filter(|v| *v > 0 && *v <= 9_007_199_254_740_991)
        .ok_or_else(ProbeError::metadata)?;
    Ok(Some(json!(n)))
}
fn numeric(
    model: &mut Model,
    endpoint: &Endpoint,
    at: u64,
    instance: Option<&str>,
    metric: &str,
    value: &Value,
    advertised: bool,
) -> Result<(), ProbeError> {
    if let Some(value) = number(value)? {
        model.add(endpoint, at, instance, metric, value, advertised);
    }
    Ok(())
}

pub fn inventory(
    endpoint: &Endpoint,
    route: Route,
    selected: Option<&str>,
    value: &Value,
    at: u64,
) -> Result<Vec<Model>, ProbeError> {
    let key = if matches!(route, Route::OllamaTags | Route::LmV1) {
        "models"
    } else {
        "data"
    };
    let mut models = vec![];
    let mut bytes = 0;
    let mut ids = HashSet::new();
    for record in records(value, key)? {
        let id = name(
            &record[match route {
                Route::OllamaTags => "name",
                Route::LmV1 => "key",
                _ => "id",
            }],
        )?;
        if !ids.insert(id.clone()) {
            return Err(ProbeError::metadata());
        }
        let mut model = Model::new(id);
        model.add(endpoint, at, None, "listed", json!(true), false);
        if route == Route::LmV1 {
            if !record["display_name"].is_null() {
                model.name = Some(name(&record["display_name"])?);
            }
            model.chat = match record["type"].as_str() {
                Some("llm") => Support::Supported,
                Some("embedding") => Support::Unsupported,
                _ => return Err(ProbeError::metadata()),
            };
            numeric(
                &mut model,
                endpoint,
                at,
                None,
                "advertisedContext",
                &record["max_context_length"],
                true,
            )?;
            for (key, metric) in [
                ("vision", "vision"),
                ("trained_for_tool_use", "trainedForTools"),
            ] {
                if !record["capabilities"][key].is_null() {
                    let capability = record["capabilities"][key]
                        .as_bool()
                        .ok_or_else(ProbeError::metadata)?;
                    model.add(endpoint, at, None, metric, json!(capability), true);
                }
            }
            if !record["loaded_instances"].is_null() {
                let instances = record["loaded_instances"]
                    .as_array()
                    .filter(|v| v.len() <= 16)
                    .ok_or_else(ProbeError::metadata)?;
                model.add(
                    endpoint,
                    at,
                    None,
                    "loaded",
                    json!(!instances.is_empty()),
                    false,
                );
                for instance in instances {
                    let id = name(&instance["id"])?;
                    numeric(
                        &mut model,
                        endpoint,
                        at,
                        Some(&id),
                        "loadedContext",
                        &instance["config"]["context_length"],
                        false,
                    )?;
                    numeric(
                        &mut model,
                        endpoint,
                        at,
                        Some(&id),
                        "reportedParallel",
                        &instance["config"]["parallel"],
                        false,
                    )?;
                }
            }
        } else if route == Route::LmV0 {
            model.chat = match record["type"].as_str() {
                Some("llm" | "vlm") => Support::Supported,
                Some("embeddings" | "embedding") => Support::Unsupported,
                _ => Support::Unknown,
            };
            numeric(
                &mut model,
                endpoint,
                at,
                None,
                "advertisedContext",
                &record["max_context_length"],
                true,
            )?;
            match record["state"].as_str() {
                Some("loaded") => model.add(endpoint, at, None, "loaded", json!(true), false),
                Some("not-loaded") => model.add(endpoint, at, None, "loaded", json!(false), false),
                _ => {}
            }
        } else if route == Route::CompatibleModels {
            if record["object"].as_str().is_some_and(|v| v != "model") {
                return Err(ProbeError::metadata());
            }
            if !record["name"].is_null() {
                model.name = Some(name(&record["name"])?);
            }
            if endpoint.backend_hint == Some(Backend::Vllm)
                && selected == Some(&model.id)
                && record["object"] == "model"
            {
                numeric(
                    &mut model,
                    endpoint,
                    at,
                    None,
                    "configuredContext",
                    &record["max_model_len"],
                    false,
                )?;
            }
            if let Some(created) = record["created"]
                .as_u64()
                .filter(|n| *n <= 9_007_199_254_740_991)
            {
                model.add(endpoint, at, None, "created", json!(created), false);
            }
        }
        account_model_bytes(&model, &mut bytes)?;
        models.push(model);
    }
    Ok(models)
}

fn account_model_bytes(model: &Model, bytes: &mut usize) -> Result<(), ProbeError> {
    *bytes += serde_json::to_vec(model)
        .map_err(|_| ProbeError::metadata())?
        .len();
    if *bytes > MAX_METADATA_BYTES {
        return Err(ProbeError::http(ErrorCode::ResponseTooLarge, 200));
    }
    Ok(())
}

pub fn ollama_show(
    endpoint: &Endpoint,
    model: &mut Model,
    value: &Value,
    at: u64,
) -> Result<(), ProbeError> {
    if !value.is_object()
        || !(value["capabilities"].is_array()
            || value["model_info"].is_object()
            || value["details"].is_object())
    {
        return Err(ProbeError::metadata());
    }
    if let Some(caps) = value["capabilities"].as_array() {
        if caps.len() > 32 || caps.iter().any(|v| name(v).is_err()) {
            return Err(ProbeError::metadata());
        }
        for (cap, metric) in [("vision", "vision"), ("tools", "trainedForTools")] {
            model.add(
                endpoint,
                at,
                None,
                metric,
                json!(caps.iter().any(|v| v == cap)),
                true,
            );
        }
        model.chat = if caps.iter().any(|v| v == "completion") {
            Support::Supported
        } else {
            Support::Unsupported
        };
    }
    let info = &value["model_info"];
    if let Some(arch) = info["general.architecture"].as_str() {
        name(&json!(arch))?;
        numeric(
            model,
            endpoint,
            at,
            None,
            "advertisedContext",
            &info[format!("{arch}.context_length")],
            true,
        )?;
    }
    Ok(())
}

pub fn ollama_ps(
    endpoint: &Endpoint,
    models: &mut [Model],
    value: &Value,
    at: u64,
) -> Result<(), ProbeError> {
    let mut loaded = std::collections::HashMap::new();
    for record in records(value, "models")? {
        let id = name(&record["name"])?;
        let context = number(&record["context_length"])?;
        if loaded.insert(id, context).is_some() {
            return Err(ProbeError::metadata());
        }
    }
    let mut bytes = 0;
    for model in models {
        model.add(
            endpoint,
            at,
            None,
            "loaded",
            json!(loaded.contains_key(&model.id)),
            false,
        );
        if let Some(Some(context)) = loaded.get(&model.id) {
            // Ollama exposes no stable instance ID. Never invent one from the model digest.
            model.add(endpoint, at, None, "loadedContext", context.clone(), false);
        }
        account_model_bytes(model, &mut bytes)?;
    }
    Ok(())
}
