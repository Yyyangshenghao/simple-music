import { describe, expect, it } from 'vitest'
import { neteaseService, qqService, serviceFor } from '../lib/service-registry'
import { listProviders, providerFor } from './registry'

describe('music provider registry', () => {
  it('注册网易云和 QQ，id 唯一且声明基础能力', () => {
    const providers = listProviders()
    expect(providers.map((provider) => provider.descriptor.id)).toEqual(['netease', 'qq'])
    expect(new Set(providers.map((provider) => provider.descriptor.id)).size).toBe(providers.length)
    for (const provider of providers) {
      expect(provider.catalog.searchTracks).toBeTypeOf('function')
      expect(provider.playback.resolve).toBeTypeOf('function')
      expect(provider.recommendations?.listSurfaces().length).toBeGreaterThan(0)
    }
  })

  it('旧 service registry 复用 provider 的同一实例', () => {
    expect(providerFor('netease').legacyService).toBe(neteaseService)
    expect(providerFor('qq').legacyService).toBe(qqService)
    expect(serviceFor('netease')).toBe(neteaseService)
    expect(serviceFor('qq')).toBe(qqService)
  })

  it('原生推荐栏目保留平台名称和语义', () => {
    const netease = providerFor('netease').recommendations!.listSurfaces()
    const qq = providerFor('qq').recommendations!.listSurfaces()
    expect(netease.find((item) => item.kind === 'daily-tracks')?.title).toBe('每日推荐')
    expect(qq.find((item) => item.kind === 'radio')?.title).toBe('猜你喜欢')
    expect(netease.every((item) => item.source === 'netease')).toBe(true)
    expect(qq.every((item) => item.source === 'qq')).toBe(true)
  })

  it('能力按实现声明，QQ 不伪装网易专属写入和榜单能力', () => {
    expect(providerFor('netease').playlistWriter).toBeDefined()
    expect(providerFor('netease').toplists).toBeDefined()
    expect(providerFor('qq').playlistWriter).toBeUndefined()
    expect(providerFor('qq').toplists).toBeUndefined()
  })
})
