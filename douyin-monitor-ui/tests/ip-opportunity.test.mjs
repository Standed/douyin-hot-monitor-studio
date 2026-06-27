import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildIpOperationCard } from '../server/ip-opportunity.mjs'

test('builds an IP operation card for low-fan viral material', () => {
  const card = buildIpOperationCard('lowfan', {
    title: '做 AI 的其实跟送外卖的是一样的',
    keyword: 'AI IP',
    hit_reason: '粉丝低于 10000 / 点赞达标 / 收藏达标',
    transcript_path: '/tmp/transcript.md',
    like_count: 12000,
    collect_count: 1800,
    comment_count: 600,
    share_count: 300,
  }, 0)

  assert.equal(card.sourceLabel, '低粉爆款')
  assert.equal(card.contentForm, '知识口播')
  assert.equal(card.topicLine, '为什么这条低粉内容能跑出来：做 AI 的其实跟送外卖的是一样的')
  assert.match(card.operatingView, /先判断它服务哪个业务/)
  assert.equal(card.decisionChecklist.length, 4)
  assert.deepEqual(card.decisionChecklist.map((item) => item.label), ['业务相关', '一句话选题', '证据素材', '人工审美'])
  assert.match(card.materialGap, /口播文稿/)
})

test('builds an account-monitor card without treating it as a final conclusion', () => {
  const card = buildIpOperationCard('account', {
    title: '普通人做 AI 短剧最容易踩的坑',
    source_account: '对标账号A',
    hit_reason: '对标账号最新作品',
  }, 2)

  assert.equal(card.sourceLabel, '账号监控')
  assert.equal(card.contentForm, 'AI短剧')
  assert.match(card.topicLine, /这个对标账号的新内容值得拆/)
  assert.match(card.nextAction, /记录选题角度、标题结构、口播节奏/)
  assert.match(card.materialGap, /补口播文稿/)
})
