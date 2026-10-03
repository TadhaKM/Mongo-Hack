// Verdict and status styling shared by the panel and report (Agent A).
import { Minus, TrendingDown, TrendingUp } from '@lucide/vue'
import type { PlanningStatus, Verdict } from '~/types/api'

export const VERDICT_STYLE: Record<Verdict, { text: string; bg: string; soft: string; icon: typeof TrendingUp }> = {
  below_market: { text: 'text-verdict-below', bg: 'bg-verdict-below', soft: 'bg-verdict-below/10 text-verdict-below border-verdict-below/30', icon: TrendingDown },
  in_line: { text: 'text-verdict-inline', bg: 'bg-verdict-inline', soft: 'bg-verdict-inline/10 text-verdict-inline border-verdict-inline/30', icon: Minus },
  above_market: { text: 'text-verdict-above', bg: 'bg-verdict-above', soft: 'bg-verdict-above/10 text-verdict-above border-verdict-above/30', icon: TrendingUp },
}

/** Colour for a rent compared with the asking rent (same ±5% thresholds as the verdict). */
export function rentVsAsking(rent: number, asking: number): Verdict {
  const diff = ((rent - asking) / asking) * 100
  return diff < -5 ? 'below_market' : diff > 5 ? 'above_market' : 'in_line'
}

export const PLANNING_STYLE: Record<PlanningStatus, { label: string; soft: string }> = {
  granted: { label: 'Granted', soft: 'bg-planning-granted/10 text-planning-granted border-planning-granted/30' },
  pending: { label: 'Pending', soft: 'bg-planning-pending/10 text-planning-pending border-planning-pending/30' },
  refused: { label: 'Refused', soft: 'bg-planning-refused/10 text-planning-refused border-planning-refused/30' },
  appealed: { label: 'Appealed', soft: 'bg-planning-appealed/10 text-planning-appealed border-planning-appealed/30' },
}
