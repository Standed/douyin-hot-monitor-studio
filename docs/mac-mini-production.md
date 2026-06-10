# Mac mini Production

`douyin.aizao.ai` 当前由 Cloudflare Tunnel 转发到 Mac mini 本机 `127.0.0.1:5174`。

## Production Shape

不要长期用 Vite dev server 承接同事访问。Mac mini 正式运行方式是：

```text
launchd company.douyin-hot-monitor-studio
  -> scripts/start-macmini-production.sh
  -> node douyin-monitor-ui/server.mjs                 # Express API, 127.0.0.1:8787
  -> node scripts/serve-ui-with-api-proxy.mjs          # static dist + /api proxy, 127.0.0.1:5174
```

Cloudflare Tunnel 只需要继续指向：

```text
douyin.aizao.ai -> http://127.0.0.1:5174
```

## Deploy

```bash
cd /Users/xys/work/company/douyin-hot-monitor-studio
./scripts/deploy-macmini-production.sh
```

该脚本会：

- 跑 `npm run lint`
- 跑 `npm run build`
- 安装 `ops/launchd/company.douyin-hot-monitor-studio.plist`
- 重启 `company.douyin-hot-monitor-studio`
- 检查 `/` 和 `/api/dashboard`

如果旧的开发服务还在占用 5174，先停掉：

```bash
launchctl bootout gui/$(id -u) /Users/xys/Library/LaunchAgents/company.douyin-hot-monitor-studio.dev.plist 2>/dev/null || true
launchctl remove company.douyin-hot-monitor-studio.dev 2>/dev/null || true
```

## Verify

```bash
node scripts/check-macmini-production.mjs
curl -fsSIL http://127.0.0.1:5174/ | sed -n '1,20p'
curl -fsS http://127.0.0.1:5174/api/dashboard | python3 -m json.tool
curl -fsSIL https://douyin.aizao.ai/ | sed -n '1,20p'
launchctl list | grep 'company.douyin'
```

公网未登录时看到 Cloudflare Access 302 是正常状态。

检查口径：

- `company.douyin-hot-monitor-studio` 必须运行。
- `company.douyin-parser` 必须运行。
- `company.douyin-hot-monitor-studio.dev` 不应运行。
- `http://127.0.0.1:5174/` 返回 200。
- `http://127.0.0.1:5174/api/dashboard` 返回 200。
- `http://127.0.0.1:8091/openapi.json` 返回 200。
- `https://douyin.aizao.ai/` 未登录时应跳转 Cloudflare Access。

这个项目目前不需要 Supabase 才能给同事使用。短期结果可以保存在 Mac mini 本地输出或飞书 Base；只有需要多人长期查询、审计、跨系统联动时，再评估 Supabase 作为团队数据层。

## Logs

```text
/Users/xys/logs/douyin-hot-monitor-studio/production.out.log
/Users/xys/logs/douyin-hot-monitor-studio/production.err.log
```

Parser 仍由独立服务管理：

```text
company.douyin-parser -> http://127.0.0.1:8091/openapi.json
```
