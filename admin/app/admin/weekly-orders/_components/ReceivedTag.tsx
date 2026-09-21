// What actually arrived against one ordered line.
//
// Rendered only once at least one delivery exists for the order. Before that,
// "nothing received" on every line would read as a problem rather than as a
// week that simply has not been delivered yet.
export function ReceivedTag({ ordered, received, unit }: {
  ordered: number; received: number; unit: string
}) {
  // Ordered quantities can be fractional (0.5 kg, 1.5 liter), so an exact
  // equality test would call a complete line short.
  const complete = received + 1e-9 >= ordered
  const color = received <= 0 ? 'rgba(var(--offwhite-rgb),0.28)'
    : complete ? 'var(--teal)'
    : 'var(--brand-secondary)'
  const label = received <= 0 ? 'nothing received'
    : complete ? `${received} ${unit} received`
    : `${received} of ${ordered} ${unit}`
  return (
    <span style={{
      marginLeft: '0.7rem', fontSize: '0.72rem', color,
      fontFamily: 'var(--font-inter)', whiteSpace: 'nowrap',
    }}>{label}</span>
  )
}
