import { useState } from 'react'

/** A numeric keypad sized for a thumb. Submits as soon as four digits are in. */
export function PinPad({ onSubmit, busy, error, digits = 4, autoSubmit = true }: {
  onSubmit(pin: string): void
  busy?: boolean
  error?: string
  digits?: number
  autoSubmit?: boolean
}) {
  const [value, setValue] = useState('')

  const press = (d: string) => {
    if (busy) return
    const next = (value + d).slice(0, 8)
    setValue(next)
    if (autoSubmit && next.length >= digits) {
      onSubmit(next)
      // Clear so a failed attempt does not leave stale digits behind.
      setTimeout(() => setValue(''), 250)
    }
  }

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
                onClick={() => setValue(value.slice(0, -1))}>←</button>
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
