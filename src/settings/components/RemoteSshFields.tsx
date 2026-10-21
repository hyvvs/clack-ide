import { Input } from "@/components/ui/input";
import { useId } from "react";
import type { RemoteSshConfig } from "@/modules/ai/lib/remoteSsh";

export function RemoteSshFields({ value, onChange }: { value: RemoteSshConfig; onChange: (value: RemoteSshConfig) => void }) {
  const id = useId();
  const set = <K extends keyof RemoteSshConfig>(key: K, next: RemoteSshConfig[K]) => onChange({ ...value, [key]: next });
  return <>
    <label htmlFor={`${id}-host`}>Computer address<Input id={`${id}-host`} required value={value.host} maxLength={253} autoComplete="off" placeholder="labpc.local" onChange={e => set("host", e.target.value)} /></label>
    <label htmlFor={`${id}-user`}>Username<Input id={`${id}-user`} required value={value.username} maxLength={253} autoComplete="off" onChange={e => set("username", e.target.value)} /></label>
    <label htmlFor={`${id}-auth`}>Authentication<select id={`${id}-auth`} aria-label="Authentication" value={value.keyPath === null ? "agent" : "key"} onChange={e => set("keyPath", e.target.value === "agent" ? null : "")}>
      <option value="agent">System SSH agent</option><option value="key">Existing private key file</option>
    </select></label>
    {value.keyPath !== null && <label htmlFor={`${id}-key`}>Private key file<Input id={`${id}-key`} required value={value.keyPath} maxLength={4096} placeholder="Full path to existing key" onChange={e => set("keyPath", e.target.value)} /></label>}
    <details className="server-details"><summary>Advanced SSH settings</summary>
      <label htmlFor={`${id}-port`}>SSH port<Input id={`${id}-port`} type="number" min={1} max={65535} required value={value.port} onChange={e => set("port", Number(e.target.value))} /></label>
      <label htmlFor={`${id}-remote`}>Remote loopback address<select id={`${id}-remote`} aria-label="Remote loopback address" value={value.remoteHost} onChange={e => set("remoteHost", e.target.value as RemoteSshConfig["remoteHost"])}>
        <option value="127.0.0.1">127.0.0.1</option><option value="localhost">localhost</option><option value="::1">::1</option>
      </select></label>
      <label htmlFor={`${id}-service`}>Remote service port<Input id={`${id}-service`} type="number" min={1} max={65535} required value={value.remotePort} onChange={e => set("remotePort", Number(e.target.value))} /></label>
    </details>
  </>;
}
