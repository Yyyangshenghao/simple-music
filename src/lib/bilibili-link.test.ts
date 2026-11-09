import { describe, expect, it } from 'vitest'
import { bilibiliLinkMessage, parseBilibiliLink } from './bilibili-link'

const bvid = 'BV1BZbSzZEGT'

describe('哔哩哔哩直达输入', () => {
  it.each([
    bvid,
    `bv${bvid.slice(2)}`,
    `https://www.bilibili.com/video/${bvid}`,
    `https://m.bilibili.com/video/${bvid}/?p=1&share_source=copy_web`,
    `【视频标题】 https://www.bilibili.com/video/${bvid}/?vd_source=test，快来看看`,
    `分享视频 ${bvid}，听听这首歌`,
  ])('只提取 BV 身份 %s', input => {
    expect(parseBilibiliLink(input)).toEqual({ kind: 'video', bvid })
  })

  it.each([
    `https://www.bilibili.com.evil.test/video/${bvid}`,
    `https://www.bilibili.com@evil.test/video/${bvid}`,
    `https://user:pass@www.bilibili.com/video/${bvid}`,
    `https://www.bilibili.com:8443/video/${bvid}`,
    `http://www.bilibili.com/video/${bvid}`,
    `https://www.bilibili.com/video/%42V${bvid.slice(2)}`,
    `https://www.bilibili.com/video/${bvid}/extra`,
    `https://www.bilibili.com/video/${bvid}?p=0`,
    `https://www.bilibili.com/video/${bvid}?p=1&p=1`,
    'BV123',
    'BV1BZbSzZEGTx',
  ])('拒绝混淆和无效链接 %s', input => {
    expect(parseBilibiliLink(input)).toEqual({ kind: 'unsupported', reason: 'invalid-link' })
  })

  it('分 P 与短链给出明确原因，不静默选择第一页', () => {
    for (const suffix of ['?p=2', '?p=%32', '?p=1&p=3', '#p=2']) {
      expect(parseBilibiliLink(`https://www.bilibili.com/video/${bvid}${suffix}`)).toEqual({ kind: 'unsupported', reason: 'multipart' })
    }
    expect(parseBilibiliLink('分享 https://b23.tv/abc123')).toEqual({ kind: 'unsupported', reason: 'short-link' })
    expect(bilibiliLinkMessage('short-link')).toContain('BV')
    expect(bilibiliLinkMessage('multipart')).toContain('分 P')
  })

  it('普通关键词和其他站点不触发视频详情，多个视频身份不猜测目标', () => {
    expect(parseBilibiliLink('晴天 周杰伦')).toBeNull()
    expect(parseBilibiliLink('https://example.com/music')).toBeNull()
    expect(parseBilibiliLink(`${bvid} BV1xx411c7mD`)).toEqual({ kind: 'unsupported', reason: 'invalid-link' })
  })
})
