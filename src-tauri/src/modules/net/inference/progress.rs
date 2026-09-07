use serde_json::Value;

// Inspection is bounded and never changes bytes delivered to the SDK.
const MAX_FRAME: usize = 256 * 1024;
#[derive(Default)]
pub struct Progress {
    line: Vec<u8>,
    data: Vec<u8>,
    oversized: bool,
    pub sse: bool,
    pub complete: bool,
    pub done: bool,
}
fn text(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_str)
        .is_some_and(|v| !v.trim().is_empty())
}
fn meaningful(value: &Value) -> bool {
    if value["choices"].as_array().is_some_and(|choices| {
        choices.iter().any(|c| {
            let delta = c.get("delta").or_else(|| c.get("message")).unwrap_or(c);
            text(delta.get("content"))
                || text(delta.get("reasoning_content"))
                || text(delta.get("reasoning"))
                || text(c.get("text"))
                || delta["tool_calls"].as_array().is_some_and(|calls| {
                    calls.iter().any(|c| {
                        text(c["function"].get("arguments")) || text(c["function"].get("name"))
                    })
                })
        })
    }) {
        return true;
    }
    if matches!(value["type"].as_str(), Some("content_block_delta")) {
        return text(value["delta"].get("text"))
            || text(value["delta"].get("thinking"))
            || text(value["delta"].get("partial_json"));
    }
    if matches!(
        value["type"].as_str(),
        Some(
            "response.output_text.delta"
                | "response.reasoning_text.delta"
                | "response.function_call_arguments.delta"
        )
    ) {
        return text(value.get("delta"));
    }
    value["candidates"].as_array().is_some_and(|c| {
        c.iter().any(|c| {
            c["content"]["parts"].as_array().is_some_and(|p| {
                p.iter()
                    .any(|p| text(p.get("text")) || p.get("functionCall").is_some())
            })
        })
    })
}
impl Progress {
    pub fn feed(&mut self, bytes: &[u8]) -> bool {
        let mut progress = false;
        for &byte in bytes {
            if byte == b'\n' {
                let mut line = std::mem::take(&mut self.line);
                if line.last() == Some(&b'\r') {
                    line.pop();
                }
                if line.is_empty() {
                    if !self.oversized && !self.data.is_empty() {
                        let data = std::mem::take(&mut self.data);
                        progress |= self.inspect(&data);
                    }
                    self.data.clear();
                    self.oversized = false;
                } else if let Some(data) = line.strip_prefix(b"data:") {
                    self.sse = true;
                    if self.data.len() + data.len() < MAX_FRAME && !self.oversized {
                        self.data.extend_from_slice(data);
                        self.data.push(b'\n');
                    } else {
                        self.oversized = true;
                        self.data.clear();
                    }
                } else if !self.sse && !self.oversized {
                    progress |= self.inspect(&line);
                }
            } else if self.line.len() < MAX_FRAME && !self.oversized {
                self.line.push(byte);
            } else {
                self.oversized = true;
                self.line.clear();
            }
        }
        progress
    }
    fn inspect(&mut self, bytes: &[u8]) -> bool {
        if bytes
            .iter()
            .copied()
            .filter(|b| !b.is_ascii_whitespace())
            .eq(b"[DONE]".iter().copied())
        {
            self.complete = true;
            self.done = true;
            return false;
        }
        let Ok(value) = serde_json::from_slice::<Value>(bytes) else {
            return false;
        };
        self.complete |= value["choices"].as_array().is_some_and(|c| {
            c.iter()
                .any(|c| c["finish_reason"].as_str().is_some_and(|s| !s.is_empty()))
        }) || matches!(
            value["type"].as_str(),
            Some("message_stop" | "response.completed")
        ) || value["candidates"]
            .as_array()
            .is_some_and(|c| c.iter().any(|c| c.get("finishReason").is_some()));
        meaningful(&value)
    }
    pub fn finish(&mut self) {
        let line = std::mem::take(&mut self.line);
        if !self.oversized && !line.is_empty() {
            self.inspect(&line);
        }
        let data = std::mem::take(&mut self.data);
        if !self.oversized && !data.is_empty() {
            self.inspect(&data);
        }
    }
}
