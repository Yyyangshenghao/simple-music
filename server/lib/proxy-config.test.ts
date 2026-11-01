import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_PROXY_SETTINGS,
  ProxyConfigError,
  electronProxyRules,
  nodeProxyAddress,
  normalizeProxyAddress,
  parsePacResult,
  proxyCredentials,
  readProxySettings,
  validateProxySettings,
  writeProxySettings,
} from './proxy-config'

const ENV_KEYS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'] as const
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

describe('代理地址规范化', () => {
  it('补全协议与端口、统一 socks 写法、去掉末尾斜线', () => {
    expect(normalizeProxyAddress(' 127.0.0.1:7890/ ')).toBe('http://127.0.0.1:7890')
    expect(normalizeProxyAddress('HTTP://Proxy.Example.com')).toBe('http://proxy.example.com:80')
    expect(normalizeProxyAddress('https://proxy.example.com')).toBe('https://proxy.example.com:443')
    expect(normalizeProxyAddress('socks://127.0.0.1:7891')).toBe('socks5://127.0.0.1:7891')
    expect(normalizeProxyAddress('socks5h://127.0.0.1:7891')).toBe('socks5://127.0.0.1:7891')
    expect(normalizeProxyAddress('http://user:p%40ss@127.0.0.1:8080')).toBe('http://user:p%40ss@127.0.0.1:8080')
    expect(normalizeProxyAddress('[::1]:7890')).toBe('http://[::1]:7890')
    expect(normalizeProxyAddress('')).toBe('')
  })

  it('拒绝不支持的协议、路径与带认证的 SOCKS5', () => {
    expect(() => normalizeProxyAddress('ftp://127.0.0.1:21')).toThrow(/只支持/)
    expect(() => normalizeProxyAddress('http://127.0.0.1:7890/path')).toThrow(/格式无效/)
    expect(() => normalizeProxyAddress('http://127.0.0.1:7890?x=1')).toThrow(/格式无效/)
    expect(() => normalizeProxyAddress('http://127.0.0.1:99999')).toThrow(ProxyConfigError)
    expect(() => normalizeProxyAddress('socks5://u:p@127.0.0.1:1080')).toThrow(/SOCKS5/)
    expect(() => normalizeProxyAddress(42)).toThrow(ProxyConfigError)
  })
})

describe('代理配置', () => {
  it('缺省跟随系统，自定义地址被规范化', () => {
    expect(validateProxySettings({})).toEqual(DEFAULT_PROXY_SETTINGS)
    expect(validateProxySettings({ mode: 'custom', url: ' 127.0.0.1:7890/ ' })).toEqual({
      mode: 'custom', url: 'http://127.0.0.1:7890', apple: 'inherit', appleUrl: '',
    })
  })

  it('拒绝非法模式，自定义却没填地址时直接报错', () => {
    expect(() => validateProxySettings({ mode: 'proxy' })).toThrow(ProxyConfigError)
    expect(() => validateProxySettings({ apple: 'system' })).toThrow(ProxyConfigError)
    expect(() => validateProxySettings({ mode: 'custom', url: '' })).toThrow(/请填写代理地址/)
    expect(() => validateProxySettings({ apple: 'custom', appleUrl: ' ' })).toThrow(/Apple Music/)
    expect(() => validateProxySettings(null)).toThrow(ProxyConfigError)
  })

  it('落盘后可读回；旧版半截配置按跟随读出', () => {
    const settings = { mode: 'custom' as const, url: 'http://127.0.0.1:7890', apple: 'custom' as const, appleUrl: 'socks5://127.0.0.1:7891' }
    writeProxySettings(dir, settings)
    expect(JSON.parse(readFileSync(join(dir, 'proxy.json'), 'utf8'))).toEqual(settings)
    expect(readProxySettings(dir)).toEqual(settings)

    writeProxySettings(dir, { ...settings, url: '' })
    expect(readProxySettings(dir)).toMatchObject({ mode: 'system', apple: 'custom' })
    writeProxySettings(dir, { ...settings, appleUrl: '' })
    expect(readProxySettings(dir)).toMatchObject({ mode: 'custom', apple: 'inherit' })
  })

  it('缺失、损坏或非法的配置文件按默认处理', () => {
    expect(readProxySettings(join(dir, 'missing'))).toEqual(DEFAULT_PROXY_SETTINGS)
    writeFileSync(join(dir, 'proxy.json'), '{bad')
    expect(readProxySettings(dir)).toEqual(DEFAULT_PROXY_SETTINGS)
    writeFileSync(join(dir, 'proxy.json'), JSON.stringify({ mode: 'custom', url: 'ftp://x' }))
    expect(readProxySettings(dir)).toEqual(DEFAULT_PROXY_SETTINGS)
  })
})

describe('出口规则', () => {
  it('Electron：自定义代理去掉账号密码并绕过本地地址，Apple 可单独出口', () => {
    expect(electronProxyRules(DEFAULT_PROXY_SETTINGS)).toEqual({ mode: 'system' })
    expect(electronProxyRules({ ...DEFAULT_PROXY_SETTINGS, mode: 'direct' })).toEqual({ mode: 'direct' })
    expect(electronProxyRules({ ...DEFAULT_PROXY_SETTINGS, mode: 'custom', url: 'http://u:p@127.0.0.1:7890' })).toEqual({
      mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:7890', proxyBypassRules: 'localhost,127.0.0.1,::1,<local>',
    })
    const settings = { mode: 'custom' as const, url: 'http://127.0.0.1:7890', apple: 'direct' as const, appleUrl: '' }
    expect(electronProxyRules(settings, 'apple')).toEqual({ mode: 'direct' })
    expect(electronProxyRules({ ...settings, apple: 'custom', appleUrl: 'socks5://127.0.0.1:7891' }, 'apple')).toMatchObject({
      mode: 'fixed_servers', proxyRules: 'socks5://127.0.0.1:7891',
    })
    expect(electronProxyRules({ ...settings, apple: 'inherit' }, 'apple')).toMatchObject({ proxyRules: 'http://127.0.0.1:7890' })
  })

  it('Node：跟随系统用宿主给的系统代理，缺省读环境变量；Apple 可覆盖', () => {
    expect(nodeProxyAddress(DEFAULT_PROXY_SETTINGS)).toBe('')
    process.env.HTTPS_PROXY = '127.0.0.1:8888'
    expect(nodeProxyAddress(DEFAULT_PROXY_SETTINGS)).toBe('http://127.0.0.1:8888')
    expect(nodeProxyAddress(DEFAULT_PROXY_SETTINGS, 'default', 'socks5://127.0.0.1:7891')).toBe('socks5://127.0.0.1:7891')
    expect(nodeProxyAddress({ ...DEFAULT_PROXY_SETTINGS, mode: 'direct' }, 'default', 'http://x:1')).toBe('')

    const settings = { mode: 'custom' as const, url: 'http://127.0.0.1:7890', apple: 'direct' as const, appleUrl: '' }
    expect(nodeProxyAddress(settings)).toBe('http://127.0.0.1:7890')
    expect(nodeProxyAddress(settings, 'apple')).toBe('')
    expect(nodeProxyAddress({ ...settings, apple: 'custom', appleUrl: 'http://127.0.0.1:7891' }, 'apple')).toBe('http://127.0.0.1:7891')
    expect(nodeProxyAddress({ ...settings, mode: 'system', apple: 'inherit' }, 'apple', 'http://127.0.0.1:1')).toBe('http://127.0.0.1:1')
  })

  it('解析 Chromium 的 PAC 结果', () => {
    expect(parsePacResult('DIRECT')).toBe('')
    expect(parsePacResult('PROXY 127.0.0.1:7890; DIRECT')).toBe('http://127.0.0.1:7890')
    expect(parsePacResult('HTTPS proxy.example.com:443')).toBe('https://proxy.example.com:443')
    expect(parsePacResult('SOCKS5 127.0.0.1:7891')).toBe('socks5://127.0.0.1:7891')
    expect(parsePacResult('QUIC x:1; PROXY 10.0.0.1:3128')).toBe('http://10.0.0.1:3128')
    expect(parsePacResult('')).toBe('')
  })

  it('取代理账号密码用于 Chromium 认证', () => {
    expect(proxyCredentials('http://u%20x:p%40@127.0.0.1:8080')).toEqual({ host: '127.0.0.1', port: 8080, username: 'u x', password: 'p@' })
    expect(proxyCredentials('http://127.0.0.1:8080')).toBeNull()
  })
})
