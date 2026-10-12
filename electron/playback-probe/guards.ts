import type { ProbeCommand, ProbeSnapshot } from '../../src/types/playback-probe'

export function isProbeCommand(value: unknown): value is ProbeCommand {
  if (!value || typeof value !== 'object') return false
  const command = value as Record<string, unknown>
  if (['play', 'pause', 'stop', 'next', 'previous'].includes(String(command.type))) return Object.keys(command).length === 1
  if (Object.keys(command).length !== 2 || typeof command.value !== 'number' || !Number.isFinite(command.value)) return false
  switch (command.type) {
    case 'seek': return command.value >= 0 && command.value <= 86400
    case 'volume': return command.value >= 0 && command.value <= 1
    case 'rate': return command.value >= 0.5 && command.value <= 2
    case 'sleep': return command.value >= 0 && command.value <= 3600
    default: return false
  }
}

/** 固定窗口、主 frame 和精确入口都必须一致，拒绝 iframe 和导航后的页面。 */
export function isProbeSender(event: { sender: unknown; senderFrame: unknown }, win: { isDestroyed(): boolean; webContents: { mainFrame: unknown; getURL(): string } } | null, entry: string): boolean {
  return !!win && !win.isDestroyed() && event.sender === win.webContents
    && !!event.senderFrame && event.senderFrame === win.webContents.mainFrame && win.webContents.getURL() === entry
}

/** 主进程只保留可展示的快照，不让 URL、路径或未知字段进入导出报告。 */
export function readProbeSnapshot(value: unknown, sessionId: string): ProbeSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const state = value as ProbeSnapshot
  if (state.sessionId !== sessionId || !['idle', 'loading', 'playing', 'paused'].includes(state.status)) return null
  const counters = [state.revision, state.queueLength, state.loadCount, state.endedCount, state.deviceChanges]
  if (!counters.every(number => Number.isSafeInteger(number) && number >= 0)
    || !Number.isSafeInteger(state.queueIndex) || state.queueIndex < -1 || state.queueIndex >= state.queueLength
    || ![state.position, state.duration, state.volume, state.rate].every(number => Number.isFinite(number) && number >= 0)
    || state.volume > 1 || state.rate < 0.5 || state.rate > 2
    || (state.sleepAt !== null && (!Number.isFinite(state.sleepAt) || state.sleepAt < 0))
    || typeof state.error !== 'string' || !/^[A-Z0-9_]{0,80}$/.test(state.error)) return null
  if ((state.queueLength === 0) !== (state.queueIndex === -1 && state.current === null)) return null
  const current = state.current
  if (state.queueLength && (!current || typeof current.id !== 'string' || typeof current.label !== 'string'
    || !['local', 'proxy'].includes(current.kind))) return null
  return {
    sessionId, revision: state.revision, status: state.status,
    current: current ? { id: current.id, label: current.label, kind: current.kind } : null,
    queueIndex: state.queueIndex, queueLength: state.queueLength, position: state.position, duration: state.duration,
    volume: state.volume, rate: state.rate, loadCount: state.loadCount, endedCount: state.endedCount,
    deviceChanges: state.deviceChanges, sleepAt: state.sleepAt, error: state.error,
  }
}
