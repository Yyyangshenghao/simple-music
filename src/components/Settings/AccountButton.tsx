import styles from './AccountButton.module.css'

interface AccountButtonProps {
  label: string
  exit?: boolean
  busy?: boolean
  disabled?: boolean
  onClick(): void
}

/** 音源账户行中的登录、退出及取消授权入口。 */
export function AccountButton({ label, exit = false, busy = false, disabled, onClick }: AccountButtonProps) {
  return (
    <button
      type="button"
      className={`${styles.button} no-drag`}
      aria-label={label}
      title={label}
      disabled={disabled || busy}
      onClick={onClick}
    >
      {busy ? <span className={styles.spinner} aria-hidden="true" /> : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M13 5h5a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5" />
          {exit ? <path d="m8 8-4 4 4 4M4 12h12" /> : <path d="m12 8 4 4-4 4M16 12H4" />}
        </svg>
      )}
    </button>
  )
}
