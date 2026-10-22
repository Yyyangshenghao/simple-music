import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LyricSourceCandidate } from '../../types/lyrics-source'

const h = vi.hoisted(() => ({
  values: [] as unknown[], stateIndex: 0, refs: [] as Array<{ current: any }>, refIndex: 0,
  effects: [] as Array<() => void | (() => void)>,
  state: {
    candidateTrackKey: 'netease:1', candidateToken: 'selection-token', candidates: [] as LyricSourceCandidate[],
    appliedOrigin: 'netease', requestedOrigin: 'auto', remembered: {} as Record<string, { origin: string }>,
    defaultSource: 'auto', appliedPreference: 'auto', fallbackReason: null,
    queryCandidates: vi.fn(), chooseSource: vi.fn(), cancelSelection: vi.fn(),
  },
  close: vi.fn(), toast: vi.fn(), requestLyrics: vi.fn(), requestMusic: vi.fn(), navigateTo: vi.fn(),
}))

vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = h.stateIndex++
    if (!(index in h.values)) h.values[index] = typeof initial === 'function' ? initial() : initial
    return [h.values[index], (next: unknown) => { h.values[index] = typeof next === 'function' ? next(h.values[index]) : next }]
  },
  useRef: (initial: unknown) => {
    const index = h.refIndex++
    return h.refs[index] ?? (h.refs[index] = { current: initial })
  },
  useEffect: (effect: typeof h.effects[number]) => h.effects.push(effect),
}))
vi.mock('../../stores/lyrics-source', () => ({ useLyricsSourceStore: Object.assign((selector: (state: typeof h.state) => unknown) => selector(h.state), { getState: () => h.state }) }))
vi.mock('../../stores/lyrics-source-dialog', () => ({ useLyricsSourceDialogStore: { getState: () => ({ close: h.close }) } }))
vi.mock('../../stores/player', () => ({ usePlayerStore: vi.fn() }))
vi.mock('../../stores/navigation', () => ({ useNavigationStore: { getState: () => ({ requestSettingsLyrics: h.requestLyrics, requestSettingsMusic: h.requestMusic, navigateTo: h.navigateTo }) } }))
vi.mock('../../stores/toast', () => ({ useToastStore: { getState: () => ({ show: h.toast }) } }))

import { LyricsSourceSelection } from './LyricsSourceDialog'

function elements(node: unknown, type: string): ReactElement<any>[] {
  if (!node || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap((child) => elements(child, type))
  const element = node as ReactElement<any>
  return element.type === type ? [element, ...elements(element.props.children, type)] : elements(element.props?.children, type)
}
const track = { id: 1, source: 'netease' as const, provider: 'netease' as const, type: 'song' as const, artists: [], name: '歌曲', artist: '歌手', duration: 180000, cover: '' }
const candidate = (origin: 'netease' | 'qq'): LyricSourceCandidate => ({ origin, status: 'ready', wordTimed: false, hasTranslation: false, hasRomaji: false, preview: [{ time: 48, text: `${origin}歌词` }] })
function render() {
  h.stateIndex = 0
  h.refIndex = 0
  h.effects = []
  return LyricsSourceSelection({ track })
}
function button(element: ReactElement, text: string) {
  const result = elements(element, 'button').find((element) => element.props.children === text)
  if (!result) throw new Error(`按钮不存在：${text}`)
  return result
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('crypto', { randomUUID: () => 'selection-token' })
  h.values = []
  h.refs = []
  Object.assign(h.state, { requestedOrigin: 'auto', appliedOrigin: 'netease', remembered: {}, defaultSource: 'auto', appliedPreference: 'auto', fallbackReason: null, candidates: [candidate('netease'), candidate('qq')] })
  h.state.queryCandidates.mockResolvedValue(undefined)
  h.state.chooseSource.mockResolvedValue({ saved: true, offsetReset: false })
})

describe('歌词来源选择交互', () => {
  it('预览只查询候选，按确认后才应用，并默认记住本首选择', async () => {
    let element = render()
    elements(element, 'button').find((button) => button.props.role === 'radio' && button.props.children[0].props.children[0].props?.children === 'QQ 音乐')!.props.onClick()
    expect(h.state.queryCandidates).toHaveBeenCalledWith('netease:1', 'selection-token', 'qq')
    expect(h.state.chooseSource).not.toHaveBeenCalled()
    element = render()
    await button(element, '使用此歌词').props.onClick()
    await Promise.resolve()
    expect(h.state.chooseSource).toHaveBeenCalledWith('netease:1', 'selection-token', 'qq', true)
    expect(h.close).toHaveBeenCalledOnce()
    expect(h.toast).toHaveBeenCalledWith('已切换，下次仍使用此来源')
  })

  it('关闭取消当前事务，迟到成功不能再显示成功提示', async () => {
    h.state.requestedOrigin = 'qq'
    h.state.appliedOrigin = 'qq'
    let finish!: (result: unknown) => void
    h.state.chooseSource.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const element = render()
    button(element, '保存选择').props.onClick()
    element.props.onCancel({ preventDefault: vi.fn() })
    finish({ saved: true, offsetReset: false })
    await Promise.resolve()
    expect(h.state.cancelSelection).toHaveBeenCalledWith('selection-token')
    expect(h.toast).not.toHaveBeenCalled()
  })

  it('切换失败保留面板、原选择与重试操作', async () => {
    h.state.requestedOrigin = 'qq'
    h.state.appliedOrigin = 'qq'
    h.state.chooseSource.mockRejectedValue(new Error('网络失败'))
    button(render(), '保存选择').props.onClick()
    await Promise.resolve()
    const element = render()
    expect(h.close).not.toHaveBeenCalled()
    expect(elements(element, 'p').find((element) => element.props.role === 'alert')?.props.children).toContain('仍使用原歌词')
    expect(button(element, '保存选择').props.disabled).toBe(false)
  })

  it('恢复自动清除本首覆盖，默认规则变化时允许重新应用', () => {
    h.state.remembered = { 'netease:1': { origin: 'qq' } }
    expect(button(render(), '恢复自动选择').props.disabled).toBe(false)
    h.state.remembered = {}
    h.state.defaultSource = 'amll'
    expect(button(render(), '应用当前默认规则').props.disabled).toBe(false)
  })

  it('仅本次不会删旧记忆，来源查询生命周期结束后取消事务', () => {
    h.state.requestedOrigin = 'qq'
    h.state.remembered = { 'netease:1': { origin: 'netease' } }
    let element = render()
    elements(element, 'input')[0].props.onChange({ target: { checked: false } })
    element = render()
    expect(elements(element, 'p').some((element) => Array.isArray(element.props.children) && element.props.children.includes('网易云音乐'))).toBe(true)
    expect(h.state.chooseSource).not.toHaveBeenCalled()
    const cleanup = h.effects[0]()
    expect(h.state.queryCandidates).toHaveBeenCalledWith('netease:1', 'selection-token')
    cleanup?.()
    expect(h.state.cancelSelection).toHaveBeenCalledWith('selection-token')
  })

  it('记住的来源临时回退后，重试可用来源仍能重新应用', () => {
    h.state.requestedOrigin = 'qq'
    h.state.appliedOrigin = 'netease'
    h.state.remembered = { 'netease:1': { origin: 'qq' } }
    expect(button(render(), '使用此歌词').props.disabled).toBe(false)
  })

  it('默认设置使用现有导航请求，不把歌词规则当播放来源', () => {
    button(render(), '默认选择设置…').props.onClick()
    expect(h.close).toHaveBeenCalledOnce()
    expect(h.requestLyrics).toHaveBeenCalledOnce()
    expect(h.requestMusic).not.toHaveBeenCalled()
    expect(h.navigateTo).toHaveBeenCalledWith('settings')
  })

  it('应用成功但记忆写入失败时，不显示已记住', async () => {
    h.state.requestedOrigin = 'qq'
    h.state.appliedOrigin = 'qq'
    h.state.chooseSource.mockResolvedValue({ saved: false, offsetReset: true })
    button(render(), '保存选择').props.onClick()
    await Promise.resolve()
    expect(h.toast).toHaveBeenCalledWith('已切换，但未能记住选择，请重试保存；歌词同步偏移已归零')
  })

  it('缺少时长不误导用户去登录，缺匹配平台时才提供音源入口', () => {
    h.state.requestedOrigin = 'amll'
    h.state.candidates = [{ ...candidate('netease'), origin: 'amll', status: 'unavailable', message: '缺少歌曲时长，无法校验匹配版本' }]
    expect(elements(render(), 'button').some((button) => button.props.children === '音源设置…')).toBe(false)
    h.state.candidates[0].message = '需启用可匹配的平台'
    expect(elements(render(), 'button').some((button) => button.props.children === '音源设置…')).toBe(true)
  })

  it('能力标签不把所有翻译宣称为中文', () => {
    h.state.candidates[0].hasTranslation = true
    expect(elements(render(), 'span').some((span) => span.props.children === '逐行 · 翻译')).toBe(true)
    expect(elements(render(), 'span').some((span) => span.props.children === '逐行 · 中文翻译')).toBe(false)
  })
})
