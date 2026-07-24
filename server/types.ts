import type { IncomingMessage, ServerResponse } from 'node:http'

export interface ServerContext {
  userDataDir: string
  port: number
  /** 是否放行 http://localhost 来源(仅开发需要;打包应用只认 file:// 的 "null")。缺省视为放行。 */
  allowLocalhostOrigins?: boolean
}

/**
 * 路由处理器。返回 true 表示已处理（终止匹配链），false 表示未命中继续匹配。
 */
export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: ServerContext
) => Promise<boolean>

export interface OkResult {
  ok: boolean
  message?: string
}
