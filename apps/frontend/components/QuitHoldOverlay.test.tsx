// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { QuitHoldOverlay } from './QuitHoldOverlay'
import type { QuitHoldState } from '../electron/main/quit-guard'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  delete window.quitHold
})

it('shows progress, short-hold feedback, and removes the subscription', () => {
  vi.useFakeTimers()
  let listener: (state: QuitHoldState) => void = () => undefined
  const unsubscribe = vi.fn()
  window.quitHold = { onQuitHoldState: (callback) => { listener = callback; return unsubscribe } }
  const view = render(<QuitHoldOverlay />)
  act(() => listener({ phase: 'start' }))
  expect(screen.getByRole('status').textContent).toContain('按住 ⌘Q 退出')
  act(() => listener({ phase: 'too-short', heldMs: 200 }))
  expect(screen.getByRole('status').textContent).toContain('松开太早——按住 ⌘Q 才能退出')
  act(() => vi.advanceTimersByTime(800))
  expect(screen.queryByRole('status')).toBeNull()
  act(() => listener({ phase: 'start' }))
  act(() => listener({ phase: 'end' }))
  expect(screen.queryByRole('status')).toBeNull()
  view.unmount()
  expect(unsubscribe).toHaveBeenCalledOnce()
})

it('keeps a new hold visible when an earlier short-hold message expires', () => {
  vi.useFakeTimers()
  let listener: (state: QuitHoldState) => void = () => undefined
  window.quitHold = { onQuitHoldState: (callback) => { listener = callback; return () => undefined } }
  render(<QuitHoldOverlay />)
  act(() => listener({ phase: 'too-short' }))
  act(() => listener({ phase: 'start' }))
  act(() => vi.advanceTimersByTime(800))
  expect(screen.getByRole('status').textContent).toContain('按住 ⌘Q 退出')
})
