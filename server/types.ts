import type { IncomingMessage, ServerResponse } from 'node:http'

export interface ServerContext {
  userDataDir: string
  port: number
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
