import { startTransition, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  Archive,
  Bot,
  Captions,
  CheckCircle2,
  Clock3,
  Command,
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
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
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
}

type ConfigSummary = {
  accountCount: number
  accounts: AccountSummary[]
  countPerAccount: number
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
}

type ReportFile = {
  name: string
  path: string
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
  transcript_error?: string
  download_error?: string
  viral_score?: number
  hit_reason?: string
}

type DashboardData = {
  service: ServiceStatus
  config: ConfigSummary
  reports: ReportFile[]
  latestRows: ReportRow[]
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

const defaultData: DashboardData = {
  service: {
    ok: false,
    apiBase: 'http://127.0.0.1:8091',
    checkedAt: '',
  },
  config: {
    accountCount: 0,
    accounts: [],
    countPerAccount: 2,
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
      pages: 1,
      route: 2,
    },
    hasTikhubKey: false,
    hasLemonfoxKey: false,
  },
  reports: [],
  latestRows: [],
  state: {},
}

const publishOptions = ['不限', '最近一天', '最近一周', '最近半年']
const durationOptions = ['不限', '1 分钟以内', '1-5 分钟', '5 分钟以上']
const sortOptions = ['综合排序', '最多点赞', '最新发布']

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || response.statusText)
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

function parseRunOutput(result?: RunResult) {
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

function App() {
  const [data, setData] = useState<DashboardData>(defaultData)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState<'account' | 'lowfan' | 'session' | null>(null)
  const [lastRun, setLastRun] = useState<RunResult | undefined>()
  const [keyword, setKeyword] = useState('AI智能体')
  const [publishTime, setPublishTime] = useState('最近一周')
  const [duration, setDuration] = useState('不限')
  const [sort, setSort] = useState('最多点赞')
  const [route, setRoute] = useState('2')
  const [pages, setPages] = useState(1)
  const [count, setCount] = useState(20)
  const [maxAccounts, setMaxAccounts] = useState<'3' | 'all'>('3')
  const [limit, setLimit] = useState(2)
  const [timeout, setTimeoutValue] = useState(18)
  const [includeSeen, setIncludeSeen] = useState(false)
  const [downloadVideo, setDownloadVideo] = useState(false)
  const [transcribe, setTranscribe] = useState(false)
  const [sessionid, setSessionid] = useState('')
  const [activeTab, setActiveTab] = useState('精选')
  const [resultMode, setResultMode] = useState<'latest' | 'lowfan' | 'account'>('latest')

  const latestReport = data.reports[0]
  const parsedRun = useMemo(() => parseRunOutput(lastRun), [lastRun])
  const lastErrors = getLastErrors(data.state)
  const visibleAccounts = maxAccounts === 'all' ? data.config.accounts : data.config.accounts.slice(0, Number(maxAccounts))
  const displayRows = lastRun?.rows?.length ? lastRun.rows : data.latestRows

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

  async function refresh() {
    setLoading(true)
    try {
      setData(await api<DashboardData>('/api/dashboard'))
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
          maxAccounts,
          includeSeen,
          download: downloadVideo,
          transcribe,
          timeout,
        }),
      })
      setLastRun(result)
      setResultMode('account')
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

  useEffect(() => {
    let cancelled = false

    api<DashboardData>('/api/dashboard')
      .then((dashboard) => {
        if (cancelled) return
        startTransition(() => {
          setData(dashboard)
          setCount(dashboard.config.defaultLowFan.count || 20)
          setPages(dashboard.config.defaultLowFan.pages || 1)
          setRoute(String(dashboard.config.defaultLowFan.route || 1))
          setLimit(dashboard.config.countPerAccount || 2)
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
          <NavItem active={activeTab === '精选'} icon={Zap} label="精选" onClick={() => setActiveTab('精选')} />
          <NavItem active={activeTab === '账号'} icon={LayoutList} label="账号监控" onClick={() => setActiveTab('账号')} />
          <NavItem active={activeTab === '低粉'} icon={Search} label="低粉爆款" onClick={() => setActiveTab('低粉')} />
          <NavItem icon={FileText} label="账号日报" onClick={() => setActiveTab('日报')} />
          <NavItem icon={Bot} label="Agent 接入" onClick={() => setActiveTab('Agent')} />
          <NavItem icon={Heart} label="关于" onClick={() => setActiveTab('关于')} />
          <NavItem icon={History} label="更新日志" onClick={() => setActiveTab('日志')} />
          <NavItem icon={Send} label="反馈" onClick={() => setActiveTab('反馈')} />
          <NavItem icon={Plus} label="信源提报" onClick={() => setActiveTab('提报')} />
        </nav>

        <div className="sidebar-bottom">
          <div className="theme-toggle" aria-label="主题切换">
            <Moon className="size-4" />
            <Command className="size-4" />
            <Sun className="size-4" />
          </div>
          <div className="login-row">
            <LogIn className="size-4" />
            <span>本地模式</span>
          </div>
        </div>
      </aside>

      <section className="main-stream">
        <header className="stream-header">
          <div>
            <h1>精选</h1>
            <p>{resultMode === 'lowfan' ? '低粉爆款搜索结果' : resultMode === 'account' ? '对标账号最新作品' : '本地自动挑选的高价值抖音素材'}</p>
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
              {['精选', '账号', '低粉', '封面', '口播', '归档'].map((tab) => (
                <button className={tab === activeTab ? 'tab active' : 'tab'} key={tab} onClick={() => setActiveTab(tab)}>
                  {tab}
                </button>
              ))}
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
          <StatusPill icon={Users} label="监控账号" value={`${data.config.accountCount} 个`} />
          <StatusPill icon={Gauge} label="粉丝阈值" value={`≤ ${formatNumber(data.config.thresholds.fans_num)}`} />
          <StatusPill icon={Sparkles} label="TikHub" value={data.config.hasTikhubKey ? '已接入' : '未配置'} tone={data.config.hasTikhubKey ? 'good' : 'warn'} />
          <StatusPill icon={Captions} label="Lemonfox" value={data.config.hasLemonfoxKey ? '已接入' : '未配置'} tone={data.config.hasLemonfoxKey ? 'good' : 'warn'} />
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

        <section className="control-grid">
          <Card className="control-card lowfan-card">
            <CardContent>
              <PanelTitle icon={Search} title="低粉爆款搜索" />
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
                <Field label="搜索线路">
                  <Select
                    value={route}
                    onChange={setRoute}
                    options={[
                      { label: '线路一 Web', value: '1' },
                      { label: '线路二 Search', value: '2' },
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
                <span>粉丝 ≤ {formatNumber(data.config.thresholds.fans_num)}</span>
                <span>赞 ≥ {formatNumber(data.config.thresholds.likes)}</span>
                <span>藏 ≥ {formatNumber(data.config.thresholds.collect)}</span>
                <span>评 ≥ {formatNumber(data.config.thresholds.comment)}</span>
                <span>转 ≥ {formatNumber(data.config.thresholds.share)}</span>
              </div>
              <Button className="full-action" onClick={runLowfan} disabled={running !== null || !keyword.trim()}>
                {running === 'lowfan' ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                开始搜索低粉爆款
              </Button>
            </CardContent>
          </Card>

          <Card className="control-card account-card">
            <CardContent>
              <PanelTitle icon={ShieldCheck} title="对标账号监控" />
              <div className="form-grid account-form">
                <Field label="账号范围">
                  <Select
                    value={maxAccounts}
                    onChange={(value) => setMaxAccounts(value as '3' | 'all')}
                    options={[
                      { label: '前 3 个', value: '3' },
                      { label: '全部账号', value: 'all' },
                    ]}
                  />
                </Field>
                <Field label="每账号条数">
                  <NumberInput value={limit} min={1} max={10} onChange={setLimit} />
                </Field>
                <Field label="请求超时">
                  <NumberInput value={timeout} min={8} max={60} onChange={setTimeoutValue} />
                </Field>
              </div>
              <div className="switch-panel compact">
                <Switch label="包含已看过作品" checked={includeSeen} onCheckedChange={setIncludeSeen} />
                <Switch label="下载无水印视频" checked={downloadVideo} onCheckedChange={setDownloadVideo} />
                <Switch label="提取口播文稿" checked={transcribe} onCheckedChange={setTranscribe} />
              </div>
              <div className="account-list">
                {visibleAccounts.map((account) => (
                  <span className="account-chip" key={account.secUserId}>
                    <b>{String(account.index).padStart(2, '0')}</b>
                    {account.name}
                  </span>
                ))}
              </div>
              <Button className="full-action" variant="secondary" onClick={runAccount} disabled={running !== null}>
                {running === 'account' ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                开始监控对标账号
              </Button>
            </CardContent>
          </Card>

          <Card className="control-card session-card">
            <CardContent>
              <PanelTitle icon={KeyRound} title="抖音登录态" />
              <div className="session-box">
                <Input value={sessionid} onChange={(event) => setSessionid(event.target.value)} placeholder="sessionid" type="password" />
                <Button variant="ghost" onClick={saveSession} disabled={running !== null || !sessionid.trim()}>
                  {running === 'session' ? <Loader2 className="size-4 animate-spin" /> : <Settings2 className="size-4" />}
                  保存
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="timeline">
          <div className="date-label">{formatMonthDay(latestReport?.modifiedAt)}</div>
          {feedItems.map((item, index) => (
            <TimelineItem item={item} index={index} key={`${item.video_id}-${index}`} empty={!displayRows.length} />
          ))}
        </section>

        <section className="bottom-grid">
          <Card className="terminal-card">
            <CardContent>
              <div className="section-title">
                <Clock3 className="size-4" />
                最近运行
              </div>
              <pre>{parsedRun ? JSON.stringify(parsedRun, null, 2) : lastRun?.stderr || lastRun?.stdout || '等待下一次运行。'}</pre>
            </CardContent>
          </Card>

          <Card className="reports-card">
            <CardContent>
              <div className="section-title">
                <Archive className="size-4" />
                归档报告
              </div>
              <div className="report-list">
                {data.reports.slice(0, 6).map((report) => (
                  <div className="report-item" key={report.path}>
                    <span>{report.name}</span>
                    <Badge>{report.type.toUpperCase()}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

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
        </section>
      </section>
    </main>
  )
}

function NavItem({ active, icon: Icon, label, onClick }: { active?: boolean; icon: IconComponent; label: string; onClick: () => void }) {
  return (
    <button className={active ? 'nav-item active' : 'nav-item'} onClick={onClick}>
      <Icon className="size-5" />
      <span>{label}</span>
    </button>
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
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

function TimelineItem({ item, index, empty }: { item: ReportRow; index: number; empty: boolean }) {
  const score = item.viral_score
    ? Math.min(99, Math.max(48, item.viral_score))
    : Math.min(99, Math.max(48, Math.round(((item.like_count || 0) + (item.collect_count || 0) + (item.comment_count || 0) + (item.share_count || 0)) / 35)))
  const hasAssets = Boolean(item.local_video_path || item.transcript_path)

  return (
    <article className="timeline-row">
      <div className="time-col">
        <strong>{formatClock(item.create_time)}</strong>
        <i />
      </div>
      <Card className="feed-card">
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
              : item.transcript_error || item.download_error || item.hit_reason || '该素材已进入本地监控归档，可继续拆封面、标题、口播结构和互动数据。'}
          </p>

          <div className="tag-row">
            <span>粉丝 {formatNumber(item.follower_count)}</span>
            <span>点赞 {formatNumber(item.like_count)}</span>
            <span>评论 {formatNumber(item.comment_count)}</span>
            <span>收藏 {formatNumber(item.collect_count)}</span>
            <span>转发 {formatNumber(item.share_count)}</span>
          </div>

          <div className="reason-box">
            <strong>推荐理由：</strong>
            {empty ? '先运行一次搜索或账号监控，命中的素材会按时间线展示在这里。' : item.hit_reason || `互动数据超过监控阈值，适合做低粉爆款拆解。素材序号 ${index + 1}。`}
          </div>

          <div className="card-actions">
            {item.url && (
              <a href={item.url} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" />
                打开原链接
              </a>
            )}
            {item.video_url && (
              <a href={item.video_url} target="_blank" rel="noreferrer">
                <Download className="size-4" />
                视频源
              </a>
            )}
            {item.transcript_path && (
              <button>
                <Captions className="size-4" />
                文稿已生成
              </button>
            )}
          </div>
        </CardContent>
      </Card>
    </article>
  )
}

export default App
