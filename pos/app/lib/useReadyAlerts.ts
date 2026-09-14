// The chime when a plate is ready, and whether this device plays it.
//
// Only for tickets that turn ready while the screen is open — which ones is
// newlyReady() in pickups.ts (verify:counter). The choice is per device, in
// localStorage: the counter wants the sound, a waiter's phone in a pocket may
// not.
//
// Browsers refuse to play sound before somebody has touched the page, so the
// audio is unlocked by the first tap anywhere. A till is tapped within seconds
// of being picked up; turning the sound on also plays it, as a test.

import { useEffect, useRef, useState } from 'react'
import { newlyReady } from './pickups'

const SOUND_KEY = 'pos-ready-sound'

let context: AudioContext | null = null

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (context) return context
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  try {
    context = new Ctor()
  } catch {
    return null
  }
  return context
}

/** Two rising notes. Nothing else on the till makes a sound, so this is unmistakable. */
function chime(): void {
  const ctx = audio()
  if (!ctx) return
  if (ctx.state === 'suspended') void ctx.resume()
  const start = ctx.currentTime + 0.02
  ;[880, 1318.5].forEach((freq, i) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    const t = start + i * 0.22
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t)
    osc.stop(t + 0.4)
  })
}

export function useReadyAlerts(ids: readonly string[], loading: boolean): {
  soundOn: boolean
  setSoundOn: (on: boolean) => void
} {
  const [soundOn, setSound] = useState(true)

  // Read once on mount, not during render — localStorage does not exist on the
  // server, and reading it while rendering mismatches hydration (see the KDS).
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (window.localStorage.getItem(SOUND_KEY) === 'off') setSound(false)
    } catch { /* private window: the sound stays on */ }
  }, [])

  useEffect(() => {
    const unlock = () => {
      const ctx = audio()
      if (ctx?.state === 'suspended') void ctx.resume()
    }
    window.addEventListener('pointerdown', unlock)
    return () => window.removeEventListener('pointerdown', unlock)
  }, [])

  const seen = useRef<Set<string> | null>(null)
  const key = ids.join('|')
  useEffect(() => {
    if (loading) return
    const current = key ? key.split('|') : []
    const fresh = newlyReady(seen.current, current)
    seen.current = new Set(current)
    if (fresh.length > 0 && soundOn) chime()
  }, [key, loading, soundOn])

  function setSoundOn(on: boolean) {
    setSound(on)
    try { window.localStorage.setItem(SOUND_KEY, on ? 'on' : 'off') } catch { /* lasts the visit */ }
    if (on) chime()
  }

  return { soundOn, setSoundOn }
}
