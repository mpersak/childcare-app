/** Round to cents. Guards against float drift like 0.1 + 0.2. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function formatMoney(n: number, currency = 'NZD', locale = 'en-NZ'): string {
  const safe = isFinite(n) ? n : 0
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(safe)
  } catch {
    return `$${round2(safe).toFixed(2)}`
  }
}

/** Compact form for dashboard tiles: $1.2k, $14.5k. */
export function formatMoneyCompact(n: number, currency = 'NZD', locale = 'en-NZ'): string {
  if (Math.abs(n) < 1000) return formatMoney(n, currency, locale)
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1,
    }).format(n)
  } catch {
    return formatMoney(n, currency, locale)
  }
}

export function parseMoney(s: string): number {
  const n = Number(String(s).replace(/[^0-9.-]/g, ''))
  return isFinite(n) ? n : 0
}
