'use client'

// How the till shows an allergen answer. One component, so a menu tile, the
// options sheet and the chart can never phrase the same dish differently.
//
// Amber chips (attention, in posUi's colour meanings) for what a dish
// contains; a red "Not verified" badge that comes FIRST whenever it applies,
// so "at least milk" can never be read as "only milk". The shape of the answer
// is staffAnswer() — verify:food-safety.

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTriangleExclamation, faCircleCheck } from '@fortawesome/free-solid-svg-icons'
import { ALLERGENS_EU14 } from '@big-cms/shared/foodSafety'
import { staffAnswer } from '@big-cms/shared/allergens'

const LABEL = new Map(ALLERGENS_EU14.map(a => [a.key, a.label]))
export const allergenName = (key: string) => LABEL.get(key) ?? key

export function AllergenAnswer({ verified, contains, others, size = 'sm' }: {
  verified: boolean
  contains: readonly string[]
  others?: readonly string[]
  /** sm for a menu tile, md for a sheet or the chart. */
  size?: 'sm' | 'md'
}) {
  const answer = staffAnswer({ verified, contains, others })
  const font = size === 'sm' ? '0.74rem' : '0.9rem'
  const pad = size === 'sm' ? '0.12rem 0.5rem' : '0.3rem 0.75rem'
  const pill = (colour: string, bg: string): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: '0.3rem', whiteSpace: 'nowrap',
    fontFamily: 'var(--font-inter)', fontSize: font, fontWeight: 600, lineHeight: 1.3,
    padding: pad, borderRadius: '999px', color: colour, background: bg,
    border: `1px solid ${colour}`,
  })

  return (
    <span style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', alignItems: 'center' }}>
      {answer.kind === 'unverified' && (
        <span style={pill('var(--red)', 'rgba(var(--red-rgb),0.14)')}>
          <FontAwesomeIcon icon={faTriangleExclamation} />Not verified
        </span>
      )}
      {answer.keys.map(k => (
        <span key={k} style={pill('var(--brand-secondary)', 'rgba(var(--brand-secondary-rgb),0.12)')}>{allergenName(k)}</span>
      ))}
      {answer.kind === 'unverified' && answer.keys.length > 0 && (
        <span style={{ fontFamily: 'var(--font-inter)', fontSize: font, color: 'rgba(var(--offwhite-rgb),0.6)' }}>at least</span>
      )}
      {answer.kind === 'none' && (
        <span style={{ ...pill('rgba(var(--offwhite-rgb),0.75)', 'rgba(255,255,255,0.05)'), fontWeight: 500 }}>
          <FontAwesomeIcon icon={faCircleCheck} />No listed allergens
        </span>
      )}
    </span>
  )
}
