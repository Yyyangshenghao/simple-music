import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  state: { promptId: 1 as number | null, pending: false, error: '', resolve: vi.fn() },
  effects: [] as Array<() => (() => void) | undefined>,
  remember: false, setRemember: vi.fn(), refs: 0,
  dialog: { open: false, showModal: vi.fn(), close: vi.fn() },
  cancel: { focus: vi.fn() }
}))
vi.mock('../../stores/window-close', () => ({ useWindowCloseStore: (selector: (state: typeof h.state) => unknown) => selector(h.state) }))
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: (effect: typeof h.effects[number]) => h.effects.push(effect),
  useRef: () => ({ current: h.refs++ === 0 ? h.dialog : h.cancel }),
  useState: () => [h.remember, h.setRemember]
}))
import { WindowCloseDialog } from './WindowCloseDialog'

function buttons(node: unknown): ReactElement<any>[] {
  if (!node || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(buttons)
  const element = node as ReactElement<any>
  return element.type === 'button' ? [element] : buttons(element.props?.children)
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(h.state, { promptId: 1, pending: false, error: '' })
  h.effects = []
  h.refs = 0
  h.remember = false
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
    cleanup?.()
    expect(h.dialog.close).toHaveBeenCalledOnce()
  })

  it('两种关闭操作携带记住选项，取消和 Esc 均不记住', () => {
    h.remember = true
    const element = WindowCloseDialog()!
    const choices = buttons(element)
    choices[0].props.onClick()
    choices[1].props.onClick()
    choices[2].props.onClick()
    const event = { preventDefault: vi.fn() }
    element.props.onCancel(event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(h.state.resolve.mock.calls).toEqual([['tray', true], ['quit', true], ['cancel', false], ['cancel', false]])
  })

  it('处理中禁用操作，失败提供提示并保留同一请求；无请求不显示', () => {
    h.state.pending = true
    h.state.error = '操作未完成，请重试。'
    const element = WindowCloseDialog()!
    expect(buttons(element).every(button => button.props.disabled)).toBe(true)
    h.refs = 0
    const html = renderToStaticMarkup(<WindowCloseDialog />)
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('role="alert"')
    expect(html).toContain('操作未完成，请重试。')
    h.state.promptId = null
    expect(WindowCloseDialog()).toBeNull()
  })

  it('Tab 在首尾控件间循环，焦点不会落到窗口背景', () => {
    const element = WindowCloseDialog()!
    const first = { focus: vi.fn() }
    const last = { focus: vi.fn() }
    const event = {
      key: 'Tab', shiftKey: false, target: last,
      currentTarget: { querySelectorAll: () => [first, last] },
      preventDefault: vi.fn(), stopPropagation: vi.fn()
    }
    element.props.onKeyDown(event)
    expect(first.focus).toHaveBeenCalledOnce()
    element.props.onKeyDown({ ...event, shiftKey: true, target: first })
    expect(last.focus).toHaveBeenCalledOnce()
    expect(event.preventDefault).toHaveBeenCalledTimes(2)
  })
})
