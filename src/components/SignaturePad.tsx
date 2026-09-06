import { useEffect, useRef, useState } from 'react'

/**
 * Full-screen signature capture for a parent at drop-off or pick-up.
 *
 * Drawn with pointer events so a finger, stylus and mouse all work the same way.
 * The canvas is sized to its own box at device pixel ratio, otherwise the stroke
 * looks soft on a phone.
 */
export interface SignerOption {
  id: string
  name: string
  relationship: string
}

export function SignaturePad({ title, subtitle, confirmLabel, people = [], onCancel, onConfirm }: {
  title: string
  subtitle?: string
  confirmLabel: string
  /** The child's guardians, offered as one-tap choices instead of typing. */
  people?: SignerOption[]
  onCancel(): void
  onConfirm(result: { dataUrl: string; name: string }): void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const dirty = useRef(false)
  const [hasInk, setHasInk] = useState(false)
  const [problem, setProblem] = useState('')

  const named = people.filter(p => p.name.trim())
  // One guardian is almost always the person at the door, so save them the tap.
  const [picked, setPicked] = useState<string>(() => (named.length === 1 ? named[0].id : ''))
  const [other, setOther] = useState('')
  const usingOther = picked === 'other' || named.length === 0
  const name = usingOther ? other.trim() : (named.find(p => p.id === picked)?.name ?? '')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const setup = () => {
      const rect = canvas.getBoundingClientRect()
      // Before layout settles the box can measure zero. Sizing the canvas to
      // that leaves a 0x0 bitmap that silently swallows the signature, so wait
      // for a real measurement — the observer below calls back when there is one.
      if (rect.width === 0 || rect.height === 0) return
      // Redrawing at a new size clears the canvas, so only resize before any ink.
      if (dirty.current) return

      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.scale(dpr, dpr)
      ctx.lineWidth = 2.4
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = getComputedStyle(canvas).color
    }

    setup()
    // Catches the first real layout, and a tablet being rotated.
    const observer = new ResizeObserver(setup)
    observer.observe(canvas)
    window.addEventListener('orientationchange', setup)
    return () => {
      observer.disconnect()
      window.removeEventListener('orientationchange', setup)
    }
  }, [])

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    dirty.current = true
    if (!hasInk) setHasInk(true)
    const p = point(e)
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    // A single tap should still leave a visible dot.
    ctx.lineTo(p.x + 0.01, p.y)
    ctx.stroke()
  }

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const p = point(e)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
  }

  const end = () => { drawing.current = false }

  const clear = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.restore()
    dirty.current = false
    setHasInk(false)
    setProblem('')
  }

  /**
   * Crops to the ink and scales down before export. A raw full-screen canvas is
   * hundreds of kilobytes; every signature is stored and synced, so this matters.
   */
  const flatten = (canvas: HTMLCanvasElement): string => {
    const ctx = canvas.getContext('2d')
    const { width, height } = canvas
    // A zero-sized bitmap would throw out of getImageData and lose the signature.
    if (!ctx || width === 0 || height === 0) return ''
    const { data } = ctx.getImageData(0, 0, width, height)

    let minX = width, minY = height, maxX = -1, maxY = -1
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 8) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    if (maxX < 0) return canvas.toDataURL('image/png')

    const pad = 8
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad)
    maxX = Math.min(width - 1, maxX + pad); maxY = Math.min(height - 1, maxY + pad)
    const cropW = maxX - minX + 1
    const cropH = maxY - minY + 1

    const MAX_W = 420
    const scale = Math.min(1, MAX_W / cropW)
    const out = document.createElement('canvas')
    out.width = Math.max(1, Math.round(cropW * scale))
    out.height = Math.max(1, Math.round(cropH * scale))
    const octx = out.getContext('2d')
    if (!octx) return canvas.toDataURL('image/png')
    // Flatten onto white so the stroke reads on any background it is shown against.
    octx.fillStyle = '#ffffff'
    octx.fillRect(0, 0, out.width, out.height)
    octx.drawImage(canvas, minX, minY, cropW, cropH, 0, 0, out.width, out.height)
    return out.toDataURL('image/png')
  }

  const confirm = () => {
    const canvas = canvasRef.current
    if (!canvas || !hasInk || !name) return
    const dataUrl = flatten(canvas)
    if (!dataUrl) {
      // Better to say so than to record a sign-in with no signature behind it.
      setProblem('The signature could not be captured. Please sign again.')
      return
    }
    onConfirm({ dataUrl, name })
  }

  return (
    <div className="sign-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <header className="sign-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
      </header>

      <div className="sign-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="sign-canvas"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerLeave={end}
        />
        {!hasInk && <span className="sign-hint">Sign here</span>}
        <span className="sign-rule" aria-hidden="true" />
      </div>

      <footer className="sign-foot">
        {named.length > 0 && (
          <div className="signer-picks" role="radiogroup" aria-label="Who is signing">
            {named.map(p => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={picked === p.id}
                className={picked === p.id ? 'signer-chip on' : 'signer-chip'}
                onClick={() => setPicked(p.id)}
              >
                <strong>{p.name}</strong>
                {p.relationship && <small>{p.relationship}</small>}
              </button>
            ))}
            <button
              type="button"
              role="radio"
              aria-checked={picked === 'other'}
              className={picked === 'other' ? 'signer-chip on' : 'signer-chip'}
              onClick={() => setPicked('other')}
            >
              <strong>Someone else</strong>
            </button>
          </div>
        )}

        {problem && <p className="lock-error">{problem}</p>}

        <div className="sign-actions">
          {usingOther && (
            <input
              className="input sign-name"
              placeholder="Name of the person signing"
              value={other}
              onChange={e => setOther(e.target.value)}
              autoComplete="name"
              autoFocus={named.length > 0}
            />
          )}
          <button className="btn" onClick={clear} disabled={!hasInk}>Clear</button>
          <button className="btn primary" onClick={confirm} disabled={!hasInk || !name}>
            {confirmLabel}
          </button>
        </div>
      </footer>
    </div>
  )
}
