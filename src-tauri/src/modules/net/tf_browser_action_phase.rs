//! Application-owned TF4 cancellation / irreversible dispatch linearization.
//! These exact functions are called by the native actor and cancellation owner;
//! the unit tests are independent of WebView2, an installed Clack process,
//! network access, and native Windows security dialogs.
use std::sync::atomic::{AtomicU8, Ordering};

pub(crate) const NATIVE_CLICK_QUEUED: u8 = 0;
pub(crate) const NATIVE_CLICK_DISPATCH_COMMITTED: u8 = 1;
pub(crate) const NATIVE_CLICK_CANCELLED: u8 = 2;

/// The *only* transition that permits the caller to attempt the one-use
/// native effect. A caller must first have durably recorded its possible
/// effect; the atomic alone does not persist a crash-safe receipt.
pub(crate) fn commit_native_action_phase(phase: &AtomicU8) -> bool {
    phase
        .compare_exchange(
            NATIVE_CLICK_QUEUED,
            NATIVE_CLICK_DISPATCH_COMMITTED,
            Ordering::AcqRel,
            Ordering::Acquire,
        )
        .is_ok()
}

/// Native cancellation wins only before dispatch commit. A late caller may
/// observe UNKNOWN, but must not claim it prevented a completed dispatch.
pub(crate) fn cancel_native_action_phase(phase: &AtomicU8) -> bool {
    phase
        .compare_exchange(
            NATIVE_CLICK_QUEUED,
            NATIVE_CLICK_CANCELLED,
            Ordering::AcqRel,
            Ordering::Acquire,
        )
        .is_ok()
}

/// Native actor admission after the original approval has been consumed.
/// The same helper is used by both native COM and bounded TF3 FORM dispatch.
/// No irreversible dispatch can be committed unless the ledger write succeeds.
/// The returned guard remains owned by the actor until it records its receipt.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum NativeDispatchAdmission {
    Committed,
    CancelledBeforeDispatch,
    StaleReservation,
}

pub(crate) fn admit_native_dispatch_after_write_ahead<T, E>(
    phase: Option<&AtomicU8>,
    write_ahead: impl FnOnce() -> Result<T, E>,
    reservation_valid: impl FnOnce() -> bool,
) -> Result<(T, NativeDispatchAdmission), E> {
    let durable = write_ahead()?;
    let decision = if !reservation_valid() {
        NativeDispatchAdmission::StaleReservation
    } else if phase.is_none_or(|phase| !commit_native_action_phase(phase)) {
        NativeDispatchAdmission::CancelledBeforeDispatch
    } else {
        NativeDispatchAdmission::Committed
    };
    Ok((durable, decision))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    use std::sync::mpsc;
    use std::sync::Arc;
    use std::time::Duration;

    /// An independent observation of the test's simulated effect. Only the
    /// exact same phase transition used by the native actor may increment it.
    fn try_effect(phase: &AtomicU8, witnessed: &AtomicUsize) -> bool {
        if commit_native_action_phase(phase) {
            witnessed.fetch_add(1, Ordering::SeqCst);
            true
        } else {
            false
        }
    }

    #[test]
    fn grouped_case10_cancel_wins_before_dispatch_no_effect_or_replay() {
        let phase = Arc::new(AtomicU8::new(NATIVE_CLICK_QUEUED));
        let witnessed = Arc::new(AtomicUsize::new(0));
        let (cancelled, advance) = mpsc::channel::<()>();
        let (allow_dispatch, resume) = mpsc::channel::<()>();
        let other = Arc::clone(&phase);
        let effects = Arc::clone(&witnessed);
        let worker = std::thread::spawn(move || {
            cancelled.send(()).unwrap();
            resume.recv_timeout(Duration::from_secs(5)).unwrap();
            try_effect(&other, &effects)
        });
        advance.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(cancel_native_action_phase(&phase));
        allow_dispatch.send(()).unwrap();
        assert!(!worker.join().unwrap());
        assert_eq!(phase.load(Ordering::Acquire), NATIVE_CLICK_CANCELLED);
        assert_eq!(witnessed.load(Ordering::SeqCst), 0);
        assert!(!cancel_native_action_phase(&phase));
        assert!(!commit_native_action_phase(&phase));
    }

    #[test]
    fn grouped_case10_dispatch_wins_then_cancel_cannot_prevent_or_replay() {
        let phase = Arc::new(AtomicU8::new(NATIVE_CLICK_QUEUED));
        let witnessed = Arc::new(AtomicUsize::new(0));
        let (ready, proceed) = mpsc::channel::<()>();
        let (allow_cancel, resume) = mpsc::channel::<()>();
        let other = Arc::clone(&phase);
        let worker = std::thread::spawn(move || {
            ready.send(()).unwrap();
            resume.recv_timeout(Duration::from_secs(5)).unwrap();
            cancel_native_action_phase(&other)
        });
        proceed.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(try_effect(&phase, &witnessed));
        allow_cancel.send(()).unwrap();
        assert!(!worker.join().unwrap());
        assert_eq!(phase.load(Ordering::Acquire), NATIVE_CLICK_DISPATCH_COMMITTED);
        assert_eq!(witnessed.load(Ordering::SeqCst), 1);
        assert!(!commit_native_action_phase(&phase));
        assert_eq!(witnessed.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn grouped_case10_simultaneous_cancel_and_dispatch_have_one_winner() {
        use std::sync::Barrier;
        for _ in 0..128 {
            let phase = Arc::new(AtomicU8::new(NATIVE_CLICK_QUEUED));
            let witnessed = Arc::new(AtomicUsize::new(0));
            let barrier = Arc::new(Barrier::new(3));
            let p = Arc::clone(&phase);
            let e = Arc::clone(&witnessed);
            let b = Arc::clone(&barrier);
            let dispatch = std::thread::spawn(move || {
                b.wait();
                try_effect(&p, &e)
            });
            let p = Arc::clone(&phase);
            let b = Arc::clone(&barrier);
            let cancel = std::thread::spawn(move || {
                b.wait();
                cancel_native_action_phase(&p)
            });
            barrier.wait();
            let sent = dispatch.join().unwrap();
            let revoked = cancel.join().unwrap();
            assert_ne!(sent, revoked);
            assert_eq!(witnessed.load(Ordering::SeqCst), usize::from(sent));
            assert_eq!(
                phase.load(Ordering::Acquire),
                if sent {
                    NATIVE_CLICK_DISPATCH_COMMITTED
                } else {
                    NATIVE_CLICK_CANCELLED
                }
            );
        }
    }

    #[test]
    fn grouped_case11_restart_creates_no_new_authority_from_committed_phase() {
        // Real restart and durable receipt are separately tested in the
        // custom-tools ledger; this source seam never issues an approval.
        let spent = AtomicU8::new(NATIVE_CLICK_DISPATCH_COMMITTED);
        let cancelled = AtomicU8::new(NATIVE_CLICK_CANCELLED);
        assert!(!commit_native_action_phase(&spent));
        assert!(!cancel_native_action_phase(&spent));
        assert!(!commit_native_action_phase(&cancelled));
        assert!(!cancel_native_action_phase(&cancelled));
    }

    #[test]
    fn grouped_case10_real_actor_admission_refuses_dispatch_on_write_failure() {
        let phase = AtomicU8::new(NATIVE_CLICK_QUEUED);
        let attempted_write = AtomicUsize::new(0);
        let actual_effects = AtomicUsize::new(0);
        let result = admit_native_dispatch_after_write_ahead(
            Some(&phase),
            || {
                attempted_write.fetch_add(1, Ordering::SeqCst);
                Err::<(), &'static str>("ledger-write-rejected")
            },
            || true,
        );
        if let Ok((_, NativeDispatchAdmission::Committed)) = result {
            actual_effects.fetch_add(1, Ordering::SeqCst);
        }
        assert_eq!(result.unwrap_err(), "ledger-write-rejected");
        assert_eq!(attempted_write.load(Ordering::SeqCst), 1);
        assert_eq!(actual_effects.load(Ordering::SeqCst), 0);
        assert_eq!(phase.load(Ordering::Acquire), NATIVE_CLICK_QUEUED);
    }

    #[test]
    fn grouped_case10_real_actor_admission_preserves_cancel_before_dispatch() {
        let phase = AtomicU8::new(NATIVE_CLICK_QUEUED);
        let writes = AtomicUsize::new(0);
        assert!(cancel_native_action_phase(&phase));
        let (guard, decision) = admit_native_dispatch_after_write_ahead(
            Some(&phase),
            || {
                writes.fetch_add(1, Ordering::SeqCst);
                Ok::<_, ()>("durably-recorded-possible")
            },
            || true,
        ).unwrap();
        assert_eq!(guard, "durably-recorded-possible");
        assert_eq!(decision, NativeDispatchAdmission::CancelledBeforeDispatch);
        assert_eq!(writes.load(Ordering::SeqCst), 1);
        assert_eq!(phase.load(Ordering::Acquire), NATIVE_CLICK_CANCELLED);
    }

    #[test]
    fn grouped_case10_real_actor_admission_commits_only_after_write_ahead() {
        let phase = AtomicU8::new(NATIVE_CLICK_QUEUED);
        let writes = AtomicUsize::new(0);
        let (guard, decision) = admit_native_dispatch_after_write_ahead(
            Some(&phase),
            || {
                assert_eq!(phase.load(Ordering::Acquire), NATIVE_CLICK_QUEUED);
                writes.fetch_add(1, Ordering::SeqCst);
                Ok::<_, ()>("durably-recorded-possible")
            },
            || true,
        ).unwrap();
        assert_eq!(guard, "durably-recorded-possible");
        assert_eq!(decision, NativeDispatchAdmission::Committed);
        assert_eq!(writes.load(Ordering::SeqCst), 1);
        assert!(!cancel_native_action_phase(&phase));
        assert!(!commit_native_action_phase(&phase));
    }

    #[test]
    fn grouped_case10_stale_reservation_cannot_commit_even_after_write_ahead() {
        let phase = AtomicU8::new(NATIVE_CLICK_QUEUED);
        let (_, decision) = admit_native_dispatch_after_write_ahead(
            Some(&phase), || Ok::<_, ()>(()), || false,
        ).unwrap();
        assert_eq!(decision, NativeDispatchAdmission::StaleReservation);
        assert_eq!(phase.load(Ordering::Acquire), NATIVE_CLICK_QUEUED);
    }
}
