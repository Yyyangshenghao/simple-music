import { describe, expect, it, vi } from 'vitest'
import { WALLPAPER_SCENE_QUALITY_DPR, wallpaperEngineSceneUrl } from './wallpaper-engine'

describe('场景壁纸遥控页地址', () => {
  it('画质与脚本在挂载时下传，帧率留到就绪后热调', () => {
    const url = wallpaperEngineSceneUrl('123', 'tok', { quality: 'smooth', scripts: false })
    expect(url).toContain('/we-scene/tok/host?id=123')
    expect(url).toContain('dpr=0.75')
    expect(url).toContain('quality=smooth')
    expect(url).toContain('scripts=0')
    // 放进地址会让改帧率时整页重载。
    expect(url).not.toContain('fps=')
    expect(WALLPAPER_SCENE_QUALITY_DPR.detailed).toBe(1.5)
  })

  it('脚本开启时不写 scripts 参数，均衡档位为 1x', () => {
    const url = wallpaperEngineSceneUrl('123', 'tok', { quality: 'balanced', scripts: true })
    expect(url).toContain('dpr=1')
    expect(url).toContain('quality=balanced')
    expect(url).not.toContain('scripts=')
  })
})

describe('iframe token 订阅', () => {
  it('壁纸库读到 token 后通知已挂载的背景，供启动补取失败后恢复', async () => {
    vi.resetModules()
    vi.doMock('./api', () => ({
      api: { get: vi.fn().mockResolvedValue({ ok: true, webToken: 'tok-live' }) },
      tokenPathBase: (prefix: string, token: string) => `${prefix}/${token}`,
    }))
    const mod = await import('./wallpaper-engine')
    const seen: string[] = []
    const unsubscribe = mod.subscribeWallpaperEngineWebToken((token) => seen.push(token))
    await expect(mod.ensureWallpaperEngineWebToken()).resolves.toBe('tok-live')
    expect(seen).toEqual(['tok-live'])
    unsubscribe()
  })
})
