/**
 * 流体玻璃透镜（折射思路参照 childrentime/liquid-glass 的 SDF 位移，改用 WebGL 自行渲染）：
 * 把透镜下方的标签预先画成一张贴图，片元着色器按胶囊 SDF 沿边缘法线向内取样，
 * 斜面内产生厚玻璃的弯折与轻微色散，中心平坦区只做等比放大。
 * 不依赖 SVG 滤镜：backdrop-filter / filter 里的 SVG 坐标原点在嵌套变换下会偏离元素自身。
 */

export interface LensFrame {
  /** 透镜在标签条坐标系中的可见矩形（已含浮起缩放），CSS px。 */
  left: number
  top: number
  width: number
  height: number
  magnify: number
  /** 边缘斜面宽度与最大折射偏移，CSS px。 */
  bezel: number
  depth: number
  /** 握持牵拉方向，限制在 -1～1；只改变局部轮廓。 */
  flowX?: number
  flowY?: number
}

const FLOW_AMPLITUDE = 2.2
const FLOW_INSET = 3
const clampFlow = (value: number) => Math.max(-1, Math.min(1, value))

/** 与着色器共用的非对称轮廓；scale 用于抵消外层 CSS 缩放。 */
export function lensOutline(rect: Pick<LensFrame, 'left' | 'top' | 'width' | 'height'>, flowX = 0, flowY = 0, scaleX = 1, scaleY = 1) {
  if (rect.width < 0.1 || rect.height < 0.1) return ''
  const cx = rect.width / 2
  const cy = rect.height / 2
  const r = Math.min(cx, cy)
  const fx = clampFlow(flowX)
  const fy = clampFlow(flowY)
  const inset = FLOW_INSET * Math.max(Math.abs(fx), Math.abs(fy))
  const corners = [[cx - r, -cy + r], [cx - r, cy - r], [-cx + r, cy - r], [-cx + r, -cy + r]]
  const points: string[] = []
  function add(px: number, py: number) {
    const u = px / cx
    const v = py / cy
    const dx = FLOW_AMPLITUDE * fx * 0.55 * Math.sin(v * 2.4 + u * 0.9)
    const dy = FLOW_AMPLITUDE * (fy * Math.sin(u * 3.2 - v * 0.7) + fx * 0.35 * Math.sin(u * 1.7 + v * 2.1))
    points.push(`${((rect.left + cx + px * (1 - inset / cx) + dx) / scaleX).toFixed(2)},${((rect.top + cy + py * (1 - inset / cy) + dy) / scaleY).toFixed(2)}`)
  }
  for (let side = 0; side < 4; side++) {
    const [ox, oy] = corners[side]
    const angle = -Math.PI / 2 + side * Math.PI / 2
    for (let step = 0; step <= 16; step++) {
      const a = angle + step / 16 * Math.PI / 2
      add(ox + r * Math.cos(a), oy + r * Math.sin(a))
    }
    const end = angle + Math.PI / 2
    const [nx, ny] = corners[(side + 1) % 4]
    for (let step = 1; step < 8; step++) add(ox + (nx - ox) * step / 8 + r * Math.cos(end), oy + (ny - oy) * step / 8 + r * Math.sin(end))
  }
  return `M${points.join('L')}Z`
}

/** 由透镜的布局尺寸与缩放算出可见矩形；缩放以透镜中心为原点。 */
export function lensRect(x: number, width: number, top: number, height: number, scaleX: number, scaleY: number) {
  const w = width * scaleX
  const h = height * scaleY
  return { left: x + width / 2 - w / 2, top: top + height / 2 - h / 2, width: w, height: h }
}

const VERTEX = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

const FRAGMENT = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uStrip;
uniform vec2 uStripSize;
uniform vec2 uOrigin;
uniform vec2 uSize;
uniform float uMagnify;
uniform float uBezel;
uniform float uDepth;
uniform vec3 uBackdrop;
uniform vec2 uFlow;

vec2 flowOffset(vec2 p, vec2 c) {
  vec2 uv = p / c;
  return ${FLOW_AMPLITUDE.toFixed(1)} * vec2(
    uFlow.x * 0.55 * sin(uv.y * 2.4 + uv.x * 0.9),
    uFlow.y * sin(uv.x * 3.2 - uv.y * 0.7) + uFlow.x * 0.35 * sin(uv.x * 1.7 + uv.y * 2.1)
  );
}

vec4 tap(vec2 p) {
  vec2 uv = (uOrigin + p) / uStripSize;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
  return texture2D(uStrip, uv);
}

void main() {
  vec2 c = uSize * 0.5;
  vec2 p = vUv * uSize - c;
  vec2 shrink = vec2(1.0) - ${FLOW_INSET.toFixed(1)} * max(abs(uFlow.x), abs(uFlow.y)) / c;
  vec2 shaped = p / shrink;
  // 逆解局部牵拉，使玻璃轮廓、高光、标签挖空与折射使用同一形状。
  for (int i = 0; i < 4; i++) shaped = (p - flowOffset(shaped, c)) / shrink;
  float r = min(c.x, c.y);
  vec2 q = abs(shaped) - c + r;
  float d;
  vec2 n;
  if (q.x > 0.0 && q.y > 0.0) {
    float len = length(q);
    d = len - r;
    n = q / len;
  } else {
    d = max(q.x, q.y) - r;
    n = q.x > q.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  }
  if (d > 0.0) discard;
  n *= vec2(shaped.x < 0.0 ? -1.0 : 1.0, shaped.y < 0.0 ? -1.0 : 1.0);
  // 用牵拉映射的雅可比修正边缘法线，彩边随局部鼓起/收缩转向。
  vec2 uv = shaped / c;
  float a = ${FLOW_AMPLITUDE.toFixed(1)} * uFlow.x * 0.55 * cos(uv.y * 2.4 + uv.x * 0.9);
  float b = ${FLOW_AMPLITUDE.toFixed(1)} * uFlow.y * cos(uv.x * 3.2 - uv.y * 0.7);
  float e = ${FLOW_AMPLITUDE.toFixed(1)} * uFlow.x * 0.35 * cos(uv.x * 1.7 + uv.y * 2.1);
  float jxx = shrink.x + a * 0.9 / c.x;
  float jxy = a * 2.4 / c.y;
  float jyx = (b * 3.2 + e * 1.7) / c.x;
  float jyy = shrink.y + (-b * 0.7 + e * 2.1) / c.y;
  n = normalize(vec2(jyy * n.x - jyx * n.y, -jxy * n.x + jxx * n.y));
  float t = clamp(-d / uBezel, 0.0, 1.0);
  float bend = uDepth * (1.0 - smoothstep(0.0, 1.0, t));
  vec2 base = c + p / uMagnify;
  vec2 samplePoint = base - n * bend;
  // 三个波段在倒角边缘略微分开；中心保持同一次取样位置，避免文字整体染色。
  float dispersion = min(uDepth * 0.45, 2.5) * (1.0 - smoothstep(0.0, 1.0, t));
  vec4 red = tap(samplePoint + n * dispersion);
  vec4 green = tap(samplePoint);
  vec4 blue = tap(samplePoint - n * dispersion);
  // 各波段的覆盖率不同：以底色补足缺少的通道，黑字在浅底上也能产生互补彩边。
  float alpha = max(red.a, max(green.a, blue.a));
  vec3 coverage = vec3(red.a, green.a, blue.a);
  vec3 color = vec3(red.r, green.g, blue.b) + uBackdrop * (vec3(alpha) - coverage);
  gl_FragColor = vec4(color, alpha);
}`

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); return null }
  return shader
}

/** 单个透镜的 WebGL 渲染器；拿不到 WebGL 时 create 返回 null，调用方退回 DOM 副本。 */
export class LiquidLensRenderer {
  private stripWidth = 0
  private stripHeight = 0
  private backdrop: readonly number[] = [0, 0, 0]
  private constructor(
    private gl: WebGLRenderingContext,
    private program: WebGLProgram,
    private texture: WebGLTexture,
    private uniforms: Record<string, WebGLUniformLocation | null>,
  ) {}

  static create(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false })
    if (!gl) return null
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX)
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT)
    const program = gl.createProgram()
    const texture = gl.createTexture()
    if (!vs || !fs || !program || !texture) return null
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null
    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const pos = gl.getAttribLocation(program, 'aPos')
    gl.enableVertexAttribArray(pos)
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    const names = ['uStripSize', 'uOrigin', 'uSize', 'uMagnify', 'uBezel', 'uDepth', 'uBackdrop', 'uFlow']
    const uniforms = Object.fromEntries(names.map(name => [name, gl.getUniformLocation(program, name)]))
    return new LiquidLensRenderer(gl, program, texture, uniforms)
  }

  /** 上传标签条贴图；cssWidth/cssHeight 是贴图对应的标签条 CSS 尺寸。 */
  setStrip(source: HTMLCanvasElement, cssWidth: number, cssHeight: number, backdrop: readonly number[] = [0, 0, 0]) {
    const { gl } = this
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    this.stripWidth = cssWidth
    this.stripHeight = cssHeight
    this.backdrop = backdrop
  }

  get hasStrip() { return this.stripWidth > 0 }

  render(frame: LensFrame, density: number) {
    const { gl, uniforms: u } = this
    const canvas = gl.canvas as HTMLCanvasElement
    const w = Math.max(1, Math.round(frame.width * density))
    const h = Math.max(1, Math.round(frame.height * density))
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
    gl.viewport(0, 0, w, h)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (!this.hasStrip) return
    gl.useProgram(this.program)
    gl.uniform2f(u.uStripSize, this.stripWidth, this.stripHeight)
    gl.uniform2f(u.uOrigin, frame.left, frame.top)
    gl.uniform2f(u.uSize, frame.width, frame.height)
    gl.uniform1f(u.uMagnify, frame.magnify)
    gl.uniform1f(u.uBezel, frame.bezel)
    gl.uniform1f(u.uDepth, frame.depth)
    gl.uniform3f(u.uBackdrop, this.backdrop[0], this.backdrop[1], this.backdrop[2])
    gl.uniform2f(u.uFlow, clampFlow(frame.flowX ?? 0), clampFlow(frame.flowY ?? 0))
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }
}

function loadSvg(svg: SVGSVGElement, width: number, height: number, color: string) {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  const markup = new XMLSerializer().serializeToString(clone).replace(/currentColor/g, color)
  return new Promise<HTMLImageElement | null>(resolve => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
  })
}

/**
 * 把标签条上每个按钮的图标与文字按真实布局画进画布（统一用 color 着色），坐标与 offsetLeft 同系。
 * scale 为贴图相对 CSS 的倍率，透镜放大后仍保持清晰。
 */
export async function rasterizeTabStrip(root: HTMLElement, buttons: HTMLElement[], color: string, scale: number) {
  const width = root.scrollWidth
  const height = root.clientHeight
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width * scale)
  canvas.height = Math.ceil(height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  // 透明标签贴图不含底色；仅用于色散通道的合成补偿，不把底色画进透镜。
  const rootStyle = getComputedStyle(root)
  ctx.fillStyle = rootStyle.getPropertyValue('--sm-bg-base').trim() || '#000'
  ctx.fillRect(0, 0, 1, 1)
  ctx.fillStyle = rootStyle.backgroundColor
  ctx.fillRect(0, 0, 1, 1)
  const pixel = ctx.getImageData(0, 0, 1, 1).data
  const backdrop = [pixel[0] / 255, pixel[1] / 255, pixel[2] / 255]
  ctx.clearRect(0, 0, 1, 1)
  const base = root.getBoundingClientRect()
  const ox = base.left + root.clientLeft - root.scrollLeft
  const oy = base.top + root.clientTop
  ctx.scale(scale, scale)
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  const icons: Promise<void>[] = []
  for (const button of buttons) {
    const svg = button.querySelector('svg')
    if (svg) {
      const rect = svg.getBoundingClientRect()
      icons.push(loadSvg(svg, rect.width * scale, rect.height * scale, color).then(image => {
        if (image) ctx.drawImage(image, rect.left - ox, rect.top - oy, rect.width, rect.height)
      }))
    }
    const label = button.querySelector<HTMLElement>(':scope > span:last-child')
    if (label?.textContent) {
      const style = getComputedStyle(label)
      const rect = label.getBoundingClientRect()
      ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      ctx.fillText(label.textContent, rect.left - ox, rect.top - oy + rect.height / 2)
    }
  }
  await Promise.all(icons)
  return { canvas, width, height, backdrop }
}
