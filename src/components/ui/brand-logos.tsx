// 平台图标统一用官方 App 图标的方形原图，由 .logo 统一裁成圆角方形：
// - 网易云音乐、酷狗音乐、汽水音乐：App Store 中国区官方上架图标（mzstatic.com）
// - QQ音乐、Apple Music：Google Play 官方上架图标（QQ 原图透明底，铺白底与 App Store 版一致）
// - 哔哩哔哩：官方 App 图标当前为活动版，改用官方 bilibili 字标（Wikimedia Commons「Bilibili 2023.svg」，公有领域）置于品牌粉 #FB7299 方底
// - Apple：Simple Icons（CC0），https://simpleicons.org/icons/apple（仅作 SourceName 里的文字标）
import styles from './brand-logos.module.css'

const neteaseUrl = new URL('../../assets/brand/netease.png', import.meta.url).href
const qqMusicUrl = new URL('../../assets/brand/qq-music.png', import.meta.url).href
const appleMusicUrl = new URL('../../assets/brand/apple-music.png', import.meta.url).href
const kugouUrl = new URL('../../assets/brand/kugou.png', import.meta.url).href
const qishuiUrl = new URL('../../assets/brand/qishui.png', import.meta.url).href
const bilibiliUrl = new URL('../../assets/brand/bilibili.svg', import.meta.url).href

function brandImage(src: string) {
  return function BrandLogo({ className }: { className?: string }) {
    return <img className={className ? `${styles.logo} ${className}` : styles.logo} src={src} alt="" aria-hidden="true" draggable={false} />
  }
}

export const NeteaseLogo = brandImage(neteaseUrl)
export const QQMusicLogo = brandImage(qqMusicUrl)
export const AppleMusicIcon = brandImage(appleMusicUrl)
export const KugouLogo = brandImage(kugouUrl)
export const QishuiLogo = brandImage(qishuiUrl)
export const BilibiliLogo = brandImage(bilibiliUrl)

export function AppleLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path fill="currentColor" d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04c-2.04.027-3.91 1.183-4.961 3.014c-2.117 3.675-.546 9.103 1.519 12.09c1.013 1.454 2.208 3.09 3.792 3.039c1.52-.065 2.09-.987 3.935-.987c1.831 0 2.35.987 3.96.948c1.637-.026 2.676-1.48 3.676-2.948c1.156-1.688 1.636-3.325 1.662-3.415c-.039-.013-3.182-1.221-3.22-4.857c-.026-3.04 2.48-4.494 2.597-4.559c-1.429-2.09-3.623-2.324-4.39-2.376c-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83c-1.207.052-2.662.805-3.532 1.818c-.78.896-1.454 2.338-1.273 3.714c1.338.104 2.715-.688 3.559-1.701" />
    </svg>
  )
}
