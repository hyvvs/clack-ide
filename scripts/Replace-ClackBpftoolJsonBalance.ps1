# HUMAN-ONLY: atomic private diagnostic bpftool+pin replacement and IDLE check.
# Never touch /usr/bin/bpftool, attach BPF, make Ollama HTTP calls, or infer.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$artifact = Join-Path $repo 'src-tauri\target\clack-bpftool-json-balance'
$sources = Join-Path $repo 'src-tauri\target\clack-bpftool-fixed-build'
$remote = 'hylab@192.168.1.44'
$key = Join-Path $env:USERPROFILE '.ssh\clack_hylab_ed25519'
$new = '0e0059127c7c926fe1ee82a7804479415a19b73515b7aebc8bb59ce06de36fa0'
$old = 'ff08d9fe9a545f488f4ecc7145f491027704a2139987f08432c1f9265be70e3d'
$buildId = '7f530859f49ede16767f9f4eb8551a6ac85aa25d'
$sourceSha = '63ac89f708672bc0071f7f84bc389c51f20820e5d1bf1d45e077153edcbe6362'
$libbpfSha = '66da46956d987ba2f15522f46810a4ce23132b01dea27452f21907a670ad2e74'
$patchSha = '3404f298ae9e2eaef4ef0533971667bf1a1c71b3fe4e8bc4a489cf0749384d2d'
$inputs = @(
  @('new-bpftool',(Join-Path $artifact 'bpftool-json-balance-linux-x86_64'),$new),
  @('source.tar',(Join-Path $sources 'bpftool-678d538a-source.tar'),$sourceSha),
  @('libbpf.tar',(Join-Path $sources 'libbpf-872299d9-source.tar'),$libbpfSha),
  @('fix.patch',(Join-Path $PSScriptRoot 'clack-bpftool-json-balance.patch'),$patchSha),
  @('build-summary.numeric',(Join-Path $artifact 'build-summary.numeric'),
    '7a21c26937496c72702f8e8c7a0085f2ae2205b619b50edfc01dae2fb87ef8da'),
  @('idle-qualify.py',(Join-Path $PSScriptRoot 'clack-json-idle-qualify.py'),
    '9e6a4a0c7b44173878d4068c2ff8d610cb9aba0784b800baca9f6488b24f421d'),
  @('root.sh',(Join-Path $PSScriptRoot 'clack-replace-json-bpftool-root.sh'),
    '418e2125e99b4d81df5fbe414d7b44905e04dd06ca31500bd519f8bec3a651a6')
)
if (-not(Test-Path -LiteralPath $key -PathType Leaf)) {
  throw 'Missing approved SSH identity'
}
foreach ($item in $inputs) {
  if (-not(Test-Path -LiteralPath $item[1] -PathType Leaf) -or
      (Get-FileHash -Algorithm SHA256 -LiteralPath $item[1]).Hash.ToLowerInvariant() -cne $item[2]) {
    throw ('Unreviewed or missing input: '+$item[0])
  }
}
$receipt = @{}
foreach ($line in [IO.File]::ReadAllLines((Join-Path $artifact 'build-summary.numeric'))) {
  if ($line -cnotmatch '^([A-Z0-9_]+)=([A-Za-z0-9.]+)$') {
    throw 'Non-normalized source build receipt'
  }
  if ($receipt.ContainsKey($Matches[1])) { throw 'Duplicate build receipt field' }
  $receipt[$Matches[1]] = $Matches[2]
}
if ($receipt.Count -ne 12 -or
    $receipt['OFFLINE_JSON_BUILD'] -cne 'PASS' -or
    $receipt['BINARY_SHA256'] -cne $new -or
    $receipt['BINARY_BUILD_ID'] -cne $buildId -or
    $receipt['PATCH_SHA256'] -cne $patchSha -or
    $receipt['SOURCE_TAR_SHA256'] -cne $sourceSha -or
    $receipt['LIBBPF_TAR_SHA256'] -cne $libbpfSha -or
    $receipt['OWNER_PID_SKELETON'] -cne 'PASS' -or
    $receipt['BUILT_BINARY_EXECUTED'] -cne '0' -or
    $receipt['VERSION_FROM_PINNED_SOURCE'] -cne '7.8.1' -or
    [int]$receipt['BINARY_BYTES'] -ne (Get-Item -LiteralPath $inputs[0][1]).Length) {
  throw 'Unreviewed build provenance or artifact size'
}
$ssh = @('-o','StrictHostKeyChecking=yes','-o','BatchMode=yes','-o','ConnectTimeout=5',
  '-o','ServerAliveInterval=5','-o','ServerAliveCountMax=4','-i',$key)
$scp = @('-q','-o','StrictHostKeyChecking=yes','-o','BatchMode=yes',
  '-o','ConnectTimeout=5','-i',$key)
$stage = $null
try {
  $created = & ssh.exe @ssh '-T' $remote '/usr/bin/mktemp -d -p /home/hylab/.cache clack-json-bpftool-upload.XXXXXXXX'
  if ($LASTEXITCODE -ne 0) { throw 'Could not create exclusive upload stage' }
  $stage = ($created | Out-String).Trim()
  if ($stage -cnotmatch '^/home/hylab/\.cache/clack-json-bpftool-upload\.[A-Za-z0-9]{8}$') {
    throw 'Unrecognized upload stage path'
  }
  foreach ($item in $inputs) {
    & scp.exe @scp '--' $item[1] ($remote+':'+$stage+'/'+$item[0])
    if ($LASTEXITCODE -ne 0) { throw ('Upload failed: '+$item[0]) }
  }

  # Root bootstrap creates an exclusive root-owned same-filesystem snapshot.
  # It NEVER executes uploaded user-owned files before root SHA verification.
  $bootstrap = @'
set -Eeuo pipefail
umask 077
upload='__UPLOAD__'
parent=/opt/clack/diagnostic-tools
rootstage=''
handed=0
release() {
  local code=$?
  trap - EXIT
  if [[ -n $rootstage && $handed == 0 &&
        $rootstage =~ ^/opt/clack/diagnostic-tools/\.clack-json-replace\.[A-Za-z0-9]{8}$ &&
        -d $rootstage && ! -L $rootstage &&
        $(/usr/bin/stat -c '%u:%g:%a' -- "$rootstage") == 0:0:700 ]]; then
    /usr/bin/rm -rf -- "$rootstage" || code=1
  fi
  exit "$code"
}
trap release EXIT
[[ $(/usr/bin/id -u) == 0 &&
   $upload =~ ^/home/hylab/\.cache/clack-json-bpftool-upload\.[A-Za-z0-9]{8}$ &&
   -d $upload && ! -L $upload &&
   $(/usr/bin/stat -c '%U:%a' -- "$upload") == hylab:700 ]]
[[ -d $parent && ! -L $parent &&
   $(/usr/bin/stat -c '%u' -- "$parent") == 0 ]]
[[ ! -e /run/local-muse-ebpf && ! -L /run/local-muse-ebpf ]]
for process in bpftrace gdb; do
  if /usr/bin/pgrep -x "$process" >/dev/null; then exit 1; else
    code=$?
    ((code == 1))
  fi
done
[[ $(/usr/bin/find "$upload" -mindepth 1 -maxdepth 1 -type f | /usr/bin/wc -l) == 7 ]]
for name in new-bpftool source.tar libbpf.tar fix.patch build-summary.numeric idle-qualify.py root.sh; do
  [[ -f $upload/$name && ! -L $upload/$name &&
     $(/usr/bin/stat -c '%U:%h' -- "$upload/$name") == hylab:1 ]]
done
rootstage=$(/usr/bin/mktemp -d -p "$parent" .clack-json-replace.XXXXXXXX)
[[ $rootstage =~ ^/opt/clack/diagnostic-tools/\.clack-json-replace\.[A-Za-z0-9]{8}$ &&
   -d $rootstage && ! -L $rootstage &&
   $(/usr/bin/stat -c '%u:%g:%a' -- "$rootstage") == 0:0:700 ]]
for name in new-bpftool source.tar libbpf.tar fix.patch build-summary.numeric idle-qualify.py root.sh; do
  mode=0600
  if [[ $name == new-bpftool ]]; then mode=0755; fi
  /usr/bin/install -o root -g root -m "$mode" -- "$upload/$name" "$rootstage/$name"
done
for pair in \
  '0e0059127c7c926fe1ee82a7804479415a19b73515b7aebc8bb59ce06de36fa0 new-bpftool' \
  '63ac89f708672bc0071f7f84bc389c51f20820e5d1bf1d45e077153edcbe6362 source.tar' \
  '66da46956d987ba2f15522f46810a4ce23132b01dea27452f21907a670ad2e74 libbpf.tar' \
  '3404f298ae9e2eaef4ef0533971667bf1a1c71b3fe4e8bc4a489cf0749384d2d fix.patch' \
  '7a21c26937496c72702f8e8c7a0085f2ae2205b619b50edfc01dae2fb87ef8da build-summary.numeric' \
  '9e6a4a0c7b44173878d4068c2ff8d610cb9aba0784b800baca9f6488b24f421d idle-qualify.py' \
  '418e2125e99b4d81df5fbe414d7b44905e04dd06ca31500bd519f8bec3a651a6 root.sh'; do
  expected=$(/usr/bin/printf '%s' "$pair" | /usr/bin/cut -d' ' -f1)
  name=$(/usr/bin/printf '%s' "$pair" | /usr/bin/cut -d' ' -f2)
  [[ $(/usr/bin/sha256sum "$rootstage/$name" | /usr/bin/cut -d' ' -f1) == "$expected" ]]
done
handed=1
/usr/bin/bash "$rootstage/root.sh" "$rootstage"
'@
  $bootstrap = $bootstrap.Replace('__UPLOAD__',$stage)
  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($bootstrap))
  if ($encoded.Length -gt 24000) { throw 'Unexpectedly long root bootstrap' }
  $command = "/usr/bin/bash -lc 'printf %s $encoded | /usr/bin/base64 -d | /usr/bin/sudo /usr/bin/bash -s'"
  Write-Output 'Replace private bpftool and root pin; idle-only version/prog/link JSON qualification.'
  Write-Output 'No /usr/bin writes, BPF attachment, Muse, Ollama requests or inference.'
  Write-Output 'Enter sudo password only at the interactive SSH terminal prompt.'
  & ssh.exe @ssh '-tt' $remote $command
  if ($LASTEXITCODE -ne 0) {
    throw 'Root bpftool replacement/idle qualification failed; no live session authorized'
  }
}
finally {
  if ($stage -and $stage -cmatch '^/home/hylab/\.cache/clack-json-bpftool-upload\.[A-Za-z0-9]{8}$') {
    $cleanup = "/usr/bin/rm -f -- "+$stage+"/new-bpftool "+$stage+"/source.tar "+
      $stage+"/libbpf.tar "+$stage+"/fix.patch "+$stage+"/build-summary.numeric "+
      $stage+"/idle-qualify.py "+$stage+"/root.sh; /usr/bin/rmdir -- "+$stage
    & ssh.exe @ssh '-T' $remote $cleanup
    if ($LASTEXITCODE -ne 0) { throw 'Task-owned upload stage cleanup failed' }
    Write-Output 'CLACK_JSON_REPLACE_USER_CLEANUP=PASS'
  }
}
