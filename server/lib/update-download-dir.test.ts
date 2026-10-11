import { afterEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { updateDownloadDir, updateWorkDir } from './update-download-dir'

describe('更新目录环境变量优先级', () => {
  afterEach(() => vi.unstubAllEnvs())

  it.each([
    ['', '', join('/user-data', 'updates'), join('/user-data', 'updates', 'downloads')],
    ['/custom-updates', '', '/custom-updates', join('/custom-updates', 'downloads')],
    ['', '/custom-downloads', join('/user-data', 'updates'), '/custom-downloads'],
    ['/custom-updates', '/custom-downloads', '/custom-updates', '/custom-downloads']
  ])('工作目录 %s、下载目录 %s', (workDir, downloadDir, expectedWorkDir, expectedDownloadDir) => {
    vi.stubEnv('SIMPLEMUSIC_UPDATE_DIR', workDir)
    vi.stubEnv('SIMPLEMUSIC_UPDATE_DOWNLOAD_DIR', downloadDir)

    expect(updateWorkDir('/user-data')).toBe(expectedWorkDir)
    expect(updateDownloadDir('/user-data')).toBe(expectedDownloadDir)
  })
})
