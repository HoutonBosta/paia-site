# PAIA 本地反馈接收器

这个接收器每次运行会从私有 Gitee 仓库读取 feedback/ 下的 JSON 文件，保存到电脑上的 archive/ 目录。只有本地保存成功后，才会删除对应的 Gitee 文件；网络或写入失败时，远程文件会保留，下一次运行会重试。

## 第一次配置

在 PowerShell 中进入这个目录：

    Set-Location 'E:\Personal_AI_Assistant\PAIA\website\feedback-receiver'

用当前 Windows 用户保存 Gitee 令牌。令牌不会写进脚本，也不会提交到 Git：

    .\Set-FeedbackReceiverSecret.ps1

按提示粘贴一个对私有仓库 Houton_Bosta/paia-feedback 有读写权限的 Gitee 令牌。令牌会写入 Windows 本地应用数据目录，只有同一个 Windows 用户能够解密。若这台电脑已用 Git Credential Manager 保存 Gitee 令牌，也可以运行：

    .\Set-FeedbackReceiverSecret.ps1 -FromGitCredentialManager

## 手动测试

先用预览模式检查待处理文件，不会修改 Gitee：

    .\Receive-Feedback.ps1

确认无误后执行归档和清理：

    .\Receive-Feedback.ps1 -Apply

归档文件位于 feedback-receiver\archive\日期\请求编号.json。

## 每周自动运行

推荐直接运行下面的命令，建立当前 Windows 用户每周日 03:00 执行的任务：

    .\Register-FeedbackReceiverTask.ps1

也可以指定时间，例如每周日 22:30：

    .\Register-FeedbackReceiverTask.ps1 -Hour 22 -Minute 30

脚本会创建当前用户的 Windows 任务计划，不需要管理员权限。任务运行时会执行 Receive-Feedback.ps1 -Apply。任务必须使用保存令牌的同一个 Windows 用户运行。

如果你希望使用图形界面，也可以在任务计划程序中创建“每周”任务，程序填写 powershell.exe，参数填写：

    -NoProfile -ExecutionPolicy Bypass -File "E:\Personal_AI_Assistant\PAIA\website\feedback-receiver\Receive-Feedback.ps1" -Apply

第一次建议手动运行 -Apply，确认文件能落盘后再启用定时任务。

## 安全说明

- 令牌加密文件位于 %LOCALAPPDATA%\PAIA\feedback-receiver\gitee-token.dpapi，是当前 Windows 用户专属的文件，不要复制到其他电脑。
- 归档目录位于 %LOCALAPPDATA%\PAIA\feedback-receiver\archive，可能包含用户反馈和设备信息，建议只保存在自己的电脑上。
- 如果令牌泄露，请在 Gitee 撤销并重新运行 Set-FeedbackReceiverSecret.ps1 -Force。

## 网络入口限制

这个接收器负责读取已经写入 Gitee 的反馈，不负责手机到中转服务的第一跳。当前 PAIA 仍通过 Cloudflare Worker 接收手机反馈；如果手机所在网络无法访问 workers.dev，反馈不会到达 Gitee，接收器也没有可读取的文件。正式发布前应在 Mate 60 的移动数据和 Wi-Fi 下分别测试入口可达性，必要时给 Worker 绑定可访问的自有域名或迁移到国内云函数。
