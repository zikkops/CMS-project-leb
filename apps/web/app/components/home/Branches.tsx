import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faLocationDot, faClock, faPhone } from '@fortawesome/free-solid-svg-icons'
import { faWhatsapp } from '@fortawesome/free-brands-svg-icons'
import { BRAND } from '@big-cms/shared/brand'

export default function Branches() {
  // Branch cards are generated from BRAND.branches rather than hardcoded.
  //
  // What used to be here: three real street addresses, three real phone
  // numbers, three real WhatsApp numbers and three real Google Maps links for
  // an actual business. None of that can sit in a demo — someone lands on the
  // page and calls a café that has no idea why.
  //
  // Per-branch details (address, hours, phone) are genuinely tenant data and
  // belong in Firestore, not in a component. Until that settings page exists,
  // these are placeholders derived from the configured branch names.
  const accents = ['var(--brand-primary)', 'var(--brand-secondary)', 'var(--brand-tertiary)']
  const branches = BRAND.branches.map((city, i) => ({
    city,
    label: i === 0 ? 'Flagship Branch' : `${city} Branch`,
    address: `${city} — address not set`,
    hours: '9:00 AM – 11:00 PM · Every day',
    phone: BRAND.contact.phone,
    whatsapp: BRAND.contact.whatsapp,
    // Search by name rather than a saved pin: a placeholder pin would point
    // somewhere real and wrong.
    mapsUrl: `https://www.google.com/maps/search/${encodeURIComponent(city)}`,
    color: accents[i % accents.length],
  }))

  return (
    <section id="branches" style={{
      maxWidth: '1200px',
      margin: '0 auto',
      padding: '6rem 3rem',
    }}>

      {/* Header */}
      <p style={{
        fontSize: '0.7rem',
        letterSpacing: '0.3em',
        textTransform: 'uppercase',
        color: 'var(--teal)',
        marginBottom: '1rem',
      }}>
        Find Us
      </p>

      <h2 style={{
        fontFamily: 'var(--font-cinzel)',
        fontSize: '2.8rem',
        color: 'var(--offwhite)',
        lineHeight: 1.2,
        marginBottom: '1.5rem',
      }}>
        Three Branches,<br />One Community
      </h2>

      <div style={{
        width: '60px', height: '2px',
        backgroundColor: 'var(--teal)',
        marginBottom: '4rem',
      }} />

      {/* Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '1.5rem',
      }}>
        {branches.map(({ city, label, address, hours, phone, whatsapp, mapsUrl, color }) => (
          <div key={city} style={{
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '4px',
            overflow: 'hidden',
          }}>
            {/* Color bar */}
            <div style={{ height: '4px', backgroundColor: color }} />

            <div style={{ padding: '2rem 1.8rem' }}>
              <h3 style={{
                fontFamily: 'var(--font-cinzel)',
                fontSize: '1.8rem',
                color: 'var(--offwhite)',
                marginBottom: '0.3rem',
              }}>{city}</h3>

              <p style={{
                fontSize: '0.7rem',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: 'rgba(245,242,236,0.3)',
                marginBottom: '1.8rem',
                fontFamily: 'var(--font-inter)',
              }}>{label}</p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                {[
                  { icon: faLocationDot, text: address },
                  { icon: faClock,       text: hours },
                  { icon: faPhone,       text: phone },
                ].map(({ icon, text }) => (
                  <div key={text} style={{
                    display: 'flex',
                    gap: '0.8rem',
                    fontSize: '0.82rem',
                    color: 'rgba(245,242,236,0.5)',
                    fontFamily: 'var(--font-inter)',
                    alignItems: 'flex-start',
                  }}>
                    <FontAwesomeIcon
                      icon={icon}
                      style={{ color: 'white', width: '14px', marginTop: '2px', flexShrink: 0 }}
                    />
                    <span>{text}</span>
                  </div>
                ))}
              </div>

              {/* Buttons */}
              <div style={{ display: 'flex', gap: '0.8rem', marginTop: '2rem' }}>
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    flex: 1,
                    background: 'transparent',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: 'rgba(245,242,236,0.6)',
                    padding: '0.6rem',
                    borderRadius: '2px',
                    fontSize: '0.72rem',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-inter)',
                    textDecoration: 'none',
                    textAlign: 'center',
                  }}
                >
                  Directions
                </a>
                <a
                  href={`https://wa.me/${whatsapp}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    flex: 1,
                    backgroundColor: color,
                    color: '#fff',
                    padding: '0.6rem',
                    borderRadius: '2px',
                    fontSize: '0.72rem',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    textDecoration: 'none',
                    textAlign: 'center',
                    fontFamily: 'var(--font-inter)',
                  }}>
                  <FontAwesomeIcon icon={faWhatsapp} style={{ width: '14px', marginRight: '0.4rem' }} />
                  Reserve
                </a>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}