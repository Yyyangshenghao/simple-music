import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TiltCard } from './TiltCard'
import { PlayerGlass } from '../Player/PlayerGlass'

const state = vi.hoisted(() => ({
  reduced: false,
  performance: { cardTiltEffect: true, cardSpotlightEffect: true, audioGlowEffect: true },
  performanceMode: 'balanced',
  energyEnabled: vi.fn(),
}))
vi.mock('../../hooks/useReducedMotion', () => ({
  useReducedMotion: () => state.reduced,
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
  it('卡片光斑与倾斜独立，系统减少动态同时暂停装饰', () => {
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
    expect(render()).not.toContain('spotlight')
    expect(state.performance.cardTiltEffect).toBe(true)
  })

  it('减少动态、节能与隐藏播放栏均停止辉光，不改动用户偏好', () => {
    const render = (hidden = false) => renderToStaticMarkup(<PlayerGlass hidden={hidden}>播放控制</PlayerGlass>)
    expect(render()).toContain('aria-hidden="true"')
    expect(state.energyEnabled).toHaveBeenLastCalledWith(true)
    for (const suppress of [() => { state.reduced = true }, () => { state.performanceMode = 'eco' }]) {
      suppress()
      expect(render()).not.toContain('aria-hidden="true"')
      expect(state.energyEnabled).toHaveBeenLastCalledWith(false)
      state.reduced = false
      state.performanceMode = 'balanced'
    }
    expect(render(true)).not.toContain('aria-hidden="true"')
    expect(state.energyEnabled).toHaveBeenLastCalledWith(false)
    expect(state.performance.audioGlowEffect).toBe(true)
    expect(render()).toContain('aria-hidden="true"')
    expect(state.energyEnabled).toHaveBeenLastCalledWith(true)
  })
})
