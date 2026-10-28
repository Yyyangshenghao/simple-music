import { createRoot } from 'react-dom/client'
import './styles/global.css'
import './styles/scroll-gradients.css'
import App from './App'
import { initTaskCenterRuntime } from './lib/task-center-runtime'
import { startPlaybackClient } from './lib/playback-client'

const root = document.getElementById('root')!
let starting = false

async function start(): Promise<void> {
  if (starting) return
  starting = true
  root.textContent = '正在连接播放器…'
  try {
    const stop = typeof window.desktop?.playbackRequest === 'function'
      ? await startPlaybackClient()
      : (await import('./lib/playback-runtime')).startPlaybackRuntime()
    window.addEventListener('unload', stop, { once: true })
    const stopTasks = initTaskCenterRuntime()
    window.addEventListener('unload', stopTasks, { once: true })
    createRoot(root).render(<App />)
  } catch (error) {
    const message = document.createElement('p')
    message.textContent = error instanceof Error ? error.message : '播放器连接失败，请重试'
    const retry = document.createElement('button')
    retry.textContent = '重新连接'
    retry.onclick = () => { void start() }
    root.replaceChildren(message, retry)
  } finally { starting = false }
}

void start()
