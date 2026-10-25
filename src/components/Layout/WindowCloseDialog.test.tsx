import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  state: { promptId: 1 as number | null, pending: false, error: '', resolve: vi.fn() },
  effects: [] as Array<() => (() => void) | undefined>,
  remember: false, setRemember: vi.fn(), refs: 0,
  action: 'tray' as 'tray' | 'quit', setAction: vi.fn(),
  dialog: { open: false, showModal: vi.fn(), close: vi.fn() },
  cancel: { focus: vi.fn() }
}))
vi.mock('../../stores/window-close', () => ({ useWindowCloseStore: (selector: (state: typeof h.state) => unknown) => selector(h.state) }))
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: (effect: typeof h.effects[number]) => h.effects.push(effect),
  useRef: () => ({ current: h.refs++ === 0 ? h.dialog : h.cancel }),
  useState: (initial: unknown) => initial === 'tray' ? [h.action, h.setAction] : [h.remember, h.setRemember]
}))
import { WindowCloseDialog } from './WindowCloseDialog'

function elements(node: unknown, type: string): ReactElement<any>[] {
  if (!node || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(child => elements(child, type))
  const element = node as ReactElement<any>
  return element.type === type ? [element] : elements(element.props?.children, type)
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(h.state, { promptId: 1, pending: false, error: '' })
  h.effects = []
  h.refs = 0
  h.remember = false
  h.action = 'tray'
  h.dialog.open = false
  h.dialog.showModal.mockImplementation(() => { h.dialog.open = true })
  h.dialog.close.mockImplementation(() => { h.dialog.open = false })
})

describe('关闭确认交互', () => {
  it('请求到达时打开模态框并默认聚焦取消，离开请求后关闭并重置记住', () => {
    WindowCloseDialog()
    const cleanup = h.effects[0]()
    expect(h.dialog.showModal).toHaveBeenCalledOnce()
    expect(h.cancel.focus).toHaveBeenCalledOnce()
    expect(h.setRemember).toHaveBeenCalledWith(false)
    expect(h.setAction).toHaveBeenCalledWith('tray')
    cleanup?.()
    expect(h.dialog.close).toHaveBeenCalledOnce()
  })

  it('切换选项不执行关闭，点击确定才提交所选行为与记住选项', () => {
    h.remember = true
    let element = WindowCloseDialog()!
    const radios = elements(element, 'input').filter(input => input.props.type === 'radio')
    expect(radios.map(input => input.props.checked)).toEqual([true, false])
    radios[1].props.onChange()
    expect(h.setAction).toHaveBeenCalledWith('quit')
    expect(h.state.resolve).not.toHaveBeenCalled()
    h.action = 'quit'
    h.refs = 0
    element = WindowCloseDialog()!
    const event = { preventDefault: vi.fn() }
    elements(element, 'form')[0].props.onSubmit(event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(h.state.resolve).toHaveBeenCalledWith('quit', true)
    const html = renderToStaticMarkup(element)
    expect(html).toContain('type="submit"')
    expect(html).toContain('确定')
    expect(html).not.toContain('让音乐继续')
  })

  it('默认确定缩回托盘，取消和 Esc 不保存已经切换的选择', () => {
    let element = WindowCloseDialog()!
    elements(element, 'form')[0].props.onSubmit({ preventDefault: vi.fn() })
    expect(h.state.resolve).toHaveBeenCalledWith('tray', false)
    h.state.resolve.mockClear()
    h.action = 'quit'
    h.remember = true
    h.refs = 0
    element = WindowCloseDialog()!
    elements(element, 'button').find(button => button.props.type === 'button')!.props.onClick()
    element.props.onCancel({ preventDefault: vi.fn() })
    expect(h.state.resolve.mock.calls).toEqual([['cancel', false], ['cancel', false]])
  })

  it('处理中禁用操作，失败提供提示并保留同一请求；无请求不显示', () => {
    h.state.pending = true
    h.state.error = '操作未完成，请重试。'
    const element = WindowCloseDialog()!
    expect(elements(element, 'button').every(button => button.props.disabled)).toBe(true)
    expect(elements(element, 'fieldset')[0].props.disabled).toBe(true)
    h.refs = 0
    const html = renderToStaticMarkup(<WindowCloseDialog />)
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('role="alert"')
    expect(html).toContain('操作未完成，请重试。')
    h.state.promptId = null
    expect(WindowCloseDialog()).toBeNull()
  })

  it('Tab 不在弹窗控件间移动焦点，按键只截留在弹窗内', () => {
    const element = WindowCloseDialog()!
    const first = { focus: vi.fn() }
    const last = { focus: vi.fn() }
    const event = {
      key: 'Tab', shiftKey: false, target: last,
      currentTarget: { querySelectorAll: () => [first, last] },
      preventDefault: vi.fn(), stopPropagation: vi.fn()
    }
    element.props.onKeyDown(event)
    element.props.onKeyDown({ ...event, shiftKey: true, target: first })
    expect(first.focus).not.toHaveBeenCalled()
    expect(last.focus).not.toHaveBeenCalled()
    expect(event.stopPropagation).toHaveBeenCalledTimes(2)
  })
})
