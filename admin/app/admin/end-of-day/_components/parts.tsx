import { sectionHeader } from './styles'

export function SectionTitle({ label, color }: { label: string; color: string }) {
  return (
    <div style={sectionHeader(color)}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: color, flexShrink: 0 }} />
      <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1rem', color, letterSpacing: '0.12em' }}>
        {label}
      </p>
    </div>
  )
}

// ─── sub-components ─────────────────────────────────────────────────────────

export function SumCell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.62rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.3)', marginBottom: '0.25rem' }}>{label}</p>
      <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.95rem', fontWeight: 600, color }}>{value}</p>
    </div>
  )
}

export function DiffBlock({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      textAlign: 'center',
      background: `${color}12`,
      border: `1px solid ${color}30`,
      borderRadius: '4px',
      padding: '1rem',
    }}>
      <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.68rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.4)', marginBottom: '0.4rem' }}>{label}</p>
      <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.4rem', color, fontWeight: 700 }}>{value}</p>
    </div>
  )
}

export function HintBox({ hints, color }: { hints: string[]; color: string }) {
  return (
    <div style={{
      marginTop: '0.75rem',
      padding: '0.75rem 1rem',
      background: 'rgba(var(--overlay-rgb),0.02)',
      border: '1px solid rgba(var(--overlay-rgb),0.06)',
      borderLeft: `3px solid ${color}50`,
      borderRadius: '2px',
    }}>
      <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.65rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.3)', marginBottom: '0.45rem' }}>
        What to include
      </p>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        {hints.map((h, i) => (
          <li key={i} style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', backgroundColor: color, flexShrink: 0, marginTop: '0.35em' }} />
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(var(--offwhite-rgb),0.45)' }}>{h}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
