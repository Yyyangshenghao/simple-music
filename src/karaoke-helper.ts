import { createKaraokeSeparator } from './lib/karaoke/separator'
import type { KaraokeHelperBridge } from '../electron/preload/karaoke-helper'

/** K 歌分离进程的页面：接收宿主转来的任务，在独立实例内调度原生 GPU 或浏览器推理。 */
const bridge = (window as unknown as { karaokeHelper: KaraokeHelperBridge }).karaokeHelper
const separator = createKaraokeSeparator()
const jobs = new Map<string, AbortController>()

bridge.onCommand((command) => {
  if (command.type === 'cancel') {
    jobs.get(command.id)?.abort()
    return
  }
  if (command.type !== 'separate') return
  const { id } = command
  const controller = new AbortController()
  jobs.set(id, controller)
  separator.separate(command.model, command.key, command.src, p => bridge.emit({ type: 'progress', id, ...p }), controller.signal).then(
    url => bridge.emit({ type: 'done', id, url }),
    (error: unknown) => bridge.emit({
      type: 'error',
      id,
      message: (error instanceof Error ? error.message : String(error)).slice(0, 2048),
      aborted: error instanceof DOMException && error.name === 'AbortError',
    }),
  ).finally(() => jobs.delete(id))
})
bridge.ready()
