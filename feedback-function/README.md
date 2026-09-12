# 阿里云函数计算反馈中转（境内入口）

当前 PAIA 的反馈链路是：手机 -> Cloudflare Worker -> Gitee。中国大陆网络可能无法稳定访问 `workers.dev`，所以手机能读取 Gitee 上的配置，却在提交反馈时超时。本目录提供一个同等功能的阿里云函数计算（FC）Node.js 模板，部署在中国大陆地域后可以作为境内 HTTPS 入口。

## 部署前提

- 一个阿里云账号和已开通的函数计算服务。
- 选择中国大陆地域（例如杭州、上海或北京），以控制台实际可选地域为准。
- Gitee 私有仓库 `Houton_Bosta/paia-feedback` 的个人访问令牌。令牌只保存到函数计算的环境变量 `GITEE_TOKEN`，不要写入本目录、Gitee 网站仓库或 APK。

## 控制台部署

1. 打开阿里云函数计算控制台，创建服务，例如 `paia-feedback`。服务不需要绑定公网 IP。
2. 创建函数，运行时选择 Node.js 18（或更高的 Node.js 运行时），请求处理程序填写 `index.handler`。
3. 将本目录中的 `index.js` 和 `package.json` 打包上传。模板只用 Node.js 内置模块，不需要安装依赖。
4. 在“环境变量”中填写：

   - `GITEE_OWNER` = `Houton_Bosta`
   - `GITEE_FEEDBACK_REPO` = `paia-feedback`
   - `GITEE_BRANCH` = `master`
   - `GITEE_TOKEN` = 你的 Gitee 令牌（只在控制台填写）

5. 创建 HTTP 触发器，认证方式选择“匿名”（否则手机无法直接提交），允许 `GET`、`POST`、`OPTIONS`，路径按控制台给出的触发器规则配置。不要把管理 API 令牌放到 URL 或响应中。
6. 在函数控制台先访问触发器 URL 的 `/health`。返回 `{"ok":true}` 后，再用下面的示例发送一条测试反馈。

上传前可在本目录运行 `npm test`。这只验证请求解析、健康检查和大小限制，不会访问 Gitee，也不能替代部署后的真机网络测试。

```powershell
$url = 'https://你的函数触发器域名/v1/feedback'
$body = @{ requestId = 'manual-test-001'; message = 'PAIA relay smoke test'; versionName = 'local'; versionCode = 0; language = 'zh' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri $url -ContentType 'application/json' -Body $body
```

确认私有仓库出现 `feedback/YYYY-MM-DD/manual-test-001.json` 后，再把真实入口加入 `E:\Personal_AI_Assistant\PAIA\website\app-config.json`。为兼容旧版本，保留旧字段，同时把境内入口放在数组第一项：

```json
{
  "feedbackApiUrl": "https://你的函数触发器域名/v1/feedback",
  "feedbackApiUrls": [
    "https://你的函数触发器域名/v1/feedback",
    "https://paia-feedback.572550696.workers.dev/v1/feedback"
  ]
}
```

提交网站配置后，包含多入口逻辑的新构建会按数组顺序尝试入口；连接超时或 5xx 时自动切换到下一入口，并沿用同一个请求编号。已经发布且只读取 `feedbackApiUrl` 的 APK 不会使用该数组，所以旧字段的键必须保留、值也应改为已验证的境内入口。

## 网络与安全边界

- “部署在境内地域”只能提高中国大陆网络的可达性，仍需用 Mate 60 的移动数据和 Wi-Fi 在关闭 VPN 时分别测试；不同运营商、地区和阿里云域名策略可能有差异。
- FC 匿名触发器只暴露反馈写入接口，不暴露 Gitee 令牌。函数对消息大小、JSON 格式和请求编号做校验，并对重复请求返回同一个引用。
- 如需更稳定的固定域名，可在函数计算控制台绑定备案域名；这不是本模板的必要条件。
- 本地接收器仍从 Gitee 私有仓库读取反馈，部署中转服务不会改变接收器的使用方式。
- 匿名入口可能被滥用。正式扩大测试范围前，应在阿里云侧设置费用告警、并发上限和访问日志；不要依赖 APK 内置密钥作为防滥用措施。
