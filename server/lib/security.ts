/**
 * 本地 API server 的两道边界防护。
 *
 * server 只监听 127.0.0.1,但"本机"也包括用户浏览器里的任意网页 —— 端口虽随机,
 * 从 JS 扫一遍临时端口段是秒级的事。历史上这两处都可被任意网页直接利用:
 *
 * 1. isAllowedOrigin —— 所有响应带 `Access-Control-Allow-Origin: *`,
 *    恶意页面可 fetch `/api/local/scan` 扫全盘、读 `/api/local/tracks` 拿到
 *    音乐文件绝对路径,再经 `/api/local/audio` 把文件流走。跨源 fetch / XHR /
 *    表单 POST 一定带 Origin 头,按来源拒绝即可闭合;`<audio>`/`<img>` 这类
 *    不带 Origin 的加载读不到响应体,放行不构成泄露。
 * 2. isSafeUpstreamUrl —— `/api/audio` 曾原样 fetch 调用方给的 url,
 *    等于一个开放代理:任意网页可借它读用户内网/回环上的服务(SSRF)。
 *
 * 注意:主机名黑名单挡不住 DNS rebinding(域名解析到内网 IP)。彻底修需要在
 * 连接建立后校验对端 IP,代价远高于收益 —— 音频代理的上游只会是音乐平台 CDN,
 * 这里的主机名级拦截已覆盖现实攻击面。
 */

/**
 * 渲染层来源:prod 为 file://(Origin 头是字符串 "null"),dev 为 vite 本地服务。
 *
 * `allowLocalhost` 只在开发时该为 true:放行 localhost 意味着本机跑着的任意其他
 * 网页(别的项目的开发服务器、本地工具的 web 界面,以及它们身上的 XSS)都能读
 * `/api/local/tracks` 拿到音乐文件绝对路径、经 `/api/local/audio` 把文件流走。
 * 打包后的应用渲染层只会是 file://,不需要这个口子。
 */
export function isAllowedOrigin(origin: string | undefined, allowLocalhost = true): boolean {
  // 无 Origin:非浏览器调用(curl / 原生请求)或不跨源的资源加载,读不到跨源响应体
  if (!origin) return true
  if (origin === 'null') return true
  // Chromium 从 file:// 页面发出的带 CORS 的请求(crossOrigin 图片、canvas 取色用的
  // /proxy/cover)带的是 `Origin: file://`,不是规范里的 "null" —— 漏掉它会把渲染层
  // 自己的封面取色/粒子纹理请求 403 掉(表现:霞光与粒子恒为默认紫色)。
  if (origin === 'file://') return true
  if (!allowLocalhost) return false
  try {
    const { protocol, hostname } = new URL(origin)
    if (protocol !== 'http:' && protocol !== 'https:') return false
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
  } catch {
    return false
  }
}

const BLOCKED_HOSTNAMES = new Set(['localhost', '0.0.0.0', '[::]', '::', '[::1]', '::1'])

/** 私有 / 回环 / 链路本地地址,音频与封面的上游 CDN 不会落在这些网段。 */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (BLOCKED_HOSTNAMES.has(host) || BLOCKED_HOSTNAMES.has(hostname.toLowerCase())) return true
  // .local(mDNS)与 .internal 惯例内网域
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) return true
  // IPv6 回环 / 链路本地 / 唯一本地地址
  if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true
  // IPv4-mapped IPv6 按其内嵌的 IPv4 判断。注意 URL 解析器会把 ::ffff:127.0.0.1
  // 归一成十六进制段形式 ::ffff:7f00:1,两种写法都要还原。
  const mappedDotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(host)
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(host)
  const v4 = mappedDotted
    ? mappedDotted[1]
    : mappedHex
      ? (() => {
          const hi = parseInt(mappedHex[1], 16)
          const lo = parseInt(mappedHex[2], 16)
          return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`
        })()
      : host
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v4)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true // 链路本地,含云元数据 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  return false
}

/** 代理上游是否可请求:必须是 http(s),且不指向本机 / 内网。 */
export function isSafeUpstreamUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  return !isPrivateHost(url.hostname)
}
