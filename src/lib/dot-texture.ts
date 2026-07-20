import * as THREE from 'three'

/**
 * 柔和圆点精灵纹理(干净圆点带衰减缘,无外圈 glow)。
 * 封面粒子云与 3D 舞台歌词的星点共用;模块级缓存,勿在组件卸载时 dispose。
 */
let cached: THREE.CanvasTexture | null = null

export function getDotSpriteTexture(): THREE.CanvasTexture {
  if (cached) return cached
  const cv = document.createElement('canvas')
  cv.width = cv.height = 64
  const ctx = cv.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 31)
  g.addColorStop(0.0, 'rgba(255,255,255,0.96)')
  g.addColorStop(0.42, 'rgba(255,255,255,0.78)')
  g.addColorStop(0.72, 'rgba(255,255,255,0.22)')
  g.addColorStop(1.0, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  cached = new THREE.CanvasTexture(cv)
  cached.minFilter = THREE.LinearFilter
  cached.magFilter = THREE.LinearFilter
  return cached
}
