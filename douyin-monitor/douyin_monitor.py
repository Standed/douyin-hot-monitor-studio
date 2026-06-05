#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
DEFAULT_CONFIG = ROOT / "config.json"

PUBLISH_TIME_MAP = {"不限": 0, "最近一天": 1, "最近一周": 7, "最近半年": 180}
DURATION_MAP = {"不限": "0", "1 分钟以内": "0-1", "1-5 分钟": "1-5", "5 分钟以上": "5-10000"}
SORT_TYPE_MAP = {"综合排序": 0, "最多点赞": 1, "最新发布": 2}
LOCAL_TRANSCRIPTION_PROVIDERS = {"faster-whisper", "whisper"}


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    tmp.replace(path)


def request_json(url: str, *, method: str = "GET", headers: dict[str, str] | None = None, body: Any = None, timeout: int = 60) -> Any:
    data = None
    req_headers = {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        **(headers or {}),
    }
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        req_headers = {"Content-Type": "application/json", **req_headers}
    req = urllib.request.Request(url, data=data, method=method, headers=req_headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc
    if not raw:
        return None
    return json.loads(raw.decode("utf-8"))


def request_json_or_error(*args: Any, **kwargs: Any) -> tuple[Any | None, str | None]:
    try:
        return request_json(*args, **kwargs), None
    except Exception as exc:
        return None, str(exc)


def request_bytes(url: str, timeout: int = 120) -> bytes:
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return resp.read()


def bearer(value: str) -> str:
    value = value.strip()
    return value if value.lower().startswith("bearer ") else f"Bearer {value}"


def now_stamp() -> str:
    return dt.datetime.now().strftime("%Y%m%d_%H%M%S")


def safe_name(value: str, max_len: int = 48) -> str:
    value = re.sub(r"[\\/\\\\?%*:|\"<>\\n\\r\\t]+", "", value or "").strip()
    value = re.sub(r"\s+", " ", value)
    return (value[:max_len] or "untitled").strip()


def resolve_path(value: str | Path, *, base: Path = ROOT) -> Path:
    path = Path(value).expanduser()
    return path if path.is_absolute() else (base / path).resolve()


def as_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if value is None:
        return []
    return [value]


def get_path(data: Any, *paths: str, default: Any = None) -> Any:
    for path in paths:
        cur = data
        ok = True
        for part in path.split("."):
            if isinstance(cur, dict) and part in cur:
                cur = cur[part]
            else:
                ok = False
                break
        if ok and cur is not None:
            return cur
    return default


def first_url(value: Any) -> str:
    urls = as_list(value)
    return str(urls[0]) if urls else ""


def format_time(ts: Any) -> str:
    try:
        ts_i = int(ts)
    except (TypeError, ValueError):
        return ""
    return dt.datetime.fromtimestamp(ts_i).strftime("%Y-%m-%d %H:%M:%S")


def normalize_aweme(item: dict[str, Any], *, source: str = "", keyword: str = "") -> dict[str, Any]:
    aweme = item.get("aweme_info") if isinstance(item.get("aweme_info"), dict) else item
    author = aweme.get("author") or {}
    stats = aweme.get("statistics") or {}
    video = aweme.get("video") or {}
    cover = video.get("cover") or {}
    play_addr = video.get("play_addr") or {}
    aweme_id = str(aweme.get("aweme_id") or item.get("videoId") or item.get("id") or "")
    return {
        "video_id": aweme_id,
        "title": aweme.get("desc") or item.get("description") or "",
        "author": author.get("nickname") or item.get("authorNickname") or source,
        "source_account": source,
        "keyword": keyword,
        "follower_count": int(author.get("follower_count") or item.get("followerCount") or 0),
        "like_count": int(stats.get("digg_count") or item.get("likeCount") or 0),
        "comment_count": int(stats.get("comment_count") or item.get("commentCount") or 0),
        "collect_count": int(stats.get("collect_count") or item.get("collectCount") or 0),
        "share_count": int(stats.get("share_count") or item.get("shareCount") or 0),
        "create_time": format_time(aweme.get("create_time") or item.get("createTimeRaw")),
        "create_time_raw": int(aweme.get("create_time") or item.get("createTimeRaw") or 0),
        "url": f"https://www.douyin.com/video/{aweme_id}" if aweme_id else "",
        "cover_url": first_url(cover.get("url_list")),
        "video_url": first_url(play_addr.get("url_list")) or item.get("videoUrl") or "",
        "raw": aweme,
    }


def extract_aweme_list(payload: Any) -> list[dict[str, Any]]:
    candidates = [
        get_path(payload, "data.aweme_list"),
        get_path(payload, "data.data"),
        get_path(payload, "data.list"),
        get_path(payload, "aweme_list"),
        get_path(payload, "data"),
    ]
    for candidate in candidates:
        if isinstance(candidate, list):
            return [x for x in candidate if isinstance(x, dict)]
    return []


def score_row(row: dict[str, Any]) -> int:
    weighted = (
        int(row.get("like_count") or 0)
        + int(row.get("collect_count") or 0) * 2
        + int(row.get("comment_count") or 0) * 3
        + int(row.get("share_count") or 0) * 3
    )
    followers = max(int(row.get("follower_count") or 0), 1)
    return round(weighted / max(followers, 1000) * 1000)


def add_analysis_fields(row: dict[str, Any], cfg: dict[str, Any]) -> dict[str, Any]:
    reasons = []
    if row.get("follower_count", 0) <= int(cfg.get("fans_num", 10000)):
        reasons.append(f"粉丝低于 {cfg.get('fans_num', 10000)}")
    if row.get("like_count", 0) >= int(cfg.get("likes", 1000)):
        reasons.append("点赞达标")
    if row.get("collect_count", 0) >= int(cfg.get("collect", 500)):
        reasons.append("收藏达标")
    if row.get("comment_count", 0) >= int(cfg.get("comment", 500)):
        reasons.append("评论达标")
    if row.get("share_count", 0) >= int(cfg.get("share", 500)):
        reasons.append("转发达标")
    row["viral_score"] = score_row(row)
    row["hit_reason"] = " / ".join(reasons) or "进入候选素材池"
    return row


def env_or_config(config: dict[str, Any], key: str, default: str = "") -> str:
    env_key = f"TRANSCRIPTION_{key.upper()}"
    env_value = os.environ.get(env_key)
    if env_value is not None:
        return env_value
    value = (config.get("transcription") or {}).get(key, default)
    return str(value if value is not None else default)


def transcription_settings(config: dict[str, Any]) -> dict[str, str]:
    provider = env_or_config(config, "provider", "faster-whisper").strip().lower() or "faster-whisper"
    return {
        "provider": provider,
        "language": env_or_config(config, "language", "zh").strip(),
        "prompt": env_or_config(config, "prompt", "请使用标点符号：，。、；：？！").strip(),
        "local_model": env_or_config(config, "local_model", "small").strip() or "small",
        "local_device": env_or_config(config, "local_device", "auto").strip() or "auto",
        "local_compute_type": env_or_config(config, "local_compute_type", "int8").strip() or "int8",
    }


def write_report(output_dir: Path, prefix: str, rows: list[dict[str, Any]]) -> dict[str, str]:
    run_dir = output_dir / "runs"
    run_dir.mkdir(parents=True, exist_ok=True)
    base = run_dir / f"{now_stamp()}_{prefix}"
    json_path = base.with_suffix(".json")
    md_path = base.with_suffix(".md")
    csv_path = base.with_suffix(".csv")

    public_rows = [{k: v for k, v in row.items() if k != "raw"} for row in rows]
    save_json(json_path, public_rows)

    fields = [
        "video_id", "title", "author", "source_account", "keyword", "follower_count", "like_count",
        "comment_count", "collect_count", "share_count", "viral_score", "hit_reason", "create_time",
        "url", "cover_url", "video_url", "local_video_path", "transcript_provider", "transcript_status",
        "transcript_path", "srt_path", "transcript_error", "download_error",
    ]
    with csv_path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(public_rows)

    lines = [f"# {prefix} {dt.datetime.now().strftime('%Y-%m-%d %H:%M')}", ""]
    for i, row in enumerate(public_rows, 1):
        lines.extend([
            f"## {i}. {row.get('title') or row.get('video_id')}",
            f"- 账号: {row.get('author') or row.get('source_account')}",
            f"- 数据: 粉丝 {row.get('follower_count')} / 赞 {row.get('like_count')} / 评 {row.get('comment_count')} / 藏 {row.get('collect_count')} / 转 {row.get('share_count')}",
            f"- 推荐: {row.get('hit_reason')} / 评分 {row.get('viral_score')}",
            f"- 发布时间: {row.get('create_time')}",
            f"- 链接: {row.get('url')}",
            f"- 封面: {row.get('cover_url')}",
            "",
        ])
    md_path.write_text("\n".join(lines), encoding="utf-8")
    return {"json": str(json_path), "csv": str(csv_path), "md": str(md_path)}


def health(config: dict[str, Any]) -> int:
    base = os.environ.get("LOCAL_API_BASE", config["local_api_base"]).rstrip("/")
    try:
        request_json(f"{base}/openapi.json", timeout=5)
    except Exception as exc:
        print(f"local API unavailable: {exc}")
        return 1
    print(f"local API OK: {base}")
    return 0


def account_run(
    config: dict[str, Any],
    *,
    limit: int | None = None,
    include_seen: bool = False,
    download: bool | None = None,
    transcribe: bool | None = None,
    max_accounts: int | None = None,
    timeout: int = 35,
) -> int:
    base = os.environ.get("LOCAL_API_BASE", config["local_api_base"]).rstrip("/")
    tikhub_key = os.environ.get("TIKHUB_API_KEY", "").strip()
    account_cfg = config["account_monitor"]
    output_dir = resolve_path(config["output_dir"])
    state_path = resolve_path(config["state_path"])
    state = load_json(state_path, {"seen_aweme_ids": []})
    seen = set(state.get("seen_aweme_ids", []))
    count = int(limit or account_cfg.get("count_per_account", 2))
    do_download = account_cfg.get("download_video", False) if download is None else download
    do_transcribe = account_cfg.get("transcribe", False) if transcribe is None else transcribe
    transcript_cfg = transcription_settings(config)

    new_rows: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []

    accounts = [account for account in account_cfg["accounts"] if account.get("enabled", True)]
    if max_accounts:
        accounts = accounts[:max_accounts]

    for account in accounts:
        params = urllib.parse.urlencode({"sec_user_id": account["sec_user_id"], "max_cursor": 0, "count": count})
        url = f"{base}/api/douyin/web/fetch_user_post_videos?{params}"
        source_api = "local-parser"
        try:
            payload = request_json(url, timeout=timeout)
        except Exception as exc:
            local_error = str(exc)
            if not tikhub_key:
                errors.append({"account": account["name"], "error": local_error})
                continue
            tikhub_url = f"https://api.tikhub.io/api/v1/douyin/web/fetch_user_post_videos?{params}"
            try:
                payload = request_json(tikhub_url, headers={"Authorization": bearer(tikhub_key)}, timeout=timeout)
                source_api = "tikhub-fallback"
            except Exception as fallback_exc:
                errors.append({"account": account["name"], "error": f"local-parser: {local_error}; tikhub-fallback: {fallback_exc}"})
                continue
        for item in extract_aweme_list(payload):
            row = normalize_aweme(item, source=account["name"])
            row["source_api"] = source_api
            if not row["video_id"]:
                continue
            if row["video_id"] in seen and not include_seen:
                continue
            new_rows.append(row)
            seen.add(row["video_id"])
            if do_download:
                download_video(base, row, output_dir)
            if do_transcribe:
                if transcript_cfg["provider"] in LOCAL_TRANSCRIPTION_PROVIDERS and not row.get("local_video_path"):
                    download_video(base, row, output_dir)
                transcribe_video(row, output_dir, transcript_cfg)
        time.sleep(0.6)

    state["seen_aweme_ids"] = sorted(seen)
    state["last_account_run_at"] = dt.datetime.now().isoformat(timespec="seconds")
    state["last_account_errors"] = errors[-20:]
    save_json(state_path, state)
    paths = write_report(output_dir, "account_new", new_rows)
    print(json.dumps({"new_count": len(new_rows), "errors": errors, "reports": paths}, ensure_ascii=False, indent=2))
    return 0 if not errors else 2


def lowfan_search(config: dict[str, Any], args: argparse.Namespace) -> int:
    api_key = os.environ.get("TIKHUB_API_KEY")
    if not api_key:
        print("Missing TIKHUB_API_KEY. Export it before running lowfan-search.")
        return 2
    low_cfg = config["low_fan_hits"]
    rows: list[dict[str, Any]] = []
    search_id = ""
    cursor = 0

    publish_time = PUBLISH_TIME_MAP.get(args.publish_time, 0)
    duration = DURATION_MAP.get(args.duration, "0")
    sort_type = SORT_TYPE_MAP.get(args.sort, 0)
    preferred_route = int(args.route or low_cfg.get("route", 2))
    routes = [preferred_route]
    if getattr(args, "fallback_route", False):
        routes.extend(route for route in [2, 1] if route not in routes)

    for _ in range(int(args.pages or low_cfg.get("max_pages", 2))):
        data = None
        route_errors: list[dict[str, str]] = []
        for route in routes:
            if route == 2:
                payload = {
                    "keyword": args.keyword,
                    "cursor": str(cursor),
                    "sort_type": str(sort_type),
                    "publish_time": str(publish_time),
                    "filter_duration": duration,
                    "content_type": "1",
                    "search_id": search_id,
                }
                data, error = request_json_or_error(
                    "https://api.tikhub.io/api/v1/douyin/search/fetch_video_search_v1",
                    method="POST",
                    headers={"Authorization": bearer(api_key)},
                    body=payload,
                )
            else:
                qs = urllib.parse.urlencode({
                    "keyword": args.keyword,
                    "offset": cursor,
                    "count": int(args.count or low_cfg.get("count", 20)),
                    "sort_type": sort_type,
                    "publish_time": publish_time,
                    "filter_duration": duration,
                    "search_id": search_id,
                })
                data, error = request_json_or_error(
                    f"https://api.tikhub.io/api/v1/douyin/web/fetch_video_search_result?{qs}",
                    headers={"Authorization": bearer(api_key)},
                )
            if data is not None:
                break
            route_errors.append({"route": str(route), "error": error or "empty response"})
        if data is None:
            raise RuntimeError(f"TikHub search failed: {json.dumps(route_errors, ensure_ascii=False)}")
        items = extract_aweme_list(data)
        for item in items:
            row = normalize_aweme(item, keyword=args.keyword)
            if is_lowfan_hit(row, low_cfg):
                rows.append(add_analysis_fields(row, low_cfg))
        cursor += int(args.count or low_cfg.get("count", 20))
        search_id = str(get_path(data, "data.extra.logid", "data.search_id", default=search_id) or search_id)
        time.sleep(0.8)

    deduped = {row["video_id"]: row for row in rows if row["video_id"]}
    result_rows = sorted(deduped.values(), key=lambda row: int(row.get("viral_score") or 0), reverse=True)
    paths = write_report(resolve_path(config["output_dir"]), f"lowfan_{safe_name(args.keyword, 20)}", result_rows)
    print(json.dumps({"hit_count": len(result_rows), "reports": paths, "route": preferred_route, "fallback_enabled": bool(getattr(args, "fallback_route", False))}, ensure_ascii=False, indent=2))
    return 0


def is_lowfan_hit(row: dict[str, Any], cfg: dict[str, Any]) -> bool:
    if row["follower_count"] > int(cfg.get("fans_num", 10000)):
        return False
    return (
        row["like_count"] >= int(cfg.get("likes", 1000))
        or row["collect_count"] >= int(cfg.get("collect", 500))
        or row["comment_count"] >= int(cfg.get("comment", 500))
        or row["share_count"] >= int(cfg.get("share", 500))
    )


def download_video(base: str, row: dict[str, Any], output_dir: Path) -> None:
    if not row.get("url"):
        return
    folder = output_dir / "assets" / safe_name(row.get("title") or row["video_id"], 28)
    folder.mkdir(parents=True, exist_ok=True)
    download_url = row.get("video_url")
    try:
        if download_url:
            content = request_bytes(download_url, timeout=180)
        else:
            qs = urllib.parse.urlencode({"url": row["url"], "prefix": "true", "with_watermark": "false"})
            content = request_bytes(f"{base}/api/download?{qs}", timeout=180)
        if content.lstrip().startswith(b"{"):
            raise ValueError(content[:500].decode("utf-8", errors="ignore"))
    except Exception as exc:
        row["download_error"] = str(exc)
        return
    path = folder / "video.mp4"
    path.write_bytes(content)
    row["local_video_path"] = str(path)


def transcribe_video(row: dict[str, Any], output_dir: Path, settings: dict[str, str]) -> None:
    provider = settings.get("provider", "faster-whisper")
    row["transcript_provider"] = provider
    if provider == "lemonfox":
        transcribe_video_with_lemonfox(row, output_dir, settings)
        return
    if provider == "faster-whisper":
        transcribe_video_with_faster_whisper(row, output_dir, settings)
        return
    if provider == "whisper":
        transcribe_video_with_whisper(row, output_dir, settings)
        return
    row["transcript_status"] = "skipped_unknown_provider"
    row["transcript_error"] = f"Unsupported transcription provider: {provider}"


def transcribe_video_with_lemonfox(row: dict[str, Any], output_dir: Path, settings: dict[str, str]) -> None:
    api_key = os.environ.get("LEMONFOX_API_KEY")
    video_url = row.get("video_url")
    if not api_key or not video_url:
        row["transcript_status"] = "skipped_missing_key_or_video_url"
        return
    body = urllib.parse.urlencode({
        "file": video_url + ("" if video_url.endswith(".mp4") else ".mp4"),
        "language": normalize_lemonfox_language(settings.get("language")),
        "response_format": "srt",
        "Prompt": settings.get("prompt") or "请使用标点符号：，。、；：？！",
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://api.lemonfox.ai/v1/audio/transcriptions",
        data=body,
        method="POST",
        headers={"Authorization": api_key, "Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            srt = resp.read().decode("utf-8")
    except Exception as exc:
        row["transcript_error"] = str(exc)
        return
    write_transcript_files(row, output_dir, srt)


def transcribe_video_with_faster_whisper(row: dict[str, Any], output_dir: Path, settings: dict[str, str]) -> None:
    local_video_path = row.get("local_video_path")
    if not local_video_path:
        row["transcript_status"] = "skipped_missing_local_video"
        return
    try:
        from faster_whisper import WhisperModel  # type: ignore
    except ImportError:
        row["transcript_error"] = "Missing faster-whisper. Install it in the Python environment, then retry."
        return
    try:
        model = WhisperModel(
            settings.get("local_model") or "small",
            device=settings.get("local_device") or "auto",
            compute_type=settings.get("local_compute_type") or "int8",
        )
        segments, _info = model.transcribe(
            local_video_path,
            language=normalize_whisper_language(settings.get("language")),
            initial_prompt=settings.get("prompt") or None,
            vad_filter=True,
        )
        write_transcript_files(row, output_dir, segments_to_srt([
            {"start": segment.start, "end": segment.end, "text": segment.text}
            for segment in segments
        ]))
    except Exception as exc:
        row["transcript_error"] = str(exc)


def transcribe_video_with_whisper(row: dict[str, Any], output_dir: Path, settings: dict[str, str]) -> None:
    local_video_path = row.get("local_video_path")
    if not local_video_path:
        row["transcript_status"] = "skipped_missing_local_video"
        return
    try:
        import whisper  # type: ignore
    except ImportError:
        row["transcript_error"] = "Missing openai-whisper. Install it in the Python environment, then retry."
        return
    try:
        model = whisper.load_model(settings.get("local_model") or "small")
        result = model.transcribe(
            local_video_path,
            language=normalize_whisper_language(settings.get("language")),
            initial_prompt=settings.get("prompt") or None,
        )
        write_transcript_files(row, output_dir, segments_to_srt(result.get("segments") or []))
    except Exception as exc:
        row["transcript_error"] = str(exc)


def normalize_whisper_language(language: str | None) -> str | None:
    if not language:
        return None
    normalized = language.strip().lower()
    if normalized in {"chinese", "zh-cn", "zh_hans"}:
        return "zh"
    if normalized in {"auto", "自动"}:
        return None
    return normalized


def normalize_lemonfox_language(language: str | None) -> str:
    if not language:
        return "chinese"
    normalized = language.strip().lower()
    if normalized in {"zh", "zh-cn", "zh_hans", "中文"}:
        return "chinese"
    return normalized


def segments_to_srt(segments: list[Any]) -> str:
    lines = []
    for index, segment in enumerate(segments, 1):
        if isinstance(segment, dict):
            start = float(segment.get("start") or 0)
            end = float(segment.get("end") or start)
            text = str(segment.get("text") or "").strip()
        else:
            start = float(getattr(segment, "start", 0))
            end = float(getattr(segment, "end", start))
            text = str(getattr(segment, "text", "")).strip()
        if not text:
            continue
        lines.extend([str(index), f"{srt_timestamp(start)} --> {srt_timestamp(end)}", text, ""])
    return "\n".join(lines).strip() + "\n"


def srt_timestamp(seconds: float) -> str:
    milliseconds = max(0, round(seconds * 1000))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def write_transcript_files(row: dict[str, Any], output_dir: Path, srt: str) -> None:
    folder = output_dir / "assets" / safe_name(row.get("title") or row["video_id"], 28)
    folder.mkdir(parents=True, exist_ok=True)
    srt_path = folder / "subtitle.srt"
    txt_path = folder / "transcript.txt"
    srt_path.write_text(srt, encoding="utf-8")
    txt_path.write_text(srt_to_text(srt), encoding="utf-8")
    row["srt_path"] = str(srt_path)
    row["transcript_path"] = str(txt_path)
    row["transcript_status"] = "ok"


def srt_to_text(srt: str) -> str:
    lines = []
    for line in srt.replace("\\n", "\n").splitlines():
        line = line.strip()
        if not line or line.isdigit() or "-->" in line:
            continue
        lines.append(line)
    return "".join(lines)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Local Douyin account and low-fan hit monitor")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG))
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("health")

    account = sub.add_parser("account-run")
    account.add_argument("--limit", type=int)
    account.add_argument("--include-seen", action="store_true")
    account.add_argument("--download", action="store_true")
    account.add_argument("--transcribe", action="store_true")
    account.add_argument("--max-accounts", type=int)
    account.add_argument("--timeout", type=int, default=35)

    lowfan = sub.add_parser("lowfan-search")
    lowfan.add_argument("keyword")
    lowfan.add_argument("--publish-time", default="最近一周")
    lowfan.add_argument("--duration", default="不限")
    lowfan.add_argument("--sort", default="最多点赞")
    lowfan.add_argument("--route", type=int, default=2)
    lowfan.add_argument("--fallback-route", action="store_true")
    lowfan.add_argument("--pages", type=int, default=2)
    lowfan.add_argument("--count", type=int, default=20)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    config = load_json(Path(args.config), {})
    try:
        if args.command == "health":
            return health(config)
        if args.command == "account-run":
            return account_run(
                config,
                limit=args.limit,
                include_seen=args.include_seen,
                download=args.download,
                transcribe=args.transcribe,
                max_accounts=args.max_accounts,
                timeout=args.timeout,
            )
        if args.command == "lowfan-search":
            return lowfan_search(config, args)
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    parser.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
