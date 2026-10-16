import { useState } from 'react'
import { AppPlaylistModal } from './AppPlaylistDialog'
import type { PlaylistSyncSnapshot } from '../../types/playlist-sync'
import type { planPlaylistSyncMerge } from '../../lib/playlist-sync-merge'
import dialogStyles from './AppPlaylistDialog.module.css'
import styles from './AppPlaylistSync.module.css'

type Choices = Record<string, 'local' | 'cloud'>
type Conflict = ReturnType<typeof planPlaylistSyncMerge>['conflicts'][number]

export function AppPlaylistSyncDialog({ local, cloud, conflicts, songName, busy, onClose, onSubmit }: {
  local: PlaylistSyncSnapshot; cloud: PlaylistSyncSnapshot; conflicts: Conflict[]; songName(id: string): string
  busy: boolean; onClose(): void; onSubmit(choices: Choices): void
}) {
  const [choices, setChoices] = useState<Choices>({})
  const tracks = (snapshot: PlaylistSyncSnapshot) => snapshot.tracks.map(track => songName(track.id)).join('、') || '没有歌曲'
  return <AppPlaylistModal title="选择冲突内容" onClose={onClose}>
    <p className={dialogStyles.hint}>独立更改会自动合并，以下内容需要选择保留哪一端。</p>
    <form className={styles.conflictForm} onSubmit={event => { event.preventDefault(); if (!busy && conflicts.every(conflict => choices[conflict.id])) onSubmit(choices) }}>
      {conflicts.map(conflict => {
        const title = conflict.kind === 'name' ? '歌单名称' : conflict.kind === 'order' ? '歌曲顺序' : `歌曲：${songName(conflict.trackId ?? '')}`
        const content = (snapshot: PlaylistSyncSnapshot) => conflict.kind === 'name' ? snapshot.name : conflict.kind === 'order' ? tracks(snapshot)
          : snapshot.tracks.some(track => track.id === conflict.trackId) ? '保留这首歌曲' : '移除这首歌曲'
        return <fieldset className={styles.conflict} key={conflict.id} disabled={busy}>
          <legend>{title}</legend>
          {(['local', 'cloud'] as const).map(side => <label key={side} className={styles.choice}>
            <input type="radio" name={conflict.id} checked={choices[conflict.id] === side} onChange={() => setChoices(current => ({ ...current, [conflict.id]: side }))} />
            <span><strong>{side === 'local' ? '保留应用' : '采用云端'}</strong><span>{content(side === 'local' ? local : cloud)}</span></span>
          </label>)}
        </fieldset>
      })}
      <div className={dialogStyles.actions}>
        <button type="button" disabled={busy} onClick={onClose}>取消</button>
        <button className={dialogStyles.primary} type="submit" disabled={busy || conflicts.some(conflict => !choices[conflict.id])}>{busy ? '正在合并…' : '确认并合并'}</button>
      </div>
    </form>
  </AppPlaylistModal>
}
