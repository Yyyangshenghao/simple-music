import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  values: [] as unknown[], stateIndex: 0,
  state: {
    remembered: {
      'netease:1': { origin: 'qq', name: '晴天', artist: '周杰伦' },
      'local:2': { origin: 'local', name: 'Blue', artist: 'Anna' },
      'qq:3': { origin: 'kugou', name: '安静', artist: '周杰伦' },
    } as Record<string, { origin: string; name: string; artist: string }>,
    updateRemembered: vi.fn(() => true), clearRemembered: vi.fn(),
  },
  toast: vi.fn(),
}))
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = h.stateIndex++
    if (!(index in h.values)) h.values[index] = typeof initial === 'function' ? initial() : initial
    return [h.values[index], (next: unknown) => { h.values[index] = typeof next === 'function' ? next(h.values[index]) : next }]
  },
  useRef: (current: unknown) => ({ current }),
  useMemo: (factory: () => unknown) => factory(),
  useEffect: () => {},
}))
vi.mock('../../stores/lyrics-source', async (original) => ({
  ...await original<typeof import('../../stores/lyrics-source')>(),
  useLyricsSourceStore: Object.assign((selector: (state: typeof h.state) => unknown) => selector(h.state), { getState: () => h.state }),
}))
vi.mock('../../stores/toast', () => ({ useToastStore: { getState: () => ({ show: h.toast }) } }))
import { LyricsMemoryDialog, queryMemory, type MemoryEntry } from './LyricsMemoryDialog'

function render() {
  h.stateIndex = 0
  return LyricsMemoryDialog({ onClose: vi.fn() })
}
function elements(node: unknown, match: (element: ReactElement<any>) => boolean): ReactElement<any>[] {
  if (!node || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(child => elements(child, match))
  const element = node as ReactElement<any>
  return [...(match(element) ? [element] : []), ...elements(element.props?.children, match)]
}
function labelled(node: unknown, label: string) {
  return elements(node, element => element.props?.['aria-label'] === label)[0]
}
function text(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(text).join('')
  if (!node || typeof node !== 'object') return ''
  return text((node as ReactElement<any>).props?.children)
}
function button(node: unknown, label: string) {
  return elements(node, element => element.type === 'button' && text(element) === label)[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  h.values = []
})

describe('歌曲歌词来源管理', () => {
  it('按歌名或歌手搜索、按来源筛选，默认最近添加在前', () => {
    const entries = Object.entries(h.state.remembered) as MemoryEntry[]
    const keys = (query: Parameters<typeof queryMemory>[1]) => queryMemory(entries, query).map(([key]) => key)
    expect(keys({ search: '', origin: 'all', sort: 'recent' })).toEqual(['qq:3', 'local:2', 'netease:1'])
    expect(keys({ search: '', origin: 'all', sort: 'name' })).toEqual(['qq:3', 'netease:1', 'local:2'])
    expect(keys({ search: '周杰伦', origin: 'all', sort: 'name' })).toEqual(['qq:3', 'netease:1'])
    expect(keys({ search: ' blue ', origin: 'all', sort: 'recent' })).toEqual(['local:2'])
    expect(keys({ search: '', origin: 'kugou', sort: 'recent' })).toEqual(['qq:3'])
    // 同歌手再按歌名排。
    expect(keys({ search: '', origin: 'all', sort: 'artist' })).toEqual(['qq:3', 'netease:1', 'local:2'])
    expect(entries.map(([key]) => key)).toEqual(['netease:1', 'local:2', 'qq:3'])
  })

  it('筛选项只列出已使用的来源并带数量', () => {
    const filters = labelled(render(), '按来源筛选')
    expect(elements(filters, element => element.type === 'button').map(text)).toEqual(['全部3', 'QQ 音乐1', '本地歌词1', '酷狗歌词库1'])
  })

  it('单曲可改来源或忘记；本地歌曲额外可选本地歌词', () => {
    const element = render()
    const local = labelled(element, 'Blue的歌词来源')
    expect(elements(local, item => item.type === 'option').map(item => item.props.value)).toEqual(['local', 'netease', 'qq', 'amll', 'kugou'])
    expect(elements(labelled(element, '晴天的歌词来源'), item => item.type === 'option').map(item => item.props.value)).toEqual(['netease', 'qq', 'amll', 'kugou'])
    labelled(element, '晴天的歌词来源').props.onChange({ target: { value: 'amll' } })
    expect(h.state.updateRemembered).toHaveBeenCalledWith(['netease:1'], 'amll')
    labelled(element, '忘记安静的歌词来源').props.onClick()
    expect(h.state.updateRemembered).toHaveBeenCalledWith(['qq:3'], null)
    expect(h.toast).not.toHaveBeenCalled()
  })

  it('全选当前列表后可批量改来源，批量忘记需先确认', async () => {
    labelled(render(), '全选当前列表').props.onChange()
    let element = render()
    expect(text(element)).toContain('已选 3 首')
    labelled(element, '将所选歌曲改为').props.onChange({ target: { value: 'netease' } })
    expect(h.state.updateRemembered).toHaveBeenCalledWith(['qq:3', 'local:2', 'netease:1'], 'netease')
    await Promise.resolve()
    expect(h.toast).toHaveBeenCalledWith('已将 3 首歌曲改为网易云音乐')
    button(element, '忘记所选').props.onClick()
    expect(h.state.updateRemembered).toHaveBeenCalledTimes(1)
    element = render()
    expect(text(element)).toContain('忘记所选 3 首歌曲的来源选择？')
    button(element, '保留').props.onClick()
    button(render(), '忘记所选').props.onClick()
    button(render(), '忘记所选').props.onClick()
    expect(h.state.updateRemembered).toHaveBeenLastCalledWith(['qq:3', 'local:2', 'netease:1'], null)
    await Promise.resolve()
    expect(text(render())).toContain('勾选歌曲可批量修改或忘记')
  })

  it('宿主保存失败时不显示成功反馈，也不清空选择', async () => {
    h.state.updateRemembered.mockResolvedValueOnce(false as never)
    labelled(render(), '全选当前列表').props.onChange()
    labelled(render(), '将所选歌曲改为').props.onChange({ target: { value: 'qq' } })
    await Promise.resolve()
    expect(h.toast).not.toHaveBeenCalled()
    expect(text(render())).toContain('已选 3 首')
  })

  it('清除全部需确认，确认说明当前歌词不改变', () => {
    button(render(), '清除全部记忆…').props.onClick()
    expect(h.state.clearRemembered).not.toHaveBeenCalled()
    const element = render()
    expect(text(element)).toContain('当前歌词继续显示')
    button(element, '清除全部').props.onClick()
    expect(h.state.clearRemembered).toHaveBeenCalledOnce()
  })
})
