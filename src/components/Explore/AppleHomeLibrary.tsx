import { useEffect, useState } from 'react'
import { requestProviderData } from '../../lib/provider-request-cache'
import { providerFor } from '../../providers/registry'
import type { Playlist } from '../../types/domain'
import { PlaylistCard } from './PlaylistCard'
import styles from './AppleHomeLibrary.module.css'

interface AppleHomeLibraryProps {
  onOpen(playlist: Playlist): void
}

export function AppleHomeLibrary({ onOpen }: AppleHomeLibraryProps) {
  const [liked, setLiked] = useState<Playlist | null>(null)
  const [albums, setAlbums] = useState<Playlist[]>([])

  useEffect(() => {
    let cancelled = false
    const library = providerFor('apple').library
    setLiked(null)
    setAlbums([])
    if (library?.getLikedPlaylist) {
      void requestProviderData('apple', 'library:liked-playlist', library.getLikedPlaylist)
        .then((playlist) => { if (!cancelled) setLiked(playlist) })
        .catch(() => {})
    }
    if (library?.getUserAlbums) {
      void requestProviderData('apple', 'library:user-albums', library.getUserAlbums)
        .then((items) => { if (!cancelled) setAlbums(items.slice(0, 8)) })
        .catch(() => {})
    }
    return () => { cancelled = true }
  }, [])

  if (!liked && albums.length === 0) return null

  return (
    <div className={styles.library} aria-label="Apple Music 个人资料库精选">
      {liked && (
        <button type="button" className={`${styles.favorite} no-drag`} onClick={() => onOpen(liked)}>
          <span className={styles.favoriteIcon} aria-hidden="true">♥</span>
          <span className={styles.favoriteText}>
            <strong>{liked.name}</strong>
            {liked.trackCountKnown !== false && <span className={styles.favoriteMeta}>{liked.trackCount} 首歌曲</span>}
          </span>
          <span className={styles.arrow} aria-hidden="true">↗</span>
        </button>
      )}
      {albums.length > 0 && (
        <section className={styles.albums} aria-label="你的 Apple Music 专辑">
          <div className={styles.heading}>
            <h3>你的专辑</h3>
          </div>
          <div className={styles.row}>
            {albums.map((album) => (
              <div className={styles.album} key={String(album.id)}>
                <PlaylistCard playlist={album} meta="" onClick={() => onOpen(album)} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
