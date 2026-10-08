import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import { startServer } from './index'

it('畸形请求返回 400，服务继续响应并保留 Origin/token 边界', async () => {
  const script = `
    import http from 'node:http'
    import { startServer } from './server/index.ts'
    const server = await startServer({ token: 'test-token', allowLocalhostOrigins: false })
    try {
      const invalid = await new Promise((resolve, reject) => {
        http.get({ hostname: '127.0.0.1', port: server.port, path: '//[', headers: { Origin: 'https://untrusted.example' } }, res => {
          res.resume()
          res.on('end', () => resolve(res.statusCode))
        }).on('error', reject)
      })
      const base = 'http://127.0.0.1:' + server.port
      const healthy = await fetch(base + '/api/app/version?token=test-token')
      const noToken = await fetch(base + '/api/app/version')
      const badOrigin = await fetch(base + '/api/app/version?token=test-token', { headers: { Origin: 'https://untrusted.example' } })
      console.log(JSON.stringify({ invalid, healthy: healthy.status, noToken: noToken.status, badOrigin: badOrigin.status }))
    } finally { server.close() }
  `
  const result = await new Promise<{ code: number | null; output: string; error: string }>((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
      cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    let error = ''
    const timeout = setTimeout(() => child.kill(), 8000)
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { error += chunk })
    child.on('close', (code) => { clearTimeout(timeout); resolve({ code, output, error }) })
  })
  expect(result.error).toBe('')
  expect(result.code).toBe(0)
  expect(JSON.parse(result.output.trim())).toEqual({ invalid: 400, healthy: 200, noToken: 401, badOrigin: 403 })
}, 10000)

/**
 * 回归测试：打包应用(token 生效、allowLocalhostOrigins=false)下,渲染层 file:// 页面
 * 发到 http://127.0.0.1 的 fetch POST 不带 Origin 头(Chromium 对 file:// origin 跨源请求的行为)。
 *
 * 历史上 server/index.ts 曾有一条「POST 必须带 Origin」的守卫,目的是挡掉 curl/原生程序
 * 的写操作。但它排在 token 校验之前,把 file:// 渲染层所有 POST(下载更新、删歌单、漫游生成、
 * 红心…)一律 403 误杀——应用内更新、歌单写操作在打包版里全挂。该守卫已被移除:
 * token 体系本身已能挡掉非渲染层调用(拿不到注入的 token),写操作的 origin 双保险冗余且有害。
 *
 * 这里锁定修复行为:无 Origin 的 POST 不应再因「Forbidden origin」被 403,应穿过安全边界
 * 到达路由分发(token 正确时返回 404 未命中;token 缺失时返回 401——二者都不是 403)。
 */
describe('startServer POST origin 守卫回归测试', () => {
  it('打包模式下,无 Origin 的 POST(带正确 token)穿过安全边界,不再被 403 误杀', async () => {
    const { port, close } = await startServer({
      port: 0,
      token: 'test-token',
      allowLocalhostOrigins: false,
    })
    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/api/__no_such_route__?token=test-token`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
      )
      // 旧守卫会在此处直接 403 'Forbidden origin';修复后放行到路由分发,返回 404。
      expect(res.status).not.toBe(403)
      expect(res.status).toBe(404)
    } finally {
      close()
    }
  })

  it('打包模式下,无 Origin 的 POST 且无 token 仍被 token 守卫挡住(401),不会因删守卫而放行写操作', async () => {
    const { port, close } = await startServer({
      port: 0,
      token: 'test-token',
      allowLocalhostOrigins: false,
    })
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/__no_such_route__`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      expect(res.status).toBe(401)
    } finally {
      close()
    }
  })
})
