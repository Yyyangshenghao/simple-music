import { describe, it, expect } from 'vitest'
import { isAllowedOrigin, isAllowedToken, isSafeUpstreamUrl } from './security'

describe('isAllowedOrigin', () => {
  it('放行渲染层来源', () => {
    // prod 是 file://,浏览器把 Origin 序列化成字符串 "null"
    expect(isAllowedOrigin('null')).toBe(true)
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true)
    expect(isAllowedOrigin('http://127.0.0.1:35530')).toBe(true)
    // Chromium 对 file:// 页面发出的 CORS 请求给的是 "file://" 而不是 "null"
    expect(isAllowedOrigin('file://')).toBe(true)
    expect(isAllowedOrigin('file://', false)).toBe(true)
  })

  it('无 Origin 头放行(非浏览器调用 / 不跨源加载)', () => {
    expect(isAllowedOrigin(undefined)).toBe(true)
    expect(isAllowedOrigin('')).toBe(true)
  })

  it('拒绝外部网页来源', () => {
    expect(isAllowedOrigin('https://evil.example')).toBe(false)
    expect(isAllowedOrigin('http://evil.example:5173')).toBe(false)
    // 前缀混淆:localhost.evil.com 不是 localhost
    expect(isAllowedOrigin('http://localhost.evil.example')).toBe(false)
    expect(isAllowedOrigin('not-a-url')).toBe(false)
  })

  it('严格模式(打包应用)只认 file:// 的 null,本机其他网页一律拒绝', () => {
    expect(isAllowedOrigin('null', false)).toBe(true)
    expect(isAllowedOrigin(undefined, false)).toBe(true)
    expect(isAllowedOrigin('http://localhost:5173', false)).toBe(false)
    expect(isAllowedOrigin('http://127.0.0.1:3000', false)).toBe(false)
  })
})

describe('isAllowedToken', () => {
  const TOKEN = 'a'.repeat(64)

  it('未配置 expected 时一律放行(独立 server / dev / 测试)', () => {
    expect(isAllowedToken(undefined, undefined)).toBe(true)
    expect(isAllowedToken(undefined, 'whatever')).toBe(true)
    expect(isAllowedToken('', 'whatever')).toBe(true)
  })

  it('token 完全一致才放行', () => {
    expect(isAllowedToken(TOKEN, TOKEN)).toBe(true)
  })

  it('拒绝缺失 / 错误 / 长度不符的 token', () => {
    expect(isAllowedToken(TOKEN, undefined)).toBe(false)
    expect(isAllowedToken(TOKEN, null)).toBe(false)
    expect(isAllowedToken(TOKEN, '')).toBe(false)
    expect(isAllowedToken(TOKEN, 'b'.repeat(64))).toBe(false)
    // 长度不同不会抛错(timingSafeEqual 要求等长,已先行拦掉)
    expect(isAllowedToken(TOKEN, TOKEN.slice(0, 32))).toBe(false)
    expect(isAllowedToken(TOKEN, TOKEN + 'x')).toBe(false)
  })
})

describe('isSafeUpstreamUrl', () => {
  it('放行公网 http(s) 上游', () => {
    expect(isSafeUpstreamUrl('https://m8c.music.126.net/x.mp3')).toBe(true)
    expect(isSafeUpstreamUrl('http://isure.stream.qqmusic.qq.com/x.m4a')).toBe(true)
  })

  it('拒绝回环与内网(SSRF)', () => {
    expect(isSafeUpstreamUrl('http://127.0.0.1:45123/secret.txt')).toBe(false)
    expect(isSafeUpstreamUrl('http://localhost:8080/')).toBe(false)
    expect(isSafeUpstreamUrl('http://[::1]:8080/')).toBe(false)
    expect(isSafeUpstreamUrl('http://192.168.1.1/')).toBe(false)
    expect(isSafeUpstreamUrl('http://10.0.0.5/')).toBe(false)
    expect(isSafeUpstreamUrl('http://172.16.0.1/')).toBe(false)
    expect(isSafeUpstreamUrl('http://172.32.0.1/')).toBe(true) // 172.32 不在私有段内
    expect(isSafeUpstreamUrl('http://169.254.169.254/latest/meta-data/')).toBe(false)
    expect(isSafeUpstreamUrl('http://0.0.0.0:3000/')).toBe(false)
    expect(isSafeUpstreamUrl('http://nas.local/')).toBe(false)
    expect(isSafeUpstreamUrl('http://[::ffff:127.0.0.1]/')).toBe(false)
  })

  it('拒绝非 http(s) 协议', () => {
    expect(isSafeUpstreamUrl('file:///etc/passwd')).toBe(false)
    expect(isSafeUpstreamUrl('ftp://example.com/x')).toBe(false)
    expect(isSafeUpstreamUrl('')).toBe(false)
  })
})
