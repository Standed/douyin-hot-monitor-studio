# Douyin Hot Monitor Studio

面向运营团队的抖音内容监控工作台：低粉爆款搜索、对标账号监控、视频下载、口播转文字、报告归档都放在一个本地页面里。

## 能做什么

- 低粉爆款搜索：按关键词找粉丝不高但互动跑出来的作品。
- 对标账号监控：按 `sec_user_id` 账号池抓取最新作品。
- 内置解析服务：Compose 默认随项目启动 `Douyin_TikTok_Download_API` 兼容容器，用于账号作品、无水印下载和登录态接口。
- 视频与文稿归档：可下载无水印视频，并用 Lemonfox 或本地 Whisper 转写口播。
- 运行报告：每次运行生成 JSON、CSV、Markdown，默认在 `douyin-monitor-output/runs`。
- 飞书结果库：运行结束后可按去重键写入飞书 Base，方便团队分负责人、标处理状态和沉淀复盘。
- 本地配置页：在网页里配置 TikHub、Lemonfox、转写方式和本地解析服务地址。

## 服务边界

```text
douyin-hot-monitor-studio/
  douyin-monitor/        Python 监控 CLI，负责搜索、账号监控、下载、转写、报告
  douyin-monitor-ui/     React 前端 + Express 控制 API
  docker-compose.yml     一键启动 UI/API/监控 CLI/内置抖音解析服务
  AGENTS.md              给 Codex/维护者的项目规则
```

`docker compose up -d --build` 默认会同时启动：

```text
douyin-parser       evil0ctal/douyin_tiktok_download_api，容器内地址 http://douyin-parser
douyin-monitor-ui   React 前端 + Express 控制 API + Python 监控 CLI
```

宿主机打开 `http://127.0.0.1:8091/openapi.json` 可以检查解析服务是否在线。前端容器内部使用 `LOCAL_API_BASE=http://douyin-parser`，本地开发时继续用 `http://127.0.0.1:8091`。

## 是否免费

- TikHub：不是长期无限免费。官方 pricing 页显示有新账号免费请求额度，正式使用按请求或套餐计费。低粉爆款搜索依赖它。
- Lemonfox：不是永久免费。官方首页显示有免费试用，正式语音转文字按月/积分计费。云端批量转写会消耗额度。
- 内置解析服务：本项目会编排 `Douyin_TikTok_Download_API` 兼容容器，能力属于本项目启动链路的一部分；但私有化部署仍有服务器、代理、Cookie、风控和维护成本。
- faster-whisper / openai-whisper：开源本地方案，不按 API 次数付费，但需要本机算力、模型下载空间和视频文件。

具体价格会变，商业使用前以各自官网和后台账单为准。

## 最小配置

### TikHub API Key

低粉爆款搜索走 TikHub，不走内置解析服务。它必须配置 `TIKHUB_API_KEY`，并且当前 CLI/UI 都按完整 `Authorization` 值读取，推荐写成带 `Bearer ` 前缀的形式：

```bash
TIKHUB_API_KEY=Bearer your_tikhub_token
```

不要把 `TIKHUB_API_KEY` 写进 README、截图、运行报告或 GitHub issue。只放在本机 `douyin-monitor-ui/.env.local`、服务器环境变量或部署平台 secret 里。

### Douyin_TikTok_Download_API / 本地解析服务

账号监控、无水印下载、登录态检测和部分作品解析依赖 `Douyin_TikTok_Download_API` 兼容接口。项目默认用 `docker-compose.yml` 启动内置容器：

```text
evil0ctal/douyin_tiktok_download_api:latest -> http://127.0.0.1:8091
```

本项目不会复制或维护完整的 `Douyin_TikTok_Download_API` 源码。需要高级 Cookie、代理、风控或独立部署时，可以在旁边单独运行完整项目，然后把本项目的 `LOCAL_API_BASE` 指向那个服务。

本地开发默认地址：

```bash
LOCAL_API_BASE=http://127.0.0.1:8091
```

Docker Compose 启动时会自动覆盖为容器内地址：

```bash
LOCAL_API_BASE=http://douyin-parser
```

### 转写 API Key

如果要云端口播转写，再配置 Lemonfox：

```bash
LEMONFOX_API_KEY=your_lemonfox_token
TRANSCRIPTION_PROVIDER=lemonfox
```

默认转写使用本地 faster-whisper：

```bash
TRANSCRIPTION_PROVIDER=faster-whisper
# 或 TRANSCRIPTION_PROVIDER=whisper
```

### 反馈入口

左侧“反馈”页会打开公司飞书问卷。涉及截图、图片、异常页面、复现步骤或更完整的需求说明时，统一通过问卷提交，方便后续归档和跟进。问卷地址可以保留默认值；群机器人 webhook 只放在本机 `.env.local`、服务器环境变量或部署 secret 里，不要提交到仓库：

```bash
FEISHU_FEEDBACK_WEBHOOK=
FEISHU_FEEDBACK_FORM_URL=https://xiyangshiai.feishu.cn/share/base/form/shrcn27png3VUckWYkSEuKX3aVc
```

### 飞书结果库

低粉爆款和账号监控跑完后，可以自动写入飞书多维表格。Mac mini 负责采集和报告，飞书 Base 负责团队协作；短期不需要为了素材协作默认引入 Supabase。

推荐在网页里配置：打开 `douyin.aizao.ai/settings`，找到“飞书结果库”，填入同步方式、Base Token、Table ID、飞书应用 App ID 和 App Secret 后保存。页面会写入 Mac mini 本机 `douyin-monitor-ui/.env.local`，并且只显示掩码，不会把密钥暴露在页面或报告里。

```bash
FEISHU_BASE_SYNC_MODE=auto
FEISHU_BASE_APP_ID=
FEISHU_BASE_APP_SECRET=
FEISHU_BASE_APP_TOKEN=
FEISHU_BASE_TABLE_ID=
DY_HOT_PUBLIC_URL=https://douyin.aizao.ai
```

飞书表必须至少有 `去重键` 字段。推荐字段、视图和协作字段保护见 [docs/feishu-collaboration.md](docs/feishu-collaboration.md)。

## 推荐启动方式

1. 克隆项目并初始化配置：

```bash
git clone https://github.com/Standed/douyin-hot-monitor-studio.git
cd douyin-hot-monitor-studio
cp douyin-monitor-ui/.env.example douyin-monitor-ui/.env.local
cp douyin-monitor/config.example.json douyin-monitor/config.json
```

2. 编辑 `douyin-monitor-ui/.env.local`，至少填 `TIKHUB_API_KEY`。需要云端转写再填 `LEMONFOX_API_KEY`。

3. 启动本项目：

```bash
docker compose up -d --build
```

4. 打开前端，在“对标账号”页面添加账号名称和 `sec_user_id`，并保存账号配置。保存后会写入 `douyin-monitor/config.json`，下次运行直接沿用。

如果不启动前端，也可以把 `douyin-monitor/config.example.json` 复制成 `douyin-monitor/config.json` 后手工编辑；这只是开发兜底，不是推荐入口。

5. 后续重启：

```bash
docker compose up -d --build
```

打开：

```text
http://127.0.0.1:5174/
```

对标账号配置页：

```text
http://127.0.0.1:5174/accounts
```

控制 API：

```text
http://127.0.0.1:8787/
```

解析服务健康检查：

```text
http://127.0.0.1:8091/openapi.json
```

## 抖音 Cookie

低粉爆款搜索主要依赖 TikHub，不一定需要抖音 Cookie。账号监控、下载和部分解析接口可能会受抖音登录态和风控影响。

默认 Compose 为了做到一键启动，只直接运行 `douyin-parser` 镜像，不会把解析服务容器里的 Cookie 配置文件暴露给 UI 写入。因此页面里的“抖音登录态”会显示为不可写，这是正常状态。

如果需要在 UI 里保存 `sessionid`，要额外挂载解析服务的 `config.yaml` 给 parser 容器使用，并把同一个文件以可写路径挂到 UI 容器，然后在 `douyin-monitor-ui/.env.local` 设置：

```bash
DOUYIN_WEB_CONFIG=/app/parser-config/douyin_web_config.yaml
```

也可以直接使用旁边完整的 `../Douyin_TikTok_Download_API/` 项目来做高级管理，例如 Cookie、代理和单独部署，再把本项目的 `LOCAL_API_BASE` 指向那个服务。

## 本地开发

```bash
cd douyin-monitor-ui
npm install
cp .env.example .env.local
npm run dev
```

前端默认 `http://127.0.0.1:5174/`，Express 控制 API 默认 `http://127.0.0.1:8787/`。

本地开发如果不使用 Compose，需要另外启动兼容的抖音解析服务，并让 `.env.local` 保持：

```bash
LOCAL_API_BASE=http://127.0.0.1:8091
```

## 转写怎么选

Lemonfox 适合不想维护本地模型、希望快速拿结果的团队。缺点是要付费，批量跑会消耗额度。

faster-whisper 适合批量监控和私有化场景。建议优先选它，本地速度和资源占用通常比 openai-whisper 更适合运营批处理：

```bash
python3 -m pip install faster-whisper
```

Docker Compose 默认只安装 `faster-whisper`，避免首次构建时拉取 `openai-whisper` 关联的 `torch/CUDA` 大依赖。

openai-whisper 适合已有 Whisper 环境或更熟悉原版工具的用户：

```bash
python3 -m pip install openai-whisper
```

本地转写注意：

- 运行账号监控时勾选“下载无水印视频”和“提取口播文稿”。
- 默认模型 `small` 比较均衡；机器弱可以改 `tiny/base`，要更准再改 `medium/large-v3`。
- 本地模型首次运行会下载模型文件，耗时取决于网络和机器性能。

## CLI

低粉爆款搜索：

```bash
cd douyin-monitor
export TIKHUB_API_KEY="Bearer your_tikhub_token"
python3 douyin_monitor.py lowfan-search "AI智能体" --publish-time 最近一周 --sort 最多点赞 --route 2 --fallback-route
```

对标账号监控：

```bash
python3 douyin_monitor.py account-run --limit 2 --max-accounts 3 --include-seen
```

账号池优先在前端“对标账号”页面维护；CLI 会读取同一个 `douyin-monitor/config.json`。

本地解析服务健康检查：

```bash
python3 douyin_monitor.py health
```

## 不要提交

- `douyin-monitor-ui/.env.local`
- `douyin-monitor/config.json`
- 抖音 `sessionid`
- TikHub / Lemonfox Token
- `douyin-monitor-output/`
- 下载视频、转写文稿和运行日志

## 维护备注

TikHub 接口可能变化。当前默认 route 2：`douyin/search/fetch_video_search_v1`，route 1 仍保留在 UI 和 CLI 里作为备用线路。
