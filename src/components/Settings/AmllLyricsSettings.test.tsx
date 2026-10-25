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
  settings: {
    lyricsAmllFallback: true, lyricsKugouFallback: true, lyricsGuestSources: { netease: true, qq: true }, lyricsPlatformSources: { netease: true, qq: true },
    setLyricsAmllFallback: vi.fn(), setLyricsKugouFallback: vi.fn(), setLyricsGuestSource: vi.fn(), setLyricsPlatformSource: vi.fn(),
  },
  providers: { byId: { netease: { enabled: true, auth: 'anonymous' }, qq: { enabled: true, auth: 'anonymous' } } },
  confirm: false, setConfirm: vi.fn(), search: '', sample: 'sunny', setSample: vi.fn(),
}))
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useCallback: (callback: unknown) => callback,
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
vi.mock('../ui/Switch', () => ({ Switch: () => null }))
vi.mock('./LyricsMemoryDialog', () => ({ LyricsMemoryDialog: () => null }))
import { AmllLyricsSettings } from './AmllLyricsSettings'

function labelled(node: unknown, label: string): ReactElement<any> | undefined {
  if (!node || typeof node !== 'object') return undefined
  if (Array.isArray(node)) return node.map((child) => labelled(child, label)).find(Boolean)
  const element = node as ReactElement<any>
  return element.props?.['aria-label'] === label ? element : labelled(element.props?.children, label)
}

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
  h.source.remembered = { 'netease:1': { origin: 'qq', name: '晴天', artist: '周杰伦' } }
  h.source.health = {}
  h.source.probes = {}
  h.settings.lyricsAmllFallback = true
  h.settings.lyricsKugouFallback = true
  h.settings.lyricsGuestSources = { netease: true, qq: true }
  h.settings.lyricsPlatformSources = { netease: true, qq: true }
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

  it('每个来源一个开关，关闭后不可测试并显示已关闭', () => {
    h.settings.lyricsAmllFallback = false
    h.settings.lyricsPlatformSources = { netease: false, qq: true }
    const element = AmllLyricsSettings()
    const rows = elements(elements(element, 'ol')[0], 'li')
    expect(text(rows[0])).toContain('已关闭')
    expect(button(rows[0], '测试').props.disabled).toBe(true)
    expect(text(rows[2])).toContain('已关闭')
    labelled(element, '使用AMLL 逐字歌词库')!.props.onChange(true)
    expect(h.settings.setLyricsAmllFallback).toHaveBeenCalledWith(true)
    labelled(element, '使用酷狗歌词库')!.props.onChange(false)
    expect(h.settings.setLyricsKugouFallback).toHaveBeenCalledWith(false)
    labelled(element, '使用QQ 音乐')!.props.onChange(false)
    expect(h.settings.setLyricsPlatformSource).toHaveBeenCalledWith('qq', false)
    expect(h.settings.setLyricsGuestSource).not.toHaveBeenCalled()
  })

  it('重新启用平台时一并恢复游客查询，未登录显示以游客身份查询', () => {
    h.settings.lyricsGuestSources = { netease: false, qq: true }
    h.settings.lyricsPlatformSources = { netease: false, qq: true }
    const element = AmllLyricsSettings()
    labelled(element, '使用网易云音乐')!.props.onChange(true)
    expect(h.settings.setLyricsPlatformSource).toHaveBeenCalledWith('netease', true)
    expect(h.settings.setLyricsGuestSource).toHaveBeenCalledWith('netease', true)
    const rows = elements(elements(element, 'ol')[0], 'li')
    expect(text(rows[1])).toContain('未登录，以游客身份查询')
    expect(infoText(element)).toContain('不使用账号')
    expect(infoText(element)).toContain('只发送歌名与歌手')
  })

  it('歌曲来源记忆显示数量，管理入口打开独立弹窗', async () => {
    const { LyricsMemoryDialog } = await import('./LyricsMemoryDialog')
    let element = AmllLyricsSettings()
    expect(text(element)).toContain('1 首歌曲使用指定来源')
    expect(elements(element, LyricsMemoryDialog as never)).toHaveLength(0)
    button(element, '管理…').props.onClick()
    expect(h.setConfirm).toHaveBeenCalledWith(true)
    h.confirm = true
    element = AmllLyricsSettings()
    expect(elements(element, LyricsMemoryDialog as never)).toHaveLength(1)
  })

  it('没有记住的歌曲时管理入口不可用', () => {
    h.source.remembered = {} as typeof h.source.remembered
    const element = AmllLyricsSettings()
    expect(button(element, '管理…').props.disabled).toBe(true)
    expect(text(element)).toContain('在歌词页选择来源并记住后')
  })

  it('只保留测试歌曲选择，线路交给应用自动判断', () => {
    const element = AmllLyricsSettings()
    expect(elements(element, 'select')).toHaveLength(1)
    expect(text(element)).not.toContain('连接线路')
  })
})
