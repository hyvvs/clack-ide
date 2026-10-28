//! Opt-in acceptance metadata at reqwest body delivery, not physical socket receive.
#[derive(Clone, Copy, serde::Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Kind {
    // Application-level boundaries only. In particular, reqwest's send future
    // does not expose socket connect or request-write completion timestamps.
    ResolveStart,
    ResolveEnd,
    RequestBuilt,
    SendAwaitStart,
    Dispatch,
    Headers,
    Body,
    MeaningfulProgress,
    IpcAttempt,
    IpcForwarded,
    IpcRejected,
    ProviderDone,
    Eof,
    CancellationObserved,
    DeadlineObserved,
    TransportError,
    Completed,
    Failed,
    FutureDropped,
}

#[cfg(debug_assertions)]
mod enabled {
    use super::Kind;
    use serde::Serialize;
    use std::{collections::VecDeque, sync::Arc, time::Instant};

    pub const MAX_EVENTS: usize = 8192;

    #[derive(Clone, Serialize, Debug)]
    #[serde(rename_all = "camelCase")]
    pub struct Stamp {
        pub kind: Kind,
        pub at: u64,
        pub elapsed_us: u64,
        pub sequence: u64,
        pub bytes: usize,
    }

    #[derive(Serialize, Debug)]
    #[serde(rename_all = "camelCase")]
    pub struct Snapshot {
        pub boundary: &'static str,
        pub request_id: String,
        pub events: VecDeque<Stamp>,
        pub dropped_events: u64,
        pub body_chunks: u64,
        pub body_bytes: u64,
        pub last_body: Option<Stamp>,
        pub last_forwarded: Option<Stamp>,
    }

    type Sink = Arc<dyn Fn(&Snapshot) + Send + Sync>;

    /// Only the invisible acceptance example installs this state. No IPC enable route.
    pub struct AcceptanceDiagnostics(Sink, Option<Sink>);
    impl AcceptanceDiagnostics {
        pub fn new(sink: impl Fn(&Snapshot) + Send + Sync + 'static) -> Self {
            Self(Arc::new(sink), None)
        }
        /// Debug acceptance-host-only event tap. Never installed in a normal app.
        /// It preserves partial evidence even if a stream never reaches EOF.
        pub fn new_live(
            completed: impl Fn(&Snapshot) + Send + Sync + 'static,
            each_event: impl Fn(&Snapshot) + Send + Sync + 'static,
        ) -> Self {
            Self(Arc::new(completed), Some(Arc::new(each_event)))
        }
        pub(crate) fn request(&self, id: &str) -> Trace {
            if id.len() > 64 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
                return Trace::default();
            }
            Trace(Some(Box::new(Recording {
                sink: self.0.clone(),
                live_sink: self.1.clone(),
                start: Instant::now(),
                snapshot: Snapshot {
                    boundary: "reqwest-http-body-delivery",
                    request_id: id.into(),
                    events: VecDeque::new(),
                    dropped_events: 0,
                    body_chunks: 0,
                    body_bytes: 0,
                    last_body: None,
                    last_forwarded: None,
                },
            })))
        }
    }

    struct Recording {
        sink: Sink,
        live_sink: Option<Sink>,
        start: Instant,
        snapshot: Snapshot,
    }

    #[derive(Default)]
    pub(crate) struct Trace(Option<Box<Recording>>);
    impl Trace {
        pub fn from_app(app: &tauri::AppHandle, id: &str) -> Self {
            use tauri::Manager;
            app.try_state::<AcceptanceDiagnostics>()
                .map(|s| s.request(id))
                .unwrap_or_default()
        }
        pub fn record(&mut self, kind: Kind, bytes: usize) {
            let Some(recording) = &mut self.0 else { return };
            let snapshot = &mut recording.snapshot;
            if kind == Kind::Body {
                snapshot.body_chunks += 1;
                snapshot.body_bytes += bytes as u64;
            }
            let stamp = Stamp {
                kind,
                at: super::super::admission::now(),
                elapsed_us: recording.start.elapsed().as_micros().min(u64::MAX as u128) as u64,
                sequence: snapshot.body_chunks,
                bytes,
            };
            if kind == Kind::Body {
                snapshot.last_body = Some(stamp.clone());
            }
            if kind == Kind::IpcForwarded {
                snapshot.last_forwarded = Some(stamp.clone());
            }
            if snapshot.events.len() == MAX_EVENTS {
                snapshot.events.pop_front();
                snapshot.dropped_events += 1;
            }
            snapshot.events.push_back(stamp);
            if let Some(sink) = &recording.live_sink {
                sink(snapshot);
            }
        }
        pub fn finish(&mut self, result: &Result<(), super::super::Failure>) {
            let kind = match result.as_ref().err().map(|e| e.code.as_str()) {
                None => Kind::Completed,
                Some("cancelled") => Kind::CancellationObserved,
                Some(
                    "connect-timeout"
                    | "first-output-timeout"
                    | "stream-idle-timeout"
                    | "overall-deadline",
                ) => Kind::DeadlineObserved,
                Some("connection-failed" | "remote-disconnect" | "tls-failure") => {
                    Kind::TransportError
                }
                _ => Kind::Failed,
            };
            self.record(kind, 0);
            self.flush();
        }
        fn flush(&mut self) {
            if let Some(recording) = self.0.take() {
                (recording.sink)(&recording.snapshot);
            }
        }
    }
    impl Drop for Trace {
        fn drop(&mut self) {
            if self.0.is_some() {
                self.record(Kind::FutureDropped, 0);
                self.flush();
            }
        }
    }
}

#[cfg(debug_assertions)]
pub use enabled::*;

#[cfg(not(debug_assertions))]
#[derive(Default)]
pub(crate) struct Trace;
#[cfg(not(debug_assertions))]
impl Trace {
    pub fn from_app(_: &tauri::AppHandle, _: &str) -> Self {
        Self
    }
    pub fn record(&mut self, _: Kind, _: usize) {}
    pub fn finish(&mut self, _: &Result<(), super::Failure>) {}
}

#[cfg(all(test, debug_assertions))]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[test]
    fn acceptance_metadata_is_bounded_correlated_and_content_free() {
        let captured = Arc::new(Mutex::new(String::new()));
        let output = captured.clone();
        let state = AcceptanceDiagnostics::new(move |snapshot| {
            *output.lock().unwrap() = serde_json::to_string(snapshot).unwrap();
        });
        let mut trace = state.request("inference-26");
        for _ in 0..5000 {
            trace.record(Kind::Body, 43);
            trace.record(Kind::IpcForwarded, 43);
        }
        trace.finish(&Ok(()));
        let text = captured.lock().unwrap();
        let value: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(value["events"].as_array().unwrap().len(), MAX_EVENTS);
        assert_eq!(value["droppedEvents"], 10001 - MAX_EVENTS);
        assert_eq!(value["bodyChunks"], 5000);
        assert_eq!(value["bodyBytes"], 215000);
        assert_eq!(
            value["lastBody"]["sequence"],
            value["lastForwarded"]["sequence"]
        );
        assert!(value["lastBody"]["at"].as_u64().unwrap() > 0);
        assert!(
            value["lastForwarded"]["elapsedUs"].as_u64().unwrap()
                >= value["lastBody"]["elapsedUs"].as_u64().unwrap()
        );
        assert!(!text.contains("content"));
        assert!(!text.contains("headers"));
        assert!(!text.contains("authorization"));
        // The API accepts only enum categories and lengths, never payload/header text.
        assert!(text.len() < 2 * 1024 * 1024);
    }

    #[test]
    fn disabled_trace_allocates_nothing_and_emits_nothing() {
        let mut trace = Trace::default();
        trace.record(Kind::Body, usize::MAX);
        trace.finish(&Ok(()));
        let state = AcceptanceDiagnostics::new(|_| panic!("unexpected trace"));
        state.request("invalid/private?credential");
    }
    #[test]
    fn diagnostic_live_events_are_saved_before_terminal_completion() {
        let live = Arc::new(Mutex::new(Vec::new()));
        let completed = Arc::new(Mutex::new(Vec::new()));
        let streamed = live.clone();
        let finished = completed.clone();
        let sink = AcceptanceDiagnostics::new_live(
            move |snapshot| finished.lock().unwrap().push(snapshot.request_id.clone()),
            move |snapshot| streamed.lock().unwrap().push(
                (snapshot.request_id.clone(), snapshot.events.back().unwrap().kind)
            ),
        );
        let mut request = sink.request("inference-8");
        request.record(Kind::Dispatch, 0);
        request.record(Kind::Headers, 0);
        request.record(Kind::Body, 154);
        assert_eq!(live.lock().unwrap().len(), 3);
        assert!(completed.lock().unwrap().is_empty());
        request.finish(&Ok(()));
        assert_eq!(completed.lock().unwrap().as_slice(), &["inference-8"]);
        assert_eq!(live.lock().unwrap().last().unwrap().1, Kind::Completed);
    }
}
