import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decryptKrc, fetchKugouLyric, kugouSignature, parseKugouLyricQuery, resetKugouLyricState } from './kugou-lyrics'

const KEY = [0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69]
const KRC = '[ti:晴天]\n[ar:周杰伦]\n[1000,800]<0,400,0>故<400,400,0>事'

/** 按酷狗格式加密：zlib 压缩、循环异或，再补 4 字节文件头。 */
function encryptKrc(text: string): string {
  const body = deflateSync(Buffer.from(text, 'utf8'))
  for (let i = 0; i < body.length; i++) body[i] ^= KEY[i % KEY.length]
  return Buffer.concat([Buffer.from('krc1'), body]).toString('base64')
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
const search = (candidates: unknown[]) => json({ status: candidates.length ? 200 : 404, candidates })
const candidate = (id: string, duration = 269000) => ({ id, accesskey: `AK${id}`, song: '晴天', singer: '周杰伦', duration })
const query = { title: '晴天', artist: '周杰伦', duration: 269500 }

let dir = ''
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kugou-test-'))
  resetKugouLyricState()
})
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

describe('酷狗逐字歌词兜底', () => {
  it('解密 KRC 密文', () => {
    expect(decryptKrc(Buffer.from(encryptKrc(KRC), 'base64'))).toBe(KRC)
    expect(() => decryptKrc(Buffer.from('krc1'))).toThrow()
  })

  it('签名按键排序拼接后加盐取 md5', () => {
    expect(kugouSignature({ b: '2', a: '1' })).toBe(kugouSignature({ a: '1', b: '2' }))
    expect(kugouSignature({ a: '1' })).toMatch(/^[0-9a-f]{32}$/)
  })

  it('校验查询参数', () => {
    expect(parseKugouLyricQuery(new URLSearchParams('title=晴天&artist=周杰伦&duration=269000'))).toEqual({ title: '晴天', artist: '周杰伦', duration: 269000 })
    expect(parseKugouLyricQuery(new URLSearchParams('title=&duration=269000'))).toBeNull()
    expect(parseKugouLyricQuery(new URLSearchParams('title=a&duration=12.5'))).toBeNull()
    expect(parseKugouLyricQuery(new URLSearchParams(`title=${'a'.repeat(201)}&duration=269000`))).toBeNull()
  })

  it('搜索后按时长粗筛，下载解密并以 KRC 标签作为候选歌名', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(search([candidate('1'), candidate('2', 300000)]))
      .mockResolvedValueOnce(json({ contenttype: 0, content: encryptKrc(KRC.replace('[ti:晴天]', "[ti:晴天 (Live)]")) }))
    const result = await fetchKugouLyric(dir, query, fetchMock as typeof fetch)
    expect(result).toEqual([{ title: '晴天 (Live)', artist: '周杰伦', duration: 269000, text: expect.stringContaining('<0,400,0>故') }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const searchUrl = new URL(String(fetchMock.mock.calls[0][0]))
    expect(searchUrl.origin + searchUrl.pathname).toBe('https://lyrics.kugou.com/v1/search')
    expect(searchUrl.searchParams.get('keyword')).toBe('周杰伦 - 晴天')
    expect(searchUrl.searchParams.get('signature')).toMatch(/^[0-9a-f]{32}$/)
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get('accesskey')).toBe('AK1')
  })

  it('命中与未收录都写入缓存，再次查询不发请求', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(search([]))
    expect(await fetchKugouLyric(dir, query, fetchMock as typeof fetch)).toEqual([])
    expect(await fetchKugouLyric(dir, query, fetchMock as typeof fetch)).toEqual([])
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(await readdir(join(dir, 'kugou-lyrics'))).toHaveLength(1)
  })

  it('纯文本歌词与损坏密文不作为候选', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(search([candidate('1'), candidate('2')]))
      .mockResolvedValueOnce(json({ contenttype: 2, content: Buffer.from('[00:01.00]逐行').toString('base64') }))
      .mockResolvedValueOnce(json({ contenttype: 0, content: Buffer.from('broken').toString('base64') }))
    expect(await fetchKugouLyric(dir, query, fetchMock as typeof fetch)).toEqual([])
  })

  it('上游失败时抛出、不写缓存，并在熔断期内不再请求', async () => {
    let clock = 1_000
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    await expect(fetchKugouLyric(dir, query, fetchMock as typeof fetch, () => clock)).rejects.toThrow()
    await expect(fetchKugouLyric(dir, query, fetchMock as typeof fetch, () => clock)).rejects.toThrow('UPSTREAM_UNAVAILABLE')
    expect(fetchMock).toHaveBeenCalledOnce()
    await expect(readdir(join(dir, 'kugou-lyrics'))).rejects.toThrow()
    clock += 11 * 60 * 1000
    fetchMock.mockResolvedValueOnce(search([]))
    expect(await fetchKugouLyric(dir, query, fetchMock as typeof fetch, () => clock)).toEqual([])
  })

  it('候选都下载失败时视为上游不可用', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(search([candidate('1')]))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
    await expect(fetchKugouLyric(dir, query, fetchMock as typeof fetch)).rejects.toThrow()
  })
})
