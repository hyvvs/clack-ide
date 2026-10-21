import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

const atom = z.string().min(1).max(253).regex(/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/);
export const remoteSshSchema = z.object({
  host: atom,
  username: atom,
  port: z.number().int().min(1).max(65535),
  keyPath: z.string().min(1).max(4096).refine(s => !/[\0\r\n]/.test(s)).nullable(),
  remoteHost: z.enum(["127.0.0.1", "localhost", "::1"]),
  remotePort: z.number().int().min(1).max(65535),
}).strict();
export type RemoteSshConfig = z.infer<typeof remoteSshSchema>;
export type RemoteSshStatus = { state: string; fingerprint: string | null; trustSource: string | null };
export function remoteSshUrl(id: string) {
  return `http://clack-ssh.invalid/${Array.from(new TextEncoder().encode(id), b => b.toString(16).padStart(2, "0")).join("")}/`;
}
export const remoteSsh = {
  connect: (endpointId: string, approveFingerprint?: string) => invoke<RemoteSshStatus>("remote_ssh_connect", { endpointId, approveFingerprint }),
  disconnect: (endpointId: string) => invoke<void>("remote_ssh_disconnect", { endpointId }),
  status: (endpointId: string) => invoke<RemoteSshStatus>("remote_ssh_status", { endpointId }),
};
export function remoteSshMessage(state: string): string {
  return ({
    connected: "Connected securely over SSH",
    disconnected: "Disconnected",
    connecting: "Connecting securely",
    offline: "Remote computer disconnected. Reconnect to try again.",
    "verification-required": "Verify this computer",
    "host-key-changed": "The remote computer's identity changed. Connection was stopped for safety.",
    "authentication-failed": "SSH authentication failed. Check your key or unlocked SSH agent.",
    "key-unreadable": "The SSH key file cannot be read. Select an existing private key file.",
    "ssh-unavailable": "OpenSSH client tools are unavailable. Install the system OpenSSH client.",
    "host-unreachable": "Couldn't reach the remote computer. Check that SSH is enabled and reachable.",
    "private-network-consent-required": "Allow private-network access before connecting.",
    "retry-later": "Wait a moment before reconnecting.",
    cancelled: "Connection cancelled",
  } as Record<string, string>)[state] ?? "Secure connection could not be established. Check Advanced connection settings.";
}
