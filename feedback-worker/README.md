# Cloudflare Worker 备用反馈入口

本目录提供与阿里云函数计算入口兼容的 Cloudflare Worker。当默认 FC 入口暂时不可用，或需要境外网络入口时，可将 Worker 作为备用地址。

```text
Android 应用 -> Cloudflare Worker（备用） -> Gitee Contents API -> feedback/YYYY-MM-DD/<requestId>.json
```

## 配置与部署

1. 安装 Wrangler，并在本目录执行部署命令：

   ```powershell
   npx wrangler deploy
   ```

2. 在 `wrangler.toml` 或 Cloudflare 控制台配置非敏感变量：

   | 变量 | 说明 |
   | --- | --- |
   | `GITEE_OWNER` | Gitee 仓库所属组织或用户 |
   | `GITEE_FEEDBACK_REPO` | 私有反馈仓库名 |
   | `GITEE_BRANCH` | 目标分支，模板默认为 `master` |

3. 使用 Wrangler Secret 保存令牌：

   ```powershell
   npx wrangler secret put GITEE_TOKEN
   ```

令牌只能作为 Worker Secret 保存，不得写入 `wrangler.toml`、站点配置、日志或 APK。

## API

Worker 提供与 FC 相同的接口：

- `GET /health`：返回 `{"ok":true}`。
- `POST /v1/feedback`：接收 JSON 反馈并写入 Gitee。
- `OPTIONS`：CORS 预检。

请求体最大 16 KiB，`message` 最大 8,000 个字符。 `requestId` 用于幂等重试，成功响应返回 Gitee 文件引用。部署后先检查 `<worker-url>/health`，再从客户端提交一条不含敏感信息的测试反馈。

## 客户端配置

将 Worker URL 放在 `app-config.json` 的 `feedbackApiUrls` 备用位置。默认 FC 地址应保持在首位；`feedbackApiUrl` 继续填写默认地址以兼容旧版本客户端：

```json
{
  "feedbackApiUrl": "https://<fc-host>/v1/feedback",
  "feedbackApiUrls": [
    "https://<fc-host>/v1/feedback",
    "https://<worker-host>/v1/feedback"
  ]
}
```

新版本客户端会在连接超时或服务端错误时按数组顺序切换入口，并沿用同一个请求编号。发布配置前确认两个入口都使用同一 Gitee 仓库、分支和令牌权限。

## 安全与限制

- Worker 只负责写入指定的 Gitee 私有仓库，不暴露仓库读取或管理接口。
- `GITEE_TOKEN` 使用 Cloudflare Secret 管理并定期轮换；不要把令牌作为 URL 参数。
- 匿名反馈入口应设置 Cloudflare 的请求日志保留策略、速率限制和费用告警（按账户能力配置）。
- Worker 是备用链路；默认境内入口及其运维策略以 [feedback-function](../feedback-function/README.md) 为准。
