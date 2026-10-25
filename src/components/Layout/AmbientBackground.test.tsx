import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AmbientBackground } from './AmbientBackground'

const fluid = vi.hoisted(() => ({ loads: 0 }))
const flags = vi.hoisted(() => ({ bgFluidMotion: false, bgPointerMotion: true, reduceTransparency: false, performanceMode: 'balanced' }))

vi.mock('../Visualizer/LiquidEther', () => {
  fluid.loads += 1
  return { default: ({ pointerInteraction, pauseOnBlur }: { pointerInteraction: boolean; pauseOnBlur: boolean }) => <div data-testid="liquid-ether" data-pointer={String(pointerInteraction)} data-pause-on-blur={String(pauseOnBlur)} /> }
})
vi.mock('../../stores/settings', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../stores/settings')>()
  return {
    ...original,
    useSettingsStore: Object.assign(
      (selector: (state: unknown) => unknown) => selector({ ...original.useSettingsStore.getState(), performance: flags }),
      original.useSettingsStore
    )
  }
})
const backgroundState = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))
vi.mock('../../stores/background', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../stores/background')>()
  // 静态渲染读的是 store 初始快照，这里直接按测试状态返回。
  return { ...original, useBackgroundStore: () => ({ ...original.DEFAULT_BACKGROUND, ...backgroundState.current }) }
})
vi.mock('../../stores/visual', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../stores/visual')>()
  return {
    ...original,
    useVisualStore: Object.assign(
      (selector: (state: unknown) => unknown) => selector({ ...original.useVisualStore.getState(), ...flags }),
      original.useVisualStore
    )
  }
})
// 静态渲染拿不到壁纸库响应，这里固定一个遥控页 token。
vi.mock('../../lib/wallpaper-engine', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/wallpaper-engine')>()
  return {
    ...original,
    wallpaperEngineCachedWebToken: () => 'scene-token',
    ensureWallpaperEngineWebToken: async () => 'scene-token'
  }
})

describe('氛围背景按需加载', () => {
  it('隐藏与节能背景不加载流体，流体加载期间仍显示霞光，隐藏后移除场景', async () => {
    expect(renderToStaticMarkup(<AmbientBackground />)).toContain('auroraFallback')
    flags.bgFluidMotion = true
    expect(renderToStaticMarkup(<AmbientBackground hidden />)).toBe('')
    flags.performanceMode = 'eco'
    expect(renderToStaticMarkup(<AmbientBackground />)).toContain('auroraFallback')
    await vi.dynamicImportSettled()
    expect(fluid.loads).toBe(0)
    expect(flags.bgFluidMotion).toBe(true)

    flags.performanceMode = 'balanced'
    expect(renderToStaticMarkup(<AmbientBackground />)).toContain('auroraFallback')
    await vi.dynamicImportSettled()
    expect(fluid.loads).toBe(1)
    expect(renderToStaticMarkup(<AmbientBackground />)).toContain('data-testid="liquid-ether"')
    flags.bgFluidMotion = false
    expect(renderToStaticMarkup(<AmbientBackground />)).not.toContain('data-testid="liquid-ether"')
    flags.bgFluidMotion = true
    expect(renderToStaticMarkup(<AmbientBackground hidden />)).toBe('')
  })

  it('减少透明度不再暂停流体背景', () => {
    flags.bgFluidMotion = true
    flags.reduceTransparency = true
    flags.performanceMode = 'balanced'
    expect(renderToStaticMarkup(<AmbientBackground />)).toContain('data-testid="liquid-ether"')
    flags.reduceTransparency = false
  })

  it('失焦暂停开关原样传给流体背景', async () => {
    flags.bgFluidMotion = true
    flags.performanceMode = 'balanced'
    backgroundState.current = { pauseOnBlur: false }
    renderToStaticMarkup(<AmbientBackground />)
    await vi.dynamicImportSettled()
    expect(renderToStaticMarkup(<AmbientBackground />)).toContain('data-pause-on-blur="false"')
    backgroundState.current = null
    expect(renderToStaticMarkup(<AmbientBackground />)).toContain('data-pause-on-blur="true"')
  })

  it('鼠标跟随可单独关闭，背景流动仍保持挂载', async () => {
    flags.bgFluidMotion = true
    flags.reduceTransparency = false
    flags.performanceMode = 'balanced'
    flags.bgPointerMotion = false
    renderToStaticMarkup(<AmbientBackground />)
    await vi.dynamicImportSettled()
    expect(renderToStaticMarkup(<AmbientBackground />)).toContain('data-pointer="false"')
    flags.bgPointerMotion = true
    expect(renderToStaticMarkup(<AmbientBackground />)).toContain('data-pointer="true"')
  })
})

describe('自定义应用背景', () => {
  it('图片、视频与纯色模式各自渲染且不加载流体', async () => {
    const useBackgroundStore = { setState: (patch: Record<string, unknown>) => { backgroundState.current = { ...backgroundState.current, ...patch } } }
    const image = { id: `${'a'.repeat(32)}.png`, kind: 'image' as const, name: 'a.png' }
    const video = { id: `${'b'.repeat(32)}.mp4`, kind: 'video' as const, name: 'b.mp4' }
    flags.bgFluidMotion = true
    useBackgroundStore.setState({ kind: 'image', image, mediaBlur: 10 })
    let html = renderToStaticMarkup(<AmbientBackground />)
    expect(html).toContain('/api/background/file?id=' + image.id)
    expect(html).toContain('blur(10px)')
    expect(html).not.toContain('liquid-ether')
    useBackgroundStore.setState({ kind: 'video', video })
    html = renderToStaticMarkup(<AmbientBackground />)
    expect(html).toContain('<video')
    expect(html).toContain('muted')
    useBackgroundStore.setState({ kind: 'solid', solid: 'custom', solidColor: '#123456' })
    expect(renderToStaticMarkup(<AmbientBackground />)).toContain('background:#123456')
    useBackgroundStore.setState({ kind: 'fluid', fluidPalette: 'custom', fluidColors: ['#111111', '#222222', '#333333'] })
    flags.bgFluidMotion = false
    expect(renderToStaticMarkup(<AmbientBackground />)).toContain('--ambient-1:#111111')
    backgroundState.current = null
  })
})

describe('Wallpaper Engine 背景', () => {
  it('场景型渲染隔离遥控页并垫一张封面，应用型只显示封面', () => {
    const useBackgroundStore = { setState: (patch: Record<string, unknown>) => { backgroundState.current = { ...backgroundState.current, ...patch } } }
    const scene = { id: '3503864903', title: '场景', type: 'scene' as const, hasPreview: true }
    useBackgroundStore.setState({ kind: 'wallpaper', wallpaper: scene })

    const html = renderToStaticMarkup(<AmbientBackground />)
    expect(html).toContain('/we-scene/scene-token/host?id=3503864903')
    expect(html).toContain('sandbox="allow-scripts allow-same-origin"')
    // 加载期间与渲染失败时都停在封面上。
    expect(html).toContain('/api/wallpaper-engine/preview?id=3503864903')

    useBackgroundStore.setState({ wallpaper: { ...scene, id: '42', type: 'application' } })
    const application = renderToStaticMarkup(<AmbientBackground />)
    expect(application).not.toContain('/we-scene/')
    expect(application).toContain('/api/wallpaper-engine/preview?id=42')

    // 画质与脚本在挂载时传入遥控页；帧率等其余选项在加载后经 postMessage 生效。
    useBackgroundStore.setState({
      wallpaper: scene,
      wallpaperScene: { fps: 24, quality: 'smooth', scripts: false, audio: false, pointer: false }
    })
    const tuned = renderToStaticMarkup(<AmbientBackground />)
    expect(tuned).toContain('dpr=0.75')
    expect(tuned).toContain('scripts=0')
    backgroundState.current = null
  })
})
