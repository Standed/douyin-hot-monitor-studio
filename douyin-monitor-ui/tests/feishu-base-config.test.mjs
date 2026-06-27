import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildFeishuBaseCheckResult, buildFeishuBaseFieldGuide, buildFeishuBaseSetupGuide, feishuBaseStatusFromEnv, normalizeFeishuBaseConfigInput } from '../server/feishu-base-config.mjs'

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

test('builds a user-facing setup guide for team Feishu sync', () => {
  const emptyGuide = buildFeishuBaseSetupGuide(feishuBaseStatusFromEnv({}))
  assert.equal(emptyGuide.ready, false)
  assert.match(emptyGuide.title, /还差 3 项/)
  assert.deepEqual(emptyGuide.missingKeys, ['appToken', 'tableId', 'openApi'])
  assert.equal(emptyGuide.steps[0], '填写飞书 Base Token')

  const partialGuide = buildFeishuBaseSetupGuide(feishuBaseStatusFromEnv({ FEISHU_BASE_APP_TOKEN: 'base', FEISHU_BASE_TABLE_ID: 'table' }))
  assert.equal(partialGuide.ready, false)
  assert.deepEqual(partialGuide.missingKeys, ['openApi'])
  assert.match(partialGuide.steps[0], /App ID 和 App Secret/)

  const readyGuide = buildFeishuBaseSetupGuide(feishuBaseStatusFromEnv({
    FEISHU_BASE_APP_TOKEN: 'base',
    FEISHU_BASE_TABLE_ID: 'table',
    FEISHU_BASE_APP_ID: 'cli_xxx',
    FEISHU_BASE_APP_SECRET: 'secret',
  }))
  assert.equal(readyGuide.ready, true)
  assert.deepEqual(readyGuide.missingKeys, [])
  assert.equal(readyGuide.title, '飞书结果库已具备团队同步配置')
})

test('builds a Feishu Base field guide for MVP setup', () => {
  const guide = buildFeishuBaseFieldGuide()

  assert.equal(guide.required.length, 1)
  assert.equal(guide.required[0].name, '去重键')
  assert.match(guide.required[0].reason, /安全去重/)
  assert.deepEqual(guide.groups.map((group) => group.label), ['运营协作', 'IP操盘判断', '资产与报告'])

  const recommendedNames = guide.groups.flatMap((group) => group.fields.map((field) => field.name))
  assert.ok(recommendedNames.includes('IP操盘判断'))
  assert.ok(recommendedNames.includes('下一步动作'))
  assert.ok(recommendedNames.includes('口播正文'))
  assert.match(guide.copyText, /必需字段：去重键/)
  assert.match(guide.copyText, /IP操盘判断/)
})

test('evaluates Feishu Base config and field readiness', () => {
  const emptyCheck = buildFeishuBaseCheckResult(feishuBaseStatusFromEnv({}))
  assert.equal(emptyCheck.ready, false)
  assert.equal(emptyCheck.status, 'blocked_by_config')
  assert.deepEqual(emptyCheck.missingConfig, ['appToken', 'tableId', 'openApi'])

  const missingRequired = buildFeishuBaseCheckResult(
    feishuBaseStatusFromEnv({
      FEISHU_BASE_APP_TOKEN: 'base',
      FEISHU_BASE_TABLE_ID: 'table',
      FEISHU_BASE_APP_ID: 'cli_xxx',
      FEISHU_BASE_APP_SECRET: 'secret',
    }),
    ['标题', '素材摘要', 'IP操盘判断'],
  )
  assert.equal(missingRequired.ready, false)
  assert.equal(missingRequired.status, 'missing_required_fields')
  assert.deepEqual(missingRequired.missingRequired, ['去重键'])

  const readyWithRecommendations = buildFeishuBaseCheckResult(
    feishuBaseStatusFromEnv({
      FEISHU_BASE_APP_TOKEN: 'base',
      FEISHU_BASE_TABLE_ID: 'table',
      FEISHU_BASE_APP_ID: 'cli_xxx',
      FEISHU_BASE_APP_SECRET: 'secret',
    }),
    ['去重键', '标题', '素材摘要', 'IP操盘判断'],
  )
  assert.equal(readyWithRecommendations.ready, true)
  assert.equal(readyWithRecommendations.status, 'ready_with_recommendations')
  assert.ok(readyWithRecommendations.missingRecommended.includes('下一步动作'))

  const allFields = buildFeishuBaseFieldGuide().groups.flatMap((group) => group.fields.map((field) => field.name))
  const ready = buildFeishuBaseCheckResult(
    feishuBaseStatusFromEnv({
      FEISHU_BASE_APP_TOKEN: 'base',
      FEISHU_BASE_TABLE_ID: 'table',
      FEISHU_BASE_APP_ID: 'cli_xxx',
      FEISHU_BASE_APP_SECRET: 'secret',
    }),
    ['去重键', ...allFields],
  )
  assert.equal(ready.ready, true)
  assert.equal(ready.status, 'ready')
  assert.deepEqual(ready.missingRecommended, [])
})
