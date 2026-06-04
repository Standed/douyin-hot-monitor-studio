# Douyin Hot Monitor Studio Agent Rules

这个仓库要作为 `Standed/douyin-hot-monitor-studio` 的完整可拉取项目维护。目标用户是公司内部运营同事和需要本地部署的团队，不是只给开发者看的 demo。

## 项目边界

```text
douyin-monitor/        Python 监控 CLI：低粉爆款、对标账号、下载、转写、报告
douyin-monitor-ui/     React 前端 + Express 控制 API
docker-compose.yml     本项目一键启动入口
README.md              用户安装、配置、费用和私有化说明
```

`Douyin_TikTok_Download_API` 兼容容器是本项目 Compose 启动链路里的内置解析服务能力；旁边完整的 `../Douyin_TikTok_Download_API` 只作为 Cookie、代理和高级部署管理入口。本项目不要把它的代码复制进来；只通过 `LOCAL_API_BASE` 连接兼容接口。

## 配置原则

- 页面只暴露用户必须配置或必须决策的内容。
- 不要把默认可工作的参数堆在主表单里；模型、设备、compute type、prompt、脚本目录等放到高级设置。
- 低粉爆款搜索需要 `TIKHUB_API_KEY`。
- 云端转写需要 `LEMONFOX_API_KEY`。
- 本地转写优先推荐 `faster-whisper`，已有 Whisper 环境时再用 `openai-whisper`。
- 对标账号监控、下载、本地转写依赖本地解析服务，默认 `http://127.0.0.1:8091`。

## 费用口径

- TikHub：官方 pricing 显示有免费请求额度，正式使用按请求或套餐计费。不要写成永久免费。
- Lemonfox：官方首页显示有免费试用，正式转写按月/积分计费。不要写成免费。
- 内置解析服务：接口框架开源免费，但私有化部署有服务器、代理、Cookie、风控和维护成本。
- faster-whisper / openai-whisper：开源本地方案，不按 API 次数付费，但会消耗本机算力和模型存储。

价格会变化，README 和页面只写稳定口径，具体价格让用户以官网和账单为准。

## UI 维护

- 左侧目录必须能进入对应页面，不要把低粉爆款和对标账号的运行入口混在同一个主页面里。
- 低粉爆款和对标账号的最新结果要按报告前缀隔离：`lowfan_` 与 `account_new`。
- 保留浅色/夜间主题切换，并用实际 DOM 状态切换，不做假按钮。
- Tooltip 用于解释付费、用途和部署成本；不要在卡片里重复堆同一段说明。
- 运营页面要保持信息密度和可扫读性，不做营销 landing page。

## 验证

改动后至少运行：

```bash
cd douyin-monitor-ui
npm run build
```

涉及 UI 时还要打开本地页面检查：

```text
http://127.0.0.1:4175/
http://127.0.0.1:5174/
```

优先用已有预览服务；必要时再重启 `npm run dev` 或 `npm run preview`。

## 安全

不要提交：

- `.env.local`
- `douyin-monitor/config.json`
- TikHub / Lemonfox Token
- 抖音 `sessionid`
- 下载视频、转写文本、运行报告和日志
