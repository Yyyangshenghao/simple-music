import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AmbientBackground } from './AmbientBackground'

const fluid = vi.hoisted(() => ({ loads: 0 }))
const flags = vi.hoisted(() => ({ bgFluidMotion: false, bgPointerMotion: true, reduceTransparency: false, performanceMode: 'balanced' }))
const motionPreference = vi.hoisted(() => ({ reduced: false }))

vi.mock('../../hooks/useReducedMotion', () => ({
  useReducedMotion: () => motionPreference.reduced,
}))

vi.mock('../Visualizer/LiquidEther', () => {
  fluid.loads += 1
  return { default: ({ pointerInteraction }: { pointerInteraction: boolean }) => <div data-testid="liquid-ether" data-pointer={String(pointerInteraction)} /> }
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

describe('氛围背景按需加载', () => {
  it('隐藏与节能背景不加载流体，流体加载期间仍显示霞光，隐藏后移除场景', async () => {
    expect(renderToStaticMarkup(<AmbientBackground />)).toContain('auroraFallback')
    flags.bgFluidMotion = true
    expect(renderToStaticMarkup(<AmbientBackground hidden />)).toBe('')
    flags.performanceMode = 'eco'
    expect(renderToStaticMarkup(<AmbientBackground />)).toContain('auroraFallback')
    flags.performanceMode = 'balanced'
    motionPreference.reduced = true
    expect(renderToStaticMarkup(<AmbientBackground />)).toContain('auroraFallback')
    await vi.dynamicImportSettled()
    expect(fluid.loads).toBe(0)
    expect(flags.bgFluidMotion).toBe(true)

    motionPreference.reduced = false
    expect(renderToStaticMarkup(<AmbientBackground />)).toContain('auroraFallback')
    await vi.dynamicImportSettled()
    expect(fluid.loads).toBe(1)
    expect(renderToStaticMarkup(<AmbientBackground />)).toContain('data-testid="liquid-ether"')
    motionPreference.reduced = true
    expect(renderToStaticMarkup(<AmbientBackground />)).not.toContain('data-testid="liquid-ether"')
    expect(renderToStaticMarkup(<AmbientBackground hidden />)).toBe('')
  })

  it('减少透明度不再暂停流体背景', () => {
    flags.bgFluidMotion = true
    flags.reduceTransparency = true
    flags.performanceMode = 'balanced'
    motionPreference.reduced = false
    expect(renderToStaticMarkup(<AmbientBackground />)).toContain('data-testid="liquid-ether"')
    flags.reduceTransparency = false
  })

  it('鼠标跟随可单独关闭，背景流动仍保持挂载', async () => {
    flags.bgFluidMotion = true
    flags.reduceTransparency = false
    flags.performanceMode = 'balanced'
    motionPreference.reduced = false
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
