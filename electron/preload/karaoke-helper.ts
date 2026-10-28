import { contextBridge, ipcRenderer } from 'electron'
import type { KaraokeHelperEvent, KaraokeHelperRequest } from '../../src/types/ipc'
import type { KaraokeModelId } from '../../src/types/karaoke'

function readArg(name: string): string {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`))
  return arg ? arg.slice(name.length + 3) : ''
}

// 分离页只需 API 地址与任务收发；api.ts 从 window.desktop 读取端口和 token
contextBridge.exposeInMainWorld('desktop', {
  serverPort: Number(readArg('simplemusic-server-port')) || 0,
  serverToken: readArg('simplemusic-server-token'),
})

const bridge = {
  initNative: (model: KaraokeModelId): Promise<boolean> => ipcRenderer.invoke('karaoke-helper:native-init', model),
  inferNative: (input: Float32Array): Promise<Float32Array> => ipcRenderer.invoke('karaoke-helper:native-infer', input),
  onCommand: (cb: (command: KaraokeHelperRequest) => void) => {
    ipcRenderer.on('karaoke-helper:command', (_event, command: KaraokeHelperRequest) => cb(command))
  },
  emit: (event: KaraokeHelperEvent): void => ipcRenderer.send('karaoke-helper:event', event),
  ready: (): void => ipcRenderer.send('karaoke-helper:ready'),
}

contextBridge.exposeInMainWorld('karaokeHelper', bridge)
export type KaraokeHelperBridge = typeof bridge
