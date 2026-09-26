import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ServerContext } from '../types'
import { appleMusicBridgeState, getAppleMusicBridgeGeneration, revokeAppleMusicBridge } from './apple-music-bridge'

export class AppleMusicError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export interface AppleMusicConfig { developerToken: string; storefront: string }
const users = new Map<string, { token: string; storefront: string }>()
const configPath = (ctx: ServerContext) => join(ctx.userDataDir, 'apple-music.json')

function storefrontValue(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z]{2}$/.test(value)) {
    throw new AppleMusicError(400, 'Apple Music 地区必须为两位小写地区代码')
  }
  return value
}

function developerTokenValue(value: unknown): string {
  if (typeof value !== 'string') throw new AppleMusicError(400, 'Apple Music 开发者令牌格式无效')
  const token = value.trim()
  if (!token) return ''
  if (token.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    throw new AppleMusicError(400, 'Apple Music 开发者令牌必须为 JWT')
  }
  try {
    const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString())
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    if (header.alg !== 'ES256' || typeof payload.exp !== 'number') throw new Error()
    if (payload.exp <= Date.now() / 1000) throw new AppleMusicError(401, 'Apple Music 开发者令牌已过期，请更新配置')
  } catch (error) {
    if (error instanceof AppleMusicError) throw error
    throw new AppleMusicError(400, 'Apple Music 开发者令牌格式无效')
  }
  return token
}

export function getAppleMusicConfig(ctx: ServerContext): AppleMusicConfig {
  let saved: Partial<AppleMusicConfig> = {}
  if (existsSync(configPath(ctx))) {
    try { saved = JSON.parse(readFileSync(configPath(ctx), 'utf8')) } catch {
      throw new AppleMusicError(500, 'Apple Music 配置读取失败，请重新保存配置')
    }
  }
  return {
    developerToken: process.env.SIMPLEMUSIC_APPLE_MUSIC_DEVELOPER_TOKEN?.trim() || saved.developerToken || '',
    storefront: users.get(ctx.userDataDir)?.storefront || saved.storefront || 'cn'
  }
}

export function getValidatedAppleMusicConfig(ctx: ServerContext): AppleMusicConfig {
  const config = getAppleMusicConfig(ctx)
  if (!developerTokenValue(config.developerToken)) throw new AppleMusicError(503, '请先配置 Apple Music 开发者令牌')
  return config
}

export function setAppleMusicConfig(ctx: ServerContext, input: { developerToken?: unknown; storefront?: unknown }): void {
  const developerToken = developerTokenValue(input.developerToken ?? '')
  const storefront = storefrontValue(input.storefront ?? 'cn')
  mkdirSync(ctx.userDataDir, { recursive: true })
  const temporary = `${configPath(ctx)}.tmp`
  writeFileSync(temporary, JSON.stringify({ developerToken, storefront }), { mode: 0o600 })
  chmodSync(temporary, 0o600)
  renameSync(temporary, configPath(ctx))
  clearAppleMusicUserToken(ctx)
}

export function setAppleMusicUserToken(ctx: ServerContext, token: string, storefront?: string): void {
  if (typeof token !== 'string' || !token.trim() || token.length > 16384 || /[\r\n]/.test(token)) {
    throw new AppleMusicError(400, 'Apple Music 用户授权无效，请重新登录')
  }
  users.set(ctx.userDataDir, { token, storefront: storefrontValue(storefront ?? getAppleMusicConfig(ctx).storefront) })
}

export function clearAppleMusicUserToken(ctx: ServerContext): void { users.delete(ctx.userDataDir) }

export function getAppleMusicStatus(ctx: ServerContext) {
  if (ctx.appleMusicWeb && ctx.appleMusicLoginMode !== 'developer') {
    const state = ctx.appleMusicWeb.state()
    return { configured: false, ready: true, managed: false, loginMode: 'web' as const,
      connected: state.connected, loggedIn: state.loggedIn, subscription: state.subscription, storefront: state.storefront }
  }
  const config = getAppleMusicConfig(ctx)
  let valid = false
  try { valid = !!developerTokenValue(config.developerToken) } catch { /* Expose state without leaking credentials or throwing during polling. */ }
  if (!valid) clearAppleMusicUserToken(ctx)
  const bridge = appleMusicBridgeState(ctx)
  return { loginMode: 'developer' as const, configured: !!config.developerToken, ready: valid, managed: !!process.env.SIMPLEMUSIC_APPLE_MUSIC_DEVELOPER_TOKEN?.trim(),
    connected: valid && bridge.connected && bridge.loggedIn, loggedIn: valid && users.has(ctx.userDataDir), subscription: bridge.subscription, storefront: config.storefront }
}

/** Accept only Apple's relative collection/relationship pagination paths, never arbitrary proxy URLs. */
export function appleMusicApiUrl(path: string): URL {
  if (typeof path !== 'string' || path.length > 8192 || !path.startsWith('/v1/') || /[\\#\r\n]/.test(path)) {
    throw new AppleMusicError(400, 'Apple Music 请求路径无效')
  }
  const pathname = path.split('?')[0]
  const catalog = /^\/v1\/catalog\/[a-z]{2}\/(?:search(?:\/suggestions)?|charts|(?:songs|albums|artists|playlists)(?:\/[A-Za-z0-9._-]+(?:\/(?:tracks|albums|songs|artists|playlists|relationships\/(?:tracks|albums|songs|artists|playlists)))?)?)$/
  const artistView = /^\/v1\/catalog\/[a-z]{2}\/artists\/[A-Za-z0-9._-]+\/view\/top-songs$/
  const library = /^\/v1\/me\/library\/(?:songs|albums|artists|playlists)(?:\/[A-Za-z0-9._-]+(?:\/(?:tracks|albums|songs|artists|catalog))?)?$/
  if ((!catalog.test(pathname) && !artistView.test(pathname) && !library.test(pathname)) || pathname.split('/').some(p => p === '.' || p === '..')) {
    throw new AppleMusicError(400, '不支持的 Apple Music 请求路径')
  }
  return new URL(path, 'https://api.music.apple.com')
}

export async function fetchAppleMusic(ctx: ServerContext, path: string): Promise<unknown> {
  const url = appleMusicApiUrl(path)
  if (ctx.appleMusicWeb && ctx.appleMusicLoginMode !== 'developer') {
    try { return await ctx.appleMusicWeb.catalog(path) } catch { throw new AppleMusicError(502, 'Apple Music 官网请求失败，请检查登录状态与网络后重试') }
  }
  const config = getAppleMusicConfig(ctx)
  const developerToken = developerTokenValue(config.developerToken)
  if (!developerToken) throw new AppleMusicError(503, '请先配置 Apple Music 开发者令牌')
  const personalized = url.pathname.startsWith('/v1/me/')
  const user = users.get(ctx.userDataDir)
  const bridgeGeneration = getAppleMusicBridgeGeneration(ctx)
  if (personalized && !user) throw new AppleMusicError(401, '请先登录 Apple Music')
  const headers: Record<string, string> = { Authorization: `Bearer ${developerToken}` }
  if (personalized && user) headers['Music-User-Token'] = user.token
  try {
    const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(15000) })
    if (!response.ok) {
      if ((response.status === 401 || response.status === 403) &&
        getAppleMusicConfig(ctx).developerToken === developerToken && users.get(ctx.userDataDir) === user) {
        clearAppleMusicUserToken(ctx)
        if (getAppleMusicBridgeGeneration(ctx) === bridgeGeneration) revokeAppleMusicBridge(ctx)
      }
      if (response.status === 401) throw new AppleMusicError(401, 'Apple Music 开发者令牌无效或已过期，请更新配置')
      if (response.status === 403) {
        throw new AppleMusicError(403, personalized ? 'Apple Music 用户授权无效或权限不足，请重新登录并检查订阅' : 'Apple Music 开发者令牌权限不足，请检查配置')
      }
      if (response.status === 404) throw new AppleMusicError(404, 'Apple Music 内容不存在或当前地区不可用')
      if (response.status === 429) throw new AppleMusicError(429, 'Apple Music 请求过于频繁，请稍后重试')
      throw new AppleMusicError(502, 'Apple Music 服务暂时不可用，请稍后重试')
    }
    return await response.json()
  } catch (error) {
    if (error instanceof AppleMusicError) throw error
    if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) {
      throw new AppleMusicError(504, 'Apple Music 请求超时，请检查网络后重试')
    }
    throw new AppleMusicError(502, '无法连接 Apple Music，请检查网络后重试')
  }
}
