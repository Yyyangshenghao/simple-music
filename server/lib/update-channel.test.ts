import { afterEach, describe, expect, it, vi } from 'vitest'

function release(version: string, extra: Record<string, unknown> = {}) {
  const name = `Simple-Music-${version}-Setup.exe`
  return {
    tag_name: `v${version}`,
    name: `Simple Music v${version}`,
    draft: false,
    prerelease: version.includes('-'),
    assets: [
      { name, size: 123, browser_download_url: `https://example.com/${name}` },
      { name: `Simple-Music-${version}-${process.arch}.dmg`, browser_download_url: `https://example.com/${version}.dmg` },
      { name: `Simple-Music-${version}-x86_64.AppImage`, browser_download_url: `https://example.com/${version}.AppImage` }
    ],
    ...extra
  }
}

async function updater(version: string) {
  vi.stubEnv('SIMPLEMUSIC_VERSION', version)
  vi.resetModules()
  const module = await import('./update')
  Object.assign(module.UPDATE_CONFIG, { configured: true, provider: 'github', manifest: '', mirrors: [] })
  return module
}

function fallbackManifest(version: string): string {
  return `version: ${version}
files:
  - url: Simple-Music-${version}-${process.arch}.dmg
    size: 123
  - url: Simple-Music-${version}-x86_64.AppImage
    size: 123
  - url: Simple-Music-${version}-Setup.exe
    size: 123
path: Simple-Music-${version}-Setup.exe
size: 123
`
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('根据当前安装版本选择更新通道', () => {
  it('正式版继续只请求 latest，不接收更高 beta', async () => {
    const update = await updater('2.7.0')
    const fetch = vi.fn(async (_url: string) => Response.json(release('2.8.0-beta.1')))
    vi.stubGlobal('fetch', fetch)
    const info = await update.fetchLatestUpdateInfo()
    expect(fetch.mock.calls[0][0]).toMatch(/\/releases\/latest$/)
    expect(info.updateAvailable).toBe(false)
  })

  it('正式版也拒绝被标成 prerelease 的数字版本', async () => {
    const update = await updater('2.7.0')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(release('2.8.0', { prerelease: true }))))
    expect((await update.fetchLatestUpdateInfo()).updateAvailable).toBe(false)
  })

  it('beta 从发布列表按版本取最高项，保留 beta 后缀与下载地址', async () => {
    const update = await updater('2.7.0-beta.1')
    const fetch = vi.fn(async (_url: string) => Response.json([
      release('2.7.0-beta.2'), release('2.7.0-beta.10'), release('2.6.2'),
      release('9.0.0-beta.1', { draft: true }), release('not-a-version')
    ]))
    vi.stubGlobal('fetch', fetch)
    const info = await update.fetchLatestUpdateInfo()
    expect(fetch.mock.calls[0][0]).toMatch(/\/releases\?per_page=100$/)
    expect(info).toMatchObject({ updateAvailable: true, latestVersion: '2.7.0-beta.10' })
    expect(info.release.version).toBe('2.7.0-beta.10')
    expect(info.release.asset?.downloadUrl).toContain('2.7.0-beta.10')
  })

  it.each([
    ['2.7.0-beta.2', ['2.7.0-beta.2', '2.6.2'], false, '2.7.0-beta.2'],
    ['2.7.0-beta.2', ['2.7.0-beta.1'], false, '2.7.0-beta.2'],
    ['2.7.0-beta.2', ['2.7.0', '2.7.0-beta.10'], true, '2.7.0'],
    ['2.7.0-beta.2', ['2.8.0-beta.1', '2.7.0'], true, '2.8.0-beta.1'],
    ['2.7.0-rc.1', ['2.7.0-beta.10', '2.7.0-rc.2'], true, '2.7.0-rc.2']
  ] as const)('%s 不降级，正式版高于同号预发版', async (current, versions, available, latest) => {
    const update = await updater(current)
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(versions.map(version => release(version)))))
    expect(await update.fetchLatestUpdateInfo()).toMatchObject({ updateAvailable: available, latestVersion: latest })
  })

  it('beta API 失败时仍可通过正式版备用清单升级', async () => {
    const update = await updater('2.7.0-beta.2')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.startsWith('https://api.github.com/')
      ? new Response('', { status: 403 })
      : new Response(fallbackManifest('2.7.0'))))
    expect(await update.fetchLatestUpdateInfo()).toMatchObject({ updateAvailable: true, latestVersion: '2.7.0', source: 'latest-yml' })
  })

  it('正式版不能被备用清单导向 beta，beta 下载 tag 也不得丢失后缀', async () => {
    const update = await updater('2.7.0')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.startsWith('https://api.github.com/')
      ? new Response('', { status: 403 })
      : new Response(fallbackManifest('2.8.0-beta.2'))))
    const info = await update.fetchLatestUpdateInfo()
    expect(info.updateAvailable).toBe(false)
    expect(info.latestVersion).toBe('2.8.0-beta.2')
    expect(info.release.downloadUrl).toContain('/v2.8.0-beta.2/')
  })

  it.each([
    ['2.7.0', '2.8.0-beta.1', false],
    ['2.7.0-beta.1', '2.7.0-beta.2', true],
    ['2.7.0-beta.2', '2.7.0-beta.1', false],
    ['2.7.0-beta.1', '2.7.0', true]
  ])('自定义清单也执行通道规则：%s → %s', async (current, candidate, available) => {
    const update = await updater(current)
    update.UPDATE_CONFIG.manifest = 'https://example.com/test-update.json'
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ version: candidate, updateAvailable: true, downloadUrl: 'https://example.com/Setup.exe' })))
    expect(await update.fetchLatestUpdateInfo()).toMatchObject({ updateAvailable: available, latestVersion: candidate })
  })
})
