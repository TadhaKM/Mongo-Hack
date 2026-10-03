// GSAP helpers (Agent A). Every animation goes through here so reduced motion is respected in one place.
import { gsap } from 'gsap'
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin'

if (import.meta.client) gsap.registerPlugin(ScrambleTextPlugin)

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

/**
 * Resolve an element's text into `text` through scrambled characters (labels only, never figures).
 * With reduced motion the text is simply set.
 */
export function scrambleTo(el: HTMLElement | null | undefined, text: string, opts: { duration?: number; delay?: number; chars?: string } = {}) {
  if (!el) return null
  if (reducedMotion()) {
    el.textContent = text
    return null
  }
  return gsap.to(el, {
    duration: opts.duration ?? 0.6,
    delay: opts.delay ?? 0,
    ease: 'none',
    scrambleText: { text, chars: opts.chars ?? 'lowerCase', speed: 0.5, revealDelay: 0.1 },
  })
}
