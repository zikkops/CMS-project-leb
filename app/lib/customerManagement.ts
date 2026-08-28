'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  collection, doc, onSnapshot, getDoc, getDocs, setDoc, updateDoc, deleteDoc, deleteField, writeBatch,
} from 'firebase/firestore'
import { sendPasswordResetEmail } from 'firebase/auth'
import { auth, db } from './firebase'
import { logActivity, logUpdate, logDelete } from './activityLog'
import { authedFetch, unwrap } from './apiClient'

export interface CustomerAccount {
  id: string
  username: string
  displayName: string
  firstName: string
  lastName: string
  email: string
  phoneNumber: string
  avatarUrl: string
  points: number
  pointsEarned: number
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
    points: (data.points as number) ?? 0,
    pointsEarned: (data.pointsEarned as number) ?? 0,
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

// The balance and the earned-total are edited separately, because they answer
// different questions: what the customer can spend, and what status they have
// reached. Correcting a mis-award usually means moving both; a goodwill
// top-up usually means moving only the balance.
//
// There is no longer a level to recompute — status is derived from
// pointsEarned on read (see app/lib/loyaltyTiers.ts), so nothing can drift.
// Both run SERVER-SIDE (Phase 00 standing rule). Firestore rules permit
// loyalty staff to write balance fields and cannot check what is written, so
// the audit entry was the only record of a correction — written by the same
// browser making it, and trivially skippable. The route writes the document
// and the log entry from one verified caller.
//
// Sent together in one request rather than as two calls: the form edits both
// numbers at once, and two requests could half-apply.
export async function updateCustomerBalance(
  customer: CustomerAccount,
  next: { points?: number; pointsEarned?: number },
): Promise<void> {
  const res = await authedFetch('/api/admin/loyalty/customers', 'PATCH', {
    uid: customer.id, ...next,
  })
  await unwrap(res)
}

// Deletes the customer's Firestore profile (points, history references,
// theme, avatar) only. Their Firebase Auth login isn't touched, so signing
// back in lands them on a brand-new blank profile, same as a first-time
// signup.
//
// This used to say true deletion 'isn't possible without server-side Admin SDK
// access, which this app deliberately doesn't have'. That has been wrong since
// Phase 00 — adminAuth().deleteUser() is available and the accounts route
// already uses it for rollback. This function is simply still on the old path;
// it is one of the privileged writes npm run audit:writes is tracking.
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

// Runs SERVER-SIDE, on a schedule (Phase 00's "real cron"). See
// app/api/admin/loyalty/reset — Vercel Cron calls it daily; this function is
// the manual "run it now" for an admin.
//
// The old version ran in this browser, fired by the first admin to open the
// dashboard on or after the date. Its comment argued no lock was needed
// because a double run is a harmless no-op, which is true — but it advanced
// the date a year BEFORE touching any customer, so closing the tab midway
// left the schedule saying "not due" with half the customers un-reset, no
// error and no retry.
//
// The server version is resumable by construction: it queries for accounts
// that still have a balance, so anything already zeroed drops out of the set,
// and the date advances only once a pass finds nothing left.
export async function runLoyaltyResetNow(force = false): Promise<{ status: string; customersReset: number; nextResetDate?: string }> {
  const res = await authedFetch('/api/admin/loyalty/reset', 'POST', { force })
  const data = await unwrap(res)
  return data as { status: string; customersReset: number; nextResetDate?: string }
}

// migratePrivateFieldsOnce() and migrateNameFieldsOnce() used to live here.
//
// Both moved personal fields (phoneNumber, avatarDeleteUrl, firstName,
// lastName) off users/{uid} — which any signed-in customer can read, because
// friend search needs it — into the staff-only private sub-docs. Both ran in
// the browser, triggered by whichever admin loaded the dashboard first.
//
// They are gone for two reasons.
//
// The trigger was wrong. Each set its `done` flag BEFORE doing the work, so a
// tab closed midway left the flag saying finished while the remaining accounts
// kept their phone numbers on the publicly-readable document — permanently,
// since nothing would ever retry. For a migration whose whole purpose is to
// stop exposing personal data, failing silently in the exposed direction is
// the wrong way round. (The annual points reset had the same bug; see
// app/lib/server/loyalty.ts.)
//
// And the timing was wrong. They fixed a data shape that only ever existed in
// the original café's database, yet ran on every admin dashboard load forever.
// A fresh tenant has nothing to migrate.
//
// The transform survives as scripts/harden-customer-fields.mjs — run
// deliberately, resumable without a flag (it queries for documents that still
// carry the fields), and useful after importing customers from another system,
// which is the case that still produces the old shape.

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
    { header: 'Points', key: 'points', width: 10 },
    { header: 'Points Earned', key: 'pointsEarned', width: 14 },
  ]
  sheet.getRow(1).font = { bold: true }

  customers.forEach(c => {
    sheet.addRow({
      firstName: c.firstName,
      lastName: c.lastName,
      username: c.username,
      email: c.email,
      phoneNumber: c.phoneNumber,
      points: c.points,
      pointsEarned: c.pointsEarned,
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
