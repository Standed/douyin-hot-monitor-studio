function truncateText(value, maxLength = 80) {
  const text = String(value || '').trim()
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 1)}…`
}

function rowText(row = {}) {
  return [row.keyword, row.title, row.hit_reason, row.source_account, row.author].filter(Boolean).join(' ')
}

export function inferContentForm(row = {}, kind = '') {
  const text = rowText(row)
  if (/短剧|剧本|漫剧|视频号/.test(text)) return 'AI短剧'
  if (/教程|步骤|实操|工具|工作流|教程/.test(text)) return '工具实操'
  if (/vlog|记录|门店|探店|过程|对比/.test(text)) return '过程记录'
  if (/账号|对标|拆解|爆款/.test(text)) return '账号对标'
  if (/趋势|行业|变化|机会|增长/.test(text)) return '行业观察'
  return kind === 'account' ? '对标观察' : '知识口播'
}

export function buildIpOperationCard(kind = '', row = {}, index = 0) {
  const isAccount = kind === 'account'
  const title = truncateText(row.title || '未命名作品', 80)
  const sourceLabel = isAccount ? '账号监控' : '低粉爆款'
  const contentForm = inferContentForm(row, kind)
  const topicLine = isAccount ? `这个对标账号的新内容值得拆：${title}` : `为什么这条低粉内容能跑出来：${title}`
  const metricEvidence = [
    row.like_count ? `点赞 ${row.like_count}` : '',
    row.collect_count ? `收藏 ${row.collect_count}` : '',
    row.comment_count ? `评论 ${row.comment_count}` : '',
    row.share_count ? `转发 ${row.share_count}` : '',
  ].filter(Boolean).join(' / ')

  return {
    sourceLabel,
    contentForm,
    topicLine,
    operatingView: '先判断它服务哪个业务、哪类账号和哪种转化场景，不只看播放和点赞。',
    nextAction: isAccount
      ? `来自监控账号池第 ${Number(index) + 1} 条新素材。先记录选题角度、标题结构、口播节奏和评论区反馈，再决定是否复用。`
      : `来自${row.keyword ? `关键词“${row.keyword}”` : '本次关键词'}低粉爆款搜索。先拆前三秒钩子、封面承诺、互动异常点和可复用观点。`,
    materialGap: row.transcript_path
      ? '已有口播文稿，可继续补评论区反馈、封面截图和账号主页判断。'
      : '建议补口播文稿、评论区截图或创作者主页信息，再进入成稿。',
    evidenceLine: [row.hit_reason, metricEvidence].filter(Boolean).join(' ｜ '),
    decisionChecklist: [
      { label: '业务相关', detail: '是否服务明确账号、项目或产品，而不是只追热点。' },
      { label: '一句话选题', detail: '能否提炼成一句让人想继续看的观点或痛点。' },
      { label: '证据素材', detail: '是否有口播、案例、评论、截图或数据支撑。' },
      { label: '人工审美', detail: '最后由懂内容的人判断是否值得拍、写或沉淀。' },
    ],
  }
}
