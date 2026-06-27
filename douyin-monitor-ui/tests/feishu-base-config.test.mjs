import assert from 'node:assert/strict'
import { test } from 'node:test'
import { feishuBaseStatusFromEnv, normalizeFeishuBaseConfigInput } from '../server/feishu-base-config.mjs'

test('normalizes Feishu Base config input without leaking secrets', () => {
  const input = normalizeFeishuBaseConfigInput({
    syncMode: ' OpenAPI ',
    appId: ' cli_xxx ',
    appSecret: ' secret ',
    appToken: ' bascn123 ',
    tableId: ' tbl123 ',
  })

  assert.deepEqual(input, {
    FEISHU_BASE_SYNC_MODE: 'openapi',
    FEISHU_BASE_APP_ID: 'cli_xxx',
    FEISHU_BASE_APP_SECRET: 'secret',
    FEISHU_BASE_APP_TOKEN: 'bascn123',
    FEISHU_BASE_TABLE_ID: 'tbl123',
  })
})

test('reports Feishu Base as configured only when Base and auth are present', () => {
  assert.equal(feishuBaseStatusFromEnv({ FEISHU_BASE_APP_TOKEN: 'base', FEISHU_BASE_TABLE_ID: 'table' }).configured, true)
  assert.equal(feishuBaseStatusFromEnv({ FEISHU_BASE_APP_TOKEN: 'base' }).configured, false)
  assert.equal(feishuBaseStatusFromEnv({ FEISHU_BASE_TABLE_ID: 'table' }).configured, false)
})

test('exposes only masked Feishu Base values in status', () => {
  const status = feishuBaseStatusFromEnv({
    FEISHU_BASE_SYNC_MODE: 'openapi',
    FEISHU_BASE_APP_ID: 'cli_1234567890',
    FEISHU_BASE_APP_SECRET: 'secret_abcdefg',
    FEISHU_BASE_APP_TOKEN: 'bascn1234567890',
    FEISHU_BASE_TABLE_ID: 'tblabcdefg',
  })

  assert.equal(status.configured, true)
  assert.equal(status.openApiConfigured, true)
  assert.equal(status.baseUrl, 'https://xiyangshiai.feishu.cn/base/bascn1234567890')
  assert.equal(status.masked.appSecret.includes('secret_abcdefg'), false)
  assert.equal(status.masked.appToken.includes('bascn1234567890'), false)
})
