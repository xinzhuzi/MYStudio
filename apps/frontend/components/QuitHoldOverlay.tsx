import { useEffect, useState } from 'react'
import type { QuitHoldState } from '../electron/main/quit-guard'

declare global {
  interface Window {
    quitHold?: { onQuitHoldState: (listener: (state: QuitHoldState) => void) => () => void }
  }
}

export function QuitHoldOverlay() {
  const [state, setState] = useState<QuitHoldState | null>(null)
  const [sequence, setSequence] = useState(0)

  useEffect(() => window.quitHold?.onQuitHoldState((next) => {
    setState(next.phase === 'end' ? null : next)
    if (next.phase === 'start') setSequence((previous) => previous + 1)
  }), [])

  useEffect(() => {
    if (state?.phase !== 'too-short') return
    const timer = setTimeout(() => setState(null), 800)
    return () => clearTimeout(timer)
  }, [state])

  if (!state) return null
  return (
    <div className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center" role="status" aria-live="polite">
      <div className="w-64 rounded-xl border border-border bg-background px-5 py-4 text-center text-sm text-foreground shadow-lg">
        <div>{state.phase === 'too-short' ? '松开太早——按住 ⌘Q 才能退出' : '按住 ⌘Q 退出'}</div>
        {state.phase === 'start' && (
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted">
            <div key={sequence} className="h-full bg-primary" style={{ animation: 'quit-hold-progress 1s linear forwards' }} />
          </div>
        )}
      </div>
      <style>{'@keyframes quit-hold-progress { from { width: 0% } to { width: 100% } }'}</style>
    </div>
  )
}
