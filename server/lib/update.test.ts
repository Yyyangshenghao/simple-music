import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  pickReleaseAsset,
  reorderCandidatesBySpeed,
  startUpdateDownloadJob,
  updateDownloadJobs,
  verifyUpdateFile,
  UPDATE_CONFIG,
  type DownloadCandidate,
  type UpdateInfo,
} from './update'

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
    { name: 'Simple Music-1.0.1-Setup.exe', browser_download_url: 'https://example.com/Simple Music-1.0.1-Setup.exe' },
    {
      name: 'Simple Music-1.0.1-portable.exe',
      browser_download_url: 'https://example.com/Simple Music-1.0.1-portable.exe',
    },
    { name: 'Simple Music-1.0.1-arm64.dmg', browser_download_url: 'https://example.com/Simple Music-1.0.1-arm64.dmg' },
    { name: 'Simple Music-1.0.1-x64.dmg', browser_download_url: 'https://example.com/Simple Music-1.0.1-x64.dmg' },
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
    expect(picked?.name).toBe('Simple Music-1.0.1-arm64.dmg')
  })

  it('mac / x64：应选中 x64 的 dmg', () => {
    const picked = withPlatform('darwin', 'x64', () => pickReleaseAsset(releaseAssets()))
    expect(picked?.name).toBe('Simple Music-1.0.1-x64.dmg')
  })

  it('mac：release 里没有匹配当前芯片的 dmg 时，回退到任意 dmg，而不是 exe', () => {
    const assets = releaseAssets().filter((a) => a.name !== 'Simple Music-1.0.1-arm64.dmg')
    const picked = withPlatform('darwin', 'arm64', () => pickReleaseAsset(assets))
    expect(picked?.name).toBe('Simple Music-1.0.1-x64.dmg')
  })

  it('mac：release 里完全没有 dmg（比如漏传）时返回 null，而不是静默发一个 windows 安装包过去', () => {
    const assets = releaseAssets().filter((a) => !a.name.endsWith('.dmg'))
    const picked = withPlatform('darwin', 'arm64', () => pickReleaseAsset(assets))
    expect(picked).toBeNull()
  })

  it('windows：应选中 NSIS 安装包 Setup.exe，而不是便携版或 dmg', () => {
    const picked = withPlatform('win32', 'x64', () => pickReleaseAsset(releaseAssets()))
    expect(picked?.name).toBe('Simple Music-1.0.1-Setup.exe')
  })

  it('windows：release 里只有便携版时回退到便携版', () => {
    const assets = releaseAssets().filter((a) => a.name !== 'Simple Music-1.0.1-Setup.exe')
    const picked = withPlatform('win32', 'x64', () => pickReleaseAsset(assets))
    expect(picked?.name).toBe('Simple Music-1.0.1-portable.exe')
  })
})

/** 用可控延迟的假 Response 模拟“镜像响应快/慢/连不上”，验证测速排序按耗时重排、
 *  全部失败时原样兜底给下载阶段的“失败即切换下一条”逻辑，不会因为测速本身出错而卡住。 */
function fakeRangeResponse(delayMs: number): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      setTimeout(() => {
        controller.enqueue(new Uint8Array(8))
        controller.close()
      }, delayMs)
    },
  })
  return new Response(body, { status: 206, statusText: 'Partial Content' })
}

describe('reorderCandidatesBySpeed（下载前测速选线）', () => {
  const candidates: DownloadCandidate[] = [
    { url: 'https://slow.example/asset.exe', label: '慢线路', mirrored: true },
    { url: 'https://fast.example/asset.exe', label: '快线路', mirrored: true },
    { url: 'https://dead.example/asset.exe', label: '断线路', mirrored: true },
  ]

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('把响应更快的线路排到前面', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('slow')) return fakeRangeResponse(120)
        if (url.includes('fast')) return fakeRangeResponse(5)
        throw new Error('network fail')
      })
    )
    const ordered = await reorderCandidatesBySpeed(candidates, 2000)
    expect(ordered.map((c) => c.label)).toEqual(['快线路', '慢线路', '断线路'])
  })

  it('全部线路都测速失败时，原样返回原始顺序', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network fail')
      })
    )
    const ordered = await reorderCandidatesBySpeed(candidates, 2000)
    expect(ordered).toEqual(candidates)
  })

  it('只有一条候选线路时直接跳过测速，不发请求', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const single: DownloadCandidate[] = [{ url: 'https://only.example/asset.exe', label: '唯一线路', mirrored: false }]
    const ordered = await reorderCandidatesBySpeed(single, 2000)
    expect(ordered).toBe(single)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('更新包流式校验与缓存复用', () => {
  const bytes = Buffer.alloc(192 * 1024 + 17, 'installer data')
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
  const sha512 = crypto.createHash('sha512').update(bytes).digest()
  let dir: string
  let filePath: string
  let originalMirrors: string[]

  function verification(overrides = {}) {
    return { expectedSize: bytes.length, total: 0, sha256, sha512: sha512.toString('base64'), ...overrides }
  }

  function updateInfo(): UpdateInfo {
    const downloadUrl = 'https://example.com/installer.exe'
    return {
      configured: true,
      preview: false,
      updateAvailable: true,
      currentVersion: '1.0.0',
      latestVersion: '2.0.0',
      release: {
        tagName: 'v2.0.0',
        name: '2.0.0',
        version: '2.0.0',
        htmlUrl: 'https://example.com/release',
        downloadUrl,
        summary: '',
        notes: [],
        asset: {
          name: 'installer.exe',
          size: bytes.length,
          contentType: 'application/octet-stream',
          downloadUrl,
          downloadUrls: [],
          sha256,
          sha512: sha512.toString('base64'),
        },
      },
    }
  }

  beforeEach(async () => {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'simplemusic-update-test-'))
    const downloadDir = path.join(dir, 'updates', 'downloads')
    await fs.promises.mkdir(downloadDir, { recursive: true })
    filePath = path.join(downloadDir, 'installer.exe')
    await fs.promises.writeFile(filePath, bytes)
    originalMirrors = UPDATE_CONFIG.mirrors
    UPDATE_CONFIG.mirrors = []
    updateDownloadJobs.clear()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    UPDATE_CONFIG.mirrors = originalMirrors
    updateDownloadJobs.clear()
    await fs.promises.rm(dir, { recursive: true, force: true })
  })

  it('多块文件一次读取，同时校验 SHA256 和 base64 SHA512', async () => {
    const read = vi.spyOn(fs, 'createReadStream')
    const synchronousRead = vi.spyOn(fs, 'readFileSync')
    await expect(verifyUpdateFile(filePath, verification())).resolves.toBeUndefined()
    expect(read).toHaveBeenCalledTimes(1)
    expect(synchronousRead).not.toHaveBeenCalled()
  })

  it('保留 digest 前缀、大小写 hex SHA256/SHA512 的兼容性', async () => {
    await expect(verifyUpdateFile(filePath, verification({
      sha256: 'sha256:' + sha256.toUpperCase(),
      sha512: 'SHA512:' + sha512.toString('hex').toUpperCase(),
    }))).resolves.toBeUndefined()
  })

  it('仅有 SHA512 或长度时保持独立校验', async () => {
    await expect(verifyUpdateFile(filePath, verification({ sha256: '' }))).resolves.toBeUndefined()
    await expect(verifyUpdateFile(filePath, verification({ sha256: '', sha512: '' }))).resolves.toBeUndefined()
    await expect(verifyUpdateFile(filePath, verification({ sha256: '', sha512: 'invalid' })))
      .rejects.toMatchObject({ code: 'UPDATE_SHA512_MISMATCH' })
  })

  it('长度不符优先于两种摘要错误，并保留错误详情', async () => {
    await expect(verifyUpdateFile(filePath, verification({
      expectedSize: bytes.length + 1,
      sha256: 'invalid',
      sha512: 'invalid',
    }))).rejects.toMatchObject({
      code: 'UPDATE_SIZE_MISMATCH',
      message: `Expected ${bytes.length + 1} bytes, got ${bytes.length}`,
    })
  })

  it('缺少 expectedSize 时仍按 total 校验长度', async () => {
    await expect(verifyUpdateFile(filePath, verification({
      expectedSize: 0,
      total: bytes.length + 1,
    }))).rejects.toMatchObject({ code: 'UPDATE_SIZE_MISMATCH' })
  })

  it('长度正确时 SHA256 错误优先于 SHA512 错误', async () => {
    await expect(verifyUpdateFile(filePath, verification({
      sha256: 'invalid',
      sha512: 'invalid',
    }))).rejects.toMatchObject({ code: 'UPDATE_SHA256_MISMATCH', message: 'Downloaded sha256 mismatch' })
  })

  it('SHA256 正确时仍拒绝错误 SHA512', async () => {
    await expect(verifyUpdateFile(filePath, verification({ sha512: 'invalid' })))
      .rejects.toMatchObject({ code: 'UPDATE_SHA512_MISMATCH', message: 'Downloaded sha512 mismatch' })
  })

  it('文件读取错误向调用方传播', async () => {
    await expect(verifyUpdateFile(path.join(dir, 'missing.exe'), verification()))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('并发请求只校验一次缓存并复用同一 ready 任务，不下载', async () => {
    const read = vi.spyOn(fs, 'createReadStream')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const ctx = { userDataDir: dir, port: 35530 }
    const jobs = await Promise.all(Array.from({ length: 8 }, () => startUpdateDownloadJob(updateInfo(), ctx)))
    expect(jobs[0]).toMatchObject({ ok: true, status: 'ready', cached: true, filePath, received: bytes.length })
    for (const job of jobs) expect(job).toEqual(jobs[0])
    expect(read).toHaveBeenCalledTimes(1)
    expect(updateDownloadJobs.size).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await startUpdateDownloadJob(updateInfo(), ctx)).toEqual(jobs[0])
    expect(read).toHaveBeenCalledTimes(1)
  })

  it.each(['摘要', '长度'])('失效缓存（%s）移出后，并发请求只下载一次并校验新文件', async (reason) => {
    await fs.promises.writeFile(filePath, reason === '摘要' ? Buffer.alloc(bytes.length) : bytes.subarray(0, 1024))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchMock = vi.fn(async () => new Response(bytes, {
      headers: { 'content-length': String(bytes.length) },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = { userDataDir: dir, port: 35530 }
    const jobs = await Promise.all(Array.from({ length: 8 }, () => startUpdateDownloadJob(updateInfo(), ctx)))
    for (const job of jobs) expect(job).toEqual(jobs[0])
    expect(updateDownloadJobs.size).toBe(1)
    await vi.waitFor(() => {
      expect(Array.from(updateDownloadJobs.values())[0]?.status).toBe('ready')
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(await fs.promises.readFile(filePath)).toEqual(bytes)
    expect((await fs.promises.readdir(path.dirname(filePath))).filter((name) => name.includes('.invalid-')))
      .toHaveLength(1)
  })

  it('下载流结束后仍等待摘要校验，错误安装包不进入 ready', async () => {
    await fs.promises.unlink(filePath)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.alloc(bytes.length), {
      headers: { 'content-length': String(bytes.length) },
    })))
    await startUpdateDownloadJob(updateInfo(), { userDataDir: dir, port: 35530 })
    await vi.waitFor(() => {
      expect(Array.from(updateDownloadJobs.values())[0]).toMatchObject({
        status: 'error',
        error: 'UPDATE_SHA256_MISMATCH',
      })
    })
    expect(fs.existsSync(filePath)).toBe(false)
    expect(fs.existsSync(filePath + '.download')).toBe(false)
  })
})
