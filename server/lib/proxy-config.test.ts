import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_PROXY_SETTINGS,
  ProxyConfigError,
  electronProxyRules,
  nodeProxyAddress,
  readProxySettings,
  validateProxySettings,
  writeProxySettings,
} from './proxy-config'

const ENV_KEYS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'] as const
const saved = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]])) as Record<string, string | undefined>

function clearEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key]
}

let dir = ''
beforeEach(() => {
  clearEnv()
  dir = mkdtempSync(join(tmpdir(), 'sm-proxy-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  clearEnv()
  for (const key of ENV_KEYS) if (saved[key] !== undefined) process.env[key] = saved[key]
})

describe('代理配置', () => {
  it('缺省跟随系统，自定义地址必须是 http(s) 且去掉末尾斜线', () => {
    expect(validateProxySettings({})).toEqual(DEFAULT_PROXY_SETTINGS)
    expect(validateProxySettings({ mode: 'custom', url: ' http://127.0.0.1:7890/ ' })).toEqual({
      mode: 'custom', url: 'http://127.0.0.1:7890', apple: 'inherit', appleUrl: '',
    })
  })

  it('拒绝非法模式与非法地址', () => {
    expect(() => validateProxySettings({ mode: 'proxy' })).toThrow(ProxyConfigError)
    expect(() => validateProxySettings({ apple: 'system' })).toThrow(ProxyConfigError)
    expect(() => validateProxySettings({ mode: 'custom', url: 'socks5://127.0.0.1:7890' })).toThrow(/http/)
    expect(() => validateProxySettings({ mode: 'custom', url: 'http://127.0.0.1:7890/path' })).toThrow(/http/)
    expect(() => validateProxySettings(null)).toThrow(ProxyConfigError)
  })

  it('落盘后可读回，坏文件与半截自定义配置退回默认', () => {
    const settings = { mode: 'custom' as const, url: 'http://127.0.0.1:7890', apple: 'custom' as const, appleUrl: 'http://127.0.0.1:7891' }
    writeProxySettings(dir, settings)
    expect(JSON.parse(readFileSync(join(dir, 'proxy.json'), 'utf8'))).toEqual(settings)
    expect(readProxySettings(dir)).toEqual(settings)

    writeProxySettings(dir, { ...settings, url: '' })
    expect(readProxySettings(dir)).toMatchObject({ mode: 'system', apple: 'custom' })

    writeProxySettings(dir, { ...settings, appleUrl: '' })
    expect(readProxySettings(dir)).toMatchObject({ mode: 'custom', apple: 'inherit' })

    writeProxySettings(dir, { ...settings, url: '', appleUrl: '' })
    expect(readProxySettings(dir)).toMatchObject({ mode: 'system', apple: 'inherit' })
  })

  it('缺失或损坏的配置文件按默认处理', () => {
    expect(readProxySettings(join(dir, 'missing'))).toEqual(DEFAULT_PROXY_SETTINGS)
    writeProxySettings(dir, DEFAULT_PROXY_SETTINGS)
    expect(readProxySettings(dir)).toEqual(DEFAULT_PROXY_SETTINGS)
  })

  it('Electron 规则：自定义代理显式绕过本地地址，Apple 可单独出口', () => {
    expect(electronProxyRules(DEFAULT_PROXY_SETTINGS)).toEqual({ mode: 'system' })
    expect(electronProxyRules({ ...DEFAULT_PROXY_SETTINGS, mode: 'direct' })).toEqual({ mode: 'direct' })
    expect(electronProxyRules({ ...DEFAULT_PROXY_SETTINGS, mode: 'custom', url: 'http://127.0.0.1:7890' })).toEqual({
      mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:7890', proxyBypassRules: 'localhost,127.0.0.1,::1',
    })
    const settings = { mode: 'custom' as const, url: 'http://127.0.0.1:7890', apple: 'direct' as const, appleUrl: '' }
    expect(electronProxyRules(settings, 'apple')).toEqual({ mode: 'direct' })
    expect(electronProxyRules({ ...settings, apple: 'custom', appleUrl: 'http://127.0.0.1:7891' }, 'apple')).toMatchObject({
      mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:7891',
    })
  })

  it('Node 侧：自定义走配置，跟随系统只认环境变量，Apple 可覆盖', () => {
    expect(nodeProxyAddress(DEFAULT_PROXY_SETTINGS)).toBe('')
    process.env.HTTPS_PROXY = 'http://127.0.0.1:8888'
    expect(nodeProxyAddress(DEFAULT_PROXY_SETTINGS)).toBe('http://127.0.0.1:8888')
    expect(nodeProxyAddress({ ...DEFAULT_PROXY_SETTINGS, mode: 'direct' })).toBe('')

    const settings = { mode: 'custom' as const, url: 'http://127.0.0.1:7890', apple: 'direct' as const, appleUrl: '' }
    expect(nodeProxyAddress(settings)).toBe('http://127.0.0.1:7890')
    expect(nodeProxyAddress(settings, 'apple')).toBe('')
    expect(nodeProxyAddress({ ...settings, apple: 'custom', appleUrl: 'http://127.0.0.1:7891' }, 'apple')).toBe('http://127.0.0.1:7891')
  })
})
