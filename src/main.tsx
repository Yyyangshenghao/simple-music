import { createRoot } from 'react-dom/client'
import './styles/global.css'
import './styles/scroll-gradients.css'
import App from './App'
import { startPlaybackRuntime } from './lib/playback-runtime'

const stopPlaybackRuntime = startPlaybackRuntime()
// beforeunload 的播放存档先保存最后状态，unload 再释放音频和订阅。
window.addEventListener('unload', stopPlaybackRuntime, { once: true })

createRoot(document.getElementById('root')!).render(<App />)
