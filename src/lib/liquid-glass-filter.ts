/**
 * 胶囊透镜折射滤镜：按胶囊外形生成位移贴图，供 `backdrop-filter: url(#id)` 使用（仅 Chromium 生效，
 * 其他环境退回 CSS 里的模糊）。中心保持通透，只有靠近边缘的一圈采样点往中心收，表现凸透镜边缘的弯折。
 * 不做分通道色散：小尺寸下色散只会在边缘留下锯齿状彩边。
 */

const SVG_NS = 'http://www.w3.org/2000/svg'
const created = new Set<string>()

/** 生成胶囊位移贴图：R/G 通道编码 x/y 位移，128 为不动。 */
function capsuleMap(width: number, height: number, density = 4): string | null {
  const canvas = document.createElement('canvas')
  const w = Math.round(width * density)
  const h = Math.round(height * density)
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const image = ctx.createImageData(w, h)
  const r = h / 2
  const halfSpan = w / 2 - r
  // 折射带只占半径的一部分，中心区域原样透出背后内容
  const bezel = r * 0.6
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const lx = px + 0.5 - w / 2
      const ly = py + 0.5 - h / 2
      const dx = Math.max(Math.abs(lx) - halfSpan, 0) * Math.sign(lx)
      const dist = Math.hypot(dx, ly)
      const inside = r - dist
      let ox = 0
      let oy = 0
      if (inside > 0 && dist > 0) {
        const t = Math.min(inside / bezel, 1)
        const bend = (1 - t) * (1 - t)
        ox = (dx / dist) * bend
        oy = (ly / dist) * bend
      }
      const i = (py * w + px) * 4
      image.data[i] = 128 - ox * 127
      image.data[i + 1] = 128 - oy * 127
      image.data[i + 2] = 128
      image.data[i + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  return canvas.toDataURL()
}

function el<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name)
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value))
  return node
}

/** 确保文档里有指定尺寸的胶囊折射滤镜，返回 CSS 可引用的 url()。同 id 只创建一次。 */
export function ensureCapsuleRefraction(id: string, width: number, height: number, scale: number): string {
  const ref = `url(#${id})`
  if (typeof document === 'undefined' || created.has(id)) return ref
  const map = capsuleMap(width, height)
  if (!map) return ref
  created.add(id)

  const svg = el('svg', { width: 0, height: 0, 'aria-hidden': 'true' })
  svg.style.position = 'absolute'
  svg.style.pointerEvents = 'none'
  const filter = el('filter', { id, x: 0, y: 0, width, height, filterUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' })
  filter.append(el('feImage', { href: map, x: 0, y: 0, width, height, preserveAspectRatio: 'none', result: 'map' }))
  filter.append(el('feDisplacementMap', { in: 'SourceGraphic', in2: 'map', scale, xChannelSelector: 'R', yChannelSelector: 'G', result: 'bent' }))
  // 8 位位移贴图在弧面上会量化出细碎台阶，轻微模糊抹平
  filter.append(el('feGaussianBlur', { in: 'bent', stdDeviation: 0.35 }))
  svg.append(filter)
  document.body.append(svg)
  return ref
}
