/**
 * 按目标显示尺寸向图床请求缩小版图片,替代原图直出:
 * - 网易系图床(*.music.126.net / *.music.127.net)支持 `?param={w}y{h}` 服务端缩图,原图常有 1800×1800,
 *   小头像场景(选歌手画布几十上百个 76px 节点)原图直出会把下载/解码/显存全部拖垮;
 * - QQ photo_new 图床尺寸编码在路径里(`T001R300x300M000{mid}.jpg`),只认固定档位,就近向上取档改写;
 * - 其他来源(本地文件、未知图床)原样返回。
 *
 * `px` 传显示尺寸的 2 倍(Retina),例如 76px 头像传 152。
 */

/** QQ photo_new 支持的尺寸档位(就近向上取)。 */
const QQ_SIZES = [90, 150, 300, 500, 800]

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
