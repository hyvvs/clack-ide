/** Real, future-only metadata/connection/clock sources for one diagnostic.
 * Importing this module does nothing. Invoking arm() will start an owned SSH
 * forward and make metadata-only remote queries, NEVER /api/chat.
 * No privileged process, service setting or user workspace is touched.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { MUSE_MODEL, MUSE_DIGEST } from './local-muse-one-session.mjs';
import { clockOffsetBounds } from './local-muse-delivery-journal.mjs';

const execFile = promisify(execFileCb);
const MANIFEST_SHA = '98314e64c5c3156e44fbc166231133f4ff116bee368549a31c17224c6fd31915';
const LOCAL = '127.0.0.1:11435';
const REMOTE = '127.0.0.1:11434';
const SSH_REMOTE = 'hylab@192.168.1.44';
const MAX_STDOUT = 4096;
const bounded = n => Number.isSafeInteger(n) && n > 0;

/** No socket, URL or credentials leak into terminal output. Win32 listener
 * owner must be exactly the task-owned SSH process, not just the same port. */
export async function localForwardOwner({port = 11435} = {}) {
  const script = `$x = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalAddress -eq '127.0.0.1' -and $_.LocalPort -eq ${port} }); if($x.Count -eq 0){ Write-Output 'NONE'; exit 0 }; if($x.Count -ne 1){ exit 2 }; Write-Output $x[0].OwningProcess`;
  const {stdout} = await execFile('powershell.exe',
    ['-NoProfile','-NonInteractive','-Command',script],
    {timeout:3000,maxBuffer:MAX_STDOUT,windowsHide:true});
  if (stdout.trim() === 'NONE') return null;
  const pid = Number(stdout.trim());
  assert(bounded(pid),'unverified-loopback-forward-owner');
  return pid;
}

export function createOneMuseHostSources({
  manifestPath, sshKey, start = spawn, ownedForwardPid = localForwardOwner,
  remoteRead = null, metadataFetch = fetch, now = () => Date.now(),
} = {}) {
  assert(path.isAbsolute(manifestPath) && path.isAbsolute(sshKey),
    'absolute-approved-input-paths-required');
  let tunnel = null, tunnelId = null, initialRunId = null, remotePid = null;
  let initialClocks = null, stopped = false, clockJournal = null;
  const remote = remoteRead ?? (async command => {
    const {stdout} = await execFile('ssh.exe',[
      '-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',
      '-o','ConnectTimeout=4','-i',sshKey,SSH_REMOTE,command],
    {timeout:6500,maxBuffer:MAX_STDOUT,windowsHide:true});
    return stdout.trim();
  });
  const guard = runId => {
    assert(runId && runId === initialRunId && !stopped,'stale-or-stopped-run');
  };
  const proof = (source,identity,props={}) => ({
    runId:initialRunId,source,identity,ready:true,loss:0,pending:0,...props,
  });
  const terminal = source => ({runId:initialRunId,source,
    identity:identities[source],complete:!stopped,loss:0,pending:0});
  const identities = {};
  const stopNoop = source => ({runId:initialRunId,source,clean:true});
  const remember = (source,ack) => {identities[source] = ack.identity;return ack;};
  const identityCheck = async () => {
    const response = await metadataFetch('http://127.0.0.1:11435/api/tags',
      {method:'GET',signal:AbortSignal.timeout(5000)});
    assert(response.ok,'metadata-inventory-unavailable');
    const doc = await response.json();
    assert(Array.isArray(doc.models) && doc.models.length < 1000,
      'untrusted-metadata-inventory');
    const exact = doc.models.filter(m => m.name === MUSE_MODEL);
    assert(exact.length === 1 && exact[0].digest === MUSE_DIGEST,
      'live-muse-digest-mismatch');
  };
  const original = async () => {
    const bytes = await readFile(manifestPath);
    assert(createHash('sha256').update(bytes).digest('hex') === MANIFEST_SHA,
      'historical-identity-manifest-changed');
    const manifest = JSON.parse(bytes.toString('utf8'));
    assert(manifest.approvedDigest === MUSE_DIGEST,
      'manifest-muse-digest-mismatch');
  };
  const owner = async () => {
    assert(tunnel && tunnel.exitCode === null && tunnel.signalCode === null,
      'task-owned-tunnel-exited');
    const pid = await ownedForwardPid();
    assert(pid === tunnel.pid,'port-owned-by-unrelated-process');
  };
  const verifyRemote = async () => {
    // Fixed command; stdout contains only one bounded decimal PID.
    const shell = `/usr/bin/bash -lc 'p=$(/usr/bin/systemctl show --value -p MainPID ollama.service); test "$p" -gt 1 && /usr/bin/ss -H -ltn "( sport = :11434 )" | /usr/bin/grep -Fq "127.0.0.1:11434" && printf "%s\\n" "$p"'`;
    const pid = Number(await remote(shell));
    assert(bounded(pid),'ollama-listener-process-unverified');
    return pid;
  };
  const clocks = async () => {
    const samples = [];
    for (let i=0;i<3;i++) {
      const clientSendUnixUs = now()*1000;
      const clientSendMonoUs = Number(process.hrtime.bigint()/1000n);
      const line = await remote('/usr/bin/python3 -c \'import time; print(time.time_ns()//1000, time.monotonic_ns()//1000)\'');
      const clientReceiveMonoUs = Number(process.hrtime.bigint()/1000n);
      const clientReceiveUnixUs = now()*1000;
      const match = /^(\d{13,17})\s+(\d{4,17})$/.exec(line);
      assert(match,'remote-clock-stamp-unavailable');
      const remoteUnixUs = Number(match[1]), remoteMonoUs = Number(match[2]);
      assert(Number.isSafeInteger(remoteUnixUs) && Number.isSafeInteger(remoteMonoUs),
        'unsafe-remote-clock');
      const bound = clockOffsetBounds({clientSendUnixUs,clientReceiveUnixUs,
        remoteUnixUs,clientSendMonoUs,clientReceiveMonoUs,tickUs:1000});
      samples.push({bound,remoteUnixUs,remoteMonoUs,clientReceiveUnixUs,
        clientReceiveMonoUs});
    }
    const best = samples.reduce((a,b)=>a.bound.uncertaintyUs<=b.bound.uncertaintyUs?a:b);
    return {sampleCount:samples.length,uncertaintyUs:Math.max(...samples.map(s=>s.bound.uncertaintyUs)),
      localAnchorUnixUs:best.clientReceiveUnixUs,
      localAnchorMonoUs:best.clientReceiveMonoUs,
      remoteAnchorUnixUs:best.remoteUnixUs,
      remoteAnchorMonoUs:best.remoteMonoUs};
  };
  const recordClocks = async anchors => {
    assert(clockJournal,'clock-source-journal-not-registered');
    for (const [endpoint,atUnixUs,monoUs] of [
      ['local-forward',anchors.localAnchorUnixUs,anchors.localAnchorMonoUs],
      ['remote-forward',anchors.remoteAnchorUnixUs,anchors.remoteAnchorMonoUs],
    ]) {
      await clockJournal.recordMetadata({schemaVersion:1,runId:initialRunId,
        host:'collector',layer:'collector',kind:'clock-anchor',source:'clocks',
        sourceIdentity:identities.clocks,endpoint,
        atUnixMs:Math.floor(atUnixUs/1000),monoUs,
        clockUncertaintyUs:anchors.uncertaintyUs});
    }
  };
  const sources = {
    identity:{
      async arm({runId}) { initialRunId ??= runId; guard(runId);await original();
        return remember('identity',proof('identity','muse-digest-verified',
          {model:MUSE_MODEL,digest:MUSE_DIGEST,metadataOnly:true}));},
      async check({runId}) {guard(runId);await identityCheck();
        return proof('identity',identities.identity,
          {model:MUSE_MODEL,digest:MUSE_DIGEST,metadataOnly:true});},
      async terminal({runId}) {guard(runId);return terminal('identity');},
      async stop() {return stopNoop('identity');},
    },
    tunnel:{
      async arm({runId}) {guard(runId);
        // The pre-existing port must be unused: never hijack or kill it.
        assert((await ownedForwardPid()) === null,
          'existing-forward-refuses-exclusive-tunnel');
        tunnel = start('ssh.exe',[
          '-N','-o','ExitOnForwardFailure=yes','-o','StrictHostKeyChecking=yes',
          '-o','BatchMode=yes','-o','ConnectTimeout=4',
          '-L','127.0.0.1:11435:127.0.0.1:11434',
          '-i',sshKey,SSH_REMOTE],
        {stdio:['ignore','ignore','pipe'],windowsHide:true});
        assert(bounded(tunnel?.pid),'task-owned-ssh-start-failed');
        tunnel.stderr?.resume(); // discard raw connection details; never log
        for(let i=0;i<30;i++){
          await new Promise(r=>setTimeout(r,100));
          try{await owner();break;}catch{if(i===29)throw Error('ssh-forward-not-ready');}
        }
        tunnelId = `ssh-${tunnel.pid}`;
        return remember('tunnel',proof('tunnel',tunnelId,{
          ownerPid:tunnel.pid,local:LOCAL,remote:REMOTE,strictHostKey:true}));},
      async check({runId}) {guard(runId);await owner();
        return proof('tunnel',tunnelId,{
          ownerPid:tunnel.pid,local:LOCAL,remote:REMOTE,strictHostKey:true});},
      async terminal({runId}) {guard(runId);await owner();return terminal('tunnel');},
      async stop({runId}) {guard(runId);
        if (!tunnel || tunnel.exitCode !== null) return {runId,source:'tunnel',clean:false};
        tunnel.kill();
        await Promise.race([new Promise(resolve=>tunnel.once('exit',resolve)),
          new Promise(resolve=>setTimeout(resolve,1500))]);
        if(tunnel.exitCode===null) tunnel.kill('SIGKILL');
        const clean = tunnel.exitCode!==null || tunnel.signalCode!==null;
        return {runId,source:'tunnel',clean};},
    },
    mapping:{
      async arm({runId,journal}) {guard(runId);await owner();
        remotePid = await verifyRemote();
        // Check the actual live manifest-bound model metadata before the
        // kernel is permitted to attach. /api/tags never triggers inference.
        await identityCheck();
        const ack = remember('mapping',proof('mapping',`map-${tunnel.pid}:${remotePid}`,{
          localListener:LOCAL,remoteListener:REMOTE,tunnelOwnerPid:tunnel.pid,
          ollamaPid:remotePid,requestSocketCorrelation:'not-established'}));
        await journal.recordMetadata({schemaVersion:1,runId,host:'collector',
          layer:'collector',kind:'capability',source:'mapping',
          sourceIdentity:ack.identity,capability:'available',
          connectionId:`map-${tunnel.pid}-${remotePid}`,localPort:11435,
          remotePort:11434,atUnixMs:now(),
          monoUs:Number(process.hrtime.bigint()/1000n)});
        return ack;},
      async check({runId}) {guard(runId);await owner();
        assert(await verifyRemote() === remotePid,'remote-ollama-identity-changed');
        return proof('mapping',identities.mapping,{
          localListener:LOCAL,remoteListener:REMOTE,tunnelOwnerPid:tunnel.pid,
          ollamaPid:remotePid,requestSocketCorrelation:'not-established'});},
      async terminal({runId}) {guard(runId);return terminal('mapping');},
      async stop(){return stopNoop('mapping');},
    },
    clocks:{
      async arm({runId,journal}) {guard(runId);
        clockJournal=journal;
        initialClocks=await clocks();
        const ack=remember('clocks',proof('clocks',`clock-${initialClocks.localAnchorUnixUs}`,
          initialClocks));
        await recordClocks(initialClocks);
        return ack;},
      async check({runId}) {guard(runId);
        if (now()*1000-initialClocks.localAnchorUnixUs > 30_000_000) {
          initialClocks=await clocks();
          await recordClocks(initialClocks);
        }
        assert(Math.abs(now()*1000-initialClocks.localAnchorUnixUs)<120_000_000,
          'clock-anchor-stale');
        return proof('clocks',identities.clocks,initialClocks);},
      async terminal({runId}) {guard(runId);
        // Post-run clock sample catches gross drift or an absent remote clock.
        const post = await clocks();
        await recordClocks(post);
        assert(post.uncertaintyUs > 0 && post.sampleCount === 3,'post-clock-unavailable');
        return terminal('clocks');},
      async stop(){return stopNoop('clocks');},
    },
  };
  return Object.freeze({sources, remote, getRemotePid:()=>remotePid,
    getTunnelPid:()=>tunnel?.pid??null});
}
