use super::super::confinement::{
    self as boundary, staging, Children, Executable, Failure, Limits, Network, Policy,
};
use super::*;

pub(super) fn captured_policy(prepared: &Prepared, module: PathBuf) -> Result<Policy> {
    functions::validate_binding(&prepared.definition.binding)?;
    let Binding::Wasi { hash, .. } = &prepared.definition.binding else {
        unreachable!()
    };
    let root = functions::host_path(&prepared.root);
    Ok(Policy {
        version: boundary::POLICY_VERSION,
        capability_version: boundary::CAPABILITY_VERSION.into(),
        executable: Executable {
            path: functions::host_path(&module),
            sha256: hash.clone(),
            argv: vec![],
        },
        workspace: root.clone(),
        cwd: root,
        read_roots: vec![],
        write_roots: vec![],
        denied_paths: vec![],
        environment: Default::default(),
        children: Children::Forbidden,
        network: Network::Deny,
        limits: Limits {
            timeout_ms: prepared.definition.timeout_ms,
            cpu_time_ms: prepared.definition.timeout_ms,
            output_bytes: (prepared.definition.output_bytes as usize).min(MAX_OUTPUT),
            memory_bytes: functions::MEMORY_BYTES,
            processes: 1,
        },
        owner: prepared.record.window.clone(),
        definition_hash: prepared.record.tool.hash.clone(),
    })
}

fn error(failure: Failure) -> String {
    match failure {
        Failure::Cancelled | Failure::StalePolicy => "cancelled",
        Failure::Timeout | Failure::FuelLimit => "timed-out",
        Failure::OutputLimit => "output-limit",
        Failure::ExecutableChanged | Failure::InvalidModule => "tool_wasi_invalid_module",
        Failure::UnsupportedResources => "execution-capacity",
        _ => "native-failed",
    }
    .into()
}

pub(super) fn result(definition: &Definition, completed: staging::Completed) -> Result<Value> {
    if let Some(failure) = completed.receipt.failure {
        return Err(error(failure));
    }
    let output: Value = serde_json::from_slice(&completed.output).map_err(|_| "invalid-output")?;
    schema::value_matches(&definition.output_schema, &output, 0)
        .map_err(|_| "output-schema-mismatch")?;
    schema::bounded_json(&output, (definition.output_bytes as usize).min(MAX_OUTPUT))?;
    // Stderr is bounded diagnostic data, never a JSON result or retained secret.
    Ok(output)
}

pub(super) async fn execute(
    app: &tauri::AppHandle,
    prepared: &Prepared,
    lease: Lease,
) -> Result<Value> {
    if !functions::platform_verified() {
        return Err("tool_wasi_platform_unverified".into());
    }
    recheck(app, prepared)?;
    let module = functions::module_path(app, &prepared.definition)?;
    let policy = captured_policy(prepared, module)?;
    let input = schema::bounded_json(&prepared.arguments, MAX_INPUT)?;
    // The content is already immutable/retained. Staging verifies its hash again
    // and exposes only a copy; arguments cannot select host files or outputs.
    let stage = staging::Prepared::new(policy.clone(), vec![], vec![])
        .map_err(error)?
        .json_input(input)
        .map_err(error)?;
    let journal = confinement::Journal::capture(app.clone(), &prepared.record.id, &policy)?;
    let completed = stage.execute(lease, journal).await.map_err(error)?;
    recheck(app, prepared)?;
    result(&prepared.definition, completed)
}

#[cfg(test)]
mod tests;
