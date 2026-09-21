'use client'

// Moving items to another open check, or merging this one into it
// (UPGRADE.md T5.6). The rules are moveProblem() in shared/src/checks.ts,
// judged again on the server; this sheet only chooses. Every open of the
// sheet gets its own key, so a Move tapped twice, or retried after a lost
// answer, moves once.

import { useState } from 'react'
import { faArrowRightArrowLeft, faObjectGroup, faXmark } from '@fortawesome/free-solid-svg-icons'
import { checkLabel, describeLine, lineTotal, moveProblem, type Check } from '@big-cms/shared/checks'
import { useOpenChecks, moveLinesTo, mergeInto } from '../../../lib/usePos'
import { PosButton, Chip, Sheet, SectionLabel } from '../../../lib/posUi'

export default function MoveItemsSheet({ check, mode, onClose, onDone, money }: {
  check: Check
  mode: 'move' | 'merge'
  onClose: () => void
  /** Called after the server answered; with the check merged away, the page goes to the other one. */
  onDone: (result: { error: string } | { mergedInto: string } | { moved: true }) => void
  money: (n: number) => string
}) {
  const { checks } = useOpenChecks(check.branch)
  const others = checks.filter(c => c.id !== check.id)
  const [target, setTarget] = useState('')
  const [chosen, setChosen] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [moveKey] = useState(() => crypto.randomUUID())
  const standing = check.lines.filter(l => l.status !== 'void')
  const to = others.find(c => c.id === target)
  const ids = mode === 'merge' ? standing.map(l => l.id) : chosen
  const problem = !to ? 'Choose the check.' : moveProblem(check, to, mode === 'merge' && ids.length === 0 ? ['-'] : ids)
  const blocked = mode === 'merge' && ids.length === 0 && to ? null : problem

  async function submit() {
    if (!to || blocked) return
    setBusy(true)
    try {
      if (mode === 'merge') {
        await mergeInto(check.id, to.id, moveKey)
        onDone({ mergedInto: to.id })
      } else {
        await moveLinesTo(check.id, to.id, chosen, moveKey)
        onDone({ moved: true })
      }
    } catch (err) {
      onDone({ error: err instanceof Error ? err.message : 'Could not move them.' })
    }
  }

  return (
    <Sheet label={mode === 'merge' ? 'Merge into another check' : 'Move items to another check'} onClose={onClose} onSubmit={() => { void submit() }}>
      <h2 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.4rem', color: 'var(--offwhite)', marginBottom: '0.4rem' }}>
        {mode === 'merge' ? `Merge ${checkLabel(check)} into…` : `Move from ${checkLabel(check)} to…`}
      </h2>
      <p style={{ color: 'rgba(var(--offwhite-rgb),0.65)', fontSize: '0.92rem', lineHeight: 1.6, marginBottom: '0.9rem' }}>
        {mode === 'merge'
          ? 'Everything still on this check moves across, the guests add up, and this check is closed as merged.'
          : 'The items move as they are, sent or not. A ticket already in the kitchen keeps the table it was sent from.'}
      </p>

      <SectionLabel icon={faArrowRightArrowLeft}>Open checks</SectionLabel>
      {others.length === 0 ? (
        <p style={{ color: 'rgba(var(--offwhite-rgb),0.6)', margin: '0.4rem 0 1rem' }}>No other check is open at this branch.</p>
      ) : (
        <div role="group" aria-label="Move to" style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', margin: '0.4rem 0 1rem' }}>
          {others.map(c => <Chip key={c.id} label={checkLabel(c)} active={target === c.id} onClick={() => setTarget(c.id)} />)}
        </div>
      )}

      {mode === 'move' && (
        <>
          <SectionLabel icon={faArrowRightArrowLeft}>Items</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', margin: '0.4rem 0 1rem' }}>
            {standing.map(l => {
              const on = chosen.includes(l.id)
              return (
                <button key={l.id} type="button" aria-pressed={on}
                  onClick={() => setChosen(prev => on ? prev.filter(id => id !== l.id) : [...prev, l.id])}
                  style={{
                    display: 'flex', justifyContent: 'space-between', gap: '0.8rem', alignItems: 'center',
                    minHeight: '52px', padding: '0.5rem 0.8rem', borderRadius: '10px', cursor: 'pointer', textAlign: 'left',
                    background: on ? 'rgba(var(--teal-rgb),0.18)' : 'rgba(var(--overlay-rgb),0.04)',
                    border: `2px solid ${on ? 'var(--teal)' : 'rgba(var(--overlay-rgb),0.14)'}`,
                    color: 'var(--offwhite)', fontFamily: 'var(--font-inter)', fontSize: '0.98rem',
                  }}>
                  <span>{l.quantity}× {describeLine(l)}{l.status === 'draft' ? ' (not sent)' : ''}</span>
                  <span style={{ fontWeight: 700 }}>{money(lineTotal(l, check.staffDiscount))}</span>
                </button>
              )
            })}
          </div>
        </>
      )}

      {to && blocked && <p style={{ color: 'var(--red)', fontSize: '0.95rem', marginBottom: '0.8rem' }}>{blocked}</p>}

      <div style={{ display: 'flex', gap: '0.6rem' }}>
        <PosButton icon={faXmark} label="Cancel" tone="quiet" grow={1} onClick={onClose} />
        <PosButton icon={mode === 'merge' ? faObjectGroup : faArrowRightArrowLeft}
          label={busy ? 'Moving…' : mode === 'merge' ? `Merge into ${to ? checkLabel(to) : '…'}` : `Move ${chosen.length || ''} to ${to ? checkLabel(to) : '…'}`}
          tone="primary" size="lg" grow={2} type="submit" disabled={busy || Boolean(blocked)} />
      </div>
    </Sheet>
  )
}
