// Tracks the Phase 00 migration: privileged mutations moving off the client
// SDK and behind route handlers.
//
//   npm run audit:writes            # summary + the ratchet
//   npm run audit:writes -- --list  # every remaining call site
//
// ── Why the headline number is not "all client writes" ────────────────────
// The standing rule from Phase 00 is "no new client SDK writes", but the goal
// was never zero client writes. It was zero client writes that a browser
// should not be trusted to make.
//
// A customer editing their own display name is a client write, and it is
// correct as one: the ownership rule in firestore.rules expresses exactly that
// constraint, and routing it through a server handler would add a hop, a
// failure mode and no safety. Moving it would be cargo-culting the rule
// instead of applying it.
//
// A manager approving a loyalty transaction is a different thing entirely.
// The browser is deciding who gets paid. That belongs on the server, and
// counting it in the same total as an avatar change hides it.
//
// So this splits them, and only PRIVILEGED is the number that has to reach
// zero. Chasing a single combined figure would have produced churn on the
// self-service writes and let the privileged ones hide in the noise.
//
// ── The ratchet ───────────────────────────────────────────────────────────
// BASELINE is the tracked count as of the last time it was locked in. The script
// exits non-zero if the count goes UP, so a new client-side privileged write
// fails CI rather than being noticed a year later. Lower the number as writes
// migrate; there is no mechanism to raise it silently.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const BASELINE = 0

const LIST = process.argv.includes('--list')

// ── Classification ────────────────────────────────────────────────────────
// Keyed by the enclosing function name. Deliberately explicit rather than
// inferred from the path: app/admin/** is a good hint but not a rule (a staff
// page can legitimately write a customer-owned doc), and packages/shared/src/** mixes both
// kinds inside a single module — redemptions.ts holds both "staff defines a
// reward" and "customer asks to redeem one".
//
// SELF: the writer owns the data and a rule can express that ownership.
// PRIV: the write is a staff decision, or sets a value the writer must not choose.
const SELF = new Set([
  // Account lifecycle for one's own login.
  'ensureCustomerProfile', 'signUpCustomer', 'signInCustomer', 'linkGoogleToPassword',
  'reserveUsername', 'updateOwnProfile', 'saveProfile', 'handleSaveProfile',
  // A customer's own bookings, invites and social graph.
  'createEventReservation', 'cancelEventReservation',
  'createTableReservation', 'cancelTableReservation',
  'createParticipantInvites', 'acceptInvite', 'declineInvite',
  'sendFriendRequest', 'acceptFriendRequest', 'declineFriendRequest', 'removeFriend',
  // Their own submissions and their own notification read-state.
  'submitCheck', 'handleSubmit', 'cancelTransaction',
  'requestRedemption', 'cancelRedemption',
  'markNotificationRead', 'createStatusNotification',
  // A customer creating their own booking/redemption REQUEST. It lands as
  // 'pending' and a rule pins that; approving it is a staff action and lives
  // in PRIV below. Request and approval are deliberately separate functions.
  'createEventReservationRequest', 'createTableReservationRequest',
  'createRedemptionRequest',
  'ensureCustomerDoc', 'completeAccountSetup',
  // Cosmetic fields on the customer's own document. The ownership rule in
  // firestore.rules already says exactly this; a route handler would add a
  // hop and no safety.
  'handleSelectAvatar', 'handleSelectTheme',
])

// Everything below is a staff decision. Listed rather than inferred so that
// adding a function forces a conscious choice about which side it is on.
const PRIV = new Set([
  // Staff-managed catalogue and content.
  'saveGame', 'deleteGame', 'addCategory', 'deleteCategory', 'handleSave', 'handleDelete',
  'saveMenuItem', 'deleteMenuItem', 'saveCategory', 'reorder', 'handleDragEnd',
  'saveEvent', 'deleteEvent', 'addType', 'deleteType',
  'importGames', 'runImport',
  // Inventory, ordering, receiving, end of day.
  'saveSupply', 'deleteSupply', 'seedFromTemplates', 'adjustStock',
  'submitWeeklyOrder', 'saveTemplateItem', 'deleteTemplateItem', 'saveProvider',
  'deleteProvider', 'saveOrderCategoryMeta', 'translateToArabic',
  'submitEndOfDay', 'saveEndOfDay', 'submitDailyCount',
  // Money and the loyalty economy.
  'approveTransaction', 'rejectTransaction',
  'createEventAttendanceTransaction', 'createTableCheckInTransaction',
  'confirmRedemption', 'rejectRedemption',
  'createRedemptionItem', 'updateRedemptionItem', 'deleteRedemptionItem',
  'seedRedemptionItemsIfEmpty',
  'recordGamePurchase', 'transferStock', 'nextInvoiceNumber', 'saveWholesaleInvoice',
  // Staff acting on a customer's account.
  'adjustCustomerPoints', 'deleteCustomerAccount', 'resetCustomerPassword',
  'setAnnualResetDate', 'runAnnualReset', 'updateCustomer',
  // Approving other people's bookings.
  'approveEventReservation', 'rejectEventReservation',
  'approveTableReservation', 'rejectTableReservation', 'checkInTableReservation',
  // Staff infrastructure.
  'logActivity', 'logCreate', 'logUpdate', 'logDelete',
  'saveBranchTableLayout', 'recordMediaUpload', 'deleteMediaItem',
  'saveOrderDepts', 'saveAccess',
  // Ordering, receiving, counting, end of day — all staff-only screens.
  'addProvider', 'updateProvider', 'addTemplateItem', 'updateTemplateItem',
  'submitWeeklyReport', 'logWeeklyOrderAction', 'updateReportItemQty',
  'deleteWeeklyReport', 'toggleWhatsappSent',
  'saveDailyInventoryDraft', 'submitDailyInventory',
  'saveEndOfDayReport', 'updateEodTips', 'saveBranchStaff', 'logEndOfDayAction',
  // Retail money: purchase orders, refunds, stock transfer, invoice sequences.
  'createPurchaseOrder', 'regenerateOrderInvoice', 'refundOrder',
  'transferGameStock', 'nextInvoiceSequence', 'generateWholesaleInvoice',
  // Staff editing a customer's balances, and the annual reset.
  'saveLoyaltyResetDate',
  // Awarding points, publishing rewards, the audit log, media backfill.
  'awardTableCheckin', 'toggleItemActive', 'writeLog', 'backfillMediaLibrary',
  // Loyalty, post-de-gamification: staff moving a customer's balance or
  // status, and the staff-managed tier perk catalogue.
  'updateCustomerPoints', 'updateCustomerPointsEarned',
  'seedTierPerksIfEmpty', 'createTierPerk', 'updateTierPerk', 'deleteTierPerk',
])

// ── Scan ──────────────────────────────────────────────────────────────────

// Both trees: the client writes live in apps/**, and packages/shared holds the
// modules they call into — a client write hiding in a shared module is exactly
// the kind this is looking for, so scanning only apps/ would miss it.
const files = []
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue
    const p = join(dir, entry).split('\\').join('/')
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.tsx?$/.test(p)) files.push(p)
  }
}
for (const app of ['web', 'admin', 'pos', 'shared']) walk(app)

const WRITE = /\b(addDoc|setDoc|updateDoc|deleteDoc|writeBatch|runTransaction)\s*\(/

const hits = []
for (const file of files) {
  // The server layer and route handlers are the destination, not the problem.
  if (file.includes('shared/src/server/') || file.includes('/api/')) continue

  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  lines.forEach((line, i) => {
    if (!WRITE.test(line)) return
    if (/^\s*(\/\/|\*)/.test(line)) return          // a mention in a comment

    // Walk back to the nearest `function NAME`, at any indentation.
    //
    // Two wrong versions preceded this one. Matching `const NAME = (` too
    // stopped at whichever local happened to be nearest — `before`, `newCoins`,
    // `url` — which are variables holding a value, not the thing doing the
    // writing. Anchoring instead to column 0 fixed that but lost every handler
    // declared INSIDE a page component (`handleSelectAvatar` and friends),
    // reporting the enclosing component instead.
    //
    // `function NAME` at any indent catches both: a nested handler is still a
    // function declaration, and an arrow-assigned local never is.
    let fn = '(top level)'
    for (let j = i; j >= 0; j--) {
      const m = lines[j].match(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/)
      if (m) { fn = m[1]; break }
    }

    // Name first, path second. A write inside app/admin/** is a staff action
    // by construction — those pages are behind useRequireRole — and the
    // enclosing "function" there is usually a React component or an inline
    // handler, which can't be named usefully. Falling back to the path stops
    // that from showing up as untriaged forever.
    //
    // No such fallback for packages/shared/src/**: those modules mix both kinds inside one
    // file, so anything there must be classified by name, deliberately.
    const kind =
      PRIV.has(fn) ? 'PRIV'
      : SELF.has(fn) ? 'SELF'
      : file.includes('app/admin/') ? 'PRIV'
      : 'TRIAGE'
    hits.push({ file, line: i + 1, fn, kind })
  })
}

// ── Report ────────────────────────────────────────────────────────────────

const count = k => hits.filter(h => h.kind === k).length
const priv = count('PRIV'), self = count('SELF'), triage = count('TRIAGE')

if (LIST) {
  for (const kind of ['PRIV', 'TRIAGE', 'SELF']) {
    const rows = hits.filter(h => h.kind === kind)
    if (!rows.length) continue
    console.log(`\n── ${kind} (${rows.length}) ──`)
    for (const h of rows) console.log(`  ${h.file}:${h.line}  ${h.fn}()`)
  }
  console.log('')
}

console.log(`Client-SDK writes outside app/api/ and app/lib/server/\n`)
console.log(`  PRIVILEGED   ${String(priv).padStart(3)}   must move behind a route handler`)
console.log(`  self-service ${String(self).padStart(3)}   correct as client writes; rules own them`)
console.log(`  needs triage ${String(triage).padStart(3)}   unclassified — add to SELF or PRIV in this script`)
console.log(`  ${'—'.repeat(46)}`)
console.log(`  total        ${String(hits.length).padStart(3)}\n`)

// TRIAGE counts toward the ratchet: an unclassified write is assumed
// privileged until someone says otherwise. Failing safe means a new staff
// mutation can't slip in simply by not being in either list yet.
const tracked = priv + triage
console.log(`Ratchet: ${tracked} tracked (privileged + untriaged), baseline ${BASELINE}.`)

if (tracked > BASELINE) {
  console.error(`\nFAIL: up ${tracked - BASELINE} from the baseline.`)
  console.error('A new privileged mutation was added on the client, or a new')
  console.error('function needs classifying. Move it behind a route handler, or')
  console.error('add it to SELF in this script if the writer genuinely owns the data.')
  process.exit(1)
}
if (tracked < BASELINE) {
  console.log(`\nDown ${BASELINE - tracked} from the baseline — lower BASELINE to ${tracked} to lock the gain in.`)
}
