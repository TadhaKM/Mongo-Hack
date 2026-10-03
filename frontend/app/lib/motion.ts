// GSAP helpers (Agent A). Every animation goes through here so reduced motion is respected in one place.
import { gsap } from 'gsap'

export { gsap }

export function reducedMotion(): boolean {
  return import.meta.client && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Tween a number and hand each frame's value to `onUpdate`. Jumps straight to the end when motion is reduced. */
export function countTo(from: number, to: number, onUpdate: (v: number) => void, opts: { duration?: number; delay?: number; ease?: string } = {}) {
  if (reducedMotion()) {
    onUpdate(to)
    return null
  }
  const state = { v: from }
  return gsap.to(state, {
    v: to,
    duration: opts.duration ?? 0.9,
    delay: opts.delay ?? 0,
    ease: opts.ease ?? 'power3.out',
    onUpdate: () => onUpdate(state.v),
  })
}
