[CmdletBinding()]
param(
    [string]$TaskName = "PAIA 每周接收反馈",
    [ValidateRange(0, 23)][int]$Hour = 3,
    [ValidateRange(0, 59)][int]$Minute = 0
)

$ErrorActionPreference = "Stop"
$receiver = Join-Path $PSScriptRoot "Receive-Feedback.ps1"
if (-not (Test-Path -LiteralPath $receiver -PathType Leaf)) {
    throw "找不到接收器脚本：$receiver"
}

$argument = '-NoProfile -ExecutionPolicy Bypass -File "' + $receiver + '" -Apply'
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argument
$triggerTime = [datetime]::Today.AddHours($Hour).AddMinutes($Minute)
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At $triggerTime
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "每周归档 PAIA 用户反馈到本机并清理已归档的 Gitee 文件。" -Force | Out-Null

Write-Host "已注册每周任务：$TaskName（每周日 $($Hour.ToString('00')):$($Minute.ToString('00'))）"
Write-Host "任务使用当前 Windows 用户运行；请确保该用户已经运行 Set-FeedbackReceiverSecret.ps1。"
