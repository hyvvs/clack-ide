/** Crash-location investigation ONLY. No Ollama HTTP, model or inference calls.
 *
 * Keep the ordinary host-source readiness path unchanged. Its /api/tags GET
 * is prohibited by this investigative task even though it is metadata-only.
 * The real root collector still proves executable/PID/socket identity from
 * /proc and a fresh session link; this diagnostic mode never qualifies READY.
 */
import assert from 'node:assert/strict';
import {createOneMuseHostSources,localForwardOwner} from './local-muse-one-host-sources.mjs';

const RUN = /^muse-one-[a-f0-9]{24}$/;
const PID_QUERY =
  "/usr/bin/bash -lc 'p=$(/usr/bin/systemctl show --value -p MainPID ollama.service); " +
  "test \"$p\" -gt 1 && test \"$(/usr/bin/cat /proc/$p/comm)\" = ollama && " +
  "/usr/bin/ss -H -ltn \"( sport = :11434 )\" | " +
  "/usr/bin/grep -Fq \"127.0.0.1:11434\" && printf \"%s\\n\" \"$p\"'";

/** Injectable only for synthetic unit fixtures; live callers use fixed tools. */
export function createCrashOnlyHostSources(options) {
  const {ownedForwardPid = localForwardOwner, ...base} = options;
  const host = createOneMuseHostSources({
    ...base,
    ownedForwardPid,
    // A wiring mistake must STOP, not accidentally request /api/tags.
    metadataFetch:async()=>{throw Error('ollama-http-forbidden');},
  });
  let runId=null, pid=null, identity=null, tunnelPid=null;
  const verify = async()=> {
    const owner=host.getTunnelPid();
    assert(Number.isSafeInteger(owner) && owner > 1 &&
      await ownedForwardPid() === owner, 'investigative-tunnel-owner-unverified');
    const raw=await host.remote(PID_QUERY);
    assert(/^[1-9][0-9]{1,9}$/.test(raw), 'investigative-process-identity-unverified');
    const fresh=Number(raw);
    assert(fresh > 1 && fresh <= 4194304, 'investigative-invalid-target-pid');
    return {fresh,owner};
  };
  const mapping={
    async arm({runId:requested,journal}) {
      assert(runId===null && RUN.test(requested), 'new-diagnostic-run-required');
      assert(journal && typeof journal.recordMetadata==='function',
        'durable-journal-required');
      // The existing source's guarded tunnel check establishes that mapping
      // belongs to precisely the same run as identity and the owned forward.
      // It does not make any Ollama HTTP request.
      await host.sources.tunnel.check({runId:requested});
      const state=await verify();
      runId=requested;pid=state.fresh;tunnelPid=state.owner;
      identity='map-'+tunnelPid+':'+pid;
      const ack=Object.freeze({runId,source:'mapping',identity,
        ready:true,loss:0,pending:0,ollamaPid:pid,
        requestSocketCorrelation:'not-established',
        identityMethod:'service-proc-comm-loopback-only',
        ollamaHttpRequests:0});
      await journal.recordMetadata({schemaVersion:1,runId,
        host:'collector',layer:'collector',kind:'capability',source:'mapping',
        sourceIdentity:identity,capability:'available',
        connectionId:'map-'+tunnelPid+'-'+pid,
        localPort:11435,remotePort:11434,
        atUnixMs:Date.now(),monoUs:Number(process.hrtime.bigint()/1000n)});
      return ack;
    },
    async check({runId:requested}) {
      assert(requested===runId && pid!==null, 'stale-diagnostic-mapping');
      const state=await verify();
      assert(state.fresh===pid && state.owner===tunnelPid,
        'remote-ollama-identity-changed');
      return {runId,source:'mapping',identity,ready:true,loss:0,pending:0,
        ollamaPid:pid,requestSocketCorrelation:'not-established',
        ollamaHttpRequests:0};
    },
    async terminal({runId:requested}) {
      await mapping.check({runId:requested});
      return {runId,source:'mapping',identity,complete:true,loss:0,pending:0};
    },
    async stop({runId:requested}) {
      assert(requested===runId || runId===null, 'wrong-diagnostic-mapping-stop');
      return {runId:requested,source:'mapping',clean:true};
    },
  };
  // Only this instance's mapping is replaced; the general readiness module
  // and all normal coordinator callers continue to require the real GET.
  host.sources.mapping=mapping;
  return host;
}

export const crashOnlyPidQuery = PID_QUERY;
