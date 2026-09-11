[CmdletBinding()]
param(
    [switch]$Apply,
    [string]$ArchiveRoot = (Join-Path $PSScriptRoot "archive")
)

$ErrorActionPreference = "Stop"

$Owner = "Houton_Bosta"
$Repository = "paia-feedback"
$Branch = "master"
$ApiRoot = "https://gitee.com/api/v5/repos/$Owner/$Repository"
$TokenPath = Join-Path $PSScriptRoot "config\gitee-token.dpapi"

function Get-AccessToken {
    if (-not (Test-Path -LiteralPath $TokenPath -PathType Leaf)) {
        throw "未找到 Gitee 令牌。请先运行 Set-FeedbackReceiverSecret.ps1。"
    }

    $encrypted = (Get-Content -LiteralPath $TokenPath -Raw).Trim()
    if ([string]::IsNullOrWhiteSpace($encrypted)) {
        throw "Gitee 令牌文件为空，请重新运行 Set-FeedbackReceiverSecret.ps1。"
    }

    try {
        $secure = ConvertTo-SecureString -String $encrypted
        return [System.Net.NetworkCredential]::new("", $secure).Password
    } catch {
        throw "无法解密 Gitee 令牌。请使用保存令牌的同一个 Windows 用户运行此脚本。"
    }
}

function Invoke-GiteeRequest {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("GET", "DELETE")][string]$Method,
        [Parameter(Mandatory = $true)][string]$Path,
        [hashtable]$Body
    )

    $token = Get-AccessToken
    $separator = if ($Path.Contains("?")) { "&" } else { "?" }
    $uri = "$ApiRoot/$Path$separator" + "access_token=" + [uri]::EscapeDataString($token)

    try {
        if ($Method -eq "DELETE") {
            return Invoke-RestMethod -Method Delete -Uri $uri -Body $Body -ContentType "application/x-www-form-urlencoded" -Headers @{ Accept = "application/json" }
        }
        return Invoke-RestMethod -Method Get -Uri $uri -Headers @{ Accept = "application/json" }
    } catch {
        throw "Gitee 请求失败（$Method $Path）：$($_.Exception.Message)"
    }
}

function Get-RemoteEntries {
    param([string]$Path)

    $page = 1
    $all = @()
    do {
        $queryPath = "$Path?ref=$Branch&per_page=100&page=$page"
        $response = @(Invoke-GiteeRequest -Method GET -Path $queryPath)
        $all += $response
        $page++
    } while ($response.Count -eq 100)
    return $all
}

function Get-FeedbackFiles {
    param([string]$Path)

    foreach ($entry in Get-RemoteEntries -Path $Path) {
        if ($entry.type -eq "dir") {
            Get-FeedbackFiles -Path $entry.path
        } elseif ($entry.type -eq "file" -and $entry.path -like "feedback/*") {
            $entry
        }
    }
}

function Get-SafeLocalPath {
    param([string]$RemotePath)

    if (-not $RemotePath.StartsWith("feedback/")) {
        throw "拒绝处理反馈目录之外的路径：$RemotePath"
    }

    $relative = $RemotePath.Substring("feedback/".Length)
    $segments = $relative -split "/"
    if ($segments.Count -lt 2 -or ($segments | Where-Object { $_ -eq ".." -or $_ -eq "." -or [string]::IsNullOrWhiteSpace($_) })) {
        throw "拒绝处理不安全的反馈路径：$RemotePath"
    }

    $candidate = [System.IO.Path]::GetFullPath((Join-Path $ArchiveRoot ($relative -replace "/", "\")))
    $root = [System.IO.Path]::GetFullPath($ArchiveRoot).TrimEnd("\") + "\"
    if (-not $candidate.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "反馈路径越过本地归档目录：$RemotePath"
    }
    return $candidate
}

function Save-RemoteFeedback {
    param([object]$Entry)

    $target = Get-SafeLocalPath -RemotePath $Entry.path
    $parent = Split-Path -Parent $target
    New-Item -ItemType Directory -Path $parent -Force | Out-Null

    $file = Invoke-GiteeRequest -Method GET -Path "$($Entry.path)?ref=$Branch"
    if ($file.encoding -ne "base64" -or [string]::IsNullOrWhiteSpace($file.content)) {
        throw "Gitee 返回的反馈文件不是预期的 base64 内容：$($Entry.path)"
    }

    $bytes = [Convert]::FromBase64String(($file.content -replace "\s", ""))
    $temporary = "$target.$([guid]::NewGuid().ToString('N')).tmp"
    [System.IO.File]::WriteAllBytes($temporary, $bytes)
    Move-Item -LiteralPath $temporary -Destination $target -Force
    return $target
}

function Remove-RemoteFeedback {
    param([object]$Entry)

    $body = @{
        sha = [string]$Entry.sha
        branch = $Branch
        message = "Archive PAIA feedback $($Entry.name)"
    }
    Invoke-GiteeRequest -Method DELETE -Path $Entry.path -Body $body | Out-Null
}

if (-not $Apply) {
    Write-Host "预览模式：不会下载或删除 Gitee 文件。需要实际处理时请加 -Apply。"
}

$entries = @(Get-FeedbackFiles -Path "feedback")
if ($entries.Count -eq 0) {
    Write-Host "Gitee 中没有待处理的反馈。"
    exit 0
}

Write-Host "发现 $($entries.Count) 个反馈文件。"
$failed = 0
foreach ($entry in $entries) {
    if (-not $Apply) {
        Write-Host "待处理：$($entry.path)"
        continue
    }

    try {
        $saved = Save-RemoteFeedback -Entry $entry
        Remove-RemoteFeedback -Entry $entry
        Write-Host "已归档并删除：$($entry.path) -> $saved"
    } catch {
        $failed++
        Write-Warning $_.Exception.Message
    }
}

if ($failed -gt 0) {
    throw "$failed 个反馈处理失败。失败文件仍保留在 Gitee，下次运行会重试。"
}

if ($Apply) {
    Write-Host "本次反馈归档完成。"
}
