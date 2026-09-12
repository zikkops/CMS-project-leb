# The pilot

One section of one branch, for one service, with the old till still taking the
money. This is the step that turns roughly seven hundred passing assertions
into evidence, and nothing else in the plan is worth doing first.

Everything below assumes the constraint that makes it safe: **the `payments`
feature switch stays off.** With it off, a check closes exactly as it did in
v1 while the old register takes payment, so the new system can be wrong about
a bill without anyone's night going badly.

---

## The decision to make before anything else

**Which deployment and which Firebase project does the pilot run against?**

This repo is a de-branded product fork pointed at `cms-project-f7e15`, a demo
project. The café's live data is not in it. So a pilot is one of:

- **Against the demo project**, with waiters entering real orders that are
  thrown away afterwards. Safe, and tests the software but not the data path
  a real café would use. Menu and staff must be set up there first.
- **Against a project holding the café's real menu and staff.** Tests the real
  thing. Needs the isolation rules in `FORK.md` re-read first, a service
  account for that project, and `npm run check:env` to confirm which project
  the app is actually pointed at.

Nothing else in this document depends on the answer, but the answer changes
what "clear the demo data" means below, and it is not a decision to discover
halfway through a Friday.

---

## The week before

1. **Confirm what is actually deployed.**
   ```bash
   npm run rules:live          # the deployed ruleset vs firestore.rules
   npm run check:env           # which project the app is pointed at
   ```
   A rule that is written but not deployed looks exactly like a rule that is
   wrong, from the application's side. That is what the printing-settings bug
   was.

2. **Take a backup, and check it.**
   ```bash
   npm run backup
   npm run restore -- backups/<the new folder>     # compares, writes nothing
   ```
   It should report every document identical. This is also the moment to
   decide whether managed backups are wanted — see the note at the end.

3. **Clear the seeded demo history if the pilot is on the demo project.**
   ```bash
   npm run seed:pos -- --clear --apply
   ```
   Seeded checks are marked `seeded: true` and nothing else is touched. Their
   receipt numbers are burnt on purpose, so real closes carry on above them.

4. **Provision the people.** Each waiter needs a staff account with the `pos`
   section; whoever runs the pass needs `kds`. A manager grants a section for
   one shift without changing anybody's role — that is what sections are for.

5. **Decide the printer, or decide to go without one.** The thermal transport
   is the one arm of the switch that is not built: `browser` printing works
   from a device that has a printer attached, `epos` and `cloudprnt` return a
   reason rather than pretending. A pilot without printing is still a pilot —
   the kitchen reads the KDS screen — but decide it deliberately rather than
   discovering it at seven o'clock.

6. **Check the switches.** `payments` OFF. `pos` and `kds` on. `loyalty` as you
   please; it is independent.

---

## The night

**Have the old till running and staffed.** The fallback is not "fix it", the
fallback is "use the register", and every person on the floor should already
know that is allowed.

What to watch, in order of how much it would cost to get wrong:

- **Does the right ticket reach the right station?** A cappuccino and a board
  game on one bill come off two different stock models. If a station sees
  nothing, that is the whole phase failing, and it is the thing to stop for.
- **Does the check total match what the old till says?** They are computed by
  different systems from the same menu. A disagreement is a finding, whichever
  is wrong.
- **Does anything take longer than the old way?** A waiter walking to the
  register because the phone was slow is the failure mode that kills adoption,
  and nobody reports it as a bug.

Known gaps, so they are not mistaken for faults:

- The **counter screen** (`/pos/counter`) has no modifiers and no retail. It is
  the fast path for a counter; the full check screen has both.
- **Closing needs a connection.** A receipt number is issued by the server, on
  purpose, so two tills can never print the same one.
- **Only the counter device works offline**, and only if it has been marked as
  the counter device on that screen. A waiter's phone that loses wifi says so
  and stops — the order goes to the counter, ten steps away.

---

## Afterwards, the same night

1. **`/admin/errors`.** Anything that broke on anybody's phone is here, one row
   per distinct fault with a count. An empty list after a real service is
   itself worth noticing.
2. **Count the drawer** — if `payments` was off, the POS has no cash to
   reconcile, and this is the old till's job as usual.
3. **`/admin/exports`**, sales for the day. Compare the net against the old
   till's Z reading. They will not match to the cent if some orders went
   through the register only; they should match on the ones the POS took.
4. **Ask the staff one question each**: what was slower than before? Write the
   answers down before anybody goes home.

---

## What a pass looks like

Not "no bugs". A pass is:

- every order that went in came out at the right station,
- no check total disagreed with the old till,
- nobody abandoned the POS mid-service to use the register instead, and
- whatever broke is in `/admin/errors` with enough detail to fix it.

Then do it again, on more tables, and only then start turning `payments` on for
one section. A month of that across three branches is the agreed bar for
removing Omega — not a demo, and not one good week.

---

## Two things this document cannot do for you

**Managed backups.** `npm run backup` is a per-document JSON copy: right for
data portability and for the drill, and not a consistent point-in-time
snapshot. Before a paying customer exists, enable Firestore's scheduled backups
or a daily `gcloud firestore export` to a bucket. That needs billing and a
bucket, which is ten minutes in a console and cannot be done from this repo.

**The offline drill.** Working offline is the single property that chose
Firestore over Postgres for this project, and it has never been tested against
a real dropped connection during a service. Mark a device as the counter
device, load `/pos/counter`, turn the café's wifi off at the router, take three
orders, turn it back on, and watch the queue drain. Twenty minutes, and it
tests the one thing a verifier structurally cannot.
