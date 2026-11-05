import { useEffect, useState } from 'react'
import { bilibiliLinkMessage, parseBilibiliLink } from '../lib/bilibili-link'
import { bilibiliService } from '../providers/bilibili-provider'
import { providerAccountSession } from '../lib/provider-account-session'
import { useProviderStore, type ProviderRuntimeState } from '../stores/providers'
import { useNavigationStore } from '../stores/navigation'
import { usePlaylistStore } from '../stores/playlist'
import type { Track } from '../types/domain'
import { ScrollArea } from '../components/ui/ScrollArea'
import { BackButton } from '../components/ui/BackButton'
import { SourceBadge } from '../components/ui/SourceBadge'
import { ActionButton } from '../components/ui/ActionButton'
import { TrackRow } from '../components/Explore/TrackRow'
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
  const [loading, setLoading] = useState(false)
  const [revision, setRevision] = useState(0)
  const track = result?.bvid === bvid && result.runtime === runtime && result.session === session ? result.track : null

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
    <BackButton className={layout.back} ariaLabel="返回上一页" onClick={() => useNavigationStore.getState().goBack()} />
    <h1 className={layout.heading}>视频音频<SourceBadge source="bilibili" reveal /></h1>
    <section className={`${layout.group} ${styles.content}`} aria-label="哔哩哔哩视频音频">
      {!parsed || parsed.kind === 'unsupported' ? <p className={styles.status}>{bilibiliLinkMessage(parsed?.kind === 'unsupported' ? parsed.reason : 'invalid-link')}</p>
        : !runtime.enabled ? <div className={styles.recovery}>
          <p>请先启用哔哩哔哩音源。</p>
          <ActionButton label="打开音源设置" onClick={openSettings} />
        </div> : <>
          {track && <>
            <div className={styles.heading}>
              <span className={styles.identity}>{bvid}</span>
              <ActionButton label="播放音频" icon="play" primary disabled={runtime.playbackAvailable === false} onClick={() => usePlaylistStore.getState().setQueue([track], 0)} />
            </div>
            {Number(track.videoPartCount) > 1 && <p className={styles.status}>多集视频，仅播放第 1P 音频。</p>}
            {runtime.playbackAvailable === false && <p className={styles.status}>哔哩哔哩音频暂不可用，请到音源设置检查连接。</p>}
            <TrackRow track={track} hideLikeAction hideOfflineAction hideSource disabled={runtime.playbackAvailable === false} onPlay={() => usePlaylistStore.getState().setQueue([track], 0)} />
          </>}
          {loading && <p className={styles.status} role="status">正在读取视频…</p>}
          {failed && <div className={styles.recovery} role="status">
            <p>视频暂时无法读取，可能已失效或请求受限。</p>
            <ActionButton label="重试" disabled={loading} onClick={() => setRevision(value => value + 1)} />
          </div>}
        </>}
    </section>
  </ScrollArea>
}
