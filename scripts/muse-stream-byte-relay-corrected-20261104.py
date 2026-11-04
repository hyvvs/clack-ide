"""Task-owned, byte-transparent relay. NO HTTP/JSON parsing or payload capture.

Single corrected diagnostic only. Remote user hylab, loopback 11437 -> 11436.
Each raw socket recv and each successful send is timestamped. No intentional
buffering: forwarding begins immediately in the recv loop. TCP_NODELAY on
both accepted and upstream connections; no production Clack/Ollama changes.
"""
import json
import os
import signal
import socket
import sys
import threading
import time

HOST = "127.0.0.1"
LISTEN_PORT = 11437
UPSTREAM_PORT = 11436
# The prior 48-cap invalidated production metadata after 5 calibrations.
# Independent offline preflight verifies >52 real short connections.
MAX_CONNECTIONS = 1024
LIFETIME_SECONDS = 1800
READ_SIZE = 16384
stop = threading.Event()
lock = threading.Lock()
connections = []
num_connections = 0


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Expected exactly one private existing directory")
    directory = os.path.realpath(sys.argv[1])
    if not os.path.isdir(directory) or os.stat(directory).st_uid != os.getuid():
        raise SystemExit("Diagnostic evidence dir not owned by this user")
    fd = os.open(os.path.join(directory, "relay-bytes.jsonl"), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    output = os.fdopen(fd, "w", encoding="utf-8", buffering=1)

    def emit(connection_id, direction, event, size=0, **more):
        row = {"mono_ns": time.monotonic_ns(), "utc_ns": time.time_ns(), "connection": connection_id,
               "direction": direction, "event": event, "bytes": size, **more}
        with lock:
            output.write(json.dumps(row, separators=(",", ":")) + "\n")

    def handle(client, connection_id):
        upstream = None
        try:
            client.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            upstream = socket.create_connection((HOST, UPSTREAM_PORT), timeout=7)
            upstream.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            client.settimeout(None)
            upstream.settimeout(None)
            emit(connection_id, "connection", "upstream-connected", destination=f"{HOST}:{UPSTREAM_PORT}")

            def pipe(source, target, direction):
                try:
                    while not stop.is_set():
                        data = source.recv(READ_SIZE)
                        if not data:
                            emit(connection_id, direction, "read-eof")
                            break
                        emit(connection_id, direction, "read", len(data))
                        view = memoryview(data)
                        while view and not stop.is_set():
                            sent = target.send(view)
                            if sent <= 0:
                                raise ConnectionError("send returned zero")
                            emit(connection_id, direction, "forward", sent)
                            view = view[sent:]
                except OSError as error:
                    emit(connection_id, direction, "socket-error", errorType=type(error).__name__, errno=error.errno)
                finally:
                    try:
                        target.shutdown(socket.SHUT_WR)
                    except OSError:
                        pass
                    emit(connection_id, direction, "forward-half-close")

            outgoing = threading.Thread(target=pipe, args=(client, upstream, "client-to-ollama"), daemon=True)
            incoming = threading.Thread(target=pipe, args=(upstream, client, "ollama-to-client"), daemon=True)
            outgoing.start()
            incoming.start()
            outgoing.join()
            incoming.join()
        except OSError as error:
            emit(connection_id, "connection", "upstream-error", errorType=type(error).__name__, errno=error.errno)
        finally:
            for sock in (client, upstream):
                if sock:
                    try:
                        sock.close()
                    except OSError:
                        pass
            emit(connection_id, "connection", "closed")

    def shutdown(_sig, _frame):
        stop.set()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    deadline = time.monotonic() + LIFETIME_SECONDS
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((HOST, LISTEN_PORT))
    server.listen(16)
    server.settimeout(0.5)
    emit(0, "server", "started", listen=f"{HOST}:{LISTEN_PORT}", upstream=f"{HOST}:{UPSTREAM_PORT}", lifetimeSeconds=LIFETIME_SECONDS, maxConnections=MAX_CONNECTIONS)
    try:
        global num_connections
        while not stop.is_set() and time.monotonic() < deadline:
            try:
                client, addr = server.accept()
            except socket.timeout:
                continue
            num_connections += 1
            if num_connections > MAX_CONNECTIONS or addr[0] != HOST:
                emit(num_connections, "connection", "rejected")
                client.close()
                continue
            emit(num_connections, "connection", "accepted", peerIp=addr[0])
            thread = threading.Thread(target=handle, args=(client, num_connections), daemon=True)
            connections.append(thread)
            thread.start()
    finally:
        stop.set()
        server.close()
        emit(0, "server", "stopping", accepted=num_connections)
        for thread in connections:
            thread.join(timeout=1.5)
        emit(0, "server", "stopped")
        output.close()


if __name__ == "__main__":
    main()
