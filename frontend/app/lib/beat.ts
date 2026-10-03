// The completion beat (Agent A). One master GSAP timeline sequences the moment a check finishes,
// across components that don't know about each other. Each part registers a factory that returns
// its own timeline; the master places them with labels and position parameters.
//
//   0.00  map      Agent B: orbit stops, camera frames the evidence, dots pulse   (registerBeatPart('map', …))
//   0.30  panel    progress list cross-fades into the report                       (onPanel callback)
//   0.75  rating   Rent rating: bands sweep, pointer travels and lands, % counts   (RentRating)
//   1.05  verdict  verdict pill letters swap from "Checking" to the verdict        (VerdictCard)
import { gsap, reducedMotion } from './motion'

export type BeatPart = 'map' | 'rating' | 'verdict'
type Factory = () => gsap.core.Animation | null | undefined

const factories = new Map<BeatPart, Factory>()
let master: gsap.core.Timeline | null = null

/** Register a part of the beat. Returns an unregister function (call it on unmount). */
export function registerBeatPart(part: BeatPart, factory: Factory): () => void {
  factories.set(part, factory)
  return () => {
    if (factories.get(part) === factory) factories.delete(part)
  }
}

/** Is a beat currently running? Parts can use this to skip their own standalone animation. */
export function beatActive(): boolean {
  return !!master?.isActive()
}

const debug: string[] = []

function addPart(tl: gsap.core.Timeline, part: BeatPart, at: string) {
  // Resolved when the master reaches the label, so parts that mount during the beat (rating, verdict) still join.
  tl.call(() => {
    const anim = factories.get(part)?.()
    if (import.meta.dev) debug.push(`${part}@${tl.time().toFixed(2)}:${factories.has(part) ? (anim ? 'played' : 'empty') : 'missing'}`)
    if (anim) tl.add(anim, tl.time())
  }, [], at)
}

export function playCompletionBeat(opts: { onPanel: () => void }): gsap.core.Timeline | null {
  master?.kill()
  if (reducedMotion()) {
    opts.onPanel()
    return null
  }
  const tl = gsap.timeline()
  tl.addLabel('map', 0)
  addPart(tl, 'map', 'map')
  tl.addLabel('panel', 'map+=0.3')
  tl.call(opts.onPanel, [], 'panel')
  tl.addLabel('rating', 'panel+=0.45')
  addPart(tl, 'rating', 'rating')
  tl.addLabel('verdict', 'rating+=0.3')
  addPart(tl, 'verdict', 'verdict')
  // Keep the master alive long enough for the parts it adds on the fly.
  tl.to({}, { duration: 2.2 }, 'map')
  master = tl
  if (import.meta.dev) Object.assign(window, { __rcBeat: { tl, debug, parts: () => [...factories.keys()] } })
  return tl
}
