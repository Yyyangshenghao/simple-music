/** 仅用于独立开发原型，不是正式播放器的跨进程协议。 */
export interface ProbeItem {
  id: string
  label: string
  kind: 'local' | 'proxy'
  url: string
}

export type ProbeCommand =
  | { type: 'play' | 'pause' | 'stop' | 'next' | 'previous' }
  | { type: 'seek' | 'volume' | 'rate' | 'sleep'; value: number }

export type ProbeHostCommand = ProbeCommand
  | { type: 'replace'; items: ProbeItem[] }
  | { type: 'snapshot' }
  | { type: 'observe'; enabled: boolean }

export interface ProbeSnapshot {
  sessionId: string
  revision: number
  status: 'idle' | 'loading' | 'playing' | 'paused'
  current: Omit<ProbeItem, 'url'> | null
  queueIndex: number
  queueLength: number
  position: number
  duration: number
  volume: number
  rate: number
  loadCount: number
  endedCount: number
  deviceChanges: number
  sleepAt: number | null
  error: string
}

export interface ProbeMetricSample {
  elapsedMs: number
  controlOpen: boolean
  hostAlive: boolean
  status: ProbeSnapshot['status']
  loadCount: number
  endedCount: number
  processes: Array<{ pid: number; kind: string; cpuPercent: number; workingSetKiB: number; privateKiB?: number }>
}

export interface ProbeReport {
  schema: 1
  startedAt: string
  runtime: { electron: string; chrome: string; platform: string; arch: string; build: 'development' }
  notes: string[]
  latest: ProbeSnapshot | null
  samples: ProbeMetricSample[]
  events: Array<{ elapsedMs: number; type: string; snapshot?: ProbeSnapshot }>
}

export interface ProbeControlApi {
  role: 'control'
  snapshot(): Promise<ProbeSnapshot>
  command(command: ProbeCommand): Promise<ProbeSnapshot>
  chooseFolder(): Promise<number>
  loadStream(url: string): Promise<ProbeSnapshot>
  detach(seconds: number): Promise<void>
  report(): Promise<ProbeReport>
  exportReport(): Promise<boolean>
  quit(): Promise<void>
  onSnapshot(listener: (snapshot: ProbeSnapshot) => void): () => void
}

export interface ProbeHostApi {
  role: 'host'
  sessionId: string
  ready(): void
  publish(snapshot: ProbeSnapshot): void
  reply(id: number, snapshot: ProbeSnapshot): void
  onCommand(listener: (packet: { id: number; command: ProbeHostCommand }) => void): () => void
}

declare global {
  interface Window {
    playbackProbe: ProbeControlApi | ProbeHostApi
  }
}
