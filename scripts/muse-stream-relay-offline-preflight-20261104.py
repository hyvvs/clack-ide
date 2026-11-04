"""No-inference proof: >52 short TCP round-trips through exact corrected relay.

Runs on remote hylab BEFORE starting diagnostic Ollama. Both fake upstream and
relay are loopback-only. No HTTP, external network, model, or prompt. Never logs
payload. Stops fixture/relay and verifies no remaining temporary listeners.
"""
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time

assert len(sys.argv) == 2
root = Path(sys.argv[1]).resolve(strict=True)
assert root.stat().st_uid == os.getuid()
assert not (root / "ollama.pid").exists()
relay_script = root / "muse-stream-byte-relay-corrected-20261104.py"
assert relay_script.is_file()
assert "MAX_CONNECTIONS = 1024" in relay_script.read_text()
testdir = root / "preflight-fixture"
testdir.mkdir(mode=0o700, exist_ok=False)
N = 80
bad = []

upstream = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
upstream.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
upstream.bind(("127.0.0.1", 11436))
upstream.listen(8)
upstream.settimeout(1)


def mock_server():
    for number in range(N):
        try:
            client, address = upstream.accept()
            assert address[0] == "127.0.0.1"
            client.settimeout(3)
            with client:
                assert client.recv(16) == b"ping!"
                client.sendall(b"pong!")
        except (AssertionError, OSError) as exc:
            bad.append(type(exc).__name__)
            return


thread = threading.Thread(target=mock_server, daemon=True)
thread.start()
relay = subprocess.Popen([sys.executable, "-u", str(relay_script), str(testdir)],
                         stdout=subprocess.DEVNULL, stderr=(testdir / "relay-errors.txt").open("w"),
                         stdin=subprocess.DEVNULL)
try:
    for _ in range(80):
        if (testdir / "relay-bytes.jsonl").exists():
            break
        assert relay.poll() is None
        time.sleep(0.05)
    assert (testdir / "relay-bytes.jsonl").exists()
    for n in range(N):
        with socket.create_connection(("127.0.0.1", 11437), timeout=4) as client:
            client.settimeout(4)
            client.sendall(b"ping!")
            assert client.recv(16) == b"pong!", n
        assert not bad, (n, bad)
    thread.join(10)
    assert not thread.is_alive() and not bad
finally:
    upstream.close()
    relay.terminate()
    relay.wait(timeout=12)

records = [json.loads(line) for line in (testdir / "relay-bytes.jsonl").read_text().splitlines()]
accepted = [e for e in records if e["event"] == "accepted"]
rejected = [e for e in records if e["event"] == "rejected"]
errors = [e for e in records if e["event"] in ("socket-error", "upstream-error")]
assert len(accepted) == N, (len(accepted), N)
assert not rejected and not errors, (rejected, errors)
counts = {}
for direction in ("client-to-ollama", "ollama-to-client"):
    reads = sum(e["bytes"] for e in records if e["direction"] == direction and e["event"] == "read")
    forwarded = sum(e["bytes"] for e in records if e["direction"] == direction and e["event"] == "forward")
    assert reads == forwarded == 5 * N, (direction, reads, forwarded)
    counts[direction] = {"received": reads, "forwarded": forwarded}
for port in (11436, 11437):
    probe = socket.socket()
    try:
        probe.bind(("127.0.0.1", port))
    finally:
        probe.close()
proof = {"kind": "offline-loopback-only-relay-preflight", "connections": N,
         "accepted":len(accepted),"rejected":0,"socketErrors":0,"bytes":counts,
         "upstream": "synthetic-TCP-mock-not-Ollama", "modelCalls":0,
         "lifetimeSeconds":1800,"maxConnections":1024,
         "relaySha256":hashlib.sha256(relay_script.read_bytes()).hexdigest(),
         "mockAndRelayStopped":True, "portsFreed": [11436,11437], "pass":True}
(root / "relay-preflight.json").write_text(json.dumps(proof,indent=2))
print(json.dumps(proof))
