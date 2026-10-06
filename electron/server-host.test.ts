import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const h = vi.hoisted(() => ({ getPath: vi.fn(), start: vi.fn(), restore: vi.fn(), close: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: h.getPath, isPackaged: true } }))
vi.mock('../server/index', () => ({ startServer: h.start }))
vi.mock('./modules/window-manager', () => ({ getMainWindow: () => null }))
vi.mock('./modules/apple-music-web-session', () => ({
  OfficialAppleMusicSession: class {
    restore = h.restore
    close = h.close
  },
}))
import { bootServer, shutdownServer } from './server-host'

let userDataDir: string
beforeEach(async () => {
  vi.clearAllMocks()
  userDataDir = await mkdtemp(join(tmpdir(), 'sm-server-host-'))
  h.getPath.mockImplementation((name: string) => name === 'userData' ? userDataDir : join(userDataDir, 'redirected-music'))
  h.start.mockResolvedValue({ port: 12345, close: vi.fn() })
  h.close.mockResolvedValue(undefined)
})
afterEach(async () => {
  await shutdownServer()
  await rm(userDataDir, { recursive: true, force: true })
})

it('启动 API 时使用系统解析的音乐目录，不改变应用数据位置', async () => {
  expect((await bootServer()).port).toBe(12345)
  expect(h.getPath).toHaveBeenCalledWith('music')
  expect(h.start).toHaveBeenCalledWith(expect.objectContaining({
    userDataDir,
    defaultSongDownloadDir: join(userDataDir, 'redirected-music', 'Simple Music'),
  }))
})

it('系统音乐目录解析失败不阻断启动，允许下载配置回退', async () => {
  h.getPath.mockImplementation((name: string) => {
    if (name === 'userData') return userDataDir
    throw new Error('music unavailable')
  })
  expect((await bootServer()).port).toBe(12345)
  expect(h.start).toHaveBeenCalledWith(expect.objectContaining({ userDataDir, defaultSongDownloadDir: undefined }))
})
