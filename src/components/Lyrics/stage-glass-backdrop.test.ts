import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { StageGlassBackdrop } from './stage-glass-backdrop'

describe('StageGlassBackdrop', () => {
  it.each([false, true])('采样隐藏歌词且在渲染异常=%s时恢复目标和可见性', (fail) => {
    const backdrop = new StageGlassBackdrop()
    const lyrics = new THREE.Group()
    const scene = new THREE.Scene()
    const pixel = { value: 2 }
    const material = new THREE.ShaderMaterial({ uniforms: { uPixel: pixel } })
    scene.add(new THREE.Points(new THREE.BufferGeometry(), material))
    const previous = new THREE.WebGLRenderTarget(1, 1)
    const renderer = {
      getDrawingBufferSize: (size: THREE.Vector2) => size.set(3840, 2160),
      getRenderTarget: () => previous,
      setRenderTarget: vi.fn(),
      clear: vi.fn(),
      render: vi.fn(() => {
        expect(lyrics.visible).toBe(false)
        expect(pixel.value).toBe(0.5)
        if (fail) throw new Error('render failure')
      })
    }
    const capture = () => backdrop.capture(renderer as unknown as THREE.WebGLRenderer, scene, new THREE.Camera(), lyrics)
    if (fail) expect(capture).toThrow('render failure')
    else capture()
    expect(lyrics.visible).toBe(true)
    expect(pixel.value).toBe(2)
    expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(previous)
    expect([backdrop.target.width, backdrop.target.height]).toEqual([960, 540])
    const disposed = vi.fn()
    backdrop.target.addEventListener('dispose', disposed)
    backdrop.dispose()
    expect(disposed).toHaveBeenCalledOnce()
    previous.dispose()
  })
})
