import { app } from 'electron'
import { startServer } from '../server/index'

let handle: { port: number; close(): void } | null = null

/** 在主进程内嵌启动 API server，注入 userData 路径。返回监听端口。 */
export async function bootServer(): Promise<number> {
  if (handle) return handle.port
  handle = await startServer({ userDataDir: app.getPath('userData') })
  return handle.port
}

export function shutdownServer(): void {
  handle?.close()
  handle = null
}
