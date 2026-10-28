/** 开发模式资源监控（dev:metrics）的采样结构，打包版不注册该通道。 */

export interface DevProcessSample {
  pid: number
  /** Electron 进程类型（Browser/Tab/GPU/Utility…）；不受 Electron 管的子进程为 'Child' */
  type: string
  label: string
  /** 距上次采样的 CPU 占用，单核 100% */
  cpu: number
  memoryKb: number
}

export interface DevMetricsSnapshot {
  at: number
  processes: DevProcessSample[]
  totals: { cpu: number; memoryKb: number }
  /** 主进程 V8（内嵌 API server 也跑在这里） */
  main: { heapUsed: number; heapTotal: number; external: number; arrayBuffers: number }
  gpu: {
    renderer: string | null
    /** 整机 GPU 利用率（macOS IOAccelerator），非本应用独占；不支持时为 null */
    utilization: number | null
    /** 整机 GPU 驱动在用内存（字节） */
    inUseMemory: number | null
  }
  system: { cpuCount: number; totalMem: number; freeMem: number }
}
