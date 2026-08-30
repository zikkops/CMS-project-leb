'use client'

import { useEffect, useState } from 'react'
import {
  GoogleAuthProvider, signInWithPopup,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile,
  linkWithCredential, EmailAuthProvider,
  onAuthStateChanged, signOut, sendEmailVerification, type User,
} from 'firebase/auth'
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, runTransaction } from 'firebase/firestore'
import { auth, db } from './firebase'

// Independent from shared/src/adminAuth.ts on purpose — customers and staff are
// different audiences with different permission models.
//
// They are NOT different collections. Both live in `users/{uid}`, and a staff
// account is one carrying `isStaff: true`. (An older comment here claimed an
// `adminUsers` collection; there has never been one.) Because it is one
// collection and one Firebase Auth user, nothing stopped a staff account from
// also signing in on the customer side and accruing a balance — which is what
// isStaffAccount() below now prevents at every entry point.

// A staff account must not be usable as a customer account.
//
// Reads the `staff` custom claim rather than the user document: it is the same
// source firestore.rules checks, it costs no billed read, and it cannot
// disagree with the rules the way a separately-read document can. Claims are
// minted on every account create, edit and delete (shared/src/server/claims.ts).
//
// The document fallback mirrors isStaff() in firestore.rules and exists for
// the same reason: a token issued before the claims backfill carries none.
async function isStaffAccount(user: User): Promise<boolean> {
  try {
    const token = await user.getIdTokenResult()
    if (token.claims.staff === true) return true
    // A token that carries ANY claim set has been minted since the backfill,
    // so the absence of `staff` on it is a real answer, not a gap.
    if (token.claims.staff !== undefined || token.claims.wholesale !== undefined) return false
  } catch {
    // Fall through to the document — a token that won't resolve must not
    // silently grant customer access.
  }
  const snap = await getDoc(doc(db, 'users', user.uid))
  return snap.exists() && snap.data().isStaff === true
}

// Signs the user straight back out and reports it. Throwing without signing
// out would leave a staff session live on the customer side with only the UI
// pretending otherwise.
async function rejectIfStaff(user: User): Promise<void> {
  if (!(await isStaffAccount(user))) return
  await signOut(auth)
  throw new Error('staff-account')
}

/**
 * The signed-in customer, plus whether this account is actually staff.
 *
 * `isStaff` matters because a session can already exist — someone signed into
 * the admin panel in this browser is signed in, full stop, and would otherwise
 * walk straight into the customer area. The sign-in guards only cover accounts
 * signing in through the customer forms.
 *
 * It stays `loading` until the claim has been read, so a guard never gets a
 * momentary `false` and lets the page render before bouncing.
 */
export function useCustomerUser() {
  const [user, setUser]       = useState<User | null>(null)
  const [isStaff, setIsStaff] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const unsub = onAuthStateChanged(auth, async u => {
      if (cancelled) return
      if (!u) { setUser(null); setIsStaff(false); setLoading(false); return }
      const staff = await isStaffAccount(u)
      if (cancelled) return
      setUser(u)
      setIsStaff(staff)
      setLoading(false)
    })
    return () => { cancelled = true; unsub() }
  }, [])

  return { user, loading, isStaff }
}

// First-time sign-in only — if the doc already exists this is a no-op, so a
// returning customer's points/badges are never reset on repeat logins.
async function ensureCustomerDoc(
  user: User, username?: string, phoneNumber?: string, firstName?: string, lastName?: string
) {
  const ref = doc(db, 'users', user.uid)
  const snap = await getDoc(ref)
  if (snap.exists()) return

  await setDoc(ref, {
    username: username ?? '',
    displayName: username ?? user.displayName ?? '',
    email: user.email ?? '',
    avatarUrl: user.photoURL ?? '',
    themeId: 'midnight',
    points: 0,
    pointsEarned: 0,
    badges: [],
    createdAt: serverTimestamp(),
    role: 'customer',
  })
  // Phone number and real first/last name live in a private sub-doc, not
  // the main profile — that doc is broadly readable by any signed-in
  // customer (friend search, leaderboard), and neither has any business
  // being part of that.
  await setDoc(doc(db, 'users', user.uid, 'private', 'contact'), {
    phoneNumber: phoneNumber ?? '',
    firstName: firstName ?? '',
    lastName: lastName ?? '',
  }, { merge: true })
}

async function needsUsername(uid: string): Promise<boolean> {
  const snap = await getDoc(doc(db, 'users', uid))
  return !snap.data()?.username
}

// Usernames live in their own collection, keyed by the lowercased username,
// so claiming one is an atomic Firestore transaction (the only safe way to
// enforce uniqueness client-side — a read-then-write query has a race window).
// The email is denormalized onto this doc too: logging in by username has to
// resolve to a real email *before* the user is authenticated, and the
// `users/{uid}` doc is locked down to its own owner, so this public mapping
// is the only place that lookup can read from. That does mean the
// usernames collection is publicly readable (see the Firestore rules note).
async function reserveUsername(username: string, uid: string, email: string) {
  const key = username.trim().toLowerCase()
  const ref = doc(db, 'usernames', key)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (snap.exists()) throw new Error('username-taken')
    tx.set(ref, { uid, email, createdAt: serverTimestamp() })
  })
}

// Turns a login-box value that might be a username into a real email by
// looking it up in the public `usernames` mapping. Passes emails through
// untouched. Exported so the login page can resolve it once up front and
// reuse the result for the Google-link recovery flow if sign-in then fails.
export async function resolveCustomerEmail(identifier: string): Promise<string> {
  const trimmed = identifier.trim()
  if (trimmed.includes('@')) return trimmed

  const snap = await getDoc(doc(db, 'usernames', trimmed.toLowerCase()))
  const email = snap.exists() ? (snap.data().email as string) : ''
  if (!email) throw new Error('user-not-found')
  return email
}

// Requires Google enabled as a Sign-in provider in Firebase Console:
// Authentication -> Sign-in method -> Google -> Enable. Not something
// this codebase can configure — it's a console-only setting.
export async function signInWithGoogle(): Promise<{ user: User; needsUsername: boolean }> {
  const provider = new GoogleAuthProvider()
  const cred = await signInWithPopup(auth, provider)
  await rejectIfStaff(cred.user)
  await ensureCustomerDoc(cred.user)
  return { user: cred.user, needsUsername: await needsUsername(cred.user.uid) }
}

export const PHONE_PATTERN = /^[0-9+\-\s()]{7,20}$/

// Lets a Google-only customer (no username yet, e.g. first Google login, or
// any older account from before usernames existed) claim a username and
// record their phone number/legal name — all required to finish registering.
export async function completeAccountSetup(
  uid: string, email: string, username: string, phoneNumber: string, firstName: string, lastName: string
): Promise<void> {
  const trimmed = username.trim()
  const phone = phoneNumber.trim()
  const first = firstName.trim()
  const last = lastName.trim()
  if (!trimmed) throw new Error('username-required')
  if (!PHONE_PATTERN.test(phone)) throw new Error('phone-required')
  if (!first || !last) throw new Error('name-required')
  if (first.length > 50 || last.length > 50) throw new Error('name-too-long')
  await reserveUsername(trimmed, uid, email)
  await updateDoc(doc(db, 'users', uid), { username: trimmed })
  await setDoc(doc(db, 'users', uid, 'private', 'contact'), { phoneNumber: phone, firstName: first, lastName: last }, { merge: true })
}

export async function signUpWithEmail(
  username: string, email: string, password: string, phoneNumber: string, firstName: string, lastName: string
): Promise<User> {
  const trimmed = username.trim()
  const phone = phoneNumber.trim()
  const first = firstName.trim()
  const last = lastName.trim()
  if (!trimmed) throw new Error('username-required')
  if (!PHONE_PATTERN.test(phone)) throw new Error('phone-required')
  if (!first || !last) throw new Error('name-required')
  if (first.length > 50 || last.length > 50) throw new Error('name-too-long')

  const cred = await createUserWithEmailAndPassword(auth, email, password)
  try {
    await reserveUsername(trimmed, cred.user.uid, email)
  } catch (err) {
    // Roll back — otherwise retrying with a different username hits
    // email-already-in-use for an account that never got claimed.
    await cred.user.delete()
    throw err
  }
  await updateProfile(cred.user, { displayName: trimmed })
  await ensureCustomerDoc(cred.user, trimmed, phone, first, last)
  // Best-effort — a customer who signed up with an email they don't
  // control just won't be able to verify later; it shouldn't block the
  // signup itself if Firebase's email send hiccups.
  try { await sendEmailVerification(cred.user) } catch { /* not fatal */ }
  return cred.user
}

// Google accounts are already verified by Google itself (Firebase trusts
// that), so this only ever matters for email/password signups — there's
// nothing to resend for a Google-only account.
export async function resendVerificationEmail(): Promise<void> {
  if (!auth.currentUser) throw new Error('not-signed-in')
  await sendEmailVerification(auth.currentUser)
}

// `user.emailVerified` on the cached Auth object only updates after a
// fresh token fetch — clicking the link in the verification email doesn't
// push a live update to an already-open tab. Call this (then re-read
// `auth.currentUser?.emailVerified`) after the customer says they've
// clicked it, rather than making them sign out and back in.
export async function refreshEmailVerified(): Promise<boolean> {
  if (!auth.currentUser) return false
  await auth.currentUser.reload()
  return auth.currentUser.emailVerified
}

// Accepts either an email or a username in `identifier`.
export async function signInCustomer(identifier: string, password: string): Promise<User> {
  const email = await resolveCustomerEmail(identifier)
  const cred = await signInWithEmailAndPassword(auth, email, password)
  await rejectIfStaff(cred.user)
  await ensureCustomerDoc(cred.user)
  return cred.user
}

// Recovery path for a Google-only account: re-authenticating with Google
// proves ownership, then we attach the password they just typed to that same
// account so they can use either method going forward.
export async function linkGoogleWithPassword(email: string, password: string): Promise<{ user: User; needsUsername: boolean }> {
  const provider = new GoogleAuthProvider()
  const cred = await signInWithPopup(auth, provider)

  if (cred.user.email?.toLowerCase() !== email.trim().toLowerCase()) {
    await signOut(auth)
    throw new Error('email-mismatch')
  }

  await rejectIfStaff(cred.user)
  await linkWithCredential(cred.user, EmailAuthProvider.credential(email, password))
  await ensureCustomerDoc(cred.user)
  return { user: cred.user, needsUsername: await needsUsername(cred.user.uid) }
}

export async function signOutCustomer() {
  await signOut(auth)
}
