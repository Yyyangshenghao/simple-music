import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ style: 'pop', enabled: true }))
vi.mock('./PopLyrics', () => ({ PopLyrics: ({ preview }: { preview?: boolean }) => <div data-testid={preview ? 'pop-preview' : 'pop-stage'} /> }))
vi.mock('../../stores/lyric-styles', () => ({
  useLyricStylesStore: (selector: (value: object) => unknown) => selector({ style: h.style, tunings: {}, setStyle: vi.fn(), setTuning: vi.fn(), resetTuning: vi.fn() }),
  useLyricStyleTuning: () => ({ intensity: 1, camera: true }),
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

const render = () => renderToStaticMarkup(<LyricStylePicker onClose={vi.fn()} />)

describe('动态歌词样式选择器', () => {
  it('列出内置样式，跃字卡片带实时预览画布，3D 卡片用示意图；显示通用与样式快捷参数', () => {
    const html = render()
    expect(html).toContain('跃字')
    expect(html).toContain('粒光')
    // 预览量到卡片宽度后才挂载内容；每个实时预览样式一块画布，粒光只有示意图。
    expect(html.match(/class="[^"]*previewCanvas/g)).toHaveLength(LYRIC_STYLES.filter(style => style.preview === 'live').length)
    expect(html).toContain('云阶')
    expect(html).toContain('拼版')
    // 撤下的样式不再出现
    for (const removed of ['流光', '倾诉', '绘光']) expect(html).not.toContain(`>${removed}<`)
    expect(html.match(/role="radio"/g)).toHaveLength(7)
    expect(html.match(/role="radio" aria-checked="true"/g)).toHaveLength(1)
    expect(html).toContain('字号')
    expect(html).toContain('显示翻译')
    expect(html).toContain('动效幅度')
    expect(html).not.toContain('镜头推移')
    expect(html).toContain('轻柔')
    expect(html).toContain('标准')
    expect(html).toContain('强烈')
    expect(html).not.toContain('社区模组')
    expect(html).not.toContain('实验')
  })

  it('粒光和镜台始终可以选择，不需要额外启用', () => {
    h.enabled = false // 模拟旧客户端内存中仍残留关闭值。
    h.style = 'stage3d'
    const html = render()
    expect(html).not.toContain('disabled=""')
    expect(html).not.toContain('立体歌词已关闭')
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*>(?:(?!<button).)*粒光/s)
    expect(html).toContain('更多「粒光」设置')
    expect(html).toContain('镜台')
    h.style = 'pop'
    h.enabled = true
  })

  it('内存里是已撤下的样式 ID 时按跃字显示，不访问空的注册项', () => {
    h.style = 'lumiere'
    const html = render()
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*>(?:(?!<button).)*跃字/s)
    expect(html).not.toContain('绘光')
    h.style = 'pop'
  })

  it('粒光的完整设置放在「更多」里，不铺在首屏', () => {
    h.style = 'stage3d'
    const html = render()
    expect(html).toContain('更多「粒光」设置')
    expect(html).not.toContain('粒子数量')
    h.style = 'pop'
  })


})
