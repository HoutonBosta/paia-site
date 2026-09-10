# PAIA 发布网站

这是一个不依赖服务器的纯静态官网。GitHub Pages 用于托管官网和海外镜像，APK 继续通过 Gitee Release 为国内用户提供下载。

## GitHub Pages

GitHub 仓库：`https://github.com/HoutonBosta/paia-site`

官网地址：`https://houtonbosta.github.io/paia-site/`

网站从 `main` 分支根目录发布。仓库的 `Settings -> Pages` 应设置为 `Deploy from a branch`、`main`、`/(root)`。

## Gitee 国内镜像

建议在 Gitee 新建一个公开、空的仓库，名称使用 `paia-site`。不要在网页端预先勾选初始化 README，这样可以直接推送本目录。

在 PowerShell 中执行：

```powershell
$sitePath = 'E:\Personal_AI_Assistant\PAIA\website'
Set-Location $sitePath
git init
git branch -M main
git add .
git commit -m '建立 PAIA 发布网站'
git remote add origin 'https://gitee.com/Houton_Bosta/paia-site.git'
git push -u origin main
```

执行 `git push` 时，Gitee 会要求在本机完成登录。不要把密码或个人令牌粘贴到聊天窗口。若 Gitee 提示 HTTPS 密码不可用，请在 Gitee 的个人设置中创建访问令牌，并只在自己的终端密码提示处使用。

如果已经执行过一次 `git init`，后续更新只需要：

```powershell
Set-Location 'E:\Personal_AI_Assistant\PAIA\website'
git add .
git commit -m '更新发布页面'
git push
```

## 打开 Pages

推送完成后，进入 Gitee 仓库的 Pages（有些界面会放在“服务”或“仓库服务”下），选择 `main` 分支和仓库根目录发布。Gitee 会显示实际的网站地址；不同账号和平台政策下入口名称可能变化，以控制台显示为准。

## 发布 APK

1. 使用正式签名密钥构建 release APK。不要把 debug APK 当作长期公开版本。
2. 在 Gitee 仓库创建 Release，标签建议使用 `v1.4` 这样的语义化版本，并上传 APK 附件。
3. 把 Release 附件的直接下载地址、Release 页面地址、文件大小和 SHA-256 写入 `release.json` 的 `apkUrl`、`releasePageUrl`、`apkSize` 和 `sha256`。
4. 计算 SHA-256 的 PowerShell 示例：

```powershell
(Get-FileHash 'E:\path\to\PAIA-1.4.apk' -Algorithm SHA256).Hash.ToLower()
```

5. 再次提交并推送 `release.json`。网页会自动启用下载按钮。

APK 不放进 Git 提交历史；它应作为 Release 附件发布。当前 Gitee 帮助文档说明单个 Release 附件不能超过 100 MB，仍应以发布页面的最新限制为准。

## 国内访问测试

发布后用 Mate 60 和 MatePad 11 在关闭 VPN 的情况下测试：

- Wi-Fi 打开 Pages 首页；
- 移动数据打开 Pages 首页；
- 点击 APK 下载并等待系统安装器；
- 检查 Release 页面和 SHA-256 文本是否可访问。

GitHub Pages 是官网托管入口，但不要让 GitHub 成为中国大陆用户唯一的 APK 下载入口。
