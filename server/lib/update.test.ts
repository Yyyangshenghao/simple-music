import { describe, it, expect, afterEach } from 'vitest'
import { pickReleaseAsset } from './update'

function withPlatform<T>(platform: NodeJS.Platform, arch: NodeJS.Architecture, fn: () => T): T {
  const originalPlatform = process.platform
  const originalArch = process.arch
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  Object.defineProperty(process, 'arch', { value: arch, configurable: true })
  try {
    return fn()
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    Object.defineProperty(process, 'arch', { value: originalArch, configurable: true })
  }
}

/** 贴近真实 release.yml 产出的资源列表：win 两个 exe（安装包+便携版），mac 两个 dmg（两种芯片）。
 *  故意把 exe 排在数组最前面 —— 这正是修复前的 bug 复现条件：旧实现按“先找 exe”的固定顺序选，
 *  跟当前机器是什么平台完全无关。 */
function releaseAssets() {
  return [
    { name: 'SimpleMusic-1.0.1-Setup.exe', browser_download_url: 'https://example.com/SimpleMusic-1.0.1-Setup.exe' },
    {
      name: 'SimpleMusic-1.0.1-portable.exe',
      browser_download_url: 'https://example.com/SimpleMusic-1.0.1-portable.exe',
    },
    { name: 'SimpleMusic-1.0.1-arm64.dmg', browser_download_url: 'https://example.com/SimpleMusic-1.0.1-arm64.dmg' },
    { name: 'SimpleMusic-1.0.1-x64.dmg', browser_download_url: 'https://example.com/SimpleMusic-1.0.1-x64.dmg' },
    { name: 'latest-mac.yml', browser_download_url: 'https://example.com/latest-mac.yml' },
    { name: 'latest.yml', browser_download_url: 'https://example.com/latest.yml' },
  ]
}

describe('pickReleaseAsset（更新检测按平台选资源 —— 回归 mac 拿到 windows exe 的 bug）', () => {
  afterEach(() => {
    // withPlatform 自己会还原，这里仅兜底
  })

  it('mac / arm64：应选中 arm64 的 dmg，而不是排在数组最前面的 windows exe', () => {
    const picked = withPlatform('darwin', 'arm64', () => pickReleaseAsset(releaseAssets()))
    expect(picked?.name).toBe('SimpleMusic-1.0.1-arm64.dmg')
  })

  it('mac / x64：应选中 x64 的 dmg', () => {
    const picked = withPlatform('darwin', 'x64', () => pickReleaseAsset(releaseAssets()))
    expect(picked?.name).toBe('SimpleMusic-1.0.1-x64.dmg')
  })

  it('mac：release 里没有匹配当前芯片的 dmg 时，回退到任意 dmg，而不是 exe', () => {
    const assets = releaseAssets().filter((a) => a.name !== 'SimpleMusic-1.0.1-arm64.dmg')
    const picked = withPlatform('darwin', 'arm64', () => pickReleaseAsset(assets))
    expect(picked?.name).toBe('SimpleMusic-1.0.1-x64.dmg')
  })

  it('mac：release 里完全没有 dmg（比如漏传）时返回 null，而不是静默发一个 windows 安装包过去', () => {
    const assets = releaseAssets().filter((a) => !a.name.endsWith('.dmg'))
    const picked = withPlatform('darwin', 'arm64', () => pickReleaseAsset(assets))
    expect(picked).toBeNull()
  })

  it('windows：应选中 NSIS 安装包 Setup.exe，而不是便携版或 dmg', () => {
    const picked = withPlatform('win32', 'x64', () => pickReleaseAsset(releaseAssets()))
    expect(picked?.name).toBe('SimpleMusic-1.0.1-Setup.exe')
  })

  it('windows：release 里只有便携版时回退到便携版', () => {
    const assets = releaseAssets().filter((a) => a.name !== 'SimpleMusic-1.0.1-Setup.exe')
    const picked = withPlatform('win32', 'x64', () => pickReleaseAsset(assets))
    expect(picked?.name).toBe('SimpleMusic-1.0.1-portable.exe')
  })
})
