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
    flags.reduceTransparency = true
    expect(renderToStaticMarkup(<AmbientBackground />)).toContain('auroraFallback')
    await vi.dynamicImportSettled()
    expect(fluid.loads).toBe(0)

    flags.reduceTransparency = false
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
