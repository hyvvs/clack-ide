use super::{
    metadata::*,
    transport::{route_url, Transport},
    ProbeState,
};
use crate::modules::net::inference::{InferenceState, Lease};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, time::Duration};

pub const MAX_CANDIDATES: usize = 8;
const MAX_ADDRESS_BYTES: usize = 2048;
const MAX_INVENTORY_RECORDS: usize = 128;
const DISCOVERY_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiscoveryOptions {
    addresses: Vec<String>,
    #[serde(default)]
    allow_private_network: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    #[serde(rename = "baseURL")]
    base_url: String,
    backend_hint: Option<Backend>,
    source: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Issue {
    index: usize,
    code: ErrorCode,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryResult {
    candidates: Vec<Candidate>,
    issues: Vec<Issue>,
    timed_out: bool,
}

fn normalize(address: &str) -> Result<Endpoint, ProbeError> {
    if address.len() > MAX_ADDRESS_BYTES {
        return Err(ProbeError::new(ErrorCode::UnsafeEndpoint));
    }
    let mut endpoint = Endpoint {
        id: "discovery".into(),
        base_url: address.into(),
        backend_hint: None,
        detected_backend: None,
        credential_ref: None,
        configuration_revision: 1,
        enabled: true,
        deleted_at: None,
    };
    // Apply the same URL guards and route construction as normal setup before DNS.
    route_url(&endpoint, Route::CompatibleModels)?;
    let mut url = Url::parse(address).map_err(|_| ProbeError::new(ErrorCode::UnsafeEndpoint))?;
    if url.port() == Some(0) {
        return Err(ProbeError::new(ErrorCode::UnsafeEndpoint));
    }
    let path = url.path().trim_end_matches('/');
    let path = if path.is_empty() { "/v1" } else { path }.to_owned();
    url.set_path(&path);
    endpoint.base_url = url.to_string();
    if endpoint.base_url.len() > MAX_ADDRESS_BYTES {
        return Err(ProbeError::new(ErrorCode::UnsafeEndpoint));
    }
    Ok(endpoint)
}

async fn inspect(
    transport: &Transport,
    endpoint: &Endpoint,
    private: bool,
) -> Result<Candidate, ProbeError> {
    let mut requests = 0;
    let mut last = ProbeError::new(ErrorCode::UnsupportedProbeRoute);
    for route in [Route::CompatibleModels, Route::OllamaTags] {
        match transport
            .discover(endpoint, route, private, &mut requests)
            .await
        {
            Ok(value) => {
                let key = if route == Route::OllamaTags {
                    "models"
                } else {
                    "data"
                };
                let list = value[key]
                    .as_array()
                    .filter(|a| a.len() <= MAX_INVENTORY_RECORDS);
                if list.is_none() || inventory(endpoint, route, None, &value, 0).is_err() {
                    last = ProbeError::metadata();
                    continue;
                }
                return Ok(Candidate {
                    base_url: endpoint.base_url.clone(),
                    backend_hint: (route == Route::OllamaTags).then_some(Backend::Ollama),
                    source: if route == Route::OllamaTags {
                        "user-address/ollama-inventory"
                    } else {
                        "user-address/compatible-inventory"
                    },
                });
            }
            Err(error) if error.code == ErrorCode::AuthenticationFailed => {
                return Ok(Candidate {
                    base_url: endpoint.base_url.clone(),
                    backend_hint: None,
                    source: "user-address/authentication-required",
                });
            }
            Err(error) => {
                let retry = error.code == ErrorCode::UnsupportedProbeRoute;
                last = error;
                if !retry {
                    break;
                }
            }
        }
    }
    Err(last)
}

pub(super) async fn discover(
    transport: &Transport,
    options: DiscoveryOptions,
    lease: &Lease,
    duration: Duration,
) -> Result<DiscoveryResult, ProbeError> {
    if options.addresses.is_empty() || options.addresses.len() > MAX_CANDIDATES {
        return Err(ProbeError::new(ErrorCode::RequestLimit));
    }
    if lease.cancelled() {
        return Err(ProbeError::new(ErrorCode::Cancelled));
    }
    let mut result = DiscoveryResult::default();
    let mut seen = HashSet::new();
    let work = async {
        for (index, address) in options.addresses.iter().enumerate() {
            match normalize(address) {
                Ok(endpoint) if seen.insert(endpoint.base_url.clone()) => {
                    match inspect(transport, &endpoint, options.allow_private_network).await {
                        Ok(candidate) => result.candidates.push(candidate),
                        Err(error) => result.issues.push(Issue {
                            index,
                            code: error.code,
                        }),
                    }
                }
                Ok(_) => {}
                Err(error) => result.issues.push(Issue {
                    index,
                    code: error.code,
                }),
            }
        }
    };
    tokio::select! {
        biased;
        _ = lease.cancellation() => return Err(ProbeError::new(ErrorCode::Cancelled)),
        outcome = tokio::time::timeout(duration, work) => {
            result.timed_out = outcome.is_err();
        }
    }
    if lease.cancelled() {
        return Err(ProbeError::new(ErrorCode::Cancelled));
    }
    Ok(result)
}

#[tauri::command]
pub async fn self_hosted_discover(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, InferenceState>,
    probes: tauri::State<'_, ProbeState>,
    request_id: String,
    options: DiscoveryOptions,
) -> Result<DiscoveryResult, ProbeError> {
    let lease = state
        .start(window.label(), &request_id)
        .map_err(|_| ProbeError::new(ErrorCode::Cancelled))?;
    discover(&probes.transport, options, &lease, DISCOVERY_TIMEOUT).await
}
