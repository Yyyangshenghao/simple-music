import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  request: vi.fn(),
  streams: vi.fn(async () => []),
  options: [] as Array<{ deviceId: string; sessions: any }>,
}))
vi.mock('qishui-music-api', () => ({
  createQishuiApi: (options: { deviceId: string; sessions: any }) => {
    h.options.push(options)
    return { request: h.request }
  },
}))

vi.mock('./qishui-client', async importOriginal => ({
  ...await importOriginal<typeof import('./qishui-client')>(),
  fetchQishuiStreams: h.streams,
}))

import {
  cancelQishuiLogin,
  completeQishuiLogin,
  fetchQishuiAccountPlaylist,
  fetchQishuiRadioTracks,
  fetchQishuiUserPlaylists,
  logoutQishui,
  pollQishuiLogin,
  prepareQishuiRadio,
  qishuiLoginStatus,
  startQishuiLogin,
} from './qishui-account'

const session = {
  deviceId: '1', userId: 'u1', ticket: 't', guardKey: 'k', guardCert: 'c', guardTsSign: 's', accessCode: 'a', openId: 'o', expiresAt: 4102444800000,
  user: { id: 'u1', nickname: '测试账号', avatar: 'https://a/1.png', isVip: false },
}
const ok = (data: unknown) => ({ ok: true, data })
const fail = (code: string, upstreamCode?: number) => ({ ok: false, error: { code, message: 'x', upstreamCode } })

describe('汽水账号', () => {
  let dir: string
  const saveSession = () => writeFileSync(join(dir, 'qishui-account.json'), JSON.stringify(session))
  const reply = (table: Record<string, unknown>) => h.request.mockImplementation(async (operation: string) => table[operation] ?? fail('unexpected'))

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'simplemusic-qishui-test-'))
    h.request.mockReset()
    h.streams.mockClear()
    h.options.length = 0
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('设备 ID 由设备标识派生，符合 19 位格式且多次相同', async () => {
    reply({ login_qr_key: ok({ key: 'a'.repeat(32) }), login_qr_create: ok({ imageUrl: 'data:image/png;base64,AAAA' }) })
    await startQishuiLogin(dir)
    const other = mkdtempSync(join(tmpdir(), 'simplemusic-qishui-test-'))
    try {
      await startQishuiLogin(other)
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
    expect(h.options[0].deviceId).toMatch(/^[1-9]\d{18}$/)
    expect(h.options[1].deviceId).toBe(h.options[0].deviceId)
  })

  it('发起扫码返回本地票据和二维码', async () => {
    reply({ login_qr_key: ok({ key: 'a'.repeat(32) }), login_qr_create: ok({ imageUrl: 'data:image/png;base64,AAAA' }) })
    await expect(startQishuiLogin(dir)).resolves.toEqual({ key: 'a'.repeat(32), image: 'data:image/png;base64,AAAA' })
  })

  it('二维码取不到时报错', async () => {
    reply({ login_qr_key: fail('network') })
    await expect(startQishuiLogin(dir)).rejects.toThrow('QISHUI_network')
  })

  it.each([
    [ok({ state: 'waiting' }), { status: 'waiting' }],
    [ok({ state: 'scanned' }), { status: 'scanned' }],
    [ok({ state: 'confirmed' }), { status: 'confirmed' }],
    [ok({ state: 'expired' }), { status: 'expired' }],
    [ok({ state: 'error', failure: { case: 'refused' } }), { status: 'failed', message: expect.stringContaining('拒绝') }],
    [fail('unavailable', 1092), { status: 'failed', message: expect.stringContaining('1092') }],
  ])('轮询状态映射 %#', async (response, expected) => {
    reply({ login_qr_check: response })
    await expect(pollQishuiLogin(dir, 'a'.repeat(32))).resolves.toEqual(expected)
  })

  it('轮询网络失败时抛错，由界面继续轮询；缺票据视为过期', async () => {
    reply({ login_qr_check: fail('network') })
    await expect(pollQishuiLogin(dir, 'a'.repeat(32))).rejects.toThrow('QISHUI_network')
    await expect(pollQishuiLogin(dir, null)).resolves.toEqual({ status: 'expired' })
  })

  it('会话以 0600 保存，确认后返回资料，清除后删除文件', async () => {
    reply({ login_qr_key: ok({ key: 'a'.repeat(32) }), login_qr_create: ok({ imageUrl: 'x' }) })
    await startQishuiLogin(dir)
    expect(completeQishuiLogin(dir)).toEqual({ loggedIn: false })
    h.options[0].sessions.set(session)
    const file = join(dir, 'qishui-account.json')
    expect(JSON.parse(readFileSync(file, 'utf8')).ticket).toBe('t')
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(completeQishuiLogin(dir)).toEqual({ loggedIn: true, nickname: '测试账号', avatar: 'https://a/1.png' })
    h.options[0].sessions.clear()
    expect(existsSync(file)).toBe(false)
    expect(h.options[0].sessions.revision).toBe(2)
  })

  it('头像是图片对象时转成地址，无法识别时留空', async () => {
    reply({ login_qr_key: ok({ key: 'a'.repeat(32) }), login_qr_create: ok({ imageUrl: 'x' }) })
    await startQishuiLogin(dir)
    h.options[0].sessions.set({ ...session, user: { ...session.user, avatar: { uri: 'p', urls: ['https://img/'] } } })
    expect(completeQishuiLogin(dir)).toMatchObject({ avatar: expect.stringContaining('https://img/p') })
    h.options[0].sessions.set({ ...session, user: { ...session.user, avatar: { foo: 1 } } })
    expect(completeQishuiLogin(dir)).toMatchObject({ avatar: '' })
  })

  it('恢复已保存的会话；旧版 passport 会话视为未登录', async () => {
    writeFileSync(join(dir, 'qishui-account.json'), JSON.stringify({ session: 'old', nickname: '旧' }))
    await expect(qishuiLoginStatus(dir)).resolves.toEqual({ loggedIn: false })
    expect(h.request).not.toHaveBeenCalled()

    const restored = mkdtempSync(join(tmpdir(), 'simplemusic-qishui-test-'))
    try {
      writeFileSync(join(restored, 'qishui-account.json'), JSON.stringify(session))
      reply({ login_status: ok(session.user) })
      await expect(qishuiLoginStatus(restored)).resolves.toEqual({ loggedIn: true, nickname: '测试账号', avatar: 'https://a/1.png' })
    } finally {
      rmSync(restored, { recursive: true, force: true })
    }
  })

  it('网络失败不退出账号，会话被清除后才算未登录', async () => {
    saveSession()
    reply({ login_status: fail('network') })
    await expect(qishuiLoginStatus(dir)).resolves.toMatchObject({ loggedIn: true, nickname: '测试账号' })
    h.options[0].sessions.clear()
    await expect(qishuiLoginStatus(dir)).resolves.toEqual({ loggedIn: false })
  })

  describe('账号歌单', () => {
    const playlist = (id: string, extra = {}) => ({
      base_info: { id, title: `歌单${id}`, owner_id: 'u1', desc: '简介' }, resource_cnt: { track_cnt: 3 },
      relation_info: { owner: { id: 'u1', nickname: '测试账号' } }, isOwned: true, ...extra,
    })

    it('未登录时不请求上游', async () => {
      await expect(fetchQishuiUserPlaylists(dir)).resolves.toBeNull()
      await expect(fetchQishuiAccountPlaylist(dir, '45')).resolves.toBeNull()
      expect(h.request).not.toHaveBeenCalled()
    })

    it('翻页读取并映射，收藏的歌单标记 subscribed，过滤无效项', async () => {
      saveSession()
      h.request.mockResolvedValueOnce(ok({ items: [playlist('45'), { base_info: { id: 'bad', title: 'x' } }], hasMore: true, nextOffset: 2 }))
        .mockResolvedValueOnce(ok({ items: [playlist('46', { isOwned: false })], hasMore: false }))
      const result = await fetchQishuiUserPlaylists(dir)
      expect(result).toMatchObject([
        { id: '45', name: '歌单45', source: 'qishui', trackCount: 3, creator: '测试账号', subscribed: false },
        { id: '46', subscribed: true },
      ])
      expect(result).toHaveLength(2)
      expect(h.request.mock.calls[1]).toEqual(['user_playlists', { limit: 100, offset: 2 }])
    })

    it('会话失效返回 null，其他错误抛出', async () => {
      saveSession()
      h.request.mockResolvedValueOnce(fail('auth-required')).mockResolvedValueOnce(fail('unavailable'))
      await expect(fetchQishuiUserPlaylists(dir)).resolves.toBeNull()
      await expect(fetchQishuiUserPlaylists(dir)).rejects.toThrow('QISHUI_unavailable')
    })

    it('读取期间退出账号时丢弃结果', async () => {
      saveSession()
      h.request.mockImplementationOnce(async () => {
        h.options[0].sessions.clear()
        return ok({ items: [playlist('45')], hasMore: false })
      })
      await expect(fetchQishuiUserPlaylists(dir)).resolves.toEqual([])
    })

    it('私有歌单详情带上 owner，并把曲目映射为应用格式', async () => {
      saveSession()
      h.request.mockResolvedValueOnce(ok({ items: [playlist('45')], hasMore: false }))
        .mockResolvedValueOnce(ok({
          collection: playlist('45'), hasMore: false,
          items: [{ id: '7', base_info: { id: '7', name: '歌曲', duration_ms: 180000 },
            related_info: { artist_links: [{ id: '9', name: '歌手' }], album_link: { id: '8', name: '专辑' } } }, { id: 'bad' }],
        }))
      await fetchQishuiUserPlaylists(dir)
      const detail = await fetchQishuiAccountPlaylist(dir, '45')
      expect(h.request.mock.calls[1]).toEqual(['playlist_tracks', { id: '45', ownerId: 'u1', limit: 100, offset: 0 }])
      expect(detail?.playlist).toMatchObject({ id: '45', name: '歌单45' })
      expect(detail?.tracks).toEqual([expect.objectContaining({ id: '7', name: '歌曲', artist: '歌手', album: '专辑', duration: 180000, source: 'qishui' })])
    })
  })

  it.each([
    ['default', {}],
    ['fresh', { preference: 'fresh' }],
    ['32', { scene: '32' }],
  ])('听歌模式 %s 按对应参数取推荐并映射曲目', async (mode, target) => {
    reply({ feed: ok({ items: [{ id: '7', base_info: { id: '7', name: '歌曲', duration_ms: 1000 } }, { id: 'bad' }], hasMore: true }) })
    await expect(fetchQishuiRadioTracks(dir, mode, true)).resolves.toMatchObject([{ id: '7', name: '歌曲', source: 'qishui' }])
    expect(h.request).toHaveBeenCalledWith('feed', { ...target, first: true, queue: 'fm', limit: 20 })
  })

  describe('听歌模式预备', () => {
    const batch = (id: string) => ok({ items: [{ id, base_info: { id, name: `歌${id}` } }], hasMore: true })

    it('备好后点击直接返回，不再等上游，并预热第一首地址和补下一批', async () => {
      h.request.mockResolvedValueOnce(batch('1')).mockResolvedValue(batch('2'))
      await prepareQishuiRadio(dir, 'fresh')
      expect(h.streams).toHaveBeenCalledWith('1')
      expect(h.request).toHaveBeenCalledTimes(1)
      await expect(fetchQishuiRadioTracks(dir, 'fresh', true)).resolves.toMatchObject([{ id: '1' }])
      await vi.waitFor(() => expect(h.request).toHaveBeenCalledTimes(2))
      await vi.waitFor(() => expect(h.streams).toHaveBeenCalledWith('2'))
      await expect(fetchQishuiRadioTracks(dir, 'fresh', true)).resolves.toMatchObject([{ id: '2' }])
    })

    it('预备进行中点击会等这一次，不重复请求', async () => {
      let resolve!: (value: unknown) => void
      h.request.mockImplementationOnce(() => new Promise(done => { resolve = done })).mockResolvedValue(batch('2'))
      const prepared = prepareQishuiRadio(dir, 'fresh')
      void prepareQishuiRadio(dir, 'fresh')
      const clicked = fetchQishuiRadioTracks(dir, 'fresh', true)
      expect(h.request).toHaveBeenCalledTimes(1)
      resolve(batch('1'))
      await prepared
      await expect(clicked).resolves.toMatchObject([{ id: '1' }])
    })

    it('预备失败时点击重新请求；过期或换账号的批次不再使用', async () => {
      h.request.mockResolvedValueOnce(fail('network')).mockResolvedValue(batch('2'))
      await expect(prepareQishuiRadio(dir, 'fresh')).rejects.toThrow('QISHUI_network')
      await expect(fetchQishuiRadioTracks(dir, 'fresh', true)).resolves.toMatchObject([{ id: '2' }])

      await vi.waitFor(() => expect(h.request.mock.calls.length).toBeGreaterThanOrEqual(3))
      h.request.mockResolvedValue(batch('3'))
      await prepareQishuiRadio(dir, 'familiar')
      h.options[0].sessions.clear()
      h.request.mockResolvedValue(batch('4'))
      await expect(fetchQishuiRadioTracks(dir, 'familiar', true)).resolves.toMatchObject([{ id: '4' }])
    })

    it('续播的批次不走预备', async () => {
      h.request.mockResolvedValue(batch('5'))
      await expect(fetchQishuiRadioTracks(dir, 'fresh', false)).resolves.toMatchObject([{ id: '5' }])
      expect(h.request).toHaveBeenCalledWith('feed', { preference: 'fresh', first: false, queue: 'fm', limit: 20 })
      expect(h.request).toHaveBeenCalledTimes(1)
    })
  })

  it('听歌模式取不到时报错', async () => {
    reply({ feed: fail('network') })
    await expect(fetchQishuiRadioTracks(dir, 'default', false)).rejects.toThrow('QISHUI_network')
  })

  it('取消和退出转交依赖包；退出失败时报错', async () => {
    reply({ login_qr_cancel: ok(null), logout: ok(null) })
    await expect(cancelQishuiLogin(dir, 'a'.repeat(32))).resolves.toEqual({ ok: true })
    await expect(cancelQishuiLogin(dir, null)).resolves.toEqual({ ok: true })
    await expect(logoutQishui(dir)).resolves.toEqual({ ok: true })
    expect(h.request.mock.calls.map(([operation]) => operation)).toEqual(['login_qr_cancel', 'logout'])
    reply({ logout: fail('invalid-response') })
    await expect(logoutQishui(dir)).rejects.toThrow('QISHUI_invalid-response')
  })
})
