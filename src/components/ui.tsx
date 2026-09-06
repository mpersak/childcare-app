import React, { useEffect, useRef, useState } from 'react'
import type { Child } from '../types'
import { initials } from '../lib/store'

export function Card({ title, actions, children, className = '' }: {
  title?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className="card-body">{children}</div>
    </section>
  )
}

export function Stat({ label, value, sub, tone = 'neutral' }: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info'
}) {
  return (
    <div className={`stat tone-${tone}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

export function Badge({ tone = 'muted', children }: {
  tone?: 'muted' | 'good' | 'warn' | 'bad' | 'info'
  children: React.ReactNode
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

export function Avatar({ child, size = 32 }: { child: Child | undefined; size?: number }) {
  return (
    <span
      className="avatar"
      style={{ background: child?.colour ?? '#94a3b8', width: size, height: size, fontSize: size * 0.4 }}
      aria-hidden="true"
    >
      {initials(child)}
    </span>
  )
}

export function Field({ label, hint, children, wide = false }: {
  label: string
  hint?: React.ReactNode
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <label className={`field ${wide ? 'field-wide' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

export function EmptyState({ title, children, action }: {
  title: string
  children?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  )
}

export function Modal({ open, title, onClose, children, footer, wide = false }: {
  open: boolean
  title: string
  onClose(): void
  children: React.ReactNode
  footer?: React.ReactNode
  wide?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)

  // Callers pass an inline arrow for onClose, so its identity changes on every
  // render. Keeping it in a ref stops the effects below from re-running (and
  // stealing focus back out of whatever the user is typing into).
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    if (!open) return
    // Once, when the dialog opens: put the caret in the first real field,
    // falling back to the dialog itself so Escape and tabbing still work.
    const first = ref.current?.querySelector<HTMLElement>(
      'input:not([type="hidden"]):not([disabled]), select, textarea',
    )
    ;(first ?? ref.current)?.focus()
  }, [open])

  if (!open) return null
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true"
           aria-label={title} tabIndex={-1} ref={ref}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  )
}

/** Two-step delete so a stray click cannot wipe a record. */
export function ConfirmButton({ onConfirm, children, confirmLabel = 'Sure?', className = 'btn danger' }: {
  onConfirm(): void
  children: React.ReactNode
  confirmLabel?: string
  className?: string
}) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])

  return (
    <button
      className={className}
      onClick={() => { if (armed) { onConfirm(); setArmed(false) } else setArmed(true) }}
    >
      {armed ? confirmLabel : children}
    </button>
  )
}

export function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="toolbar">{children}</div>
}

/**
 * An action that shows its label on a roomy screen and collapses to just the
 * icon on a phone. The label stays in the accessible name and the tooltip, so
 * nothing is lost when the text is hidden.
 */
export function ActionButton({ icon, label, primary, onClick, disabled, title }: {
  icon: string
  label: string
  primary?: boolean
  onClick(): void
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      className={`btn has-icon ${primary ? 'primary' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title ?? label}
    >
      <span aria-hidden="true">{icon}</span>
      <span className="btn-label">{label}</span>
    </button>
  )
}

export function PageHead({ title, subtitle, actions }: {
  title: string
  subtitle?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="row gap">{actions}</div>}
    </header>
  )
}
