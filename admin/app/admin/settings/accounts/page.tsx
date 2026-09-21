'use client'

// Account codes (UPGRADE.md T7.15): the chart of accounts the journal posts
// to. Each posting (cash, card clearing, VAT output, tips payable, sales,
// service, discounts, rounding) has a code and a name, and a menu category can
// have a sales code of its own. The defaults are a common layout; the
// accountant's own chart replaces them. Admin only.

import { useEffect, useState } from 'react'
import { faFloppyDisk } from '@fortawesome/free-solid-svg-icons'
import { useRequireRole, type Role } from '@big-cms/shared/adminAuth'
import { authedFetch, unwrap } from '@big-cms/shared/apiClient'
import { isNetworkFailure } from '@big-cms/shared/netErrors'
import { startLoad } from '@big-cms/shared/startLoad'
import { ACCOUNT_LABELS, type AccountCodes, type AccountKey } from '@big-cms/shared/journal'
import { Page, PageHeader, Panel, Button, inputStyle, Loading, ErrorLine } from '../../../components/ui'

const words = (err: unknown, fallback: string) =>
  isNetworkFailure(err) ? 'No connection. Try again when the internet is back.' : err instanceof Error ? err.message : fallback

const row = { display: 'grid', gridTemplateColumns: 'minmax(140px, 1fr) 120px minmax(160px, 2fr)', gap: '0.6rem', alignItems: 'center', marginBottom: '0.55rem' } as const
const label = { fontFamily: 'var(--font-inter)', color: 'var(--offwhite)', fontSize: '0.9rem' } as const

export default function AccountCodesPage() {
  const { checking } = useRequireRole(['admin'] as Role[])
  const [codes, setCodes] = useState<AccountCodes | null>(null)
  const [categories, setCategories] = useState<string[]>([])
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      const data = await unwrap(await authedFetch('/api/admin/account-codes', 'GET')) as unknown as { codes: AccountCodes; categories: string[] }
      setCodes(data.codes)
      setCategories(data.categories)
      setError('')
    } catch (err) {
      setError(words(err, 'The account codes could not be read.'))
    }
  }

  useEffect(() => {
    if (checking) return
    startLoad(load)
  }, [checking])

  async function save() {
    if (!codes) return
    setBusy(true); setError(''); setDone('')
    try {
      const categoriesOut = Object.fromEntries(Object.entries(codes.categories).filter(([, v]) => v.trim()))
      const data = await unwrap(await authedFetch('/api/admin/account-codes', 'PUT', { accounts: codes.accounts, categories: categoriesOut })) as unknown as { codes: AccountCodes }
      setCodes(data.codes)
      setDone('Saved. The next journal download uses these codes.')
    } catch (err) {
      setError(words(err, 'That was not saved.'))
    } finally {
      setBusy(false)
    }
  }

  const setAccount = (key: AccountKey, field: 'code' | 'name', value: string) =>
    setCodes(c => (c ? { ...c, accounts: { ...c.accounts, [key]: { ...c.accounts[key], [field]: value } } } : c))
  const setCategory = (cat: string, value: string) =>
    setCodes(c => (c ? { ...c, categories: { ...c.categories, [cat]: value } } : c))

  if (checking) return <Loading />
  return (
    <Page>
      <PageHeader title="Account Codes"
        lead="The chart of accounts the accountant's journal posts to. The defaults are a common layout: replace them with the codes from the accountant's own chart." />
      {error && <ErrorLine>{error}</ErrorLine>}
      {!codes ? <Loading /> : (
        <>
          <Panel title="Accounts">
            {(Object.keys(ACCOUNT_LABELS) as AccountKey[]).map(key => (
              <div key={key} style={row}>
                <span style={label}>{ACCOUNT_LABELS[key]}</span>
                <input aria-label={`${ACCOUNT_LABELS[key]} code`} value={codes.accounts[key].code} onChange={e => setAccount(key, 'code', e.target.value)} style={inputStyle} />
                <input aria-label={`${ACCOUNT_LABELS[key]} name`} value={codes.accounts[key].name} onChange={e => setAccount(key, 'name', e.target.value)} style={inputStyle} />
              </div>
            ))}
          </Panel>
          <Panel title="Sales by category">
            <p style={{ ...label, color: 'rgba(var(--offwhite-rgb),0.7)', marginBottom: '0.75rem' }}>
              A category left blank posts to the Sales account ({codes.accounts.sales.code}), named for its category.
            </p>
            {categories.map(cat => (
              <div key={cat} style={{ ...row, gridTemplateColumns: 'minmax(140px, 1fr) 120px' }}>
                <span style={label}>{cat}</span>
                <input aria-label={`${cat} sales code`} value={codes.categories[cat] ?? ''} placeholder={codes.accounts.sales.code} onChange={e => setCategory(cat, e.target.value)} style={inputStyle} />
              </div>
            ))}
          </Panel>
          {done && <p style={{ ...label, color: 'var(--teal)', marginBottom: '0.75rem' }}>{done}</p>}
          <Button tone="primary" icon={faFloppyDisk} onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save codes'}</Button>
        </>
      )}
    </Page>
  )
}
