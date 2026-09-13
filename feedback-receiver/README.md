# PAIA 本地反馈接收器

接收器从 Gitee 私有反馈仓库读取 `feedback/` 下的 JSON 文件，先保存到当前 Windows 用户的本地归档目录；只有本地文件通过校验后，才删除远端对应文件。网络、校验或写入失败时，远端文件会保留，下一次运行可重试。

## 配置令牌

在 PowerShell 中运行：

```powershell
.\Set-FeedbackReceiverSecret.ps1
```

按提示输入对反馈仓库具有读写权限的 Gitee 访问令牌。脚本使用 Windows DPAPI 加密，令牌只对保存它的 Windows 用户可解密，不会写入脚本或 Git。已有 Git Credential Manager 凭据时，也可使用：

```powershell
.\Set-FeedbackReceiverSecret.ps1 -FromGitCredentialManager
```

仓库所有者、仓库名和分支在 `Receive-Feedback.ps1` 中配置；部署到其他仓库前应同步修改并进行代码审查。

## 运行模式

预览待处理文件，不修改远端：

```powershell
.\Receive-Feedback.ps1
```

归档并删除已验证的远端文件：

```powershell
.\Receive-Feedback.ps1 -Apply
```

只归档、不删除远端文件：

```powershell
.\Receive-Feedback.ps1 -Apply -ArchiveOnly
```

默认归档位置为 `%LOCALAPPDATA%\PAIA\feedback-receiver\archive`，按日期保存文件，并在同一目录写入 `receiver-runs.jsonl` 运行摘要。可通过 `-ArchiveRoot` 指定其他目录。

接收器会校验路径格式、Blob SHA、UTF-8 JSON、反馈消息和文件大小，并拒绝符号链接或目录穿越路径。删除前还会重新读取远端 SHA，避免覆盖并发更新。

## 计划任务

使用当前 Windows 用户注册每周日任务（默认 03:00）：

```powershell
.\Register-FeedbackReceiverTask.ps1
```

可用 `-Hour` 和 `-Minute` 指定时间。任务必须由保存令牌的同一用户运行，并要求该用户能够访问网络和本地归档目录。首次启用自动删除前，建议先运行 `-Apply -ArchiveOnly` 检查归档结果。

## 安全说明

- 令牌文件和归档目录可能包含敏感反馈及设备诊断信息，只应保存在受控计算机上。
- 不要将令牌、归档文件或运行日志提交到代码仓库或发送到公开渠道。
- 删除远端文件不会自动清除 Git 历史对象；历史清理属于单独的仓库维护操作，接收器不会执行。
- 令牌疑似泄露时，应立即在 Gitee 撤销并重新运行 `Set-FeedbackReceiverSecret.ps1 -Force`。

接收器只负责从 Gitee 归档反馈，不负责 Android 应用到 API 入口的网络传输。入口部署请参见 [feedback-function](../feedback-function/README.md)；备用 Worker 请参见 [feedback-worker](../feedback-worker/README.md)。
