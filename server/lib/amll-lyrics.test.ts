import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AMLL_HOSTS, amllLyricUrl, amllRouteSnapshot, fetchAmllLyric, isValidAmllId, probeAmllHosts, resetAmllRouteState } from './amll-lyrics'

let dir = ''
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'amll-test-'))
  resetAmllRouteState()
})
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

const response = (status: number, body = '') => new Response(body, { status })
const hostOf = (url: string) => AMLL_HOSTS.find((host) => url.startsWith(host.base))!.id
/** 按线路给出响应；值为 'down' 时模拟连不上。 */
const byHost = (table: Record<string, number | 'down'>, body = '[0,1](0,1,0)a') => vi.fn(async (input: string | URL | Request) => {
  const status = table[hostOf(String(input))]
  if (status === 'down' || status === undefined) throw new TypeError('fetch failed')
  return response(status, status === 200 ? body : '')
})

describe('AMLL 逐字歌词兜底', () => {
  it('ID 只接受平台字符集，地址固定在各线路的仓库目录', () => {
    expect(isValidAmllId('ncm', '123456')).toBe(true)
    expect(isValidAmllId('ncm', '12a')).toBe(false)
    expect(isValidAmllId('ncm', '../1')).toBe(false)
    expect(isValidAmllId('qq', '0000Dso20pNy35')).toBe(true)
    expect(isValidAmllId('qq', '42')).toBe(true)
    expect(isValidAmllId('qq', 'abc/../x')).toBe(false)
    // 默认先走国内镜像，GitHub 官方兜底
    expect(AMLL_HOSTS.map(host => host.id)).toEqual(['gbclstudio', 'bikonoo', 'github'])
    expect(amllLyricUrl('qq', 'abcdef12')).toBe('https://amll-ttml-db.gbclstudio.cn/qq-lyrics/abcdef12.qrc')
    expect(amllLyricUrl('ncm', '42', AMLL_HOSTS[1])).toBe('https://amlldb.bikonoo.com/ncm-lyrics/42.yrc')
    expect(amllLyricUrl('ncm', '42', AMLL_HOSTS[2])).toBe('https://raw.githubusercontent.com/amll-dev/amll-ttml-db/main/ncm-lyrics/42.yrc')
  })

  it('命中后写入缓存，再次请求不再访问网络', async () => {
    const fetchImpl = byHost({ gbclstudio: 200 })
    expect(await fetchAmllLyric(dir, 'ncm', '1', fetchImpl)).toBe('[0,1](0,1,0)a')
    expect(await fetchAmllLyric(dir, 'ncm', '1', fetchImpl)).toBe('[0,1](0,1,0)a')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('库里没有（404）时负缓存，过期后重新查询', async () => {
    const fetchImpl = byHost({ gbclstudio: 404 })
    let now = 1_000_000
    expect(await fetchAmllLyric(dir, 'ncm', '2', fetchImpl, () => now)).toBeNull()
    expect(await fetchAmllLyric(dir, 'ncm', '2', fetchImpl, () => now + 3600_000)).toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    now += 7 * 3600_000
    await fetchAmllLyric(dir, 'ncm', '2', fetchImpl, () => now)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('首选镜像连不上时切到下一条，并记住可用线路、熔断首选镜像', async () => {
    const fetchImpl = byHost({ gbclstudio: 'down', bikonoo: 200 })
    expect(await fetchAmllLyric(dir, 'ncm', '3', fetchImpl)).toBe('[0,1](0,1,0)a')
    expect(amllRouteSnapshot()).toEqual({ preferred: 'bikonoo', open: ['gbclstudio'] })
    // 下一首直接走记住的线路，熔断中的首选镜像不再尝试
    fetchImpl.mockClear()
    await fetchAmllLyric(dir, 'ncm', '4', fetchImpl)
    expect(fetchImpl.mock.calls.map(([url]) => hostOf(String(url)))).toEqual(['bikonoo'])
  })

  it('熔断到期后重新尝试原线路', async () => {
    let now = 1_000_000
    const fetchImpl = byHost({ gbclstudio: 'down', bikonoo: 'down', github: 200 })
    await fetchAmllLyric(dir, 'ncm', '5', fetchImpl, () => now)
    expect(amllRouteSnapshot(now).preferred).toBe('github')
    expect(amllRouteSnapshot(now).open).toEqual(['gbclstudio', 'bikonoo'])
    // 熔断到期：github 仍最先，但它失败时可以再回到 GitHub
    now += 11 * 60_000
    expect(amllRouteSnapshot(now).open).toEqual([])
    const recovered = byHost({ gbclstudio: 200, github: 'down' })
    await fetchAmllLyric(dir, 'ncm', '6', recovered, () => now)
    expect(recovered.mock.calls.map(([url]) => hostOf(String(url)))).toEqual(['github', 'gbclstudio'])
    expect(amllRouteSnapshot(now).preferred).toBe('gbclstudio')
  })

  it('所有线路都连不上：抛出、不写缓存；熔断期内不再发请求', async () => {
    const fetchImpl = byHost({ gbclstudio: 'down', bikonoo: 503, github: 'down' })
    await expect(fetchAmllLyric(dir, 'qq', 'abcdef12', fetchImpl)).rejects.toThrow('ALL_HOSTS_UNAVAILABLE')
    expect(await readdir(dir)).toEqual([])
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    fetchImpl.mockClear()
    await expect(fetchAmllLyric(dir, 'qq', 'abcdef13', fetchImpl)).rejects.toThrow('ALL_HOSTS_UNAVAILABLE')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('同一首歌的并发请求只访问一次网络', async () => {
    const fetchImpl = byHost({ gbclstudio: 404 })
    await Promise.all([fetchAmllLyric(dir, 'ncm', '7', fetchImpl), fetchAmllLyric(dir, 'ncm', '7', fetchImpl)])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('非法 ID 直接拒绝，不访问网络', async () => {
    const fetchImpl = vi.fn()
    await expect(fetchAmllLyric(dir, 'ncm', '../etc', fetchImpl)).rejects.toThrow('INVALID_ID')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('用户指定的线路最先尝试，连不上时仍回落其他线路', async () => {
    const fetchImpl = byHost({ gbclstudio: 200, github: 200 })
    await fetchAmllLyric(dir, 'ncm', '8', fetchImpl, Date.now, 'github')
    expect(fetchImpl.mock.calls.map(([url]) => hostOf(String(url)))).toEqual(['github'])
    const fallback = byHost({ gbclstudio: 200, github: 'down' })
    await fetchAmllLyric(dir, 'ncm', '9', fallback, Date.now, 'github')
    expect(fallback.mock.calls.map(([url]) => hostOf(String(url)))).toEqual(['github', 'gbclstudio'])
  })

  it('测速逐条返回往返时间，连不上为 null，只探测库里没有的 ID', async () => {
    let t = 0
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const id = hostOf(String(input))
      expect(String(input)).toMatch(/\/ncm-lyrics\/1\.yrc$/)
      if (id === 'bikonoo') throw new TypeError('fetch failed')
      t += id === 'github' ? 300 : 80
      return response(404)
    })
    const result = await probeAmllHosts(fetchImpl, () => t)
    expect(result.map((r) => r.id)).toEqual(['gbclstudio', 'bikonoo', 'github'])
    expect(result.find((r) => r.id === 'bikonoo')!.ms).toBeNull()
    expect(result.filter((r) => r.ms !== null)).toHaveLength(2)
  })
})


it('手动测试绕过缓存与临时故障线路，恢复后普通请求可复用新结果', async () => {
  const network = byHost({ gbclstudio: 404 })
  await fetchAmllLyric(dir, 'ncm', '42', network)
  network.mockClear()
  await fetchAmllLyric(dir, 'ncm', '42', network)
  expect(network).not.toHaveBeenCalled()
  await fetchAmllLyric(dir, 'ncm', '42', network, Date.now, undefined, true)
  expect(network).toHaveBeenCalledOnce()
  resetAmllRouteState()
  const offline = byHost({ gbclstudio: 'down', bikonoo: 'down', github: 'down' })
  await expect(fetchAmllLyric(dir, 'ncm', '43', offline)).rejects.toThrow()
  const recovered = byHost({ gbclstudio: 200, bikonoo: 200, github: 200 })
  expect(await fetchAmllLyric(dir, 'ncm', '43', recovered, Date.now, undefined, true)).toBe('[0,1](0,1,0)a')
  expect(recovered).toHaveBeenCalledOnce()
})
