// Open checks. Phase 03, POS v1.
//
// POST   open a check on a table, or add lines to one
// PATCH  send, void a line, move to another table, or close
//
// Gated on the `pos` section, which is grantable per person: taking orders is
// a shift-by-shift thing a manager hands out without changing a role.
//
// Every price is looked up server-side. The browser sends an item id, a
// quantity and modifier option ids — never a price, a name or a station. See
// the note at the top of @big-cms/shared/server/checks.

import { requireSection, toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import {
  parseLineRequests, parseBatchKey, openCheck, addLines, sendCheck, voidLine, moveCheck, moveLines, mergeChecks, closeCheck,
  setStaffMeal, refundCheck, addPayment, parsePaymentRequest, parsePaymentKey, setLoyaltyCustomer,
  setLineDiscount, setCheckDiscount, removeServiceCharge, fireHeld, parseDiscountInput, parseOpenId, parseMadeOffline,
} from '@big-cms/shared/server/checks'
import { logActivity } from '@big-cms/shared/server/activityLog'
import { refuseWhileHubbed } from '@big-cms/shared/server/hubLock'

export const runtime = 'nodejs'

/** How the activity log names a check: its table, or none for a takeaway, delivery or tab (UPGRADE.md T5.5). */
const where = (tableNumber: number) => tableNumber > 0 ? `table ${tableNumber}` : 'an order with no table'

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json()
    if (!body || typeof body !== 'object') throw new Error('not an object')
    return body as Record<string, unknown>
  } catch {
    throw new HttpError(400, 'Invalid request body.')
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'pos')
    const body = await readBody(request)

    // Adding to an existing check names one; opening a new check names a table.
    //
    // A request carrying `lines` but no checkId used to fall through to the
    // open path, which then failed on the missing branch with "Unknown
    // branch" — an error about the wrong thing entirely, and one that sent me
    // looking at the branch config for several minutes. Say what is actually
    // wrong.
    const checkId = typeof body.checkId === 'string' ? body.checkId : ''
    if (!checkId && Array.isArray(body.lines)) {
      throw new HttpError(400, 'Missing check id — items can only be added to an open check.')
    }
    // A branch a café hub trades is view-only here (S10).
    await refuseWhileHubbed(checkId ? { checkId } : { branch: String(body.branch ?? '') })
    if (checkId) {
      const madeOfflineAt = parseMadeOffline(body)
      const result = await addLines(caller, checkId, parseLineRequests(body), parseBatchKey(body), madeOfflineAt)
      // Deliberately not logged, as a rule: a service is hundreds of these, and
      // an audit entry per item would bury everything else that happened.
      // The exception is items recorded as made during an outage — the one
      // path that goes around the kitchen, so the one worth an entry.
      if (madeOfflineAt && !result.duplicate) {
        await logActivity(caller, 'create', 'POS',
          `Recorded ${result.added} item${result.added === 1 ? '' : 's'} taken during an outage at ${madeOfflineAt}`)
      }
      return Response.json({ ok: true, ...result })
    }

    const { id, replayed } = await openCheck(caller, {
      branch: String(body.branch ?? ''),
      // A number, not an id. A waiter types "7"; whether table 7 is on the
      // floor plan is the server's problem, not the phone's.
      tableNumber: Number(body.tableNumber ?? 0),
      guestCount: Number(body.guestCount ?? 1),
      // Optional: the counter device names the check itself, so an open
      // queued offline and replayed later is recognised, not refused (7b).
      openId: parseOpenId(body),
      // Takeaway, delivery or a tab (UPGRADE.md T5.5); absent is a table.
      orderType: body.orderType,
      orderName: body.orderName,
    })
    return Response.json({ ok: true, id, replayed })
  } catch (err) {
    return toResponse(err)
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'pos')
    const body = await readBody(request)

    const checkId = typeof body.checkId === 'string' ? body.checkId : ''
    if (!checkId) throw new HttpError(400, 'Missing check id.')
    await refuseWhileHubbed({ checkId })

    switch (String(body.action ?? '')) {
      case 'send': {
        const result = await sendCheck(caller, checkId, Array.isArray(body.hold) ? body.hold : [])
        return Response.json({ ok: true, ...result })
      }
      case 'fire': {
        // What a Send held back, to the pass now (UPGRADE.md T3.11). Not
        // logged, like a Send: the tickets carry who fired them.
        const result = await fireHeld(caller, checkId)
        return Response.json({ ok: true, ...result })
      }
      case 'void': {
        // Logged, unlike adding an item: striking something off is a decision
        // with a reason attached, and it is the one a manager asks about.
        const result = await voidLine(
          caller,
          checkId,
          String(body.lineId ?? ''),
          String(body.reasonKey ?? ''),
          String(body.note ?? ''),
        )
        await logActivity(caller, 'delete', 'POS',
          `Voided an item${result.wasSent ? ' after it was sent' : ''} — ${result.label}` +
          (result.restored > 0 ? ` — ${result.restored} back on the shelf` : '') +
          (result.ingredients === 'return' ? ' — ingredients back in stock' : '') +
          (result.ingredients === 'waste' ? ' — ingredients recorded as waste' : ''))
        return Response.json({ ok: true, ...result })
      }
      case 'moveLines':
      case 'merge': {
        // Items to another open check, or the whole table into it (UPGRADE.md
        // T5.6). The key makes a retried move one move. The receiving check is
        // at the same branch (moveProblem), so the lock above covers it.
        const toCheckId = typeof body.toCheckId === 'string' ? body.toCheckId : ''
        if (!toCheckId) throw new HttpError(400, 'Choose the check to move them to.')
        const moveKey = parseBatchKey({ batchKey: body.moveKey })
        const result = body.action === 'merge'
          ? await mergeChecks(caller, checkId, toCheckId, moveKey)
          : await moveLines(caller, checkId, toCheckId, Array.isArray(body.lineIds) ? body.lineIds.map(String) : [], moveKey)
        if (!result.duplicate) {
          await logActivity(caller, 'update', 'POS', body.action === 'merge'
            ? `Merged ${result.from} into ${result.to} (${result.moved} item${result.moved === 1 ? '' : 's'})`
            : `Moved ${result.moved} item${result.moved === 1 ? '' : 's'} from ${result.from} to ${result.to}`)
        }
        return Response.json({ ok: true, ...result })
      }
      case 'move': {
        const result = await moveCheck(caller, checkId, Number(body.tableNumber ?? 0))
        await logActivity(caller, 'update', 'POS',
          `Moved a check from table ${result.from} to table ${result.to}`)
        return Response.json({ ok: true, ...result })
      }
      case 'staffMeal': {
        // Logged. A discount is the one thing on a check somebody should be
        // answerable for, and the entry names the rates that were applied
        // rather than just that a discount happened.
        const on = body.on === true
        const r = await setStaffMeal(caller, checkId, on)
        await logActivity(caller, 'update', 'POS', on
          ? `Staff meal on a check — ${Math.round(r.food * 100)}% off food, ${Math.round(r.drink * 100)}% off drinks`
          : 'Staff meal removed from a check')
        return Response.json({ ok: true, ...r })
      }
      case 'lineDiscount':
      case 'checkDiscount': {
        // Logged, every one, with its reason: a discount is somebody's
        // discretion over the café's money, and it is the entry a manager's
        // manager asks about. Managers and admins only — checked inside.
        const input = parseDiscountInput(body)
        const r = body.action === 'lineDiscount'
          ? await setLineDiscount(caller, checkId, String(body.lineId ?? ''), input)
          : await setCheckDiscount(caller, checkId, input)
        await logActivity(caller, 'update', 'POS',
          `${r.label} — ${where(r.tableNumber)}` + (input ? ` — ${input.reasonKey}${input.note ? `: ${input.note}` : ''}` : ''))
        return Response.json({ ok: true, ...r })
      }
      case 'removeService': {
        // Logged: taking money off a bill is somebody's decision (UPGRADE.md T3.8).
        const r = await removeServiceCharge(caller, checkId)
        await logActivity(caller, 'update', 'POS', `${r.label} — ${where(r.tableNumber)}`)
        return Response.json({ ok: true, ...r })
      }
      case 'customer': {
        // Logged: who collects a check's points is a decision about somebody's
        // balance, and "who put that customer on my table" gets asked.
        const code = typeof body.code === 'string' && body.code.trim() ? body.code : null
        const r = await setLoyaltyCustomer(caller, checkId, code)
        await logActivity(caller, 'update', 'POS', r.name
          ? `Loyalty customer ${r.name} added to ${where(r.tableNumber)}`
          : `Loyalty customer removed from ${where(r.tableNumber)}`)
        return Response.json({ ok: true, ...r })
      }
      case 'pay': {
        // Logged, every one. This is money changing hands, and "who took it,
        // in what, and how much went back" is the question asked at the
        // drawer. A resend is not a second payment, so it is not logged twice.
        const r = await addPayment(caller, checkId, parsePaymentRequest(body), parsePaymentKey(body))
        if (!r.duplicate) {
          const p = r.payment
          const change = [
            p.changeUsd > 0 ? `$${p.changeUsd}` : '',
            p.changeLbp > 0 ? `${p.changeLbp.toLocaleString('en-US')} LBP` : '',
          ].filter(Boolean).join(' + ')
          await logActivity(caller, 'create', 'POS',
            `Took ${p.tender} ${p.amount.toLocaleString('en-US')} ${p.currency} on ${where(r.tableNumber)}` +
            (change ? ` — change ${change}` : '') +
            (r.settled ? ' — paid in full' : ''))
        }
        return Response.json({ ok: true, ...r })
      }
      case 'close': {
        const result = await closeCheck(caller, checkId)
        return Response.json({ ok: true, ...result })
      }
      case 'refund': {
        // Logged, and the entry names the receipt rather than a document id —
        // "which refund was that" is asked with a piece of paper in hand.
        // The reason is a choice, as for a void: it decides what goes back on
        // the shelf. The note is free text beside it, required for Other.
        const result = await refundCheck(caller, checkId, String(body.reasonKey ?? ''), String(body.note ?? ''))
        await logActivity(caller, 'update', 'POS',
          `Refunded receipt ${result.receiptNumber} (${where(result.tableNumber)})` +
          (result.restored > 0 ? ` — ${result.restored} item(s) back on the shelf` : '') +
          (result.ingredients === 'return' ? ' — ingredients back in stock' : '') +
          (result.ingredients === 'waste' ? ' — ingredients recorded as waste' : '') +
          ` — ${result.label}`)
        return Response.json({ ok: true, ...result })
      }
      default:
        throw new HttpError(400, 'Unknown action.')
    }
  } catch (err) {
    return toResponse(err)
  }
}
