import { describe, expect, it } from 'vitest'
import { appProcessNames, proxyDnsSnippet, proxyRuleSnippet } from './proxy-rules'

describe('代理软件规则', () => {
  it('Clash 按域名直连，YAML 列表项可直接粘进 rules', () => {
    const text = proxyRuleSnippet('clash', 'apple', 'darwin')
    expect(text.split('\n')[0]).toBe('- DOMAIN-SUFFIX,apple.com,DIRECT')
    expect(text).toContain('- DOMAIN-SUFFIX,mzstatic.com,DIRECT')
  })

  it('Surge 按进程直连，macOS 同时覆盖主进程与 Helper', () => {
    expect(proxyRuleSnippet('surge', 'app', 'darwin')).toBe('PROCESS-NAME,Simple Music,DIRECT\nPROCESS-NAME,Simple Music Helper,DIRECT')
    expect(appProcessNames('win32')).toEqual(['Simple Music.exe'])
  })

  it('sing-box 生成 route 规则对象', () => {
    expect(JSON.parse(proxyRuleSnippet('singbox', 'apple', 'win32'))).toMatchObject({ domain_suffix: expect.arrayContaining(['apple.com']), outbound: 'direct' })
    expect(JSON.parse(proxyRuleSnippet('singbox', 'app', 'win32'))).toEqual({ process_name: ['Simple Music.exe'], outbound: 'direct' })
  })

  it('Apple 域名的国内 DNS 片段按客户端格式生成', () => {
    const clash = proxyDnsSnippet('clash').split('\n')
    expect(clash.slice(0, 2)).toEqual(['dns:', '  nameserver-policy:'])
    expect(clash[2]).toMatch(/^ {4}'\+\.apple\.com,\+\.mzstatic\.com,.*':$/)
    expect(clash[3]).toBe('      - https://doh.pub/dns-query')
    expect(proxyDnsSnippet('surge').split('\n')[0]).toBe('*.apple.com = server:223.5.5.5')
    expect(JSON.parse(proxyDnsSnippet('singbox'))).toMatchObject({ domain_suffix: expect.arrayContaining(['apple.com']), server: 'local' })
  })
})
