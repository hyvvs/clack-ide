use super::*;
use crate::modules::net::inference::InferenceState;
use futures_util::poll;

fn spec(endpoint: &str, capacity: usize) -> Admission {
    Admission {
        endpoint_id: endpoint.into(),
        profile_id: "model".into(),
        capacity,
    }
}
fn lease(state: &InferenceState, owner: &str) -> Lease {
    state.start(owner, &state.open(owner).unwrap()).unwrap()
}

#[tokio::test]
async fn capacity_one_fifo_and_release() {
    let state = InferenceState::default();
    let a = lease(&state, "main");
    let b = lease(&state, "window-b");
    let c = lease(&state, "main");
    let first = state
        .admission
        .acquire(&a, spec("a", 1), |_| panic!())
        .await
        .unwrap();
    let second = state.admission.acquire(&b, spec("a", 1), |_| true);
    let third = state.admission.acquire(&c, spec("a", 1), |_| true);
    tokio::pin!(second, third);
    assert!(poll!(&mut second).is_pending());
    assert!(poll!(&mut third).is_pending());
    drop(first);
    assert!(poll!(&mut third).is_pending());
    let second = second.await.unwrap();
    assert!(poll!(&mut third).is_pending());
    drop(second);
    drop(third.await.unwrap());
    assert!(state.admission.inner.lock().unwrap().entries.is_empty());
}

#[tokio::test]
async fn capacity_two_and_models_share_one_endpoint() {
    let state = InferenceState::default();
    let a = lease(&state, "a");
    let b = lease(&state, "b");
    let c = lease(&state, "c");
    let first = state
        .admission
        .acquire(&a, spec("server", 2), |_| panic!())
        .await
        .unwrap();
    let mut other_model = spec("server", 2);
    other_model.profile_id = "other-model/instance".into();
    let second = state
        .admission
        .acquire(&b, other_model, |_| panic!())
        .await
        .unwrap();
    let third = state.admission.acquire(&c, spec("server", 2), |_| true);
    tokio::pin!(third);
    assert!(poll!(&mut third).is_pending());
    drop(first);
    let third = third.await.unwrap();
    assert_eq!(third.observation.capacity, 2);
    drop((second, third));
}

#[tokio::test]
async fn busy_endpoint_does_not_block_another_with_same_model() {
    let state = InferenceState::default();
    let a = lease(&state, "main");
    let b = lease(&state, "main");
    let c = lease(&state, "settings");
    let first = state
        .admission
        .acquire(&a, spec("a", 1), |_| panic!())
        .await
        .unwrap();
    let queued = state.admission.acquire(&b, spec("a", 1), |_| true);
    tokio::pin!(queued);
    assert!(poll!(&mut queued).is_pending());
    let other = state
        .admission
        .acquire(&c, spec("b", 1), |_| panic!())
        .await
        .unwrap();
    drop((first, other));
    drop(queued.await.unwrap());
}

#[tokio::test]
async fn duplicate_acquire_never_releases_original_slot() {
    let state = InferenceState::default();
    let a = lease(&state, "main");
    let first = state
        .admission
        .acquire(&a, spec("a", 1), |_| panic!())
        .await
        .unwrap();
    let error = state
        .admission
        .acquire(&a, spec("a", 1), |_| panic!())
        .await
        .err()
        .unwrap();
    assert_eq!(error.code, "duplicate-admission");
    assert_eq!(state.admission.inner.lock().unwrap().entries.len(), 1);
    drop(first);
    assert!(state.admission.inner.lock().unwrap().entries.is_empty());
}

#[tokio::test]
async fn queued_cancellation_and_stale_id_cannot_admit() {
    let state = InferenceState::default();
    let a = lease(&state, "main");
    let b = lease(&state, "other");
    let first = state
        .admission
        .acquire(&a, spec("a", 1), |_| panic!())
        .await
        .unwrap();
    {
        let queued = state.admission.acquire(&b, spec("a", 1), |_| true);
        tokio::pin!(queued);
        assert!(poll!(&mut queued).is_pending());
        state.close_owner("other");
        drop(first);
        assert_eq!(queued.await.err().unwrap().code, "cancelled");
    }
    assert!(state.admission.inner.lock().unwrap().entries.is_empty());
    let id = b.id.clone();
    drop(b);
    state.cancel("other", &id).await;
    assert!(state.start("other", &id).is_err());
}

#[tokio::test]
async fn active_stop_retains_capacity_until_transport_drops() {
    let state = InferenceState::default();
    let a = lease(&state, "first");
    let b = lease(&state, "second");
    let first = state
        .admission
        .acquire(&a, spec("a", 1), |_| panic!())
        .await
        .unwrap();
    let second = state.admission.acquire(&b, spec("a", 1), |_| true);
    tokio::pin!(second);
    assert!(poll!(&mut second).is_pending());
    let cancellation = state.cancel("first", &a.id);
    tokio::pin!(cancellation);
    assert!(poll!(&mut cancellation).is_pending());
    assert!(a.cancelled());
    assert!(poll!(&mut second).is_pending());
    drop(first);
    drop(second.await.unwrap());
}

#[tokio::test]
async fn cancellation_wins_simultaneous_release() {
    for _ in 0..50 {
        let state = InferenceState::default();
        let a = lease(&state, "first");
        let b = lease(&state, "second");
        let first = state
            .admission
            .acquire(&a, spec("a", 1), |_| panic!())
            .await
            .unwrap();
        let second = state.admission.acquire(&b, spec("a", 1), |_| true);
        tokio::pin!(second);
        assert!(poll!(&mut second).is_pending());
        drop(first);
        state.close_owner("second");
        assert_eq!(second.await.err().unwrap().code, "cancelled");
    }
}

#[tokio::test]
async fn aborted_waiter_future_removes_queue_entry() {
    let state = InferenceState::default();
    let a = lease(&state, "main");
    let b = lease(&state, "main");
    let first = state
        .admission
        .acquire(&a, spec("a", 1), |_| panic!())
        .await
        .unwrap();
    {
        let queued = state.admission.acquire(&b, spec("a", 1), |_| true);
        tokio::pin!(queued);
        assert!(poll!(&mut queued).is_pending());
    }
    assert_eq!(state.admission.inner.lock().unwrap().entries.len(), 1);
    drop(first);
}

#[tokio::test]
async fn invalid_capacities_and_identity_are_rejected_without_ownership() {
    let state = InferenceState::default();
    let a = lease(&state, "main");
    for capacity in [0, 9, usize::MAX] {
        assert_eq!(
            state
                .admission
                .acquire(&a, spec("a", capacity), |_| panic!())
                .await
                .err()
                .unwrap()
                .code,
            "invalid-capacity"
        );
    }
    for endpoint in ["".to_string(), "x".repeat(2049), "a\nb".into()] {
        assert!(spec(&endpoint, 1).validate().is_err());
    }
    for value in ["-1", "0.5", "null", "1e100"] {
        assert!(serde_json::from_str::<Admission>(&format!(
            r#"{{"endpointId":"a","profileId":"p","capacity":{value}}}"#
        ))
        .is_err());
    }
    assert!(state.admission.inner.lock().unwrap().entries.is_empty());
}

#[tokio::test]
async fn conflicting_captured_policies_use_lower_bound_until_drained() {
    let state = InferenceState::default();
    let a = lease(&state, "main");
    let b = lease(&state, "other");
    let first = state
        .admission
        .acquire(&a, spec("a", 1), |_| panic!())
        .await
        .unwrap();
    let newer = state.admission.acquire(&b, spec("a", 8), |_| true);
    tokio::pin!(newer);
    assert!(poll!(&mut newer).is_pending());
    drop(first);
    assert_eq!(newer.await.unwrap().observation.capacity, 8);
}

#[tokio::test]
async fn fresh_process_has_no_slots_and_shutdown_never_replays() {
    let old = InferenceState::default();
    let a = lease(&old, "main");
    let first = old
        .admission
        .acquire(&a, spec("a", 1), |_| panic!())
        .await
        .unwrap();
    old.shutdown();
    assert!(old.open("main").is_err());
    let fresh = InferenceState::default();
    let b = lease(&fresh, "main");
    drop(
        fresh
            .admission
            .acquire(&b, spec("a", 1), |_| panic!())
            .await
            .unwrap(),
    );
    drop(first);
}

#[tokio::test]
async fn failed_queue_event_releases_and_does_not_starve_successor() {
    let state = InferenceState::default();
    let a = lease(&state, "main");
    let b = lease(&state, "main");
    let first = state
        .admission
        .acquire(&a, spec("a", 1), |_| panic!())
        .await
        .unwrap();
    assert_eq!(
        state
            .admission
            .acquire(&b, spec("a", 1), |_| false)
            .await
            .err()
            .unwrap()
            .code,
        "cancelled"
    );
    assert_eq!(state.admission.inner.lock().unwrap().entries.len(), 1);
    drop(first);
}

#[tokio::test]
async fn parent_child_parent_can_reacquire_capacity_one() {
    let state = InferenceState::default();
    let parent = lease(&state, "main");
    let slot = state
        .admission
        .acquire(&parent, spec("a", 1), |_| panic!())
        .await
        .unwrap();
    drop(slot);
    drop(parent);
    let child = lease(&state, "main");
    let slot = state
        .admission
        .acquire(&child, spec("a", 1), |_| panic!())
        .await
        .unwrap();
    drop(slot);
    drop(child);
    let parent = lease(&state, "main");
    drop(
        state
            .admission
            .acquire(&parent, spec("a", 1), |_| panic!())
            .await
            .unwrap(),
    );
}

#[tokio::test]
async fn queue_is_bounded_across_groups() {
    let admission = Arc::new(AdmissionState::default());
    let state = InferenceState::default();
    let another = InferenceState::default();
    let mut held = Vec::new();
    for index in 0..MAX_ENTRIES {
        let a = lease(&state, "main");
        let slot = admission
            .acquire(&a, spec(&format!("endpoint-{index}"), 1), |_| panic!())
            .await
            .unwrap();
        held.push((slot, a));
    }
    // Distinct ID from a different registry stands in for a caller over the native cap.
    let _unused = another.open("main").unwrap();
    let a = lease(&another, "main");
    {
        let mut inner = admission.inner.lock().unwrap();
        let entry = inner.entries.remove(&a.id).unwrap();
        inner.entries.insert("reserved-extra".into(), entry);
    }
    let result = admission
        .acquire(&a, spec("overflow", 1), |_| panic!())
        .await;
    assert!(matches!(result, Err(Failure { code }) if code == "admission-limit"));
}

#[test]
fn observation_contains_no_request_content_or_address() {
    let observation = Observation {
        endpoint_id: "a".into(),
        profile_id: "p".into(),
        capacity: 1,
        queue_entered_at: now(),
        admitted_at: None,
        attempt_started_at: None,
        settled_at: None,
    };
    let json = serde_json::to_value(observation).unwrap();
    assert_eq!(json.as_object().unwrap().len(), 7);
    assert!(json.get("url").is_none());
    assert!(json.get("body").is_none());
    assert!(json.get("headers").is_none());
}
