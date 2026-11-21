# ONE versioned Clack root repin, no kernel attach/HTTP/evaluator.
# A genuine sudo authentication runs in a dedicated visible SSH PTY.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$bundle=Join-Path $PSScriptRoot 'one-muse-private-bpftool-v2'
$key=Join-Path $env:USERPROFILE '.ssh\clack_hylab_ed25519'
$remote='hylab@192.168.1.44'
$stagePattern='^/home/hylab/\.cache/clack-muse-private-repin\.[A-Za-z0-9]{8}$'
$files=[ordered]@{
  'local-muse-one-root.sh'='b3da0a0de8e8c6c1648ef6ce9c9ecb14f642341468e8dfc567962667ad3f6f44'
  'local-muse-one-ebpf.py'='169c1ae8e6822f7e795cfadb8d624d5e03964d0f182cdf6c948aa012dc12a527'
  'one-muse-narrow-root.py'='bdba04eb0952a2cd4c1e9f77f645be716b6ef220e124045d0e0f630ddee77260'
  'one-muse-narrow-sudoers'='a9782c350e18c09a83bd543d3359ab13cc371aae945f28f39492db421cf49586'
  'manifest.json'='34cdff42d5e43a1cbdbadbb96d537614e6bf7d81099cdcd92a753b1db84809a7'
  'installer.py'='4112ceaa548621c3ea905152ab9fd8e3ad75da22cd1ecde9c3d1926475347ad2'
}
$moduleFile=Join-Path $PSScriptRoot 'OneMuseBootstrapRuntime.psm1'
$moduleHash='72f7827b0a3468f3cec835d3fe6fa27108044f9f4f0b3064fa9c9161cba8fc91'
$stage=$null
$success=$false
$opts=$null
$crlf=([string][char]13)+([string][char]10)
$lf=[string][char]10
function Say([string]$message) {
  [Console]::Out.WriteLine($message)
  [Console]::Out.Flush()
}
function RequireHash([string]$file,[string]$expected) {
  if(-not (Test-Path -LiteralPath $file -PathType Leaf) -or
      (Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLowerInvariant() -cne $expected) {
    throw 'ROOT_REPIN_FAILED=PINNED_SOURCE_MISMATCH'
  }
}
try {
  Say '[1/6] validating exact versioned private-bpftool bundle'
  RequireHash $moduleFile $moduleHash
  foreach($name in $files.Keys) {RequireHash (Join-Path $bundle $name) $files[$name]}
  if(-not (Test-Path -LiteralPath $key -PathType Leaf)) {
    throw 'ROOT_REPIN_FAILED=PINNED_SSH_IDENTITY_MISSING'
  }
  Import-Module $moduleFile -Force -ErrorAction Stop
  $opts=@('-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',
    '-o','ConnectTimeout=5','-o','ConnectionAttempts=1',
    '-o','ServerAliveInterval=5','-o','ServerAliveCountMax=2','-i',$key)
  Say '[2/6] checking pinned SSH host and key'
  $c=Invoke-OneMuseNativeChild -Tool ssh -Arguments ($opts + @(
    '-T',$remote,'/usr/bin/true')) -Stage 'repin_connect' -DeadlineSeconds 12
  if($c.ExitCode -ne 0){throw 'ROOT_REPIN_FAILED=SSH_CONNECTION_UNAVAILABLE'}
  Say '[3/6] staging six exact immutable production assets'
  $d=Invoke-OneMuseNativeChild -Tool ssh -Arguments ($opts + @(
    '-T',$remote,
    '/usr/bin/mktemp -d -p /home/hylab/.cache clack-muse-private-repin.XXXXXXXX')) -Stage 'repin_stage' -DeadlineSeconds 12
  if($d.ExitCode -ne 0){throw 'ROOT_REPIN_FAILED=EXCLUSIVE_STAGE_FAILED'}
  $stage=$d.Stdout.Trim()
  if($stage -cnotmatch $stagePattern){throw 'ROOT_REPIN_FAILED=STAGE_IDENTITY_INVALID'}
  foreach($name in $files.Keys){
    $s=Join-Path $bundle $name
    $copy=Invoke-OneMuseNativeChild -Tool scp -Arguments ($opts + @(
      '--',$s,($remote+':'+$stage+'/'+$name))) -Stage 'repin_stage' -DeadlineSeconds 25
    if($copy.ExitCode -ne 0){throw 'ROOT_REPIN_FAILED=ASSET_TRANSFER_FAILED'}
    $mode=Invoke-OneMuseNativeChild -Tool ssh -Arguments ($opts + @(
      '-T',$remote,('/usr/bin/chmod 0600 -- '+$stage+'/'+$name))) -Stage 'repin_stage' -DeadlineSeconds 12
    if($mode.ExitCode -ne 0){throw 'ROOT_REPIN_FAILED=STAGED_ASSET_PERMISSIONS'}
  }
  # Root loader opens exact bytes ONCE, O_NOFOLLOW and verifies SHA-256
  # before compile. Never executes unverified user-controlled source.
  $loader=@'
import hashlib,os,re,stat,sys
stage=sys.argv[1]
sha="4112ceaa548621c3ea905152ab9fd8e3ad75da22cd1ecde9c3d1926475347ad2"
if not re.fullmatch(r"/home/hylab/\.cache/clack-muse-private-repin\.[A-Za-z0-9]{8}",stage,re.ASCII): sys.exit(72)
root=os.open(stage,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
try:
    fd=os.open("installer.py",os.O_RDONLY|os.O_NOFOLLOW,dir_fd=root)
    try:
        info=os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid!=1000 or stat.S_IMODE(info.st_mode)!=0o600 or info.st_nlink!=1 or info.st_size>200000: sys.exit(72)
        data=bytearray()
        while True:
            part=os.read(fd,65536)
            if not part: break
            data.extend(part)
            if len(data)>200000: sys.exit(72)
        if hashlib.sha256(data).hexdigest()!=sha: sys.exit(72)
    finally: os.close(fd)
finally: os.close(root)
sys.argv=["installer.py",stage]
exec(compile(bytes(data),"<pinned-private-bpftool-root-repin>","exec"),{"__name__":"__main__"})
'@
  $loader=$loader.Replace($crlf,$lf)
  $loader64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($loader))
  $control=@'
set -Eeuo pipefail
set +e
/usr/bin/timeout --foreground --signal=TERM --kill-after=2s 90s /usr/bin/sudo -v
auth=$?
set -e
if ((auth==124 || auth==137)); then exit 74; fi
if ((auth!=0)); then exit 1; fi
printf '[5/6] atomically repinning root bundle and sudoers digest\n'
loader=$(/usr/bin/printf %s __LOADER__ | /usr/bin/base64 -d)
set +e
/usr/bin/timeout --foreground --signal=TERM --kill-after=3s 75s /usr/bin/sudo -n /usr/bin/python3 -I -c "$loader" '__STAGE__'
code=$?
set -e
if ((code==124 || code==137)); then exit 75; fi
exit "$code"
'@
  $control=$control.Replace('__LOADER__',$loader64).Replace('__STAGE__',$stage).Replace($crlf,$lf)
  $control64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($control))
  if($control64.Length -gt 22000){throw 'ROOT_REPIN_FAILED=BOUNDED_CONTROL_TOO_LARGE'}
  $command="/usr/bin/bash -lc 'printf %s $control64 | /usr/bin/base64 -d | /usr/bin/bash -s'"
  Say '[4/6] opening separate visible SSH console for genuine sudo authentication'
  Say 'Password is entered ONLY in the separate SSH terminal, never here.'
  $remoteRun=Invoke-OneMuseNativeChild -Tool ssh -Arguments ($opts + @(
    '-tt',$remote,$command)) -Stage 'root_repin' -DeadlineSeconds 178 -Interactive
  if($remoteRun.ExitCode -eq 74){throw 'ROOT_REPIN_FAILED=REMOTE_AUTH_TIMEOUT'}
  if($remoteRun.ExitCode -eq 75){throw 'ROOT_REPIN_FAILED=REMOTE_DEPLOY_TIMEOUT'}
  if($remoteRun.ExitCode -ne 0){throw 'ROOT_REPIN_FAILED=ROOT_DEPLOY_REJECTED'}
  Say '[6/6] independently verifying narrow sudo -n no-traffic self-check'
  $check=Invoke-OneMuseNativeChild -Tool ssh -Arguments ($opts + @(
    '-T',$remote,'/usr/bin/sudo -n /usr/local/libexec/clack-one-muse-root --self-check')) -Stage 'repin_self_check' -DeadlineSeconds 12
  if($check.ExitCode -ne 0 -or $check.Stdout.Trim() -cne 'CLACK_NARROW_SUDO_SELF_CHECK=PASS') {
    throw 'ROOT_REPIN_FAILED=POST_INSTALL_SELF_CHECK_MISMATCH'
  }
  $success=$true
  Say 'ROOT_REPIN_INSTALL=PASS'
}
catch{
  $message=[string]$_.Exception.Message
  if($message -cnotmatch '^ROOT_REPIN_FAILED=[A-Z0-9_]{3,72}$'){
    $message='ROOT_REPIN_FAILED=BOUNDED_STAGE_ERROR'
  }
  [Console]::Error.WriteLine($message)
  [Console]::Error.Flush()
}
finally{
  if($stage -and $stage -cmatch $stagePattern -and $opts){
    $cleanup=@'
set -Eeuo pipefail
stage='__STAGE__'
test -d "$stage" && test ! -L "$stage"
test "$(/usr/bin/stat -c '%u:%a' -- "$stage")" = "$(/usr/bin/id -u):700"
for name in local-muse-one-root.sh local-muse-one-ebpf.py one-muse-narrow-root.py one-muse-narrow-sudoers manifest.json installer.py; do
  if [[ -e $stage/$name || -L $stage/$name ]]; then
    test -f "$stage/$name" && test ! -L "$stage/$name"
    /usr/bin/rm -f -- "$stage/$name"
  fi
done
/usr/bin/rmdir -- "$stage"
'@
    $cleanup=$cleanup.Replace('__STAGE__',$stage).Replace($crlf,$lf)
    $cleanup64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($cleanup))
    $cleanCommand="/usr/bin/bash -lc 'printf %s $cleanup64 | /usr/bin/base64 -d | /usr/bin/timeout --signal=TERM --kill-after=1s 8s /usr/bin/bash -s'"
    try{
      $cleaned=Invoke-OneMuseNativeChild -Tool ssh -Arguments ($opts + @(
        '-T',$remote,$cleanCommand)) -Stage 'repin_cleanup' -DeadlineSeconds 12
      if($cleaned.ExitCode -eq 0){Say 'ROOT_REPIN_STAGING_CLEANUP=PASS'}
      else{Say 'ROOT_REPIN_STAGING_CLEANUP=UNVERIFIED'}
    }catch{Say 'ROOT_REPIN_STAGING_CLEANUP=UNVERIFIED'}
  }
  if(-not $success){Say 'ROOT_REPIN_INSTALL=NOT_VERIFIED'}
}
if(-not $success){exit 1}
exit 0
