/**
 * 按目标显示尺寸向图床请求缩小版图片,替代原图直出:
 * - 网易系图床(*.music.126.net / *.music.127.net)支持 `?param={w}y{h}` 服务端缩图,原图常有 1800×1800,
 *   小头像场景(选歌手画布几十上百个 76px 节点)原图直出会把下载/解码/显存全部拖垮;
 * - QQ photo_new 图床尺寸编码在路径里(`T001R300x300M000{mid}.jpg`),只认固定档位,就近向上取档改写;
 * - 其他来源(本地文件、未知图床)原样返回。
 *
 * `px` 传显示尺寸的 2 倍(Retina),例如 76px 头像传 152。
 */

/**
 * canvas 侧取图(封面粒子纹理 384²、3D 舞台取色 64²、霞光取色 24²)统一用这一档:
 * 三处都经 `/proxy/cover` 拉同一张图,尺寸一致才会命中同一个 URL 只打一次上游 ——
 * 各要各的尺寸会让切歌瞬间对同一封面连发数个请求,网易图床会以 403 限流。
 */
export const CANVAS_COVER_PX = 384

/** QQ photo_new 支持的尺寸档位(就近向上取)。 */
const QQ_SIZES = [90, 150, 300, 500, 800]

/** 统一过滤上游的缺图占位值，避免相对查询串被浏览器解析成当前页面。 */
export function normalizeImageUrl(value: unknown): string {
  if (typeof value !== 'string') return ''
  const raw = value.trim()
  if (!raw) return ''
  const normalized = raw.startsWith('//') ? `https:${raw}` : raw
  try {
    const protocol = new URL(normalized).protocol
    return ['http:', 'https:', 'data:', 'blob:'].includes(protocol) ? normalized : ''
  } catch {
    return ''
  }
}

export function sizedImage(url: string, px: number): string {
  if (!url || px <= 0) return url
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return url
  }
  const host = u.hostname
  if (host.endsWith('.music.126.net') || host.endsWith('.music.127.net')) {
    // 用户歌单封面可能已经带 imageView/thumbnail/watermark 处理链。
    // 这类地址再混入 param 会被网易图床判为非法请求并返回 400，必须保留原链路。
    const hasImageProcessChain = Array.from(u.searchParams.keys()).some((key) => key !== 'param')
    if (hasImageProcessChain) return url
    const size = Math.round(px)
    u.searchParams.set('param', `${size}y${size}`)
    return u.toString()
  }
  if (/\/music\/photo_new\/T\d+R\d+x\d+M/.test(u.pathname)) {
    const size = QQ_SIZES.find((s) => s >= px) ?? QQ_SIZES[QQ_SIZES.length - 1]
    u.pathname = u.pathname.replace(/R\d+x\d+M/, `R${size}x${size}M`)
    return u.toString()
  }
  return url
}
