export interface SongComment {
  id: unknown
  content: string
  likedCount: number
  time: number
  user: { id: unknown; nickname: string; avatar: string } | null
}

export interface SongCommentsPage {
  comments: SongComment[]
  hotComments: SongComment[]
  total: number | null
  nextOffset?: number
}
