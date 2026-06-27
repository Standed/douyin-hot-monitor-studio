import cors from 'cors'
import express from 'express'
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const defaultMonitorDir = path.resolve(__dirname, '../douyin-monitor')
let monitorDir = defaultMonitorDir
let monitorScript = path.join(monitorDir, 'douyin_monitor.py')
let python = '/opt/homebrew/bin/python3.12'
let configPath = path.join(monitorDir, 'config.json')
let douyinWebConfigPath = ''
const app = express()
const port = 8787
const host = process.env.HOST || '127.0.0.1'
const feedbackDefaults = {
  formUrl: 'https://xiyangshiai.feishu.cn/share/base/form/shrcn27png3VUckWYkSEuKX3aVc',
  baseUrl: 'https://xiyangshiai.feishu.cn/share/base/form/shrcn27png3VUckWYkSEuKX3aVc',
  formId: 'shrcn27png3VUckWYkSEuKX3aVc',
}

const defaultLowFanConfig = {
  fans_num: 10000,
  likes: 1000,
  collect: 500,
  comment: 500,
  share: 500,
  count: 20,
  max_pages: 2,
  route: 2,
}

const defaultCardMaxRows = 8
const collaborationFields = new Set([
  '处理状态',
  '负责人',
  '适配账号',
  '选题价值',
  '内容类型',
  '是否已采纳',
  '选题句',
  '写作角度',
  '素材缺口',
  '备注',
  '成稿链接',
  '发布链接',
  '复盘结论',
])
const extendedFeishuFields = new Set(['适配账号', '内容类型', '选题句', '写作角度', '素材缺口', '成稿链接', '发布链接', '复盘结论'])
const dailyRunState = {
  running: false,
  lastDateKey: '',
}

app.use(cors())
app.use(express.json())

async function loadLocalEnv() {
  const envPath = path.join(__dirname, '.env.local')
  try {
    const content = await fs.readFile(envPath, 'utf8')
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const index = trimmed.indexOf('=')
      if (index < 0) continue
      const key = trimmed.slice(0, index).trim()
      const value = trimmed.slice(index + 1).trim()
      if (key && !process.env[key]) {
        process.env[key] = value
      }
    }
  } catch {
    // Local env file is optional.
  }
}

function refreshRuntimeConfig() {
  monitorDir = process.env.MONITOR_DIR || defaultMonitorDir
  monitorScript = path.join(monitorDir, 'douyin_monitor.py')
  python = process.env.PYTHON_BIN || '/opt/homebrew/bin/python3.12'
  configPath = path.join(monitorDir, 'config.json')
  douyinWebConfigPath = process.env.DOUYIN_WEB_CONFIG || ''
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

async function saveJson(file, data) {
  const tmp = `${file}.tmp`
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  await fs.rename(tmp, file)
}

async function exists(file) {
  try {
    await fs.access(file, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

async function douyinWebConfigStatus() {
  if (!douyinWebConfigPath) {
    return {
      configured: false,
      writable: false,
      path: '',
      detail: 'DOUYIN_WEB_CONFIG 未配置；Docker 默认内置解析容器不会把 Cookie 配置暴露给 UI 写入。',
    }
  }

  try {
    await fs.access(douyinWebConfigPath, fsConstants.R_OK | fsConstants.W_OK)
    return {
      configured: true,
      writable: true,
      path: douyinWebConfigPath,
      detail: 'DOUYIN_WEB_CONFIG 指向的配置文件可写。',
    }
  } catch (error) {
    return {
      configured: true,
      writable: false,
      path: douyinWebConfigPath,
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

async function getServiceStatus(apiBase) {
  const effectiveApiBase = process.env.LOCAL_API_BASE || apiBase
  try {
    const response = await fetch(`${effectiveApiBase.replace(/\/$/, '')}/openapi.json`, { signal: AbortSignal.timeout(3000) })
    return {
      ok: response.ok,
      apiBase: effectiveApiBase,
      checkedAt: new Date().toISOString(),
      error: response.ok ? undefined : `HTTP ${response.status}`,
    }
  } catch (error) {
    return {
      ok: false,
      apiBase: effectiveApiBase,
      checkedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function listReports(outputDir) {
  const runsDir = path.join(outputDir, 'runs')
  if (!(await exists(runsDir))) return []
  const entries = await fs.readdir(runsDir, { withFileTypes: true })
  const reports = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const ext = path.extname(entry.name).slice(1)
    if (!['json', 'csv', 'md'].includes(ext)) continue
    const fullPath = path.join(runsDir, entry.name)
    const stat = await fs.stat(fullPath)
    reports.push({
      name: entry.name,
      path: fullPath,
      url: `/api/reports/${encodeURIComponent(entry.name)}`,
      type: ext,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    })
  }
  return reports.sort((a, b) => +new Date(b.modifiedAt) - +new Date(a.modifiedAt))
}

async function latestRows(reports) {
  const latestJson = reports.find((report) => report.type === 'json')
  if (!latestJson) return []
  const rows = await readJson(latestJson.path, [])
  return Array.isArray(rows) ? rows : []
}

async function latestRowsByKind(reports, kind) {
  const latestJson = reports.find((report) => report.type === 'json' && report.name.includes(`_${kind}`))
  if (!latestJson) return []
  const rows = await readJson(latestJson.path, [])
  return Array.isArray(rows) ? rows : []
}

async function reportRows(reportPath) {
  const rows = await readJson(reportPath, [])
  return Array.isArray(rows) ? rows : []
}

function summarizeAccounts(config) {
  const accounts = config.account_monitor?.accounts || []
  return accounts.map((account, index) => ({
    index: index + 1,
    name: account.name,
    secUserId: account.sec_user_id,
    enabled: account.enabled !== false,
  }))
}

function enabledAccounts(config) {
  return (config.account_monitor?.accounts || []).filter((account) => account.enabled !== false)
}

function asPositiveNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback
}

function boundedNumber(value, fallback, min, max) {
  const number = asPositiveNumber(value, fallback)
  return Math.min(max, Math.max(min, number))
}

function normalizeLowFanConfig(value = {}) {
  return {
    fans_num: boundedNumber(value.fans_num, defaultLowFanConfig.fans_num, 100, 10000000),
    likes: boundedNumber(value.likes, defaultLowFanConfig.likes, 1, 10000000),
    collect: boundedNumber(value.collect, defaultLowFanConfig.collect, 1, 10000000),
    comment: boundedNumber(value.comment, defaultLowFanConfig.comment, 1, 10000000),
    share: boundedNumber(value.share, defaultLowFanConfig.share, 1, 10000000),
    count: boundedNumber(value.count, defaultLowFanConfig.count, 5, 50),
    max_pages: boundedNumber(value.max_pages, defaultLowFanConfig.max_pages, 1, 10),
    route: Number(value.route) === 1 ? 1 : 2,
  }
}

function normalizeDouyinSecUserId(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const fromUserPath = raw.match(/\/user\/([^/?#\s]+)/i)?.[1]
  const fromText = raw.match(/(MS4wLj[A-Za-z0-9_-]+)/)?.[1]
  return decodeURIComponent(fromUserPath || fromText || raw)
    .replace(/[?#].*$/, '')
    .trim()
}

function normalizeAccountMonitorConfig(value = {}, current = {}) {
  const incomingAccounts = Array.isArray(value.accounts) ? value.accounts : current.accounts || []
  const accounts = []

  for (const account of incomingAccounts) {
    const name = String(account?.name || '').trim()
    const secUserId = normalizeDouyinSecUserId(account?.secUserId || account?.sec_user_id || '')
    if (!name && !secUserId) continue
    if (!name || !secUserId) {
      return { error: '账号名称和抖音主页链接 / sec_user_id 都要填写；空白行可以直接留空。' }
    }
    accounts.push({ name, sec_user_id: secUserId, enabled: account?.enabled !== false })
  }

  return {
    count_per_account: boundedNumber(value.countPerAccount ?? current.count_per_account, 2, 1, 50),
    download_video: Boolean(value.downloadVideo ?? current.download_video),
    transcribe: Boolean(value.transcribe ?? current.transcribe),
    accounts,
  }
}

function monitorJobTimeoutMs(args = []) {
  const envTimeout = Number(process.env.MONITOR_JOB_TIMEOUT_SECONDS || 0)
  if (Number.isFinite(envTimeout) && envTimeout > 0) return envTimeout * 1000
  if (args.includes('--transcribe')) return 1000 * 60 * 20
  if (args.includes('--download')) return 1000 * 60 * 10
  return 1000 * 60 * 5
}

function runMonitor(args) {
  return new Promise((resolve) => {
    const command = `${python} ${monitorScript} ${args.join(' ')}`
    execFile(python, [monitorScript, ...args], { cwd: monitorDir, env: process.env, timeout: monitorJobTimeoutMs(args), maxBuffer: 1024 * 1024 * 8 }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        command,
        code: typeof error?.code === 'number' ? error.code : error ? 1 : 0,
        stdout,
        stderr,
      })
    })
  })
}

function checkPythonModules(modules) {
  return new Promise((resolve) => {
    const code = `
import importlib.util, json
modules = ${JSON.stringify(modules)}
print(json.dumps({name: importlib.util.find_spec(name) is not None for name in modules}))
`
    execFile(python, ['-c', code], { cwd: monitorDir, timeout: 1000 * 5, maxBuffer: 1024 * 64 }, (error, stdout) => {
      if (error) {
        resolve(Object.fromEntries(modules.map((module) => [module, false])))
        return
      }
      try {
        resolve(JSON.parse(stdout))
      } catch {
        resolve(Object.fromEntries(modules.map((module) => [module, false])))
      }
    })
  })
}

async function runMonitorWithRows(args) {
  const result = await runMonitor(args)
  const parsed = parseMonitorOutput(result.stdout)
  const jsonPath = parsed?.reports?.json
  return {
    ...result,
    stdout: result.ok ? '运行完成' : '',
    stderr: friendlyMonitorError(result.stderr),
    parsed: normalizeRunParsed(parsed),
    rows: typeof jsonPath === 'string' ? await reportRows(jsonPath) : [],
  }
}

function normalizeRunParsed(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed
  const errors = Array.isArray(parsed.errors)
    ? parsed.errors.map((entry) => ({
        ...entry,
        error: friendlyMonitorError(entry?.error || ''),
      }))
    : parsed.errors
  return { ...parsed, errors }
}

function friendlyMonitorError(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  const lower = text.toLowerCase()
  if (lower.includes('timed out') || lower.includes('timeout')) {
    return '抖音接口响应超时。建议稍后重试，或把“请求超时”调到 30-60 秒；如果连续超时，优先检查登录态、代理和解析服务。'
  }
  if (lower.includes('fetch_user_post_videos') || lower.includes('http 400') || lower.includes('an error occurred')) {
    return '抖音账号作品接口返回异常。本次会自动尝试 TikHub 兜底；如果仍失败，请检查账号 ID、登录态、代理和解析服务。'
  }
  if (lower.includes('cookie') || lower.includes('login') || text.includes('登录')) {
    return '抖音登录态可能失效。请到“接口配置”检查登录态，或在解析服务里更新 Cookie。'
  }
  return text
}

function parseMonitorOutput(stdout) {
  if (!stdout) return null
  const start = stdout.indexOf('{')
  const end = stdout.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    return JSON.parse(stdout.slice(start, end + 1))
  } catch {
    return null
  }
}

function maskSecret(value) {
  if (!value) return ''
  const normalized = String(value).trim()
  if (normalized.length <= 10) return '已配置'
  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`
}

async function readLocalEnvValues() {
  const envPath = path.join(__dirname, '.env.local')
  const values = {}
  try {
    const content = await fs.readFile(envPath, 'utf8')
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const index = trimmed.indexOf('=')
      if (index < 0) continue
      values[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim()
    }
  } catch {
    // Local env file is optional.
  }
  return values
}

async function writeLocalEnvValues(updates) {
  const envPath = path.join(__dirname, '.env.local')
  let lines = []
  try {
    lines = (await fs.readFile(envPath, 'utf8')).split(/\r?\n/)
  } catch {
    lines = []
  }

  const pending = new Map(Object.entries(updates).filter(([, value]) => typeof value === 'string' && value.trim()))
  const next = lines.map((line) => {
    const index = line.indexOf('=')
    if (index < 0) return line
    const key = line.slice(0, index).trim()
    if (!pending.has(key)) return line
    const value = pending.get(key).trim()
    pending.delete(key)
    return `${key}=${value}`
  })

  for (const [key, value] of pending) {
    next.push(`${key}=${String(value).trim()}`)
  }

  await fs.writeFile(envPath, `${next.filter((line, index, array) => line.trim() || index < array.length - 1).join('\n')}\n`, 'utf8')
}

function normalizeProvider(value) {
  const provider = String(value || 'faster-whisper').trim().toLowerCase()
  return ['lemonfox', 'faster-whisper', 'whisper'].includes(provider) ? provider : 'faster-whisper'
}

function feedbackSettings(envValues = {}) {
  const webhook = process.env.FEISHU_FEEDBACK_WEBHOOK || envValues.FEISHU_FEEDBACK_WEBHOOK || ''
  return {
    formUrl: process.env.FEISHU_FEEDBACK_FORM_URL || envValues.FEISHU_FEEDBACK_FORM_URL || feedbackDefaults.formUrl,
    baseUrl: process.env.FEISHU_FEEDBACK_BASE_URL || envValues.FEISHU_FEEDBACK_BASE_URL || feedbackDefaults.baseUrl,
    formId: process.env.FEISHU_FEEDBACK_FORM_ID || envValues.FEISHU_FEEDBACK_FORM_ID || feedbackDefaults.formId,
    webhookConfigured: Boolean(webhook),
  }
}

function sanitizeFeedbackText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength)
}

async function sendFeedbackNotification(feedback, webhook) {
  if (!webhook) return { configured: false, sent: false }
  const settings = feedbackSettings()
  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msg_type: 'text',
      content: {
        text: [
          'DY HOT 收到新反馈',
          `页面：${feedback.page || '未填写'}`,
          `联系方式：${feedback.contact || '未填写'}`,
          `内容：${feedback.message}`,
          `问卷：${settings.formUrl}`,
          `时间：${feedback.createdAt}`,
        ].join('\n'),
      },
    }),
  })
  if (!response.ok) {
    throw new Error(`Feishu webhook HTTP ${response.status}`)
  }
  return { configured: true, sent: true }
}

function feishuBaseSettings(envValues = {}) {
  const appId = process.env.FEISHU_BASE_APP_ID || envValues.FEISHU_BASE_APP_ID || process.env.LARK_APP_ID || envValues.LARK_APP_ID || ''
  const appSecret = process.env.FEISHU_BASE_APP_SECRET || envValues.FEISHU_BASE_APP_SECRET || process.env.LARK_APP_SECRET || envValues.LARK_APP_SECRET || ''
  const baseToken = process.env.FEISHU_BASE_APP_TOKEN || envValues.FEISHU_BASE_APP_TOKEN || process.env.FEISHU_BASE_TOKEN || envValues.FEISHU_BASE_TOKEN || ''
  const tableId = process.env.FEISHU_BASE_TABLE_ID || envValues.FEISHU_BASE_TABLE_ID || ''
  const syncMode = String(process.env.FEISHU_BASE_SYNC_MODE || envValues.FEISHU_BASE_SYNC_MODE || 'auto').trim().toLowerCase()
  const larkCliProfile = process.env.FEISHU_BASE_LARK_PROFILE || envValues.FEISHU_BASE_LARK_PROFILE || 'xiyangshi-company'
  const larkCliAs = process.env.FEISHU_BASE_LARK_AS || envValues.FEISHU_BASE_LARK_AS || 'user'
  const larkCliBin = process.env.FEISHU_BASE_LARK_CLI || envValues.FEISHU_BASE_LARK_CLI || 'lark-cli'
  const openApiConfigured = Boolean(appId && appSecret)
  return {
    configured: Boolean(baseToken && tableId && (openApiConfigured || syncMode === 'auto' || syncMode === 'lark-cli')),
    openApiConfigured,
    syncMode,
    larkCliProfile,
    larkCliAs,
    larkCliBin,
    appId,
    appSecret,
    baseToken,
    tableId,
    baseUrl: baseToken ? `https://xiyangshiai.feishu.cn/base/${baseToken}` : '',
  }
}

function contentOsSettings(envValues = {}) {
  const url = process.env.CONTENT_OS_SUPABASE_URL || envValues.CONTENT_OS_SUPABASE_URL || process.env.SUPABASE_URL || envValues.SUPABASE_URL || ''
  const serviceRoleKey =
    process.env.CONTENT_OS_SUPABASE_SERVICE_ROLE_KEY ||
    envValues.CONTENT_OS_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    envValues.SUPABASE_SERVICE_ROLE_KEY ||
    ''
  const workspaceId = process.env.CONTENT_OS_WORKSPACE_ID || envValues.CONTENT_OS_WORKSPACE_ID || '00000000-0000-4000-8000-000000000001'
  const sourceName = process.env.CONTENT_OS_DOUYIN_SOURCE_NAME || envValues.CONTENT_OS_DOUYIN_SOURCE_NAME || '抖音素材雷达'
  const publicUrl = process.env.CONTENT_OS_PUBLIC_URL || envValues.CONTENT_OS_PUBLIC_URL || 'https://content.aizao.ai'
  const enabled = booleanEnv(process.env.CONTENT_OS_SYNC_ENABLED || envValues.CONTENT_OS_SYNC_ENABLED, false)
  return {
    configured: Boolean(enabled && url && serviceRoleKey && workspaceId),
    enabled,
    url: url.replace(/\/$/, ''),
    serviceRoleKey,
    workspaceId,
    sourceName,
    publicUrl,
  }
}

async function contentOsFetch(settings, pathName, options = {}) {
  const response = await fetch(`${settings.url}/rest/v1/${pathName}`, {
    method: options.method || 'GET',
    headers: {
      apikey: settings.serviceRoleKey,
      Authorization: `Bearer ${settings.serviceRoleKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Prefer: options.prefer || 'return=representation',
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : null
  if (!response.ok) {
    throw new Error(`Content OS Supabase ${response.status}: ${text.slice(0, 240)}`)
  }
  return payload
}

function contentOsFilter(value) {
  return encodeURIComponent(String(value || ''))
}

async function ensureContentOsSource(settings) {
  const existing = await contentOsFetch(
    settings,
    `sources?workspace_id=eq.${contentOsFilter(settings.workspaceId)}&name=eq.${contentOsFilter(settings.sourceName)}&limit=1`,
  )
  if (existing?.[0]?.id) return existing[0]
  const created = await contentOsFetch(settings, 'sources', {
    method: 'POST',
    body: {
      workspace_id: settings.workspaceId,
      name: settings.sourceName,
      tier: 'T1_5',
      method: 'api',
      connector_kind: 'private_worker',
      connector_config: { producer: 'douyin.aizao.ai', boundary: 'data-sync-only' },
      url: 'https://douyin.aizao.ai/',
      cadence: 'manual_or_daily',
      status: 'active',
      owner: '素材雷达',
      account_fit: ['main', 'yangy', 'dramas', 'gongfang'],
      use_case: '把低粉爆款和对标账号监控结果作为 Content OS 的内容机会，不合并抖音配置界面。',
      risk: '抖音 Cookie、解析 API、转写模型仍留在素材雷达后台，Content OS 只消费结果。',
    },
  })
  return created?.[0]
}

function contentOsTimestamp(value) {
  const date = value ? new Date(value) : new Date()
  return Number.isNaN(+date) ? new Date().toISOString() : date.toISOString()
}

function contentOsFitAccounts(row = {}) {
  const text = [row.keyword, row.title, row.hit_reason, row.source_account].join(' ')
  if (/短剧|剧本|剪辑|视频号/.test(text)) return ['dramas']
  if (/agent|智能体|自动化|编程|cursor|codex/i.test(text)) return ['gongfang', 'main']
  return ['main']
}

function fitAccountLabels(row = {}) {
  const fits = contentOsFitAccounts(row)
  const labels = {
    main: '西羊石AI视频',
    yangy: '羊羊AI视频',
    dramas: '西羊石AI短剧',
    gongfang: '小石的AI智能体工坊',
  }
  return fits.map((fit) => labels[fit] || fit).join('、')
}

function contentOsAssetList(row = {}, reports = {}, envValues = {}) {
  return [
    row.url ? { label: '原视频', url: row.url, kind: '原视频' } : null,
    row.local_video_path ? { label: '无水印视频', url: assetLink(row.local_video_path, envValues) || row.local_video_path, kind: '无水印视频' } : null,
    row.transcript_path ? { label: '口播文稿', url: assetLink(row.transcript_path, envValues, { inline: true }) || row.transcript_path, kind: '口播文稿' } : null,
    row.srt_path ? { label: 'SRT字幕', url: assetLink(row.srt_path, envValues, { inline: true }) || row.srt_path, kind: '字幕' } : null,
    reports.md ? { label: 'Markdown报告', url: reportLink(reports.md, envValues) || reportFileName(reports.md), kind: '报告' } : null,
    reports.csv ? { label: 'CSV报告', url: reportLink(reports.csv, envValues) || reportFileName(reports.csv), kind: '报告' } : null,
  ].filter(Boolean)
}

function contentOsOpportunity(kind, result, row, index, envValues = {}) {
  const reports = result.parsed?.reports || {}
  const materialKind = kind === 'lowfan' ? '低粉爆款搜索' : '对标账号监控'
  const score = Number(row.viral_score || 0)
  const finalScore = score > 0 ? Math.min(99, Math.max(55, Math.round(score))) : Math.min(92, Math.max(58, Math.round(((row.like_count || 0) + (row.collect_count || 0) + (row.comment_count || 0) + (row.share_count || 0)) / 35)))
  const evidence = [row.hit_reason, rowMetricLine(row), row.source_api ? `来源API：${sourceApiLabel(row.source_api)}` : ''].filter(Boolean)
  return {
    opportunity: {
      id: dedupeKeyForRow(kind, row),
      sourcePlatform: 'douyin',
      sourceKind: materialKind,
      title: truncateText(row.title || '未命名作品', 500),
      summary: materialSummary(row),
      originalUrl: row.url || '',
      author: row.author || '',
      sourceAccount: row.source_account || '',
      keyword: row.keyword || '',
      publishedAt: contentOsTimestamp(row.create_time),
      metrics: [
        { label: '爆款分', value: finalScore },
        { label: '粉丝', value: Number(row.follower_count || 0) },
        { label: '点赞', value: Number(row.like_count || 0) },
        { label: '评论', value: Number(row.comment_count || 0) },
        { label: '收藏', value: Number(row.collect_count || 0) },
        { label: '转发', value: Number(row.share_count || 0) },
      ],
      evidence,
      painPoints: [],
      fitAccounts: contentOsFitAccounts(row),
      angles: [
        operationSuggestion(row, kind, index),
        row.hit_reason || '从标题、封面、口播和评论反馈里拆一个可复用选题。',
      ],
      assets: contentOsAssetList(row, reports, envValues),
      risk: '只作为内容机会进入 Content OS，是否采用、观点和写作判断必须人工确认。',
      status: '已精选',
      workflowStage: 'topic_candidate',
    },
    finalScore,
  }
}

async function upsertContentOsRows(settings, source, kind, result, envValues = {}) {
  const rows = Array.isArray(result.rows) ? result.rows.slice(0, 200) : []
  if (!rows.length) return { rawItems: 0, signals: 0 }
  const rawPayload = rows.map((row, index) => {
    const { opportunity } = contentOsOpportunity(kind, result, row, index, envValues)
    return {
      workspace_id: settings.workspaceId,
      source_id: source.id,
      external_id: dedupeKeyForRow(kind, row),
      title: opportunity.title,
      url: opportunity.originalUrl || row.url || '',
      raw: {
        provider: 'douyin-hot-monitor-studio',
        material_kind: kind,
        row,
        content_opportunity: opportunity,
      },
      fetched_at: new Date().toISOString(),
    }
  })
  const rawItems = await contentOsFetch(settings, 'raw_items?on_conflict=source_id,external_id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: rawPayload,
  })
  const signalPayload = rawItems.map((rawItem, index) => {
    const row = rows[index] || {}
    const { opportunity, finalScore } = contentOsOpportunity(kind, result, row, index, envValues)
    return {
      workspace_id: settings.workspaceId,
      source_id: source.id,
      raw_item_id: rawItem.id,
      title: opportunity.title,
      summary: opportunity.summary,
      url: opportunity.originalUrl || row.url || '',
      published_at: opportunity.publishedAt,
      category: 'benchmark',
      tags: ['抖音', '素材雷达', opportunity.sourceKind, row.keyword || row.source_account || row.author || ''].filter(Boolean),
      relevance_score: finalScore,
      novelty_score: Math.min(98, Math.max(50, finalScore - 3)),
      authority_score: Math.min(95, Math.max(45, Number(row.follower_count || 0) > 50000 ? 72 : 58)),
      actionability_score: Math.min(99, Math.max(55, finalScore + (row.transcript_path ? 4 : 0))),
      conversion_score: Math.min(95, Math.max(50, finalScore - 5)),
      final_score: finalScore,
      selection_threshold: 70,
      status: 'selected',
      reason: opportunity.angles[0] || operationSuggestion(row, kind, index),
      updated_at: new Date().toISOString(),
    }
  })
  const signals = await contentOsFetch(settings, 'signals?on_conflict=raw_item_id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: signalPayload,
  })
  return { rawItems: rawItems.length, signals: signals.length }
}

async function updateContentOsRun(settings, source, kind, result, counts, error = '') {
  await contentOsFetch(settings, 'source_jobs?on_conflict=source_id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: {
      source_id: source.id,
      mode: 'private_worker',
      enabled: true,
      last_status: error ? 'failed' : 'success',
      last_error: error,
      last_run_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  })
  await contentOsFetch(settings, 'monitor_runs', {
    method: 'POST',
    body: {
      workspace_id: settings.workspaceId,
      source_id: source.id,
      connector_kind: 'private_worker',
      runner: 'douyin-hot-monitor-studio',
      status: error ? 'failed' : 'success',
      item_count: Array.isArray(result.rows) ? result.rows.length : 0,
      signal_count: counts.signals || 0,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      error,
      meta: {
        kind,
        command: result.command,
        reports: result.parsed?.reports || {},
      },
    },
  })
}

async function syncRunToContentOs(kind, result, envValues = {}) {
  const settings = contentOsSettings(envValues)
  const rows = Array.isArray(result.rows) ? result.rows : []
  if (!settings.configured) {
    return { configured: false, synced: false, count: 0, enabled: settings.enabled }
  }
  try {
    const source = await ensureContentOsSource(settings)
    if (!source?.id) throw new Error('Content OS source 创建失败')
    const counts = await upsertContentOsRows(settings, source, kind, result, envValues)
    await updateContentOsRun(settings, source, kind, result, counts)
    return {
      configured: true,
      synced: true,
      count: counts.signals,
      rawItems: counts.rawItems,
      signals: counts.signals,
      sourceId: source.id,
      publicUrl: settings.publicUrl,
      rows: rows.length,
    }
  } catch (error) {
    try {
      const source = await ensureContentOsSource(settings)
      if (source?.id) await updateContentOsRun(settings, source, kind, result, { signals: 0 }, error instanceof Error ? error.message : String(error))
    } catch {
      // Keep the original run usable even if run-status writeback also fails.
    }
    return {
      configured: true,
      synced: false,
      count: 0,
      error: error instanceof Error ? error.message : String(error),
      publicUrl: settings.publicUrl,
    }
  }
}

function safeIsoDateTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(+date)) return new Date().toISOString()
  return date.toISOString()
}

function safeLocalDateTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  const normalized = Number.isNaN(+date) ? new Date() : date
  const pad = (number) => String(number).padStart(2, '0')
  return [
    `${normalized.getFullYear()}-${pad(normalized.getMonth() + 1)}-${pad(normalized.getDate())}`,
    `${pad(normalized.getHours())}:${pad(normalized.getMinutes())}:${pad(normalized.getSeconds())}`,
  ].join(' ')
}

function hashText(value) {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 16)
}

function normalizeUrlKey(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  try {
    const url = new URL(text)
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return text.split('?')[0]
  }
}

function dedupeKeyForRow(kind, row = {}) {
  const type = kind === 'lowfan' ? 'lowfan' : 'account'
  if (row.video_id) return `${type}:video:${row.video_id}`
  const urlKey = normalizeUrlKey(row.url)
  if (urlKey) return `${type}:url:${hashText(urlKey)}`
  return `${type}:fallback:${hashText([row.title, row.author, row.source_account, row.create_time].join('|'))}`
}

function reportRunId(reports = {}) {
  const name = reportFileName(reports.md || reports.json || reports.csv)
  return name ? name.replace(/\.(md|json|csv)$/i, '') : safeIsoDateTime()
}

async function readTextPreview(filePath, maxLength = 3500) {
  if (!filePath) return ''
  try {
    const content = await fs.readFile(filePath, 'utf8')
    return truncateText(content, maxLength)
  } catch {
    return ''
  }
}

function materialSummary(row) {
  const author = row.source_account || row.author || '未知账号'
  const reason = row.hit_reason ? `推荐理由：${row.hit_reason}` : '推荐理由：待人工判断'
  return truncateText(`${author} ｜ ${rowMetricLine(row)} ｜ ${reason}`, 700)
}

function contentTypeFromRow(row = {}, kind = '') {
  const text = [row.keyword, row.title, row.hit_reason, row.source_account].join(' ')
  if (/教程|步骤|实操|工具|工作流/.test(text)) return '工具实操'
  if (/短剧|剧本|漫剧|视频号/.test(text)) return 'AI短剧'
  if (/账号|对标|拆解|爆款/.test(text)) return '账号对标'
  return kind === 'lowfan' ? '低粉爆款' : '对标观察'
}

function topicSeed(row = {}, kind = '') {
  const title = truncateText(row.title || '', 80)
  if (!title) return ''
  if (kind === 'lowfan') return `为什么这条低粉内容能跑出来：${title}`
  return `这个对标账号的新内容值得拆：${title}`
}

function operationSuggestion(row, kind, index) {
  if (kind === 'account') {
    const rank = Number(index) + 1
    return `来自监控账号池第 ${rank} 条新素材。建议先判断选题角度、标题结构、口播节奏和评论区反馈；需要创作复用时再下载无水印视频或提取文稿。`
  }
  const keyword = row.keyword ? `关键词“${row.keyword}”` : '本次关键词'
  return `来自${keyword}低粉爆款搜索。建议优先看标题钩子、封面承诺、互动异常点和转发理由；适合沉淀到选题池后再安排改写或视频创作。`
}

async function feishuTenantAccessToken(settings) {
  const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: settings.appId,
      app_secret: settings.appSecret,
    }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload.code !== 0 || !payload.tenant_access_token) {
    throw new Error(payload.msg || `tenant_access_token HTTP ${response.status}`)
  }
  return payload.tenant_access_token
}

async function feishuRecordFields(kind, result, row, index, envValues = {}, options = {}) {
  const reports = result.parsed?.reports || {}
  const runId = reportRunId(reports)
  const materialKind = kind === 'lowfan' ? '低粉爆款搜索' : '对标账号监控'
  const transcriptText = await readTextPreview(row.transcript_path, 3500)
  const fields = {
    去重键: dedupeKeyForRow(kind, row),
    运行ID: runId,
    运行类型: materialKind,
    本次序号: index + 1,
    标题: truncateText(row.title || '未命名作品', 500),
    素材类型: materialKind,
    素材摘要: materialSummary(row),
    口播正文: transcriptText,
    运营建议: operationSuggestion(row, kind, index),
    适配账号: fitAccountLabels(row),
    内容类型: contentTypeFromRow(row, kind),
    选题句: topicSeed(row, kind),
    写作角度: operationSuggestion(row, kind, index),
    素材缺口: transcriptText ? '可先结合口播文稿、评论区和封面继续人工判断。' : '建议补充口播文稿、评论区截图或创作者主页信息。',
    成稿链接: '',
    发布链接: '',
    复盘结论: '',
    作者: row.author || '',
    来源账号: row.source_account || '',
    关键词: row.keyword || '',
    原视频链接: row.url || '',
    封面链接: row.cover_url || '',
    视频源链接: row.video_url || '',
    粉丝数: Number(row.follower_count || 0),
    点赞数: Number(row.like_count || 0),
    评论数: Number(row.comment_count || 0),
    收藏数: Number(row.collect_count || 0),
    转发数: Number(row.share_count || 0),
    爆款分: Number(row.viral_score || 0),
    推荐理由: row.hit_reason || '',
    发布时间: row.create_time || '',
    来源API: sourceApiLabel(row.source_api),
    资产状态: row.transcript_status === 'ok' ? '视频与文稿可用' : row.local_video_path ? '视频可用' : '未下载',
    无水印视频: assetLink(row.local_video_path, envValues) || row.local_video_path || '',
    口播文稿: assetLink(row.transcript_path, envValues, { inline: true }) || row.transcript_path || '',
    SRT字幕: assetLink(row.srt_path, envValues, { inline: true }) || row.srt_path || '',
    Markdown报告: reportLink(reports.md, envValues) || reportFileName(reports.md),
    CSV报告: reportLink(reports.csv, envValues) || reportFileName(reports.csv),
    同步时间: safeLocalDateTime(),
  }
  if (options.includeCollaborationDefaults) {
    fields.处理状态 = '待处理'
    fields.选题价值 = '待评估'
    fields.是否已采纳 = false
  }
  return fields
}

function fieldsWithoutCollaboration(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([field]) => !collaborationFields.has(field)))
}

function fieldsWithoutExtendedFeishu(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([field]) => !extendedFeishuFields.has(field)))
}

function parseJsonFromCliOutput(output) {
  const text = String(output || '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0) return {}
  return JSON.parse(text.slice(start, end + 1))
}

function runLarkCli(settings, args, timeout = 45000) {
  return new Promise((resolve, reject) => {
    execFile(settings.larkCliBin, args, { timeout, maxBuffer: 1024 * 1024 * 4 }, (error, stdout, stderr) => {
      const output = `${stdout || ''}\n${stderr || ''}`.trim()
      if (error) {
        reject(new Error(output || error.message))
        return
      }
      resolve(parseJsonFromCliOutput(output))
    })
  })
}

async function larkCliFindRecord(settings, dedupeKey) {
  const payload = {
    keyword: dedupeKey,
    search_fields: ['去重键'],
    select_fields: ['去重键'],
    limit: 10,
  }
  const response = await runLarkCli(settings, [
    'base',
    '+record-search',
    '--profile',
    settings.larkCliProfile,
    '--as',
    settings.larkCliAs,
    '--base-token',
    settings.baseToken,
    '--table-id',
    settings.tableId,
    '--json',
    JSON.stringify(payload),
    '--format',
    'json',
  ])
  const recordIds = response?.data?.record_id_list || []
  return recordIds[0] || ''
}

async function larkCliUpsertRecord(settings, createFields, updateFields) {
  const recordId = await larkCliFindRecord(settings, createFields.去重键)
  const args = [
    'base',
    '+record-upsert',
    '--profile',
    settings.larkCliProfile,
    '--as',
    settings.larkCliAs,
    '--base-token',
    settings.baseToken,
    '--table-id',
    settings.tableId,
    '--json',
    JSON.stringify(recordId ? updateFields : createFields),
  ]
  if (recordId) args.splice(args.length - 2, 0, '--record-id', recordId)
  const response = await runLarkCli(settings, args)
  return {
    recordId: response?.data?.record?.record_id || recordId,
    created: Boolean(response?.data?.created || !recordId),
    updated: Boolean(response?.data?.updated || recordId),
  }
}

async function feishuApi(settings, token, pathName, options = {}) {
  const response = await fetch(`https://open.feishu.cn/open-apis${pathName}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.msg || `Feishu API HTTP ${response.status}`)
  }
  return payload
}

async function openApiTableFieldNames(settings, token) {
  const payload = await feishuApi(settings, token, `/bitable/v1/apps/${settings.baseToken}/tables/${settings.tableId}/fields?page_size=200`)
  const items = payload?.data?.items || []
  return new Set(items.map((item) => item?.field_name).filter(Boolean))
}

function filterFieldsByNames(fields, fieldNames) {
  if (!fieldNames?.size) return fields
  return Object.fromEntries(Object.entries(fields).filter(([field]) => fieldNames.has(field)))
}

async function openApiFindRecord(settings, token, dedupeKey) {
  const payload = await feishuApi(
    settings,
    token,
    `/bitable/v1/apps/${settings.baseToken}/tables/${settings.tableId}/records/search?page_size=10`,
    {
      method: 'POST',
      body: {
        field_names: ['去重键'],
        filter: {
          conjunction: 'and',
          conditions: [
            {
              field_name: '去重键',
              operator: 'is',
              value: [dedupeKey],
            },
          ],
        },
      },
    },
  )
  const items = payload?.data?.items || []
  const exact = items.find((item) => String(item?.fields?.去重键 || '') === dedupeKey)
  return exact?.record_id || ''
}

async function openApiUpsertRecord(settings, token, createFields, updateFields) {
  const recordId = await openApiFindRecord(settings, token, createFields.去重键)
  if (recordId) {
    const payload = await feishuApi(settings, token, `/bitable/v1/apps/${settings.baseToken}/tables/${settings.tableId}/records/${recordId}`, {
      method: 'PUT',
      body: { fields: updateFields },
    })
    return { recordId: payload?.data?.record?.record_id || recordId, created: false, updated: true }
  }
  const payload = await feishuApi(settings, token, `/bitable/v1/apps/${settings.baseToken}/tables/${settings.tableId}/records`, {
    method: 'POST',
    body: { fields: createFields },
  })
  return { recordId: payload?.data?.record?.record_id || '', created: true, updated: false }
}

async function syncRunToFeishuBase(kind, result, envValues = {}) {
  const settings = feishuBaseSettings(envValues)
  const rows = Array.isArray(result.rows) ? result.rows : []
  if (!settings.configured) {
    return { configured: false, synced: false, count: 0 }
  }
  if (!rows.length) {
    return { configured: true, synced: true, count: 0, baseUrl: settings.baseUrl }
  }

  try {
    const useOpenApi = settings.syncMode === 'openapi' || (settings.syncMode === 'auto' && settings.openApiConfigured)
    const token = useOpenApi ? await feishuTenantAccessToken(settings) : ''
    const tableFieldNames = useOpenApi ? await openApiTableFieldNames(settings, token) : null
    if (tableFieldNames && !tableFieldNames.has('去重键')) {
      throw new Error('飞书 Base 缺少必需字段“去重键”，无法安全去重入库。')
    }
    let created = 0
    let updated = 0
    for (const [index, row] of rows.slice(0, 200).entries()) {
      const rawCreateFields = await feishuRecordFields(kind, result, row, index, envValues, { includeCollaborationDefaults: true })
      const syncCreateFields = useOpenApi ? rawCreateFields : fieldsWithoutExtendedFeishu(rawCreateFields)
      const syncUpdateFields = useOpenApi ? fieldsWithoutCollaboration(rawCreateFields) : fieldsWithoutCollaboration(fieldsWithoutExtendedFeishu(rawCreateFields))
      const createFields = filterFieldsByNames(syncCreateFields, tableFieldNames)
      const updateFields = filterFieldsByNames(syncUpdateFields, tableFieldNames)
      const status = useOpenApi
        ? await openApiUpsertRecord(settings, token, createFields, updateFields)
        : await larkCliUpsertRecord(settings, createFields, updateFields)
      if (status.created) created += 1
      if (status.updated) updated += 1
    }
    return {
      configured: true,
      synced: true,
      mode: useOpenApi ? 'openapi' : 'lark-cli',
      count: created + updated,
      created,
      updated,
      baseUrl: settings.baseUrl,
    }
  } catch (error) {
    return {
      configured: true,
      synced: false,
      count: 0,
      created: 0,
      updated: 0,
      baseUrl: settings.baseUrl,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function truncateText(value, maxLength = 80) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

function compactNumber(value) {
  const number = Number(value || 0)
  if (!Number.isFinite(number) || number <= 0) return '0'
  if (number >= 10000) {
    const compact = number / 10000
    return `${compact >= 10 ? Math.round(compact) : compact.toFixed(1)}万`
  }
  return String(Math.round(number))
}

function cleanCardText(value) {
  return String(value || '').replace(/[<>]/g, '').trim()
}

function reportBaseUrl(envValues = {}) {
  return [
    process.env.FEISHU_REPORT_BASE_URL,
    envValues.FEISHU_REPORT_BASE_URL,
    process.env.DY_HOT_PUBLIC_URL,
    envValues.DY_HOT_PUBLIC_URL,
    process.env.APP_PUBLIC_URL,
    envValues.APP_PUBLIC_URL,
    process.env.PUBLIC_BASE_URL,
    envValues.PUBLIC_BASE_URL,
  ].find((value) => String(value || '').trim())
}

function reportLink(reportPath, envValues = {}) {
  const baseUrl = reportBaseUrl(envValues)
  if (!reportPath || !baseUrl) return ''
  return `${String(baseUrl).replace(/\/$/, '')}/api/reports/${encodeURIComponent(path.basename(reportPath))}`
}

function assetLink(assetPath, envValues = {}, options = {}) {
  const baseUrl = reportBaseUrl(envValues)
  if (!assetPath || !baseUrl) return ''
  const inline = options.inline ? '&inline=1' : ''
  return `${String(baseUrl).replace(/\/$/, '')}/api/assets?path=${encodeURIComponent(assetPath)}${inline}`
}

function reportFileName(reportPath) {
  return reportPath ? path.basename(reportPath) : ''
}

function sourceApiLabel(value) {
  const source = String(value || '').toLowerCase()
  if (source.includes('tikhub')) return 'TikHub 兜底'
  if (source.includes('local')) return '本地解析'
  if (source) return source
  return ''
}

function rowMetricLine(row) {
  return [
    `粉丝 ${compactNumber(row.follower_count)}`,
    `赞 ${compactNumber(row.like_count)}`,
    `评 ${compactNumber(row.comment_count)}`,
    `藏 ${compactNumber(row.collect_count)}`,
    `转 ${compactNumber(row.share_count)}`,
  ].join(' / ')
}

function runCardRow(row, index) {
  const author = row.source_account || row.author || '未知账号'
  const lines = [
    `**${index}. ${cleanCardText(truncateText(row.title || '未命名作品', 58))}**`,
    `${cleanCardText(author)} ｜ ${rowMetricLine(row)}`,
  ]
  if (row.hit_reason) lines.push(`推荐理由：${cleanCardText(truncateText(row.hit_reason, 72))}`)
  const apiLabel = sourceApiLabel(row.source_api)
  if (apiLabel) lines.push(`来源：${apiLabel}`)
  if (row.url) lines.push(`[打开原视频](${row.url})`)
  return lines.join('\n')
}

function runSummaryMarkdown(kind, result, reports, envValues) {
  const rows = Array.isArray(result.rows) ? result.rows : []
  const errors = Array.isArray(result.parsed?.errors) ? result.parsed.errors : []
  const baseSync = result.baseSync || {}
  const contentOsSync = result.contentOsSync || {}
  const reportName = reportFileName(reports.md) || reportFileName(reports.csv)
  const summary = [
    `**结果**：${rows.length} 条`,
    `**类型**：${kind === 'lowfan' ? '低粉爆款搜索' : '对标账号监控'}`,
    reportName ? `**报告**：${reportName}` : '',
  ].filter(Boolean)

  if (!rows.length && result.ok) {
    summary.push('本次没有命中。建议换关键词、放宽阈值，或减少筛选条件后再跑一次。')
  }

  if (errors.length) {
    const message = errors
      .slice(0, 3)
      .map((entry) => `${entry.account || '账号'}：${entry.error || '运行失败'}`)
      .join('\n')
    summary.push(`**需要处理**：\n${cleanCardText(message)}`)
  } else if (!result.ok && result.stderr) {
    summary.push(`**需要处理**：${cleanCardText(result.stderr)}`)
  }

  const link = reportLink(reports.md, envValues)
  if (!link) {
    summary.push('提示：配置 DY_HOT_PUBLIC_URL 或 FEISHU_REPORT_BASE_URL 后，群卡片会出现可点击报告按钮。')
  }
  if (baseSync.configured && baseSync.synced) {
    summary.push(`**飞书多维表格**：已同步 ${baseSync.count || 0} 条（新增 ${baseSync.created || 0} / 更新 ${baseSync.updated || 0}）`)
  } else if (baseSync.configured && !baseSync.synced) {
    summary.push(`**飞书多维表格**：同步失败，${cleanCardText(truncateText(baseSync.error || '请检查 Base 配置和字段结构', 80))}`)
  } else {
    summary.push('**飞书多维表格**：未配置，配置 FEISHU_BASE_APP_TOKEN / FEISHU_BASE_TABLE_ID 后会自动入库。')
  }
  if (contentOsSync.configured && contentOsSync.synced) {
    summary.push(`**Content OS**：已写入 ${contentOsSync.count || 0} 个内容机会`)
  } else if (contentOsSync.configured && !contentOsSync.synced) {
    summary.push(`**Content OS**：同步失败，${cleanCardText(truncateText(contentOsSync.error || '请检查 Supabase 配置', 80))}`)
  } else {
    summary.push('**Content OS**：未配置，素材雷达继续只保留本地报告和飞书结果库。')
  }

  return summary.join('\n')
}

async function sendRunNotification(kind, result, webhook, envValues = {}) {
  if (!webhook) return { configured: false, sent: false }
  const parsed = result.parsed || {}
  const reports = parsed.reports || {}
  const title = kind === 'lowfan' ? '低粉爆款搜索' : '对标账号监控'
  const status = result.ok ? '完成' : '需要处理'
  const rows = Array.isArray(result.rows) ? result.rows : []
  const reportMdUrl = reportLink(reports.md, envValues)
  const reportCsvUrl = reportLink(reports.csv, envValues)
  const elements = [
    {
      tag: 'markdown',
      content: runSummaryMarkdown(kind, result, reports, envValues),
    },
  ]

  if (rows.length) {
    elements.push({ tag: 'hr' })
    const maxRows = boundedNumber(process.env.FEISHU_CARD_MAX_ROWS || envValues.FEISHU_CARD_MAX_ROWS, defaultCardMaxRows, 1, 12)
    for (const [index, row] of rows.slice(0, maxRows).entries()) {
      elements.push({
        tag: 'markdown',
        content: runCardRow(row, index + 1),
      })
    }
    if (rows.length > maxRows) {
      elements.push({
        tag: 'markdown',
        content: `还有 ${rows.length - maxRows} 条没有放进群卡片，完整结果请看 Markdown 报告或飞书多维表格。`,
      })
    }
  }

  const actions = []
  if (reportMdUrl) {
    actions.push({
      tag: 'button',
      text: { tag: 'plain_text', content: '打开 Markdown 报告' },
      url: reportMdUrl,
      type: 'primary',
    })
  }
  if (reportCsvUrl) {
    actions.push({
      tag: 'button',
      text: { tag: 'plain_text', content: '下载 CSV' },
      url: reportCsvUrl,
      type: 'default',
    })
  }
  const firstVideo = rows.find((row) => row.url)?.url
  if (firstVideo) {
    actions.push({
      tag: 'button',
      text: { tag: 'plain_text', content: '打开第一条视频' },
      url: firstVideo,
      type: 'default',
    })
  }
  if (actions.length) {
    elements.push({ tag: 'action', actions: actions.slice(0, 3) })
  }

  elements.push({
    tag: 'note',
    elements: [
      {
        tag: 'plain_text',
        content: `运行时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
      },
    ],
  })

  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msg_type: 'interactive',
      card: {
        config: {
          wide_screen_mode: true,
          enable_forward: true,
        },
        header: {
          template: result.ok ? 'green' : 'orange',
          title: {
            tag: 'plain_text',
            content: `DY HOT ${title}${status}`,
          },
        },
        elements,
      },
    }),
  })
  if (!response.ok) {
    throw new Error(`Feishu webhook HTTP ${response.status}`)
  }
  return { configured: true, sent: true }
}

async function notifyRun(kind, result) {
  const envValues = await readLocalEnvValues()
  const webhook = process.env.FEISHU_RUN_WEBHOOK || envValues.FEISHU_RUN_WEBHOOK || process.env.FEISHU_FEEDBACK_WEBHOOK || envValues.FEISHU_FEEDBACK_WEBHOOK || ''
  try {
    return await sendRunNotification(kind, result, webhook, envValues)
  } catch (error) {
    return {
      configured: Boolean(webhook),
      sent: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function finalizeRun(kind, result) {
  const envValues = await readLocalEnvValues()
  const baseSync = await syncRunToFeishuBase(kind, result, envValues)
  const contentOsSync = await syncRunToContentOs(kind, result, envValues)
  const enriched = { ...result, baseSync, contentOsSync }
  return { ...enriched, notification: await notifyRun(kind, enriched) }
}

function booleanEnv(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'on', '开启', '启用'].includes(String(value).trim().toLowerCase())
}

function dailyRunSettings(envValues = {}, overrides = {}) {
  const rawTime = String(overrides.time || process.env.DY_HOT_DAILY_RUN_TIME || envValues.DY_HOT_DAILY_RUN_TIME || '09:30').trim()
  const time = /^\d{2}:\d{2}$/.test(rawTime) ? rawTime : '09:30'
  return {
    enabled: overrides.enabled === undefined ? booleanEnv(process.env.DY_HOT_DAILY_RUN_ENABLED || envValues.DY_HOT_DAILY_RUN_ENABLED, false) : Boolean(overrides.enabled),
    time,
    keyword: String(overrides.keyword || process.env.DY_HOT_DAILY_KEYWORD || envValues.DY_HOT_DAILY_KEYWORD || 'AI智能体').trim() || 'AI智能体',
    publishTime: String(overrides.publishTime || process.env.DY_HOT_DAILY_PUBLISH_TIME || envValues.DY_HOT_DAILY_PUBLISH_TIME || '最近一周').trim() || '最近一周',
    duration: String(overrides.duration || process.env.DY_HOT_DAILY_DURATION || envValues.DY_HOT_DAILY_DURATION || '不限').trim() || '不限',
    sort: String(overrides.sort || process.env.DY_HOT_DAILY_SORT || envValues.DY_HOT_DAILY_SORT || '最多点赞').trim() || '最多点赞',
    pages: boundedNumber(overrides.pages ?? process.env.DY_HOT_DAILY_PAGES ?? envValues.DY_HOT_DAILY_PAGES, 2, 1, 10),
    count: boundedNumber(overrides.count ?? process.env.DY_HOT_DAILY_COUNT ?? envValues.DY_HOT_DAILY_COUNT, 20, 5, 50),
    accountLimit: boundedNumber(overrides.accountLimit ?? process.env.DY_HOT_DAILY_ACCOUNT_LIMIT ?? envValues.DY_HOT_DAILY_ACCOUNT_LIMIT, 2, 1, 50),
    accountTimeout: boundedNumber(overrides.accountTimeout ?? process.env.DY_HOT_DAILY_ACCOUNT_TIMEOUT ?? envValues.DY_HOT_DAILY_ACCOUNT_TIMEOUT, 30, 5, 180),
    maxAccounts: overrides.maxAccounts || process.env.DY_HOT_DAILY_MAX_ACCOUNTS || envValues.DY_HOT_DAILY_MAX_ACCOUNTS || 'all',
    download: overrides.download === undefined ? booleanEnv(process.env.DY_HOT_DAILY_DOWNLOAD_VIDEO || envValues.DY_HOT_DAILY_DOWNLOAD_VIDEO, false) : Boolean(overrides.download),
    transcribe: overrides.transcribe === undefined ? booleanEnv(process.env.DY_HOT_DAILY_TRANSCRIBE || envValues.DY_HOT_DAILY_TRANSCRIBE, false) : Boolean(overrides.transcribe),
  }
}

function localDateKey(date = new Date()) {
  const pad = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function timeMatchesDailyTarget(now, time) {
  const [hour, minute] = time.split(':').map((part) => Number(part))
  return now.getHours() === hour && now.getMinutes() === minute
}

function rankedRows(results) {
  return results
    .flatMap((entry) => (Array.isArray(entry.result?.rows) ? entry.result.rows.map((row) => ({ ...row, _kind: entry.kind })) : []))
    .sort((a, b) => {
      const scoreA = Number(a.viral_score || 0) || Number(a.share_count || 0) + Number(a.collect_count || 0)
      const scoreB = Number(b.viral_score || 0) || Number(b.share_count || 0) + Number(b.collect_count || 0)
      return scoreB - scoreA
    })
}

function collectDailyErrors(results) {
  return results.flatMap((entry) => {
    const errors = Array.isArray(entry.result?.parsed?.errors) ? entry.result.parsed.errors : []
    return errors.map((error) => ({
      kind: entry.kind,
      account: error.account || error.route || '未知来源',
      error: error.error || '运行异常',
    }))
  })
}

function dailySummaryMarkdown(summary, envValues) {
  const lines = [
    `**今日新增**：${summary.createdCount} 条`,
    `**本次命中**：低粉爆款 ${summary.lowfanRows} 条 / 对标账号 ${summary.accountRows} 条`,
    `**入库状态**：新增 ${summary.createdCount} / 更新 ${summary.updatedCount}`,
  ]
  if (summary.errors.length) {
    lines.push(`**异常账号/线路**：${summary.errors.slice(0, 5).map((entry) => `${entry.account}：${truncateText(entry.error, 60)}`).join('\n')}`)
  } else {
    lines.push('**异常账号/线路**：暂无')
  }
  const baseUrl = feishuBaseSettings(envValues).baseUrl
  if (baseUrl) lines.push(`**结果库**：[打开 DY HOT 抖音监控结果库](${baseUrl})`)
  return lines.join('\n')
}

async function sendDailyNotification(summary, webhook, envValues = {}) {
  if (!webhook) return { configured: false, sent: false }
  const topRows = summary.topRows.slice(0, 5)
  const elements = [
    {
      tag: 'markdown',
      content: dailySummaryMarkdown(summary, envValues),
    },
  ]
  if (topRows.length) {
    elements.push({ tag: 'hr' })
    for (const [index, row] of topRows.entries()) {
      elements.push({
        tag: 'markdown',
        content: runCardRow(row, index + 1),
      })
    }
  }
  const actions = []
  const baseUrl = feishuBaseSettings(envValues).baseUrl
  if (baseUrl) {
    actions.push({
      tag: 'button',
      text: { tag: 'plain_text', content: '打开结果库' },
      url: baseUrl,
      type: 'primary',
    })
  }
  const firstReport = summary.reports.find((report) => report.mdUrl)
  if (firstReport?.mdUrl) {
    actions.push({
      tag: 'button',
      text: { tag: 'plain_text', content: '打开最新报告' },
      url: firstReport.mdUrl,
      type: 'default',
    })
  }
  if (actions.length) elements.push({ tag: 'action', actions: actions.slice(0, 3) })
  elements.push({
    tag: 'note',
    elements: [{ tag: 'plain_text', content: `日报时间：${new Date().toLocaleString('zh-CN', { hour12: false })}` }],
  })

  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msg_type: 'interactive',
      card: {
        config: { wide_screen_mode: true, enable_forward: true },
        header: {
          template: summary.errors.length ? 'orange' : 'green',
          title: { tag: 'plain_text', content: 'DY HOT 每日监控日报' },
        },
        elements,
      },
    }),
  })
  if (!response.ok) throw new Error(`Feishu webhook HTTP ${response.status}`)
  return { configured: true, sent: true }
}

function resultReportLinks(result, envValues) {
  const reports = result.parsed?.reports || {}
  return {
    mdUrl: reportLink(reports.md, envValues),
    csvUrl: reportLink(reports.csv, envValues),
  }
}

async function runDailyMonitor(reason = 'manual', overrides = {}) {
  if (dailyRunState.running) {
    return { ok: false, running: true, reason, error: '每日监控正在运行中' }
  }
  dailyRunState.running = true
  try {
    const envValues = await readLocalEnvValues()
    const settings = dailyRunSettings(envValues, overrides)
    const config = await readJson(configPath, {})
    const lowFanConfig = normalizeLowFanConfig(config.low_fan_hits)
    const results = []

    const lowfanResult = await runMonitorWithRows([
      'lowfan-search',
      settings.keyword,
      '--publish-time',
      settings.publishTime,
      '--duration',
      settings.duration,
      '--sort',
      settings.sort,
      '--route',
      String(lowFanConfig.route),
      '--pages',
      String(settings.pages),
      '--count',
      String(settings.count),
      '--fallback-route',
    ])
    const lowfanBaseSync = await syncRunToFeishuBase('lowfan', lowfanResult, envValues)
    const lowfanContentOsSync = await syncRunToContentOs('lowfan', lowfanResult, envValues)
    results.push({ kind: 'lowfan', result: { ...lowfanResult, baseSync: lowfanBaseSync, contentOsSync: lowfanContentOsSync } })

    const accountMonitor = config.account_monitor || {}
    const accounts = enabledAccounts(config)
    if (accounts.length) {
      const runConfig = {
        ...config,
        account_monitor: {
          ...accountMonitor,
          accounts,
        },
      }
      const runConfigPath = path.join(monitorDir, '.tmp-daily-account-run.config.json')
      await saveJson(runConfigPath, runConfig)
      try {
        const accountArgs = [
          '--config',
          runConfigPath,
          'account-run',
          '--limit',
          String(settings.accountLimit),
          '--timeout',
          String(settings.accountTimeout),
        ]
        if (settings.maxAccounts && settings.maxAccounts !== 'all') {
          accountArgs.push('--max-accounts', String(asPositiveNumber(settings.maxAccounts, 3)))
        }
        if (settings.download) accountArgs.push('--download')
        if (settings.transcribe) accountArgs.push('--transcribe')
        const accountResult = await runMonitorWithRows(accountArgs)
        const accountBaseSync = await syncRunToFeishuBase('account', accountResult, envValues)
        const accountContentOsSync = await syncRunToContentOs('account', accountResult, envValues)
        results.push({ kind: 'account', result: { ...accountResult, baseSync: accountBaseSync, contentOsSync: accountContentOsSync } })
      } finally {
        await fs.rm(runConfigPath, { force: true })
      }
    }

    const summary = {
      ok: results.every((entry) => entry.result.ok || (Array.isArray(entry.result.rows) && entry.result.rows.length)),
      reason,
      date: localDateKey(),
      lowfanRows: results.find((entry) => entry.kind === 'lowfan')?.result.rows?.length || 0,
      accountRows: results.find((entry) => entry.kind === 'account')?.result.rows?.length || 0,
      createdCount: results.reduce((sum, entry) => sum + (entry.result.baseSync?.created || 0), 0),
      updatedCount: results.reduce((sum, entry) => sum + (entry.result.baseSync?.updated || 0), 0),
      topRows: rankedRows(results),
      errors: collectDailyErrors(results),
      reports: results.map((entry) => resultReportLinks(entry.result, envValues)),
      baseSync: results.map((entry) => ({ kind: entry.kind, ...entry.result.baseSync })),
      contentOsSync: results.map((entry) => ({ kind: entry.kind, ...entry.result.contentOsSync })),
    }

    const webhook = process.env.FEISHU_DAILY_WEBHOOK || envValues.FEISHU_DAILY_WEBHOOK || process.env.FEISHU_RUN_WEBHOOK || envValues.FEISHU_RUN_WEBHOOK || process.env.FEISHU_FEEDBACK_WEBHOOK || envValues.FEISHU_FEEDBACK_WEBHOOK || ''
    try {
      summary.notification = await sendDailyNotification(summary, webhook, envValues)
    } catch (error) {
      summary.notification = {
        configured: Boolean(webhook),
        sent: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
    return summary
  } finally {
    dailyRunState.running = false
  }
}

async function maybeRunDailySchedule() {
  const envValues = await readLocalEnvValues()
  const settings = dailyRunSettings(envValues)
  if (!settings.enabled) return
  const now = new Date()
  const today = localDateKey(now)
  if (dailyRunState.lastDateKey === today || !timeMatchesDailyTarget(now, settings.time)) return
  dailyRunState.lastDateKey = today
  runDailyMonitor('schedule').catch((error) => {
    console.error('DY HOT daily run failed:', error instanceof Error ? error.message : String(error))
  })
}

function startDailyScheduler() {
  setInterval(() => {
    maybeRunDailySchedule().catch((error) => {
      console.error('DY HOT daily scheduler failed:', error instanceof Error ? error.message : String(error))
    })
  }, 60 * 1000)
}

async function settingsStatus(config = null) {
  const envValues = await readLocalEnvValues()
  const cfg = config || await readJson(configPath, {})
  const transcription = cfg.transcription || {}
  const tikhub = process.env.TIKHUB_API_KEY || envValues.TIKHUB_API_KEY || ''
  const lemonfox = process.env.LEMONFOX_API_KEY || envValues.LEMONFOX_API_KEY || ''
  const localApiBase = process.env.LOCAL_API_BASE || envValues.LOCAL_API_BASE || cfg.local_api_base || 'http://127.0.0.1:8091'
  const modules = await checkPythonModules(['faster_whisper', 'whisper'])
  const parserConfig = await douyinWebConfigStatus()
  return {
    tikhub: {
      configured: Boolean(tikhub),
    },
    lemonfox: {
      configured: Boolean(lemonfox),
    },
    transcription: {
      provider: normalizeProvider(process.env.TRANSCRIPTION_PROVIDER || transcription.provider),
      language: process.env.TRANSCRIPTION_LANGUAGE || transcription.language || 'zh',
      localModel: process.env.TRANSCRIPTION_LOCAL_MODEL || transcription.local_model || 'small',
      localDevice: process.env.TRANSCRIPTION_LOCAL_DEVICE || transcription.local_device || 'auto',
      localComputeType: process.env.TRANSCRIPTION_LOCAL_COMPUTE_TYPE || transcription.local_compute_type || 'int8',
      prompt: process.env.TRANSCRIPTION_PROMPT || transcription.prompt || '请使用标点符号：，。、；：？！',
      providers: {
        lemonfox: {
          available: Boolean(lemonfox),
          detail: lemonfox ? 'LEMONFOX_API_KEY 已配置' : '需要配置 LEMONFOX_API_KEY',
        },
        fasterWhisper: {
          available: Boolean(modules.faster_whisper),
          detail: modules.faster_whisper ? 'Python 模块 faster_whisper 可用' : '当前 Python 环境缺少 faster-whisper',
        },
        whisper: {
          available: Boolean(modules.whisper),
          detail: modules.whisper ? 'Python 模块 whisper 可用' : '当前 Python 环境缺少 openai-whisper',
        },
      },
    },
    runtime: {
      localApiBase,
      pythonBin: python,
      monitorDir,
    },
    parserConfig,
    feishuBase: {
      configured: feishuBaseSettings(envValues).configured,
      baseUrl: feishuBaseSettings(envValues).baseUrl,
    },
    dailyRun: dailyRunSettings(envValues),
  }
}

app.get('/api/dashboard', async (_req, res) => {
  const config = await readJson(configPath, {})
  const envValues = await readLocalEnvValues()
  const lowFanConfig = normalizeLowFanConfig(config.low_fan_hits)
  const outputDir = path.resolve(monitorDir, config.output_dir || '../../douyin-monitor-output')
  const reports = await listReports(outputDir)
  const state = await readJson(config.state_path || path.join(outputDir, 'state.json'), {})
  const service = await getServiceStatus(config.local_api_base || 'http://127.0.0.1:8091')
  const settings = await settingsStatus(config)
  res.json({
    service,
    config: {
      accountCount: config.account_monitor?.accounts?.length || 0,
      enabledAccountCount: enabledAccounts(config).length,
      accounts: summarizeAccounts(config),
      countPerAccount: config.account_monitor?.count_per_account || 2,
      downloadVideo: Boolean(config.account_monitor?.download_video),
      transcribe: Boolean(config.account_monitor?.transcribe),
      outputDir,
      thresholds: {
        fans_num: lowFanConfig.fans_num,
        likes: lowFanConfig.likes,
        collect: lowFanConfig.collect,
        comment: lowFanConfig.comment,
        share: lowFanConfig.share,
      },
      defaultLowFan: {
        count: lowFanConfig.count,
        pages: lowFanConfig.max_pages,
        route: lowFanConfig.route,
      },
      hasTikhubKey: settings.tikhub.configured,
      hasLemonfoxKey: settings.lemonfox.configured,
      integrations: settings,
    },
    reports,
    latestRows: await latestRows(reports),
    latestLowfanRows: await latestRowsByKind(reports, 'lowfan'),
    latestAccountRows: await latestRowsByKind(reports, 'account_new'),
    feedback: feedbackSettings(envValues),
    state,
  })
})

app.get('/api/reports/:name', async (req, res) => {
  const config = await readJson(configPath, {})
  const outputDir = path.resolve(monitorDir, config.output_dir || '../../douyin-monitor-output')
  const safeName = path.basename(String(req.params.name || ''))
  const reportPath = path.join(outputDir, 'runs', safeName)
  if (!(await exists(reportPath))) {
    res.status(404).send('报告不存在')
    return
  }
  res.download(reportPath, safeName)
})

app.get('/api/assets', async (req, res) => {
  const config = await readJson(configPath, {})
  const outputDir = path.resolve(monitorDir, config.output_dir || '../../douyin-monitor-output')
  const assetsDir = path.join(outputDir, 'assets')
  const rawPath = String(req.query.path || '')
  const inline = String(req.query.inline || '') === '1'
  const assetPath = path.resolve(rawPath)
  if (!rawPath || !assetPath.startsWith(`${assetsDir}${path.sep}`)) {
    res.status(403).send('资产路径不允许访问')
    return
  }
  if (!(await exists(assetPath))) {
    res.status(404).send('资产不存在')
    return
  }
  const textLikeTypes = new Set(['.txt', '.srt', '.vtt', '.md', '.csv', '.json'])
  if (inline && textLikeTypes.has(path.extname(assetPath).toLowerCase())) {
    const ext = path.extname(assetPath).toLowerCase()
    const mime = ext === '.md' ? 'text/markdown' : ext === '.json' ? 'application/json' : ext === '.csv' ? 'text/csv' : 'text/plain'
    res.type(`${mime}; charset=utf-8`)
    res.send(await fs.readFile(assetPath, 'utf8'))
    return
  }
  res.download(assetPath, path.basename(assetPath))
})

app.get('/api/settings/integrations', async (_req, res) => {
  res.json(await settingsStatus())
})

app.post('/api/settings/integrations', async (req, res) => {
  const tikhubKey = String(req.body?.tikhubKey || '').trim()
  const lemonfoxKey = String(req.body?.lemonfoxKey || '').trim()
  const transcription = req.body?.transcription || {}
  const provider = normalizeProvider(transcription.provider)
  const language = String(transcription.language || 'zh').trim() || 'zh'
  const localModel = String(transcription.localModel || 'small').trim() || 'small'
  const localDevice = String(transcription.localDevice || 'auto').trim() || 'auto'
  const localComputeType = String(transcription.localComputeType || 'int8').trim() || 'int8'
  const prompt = String(transcription.prompt || '请使用标点符号：，。、；：？！').trim()

  const envUpdates = {
    TRANSCRIPTION_PROVIDER: provider,
    TRANSCRIPTION_LANGUAGE: language,
    TRANSCRIPTION_LOCAL_MODEL: localModel,
    TRANSCRIPTION_LOCAL_DEVICE: localDevice,
    TRANSCRIPTION_LOCAL_COMPUTE_TYPE: localComputeType,
    TRANSCRIPTION_PROMPT: prompt,
  }
  if (tikhubKey) envUpdates.TIKHUB_API_KEY = tikhubKey
  if (lemonfoxKey) envUpdates.LEMONFOX_API_KEY = lemonfoxKey
  await writeLocalEnvValues(envUpdates)

  Object.assign(process.env, envUpdates)
  if (tikhubKey) process.env.TIKHUB_API_KEY = tikhubKey
  if (lemonfoxKey) process.env.LEMONFOX_API_KEY = lemonfoxKey

  const config = await readJson(configPath, {})
  config.transcription = {
    ...(config.transcription || {}),
    provider,
    language,
    local_model: localModel,
    local_device: localDevice,
    local_compute_type: localComputeType,
    prompt,
  }
  await saveJson(configPath, config)

  res.json({ ok: true, integrations: await settingsStatus(config) })
})

app.post('/api/settings/runtime', async (req, res) => {
  const localApiBase = String(req.body?.localApiBase || '').trim()
  const pythonBin = String(req.body?.pythonBin || '').trim()
  const nextMonitorDir = String(req.body?.monitorDir || '').trim()
  const updates = {}
  if (localApiBase) updates.LOCAL_API_BASE = localApiBase
  if (pythonBin) updates.PYTHON_BIN = pythonBin
  if (nextMonitorDir) updates.MONITOR_DIR = nextMonitorDir
  if (!Object.keys(updates).length) {
    res.status(400).json({ ok: false, error: '没有可保存的后台配置' })
    return
  }
  await writeLocalEnvValues(updates)
  Object.assign(process.env, updates)
  refreshRuntimeConfig()
  res.json({ ok: true, integrations: await settingsStatus() })
})

app.post('/api/settings/thresholds', async (req, res) => {
  const config = await readJson(configPath, {})
  const current = normalizeLowFanConfig(config.low_fan_hits)
  const body = req.body || {}
  const next = normalizeLowFanConfig({
    ...current,
    fans_num: body.fansNum,
    likes: body.likes,
    collect: body.collect,
    comment: body.comment,
    share: body.share,
    count: body.count,
    max_pages: body.pages,
    route: body.route,
  })

  config.low_fan_hits = next
  await saveJson(configPath, config)

  res.json({
    ok: true,
    thresholds: {
      fans_num: next.fans_num,
      likes: next.likes,
      collect: next.collect,
      comment: next.comment,
      share: next.share,
    },
    defaultLowFan: {
      count: next.count,
      pages: next.max_pages,
      route: next.route,
    },
  })
})

app.post('/api/settings/accounts', async (req, res) => {
  const config = await readJson(configPath, {})
  const current = config.account_monitor || {}
  const next = normalizeAccountMonitorConfig(req.body || {}, current)
  if (next.error) {
    res.status(400).json({ ok: false, error: next.error })
    return
  }

  config.account_monitor = {
    ...current,
    ...next,
  }
  await saveJson(configPath, config)

  res.json({
    ok: true,
    accountMonitor: {
      accountCount: config.account_monitor.accounts.length,
      enabledAccountCount: enabledAccounts(config).length,
      accounts: summarizeAccounts(config),
      countPerAccount: config.account_monitor.count_per_account,
      downloadVideo: config.account_monitor.download_video,
      transcribe: config.account_monitor.transcribe,
    },
  })
})

app.post('/api/run/account', async (req, res) => {
  const body = req.body || {}
  const config = await readJson(configPath, {})
  const current = config.account_monitor || {}
  let accountMonitor = current

  if (Array.isArray(body.accounts)) {
    const next = normalizeAccountMonitorConfig(
      {
        accounts: body.accounts,
        countPerAccount: body.limit,
        downloadVideo: body.download,
        transcribe: body.transcribe,
      },
      current,
    )
    if (next.error) {
      res.status(400).json({ ok: false, command: 'account-run', code: 1, stdout: '', stderr: next.error })
      return
    }
    accountMonitor = {
      ...current,
      ...next,
    }
  }

  const accounts = (accountMonitor.accounts || []).filter((account) => account.enabled !== false)
  if (!accounts.length) {
    res.status(400).json({ ok: false, command: 'account-run', code: 1, stdout: '', stderr: '没有启用的对标账号' })
    return
  }

  const runConfig = {
    ...config,
    account_monitor: {
      ...accountMonitor,
      accounts,
    },
  }
  const runConfigPath = path.join(monitorDir, '.tmp-account-run.config.json')
  await saveJson(runConfigPath, runConfig)
  const args = [
    '--config',
    runConfigPath,
    'account-run',
    '--limit',
    String(asPositiveNumber(body.limit, 2)),
    '--timeout',
    String(asPositiveNumber(body.timeout, 30)),
  ]
  if (body.maxAccounts && body.maxAccounts !== 'all') {
    args.push('--max-accounts', String(asPositiveNumber(body.maxAccounts, 3)))
  }
  if (body.includeSeen) args.push('--include-seen')
  if (body.download) args.push('--download')
  if (body.transcribe) args.push('--transcribe')
  try {
    const result = await runMonitorWithRows(args)
    res.json(await finalizeRun('account', result))
  } finally {
    await fs.rm(runConfigPath, { force: true })
  }
})

app.post('/api/feedback', async (req, res) => {
  const envValues = await readLocalEnvValues()
  const webhook = process.env.FEISHU_FEEDBACK_WEBHOOK || envValues.FEISHU_FEEDBACK_WEBHOOK || ''
  const feedback = {
    message: sanitizeFeedbackText(req.body?.message, 2000),
    contact: sanitizeFeedbackText(req.body?.contact, 200),
    page: sanitizeFeedbackText(req.body?.page, 100),
    createdAt: new Date().toISOString(),
  }
  if (!feedback.message) {
    res.status(400).json({ ok: false, webhookConfigured: Boolean(webhook), error: '反馈内容不能为空' })
    return
  }

  try {
    const notification = await sendFeedbackNotification(feedback, webhook)
    res.json({ ok: true, ...notification, ...feedbackSettings(envValues) })
  } catch (error) {
    res.status(502).json({
      ok: false,
      webhookConfigured: Boolean(webhook),
      error: error instanceof Error ? error.message : String(error),
      ...feedbackSettings(envValues),
    })
  }
})

app.post('/api/run/lowfan', async (req, res) => {
  const body = req.body || {}
  const config = await readJson(configPath, {})
  const lowFanConfig = normalizeLowFanConfig(config.low_fan_hits)
  const args = [
    'lowfan-search',
    body.keyword || 'AI智能体',
    '--publish-time',
    body.publishTime || '最近一周',
    '--duration',
    body.duration || '不限',
    '--sort',
    body.sort || '最多点赞',
    '--route',
    String(body.route === 2 || body.route === '2' ? 2 : 1),
    '--pages',
    String(asPositiveNumber(body.pages, lowFanConfig.max_pages)),
    '--count',
    String(asPositiveNumber(body.count, lowFanConfig.count)),
  ]
  if (body.fallbackRoute !== false) args.push('--fallback-route')
  const result = await runMonitorWithRows(args)
  res.json(await finalizeRun('lowfan', result))
})

app.post('/api/run/daily', async (req, res) => {
  res.json(await runDailyMonitor('manual', req.body || {}))
})

app.post('/api/settings/douyin-session', async (req, res) => {
  const sessionid = String(req.body?.sessionid || '').trim()
  if (!/^[A-Za-z0-9]{24,128}$/.test(sessionid)) {
    res.status(400).json({ ok: false, error: 'sessionid 格式不对' })
    return
  }
  if (!douyinWebConfigPath) {
    res.status(400).json({ ok: false, error: 'DOUYIN_WEB_CONFIG 未配置；请先挂载解析服务 config.yaml 并设置该路径。' })
    return
  }
  const configStatus = await douyinWebConfigStatus()
  if (!configStatus.writable) {
    res.status(400).json({ ok: false, error: `DOUYIN_WEB_CONFIG 不可写：${configStatus.detail}` })
    return
  }

  const content = await fs.readFile(douyinWebConfigPath, 'utf8')
  const cookieLine = `      Cookie: sessionid=${sessionid};`
  const next = content.match(/^\s*Cookie:\s*.*$/m)
    ? content.replace(/^\s*Cookie:\s*.*$/m, cookieLine)
    : content.replace(/(\s*Referer:\s*https:\/\/www\.douyin\.com\/\n)/, `$1${cookieLine}\n`)
  await fs.writeFile(douyinWebConfigPath, next, 'utf8')
  res.json({ ok: true, masked: `${sessionid.slice(0, 6)}...${sessionid.slice(-4)}` })
})

app.use('/assets', express.static(path.join(__dirname, 'dist')))

await loadLocalEnv()
refreshRuntimeConfig()
startDailyScheduler()

app.listen(port, host, () => {
  console.log(`Douyin monitor API listening on http://${host}:${port}`)
})
