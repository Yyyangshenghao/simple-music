import { app, ipcMain, webContents } from 'electron'
import { execFile } from 'node:child_process'
import { basename } from 'node:path'
import { cpus, freemem, totalmem } from 'node:os'
import type { DevMetricsSnapshot, DevProcessSample } from '../../src/types/dev-metrics'

// 仅开发模式：采样本应用全部进程的 CPU/内存，以及整机 GPU 利用率。

const URL_LABELS: Array<[RegExp, string]> = [
  [/\/playback-host\.html/, '播放宿主'],
  [/\/desktop-lyrics\.html/, '桌面歌词'],
  [/\/wallpaper\.html/, '动态壁纸'],
  [/\/mini-player\.html/, '迷你播放条'],
  [/\/karaoke-helper\.html/, 'K 歌分离'],
  [/\/index\.html|^https?:\/\/localhost:\d+\/?(#|$)/, '主窗口'],
  [/music\.apple\.com/, 'Apple Music'],
  [/music\.163\.com/, '网易云登录'],
  [/qq\.com/, 'QQ 登录']
]

export function labelForUrl(url: string): string | null {
  for (const [pattern, label] of URL_LABELS) if (pattern.test(url)) return label
  try { return new URL(url).host || null } catch { return null }
}

const TYPE_LABELS: Record<string, string> = {
  Browser: '主进程（含 API server）',
  GPU: 'GPU 进程',
  Utility: '工具进程',
  Zygote: 'Zygote',
  'Sandbox helper': '沙箱辅助',
  'Pepper Plugin': '插件'
}

const SAMPLER_COMMANDS = new Set(['ps', 'ioreg', '(ps)', '(ioreg)'])

export interface PsRow { pid: number; ppid: number; cpu: number; rssKb: number; command: string }

export function parsePs(stdout: string): PsRow[] {
  const rows: PsRow[] = []
  for (const line of stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/.exec(line)
    if (!match) continue
    rows.push({ pid: Number(match[1]), ppid: Number(match[2]), cpu: Number(match[3]), rssKb: Number(match[4]), command: basename(match[5].trim()) })
  }
  return rows
}

/** root 的全部后代（不含 root）。 */
export function descendantsOf(rows: PsRow[], root: number): PsRow[] {
  const children = new Map<number, PsRow[]>()
  for (const row of rows) {
    const list = children.get(row.ppid)
    if (list) list.push(row)
    else children.set(row.ppid, [row])
  }
  const result: PsRow[] = []
  const queue = [root]
  while (queue.length) {
    for (const child of children.get(queue.shift()!) ?? []) {
      result.push(child)
      queue.push(child.pid)
    }
  }
  return result
}

export function parseIoregGpu(stdout: string): { utilization: number | null; inUseMemory: number | null } {
  const util = /"Device Utilization %"\s*=\s*(\d+)/.exec(stdout)
  const mem = /"In use system memory"\s*=\s*(\d+)/.exec(stdout)
  return { utilization: util ? Number(util[1]) : null, inUseMemory: mem ? Number(mem[1]) : null }
}

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 2000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => resolve(error ? '' : stdout))
  })
}

function webContentsLabels(): Map<number, string> {
  const labels = new Map<number, string>()
  for (const wc of webContents.getAllWebContents()) {
    if (wc.isDestroyed()) continue
    const label = labelForUrl(wc.getURL())
    const pid = wc.getOSProcessId()
    if (!label || !pid) continue
    const existing = labels.get(pid)
    labels.set(pid, existing && existing !== label ? `${existing} / ${label}` : label)
  }
  return labels
}

let gpuRenderer: Promise<string | null> | null = null

function readGpuRenderer(): Promise<string | null> {
  gpuRenderer ??= app.getGPUInfo('basic')
    .then((info) => {
      const aux = (info as { auxAttributes?: { glRenderer?: string } }).auxAttributes
      return aux?.glRenderer || null
    })
    .catch(() => null)
  return gpuRenderer
}

export async function sampleDevMetrics(): Promise<DevMetricsSnapshot> {
  const unix = process.platform !== 'win32'
  const [psOut, ioregOut, renderer] = await Promise.all([
    unix ? run('ps', ['-A', '-o', 'pid=,ppid=,pcpu=,rss=,comm=']) : Promise.resolve(''),
    process.platform === 'darwin' ? run('ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator']) : Promise.resolve(''),
    readGpuRenderer()
  ])
  const labels = webContentsLabels()
  const processes: DevProcessSample[] = app.getAppMetrics().map((metric) => ({
    pid: metric.pid,
    type: metric.type,
    label: labels.get(metric.pid) ?? metric.name ?? TYPE_LABELS[metric.type] ?? metric.type,
    cpu: metric.cpu.percentCPUUsage,
    memoryKb: metric.memory.workingSetSize
  }))
  // K 歌分离等自行拉起的进程不在 getAppMetrics 里，按进程树补上。
  const known = new Set(processes.map((item) => item.pid))
  for (const row of descendantsOf(parsePs(psOut), process.pid)) {
    // 跳过采样自己拉起的 ps/ioreg
    if (known.has(row.pid) || (row.ppid === process.pid && SAMPLER_COMMANDS.has(row.command))) continue
    processes.push({ pid: row.pid, type: 'Child', label: row.command, cpu: row.cpu, memoryKb: row.rssKb })
  }
  const memory = process.memoryUsage()
  return {
    at: Date.now(),
    processes,
    totals: {
      cpu: processes.reduce((sum, item) => sum + item.cpu, 0),
      memoryKb: processes.reduce((sum, item) => sum + item.memoryKb, 0)
    },
    main: { heapUsed: memory.heapUsed, heapTotal: memory.heapTotal, external: memory.external, arrayBuffers: memory.arrayBuffers },
    gpu: { renderer, ...parseIoregGpu(ioregOut) },
    system: { cpuCount: cpus().length, totalMem: totalmem(), freeMem: freemem() }
  }
}

export function registerDevMetricsIpc(): void {
  ipcMain.handle('dev:metrics', () => sampleDevMetrics())
}
