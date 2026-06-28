interface ArtistPageProps { id: unknown; source: 'netease' | 'qq' }
export function ArtistPage({ id, source }: ArtistPageProps) {
  return <div style={{ padding: 24, color: 'var(--sm-text-primary)' }}>歌手页 {String(id)} {source}（开发中）</div>
}
