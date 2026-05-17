# Douyin Hot Monitor Studio

A local-first Douyin content intelligence dashboard for:

- finding low-follower viral videos by keyword;
- monitoring benchmark Douyin accounts;
- collecting cover links, video links, CSV/JSON/Markdown reports;
- optionally downloading videos and transcribing spoken scripts.

The project is a lightweight replacement for n8n-style Douyin monitoring workflows. It ships with a React + TypeScript + Tailwind UI, a small Express control API, and a Python monitor CLI.

## What It Does

- Low-follower viral search through TikHub.
- Benchmark account monitoring through a local Douyin parser service.
- Viral scoring and hit reasons for search results.
- Local report archive under `douyin-monitor-output/runs`.
- Session ID update endpoint for the local parser config.
- Dark information-stream UI inspired by AI news dashboards.

## Project Structure

```text
douyin-hot-monitor-studio/
  douyin-monitor/        Python monitor CLI and config
  douyin-monitor-ui/     React dashboard and Express control API
  README.md
```

## Requirements

- Node.js 20+
- Python 3.10+
- A TikHub API token for low-follower viral search
- Optional Lemonfox API token for transcription
- Optional local Douyin parser service for account monitoring and downloads

For the parser service, this project expects a compatible local API at:

```text
http://127.0.0.1:8091
```

The original internal setup used `Douyin_TikTok_Download_API`; any compatible endpoint with `/api/douyin/web/fetch_user_post_videos`, `/api/download`, and `/openapi.json` should work.

## Setup

```bash
cd douyin-hot-monitor-studio/douyin-monitor-ui
npm install
cp .env.example .env.local
```

Edit `.env.local`:

```bash
TIKHUB_API_KEY=Bearer your_tikhub_token
LEMONFOX_API_KEY=your_lemonfox_token
PYTHON_BIN=python3
MONITOR_DIR=../douyin-monitor
```

Then configure monitored accounts:

```bash
cd ../douyin-monitor
cp config.example.json config.json
```

Edit `config.json` and add your own Douyin `sec_user_id` list.

## Run

Start the dashboard:

```bash
cd douyin-hot-monitor-studio/douyin-monitor-ui
npm run dev
```

Open:

```text
http://127.0.0.1:5174/
```

The Express control API runs at:

```text
http://127.0.0.1:8787/
```

## CLI Usage

Low-follower viral search:

```bash
cd douyin-hot-monitor-studio/douyin-monitor
export TIKHUB_API_KEY="Bearer your_tikhub_token"
python3 douyin_monitor.py lowfan-search "AI智能体" --publish-time 最近一周 --sort 最多点赞 --route 2 --fallback-route
```

Benchmark account monitoring:

```bash
python3 douyin_monitor.py account-run --limit 2 --max-accounts 3 --include-seen
```

Health check for the local parser:

```bash
python3 douyin_monitor.py health
```

## Security

Do not commit:

- `.env.local`
- `config.json` with private account lists if you do not want them public
- parser cookies, Douyin `sessionid`, TikHub tokens, Lemonfox tokens
- generated reports or downloaded media

This repository includes `.env.example` and `config.example.json` for safe public sharing.

## Notes

TikHub endpoint behavior can change. Route 2 (`douyin/search/fetch_video_search_v1`) is the current default because it has been more stable in testing. Route 1 is still available from the UI and CLI.
