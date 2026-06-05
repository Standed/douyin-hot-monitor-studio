import { startTransition, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  Archive,
  Captions,
  ChartNoAxesColumnIncreasing,
  CheckCircle2,
  Clock3,
  Computer,
  Database,
  Download,
  ExternalLink,
  FileText,
  Gauge,
  Heart,
  History,
  KeyRound,
  LayoutList,
  Loader2,
  LogIn,
  Moon,
  MessageSquareText,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Server,
  Sun,
  Timer,
  Trash2,
  Users,
  Video,
  Zap,
} from 'lucide-react'
import './index.css'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { Card, CardContent } from './components/ui/card'
import { Input } from './components/ui/input'
import { Switch } from './components/ui/switch'

type IconComponent = typeof Zap

type ServiceStatus = {
  ok: boolean
  apiBase: string
  checkedAt: string
  error?: string
}

type AccountSummary = {
  index: number
  name: string
  secUserId: string
  enabled: boolean
}

type AccountDraft = {
  id: string
  name: string
  secUserId: string
  enabled: boolean
}

type IntegrationState = {
  configured: boolean
  masked: string
}

type TranscriptionSettings = {
  provider: 'lemonfox' | 'faster-whisper' | 'whisper'
  language: string
  localModel: string
  localDevice: string
  localComputeType: string
  prompt: string
  providers?: {
    lemonfox: ProviderStatus
    fasterWhisper: ProviderStatus
    whisper: ProviderStatus
  }
}

type RuntimeSettings = {
  localApiBase: string
  pythonBin: string
  monitorDir: string
}

type ParserConfigStatus = {
  configured: boolean
  writable: boolean
  path: string
  detail: string
}

type ProviderStatus = {
  available: boolean
  detail: string
}

type ThresholdSettings = {
  thresholds: ConfigSummary['thresholds']
  defaultLowFan: ConfigSummary['defaultLowFan']
}

type RunningAction = 'account' | 'accounts' | 'lowfan' | 'session' | 'integrations' | 'runtime' | 'thresholds' | 'feedback' | null

type ConfigSummary = {
  accountCount: number
  enabledAccountCount: number
  accounts: AccountSummary[]
  countPerAccount: number
  downloadVideo: boolean
  transcribe: boolean
  outputDir: string
  thresholds: {
    fans_num: number
    likes: number
    collect: number
    comment: number
    share: number
  }
  defaultLowFan: {
    count: number
    pages: number
    route: number
  }
  hasTikhubKey: boolean
  hasLemonfoxKey: boolean
  integrations?: {
    tikhub: IntegrationState
    lemonfox: IntegrationState
    transcription: TranscriptionSettings
    runtime?: RuntimeSettings
    parserConfig?: ParserConfigStatus
  }
}

type ReportFile = {
  name: string
  path: string
  url?: string
  type: 'json' | 'csv' | 'md'
  size: number
  modifiedAt: string
}

type ReportRow = {
  video_id?: string
  title?: string
  author?: string
  source_account?: string
  keyword?: string
  follower_count?: number
  like_count?: number
  comment_count?: number
  collect_count?: number
  share_count?: number
  create_time?: string
  url?: string
  cover_url?: string
  video_url?: string
  local_video_path?: string
  transcript_path?: string
  srt_path?: string
  transcript_provider?: string
  transcript_status?: string
  transcript_error?: string
  download_error?: string
  viral_score?: number
  hit_reason?: string
}

type DashboardData = {
  service: ServiceStatus
  config: ConfigSummary
  feedback: FeedbackSettings
  reports: ReportFile[]
  latestRows: ReportRow[]
  latestLowfanRows: ReportRow[]
  latestAccountRows: ReportRow[]
  state: Record<string, unknown>
}

type RunResult = {
  ok: boolean
  command: string
  code: number | null
  stdout: string
  stderr: string
  parsed?: Record<string, unknown> | null
  rows?: ReportRow[]
}

type FeedbackSettings = {
  formUrl: string
  baseUrl: string
  formId: string
  webhookConfigured: boolean
}

type FeedbackState = {
  message: string
  contact: string
  page: string
}

const feedbackDefaults: FeedbackSettings = {
  formUrl: 'https://xiyangshiai.feishu.cn/base/RauKbsrBkakfgOshWymciovnn38?table=tbluyxSuTJzzm4tw&view=vewSjYQe24',
  baseUrl: 'https://xiyangshiai.feishu.cn/base/RauKbsrBkakfgOshWymciovnn38',
  formId: 'vewSjYQe24',
  webhookConfigured: false,
}

const defaultData: DashboardData = {
  service: {
    ok: false,
    apiBase: 'http://127.0.0.1:8091',
    checkedAt: '',
  },
  config: {
    accountCount: 0,
    enabledAccountCount: 0,
    accounts: [],
    countPerAccount: 2,
    downloadVideo: false,
    transcribe: false,
    outputDir: '',
    thresholds: {
      fans_num: 10000,
      likes: 1000,
      collect: 500,
      comment: 500,
      share: 500,
    },
    defaultLowFan: {
      count: 20,
      pages: 2,
      route: 2,
    },
    hasTikhubKey: false,
    hasLemonfoxKey: false,
    integrations: {
      tikhub: { configured: false, masked: '' },
      lemonfox: { configured: false, masked: '' },
      transcription: {
        provider: 'faster-whisper',
        language: 'zh',
        localModel: 'small',
        localDevice: 'auto',
        localComputeType: 'int8',
        prompt: '请使用标点符号：，。、；：？！',
        providers: {
          lemonfox: { available: false, detail: '需要配置 LEMONFOX_API_KEY' },
          fasterWhisper: { available: false, detail: '当前 Python 环境缺少 faster-whisper' },
          whisper: { available: false, detail: '当前 Python 环境缺少 openai-whisper' },
        },
      },
      runtime: {
        localApiBase: 'http://127.0.0.1:8091',
        pythonBin: 'python3',
        monitorDir: '../douyin-monitor',
      },
      parserConfig: {
        configured: false,
        writable: false,
        path: '',
        detail: 'DOUYIN_WEB_CONFIG 未配置',
      },
    },
  },
  feedback: feedbackDefaults,
  reports: [],
  latestRows: [],
  latestLowfanRows: [],
  latestAccountRows: [],
  state: {},
}

const publishOptions = ['不限', '最近一天', '最近一周', '最近半年']
const durationOptions = ['不限', '1 分钟以内', '1-5 分钟', '5 分钟以上']
const sortOptions = ['综合排序', '最多点赞', '最新发布']
const providerOptions = [
  { label: '本地 faster-whisper', value: 'faster-whisper' },
  { label: '本地 Whisper', value: 'whisper' },
  { label: 'Lemonfox 云端', value: 'lemonfox' },
]

type PageId = 'overview' | 'lowfan' | 'accounts' | 'settings' | 'reports' | 'ops' | 'about' | 'feedback'

const pageIds: PageId[] = ['overview', 'lowfan', 'accounts', 'settings', 'reports', 'ops', 'about', 'feedback']

const navItems: Array<{ id: PageId; icon: IconComponent; label: string; desc: string }> = [
  { id: 'overview', icon: Zap, label: '精选总览', desc: '素材流和运行状态' },
  { id: 'lowfan', icon: Search, label: '低粉爆款', desc: '关键词发现' },
  { id: 'accounts', icon: LayoutList, label: '对标账号', desc: '账号追踪' },
  { id: 'settings', icon: Settings2, label: '接口配置', desc: 'TikHub / Lemonfox' },
  { id: 'reports', icon: FileText, label: '归档报告', desc: 'JSON / CSV / MD' },
  { id: 'ops', icon: ShieldCheck, label: '运行诊断', desc: '服务和错误' },
  { id: 'about', icon: Heart, label: '使用说明', desc: '用途和替代方案' },
  { id: 'feedback', icon: MessageSquareText, label: '反馈', desc: '建议和问题' },
]

const primaryPageIds: PageId[] = ['overview', 'lowfan', 'accounts', 'settings', 'reports']
const utilityPageIds: PageId[] = ['ops', 'about', 'feedback']

const pageCopy: Record<PageId, { title: string; eyebrow: string; description: string }> = {
  overview: {
    title: '抖音爆款监控台',
    eyebrow: '运营素材雷达',
    description: '汇总低粉爆款、对标账号、接口状态和最近归档，适合运营同事每天扫一遍。',
  },
  lowfan: {
    title: '低粉爆款搜索',
    eyebrow: 'Keyword Discovery',
    description: '按关键词搜索粉丝不高但互动异常好的作品，用来找选题、封面、口播和账号打法。',
  },
  accounts: {
    title: '对标账号监控',
    eyebrow: 'Benchmark Watch',
    description: '按监控账号的用户 ID 抓取对标账号最新作品，适合固定账号池的日常巡检。',
  },
  settings: {
    title: '接口与转写配置',
    eyebrow: 'Integrations',
    description: '配置 TikHub、Lemonfox、抖音登录态和本地转写引擎，避免运行前再改环境变量。',
  },
  reports: {
    title: '归档报告',
    eyebrow: 'Archive',
    description: '查看最近生成的 JSON、CSV 和 Markdown 报告，确认每次搜索和监控的产物位置。',
  },
  ops: {
    title: '运行诊断',
    eyebrow: 'Ops',
    description: '查看解析服务、最近命令输出、接口可用性和账号监控错误。',
  },
  about: {
    title: '使用说明',
    eyebrow: 'Playbook',
    description: '说明 TikHub、Lemonfox 分别做什么，以及没有它们时可以怎么替代。',
  },
  feedback: {
    title: '说说你的想法',
    eyebrow: 'Feedback',
    description: '发现 bug、想要的功能、看不顺眼的地方都可以告诉我，提交后会通知到飞书群。',
  },
}

const learningCards = [
  {
    title: 'TikHub',
    body: 'TikHub 在这里负责抖音搜索和视频数据接口，低粉爆款搜索主要靠它按关键词拿到作品、作者粉丝数、点赞评论收藏转发等数据。',
    cost: '官方 pricing 页显示有新账号免费请求额度，正式使用按请求或套餐计费，具体价格以官网为准。',
    alternatives: '可替代方式：自建抖音采集/爬虫服务、接入其他短视频数据 API、用人工表格导入候选作品。自建方案控制力更强，但维护成本和风控压力更高。',
  },
  {
    title: 'Lemonfox',
    body: 'Lemonfox 在这里负责云端语音转文字。账号监控开启“提取口播文稿”后，可以把视频口播转成文稿，方便拆标题、脚本结构和表达方式。',
    cost: '官方首页显示有免费试用，但正式转写按月/积分计费，云端批量转写前要看账单和额度。',
    alternatives: '可替代方式：本地 faster-whisper、本地 openai-whisper、其他云转写服务或人工听写。本地方案更可控，但需要下载视频、配置模型和处理机器性能。',
  },
  {
    title: 'Douyin_TikTok_Download_API',
    body: '这是本项目编排进 Docker Compose 的内置解析服务能力，负责对标账号作品列表、无水印下载和需要登录态的抖音接口。',
    cost: 'FastAPI 框架本身开源免费，但私有化部署仍有服务器、代理、Cookie 维护、风控和人员维护成本。',
    alternatives: '完整上游项目仍可作为高级配置入口，用来单独管理 Cookie、代理和部署细节；也可以接入其他兼容本地解析 API、商业短视频数据接口，或先用人工导入链接。',
  },
]

type ThemeMode = 'dark' | 'system' | 'light'

function getSystemTheme() {
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function resolveTheme(theme: ThemeMode) {
  return theme === 'system' ? getSystemTheme() : theme
}

function getInitialPage(): PageId {
  if (typeof window === 'undefined') return 'overview'
  const pathPage = window.location.pathname.replace(/^\/+/, '') as PageId
  if (pageIds.includes(pathPage)) return pathPage
  const hashPage = window.location.hash.replace('#', '') as PageId
  return pageIds.includes(hashPage) ? hashPage : 'overview'
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!response.ok) {
    const text = await response.text()
    let message
    try {
      const payload = JSON.parse(text) as { error?: string; stderr?: string }
      message = payload.error || payload.stderr || text
    } catch {
      message = text
    }
    throw new Error(message || response.statusText)
  }
  return response.json() as Promise<T>
}

function formatNumber(value?: number) {
  if (typeof value !== 'number') return '0'
  return new Intl.NumberFormat('zh-CN', { notation: value >= 10000 ? 'compact' : 'standard' }).format(value)
}

function formatMonthDay(value?: string) {
  if (!value) return '今日'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '今日'
  return date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
}

function formatClock(value?: string) {
  if (!value) return '00:00'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '00:00'
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 KB'
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(value / 1024))} KB`
}

function parseRunOutput(result?: RunResult) {
  if (result?.parsed) return result.parsed
  if (!result?.stdout) return null
  const start = result.stdout.indexOf('{')
  const end = result.stdout.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    return JSON.parse(result.stdout.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

function getLastErrors(state: Record<string, unknown>) {
  const errors = state.last_account_errors
  return Array.isArray(errors) ? errors : []
}

function createRunError(command: string, error: unknown): RunResult {
  return {
    ok: false,
    command,
    code: 1,
    stdout: '',
    stderr: error instanceof Error ? error.message : String(error),
    rows: [],
  }
}

function resultModeMatchesPage(mode: 'latest' | 'lowfan' | 'account', page: PageId) {
  if (page === 'overview') return true
  if (page === 'lowfan') return mode === 'lowfan'
  if (page === 'accounts') return mode === 'account'
  return false
}

function accountsToDrafts(accounts: AccountSummary[]): AccountDraft[] {
  return accounts.map((account) => ({
    id: `${account.index}-${account.secUserId || account.name}`,
    name: account.name || '',
    secUserId: account.secUserId || '',
    enabled: account.enabled !== false,
  }))
}

function createEmptyAccountDraft(): AccountDraft {
  return {
    id: `new-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: '',
    secUserId: '',
    enabled: true,
  }
}

function normalizeIntegrations(config: ConfigSummary): NonNullable<ConfigSummary['integrations']> {
  const fallback = defaultData.config.integrations!
  const incoming = config.integrations
  return {
    tikhub: incoming?.tikhub || fallback.tikhub,
    lemonfox: incoming?.lemonfox || fallback.lemonfox,
    transcription: {
      ...fallback.transcription,
      ...incoming?.transcription,
      providers: {
        lemonfox: incoming?.transcription?.providers?.lemonfox || fallback.transcription.providers!.lemonfox,
        fasterWhisper: incoming?.transcription?.providers?.fasterWhisper || fallback.transcription.providers!.fasterWhisper,
        whisper: incoming?.transcription?.providers?.whisper || fallback.transcription.providers!.whisper,
      },
    },
    runtime: incoming?.runtime || fallback.runtime,
    parserConfig: incoming?.parserConfig || fallback.parserConfig,
  }
}

function App() {
  const [data, setData] = useState<DashboardData>(defaultData)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState<RunningAction>(null)
  const [lastRun, setLastRun] = useState<RunResult | undefined>()
  const [keyword, setKeyword] = useState('AI智能体')
  const [publishTime, setPublishTime] = useState('最近一周')
  const [duration, setDuration] = useState('不限')
  const [sort, setSort] = useState('最多点赞')
  const [route, setRoute] = useState('2')
  const [pages, setPages] = useState(1)
  const [count, setCount] = useState(20)
  const [fansNum, setFansNum] = useState(10000)
  const [minLikes, setMinLikes] = useState(1000)
  const [minCollect, setMinCollect] = useState(500)
  const [minComment, setMinComment] = useState(500)
  const [minShare, setMinShare] = useState(500)
  const [limit, setLimit] = useState(2)
  const [timeout, setTimeoutValue] = useState(30)
  const [includeSeen, setIncludeSeen] = useState(false)
  const [downloadVideo, setDownloadVideo] = useState(false)
  const [transcribe, setTranscribe] = useState(false)
  const [accountDrafts, setAccountDrafts] = useState<AccountDraft[]>([])
  const [sessionid, setSessionid] = useState('')
  const [tikhubKey, setTikhubKey] = useState('')
  const [lemonfoxKey, setLemonfoxKey] = useState('')
  const [localApiBase, setLocalApiBase] = useState('')
  const [pythonBin, setPythonBin] = useState('')
  const [monitorDir, setMonitorDir] = useState('')
  const [transcriptionProvider, setTranscriptionProvider] = useState('faster-whisper')
  const [transcriptionLanguage, setTranscriptionLanguage] = useState('zh')
  const [localModel, setLocalModel] = useState('small')
  const [localDevice, setLocalDevice] = useState('auto')
  const [localComputeType, setLocalComputeType] = useState('int8')
  const [transcriptionPrompt, setTranscriptionPrompt] = useState('请使用标点符号：，。、；：？！')
  const [activePage, setActivePage] = useState<PageId>(getInitialPage)
  const [resultMode, setResultMode] = useState<'latest' | 'lowfan' | 'account'>('latest')
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'system'
    const saved = window.localStorage.getItem('douyin-monitor-theme')
    return saved === 'dark' || saved === 'light' || saved === 'system' ? saved : 'system'
  })
  const [feedbackDraft, setFeedbackDraft] = useState<FeedbackState>({ message: '', contact: '', page: '' })

  const latestReport = data.reports[0]
  const integrations = normalizeIntegrations(data.config)
  const activeTranscription = integrations.transcription
  const runtimeSettings = integrations.runtime
  const providerStatus = getProviderStatus(activeTranscription)
  const parsedRun = useMemo(() => parseRunOutput(lastRun), [lastRun])
  const lastErrors = getLastErrors(data.state)
  const visibleAccounts = data.config.accounts
  const pageRows = activePage === 'lowfan' ? data.latestLowfanRows : activePage === 'accounts' ? data.latestAccountRows : data.latestRows
  const displayRows = lastRun?.rows?.length && resultModeMatchesPage(resultMode, activePage) ? lastRun.rows : pageRows
  const currentPage = pageCopy[activePage]
  const isUtilityPage = utilityPageIds.includes(activePage)

  const feedItems = displayRows.length
    ? displayRows
    : [
        {
          video_id: 'waiting-for-cookie',
          title: '等待第一次命中结果',
          author: '本地监控器',
          source_account: '系统提示',
          create_time: latestReport?.modifiedAt,
          follower_count: data.config.thresholds.fans_num,
          like_count: data.config.thresholds.likes,
          comment_count: data.config.thresholds.comment,
          collect_count: data.config.thresholds.collect,
          share_count: data.config.thresholds.share,
          url: data.service.apiBase,
        },
      ]

  function syncDashboardForm(dashboard: DashboardData) {
    setCount(dashboard.config.defaultLowFan.count || 20)
    setPages(dashboard.config.defaultLowFan.pages || 1)
    setRoute(String(dashboard.config.defaultLowFan.route || 1))
    setFansNum(dashboard.config.thresholds.fans_num || 10000)
    setMinLikes(dashboard.config.thresholds.likes || 1000)
    setMinCollect(dashboard.config.thresholds.collect || 500)
    setMinComment(dashboard.config.thresholds.comment || 500)
    setMinShare(dashboard.config.thresholds.share || 500)
    setLimit(dashboard.config.countPerAccount || 2)
    setDownloadVideo(Boolean(dashboard.config.downloadVideo))
    setTranscribe(Boolean(dashboard.config.transcribe))
    setAccountDrafts(accountsToDrafts(dashboard.config.accounts))
    if (dashboard.config.integrations?.transcription) {
      const settings = dashboard.config.integrations.transcription
      setTranscriptionProvider(settings.provider || 'faster-whisper')
      setTranscriptionLanguage(settings.language || 'zh')
      setLocalModel(settings.localModel || 'small')
      setLocalDevice(settings.localDevice || 'auto')
      setLocalComputeType(settings.localComputeType || 'int8')
      setTranscriptionPrompt(settings.prompt || '请使用标点符号：，。、；：？！')
    }
    if (dashboard.config.integrations?.runtime) {
      const runtime = dashboard.config.integrations.runtime
      setLocalApiBase(runtime.localApiBase || '')
      setPythonBin(runtime.pythonBin || '')
      setMonitorDir(runtime.monitorDir || '')
    }
  }

  async function refresh() {
    setLoading(true)
    try {
      const dashboard = await api<DashboardData>('/api/dashboard')
      setData(dashboard)
      syncDashboardForm(dashboard)
    } finally {
      setLoading(false)
    }
  }

  async function runAccount() {
    setRunning('account')
    try {
      const result = await api<RunResult>('/api/run/account', {
        method: 'POST',
        body: JSON.stringify({
          limit,
          accounts: accountDrafts,
          includeSeen,
          download: downloadVideo,
          transcribe,
          timeout,
        }),
      })
      setLastRun(result)
      setResultMode('account')
      setActivePage('accounts')
      await refresh()
    } catch (error) {
      setLastRun(createRunError('POST /api/run/account', error))
    } finally {
      setRunning(null)
    }
  }

  async function runLowfan() {
    setRunning('lowfan')
    try {
      const result = await api<RunResult>('/api/run/lowfan', {
        method: 'POST',
        body: JSON.stringify({
          keyword,
          publishTime,
          duration,
          sort,
          route: Number(route),
          pages,
          count,
          fallbackRoute: true,
        }),
      })
      setLastRun(result)
      setResultMode('lowfan')
      setActivePage('lowfan')
      await refresh()
    } catch (error) {
      setLastRun(createRunError('POST /api/run/lowfan', error))
    } finally {
      setRunning(null)
    }
  }

  async function saveSession() {
    if (!sessionid.trim()) return
    setRunning('session')
    try {
      const result = await api<{ ok: boolean; masked?: string; error?: string }>('/api/settings/douyin-session', {
        method: 'POST',
        body: JSON.stringify({ sessionid }),
      })
      setLastRun({
        ok: Boolean(result.ok),
        command: 'POST /api/settings/douyin-session',
        code: result.ok ? 0 : 1,
        stdout: result.masked ? `已写入 ${result.masked}` : '',
        stderr: result.error || '',
      })
      setSessionid('')
    } catch (error) {
      setLastRun(createRunError('POST /api/settings/douyin-session', error))
    } finally {
      setRunning(null)
    }
  }

  async function saveIntegrations() {
    setRunning('integrations')
    try {
      const result = await api<{ ok: boolean; integrations: ConfigSummary['integrations'] }>('/api/settings/integrations', {
        method: 'POST',
        body: JSON.stringify({
          tikhubKey,
          lemonfoxKey,
          transcription: {
            provider: transcriptionProvider,
            language: transcriptionLanguage,
            localModel,
            localDevice,
            localComputeType,
            prompt: transcriptionPrompt,
          },
        }),
      })
      setLastRun({
        ok: Boolean(result.ok),
        command: 'POST /api/settings/integrations',
        code: result.ok ? 0 : 1,
        stdout: '配置已保存',
        stderr: '',
      })
      setTikhubKey('')
      setLemonfoxKey('')
      await refresh()
      if (result.integrations) {
        setData((current) => ({
          ...current,
          config: {
            ...current.config,
            hasTikhubKey: result.integrations!.tikhub.configured,
            hasLemonfoxKey: result.integrations!.lemonfox.configured,
            integrations: result.integrations,
          },
        }))
      }
    } catch (error) {
      setLastRun(createRunError('POST /api/settings/integrations', error))
    } finally {
      setRunning(null)
    }
  }

  async function saveRuntime() {
    setRunning('runtime')
    try {
      const result = await api<{ ok: boolean; integrations: ConfigSummary['integrations']; error?: string }>('/api/settings/runtime', {
        method: 'POST',
        body: JSON.stringify({
          localApiBase,
          pythonBin,
          monitorDir,
        }),
      })
      setLastRun({
        ok: Boolean(result.ok),
        command: 'POST /api/settings/runtime',
        code: result.ok ? 0 : 1,
        stdout: result.ok ? '后台配置已保存' : '',
        stderr: result.error || '',
      })
      await refresh()
      if (result.integrations) {
        setData((current) => ({
          ...current,
          config: {
            ...current.config,
            integrations: result.integrations,
          },
        }))
      }
    } catch (error) {
      setLastRun(createRunError('POST /api/settings/runtime', error))
    } finally {
      setRunning(null)
    }
  }

  async function saveThresholds() {
    setRunning('thresholds')
    try {
      const result = await api<{ ok: boolean } & ThresholdSettings>('/api/settings/thresholds', {
        method: 'POST',
        body: JSON.stringify({
          fansNum,
          likes: minLikes,
          collect: minCollect,
          comment: minComment,
          share: minShare,
          count,
          pages,
          route: Number(route),
        }),
      })
      setLastRun({
        ok: Boolean(result.ok),
        command: 'POST /api/settings/thresholds',
        code: result.ok ? 0 : 1,
        stdout: '监控阈值已保存',
        stderr: '',
      })
      setData((current) => ({
        ...current,
        config: {
          ...current.config,
          thresholds: result.thresholds,
          defaultLowFan: result.defaultLowFan,
        },
      }))
      setCount(result.defaultLowFan.count)
      setPages(result.defaultLowFan.pages)
      setRoute(String(result.defaultLowFan.route))
    } catch (error) {
      setLastRun(createRunError('POST /api/settings/thresholds', error))
    } finally {
      setRunning(null)
    }
  }

  async function saveAccounts() {
    setRunning('accounts')
    try {
      const result = await api<{
        ok: boolean
        accountMonitor: Pick<ConfigSummary, 'accountCount' | 'enabledAccountCount' | 'accounts' | 'countPerAccount' | 'downloadVideo' | 'transcribe'>
        error?: string
      }>('/api/settings/accounts', {
        method: 'POST',
        body: JSON.stringify({
          countPerAccount: limit,
          downloadVideo,
          transcribe,
          accounts: accountDrafts,
        }),
      })
      setLastRun({
        ok: Boolean(result.ok),
        command: 'POST /api/settings/accounts',
        code: result.ok ? 0 : 1,
        stdout: '对标账号配置已保存',
        stderr: result.error || '',
      })
      setData((current) => ({
        ...current,
        config: {
          ...current.config,
          ...result.accountMonitor,
        },
      }))
      setAccountDrafts(accountsToDrafts(result.accountMonitor.accounts))
      setLimit(result.accountMonitor.countPerAccount)
      setDownloadVideo(result.accountMonitor.downloadVideo)
      setTranscribe(result.accountMonitor.transcribe)
    } catch (error) {
      setLastRun(createRunError('POST /api/settings/accounts', error))
    } finally {
      setRunning(null)
    }
  }

  async function submitFeedback() {
    if (!feedbackDraft.message.trim()) return
    setRunning('feedback')
    try {
      const result = await api<{ ok: boolean; webhookConfigured: boolean; error?: string }>('/api/feedback', {
        method: 'POST',
        body: JSON.stringify({
          ...feedbackDraft,
          page: feedbackDraft.page || currentPage.title,
        }),
      })
      setLastRun({
        ok: Boolean(result.ok),
        command: 'POST /api/feedback',
        code: result.ok ? 0 : 1,
        stdout: result.webhookConfigured ? '反馈已发送到飞书群' : '反馈已记录；飞书群机器人未配置',
        stderr: result.error || '',
      })
      if (result.ok) setFeedbackDraft({ message: '', contact: '', page: '' })
      setData((current) => ({
        ...current,
        feedback: {
          ...(current.feedback || feedbackDefaults),
          webhookConfigured: result.webhookConfigured,
        },
      }))
    } catch (error) {
      setLastRun(createRunError('POST /api/feedback', error))
    } finally {
      setRunning(null)
    }
  }

  useEffect(() => {
    let cancelled = false

    api<DashboardData>('/api/dashboard')
      .then((dashboard) => {
        if (cancelled) return
        startTransition(() => {
          setData(dashboard)
          syncDashboardForm(dashboard)
          setLoading(false)
        })
      })
      .catch((error) => {
        if (cancelled) return
        startTransition(() => {
          setLoading(false)
          setLastRun(createRunError('GET /api/dashboard', error))
        })
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = resolveTheme(theme)
    document.documentElement.dataset.themeMode = theme
    window.localStorage.setItem('douyin-monitor-theme', theme)
  }, [theme])

  useEffect(() => {
    if (theme !== 'system') return
    const query = window.matchMedia('(prefers-color-scheme: light)')
    const updateTheme = () => {
      document.documentElement.dataset.theme = resolveTheme('system')
    }
    updateTheme()
    query.addEventListener('change', updateTheme)
    return () => query.removeEventListener('change', updateTheme)
  }, [theme])

  useEffect(() => {
    const onHashChange = () => setActivePage(getInitialPage())
    window.addEventListener('hashchange', onHashChange)
    window.addEventListener('popstate', onHashChange)
    return () => {
      window.removeEventListener('hashchange', onHashChange)
      window.removeEventListener('popstate', onHashChange)
    }
  }, [])

  function navigate(page: PageId) {
    setActivePage(page)
    window.history.pushState(null, '', page === 'overview' ? '/' : `/${page}`)
  }

  return (
    <main className="app-frame">
      <aside className="app-sidebar">
        <div className="brand-card">
          <div className="brand-word">
            <span>DY</span>
            <i />
            <strong>HOT</strong>
          </div>
        </div>

        <nav className="nav-list">
          {navItems.map((item) => (
            <NavItem active={activePage === item.id} desc={item.desc} icon={item.icon} key={item.id} label={item.label} onClick={() => navigate(item.id)} />
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="theme-toggle" aria-label="主题切换">
            <button className={theme === 'dark' ? 'theme-button active' : 'theme-button'} onClick={() => setTheme('dark')} title="夜间模式">
              <Moon className="size-4" />
            </button>
            <button className={theme === 'system' ? 'theme-button active' : 'theme-button'} onClick={() => setTheme('system')} title="跟随系统">
              <Computer className="size-4" />
            </button>
            <button className={theme === 'light' ? 'theme-button active' : 'theme-button'} onClick={() => setTheme('light')} title="浅色模式">
              <Sun className="size-4" />
            </button>
          </div>
          <div className="login-row">
            <LogIn className="size-4" />
            <span>本地模式</span>
          </div>
        </div>
      </aside>

      <section className="main-stream">
        {!isUtilityPage && (
          <>
            <header className="stream-header">
              <div>
                <span className="page-eyebrow">{currentPage.eyebrow}</span>
                <h1>{currentPage.title}</h1>
                <p>{currentPage.description}</p>
              </div>
              <div className="header-status">
                <Badge variant={data.service.ok ? 'success' : 'warning'}>
                  {data.service.ok ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
                  {data.service.ok ? '解析服务在线' : '解析服务异常'}
                </Badge>
                <Button variant="ghost" size="icon" onClick={refresh} disabled={loading} title="刷新">
                  <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} />
                </Button>
              </div>
              <div className="header-tools">
                <div className="tabs-shell">
                  {primaryPageIds.map((pageId) => {
                    const item = navItems.find((navItem) => navItem.id === pageId)
                    if (!item) return null
                    return (
                      <button className={item.id === activePage ? 'tab active' : 'tab'} key={item.id} onClick={() => navigate(item.id)}>
                        {item.label}
                      </button>
                    )
                  })}
                </div>
                <div className="search-box">
                  <Search className="size-4" />
                  <Input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索关键词..." />
                  <Button onClick={runLowfan} disabled={running !== null || !keyword.trim()}>
                    {running === 'lowfan' ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                    搜索
                  </Button>
                </div>
              </div>
            </header>

            <section className="ops-strip">
              <StatusPill icon={Users} label="监控账号" value={`${data.config.enabledAccountCount} / ${data.config.accountCount} 个`} />
              <StatusPill icon={Gauge} label="粉丝阈值" value={`≤ ${formatNumber(data.config.thresholds.fans_num)}`} />
              <StatusPill
                icon={Sparkles}
                label="TikHub"
                value={data.config.hasTikhubKey ? '已接入' : '未配置'}
                tone={data.config.hasTikhubKey ? 'good' : 'warn'}
              />
              <StatusPill
                icon={Captions}
                label="转写"
                value={formatProvider(activeTranscription.provider)}
                tone={providerStatus.available ? 'good' : 'warn'}
              />
              <div className="run-actions">
                <Button variant="secondary" onClick={runAccount} disabled={running !== null}>
                  {running === 'account' ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                  跑账号监控
                </Button>
                <Button variant="ghost" onClick={refresh} disabled={loading}>
                  <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} />
                  刷新
                </Button>
              </div>
            </section>
          </>
        )}

        {isUtilityPage && (
          <section className="utility-heading">
            <div>
              <span className="page-eyebrow">{currentPage.eyebrow}</span>
              <h1>{currentPage.title}</h1>
              <p>{currentPage.description}</p>
            </div>
            {activePage === 'ops' && (
              <Button variant="ghost" onClick={refresh} disabled={loading}>
                <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} />
                刷新诊断
              </Button>
            )}
          </section>
        )}

        {activePage === 'overview' && (
          <>
            <section className="summary-grid">
              <FeatureTile icon={Search} title="低粉爆款" value={resultMode === 'lowfan' ? `${displayRows.length} 条命中` : '关键词发现'} onClick={() => navigate('lowfan')} />
              <FeatureTile icon={LayoutList} title="对标账号" value={`${data.config.enabledAccountCount} 个启用`} onClick={() => navigate('accounts')} />
              <FeatureTile icon={Settings2} title="接口配置" value={data.config.hasTikhubKey && data.config.hasLemonfoxKey ? '关键接口已接入' : '有接口待配置'} onClick={() => navigate('settings')} />
            </section>
            <TimelineSection displayRows={displayRows} feedItems={feedItems} latestReport={latestReport} />
            <UtilityGrid lastErrors={lastErrors} lastRun={lastRun} parsedRun={parsedRun} reports={data.reports} />
          </>
        )}

        {activePage === 'lowfan' && (
          <section className="workspace-grid">
            <LowfanPanel
              count={count}
              duration={duration}
              keyword={keyword}
              pages={pages}
              publishTime={publishTime}
              route={route}
              running={running}
              setCount={setCount}
              setDuration={setDuration}
              setKeyword={setKeyword}
              setPages={setPages}
              setPublishTime={setPublishTime}
              setRoute={setRoute}
              setSort={setSort}
              sort={sort}
              thresholds={data.config.thresholds}
              onRun={runLowfan}
            />
            <TimelineSection displayRows={displayRows} feedItems={feedItems} latestReport={latestReport} />
          </section>
        )}

        {activePage === 'accounts' && (
          <section className="workspace-grid accounts-workspace">
            <AccountPanel
              downloadVideo={downloadVideo}
              includeSeen={includeSeen}
              lastRun={lastRun}
              limit={limit}
              running={running}
              setDownloadVideo={setDownloadVideo}
              setIncludeSeen={setIncludeSeen}
              setLimit={setLimit}
              setTimeoutValue={setTimeoutValue}
              setTranscribe={setTranscribe}
              accountDrafts={accountDrafts}
              saveAccounts={saveAccounts}
              setAccountDrafts={setAccountDrafts}
              timeout={timeout}
              transcribe={transcribe}
              visibleAccounts={visibleAccounts}
              onRun={runAccount}
            />
            <AccountResultsPanel displayRows={displayRows} feedItems={feedItems} latestReport={latestReport} />
          </section>
        )}

        {activePage === 'settings' && (
          <section className="settings-layout">
            <ThresholdPanel
              count={count}
              fansNum={fansNum}
              minCollect={minCollect}
              minComment={minComment}
              minLikes={minLikes}
              minShare={minShare}
              pages={pages}
              route={route}
              running={running}
              saveThresholds={saveThresholds}
              setCount={setCount}
              setFansNum={setFansNum}
              setMinCollect={setMinCollect}
              setMinComment={setMinComment}
              setMinLikes={setMinLikes}
              setMinShare={setMinShare}
              setPages={setPages}
              setRoute={setRoute}
            />
            <IntegrationPanel
              activeTranscription={activeTranscription}
              integrations={integrations}
              lemonfoxKey={lemonfoxKey}
              localComputeType={localComputeType}
              localDevice={localDevice}
              localModel={localModel}
              running={running}
              saveIntegrations={saveIntegrations}
              setLemonfoxKey={setLemonfoxKey}
              setLocalComputeType={setLocalComputeType}
              setLocalDevice={setLocalDevice}
              setLocalModel={setLocalModel}
              setTikhubKey={setTikhubKey}
              setTranscriptionLanguage={setTranscriptionLanguage}
              setTranscriptionPrompt={setTranscriptionPrompt}
              setTranscriptionProvider={setTranscriptionProvider}
              tikhubKey={tikhubKey}
              transcriptionLanguage={transcriptionLanguage}
              transcriptionPrompt={transcriptionPrompt}
              transcriptionProvider={transcriptionProvider}
            />
            <RuntimePanel
              localApiBase={localApiBase || runtimeSettings?.localApiBase || ''}
              monitorDir={monitorDir || runtimeSettings?.monitorDir || ''}
              pythonBin={pythonBin || runtimeSettings?.pythonBin || ''}
              running={running}
              saveRuntime={saveRuntime}
              setLocalApiBase={setLocalApiBase}
              setMonitorDir={setMonitorDir}
              setPythonBin={setPythonBin}
            />
            <SessionPanel parserConfig={integrations.parserConfig} running={running} saveSession={saveSession} sessionid={sessionid} setSessionid={setSessionid} />
          </section>
        )}

        {activePage === 'reports' && <ReportsPage outputDir={data.config.outputDir} reports={data.reports} />}
        {activePage === 'ops' && <OpsPage data={data} lastErrors={lastErrors} lastRun={lastRun} parsedRun={parsedRun} providerStatus={providerStatus} />}
        {activePage === 'about' && <AboutPage />}
        {activePage === 'feedback' && (
          <FeedbackPage
            feedback={feedbackDraft}
            running={running}
            setFeedback={setFeedbackDraft}
            settings={data.feedback || feedbackDefaults}
            submitFeedback={submitFeedback}
          />
        )}
      </section>
    </main>
  )
}

function NavItem({ active, desc, icon: Icon, label, onClick }: { active?: boolean; desc: string; icon: IconComponent; label: string; onClick: () => void }) {
  return (
    <button className={active ? 'nav-item active' : 'nav-item'} onClick={onClick}>
      <Icon className="size-5" />
      <span>
        {label}
        <small>{desc}</small>
      </span>
    </button>
  )
}

function FeatureTile({ icon: Icon, title, value, onClick }: { icon: IconComponent; title: string; value: string; onClick: () => void }) {
  return (
    <button className="feature-tile" onClick={onClick}>
      <Icon className="size-5" />
      <span>{title}</span>
      <strong>{value}</strong>
    </button>
  )
}

function LowfanPanel({
  count,
  duration,
  keyword,
  pages,
  publishTime,
  route,
  running,
  setCount,
  setDuration,
  setKeyword,
  setPages,
  setPublishTime,
  setRoute,
  setSort,
  sort,
  thresholds,
  onRun,
}: {
  count: number
  duration: string
  keyword: string
  pages: number
  publishTime: string
  route: string
  running: RunningAction
  setCount: (value: number) => void
  setDuration: (value: string) => void
  setKeyword: (value: string) => void
  setPages: (value: number) => void
  setPublishTime: (value: string) => void
  setRoute: (value: string) => void
  setSort: (value: string) => void
  sort: string
  thresholds: ConfigSummary['thresholds']
  onRun: () => void
}) {
  return (
    <Card className="control-card lowfan-card page-card">
      <CardContent>
        <PanelTitle icon={Search} title="搜索条件" />
        <p className="panel-copy">用于主动发现“账号粉丝不高，但单条内容互动明显跑出来”的素材。</p>
        <div className="cost-strip">
          <Sparkles className="size-4" />
          低粉爆款会调用 TikHub 搜索接口；先用小页数测试，正式批量跑前看 TikHub 额度。
        </div>
        <div className="form-grid">
          <Field label="关键词">
            <Input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="AI智能体 / 口播 / 副业" />
          </Field>
          <Field label="发布时间">
            <Select value={publishTime} onChange={setPublishTime} options={publishOptions} />
          </Field>
          <Field label="视频时长">
            <Select value={duration} onChange={setDuration} options={durationOptions} />
          </Field>
          <Field label="排序方式">
            <Select value={sort} onChange={setSort} options={sortOptions} />
          </Field>
          <Field label="优先线路">
            <Select
              value={route}
              onChange={setRoute}
              options={[
                { label: '线路二 Search：关键词搜索，默认推荐', value: '2' },
                { label: '线路一 Web：网页搜索接口，兜底备用', value: '1' },
              ]}
            />
          </Field>
          <Field label="页数">
            <NumberInput value={pages} min={1} max={5} onChange={setPages} />
          </Field>
          <Field label="每页数量">
            <NumberInput value={count} min={5} max={50} step={5} onChange={setCount} />
          </Field>
        </div>
        <div className="threshold-row">
          <span>粉丝 ≤ {formatNumber(thresholds.fans_num)}</span>
          <span>赞 ≥ {formatNumber(thresholds.likes)}</span>
          <span>藏 ≥ {formatNumber(thresholds.collect)}</span>
          <span>评 ≥ {formatNumber(thresholds.comment)}</span>
          <span>转 ≥ {formatNumber(thresholds.share)}</span>
        </div>
        <RouteGuide route={route} />
        <Button className="full-action" onClick={onRun} disabled={running !== null || !keyword.trim()}>
          {running === 'lowfan' ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          开始搜索低粉爆款
        </Button>
      </CardContent>
    </Card>
  )
}

function RouteGuide({ route }: { route: string }) {
  const primary = route === '1'
    ? '当前优先使用线路一 Web。它走 TikHub 的网页搜索接口，适合线路二搜索异常时备用。'
    : '当前优先使用线路二 Search。它走 TikHub 的关键词搜索接口，是默认推荐线路。'
  const fallback = route === '1'
    ? '运行时会自动兜底到线路二 Search。'
    : '运行时会自动兜底到线路一 Web。'

  return (
    <div className="route-guide">
      <div>
        <strong>{route === '1' ? '线路一 Web' : '线路二 Search'}</strong>
        <span>{primary}</span>
      </div>
      <em>{fallback}</em>
    </div>
  )
}

function AccountPanel({
  accountDrafts,
  downloadVideo,
  includeSeen,
  lastRun,
  limit,
  running,
  saveAccounts,
  setAccountDrafts,
  setDownloadVideo,
  setIncludeSeen,
  setLimit,
  setTimeoutValue,
  setTranscribe,
  timeout,
  transcribe,
  visibleAccounts,
  onRun,
}: {
  accountDrafts: AccountDraft[]
  downloadVideo: boolean
  includeSeen: boolean
  lastRun?: RunResult
  limit: number
  running: RunningAction
  saveAccounts: () => void
  setAccountDrafts: (value: AccountDraft[]) => void
  setDownloadVideo: (value: boolean) => void
  setIncludeSeen: (value: boolean) => void
  setLimit: (value: number) => void
  setTimeoutValue: (value: number) => void
  setTranscribe: (value: boolean) => void
  timeout: number
  transcribe: boolean
  visibleAccounts: AccountSummary[]
  onRun: () => void
}) {
  function updateAccount(id: string, patch: Partial<AccountDraft>) {
    setAccountDrafts(accountDrafts.map((account) => (account.id === id ? { ...account, ...patch } : account)))
  }

  function removeAccount(id: string) {
    const next = accountDrafts.filter((account) => account.id !== id)
    setAccountDrafts(next.length ? next : [createEmptyAccountDraft()])
  }

  const enabledDraftCount = accountDrafts.filter((account) => account.enabled !== false && account.name.trim() && account.secUserId.trim()).length
  const accountRunResult = lastRun?.command.includes('account-run') || lastRun?.command.includes('/api/run/account') ? lastRun : undefined
  const accountRunMessage = formatAccountRunMessage(accountRunResult, enabledDraftCount)
  const totalDraftCount = accountDrafts.filter((account) => account.name.trim() || account.secUserId.trim()).length

  return (
    <Card className="control-card account-card page-card">
      <CardContent>
        <div className="account-hero">
          <PanelTitle icon={ShieldCheck} title="监控批次" />
          <p>固定巡检对标账号池，适合每天看新增作品、素材方向和脚本表达变化。</p>
          <div className="account-run-stats">
            <span>
              <b>{enabledDraftCount}</b>
              启用账号
            </span>
            <span>
              <b>{limit}</b>
              每账号条数
            </span>
            <span>
              <b>{timeout}s</b>
              请求超时
            </span>
          </div>
        </div>

        <div className="account-tune-grid">
          <Field label="每账号条数">
            <NumberInput value={limit} min={1} max={10} onChange={setLimit} />
          </Field>
          <Field label="请求超时">
            <NumberInput value={timeout} min={15} max={90} onChange={setTimeoutValue} />
          </Field>
        </div>

        <div className="asset-decision">
          <div>
            <Database className="size-4" />
            <strong>资产落点</strong>
            <p>网页端保存无水印视频和口播文稿，飞书多维表格保存索引、链接、负责人和处理状态。</p>
          </div>
          <div>
            <Timer className="size-4" />
            <strong>耗时预估</strong>
            <p>只抓作品通常几十秒；下载按视频大小增加；本地转写一般按视频时长的 0.5-2 倍浮动。</p>
          </div>
        </div>

        <div className="switch-panel compact account-switches">
          <Switch label="包含已看过作品" checked={includeSeen} onCheckedChange={setIncludeSeen} />
          <Switch label="下载无水印视频" checked={downloadVideo} onCheckedChange={setDownloadVideo} />
          <Switch label="提取口播文稿" checked={transcribe} onCheckedChange={setTranscribe} />
        </div>

        <div className="account-section-head">
          <div>
            <strong>账号池</strong>
            <span>{enabledDraftCount} 启用 / {totalDraftCount || accountDrafts.length} 行</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setAccountDrafts([...accountDrafts, createEmptyAccountDraft()])}>
            <Plus className="size-4" />
            添加账号
          </Button>
        </div>
        <div className="account-editor">
          <div className="account-editor-head">
            <span>状态</span>
            <span>账号名称</span>
            <span>用户 ID</span>
            <span>操作</span>
          </div>
          {accountDrafts.length ? (
            accountDrafts.map((account) => (
              <div className={account.enabled === false ? 'account-editor-row disabled' : 'account-editor-row'} key={account.id}>
                <label className="account-enabled">
                  <input type="checkbox" checked={account.enabled !== false} onChange={(event) => updateAccount(account.id, { enabled: event.target.checked })} />
                  <span>{account.enabled === false ? '停用' : '启用'}</span>
                </label>
                <Input value={account.name} onChange={(event) => updateAccount(account.id, { name: event.target.value })} placeholder="例如：AIGC自修室" />
                <Input value={account.secUserId} onChange={(event) => updateAccount(account.id, { secUserId: event.target.value })} placeholder="例如：MS4wLjABAAAAX7P5NK7HVXt5dPUWL9qoxKqMcHaLM7rkqxQqEK2C7vrgLUJ3c_4wr8H4cTk3ThnN" />
                <div className="account-row-actions">
                  <button className="account-action danger" onClick={() => removeAccount(account.id)} type="button">
                    <Trash2 className="size-4" />
                    移除
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="account-empty">还没有对标账号，先添加一行。</div>
          )}
        </div>
        <p className="panel-hint">用户 ID 是监控账号抖音主页网址里 /user/ 后、? 前的那一段，例如 https://www.douyin.com/user/MS4wLjAB...?from_tab_name=main 中的 MS4wLjAB...。</p>
        <div className="account-actions">
          <Button variant="secondary" onClick={saveAccounts} disabled={running !== null}>
            {running === 'accounts' ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            保存账号配置
          </Button>
          <Button className="account-run-button" variant="secondary" onClick={onRun} disabled={running !== null || enabledDraftCount === 0}>
            {running === 'account' ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            {enabledDraftCount ? `开始监控 ${enabledDraftCount} 个账号` : '没有启用账号'}
          </Button>
        </div>
        <div className="account-list">
          {visibleAccounts.length ? (
            visibleAccounts.map((account) => (
              <span className={account.enabled === false ? 'account-chip muted' : 'account-chip'} key={account.secUserId}>
                <b>{String(account.index).padStart(2, '0')}</b>
                {account.name}
              </span>
            ))
          ) : (
            <span className="account-chip muted">请先在页面添加并保存对标账号</span>
          )}
        </div>
        <div className={running === 'account' ? 'run-feedback active' : accountRunResult?.ok === false ? 'run-feedback error' : 'run-feedback'}>
          {running === 'account'
            ? `正在监控 ${enabledDraftCount} 个启用账号，完成后右侧结果和归档报告会刷新。`
            : accountRunResult
              ? accountRunMessage
              : `将监控 ${enabledDraftCount} 个启用账号。`}
        </div>
      </CardContent>
    </Card>
  )
}

function formatAccountRunMessage(result: RunResult | undefined, enabledCount: number) {
  if (!result) return `将监控 ${enabledCount} 个启用账号。`
  if (result.ok) return `上次账号监控完成，返回 ${result.rows?.length || 0} 条结果。`

  const errors = Array.isArray(result.parsed?.errors) ? result.parsed.errors : []
  const firstError = errors[0]
  if (firstError && typeof firstError === 'object') {
    const account = String((firstError as Record<string, unknown>).account || '账号')
    const error = friendlyRunError(String((firstError as Record<string, unknown>).error || '运行失败'))
    return `${account}：${error}`
  }

  return friendlyRunError(result.stderr) || '账号监控失败，请查看运行诊断。'
}

function friendlyRunError(value?: string) {
  const text = String(value || '').trim()
  if (!text) return ''
  const lower = text.toLowerCase()
  if (lower.includes('timed out') || lower.includes('timeout')) {
    return '抖音接口响应超时。建议稍后重试，或把请求超时调到 30-60 秒；如果连续超时，请检查登录态、代理和解析服务。'
  }
  return text
}

function SessionPanel({
  parserConfig,
  running,
  saveSession,
  sessionid,
  setSessionid,
}: {
  parserConfig?: ParserConfigStatus
  running: RunningAction
  saveSession: () => void
  sessionid: string
  setSessionid: (value: string) => void
}) {
  const writable = Boolean(parserConfig?.writable)

  return (
    <Card className="control-card session-card">
      <CardContent>
        <PanelTitle icon={KeyRound} title="抖音登录态" />
        <p className="panel-copy">用于本地解析服务访问需要登录态的抖音页面。只有配置了可写的 `DOUYIN_WEB_CONFIG` 时，这里才会写入解析服务配置。</p>
        <div className={writable ? 'session-status ready' : 'session-status'}>
          <strong>{writable ? '可写入 parser config' : '未连接可写 parser config'}</strong>
          <span>{parserConfig?.path || 'DOUYIN_WEB_CONFIG 未配置'}</span>
          <p>{parserConfig?.detail || 'Docker 默认内置解析容器不会把 Cookie 配置暴露给 UI 写入。'}</p>
        </div>
        <div className="session-box">
          <Input value={sessionid} onChange={(event) => setSessionid(event.target.value)} placeholder="sessionid" type="password" />
          <Button variant="ghost" onClick={saveSession} disabled={running !== null || !sessionid.trim() || !writable}>
            {running === 'session' ? <Loader2 className="size-4 animate-spin" /> : <Settings2 className="size-4" />}
            保存
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function ThresholdPanel({
  count,
  fansNum,
  minCollect,
  minComment,
  minLikes,
  minShare,
  pages,
  route,
  running,
  saveThresholds,
  setCount,
  setFansNum,
  setMinCollect,
  setMinComment,
  setMinLikes,
  setMinShare,
  setPages,
  setRoute,
}: {
  count: number
  fansNum: number
  minCollect: number
  minComment: number
  minLikes: number
  minShare: number
  pages: number
  route: string
  running: RunningAction
  saveThresholds: () => void
  setCount: (value: number) => void
  setFansNum: (value: number) => void
  setMinCollect: (value: number) => void
  setMinComment: (value: number) => void
  setMinLikes: (value: number) => void
  setMinShare: (value: number) => void
  setPages: (value: number) => void
  setRoute: (value: string) => void
}) {
  return (
    <Card className="control-card thresholds-card">
      <CardContent>
        <PanelTitle icon={Gauge} title="监控阈值" />
        <p className="panel-copy">前五项决定什么内容会进入低粉爆款候选，后三项是搜索默认运行参数；保存后会写入 config.json，下次自动沿用。</p>
        <div className="threshold-editor">
          <Field label="粉丝上限">
            <NumberInput value={fansNum} min={100} max={10000000} step={1000} onChange={setFansNum} />
          </Field>
          <Field label="最低点赞">
            <NumberInput value={minLikes} min={1} max={10000000} step={100} onChange={setMinLikes} />
          </Field>
          <Field label="最低收藏">
            <NumberInput value={minCollect} min={1} max={10000000} step={50} onChange={setMinCollect} />
          </Field>
          <Field label="最低评论">
            <NumberInput value={minComment} min={1} max={10000000} step={50} onChange={setMinComment} />
          </Field>
          <Field label="最低转发">
            <NumberInput value={minShare} min={1} max={10000000} step={50} onChange={setMinShare} />
          </Field>
          <Field label="默认页数">
            <NumberInput value={pages} min={1} max={10} onChange={setPages} />
          </Field>
          <Field label="默认每页数量">
            <NumberInput value={count} min={5} max={50} step={5} onChange={setCount} />
          </Field>
          <Field label="默认线路">
            <Select
              value={route}
              onChange={setRoute}
              options={[
                { label: '线路二 Search：默认推荐', value: '2' },
                { label: '线路一 Web：兜底备用', value: '1' },
              ]}
            />
          </Field>
        </div>
        <RouteGuide route={route} />
        <Button className="full-action" variant="secondary" onClick={saveThresholds} disabled={running !== null}>
          {running === 'thresholds' ? <Loader2 className="size-4 animate-spin" /> : <Gauge className="size-4" />}
          保存监控阈值
        </Button>
      </CardContent>
    </Card>
  )
}

function IntegrationPanel({
  activeTranscription,
  integrations,
  lemonfoxKey,
  localComputeType,
  localDevice,
  localModel,
  running,
  saveIntegrations,
  setLemonfoxKey,
  setLocalComputeType,
  setLocalDevice,
  setLocalModel,
  setTikhubKey,
  setTranscriptionLanguage,
  setTranscriptionPrompt,
  setTranscriptionProvider,
  tikhubKey,
  transcriptionLanguage,
  transcriptionPrompt,
  transcriptionProvider,
}: {
  activeTranscription: TranscriptionSettings
  integrations: NonNullable<ConfigSummary['integrations']>
  lemonfoxKey: string
  localComputeType: string
  localDevice: string
  localModel: string
  running: RunningAction
  saveIntegrations: () => void
  setLemonfoxKey: (value: string) => void
  setLocalComputeType: (value: string) => void
  setLocalDevice: (value: string) => void
  setLocalModel: (value: string) => void
  setTikhubKey: (value: string) => void
  setTranscriptionLanguage: (value: string) => void
  setTranscriptionPrompt: (value: string) => void
  setTranscriptionProvider: (value: string) => void
  tikhubKey: string
  transcriptionLanguage: string
  transcriptionPrompt: string
  transcriptionProvider: string
}) {
  return (
    <Card className="control-card settings-card">
      <CardContent>
        <PanelTitle icon={Settings2} title="接口与转写" />
        <p className="panel-copy">低粉搜索需要 TikHub；转写默认走本地 faster-whisper，Lemonfox 仅作为云端省心选项。</p>
        <div className="form-grid">
          <Field label="TikHub Key" help="用于低粉爆款搜索。官网有试用额度，正式使用通常按请求或套餐收费。">
            <Input value={tikhubKey} onChange={(event) => setTikhubKey(event.target.value)} placeholder={integrations.tikhub.configured ? integrations.tikhub.masked : 'Bearer ...'} type="password" />
          </Field>
          <Field label="Lemonfox Key" help="用于云端语音转文字。官网展示试用和按月/积分计费，批量转写前要看额度。">
            <Input value={lemonfoxKey} onChange={(event) => setLemonfoxKey(event.target.value)} placeholder={integrations.lemonfox.configured ? integrations.lemonfox.masked : 'sk-...'} type="password" />
          </Field>
          <Field label="转写引擎">
            <Select value={transcriptionProvider} onChange={setTranscriptionProvider} options={providerOptions} />
          </Field>
          <Field label="语言">
            <Input value={transcriptionLanguage} onChange={(event) => setTranscriptionLanguage(event.target.value)} placeholder="zh / auto / en" />
          </Field>
        </div>
        <details className="advanced-settings">
          <summary>本地转写高级设置</summary>
          <p>默认 `small / auto / int8` 对多数 Mac 和轻量服务器够用。需要更快可以用 `tiny/base`，需要更准再改 `medium/large-v3`，但会明显增加模型下载、内存和耗时。</p>
          <div className="form-grid">
            <Field label="本地模型">
              <Input value={localModel} onChange={(event) => setLocalModel(event.target.value)} placeholder="tiny / base / small / medium" />
            </Field>
            <Field label="计算方式">
              <Input value={localComputeType} onChange={(event) => setLocalComputeType(event.target.value)} placeholder="int8 / float16" />
            </Field>
          </div>
          <Field label="设备">
            <Input value={localDevice} onChange={(event) => setLocalDevice(event.target.value)} placeholder="auto / cpu / cuda" />
          </Field>
          <Field label="转写提示词">
            <textarea className="textarea-control" value={transcriptionPrompt} onChange={(event) => setTranscriptionPrompt(event.target.value)} rows={3} />
          </Field>
        </details>
        <div className="transcription-guide">
          <strong>本地转写怎么选</strong>
          <p>优先用 faster-whisper：速度和资源占用更适合批量账号监控。openai-whisper 更适合已有 Whisper 环境的用户。两者都需要先勾选“下载无水印视频”，本地模型才能读取视频文件。</p>
          <code>python3 -m pip install faster-whisper</code>
          <code>python3 -m pip install openai-whisper</code>
        </div>
        <div className="provider-grid">
          <ProviderPill label="faster-whisper" status={activeTranscription.providers?.fasterWhisper} />
          <ProviderPill label="Whisper" status={activeTranscription.providers?.whisper} />
          <ProviderPill label="Lemonfox" status={activeTranscription.providers?.lemonfox} />
        </div>
        <Button className="full-action" variant="secondary" onClick={saveIntegrations} disabled={running !== null}>
          {running === 'integrations' ? <Loader2 className="size-4 animate-spin" /> : <Settings2 className="size-4" />}
          保存接口与转写配置
        </Button>
      </CardContent>
    </Card>
  )
}

function RuntimePanel({
  localApiBase,
  monitorDir,
  pythonBin,
  running,
  saveRuntime,
  setLocalApiBase,
  setMonitorDir,
  setPythonBin,
}: {
  localApiBase: string
  monitorDir: string
  pythonBin: string
  running: RunningAction
  saveRuntime: () => void
  setLocalApiBase: (value: string) => void
  setMonitorDir: (value: string) => void
  setPythonBin: (value: string) => void
}) {
  return (
    <Card className="control-card runtime-card">
      <CardContent>
        <PanelTitle icon={Server} title="后台解析服务" />
        <p className="panel-copy">Docker Compose 会随本项目启动内置解析服务。这里通常只需要确认 API 地址；完整上游项目只作为 Cookie、代理和高级部署管理入口。</p>
        <div className="form-grid">
          <Field label="解析 API" help="通常是 FastAPI 或兼容服务。FastAPI 框架免费开源，但服务器、代理和维护不免费。">
            <Input value={localApiBase} onChange={(event) => setLocalApiBase(event.target.value)} placeholder="http://127.0.0.1:8091" />
          </Field>
        </div>
        <details className="advanced-settings">
          <summary>开发者路径设置</summary>
          <div className="form-grid">
            <Field label="Python 命令">
              <Input value={pythonBin} onChange={(event) => setPythonBin(event.target.value)} placeholder="python3" />
            </Field>
            <Field label="Monitor 目录">
              <Input value={monitorDir} onChange={(event) => setMonitorDir(event.target.value)} placeholder="../douyin-monitor" />
            </Field>
          </div>
        </details>
        <Button className="full-action" variant="ghost" onClick={saveRuntime} disabled={running !== null}>
          {running === 'runtime' ? <Loader2 className="size-4 animate-spin" /> : <Server className="size-4" />}
          保存后台配置
        </Button>
      </CardContent>
    </Card>
  )
}

function LearningGrid() {
  return (
    <section className="learning-grid">
      {learningCards.map((card) => (
        <Card className="learning-card" key={card.title}>
          <CardContent>
            <strong>
              {card.title}
            </strong>
            <p>{card.body}</p>
            <em className="cost-note">{card.cost}</em>
            <span>{card.alternatives}</span>
          </CardContent>
        </Card>
      ))}
    </section>
  )
}

function assetDownloadUrl(path?: string) {
  return path ? `/api/assets?path=${encodeURIComponent(path)}` : ''
}

function uniqueCount(values: Array<string | undefined>) {
  return new Set(values.filter(Boolean)).size
}

function AccountResultsPanel({
  displayRows,
  feedItems,
  latestReport,
}: {
  displayRows: ReportRow[]
  feedItems: ReportRow[]
  latestReport?: ReportFile
}) {
  const rows = displayRows.length ? displayRows : []
  const accountCount = uniqueCount(rows.map((row) => row.source_account || row.author))
  const videoCount = rows.filter((row) => row.local_video_path || row.video_url).length
  const transcriptCount = rows.filter((row) => row.transcript_path || row.transcript_status === 'ok').length

  return (
    <section className="account-results-panel">
      <div className="account-results-head">
        <div>
          <PanelTitle icon={LayoutList} title="监控结果" />
          <p>最新作品会先进入本地网页端，适合预览、下载、拆解；飞书多维表格更适合后续分配、标注和复盘。</p>
        </div>
        {latestReport?.url && (
          <a className="report-open-link" href={latestReport.url} target="_blank" rel="noreferrer">
            <FileText className="size-4" />
            打开最新报告
          </a>
        )}
      </div>
      <div className="account-result-metrics">
        <span>
          <b>{rows.length}</b>
          最新作品
        </span>
        <span>
          <b>{accountCount || '-'}</b>
          来源账号
        </span>
        <span>
          <b>{videoCount}</b>
          视频可取
        </span>
        <span>
          <b>{transcriptCount}</b>
          文稿可用
        </span>
      </div>
      <TimelineSection displayRows={displayRows} feedItems={feedItems} latestReport={latestReport} mode="account" />
    </section>
  )
}

function TimelineSection({
  displayRows,
  feedItems,
  latestReport,
  mode,
}: {
  displayRows: ReportRow[]
  feedItems: ReportRow[]
  latestReport?: ReportFile
  mode?: 'compact' | 'account'
}) {
  return (
    <section className={mode ? `timeline ${mode}` : 'timeline'}>
      <div className="date-label">{formatMonthDay(latestReport?.modifiedAt)}</div>
      {feedItems.map((item, index) => (
        <TimelineItem item={item} index={index} key={`${item.video_id}-${index}`} empty={!displayRows.length} />
      ))}
    </section>
  )
}

function UtilityGrid({
  lastErrors,
  lastRun,
  parsedRun,
  reports,
}: {
  lastErrors: unknown[]
  lastRun?: RunResult
  parsedRun: Record<string, unknown> | null
  reports: ReportFile[]
}) {
  return (
    <section className="bottom-grid">
      <RunLogCard lastRun={lastRun} parsedRun={parsedRun} />
      <ReportsCard reports={reports.slice(0, 6)} />
      <AlertsCard lastErrors={lastErrors} />
    </section>
  )
}

function RunLogCard({ lastRun, parsedRun }: { lastRun?: RunResult; parsedRun: Record<string, unknown> | null }) {
  return (
    <Card className="terminal-card">
      <CardContent>
        <div className="section-title">
          <Clock3 className="size-4" />
          最近运行
        </div>
        <pre>{parsedRun ? JSON.stringify(parsedRun, null, 2) : lastRun?.stderr || lastRun?.stdout || '等待下一次运行。'}</pre>
      </CardContent>
    </Card>
  )
}

function ReportsCard({ reports }: { reports: ReportFile[] }) {
  return (
    <Card className="reports-card">
      <CardContent>
        <div className="section-title">
          <Archive className="size-4" />
          归档报告
        </div>
        <div className="report-list">
          {reports.length ? (
            reports.map((report) => (
              <a className="report-item" href={report.url || '#'} key={report.path} target="_blank" rel="noreferrer">
                <span>{report.name}</span>
                <Badge>{report.type.toUpperCase()}</Badge>
              </a>
            ))
          ) : (
            <div className="report-item empty">暂无报告</div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function AlertsCard({ lastErrors }: { lastErrors: unknown[] }) {
  return (
    <Card className="alerts-card">
      <CardContent>
        <div className="section-title">
          <AlertTriangle className="size-4" />
          监控提示
        </div>
        <div className="alert-list">
          {lastErrors.length ? (
            lastErrors.slice(0, 3).map((error, index) => (
              <div className="alert-line" key={index}>
                <span>{String((error as Record<string, unknown>).account || '账号')}</span>
                <p>{String((error as Record<string, unknown>).error || '未知错误')}</p>
              </div>
            ))
          ) : (
            <div className="alert-line good">
              <span>系统</span>
              <p>暂无最近错误。</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function ReportsPage({ outputDir, reports }: { outputDir: string; reports: ReportFile[] }) {
  const jsonCount = reports.filter((report) => report.type === 'json').length
  const mdCount = reports.filter((report) => report.type === 'md').length

  return (
    <section className="reports-page">
      <Card className="history-guide-card">
        <CardContent>
          <PanelTitle icon={History} title="历史记录怎么保存" />
          <p>每次低粉爆款搜索和对标账号监控都会写入本地归档目录，服务重启后仍从这里读取历史记录。运营同事直接看本页；需要给别人分析时，优先下载 Markdown 或 CSV。</p>
          <div className="history-meta">
            <span>本地目录：{outputDir || '等待读取'}/runs</span>
            <span>JSON {jsonCount} 份</span>
            <span>Markdown {mdCount} 份</span>
          </div>
        </CardContent>
      </Card>
      {reports.length ? (
        reports.map((report) => (
          <Card className="report-row-card" key={report.path}>
            <CardContent>
              <div>
                <Badge>{report.type.toUpperCase()}</Badge>
                <strong>{report.name}</strong>
                <p>{report.path}</p>
              </div>
              <span>{formatBytes(report.size)}</span>
              <time>{formatMonthDay(report.modifiedAt)} {formatClock(report.modifiedAt)}</time>
              <a className="report-open-link" href={report.url || '#'} target="_blank" rel="noreferrer">
                <Download className="size-4" />
                下载
              </a>
            </CardContent>
          </Card>
        ))
      ) : (
        <Card className="report-row-card">
          <CardContent>
            <div>
              <strong>暂无归档报告</strong>
              <p>运行低粉爆款搜索或对标账号监控后，会在这里显示生成的文件。</p>
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  )
}

function OpsPage({
  data,
  lastErrors,
  lastRun,
  parsedRun,
  providerStatus,
}: {
  data: DashboardData
  lastErrors: unknown[]
  lastRun?: RunResult
  parsedRun: Record<string, unknown> | null
  providerStatus: ProviderStatus
}) {
  return (
    <section className="ops-page">
      <div className="ops-diagnostics">
        <StatusPill icon={CheckCircle2} label="解析服务" value={data.service.ok ? '在线' : '异常'} tone={data.service.ok ? 'good' : 'warn'} />
        <StatusPill icon={Sparkles} label="TikHub" value={data.config.hasTikhubKey ? '已配置' : '未配置'} tone={data.config.hasTikhubKey ? 'good' : 'warn'} />
        <StatusPill icon={Captions} label="当前转写" value={providerStatus.available ? '可用' : '不可用'} tone={providerStatus.available ? 'good' : 'warn'} />
        <StatusPill icon={Archive} label="报告数" value={`${data.reports.length} 份`} />
      </div>
      <UtilityGrid lastErrors={lastErrors} lastRun={lastRun} parsedRun={parsedRun} reports={data.reports} />
    </section>
  )
}

function AboutPage() {
  return (
    <section className="about-page">
      <CostGuide />
      <DeploymentGuide />
      <Card className="about-card">
        <CardContent>
          <PanelTitle icon={ChartNoAxesColumnIncreasing} title="两个目录为什么要分开" />
          <p>低粉爆款搜索是“按关键词找机会”，对标账号监控是“按账号池看变化”。前者更像选题发现，后者更像日常巡检，放在不同目录里能减少运营同事误操作。</p>
        </CardContent>
      </Card>
      <LearningGrid />
      <Card className="about-card">
        <CardContent>
          <PanelTitle icon={History} title="参考 AIHOT 的部分" />
          <p>这里借鉴了 AIHOT 的左侧目录、顶部快速切换和信息流密度，但没有硬套新闻站结构。当前产品的核心是内部运营工作台，所以优先让配置、运行、归档、诊断都能直接落到页面。</p>
        </CardContent>
      </Card>
    </section>
  )
}

function CostGuide() {
  return (
    <Card className="about-card cost-guide-card">
      <CardContent>
        <PanelTitle icon={Gauge} title="哪些操作会消耗额度" />
        <div className="cost-guide-grid">
          <div>
            <strong>低粉爆款搜索</strong>
            <p>会调用 TikHub 搜索接口，通常按请求或套餐消耗。页数越多、关键词越多，消耗越多。</p>
          </div>
          <div>
            <strong>对标账号监控</strong>
            <p>基础抓取走本地解析服务，主要消耗 Mac mini 和网络资源；如果接入商业数据接口或代理，也会产生对应费用。</p>
          </div>
          <div>
            <strong>下载视频</strong>
            <p>不消耗 Lemonfox，但会占本机磁盘、带宽和解析服务请求。批量跑时建议先小批量验证。</p>
          </div>
          <div>
            <strong>提取口播文稿</strong>
            <p>本地 faster-whisper 主要消耗机器算力；Lemonfox 云端转写会消耗云端额度。</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function DeploymentGuide() {
  return (
    <Card className="about-card deployment-guide-card">
      <CardContent>
        <PanelTitle icon={Server} title="现阶段推荐部署方式" />
        <p>当前不需要先做公网网站。更稳妥的方式是把闲置 Mac mini 当成公司内网服务器：Mac mini 常开 Docker Compose，同事在同一网络访问 `http://Mac-mini-局域网IP:5174`，报告继续落在本地目录，飞书群机器人负责把运行结果和异常通知到群里。</p>
        <div className="deployment-steps">
          <span>1. Mac mini 固定局域网 IP</span>
          <span>2. 启动本项目 Docker Compose</span>
          <span>3. 公司同事访问 5174 页面</span>
          <span>4. 用飞书机器人/多维表格承接通知和反馈</span>
        </div>
      </CardContent>
    </Card>
  )
}

function FeedbackPage({
  feedback,
  running,
  setFeedback,
  settings,
  submitFeedback,
}: {
  feedback: FeedbackState
  running: RunningAction
  setFeedback: (value: FeedbackState) => void
  settings: FeedbackSettings
  submitFeedback: () => void
}) {
  return (
    <section className="feedback-page">
      <Card className="feedback-card">
        <CardContent>
          <PanelTitle icon={MessageSquareText} title="反馈" />
          <p className="panel-copy">发现 bug、想要的功能、看不顺眼的地方，都可以直接写。提交后会通知飞书群；也可以打开公司飞书问卷补充更完整的信息。</p>
          <Field label="想说点什么？">
            <textarea
              className="textarea-control feedback-textarea"
              value={feedback.message}
              onChange={(event) => setFeedback({ ...feedback, message: event.target.value })}
              maxLength={2000}
              placeholder="比如：对标账号这里希望能批量导入；接口配置页某个说明看不懂；某个按钮位置不顺手。"
              rows={8}
            />
          </Field>
          <div className="feedback-count">{feedback.message.length} / 2000</div>
          <div className="form-grid">
            <Field label="联系方式（选填）">
              <Input value={feedback.contact} onChange={(event) => setFeedback({ ...feedback, contact: event.target.value })} placeholder="邮箱 / 微信 / 手机号 / 飞书名" />
            </Field>
            <Field label="页面位置（选填）">
              <Input value={feedback.page} onChange={(event) => setFeedback({ ...feedback, page: event.target.value })} placeholder="例如：对标账号 / 接口配置" />
            </Field>
          </div>
          <div className="feedback-actions">
            <Button onClick={submitFeedback} disabled={running !== null || !feedback.message.trim()}>
              {running === 'feedback' ? <Loader2 className="size-4 animate-spin" /> : <MessageSquareText className="size-4" />}
              发送反馈
            </Button>
            <a className="feedback-link" href={settings.formUrl || settings.baseUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="size-4" />
              打开飞书问卷
            </a>
          </div>
          <p className="panel-hint">{settings.webhookConfigured ? '飞书群机器人已配置，页面内提交会同步通知。' : '当前环境没有配置 FEISHU_FEEDBACK_WEBHOOK，页面会保留反馈结果提示；部署时配置环境变量即可通知飞书群。'}</p>
        </CardContent>
      </Card>
    </section>
  )
}

function PanelTitle({ icon: Icon, title }: { icon: IconComponent; title: string }) {
  return (
    <div className="panel-title">
      <Icon className="size-4" />
      <strong>{title}</strong>
    </div>
  )
}

function Field({ label, children, help }: { label: string; children: ReactNode; help?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {help && <small className="field-help">{help}</small>}
    </label>
  )
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (value: string) => void
  options: Array<string | { label: string; value: string }>
}) {
  return (
    <select className="select-control" value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => {
        const value = typeof option === 'string' ? option : option.value
        const label = typeof option === 'string' ? option : option.label
        return (
          <option value={value} key={value}>
            {label}
          </option>
        )
      })}
    </select>
  )
}

function NumberInput({
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
}) {
  return (
    <input
      className="number-control"
      type="number"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  )
}

function StatusPill({
  icon: Icon,
  label,
  value,
  tone = 'default',
}: {
  icon: IconComponent
  label: string
  value: string
  tone?: 'default' | 'good' | 'warn'
}) {
  return (
    <div className={`status-pill ${tone}`}>
      <Icon className="size-4" />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function formatProvider(provider?: string) {
  if (provider === 'faster-whisper') return '本地 faster-whisper'
  if (provider === 'whisper') return '本地 Whisper'
  return 'Lemonfox'
}

function getProviderStatus(settings: TranscriptionSettings): ProviderStatus {
  if (settings.provider === 'faster-whisper') {
    return settings.providers?.fasterWhisper || { available: false, detail: '当前 Python 环境缺少 faster-whisper' }
  }
  if (settings.provider === 'whisper') {
    return settings.providers?.whisper || { available: false, detail: '当前 Python 环境缺少 openai-whisper' }
  }
  return settings.providers?.lemonfox || { available: false, detail: '需要配置 LEMONFOX_API_KEY' }
}

function ProviderPill({ label, status }: { label: string; status?: ProviderStatus }) {
  const available = Boolean(status?.available)
  return (
    <div className={available ? 'provider-pill available' : 'provider-pill'}>
      <span>{label}</span>
      <strong>{available ? '可用' : '不可用'}</strong>
      <p>{status?.detail || '等待检测'}</p>
    </div>
  )
}

function TimelineItem({ item, index, empty }: { item: ReportRow; index: number; empty: boolean }) {
  const score = item.viral_score
    ? Math.min(99, Math.max(48, item.viral_score))
    : Math.min(99, Math.max(48, Math.round(((item.like_count || 0) + (item.collect_count || 0) + (item.comment_count || 0) + (item.share_count || 0)) / 35)))
  const hasAssets = Boolean(item.local_video_path || item.transcript_path)
  const localVideoUrl = assetDownloadUrl(item.local_video_path)
  const transcriptUrl = assetDownloadUrl(item.transcript_path)
  const srtUrl = assetDownloadUrl(item.srt_path)
  const isBenchmark = Boolean(item.source_account)

  return (
    <article className="timeline-row">
      <div className="time-col">
        <strong>{formatClock(item.create_time)}</strong>
        <i />
      </div>
      <Card className={isBenchmark ? 'feed-card benchmark-feed-card' : 'feed-card'}>
        <CardContent>
          <div className="feed-head">
            <div className="source-line">
              {item.cover_url ? <img src={item.cover_url} alt="" /> : <Video className="size-4" />}
              <span>{item.author || item.source_account || '本地监控器'}</span>
              {item.keyword && <em>@{item.keyword}</em>}
            </div>
            <div className="rank-pills">
              <Badge variant={empty ? 'warning' : 'success'}>{empty ? '待运行' : hasAssets ? '已归档' : '精选'}</Badge>
              <span>{score || 63}</span>
            </div>
          </div>

          <h2>{item.title || '未命名作品'}</h2>
          <p className="feed-desc">
            {empty
              ? '低粉爆款搜索和对标账号监控已经接到本地页面。'
              : item.transcript_error || item.download_error || item.hit_reason || (isBenchmark ? '该作品来自对标账号池，可继续拆标题、封面、口播结构和创作角度。' : '该素材已进入本地监控归档，可继续拆封面、标题、口播结构和互动数据。')}
          </p>

          <div className="tag-row">
            <span>粉丝 {formatNumber(item.follower_count)}</span>
            <span>点赞 {formatNumber(item.like_count)}</span>
            <span>评论 {formatNumber(item.comment_count)}</span>
            <span>收藏 {formatNumber(item.collect_count)}</span>
            <span>转发 {formatNumber(item.share_count)}</span>
          </div>

          <div className="reason-box">
            <strong>{isBenchmark ? '拆解提示：' : '推荐理由：'}</strong>
            {empty
              ? '先运行一次搜索或账号监控，命中的素材会按时间线展示在这里。'
              : item.hit_reason || (isBenchmark ? `对标账号最新作品，可优先记录选题角度、标题结构和口播节奏。素材序号 ${index + 1}。` : `互动数据超过监控阈值，适合做低粉爆款拆解。素材序号 ${index + 1}。`)}
          </div>

          <div className="card-actions">
            {item.url && (
              <a href={item.url} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" />
                打开原链接
              </a>
            )}
            {localVideoUrl && (
              <a href={localVideoUrl} target="_blank" rel="noreferrer">
                <Download className="size-4" />
                下载无水印
              </a>
            )}
            {item.video_url && (
              <a href={item.video_url} target="_blank" rel="noreferrer">
                <Download className="size-4" />
                视频源
              </a>
            )}
            {transcriptUrl && (
              <a href={transcriptUrl} target="_blank" rel="noreferrer">
                <Captions className="size-4" />
                下载文稿
              </a>
            )}
            {srtUrl && (
              <a href={srtUrl} target="_blank" rel="noreferrer">
                <FileText className="size-4" />
                下载字幕
              </a>
            )}
          </div>
        </CardContent>
      </Card>
    </article>
  )
}

export default App
