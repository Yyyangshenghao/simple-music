import { useState } from 'react'
import { useToastStore } from '../../stores/toast'
import type { Track } from '../../types/domain'
import { ActionButton } from './ActionButton'

/** 只传索引 ID，由主进程解析原文件路径，不从播放 URL 推断目录。 */
export function LocalTrackFolderButton({ track }: { track: Track }) {
  const [busy, setBusy] = useState(false)
  async function reveal() {
    if (busy || !window.desktop?.revealLocalTrack) return
    setBusy(true)
    try {
      const result = await window.desktop.revealLocalTrack(String(track.id))
      if (!result.ok) useToastStore.getState().show('无法定位歌曲文件，文件可能已移动或删除，请重新导入文件夹')
    } catch {
      useToastStore.getState().show('打开文件夹失败，请重试')
    } finally { setBusy(false) }
  }
  return <ActionButton label={`打开文件夹：${track.name}`} title="在文件夹中显示歌曲" icon="folder" iconOnly
    disabled={typeof window === 'undefined' || !window.desktop?.revealLocalTrack} busy={busy} onClick={() => void reveal()} />
}
