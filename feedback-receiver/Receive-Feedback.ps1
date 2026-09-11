[CmdletBinding()]
param(
    [switch]$Apply,
    [switch]$ArchiveOnly,
    [string]$ArchiveRoot = (Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "PAIA\feedback-receiver\archive")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$script:ApiRoot = "https://gitee.com/api/v5/repos/Houton_Bosta/paia-feedback"
$script:Branch = "master"
$script:TokenPath = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "PAIA\feedback-receiver\gitee-token.dpapi"
$script:ArchiveRoot = [IO.Path]::GetFullPath($ArchiveRoot)
$script:MaxFeedbackBytes = 1048576
$script:AccessToken = $null

function Get-AccessToken {
    if (-not (Test-Path -LiteralPath $script:TokenPath -PathType Leaf)) { throw "Run Set-FeedbackReceiverSecret.ps1 before receiving feedback." }
    try {
        $encrypted = [IO.File]::ReadAllText($script:TokenPath).Trim()
        $secure = ConvertTo-SecureString -String $encrypted
        $token = [Net.NetworkCredential]::new("", $secure).Password
        if ([string]::IsNullOrWhiteSpace($token)) { throw "empty" }
        return $token
    } catch { throw "Cannot decrypt the token. Run under the Windows account that saved it." }
}

function Invoke-Gitee {
    param([ValidateSet("GET", "DELETE")][string]$Method, [string]$Path, [hashtable]$Query = @{})
    $parameters = @{ access_token = $script:AccessToken }
    foreach ($key in $Query.Keys) { $parameters[$key] = $Query[$key] }
    $queryText = ($parameters.GetEnumerator() | ForEach-Object { [uri]::EscapeDataString([string]$_.Key) + "=" + [uri]::EscapeDataString([string]$_.Value) }) -join "&"
    $uri = $script:ApiRoot + "/" + $Path + "?" + $queryText
    try {
        return Invoke-RestMethod -Method $Method -Uri $uri -TimeoutSec 30 -Headers @{ Accept = "application/json" } -MaximumRedirection 0
    } catch {
        $status = "network error"
        $response = $_.Exception.PSObject.Properties["Response"]
        if ($null -ne $response -and $null -ne $response.Value) { $status = "HTTP " + [int]$response.Value.StatusCode }
        throw "Gitee request failed ($Method $Path; $status). Remote deletion is unconfirmed."
    } finally { $parameters.Clear(); $uri = $null; $queryText = $null }
}

function Assert-FeedbackEntry {
    param([object]$Entry)
    if ($Entry.path -cnotmatch '^feedback/\d{4}-\d{2}-\d{2}/[A-Za-z0-9_-]{1,80}\.json$') { throw "Invalid feedback path." }
    if ($Entry.sha -cnotmatch '^[0-9a-f]{40}$') { throw "Invalid feedback SHA." }
}

function Get-FeedbackFiles {
    $snapshot = Invoke-Gitee -Method GET -Path ("git/trees/" + [uri]::EscapeDataString($script:Branch)) -Query @{ recursive = 1 }
    if ($null -eq $snapshot.PSObject.Properties["truncated"] -or $snapshot.truncated -ne $false) { throw "Gitee returned an incomplete tree; no files will be deleted." }
    if ($null -eq $snapshot.PSObject.Properties["tree"]) { throw "Gitee returned an invalid tree." }
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in @($snapshot.tree)) {
        if ($entry.type -ne "blob" -or -not ([string]$entry.path).StartsWith("feedback/", [StringComparison]::Ordinal)) { continue }
        if (-not ([string]$entry.path).EndsWith(".json", [StringComparison]::OrdinalIgnoreCase)) { continue }
        Assert-FeedbackEntry $entry
        if (-not $seen.Add([string]$entry.path)) { throw "Duplicate or case-colliding feedback paths." }
        if ([long]$entry.size -gt $script:MaxFeedbackBytes -or [long]$entry.size -lt 1) { throw "Feedback size is outside the archive limit: $($entry.path)" }
        $entry
    }
}

function Assert-NoReparsePoint {
    param([string]$Path)
    $current = [IO.Path]::GetFullPath($Path)
    while (-not [string]::IsNullOrEmpty($current)) {
        $item = Get-Item -LiteralPath $current -Force -ErrorAction SilentlyContinue
        if ($null -ne $item -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Refusing archive path containing a symbolic link or junction." }
        $parent = [IO.Path]::GetDirectoryName($current)
        if ($parent -eq $current) { break }
        $current = $parent
    }
}

function Get-LocalPath {
    param([object]$Entry)
    Assert-FeedbackEntry $Entry
    $parts = ([string]$Entry.path).Split("/")
    $id = [IO.Path]::GetFileNameWithoutExtension($parts[2])
    $relative = Join-Path $parts[1] ($id + "--" + $Entry.sha + ".json")
    $root = [IO.Path]::GetFullPath($script:ArchiveRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $target = [IO.Path]::GetFullPath((Join-Path $root $relative))
    if (-not $target.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Feedback path escapes the archive." }
    Assert-NoReparsePoint $target
    return $target
}

function Get-BlobSha {
    param([byte[]]$Bytes)
    $header = [Text.Encoding]::ASCII.GetBytes("blob " + $Bytes.Length + [char]0)
    $sha = [Security.Cryptography.SHA1]::Create()
    try { [void]$sha.TransformBlock($header, 0, $header.Length, $header, 0); [void]$sha.TransformFinalBlock($Bytes, 0, $Bytes.Length); return ([BitConverter]::ToString($sha.Hash)).Replace("-", "").ToLowerInvariant() } finally { $sha.Dispose() }
}

function Assert-FeedbackBytes {
    param([byte[]]$Bytes, [object]$Entry)
    if ($Bytes.Length -gt $script:MaxFeedbackBytes -or (Get-BlobSha $Bytes) -ne $Entry.sha) { throw "Feedback hash or size verification failed: $($Entry.path)" }
    try {
        $payload = ConvertFrom-Json -InputObject ([Text.UTF8Encoding]::new($false, $true).GetString($Bytes))
        if ($null -eq $payload -or $payload -is [array] -or $null -eq $payload.PSObject.Properties["message"] -or $payload.message -isnot [string] -or [string]::IsNullOrWhiteSpace($payload.message)) { throw "Invalid message" }
    } catch { throw "Feedback is not a valid UTF-8 JSON feedback object: $($Entry.path)" }
}

function Get-VerifiedLocalBytes {
    param([string]$Path, [object]$Entry)
    Assert-NoReparsePoint $Path
    $info = Get-Item -LiteralPath $Path -Force
    if ($info.PSIsContainer -or $info.Length -gt $script:MaxFeedbackBytes) { throw "Invalid local archive file." }
    $bytes = [IO.File]::ReadAllBytes($Path)
    Assert-FeedbackBytes $bytes $Entry
    return ,$bytes
}

function Save-Feedback {
    param([object]$Entry)
    $target = Get-LocalPath $Entry
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))
    Assert-NoReparsePoint $target
    if (Test-Path -LiteralPath $target) { [void](Get-VerifiedLocalBytes $target $Entry); return $target }
    $file = Invoke-Gitee -Method GET -Path ("git/blobs/" + $Entry.sha)
    if ($file.encoding -ne "base64" -or $file.sha -ne $Entry.sha -or [string]::IsNullOrWhiteSpace($file.content) -or $file.content.Length -gt ($script:MaxFeedbackBytes * 2)) { throw "Invalid Gitee blob response: $($Entry.path)" }
    $bytes = [Convert]::FromBase64String(($file.content -replace "\s", ""))
    Assert-FeedbackBytes $bytes $Entry
    $tmp = "$target.$([guid]::NewGuid().ToString('N')).tmp"
    try {
        $stream = [IO.File]::Open($tmp, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
        [void](Get-VerifiedLocalBytes $tmp $Entry)
        Assert-NoReparsePoint $target
        [IO.File]::Move($tmp, $target)
        [void](Get-VerifiedLocalBytes $target $Entry)
    } finally { if ([IO.File]::Exists($tmp)) { [IO.File]::Delete($tmp) } }
    return $target
}

function Remove-Feedback {
    param([object]$Entry)
    $target = Get-LocalPath $Entry
    [void](Get-VerifiedLocalBytes $target $Entry)
    $encodedPath = (($Entry.path -split "/" | ForEach-Object { [uri]::EscapeDataString($_) }) -join "/")
    $current = Invoke-Gitee -Method GET -Path ("contents/" + $encodedPath) -Query @{ ref = $script:Branch }
    if ($current.sha -ne $Entry.sha -or $current.path -cne $Entry.path -or $current.type -ne "file") { throw "Remote feedback changed; keeping it for the next run: $($Entry.path)" }
    [void](Get-VerifiedLocalBytes $target $Entry)
    Invoke-Gitee -Method DELETE -Path ("contents/" + $encodedPath) -Query @{ sha = $Entry.sha; branch = $script:Branch; message = "Archive PAIA feedback " + [IO.Path]::GetFileName($Entry.path) } | Out-Null
}

function Invoke-FeedbackReceiver {
    param([switch]$Apply, [switch]$ArchiveOnly)
    if ($ArchiveOnly -and -not $Apply) { throw "Use -Apply -ArchiveOnly to archive without deleting." }
    Assert-NoReparsePoint $script:ArchiveRoot
    [void][IO.Directory]::CreateDirectory($script:ArchiveRoot)
    Assert-NoReparsePoint $script:ArchiveRoot
    $lockPath = Join-Path $script:ArchiveRoot ".lock"
    Assert-NoReparsePoint $lockPath
    $lock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    $summary = [ordered]@{ startedAt = [datetime]::UtcNow.ToString("o"); completedAt = $null; mode = "preview"; found = 0; archived = 0; deleted = 0; failed = 0; status = "running" }
    if ($Apply) { $summary.mode = if ($ArchiveOnly) { "archive-only" } else { "archive-and-delete" } }
    try {
        $script:AccessToken = Get-AccessToken
        $entries = @(Get-FeedbackFiles)
        $summary.found = $entries.Count
        foreach ($entry in $entries) {
            if (-not $Apply) { Write-Host "Preview: $($entry.path)"; continue }
            try { $saved = Save-Feedback $entry; $summary.archived++; if (-not $ArchiveOnly) { Remove-Feedback $entry; $summary.deleted++ }; Write-Host "Archived: $($entry.path) -> $saved" } catch { $summary.failed++; Write-Warning $_.Exception.Message }
        }
        if ($summary.failed -gt 0) { throw "$($summary.failed) feedback items could not be completed. Local archives are retained; failed remote deletions are unconfirmed." }
        $summary.status = "success"
    } catch { $summary.status = "failed"; throw }
    finally {
        $script:AccessToken = $null
        $summary.completedAt = [datetime]::UtcNow.ToString("o")
        try {
            $logPath = Join-Path $script:ArchiveRoot "receiver-runs.jsonl"
            Assert-NoReparsePoint $logPath
            [IO.File]::AppendAllText($logPath, (($summary | ConvertTo-Json -Compress) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
            Write-Host ("Result: " + ($summary | ConvertTo-Json -Compress))
        } finally { $lock.Dispose() }
    }
}

if ($MyInvocation.InvocationName -ne ".") { Invoke-FeedbackReceiver -Apply:$Apply -ArchiveOnly:$ArchiveOnly }
