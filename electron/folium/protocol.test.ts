import { describe, it, expect, vi } from 'vitest'
vi.mock('electron', () => ({ app: {}, protocol: {} }))
import { attachLyricModFrameGuard, lyricModResponse } from './protocol'
import type { LyricModManager } from './manager'

const session = '11111111-1111-1111-1111-111111111111'
const store = {
  load: vi.fn(async (id: string) => ({ client: 'client.mjs', info: { id }, files: new Map([
    ['client.mjs', Buffer.from('export default function(){}')], ['evil.html', Buffer.from('<script>alert(1)</script>')]
  ]) }))
} as unknown as LyricModManager

describe('歌词模组协议与子框架隔离', () => {
  it('宿主文档禁止网络和嵌套框架，ESM 只允许本模组资源', async () => {
    const response = await lyricModResponse(new Request('simplemusic-mod://cinerama/__host.html?session=' + session), store)
    expect(response.status).toBe(200)
    const policy = response.headers.get('Content-Security-Policy')!
    expect(policy).toContain("connect-src 'none'")
    expect(policy).toContain("frame-src 'none'")
    expect(policy).toContain('sandbox allow-scripts')
    expect(policy).not.toContain('allow-same-origin')
    expect(policy).not.toContain('unsafe-eval')
    expect(await response.text()).toContain('simplemusic-mod://cinerama/client.mjs')
    const pixi = await lyricModResponse(new Request('simplemusic-mod://visualizer52hz/__host.html?session=' + session), store)
    expect(pixi.headers.get('Content-Security-Policy')).toContain("'unsafe-eval'")
  })
  it('脚本使用正确 MIME/CORS，拒绝包内 HTML 与编码越界', async () => {
    const script = await lyricModResponse(new Request('simplemusic-mod://cinerama/client.mjs'), store)
    expect(script.headers.get('Content-Type')).toBe('text/javascript')
    expect(script.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect((await lyricModResponse(new Request('simplemusic-mod://cinerama/evil.html'), store)).status).toBe(404)
    expect((await lyricModResponse(new Request('simplemusic-mod://cinerama/a%2f..%2fb'), store)).status).toBe(403)
  })
  it('外跳、已运行框架的自跳、嵌套框架和重定向均拒绝，主框架交给原有规则', () => {
    let listener: (event: { isMainFrame: boolean; url: string; frame?: { url: string; parent: unknown }; preventDefault(): void }) => void
    const on = vi.fn((_event, handler) => { listener = handler })
    const mainFrame = { url: 'app' }
    attachLyricModFrameGuard({ webContents: { on, mainFrame } } as never)
    const navigation = (url: string, previous = 'about:blank', main = false, parent: unknown = mainFrame) => {
      const preventDefault = vi.fn()
      listener({ url, frame: { url: previous, parent }, isMainFrame: main, preventDefault })
      return preventDefault
    }
    const host = 'simplemusic-mod://cinerama/__host.html?session=' + session
    expect(navigation(host)).not.toHaveBeenCalled()
    expect(navigation('https://example.com')).toHaveBeenCalledOnce()
    expect(navigation(host, host)).toHaveBeenCalledOnce()
    expect(navigation(host, 'about:blank', false, { url: host })).toHaveBeenCalledOnce()
    expect(navigation('https://example.com', '', true)).not.toHaveBeenCalled()
  })
})
