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

export function feishuBaseStatusFromEnv(envValues = {}) {
  const appId = envValues.FEISHU_BASE_APP_ID || envValues.LARK_APP_ID || ''
  const appSecret = envValues.FEISHU_BASE_APP_SECRET || envValues.LARK_APP_SECRET || ''
  const appToken = envValues.FEISHU_BASE_APP_TOKEN || envValues.FEISHU_BASE_TOKEN || ''
  const tableId = envValues.FEISHU_BASE_TABLE_ID || ''
  const syncMode = normalizeFeishuBaseSyncMode(envValues.FEISHU_BASE_SYNC_MODE)
  const openApiConfigured = Boolean(appId && appSecret)
  const configured = Boolean(appToken && tableId && (openApiConfigured || syncMode === 'auto' || syncMode === 'lark-cli'))
  return {
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
}
