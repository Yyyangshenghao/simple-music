import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { create } from 'zustand'
import { QR_LOGIN_ADAPTERS, type QrLoginMethod, type QrLoginSource, type QrLoginTicket } from '../../lib/qr-login'
import { loginMusicProvider } from '../../lib/provider-login'
import { springSnappy } from '../../lib/motion-presets'
import { SOURCE_BRAND } from '../../lib/source-brand'
import { useToastStore } from '../../stores/toast'
import { CloseIcon } from '../ui/CloseIcon'
import styles from './QrLoginDialog.module.css'

interface QrLoginDialogState {
  source: QrLoginSource | null
  show(source: QrLoginSource): void
  hide(): void
}

/** 扫码浮层只在当前窗口显示；账号切换仍由播放宿主完成。 */
export const useQrLoginDialog = create<QrLoginDialogState>((set) => ({
  source: null,
  show: (source) => set({ source }),
  hide: () => set({ source: null }),
}))

type Phase = 'loading' | 'waiting' | 'scanned' | 'expired' | 'failed' | 'completing'

const POLL_MS = 2000

function QrPanel({ source, onDone }: { source: QrLoginSource; onDone(): void }) {
  const adapter = QR_LOGIN_ADAPTERS[source]
  const [method, setMethod] = useState<QrLoginMethod>(adapter.methods[0].id)
  const [image, setImage] = useState('')
  const [phase, setPhase] = useState<Phase>('loading')
  const [message, setMessage] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let scanned = false
    setImage('')
    setPhase('loading')
    setMessage('')

    const finish = async (result: Parameters<typeof adapter.complete>[0]) => {
      setPhase('completing')
      try {
        await adapter.complete(result)
        if (cancelled) return
        useToastStore.getState().show(`${SOURCE_BRAND[source].label}已登录`)
        onDone()
      } catch {
        if (cancelled) return
        setPhase('failed')
        setMessage('登录信息同步失败，请重试')
      }
    }

    const poll = async (ticket: QrLoginTicket) => {
      try {
        const res = await adapter.poll(ticket, method, scanned)
        if (cancelled) return
        if (res.image) setImage(res.image)
        if (res.status === 'confirmed') { await finish(res); return }
        if (res.status === 'expired') { setPhase('expired'); return }
        if (res.status === 'failed') { setPhase('failed'); setMessage(res.message || ''); return }
        scanned = res.status === 'scanned'
        setPhase(scanned ? 'scanned' : 'waiting')
      } catch {
        // 单次网络失败继续轮询，二维码过期由上游状态决定。
        if (cancelled) return
      }
      timer = setTimeout(() => void poll(ticket), POLL_MS)
    }

    adapter.start(method)
      .then((ticket) => {
        if (cancelled) return
        if (ticket.status === 'confirmed') { void finish(ticket); return }
        if (ticket.status === 'failed' || !ticket.image) { setPhase('failed'); setMessage(ticket.message || ''); return }
        setImage(ticket.image)
        setPhase('waiting')
        timer = setTimeout(() => void poll(ticket), POLL_MS)
      })
      .catch(() => { if (!cancelled) setPhase('failed') })
    return () => {
      cancelled = true
      clearTimeout(timer)
      adapter.cancel?.()
    }
  }, [adapter, attempt, method, onDone, source])

  const stale = phase === 'expired' || phase === 'failed'
  const status = {
    loading: '正在生成二维码',
    waiting: `打开${adapter.scanner(method)}扫一扫`,
    scanned: '已扫码，请在手机上确认登录',
    completing: '正在登录…',
    expired: '二维码已过期',
    failed: message || '二维码生成失败，请检查网络',
  }[phase]

  const openWeb = () => {
    onDone()
    if (source === 'kugou') return
    loginMusicProvider(source).catch(() => useToastStore.getState().show('登录失败，请重试'))
  }

  return (
    <>
      {adapter.methods.length > 1 && (
        <div className={styles.methods} role="tablist" aria-label="扫码方式">
          {adapter.methods.map((item) => (
            <button key={item.id} type="button" role="tab" aria-selected={item.id === method}
              className={`${styles.method} no-drag`} data-active={item.id === method || undefined}
              onClick={() => setMethod(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      )}
      <div className={styles.qrFrame} data-stale={stale || undefined} data-scanned={phase === 'scanned' || phase === 'completing' || undefined}>
        {image ? <img src={image} alt={`${adapter.title}二维码`} draggable={false} /> : <span className={styles.spinner} aria-hidden="true" />}
        {stale && (
          <button type="button" className={`${styles.refresh} no-drag`} onClick={() => setAttempt((n) => n + 1)}>
            刷新二维码
          </button>
        )}
      </div>
      {/* 状态行固定占位，切换文案不挤动布局。 */}
      <p className={styles.status} aria-live="polite">{status}</p>
      {adapter.hint && <p className={styles.hint}>{adapter.hint}</p>}
      {adapter.webFallback && (
        <button type="button" className={`${styles.fallback} no-drag`} onClick={openWeb}>用网页登录</button>
      )}
    </>
  )
}

export function QrLoginDialog() {
  const source = useQrLoginDialog((state) => state.source)
  const hide = useQrLoginDialog((state) => state.hide)

  useEffect(() => {
    if (!source) return
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.isComposing) hide() }
    // 全局快捷键会拦截冒泡阶段的按键，与其他浮层一样在捕获阶段处理 Esc。
    window.addEventListener('keydown', escape, true)
    return () => window.removeEventListener('keydown', escape, true)
  }, [source, hide])

  if (typeof document === 'undefined') return null
  const adapter = source ? QR_LOGIN_ADAPTERS[source] : null
  return createPortal(
    <AnimatePresence>
      {source && adapter && (
        <motion.div key="qr-login" className={`${styles.backdrop} no-drag`} onPointerDown={(event) => { if (event.target === event.currentTarget) hide() }}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
          <motion.div className={styles.dialog} role="dialog" aria-modal="true" aria-label={adapter.title}
            initial={{ opacity: 0, scale: 0.96, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }} transition={springSnappy}>
            <header className={styles.header}>
              <strong>{adapter.title}</strong>
              <button type="button" className={`${styles.close} no-drag`} aria-label="关闭" title="关闭" onClick={hide}><CloseIcon /></button>
            </header>
            <QrPanel key={source} source={source} onDone={hide} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
