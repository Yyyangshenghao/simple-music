import { contextBridge, ipcRenderer } from 'electron'
import type { ProbeControlApi, ProbeHostApi, ProbeHostCommand, ProbeSnapshot } from '../../src/types/ipc'

function argument(name: string): string {
  return process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? ''
}
function on<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

if (argument('probe-role') === 'host') {
  contextBridge.exposeInMainWorld('desktop', { serverPort: Number(argument('probe-port')), serverToken: argument('probe-token') })
  const host: ProbeHostApi = {
    role: 'host', sessionId: argument('probe-session'),
    ready: () => ipcRenderer.send('probe:ready'),
    publish: snapshot => ipcRenderer.send('probe:state', snapshot),
    reply: (id, snapshot) => ipcRenderer.send('probe:reply', { id, snapshot }),
    onCommand: listener => on<{ id: number; command: ProbeHostCommand }>('probe:execute', listener),
  }
  contextBridge.exposeInMainWorld('playbackProbe', host)
} else {
  const control: ProbeControlApi = {
    role: 'control', snapshot: () => ipcRenderer.invoke('probe:snapshot'),
    command: command => ipcRenderer.invoke('probe:command', command),
    chooseFolder: () => ipcRenderer.invoke('probe:choose-folder'),
    loadStream: url => ipcRenderer.invoke('probe:stream', url),
    detach: seconds => ipcRenderer.invoke('probe:detach', seconds),
    report: () => ipcRenderer.invoke('probe:report'),
    exportReport: () => ipcRenderer.invoke('probe:export'),
    quit: () => ipcRenderer.invoke('probe:quit'),
    onSnapshot: listener => on<ProbeSnapshot>('probe:state', listener),
  }
  contextBridge.exposeInMainWorld('playbackProbe', control)
}
