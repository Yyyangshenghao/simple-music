import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { amllLyricUrl, fetchAmllLyric, isValidAmllId } from './amll-lyrics'

let dir = ''
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'amll-test-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

const response = (status: number, body = '') => new Response(body, { status })

describe('AMLL 逐字歌词兜底', () => {
  it('ID 只接受平台字符集，地址固定在 AMLL 仓库目录', () => {
    expect(isValidAmllId('ncm', '123456')).toBe(true)
    expect(isValidAmllId('ncm', '12a')).toBe(false)
    expect(isValidAmllId('ncm', '../1')).toBe(false)
    expect(isValidAmllId('qq', '0000Dso20pNy35')).toBe(true)
    expect(isValidAmllId('qq', 'abc/../x')).toBe(false)
    expect(amllLyricUrl('ncm', '42')).toBe('https://raw.githubusercontent.com/amll-dev/amll-ttml-db/main/ncm-lyrics/42.yrc')
    expect(amllLyricUrl('qq', 'abcdef12')).toBe('https://raw.githubusercontent.com/amll-dev/amll-ttml-db/main/qq-lyrics/abcdef12.qrc')
  })

  it('命中后写入缓存，再次请求不再访问网络', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, '[0,1000](0,500,0)测(500,500,0)试'))
    expect(await fetchAmllLyric(dir, 'ncm', '1', fetchImpl)).toContain('测')
    expect(await fetchAmllLyric(dir, 'ncm', '1', fetchImpl)).toContain('测')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('库里没有（404）时负缓存，过期后重新查询', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(404))
    let now = 1_000_000
    expect(await fetchAmllLyric(dir, 'ncm', '2', fetchImpl, () => now)).toBeNull()
    expect(await fetchAmllLyric(dir, 'ncm', '2', fetchImpl, () => now + 3600_000)).toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    now += 7 * 3600_000
    await fetchAmllLyric(dir, 'ncm', '2', fetchImpl, () => now)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('网络失败抛出且不写缓存，下次重试', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(503)).mockResolvedValueOnce(response(200, '[0,1](0,1,0)a'))
    await expect(fetchAmllLyric(dir, 'qq', 'abcdef12', fetchImpl)).rejects.toThrow('UPSTREAM_503')
    expect(await readdir(dir)).toEqual([])
    expect(await fetchAmllLyric(dir, 'qq', 'abcdef12', fetchImpl)).toBe('[0,1](0,1,0)a')
  })

  it('同一首歌的并发请求只访问一次网络', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(404))
    await Promise.all([fetchAmllLyric(dir, 'ncm', '3', fetchImpl), fetchAmllLyric(dir, 'ncm', '3', fetchImpl)])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('非法 ID 直接拒绝，不访问网络', async () => {
    const fetchImpl = vi.fn()
    await expect(fetchAmllLyric(dir, 'ncm', '../etc', fetchImpl)).rejects.toThrow('INVALID_ID')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
