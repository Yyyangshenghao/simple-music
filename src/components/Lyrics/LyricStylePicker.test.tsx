import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ style: 'pop', enabled: true, mod: null as null | { id: string; name: string; valid: boolean } }))
vi.mock('./PopLyrics', () => ({ PopLyrics: ({ preview }: { preview?: boolean }) => <div data-testid={preview ? 'pop-preview' : 'pop-stage'} /> }))
vi.mock('../../stores/lyric-styles', () => ({
  useLyricStylesStore: (selector: (value: object) => unknown) => selector({ style: h.style, tunings: {}, setStyle: vi.fn(), setTuning: vi.fn(), resetTuning: vi.fn() }),
  useLyricStyleTuning: () => ({ intensity: 1 }),
}))
vi.mock('../../stores/lyric-mods', () => ({
  useLyricModsStore: Object.assign(
    (selector: (value: object) => unknown) => selector({ selectedId: h.mod?.id ?? null, installed: h.mod ? [h.mod] : [] }),
    { getState: () => ({ select: vi.fn() }) },
  ),
}))
vi.mock('../../stores/settings', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../stores/settings')>()
  return {
    ...original,
    // 保留 getState 等方法：样式模块会间接引入播放器 store，它在加载时读取设置。
    useSettingsStore: Object.assign((selector: (value: unknown) => unknown) => {
      const state = original.useSettingsStore.getState()
      return selector({ ...state, performance: { ...state.performance, lyrics3dEnabled: h.enabled } })
    }, original.useSettingsStore),
  }
})

import { LyricStylePicker } from './LyricStylePicker'
import { LYRIC_STYLES } from '../../lib/lyric-style-catalog'

const render = () => renderToStaticMarkup(<LyricStylePicker onClose={vi.fn()} onOpenMods={vi.fn()} />)

describe('动态歌词样式选择器', () => {
  it('列出内置样式，跃字卡片带实时预览画布，3D 卡片用示意图；显示通用与样式快捷参数', () => {
    const html = render()
    expect(html).toContain('跃字')
    expect(html).toContain('3D 舞台')
    // 预览量到卡片宽度后才挂载内容；每个实时预览样式一块画布，3D 舞台只有示意图。
    expect(html.match(/class="[^"]*previewCanvas/g)).toHaveLength(LYRIC_STYLES.filter(style => style.preview === 'live').length)
    expect(html).toContain('云阶')
    expect(html).toContain('浮名')
    // 撤下的样式不再出现
    for (const removed of ['流光', '倾诉', '绘光']) expect(html).not.toContain(`>${removed}<`)
    expect(html.match(/role="radio"/g)).toHaveLength(7)
    expect(html.match(/role="radio" aria-checked="true"/g)).toHaveLength(1)
    expect(html).toContain('字号')
    expect(html).toContain('显示翻译')
    expect(html).toContain('跃起幅度')
    // 实验入口在最后，与内置样式不同级。
    expect(html.lastIndexOf('社区模组')).toBeGreaterThan(html.lastIndexOf('跃起幅度'))
  })

  it('3D 歌词关闭时 3D 卡片不可选并说明原因', () => {
    h.enabled = false
    const html = render()
    expect(html).toContain('3D 歌词已关闭')
    // 保存的仍是 3D 时，选中态与参数跟随实际显示的跃字，不出现 3D 的更多设置。
    h.style = 'stage3d'
    const fallback = render()
    expect(fallback).toMatch(/role="radio" aria-checked="true"[^>]*>(?:(?!<button).)*跃字/s)
    expect(fallback).toContain('跃起幅度')
    expect(fallback).not.toContain('更多「3D 舞台」设置')
    h.style = 'pop'
    expect(html).toMatch(/aria-checked="false" disabled=""[^>]*title="已在设置的歌词与动效中关闭 3D 歌词"/)
    h.enabled = true
  })

  it('内存里是已撤下的样式 ID 时按跃字显示，不访问空的注册项', () => {
    h.style = 'lumiere'
    const html = render()
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*>(?:(?!<button).)*跃字/s)
    expect(html).not.toContain('绘光')
    h.style = 'pop'
  })

  it('3D 舞台的完整设置放在「更多」里，不铺在首屏', () => {
    h.style = 'stage3d'
    const html = render()
    expect(html).toContain('更多「3D 舞台」设置')
    expect(html).not.toContain('同屏歌词')
    h.style = 'pop'
  })

  it('使用实验模组时提示并可停用，内置样式都不显示为选中，也不显示样式参数', () => {
    h.mod = { id: 'cinerama', name: '巨幕', valid: true }
    const html = render()
    expect(html).toContain('正在使用实验模组「巨幕」')
    expect(html).not.toMatch(/role="radio" aria-checked="true"/)
    expect(html).not.toContain('跃起幅度')
    h.mod = null
  })
})
