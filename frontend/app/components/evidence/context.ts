import type { InjectionKey } from 'vue'
import type { Evidence, Source } from '~/types/api'

export interface EvidenceContext {
  /** Opens the evidence drawer for these evidence ids, with an optional heading (the claim text). */
  open: (ids: string[], heading?: string) => void
  evidence: ComputedRef<Evidence[]>
  sources: ComputedRef<Source[]>
}

export const EVIDENCE_KEY: InjectionKey<EvidenceContext> = Symbol('evidence')

export function useEvidence(): EvidenceContext {
  const ctx = inject(EVIDENCE_KEY, null)
  if (!ctx) throw new Error('useEvidence() needs an EvidenceProvider above it')
  return ctx
}
