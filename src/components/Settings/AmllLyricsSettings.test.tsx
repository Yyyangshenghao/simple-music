import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  source: { defaultSource: 'auto', remembered: { 'netease:1': { origin: 'qq' } }, setDefaultSource: vi.fn(), clearRemembered: vi.fn() },
  settings: { lyricsAmllFallback: true, lyricsAmllHost: 'auto', lyricsKugouFallback: true, setLyricsAmllFallback: vi.fn(), setLyricsAmllHost: vi.fn(), setLyricsKugouFallback: vi.fn() },
  providers: { byId: { netease: { enabled: true, auth: 'authenticated' }, qq: { enabled: true, auth: 'authenticated' } } },
  requestMusic: vi.fn(), navigateTo: vi.fn(),
  confirm: false, setConfirm: vi.fn(),
}))
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (value: unknown) => typeof value === 'boolean' ? [h.confirm, h.setConfirm] : [value, vi.fn()],
}))
vi.mock('../../stores/lyrics-source', () => ({ useLyricsSourceStore: Object.assign((selector: (state: typeof h.source) => unknown) => selector(h.source), { getState: () => h.source }) }))
vi.mock('../../stores/settings', () => ({ AMLL_HOST_PREFERENCES: ['auto', 'github'], useSettingsStore: (selector: (state: typeof h.settings) => unknown) => selector(h.settings) }))
vi.mock('../../stores/providers', () => ({ useProviderStore: (selector: (state: typeof h.providers) => unknown) => selector(h.providers) }))
vi.mock('../../stores/navigation', () => ({ useNavigationStore: { getState: () => ({ requestSettingsMusic: h.requestMusic, navigateTo: h.navigateTo }) } }))
vi.mock('../ui/InfoButton', () => ({ InfoButton: () => null }))
vi.mock('../ui/Switch', () => ({ Switch: () => null }))
import { AmllLyricsSettings } from './AmllLyricsSettings'

function elements(node: unknown, type: string): ReactElement<any>[] {
  if (!node || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap((child) => elements(child, type))
  const element = node as ReactElement<any>
  return element.type === type ? [element] : elements(element.props?.children, type)
}

beforeEach(() => {
  vi.clearAllMocks()
  h.confirm = false
  h.source.defaultSource = 'auto'
  h.settings.lyricsAmllFallback = true
  h.providers.byId.netease = { enabled: true, auth: 'authenticated' }
  h.providers.byId.qq = { enabled: true, auth: 'authenticated' }
})

describe('歌词来源设置', () => {
  it('默认偏好通过宿主动作更新，保留原平台与补全来源选项', () => {
    const element = AmllLyricsSettings()
    const select = elements(element, 'select')[0]
    expect(elements(select, 'option').map((option) => option.props.value)).toEqual(['auto', 'origin', 'netease', 'qq', 'amll', 'kugou'])
    select.props.onChange({ target: { value: 'qq' } })
    expect(h.source.setDefaultSource).toHaveBeenCalledWith('qq')
  })

  it('清除记忆先展示明确范围，取消不调用清除动作', () => {
    let element = AmllLyricsSettings()
    elements(element, 'button').find((button) => button.props.children === '清除全部记忆…')!.props.onClick()
    expect(h.setConfirm).toHaveBeenCalledWith(true)
    expect(h.source.clearRemembered).not.toHaveBeenCalled()
    h.confirm = true
    element = AmllLyricsSettings()
    const clearCopy = elements(element, 'p').map((paragraph) => paragraph.props.children).flat().join('')
    expect(clearCopy).toContain('不删除歌词文件，不更改默认偏好')
    elements(element, 'button').find((button) => button.props.children === '保留')!.props.onClick()
    expect(h.setConfirm).toHaveBeenCalledWith(false)
    expect(h.source.clearRemembered).not.toHaveBeenCalled()
    elements(element, 'button').find((button) => button.props.children === '清除记忆')!.props.onClick()
    expect(h.source.clearRemembered).toHaveBeenCalledOnce()
  })

  it('优先来源已关闭时说明不可参与，保持开关由用户决定', () => {
    h.source.defaultSource = 'amll'
    h.settings.lyricsAmllFallback = false
    const element = AmllLyricsSettings()
    expect(elements(element, 'p').find((paragraph) => paragraph.props.role === 'status')?.props.children).toContain('优先来源已停用')
    expect(h.settings.setLyricsAmllFallback).not.toHaveBeenCalled()
  })

  it.each(['netease', 'qq'] as const)('优先%s未登录或停用时给出真实原因与现有音源入口', (source) => {
    h.source.defaultSource = source
    h.providers.byId[source].auth = 'anonymous'
    let element = AmllLyricsSettings()
    expect(elements(element, 'div').find((div) => div.props.role === 'status')?.props.children[0]).toContain('尚未登录')
    elements(element, 'button').find((button) => button.props.children === '音源设置…')!.props.onClick()
    expect(h.requestMusic).toHaveBeenCalledOnce()
    expect(h.navigateTo).toHaveBeenCalledWith('settings')
    h.providers.byId[source] = { auth: 'authenticated', enabled: false }
    element = AmllLyricsSettings()
    expect(elements(element, 'div').find((div) => div.props.role === 'status')?.props.children[0]).toContain('已停用')
  })

  it('AMLL线路与测速默认收起，参与开关仍在主设置层', () => {
    const element = AmllLyricsSettings()
    const connection = elements(element, 'details')[0]
    expect(connection.props.open).toBeUndefined()
    expect(elements(connection, 'summary')[0].props.children).toBe('AMLL 连接设置')
    expect(elements(connection, 'fieldset')).toHaveLength(1)
    expect(elements(connection, 'span').some((span) => span.props.children === '使用酷狗歌词库补全')).toBe(false)
  })
})
