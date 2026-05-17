import cors from 'cors'
import express from 'express'
import { execFile } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const defaultMonitorDir = path.resolve(__dirname, '../douyin-monitor')
const monitorDir = process.env.MONITOR_DIR || defaultMonitorDir
const monitorScript = path.join(monitorDir, 'douyin_monitor.py')
const python = process.env.PYTHON_BIN || '/opt/homebrew/bin/python3.12'
const configPath = path.join(monitorDir, 'config.json')
const douyinWebConfigPath = process.env.DOUYIN_WEB_CONFIG || ''
const app = express()
const port = 8787

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
      if (key && process.env[key] === undefined) {
        process.env[key] = value
      }
    }
  } catch {
    // Local env file is optional.
  }
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

async function exists(file) {
  try {
    await fs.access(file, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

async function getServiceStatus(apiBase) {
  try {
    const response = await fetch(`${apiBase.replace(/\/$/, '')}/openapi.json`, { signal: AbortSignal.timeout(3000) })
    return {
      ok: response.ok,
      apiBase,
      checkedAt: new Date().toISOString(),
      error: response.ok ? undefined : `HTTP ${response.status}`,
    }
  } catch (error) {
    return {
      ok: false,
      apiBase,
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
  }))
}

function asPositiveNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback
}

function runMonitor(args) {
  return new Promise((resolve) => {
    const command = `${python} ${monitorScript} ${args.join(' ')}`
    execFile(python, [monitorScript, ...args], { cwd: monitorDir, env: process.env, timeout: 1000 * 90, maxBuffer: 1024 * 1024 * 8 }, (error, stdout, stderr) => {
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

async function runMonitorWithRows(args) {
  const result = await runMonitor(args)
  const parsed = parseMonitorOutput(result.stdout)
  const jsonPath = parsed?.reports?.json
  return {
    ...result,
    parsed,
    rows: typeof jsonPath === 'string' ? await reportRows(jsonPath) : [],
  }
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

app.get('/api/dashboard', async (_req, res) => {
  const config = await readJson(configPath, {})
  const outputDir = path.resolve(monitorDir, config.output_dir || '../../douyin-monitor-output')
  const reports = await listReports(outputDir)
  const state = await readJson(config.state_path || path.join(outputDir, 'state.json'), {})
  const service = await getServiceStatus(config.local_api_base || 'http://127.0.0.1:8091')
  res.json({
    service,
    config: {
      accountCount: config.account_monitor?.accounts?.length || 0,
      accounts: summarizeAccounts(config),
      countPerAccount: config.account_monitor?.count_per_account || 2,
      outputDir,
      thresholds: config.low_fan_hits || {},
      defaultLowFan: {
        count: config.low_fan_hits?.count || 20,
        pages: config.low_fan_hits?.max_pages || 2,
        route: config.low_fan_hits?.route || 2,
      },
      hasTikhubKey: Boolean(process.env.TIKHUB_API_KEY),
      hasLemonfoxKey: Boolean(process.env.LEMONFOX_API_KEY),
    },
    reports,
    latestRows: await latestRows(reports),
    state,
  })
})

app.post('/api/run/account', async (req, res) => {
  const body = req.body || {}
  const args = [
    'account-run',
    '--limit',
    String(asPositiveNumber(body.limit, 2)),
    '--timeout',
    String(asPositiveNumber(body.timeout, 12)),
  ]
  if (body.maxAccounts !== 'all') {
    args.push('--max-accounts', String(asPositiveNumber(body.maxAccounts, 3)))
  }
  if (body.includeSeen) args.push('--include-seen')
  if (body.download) args.push('--download')
  if (body.transcribe) args.push('--transcribe')
  res.json(await runMonitorWithRows(args))
})

app.post('/api/run/lowfan', async (req, res) => {
  const body = req.body || {}
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
    String(asPositiveNumber(body.pages, 1)),
    '--count',
    String(asPositiveNumber(body.count, 20)),
  ]
  if (body.fallbackRoute !== false) args.push('--fallback-route')
  res.json(await runMonitorWithRows(args))
})

app.post('/api/settings/douyin-session', async (req, res) => {
  const sessionid = String(req.body?.sessionid || '').trim()
  if (!/^[A-Za-z0-9]{24,128}$/.test(sessionid)) {
    res.status(400).json({ ok: false, error: 'sessionid 格式不对' })
    return
  }
  if (!douyinWebConfigPath) {
    res.status(400).json({ ok: false, error: 'DOUYIN_WEB_CONFIG 未配置' })
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

app.listen(port, '127.0.0.1', () => {
  console.log(`Douyin monitor API listening on http://127.0.0.1:${port}`)
})
