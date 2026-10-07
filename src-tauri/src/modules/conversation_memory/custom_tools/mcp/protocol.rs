//! Bounded MCP 2025-06-18 Streamable HTTP. No background stream or replay.
use super::*;
use std::sync::atomic::AtomicU64;

pub(super) const PROTOCOL: &str = "2025-06-18";
const WIRE_LIMIT: usize = 64 * 1024;
static REQUEST_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
pub(super) struct Client {
    pub client: reqwest::Client,
    pub url: reqwest::Url,
    session: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub(super) struct Tool {
    pub name: String,
    pub hash: String,
    pub description: String,
    pub input: Value,
    pub output: Value,
}

#[derive(Clone)]
pub(super) struct Discovery {
    pub server: Value,
    pub tools: Vec<Tool>,
    pub hash: String,
}

fn normalize(value: &Value, depth: usize) -> Result<Value> {
    if depth > 5 || serde_json::to_vec(value).map_err(|_| "mcp-schema")?.len() > 8192 {
        return Err("mcp-schema-limit".into());
    }
    let mut object = value.as_object().ok_or("mcp-schema")?.clone();
    // Declared dialects never authorize fetching schemas or references.
    if let Some(dialect) = object.remove("$schema") {
        if !matches!(
            dialect.as_str(),
            Some(
                "https://json-schema.org/draft/2020-12/schema"
                    | "http://json-schema.org/draft-07/schema#"
            )
        ) {
            return Err("mcp-schema-dialect".into());
        }
    }
    match object.get("type").and_then(Value::as_str) {
        Some("object") => {
            object.entry("additionalProperties").or_insert(json!(false));
            let properties = object.entry("properties").or_insert(json!({}));
            for value in properties.as_object_mut().ok_or("mcp-schema")?.values_mut() {
                *value = normalize(value, depth + 1)?;
            }
        }
        Some("array") => {
            object.entry("maxItems").or_insert(json!(64));
            let items = object.get_mut("items").ok_or("mcp-schema")?;
            *items = normalize(items, depth + 1)?;
        }
        Some("string") => {
            object.entry("maxLength").or_insert(json!(8192));
        }
        _ => {}
    }
    let value = Value::Object(object);
    schema(&value, 0, &mut 0).map_err(|_| "mcp-unsupported-schema")?;
    Ok(value)
}

fn tool(raw: &Value) -> Result<Tool> {
    if serde_json::to_vec(raw).map_err(|_| "mcp-tool")?.len() > 16 * 1024 {
        return Err("mcp-tool-limit".into());
    }
    let name = raw["name"].as_str().ok_or("mcp-tool-name")?;
    if name.is_empty()
        || name.len() > 64
        || !name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
    {
        return Err("mcp-tool-name".into());
    }
    let description = raw
        .get("description")
        .map(|v| v.as_str().ok_or("mcp-description"))
        .transpose()?
        .unwrap_or("MCP tool");
    bounded(description, 2048).map_err(|_| "mcp-description-limit")?;
    let input = normalize(&raw["inputSchema"], 0)?;
    if input["type"] != "object" {
        return Err("mcp-schema-input-object".into());
    }
    let mut output = json!({"type":"object","additionalProperties":false,"properties":{
        "content":{"type":"array","maxItems":16,"items":{"type":"string","maxLength":8192}},
        "isError":{"type":"boolean"}
    },"required":["content","isError"]});
    if let Some(value) = raw.get("outputSchema") {
        let structured = normalize(value, 1)?;
        if structured["type"] != "object" {
            return Err("mcp-schema-output-object".into());
        }
        output["properties"]["structuredContent"] = structured;
    }
    schema(&output, 0, &mut 0).map_err(|_| "mcp-unsupported-schema")?;
    Ok(Tool {
        name: name.into(),
        description: description.into(),
        input,
        output,
        hash: digest(&serde_json::to_vec(raw).map_err(|_| "mcp-tool")?),
    })
}

fn session_header(response: &reqwest::Response) -> Result<Option<String>> {
    response
        .headers()
        .get("mcp-session-id")
        .map(|v| {
            let value = v.to_str().map_err(|_| "mcp-session")?;
            if value.is_empty()
                || value.len() > 128
                || !value.bytes().all(|b| (0x21..=0x7e).contains(&b))
            {
                return Err("mcp-session".into());
            }
            Ok(value.to_string())
        })
        .transpose()
}

#[derive(Debug)]
enum Incoming {
    Result(Value),
    Request { id: Value, ping: bool },
}

fn message(value: Value, id: u64) -> Result<Option<Incoming>> {
    if value["jsonrpc"] != "2.0" || !value.is_object() {
        return Err("mcp-malformed-rpc".into());
    }
    if let Some(method) = value.get("method") {
        if let Some(id) = value.get("id") {
            if !(id.is_i64() || id.is_u64() || id.as_str().is_some_and(|s| bounded(s, 128).is_ok()))
                || !method.is_string()
            {
                return Err("mcp-malformed-rpc".into());
            }
            return Ok(Some(Incoming::Request {
                id: id.clone(),
                ping: method == "ping",
            }));
        }
        return match method.as_str() {
            Some("notifications/progress" | "notifications/message") => Ok(None),
            Some("notifications/tools/list_changed") => Err("mcp-discovery-changed".into()),
            _ => Err("mcp-unsupported-notification".into()),
        };
    }
    if value["id"] != id || value.get("result").is_some() == value.get("error").is_some() {
        return Err("mcp-response-identity".into());
    }
    if value.get("error").is_some() {
        return Err("mcp-server-error".into());
    }
    Ok(Some(Incoming::Result(value["result"].clone())))
}

#[derive(Default)]
struct Events {
    buffer: Vec<u8>,
    bytes: usize,
    events: usize,
}
impl Events {
    fn push(&mut self, chunk: &[u8], id: u64) -> Result<Option<Incoming>> {
        self.bytes += chunk.len();
        if self.bytes > WIRE_LIMIT {
            return Err("mcp-response-limit".into());
        }
        self.buffer.extend_from_slice(chunk);
        loop {
            let boundary = self
                .buffer
                .windows(2)
                .position(|w| w == b"\n\n")
                .map(|n| (n, 2))
                .into_iter()
                .chain(
                    self.buffer
                        .windows(4)
                        .position(|w| w == b"\r\n\r\n")
                        .map(|n| (n, 4)),
                )
                .min();
            let Some((end, length)) = boundary else {
                return Ok(None);
            };
            self.events += 1;
            if self.events > 32 {
                return Err("mcp-event-limit".into());
            }
            let event = std::str::from_utf8(&self.buffer[..end]).map_err(|_| "mcp-encoding")?;
            let mut data = Vec::new();
            for line in event.lines() {
                if let Some(value) = line.strip_prefix("event:") {
                    if value.trim() != "message" {
                        return Err("mcp-unsupported-event".into());
                    }
                }
                if let Some(value) = line.strip_prefix("data:") {
                    data.push(value.strip_prefix(' ').unwrap_or(value));
                }
            }
            let value = if data.is_empty() {
                None
            } else {
                message(
                    serde_json::from_str(&data.join("\n")).map_err(|_| "mcp-malformed-json")?,
                    id,
                )?
            };
            self.buffer.drain(..end + length);
            if value.is_some() {
                return Ok(value);
            }
        }
    }
}

impl Client {
    async fn acknowledge(&self, incoming: Incoming, secret: Option<&str>) -> Result<Option<Value>> {
        match incoming {
            Incoming::Result(value) => Ok(Some(value)),
            Incoming::Request { id, ping } => {
                let body = if ping {
                    json!({"jsonrpc":"2.0","id":id,"result":{}})
                } else {
                    json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"Client capability not supported"}})
                };
                let mut response = self.post(body, secret).await?;
                if response.status().as_u16() != 202
                    || response
                        .chunk()
                        .await
                        .map_err(|_| "mcp-network-failed")?
                        .is_some()
                {
                    return Err("mcp-notification-response".into());
                }
                if !ping {
                    return Err("mcp-unsupported-server-request".into());
                }
                Ok(None)
            }
        }
    }
    #[cfg(test)]
    pub(super) fn fixture(endpoint: &str) -> Self {
        Self {
            client: crate::modules::net::custom_tool_transport()
                .build()
                .unwrap(),
            url: endpoint.parse().unwrap(),
            session: None,
        }
    }
    pub async fn secure(endpoint: &str) -> Result<Self> {
        let (client, url) = crate::modules::net::custom_tool_client(endpoint).await?;
        Ok(Self {
            client,
            url,
            session: None,
        })
    }

    async fn post(&self, body: Value, secret: Option<&str>) -> Result<reqwest::Response> {
        let mut request = self
            .client
            .post(self.url.clone())
            .header("Accept", "application/json, text/event-stream")
            .header("MCP-Protocol-Version", PROTOCOL)
            .header("Content-Type", "application/json")
            .body(serde_json::to_vec(&body).map_err(|_| "mcp-request")?);
        if let Some(session) = &self.session {
            request = request.header("Mcp-Session-Id", session);
        }
        if let Some(secret) = secret {
            request = request.bearer_auth(secret);
        }
        let response = request.send().await.map_err(|_| "mcp-network-failed")?;
        match response.status().as_u16() {
            401 | 403 => return Err("mcp-auth-failed".into()),
            404 => return Err("mcp-disconnected".into()),
            200..=299 => {}
            _ => return Err("mcp-http-failed".into()),
        }
        if self.session.is_some()
            && session_header(&response)?.is_some_and(|s| Some(s) != self.session)
        {
            return Err("mcp-session-changed".into());
        }
        Ok(response)
    }

    async fn rpc(
        &self,
        method: &str,
        params: Value,
        secret: Option<&str>,
    ) -> Result<(Value, Option<String>)> {
        let id = REQUEST_ID.fetch_add(1, Ordering::Relaxed);
        let mut response = self
            .post(
                json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}),
                secret,
            )
            .await?;
        let session = session_header(&response)?;
        let mime = response
            .headers()
            .get("content-type")
            .and_then(|h| h.to_str().ok())
            .unwrap_or("")
            .split(';')
            .next()
            .unwrap_or("")
            .trim();
        let sse = match mime {
            "application/json" => false,
            "text/event-stream" => true,
            _ => return Err("mcp-content-type".into()),
        };
        if response
            .content_length()
            .is_some_and(|n| n > WIRE_LIMIT as u64)
        {
            return Err("mcp-response-limit".into());
        }
        let mut bytes = Vec::new();
        let mut events = Events::default();
        let mut channel = self.clone();
        if channel.session.is_none() {
            channel.session = session.clone();
        }
        while let Some(chunk) = response.chunk().await.map_err(|_| "mcp-network-failed")? {
            if sse {
                let mut incoming = events.push(&chunk, id)?;
                while let Some(message) = incoming {
                    if let Some(value) = channel.acknowledge(message, secret).await? {
                        return Ok((value, session));
                    }
                    incoming = events.push(&[], id)?;
                }
            } else {
                if bytes.len() + chunk.len() > WIRE_LIMIT {
                    return Err("mcp-response-limit".into());
                }
                bytes.extend_from_slice(&chunk);
            }
        }
        if sse {
            return Err("mcp-incomplete-stream".into());
        }
        let value = message(
            serde_json::from_slice(&bytes).map_err(|_| "mcp-malformed-json")?,
            id,
        )?
        .ok_or("mcp-missing-result")?;
        Ok((
            channel
                .acknowledge(value, secret)
                .await?
                .ok_or("mcp-missing-result")?,
            session,
        ))
    }

    pub async fn initialize(&mut self, secret: Option<&str>) -> Result<Discovery> {
        let (value, session) = self
            .rpc(
                "initialize",
                json!({"protocolVersion":PROTOCOL,"capabilities":{},
            "clientInfo":{"name":"Clack","version":env!("CARGO_PKG_VERSION")}}),
                secret,
            )
            .await?;
        let value = execution::redact_mcp(value, secret);
        if value["protocolVersion"] != PROTOCOL || !value["capabilities"]["tools"].is_object() {
            return Err("mcp-incompatible".into());
        }
        bounded(
            value["serverInfo"]["name"]
                .as_str()
                .ok_or("mcp-server-info")?,
            128,
        )?;
        bounded(
            value["serverInfo"]["version"]
                .as_str()
                .ok_or("mcp-server-info")?,
            128,
        )?;
        let server =
            json!({"name":value["serverInfo"]["name"],"version":value["serverInfo"]["version"]});
        self.session = session;
        let mut response = self
            .post(
                json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
                secret,
            )
            .await?;
        if response.status().as_u16() != 202
            || response
                .chunk()
                .await
                .map_err(|_| "mcp-network-failed")?
                .is_some()
        {
            return Err("mcp-notification-response".into());
        }
        self.discover(server, secret).await
    }

    pub async fn discover(&self, server: Value, secret: Option<&str>) -> Result<Discovery> {
        let mut tools = Vec::new();
        let mut names = BTreeSet::new();
        let mut cursors = BTreeSet::new();
        let mut params = json!({});
        for page in 0..4 {
            let (value, _) = self.rpc("tools/list", params, secret).await?;
            let value = execution::redact_mcp(value, secret);
            for raw in value["tools"].as_array().ok_or("mcp-tools-list")? {
                if tools.len() == 16 {
                    return Err("mcp-tool-count".into());
                }
                let item = tool(raw)?;
                if !names.insert(item.name.clone()) {
                    return Err("mcp-duplicate-tool".into());
                }
                tools.push(item);
            }
            let Some(cursor) = value.get("nextCursor") else {
                tools.sort_by(|a, b| a.name.cmp(&b.name));
                let hash = digest(
                    &serde_json::to_vec(&json!({"server":server,"tools":tools}))
                        .map_err(|_| "mcp-discovery")?,
                );
                return Ok(Discovery {
                    server,
                    tools,
                    hash,
                });
            };
            let cursor = cursor.as_str().ok_or("mcp-cursor")?;
            bounded(cursor, 256)?;
            if page == 3 || !cursors.insert(cursor.to_string()) {
                return Err("mcp-pagination-limit".into());
            }
            params = json!({"cursor":cursor});
        }
        Err("mcp-pagination-limit".into())
    }

    pub async fn call(&self, tool: &str, arguments: &Value, secret: Option<&str>) -> Result<Value> {
        let (value, _) = self
            .rpc(
                "tools/call",
                json!({"name":tool,"arguments":arguments}),
                secret,
            )
            .await?;
        let items = value["content"].as_array().ok_or("mcp-result")?;
        if items.len() > 16 {
            return Err("mcp-result-limit".into());
        }
        let mut content = Vec::new();
        for item in items {
            if item["type"] != "text" {
                return Err("mcp-unsupported-result-content".into());
            }
            let text = item["text"].as_str().ok_or("mcp-result")?;
            if text.len() > 8192 {
                return Err("mcp-result-limit".into());
            }
            content.push(text);
        }
        let is_error = value
            .get("isError")
            .map(|v| v.as_bool().ok_or("mcp-result"))
            .transpose()?
            .unwrap_or(false);
        if is_error {
            return Err("mcp-tool-error".into());
        }
        let mut result = json!({"content":content,"isError":is_error});
        if let Some(structured) = value.get("structuredContent") {
            result["structuredContent"] = structured.clone();
        }
        if serde_json::to_vec(&result).map_err(|_| "mcp-result")?.len() > 16 * 1024 {
            return Err("mcp-result-limit".into());
        }
        Ok(execution::redact_mcp(result, secret))
    }

    pub async fn close(&self, secret: Option<&str>) {
        if let Some(session) = &self.session {
            let mut request = self
                .client
                .delete(self.url.clone())
                .header("Mcp-Session-Id", session)
                .header("MCP-Protocol-Version", PROTOCOL);
            if let Some(secret) = secret {
                request = request.bearer_auth(secret);
            }
            let _ = tokio::time::timeout(Duration::from_secs(2), request.send()).await;
        }
    }
}

#[cfg(test)]
mod tests;
