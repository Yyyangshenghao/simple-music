import { useState } from 'react'
import { useProviderStore } from '../../stores/providers'
import { resolveContentProvider } from '../../lib/content-provider-preference'
import { supportsPlatformPlaylists } from '../../lib/platform-playlists'
import { SOURCE_BRAND } from '../../lib/source-brand'
import type { MusicSource } from '../../types/domain'
import type { ProviderId } from '../../providers/types'
import type { WritablePlaylistSource } from '../../types/platform-playlist'
import { AppPlaylistPicker, playlistContextSubtitle, type AddTracksProps } from './AppPlaylistDialog'
import { PlatformPlaylistPicker } from './PlatformPlaylistDialog'
import { NameDialog, nameDialogStyles as nameStyles } from './NameDialog'

type Target = 'app' | 'platform'

/** 平台歌单页签：跟随当前内容平台；不可写时给出原因而不是隐藏入口。 */
export function platformTarget(platform: ProviderId | null, sources: MusicSource[], allowPlatform: boolean): { source: WritablePlaylistSource | null; label: string; unavailable: string } {
  const label = platform ? `${SOURCE_BRAND[platform].label}歌单` : '平台歌单'
  if (!allowPlatform) return { source: null, label, unavailable: '离线列表只能加入应用歌单' }
  if (!platform) return { source: null, label, unavailable: '登录音乐平台后可加入平台歌单' }
  if (!supportsPlatformPlaylists(platform)) return { source: null, label, unavailable: `${SOURCE_BRAND[platform].label}暂不支持加入平台歌单` }
  const brand = SOURCE_BRAND[platform].label
  if (sources.some(source => source !== platform)) return { source: platform, label, unavailable: `只能把${brand}的歌曲加入${label}，其他平台的歌曲请加入应用歌单` }
  return { source: platform, label, unavailable: '' }
}

/**
 * 统一的「加入歌单」弹窗：单曲与多选共用，在应用歌单与当前内容平台的歌单之间切换。
 * 平台不可写或歌曲来源不符时仍保留入口，并说明原因。
 */
export function AddToPlaylistDialog({ contextLabel, sources, allowPlatform = true, ...props }: AddTracksProps & {
  contextLabel?: string
  /** 已知的歌曲/集合来源；不传时按 tracks 推断。 */
  sources?: MusicSource[]
  allowPlatform?: boolean
}) {
  const platform = useProviderStore(state => resolveContentProvider(state.contentSource, state.byId, false))
  const [target, setTarget] = useState<Target>('app')
  const { source: platformSource, label: platformLabel, unavailable } = platformTarget(platform, sources ?? props.tracks?.map(track => track.source) ?? [], allowPlatform)

  return <NameDialog title="加入歌单" subtitle={playlistContextSubtitle(contextLabel, props.tracks)} className={nameStyles.picker} onClose={props.onClose}>
    <div className={nameStyles.tabs} role="tablist" aria-label="歌单类型">
      {([['app', '应用歌单'], ['platform', platformLabel]] as const).map(([value, label]) =>
        <button key={value} type="button" role="tab" aria-selected={target === value} onClick={() => setTarget(value)}>{label}</button>)}
    </div>
    {target === 'app' ? <AppPlaylistPicker key="app" {...props} />
      : unavailable || !platformSource ? <>
        <p className={nameStyles.empty} role="status">{unavailable}</p>
        <div className={nameStyles.actions}><button type="button" className={nameStyles.ghost} onClick={props.onClose}>取消</button></div>
      </>
        : <PlatformPlaylistPicker key={platformSource} source={platformSource} loadTracks={props.loadTracks} onClose={props.onClose} onDone={props.onDone} />}
  </NameDialog>
}
