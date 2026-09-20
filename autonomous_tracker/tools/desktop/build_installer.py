"""Build an offline Windows installer from the verified local CPU Python runtime."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata as metadata
import json
import os
import shutil
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from packaging.markers import default_environment
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def packaged_path(relative: Path) -> Path:
    original = Path("runtime/Lib/site-packages") / relative
    if (
        len(original.as_posix()) > 145
        and relative.parts[0].endswith(".dist-info")
        and "licenses" in relative.parts
    ):
        identity = hashlib.sha256(relative.as_posix().encode("utf-8")).hexdigest()[:24]
        return Path("third-party-licenses") / f"{identity}.txt"
    return original


def dependencies(roots: list[str]) -> list[metadata.Distribution]:
    selected: dict[str, metadata.Distribution] = {}
    pending = [(name, frozenset()) for name in roots]
    processed: set[tuple[str, frozenset[str]]] = set()
    environment = default_environment()
    while pending:
        name, extras = pending.pop()
        name = canonicalize_name(name)
        if (name, extras) in processed:
            continue
        processed.add((name, extras))
        distribution = metadata.distribution(name)
        selected[name] = distribution
        for raw in distribution.requires or []:
            requirement = Requirement(raw)
            contexts = extras | {""}
            if requirement.marker is None or any(
                requirement.marker.evaluate({**environment, "extra": extra}) for extra in contexts
            ):
                installed = metadata.version(requirement.name)
                if requirement.specifier and not requirement.specifier.contains(
                    installed, prereleases=True
                ):
                    raise ValueError(
                        f"Installed {requirement.name} {installed} does not satisfy {requirement}"
                    )
                pending.append((requirement.name, frozenset(requirement.extras)))
    return [selected[name] for name in sorted(selected)]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--compiler", type=Path, default=Path(__file__).parent / "vendor/inno-6.7.3/ISCC.exe"
    )
    parser.add_argument("--version", default="0.9.0")
    parser.add_argument("--bundle-only", action="store_true")
    args = parser.parse_args()
    if sys.platform != "win32" or sys.version_info[:2] != (3, 12):
        parser.error("Build using the tested Windows x64 Python 3.12 environment.")
    import torch

    if torch.version.cuda is not None:
        parser.error("This installer profile requires the CPU-only PyTorch build.")
    if not args.bundle_only and not args.compiler.is_file():
        parser.error("Install a trusted Inno Setup compiler or pass --compiler.")
    workspace = Path(__file__).resolve().parents[2]
    build = workspace / "build" / f"desktop-{datetime.now(UTC):%Y%m%d-%H%M%S}-{uuid4().hex[:8]}"
    bundle = build / "bundle"
    runtime = bundle / "runtime"
    runtime.mkdir(parents=True, exist_ok=False)
    base = Path(sys.base_prefix)
    print(f"Bundling isolated CPython from {base}", flush=True)
    for pattern in ("python*.exe", "*.dll", "LICENSE.txt"):
        for path in base.glob(pattern):
            shutil.copy2(path, runtime / path.name)
    ignore = shutil.ignore_patterns(
        "__pycache__", "*.pyc", "site-packages", "test", "tests", "idlelib", "ensurepip", "venv"
    )
    for name in ("Lib", "DLLs", "tcl"):
        shutil.copytree(base / name, runtime / name, ignore=ignore)
    site = runtime / "Lib/site-packages"
    site.mkdir()
    records = []
    relocated_licenses: dict[str, str] = {}
    packages = dependencies(
        ["numpy", "opencv-python", "pydantic", "PyYAML", "scipy", "ultralytics", "lap"]
    )
    for distribution in packages:
        name = distribution.metadata["Name"]
        print(f"Vendoring {name} {distribution.version}", flush=True)
        root = Path(distribution.locate_file("")).resolve()
        count = 0
        for item in distribution.files or []:
            relative = Path(str(item))
            source = Path(distribution.locate_file(item)).resolve()
            if (
                not source.is_relative_to(root)
                or "__pycache__" in relative.parts
                or source.suffix == ".pyc"
            ):
                continue
            original = (site / relative).resolve()
            if not original.is_relative_to(site.resolve()):
                continue
            target = (bundle / packaged_path(relative)).resolve()
            if not target.is_relative_to(bundle.resolve()):
                raise ValueError("Packaged dependency path escapes the bundle.")
            if len(target.relative_to(bundle.resolve()).as_posix()) > 150:
                raise ValueError(f"Dependency path is too long for the installer: {relative}")
            if target != original:
                relocated_licenses[relative.as_posix()] = target.relative_to(bundle).as_posix()
            if not source.is_file():
                raise ValueError(f"Installed runtime file is missing: {source}")
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            count += 1
        records.append(
            {
                "name": name,
                "version": distribution.version,
                "files": count,
                "license": distribution.metadata.get("License-Expression")
                or distribution.metadata.get("License"),
                "homepage": distribution.metadata.get_all("Project-URL") or [],
            }
        )
    if relocated_licenses:
        with (bundle / "third-party-licenses/index.json").open("x", encoding="utf-8") as stream:
            json.dump(relocated_licenses, stream, indent=2)
    app = bundle / "app/tracker"
    app.mkdir(parents=True)
    for name in ("__init__.py", "config.py"):
        shutil.copy2(workspace / "src/tracker" / name, app / name)
    shutil.copytree(
        workspace / "src/tracker/rescue",
        app / "rescue",
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )
    (app / "cli").mkdir()
    for path in (workspace / "src/tracker/cli").glob("rescue_*.py"):
        shutil.copy2(path, app / "cli" / path.name)
    shutil.copy2(workspace / "src/tracker/cli/__init__.py", app / "cli/__init__.py")
    (runtime / "python312._pth").write_text(
        ".\nLib\nDLLs\nLib/site-packages\n../app\nimport site\n", encoding="utf-8"
    )
    (bundle / "INSTALL-NOTES.txt").write_text(
        "Rescue Studio - local observation and human-reviewed model training\n\n"
        "Includes a private CPU Python runtime. No Python installation, virtual environment, "
        "administrator access or dependency downloads are needed to run the installed app.\n"
        "Choose or create a workspace at first launch. Videos, annotations, model weights and "
        "training results are stored there, outside the app folder, and are not uninstalled.\n"
        "No footage or trained weights are bundled. Import trusted local detection weights through "
        "Model library. Loading untrusted .pt files can execute code.\n"
        "This is an unsigned development build, "
        "not a field-readiness or commercial-license certification. "
        "Windows may show an unknown-publisher warning. "
        "No hardware or projectile interfaces are packaged.\n"
        "Third-party packages retain their bundled license notices. Ultralytics is AGPL-licensed; "
        "deeply nested notices are indexed under third-party-licenses "
        "to avoid Windows path limits. "
        "review applicable source-distribution or commercial-license obligations "
        "before redistribution. The manifest records package versions; "
        "it does not grant rights to datasets or model weights.\n"
        "Installer built with Inno Setup: https://jrsoftware.org/\n",
        encoding="utf-8",
    )
    docs = bundle / "docs"
    docs.mkdir()
    for path in (workspace / "docs").glob("RESCUE*.md"):
        shutil.copy2(path, docs / path.name)
    compiler = Path(os.environ["WINDIR"]) / "Microsoft.NET/Framework64/v4.0.30319/csc.exe"
    subprocess.run(
        [
            str(compiler),
            "/nologo",
            "/target:winexe",
            "/optimize+",
            "/reference:System.Windows.Forms.dll",
            f"/out:{bundle / 'Rescue Studio.exe'}",
            str(Path(__file__).parent / "InstalledLauncher.cs"),
        ],
        check=True,
    )
    print("Verifying bundled runtime without development environment paths...", flush=True)
    environment = {
        key: value
        for key, value in os.environ.items()
        if key not in {"PYTHONHOME", "PYTHONPATH", "VIRTUAL_ENV"}
    }
    environment.update(
        TCL_LIBRARY=str(runtime / "tcl/tcl8.6"),
        TK_LIBRARY=str(runtime / "tcl/tk8.6"),
        PYTHONDONTWRITEBYTECODE="1",
    )
    subprocess.run(
        [
            str(runtime / "python.exe"),
            "-B",
            "-m",
            "tracker.cli.rescue_runtime_check",
            "--output",
            str(build / "runtime-check"),
        ],
        cwd=build,
        env=environment,
        check=True,
    )
    check = json.loads((build / "runtime-check/runtime-check.json").read_bytes())
    if not check["isolated"] or any(
        not Path(path).resolve().is_relative_to(bundle.resolve()) for path in check["sys_path"]
    ):
        raise ValueError("Runtime is not isolated to the bundle.")
    inventory = {
        path.relative_to(bundle).as_posix(): sha256(path)
        for path in bundle.rglob("*")
        if path.is_file()
    }
    with (bundle / "package-manifest.json").open("x", encoding="utf-8") as stream:
        json.dump(
            {
                "version": args.version,
                "python": sys.version,
                "profile": "windows-x64-cpu",
                "packages": records,
                "files": inventory,
                "note": "No weights or user data included. Unsigned local development build.",
            },
            stream,
            indent=2,
        )
    if not args.bundle_only:
        output = workspace / "dist" / build.name
        output.mkdir(parents=True, exist_ok=False)
        log_path = build / "installer-compiler.log"
        print(f"Compiling installer; detailed log: {log_path}", flush=True)
        with log_path.open("xb") as log:
            result = subprocess.run(
                [
                    str(args.compiler.resolve()),
                    f"/DBundleDir={bundle}",
                    f"/DOutputDir={output}",
                    f"/DBuildVersion={args.version}",
                    str(Path(__file__).parent / "RescueStudio.iss"),
                ],
                stdout=log,
                stderr=subprocess.STDOUT,
            )
        if result.returncode:
            raise ValueError(f"Installer compiler failed. See {log_path}")
        installer = output / f"RescueStudio-Setup-{args.version}-win64.exe"
        (output / "SHA256.txt").write_text(
            f"{sha256(installer)}  {installer.name}\n", encoding="utf-8"
        )
        print(f"Installer: {installer}", flush=True)
    print(f"Verified bundle: {bundle}", flush=True)


if __name__ == "__main__":
    main()
