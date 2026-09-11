[CmdletBinding()]
param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$tokenPath = Join-Path $PSScriptRoot "config\gitee-token.dpapi"

if ((Test-Path -LiteralPath $tokenPath) -and -not $Force) {
    throw "令牌已存在。如需替换，请加 -Force。"
}

$parent = Split-Path -Parent $tokenPath
New-Item -ItemType Directory -Path $parent -Force | Out-Null
$secure = Read-Host "请输入 Gitee 访问令牌（输入时不会显示）" -AsSecureString
$encrypted = ConvertFrom-SecureString -SecureString $secure
[System.IO.File]::WriteAllText($tokenPath, $encrypted, [System.Text.UTF8Encoding]::new($false))
Write-Host "令牌已使用当前 Windows 用户加密保存：$tokenPath"
