import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  source: {
    sourceOrder: ['netease', 'qq', 'amll', 'kugou'],
    remembered: { 'netease:1': { origin: 'qq', name: '晴天', artist: '周杰伦' } },
    health: {} as Record<string, { failures: number; suspended: boolean }>,
    probes: {} as Record<string, { status: string; sample?: string; ms?: number }>,
    setSourceOrder: vi.fn(), clearRemembered: vi.fn(), forgetTrack: vi.fn(), testSource: vi.fn(),
  },
  settings: { lyricsAmllFallback: true, lyricsKugouFallback: true, setLyricsAmllFallback: vi.fn(), setLyricsKugouFallback: vi.fn() },
  providers: { byId: { netease: { enabled: true, auth: 'anonymous' }, qq: { enabled: true, auth: 'anonymous' } } },
  confirm: false, setConfirm: vi.fn(), search: '', sample: 'sunny', setSample: vi.fn(),
}))
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (value: unknown) => typeof value === 'boolean' ? [h.confirm, h.setConfirm] : value === 'sunny' ? [h.sample, h.setSample] : value === '' ? [h.search, vi.fn()] : [value, vi.fn()],
}))
vi.mock('framer-motion', () => ({ motion: { li: 'li' } }))
vi.mock('../../hooks/useMotion', () => ({ useMotion: () => true }))
vi.mock('../../stores/lyrics-source', async (original) => ({
  ...await original<typeof import('../../stores/lyrics-source')>(),
  useLyricsSourceStore: Object.assign((selector: (state: typeof h.source) => unknown) => selector(h.source), { getState: () => h.source }),
}))
vi.mock('../../stores/settings', () => ({ useSettingsStore: (selector: (state: typeof h.settings) => unknown) => selector(h.settings) }))
vi.mock('../../stores/providers', () => ({ useProviderStore: (selector: (state: typeof h.providers) => unknown) => selector(h.providers) }))
vi.mock('../ui/InfoButton', () => ({ InfoButton: () => null }))
import { AmllLyricsSettings } from './AmllLyricsSettings'

function elements(node: unknown, type: string): ReactElement<any>[] {
  if (!node || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap((child) => elements(child, type))
  const element = node as ReactElement<any>
  return element.type === type ? [element] : elements(element.props?.children, type)
}
function text(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(text).join('')
  if (!node || typeof node !== 'object') return ''
  return text((node as ReactElement<any>).props?.children)
}
/** ⓘ 说明（InfoButton 已被 mock 为空渲染）的文字，从元素 props.text 收集。 */
function infoText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  if (Array.isArray(node)) return node.map(infoText).join('')
  const props = (node as ReactElement<any>).props
  return `${typeof props?.text === 'string' ? props.text : ''}${infoText(props?.children)}`
}
function button(node: unknown, label: string) {
  return elements(node, 'button').find(item => item.props['aria-label'] === label || text(item) === label)!
}

beforeEach(() => {
  vi.clearAllMocks()
  h.source.testSource.mockResolvedValue(undefined)
  h.confirm = false
  h.search = ''
  h.sample = 'sunny'
  h.source.sourceOrder = ['netease', 'qq', 'amll', 'kugou']
  h.source.health = {}
  h.source.probes = {}
  h.settings.lyricsAmllFallback = true
  h.settings.lyricsKugouFallback = true
  h.providers.byId.netease = { enabled: true, auth: 'anonymous' }
  h.providers.byId.qq = { enabled: true, auth: 'anonymous' }
})

describe('歌词来源设置', () => {
  it('展示四个编号优先级，通过宿主动作交换完整顺序', () => {
    const element = AmllLyricsSettings()
    const rows = elements(elements(element, 'ol')[0], 'li')
    expect(rows.map(row => elements(row, 'strong')[0].props.children)).toEqual(['网易云音乐', 'QQ 音乐', 'AMLL 逐字歌词库', '酷狗歌词库'])
    expect(rows.map(row => elements(row, 'span')[0].props['aria-label'])).toEqual(['第 1 优先级', '第 2 优先级', '第 3 优先级', '第 4 优先级'])
    expect(button(element, '提高网易云音乐优先级').props.disabled).toBe(true)
    button(element, '提高QQ 音乐优先级').props.onClick()
    expect(h.source.setSourceOrder).toHaveBeenCalledWith(['qq', 'netease', 'amll', 'kugou'])
    expect(infoText(element)).toContain('从下一首歌曲生效')
  })

  it('游客可测试固定歌曲，不引导登录或展示补全实现开关', () => {
    h.sample = 'ocean'
    const element = AmllLyricsSettings()
    const select = elements(element, 'select')[0]
    expect(elements(select, 'option').map(option => option.props.value)).toEqual(['sunny', 'ocean'])
    const rows = elements(elements(element, 'ol')[0], 'li')
    button(rows[1], '测试').props.onClick()
    expect(h.source.testSource).toHaveBeenCalledWith('qq', 'ocean')
    expect(text(element)).not.toMatch(/尚未登录|使用.*补全/)
    expect(infoText(element)).toContain('测试不会切歌或替换正在显示的歌词')
  })

  it('暂停来源提供测试恢复，测试中的来源禁止重复点击', () => {
    h.source.health.qq = { failures: 3, suspended: true }
    h.source.probes.amll = { status: 'loading', sample: '晴天' }
    const element = AmllLyricsSettings()
    expect(text(element)).toContain('连接异常，稍后自动重试')
    button(element, '测试恢复').props.onClick()
    expect(h.source.testSource).toHaveBeenCalledWith('qq', 'sunny')
    expect(button(element, '测试中…').props.disabled).toBe(true)
  })

  it('已停用的歌词库可明确启用并测试', () => {
    h.settings.lyricsAmllFallback = false
    const element = AmllLyricsSettings()
    button(element, '启用并测试').props.onClick()
    expect(h.settings.setLyricsAmllFallback).toHaveBeenCalledWith(true)
    expect(h.source.testSource).toHaveBeenCalledWith('amll', 'sunny')
  })

  it('显示歌曲与记住的来源，可搜索并单独忘记', () => {
    const element = AmllLyricsSettings()
    const memory = elements(element, 'details')[0]
    expect(text(memory)).toContain('晴天周杰伦 · QQ 音乐')
    button(memory, '忘记晴天的歌词来源').props.onClick()
    expect(h.source.forgetTrack).toHaveBeenCalledWith('netease:1')
    expect(h.source.clearRemembered).not.toHaveBeenCalled()
    h.search = '不存在'
    expect(text(AmllLyricsSettings())).toContain('没有匹配的歌曲')
    h.search = 'QQ'
    expect(text(AmllLyricsSettings())).toContain('晴天')
  })

  it('清除全部先确认，保留不清除，确认说明当前歌词不改变', () => {
    let element = AmllLyricsSettings()
    button(element, '清除全部记忆…').props.onClick()
    expect(h.setConfirm).toHaveBeenCalledWith(true)
    expect(h.source.clearRemembered).not.toHaveBeenCalled()
    h.confirm = true
    element = AmllLyricsSettings()
    expect(text(element)).toContain('当前歌词继续显示')
    button(element, '保留').props.onClick()
    expect(h.setConfirm).toHaveBeenCalledWith(false)
    expect(h.source.clearRemembered).not.toHaveBeenCalled()
    button(element, '清除记忆').props.onClick()
    expect(h.source.clearRemembered).toHaveBeenCalledOnce()
  })

  it('只保留测试歌曲选择，线路交给应用自动判断', () => {
    const element = AmllLyricsSettings()
    expect(elements(element, 'select')).toHaveLength(1)
    expect(elements(element, 'details')).toHaveLength(1)
    expect(text(element)).not.toContain('连接线路')
  })
})
