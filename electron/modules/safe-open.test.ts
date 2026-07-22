import { describe, it, expect } from 'vitest'
import { isExternallyOpenable } from './safe-open'
import { isInAppUrl } from './window-manager'

describe('isExternallyOpenable', () => {
  it('放行浏览器/邮件协议', () => {
    expect(isExternallyOpenable('https://music.163.com/')).toBe(true)
    expect(isExternallyOpenable('http://y.qq.com/')).toBe(true)
    expect(isExternallyOpenable('mailto:a@b.com')).toBe(true)
  })

  it('拦截能拉起本地程序的协议', () => {
    expect(isExternallyOpenable('file:///Applications/Calculator.app')).toBe(false)
    expect(isExternallyOpenable('ms-msdt:/id')).toBe(false)
    expect(isExternallyOpenable('javascript:alert(1)')).toBe(false)
    expect(isExternallyOpenable('smb://host/share')).toBe(false)
    expect(isExternallyOpenable('不是 url')).toBe(false)
  })
})

describe('isInAppUrl', () => {
  const devEntry = 'http://localhost:5173/index.html'
  const prodEntry = 'file:///Apps/SimpleMusic.app/out/renderer/index.html'

  it('dev:同 origin 视为站内', () => {
    expect(isInAppUrl('http://localhost:5173/index.html', devEntry)).toBe(true)
    expect(isInAppUrl('http://localhost:5173/', devEntry)).toBe(true)
    expect(isInAppUrl('http://localhost:5173/index.html#/library', devEntry)).toBe(true)
    expect(isInAppUrl('https://evil.example/', devEntry)).toBe(false)
  })

  it('prod:限定在 renderer 目录内', () => {
    expect(isInAppUrl('file:///Apps/SimpleMusic.app/out/renderer/index.html', prodEntry)).toBe(true)
    expect(isInAppUrl('file:///Apps/SimpleMusic.app/out/renderer/index.html#/roam', prodEntry)).toBe(true)
    // 越出 renderer 目录读磁盘上的其它文件
    expect(isInAppUrl('file:///etc/passwd', prodEntry)).toBe(false)
    expect(isInAppUrl('file:///Apps/SimpleMusic.app/out/main/index.js', prodEntry)).toBe(false)
    expect(isInAppUrl('https://evil.example/', prodEntry)).toBe(false)
  })
})
