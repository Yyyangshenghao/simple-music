import { shell } from 'electron'

/**
 * 交给系统打开外部链接的统一入口。
 *
 * shell.openExternal 会把 URL 丢给操作系统的协议处理器,传入 `file://`、
 * 自定义 scheme(如 `ms-msdt:`)等能触发本地程序启动。窗口里可能出现的
 * 链接并不都可信 —— 登录窗加载的是音乐平台自己的页面,主窗渲染的歌词/
 * 评论/歌手简介也来自上游接口 —— 所以只放行浏览器/邮件这几种无害协议。
 */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

export function isExternallyOpenable(rawUrl: string): boolean {
  try {
    return ALLOWED_PROTOCOLS.has(new URL(rawUrl).protocol)
  } catch {
    return false
  }
}

/** 协议在白名单内才交给系统打开;否则丢弃并记一条日志。 */
export function openExternalSafely(rawUrl: string): void {
  if (!isExternallyOpenable(rawUrl)) {
    console.warn('[safe-open] 已拦截非常规协议的外部打开请求:', rawUrl.slice(0, 120))
    return
  }
  shell.openExternal(rawUrl).catch((e) => console.warn('[safe-open] 打开失败:', (e as Error).message))
}
