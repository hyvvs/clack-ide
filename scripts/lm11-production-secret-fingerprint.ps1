param(
  [ValidateSet('Before','After')][string]$Phase,
  [Parameter(Mandatory=$true)][string]$CaseDir,
  [switch]$ProbeOnly
)

# CLACK LM11 T15: Read ONLY Clack/Terax Windows Credential Manager entries.
# This hashes opaque secret blobs in process memory, zeroes temporary copies,
# and writes ONLY hashes/metadata to an isolated, canonical acceptance case.
# No plaintext secret, target ID, username, endpoint or provider name is emitted.
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).ProviderPath
$cases = (Resolve-Path -LiteralPath (Join-Path $project 'src-tauri\target\lm11-b01-b03-authenticated-webview-20261119\cases')).ProviderPath
$CaseDir = (Resolve-Path -LiteralPath $CaseDir).ProviderPath
if ((Split-Path -Parent $CaseDir) -ne $cases -or
    (Split-Path -Leaf $CaseDir) -notmatch '^fidelity-audit-[0-9]{17}-[a-f0-9]{12}$' -or
    ((Get-Item -LiteralPath $CaseDir -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
  throw 'Credential fingerprint output must be an exact owned non-reparse audit case'
}

Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

public static class ClackLm11CredFingerprint {
  [StructLayout(LayoutKind.Sequential)]
  struct Credential {
    public UInt32 Flags, Type;
    public IntPtr TargetName, Comment;
    public Int64 LastWritten;
    public UInt32 BlobSize;
    public IntPtr Blob;
    public UInt32 Persist, AttributeCount;
    public IntPtr Attributes, TargetAlias, UserName;
  }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode,
    EntryPoint="CredEnumerateW", SetLastError=true)]
  static extern bool Enumerate(string filter, UInt32 flags,
    out UInt32 count, out IntPtr credentials);
  [DllImport("advapi32.dll", EntryPoint="CredFree")]
  static extern void Free(IntPtr credentials);

  static string Sha(byte[] contents) {
    using (var hasher = SHA256.Create()) {
      return BitConverter.ToString(hasher.ComputeHash(contents)).Replace("-", "").ToLowerInvariant();
    }
  }
  static string Sha(string value) {
    var bytes=Encoding.UTF8.GetBytes(value ?? "");
    try { return Sha(bytes); } finally { Array.Clear(bytes,0,bytes.Length); }
  }
  public static int[] ProbeCounts() {
    UInt32 count; IntPtr outer;
    if (!Enumerate(null,0,out count,out outer))
      throw new Win32Exception(Marshal.GetLastWin32Error(),"Read-only metadata probe failed");
    int clack=0, terax=0, legacyPrefix=0, nameEmpty=0;
    try {
      for (int i=0;i<count;i++) {
        IntPtr at=Marshal.ReadIntPtr(outer,i*IntPtr.Size);
        var c=(Credential)Marshal.PtrToStructure(at,typeof(Credential));
        string target=Marshal.PtrToStringUni(c.TargetName) ?? "";
        if (target.IndexOf("clack",StringComparison.OrdinalIgnoreCase)>=0) clack++;
        if (target.IndexOf("terax",StringComparison.OrdinalIgnoreCase)>=0) terax++;
        if (target.StartsWith("LegacyGeneric",StringComparison.OrdinalIgnoreCase)) legacyPrefix++;
        if (target.Length==0) nameEmpty++;
      }
    } finally {Free(outer);}
    return new int[] {(int)count,clack,terax,legacyPrefix,nameEmpty};
  }
  public static string ProbeServiceBoundaries() {
    UInt32 count; IntPtr outer;
    if (!Enumerate(null,0,out count,out outer))
      throw new Win32Exception(Marshal.GetLastWin32Error(),"Read-only scoped metadata probe failed");
    var info=new List<string>();
    try {
      for (int i=0;i<count;i++) {
        IntPtr at=Marshal.ReadIntPtr(outer,i*IntPtr.Size);
        var c=(Credential)Marshal.PtrToStructure(at,typeof(Credential));
        string target=Marshal.PtrToStringUni(c.TargetName) ?? "";
        int p=target.IndexOf("clack-ai",StringComparison.OrdinalIgnoreCase);
        if(p<0) continue;
        int before=p==0 ? -1 : (int)target[p-1];
        int end=p+"clack-ai".Length;
        int after=end>=target.Length ? -1 : (int)target[end];
        info.Add("length="+target.Length+",index="+p+",beforeCode="+before+",afterCode="+after);
      }
    } finally {Free(outer);}
    return String.Join(";",info.ToArray());
  }
  public static string[] Fingerprints(string exactService) {
    UInt32 count;
    IntPtr outer;
    // Keyring targets may be exposed with a "LegacyGeneric:target=" prefix.
    // Enumerate metadata for the current user; never dereference or hash a
    // foreign app's blob. A service-boundary regex gates secret access.
    if (!Enumerate(null, 0, out count, out outer)) {
      int error = Marshal.GetLastWin32Error();
      if (error == 1168) return new string[0]; // no such target
      throw new Win32Exception(error,"Read-only filtered credential enumeration failed");
    }
    var results=new List<string>();
    try {
      if (count > 512) throw new InvalidOperationException("Unexpected credential enumeration size");
      for (int i=0; i<count; ++i) {
        IntPtr at=Marshal.ReadIntPtr(outer, i*IntPtr.Size);
        var c=(Credential)Marshal.PtrToStructure(at, typeof(Credential));
        string target=Marshal.PtrToStringUni(c.TargetName) ?? "";
        // The keyring crate stores service names as a final dot-separated
        // target segment (e.g. opaque account prefix + ".clack-ai"). Match
        // only this service segment, never a substring of a foreign target.
        if (!Regex.IsMatch(target, @"(?i)(?:^|[.])"+
            Regex.Escape(exactService)+@"$")) continue;
        if (c.BlobSize > 1048576 || (c.BlobSize > 0 && c.Blob == IntPtr.Zero)) {
          throw new InvalidOperationException("Unsafe or unreadable credential blob size");
        }
        byte[] secret=new byte[c.BlobSize];
        try {
          if (secret.Length>0) Marshal.Copy(c.Blob,secret,0,secret.Length);
          string username=Marshal.PtrToStringUni(c.UserName) ?? "";
          string alias=Marshal.PtrToStringUni(c.TargetAlias) ?? "";
          string metadata=target+"\u0000"+username+"\u0000"+alias+"\u0000"+
            c.Type+"\u0000"+c.Persist+"\u0000"+c.LastWritten+"\u0000"+c.BlobSize;
          results.Add(Sha(target)+"|"+Sha(metadata)+"|"+Sha(secret));
        } finally { Array.Clear(secret,0,secret.Length); }
      }
    } finally { Free(outer); }
    results.Sort(StringComparer.Ordinal);
    return results.ToArray();
  }
}
'@

if ($ProbeOnly) {
  $safe = [ClackLm11CredFingerprint]::ProbeCounts()
  Write-Output ('WINCRED_METADATA_PROBE_TOTAL='+$safe[0]+' CLACK_NAME_COUNT='+$safe[1]+ ' TERAX_NAME_COUNT='+$safe[2]+' LEGACY_PREFIX_COUNT='+$safe[3]+' EMPTY_NAMES='+$safe[4])
  Write-Output ('SCOPED_NAME_BOUNDARIES='+[ClackLm11CredFingerprint]::ProbeServiceBoundaries())
  return
}

$records = New-Object System.Collections.Generic.List[object]
foreach ($category in @('clack-ai', 'terax-ai')) {
  $rawFingerprints = [ClackLm11CredFingerprint]::Fingerprints($category)
  foreach ($line in $rawFingerprints) {
    $parts = $line.Split('|')
    if ($parts.Count -ne 3 -or @($parts | Where-Object {$_ -notmatch '^[0-9a-f]{64}$'}).Count -ne 0) {
      throw 'Invalid credential digest encoding'
    }
    $records.Add([pscustomobject]@{
      targetHash=$parts[0]; metadataHash=$parts[1]; secretBlobHash=$parts[2]
    })
  }
}
$ordered=@($records | Sort-Object -Property targetHash)
$report=[pscustomobject]@{
  phase=$Phase;source='Win32 CredEnumerateW filtered to exact clack-ai/terax-ai services (read-only)'
  scopedCredentialCount=$ordered.Count;entries=$ordered
  secretsSerialized=$false;credentialsMutated=$false
}
function Write-Once([string]$path,[object]$obj) {
  $encoder=New-Object System.Text.UTF8Encoding($false)
  $bytes=$encoder.GetBytes((ConvertTo-Json -InputObject $obj -Depth 6))
  $out=[IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try {$out.Write($bytes,0,$bytes.Length);$out.Flush($true)}
  finally {$out.Dispose();[Array]::Clear($bytes,0,$bytes.Length)}
}
$leaf='credential-secret-v3-before.json'
if ($Phase -eq 'After') {$leaf='credential-secret-v3-after.json'}
Write-Once (Join-Path $CaseDir $leaf) $report
if ($Phase -eq 'After') {
  $before=Get-Content -LiteralPath (Join-Path $CaseDir 'credential-secret-v3-before.json') -Raw | ConvertFrom-Json
  $a=@($before.entries | ForEach-Object {$_.targetHash+'|'+$_.metadataHash+'|'+$_.secretBlobHash}) -join "`n"
  $b=@($ordered | ForEach-Object {$_.targetHash+'|'+$_.metadataHash+'|'+$_.secretBlobHash}) -join "`n"
  $same=$before.scopedCredentialCount -eq $ordered.Count -and $a -ceq $b
  Write-Once (Join-Path $CaseDir 'credential-secret-v3-comparison.json') ([pscustomobject]@{
    scopedCredentialBlobsUnchanged=$same; secretsSerialized=$false
    beforeCount=$before.scopedCredentialCount;afterCount=$ordered.Count
  })
  Write-Output ('CLACK_CREDENTIAL_BLOB_HASHES_UNCHANGED='+$same)
  if (-not $same) {exit 3}
} else {
  Write-Output ('CLACK_CREDENTIAL_BLOB_BASELINE_COUNT='+$ordered.Count)
}
