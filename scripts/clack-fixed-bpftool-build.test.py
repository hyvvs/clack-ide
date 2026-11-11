"""Pinned-source and fail-closed handoff checks. No SSH, sudo or BPF attach."""

import hashlib
from pathlib import Path
import re
import tarfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "src-tauri/target/clack-bpftool-fixed-build"
BPFT_ARCHIVE = SOURCE_DIR / "bpftool-678d538a-source.tar"
LIBBPF_ARCHIVE = SOURCE_DIR / "libbpf-872299d9-source.tar"
BUILDER = ROOT / "scripts/clack-build-fixed-bpftool.sh"
OPERATOR = ROOT / "scripts/Build-ClackFixedBpftool.ps1"
ROOT_INSTALLER = ROOT / "scripts/clack-install-fixed-bpftool.sh"
ROOT_OPERATOR = ROOT / "scripts/Install-ClackFixedBpftool.ps1"


class PinnedBuildOfflineTests(unittest.TestCase):
    def test_reviewed_builder_checks_exact_pins_and_preserves_skeletons(self):
        source = BUILDER.read_text(encoding="utf-8")
        self.assertIn(
            "63ac89f708672bc0071f7f84bc389c51f20820e5d1bf1d45e077153edcbe6362",
            source)
        self.assertIn(
            "66da46956d987ba2f15522f46810a4ce23132b01dea27452f21907a670ad2e74",
            source)
        self.assertIn("SOURCE_DATE_EPOCH=1793705106", source)
        self.assertIn("SKIP_LLVM=1 SKIP_LIBBFD=1", source)
        self.assertIn("pid_iter.skel.h", source)
        self.assertIn("pids.o", source)
        self.assertIn("UNEXPECTED_SUBMODULE_ARCHIVE_CONTENT", source)
        self.assertIn("find \"$stage/source/libbpf\" -mindepth 1", source)
        self.assertNotIn("SKIP_CRYPTO=1", source)
        self.assertNotIn("BPFTOOL_WITHOUT_SKELETONS", source)
        self.assertNotRegex(source, r"(?m)^\s*(?:/usr/bin/)?(?:sudo|make\s+install)\b")

    def test_windows_handoff_does_not_shadow_packaged_tool_or_sudo(self):
        source = OPERATOR.read_text(encoding="utf-8")
        self.assertIn("StrictHostKeyChecking=yes", source)
        self.assertIn("BatchMode=yes", source)
        self.assertIn("Exclusive diagnostic build attempt already exists", source)
        self.assertIn("Get-FileHash -LiteralPath $binaryPath", source)
        self.assertNotIn("Set-Item Env:PATH", source)
        self.assertNotRegex(source, r"(?im)^\s*&\s*(?:sudo|bpftrace|ollama)\b")

    def test_root_idle_qualification_is_separate_and_metadata_only(self):
        script = ROOT_INSTALLER.read_text(encoding="utf-8")
        operator = ROOT_OPERATOR.read_text(encoding="utf-8")
        self.assertIn("/opt/clack/diagnostic-tools/bpftool-678d538", script)
        self.assertIn("schemaVersion", script)
        self.assertIn("binarySha256", script)
        self.assertIn("root-idle-summary.numeric", script)
        self.assertIn("CLACK_BPFT_ROOT_QUALIFICATION=PASS", script)
        self.assertIn("CLACK_BPFT_IDLE_{kind.upper()}_COMPARE=PASS", script)
        self.assertIn('"-j", kind, "show"', script)
        self.assertIn('"-j", "version"', script)
        self.assertIn("root-owned", operator)
        self.assertIn("StrictHostKeyChecking=yes", operator)
        self.assertIn("BatchMode=yes", operator)
        self.assertIn("sudo /usr/bin/bash -s", operator)
        self.assertNotIn("pacman -S", script)
        self.assertNotIn("apt-get", script)
        self.assertNotIn("bpftrace ", script)
        self.assertNotRegex(script, r"(?m)^\s*(?:/usr/bin/)?(?:bpftool|make)\s+(?:prog\s+load|install)\b")
        # Bash syntax-check alone does not validate embedded Python snippets.
        snippets = re.findall(r"<<'PY'\n(.*?)\nPY", script, re.S)
        self.assertEqual(len(snippets), 2)
        for i, source in enumerate(snippets):
            compile(source, f"root-idle-snippet-{i}.py", "exec")

    def test_exact_git_archives_have_fixed_renderer_and_empty_gitlink(self):
        if not BPFT_ARCHIVE.is_file() or not LIBBPF_ARCHIVE.is_file():
            self.skipTest("Ignored task-owned pinned source archives not present")
        expected = (
            (BPFT_ARCHIVE,
             "63ac89f708672bc0071f7f84bc389c51f20820e5d1bf1d45e077153edcbe6362"),
            (LIBBPF_ARCHIVE,
             "66da46956d987ba2f15522f46810a4ce23132b01dea27452f21907a670ad2e74"),
        )
        for path, sha in expected:
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), sha)
        with tarfile.open(BPFT_ARCHIVE, "r") as source:
            names = source.getnames()
            self.assertIn("libbpf", {name.rstrip("/") for name in names})
            self.assertFalse([name for name in names
                              if name.startswith("libbpf/") and
                              name.rstrip("/") != "libbpf"])
            link = source.extractfile("src/link.c").read().decode("utf-8")
            self.assertEqual(link.count(
                "if (++j == info->kprobe_multi.count)"), 2)
            self.assertNotIn("if (j++ == info->kprobe_multi.count)", link)
            self.assertIn("7.8.1", source.extractfile(
                "src/Makefile").read().decode("utf-8"))
        with tarfile.open(LIBBPF_ARCHIVE, "r") as source:
            makefile = source.extractfile(
                "src/Makefile").read().decode("utf-8")
            self.assertRegex(makefile, r"LIBBPF_MINOR_VERSION := 9")


if __name__ == "__main__":
    unittest.main()
