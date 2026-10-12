import { createRoot } from 'react-dom/client'
import './styles/global.css'
import './styles/scroll-gradients.css'
import App from './App'
import { startPlaybackCore } from './stores/player'

const disposePlaybackCore = startPlaybackCore()
// beforeunload 的播放存档先保存最后状态，unload 再释放音频和订阅。
window.addEventListener('unload', disposePlaybackCore, { once: true })

createRoot(document.getElementById('root')!).render(<App />)
