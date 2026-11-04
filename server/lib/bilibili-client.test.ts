import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BilibiliRiskError,
  getBilibiliPlayInfo,
  isBilibiliMediaHost,
  mapPlayUrl,
  mapSearchVideo,
  parseDuration,
  readingsFromTitle,
  resetBilibiliState,
  searchBilibiliTracks,
} from './bilibili-client'
import { audioContentTypeForUrl, audioProxyHeadersFor } from './netease-client'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

afterEach(() => resetBilibiliState())

describe('视频标题拆成歌名/歌手读法', () => {
  it('书名号里是歌名，去掉宣传标签、画质词与歌词摘句', () => {
    expect(readingsFromTitle('【𝐇𝐢-𝐑𝐞𝐬无损音质】｜《晴天》- 周杰伦 -‘故事的小黄花’', 'VV音乐局')).toEqual([
      { name: '晴天', artists: ['周杰伦', 'VV音乐局'] },
    ])
    expect(readingsFromTitle('《晴天》 - 周杰伦「刮风这天我试过握着你手」', 'UP')).toEqual([
      { name: '晴天', artists: ['周杰伦', 'UP'] },
    ])
    expect(readingsFromTitle('米津玄師「Lemon」MV', 'UP')).toEqual([{ name: 'Lemon', artists: ['米津玄師', 'UP'] }])
  })

  it('没有书名号时每段都试作歌名，英文连字符不拆', () => {
    expect(readingsFromTitle('【4K修复】周杰伦 - 晴天MV 2160P修复版', 'UP')).toEqual([
      { name: '周杰伦', artists: ['晴天', 'UP'] },
      { name: '晴天', artists: ['周杰伦', 'UP'] },
    ])
    expect(readingsFromTitle('晴天-周杰伦', 'UP').map((item) => item.name)).toEqual(['晴天', '周杰伦'])
    expect(readingsFromTitle('Jay-Z - Empire State of Mind', 'UP')[0]).toEqual({ name: 'Jay-Z', artists: ['Empire State of Mind', 'UP'] })
  })

  it('搜索结果去掉高亮标签，排除翻唱/演奏分区，时长转毫秒', () => {
    const base = { bvid: 'BV1BZbSzZEGT', author: 'UP', duration: '4:30', pic: '//i0.hdslb.com/a.jpg' }
    const [track] = mapSearchVideo({ ...base, typename: '音乐综合', title: '《<em class="keyword">晴天</em>》周杰伦' })
    expect(track).toMatchObject({ source: 'bilibili', id: 'BV1BZbSzZEGT', name: '晴天', duration: 270000, cover: 'https://i0.hdslb.com/a.jpg' })
    expect(mapSearchVideo({ ...base, typename: '翻唱', title: '《晴天》周杰伦' })).toEqual([])
    expect(mapSearchVideo({ ...base, typename: '音乐综合', title: '【史诗版】《夜曲》cover 周杰伦' })).toEqual([])
    expect(mapSearchVideo({ ...base, typename: '音乐综合', title: '朴树《平凡之路》完整伴奏背景视频' })).toEqual([])
    expect(mapSearchVideo({ ...base, typename: '音乐综合', title: '《晴天》周杰伦「从前从前 现场的风」' })).toHaveLength(1)
    expect(mapSearchVideo({ ...base, typename: '音乐综合', title: '【AI Ado】米津玄师-Lemon' })).toEqual([])
    expect(mapSearchVideo({ ...base, typename: '音乐综合', title: '【AI-MV】起风了-买辣椒也用券' })).toHaveLength(2)
    expect(mapSearchVideo({ ...base, bvid: 'bad', typename: 'MV', title: '《晴天》' })).toEqual([])
    expect(mapSearchVideo({ ...base, typename: '翻唱', title: '《<em>晴天</em>》现场翻唱' }, 'browse'))
      .toMatchObject([{ id: base.bvid, name: '《晴天》现场翻唱', artist: 'UP', duration: 270000 }])
    expect(parseDuration('1:04:30')).toBe(3870000)
    expect(parseDuration('x')).toBe(0)
  })
})

describe('播放地址', () => {
  const audio = (id: number, host: string) => ({
    id, bandwidth: id, baseUrl: `https://${host}/v.m4s?deadline=2000000000`, backupUrl: [`https://upos-sz-mirrorcos.bilivideo.com/v${id}.m4s?deadline=1900000000`],
  })

  it('高档在前，主站节点优先，内网地址剔除，按最早 deadline 减余量', () => {
    const info = mapPlayUrl({ dash: { audio: [audio(30216, 'xy1.mcdn.bilivideo.cn:8082'), audio(30280, '127.0.0.1'), audio(99999, 'x.bilivideo.com')] } })
    expect(info.candidates.map((item) => [item.level, new URL(item.url).host])).toEqual([
      ['exhigh', 'upos-sz-mirrorcos.bilivideo.com'],
      ['standard', 'upos-sz-mirrorcos.bilivideo.com'],
      ['standard', 'xy1.mcdn.bilivideo.cn:8082'],
    ])
    expect(info.expiresAt).toBe(1900000000 * 1000 - 10 * 60 * 1000)
  })

  it('只回 v_voucher 视为风控并熔断，之后不再请求上游', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('finger/spi')) return json({ code: 0, data: { b_3: 'buvid-x' } })
      if (url.includes('/view')) return json({ code: 0, data: { cid: 42 } })
      return json({ code: 0, data: { v_voucher: 'voucher' } })
    }) as unknown as typeof fetch
    await expect(getBilibiliPlayInfo('BV1BZbSzZEGT', fetchImpl)).rejects.toBeInstanceOf(BilibiliRiskError)
    const calls = vi.mocked(fetchImpl).mock.calls.length
    await expect(searchBilibiliTracks('晴天', fetchImpl)).rejects.toThrow('BILIBILI_BREAKER_OPEN')
    expect(vi.mocked(fetchImpl).mock.calls.length).toBe(calls)
  })

  it('搜索带游客 buvid3 与 B 站 Referer，结果短期缓存', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('finger/spi')) return json({ code: 0, data: { b_3: 'buvid-x' } })
      expect(url).toContain('tids=3')
      expect((init?.headers as Record<string, string>).Cookie).toBe('buvid3=buvid-x')
      expect((init?.headers as Record<string, string>).Referer).toBe('https://www.bilibili.com/')
      return json({ code: 0, data: { result: [{ bvid: 'BV1BZbSzZEGT', typename: 'MV', title: '《晴天》周杰伦', author: 'UP', duration: '4:30' }] } })
    }) as unknown as typeof fetch
    expect(await searchBilibiliTracks('晴天 周杰伦', fetchImpl)).toHaveLength(1)
    expect(await searchBilibiliTracks('晴天 周杰伦', fetchImpl)).toHaveLength(1)
    expect(vi.mocked(fetchImpl).mock.calls.length).toBe(2)
  })

  it('音频代理对 B 站 CDN 补 Referer，m4s 按 audio/mp4 返回', () => {
    expect(isBilibiliMediaHost('upos-sz-mirrorcos.bilivideo.com')).toBe(true)
    expect(isBilibiliMediaHost('b-x.edge.mountaintoys.cn')).toBe(true)
    expect(isBilibiliMediaHost('example.com')).toBe(false)
    expect(audioProxyHeadersFor('https://upos-sz-mirrorcos.bilivideo.com/a.m4s', '').Referer).toBe('https://www.bilibili.com/')
    expect(audioProxyHeadersFor('https://m701.music.126.net/a.mp3', '').Referer).toBe('https://music.163.com/')
    expect(audioContentTypeForUrl('https://upos-sz-mirrorcos.bilivideo.com/a.m4s', 'application/octet-stream')).toBe('audio/mp4')
  })
})
