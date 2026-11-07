import { useEffect, useState } from 'react'
import { bilibiliLinkMessage, parseBilibiliLink } from '../lib/bilibili-link'
import { bilibiliService } from '../providers/bilibili-provider'
import { providerAccountSession } from '../lib/provider-account-session'
import { useProviderStore, type ProviderRuntimeState } from '../stores/providers'
import { useNavigationStore } from '../stores/navigation'
import { usePlaylistStore } from '../stores/playlist'
import { anchorOf, useTrackActionsStore } from '../stores/track-actions'
import { bilibiliVideoTitle } from '../lib/bilibili-track-display'
import { formatDuration } from '../lib/format-duration'
import { sizedImage } from '../lib/image-size'
import type { Track } from '../types/domain'
import { ScrollArea } from '../components/ui/ScrollArea'
import { BackButton } from '../components/ui/BackButton'
import { SourceBadge } from '../components/ui/SourceBadge'
import { ActionButton } from '../components/ui/ActionButton'
import { PlaylistCoverFallback } from '../components/ui/PlaylistCoverFallback'
import layout from './ToplistPage.module.css'
import styles from './BilibiliVideoPage.module.css'

interface VideoResult {
  bvid: string
  runtime: ProviderRuntimeState
  session: number
  track: Track
}

export function BilibiliVideoPage({ input }: { input: string }) {
  const parsed = parseBilibiliLink(input)
  const bvid = parsed?.kind === 'video' ? parsed.bvid : null
  const runtime = useProviderStore(state => state.byId.bilibili)
  const session = useProviderStore(() => providerAccountSession('bilibili'))
  const [result, setResult] = useState<VideoResult | null>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(!!bvid && runtime.enabled)
  const [revision, setRevision] = useState(0)
  const track = result?.bvid === bvid && result.runtime === runtime && result.session === session ? result.track : null
  const title = track ? bilibiliVideoTitle(track) : '视频音频'
  const uploader = track && (typeof track.uploader === 'string' ? track.uploader : track.artist)

  useEffect(() => {
    const controller = new AbortController()
    setResult(null)
    setFailed(false)
    setLoading(!!bvid && runtime.enabled)
    if (bvid && runtime.enabled) {
      void bilibiliService.getVideoTrack(bvid, controller.signal)
        .then(value => {
          if (!controller.signal.aborted && useProviderStore.getState().byId.bilibili === runtime && providerAccountSession('bilibili') === session) {
            setResult({ bvid, runtime, session, track: value })
          }
        })
        .catch(() => { if (!controller.signal.aborted) setFailed(true) })
        .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }
    return () => controller.abort()
  }, [bvid, runtime, session, revision])

  function openSettings() {
    const navigation = useNavigationStore.getState()
    navigation.requestSettingsMusic()
    navigation.navigateTo('settings')
  }

  return <ScrollArea className={layout.page}>
    <BackButton autoHide={false} iconOnly className={layout.back} ariaLabel="返回上一页" onClick={() => useNavigationStore.getState().goBack()} />
    {!track && <h1 className={layout.heading}>{title}<SourceBadge source="bilibili" reveal /></h1>}
    <section className={`${layout.group} ${styles.content}`} aria-label="哔哩哔哩视频音频">
      {!parsed || parsed.kind === 'unsupported' ? <p className={styles.status}>{bilibiliLinkMessage(parsed?.kind === 'unsupported' ? parsed.reason : 'invalid-link')}</p>
        : !runtime.enabled ? <div className={styles.recovery}>
          <p>请先启用哔哩哔哩音源。</p>
          <ActionButton label="打开音源设置" onClick={openSettings} />
        </div> : <>
          {track && <div className={styles.video} onContextMenu={event => {
            event.preventDefault()
            useTrackActionsStore.getState().openMenu(track, { x: event.clientX, y: event.clientY, width: 0, height: 0 })
          }}>
            <div className={styles.artwork}>
              {track.cover ? <img src={sizedImage(track.cover, 512)} alt="" /> : <PlaylistCoverFallback name={title} source="bilibili" />}
            </div>
            <div className={styles.info}>
              <h1 className={styles.title}>{title}</h1>
              <div className={styles.identity}><SourceBadge source="bilibili" reveal />{uploader && <span>UP 主 · {uploader}</span>}{!!track.duration && <span>{formatDuration(track.duration)}</span>}</div>
              <p className={styles.videoId}>{bvid}</p>
              {Number(track.videoPartCount) > 1 && <p className={styles.status}>多集视频，仅播放第 1P 音频。</p>}
              {runtime.playbackAvailable === false && <p className={styles.status}>哔哩哔哩音频暂不可用，请到音源设置检查连接。</p>}
              <div className={styles.actions}>
                <ActionButton label="播放音频" icon="play" primary disabled={runtime.playbackAvailable === false} onClick={() => usePlaylistStore.getState().setQueue([track], 0)} />
                <ActionButton label="加入歌单" icon="add" iconOnly data-track-action-trigger aria-haspopup="dialog" onClick={event => useTrackActionsStore.getState().toggleQuickAdd(track, anchorOf(event.currentTarget))} />
                <ActionButton label="更多操作" icon="more" iconOnly data-track-action-trigger aria-haspopup="menu" onClick={event => useTrackActionsStore.getState().openMenu(track, anchorOf(event.currentTarget))} />
              </div>
            </div>
          </div>}
          {!track && loading && <p className={styles.status} role="status">正在读取视频…</p>}
          {failed && <div className={styles.recovery} role="status">
            <p>视频暂时无法读取，可能已失效或请求受限。</p>
            <ActionButton label="重试" disabled={loading} onClick={() => setRevision(value => value + 1)} />
          </div>}
        </>}
    </section>
  </ScrollArea>
}
