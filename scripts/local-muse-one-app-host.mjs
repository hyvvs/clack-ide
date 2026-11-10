/** Isolated production-native Tauri host adapter for ONE future Muse session.
 * Merely importing or creating this adapter never executes a model or app.
 * Only source.native.arm() starts the reviewed diagnostic-only host; its
 * WebView registers content-free observations, but NEVER auto-infers.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const RUN = /^muse-one-[a-f0-9]{24}$/;
const EXACT_SOURCES = ['native','semantic','webview'];
const alive = child => child && child.exitCode === null &&
  child.signalCode === null;

export function createOneMuseAppHost({broker, binary, webviewUrl,
  start=spawn, waitMs=7000} = {}) {
  assert(broker && RUN.test(broker.runId) &&
    typeof broker.source==='function' &&
    /^[a-f0-9]{64}$/.test(broker.permitSha256),
  'authenticated-run-bound-broker-required');
  assert(path.isAbsolute(binary),'absolute-diagnostic-host-binary-required');
  assert(/^http:\/\/127\.0\.0\.1:\d{1,5}\/local-muse-one\.html$/.test(webviewUrl),
    'isolated-one-muse-webview-required');
  assert(Number.isSafeInteger(waitMs)&&waitMs>=100&&waitMs<=20000,
    'bounded-app-shutdown-required');
  let app=null, launchRunId=null, appStopped=false;
  let boundJournal=null, launchRoot=null;
  const guard = runId => {
    assert(runId===broker.runId && runId===launchRunId &&
      launchRoot && !appStopped,'stale-or-stopped-app-host');
  };
  const ensureAlive = () => {
    assert(alive(app),'diagnostic-native-host-not-running');
  };
  const terminate = async () => {
    if(!alive(app)) return true;
    app.kill();
    await Promise.race([new Promise(resolve=>app.once('exit',resolve)),
      new Promise(resolve=>setTimeout(resolve,waitMs))]);
    if(alive(app)) app.kill('SIGKILL');
    return !alive(app);
  };
  const native = broker.source('native');
  const semantic = broker.source('semantic');
  const webview = broker.source('webview');
  const hostSources = Object.fromEntries(EXACT_SOURCES.map(source => {
    const brokerSource={native,semantic,webview}[source];
    return [source, Object.freeze({
      async arm({runId,root,journal}) {
        assert(runId===broker.runId,'stale-app-run');
        if(source==='native'){
          assert(!app && !launchRunId,'diagnostic-host-started-twice');
          assert(path.isAbsolute(root) && path.basename(root)===runId,
            'invalid-run-root-ownership');
          const actual=await realpath(binary);
          assert(actual===path.resolve(binary),'noncanonical-host-binary');
          assert((await stat(actual)).isFile(),'native-host-binary-unavailable');
          launchRunId=runId;launchRoot=root;boundJournal=journal;
          assert(journal?.url && /^[a-f0-9]{48}$/.test(journal.nonce),
            'run-owned-delivery-journal-required');
          const env={...process.env,
            CLACK_ONE_MUSE_DIAGNOSTIC_RUN_ID:runId,
            CLACK_ONE_MUSE_DIAGNOSTIC_ROOT:root,
            CLACK_ONE_MUSE_DIAGNOSTIC_PERMIT_SHA256:broker.permitSha256,
            CLACK_ONE_MUSE_WEBVIEW_URL:webviewUrl,
            CLACK_ONE_MUSE_READY_URL:broker.url,
            CLACK_ONE_MUSE_READY_NONCE:broker.nonce,
            CLACK_ONE_MUSE_JOURNAL_URL:journal.url,
            CLACK_ONE_MUSE_JOURNAL_NONCE:journal.nonce};
          app=start(binary,[],{env,stdio:['ignore','ignore','pipe'],
            windowsHide:true});
          assert(app?.pid>0,'native-host-launch-failed');
          // Never echo unreviewed native stderr, which may contain OS paths or
          // unrelated sensitive diagnostics. Any stderr only blocks readiness.
          app.stderr?.on('data',()=>undefined);
        }else {
          guard(runId);ensureAlive();
        }
        const receipt=await brokerSource.arm({runId});
        ensureAlive();
        return receipt;
      },
      async check({runId}) {guard(runId);ensureAlive();
        return brokerSource.check({runId});},
      async drain({runId}) {guard(runId);
        await brokerSource.drain({runId});},
      async terminal({runId}) {guard(runId);
        return brokerSource.terminal({runId});},
      async stop({runId}) {
        guard(runId);
        const brokerStopped=await brokerSource.stop({runId});
        if(source!=='native') return brokerStopped;
        const stopped=await terminate();
        appStopped=true;
        return {runId,source,clean:brokerStopped.clean===true&&stopped};
      },
    })];
  }));
  return Object.freeze({sources:hostSources, getPid:()=>app?.pid??null,
    async terminate() {
      const stopped=await terminate();
      appStopped=true;
      return stopped;
    },
    snapshot:()=>({runId:launchRunId,hostPid:app?.pid??null,
      nativeHostAlive:alive(app),stopped:appStopped,
      journalBound:!!boundJournal})});
}
