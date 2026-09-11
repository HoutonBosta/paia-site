[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("paia-feedback-tests-" + [guid]::NewGuid().ToString("N"))
[void][IO.Directory]::CreateDirectory($testRoot)
. (Join-Path $PSScriptRoot "Receive-Feedback.ps1") -ArchiveRoot $testRoot
$script:testRoot = $testRoot
$script:passes = 0
$script:requests = @()
$script:handler = $null

function Assert-True([bool]$Value, [string]$Message) { if (-not $Value) { throw $Message } }
function Assert-Throws([scriptblock]$Action, [string]$Pattern) {
    $caught = $false
    try { & $Action } catch { $caught = $true; Assert-True ($_.Exception.Message -match $Pattern) ("Unexpected error: " + $_.Exception.Message) }
    Assert-True $caught "Expected operation to fail."
}
function Get-AccessToken { return "offline-test-token" }
function Invoke-Gitee {
    param([string]$Method, [string]$Path, [hashtable]$Query = @{})
    $script:requests += [pscustomobject]@{ Method = $Method; Path = $Path; Query = $Query }
    if ($null -eq $script:handler) { throw "No offline transport handler installed." }
    & $script:handler $Method $Path $Query
}
function New-TestCase([string]$Name) {
    $script:ArchiveRoot = Join-Path $script:testRoot $Name
    $script:requests = @()
    $script:handler = $null
}
function Pass([string]$Name) { $script:passes++; Write-Host "PASS $Name" }

$script:bytes = [Text.Encoding]::UTF8.GetBytes('{"message":"offline feedback"}')
$script:entry = [pscustomobject]@{ path = "feedback/2026-09-11/test.json"; sha = (Get-BlobSha $script:bytes); size = $script:bytes.Length; type = "blob" }
$script:blob = [pscustomobject]@{ sha = $script:entry.sha; content = [Convert]::ToBase64String($script:bytes); encoding = "base64" }

try {
    New-TestCase "hash"
    Assert-True ((Get-BlobSha ([Text.Encoding]::UTF8.GetBytes("hello`n"))) -eq "ce013625030ba8dba906f756967f9e9ca394464a") "Git blob hash mismatch."
    Pass "Known Git blob SHA"

    New-TestCase "paths"
    foreach ($badPath in @("feedback/../outside.json", "feedback/2026-09-11/../../x.json", "feedback/2026-09-11/x:ads.json", "notes/2026-09-11/test.json", "feedback/2026-09-11/x\y.json")) {
        $bad = [pscustomobject]@{ path = $badPath; sha = $script:entry.sha }
        Assert-Throws { Get-LocalPath $bad } "Invalid feedback path"
    }
    Pass "Traversal, alternate stream, and out-of-scope paths rejected"

    New-TestCase "truncated"
    $script:handler = { param($method, $path, $query) [pscustomobject]@{ truncated = $true; tree = @($script:entry) } }
    Assert-Throws { @(Get-FeedbackFiles) } "incomplete tree"
    Assert-True (@($script:requests | Where-Object Method -eq "DELETE").Count -eq 0) "Deleted from truncated snapshot."
    Pass "Truncated snapshot blocks processing"

    New-TestCase "archive-only"
    $script:handler = {
        param($method, $path, $query)
        if ($path -like "git/trees/*") { return [pscustomobject]@{ truncated = $false; tree = @($script:entry) } }
        if ($path -eq ("git/blobs/" + $script:entry.sha)) { return $script:blob }
        throw "Unexpected request"
    }
    Invoke-FeedbackReceiver -Apply -ArchiveOnly
    $saved = Get-LocalPath $script:entry
    Assert-True ([IO.File]::Exists($saved)) "Archive missing."
    Assert-True ((Get-BlobSha ([IO.File]::ReadAllBytes($saved))) -eq $script:entry.sha) "Archive bytes changed."
    Assert-True (@($script:requests | Where-Object Method -eq "DELETE").Count -eq 0) "Archive-only performed deletion."
    Pass "Archive-only preserves exact bytes without deletion"

    New-TestCase "normal"
    $script:handler = {
        param($method, $path, $query)
        if ($path -like "git/trees/*") { return [pscustomobject]@{ truncated = $false; tree = @($script:entry) } }
        if ($path -like "git/blobs/*") { return $script:blob }
        if ($path -like "contents/*") {
            if ($method -eq "GET") { return [pscustomobject]@{ path = $script:entry.path; sha = $script:entry.sha; type = "file" } }
            Assert-True ($query.sha -eq $script:entry.sha) "Normal deletion omitted SHA."
            return @{ ok = $true }
        }
        throw "Unexpected request"
    }
    Invoke-FeedbackReceiver -Apply
    Assert-True (@($script:requests | Where-Object Method -eq "DELETE").Count -eq 1) "Normal run did not delete once."
    $normalSaved = Get-LocalPath $script:entry
    Assert-True ([IO.File]::Exists($normalSaved)) "Normal archive missing."
    [void](Save-Feedback $script:entry)
    Assert-True ([IO.File]::ReadAllBytes($normalSaved).Length -eq $script:bytes.Length) "Repeated archive changed bytes."
    Pass "Normal archive/delete and repeated archive are idempotent"

    New-TestCase "changed-remote"
    $script:handler = {
        param($method, $path, $query)
        if ($path -like "git/blobs/*") { return $script:blob }
        return [pscustomobject]@{ path = $script:entry.path; sha = ("b" * 40); type = "file" }
    }
    [void](Save-Feedback $script:entry)
    Assert-Throws { Remove-Feedback $script:entry } "Remote feedback changed"
    Assert-True (@($script:requests | Where-Object Method -eq "DELETE").Count -eq 0) "Deleted concurrently changed feedback."
    Pass "Changed remote file blocks deletion"

    New-TestCase "corrupt-blob"
    $script:handler = { param($method, $path, $query) [pscustomobject]@{ sha = $script:entry.sha; encoding = "base64"; content = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('{"message":"changed"}')) } }
    Assert-Throws { Save-Feedback $script:entry } "hash or size verification"
    Assert-True (-not [IO.File]::Exists((Get-LocalPath $script:entry))) "Corrupt blob was archived."
    Pass "Corrupt blob rejected"

    New-TestCase "invalid-json"
    $badBytes = [Text.Encoding]::UTF8.GetBytes("not json")
    $badEntry = [pscustomobject]@{ path = $script:entry.path; sha = (Get-BlobSha $badBytes); size = $badBytes.Length; type = "blob" }
    $script:handler = { param($method, $path, $query) [pscustomobject]@{ sha = $badEntry.sha; encoding = "base64"; content = [Convert]::ToBase64String($badBytes) } }
    Assert-Throws { Save-Feedback $badEntry } "valid UTF-8 JSON"
    Assert-True (-not [IO.File]::Exists((Get-LocalPath $badEntry))) "Invalid JSON was archived."
    Pass "Invalid JSON rejected"

    New-TestCase "local-conflict"
    $target = Get-LocalPath $script:entry
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))
    [IO.File]::WriteAllText($target, "existing data")
    Assert-Throws { Save-Feedback $script:entry } "hash or size verification"
    Assert-True ([IO.File]::ReadAllText($target) -eq "existing data") "Existing file overwritten."
    Assert-True ($script:requests.Count -eq 0) "Requested remote data before resolving conflict."
    Pass "Local conflict is retained"

    New-TestCase "local-modified"
    $script:handler = { param($method, $path, $query) $script:blob }
    $target = Save-Feedback $script:entry
    [IO.File]::WriteAllText($target, "changed after save")
    $script:requests = @()
    Assert-Throws { Remove-Feedback $script:entry } "hash or size verification"
    Assert-True ($script:requests.Count -eq 0) "Deleted after local copy changed."
    Pass "Local read-back check blocks unsafe deletion"

    New-TestCase "delete-failed"
    $script:handler = {
        param($method, $path, $query)
        if ($path -like "git/blobs/*") { return $script:blob }
        if ($method -eq "GET") { return [pscustomobject]@{ path = $script:entry.path; sha = $script:entry.sha; type = "file" } }
        throw "offline delete failed"
    }
    [void](Save-Feedback $script:entry)
    Assert-Throws { Remove-Feedback $script:entry } "offline delete failed"
    Assert-True ([IO.File]::Exists((Get-LocalPath $script:entry))) "Archive disappeared after delete failure."
    Pass "Delete failure retains local archive"

    New-TestCase "download-failed"
    $script:handler = { param($method, $path, $query) throw "offline download failed" }
    Assert-Throws { Save-Feedback $script:entry } "offline download failed"
    Assert-True (-not [IO.File]::Exists((Get-LocalPath $script:entry))) "Failed download left final archive."
    Pass "Download failure leaves no final archive"

    New-TestCase "delete-precondition"
    $script:handler = {
        param($method, $path, $query)
        if ($path -like "git/blobs/*") { return $script:blob }
        if ($method -eq "GET") { return [pscustomobject]@{ path = $script:entry.path; sha = $script:entry.sha; type = "file" } }
        Assert-True ($query.sha -eq $script:entry.sha -and $query.branch -eq "master") "Missing deletion precondition."
        Assert-True ([IO.File]::Exists((Get-LocalPath $script:entry))) "Deleted before archive existed."
        return @{ ok = $true }
    }
    [void](Save-Feedback $script:entry)
    Remove-Feedback $script:entry
    Assert-True (@($script:requests | Where-Object Method -eq "DELETE").Count -eq 1) "Expected one conditional deletion."
    Pass "Delete carries verified snapshot SHA and branch"

    New-TestCase "empty"
    $script:handler = { param($method, $path, $query) [pscustomobject]@{ truncated = $false; tree = @() } }
    Invoke-FeedbackReceiver -Apply
    $run = [IO.File]::ReadAllText((Join-Path $script:ArchiveRoot "receiver-runs.jsonl")) | ConvertFrom-Json
    Assert-True ($run.status -eq "success" -and $run.found -eq 0) "Empty tree was not successful."
    Pass "Empty tree succeeds with a summary log"

    New-TestCase "locked"
    [void][IO.Directory]::CreateDirectory($script:ArchiveRoot)
    $held = [IO.File]::Open((Join-Path $script:ArchiveRoot ".lock"), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try { Assert-Throws { Invoke-FeedbackReceiver -Apply } ".+" } finally { $held.Dispose() }
    Assert-True ($script:requests.Count -eq 0) "Concurrent run reached transport."
    Pass "Concurrent run blocked before transport"

    Write-Host "$script:passes offline feedback receiver checks passed."
} finally {
    $resolvedTestRoot = [IO.Path]::GetFullPath($script:testRoot)
    $tempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar + "paia-feedback-tests-"
    if ($resolvedTestRoot.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase)) { [IO.Directory]::Delete($resolvedTestRoot, $true) }
}
