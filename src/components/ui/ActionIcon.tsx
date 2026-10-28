export type ActionIconName = 'play' | 'pause' | 'refresh' | 'settings' | 'folder' | 'queue' | 'delete' | 'close' | 'more'

/** 库工具栏与任务队列共用的操作图标。 */
export function ActionIcon({ name, size = 16 }: { name: ActionIconName; size?: number }) {
  return <svg data-action-icon={name} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'play' && <path d="m9 5 10 7-10 7z" />}
    {name === 'pause' && <path d="M8 5v14M16 5v14" />}
    {name === 'refresh' && <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />}
    {name === 'settings' && <><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /><circle cx="12" cy="12" r="3" /></>}
    {name === 'folder' && <path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7h18" />}
    {name === 'queue' && <><path d="M4 5h16M4 10h10M4 15h8" /><path d="m17 13 5 4-5 4z" /></>}
    {name === 'delete' && <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />}
    {name === 'more' && <><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></>}
    {name === 'close' && <path d="m6 6 12 12M18 6 6 18" />}
  </svg>
}
