[CmdletBinding()]
param(
    [switch]$Force,
    [switch]$FromGitCredentialManager
)

$ErrorActionPreference = "Stop"
$tokenPath = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "PAIA\feedback-receiver\gitee-token.dpapi"

if ((Test-Path -LiteralPath $tokenPath) -and -not $Force) {
    throw "令牌已存在。如需替换，请加 -Force。"
}

$parent = Split-Path -Parent $tokenPath
New-Item -ItemType Directory -Path $parent -Force | Out-Null
if ($FromGitCredentialManager) {
    $oldPrompt = $env:GIT_TERMINAL_PROMPT
    $oldInteractive = $env:GCM_INTERACTIVE
    try {
        $env:GIT_TERMINAL_PROMPT = "0"
        $env:GCM_INTERACTIVE = "Never"
        $request = "protocol=https" + [char]10 + "host=gitee.com" + [char]10 + [char]10
        $response = $request | git credential fill 2>$null
        if ($LASTEXITCODE -ne 0) { throw "未找到已保存的 Gitee 凭据。" }
        $values = @{}
        foreach ($line in $response) {
            $pair = $line -split "=", 2
            if ($pair.Count -eq 2) { $values[$pair[0]] = $pair[1] }
        }
        if ([string]::IsNullOrWhiteSpace($values["password"])) { throw "已保存的 Gitee 凭据中没有令牌。" }
        $secure = ConvertTo-SecureString -String $values["password"] -AsPlainText -Force
    } finally {
        $response = $null
        if ($values) { $values.Clear() }
        $env:GIT_TERMINAL_PROMPT = $oldPrompt
        $env:GCM_INTERACTIVE = $oldInteractive
    }
} else {
    $secure = Read-Host "请输入 Gitee 访问令牌（输入时不会显示）" -AsSecureString
}
$encrypted = ConvertFrom-SecureString -SecureString $secure
[System.IO.File]::WriteAllText($tokenPath, $encrypted, [System.Text.UTF8Encoding]::new($false))
Write-Host "令牌已使用当前 Windows 用户加密保存：$tokenPath"
