import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LiquidEther from './LiquidEther'

const h = vi.hoisted(() => ({
  refs: [] as { current: unknown }[],
  effects: [] as { deps: unknown[]; cleanup?: () => void }[],
  pending: [] as (() => void)[],
  refIndex: 0,
  effectIndex: 0,
  mount: null as unknown,
  rendererCount: 0,
  forces: [] as { x: number; y: number }[],
}))

vi.mock('react', () => ({
  useRef: (initial: unknown) => {
    const index = h.refIndex++
    return h.refs[index] ??= { current: index === 0 ? h.mount : initial }
  },
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
    const index = h.effectIndex++
    const previous = h.effects[index]
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
      h.pending.push(() => {
        previous?.cleanup?.()
        h.effects[index] = { deps, cleanup: effect() || undefined }
      })
    }
  },
}))

// 保留真实向量、模拟和着色器参数，仅替换 GPU 输出，检查实际注入力。
vi.mock('three', async (importOriginal) => ({
  ...await importOriginal<typeof import('three')>(),
  WebGLRenderer: class {
    domElement = { style: {} }
    constructor() { h.rendererCount += 1 }
    setClearColor() {}
    setPixelRatio() {}
    setSize() {}
    setRenderTarget() {}
    dispose() {}
    forceContextLoss() {}
    render(scene: import('three').Scene) {
      for (const child of scene.children) {
        const material = (child as import('three').Mesh).material as import('three').RawShaderMaterial
        const force = material?.uniforms?.force?.value as { x: number; y: number } | undefined
        if (force) h.forces.push({ x: force.x, y: force.y })
      }
    }
  },
}))

const frames = new Map<number, FrameRequestCallback>()
const listeners = new Map<string, EventListener>()
const documentListeners = new Map<string, EventListener>()
const colors = ['#5227FF', '#FF9FFC']
let now = 0
let nextFrame = 0

function render(pointerInteraction?: boolean, autoDemo = true) {
  h.refIndex = h.effectIndex = 0
  LiquidEther({ pointerInteraction, colors, autoDemo, fpsCap: 20, interactFpsCap: 60, autoResumeDelay: 2000 })
  h.pending.splice(0).forEach((effect) => effect())
}

function frame(time: number) {
  now = time
  const [id, callback] = frames.entries().next().value as [number, FrameRequestCallback]
  frames.delete(id)
  callback(time)
}

function move(x: number, y: number) {
  listeners.get('mousemove')?.({ clientX: x, clientY: y } as unknown as Event)
}

beforeEach(() => {
  h.refs = []
  h.effects = []
  h.pending = []
  h.rendererCount = 0
  h.forces = []
  frames.clear()
  listeners.clear()
  documentListeners.clear()
  now = nextFrame = 0
  const view = {
    addEventListener: (name: string, callback: EventListener) => listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name),
    setTimeout: vi.fn(() => 1),
    clearTimeout: vi.fn(),
  }
  const doc = {
    defaultView: view, hidden: false, hasFocus: () => true,
    addEventListener: (name: string, callback: EventListener) => documentListeners.set(name, callback),
    removeEventListener: (name: string) => documentListeners.delete(name),
  }
  h.mount = {
    style: {}, ownerDocument: doc, prepend: vi.fn(),
    getBoundingClientRect: () => ({ width: 1000, height: 700, left: 0, top: 0, right: 1000, bottom: 700 }),
  }
  vi.stubGlobal('window', view)
  vi.stubGlobal('document', doc)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.spyOn(Math, 'random').mockReturnValue(0.75)
})

afterEach(() => {
  h.effects.forEach((effect) => effect.cleanup?.())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('流体鼠标跟随解耦', () => {
  it('关闭跟随仍自动漂流，不监听鼠标触摸且不触发交互提帧', () => {
    render(false)
    expect(listeners.has('mousemove')).toBe(false)
    expect(listeners.has('touchstart')).toBe(false)
    expect(documentListeners.has('mouseleave')).toBe(false)
    frame(100)
    frame(300)
    expect(h.forces.some(({ x, y }) => x !== 0 || y !== 0)).toBe(true)
    const count = h.forces.length
    move(900, 50)
    frame(320)
    expect(h.forces).toHaveLength(count)
    frame(350)
    expect(h.forces).toHaveLength(count + 1)
  })

  it('热切换清理悬停和接管状态，恢复自动漂流，不重建场景；再次开启可交互', () => {
    render()
    expect(listeners.has('mousemove')).toBe(true)
    frame(2100)
    frame(2200)
    move(900, 50)
    frame(2250)
    const staleMove = listeners.get('mousemove')
    render(false)
    expect(h.rendererCount).toBe(1)
    expect(window.clearTimeout).toHaveBeenCalledWith(1)
    for (const event of ['mousemove', 'touchstart', 'touchmove', 'touchend']) expect(listeners.has(event)).toBe(false)
    expect(documentListeners.has('mouseleave')).toBe(false)
    staleMove?.({ clientX: 0, clientY: 0 } as unknown as Event)
    frame(2300)
    expect(h.forces.at(-1)).toEqual({ x: 0, y: 0 })
    frame(2400)
    expect(h.forces.at(-1)).not.toEqual({ x: 0, y: 0 })
    const count = h.forces.length
    frame(2420)
    expect(h.forces).toHaveLength(count)

    render(true)
    expect(h.rendererCount).toBe(1)
    expect(listeners.has('touchmove')).toBe(true)
    move(100, 650)
    frame(2440)
    expect(h.forces.length).toBeGreaterThan(count)
    expect(h.forces.at(-1)).not.toEqual({ x: 0, y: 0 })
    h.effects.forEach((effect) => effect.cleanup?.())
    expect(listeners.size).toBe(0)
    expect(documentListeners.size).toBe(0)
    expect(frames.size).toBe(0)
  })
})
