import * as THREE from 'three'

/** 玻璃专用低分辨率背景；隐藏歌词自身，防止将上一次字面反馈进折射。 */
export class StageGlassBackdrop {
  readonly target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true })
  readonly resolution = new THREE.Vector2()

  capture(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, lyrics: THREE.Object3D) {
    renderer.getDrawingBufferSize(this.resolution)
    const scale = Math.min(0.5, 960 / Math.max(this.resolution.x, this.resolution.y))
    this.target.setSize(Math.max(1, Math.round(this.resolution.x * scale)), Math.max(1, Math.round(this.resolution.y * scale)))
    const previous = renderer.getRenderTarget()
    const visible = lyrics.visible
    const pixels = new Map<THREE.IUniform<number>, number>()
    const sizes = new Map<THREE.PointsMaterial, number>()
    scene.traverseVisible((object) => {
      if (!(object instanceof THREE.Points)) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) {
        if (material instanceof THREE.ShaderMaterial && material.uniforms.uPixel && !pixels.has(material.uniforms.uPixel)) {
          const pixel = material.uniforms.uPixel
          pixels.set(pixel, pixel.value)
          pixel.value *= scale
        } else if (material instanceof THREE.PointsMaterial && !sizes.has(material)) {
          sizes.set(material, material.size)
          material.size *= scale
        }
      }
    })
    try {
      lyrics.visible = false
      renderer.setRenderTarget(this.target)
      renderer.clear()
      renderer.render(scene, camera)
    } finally {
      for (const [pixel, value] of pixels) pixel.value = value
      for (const [material, value] of sizes) material.size = value
      lyrics.visible = visible
      renderer.setRenderTarget(previous)
    }
  }

  dispose() {
    this.target.dispose()
  }
}
