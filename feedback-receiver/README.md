# PAIA 本地反馈接收器

这个接收器每次运行会从私有 Gitee 仓库读取 feedback/ 下的 JSON 文件，保存到电脑上的 archive/ 目录。只有本地保存成功后，才会删除对应的 Gitee 文件；网络或写入失败时，远程文件会保留，下一次运行会重试。

## 第一次配置

在 PowerShell 中进入这个目录：

    Set-Location 'E:\Personal_AI_Assistant\PAIA\website\feedback-receiver'

用当前 Windows 用户保存 Gitee 令牌。令牌不会写进脚本，也不会提交到 Git：

    .\Set-FeedbackReceiverSecret.ps1

按提示粘贴一个对私有仓库 Houton_Bosta/paia-feedback 有读写权限的 Gitee 令牌。令牌会写入 config\gitee-token.dpapi，只有同一个 Windows 用户能够解密。

## 手动测试

先用预览模式检查待处理文件，不会修改 Gitee：

    .\Receive-Feedback.ps1

确认无误后执行归档和清理：

    .\Receive-Feedback.ps1 -Apply

归档文件位于 feedback-receiver\archive\日期\请求编号.json。

## 每周自动运行

打开 Windows“任务计划程序”，选择“创建基本任务”：

1. 名称填写 PAIA 每周接收反馈。
2. 触发器选择“每周”，选择方便的时间，例如周日 03:00。
3. 操作选择“启动程序”。
4. 程序填写 powershell.exe。
5. 参数填写：

    -NoProfile -ExecutionPolicy Bypass -File "E:\Personal_AI_Assistant\PAIA\website\feedback-receiver\Receive-Feedback.ps1" -Apply

6. 完成后打开任务属性，在“常规”中选择“仅当用户登录时运行”，确保使用保存令牌的同一个 Windows 账户。

第一次建议手动运行 -Apply，确认文件能落盘后再启用定时任务。

## 安全说明

- config\gitee-token.dpapi 是当前 Windows 用户专属的加密文件，不要复制到其他电脑。
- archive\ 可能包含用户反馈和设备信息，建议只保存在自己的电脑上。
- 如果令牌泄露，请在 Gitee 撤销并重新运行 Set-FeedbackReceiverSecret.ps1 -Force。
