"""Offline real-source JSON-balance regression for SHA-pinned bpftool 678d538.

Compiles source extracted from the exact pinned archive and tests synthetic
bpf_link_info-like structures. Never executes bpftool, libbpf, BPF, a debugger,
or live kernel enumeration. The synthetic kernel symbol loader uses no /proc.
"""
import hashlib
import json
import os
from pathlib import Path
import resource
import shutil
import subprocess
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src-tauri/target/clack-bpftool-fixed-build/bpftool-678d538a-source.tar"
LIBBPF = ROOT / "src-tauri/target/clack-bpftool-fixed-build/libbpf-872299d9-source.tar"
PATCH = ROOT / "scripts/clack-bpftool-json-balance.patch"
BUILDER = ROOT / "scripts/clack-build-json-balance-offline.sh"
BUILT = (ROOT / "src-tauri/target/clack-bpftool-json-balance"
         / "bpftool-json-balance-linux-x86_64")
RECEIPT = BUILT.parent / "build-summary.numeric"
SOURCE_SHA = "63ac89f708672bc0071f7f84bc389c51f20820e5d1bf1d45e077153edcbe6362"
LIBBPF_SHA = "66da46956d987ba2f15522f46810a4ce23132b01dea27452f21907a670ad2e74"
PATCH_SHA = "3404f298ae9e2eaef4ef0533971667bf1a1c71b3fe4e8bc4a489cf0749384d2d"
BUILT_SHA = "0e0059127c7c926fe1ee82a7804479415a19b73515b7aebc8bb59ce06de36fa0"
BUILT_ID = "7f530859f49ede16767f9f4eb8551a6ac85aa25d"

HARNESS_PREFIX = r'''
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "json_writer.h"
typedef uint64_t __u64;
typedef uint32_t __u32;
#define BPF_F_KPROBE_MULTI_RETURN (1u << 0)
#define p_err(...) ((void)0)
struct kernel_sym {
    __u64 address;
    char name[64];
    char module[64];
};
struct dump_data {
    __u32 sym_count;
    struct kernel_sym *sym_mapping;
};
struct bpf_link_info {
    struct {
        __u32 flags, count;
        __u64 missed, addrs, cookies;
    } kprobe_multi;
};
static struct dump_data dd;
static json_writer_t *json_wtr;
static int deny_allocation;
static void *u64_to_ptr(__u64 p) { return (void *)(uintptr_t)p; }
static void *synthetic_calloc(size_t count, size_t width)
{
    if (deny_allocation)
        return NULL;
    return calloc(count, width);
}
/* The exact real get_addr_cookie_array() uses calloc. Allow just its
 * allocation to be deterministically rejected by the synthetic fixture. */
#define calloc synthetic_calloc
'''

HARNESS_MIDDLE = r'''
#undef calloc
static void kernel_syms_load(struct dump_data *unused)
{
    /* Deterministic synthetic empty /proc/kallsyms; never reads the kernel. */
    (void)unused;
}
static bool is_x86_ibt_enabled(void) { return false; }
'''

HARNESS_MAIN = r'''
int main(int argc, char **argv)
{
    struct kernel_sym symbols[2] = {
        {.address = 0x100, .name = "synthetic_enter", .module = ""},
        {.address = 0x200, .name = "synthetic_return", .module = ""}
    };
    __u64 addrs[2] = {0x100, 0x200};
    __u64 cookies[2] = {11, 22};
    struct bpf_link_info info = {
        .kprobe_multi = {
            .flags = BPF_F_KPROBE_MULTI_RETURN, .count = 2, .missed = 0,
            .addrs = (__u64)(uintptr_t)addrs,
            .cookies = (__u64)(uintptr_t)cookies
        }
    };
    FILE *stream = tmpfile();
    if (!stream || argc != 2) return 3;
    dd.sym_mapping = symbols;
    dd.sym_count = strcmp(argv[1], "no-symbols") == 0 ? 0 : 2;
    deny_allocation = strcmp(argv[1], "no-data") == 0;
    json_wtr = jsonw_new(stream);
    if (!json_wtr) return 4;
    jsonw_start_array(json_wtr);    /* outer link enumeration */
    if (strcmp(argv[1], "idle") != 0) {
        jsonw_start_object(json_wtr);  /* link object */
        jsonw_string_field(json_wtr, "type", "kprobe_multi");
        show_kprobe_multi_json(&info, json_wtr);
        /* Synthetic owner metadata (same nesting style as pids.c). */
        jsonw_name(json_wtr, "pids");
        jsonw_start_array(json_wtr);
        jsonw_start_object(json_wtr);
        jsonw_int_field(json_wtr, "pid", 42);
        jsonw_string_field(json_wtr, "comm", "synthetic-only");
        jsonw_end_object(json_wtr);
        jsonw_end_array(json_wtr);
        jsonw_end_object(json_wtr);
    }
    jsonw_end_array(json_wtr);
    /* This is the REAL original jsonw_destroy, not a synthetic assert. */
    jsonw_destroy(&json_wtr);
    rewind(stream);
    int ch;
    while ((ch = fgetc(stream)) != EOF)
        if (putchar(ch) == EOF) return 5;
    fclose(stream);
    return 0;
}
'''


def extract_between(source, start, stop):
    begin = source.index(start)
    return source[begin:source.index(stop, begin)]


def no_core():
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


@unittest.skipUnless(os.name == "posix" and shutil.which("cc"),
                     "Run in unprivileged Linux/WSL with compiler")
class OriginalBpftoolWriterBalance(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        for path, expected in ((SOURCE, SOURCE_SHA), (LIBBPF, LIBBPF_SHA)):
            if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
                raise AssertionError("Unapproved source archive")
        cls.directory = tempfile.TemporaryDirectory(prefix="clack-offline-json-balance-")
        cls.folder = Path(cls.directory.name)
        with tarfile.open(SOURCE, "r") as archive:
            link = (archive.extractfile("src/link.c").read().decode("utf-8")
                    .replace("\r\n", "\n"))
            writer = archive.extractfile("src/json_writer.c").read()
            header = archive.extractfile("src/json_writer.h").read()
        cls.link = link
        cls.patch = PATCH.read_text(encoding="utf-8")
        (cls.folder / "json_writer.c").write_bytes(writer)
        (cls.folder / "json_writer.h").write_bytes(header)
        (cls.folder / "linux").mkdir()
        # Only the kernel header's annotation needs a local compatibility
        # substitute; production writer and renderer code remain verbatim.
        (cls.folder / "linux/compiler.h").write_text(
            "#define __printf(a,b) __attribute__((format(printf,a,b)))\n",
            encoding="ascii")
        cls.original = cls.folder / "original"
        cls.corrected = cls.folder / "corrected"
        # These three slices are verbatim from the pinned src/link.c.
        helpers = extract_between(link, "struct addr_cookie {",
                                  "static bool is_x86_ibt_enabled(void)")
        matches = extract_between(link, "static bool\nsymbol_matches_target(",
                                  "static void\nshow_kprobe_multi_json(")
        renderer = extract_between(link, "static void\nshow_kprobe_multi_json(",
                                   "static __u64 *u64_to_arr(")
        cls.renderer_original = renderer
        # Apply the same reviewed patch to the extracted real renderer; never
        # hand-maintain a second implementation of the corrected function.
        cls._write_and_compile("original", helpers, matches, renderer)
        patched_link = cls._apply_patch_to_real_link(link)
        corrected_renderer = extract_between(patched_link,
                                             "static void\nshow_kprobe_multi_json(",
                                             "static __u64 *u64_to_arr(")
        cls.renderer_corrected = corrected_renderer
        cls._write_and_compile("corrected", helpers, matches, corrected_renderer)

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, "directory"):
            cls.directory.cleanup()

    @classmethod
    def _apply_patch_to_real_link(cls, source):
        # Validate a real Git-style patch against exactly the pinned source,
        # without touching the original archive or repository.
        (cls.folder / "src").mkdir()
        (cls.folder / "src/link.c").write_text(source, encoding="utf-8")
        result = subprocess.run(["git", "apply", "--check", str(PATCH)],
                                cwd=cls.folder, capture_output=True,
                                timeout=5)
        if result.returncode:
            raise AssertionError("Patch does not apply to pinned source: " +
                                 result.stderr.decode("utf-8", errors="replace")[:400])
        subprocess.run(["git", "apply", str(PATCH)], cwd=cls.folder,
                       check=True, capture_output=True, timeout=5)
        output = (cls.folder / "src/link.c").read_text(encoding="utf-8")
        if output.count("if (++j == info->kprobe_multi.count)") != 2:
            raise AssertionError("Previously pinned ++j fix not preserved")
        return output

    @classmethod
    def _write_and_compile(cls, mode, helpers, matches, renderer):
        source = (HARNESS_PREFIX + helpers + HARNESS_MIDDLE + matches +
                  renderer + HARNESS_MAIN)
        path = cls.folder / (mode + ".c")
        path.write_text(source, encoding="utf-8")
        result = subprocess.run(
            ["cc", "-g", "-O0", "-std=gnu11", "-fno-omit-frame-pointer",
             "-I", str(cls.folder), str(path), str(cls.folder / "json_writer.c"),
             "-o", str(cls.folder / mode)],
            cwd=cls.folder, capture_output=True, timeout=12)
        if result.returncode != 0:
            raise AssertionError("Fixture compiler failed: " +
                                 result.stderr.decode("utf-8", errors="replace")[:1500])

    def exercise(self, binary, mode):
        completed = subprocess.run([str(binary), mode], cwd=self.folder,
                                   stdin=subprocess.DEVNULL,
                                   capture_output=True, timeout=4,
                                   preexec_fn=no_core)
        self.assertFalse(list(self.folder.glob("core*")))
        self.assertLess(len(completed.stderr), 4096)
        return completed

    def test_exact_writer_depth_invariant_and_source_locations(self):
        with tarfile.open(SOURCE, "r") as archive:
            source = archive.extractfile("src/json_writer.c").read().decode("utf-8")
        self.assertEqual(source.splitlines()[106].strip(), "assert(self->depth == 0);")
        lines = self.link.splitlines()
        self.assertEqual(lines[336].strip(), "jsonw_start_array(json_wtr);")
        self.assertEqual(lines[341].strip(), "return;")
        self.assertEqual(lines[347].strip(), "goto error;")
        self.assertEqual(lines[369].strip(), "jsonw_end_array(json_wtr);")
        self.assertEqual(lines[370].strip(), "error:")
        self.assertEqual(lines[366].strip(),
                         "if (++j == info->kprobe_multi.count)")

    def test_original_real_writer_asserts_on_both_early_exit_paths(self):
        for case in ("no-symbols", "no-data"):
            with self.subTest(case=case):
                result = self.exercise(self.original, case)
                self.assertEqual(result.returncode, -6)
                self.assertIn(b"jsonw_destroy", result.stderr)
                self.assertIn(b"self->depth == 0", result.stderr)
                self.assertEqual(result.stdout, b"")

    def test_corrected_real_writer_all_paths_valid_and_owner_preserved(self):
        for case, expected_count in (("symbols", 2), ("no-symbols", 0),
                                     ("no-data", 0)):
            with self.subTest(case=case):
                result = self.exercise(self.corrected, case)
                self.assertEqual(result.returncode, 0)
                self.assertEqual(result.stderr, b"")
                value = json.loads(result.stdout)
                self.assertEqual(len(value), 1)
                self.assertEqual(value[0]["type"], "kprobe_multi")
                self.assertEqual(value[0]["func_cnt"], 2)
                self.assertEqual(len(value[0]["funcs"]), expected_count)
                self.assertEqual(value[0]["pids"],
                                 [{"pid": 42, "comm": "synthetic-only"}])
                if case == "symbols":
                    self.assertEqual([x["cookie"] for x in value[0]["funcs"]],
                                     [11, 22])
                    self.assertEqual([x["func"] for x in value[0]["funcs"]],
                                     ["synthetic_enter", "synthetic_return"])

    def test_idle_and_complete_symbols_unchanged(self):
        for mode in ("idle", "symbols"):
            with self.subTest(mode=mode):
                a = self.exercise(self.original, mode)
                b = self.exercise(self.corrected, mode)
                self.assertEqual(a.returncode, b.returncode)
                self.assertEqual(a.stdout, b.stdout)
                self.assertEqual(json.loads(b.stdout), [] if mode == "idle"
                                 else json.loads(a.stdout))

    def test_patch_keeps_prior_j_fix_and_only_changes_kprobe_json_scope(self):
        orig = self.renderer_original
        corrected = self.renderer_corrected
        self.assertEqual(orig.count("jsonw_start_array(json_wtr);"), 1)
        self.assertEqual(corrected.count("jsonw_start_array(json_wtr);"), 1)
        self.assertEqual(corrected.count("jsonw_end_array(json_wtr);"), 1)
        self.assertEqual(corrected.count("goto out;"), 2)
        self.assertNotIn("goto error;", corrected)
        self.assertIn("if (++j == info->kprobe_multi.count)", corrected)
        self.assertIn("free(data);", corrected)


class OfflineBuildSafety(unittest.TestCase):
    def test_unchanged_archive_patch_and_no_install_builder(self):
        self.assertEqual(hashlib.sha256(PATCH.read_bytes()).hexdigest(), PATCH_SHA)
        source = BUILDER.read_text(encoding="utf-8")
        for token in (SOURCE_SHA, LIBBPF_SHA, PATCH_SHA, "SOURCE_DATE_EPOCH",
                      "SKIP_LLVM=1 SKIP_LIBBFD=1", "pid_iter.skel.h",
                      "pids.o", "git -C", "apply --ignore-whitespace"):
            with self.subTest(token=token):
                self.assertIn(token, source)
        for unsafe in ("/usr/bin/sudo", "make install", "/opt/clack",
                       "/api/tags", "ollama run", "/usr/bin/bpftrace ",
                       "bpf_link_create(", "bpftool -j link show"):
            with self.subTest(unsafe=unsafe):
                if unsafe == "make install":
                    # Only an explicit prohibition in a comment is allowed.
                    self.assertNotIn("\n/usr/bin/make install", source)
                else:
                    self.assertNotIn(unsafe, source)
        self.assertIn("BUILT_BINARY_EXECUTED=0", source)

    def test_independent_binary_and_build_id_receipt(self):
        if not BUILT.is_file() or not RECEIPT.is_file():
            self.skipTest("Ignored offline build artifacts not present")
        self.assertEqual(hashlib.sha256(BUILT.read_bytes()).hexdigest(), BUILT_SHA)
        record = dict(line.split("=", 1) for line in
                      RECEIPT.read_text(encoding="ascii").splitlines())
        self.assertEqual(record["OFFLINE_JSON_BUILD"], "PASS")
        self.assertEqual(record["BINARY_SHA256"], BUILT_SHA)
        self.assertEqual(record["BINARY_BUILD_ID"], BUILT_ID)
        self.assertEqual(record["BINARY_BYTES"], str(BUILT.stat().st_size))
        self.assertEqual(record["SOURCE_COMMIT"],
                         "678d538a85e6960f84e443695eebb13f66f89981")
        self.assertEqual(record["LIBBPF_COMMIT"],
                         "872299d94e27d2fa9f119667c7e52268698dc760")
        self.assertEqual(record["PATCH_SHA256"], PATCH_SHA)
        self.assertEqual(record["OWNER_PID_SKELETON"], "PASS")
        self.assertEqual(record["BUILT_BINARY_EXECUTED"], "0")
        # ELF metadata inspection only; do not run the new bpftool.
        output = subprocess.run(["readelf", "-n", str(BUILT)],
                                capture_output=True, timeout=5, check=True)
        self.assertIn(("Build ID: " + BUILT_ID).encode("ascii"), output.stdout)


if __name__ == "__main__":
    unittest.main()
