import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createLyricStarRiver } from './stage-lyric-river'

vi.mock('../../lib/dot-texture', async () => {
  const { Texture } = await import('three')
  const texture = new Texture()
  return { getDotSpriteTexture: () => texture }
})

describe('createLyricStarRiver', () => {
  it('allocates complete attributes for twice the baseline particle count', () => {
    const pixel = { value: 2 }
    const river = createLyricStarRiver(pixel)
    expect(river.geometry.getAttribute('position').itemSize).toBe(3)
    for (const name of ['position', 'seed', 'lane', 'depthSeed']) {
      const attribute = river.geometry.getAttribute(name)
      expect(attribute.count).toBe(840)
      expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true)
    }
    expect(river.geometry.drawRange).toEqual({ start: 0, count: 420 })
    river.geometry.setDrawRange(0, 840)
    expect(river.geometry.drawRange.count).toBe(river.geometry.getAttribute('position').count)
    expect(river.material.uniforms.uPixel).toBe(pixel)
    expect(river.material.uniforms.uOpacity.value).toBe(0)
    expect(river.frustumCulled).toBe(false)
    expect(river.position.toArray()).toEqual([0, 0.18, 1.2])
    expect(river.renderOrder).toBe(38)
    expect(river.material.blending).toBe(THREE.AdditiveBlending)
    expect(river.material.depthWrite).toBe(false)
    river.geometry.dispose()
    river.material.dispose()
  })

  it('keeps the shared dot texture alive when one river is disposed', () => {
    const first = createLyricStarRiver({ value: 1 })
    const second = createLyricStarRiver({ value: 1 })
    const texture = first.material.uniforms.uMap.value as THREE.Texture
    const disposed = vi.fn()
    texture.addEventListener('dispose', disposed)
    expect(second.material.uniforms.uMap.value).toBe(texture)
    expect(second.geometry).not.toBe(first.geometry)
    expect(second.material).not.toBe(first.material)
    first.geometry.dispose()
    first.material.dispose()
    expect(disposed).not.toHaveBeenCalled()
    second.geometry.dispose()
    second.material.dispose()
    expect(disposed).not.toHaveBeenCalled()
    texture.removeEventListener('dispose', disposed)
  })
})
