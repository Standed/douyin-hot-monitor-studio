export function maskSecret(value) {
  if (!value) return ''
  const normalized = String(value).trim()
  if (normalized.length <= 10) return '已配置'
  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`
}

export function normalizeFeishuBaseSyncMode(value) {
  const mode = String(value || 'auto').trim().toLowerCase()
  return ['auto', 'openapi', 'lark-cli'].includes(mode) ? mode : 'auto'
}

export function normalizeFeishuBaseConfigInput(value = {}) {
  const updates = {}
  const syncMode = normalizeFeishuBaseSyncMode(value.syncMode || value.FEISHU_BASE_SYNC_MODE)
  updates.FEISHU_BASE_SYNC_MODE = syncMode

  const mappings = [
    ['appId', 'FEISHU_BASE_APP_ID'],
    ['appSecret', 'FEISHU_BASE_APP_SECRET'],
    ['appToken', 'FEISHU_BASE_APP_TOKEN'],
    ['tableId', 'FEISHU_BASE_TABLE_ID'],
  ]
  for (const [inputKey, envKey] of mappings) {
    const raw = value[inputKey] ?? value[envKey]
    const text = String(raw || '').trim()
    if (text) updates[envKey] = text
  }
  return updates
}

export function buildFeishuBaseSetupGuide(status = {}) {
  const missing = []
  if (!status.appTokenConfigured) {
    missing.push({
      key: 'appToken',
      step: '填写飞书 Base Token',
      reason: '用于定位团队协作的多维表格结果库。',
    })
  }
  if (!status.tableIdConfigured) {
    missing.push({
      key: 'tableId',
      step: '填写飞书 Table ID',
      reason: '用于定位要写入的具体数据表。',
    })
  }
  if (!status.openApiConfigured) {
    missing.push({
      key: 'openApi',
      step: '填写飞书应用 App ID 和 App Secret',
      reason: '正式团队同步建议使用 OpenAPI，避免依赖个人 lark-cli 登录态。',
    })
  }

  return {
    ready: missing.length === 0,
    title: missing.length ? `还差 ${missing.length} 项即可稳定写入飞书` : '飞书结果库已具备团队同步配置',
    missingKeys: missing.map((item) => item.key),
    steps: missing.map((item) => item.step),
    reasons: missing.map((item) => item.reason),
  }
}

export function buildFeishuBaseFieldGuide() {
  const required = [
    {
      name: '去重键',
      reason: '用于按素材唯一键安全去重；缺少它时同步会停止，避免重复追加。',
    },
  ]
  const groups = [
    {
      label: '运营协作',
      fields: [
        { name: '标题', reason: '快速判断素材主题。' },
        { name: '素材摘要', reason: '用一句话看懂素材价值。' },
        { name: '处理状态', reason: '标记待处理、已入选、已放弃。' },
        { name: '负责人', reason: '方便团队认领。' },
      ],
    },
    {
      label: 'IP操盘判断',
      fields: [
        { name: '选题句', reason: '沉淀一句话选题。' },
        { name: '内容形式', reason: '判断是知识口播、AI短剧、工具实操等。' },
        { name: 'IP操盘判断', reason: '记录业务相关性和内容判断口径。' },
        { name: '下一步动作', reason: '明确补素材、改写或进入成稿。' },
      ],
    },
    {
      label: '资产与报告',
      fields: [
        { name: '原视频链接', reason: '回看原始素材。' },
        { name: '口播正文', reason: '用于拆标题、钩子和表达结构。' },
        { name: '无水印视频', reason: '归档可下载资产。' },
        { name: 'Markdown报告', reason: '回看本次运行报告。' },
      ],
    },
  ]
  const copyText = [
    `必需字段：${required.map((field) => field.name).join('、')}`,
    ...groups.map((group) => `${group.label}：${group.fields.map((field) => field.name).join('、')}`),
  ].join('\n')
  return { required, groups, copyText }
}

export function feishuBaseStatusFromEnv(envValues = {}) {
  const appId = envValues.FEISHU_BASE_APP_ID || envValues.LARK_APP_ID || ''
  const appSecret = envValues.FEISHU_BASE_APP_SECRET || envValues.LARK_APP_SECRET || ''
  const appToken = envValues.FEISHU_BASE_APP_TOKEN || envValues.FEISHU_BASE_TOKEN || ''
  const tableId = envValues.FEISHU_BASE_TABLE_ID || ''
  const syncMode = normalizeFeishuBaseSyncMode(envValues.FEISHU_BASE_SYNC_MODE)
  const openApiConfigured = Boolean(appId && appSecret)
  const configured = Boolean(appToken && tableId && (openApiConfigured || syncMode === 'auto' || syncMode === 'lark-cli'))
  const status = {
    configured,
    openApiConfigured,
    syncMode,
    appIdConfigured: Boolean(appId),
    appSecretConfigured: Boolean(appSecret),
    appTokenConfigured: Boolean(appToken),
    tableIdConfigured: Boolean(tableId),
    baseUrl: appToken ? `https://xiyangshiai.feishu.cn/base/${appToken}` : '',
    masked: {
      appId: maskSecret(appId),
      appSecret: maskSecret(appSecret),
      appToken: maskSecret(appToken),
      tableId: maskSecret(tableId),
    },
  }
  return {
    ...status,
    setupGuide: buildFeishuBaseSetupGuide(status),
    fieldGuide: buildFeishuBaseFieldGuide(),
  }
}
