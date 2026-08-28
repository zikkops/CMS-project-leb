'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  collection, doc, onSnapshot, getDoc, getDocs, setDoc, updateDoc, deleteDoc, deleteField, writeBatch,
} from 'firebase/firestore'
import { sendPasswordResetEmail } from 'firebase/auth'
import { auth, db } from './firebase'
import { logActivity, logUpdate, logDelete } from './activityLog'
import { getLevelFromXP, LEVEL_TITLES } from './levelConfig'

export interface CustomerAccount {
  id: string
  username: string
  displayName: string
  firstName: string
  lastName: string
  email: string
  phoneNumber: string
  avatarUrl: string
  xp: number
  level: number
  levelTitle: string
  obCoins: number
}

function toCustomer(id: string, data: Record<string, unknown>): CustomerAccount {
  return {
    id,
    username: (data.username as string) || '',
    displayName: (data.displayName as string) || (data.username as string) || 'Unnamed',
    firstName: '',
    lastName: '',
    email: (data.email as string) || '',
    phoneNumber: '',
    avatarUrl: (data.avatarUrl as string) || '',
    xp: (data.xp as number) ?? 0,
    level: (data.level as number) ?? 1,
    levelTitle: (data.levelTitle as string) || LEVEL_TITLES[0],
    obCoins: (data.obCoins as number) ?? 0,
  }
}

export interface StaffContactInfo {
  firstName: string
  lastName: string
  phoneNumber: string
}

// Real first/last name + phone number live in users/{uid}/private/contact,
// staff-only read (see firestore.rules) — the main users/{uid} doc is
// broadly readable by any signed-in customer, so neither belongs there.
// Fetched one getDoc per uid rather than a collectionGroup('private')
// query — a security rule scoped to specific document ids (here: 'contact')
// can't be proven safe for an *unfiltered* collection-group read, so
// Firestore rejects that whole query outright even though every individual
// doc is readable by staff; targeted per-uid gets sidestep that entirely.
// Re-fetches only when the actual set of uids changes (not on every
// render) — `key` is the stable, sorted/joined dependency.
export function useStaffContactDirectory(uids: string[]): Record<string, StaffContactInfo> {
  const [contacts, setContacts] = useState<Record<string, StaffContactInfo>>({})
  const key = useMemo(() => Array.from(new Set(uids)).sort().join(','), [uids])

  useEffect(() => {
    const list = key ? key.split(',') : []
    if (list.length === 0) { setContacts({}); return }
    let cancelled = false
    Promise.all(list.map(uid =>
      getDoc(doc(db, 'users', uid, 'private', 'contact')).then(snap => ({ uid, snap }))
    )).then(results => {
      if (cancelled) return
      const next: Record<string, StaffContactInfo> = {}
      results.forEach(({ uid, snap }) => {
        if (!snap.exists()) return
        const data = snap.data() as { firstName?: string; lastName?: string; phoneNumber?: string }
        next[uid] = {
          firstName: data.firstName || '',
          lastName: data.lastName || '',
          phoneNumber: data.phoneNumber || '',
        }
      })
      console.log(`[useStaffContactDirectory] fetched contact info for ${Object.keys(next).length}/${list.length} uid(s)`)
      setContacts(next)
    }).catch(err => console.error('[useStaffContactDirectory] private/contact batch fetch failed:', err))
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return contacts
}

// Live list of every customer account. This is an internal admin tool with a
// manageable customer count, so one collection-wide listener (rather than
// paginating) keeps edits/deletes reflected immediately without a manual
// refresh. Sorted client-side, not via `orderBy('displayName')` — Firestore
// excludes any doc missing the order field entirely, which would silently
// hide accounts that predate `displayName` being set.
export function useAllCustomers() {
  const [customers, setCustomers] = useState<CustomerAccount[]>([])
  const [loading, setLoading] = useState(true)
  const uids = useMemo(() => customers.map(c => c.id), [customers])
  const contacts = useStaffContactDirectory(uids)

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'users'), snap => {
      const list = snap.docs.map(d => toCustomer(d.id, d.data()))
      list.sort((a, b) => a.displayName.localeCompare(b.displayName))
      setCustomers(list)
      setLoading(false)
    })
    return unsub
  }, [])

  // Merged in separately from the contacts map (which arrives on its own
  // listener) rather than inside toCustomer — real name/phone now live
  // entirely off the main users/{uid} doc.
  const enriched = useMemo(() => customers.map(c => ({
    ...c,
    firstName: contacts[c.id]?.firstName ?? c.firstName,
    lastName: contacts[c.id]?.lastName ?? c.lastName,
    phoneNumber: contacts[c.id]?.phoneNumber ?? c.phoneNumber,
  })), [customers, contacts])

  return { customers: enriched, loading }
}

// XP and OB Coins are edited independently. Updating XP also recomputes
// level/levelTitle so they never drift out of sync with the new value —
// the same recompute the customer's own profile page does for itself.
export async function updateCustomerXP(customer: CustomerAccount, newXp: number): Promise<void> {
  const safeXp = Math.max(0, Math.round(newXp))
  const info = getLevelFromXP(safeXp)
  await updateDoc(doc(db, 'users', customer.id), {
    xp: safeXp, level: info.level, levelTitle: info.levelTitle,
  })
  await logUpdate(
    'Customer Account', customer.email || customer.username,
    { xp: customer.xp, level: customer.level, levelTitle: customer.levelTitle },
    { xp: safeXp, level: info.level, levelTitle: info.levelTitle }
  )
}

export async function updateCustomerCoins(customer: CustomerAccount, newCoins: number): Promise<void> {
  const safeCoins = Math.max(0, Math.round(newCoins))
  await updateDoc(doc(db, 'users', customer.id), { obCoins: safeCoins })
  await logUpdate('Customer Account', customer.email || customer.username, { obCoins: customer.obCoins }, { obCoins: safeCoins })
}

// Deletes the customer's Firestore profile (XP, coins, history references,
// theme, avatar) only. Their Firebase Auth login isn't touched — deleting
// another user's auth account isn't possible without server-side Admin SDK
// access, which this app deliberately doesn't have. If they sign back in
// after this, they'd land on a brand-new blank profile, same as a first-time
// signup.
export async function deleteCustomerAccount(customer: CustomerAccount): Promise<void> {
  // Firestore doesn't cascade-delete subcollections — the private/contact
  // and private/avatar docs (phone number, avatar delete-hash) would
  // otherwise be orphaned.
  await deleteDoc(doc(db, 'users', customer.id, 'private', 'contact'))
  await deleteDoc(doc(db, 'users', customer.id, 'private', 'avatar'))
  await deleteDoc(doc(db, 'users', customer.id))
  await logDelete('Customer Account', customer.email || customer.username, { ...customer })
}

export async function resendCustomerPasswordReset(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email)
  await logActivity('update', 'Customer Account', `Password reset email sent to ${email}`)
}

// ---------- Annual points reset ----------

export interface LoyaltyResetSettings {
  nextResetDate: string // 'YYYY-MM-DD'
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function oneYearFromToday(): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() + 1)
  return d.toISOString().slice(0, 10)
}

function oneYearAfter(dateStr: string): string {
  const d = new Date(dateStr)
  d.setFullYear(d.getFullYear() + 1)
  return d.toISOString().slice(0, 10)
}

const resetSettingsRef = doc(db, 'appSettings', 'loyaltyReset')

// `settings` is null until the doc has been saved at least once — callers
// fall back to `defaultDate` (today + 1 year) to pre-fill the date input.
export function useLoyaltyResetSettings() {
  const [settings, setSettings] = useState<LoyaltyResetSettings | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onSnapshot(resetSettingsRef, snap => {
      setSettings(snap.exists() ? { nextResetDate: snap.data().nextResetDate as string } : null)
      setLoading(false)
    })
    return unsub
  }, [])

  return { settings, loading, defaultDate: oneYearFromToday() }
}

export async function saveLoyaltyResetDate(dateStr: string, before: string | null): Promise<void> {
  await setDoc(resetSettingsRef, { nextResetDate: dateStr }, { merge: true })
  await logUpdate('Loyalty Reset Schedule', 'Next reset date', { nextResetDate: before }, { nextResetDate: dateStr })
}

// Auto-fires the reset for every customer once the configured date has
// passed. There's no server/cron job in this app (client SDK only), so this
// piggybacks on the first admin dashboard load on or after the date instead
// of running automatically at midnight. The settings doc's date is pushed a
// year forward *before* processing customers, so a second admin opening the
// dashboard moments later sees the already-rescheduled future date and skips
// — a double-run would just be a harmless no-op (zeroing already-zero values)
// anyway, so no distributed lock is needed for an internal tool like this.
export async function checkAndRunLoyaltyReset(): Promise<void> {
  const snap = await getDoc(resetSettingsRef)
  if (!snap.exists()) {
    // Never configured — seed it to a year from today rather than silently
    // never resetting anything.
    await setDoc(resetSettingsRef, { nextResetDate: oneYearFromToday() }, { merge: true })
    return
  }

  const nextResetDate = snap.data().nextResetDate as string
  if (todayStr() < nextResetDate) return

  const rescheduled = oneYearAfter(nextResetDate)
  await updateDoc(resetSettingsRef, { nextResetDate: rescheduled })

  const usersSnap = await getDocs(collection(db, 'users'))
  const docs = usersSnap.docs
  const zero = getLevelFromXP(0)

  for (let i = 0; i < docs.length; i += 500) {
    const batch = writeBatch(db)
    docs.slice(i, i + 500).forEach(d => {
      batch.update(d.ref, { xp: 0, level: zero.level, levelTitle: zero.levelTitle, obCoins: 0 })
    })
    await batch.commit()
  }

  await logActivity(
    'update', 'Loyalty Reset Schedule',
    `Annual points reset ran for ${docs.length} customer${docs.length === 1 ? '' : 's'} — next reset ${rescheduled}`
  )
}

const privateFieldsMigrationRef = doc(db, 'appSettings', 'privateFieldsMigration')

// One-time cleanup for accounts created before phoneNumber/avatarDeleteUrl
// moved off the main users/{uid} doc into private sub-docs (see
// firestore.rules) — that doc is broadly readable by any signed-in
// customer, so anything written there before this migration ran would
// otherwise still be sitting there, unprotected, indefinitely. Same
// passive trigger as checkAndRunLoyaltyReset (first admin dashboard load),
// guarded by its own appSettings flag so it only ever runs once; a
// double-run would just redundantly re-write the same already-migrated
// values, which is harmless.
export async function migratePrivateFieldsOnce(): Promise<void> {
  const snap = await getDoc(privateFieldsMigrationRef)
  if (snap.exists() && snap.data().done) return
  await setDoc(privateFieldsMigrationRef, { done: true }, { merge: true })

  const usersSnap = await getDocs(collection(db, 'users'))
  let migrated = 0

  for (const d of usersSnap.docs) {
    const data = d.data() as { phoneNumber?: string; avatarDeleteUrl?: string | null }
    const hasPhone = typeof data.phoneNumber === 'string'
    const hasAvatarUrl = data.avatarDeleteUrl !== undefined
    if (!hasPhone && !hasAvatarUrl) continue

    if (hasPhone) {
      await setDoc(doc(db, 'users', d.id, 'private', 'contact'), { phoneNumber: data.phoneNumber }, { merge: true })
    }
    if (hasAvatarUrl) {
      await setDoc(doc(db, 'users', d.id, 'private', 'avatar'), { avatarDeleteUrl: data.avatarDeleteUrl }, { merge: true })
    }
    await updateDoc(d.ref, {
      ...(hasPhone ? { phoneNumber: deleteField() } : {}),
      ...(hasAvatarUrl ? { avatarDeleteUrl: deleteField() } : {}),
    })
    migrated++
  }

  if (migrated > 0) {
    await logActivity(
      'update', 'Customer Account',
      `Migrated phone number / avatar delete-hash off the main profile doc for ${migrated} customer${migrated === 1 ? '' : 's'}`
    )
  }
}

const nameFieldsMigrationRef = doc(db, 'appSettings', 'nameFieldsMigration')

// Same one-time passive migration as migratePrivateFieldsOnce above, run
// under its own flag since that one is already marked done on existing
// deployments — firstName/lastName are real legal names, so they get the
// same treatment phoneNumber already got: off the broadly-readable main
// doc and into the staff-only private/contact doc.
export async function migrateNameFieldsOnce(): Promise<void> {
  const snap = await getDoc(nameFieldsMigrationRef)
  if (snap.exists() && snap.data().done) return
  await setDoc(nameFieldsMigrationRef, { done: true }, { merge: true })

  const usersSnap = await getDocs(collection(db, 'users'))
  let migrated = 0

  for (const d of usersSnap.docs) {
    const data = d.data() as { firstName?: string; lastName?: string }
    const hasFirst = typeof data.firstName === 'string'
    const hasLast = typeof data.lastName === 'string'
    if (!hasFirst && !hasLast) continue

    await setDoc(doc(db, 'users', d.id, 'private', 'contact'), {
      ...(hasFirst ? { firstName: data.firstName } : {}),
      ...(hasLast ? { lastName: data.lastName } : {}),
    }, { merge: true })
    await updateDoc(d.ref, {
      ...(hasFirst ? { firstName: deleteField() } : {}),
      ...(hasLast ? { lastName: deleteField() } : {}),
    })
    migrated++
  }

  if (migrated > 0) {
    await logActivity(
      'update', 'Customer Account',
      `Migrated first/last name off the main profile doc for ${migrated} customer${migrated === 1 ? '' : 's'}`
    )
  }
}

// `exceljs` is dynamically imported so it never lands in the main admin
// bundle; this runs once, on demand, when staff click "Export." Real
// name/phone are already merged onto `customers` by useAllCustomers, so
// no separate private/contact read is needed here.
export async function exportCustomersToExcel(customers: CustomerAccount[]): Promise<void> {
  // The bare 'exceljs' specifier resolves to the package's Node entry point
  // (excel.js), which unconditionally checks process.versions.node at
  // import time — that throws immediately in a browser, where `process`
  // isn't defined. exceljs publishes a separate, self-contained browser
  // bundle specifically for this (see its README's "Browser" section);
  // importing that exact file sidesteps the Node-vs-browser entry-point
  // mismatch instead of relying on the bundler picking package.json's
  // "browser" field on its own.
  const { default: ExcelJS } = await import('exceljs/dist/exceljs.min.js')
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Customers')
  sheet.columns = [
    { header: 'First Name', key: 'firstName', width: 18 },
    { header: 'Last Name', key: 'lastName', width: 18 },
    { header: 'Username', key: 'username', width: 18 },
    { header: 'Email', key: 'email', width: 28 },
    { header: 'Phone Number', key: 'phoneNumber', width: 18 },
    { header: 'Level', key: 'level', width: 8 },
    { header: 'Level Title', key: 'levelTitle', width: 18 },
    { header: 'XP', key: 'xp', width: 10 },
    { header: 'OB Coins', key: 'obCoins', width: 10 },
  ]
  sheet.getRow(1).font = { bold: true }

  customers.forEach(c => {
    sheet.addRow({
      firstName: c.firstName,
      lastName: c.lastName,
      username: c.username,
      email: c.email,
      phoneNumber: c.phoneNumber,
      level: c.level,
      levelTitle: c.levelTitle,
      xp: c.xp,
      obCoins: c.obCoins,
    })
  })

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `customers-${new Date().toISOString().slice(0, 10)}.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
