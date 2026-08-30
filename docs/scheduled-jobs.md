# Scheduled jobs

There is exactly one, and it is not running.

## The annual loyalty reset

`GET /api/admin/loyalty/reset` on the **admin** app, once a day. It checks
whether `appSettings/loyaltyReset.nextResetDate` has arrived and, if it has,
zeroes every customer's earned-total for the new cycle and moves the date a
year forward.

**The method matters.** POST on the same route is the "an admin runs it by
hand" path and requires a signed-in admin, so a scheduler using POST gets a
401 saying "Not signed in" — which reads like a wrong secret and is not.

Running it daily rather than yearly is deliberate: a job that fires once a
year is a job nobody finds out is broken until the year it matters.

### Why it stopped

`vercel.json` declared it, and Vercel crons only run on Vercel. The site moved
to Hostinger, the file stayed, and the job silently stopped — a cron that never
fires raises nothing, logs nothing, and looks exactly like a cron that fired
and had nothing to do.

That file has been deleted rather than left as documentation of a thing that
does not happen.

### Setting it up on Hostinger

hPanel → Advanced → Cron Jobs. Daily, and the exact command:

```
curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
  https://admin.cms-projectlb.com/api/admin/loyalty/reset
```

Substitute the real `CRON_SECRET` — the same value the admin app has in its
environment. The route refuses anything else with a 401, and refuses
everything with a 503 if the secret is not configured at all, so a
misconfiguration fails loudly rather than running unauthenticated.

`-fsS` matters: without `-f`, curl exits 0 on an HTTP error and the cron
reports success while the job refused.

### Or from a machine with the repo

```bash
npm run cron:reset
```

Reads `CRON_SECRET` from the root `.env.local` and posts to `ADMIN_URL`
(defaulting to localhost:3001). Useful for testing the wiring; not a
substitute for a scheduled trigger.

### How you find out it is broken

The customers page under Loyalty shows the scheduled date, and now says so in
red when that date has passed — because the only way this fails is silently,
and the failure lasts a year.

That warning is the backstop, not the mechanism. If it ever appears, the cron
is not running.
