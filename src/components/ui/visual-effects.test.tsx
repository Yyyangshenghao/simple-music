import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TiltCard } from './TiltCard'
import { PlayerGlass } from '../Player/PlayerGlass'
import { BorderGlow } from '../BorderGlow/BorderGlow'

const state = vi.hoisted(() => ({
  reduced: false,
  performance: { cardTiltEffect: true, cardSpotlightEffect: true, audioGlowEffect: true },
  performanceMode: 'balanced',
  energyEnabled: vi.fn(),
}))
// reduced 模拟其它动效开关（控件动效等）全部关闭，用来确认它们不再压制装饰效果。
vi.mock('../../hooks/useMotion', () => ({
  useMotion: () => !state.reduced,
}))
vi.mock('../../stores/settings', () => ({
  useSettingsStore: (selector: (value: typeof state) => unknown) => selector(state),
}))
vi.mock('../../stores/visual', () => ({
  useVisualStore: (selector: (value: typeof state) => unknown) => selector(state),
}))
vi.mock('../../hooks/useAudioEnergy', () => ({
  useAudioEnergy: (_ref: unknown, enabled: boolean) => state.energyEnabled(enabled),
}))

afterEach(() => {
  state.reduced = false
  state.performance.cardTiltEffect = state.performance.cardSpotlightEffect = state.performance.audioGlowEffect = true
  state.performanceMode = 'balanced'
  state.energyEnabled.mockClear()
})

describe('装饰动效的实际开关', () => {
  it('闲置卡片不常驻透视变换，避免为每张封面保留 3D 合成层', () => {
    const html = renderToStaticMarkup(<TiltCard>歌单</TiltCard>)
    expect(html).not.toContain('perspective(')
  })

  it('卡片光斑与倾斜独立，也不受其它动效开关影响', () => {
    const render = () => renderToStaticMarkup(<TiltCard>歌单</TiltCard>)
    expect(render()).toContain('spotlight')
    state.performance.cardTiltEffect = false
    expect(render()).toContain('spotlight')
    state.performance.cardSpotlightEffect = false
    expect(render()).not.toContain('spotlight')
    state.performance.cardTiltEffect = true
    expect(render()).not.toContain('spotlight')
    state.performance.cardSpotlightEffect = true
    expect(render()).toContain('spotlight')
    state.reduced = true
    expect(render()).toContain('spotlight')
    expect(state.performance.cardTiltEffect).toBe(true)
  })

  it('边缘跟手辉光只随光斑开关关闭', () => {
    const render = () => renderToStaticMarkup(<BorderGlow>歌单</BorderGlow>)
    expect(render()).not.toContain('data-glow-off')
    state.performance.cardSpotlightEffect = false
    expect(render()).toContain('data-glow-off')
    state.performance.cardSpotlightEffect = true
    state.reduced = true
    expect(render()).not.toContain('data-glow-off')
  })

  it('节能与隐藏播放栏停止辉光，其它动效开关不影响，不改动用户偏好', () => {
    const render = (hidden = false) => renderToStaticMarkup(<PlayerGlass hidden={hidden}>播放控制</PlayerGlass>)
    expect(render()).toContain('aria-hidden="true"')
    expect(state.energyEnabled).toHaveBeenLastCalledWith(true)
    state.reduced = true
    expect(render()).toContain('aria-hidden="true"')
    state.reduced = false
    state.performanceMode = 'eco'
    expect(render()).not.toContain('aria-hidden="true"')
    expect(state.energyEnabled).toHaveBeenLastCalledWith(false)
    state.performanceMode = 'balanced'
    expect(render(true)).not.toContain('aria-hidden="true"')
    expect(state.energyEnabled).toHaveBeenLastCalledWith(false)
    expect(state.performance.audioGlowEffect).toBe(true)
    expect(render()).toContain('aria-hidden="true"')
    expect(state.energyEnabled).toHaveBeenLastCalledWith(true)
  })
})
