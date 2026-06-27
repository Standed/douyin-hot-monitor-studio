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
  }
}
