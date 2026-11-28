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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    use std::sync::mpsc;
    use std::sync::Arc;

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
            resume.recv().unwrap();
            try_effect(&other, &effects)
        });
        advance.recv().unwrap();
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
            resume.recv().unwrap();
            cancel_native_action_phase(&other)
        });
        proceed.recv().unwrap();
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
}
