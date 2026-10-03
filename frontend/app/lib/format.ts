// Formatting helpers shared by the report and the map. Owned by Agent A.

const eurFormat = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const numberFormat = new Intl.NumberFormat('en-IE', { maximumFractionDigits: 1 })
const monthFormat = new Intl.DateTimeFormat('en-IE', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const dayFormat = new Intl.DateTimeFormat('en-IE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/** 2200 → "€2,200" */
export function eur(value: number): string {
  return eurFormat.format(value)
}

/** 350 → "350 m", 1520 → "1.5 km" */
export function metres(value: number): string {
  if (value < 1000) return `${Math.round(value / 10) * 10} m`
  return `${numberFormat.format(Math.round(value / 100) / 10)} km`
}

/** 5 → "5 min walk" */
export function walk(minutes: number): string {
  return `${Math.max(1, Math.round(minutes))} min walk`
}

/** 11.1 → "11%", with sign: "+11%" / "-4%" / "0%" */
export function pct(value: number, opts: { sign?: boolean; decimals?: number } = {}): string {
  const factor = 10 ** (opts.decimals ?? 0)
  const rounded = Math.round(value * factor) / factor
  const body = `${Math.abs(rounded).toFixed(opts.decimals ?? 0)}%`
  if (!opts.sign || rounded === 0) return rounded < 0 ? `-${body}` : body
  return rounded > 0 ? `+${body}` : `-${body}`
}

/** 0.054 → "5.4%" (for fractions such as vacancy rate) */
export function fraction(value: number): string {
  return `${numberFormat.format(value * 100)}%`
}

/** 12345 → "12,345" */
export function count(value: number): string {
  return Math.round(value).toLocaleString('en-IE')
}

/** Parses "2025-01", "2025-01-15", "2024-Q3" or a full ISO string into a UTC Date. */
export function parseDate(value: string): Date {
  const quarter = /^(\d{4})-Q([1-4])$/.exec(value)
  if (quarter) return new Date(Date.UTC(Number(quarter[1]), (Number(quarter[2]) - 1) * 3, 1))
  if (/^\d{4}-\d{2}$/.test(value)) return new Date(`${value}-01T00:00:00Z`)
  return new Date(value)
}

/** "2025-01" → "Jan 2025", "2024-Q3" → "Q3 2024" */
export function month(value: string): string {
  const quarter = /^(\d{4})-Q([1-4])$/.exec(value)
  if (quarter) return `Q${quarter[2]} ${quarter[1]}`
  return monthFormat.format(parseDate(value))
}

/** "2026-05-12" → "12 May 2026" */
export function day(value: string): string {
  return dayFormat.format(parseDate(value))
}

/** ('2025-01', '2026-09') → "Jan 2025 to Sep 2026" */
export function period(from: string, to: string): string {
  return `${month(from)} to ${month(to)}`
}

/** "2026-09-01" → "1 month ago" (relative to now) */
export function relativeDate(value: string, now: Date = new Date()): string {
  const days = Math.round((now.getTime() - parseDate(value).getTime()) / 86_400_000)
  if (days < 1) return 'today'
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  const months = Math.round(days / 30.4)
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`
  const years = Math.round(months / 12)
  return `${years} year${years === 1 ? '' : 's'} ago`
}

const PROPERTY_TYPE_LABELS = { apartment: 'Apartment', house: 'House', duplex: 'Duplex', shared_room: 'Shared room' } as const
export function propertyType(value: keyof typeof PROPERTY_TYPE_LABELS): string {
  return PROPERTY_TYPE_LABELS[value]
}

/** 0 → "Studio", 1 → "1 bed", 2 → "2 beds" */
export function beds(value: number): string {
  if (value === 0) return 'Studio'
  return `${value} bed${value === 1 ? '' : 's'}`
}

const VERDICT_LABELS = { below_market: 'Below market', in_line: 'In line with market', above_market: 'Above market' } as const
export function verdictLabel(value: keyof typeof VERDICT_LABELS): string {
  return VERDICT_LABELS[value]
}
