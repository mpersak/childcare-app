import { useEffect, useRef, useState } from 'react'

/**
 * A numeric keypad sized for a thumb. Submits as soon as enough digits are in.
 *
 * Digits are appended with a functional state update, not `value + d`: two taps
 * inside one React batch — easy to produce on a tablet — would otherwise read
 * the same stale `value` and collapse into a single digit.
 */
export function PinPad({ onSubmit, busy, error, digits = 4, autoSubmit = true }: {
  onSubmit(pin: string): void
  busy?: boolean
  error?: string
  digits?: number
  autoSubmit?: boolean
}) {
  const [value, setValue] = useState('')
  const submitted = useRef('')

  const press = (d: string) => {
    if (busy) return
    setValue(prev => (prev + d).slice(0, 8))
  }

  // Submitting from an effect keeps the state updater pure, so StrictMode's
  // double invocation cannot fire the attempt twice.
  useEffect(() => {
    if (!autoSubmit || busy) return
    if (value.length < digits) return
    if (submitted.current === value) return
    submitted.current = value
    onSubmit(value)
  }, [value, autoSubmit, busy, digits, onSubmit])

  // A fresh error means that attempt failed; clear the pad ready for another.
  useEffect(() => {
    if (error) setValue('')
  }, [error])

  return (
    <div className="pinpad-body">
      <div className="pin-dots" aria-label={`${value.length} digits entered`}>
        {Array.from({ length: Math.max(digits, value.length) }, (_, i) => (
          <span key={i} className={i < value.length ? 'pin-dot on' : 'pin-dot'} />
        ))}
      </div>

      {error && <p className="lock-error">{error}</p>}

      <div className="pinpad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
          <button key={d} type="button" className="pin-key" onClick={() => press(d)}>{d}</button>
        ))}
        <button type="button" className="pin-key subtle" onClick={() => setValue('')}>clear</button>
        <button type="button" className="pin-key" onClick={() => press('0')}>0</button>
        <button type="button" className="pin-key subtle"
                onClick={() => setValue(v => v.slice(0, -1))}>←</button>
      </div>

      {!autoSubmit && (
        <button type="button" className="btn primary big"
                disabled={busy || value.length < digits} onClick={() => onSubmit(value)}>
          {busy ? 'Working…' : 'Unlock'}
        </button>
      )}
    </div>
  )
}
