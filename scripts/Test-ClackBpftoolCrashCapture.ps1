# Synthetic fixture tests in exclusive unprivileged cache stage only.
# No sudo, bpftool invocation, eBPF attachment or package changes.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$key=Join-Path $env:USERPROFILE '.ssh\clack_hylab_ed25519'
$remote='hylab@192.168.1.44'
$files=@('clack-bpftool-abort-capture.py','clack-bpftool-abort-capture.test.py')
$ssh=@('-T','-o','StrictHostKeyChecking=yes','-o','BatchMode=yes',
  '-o','ConnectTimeout=5','-i',$key)
$scp=@('-q','-o','StrictHostKeyChecking=yes','-o','BatchMode=yes',
  '-o','ConnectTimeout=5','-i',$key)
$stage=$null
try {
  $created=& ssh.exe @ssh $remote '/usr/bin/mktemp -d -p /home/hylab/.cache clack-crash-offline.XXXXXXXX'
  if($LASTEXITCODE -ne 0){throw 'Exclusive offline stage not created'}
  $stage=($created|Out-String).Trim()
  if($stage -cnotmatch '^/home/hylab/\.cache/clack-crash-offline\.[A-Za-z0-9]{8}$'){
    throw 'Unexpected stage'
  }
  foreach($name in $files){
    $p=Join-Path $PSScriptRoot $name
    if(-not(Test-Path -LiteralPath $p -PathType Leaf)){throw 'Missing fixture file'}
    & scp.exe @scp '--' $p ($remote+':'+$stage+'/'+$name)
    if($LASTEXITCODE -ne 0){throw 'Offline test upload failed'}
  }
  Write-Output 'OFFLINE_GDB_FIXTURES: only artificial Python/C abort fixtures.'
  & ssh.exe @ssh $remote ("/usr/bin/timeout --signal=TERM --kill-after=2s 45s /usr/bin/python3 -B '"+$stage+"/clack-bpftool-abort-capture.test.py' -q")
  if($LASTEXITCODE -ne 0){throw 'Offline GDB fixture test failed'}
  Write-Output 'OFFLINE_GDB_FIXTURES=PASS'
}
finally {
  if($stage -and $stage -cmatch '^/home/hylab/\.cache/clack-crash-offline\.[A-Za-z0-9]{8}$'){
    $command="/usr/bin/rm -f -- '"+$stage+"/clack-bpftool-abort-capture.py' '"+$stage+"/clack-bpftool-abort-capture.test.py'; /usr/bin/rmdir -- '"+$stage+"'"
    & ssh.exe @ssh $remote $command
    if($LASTEXITCODE -ne 0){throw 'Offline stage cleanup failed'}
    Write-Output 'OFFLINE_GDB_FIXTURES_CLEANUP=PASS'
  }
}
