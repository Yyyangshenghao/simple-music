import { describe, it, expect } from 'vitest'
import { startServer } from './index'

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
