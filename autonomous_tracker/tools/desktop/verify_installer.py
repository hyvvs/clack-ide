"""Test the actual installer in a disposable directory, then uninstall only that QA copy."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

from build_installer import sha256


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--installer", type=Path, required=True)
    args = parser.parse_args()
    if sys.platform != "win32":
        parser.error("Installer verification requires Windows.")
    import winreg

    key = r"Software\Microsoft\Windows\CurrentVersion\Uninstall"
    key += r"\{B0B1C830-75C1-45F1-93A6-7D503C4D765E}_is1"
    try:
        existing = winreg.OpenKey(winreg.HKEY_CURRENT_USER, key)
    except FileNotFoundError:
        pass
    else:
        existing.Close()
        raise ValueError("Rescue Studio is already installed; do not replace it during QA.")
    installer = args.installer.resolve(strict=True)
    project = Path(__file__).resolve().parents[2]
    qa = project / "diagnostics" / f"installer-qa-{uuid4().hex[:8]}"
    qa.mkdir(parents=True, exist_ok=False)
    application = (qa / "application").resolve()
    if application.parent != qa.resolve() or application.exists():
        raise ValueError("QA installation target must be a new child of the diagnostic directory.")
    workspace = qa / "user-workspace"
    workspace.mkdir()
    marker = workspace / "preservation-check.txt"
    marker.write_text("Disposable user workspace must survive uninstall.\n", encoding="utf-8")
    original = sha256(marker)
    print(f"Installing disposable QA copy into {application}", flush=True)
    subprocess.run(
        [
            str(installer),
            "/VERYSILENT",
            "/SUPPRESSMSGBOXES",
            "/NORESTART",
            "/CURRENTUSER",
            "/NOICONS",
            f"/DIR={application}",
            f"/LOG={qa / 'install.log'}",
        ],
        check=True,
        timeout=240,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    uninstaller = application / "uninstall/unins000.exe"
    manifest = json.loads((application / "package-manifest.json").read_bytes())
    for name, expected in manifest["files"].items():
        path = (application / name).resolve()
        if not path.is_relative_to(application) or sha256(path) != expected:
            raise ValueError(f"Installed file mismatch: {name}")
    runtime = application / "runtime"
    environment = {
        key: value
        for key, value in os.environ.items()
        if key not in {"PYTHONHOME", "PYTHONPATH", "VIRTUAL_ENV"}
    }
    environment.update(
        TCL_LIBRARY=str(runtime / "tcl/tcl8.6"),
        TK_LIBRARY=str(runtime / "tcl/tk8.6"),
        PYTHONDONTWRITEBYTECODE="1",
        PYTHONIOENCODING="utf-8",
    )
    subprocess.run(
        [
            str(runtime / "python.exe"),
            "-B",
            "-m",
            "tracker.cli.rescue_runtime_check",
            "--output",
            str(qa / "runtime-check"),
        ],
        check=True,
        timeout=90,
        cwd=qa,
        env=environment,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    subprocess.run(
        [
            sys.executable,
            str(Path(__file__).with_name("verify_runtime_workflow.py")),
            "--runtime",
            str(runtime),
        ],
        check=True,
        timeout=240,
        cwd=project,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    if not uninstaller.resolve(strict=True).is_relative_to(application):
        raise ValueError("Uninstaller escaped the verified QA installation target.")
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key) as registry:
        location = Path(winreg.QueryValueEx(registry, "InstallLocation")[0]).resolve()
    if location != application or application.parent != qa.resolve():
        raise ValueError("Refusing to uninstall anything outside the verified QA app directory.")
    print("Uninstalling only the verified disposable QA copy...", flush=True)
    subprocess.run(
        [
            str(uninstaller),
            "/VERYSILENT",
            "/SUPPRESSMSGBOXES",
            "/NORESTART",
            f"/LOG={qa / 'uninstall.log'}",
        ],
        check=True,
        timeout=120,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    if sha256(marker) != original or (application / "Rescue Studio.exe").exists():
        raise ValueError("Uninstall preservation check failed.")
    with (qa / "verification.json").open("x", encoding="utf-8") as stream:
        json.dump(
            {
                "status": "passed",
                "installer": str(installer),
                "installer_sha256": sha256(installer),
                "installed_files_verified": len(manifest["files"]),
                "workspace_preserved": True,
                "qa_application_uninstalled": True,
                "qa_directory": str(qa),
            },
            stream,
            indent=2,
        )
    print(f"Installer verification passed: {qa / 'verification.json'}", flush=True)


if __name__ == "__main__":
    main()
