import { api } from './api'
import { applyLoginCookie, refreshKugouAccount } from './provider-login'
import type { QrLoginPoll } from '../types/ipc'

/** 支持应用内扫码登录的平台；Apple Music 只能走 Apple ID 网页授权。 */
export type QrLoginSource = 'netease' | 'qq' | 'kugou'
export type QrLoginMethod = 'app' | 'qq' | 'wx'

export interface QrLoginTicket extends QrLoginPoll {
  key?: string
}

export interface QrLoginAdapter {
  title: string
  methods: Array<{ id: QrLoginMethod; label: string }>
  /** 「打开 X 扫一扫」里的 X */
  scanner(method: QrLoginMethod): string
  hint?: string
  /** 能否退回原来的网页登录窗口（账密、短信等） */
  webFallback: boolean
  start(method: QrLoginMethod): Promise<QrLoginTicket>
  poll(ticket: QrLoginTicket, method: QrLoginMethod, scanned: boolean): Promise<QrLoginPoll>
  cancel?(): void
  complete(result: QrLoginPoll): Promise<void>
}

const serverQr = (base: string, method: QrLoginMethod) => ({
  async start(): Promise<QrLoginTicket> {
    const res = await api.post<{ key?: string; image?: string }>(`${base}/login/qr${method === 'wx' ? '?type=wx' : ''}`)
    return res.key && res.image ? { status: 'waiting', key: res.key, image: res.image } : { status: 'failed' }
  },
  async poll(ticket: QrLoginTicket, scanned: boolean): Promise<QrLoginPoll> {
    // 微信长轮询要带上一次的状态码，否则会立刻重复返回「已扫码」。
    return api.get<QrLoginPoll>(`${base}/login/qr/check`, {
      key: ticket.key, ...(method === 'wx' ? { type: 'wx', last: scanned ? '404' : undefined } : {}),
    })
  },
})

export const QR_LOGIN_ADAPTERS: Record<QrLoginSource, QrLoginAdapter> = {
  netease: {
    title: '登录网易云音乐',
    methods: [{ id: 'app', label: '扫码' }],
    scanner: () => '网易云音乐 App 或微信',
    webFallback: true,
    async start() {
      return (await window.desktop?.startNeteaseQrLogin()) ?? { status: 'failed', message: '当前环境不支持扫码登录' }
    },
    async poll() {
      return (await window.desktop?.pollNeteaseQrLogin()) ?? { status: 'expired' }
    },
    cancel() { void window.desktop?.cancelNeteaseQrLogin() },
    async complete(result) { if (result.cookie) await applyLoginCookie('netease', result.cookie) },
  },
  qq: {
    title: '登录 QQ 音乐',
    methods: [{ id: 'qq', label: 'QQ' }, { id: 'wx', label: '微信' }],
    scanner: (method) => method === 'wx' ? '微信' : '手机 QQ',
    webFallback: true,
    start: (method) => serverQr('/api/qq', method).start(),
    poll: (ticket, method, scanned) => serverQr('/api/qq', method).poll(ticket, scanned),
    async complete(result) { if (result.cookie) await applyLoginCookie('qq', result.cookie) },
  },
  kugou: {
    title: '登录酷狗音乐',
    methods: [{ id: 'app', label: '扫码' }],
    scanner: () => '酷狗音乐 App',
    hint: '登录后可播放账号权益内的整曲与高音质，并读取我的歌单',
    webFallback: false,
    start: (method) => serverQr('/api/kugou', method).start(),
    poll: (ticket, method, scanned) => serverQr('/api/kugou', method).poll(ticket, scanned),
    complete: () => refreshKugouAccount(),
  },
}
