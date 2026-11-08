import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cancelQishuiLogin, completeQishuiLogin, fetchQishuiAccountPlaylist, fetchQishuiUserPlaylists, logoutQishui, pollQishuiLogin, qishuiLoginStatus, startQishuiLogin } from './qishui-account'

const qr = { data: { token: 'upstream-token', qrcode: 'data:image/png;base64,AAAA' } }
const account = { my_info: { id: '123', nickname: '测试账号' } }
const confirmed = () => Response.json({ data: { status: 'confirmed' } }, { headers: { 'Set-Cookie': 'sessionid=test-secret; Secure; HttpOnly' } })

describe('汽水扫码登录', () => {
  let dir: string

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'simplemusic-qishui-test-')) })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.unstubAllGlobals()
  })

  it('核实扫码账号、恢复资料并退出，界面只得到本地票据和资料', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json(qr, { headers: { 'Set-Cookie': 'ttwid=visitor; Secure' } }))
      .mockResolvedValueOnce(Response.json({ data: { status: 'scanned' } }))
      .mockResolvedValueOnce(confirmed())
      .mockResolvedValueOnce(Response.json(account))
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(Response.json(account))
      .mockResolvedValueOnce(Response.json({ status_code: 1000016 }))
    vi.stubGlobal('fetch', fetch)

    const { key } = await startQishuiLogin(dir)
    expect(key).not.toBe('upstream-token')
    await expect(pollQishuiLogin(dir, key)).resolves.toEqual({ status: 'scanned' })
    expect(fetch.mock.calls[1][1].headers.Cookie).toBe('ttwid=visitor')
    await expect(pollQishuiLogin(dir, key)).resolves.toEqual({ status: 'confirmed' })
    await expect(qishuiLoginStatus(dir)).resolves.toEqual({ loggedIn: false })
    expect(completeQishuiLogin(dir, key)).toEqual({ loggedIn: true, nickname: '测试账号' })
    if (process.platform !== 'win32') expect(statSync(join(dir, 'qishui-account.json')).mode & 0o777).toBe(0o600)
    await expect(qishuiLoginStatus(dir)).resolves.toEqual({ loggedIn: true, nickname: '测试账号' })
    await expect(qishuiLoginStatus(dir)).resolves.toEqual({ loggedIn: true, nickname: '测试账号' })
    expect(fetch.mock.calls[4][1].headers.Cookie).toBe('sessionid=test-secret')
    await expect(qishuiLoginStatus(dir)).resolves.toEqual({ loggedIn: false })
    logoutQishui(dir)
    await expect(qishuiLoginStatus(dir)).resolves.toEqual({ loggedIn: false })
  })

  it('资料请求暂时失败时重试核实，复用扫码已下发的会话', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json(qr))
      .mockResolvedValueOnce(confirmed())
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(Response.json(account))
    vi.stubGlobal('fetch', fetch)
    const { key } = await startQishuiLogin(dir)
    await expect(pollQishuiLogin(dir, key)).rejects.toThrow('timeout')
    await expect(pollQishuiLogin(dir, key)).resolves.toEqual({ status: 'confirmed' })
    expect(fetch.mock.calls[3][0]).toBe(fetch.mock.calls[2][0])
    expect(completeQishuiLogin(dir, key)).toEqual({ loggedIn: true, nickname: '测试账号' })
  })

  it('关闭浮层丢弃已核实但未提交的会话', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json(qr))
      .mockResolvedValueOnce(confirmed())
      .mockResolvedValueOnce(Response.json(account)))
    const { key } = await startQishuiLogin(dir)
    await expect(pollQishuiLogin(dir, key)).resolves.toEqual({ status: 'confirmed' })
    cancelQishuiLogin(dir, key)
    expect(completeQishuiLogin(dir, key)).toEqual({ loggedIn: false })
    await expect(qishuiLoginStatus(dir)).resolves.toEqual({ loggedIn: false })
  })

  describe('账号歌单', () => {
    const saveSession = () => writeFileSync(join(dir, 'qishui-account.json'), JSON.stringify({ session: 'test-secret', nickname: '测试账号' }))

    it('未登录时不请求上游', async () => {
      const fetch = vi.fn()
      vi.stubGlobal('fetch', fetch)
      await expect(fetchQishuiUserPlaylists(dir)).resolves.toBeNull()
      await expect(fetchQishuiAccountPlaylist(dir, '45')).resolves.toBeNull()
      expect(fetch).not.toHaveBeenCalled()
    })

    it('带会话读取并映射歌单，过滤无名和重复项', async () => {
      saveSession()
      const fetch = vi.fn().mockResolvedValueOnce(Response.json({
        playlists: [{ id: '45', title: '我的歌单', count_tracks: 3 }, { id: '45', title: '重复' }, { id: '46' }],
      }))
      vi.stubGlobal('fetch', fetch)
      const playlists = await fetchQishuiUserPlaylists(dir)
      expect(playlists).toMatchObject([{ id: '45', name: '我的歌单', source: 'qishui', trackCount: 3 }])
      expect(playlists).toHaveLength(1)
      expect(fetch.mock.calls[0][0]).toContain('/luna/pc/me/playlist?')
      expect(fetch.mock.calls[0][1].headers.Cookie).toBe('sessionid=test-secret')
    })

    it('iid 由设备标识派生，退出账号和换数据目录后不变', async () => {
      const iidOf = (url: string) => new URL(url).searchParams.get('iid')
      const fetch = vi.fn(async (_url: string) => Response.json({ playlists: [] }))
      vi.stubGlobal('fetch', fetch)
      saveSession()
      await fetchQishuiUserPlaylists(dir)
      const first = iidOf(fetch.mock.calls[0][0])
      expect(first).toMatch(/^[1-9]\d{13}$/)
      expect(first).not.toBe('27960026095955')
      logoutQishui(dir)
      saveSession()
      await fetchQishuiUserPlaylists(dir)
      expect(iidOf(fetch.mock.calls[1][0])).toBe(first)

      const other = mkdtempSync(join(tmpdir(), 'simplemusic-qishui-test-'))
      try {
        writeFileSync(join(other, 'qishui-account.json'), JSON.stringify({ session: 'other-secret' }))
        await fetchQishuiUserPlaylists(other)
        expect(iidOf(fetch.mock.calls[2][0])).toBe(first)
      } finally {
        rmSync(other, { recursive: true, force: true })
      }
    })

    it('会话失效返回 null，响应缺少歌单时报错', async () => {
      saveSession()
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(Response.json({ status_code: 1000016 }))
        .mockResolvedValueOnce(Response.json({ status_code: 0 })))
      await expect(fetchQishuiUserPlaylists(dir)).resolves.toBeNull()
      await expect(fetchQishuiUserPlaylists(dir)).rejects.toThrow('汽水音乐未返回账号歌单')
    })

    it('读取期间退出账号时丢弃结果', async () => {
      saveSession()
      let respond!: (response: Response) => void
      vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { respond = resolve })))
      const reading = fetchQishuiUserPlaylists(dir)
      logoutQishui(dir)
      respond(Response.json({ playlists: [{ id: '45', title: '旧账号歌单' }] }))
      await expect(reading).resolves.toEqual([])
    })

    it('私有歌单详情带上账号会话', async () => {
      saveSession()
      const fetch = vi.fn().mockResolvedValueOnce(Response.json({
        status_code: 0, playlist: { id: '45', title: '私有歌单' }, media_resources: [],
      }))
      vi.stubGlobal('fetch', fetch)
      await expect(fetchQishuiAccountPlaylist(dir, '45')).resolves.toMatchObject({ playlist: { id: '45', name: '私有歌单' } })
      expect(fetch.mock.calls[0][1].headers.Cookie).toBe('sessionid=test-secret')
      expect(fetch.mock.calls[0][1].redirect).toBe('error')
    })
  })

  it('取消后丢弃尚未返回的扫码确认', async () => {
    let respond!: (response: Response) => void
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(qr))
      .mockImplementationOnce(() => new Promise<Response>(resolve => { respond = resolve }))
    vi.stubGlobal('fetch', fetch)
    const { key } = await startQishuiLogin(dir)
    const poll = pollQishuiLogin(dir, key)
    cancelQishuiLogin(dir, key)
    respond(confirmed())
    await expect(poll).resolves.toEqual({ status: 'expired' })
    await expect(qishuiLoginStatus(dir)).resolves.toEqual({ loggedIn: false })
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
