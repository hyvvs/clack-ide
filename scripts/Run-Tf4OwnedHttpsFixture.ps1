#requires -Version 5.1
<#
.SYNOPSIS
  Explicitly opted-in bounded HTTPS fixture on IPv4 127.0.0.1:443 ONLY.
.DESCRIPTION
  Creates a non-exportable CurrentUser\My Windows certificate with IPv4 SAN
  127.0.0.1. Only PUBLIC DER is exposed at the exact current-run path
  src-tauri\target\tf4-owned-https\server.cer. Removes the cert, CNG key,
  public DER and local listener on normal stop or failure.

  Does not spawn a browser, TF3, Rust test, trust installer, or PFX export.
  Run the Rust test in ANOTHER PowerShell with CLACK_TF4_OWNED_HTTPS_CERT
  pointing to the live server.cer; only the test may explicitly trust it.

  .\scripts\Run-Tf4OwnedHttpsFixture.ps1 -Action Serve
  .\scripts\Run-Tf4OwnedHttpsFixture.ps1 -Action Stop -RunId <printed-run-id>

  A forcibly killed PowerShell process may bypass finally. Stale certs and
  files must never be interpreted as a live verified fixture.
#>
[CmdletBinding()]
param(
    [ValidateSet('Serve', 'Stop', 'Help')]
    [string] $Action = 'Serve',
    [ValidatePattern('^[0-9a-fA-F]{32}$')]
    [string] $RunId,
    [ValidateRange(10, 1800)]
    [int] $MaxDurationSeconds = 600,
    [ValidateRange(1, 256)]
    [int] $MaxRequests = 64,
    [ValidateRange(500, 10000)]
    [int] $ClientTimeoutMilliseconds = 3000,
    [switch] $CssRedirect,
    [switch] $DiagnosticStages,
    # Explicit physical pending-document cancellation probe ONLY. The default
    # remains unchanged for all previously accepted owned-HTTPS fixtures.
    [ValidateRange(0, 3500)]
    [int] $PendingDocumentDelayMilliseconds = 0,
    # Separate single-document read-only native COM element recheck probe.
    # No JS, CSS, image, font or other remote resources. Original routes and
    # accepted multi-resource fixtures remain the default and unchanged.
    [switch] $MinimalRecheckDocument,
    # Independent actual WebView2 programmatic exact-node click/navigation
    # acceptance document. Does not alter the historical recheck fixture.
    [switch] $MinimalClickDocument,
    # Physical screenshot privacy-negative: one static HTML document with
    # deliberately synthetic password/hidden fields, no external resources.
    # Kept separate from the prior positive read-only and click fixtures.
    [switch] $MinimalSensitiveDocument,
    # One real original FORM/submitter with supported hidden-only controls,
    # captured by WebView2 before consent; never automatically submitted.
    [switch] $MinimalOriginalFormDocument,
    # Isolated positive HTML form fixture for a future TF3-governed POST.
    # It confers no native action or network approval and is never default.
    [switch] $SubmittingFormDocument
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$crlf = ([string][char]13) + ([string][char]10)
$target = [System.IO.Path]::GetFullPath(
    (Join-Path $PSScriptRoot '..\src-tauri\target\tf4-owned-https')
)
$publicPath = Join-Path $target 'server.cer'
$activePath = Join-Path $target 'active.run'
$ip = [System.Net.IPAddress]::Parse('127.0.0.1')
$port = 443

if ($Action -eq 'Help') {
    Write-Output 'TF4 owned HTTPS fixture: foreground IPv4 127.0.0.1:443 only.'
    Write-Output '.\scripts\Run-Tf4OwnedHttpsFixture.ps1 -Action Serve [-CssRedirect] [-MaxDurationSeconds 600] [-MaxRequests 64]'
    Write-Output '.\scripts\Run-Tf4OwnedHttpsFixture.ps1 -Action Serve -PendingDocumentDelayMilliseconds 2500 (one explicitly signaled pending HTTPS / GET for the new cancellation-only test)'
    Write-Output '.\scripts\Run-Tf4OwnedHttpsFixture.ps1 -Action Serve -MinimalRecheckDocument (one static no-subresource HTML page for the separate read-only COM recheck test)'
    Write-Output '.\scripts\Run-Tf4OwnedHttpsFixture.ps1 -Action Serve -MinimalClickDocument (two bounded static pages for the separate live COM click navigation probe)'
    Write-Output '.\scripts\Run-Tf4OwnedHttpsFixture.ps1 -Action Serve -MinimalSensitiveDocument (one static synthetic credential-control screenshot-denial probe)'
    Write-Output '.\scripts\Run-Tf4OwnedHttpsFixture.ps1 -Action Serve -MinimalOriginalFormDocument (one static original hidden-only FORM/submitter capture, no POST)'
    Write-Output '.\scripts\Run-Tf4OwnedHttpsFixture.ps1 -Action Serve -SubmittingFormDocument (bounded real HTML POST; server accepts at most one submission)'
    Write-Output '.\scripts\Run-Tf4OwnedHttpsFixture.ps1 -Action Stop -RunId <32-hex-run-id>'
    Write-Output ('Second terminal: $env:CLACK_TF4_OWNED_HTTPS_CERT = "' + $publicPath + '"')
    Write-Output 'Run ONLY the selected Rust test concurrently. Script never launches it.'
    return
}

if ($Action -eq 'Stop') {
    if (-not $RunId) { throw '-Action Stop needs the run ID printed by the server.' }
    if (-not [System.IO.File]::Exists($activePath)) {
        throw 'No active owned HTTPS fixture marker exists.'
    }
    $active = [System.IO.File]::ReadAllText($activePath).Trim()
    if ($active -cne $RunId.ToLowerInvariant()) {
        throw 'Run ID does not match the currently registered fixture.'
    }
    $stopPath = Join-Path $target ('stop-' + $active + '.request')
    if (-not [System.IO.File]::Exists($stopPath)) {
        $file = [System.IO.FileStream]::new(
            $stopPath, [System.IO.FileMode]::CreateNew,
            [System.IO.FileAccess]::Write, [System.IO.FileShare]::None
        )
        try {
            $marker = [System.Text.Encoding]::ASCII.GetBytes('stop')
            $file.Write($marker, 0, $marker.Length)
            $file.Flush($true)
        }
        finally { $file.Dispose() }
    }
    Write-Output ('Stop requested for ' + $active + '; server will clean up in finally.')
    return
}
if ($RunId) { throw '-RunId is only accepted with -Action Stop.' }
if (-not (Get-Command New-SelfSignedCertificate -ErrorAction SilentlyContinue)) {
    throw 'Windows PKI New-SelfSignedCertificate is unavailable.'
}

$utf8 = [System.Text.UTF8Encoding]::new($false)
$html = @'
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="referrer" content="no-referrer">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="data:,">
  <link rel="stylesheet" href="/page.css">
  <script defer src="/page.js"></script>
  <title>TF4 owned HTTPS fixture</title>
</head>
<body>
  <main id="fixture-root">
    <h1>TF4 owned fixture</h1>
    <p id="font-glyphs">ABCD0123</p>
    <img id="fixture-image" alt="" src="/pixel.png" width="1" height="1">
    <form id="safe-observation-form" action="/never-submit" method="post">
      <label for="safe-text">Visible controlled field</label>
      <input id="safe-text" type="text" required value="synthetic-nonsecret-input-value">
      <input id="safe-password" type="password" value="synthetic-secret-must-not-appear">
      <input id="safe-hidden" type="hidden" value="synthetic-hidden-must-not-appear">
      <input id="safe-check" type="checkbox" checked>
      <select id="safe-select"><option selected>Controlled option</option></select>
      <textarea id="safe-textarea">synthetic-nonsecret-field-content</textarea>
      <button id="safe-button" type="button" disabled>Disabled action</button>
    </form>
  </main>
</body>
</html>
'@
$css = @'
@font-face {
  font-family: "ClackOwnedFixture";
  src: url("/font.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: block;
}
html, body { margin: 0; padding: 0; }
body { background: #fff; color: #111; }
#font-glyphs { font-family: "ClackOwnedFixture", sans-serif; font-weight: 400; }
'@
$js = @'
(() => {
  "use strict";
  const root = document.getElementById("fixture-root");
  if (root) root.dataset.ownedFixture = "script-loaded";
  // Request the one already declared CSS font face even if browser layout
  // defers text painting. It is still the same fixed-origin /font.woff2 URL.
  if (document.fonts && document.fonts.load) {
    document.fonts.load("16px ClackOwnedFixture").catch(() => {});
  }
})();
'@

# Small fixture-specific response, NOT a redistributable system font and NOT
# guaranteed to decode as a valid WOFF2. It has the expected signature;
# the CSS makes the browser request it. Browser scheduling of that request
# cannot be guaranteed, so the Rust test must count physical GETs itself.
[byte[]] $fontBytes = [byte[]] @(
    0x77, 0x4f, 0x46, 0x32, 0x00, 0x01, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x30, 0x00, 0x00, 0x00, 0x01,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
)
[byte[]] $pixelBytes = [System.Convert]::FromBase64String(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5+wHQAAAAASUVORK5CYII='
)
$routes = [System.Collections.Generic.Dictionary[string,object]]::new(
    [System.StringComparer]::Ordinal
)
$routes.Add('/', @{ Type = 'text/html'; Body = $utf8.GetBytes($html) })
$routes.Add('/page.css', @{ Type = 'text/css'; Body = $utf8.GetBytes($css) })
$routes.Add('/page.js', @{ Type = 'application/javascript'; Body = $utf8.GetBytes($js) })
$routes.Add('/pixel.png', @{ Type = 'image/png'; Body = $pixelBytes })
$routes.Add('/font.woff2', @{ Type = 'font/woff2'; Body = $fontBytes })
if ($MinimalRecheckDocument) {
    if ($CssRedirect -or $PendingDocumentDelayMilliseconds -ne 0 -or $MinimalClickDocument -or $MinimalSensitiveDocument -or $MinimalOriginalFormDocument -or $SubmittingFormDocument) {
        throw '-MinimalRecheckDocument cannot combine with CSS redirect or pending-document delay.'
    }
    $minimalHtml = @'
<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'">
<link rel="icon" href="data:,">
<title>TF4 exact native identity fixture</title></head>
<body><main><h1>Controlled heading</h1><p>Read only native identity</p>
<button type="button" disabled>Disabled control</button>
</main></body></html>
'@
    $routes.Clear()
    $routes.Add('/', @{ Type = 'text/html'; Body = $utf8.GetBytes($minimalHtml) })
}
if ($MinimalClickDocument) {
    if ($CssRedirect -or $PendingDocumentDelayMilliseconds -ne 0 -or $MinimalRecheckDocument -or $MinimalSensitiveDocument -or $MinimalOriginalFormDocument -or $SubmittingFormDocument) {
        throw '-MinimalClickDocument cannot combine with other fixture modes.'
    }
    $clickHtml = @'
<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'">
<link rel="icon" href="data:,">
<title>TF4 owned exact click</title></head>
<body><main><h1>Controlled before activation</h1><p>No page-authored scripts</p>
<a href="/clicked">Approved destination link</a>
<button type="button" disabled>Disabled control</button></main></body></html>
'@
    $afterHtml = @'
<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'">
<link rel="icon" href="data:,">
<title>TF4 click navigation destination</title></head>
<body><main><h1>Controlled destination reached</h1><p>No scripted mutations</p></main></body></html>
'@
    $routes.Clear()
    $routes.Add('/', @{ Type = 'text/html'; Body = $utf8.GetBytes($clickHtml) })
    $routes.Add('/clicked', @{ Type = 'text/html'; Body = $utf8.GetBytes($afterHtml) })
}
if ($MinimalSensitiveDocument) {
    if ($CssRedirect -or $PendingDocumentDelayMilliseconds -ne 0 -or $MinimalRecheckDocument -or $MinimalClickDocument -or $MinimalOriginalFormDocument -or $SubmittingFormDocument) {
        throw '-MinimalSensitiveDocument cannot combine with other fixture modes.'
    }
    # The value is synthetic; even this fixture's controlled original bytes
    # must never enter semantic/model/pixel evidence.
    $sensitiveHtml = @'
<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'">
<link rel="icon" href="data:,">
<title>TF4 synthetic sensitive control fixture</title></head>
<body><main><h1>Controlled sensitivity denial</h1>
<form action="/never-submit" method="post">
<label for="synthetic-password">Synthetic password</label>
<input id="synthetic-password" type="password" value="SYNTHETIC-TF4-NO-DISCLOSURE-4ae8">
<input type="hidden" name="synthetic" value="SYNTHETIC-HIDDEN-NOT-FOR-MODEL">
</form></main></body></html>
'@
    $routes.Clear()
    $routes.Add('/', @{ Type = 'text/html'; Body = $utf8.GetBytes($sensitiveHtml) })
}
if ($MinimalOriginalFormDocument) {
    if ($CssRedirect -or $PendingDocumentDelayMilliseconds -ne 0 -or $MinimalRecheckDocument -or $MinimalClickDocument -or $MinimalSensitiveDocument -or $SubmittingFormDocument) {
        throw '-MinimalOriginalFormDocument cannot combine with other fixture modes.'
    }
    $originalFormHtml = @'
<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'self'">
<link rel="icon" href="data:,">
<title>TF4 original native FORM capture</title></head>
<body><main><h1>Controlled original FORM</h1>
<form action="/capture-only" method="post" enctype="application/x-www-form-urlencoded" target="_self" autocomplete="off">
<input type="hidden" name="flow" value="owned browser">
<input type="hidden" name="stamp" value="unique+token">
<button type="submit">Approve original form</button>
</form></main></body></html>
'@
    $routes.Clear()
    $routes.Add('/', @{ Type = 'text/html'; Body = $utf8.GetBytes($originalFormHtml) })
}
if ($SubmittingFormDocument) {
    if ($CssRedirect -or $PendingDocumentDelayMilliseconds -ne 0 -or $MinimalClickDocument -or $MinimalRecheckDocument -or $MinimalSensitiveDocument -or $MinimalOriginalFormDocument) {
        throw '-SubmittingFormDocument cannot combine with other fixture modes.'
    }
    $formHtml = @'
<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'self'">
<link rel="icon" href="data:,">
<title>TF4 owned real submission fixture</title></head>
<body><main><h1>Controlled form</h1>
<form action="/submitted" method="post" autocomplete="off">
<label for="message">Controlled message</label><input id="message" name="message" type="text" maxlength="64" value="sample" required>
<label for="choice">Controlled choice</label><select id="choice" name="choice"><option value="one">One</option><option value="two">Two</option></select>
<label for="confirmed">Confirm</label><input id="confirmed" name="confirmed" type="checkbox" value="on">
<button type="submit">Submit exactly once</button>
</form></main></body></html>
'@
    $submittedHtml = @'
<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'">
<title>TF4 submission receipt</title></head><body><main><h1>Exactly one submission accepted</h1></main></body></html>
'@
    $routes.Clear()
    $routes.Add('/', @{ Type = 'text/html'; Body = $utf8.GetBytes($formHtml) })
    $routes.Add('/submitted', @{ Type = 'text/html'; Body = $utf8.GetBytes($submittedHtml) })
}
foreach ($route in $routes.Values) {
    if ($route.Body.Length -eq 0 -or $route.Body.Length -gt 65536) {
        throw 'Fixed fixture response violates the 64 KiB body bound.'
    }
}
if ($CssRedirect) {
    # Optional only: one bounded same-origin redirect permits TF3 to prove
    # re-authorization of the redirected CSS target without adding a new
    # WebView2-native resource kind. Default direct mode has five GET routes.
    $routes['/style.css'] = @{ Type = 'text/css'; Body = $utf8.GetBytes($css) }
}

function Send-FixedResponse {
    param(
        [System.Net.Security.SslStream] $Stream,
        [int] $Status,
        [string] $Reason,
        [string] $ContentType,
        [byte[]] $Body,
        [string] $Location = '',
        [ValidateSet('none', 'self')]
        [string] $FormAction = 'none'
    )
    if ($Body.Length -gt 65536) { throw 'Response body exceeds the fixed 64 KiB bound.' }
    if ($Location -ne '' -and $Location -cne '/style.css') {
        throw 'Only the compile-time same-origin CSS redirect is allowed.'
    }
    $headers = @(
        "HTTP/1.1 $Status $Reason",
        "Content-Type: $ContentType",
        "Content-Length: $($Body.Length)",
        'Cache-Control: no-store, max-age=0',
        'Connection: close',
        'X-Content-Type-Options: nosniff',
        'Referrer-Policy: no-referrer',
        "Content-Security-Policy: default-src 'none'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action '$FormAction'"
    )
    if ($Location -ne '') { $headers += "Location: $Location" }
    $prefix = ([string]::Join($crlf, $headers) + $crlf + $crlf)
    $wire = [System.Text.Encoding]::ASCII.GetBytes($prefix)
    $Stream.Write($wire, 0, $wire.Length)
    if ($Body.Length -gt 0) { $Stream.Write($Body, 0, $Body.Length) }
    $Stream.Flush()
}

function Read-StrictGetPath {
    param(
        [System.Net.Security.SslStream] $Stream,
        [int] $TimeoutMilliseconds,
        [switch] $AllowFormPost
    )
    # One HTTP/1.1 GET per TLS connection, <=8192-byte headers. Total
    # request-header time and each individual blocking read are both bounded.
    # All URI queries, encoded paths, userinfo and arbitrary origins fail.
    $buffer = [byte[]]::new(8192)
    $used = 0
    $delimiterEnd = -1
    $clock = [System.Diagnostics.Stopwatch]::StartNew()
    while ($used -lt $buffer.Length -and $clock.ElapsedMilliseconds -lt $TimeoutMilliseconds) {
        $left = $TimeoutMilliseconds - [int]$clock.ElapsedMilliseconds
        if ($left -le 0) { break }
        $Stream.ReadTimeout = [Math]::Max(1, [Math]::Min($left, 500))
        $read = $Stream.Read($buffer, $used, [Math]::Min(512, $buffer.Length - $used))
        if ($read -le 0) { throw 'Peer closed before completing GET headers.' }
        $used += $read
        for ($i = 3; $i -lt $used; $i++) {
            if ($buffer[$i - 3] -eq 13 -and $buffer[$i - 2] -eq 10 -and
                $buffer[$i - 1] -eq 13 -and $buffer[$i] -eq 10) {
                $delimiterEnd = $i + 1
                break
            }
        }
        if ($delimiterEnd -ge 0) { break }
    }
    if ($delimiterEnd -lt 0 -or $delimiterEnd -gt 8192) {
        throw 'Headers exceeded strict time/length bound.'
    }
    for ($i = 0; $i -lt $delimiterEnd; $i++) {
        $byte = [int]$buffer[$i]
        if ($byte -gt 126 -or ($byte -lt 32 -and $byte -ne 13 -and $byte -ne 10)) {
            throw 'HTTP headers must use printable US-ASCII, CR and LF only.'
        }
    }
    $raw = [System.Text.Encoding]::ASCII.GetString($buffer, 0, $delimiterEnd)
    $raw = $raw.TrimEnd([char[]]@(13, 10))
    $lines = $raw.Split([string[]]@($crlf), [System.StringSplitOptions]::None)
    if ($lines.Length -lt 2 -or $lines.Length -gt 64) {
        throw 'HTTP header count must be bounded.'
    }
    $first = [System.Text.RegularExpressions.Regex]::Match(
        $lines[0], '^(GET|POST) (/[^ ]*) HTTP/1[.]1$'
    )
    if (-not $first.Success) {
        throw 'Only origin-form GET or exact submitting-form POST over HTTP/1.1 is accepted.'
    }
    $method = $first.Groups[1].Value
    $path = $first.Groups[2].Value
    if ($method -ceq 'POST' -and (-not $AllowFormPost -or $path -cne '/submitted')) {
        throw 'POST is permitted only for the opted-in owned form destination.'
    }
    if ($path.Contains('?') -or $path.Contains('#') -or
        $path.Contains('%') -or $path.Contains('\') -or $path.Contains('//')) {
        throw 'Query, fragment, escape and ambiguous path denied.'
    }
    $hosts = 0
    $lengthCount = 0
    $contentLength = 0
    $contentTypeCount = 0
    foreach ($line in $lines[1..($lines.Length - 1)]) {
        if ($line -eq '') { continue }
        if ($line -cnotmatch '^[A-Za-z0-9-]+:[\x20-\x7e]*$') {
            throw 'Malformed HTTP header.'
        }
        $hostMatch = [System.Text.RegularExpressions.Regex]::Match(
            $line, '^Host:[ ]*(.+)$',
            [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
        )
        if ($hostMatch.Success) {
            $hosts++
            if ($hostMatch.Groups[1].Value -cnotin @('127.0.0.1', '127.0.0.1:443')) {
                throw 'Only one exact 127.0.0.1 Host is allowed.'
            }
        }
        if ($line -imatch '^Transfer-Encoding:') {
            throw 'Chunked or transfer-encoded requests are not accepted.'
        }
        if ($line -imatch '^Content-Length:[ ]*(.*)$') {
            $lengthCount++
            if ($Matches[1] -cnotmatch '^(0|[1-9][0-9]{0,3})$') {
                throw 'Invalid fixed request body length.'
            }
            $contentLength = [int]$Matches[1]
        }
        if ($line -imatch '^Content-Type:[ ]*(.*)$') {
            $contentTypeCount++
            if ($method -ceq 'POST' -and $Matches[1] -ine 'application/x-www-form-urlencoded') {
                throw 'Only the browser form-urlencoded content type is accepted.'
            }
        }
    }
    if ($hosts -ne 1) { throw 'Exactly one IPv4 loopback Host header required.' }
    if ($method -ceq 'POST') {
        if ($lengthCount -ne 1 -or $contentTypeCount -ne 1 -or
            $contentLength -lt 1 -or $contentLength -gt 1024) {
            throw 'Form POST requires exactly one bounded fixed-length body.'
        }
    }
    elseif ($lengthCount -gt 1 -or $contentLength -ne 0) {
        throw 'GET cannot carry a request body.'
    }
    $alreadyRead = $used - $delimiterEnd
    if ($alreadyRead -gt $contentLength) {
        throw 'HTTP pipelining or trailing request bytes are not permitted.'
    }
    $received = $alreadyRead
    while ($received -lt $contentLength -and $clock.ElapsedMilliseconds -lt $TimeoutMilliseconds) {
        $left = $TimeoutMilliseconds - [int]$clock.ElapsedMilliseconds
        if ($left -le 0) { break }
        $Stream.ReadTimeout = [Math]::Max(1, [Math]::Min($left, 500))
        $chunk = $Stream.Read($buffer, 0, [Math]::Min(512, $contentLength - $received))
        if ($chunk -le 0) { throw 'Form POST truncated before fixed body length.' }
        $received += $chunk
    }
    if ($received -ne $contentLength) { throw 'Form POST body deadline exceeded.' }
    # The body is intentionally not stored, echoed, or projected into logs.
    return @{ Path = $path; Method = $method }
}

$listener = $null
$certificate = $null
$privateRsa = $null
$privateCngKey = $null
$der = $null
$ownedPublic = $false
$ownedActive = $false
$served = 0
$denied = 0
$postAttempts = 0
$postAccepted = 0
$run = [System.Guid]::NewGuid().ToString('N')
$stopPath = Join-Path $target ('stop-' + $run + '.request')
$pendingDocumentSignal = Join-Path $target ('pending-document-' + $run + '.signal')
$ownedPendingDocumentSignal = $false
$cleanupFailures = [System.Collections.Generic.List[string]]::new()

try {
    if ([System.IO.File]::Exists($publicPath) -or
        [System.IO.File]::Exists($activePath)) {
        throw 'Existing server.cer or active.run must not be overwritten; inspect stale fixture safely.'
    }

    # A concrete IPv4 loopback socket, never IPAddress.Any, IPv6Any or a
    # hostname. ExclusiveAddressUse prevents sharing a listener on this port.
    $listener = [System.Net.Sockets.TcpListener]::new($ip, $port)
    $listener.Server.ExclusiveAddressUse = $true
    $listener.Start(16)
    $bound = [System.Net.IPEndPoint]$listener.LocalEndpoint
    if ($bound.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork -or
        $bound.Address.ToString() -cne '127.0.0.1' -or $bound.Port -ne 443) {
        throw 'STOP: listener did not bind exactly IPv4 127.0.0.1:443.'
    }

    [System.IO.Directory]::CreateDirectory($target) | Out-Null
    $minutes = [Math]::Min(35, [Math]::Ceiling($MaxDurationSeconds / 60) + 3)
    $certParameters = @{
        Type = 'SSLServerAuthentication'
        Subject = 'CN=127.0.0.1'
        TextExtension = @('2.5.29.17={text}IPAddress=127.0.0.1')
        CertStoreLocation = 'Cert:\CurrentUser\My'
        Provider = 'Microsoft Software Key Storage Provider'
        KeyAlgorithm = 'RSA'
        KeyLength = 2048
        KeyExportPolicy = 'NonExportable'
        HashAlgorithm = 'SHA256'
        NotAfter = [System.DateTime]::Now.AddMinutes($minutes)
    }
    $certificate = New-SelfSignedCertificate @certParameters
    if ($null -eq $certificate -or -not $certificate.HasPrivateKey) {
        throw 'Windows CurrentUser TLS identity was not created with its private key.'
    }
    $san = $certificate.Extensions |
        Where-Object { $_.Oid.Value -eq '2.5.29.17' } |
        Select-Object -First 1
    if ($null -eq $san -or
        -not [System.BitConverter]::ToString($san.RawData).Contains('87-04-7F-00-00-01')) {
        throw 'Generated certificate lacks the actual IP SAN 127.0.0.1.'
    }
    $privateRsa = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey(
        $certificate
    )
    if ($null -eq $privateRsa -or
        $privateRsa -isnot [System.Security.Cryptography.RSACng]) {
        throw 'Generated key must be owned Windows CNG RSA, not an unexpected provider.'
    }
    $privateCngKey = $privateRsa.Key
    $export = $privateCngKey.ExportPolicy
    if (($export -band [System.Security.Cryptography.CngExportPolicies]::AllowExport) -ne 0 -or
        ($export -band [System.Security.Cryptography.CngExportPolicies]::AllowPlaintextExport) -ne 0) {
        throw 'Generated private key was exportable; refusing TLS fixture.'
    }

    # Cert is PUBLIC DER only. Never export X509ContentType.Pfx, private
    # keys, or a CNG key blob, and never add anything to a trust root store.
    $der = $certificate.Export(
        [System.Security.Cryptography.X509Certificates.X509ContentType]::Cert
    )
    $publicFile = [System.IO.FileStream]::new(
        $publicPath, [System.IO.FileMode]::CreateNew,
        [System.IO.FileAccess]::Write, [System.IO.FileShare]::None
    )
    $ownedPublic = $true
    try {
        $publicFile.Write($der, 0, $der.Length)
        $publicFile.Flush($true)
    }
    finally { $publicFile.Dispose() }

    $activeFile = [System.IO.FileStream]::new(
        $activePath, [System.IO.FileMode]::CreateNew,
        [System.IO.FileAccess]::Write, [System.IO.FileShare]::None
    )
    $ownedActive = $true
    try {
        $activeBytes = [System.Text.Encoding]::ASCII.GetBytes($run)
        $activeFile.Write($activeBytes, 0, $activeBytes.Length)
        $activeFile.Flush($true)
    }
    finally { $activeFile.Dispose() }

    Write-Output ('READY runId=' + $run + ' bound=https://127.0.0.1:443/')
    Write-Output ('PUBLIC_DER=' + $publicPath)
    Write-Output ('SECOND_TERMINAL: $env:CLACK_TF4_OWNED_HTTPS_CERT = "' + $publicPath + '"')
    Write-Output 'SECOND_TERMINAL: run ONLY the selected Rust owned-HTTPS test.'
    Write-Output ('.\scripts\Run-Tf4OwnedHttpsFixture.ps1 -Action Stop -RunId ' + $run)
    Write-Output ('LIMITS maxSeconds=' + $MaxDurationSeconds +
        ' maxConnections=' + $MaxRequests +
        ' perClientMs=' + $ClientTimeoutMilliseconds +
        ' maxHeaderBytes=8192 maxBodyBytes=65536' +
        ' pendingDocumentDelayMs=' + $PendingDocumentDelayMilliseconds)
    Write-Output ('CSS=' + $(if ($CssRedirect) { 'one bounded same-origin 302 to /style.css' } else { 'direct /page.css' }))
    Write-Output ('DOCUMENT_MODE=' + $(if ($MinimalRecheckDocument) { 'one_static_no_subresource_html' } elseif ($MinimalSensitiveDocument) { 'one_synthetic_sensitive_control_denial' } elseif ($MinimalOriginalFormDocument) { 'one_original_hidden_form_capture_no_post' } elseif ($MinimalClickDocument) { 'two_static_exact_click_navigation' } elseif ($SubmittingFormDocument) { 'one_bounded_real_post_form' } else { 'original_multiresource' }))

    $clock = [System.Diagnostics.Stopwatch]::StartNew()
    while ($clock.Elapsed.TotalSeconds -lt $MaxDurationSeconds -and
        $served -lt $MaxRequests -and
        -not [System.IO.File]::Exists($stopPath)) {
        if (-not $listener.Pending()) {
            Start-Sleep -Milliseconds 40
            continue
        }
        $client = $null
        $tls = $null
        $served++
        $stage = 'accept'
        try {
            $client = $listener.AcceptTcpClient()
            $remote = [System.Net.IPEndPoint]$client.Client.RemoteEndPoint
            if ($remote.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork -or
                $remote.Address.ToString() -cne '127.0.0.1') {
                throw 'A non-loopback or non-IPv4 peer was rejected.'
            }
            $client.NoDelay = $true
            $client.ReceiveTimeout = $ClientTimeoutMilliseconds
            $client.SendTimeout = $ClientTimeoutMilliseconds
            $tls = [System.Net.Security.SslStream]::new($client.GetStream(), $false)
            $tls.ReadTimeout = $ClientTimeoutMilliseconds
            $tls.WriteTimeout = $ClientTimeoutMilliseconds
            $stage = 'tls'
            # TLS 1.2 only; no client-auth, SSL3/TLS1.0/1.1 or global trust.
            $tls.AuthenticateAsServer(
                $certificate, $false,
                [System.Security.Authentication.SslProtocols]::Tls12, $false
            )
            $stage = 'headers'
            $request = Read-StrictGetPath -Stream $tls -TimeoutMilliseconds $ClientTimeoutMilliseconds -AllowFormPost:$SubmittingFormDocument
            $path = $request.Path
            $stage = 'response'
            if ($PendingDocumentDelayMilliseconds -gt 0 -and $path -ceq '/') {
                # The only signal source is an already TLS-authenticated,
                # strictly parsed HTTPS GET /. Parent TF3 cannot initiate it
                # before the production WebView2 child owns a live COM
                # WebResourceRequested deferral and emits its native GET.
                #
                # Each accepted GET appends exactly one ASCII 'D' (bounded by
                # MaxRequests). The cancellation test observes count 1 while
                # the first response remains delayed; count >1 means replay.
                # Signal is scoped by this run ID and removed in finally.
                $signal = [System.IO.FileStream]::new(
                    $pendingDocumentSignal,
                    [System.IO.FileMode]::Append,
                    [System.IO.FileAccess]::Write,
                    [System.IO.FileShare]::Read
                )
                $ownedPendingDocumentSignal = $true
                try {
                    if ($signal.Length -ge $MaxRequests) {
                        throw 'Pending document signal exceeded the accepted request bound.'
                    }
                    $signal.WriteByte(68)
                    $signal.Flush($true)
                }
                finally { $signal.Dispose() }
                Start-Sleep -Milliseconds $PendingDocumentDelayMilliseconds
            }
            if ($SubmittingFormDocument -and $request.Method -ceq 'POST') {
                $postAttempts++
                if ($postAccepted -eq 0) {
                    $postAccepted++
                    $route = $routes['/submitted']
                    Send-FixedResponse -Stream $tls -Status 200 -Reason 'OK' -ContentType $route.Type -Body $route.Body
                }
                else {
                    # The fixture itself never treats duplicate POST as a
                    # second completed effect, even when native dispatch
                    # or network transport is retried incorrectly.
                    $denied++
                    Send-FixedResponse -Stream $tls -Status 409 -Reason 'Conflict' -ContentType 'text/plain' -Body $utf8.GetBytes('duplicate submission denied')
                }
            }
            elseif ($SubmittingFormDocument -and $path -ceq '/submitted') {
                $denied++
                Send-FixedResponse -Stream $tls -Status 405 -Reason 'Method Not Allowed' -ContentType 'text/plain' -Body $utf8.GetBytes('POST required')
            }
            elseif ($CssRedirect -and $path -ceq '/page.css') {
                # Optional exact same-origin one-hop CSS redirect. The
                # redirected path is another fixed route with no second hop.
                Send-FixedResponse -Stream $tls -Status 302 -Reason 'Found' -ContentType 'text/css' -Body ([byte[]]::new(0)) -Location '/style.css'
            }
            elseif ($routes.ContainsKey($path)) {
                $route = $routes[$path]
                Send-FixedResponse -Stream $tls -Status 200 -Reason 'OK' -ContentType $route.Type -Body $route.Body -FormAction $(if ($SubmittingFormDocument -and $path -ceq '/') { 'self' } else { 'none' })
            }
            else {
                $denied++
                Send-FixedResponse -Stream $tls -Status 404 -Reason 'Not Found' -ContentType 'text/plain' -Body $utf8.GetBytes('not found')
            }
        }
        catch {
            $denied++
            # NEVER echo the request URI, query, headers, page content or
            # certificate/private key into stdout, stderr or a file.
            if ($DiagnosticStages) {
                Write-Output ('REJECT stage=' + $stage +
                    ' exceptionType=' + $_.Exception.GetType().Name)
            }
        }
        finally {
            if ($null -ne $tls) { try { $tls.Dispose() } catch {} }
            if ($null -ne $client) { try { $client.Close() } catch {} }
        }
    }
    if ($SubmittingFormDocument) {
        Write-Output ('FORM_POST_ATTEMPTS=' + $postAttempts + ' FORM_POST_ACCEPTED=' + $postAccepted +
            ' FORM_POST_REPLAY_DENIED=' + [Math]::Max(0, $postAttempts - $postAccepted))
    }
    Write-Output ('STOPPED connections=' + $served +
        ' denied=' + $denied +
        ' elapsedSeconds=' + [Math]::Round($clock.Elapsed.TotalSeconds, 1))
}
finally {
    if ($null -ne $listener) {
        try { $listener.Stop() } catch { $cleanupFailures.Add('IPv4 listener close') }
    }
    if ([System.IO.File]::Exists($stopPath)) {
        # The explicit stop signal is written by a separate process. Antivirus
        # or indexing may briefly retain its just-closed four-byte handle;
        # retry ONLY this exact run-owned marker, never scan/remove other runs.
        $stopMarkerRemoved = $false
        for ($stopDeleteAttempt = 0; $stopDeleteAttempt -lt 4; $stopDeleteAttempt++) {
            try {
                [System.IO.File]::Delete($stopPath)
                if (-not [System.IO.File]::Exists($stopPath)) {
                    $stopMarkerRemoved = $true
                    break
                }
            }
            catch { }
            if ($stopDeleteAttempt -lt 3) { Start-Sleep -Milliseconds 50 }
        }
        if (-not $stopMarkerRemoved) { $cleanupFailures.Add('owned stop marker removal') }
    }
    if ($ownedPendingDocumentSignal -and [System.IO.File]::Exists($pendingDocumentSignal)) {
        try { [System.IO.File]::Delete($pendingDocumentSignal) }
        catch { $cleanupFailures.Add('owned pending document signal removal') }
    }
    if ($ownedActive -and [System.IO.File]::Exists($activePath)) {
        try {
            if ([System.IO.File]::ReadAllText($activePath).Trim() -ceq $run) {
                [System.IO.File]::Delete($activePath)
            }
            else { $cleanupFailures.Add('active marker changed; retained') }
        }
        catch { $cleanupFailures.Add('owned active marker removal') }
    }
    if ($ownedPublic -and [System.IO.File]::Exists($publicPath)) {
        try {
            if ([System.Convert]::ToBase64String(
                    [System.IO.File]::ReadAllBytes($publicPath)) -ceq
                [System.Convert]::ToBase64String($der)) {
                [System.IO.File]::Delete($publicPath)
            }
            else { $cleanupFailures.Add('public cert changed; retained') }
        }
        catch { $cleanupFailures.Add('owned public DER removal') }
    }
    if ($null -ne $certificate) {
        try {
            $store = [System.Security.Cryptography.X509Certificates.X509Store]::new(
                'My', [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser
            )
            try {
                $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
                $store.Remove($certificate)
            }
            finally { $store.Close() }
        }
        catch { $cleanupFailures.Add('CurrentUser certificate removal') }
        # Removing a Windows cert need not remove its owned key container.
        if ($null -ne $privateCngKey) {
            try {
                if (-not $privateCngKey.IsEphemeral) { $privateCngKey.Delete() }
            }
            catch { $cleanupFailures.Add('non-exportable CNG key deletion') }
        }
        if ($null -ne $privateRsa) {
            try { $privateRsa.Dispose() } catch {}
        }
        try { $certificate.Dispose() } catch {}
    }
    if ($cleanupFailures.Count -ne 0) {
        throw ('TF4 fixture cleanup incomplete: ' + ($cleanupFailures -join ', ') +
            '. Inspect this run; do not claim successful cleanup.')
    }
}
