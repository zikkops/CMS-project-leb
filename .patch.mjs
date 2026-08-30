import { readFileSync, writeFileSync } from 'node:fs'
const p = 'docs/deploying.md'
const raw = readFileSync(p, 'utf8'); const crlf = raw.includes('\r\n')
let s = raw.split('\r\n').join('\n')
const rep = (a, b) => { if (!s.includes(a)) throw new Error('MISS: ' + a.slice(0, 60)); s = s.replace(a, b) }

rep(`## Step 8 — Environment variables, in the panel`,
`## Which app serves which hostname

**Nothing in this repo binds a hostname to an app.** There is no routing file,
no vhost config, no manifest. Do not go looking for one. The binding is two
fields on the hPanel application, and only those two:

| Field | What it means |
|---|---|
| **Application URL** | the hostname visitors type |
| **Application root** | the folder whose \`server.js\` answers it |

To make a subdomain serve a different app, edit **Application root** and the
**startup file** to match, then restart. Nothing in the repo changes:

| To serve | Application root | Startup file |
|---|---|---|
| the customer site | \`…/dist/web\` | \`web/server.js\` |
| the admin panel | \`…/dist/admin\` | \`admin/server.js\` |
| the POS | \`…/dist/pos\` | \`pos/server.js\` |

The startup file always repeats the app name, because standalone output nests
in a workspace. Change the root without changing it and you get
\`MODULE_NOT_FOUND\`.

### \`ADMIN_HOST\` does not route — it gates

This is the part that surprises people. \`ADMIN_HOST\` and \`POS_HOST\` do not
send a hostname anywhere. hPanel has already decided which process answers by
the time the app sees the request; these two only tell that process *which
hostname it believes it is*, so it can refuse paths that belong elsewhere.

Which means they must agree with the pairing you set above. If they disagree,
every app in the chain is behaving correctly and the site is dark.

### The mis-pairing signature

Point `admin.cms-projectlb.com` at `dist/web` by mistake, with `ADMIN_HOST`
set correctly, and this is what you get — measured, by running the packaged
web app and sending it these Host headers:

| Host | Path | Result |
|---|---|---|
| cms-projectlb.com | \`/\` | 200 |
| cms-projectlb.com | \`/menu\` | 200 |
| admin.cms-projectlb.com | \`/\` | 307 → \`/admin\` |
| admin.cms-projectlb.com | \`/menu\` | **404** |
| admin.cms-projectlb.com | \`/admin/login\` | **404** |

The subdomain is a total blackout while the apex is perfectly healthy. The
reason is that the app correctly concluded "I am the admin host, so I serve
only \`/admin/**\`" — and it is the *customer* app, which has no \`/admin\`
routes at all. Every layer did its job.

**So: 404 on everything at one subdomain, with the main site fine, means the
Application root points at the wrong app.** It is not DNS, not SSL, and not
the rules.

---

## Step 8 — Environment variables, in the panel`)

writeFileSync(p, crlf ? s.split('\n').join('\r\n') : s)
console.log('ok')
