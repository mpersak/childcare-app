import { useState } from 'react'
import { formatMoney, formatMoneyCompact } from '../lib/money'
import { formatMonth } from '../lib/dates'

/**
 * Charts are hand-rolled SVG — no chart library, so the bundle stays small and
 * the marks follow the palette in `styles.css` (categorical slots 1 and 2,
 * validated for both themes and for colour-vision deficiency).
 */

/** Rounds an axis maximum up to a readable number so gridlines land on round values. */
function niceMax(value: number): number {
  if (value <= 0) return 100
  const mag = Math.pow(10, Math.floor(Math.log10(value)))
  const norm = value / mag
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10
  return step * mag
}

/** Rectangle with only the two data-end corners rounded, anchored to the baseline. */
function barPath(x: number, y: number, w: number, h: number, r = 4): string {
  const rr = Math.max(0, Math.min(r, h, w / 2))
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} ` +
    `L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`
}

export interface MonthPointView {
  key: string
  revenue: number
  collected: number
}

export function MonthlyRevenueChart({ points, currency, locale }: {
  points: MonthPointView[]
  currency: string
  locale: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  if (!points.length) return null

  const W = 760, H = 280, padL = 62, padR = 14, padT = 18, padB = 42
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const max = niceMax(Math.max(1, ...points.flatMap(p => [p.revenue, p.collected])))
  const groupW = plotW / points.length
  const barW = Math.max(5, Math.min(16, groupW / 2 - 3))
  const y = (v: number) => padT + plotH - (v / max) * plotH
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * max)
  const active = hover !== null ? points[hover] : null

  return (
    <div className="chart">
      <div className="legend">
        <span className="legend-item"><i className="swatch series-1" />Invoiced</span>
        <span className="legend-item"><i className="swatch series-2" />Received</span>
      </div>

      <div className="chart-plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img"
             aria-label="Invoiced and received by month"
             onMouseLeave={() => setHover(null)}>
          {ticks.map(t => (
            <g key={t}>
              <line className="grid" x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} />
              <text className="axis" x={padL - 10} y={y(t) + 4} textAnchor="end">
                {formatMoneyCompact(t, currency, locale)}
              </text>
            </g>
          ))}

          {points.map((p, i) => {
            const gx = padL + i * groupW
            // Two-pixel surface gap between the paired bars, per the mark spec.
            const x1 = gx + groupW / 2 - barW - 1
            const x2 = gx + groupW / 2 + 1
            const isLast = i === points.length - 1
            return (
              <g key={p.key}>
                <rect className="hit" x={gx} y={padT} width={groupW} height={plotH}
                      onMouseEnter={() => setHover(i)} />
                {hover === i && (
                  <rect className="hover-band" x={gx} y={padT} width={groupW} height={plotH} />
                )}
                <path className="series-1-fill"
                      d={barPath(x1, y(p.revenue), barW, padT + plotH - y(p.revenue))} />
                <path className="series-2-fill"
                      d={barPath(x2, y(p.collected), barW, padT + plotH - y(p.collected))} />
                <text className="axis" x={gx + groupW / 2} y={H - padB + 18} textAnchor="middle">
                  {formatMonth(p.key, locale)}
                </text>
                {/* Direct labels on the newest group so identity never rests on colour alone. */}
                {isLast && p.revenue > 0 && (
                  <text className="mark-label" x={x1 + barW / 2} y={y(p.revenue) - 6} textAnchor="middle">
                    Invoiced
                  </text>
                )}
                {isLast && p.collected > 0 && (
                  <text className="mark-label" x={x2 + barW / 2} y={y(p.collected) - 6} textAnchor="middle">
                    Received
                  </text>
                )}
              </g>
            )
          })}

          <line className="axis-line" x1={padL} x2={W - padR} y1={padT + plotH} y2={padT + plotH} />
        </svg>

        {active && (
          <div
            className="chart-tip"
            style={{ left: `${((padL + (hover! + 0.5) * groupW) / W) * 100}%` }}
          >
            <strong>{formatMonth(active.key, locale)}</strong>
            <span><i className="swatch series-1" />Invoiced {formatMoney(active.revenue, currency, locale)}</span>
            <span><i className="swatch series-2" />Received {formatMoney(active.collected, currency, locale)}</span>
          </div>
        )}
      </div>
    </div>
  )
}

export interface HBarDatum {
  label: string
  value: number
  /** Optional class for an ordinal ramp step; defaults to categorical slot 1. */
  className?: string
  note?: string
}

export function HorizontalBars({ data, currency, locale, emptyText = 'Nothing to show yet.' }: {
  data: HBarDatum[]
  currency: string
  locale: string
  emptyText?: string
}) {
  const max = Math.max(1, ...data.map(d => d.value))
  if (!data.some(d => d.value > 0)) return <p className="muted">{emptyText}</p>
  return (
    <div className="hbars">
      {data.map(d => (
        <div className="hbar-row" key={d.label} title={`${d.label}: ${formatMoney(d.value, currency, locale)}`}>
          <span className="hbar-label">{d.label}</span>
          <span className="hbar-track">
            <span
              className={`hbar-fill ${d.className ?? 'series-1-bg'}`}
              style={{ width: `${Math.max(1.5, (d.value / max) * 100)}%` }}
            />
          </span>
          <span className="hbar-value">
            {formatMoney(d.value, currency, locale)}
            {d.note && <em className="hbar-note">{d.note}</em>}
          </span>
        </div>
      ))}
    </div>
  )
}
