import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { create } from 'zustand'
import { api } from '../../lib/api'
import { refreshKugouAccount } from '../../lib/provider-login'
import { springSnappy } from '../../lib/motion-presets'
import { useToastStore } from '../../stores/toast'
import { CloseIcon } from '../ui/CloseIcon'
import styles from './KugouLoginDialog.module.css'

interface KugouLoginDialogState {
  open: boolean
  show(): void
  hide(): void
}

/** 扫码浮层只在当前窗口显示；登录结果由播放宿主向 server 核实。 */
export const useKugouLoginDialog = create<KugouLoginDialogState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}))

type Phase = 'loading' | 'waiting' | 'scanned' | 'expired' | 'failed'

const POLL_MS = 2000

function KugouQrPanel({ onDone }: { onDone(): void }) {
  const [qr, setQr] = useState<{ key: string; image: string } | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    setQr(null)
    setPhase('loading')
    const poll = async (key: string) => {
      try {
        const res = await api.get<{ status?: string }>('/api/kugou/login/qr/check', { key })
        if (cancelled) return
        if (res.status === 'confirmed') {
          await refreshKugouAccount()
          if (cancelled) return
          useToastStore.getState().show('酷狗音乐已登录')
          onDone()
          return
        }
        if (res.status === 'expired') { setPhase('expired'); return }
        setPhase(res.status === 'scanned' ? 'scanned' : 'waiting')
      } catch {
        if (cancelled) return
      }
      timer = setTimeout(() => void poll(key), POLL_MS)
    }
    api.post<{ key?: string; image?: string }>('/api/kugou/login/qr')
      .then((res) => {
        if (cancelled) return
        if (!res.key || !res.image) { setPhase('failed'); return }
        setQr({ key: res.key, image: res.image })
        setPhase('waiting')
        timer = setTimeout(() => void poll(res.key!), POLL_MS)
      })
      .catch(() => { if (!cancelled) setPhase('failed') })
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [attempt, onDone])

  const stale = phase === 'expired' || phase === 'failed'
  const status = {
    loading: '正在生成二维码',
    waiting: '打开酷狗音乐 App 扫一扫',
    scanned: '已扫码，请在手机上确认登录',
    expired: '二维码已过期',
    failed: '二维码生成失败，请检查网络',
  }[phase]

  return (
    <>
      <div className={styles.qrFrame} data-stale={stale || undefined} data-scanned={phase === 'scanned' || undefined}>
        {qr ? <img src={qr.image} alt="酷狗音乐登录二维码" draggable={false} /> : <span className={styles.spinner} aria-hidden="true" />}
        {stale && (
          <button type="button" className={`${styles.refresh} no-drag`} onClick={() => setAttempt((n) => n + 1)}>
            刷新二维码
          </button>
        )}
      </div>
      {/* 状态行固定占位，切换文案不挤动布局。 */}
      <p className={styles.status} aria-live="polite">{status}</p>
      <p className={styles.hint}>登录后可播放账号权益内的整曲与高音质，并读取我的歌单</p>
    </>
  )
}

export function KugouLoginDialog() {
  const open = useKugouLoginDialog((state) => state.open)
  const hide = useKugouLoginDialog((state) => state.hide)

  useEffect(() => {
    if (!open) return
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.isComposing) hide() }
    // 全局快捷键会拦截冒泡阶段的按键，与其他浮层一样在捕获阶段处理 Esc。
    window.addEventListener('keydown', escape, true)
    return () => window.removeEventListener('keydown', escape, true)
  }, [open, hide])

  if (typeof document === 'undefined') return null
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div key="kugou-login" className={`${styles.backdrop} no-drag`} onPointerDown={(event) => { if (event.target === event.currentTarget) hide() }}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
          <motion.div className={styles.dialog} role="dialog" aria-modal="true" aria-label="登录酷狗音乐"
            initial={{ opacity: 0, scale: 0.96, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }} transition={springSnappy}>
            <header className={styles.header}>
              <strong>登录酷狗音乐</strong>
              <button type="button" className={`${styles.close} no-drag`} aria-label="关闭" title="关闭" onClick={hide}><CloseIcon /></button>
            </header>
            <KugouQrPanel onDone={hide} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
