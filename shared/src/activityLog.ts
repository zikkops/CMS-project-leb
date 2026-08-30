// The shape of an activity-log entry, for the pages that display them.
//
// This file used to WRITE the log. The browser added its own rows to
// `activityLog` with a client `addDoc`, attributed to whatever
// auth.currentUser said, and every admin screen called into it.
//
// Every one of those writers has moved behind a route handler, and each took
// its logging with it — shared/src/server/activityLog.ts is where entries are
// written now, from a verified token. When the last of them went (the
// password-reset notice on a customer account) nothing was left here to write
// with, so the writer is gone rather than kept around unused.
//
// diffFields() went with it. It only ever fed writeLog(), and the server
// module has its own copy operating on the same field-change shape — the
// entries in the collection are identical either way, so old rows and new ones
// render through the same components below.
//
// Deliberately no 'use client': these are types, and /admin/logs is not the
// only thing that should be able to name them.

export type LogAction = 'create' | 'update' | 'delete'

export interface FieldChange {
  field: string
  before: unknown
  after: unknown
}
