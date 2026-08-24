import type { SystemFontFamily } from '../types/ipc'

export function filterFontFamilies(fonts: SystemFontFamily[], query: string): SystemFontFamily[] {
  const keyword = query.trim().toLocaleLowerCase()
  if (!keyword) return fonts
  return fonts.filter((font) => (
    font.family.toLocaleLowerCase().includes(keyword)
    || font.localizedName?.toLocaleLowerCase().includes(keyword)
  ))
}
