import { Marker, type Map as MlMap, type MapSourceDataEvent } from 'maplibre-gl'
import type { ListingSummary, Verdict } from '~/types/api'
import { eur } from '~/lib/format'
import { gsap, reducedMotion } from '~/lib/motion'

export const LISTINGS_SOURCE = 'listings'

export interface PinState {
  hoveredId: string | null
  selectedId: string | null
  visited: Set<string>
  saved: Set<string>
  /** While an analysis runs only the selected pin is shown. */
  onlySelected: boolean
}

export interface PinHandlers {
  hover: (id: string | null) => void
  select: (id: string) => void
  /** Right-click on a pin; `point` is in map-container pixels at the pin's tip. */
  context: (id: string, point: { x: number; y: number }) => void
}

interface PinEntry { marker: Marker; el: HTMLElement; pill: HTMLButtonElement; verdict: Verdict }

/**
 * Keeps HTML price-pill markers in sync with the unclustered points of the
 * `listings` GeoJSON source. Markers are keyed by listing id: new ones are
 * added, existing ones kept, missing ones removed. Never recreated wholesale.
 */
export class PricePins {
  private pins = new Map<string, PinEntry>()
  private listings = new Map<string, ListingSummary>()
  private state: PinState = { hoveredId: null, selectedId: null, visited: new Set(), saved: new Set(), onlySelected: false }
  private scheduled = false
  /** The first batch of pins drops in with a GSAP ripple; later ones use the CSS fade. */
  private introPlayed = false

  private map: MlMap
  private handlers: PinHandlers

  constructor(map: MlMap, handlers: PinHandlers) {
    this.map = map
    this.handlers = handlers
    map.on('render', this.schedule)
    map.on('sourcedata', this.onSourceData)
  }

  /** Latest listings (also used to place the selected pin when it is inside a cluster). */
  setListings(items: ListingSummary[]) {
    for (const l of items) this.listings.set(l.id, l)
    this.schedule()
  }

  /** Remember a listing that may not be in the current bbox result (e.g. from URL restore). */
  remember(listing: ListingSummary) {
    this.listings.set(listing.id, listing)
    this.schedule()
  }

  setState(patch: Partial<PinState>) {
    this.state = { ...this.state, ...patch }
    this.schedule()
  }

  destroy() {
    this.map.off('render', this.schedule)
    this.map.off('sourcedata', this.onSourceData)
    for (const p of this.pins.values()) p.marker.remove()
    this.pins.clear()
  }

  private onSourceData = (e: MapSourceDataEvent) => {
    if (e.sourceId === LISTINGS_SOURCE && e.isSourceLoaded) this.schedule()
  }

  private schedule = () => {
    if (this.scheduled) return
    this.scheduled = true
    requestAnimationFrame(() => {
      this.scheduled = false
      this.sync()
    })
  }

  private visibleIds(): Set<string> {
    const ids = new Set<string>()
    const { selectedId, onlySelected } = this.state
    if (!onlySelected && this.map.getSource(LISTINGS_SOURCE)) {
      for (const f of this.map.querySourceFeatures(LISTINGS_SOURCE)) {
        const p = f.properties
        if (p && !p.cluster && typeof p.id === 'string') ids.add(p.id)
      }
    }
    // The selected pin is always shown, even if its point is clustered or out of view.
    if (selectedId && this.listings.has(selectedId)) ids.add(selectedId)
    return ids
  }

  private sync() {
    if (!this.map.style) return
    const want = this.visibleIds()
    for (const [id, p] of this.pins) {
      if (!want.has(id)) {
        p.marker.remove()
        this.pins.delete(id)
      }
    }
    const created: PinEntry[] = []
    for (const id of want) {
      const listing = this.listings.get(id)
      if (!listing) continue
      let entry = this.pins.get(id)
      if (!entry) {
        entry = this.create(listing)
        this.pins.set(id, entry)
        created.push(entry)
      }
      this.paint(id, entry, listing)
    }
    if (!this.introPlayed && created.length > 1) this.playIntro(created)
  }

  /** Staggered drop-in rippling out from the middle of the map. */
  private playIntro(entries: PinEntry[]) {
    this.introPlayed = true
    if (reducedMotion()) return
    const c = this.map.getContainer().getBoundingClientRect()
    const cx = c.left + c.width / 2, cy = c.top + c.height / 2
    const dist = (e: PinEntry) => {
      const r = e.el.getBoundingClientRect()
      return Math.hypot(r.left - cx, r.top - cy)
    }
    const pills = entries.sort((a, b) => dist(a) - dist(b)).map(e => {
      e.el.classList.remove('rc-pin--enter')
      return e.pill
    })
    gsap.from(pills, {
      y: -12, autoAlpha: 0, duration: 0.45, ease: 'back.out(1.7)',
      stagger: Math.min(0.02, 0.6 / pills.length),
      clearProps: 'transform,opacity,visibility',
    })
  }

  private create(l: ListingSummary): PinEntry {
    const el = document.createElement('div')
    el.className = 'rc-pin rc-pin--enter'
    const pill = document.createElement('button')
    pill.type = 'button'
    pill.className = 'rc-pin__pill'
    pill.textContent = eur(l.rent)
    pill.setAttribute('aria-label', `${eur(l.rent)}, ${l.bedrooms} bed ${l.property_type.replace('_', ' ')} in ${l.area}`)
    el.appendChild(pill)
    // Heart badge for shortlisted rentals (static markup, shown via .is-saved).
    const heart = document.createElement('span')
    heart.className = 'rc-pin__heart'
    heart.setAttribute('aria-hidden', 'true')
    heart.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.5 3 5 6.4 5c2 0 3.6 1.1 4.6 2.6C12 6.1 13.6 5 15.6 5 19 5 21.1 8.5 19.6 11.8 17.5 16.4 12 21 12 21z"/></svg>'
    el.appendChild(heart)
    pill.addEventListener('mouseenter', () => this.handlers.hover(l.id))
    pill.addEventListener('mouseleave', () => this.handlers.hover(null))
    pill.addEventListener('click', (e) => {
      e.stopPropagation()
      this.handlers.select(l.id)
    })
    pill.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.handlers.context(l.id, this.map.project([l.location.lng, l.location.lat]))
    })
    el.addEventListener('animationend', () => el.classList.remove('rc-pin--enter'), { once: true })
    const marker = new Marker({ element: el, anchor: 'bottom' })
      .setLngLat([l.location.lng, l.location.lat])
      .addTo(this.map)
    return { marker, el, pill, verdict: l.verdict }
  }

  private paint(id: string, p: PinEntry, l: ListingSummary) {
    const { hoveredId, selectedId, visited } = this.state
    const selected = id === selectedId
    const hovered = id === hoveredId
    p.el.dataset.verdict = l.verdict
    p.el.classList.toggle('is-selected', selected)
    p.el.classList.toggle('is-hovered', hovered && !selected)
    p.el.classList.toggle('is-visited', visited.has(id) && !selected)
    p.el.classList.toggle('is-saved', this.state.saved.has(id))
    p.el.style.zIndex = selected ? '30' : hovered ? '20' : '1'
    if (p.verdict !== l.verdict || p.pill.textContent !== eur(l.rent)) {
      p.pill.textContent = eur(l.rent)
      p.verdict = l.verdict
    }
  }
}

/** GeoJSON for the clustered listings source. */
export function listingsGeoJSON(items: ListingSummary[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: items.map(l => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [l.location.lng, l.location.lat] },
      properties: { id: l.id, rent: l.rent, verdict: l.verdict },
    })),
  }
}
