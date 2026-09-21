export function ReceivingHeader() {
  return (
    <div style={{ marginBottom: '1.75rem' }}>
      <a href="/admin/supplies" style={{
        fontSize: '0.68rem', letterSpacing: '0.2em', textTransform: 'uppercase',
        color: 'rgba(var(--offwhite-rgb),0.3)', textDecoration: 'none',
        marginBottom: '0.5rem', display: 'block', fontFamily: 'var(--font-inter)',
      }}>← Inventory Management</a>
      <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.8rem', color: 'var(--offwhite)', marginBottom: '0.2rem' }}>
        Receive a Delivery
      </h1>
      <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'rgba(var(--offwhite-rgb),0.3)' }}>
        Pick the weekly order this delivery is against — everything comes pre-filled as ordered.
        Only change the lines that were short, damaged, or priced differently.
      </p>
    </div>
  )
}
