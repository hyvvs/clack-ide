//! Durable sink for the native boundary, reusing T2 ownership and atomic ledger.
use super::super::confinement::{Cleanup, Failure, Policy, Receipt};
use super::*;

type WriteReceipt = dyn Fn(bool, &Receipt) -> std::result::Result<(), Failure> + Send + Sync;
pub struct Journal {
    captured: Policy,
    check: Box<dyn Fn() -> std::result::Result<(), Failure> + Send + Sync>,
    write: Box<WriteReceipt>,
}

impl Journal {
    // Not IPC: only a captured T2 invocation can acquire a confinement journal.
    pub fn capture(app: tauri::AppHandle, execution_id: &str, policy: &Policy) -> Result<Self> {
        let prepared = app
            .state::<MemoryState>()
            .tool_calls
            .lock()
            .map_err(|_| "execution-unavailable")?
            .get(execution_id)
            .cloned()
            .ok_or("execution-unavailable")?;
        recheck(&app, &prepared)?;
        let expected = super::wasi::captured_policy(
            &prepared,
            functions::module_path(&app, &prepared.definition)?,
        )?;
        if expected.digest().map_err(|_| "stale-approval")?
            != policy.digest().map_err(|_| "stale-approval")?
        {
            return Err("stale-approval".into());
        }
        let check_app = app.clone();
        let check_prepared = prepared.clone();
        Ok(Self {
            captured: policy.clone(),
            check: Box::new(move || {
                recheck(&check_app, &check_prepared).map_err(|_| Failure::StalePolicy)
            }),
            write: Box::new(move |finished, receipt| {
                edit_record(&app, &prepared.record.id, |record| {
                    same_capture(record, &prepared.record)?;
                    if !finished {
                        recheck(&app, &prepared)?;
                    }
                    retain_receipt(record, receipt, finished)
                })
                .map(|_| ())
                .map_err(|_| Failure::Persistence)
            }),
        })
    }

    pub(crate) fn validate(&self, policy: &Policy) -> std::result::Result<(), Failure> {
        if self.captured.digest()? != policy.digest()? {
            return Err(Failure::StalePolicy);
        }
        (self.check)()
    }
    pub(crate) fn begin(&self, receipt: &Receipt) -> std::result::Result<(), Failure> {
        (self.write)(false, receipt)
    }
    pub(crate) fn finish(&self, receipt: &Receipt) -> std::result::Result<(), Failure> {
        (self.write)(true, receipt)
    }
}

fn retain_receipt(record: &mut Record, receipt: &Receipt, finished: bool) -> Result<()> {
    // Cleanup success is not JSON/schema success. Only T2 can settle a function.
    let mut receipt_record = record.clone();
    update(&mut receipt_record, receipt, finished)?;
    record.confinement = receipt_record.confinement;
    Ok(())
}

fn update(record: &mut Record, receipt: &Receipt, finished: bool) -> Result<()> {
    receipt
        .validate()
        .map_err(|_| "invalid-confinement-receipt")?;
    if record.state != "running" || record.approval.is_none() || record.native_id.is_none() {
        return Err("stale-approval".into());
    }
    if finished {
        if record
            .confinement
            .as_ref()
            .is_none_or(|old| old.policy_hash != receipt.policy_hash)
        {
            return Err("stale-approval".into());
        }
        if receipt.cleanup == Cleanup::NotStarted && receipt.failure.is_some() {
            record.effect = "none".into();
        }
        let outcome = match receipt.failure {
            None => Ok(json!({"confinement": receipt})),
            Some(Failure::Cancelled | Failure::StalePolicy) => Err("cancelled".into()),
            Some(Failure::Timeout) => Err("timed-out".into()),
            Some(Failure::OutputLimit) => Err("output-limit".into()),
            Some(_) => Err("native-failed".into()),
        };
        settle(record, outcome);
    } else {
        if record.confinement.is_some()
            || receipt.failure.is_some()
            || receipt.cleanup != Cleanup::NotStarted
        {
            return Err("stale-approval".into());
        }
        record.effect = "possible".into();
    }
    record.confinement = Some(receipt.clone());
    Ok(())
}

#[cfg(test)]
pub(crate) fn fixture(
    path: PathBuf,
    policy: &Policy,
    native_id: &str,
    revoked: Arc<AtomicBool>,
    fail_finish: bool,
) -> Journal {
    let mut record = super::tests::record();
    record.window = policy.owner.clone();
    record.epoch = MEMORY_EPOCH.to_string();
    record.tool.hash = policy.definition_hash.clone();
    record.native_id = Some(native_id.into());
    record.approval = Some("a".repeat(64));
    fixture_record(path, policy, revoked, fail_finish, record)
}

#[cfg(test)]
pub(super) fn fixture_record(
    path: PathBuf,
    policy: &Policy,
    revoked: Arc<AtomicBool>,
    fail_finish: bool,
    record: Record,
) -> Journal {
    let store = Arc::new(session_file::SessionFile::default());
    write_ledger(
        &store,
        &path,
        &Ledger {
            version: 1,
            records: vec![record],
        },
    )
    .unwrap();
    let lock = std::sync::Mutex::new(());
    Journal {
        captured: policy.clone(),
        check: Box::new(move || {
            if revoked.load(Ordering::Acquire) {
                Err(Failure::StalePolicy)
            } else {
                Ok(())
            }
        }),
        write: Box::new(move |finished, receipt| {
            if fail_finish && finished {
                return Err(Failure::Persistence);
            }
            let _guard = lock.lock().unwrap();
            let mut ledger = read_ledger(&store, &path).map_err(|_| Failure::Persistence)?;
            let record = &mut ledger.records[0];
            if record.kind == "wasi" {
                retain_receipt(record, receipt, finished)
            } else {
                update(record, receipt, finished)
            }
            .map_err(|_| Failure::Persistence)?;
            write_ledger(&store, &path, &ledger).map_err(|_| Failure::Persistence)
        }),
    }
}
