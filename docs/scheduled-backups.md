# Scheduled backups

Two copies, for two different disasters (UPGRADE.md T5.11).

## The cloud: a managed daily export (owner sets up)

`npm run backup` is for "send me a copy of that café's data" and for the
restore drill. It reads collection by collection while the café may still be
trading, so it is not a point-in-time snapshot. For disaster recovery, Firestore's
own managed export is. It needs a billing account on the project and a Cloud
Storage bucket, so the owner sets it up once, in the Google Cloud console or
with the commands below. None of this has been run from this repo.

1. A bucket in the same region as the database, with a lifecycle rule that
   deletes objects after 30 days:

   ```bash
   gcloud storage buckets create gs://<project>-firestore-backups --location=<region>
   ```

2. A daily scheduled backup, kept for 14 weeks (Firestore's own scheduled
   backups, no bucket needed):

   ```bash
   gcloud firestore backups schedules create --database='(default)' --recurrence=daily --retention=14w
   ```

   Or, for an export to the bucket instead, a Cloud Scheduler job that calls
   `gcloud firestore export gs://<project>-firestore-backups` each night.

3. Once a quarter, restore one into a scratch project and compare it with
   `npm run restore -- <dir>` in compare mode. A backup nobody has restored is
   a rumour.

## The café hub: a nightly copy of pos.db (built)

On a counter PC in hub mode, the POS server copies its SQLite database once a
café day into `backups/` beside it:
`%APPDATA%\BIG CMS POS\hub\backups\pos-YYYY-MM-DD.db`. Seven are kept.

- The copy is SQLite's own `VACUUM INTO`, so it is consistent while the till
  keeps trading. It is written as `.part` and renamed when done, so a
  half-written copy never carries a finished name.
- It is checked a minute after the server starts and every hour, so a PC
  switched off overnight still gets its copy when it comes on.
- Only files named exactly `pos-YYYY-MM-DD.db` are ever deleted.
- The rules are `shared/src/hubBackup.ts`, and the copy is
  `shared/src/server/hubBackup.ts`. Both are asserted in `verify:hub`, which
  makes a real copy and reads it back.

These copies stay on the same PC. They protect against a corrupted database,
not against a stolen or dead PC. For those, the hub's trading is already in the
cloud once it has synced.
