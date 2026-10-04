//! The only production guest engine. No native-process, socket, ambient file,
//! precompiled-artifact deserialization, or model-selected host imports.
use super::{Failure, Policy};
use std::path::Path;
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use wasmtime::{Caller, Config, Engine, Linker, Module, Store, StoreLimits, StoreLimitsBuilder};
use wasmtime_wasi::{
    p1::WasiP1Ctx,
    p2::pipe::{MemoryInputPipe, MemoryOutputPipe},
    DirPerms, FilePerms, WasiCtxBuilder,
};

pub(super) const MAX_MODULE_BYTES: usize = 1024 * 1024;
const FILE_WRITE_BUDGET: usize = 8 * 1024 * 1024;

pub(super) fn engine() -> Result<&'static Engine, Failure> {
    static ENGINE: OnceLock<Result<Engine, String>> = OnceLock::new();
    ENGINE
        .get_or_init(|| {
            let mut config = Config::new();
            config
                .consume_fuel(true)
                .wasm_multi_memory(false)
                .wasm_memory64(false)
                .max_wasm_stack(512 * 1024)
                .cranelift_opt_level(wasmtime::OptLevel::None);
            Engine::new(&config).map_err(|e| e.to_string())
        })
        .as_ref()
        .map_err(|_| Failure::UnsupportedPlatform)
}

struct State {
    wasi: WasiP1Ctx,
    limits: StoreLimits,
    stdout_left: usize,
    file_bytes_left: usize,
    opens_left: usize,
    failure: Option<Failure>,
    forwarding: Option<wasmtime::Instance>,
}

#[derive(Debug)]
pub(super) struct Outcome {
    pub output: Vec<u8>,
    pub stderr: Vec<u8>,
    pub failure: Option<Failure>,
}

pub(super) fn run(
    bytes: &[u8],
    root: &Path,
    policy: &Policy,
    cancelled: &dyn Fn() -> bool,
    input: Option<&[u8]>,
) -> Outcome {
    let output = MemoryOutputPipe::new(policy.limits.output_bytes);
    let stderr = if input.is_some() {
        MemoryOutputPipe::new(policy.limits.output_bytes)
    } else {
        output.clone()
    };
    let operation = || -> Result<(), Failure> {
        policy.check_host()?;
        if cancelled() {
            return Err(Failure::Cancelled);
        }
        if bytes.len() > MAX_MODULE_BYTES || !bytes.starts_with(b"\0asm\x01\0\0\0") {
            return Err(Failure::InvalidModule);
        }
        let started = Instant::now();
        let engine = engine()?;
        // Compile only bounded, reviewed WebAssembly bytes. Never deserialize
        // serialized native code supplied by a guest, model, workspace or cache.
        let module = Module::from_binary(engine, bytes).map_err(|_| Failure::InvalidModule)?;
        if module
            .imports()
            .any(|i| i.module() != "wasi_snapshot_preview1")
        {
            return Err(Failure::InvalidModule);
        }
        let mut wasi = WasiCtxBuilder::new();
        if let Some(input) = input {
            if input.len() > 16 * 1024 {
                return Err(Failure::InvalidPolicy);
            }
            wasi.stdin(MemoryInputPipe::new(input.to_vec()));
        }
        wasi.stdout(output.clone())
            .stderr(stderr.clone())
            .arg("program.wasm")
            .args(&policy.executable.argv)
            .envs(
                &policy
                    .environment
                    .iter()
                    .map(|(k, v)| (k.as_str(), v.as_str()))
                    .collect::<Vec<_>>(),
            )
            .initial_cwd(".")
            .allow_tcp(false)
            .allow_udp(false)
            .allow_ip_name_lookup(false)
            .socket_addr_check(|_, _| Box::pin(async { false }));
        wasi.preopened_dir(root, ".", DirPerms::all(), FilePerms::all())
            .map_err(|_| Failure::Initialization)?;
        let mut store = Store::new(
            engine,
            State {
                wasi: wasi.build_p1(),
                limits: StoreLimitsBuilder::new()
                    .memory_size(policy.limits.memory_bytes)
                    .memories(1)
                    .instances(2)
                    .tables(1)
                    .table_elements(4096)
                    .trap_on_grow_failure(true)
                    .build(),
                stdout_left: policy.limits.output_bytes,
                file_bytes_left: FILE_WRITE_BUDGET,
                opens_left: 64,
                failure: None,
                forwarding: None,
            },
        );
        store.limiter(|s| &mut s.limits);
        store
            .set_fuel(policy.limits.cpu_time_ms.saturating_mul(50_000))
            .map_err(|_| Failure::Initialization)?;
        // Cooperatively yields even a pure Wasm infinite loop, allowing the
        // surrounding deadline/cancellation select to drop the entire Store.
        store
            .fuel_async_yield_interval(Some(10_000))
            .map_err(|_| Failure::Initialization)?;
        let mut linker = Linker::new(engine);
        wasmtime_wasi::p1::add_to_linker_async(&mut linker, |s: &mut State| &mut s.wasi)
            .map_err(|_| Failure::Initialization)?;
        guard_io(&mut linker, &mut store).map_err(|_| Failure::Initialization)?;
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|_| Failure::Initialization)?;
        let result = runtime.block_on(async {
            let guest = async {
                let instance = linker.instantiate_async(&mut store, &module).await?;
                let start = instance.get_typed_func::<(), ()>(&mut store, "_start")?;
                start.call_async(&mut store, ()).await
            };
            tokio::pin!(guest);
            let mut tick = tokio::time::interval(Duration::from_millis(5));
            loop {
                tokio::select! {
                    biased;
                    _ = tick.tick() => {
                        if cancelled() { break Err(Failure::Cancelled); }
                        if started.elapsed() >= Duration::from_millis(policy.limits.timeout_ms) {
                            break Err(Failure::Timeout);
                        }
                    }
                    outcome = &mut guest => break match outcome {
                        Ok(()) => Ok(()),
                        Err(e) if e.downcast_ref::<wasmtime_wasi::I32Exit>().is_some_and(|e| e.0 == 0) => Ok(()),
                        Err(e) if matches!(e.downcast_ref::<wasmtime::Trap>(), Some(wasmtime::Trap::OutOfFuel)) => Err(Failure::FuelLimit),
                        Err(e) => {
                            #[cfg(test)]
                            eprintln!("WASI guest trap: {e:?}");
                            let _ = e;
                            Err(Failure::GuestTrap)
                        },
                    },
                }
            }
        });
        if let Some(failure) = store.data().failure {
            return Err(failure);
        }
        result
    };
    let failure = operation().err();
    Outcome {
        output: output.contents().to_vec(),
        stderr: if input.is_some() {
            stderr.contents().to_vec()
        } else {
            vec![]
        },
        failure,
    }
}

pub(crate) fn validate_function(bytes: &[u8]) -> Result<(), Failure> {
    if bytes.len() > MAX_MODULE_BYTES || !bytes.starts_with(b"\0asm\x01\0\0\0") {
        return Err(Failure::InvalidModule);
    }
    let engine = engine()?;
    let module = Module::from_binary(engine, bytes).map_err(|_| Failure::InvalidModule)?;
    if module.imports().any(|i| {
        i.module() != "wasi_snapshot_preview1"
            || !matches!(
                i.name(),
                "args_get"
                    | "args_sizes_get"
                    | "environ_get"
                    | "environ_sizes_get"
                    | "fd_read"
                    | "fd_pread"
                    | "fd_write"
                    | "fd_close"
                    | "fd_fdstat_get"
                    | "fd_seek"
                    | "fd_tell"
                    | "fd_fdstat_set_flags"
                    | "fd_fdstat_set_rights"
                    | "fd_filestat_get"
                    | "fd_prestat_get"
                    | "fd_prestat_dir_name"
                    | "fd_readdir"
                    | "path_open"
                    | "path_filestat_get"
                    | "path_readlink"
                    | "clock_res_get"
                    | "clock_time_get"
                    | "poll_oneoff"
                    | "random_get"
                    | "sched_yield"
                    | "proc_exit"
            )
    }) {
        return Err(Failure::InvalidModule);
    }
    match module.get_export("_start") {
        Some(wasmtime::ExternType::Func(f)) if f.params().len() == 0 && f.results().len() == 0 => {}
        _ => return Err(Failure::InvalidModule),
    }
    match module.get_export("memory") {
        Some(wasmtime::ExternType::Memory(m))
            if !m.is_shared() && !m.is_64() && m.minimum() <= 1024 => {}
        _ => return Err(Failure::InvalidModule),
    }
    let mut linker = Linker::<WasiP1Ctx>::new(engine);
    wasmtime_wasi::p1::add_to_linker_async(&mut linker, |s| s)
        .map_err(|_| Failure::Initialization)?;
    // Type/link validation only; neither the start section nor _start executes.
    linker
        .instantiate_pre(&module)
        .map_err(|_| Failure::InvalidModule)?;
    Ok(())
}

fn deny(caller: &mut Caller<'_, State>, failure: Failure) -> wasmtime::Error {
    caller.data_mut().failure = Some(failure);
    wasmtime::format_err!("confined guest limit")
}

fn guard_io(linker: &mut Linker<State>, store: &mut Store<State>) -> wasmtime::Result<()> {
    const WASI: &str = "wasi_snapshot_preview1";
    let write = linker.get(&mut *store, WASI, "fd_write").unwrap();
    let open = linker.get(&mut *store, WASI, "path_open").unwrap();
    let forwarding = forwarding_module(store.engine())?;
    let imports = [write, open];
    let write_module = forwarding.clone();
    let write_imports = imports.clone();
    linker.allow_shadowing(true);
    linker.func_wrap_async(
        WASI,
        "fd_write",
        move |mut caller: Caller<'_, State>, args: (i32, i32, i32, i32)| {
            let module = write_module.clone();
            let imports = write_imports.clone();
            Box::new(async move {
                let (fd, ptr, count, _) = args;
                if !(0..=128).contains(&count) {
                    return Err(deny(&mut caller, Failure::OutputLimit));
                }
                let memory = caller
                    .get_export("memory")
                    .and_then(|e| e.into_memory())
                    .ok_or_else(|| wasmtime::format_err!("missing guest memory"))?;
                let mut total = 0usize;
                for i in 0..count as usize {
                    let offset = (ptr as u32 as usize)
                        .checked_add(i * 8)
                        .ok_or_else(|| wasmtime::format_err!("iovec overflow"))?;
                    let mut vector = [0; 8];
                    memory.read(&caller, offset, &mut vector)?;
                    let len = u32::from_le_bytes(vector[4..].try_into().unwrap()) as usize;
                    total = total
                        .checked_add(len)
                        .ok_or_else(|| wasmtime::format_err!("iovec overflow"))?;
                }
                let remaining = if fd == 1 || fd == 2 {
                    &mut caller.data_mut().stdout_left
                } else {
                    &mut caller.data_mut().file_bytes_left
                };
                if total > *remaining {
                    return Err(deny(&mut caller, Failure::OutputLimit));
                }
                *remaining -= total;
                let instance = forwarding_instance(&mut caller, &module, &imports).await?;
                instance
                    .get_typed_func::<(i32, i32, i32, i32), i32>(&mut caller, "write")?
                    .call_async(&mut caller, args)
                    .await
            })
        },
    )?;
    linker.func_wrap_async(
        WASI,
        "path_open",
        move |mut caller: Caller<'_, State>,
              args: (i32, i32, i32, i32, i32, i64, i64, i32, i32)| {
            let module = forwarding.clone();
            let imports = imports.clone();
            Box::new(async move {
                if args.3 < 0 || args.3 > 2048 || caller.data().opens_left == 0 {
                    return Err(deny(&mut caller, Failure::OutputLimit));
                }
                caller.data_mut().opens_left -= 1;
                let instance = forwarding_instance(&mut caller, &module, &imports).await?;
                instance
                    .get_typed_func::<(i32, i32, i32, i32, i32, i64, i64, i32, i32), i32>(
                        &mut caller,
                        "open",
                    )?
                    .call_async(&mut caller, args)
                    .await
            })
        },
    )?;
    // No sparse-file growth, unbounded metadata creation, blocking signal or
    // process extensions. Sequential file writes remain available and metered.
    linker.func_wrap(WASI, "fd_seek", |_: i32, _: i64, _: i32, _: i32| -> i32 {
        58
    })?;
    linker.func_wrap(
        WASI,
        "fd_pwrite",
        |_: i32, _: i32, _: i32, _: i64, _: i32| -> i32 { 58 },
    )?;
    linker.func_wrap(WASI, "fd_allocate", |_: i32, _: i64, _: i64| -> i32 { 58 })?;
    linker.func_wrap(WASI, "fd_filestat_set_size", |_: i32, _: i64| -> i32 { 58 })?;
    linker.func_wrap(
        WASI,
        "path_create_directory",
        |_: i32, _: i32, _: i32| -> i32 { 58 },
    )?;
    linker.func_wrap(
        WASI,
        "path_link",
        |_: i32, _: i32, _: i32, _: i32, _: i32, _: i32, _: i32| -> i32 { 58 },
    )?;
    linker.func_wrap(
        WASI,
        "path_symlink",
        |_: i32, _: i32, _: i32, _: i32, _: i32| -> i32 { 58 },
    )?;
    linker.func_wrap(WASI, "proc_raise", |_: i32| -> i32 { 58 })?;
    linker.func_wrap(WASI, "fd_renumber", |_: i32, _: i32| -> i32 { 58 })?;
    Ok(())
}

// A host-to-host Func call has no calling Wasm memory. This fixed forwarding
// instance exports the SAME guest memory so stock WASI still validates pointers.
// It adds no memory, authority or guest-selected import and is created once/store.
async fn forwarding_instance(
    caller: &mut Caller<'_, State>,
    module: &Module,
    imports: &[wasmtime::Extern; 2],
) -> wasmtime::Result<wasmtime::Instance> {
    if let Some(instance) = caller.data().forwarding {
        return Ok(instance);
    }
    let memory = caller
        .get_export("memory")
        .and_then(|e| e.into_memory())
        .ok_or_else(|| wasmtime::format_err!("missing guest memory"))?;
    let instance = wasmtime::Instance::new_async(
        &mut *caller,
        module,
        &[imports[0].clone(), imports[1].clone(), memory.into()],
    )
    .await?;
    caller.data_mut().forwarding = Some(instance);
    Ok(instance)
}

fn forwarding_module(engine: &Engine) -> wasmtime::Result<Module> {
    use wasm_encoder::{
        CodeSection, EntityType, ExportKind, ExportSection, Function, FunctionSection,
        ImportSection, Instruction, MemoryType, TypeSection, ValType,
    };
    let mut module = wasm_encoder::Module::new();
    let mut types = TypeSection::new();
    types.ty().function([ValType::I32; 4], [ValType::I32]);
    types.ty().function(
        [
            ValType::I32,
            ValType::I32,
            ValType::I32,
            ValType::I32,
            ValType::I32,
            ValType::I64,
            ValType::I64,
            ValType::I32,
            ValType::I32,
        ],
        [ValType::I32],
    );
    module.section(&types);
    let mut imports = ImportSection::new();
    imports.import("host", "write", EntityType::Function(0));
    imports.import("host", "open", EntityType::Function(1));
    imports.import(
        "guest",
        "memory",
        EntityType::Memory(MemoryType {
            minimum: 0,
            maximum: None,
            memory64: false,
            shared: false,
            page_size_log2: None,
        }),
    );
    module.section(&imports);
    let mut functions = FunctionSection::new();
    functions.function(0).function(1);
    module.section(&functions);
    let mut exports = ExportSection::new();
    exports
        .export("memory", ExportKind::Memory, 0)
        .export("write", ExportKind::Func, 2)
        .export("open", ExportKind::Func, 3);
    module.section(&exports);
    let mut code = CodeSection::new();
    for (index, count) in [(0, 4), (1, 9)] {
        let mut function = Function::new([]);
        for local in 0..count {
            function.instruction(&Instruction::LocalGet(local));
        }
        function
            .instruction(&Instruction::Call(index))
            .instruction(&Instruction::End);
        code.function(&function);
    }
    module.section(&code);
    Module::from_binary(engine, &module.finish())
}

#[cfg(test)]
#[path = "wasi_tests.rs"]
mod wasi_confinement;
