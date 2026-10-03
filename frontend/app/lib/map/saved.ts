import { useState } from '#imports'
import { watch } from 'vue'
import type { ListingSummary } from '~/types/api'

// Shortlist of rentals, kept in this browser (localStorage). Each entry is a
// snapshot of the listing so the Saved list works even when it's off-screen.

const KEY = 'rc:saved'
export interface SavedListing extends ListingSummary { saved_at: string }

function read(): SavedListing[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v : []
  }
  catch { return [] }
}

let synced = false

export function useSaved() {
  const saved = useState<SavedListing[]>('map:saved', () => [])
  if (import.meta.client && !synced) {
    synced = true
    saved.value = read()
    watch(saved, (v) => {
      try { localStorage.setItem(KEY, JSON.stringify(v)) }
      catch { /* private mode: keep it for this page only */ }
    }, { deep: true })
  }

  const isSaved = (id: string) => saved.value.some(s => s.id === id)

  function toggle(listing: ListingSummary): boolean {
    if (isSaved(listing.id)) {
      saved.value = saved.value.filter(s => s.id !== listing.id)
      return false
    }
    const { id, rent, bedrooms, property_type, area, location, verdict, diff_pct, is_sample } = listing
    saved.value = [{ id, rent, bedrooms, property_type, area, location, verdict, diff_pct, is_sample, saved_at: new Date().toISOString() }, ...saved.value]
    return true
  }

  function remove(id: string) {
    saved.value = saved.value.filter(s => s.id !== id)
  }

  return { saved, isSaved, toggle, remove }
}
