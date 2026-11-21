import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {readFile} from 'node:fs/promises';
import {runOneMuseCoordinated} from './Run-OneMuseCoordinatedOnce.mjs';

const RUN='muse-one-1234567890abcdef12345678';
const auditFactory=()=>({record:()=>{},close:()=>{}});
const child=()=>{
  const c=new EventEmitter();
  c.pid=4321;
  c.exitCode=null;
  c.signalCode=null;
  c.stderr=new PassThrough();
  c.kill=()=>{c.exitCode=1;return true;};
  return c;
};

test('one root operation with no TTY and one real WebView click',async()=>{
  const launched=[],clicked=[];
  const result=await runOneMuseCoordinated({
    makeAudit:auditFactory,
    startSampler:()=>null,
    start:(exe,args,opts)=>{
      launched.push({exe,args,opts});
      return child();
    },
    invokeButton:async (exe,args,opts)=>{
      clicked.push({exe,args,opts});
      return {stdout:'ONE_MUSE_AUTHORIZED_BUTTON_INVOKED=1\n',stderr:''};
    },
    runCoordinator:async ({operatorStep,requestTrigger})=>{
      operatorStep({runId:RUN,pid:1658});
      assert.equal(await requestTrigger({runId:RUN,appPid:7821}),true);
      await assert.rejects(requestTrigger({runId:RUN,appPid:7821}));
      return {runId:RUN,status:'sealed'};
    },
  });
  assert.equal(result.status,'sealed');
  assert.equal(launched.length,1);
  assert.equal(clicked.length,1);
  assert.equal(launched[0].exe,'powershell.exe');
  assert.equal(launched[0].opts.stdio[0],'ignore');
  assert.equal(launched[0].args.at(-1),'1658');
  assert.match(launched[0].args.join(' '),/Run-OneMuseNarrowOperator\.ps1/);
  assert.match(clicked[0].args.join(' '),/Invoke-OneMuseReadyButton\.ps1/);
});

test('no request when only four gates armed or owner identity mismatches',async()=>{
  let count=0;
  await assert.rejects(runOneMuseCoordinated({
    makeAudit:auditFactory,
    startSampler:()=>null,
    start:()=>{count++;return child();},
    invokeButton:async()=>{count++;return {stdout:'OK',stderr:''};},
    runCoordinator:async ({operatorStep,requestTrigger})=>{
      await assert.rejects(requestTrigger({runId:RUN,appPid:7821}));
      operatorStep({runId:RUN,pid:1658});
      operatorStep({runId:RUN,pid:1658});
    },
  }));
  assert.equal(count,1);
});

test('narrow production path is not password injection or standalone qualification',async()=>{
  const operator=await readFile(
    new URL('./Run-OneMuseNarrowOperator.ps1',import.meta.url),'utf8');
  assert.match(operator,/sudo -n \/usr\/local\/libexec\/clack-one-muse-root --run /);
  assert.doesNotMatch(operator,/-tt\b|sudo -S|local-muse-no-http-kernel-only-check/ig);
  const browser=await readFile(
    new URL('./Invoke-OneMuseReadyButton.ps1',import.meta.url),'utf8');
  assert.match(browser,/InvokePattern/);
  assert.match(browser,/Dispatch one instrumented Muse request/);
  assert.doesNotMatch(browser,/api\/chat|model\.doStream|Start-Process|Invoke-WebRequest/i);
});
