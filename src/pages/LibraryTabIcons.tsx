import type { ReactNode } from 'react'

function Glyph({ children }: { children: ReactNode }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
}

/** 我的库分类图标：线性 20px，跟随文字颜色。 */
export const LIBRARY_TAB_ICONS: Record<string, ReactNode> = {
  'app-playlists': <Glyph><path d="M3 6h11M3 12h8M3 18h6" /><path d="M18 4l1 2.4 2.4 1-2.4 1L18 10.8l-1-2.4-2.4-1 2.4-1z" /><path d="M15 18a2 2 0 1 0 4 0v-5" /></Glyph>,
  playlists: <Glyph><path d="M3 6h12M3 12h12M3 18h7" /><circle cx="17" cy="18" r="2.5" /><path d="M19.5 18V9l2 1" /></Glyph>,
  favorites: <Glyph><path d="M7 4h10v16l-5-3.6L7 20z" /></Glyph>,
  recent: <Glyph><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Glyph>,
  offline: <Glyph><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" /><path d="M5 19h14" /></Glyph>,
  local: <Glyph><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h7.5A2.5 2.5 0 0 1 21 10v6.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5z" /></Glyph>,
}
