import { describe, expect, it } from 'vitest'
import { appProcessNames, proxyRuleSnippet } from './proxy-rules'

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
})
