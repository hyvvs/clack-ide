"""Unprivileged offline atomic replacement fixtures; never invoke the installer."""
import base64
import hashlib
import os
from pathlib import Path
import re
import subprocess
import unittest

HERE = Path(__file__).parent
ENTRY = HERE / "Replace-ClackBpftoolCrashCapture.ps1"
WRAPPER = HERE / "clack-bpftool-abort-capture.py"
NEW = "143c040fe9db82e23f722f77704841f1ac5bc12fbb21c8d0646169f2c01a15fe"
OLD = "c5002328d5563c6af32559c4809940d9f89bfc78f330fe9e2022805bca4ac126"
FIXED = "ff08d9fe9a545f488f4ecc7145f491027704a2139987f08432c1f9265be70e3d"


def root_body():
    match = re.search(r"\$bootstrap = @'\n(.*?)\n'@",
                      ENTRY.read_text(encoding="utf-8"), re.S)
    if not match:
        raise AssertionError("Missing literal Bash bootstrap")
    return match.group(1)


class Boundaries(unittest.TestCase):
    def test_exact_pins_and_no_production_execution(self):
        self.assertEqual(hashlib.sha256(WRAPPER.read_bytes()).hexdigest(), NEW)
        text = ENTRY.read_text(encoding="utf-8")
        for value in (NEW, OLD, FIXED, "StrictHostKeyChecking=yes",
                      "BatchMode=yes", "/usr/bin/sudo /usr/bin/bash -s",
                      '[[ $(sha "$dest") == "$old" ]]',
                      '[[ $(sha "$tmp/replacement.py") == "$new" ]]',
                      '[[ $(sha "$tmp/previous.py") == "$old" ]]',
                      '/usr/bin/mv -T -- "$tmp/replacement.py" "$dest"',
                      '/usr/bin/mv -T -- "$tmp/revert.py" "$dest"',
                      "CLACK_CRASH_REPLACE_EXECUTED=0"):
            with self.subTest(value=value):
                self.assertIn(value, text)
        self.assertLess(text.index("swapped=1\n/usr/bin/mv -T"),
                        text.index('[[ $(sha "$dest") == "$new" ]]'))
        self.assertLess(text.index('[[ $(sha "$dest") == "$new" ]]'),
                        text.index("verified=1\n"))
        for forbidden in ("/usr/bin/gdb --version", "/usr/bin/bpftool -",
                          "/usr/bin/bpftrace ", "/api/tags", "/api/chat",
                          "ollama run", "curl ", "rm -rf"):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, root_body())

    def test_bash_parser_accepts_embedded_root_script(self):
        result = subprocess.run(
            ["wsl.exe", "-d", "Ubuntu", "--exec", "/usr/bin/bash", "-n"],
            input=root_body().encode("ascii"), capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)


@unittest.skipUnless(os.name == "nt", "Windows + WSL fixture")
class SyntheticAtomicSemantics(unittest.TestCase):
    def simulate(self, scenario):
        old = hashlib.sha256(b"old-fixture\n").hexdigest()
        new = hashlib.sha256(b"new-fixture\n").hexdigest()
        fixed = hashlib.sha256(b"fixed-fixture\n").hexdigest()
        bash = root_body()
        adaptations = [
            ("stage='__STAGE__'", 'stage="$fixture/upload"'),
            ("parent=/opt/clack/diagnostic-tools", 'parent="$fixture/dir"'),
            ("old='__OLD__'", "old='" + old + "'"),
            ("new='__NEW__'", "new='" + new + "'"),
            ("fixed='__FIXED__'", "fixed='" + fixed + "'"),
            ("0:0:600:1", "1000:1000:600:1"),
            ("0:0:755:1", "1000:1000:755:1"),
            ("0:0:700", "1000:1000:700"),
            ("[[ $(/usr/bin/id -u) == 0 ]]", "[[ $(/usr/bin/id -u) == 1000 ]]"),
            ("hylab:700", "hayden:700"),
            ("== hylab ]]", "== hayden ]]"),
            ('for dir in /opt /opt/clack "$parent"; do',
             'for dir in "$parent"; do'),
            ('$(/usr/bin/stat -c \'%u\' -- "$dir") == 0',
             '$(/usr/bin/stat -c \'%u\' -- "$dir") == 1000'),
            ("/usr/bin/install -o root -g root",
             "/usr/bin/install -o hayden -g hayden"),
            (r"^/opt/clack/diagnostic-tools/\.clack-crash-replace\.",
             r"^$fixture/dir/\.clack-crash-replace\."),
            ("/run/local-muse-ebpf", '"$fixture/no-operator-session"'),
            ("if /usr/bin/pgrep -x bpftrace >/dev/null; then",
             "if false; then"),
            ("if /usr/bin/pgrep -x gdb >/dev/null; then",
             "if false; then"),
        ]
        for before, after in adaptations:
            if before not in bash:
                raise AssertionError("Synthetic transform missing: " + before)
            bash = bash.replace(before, after)
        if scenario == "rollback":
            needle = '/usr/bin/mv -T -- "$tmp/replacement.py" "$dest"\n'
            self.assertIn(needle, bash)
            bash = bash.replace(needle, needle + "false # synthetic after-rename fault\n")
        setup = r'''set -Eeuo pipefail
umask 077
fixture=$(/usr/bin/mktemp -d -p /tmp clack-replace-fixture.XXXXXXXX)
/usr/bin/mkdir -m 0700 -- "$fixture/dir" "$fixture/upload"
printf 'old-fixture\n' >"$fixture/dir/clack-bpftool-abort-capture.py"
printf 'fixed-fixture\n' >"$fixture/dir/bpftool-678d538"
printf 'new-fixture\n' >"$fixture/upload/observer.py"
/usr/bin/chmod 0600 -- "$fixture/dir/clack-bpftool-abort-capture.py"
/usr/bin/chmod 0755 -- "$fixture/dir/bpftool-678d538"
'''
        if scenario == "bad_old":
            setup += "printf 'wrong-old\\n' >\"$fixture/dir/clack-bpftool-abort-capture.py\"\n"
        elif scenario == "bad_stage":
            setup += "printf 'wrong-new\\n' >\"$fixture/upload/observer.py\"\n"
        elif scenario == "symlink":
            setup += ("/usr/bin/mv -- \"$fixture/dir/clack-bpftool-abort-capture.py\" "
                      "\"$fixture/previous\"\n"
                      "/usr/bin/ln -s -- \"$fixture/previous\" "
                      "\"$fixture/dir/clack-bpftool-abort-capture.py\"\n")
        verify = r'''
)
status=$?
set -e
actual=$(/usr/bin/sha256sum -- "$fixture/dir/clack-bpftool-abort-capture.py" | /usr/bin/cut -d' ' -f1)
if [[ __CASE__ == success ]]; then
  [[ $status == 0 && $actual == __NEW__ ]]
else
  [[ $status != 0 ]]
  if [[ __CASE__ != bad_old ]]; then [[ $actual == __OLD__ ]]; fi
fi
if [[ __CASE__ == symlink ]]; then
  [[ -L $fixture/dir/clack-bpftool-abort-capture.py ]]
fi
if /usr/bin/find "$fixture/dir" -maxdepth 1 -name '.clack-crash-replace.*' |
   /usr/bin/grep -q .; then exit 9; fi
/usr/bin/rm -f -- "$fixture/dir/clack-bpftool-abort-capture.py" \
  "$fixture/dir/bpftool-678d538" "$fixture/upload/observer.py" "$fixture/previous"
/usr/bin/rmdir -- "$fixture/dir" "$fixture/upload" "$fixture"
printf 'SYNTHETIC_ATOMIC_CASE=__CASE__:PASS\n'
'''
        verify = verify.replace("__CASE__", scenario).replace("__OLD__", old).replace(
            "__NEW__", new)
        full = setup + "set +e\n(\n" + bash + "\n" + verify
        encoded = base64.b64encode(full.encode("ascii")).decode("ascii")
        command = ("/usr/bin/printf %s " + encoded +
                   " | /usr/bin/base64 -d | /usr/bin/bash -s")
        result = subprocess.run(
            ["wsl.exe", "-d", "Ubuntu", "--exec",
             "/usr/bin/bash", "-lc", command],
            capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0,
                         (scenario, result.stdout[-400:], result.stderr[-400:]))
        self.assertIn("SYNTHETIC_ATOMIC_CASE=" + scenario + ":PASS",
                      result.stdout.decode("ascii", errors="replace"))
        if scenario == "rollback":
            self.assertIn("CLACK_CRASH_REPLACE_ROLLBACK=PASS",
                          result.stderr.decode("ascii", errors="replace"))

    def test_atomic_success_and_failure_recovery(self):
        for scenario in ("success", "bad_old", "bad_stage", "symlink", "rollback"):
            with self.subTest(scenario=scenario):
                self.simulate(scenario)


if __name__ == "__main__":
    unittest.main()
