# PAIA 发布与反馈服务

PAIA 是一个 Android 应用项目。本目录是发布站点及反馈服务的公开配置和部署说明。

## 发布站点

官网使用 GitHub Pages 托管：

- 仓库：`https://github.com/HoutonBosta/paia-site`
- 地址：`https://houtonbosta.github.io/paia-site/`
- [使用教程](https://houtonbosta.github.io/paia-site/guide.html)：百炼配置、录音协作、资料管理与常见问题。

教程正文位于 `guide.html`，左侧目录按功能分组，支持章节直达链接。经裁剪、隐私遮盖和引导标注的图片保存在 `assets/tutorial/`；包含个人信息的原始截图不得提交到公开仓库。

将 `main` 分支根目录配置为 Pages 发布源。站点只存放公开页面、版本清单和客户端配置，不存放访问令牌、用户反馈或 APK 私钥。

如需提供国内镜像，可将同一站点内容发布到 Gitee Pages。镜像地址以 Gitee 控制台显示为准；发布镜像不改变反馈服务的安全边界。

## 反馈架构

默认链路为：

```text
Android 应用 -> 阿里云函数计算（境内 HTTPS 入口） -> Gitee 私有反馈仓库
```

Cloudflare Worker 保留为备用入口，用于境外或主入口临时不可用时的故障切换。客户端配置中的 `feedbackApiUrls` 按顺序尝试地址；`feedbackApiUrl` 为旧版本客户端保留的单地址字段。两个字段都只能填写 HTTPS URL，不能包含令牌。

部署和配置阿里云入口，参见 [feedback-function/README.md](feedback-function/README.md)；配置备用 Worker，参见 [feedback-worker/README.md](feedback-worker/README.md)。本地归档 Gitee 反馈，参见 [feedback-receiver/README.md](feedback-receiver/README.md)。

## 反馈 API

入口提供以下接口：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/health` | 健康检查，返回 `{"ok":true}` |
| `POST` | `/v1/feedback` | 接收反馈 JSON 并写入 Gitee |
| `OPTIONS` | 任意 | 为 API 客户端提供 CORS 预检响应 |

`POST` 请求至少包含非空的 `message` 字段，可附带 `requestId`、`versionName`、`versionCode`、`language` 及设备诊断字段。请求体最大 16 KiB，消息最大 8,000 个字符。服务返回 Gitee 文件引用；相同 `requestId` 的重试返回原引用，不重复创建文件。

## 发布 APK

1. 使用受保护的签名配置构建 release APK，不要把签名材料或 debug APK 当作正式版本。
2. 将 APK 作为 Gitee Release 附件发布，并记录版本号、文件大小和 SHA-256。
3. 更新根目录 `release.json` 的 `apkUrl`、`releasePageUrl`、`apkSize` 和 `sha256`，再发布站点。
4. 在发布前从干净网络环境检查站点、版本清单、下载链接和校验值。

示例校验命令（在本地终端执行）：

```powershell
(Get-FileHash '.\PAIA-release.apk' -Algorithm SHA256).Hash.ToLower()
```

APK 应作为 Release 附件管理，不应提交到站点 Git 历史。发布平台的附件大小限制以平台最新文档为准。

## 安全边界

- Gitee 反馈仓库必须设为私有；反馈内容可能包含用户意见和设备诊断信息。
- `GITEE_TOKEN` 只配置在阿里云函数或备用 Worker 的密钥管理中，不写入 Git、站点配置、日志或 APK。
- 境内入口使用匿名 HTTPS 触发器是客户端直连所需条件，应在云平台设置费用告警、并发上限和访问日志。
- API 入口只负责写入反馈，不提供 Gitee 仓库浏览、令牌代理或管理接口。
- 归档工具在本地保存反馈后才删除远端文件；归档目录应按敏感数据处理并限制访问。
