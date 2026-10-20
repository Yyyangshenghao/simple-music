import { describe, expect, it } from 'vitest'
import { isProbeCommand, isProbeSender, readProbeSnapshot } from './guards'
import type { ProbeSnapshot } from '../../src/types/playback-probe'

const snapshot: ProbeSnapshot = {
  sessionId: 'session', revision: 1, status: 'playing', current: { id: 'a', label: 'A', kind: 'local' }, queueIndex: 0, queueLength: 1,
  position: 10, duration: 30, volume: 0.2, rate: 1, loadCount: 1, endedCount: 0, deviceChanges: 0, sleepAt: null, error: '',
}
describe('原型 IPC 边界', () => {
  it('只接收公开控制集合及有限范围，不允许控制页注入队列或私有地址', () => {
    expect(isProbeCommand({ type: 'play' })).toBe(true)
    expect(isProbeCommand({ type: 'seek', value: 12 })).toBe(true)
    for (const command of [null, { type: 'replace', items: [] }, { type: 'play', url: 'file:///private' }, { type: 'volume', value: 2 }, { type: 'rate', value: NaN }, { type: 'sleep', value: Infinity }]) expect(isProbeCommand(command)).toBe(false)
  })
  it('限制为指定存活窗口主 frame 的精确入口', () => {
    const frame = {}
    const win = { isDestroyed: () => false, webContents: { mainFrame: frame, getURL: () => 'http://127.0.0.1:5173/control.html' } }
    const event = { sender: win.webContents, senderFrame: frame }
    expect(isProbeSender(event, win, win.webContents.getURL())).toBe(true)
    expect(isProbeSender({ ...event, senderFrame: {} }, win, win.webContents.getURL())).toBe(false)
    expect(isProbeSender({ ...event, sender: {} }, win, win.webContents.getURL())).toBe(false)
    expect(isProbeSender(event, win, 'http://127.0.0.1:5173/host.html')).toBe(false)
    expect(isProbeSender(event, { ...win, isDestroyed: () => true }, win.webContents.getURL())).toBe(false)
  })
  it('拒绝旧会话和无效状态，复制白名单字段防止地址与令牌混入报告', () => {
    expect(readProbeSnapshot(snapshot, 'other')).toBeNull()
    expect(readProbeSnapshot({ ...snapshot, position: Infinity }, 'session')).toBeNull()
    expect(readProbeSnapshot({ ...snapshot, queueIndex: 2 }, 'session')).toBeNull()
    expect(readProbeSnapshot({ ...snapshot, current: null }, 'session')).toBeNull()
    expect(readProbeSnapshot({ ...snapshot, error: 'http://secret' }, 'session')).toBeNull()
    const result = readProbeSnapshot({ ...snapshot, token: 'secret', current: { ...snapshot.current, url: 'file:///private' } }, 'session')
    expect(result).toEqual(snapshot)
    expect(result?.current).not.toBe(snapshot.current)
  })
})
