# 阿里云函数计算反馈入口

本目录提供 Node.js 18+ 的阿里云函数计算（FC）模板，将 Android 应用提交的反馈写入 Gitee 私有仓库。它是 PAIA 的默认境内入口。

```text
Android 应用 -> FC HTTP 触发器 -> Gitee Contents API -> feedback/YYYY-MM-DD/<requestId>.json
```

## 部署要求

- 阿里云账号及已开通的函数计算服务，选择可用的中国大陆地域。
- 一个用于存储反馈的 Gitee 私有仓库。
- 对该仓库具有写入权限的 Gitee 访问令牌。令牌只放在 FC 环境变量中。

## 控制台配置

1. 创建函数计算服务和函数，运行时选择 Node.js 18 或更高版本，处理程序为 `index.handler`。
2. 上传本目录的 `index.js` 和 `package.json`。模板仅使用 Node.js 内置模块，无需安装依赖。
3. 配置以下环境变量：

   | 变量 | 说明 |
   | --- | --- |
   | `GITEE_OWNER` | Gitee 仓库所属组织或用户（例如 `your-owner`） |
   | `GITEE_FEEDBACK_REPO` | 私有反馈仓库名 |
   | `GITEE_BRANCH` | 目标分支，未设置时默认为 `master` |
   | `GITEE_TOKEN` | Gitee 访问令牌，仅在 FC 密钥配置中填写 |

4. 创建 HTTP 触发器，允许匿名访问，并启用 `GET`、`POST`、`OPTIONS`。手机端使用触发器提供的 HTTPS 地址，不要把令牌放入 URL。
5. 访问 `<trigger-url>/health`，确认返回 `{"ok":true}`。

上传前可运行 `npm test` 进行本地请求解析测试；该测试不访问 Gitee，也不代表云端网络验证完成。

## API

- `GET /health`：健康检查。
- `POST /v1/feedback`：接收 JSON 反馈。
- `OPTIONS`：CORS 预检。

请求示例：

```powershell
$url = 'https://<trigger-host>/v1/feedback'
$body = @{
  requestId = 'example-001'
  message = '反馈内容'
  versionName = '1.0.0'
  versionCode = 1
  language = 'zh'
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri $url -ContentType 'application/json' -Body $body
```

请求体最大 16 KiB，`message` 最大 8,000 个字符。服务会清理请求编号、校验 JSON，并对相同编号的重试保持幂等。成功响应包含 `ok: true` 和 Gitee 文件 `reference`；配置缺失或上游失败时返回通用错误，不泄露令牌或内部响应内容。

## 客户端配置

在站点的 `app-config.json` 中，将已验证的 FC 地址放入 `feedbackApiUrls` 首位，并保留 `feedbackApiUrl` 供旧版本客户端读取：

```json
{
  "feedbackApiUrl": "https://<trigger-host>/v1/feedback",
  "feedbackApiUrls": [
    "https://<trigger-host>/v1/feedback",
    "https://<worker-host>/v1/feedback"
  ]
}
```

数组中的备用地址应指向 [feedback-worker](../feedback-worker/README.md) 部署的 Worker。新版本客户端按顺序尝试入口；旧版本只使用 `feedbackApiUrl`。

## 安全与运维

- 境内部署改善可达性，但仍应从目标网络验证 `/health` 和一次完整反馈提交。
- 匿名触发器可能被滥用；在阿里云设置费用告警、并发限制、访问日志和必要的限流策略。
- 不要依赖 APK 中的固定密钥进行鉴权。令牌轮换应在 Gitee 撤销旧令牌后更新 FC 环境变量。
- FC 只写入指定仓库和分支，不提供反馈读取或仓库管理能力。
