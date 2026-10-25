import { describe, expect, it } from 'vitest'
import { DEFAULT_BACKGROUND, DEFAULT_WALLPAPER_SCENE, normalizeBackground } from './background'

describe('应用背景设置归一化', () => {
  it('缺档与坏值回落默认，数值夹到范围内', () => {
    expect(normalizeBackground(null)).toEqual(DEFAULT_BACKGROUND)
    expect(normalizeBackground({ version: 2, kind: 'nope', fluidColors: ['#fff'], mediaBlur: 999, mediaDim: -1, solid: 'x', solidColor: 'red' })).toEqual(
      { ...DEFAULT_BACKGROUND, mediaBlur: 40, mediaDim: 0 }
    )
  })

  it('旧版存档的压暗是总遮罩，迁移时回到默认额外强度', () => {
    expect(normalizeBackground({ mediaDim: 0.6 }).mediaDim).toBe(DEFAULT_BACKGROUND.mediaDim)
    expect(normalizeBackground({ version: 2, mediaDim: 0.6 }).mediaDim).toBe(0.6)
  })

  it('调整额外强度后能保存下来，不被迁移逻辑重置', async () => {
    const { useBackgroundStore } = await import('./background')
    useBackgroundStore.getState().update({ mediaDim: 0.45 })
    expect(useBackgroundStore.getState().mediaDim).toBe(0.45)
    useBackgroundStore.getState().update({ mediaBlur: 3 })
    expect(useBackgroundStore.getState().mediaDim).toBe(0.45)
  })

  it('图片/视频槽位为空时回到流体，槽位类型不符则丢弃', () => {
    expect(normalizeBackground({ kind: 'video', video: null }).kind).toBe('fluid')
    expect(normalizeBackground({ kind: 'image', image: { id: 'a.png', kind: 'video', name: 'a' } })).toMatchObject({ kind: 'fluid', image: null })
    expect(normalizeBackground({ kind: 'image', image: { id: 'a.png', kind: 'image', name: 'a' } })).toMatchObject({ kind: 'image', image: { id: 'a.png' } })
  })

  it('壁纸槽位要求数字 workshop id；空槽位同样回到流体', () => {
    expect(normalizeBackground({ kind: 'wallpaper', wallpaper: null }).kind).toBe('fluid')
    expect(normalizeBackground({ kind: 'wallpaper', wallpaper: { id: '../x', title: 'x', type: 'video' } }))
      .toMatchObject({ kind: 'fluid', wallpaper: null })
    const wallpaper = { id: '123456', title: '雨夜', type: 'video', hasPreview: true }
    expect(normalizeBackground({ kind: 'wallpaper', wallpaper })).toMatchObject({ kind: 'wallpaper', wallpaper })
  })

  it('失焦暂停默认开启，只接受布尔值', () => {
    expect(DEFAULT_BACKGROUND.pauseOnBlur).toBe(true)
    expect(normalizeBackground({}).pauseOnBlur).toBe(true)
    expect(normalizeBackground({ pauseOnBlur: false }).pauseOnBlur).toBe(false)
    expect(normalizeBackground({ pauseOnBlur: 'no' }).pauseOnBlur).toBe(true)
  })

  it('场景壁纸渲染选项只接受有效档位，缺省与坏值回到默认', () => {
    expect(normalizeBackground({ wallpaperScene: { fps: 15, quality: 'nope', scripts: 'yes', audio: 0, pointer: null } }).wallpaperScene)
      .toEqual(DEFAULT_WALLPAPER_SCENE)
    expect(normalizeBackground({
      wallpaperScene: { fps: 60, quality: 'detailed', scripts: false, audio: false, pointer: false }
    }).wallpaperScene).toEqual({ fps: 60, quality: 'detailed', scripts: false, audio: false, pointer: false })
  })
})

describe('壁纸背景的选择', () => {
  it('选中壁纸切到壁纸背景，清空后回到流体', async () => {
    const { useBackgroundStore } = await import('./background')
    useBackgroundStore.getState().setWallpaper({ id: '123456', title: '雨夜', type: 'video', hasPreview: true })
    expect(useBackgroundStore.getState()).toMatchObject({ kind: 'wallpaper', wallpaper: { id: '123456' } })
    useBackgroundStore.getState().setWallpaper(null)
    expect(useBackgroundStore.getState()).toMatchObject({ kind: 'fluid', wallpaper: null })
  })

  it('场景渲染选项逐项保存，不影响其他设置', async () => {
    const { useBackgroundStore } = await import('./background')
    const { update } = useBackgroundStore.getState()
    update({ wallpaperScene: { ...DEFAULT_WALLPAPER_SCENE, fps: 60, quality: 'detailed' } })
    update({ wallpaperScene: { ...useBackgroundStore.getState().wallpaperScene, audio: false } })
    expect(useBackgroundStore.getState().wallpaperScene).toMatchObject({
      fps: 60, quality: 'detailed', scripts: true, audio: false, pointer: true
    })
    update({ wallpaperScene: DEFAULT_WALLPAPER_SCENE })
  })
})

describe('纯色背景按主题取预设', () => {
  it('预设色调与主题相反时回到主题底色，自定义颜色原样使用', async () => {
    const { solidBackgroundCss, solidBackgroundsFor } = await import('./background')
    expect(solidBackgroundsFor(true).every(item => item.tone !== 'dark')).toBe(true)
    expect(solidBackgroundCss({ solid: 'dusk', solidColor: '#000000' }, false)).toContain('#2c1a3c')
    expect(solidBackgroundCss({ solid: 'dusk', solidColor: '#000000' }, true)).toBe('var(--sm-bg-base)')
    expect(solidBackgroundCss({ solid: 'custom', solidColor: '#123456' }, true)).toBe('#123456')
  })
})
