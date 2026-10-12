import '../styles/tokens.css'
import './control.css'
import type { ProbeCommand, ProbeSnapshot } from '../types/playback-probe'

const bridge = window.playbackProbe
if (bridge.role !== 'control') throw new Error('Invalid probe control')
const api = bridge
function element<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T }
function input(id: string): HTMLInputElement { return element<HTMLInputElement>(id) }
function time(seconds: number) { return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` }
let revision = -1
function render(state: ProbeSnapshot) {
  if (state.revision < revision) return
  revision = state.revision
  element('track').textContent = state.current?.label ?? '未选择音频'
  element('status').textContent = ({ idle: '停止', loading: '加载中', playing: '播放中', paused: '已暂停' })[state.status]
  element('position').textContent = `${time(state.position)} / ${time(state.duration)}`
  element('counters').textContent = `队列 ${state.queueLength} 首 · 当前 ${state.queueIndex + 1} · 加载 ${state.loadCount} 次 · 自然结束 ${state.endedCount} 次 · 设备变更 ${state.deviceChanges} 次`
  element('session').textContent = `会话 ${state.sessionId.slice(0, 8)} · 状态版本 ${state.revision}`
  element('sleep-state').textContent = state.sleepAt ? `将在 ${new Date(state.sleepAt).toLocaleTimeString()} 停止` : '未设置定时停止'
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-command]')) button.disabled = !state.queueLength
  if (document.activeElement !== input('volume')) input('volume').value = String(state.volume)
  if (document.activeElement !== element('rate')) element<HTMLSelectElement>('rate').value = String(state.rate)
  if (state.error) element('message').textContent = `播放错误：${state.error}`
}
async function run(action: () => Promise<unknown>) {
  element('message').textContent = ''
  try { await action() }
  catch (error) { element('message').textContent = error instanceof Error ? error.message : '操作失败' }
}
function command(value: ProbeCommand) { return run(async () => render(await api.command(value))) }
const unsubscribe = api.onSnapshot(render)
void run(async () => render(await api.snapshot()))
window.addEventListener('unload', unsubscribe)

element('folder').addEventListener('click', () => void run(async () => {
  const count = await api.chooseFolder()
  element('message').textContent = count ? `已载入 ${count} 首测试音频` : '未载入新的音频'
}))
element('stream-form').addEventListener('submit', event => {
  event.preventDefault()
  void run(async () => { render(await api.loadStream(input('stream').value.trim())); input('stream').value = '' })
})
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-command]')) {
  button.addEventListener('click', () => void command({ type: button.dataset.command as 'play' | 'pause' | 'stop' | 'next' | 'previous' }))
}
element('seek-button').addEventListener('click', () => void command({ type: 'seek', value: Number(input('seek').value) }))
input('volume').addEventListener('change', () => void command({ type: 'volume', value: Number(input('volume').value) }))
element('rate').addEventListener('change', () => void command({ type: 'rate', value: Number(element<HTMLSelectElement>('rate').value) }))
element('sleep').addEventListener('click', () => void command({ type: 'sleep', value: Number(input('sleep-seconds').value) }))
element('detach').addEventListener('click', () => void run(() => api.detach(Number(input('detach-seconds').value))))
element('export').addEventListener('click', () => void run(async () => { if (await api.exportReport()) element('message').textContent = '报告已保存' }))
element('quit').addEventListener('click', () => void run(() => api.quit()))
element('refresh-report').addEventListener('click', () => void run(async () => {
  const report = await api.report()
  const last = report.samples.at(-1)
  element('report').textContent = [
    `${report.runtime.platform} ${report.runtime.arch} · Electron ${report.runtime.electron} · 开发构建`,
    `采样 ${report.samples.length} 次 · 控制界面${last?.controlOpen ? '存在' : '不存在'} · 音频宿主${last?.hostAlive ? '存活' : '未就绪'}`,
    last ? `应用进程 CPU 合计 ${last.processes.reduce((sum, proc) => sum + proc.cpuPercent, 0).toFixed(2)}% · 工作集合计 ${(last.processes.reduce((sum, proc) => sum + proc.workingSetKiB, 0) / 1024).toFixed(1)} MiB（可能重复计入共享页）` : '等待采样',
    ...report.events.slice(-8).map(event => `${(event.elapsedMs / 1000).toFixed(1)}s  ${event.type}${event.snapshot
      ? ` · ${event.snapshot.current?.label ?? '无曲目'} · ${event.snapshot.status} · ${event.snapshot.position.toFixed(1)}s${event.snapshot.error ? ` · ${event.snapshot.error}` : ''}` : ''}`),
  ].join('\n')
}))
