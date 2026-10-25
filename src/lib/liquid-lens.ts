/**
 * 流体玻璃透镜（折射思路参照 childrentime/liquid-glass 的 SDF 位移，改用 WebGL 自行渲染）：
 * 把透镜下方的标签预先画成一张贴图，片元着色器按胶囊 SDF 沿边缘法线向内取样，
 * 斜面内产生厚玻璃的弯折，中心平坦区只做等比放大。
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
  /** 边缘镜面高光强度，0 为不加（由 CSS 负责高光时）。 */
  rim?: number
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
uniform float uRim;

vec4 tap(vec2 p) {
  vec2 uv = (uOrigin + p) / uStripSize;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
  return texture2D(uStrip, uv);
}

void main() {
  vec2 c = uSize * 0.5;
  vec2 p = vUv * uSize - c;
  float r = min(c.x, c.y);
  vec2 q = abs(p) - c + r;
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
  n *= vec2(p.x < 0.0 ? -1.0 : 1.0, p.y < 0.0 ? -1.0 : 1.0);
  float t = clamp(-d / uBezel, 0.0, 1.0);
  float bend = uDepth * (1.0 - smoothstep(0.0, 1.0, t));
  vec2 base = c + p / uMagnify;
  vec4 color = tap(base - n * bend);
  // 斜面镜面高光：越靠边越亮，左上迎光、右下有弱反光。
  float facing = dot(n, normalize(vec2(-0.6, -0.8)));
  float glint = uRim * pow(1.0 - t, 3.0) * (0.25 + 0.75 * max(facing, 0.0) + 0.3 * max(-facing, 0.0));
  gl_FragColor = color + vec4(glint) * (1.0 - color.a);
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
    const names = ['uStripSize', 'uOrigin', 'uSize', 'uMagnify', 'uBezel', 'uDepth', 'uRim']
    const uniforms = Object.fromEntries(names.map(name => [name, gl.getUniformLocation(program, name)]))
    return new LiquidLensRenderer(gl, program, texture, uniforms)
  }

  /** 上传标签条贴图；cssWidth/cssHeight 是贴图对应的标签条 CSS 尺寸。 */
  setStrip(source: HTMLCanvasElement, cssWidth: number, cssHeight: number) {
    const { gl } = this
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    this.stripWidth = cssWidth
    this.stripHeight = cssHeight
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
    gl.uniform1f(u.uRim, frame.rim ?? 0)
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
 * 把容器内各条目的图标与末尾文字按真实布局画进画布（统一用 color 着色），坐标为容器内容区坐标。
 * scale 为贴图相对 CSS 的倍率，透镜放大后仍保持清晰。
 */
export async function rasterizeContent(root: HTMLElement, entries: HTMLElement[], color: string, scale: number) {
  const width = root.scrollWidth
  const height = root.clientHeight
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width * scale)
  canvas.height = Math.ceil(height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const base = root.getBoundingClientRect()
  const ox = base.left + root.clientLeft - root.scrollLeft
  const oy = base.top + root.clientTop
  ctx.scale(scale, scale)
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  const icons: Promise<void>[] = []
  for (const button of entries) {
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
  return { canvas, width, height }
}
