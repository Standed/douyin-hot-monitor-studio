import cors from 'cors'
import express from 'express'
import { execFile } from 'node:child_process'
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
  formUrl: 'https://xiyangshiai.feishu.cn/base/RauKbsrBkakfgOshWymciovnn38?table=tbluyxSuTJzzm4tw&view=vewSjYQe24',
  baseUrl: 'https://xiyangshiai.feishu.cn/base/RauKbsrBkakfgOshWymciovnn38',
  formId: 'vewSjYQe24',
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

function normalizeAccountMonitorConfig(value = {}, current = {}) {
  const incomingAccounts = Array.isArray(value.accounts) ? value.accounts : current.accounts || []
  const accounts = []

  for (const account of incomingAccounts) {
    const name = String(account?.name || '').trim()
    const secUserId = String(account?.secUserId || account?.sec_user_id || '').trim()
    if (!name && !secUserId) continue
    if (!name || !secUserId) {
      return { error: '账号名称和 sec_user_id 都要填写；空白行可以直接留空。' }
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

function runMonitor(args) {
  return new Promise((resolve) => {
    const command = `${python} ${monitorScript} ${args.join(' ')}`
    execFile(python, [monitorScript, ...args], { cwd: monitorDir, env: process.env, timeout: 1000 * 300, maxBuffer: 1024 * 1024 * 8 }, (error, stdout, stderr) => {
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
  return {
    configured: Boolean(appId && appSecret && baseToken && tableId),
    appId,
    appSecret,
    baseToken,
    tableId,
    baseUrl: baseToken ? `https://xiyangshiai.feishu.cn/base/${baseToken}` : '',
  }
}

function safeIsoDateTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(+date)) return new Date().toISOString()
  return date.toISOString()
}

function reportRunId(reports = {}) {
  const name = reportFileName(reports.md || reports.json || reports.csv)
  return name ? name.replace(/\.(md|json|csv)$/i, '') : safeIsoDateTime()
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

function feishuRecordFields(kind, result, row, index, envValues = {}) {
  const reports = result.parsed?.reports || {}
  const runId = reportRunId(reports)
  return {
    运行ID: runId,
    运行类型: kind === 'lowfan' ? '低粉爆款搜索' : '对标账号监控',
    本次序号: index + 1,
    标题: truncateText(row.title || '未命名作品', 500),
    作者: row.author || '',
    来源账号: row.source_account || '',
    关键词: row.keyword || '',
    视频ID: row.video_id || '',
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
    Markdown报告: reportLink(reports.md, envValues) || reportFileName(reports.md),
    CSV报告: reportLink(reports.csv, envValues) || reportFileName(reports.csv),
    同步时间: safeIsoDateTime(),
  }
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
    const token = await feishuTenantAccessToken(settings)
    const records = rows.slice(0, 200).map((row, index) => ({
      fields: feishuRecordFields(kind, result, row, index, envValues),
    }))
    const response = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${settings.baseToken}/tables/${settings.tableId}/records/batch_create`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ records }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || payload.code !== 0) {
      throw new Error(payload.msg || `bitable batch_create HTTP ${response.status}`)
    }
    return {
      configured: true,
      synced: true,
      count: records.length,
      baseUrl: settings.baseUrl,
    }
  } catch (error) {
    return {
      configured: true,
      synced: false,
      count: 0,
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
    summary.push(`**飞书多维表格**：已同步 ${baseSync.count || 0} 条`)
  } else if (baseSync.configured && !baseSync.synced) {
    summary.push(`**飞书多维表格**：同步失败，${cleanCardText(truncateText(baseSync.error || '请检查 Base 配置和字段结构', 80))}`)
  } else {
    summary.push('**飞书多维表格**：未配置，配置 FEISHU_BASE_APP_TOKEN / FEISHU_BASE_TABLE_ID 后会自动入库。')
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
  const enriched = { ...result, baseSync }
  return { ...enriched, notification: await notifyRun(kind, enriched) }
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
      masked: maskSecret(tikhub),
    },
    lemonfox: {
      configured: Boolean(lemonfox),
      masked: maskSecret(lemonfox),
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

app.listen(port, host, () => {
  console.log(`Douyin monitor API listening on http://${host}:${port}`)
})
