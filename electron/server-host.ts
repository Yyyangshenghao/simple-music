import { app } from 'electron'
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { startServer } from '../server/index'

let handle: { port: number; close(): void } | null = null
let apiToken = ''

/**
 * 读取或生成本机 API 访问 token,持久化在 userData 下。
 *
 * 为何要持久化而非每次启动随机:本地音乐的封面 URL(`/api/local/cover?id=...&token=...`)
 * 会随曲目对象落盘(最近播放 / 漫游 / 歌单;url 落盘时被剥离但 cover 不会)。若 token 每次
 * 变化,重启后这些历史封面会带旧 token 被 401,本地封面成片裂图。持久化后旧 URL 仍然有效。
 * 对真实威胁(浏览器网页扫端口)而言,token 存在磁盘上并无损失 —— 网页读不到 userData。
 */
function loadOrCreateToken(userDataDir: string): string {
  const file = join(userDataDir, 'api-token')
  try {
    const existing = readFileSync(file, 'utf8').trim()
    if (existing) return existing
  } catch {
    /* 首次运行:文件不存在,继续生成 */
  }
  const token = randomBytes(32).toString('hex')
  try {
    mkdirSync(userDataDir, { recursive: true })
    writeFileSync(file, token, { encoding: 'utf8', mode: 0o600 })
  } catch {
    /* 落盘失败(目录不可写等):退化为本会话内存 token,功能仍可用,仅重启后历史封面会裂 */
  }
  return token
}

/** 在主进程内嵌启动 API server,注入 userData 路径与访问 token。返回监听端口与 token。 */
export async function bootServer(): Promise<{ port: number; token: string }> {
  if (handle) return { port: handle.port, token: apiToken }
  const userDataDir = app.getPath('userData')
  apiToken = loadOrCreateToken(userDataDir)
  handle = await startServer({
    userDataDir,
    token: apiToken,
    // 打包后的渲染层是 file://,不需要放行 localhost 来源(见 server/lib/security.ts)
    allowLocalhostOrigins: !app.isPackaged
  })
  return { port: handle.port, token: apiToken }
}

/** 当前会话的 API token(供窗口/悬浮窗注入渲染层)。 */
export function getApiToken(): string {
  return apiToken
}

export function shutdownServer(): void {
  handle?.close()
  handle = null
}
