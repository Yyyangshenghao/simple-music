import { useCallback, useEffect, useRef, useState } from 'react'
import { useToastStore } from '../../stores/toast'
import { useBackgroundStore } from '../../stores/background'
import {
  WALLPAPER_TYPE_LABELS,
  fetchWallpaperEngineLibrary,
  isPlayableWallpaper,
  setWallpaperEngineRoot,
  wallpaperEnginePreviewUrl,
  type WallpaperEngineLibrary
} from '../../lib/wallpaper-engine'
import type { WallpaperSelection } from '../../types/domain'
import styles from './WallpaperEnginePicker.module.css'

function errorMessage(code: string): string {
  if (code === 'WALLPAPER_DIR_INVALID') return '这个目录里没有 Wallpaper Engine 壁纸'
  if (code === 'REQUEST_TIMEOUT') return '读取壁纸库超时，请重试'
  if (code === 'WALLPAPER_SCAN_FAILED') return '读取壁纸库失败，请重试'
  return code
}

/**
 * Steam 订阅的 Wallpaper Engine 壁纸库。文件留在 Steam 目录里不复制，
 * 这里只做选择与预览；场景型由隔离页面渲染，应用型是独立程序，只显示封面。
 */
export function WallpaperEnginePicker({ selected }: { selected: WallpaperSelection | null }) {
  const setWallpaper = useBackgroundStore((s) => s.setWallpaper)
  const showToast = useToastStore((s) => s.show)
  const [library, setLibrary] = useState<WallpaperEngineLibrary | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  // 连续点「重新扫描」时丢弃过期响应，只让最后一次落地。
  const loadSession = useRef(0)

  const load = useCallback(async (task: () => Promise<WallpaperEngineLibrary>) => {
    const session = ++loadSession.current
    setLoading(true)
    try {
      const next = await task()
      if (session === loadSession.current) setLibrary(next)
    } catch (error) {
      if (session === loadSession.current) showToast(errorMessage((error as Error).message))
    } finally {
      if (session === loadSession.current) setLoading(false)
    }
  }, [showToast])

  useEffect(() => { void load(() => fetchWallpaperEngineLibrary()) }, [load])

  async function chooseDirectory(): Promise<void> {
    const picker = window.desktop?.selectDirectory
    if (!picker) return
    const result = await picker({ title: '选择 Wallpaper Engine 壁纸目录' })
    const path = result.filePath
    if (!result.ok || !path) return
    await load(() => setWallpaperEngineRoot(path))
  }

  const wallpapers = (library?.wallpapers ?? []).filter(item => {
    const keyword = query.trim().toLowerCase()
    return !keyword || item.title.toLowerCase().includes(keyword) || item.id.includes(keyword)
  })
  const customRoot = library?.customRoot ?? null
  const total = library?.wallpapers.length ?? 0
  const canChooseDirectory = !!window.desktop?.selectDirectory

  return (
    <div className={styles.picker}>
      <div className={styles.toolbar}>
        <input
          className={styles.search}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索壁纸"
          aria-label="搜索壁纸"
          spellCheck={false}
        />
        <button type="button" className={`${styles.button} no-drag`} disabled={loading} onClick={() => void load(() => fetchWallpaperEngineLibrary(true))}>
          {loading ? '扫描中…' : '重新扫描'}
        </button>
        {canChooseDirectory && <button type="button" className={`${styles.button} no-drag`} disabled={loading} onClick={() => void chooseDirectory()}>
          {customRoot ? '更改目录' : '选择目录'}
        </button>}
        {customRoot && <button type="button" className={`${styles.button} no-drag`} disabled={loading} onClick={() => void load(() => setWallpaperEngineRoot(null))}>
          自动检测
        </button>}
      </div>

      <p className={styles.status}>
        {loading && !library ? '正在读取 Steam 壁纸库…'
          : customRoot ? <span title={customRoot}>手动目录里的壁纸 · 共 {total} 张</span>
            : library && library.roots > 0 ? `来自 ${library.roots} 个 Steam 库 · 共 ${total} 张壁纸`
              : '没有检测到 Steam 壁纸库'}
      </p>

      {!loading && total === 0 && <p className={styles.empty}>
        {customRoot
          ? '这个目录里没有已订阅的壁纸。请在 Wallpaper Engine 中订阅后重新扫描，或改选 steamapps\\workshop\\content\\431960。'
          : '请确认已安装 Steam、在 Wallpaper Engine 中订阅了壁纸，或手动选择 steamapps\\workshop\\content\\431960 目录。'}
      </p>}

      {total > 0 && wallpapers.length === 0 && <p className={styles.empty}>没有标题包含「{query.trim()}」的壁纸。</p>}

      {wallpapers.length > 0 && <div className={styles.grid}>
        {wallpapers.map(item => {
          const label = WALLPAPER_TYPE_LABELS[item.type]
          const playable = isPlayableWallpaper(item.type)
          return <button
            key={item.id}
            type="button"
            className={styles.card}
            aria-pressed={selected?.id === item.id}
            title={`${item.title}（${label}${playable ? '' : '，仅封面'}）`}
            onClick={() => setWallpaper(item)}
          >
            {item.hasPreview
              ? <img className={styles.preview} src={wallpaperEnginePreviewUrl(item.id)} loading="lazy" alt="" draggable={false} />
              : <span className={`${styles.preview} ${styles.previewEmpty}`}>无预览图</span>}
            <span className={styles.cardTitle}>{item.title}</span>
            <span className={styles.cardMeta}>{label}{playable ? '' : ' · 仅封面'}</span>
          </button>
        })}
      </div>}

      <p className={styles.note}>视频、网页与场景型壁纸会作为应用背景播放；场景型在隔离页面中渲染，选中后可调整帧率、画质与交互。应用型只显示封面。壁纸文件留在 Steam 目录中，取消订阅后需要重新选择。</p>
    </div>
  )
}
